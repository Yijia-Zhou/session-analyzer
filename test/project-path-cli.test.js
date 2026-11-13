'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { requestHistory } = require('../src/history-cli');
const { interpretProjectPath } = require('../src/shared/project-path');

const forward = '//localhost/synthetic-project/Project';
const unc = '\\\\localhost\\synthetic-project\\Project';
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-cli-'));
  const originals = new Map();
  for (const [i, cwd] of [forward, unc].entries()) {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const file = path.join(home, 'sessions', `rollout-${id}.jsonl`);
    const text = [
      { type: 'session_meta', payload: { id, cwd } },
      { type: 'event_msg', payload: { type: 'user_message', message: `SYNTHETIC_DIRECT_CLI_${i}` } },
    ].map(JSON.stringify).join('\n') + '\n';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text); originals.set(file, text);
  }
  const config = path.join(home, 'paths.json');
  const configBytes = JSON.stringify({ codex: { home: '.', projectPathRules: [
    { scope: 'container', path: 'sessions', interpretation: 'unc' },
  ] } });
  await fs.writeFile(config, configBytes); originals.set(config, configBytes);
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return { home, config, port, originals };
}
function start(t, f, history = false) {
  const args = [path.join(__dirname, '..', 'server.js'), ...(history ? ['history', 'serve'] : []),
    '--source', 'codex', '--repo', forward, '--path-config', f.config,
    '--project-path-semantics', 'windows', '--port', String(f.port)];
  const child = spawn(process.execPath, args, { cwd: f.home, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', error => { output += error.stack; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(timer); }
  });
  t.after(() => fs.rm(f.home, { recursive: true, force: true }));
  return { child, output: () => output, endpoint: `http://127.0.0.1:${f.port}` };
}
async function ready(running, operation) {
  let last;
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.equal(running.child.exitCode, null, running.output());
    try { last = await operation(); if (last) return last; } catch (error) { last = error; }
    await delay(25);
  }
  assert.fail(`CLI did not become ready: ${running.output()}\n${last?.stack || JSON.stringify(last)}`);
}
async function unchanged(f) {
  for (const [file, bytes] of f.originals) assert.equal(await fs.readFile(file, 'utf8'), bytes);
}

test('normal CLI directly indexes scoped UNC without discovery and reports its effective project', { timeout: 20000 }, async t => {
  const f = await fixture(t); const running = start(t, f);
  const state = await ready(running, async () => {
    const response = await fetch(`${running.endpoint}/api/state`, { signal: AbortSignal.timeout(1000) });
    const body = response.ok ? await response.json() : null;
    return body?.projectSelected && body.totals ? body : null;
  });
  assert.equal(state.totals.sessionCount, 2);
  assert.equal(state.projectPath.key, interpretProjectPath(unc).key);
  assert.equal(state.repoRoot, unc);
  assert.ok(running.output().includes('Repo: indexing ' + unc), 'startup message must not reinterpret the explicit UNC selection as POSIX');
  await unchanged(f);
});

test('history CLI directly loads scoped UNC configuration and reads both spelling variants', { timeout: 20000 }, async t => {
  const f = await fixture(t); const running = start(t, f, true);
  const status = await ready(running, async () => {
    const result = await requestHistory(running.endpoint, 'status', {});
    return result.error ? null : result;
  });
  assert.equal(status.coverage.sessionCount, 2);
  const search = await requestHistory(running.endpoint, 'search', { queries: ['SYNTHETIC_DIRECT_CLI_'] });
  assert.equal(search.scan.matchedSessions, 2);
  const read = await requestHistory(running.endpoint, 'read', { refs: search.items.map(item => item.ref) });
  assert.equal(read.items.length, 2);
  for (const marker of ['SYNTHETIC_DIRECT_CLI_0', 'SYNTHETIC_DIRECT_CLI_1']) assert.ok(JSON.stringify(read).includes(marker));
  await unchanged(f);
});
