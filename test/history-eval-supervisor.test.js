'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { createSupervisor } = require('../scripts/history-eval-supervisor');

function temporary(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, 'tmp/history-supervisor-test-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
}
const rows = (supervisor) => fs.readFileSync(supervisor.journalPath, 'utf8').trim().split('\n').map(JSON.parse);

test('supervisor stays idle until asked; captures bytes and observes readiness while another process runs', async (t) => {
  const directory = temporary(t);
  const supervisor = createSupervisor({ directory, identity: { trial: 'synthetic' } });
  t.after(() => supervisor.close());
  assert.deepEqual(rows(supervisor).map((row) => row.event), ['supervisor_started']);
  const keeper = supervisor.start({ id: 'control', command: process.execPath, args: ['-e', 'setInterval(()=>{}, 1000)'], input: '' });
  await once(keeper.child, 'spawn');
  supervisor.mark('control', 'ready', { observed: 'spawn-only-control' });
  const capture = Buffer.from([0xff, 0x00, 0xe4, 0xb8, 0xad]);
  const job = supervisor.start({ id: 'query', command: process.execPath,
    args: ['-e', 'process.stdin.on("data",b=>process.stdout.write(b)); process.stdin.on("end",()=>{process.stderr.write("failure 中文");process.exitCode=7})'], input: capture });
  const result = await job.completed;
  assert.equal(result.exitCode, 7);
  assert.equal(result.captureComplete, true);
  assert.deepEqual(fs.readFileSync(result.stdoutPath), capture);
  assert.equal(result.stdoutSha256, sha256(capture));
  assert.equal(result.stdoutBytes, capture.length);
  assert.equal(result.stderrBytes, Buffer.byteLength('failure 中文'));
  assert.equal(keeper.exited, false);
  supervisor.mark('control', 'indexing_complete', { synthetic: true });
  const closing = supervisor.close();
  assert.throws(() => supervisor.start({ id: 'during-close', command: process.execPath }), /open instance/u);
  await Promise.all([closing, supervisor.close()]);
  assert.equal(keeper.exited, true);
  const events = rows(supervisor);
  assert.ok(events.some((row) => row.id === 'query' && row.event === 'exited' && row.cause === 'not_inferred'));
  assert.ok(events.some((row) => row.id === 'control' && row.event === 'cleanup_requested'));
  assert.equal(events.at(-1).event, 'supervisor_closed');
  assert.throws(() => supervisor.start({ id: 'late', command: process.execPath }), /open instance/u);
});

test('timeout retains partial output and records its actual termination reason', async (t) => {
  const supervisor = createSupervisor({ directory: temporary(t) });
  t.after(() => supervisor.close());
  const job = supervisor.start({ id: 'timed', command: process.execPath,
    args: ['-e', 'process.stdout.write("before timeout"); setInterval(()=>{}, 1000)'], input: '', timeoutMs: 400 });
  const result = await job.completed;
  await supervisor.close();
  assert.equal(result.timedOut, true);
  assert.equal(result.stopReason, 'timeout');
  assert.equal(fs.readFileSync(result.stdoutPath, 'utf8'), 'before timeout');
  assert.ok(rows(supervisor).some((row) => row.event === 'timeout'));
  assert.ok(rows(supervisor).some((row) => row.event === 'cleanup_signal'));
});

test('spawn failures remain in lifecycle records and process ids cannot be silently reused', async (t) => {
  const supervisor = createSupervisor({ directory: temporary(t) });
  t.after(() => supervisor.close());
  const job = supervisor.start({ id: 'missing', command: path.join(ROOT, 'tmp', 'nonexistent-history-test-executable'), input: '' });
  const result = await job.completed;
  assert.equal(result.spawnError.code, 'ENOENT');
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.captureComplete, false);
  assert.throws(() => supervisor.start({ id: 'missing', command: process.execPath }), /fresh process id/u);
  await assert.rejects(supervisor.stop('not-owned'), /unowned/u);
  assert.throws(() => supervisor.mark('missing', 'ready'), /Invalid lifecycle mark/u);
  await supervisor.close();
  assert.ok(rows(supervisor).some((row) => row.event === 'process_error'));
});

test('a throwing output consumer is recorded and stops its owned child', async (t) => {
  const supervisor = createSupervisor({ directory: temporary(t) });
  t.after(() => supervisor.close());
  const job = supervisor.start({ id: 'consumer', command: process.execPath,
    args: ['-e', 'process.stdout.write("captured"); setInterval(()=>{}, 1000)'], input: '',
    onStdout() { throw new Error('synthetic output gate failed'); } });
  const result = await job.completed;
  await supervisor.close();
  assert.equal(result.stopReason, 'capture_error');
  assert.equal(result.captureComplete, false);
  assert.equal(fs.readFileSync(result.stdoutPath, 'utf8'), 'captured');
  assert.match(result.captureError.message, /gate failed/u);
});

test('cleanup reaps an owned live process tree while leaving an unrelated owned control alive', async (t) => {
  const supervisor = createSupervisor({ directory: temporary(t) });
  t.after(() => supervisor.close());
  const control = supervisor.start({ id: 'unrelated', command: process.execPath,
    args: ['-e', 'setInterval(()=>{}, 1000)'], input: '' });
  await once(control.child, 'spawn');
  let descendantPid;
  let captured = '';
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  supervisor.start({ id: 'tree', command: process.execPath, input: '', timeoutMs: 5000,
    args: ['-e', 'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{}, 1000)"],{windowsHide:true,stdio:"ignore"}); c.on("spawn",()=>process.stdout.write(String(c.pid)+"\\n")); setInterval(()=>{},1000)'],
    onStdout(bytes) { captured += bytes.toString('utf8'); if (captured.includes('\n')) { descendantPid = Number(captured.trim()); resolveReady(); } } });
  await ready;
  assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
  const result = await supervisor.stop('tree', 'synthetic_tree_cleanup');
  assert.equal(result.cleanupError, null);
  assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
  assert.equal(control.exited, false);
  await supervisor.close();
});
