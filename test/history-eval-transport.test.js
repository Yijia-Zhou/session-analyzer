'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { freeze } = require('../scripts/freeze-history-eval');
const { freezeScope } = require('../scripts/history-eval-scope');
const { capture } = require('../scripts/history-eval-mcp');
const { startGateTransport, readDescriptor, MAX_AUTH_BYTES, AUTH_TIMEOUT_MS } = require('../scripts/history-eval-transport');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function fixture(t, condition = 'raw') {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp/history-transport-parent-test-'));
  let transport;
  t.after(async () => { if (transport) await transport.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const original = path.join(root, 'rollout-transport.jsonl');
  fs.writeFileSync(original, [
    { type: 'session_meta', payload: { id: 'transport-synthetic', cwd: project } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'SYNTHETIC_TRANSPORT_EVIDENCE' } },
  ].map(JSON.stringify).join('\n') + '\n');
  const corpus = freeze({ target: path.join(root, 'frozen'), inputs: [original], repo: project });
  const corpusManifest = path.join(root, 'frozen/manifest.json');
  const port = await freePort();
  const serveArgs = ['serve', '--repo', project, '--source', 'codex', '--codex-home', corpus.codexHome, '--port', String(port)];
  const scopeFile = path.join(root, 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify(await freezeScope({ corpusManifest, serveArgs, expectedSessionIds: ['transport-synthetic'] })));
  const guideRoot = path.join(root, 'guide'); fs.mkdirSync(guideRoot);
  fs.writeFileSync(path.join(guideRoot, 'SKILL.md'), 'Synthetic guide.');
  const config = { directory: path.join(root, 'gate'), trial: 'synthetic-transport', condition, task: 'transport',
    model: 'synthetic', harness: 'transport-test', scopeFile, corpusManifest, runtimeRoot: ROOT,
    maxRetrievalCalls: 80, maxOutputBytes: 65536, serveArgs, port, serviceTimeoutMs: 20000,
    initialState: 'no-service', calibrationControl: condition !== 'raw', pollWaitMs: 50,
    guideRoot, guides: { 'SKILL.md': sha256('Synthetic guide.') }, rgExecutable: 'rg' };
  const descriptorFile = path.join(root, 'transport.json');
  transport = await startGateTransport({ config, descriptorFile });
  return { root, config, corpus, transport, descriptorFile, descriptor: readDescriptor(descriptorFile) };
}

function attempt(descriptor, firstLine, { silent = false } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: descriptor.host, port: descriptor.port });
    const chunks = [];
    socket.on('error', (error) => { if (!['ECONNRESET', 'EPIPE'].includes(error.code)) reject(error); });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('connect', () => { if (!silent) socket.write(firstLine); });
    socket.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
function startShim(t, file, script = 'history-eval-transport.js') {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', script), file],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let id = 0, captured = '', stderr = '';
  child.stdout.on('data', (bytes) => { captured += bytes.toString('utf8'); });
  child.stderr.on('data', (bytes) => { stderr += bytes.toString('utf8'); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => { const response = JSON.parse(line); const settle = pending.get(response.id); if (settle) { pending.delete(response.id); settle(response); } });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  t.after(() => { if (child.exitCode === null) child.kill(); });
  return { child, output: () => captured, stderr: () => stderr,
    call(method, params = {}) { const requestId = ++id; return new Promise((resolve) => { pending.set(requestId, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n'); }); } };
}
const rows = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

test('transport shutdown cancellation retains received capture and ends the owned raw subprocess', async () => {
  const controller = new AbortController();
  const pending = capture(process.execPath, ['-e', 'process.stdout.write("before-close");setInterval(()=>{},1000)'], { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 500);
  const result = await pending;
  clearTimeout(timer);
  assert.equal(result.failure.code, 'COMMAND_CANCELLED');
  assert.equal(result.captureComplete, false);
  assert.equal(result.stdout.toString('utf8'), 'before-close');
});

test('authentication rejects wrong/oversized/stalled requests without leaking token or consuming the valid slot', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  assert.equal(JSON.stringify(f.transport.transport).includes(f.descriptor.token), false);
  assert.equal(await attempt(f.descriptor, JSON.stringify({ token: '0'.repeat(64) }) + '\n'), '');
  assert.equal(await attempt(f.descriptor, 'x'.repeat(MAX_AUTH_BYTES + 1)), '');
  const start = performance.now();
  assert.equal(await attempt(f.descriptor, '', { silent: true }), '');
  assert.ok(performance.now() - start >= AUTH_TIMEOUT_MS - 100);
  const shim = startShim(t, f.descriptorFile);
  const result = await shim.call('tools/list');
  assert.deepEqual(result.result.tools.map((tool) => tool.name), ['history_eval']);
  assert.equal(await attempt(f.descriptor, JSON.stringify({ token: f.descriptor.token }) + '\n'), '');
  assert.equal(shim.output().includes(f.descriptor.token), false);
  assert.equal(shim.stderr().includes(f.descriptor.token), false);
  shim.child.stdin.end(); await once(shim.child, 'close');
  await f.transport.close();
});

test('descriptor validation rejects remote addresses, arbitrary gate configuration and malformed secrets', () => {
  assert.throws(() => readDescriptor('relative.json'), /absolute path/u);
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp/history-transport-descriptor-test-'));
  try {
    const file = path.join(root, 'descriptor.json');
    const valid = { schemaVersion: 1, kind: 'parent-owned-loopback', host: '127.0.0.1', port: 17891, token: 'a'.repeat(64) };
    for (const value of [{ ...valid, host: 'example.com' }, { ...valid, token: 'bad' }, { ...valid, port: 0 }, { ...valid, config: { source: 'other' } }]) {
      fs.writeFileSync(file, JSON.stringify(value)); assert.throws(() => readDescriptor(file), /Invalid transport descriptor/u);
    }
    fs.writeFileSync(file, `{"token":"${valid.token}`);
    assert.throws(() => readDescriptor(file), { message: 'Invalid transport descriptor' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('existing direct MCP stdin entry still handles the same protocol and closes its journal', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const config = { ...f.config, directory: path.join(f.root, 'legacy-gate') };
  const file = path.join(f.root, 'legacy-config.json'); fs.writeFileSync(file, JSON.stringify(config));
  const legacy = startShim(t, file, 'history-eval-mcp.js');
  assert.deepEqual((await legacy.call('tools/list')).result.tools.map((tool) => tool.name), ['history_eval']);
  const response = await legacy.call('tools/call', { name: 'history_eval', arguments: { args: ['raw', 'read', f.corpus.files[0].relativePath, '1', '2'] } });
  assert.equal(response.result.isError, false);
  legacy.child.stdin.end(); await once(legacy.child, 'close');
  assert.equal(rows(path.join(config.directory, 'processes/lifecycle.jsonl')).at(-1).event, 'supervisor_closed');
});

test('actual gate preserves scope and resource denials through the forwarding shim', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const shim = startShim(t, f.descriptorFile);
  assert.equal((await shim.call('initialize', { protocolVersion: '2024-11-05' })).result.serverInfo.name, 'history-eval-gate');
  assert.equal((await shim.call('resources/read', { uri: 'file:///outside' })).error.code, -32601);
  const response = await shim.call('tools/call', { name: 'history_eval', arguments: { args: ['raw', 'read', f.corpus.files[0].relativePath, '1', '2'] } });
  assert.equal(response.result.isError, false);
  assert.match(response.result.content[0].text, /SYNTHETIC_TRANSPORT_EVIDENCE/u);
  const outside = await shim.call('tools/call', { name: 'history_eval', arguments: { args: ['raw', 'read', '../outside.jsonl'] } });
  assert.equal(outside.result.isError, true);
  shim.child.stdin.end(); await once(shim.child, 'close');
  await f.transport.close();
});

test('worker termination leaves parent-owned service/control alive until explicit parent cleanup writes complete lifecycle', { timeout: 30000 }, async (t) => {
  const f = await fixture(t, 'current');
  const shim = startShim(t, f.descriptorFile);
  const call = (args) => shim.call('tools/call', { name: 'history_eval', arguments: { args } });
  const start = await call(['history', ...f.config.serveArgs]);
  assert.equal(start.result.isError, false);
  let ready = false;
  const deadline = Date.now() + 20000;
  while (!ready && Date.now() < deadline) {
    const response = await call(['history', 'status', '--endpoint', `http://127.0.0.1:${f.config.port}`]);
    assert.equal(response.result.isError, false);
    ready = JSON.parse(response.result.content[0].text).coverage?.indexing === 'complete';
  }
  assert.equal(ready, true);
  const lifecycleFile = path.join(f.config.directory, 'processes/lifecycle.jsonl');
  const before = rows(lifecycleFile);
  const children = before.filter((row) => row.event === 'started');
  assert.deepEqual(children.map((row) => row.id).sort(), ['control', 'service']);
  assert.ok(before.filter((row) => row.event === 'start_requested').every((row) => row.parentPid === process.pid));
  const closed = once(shim.child, 'close'); shim.child.kill(); await closed;
  for (const child of children) assert.doesNotThrow(() => process.kill(child.pid, 0));
  await Promise.all([f.transport.close(), f.transport.close()]);
  const after = rows(lifecycleFile);
  for (const child of children) {
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    const end = after.find((row) => row.event === 'closed' && row.id === child.id);
    assert.equal(end.captureComplete, true); assert.equal(end.cleanupError, null); assert.equal(end.stopReason, 'trial_cleanup');
  }
  assert.equal(after.at(-1).event, 'supervisor_closed');
});
