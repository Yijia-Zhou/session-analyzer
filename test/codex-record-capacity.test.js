'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const { zstdCompressSync } = require('node:zlib');
const storage = require('../src/codex-rollout-storage');
const codex = require('../src/codex');
const { disposeIndexResources } = require('../src/index-resources');

const capacityError = (error) => error.code === 'CODEX_ROLLOUT_RECORD_TOO_LARGE'
  && error.statusCode === 413;
async function collect(input, options) {
  const result = [];
  for await (const line of storage.readLogicalLines(input, options)) result.push(line);
  return result;
}

test('bounded Codex lines retain UTF-8, empty lines and split CRLF at exact byte limits', async () => {
  const bytes = Buffer.from('界🙂\r\n\r\nx\ry\nlast');
  for (const width of [1, 2, 3, 8, bytes.length]) {
    const chunks = [];
    for (let i = 0; i < bytes.length; i += width) chunks.push(bytes.subarray(i, i + width));
    const input = Readable.from(chunks);
    assert.deepEqual(await collect(input, { maxLineBytes: 7 }), ['界🙂', '', 'x', 'y', 'last']);
    assert.equal(input.destroyed, true);
  }
  assert.deepEqual(await collect(Readable.from([])), []);
  assert.deepEqual(await collect(Readable.from([Buffer.from('\n\n')])), ['', '']);
});

test('oversized Codex lines reject before consuming the remainder and identify the physical line', async () => {
  let reads = 0;
  const input = Readable.from((async function* () {
    yield Buffer.from('ok\n');
    for (let i = 0; i < 1000; i += 1) { reads += 1; yield Buffer.from('界🙂'); }
  })());
  await assert.rejects(collect(input, { maxLineBytes: 7 }), (error) => {
    assert.equal(error.lineNumber, 2);
    assert.equal(error.limitBytes, 7);
    assert.ok(error.observedBytes > 7);
    return capacityError(error);
  });
  assert.ok(reads < 10, 'backpressure stops the oversized source early');
  assert.equal(input.destroyed, true);
  await assert.rejects(collect(Readable.from([Buffer.from('eight888')]), { maxLineBytes: 7 }), capacityError);
});

test('bounded Codex readers propagate I/O and cancellation and close on early return', async () => {
  const cause = Object.assign(new Error('synthetic read failure'), { code: 'EIO' });
  await assert.rejects(collect(Readable.from((async function* () { yield Buffer.from('part'); throw cause; })())),
    (error) => error === cause);
  const controller = new AbortController();
  const input = new Readable({ read() { this.push(Buffer.from('partial')); this._read = () => {}; } });
  const pending = collect(input, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(input.destroyed, true);
  const early = Readable.from([Buffer.from('first\nsecond\n')]);
  for await (const line of storage.readLogicalLines(early)) { assert.equal(line, 'first'); break; }
  assert.equal(early.destroyed, true);
});

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-record-capacity-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const root = path.join(home, 'sessions');
  await fs.mkdir(root);
  const repoRoot = path.join(home, 'repo');
  const text = (id) => JSON.stringify({ type: 'session_meta', payload: { id, cwd: repoRoot }, timestamp: '2026-11-13T00:00:00Z' })
    + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'healthy task' }, timestamp: '2026-11-13T00:00:01Z' }) + '\n';
  await fs.writeFile(path.join(root, 'rollout-healthy.jsonl'), text('healthy'));
  return { home, root, repoRoot, text };
}

for (const compressed of [false, true]) {
  test(`single-line read applies decoded capacity to ${compressed ? 'Zstandard' : 'plain'} artifacts`, async (t) => {
    const f = await fixture(t);
    const file = path.join(f.root, `rollout-lines.jsonl${compressed ? '.zst' : ''}`);
    const bytes = Buffer.from('small\n' + '界🙂'.repeat(10) + '\n');
    await fs.writeFile(file, compressed ? zstdCompressSync(bytes) : bytes);
    assert.equal((await storage.readLogicalLine(file, 1, { maxLineBytes: 7 })).line, 'small');
    await assert.rejects(storage.readLogicalLine(file, 2, { maxLineBytes: 7 }), capacityError);
  });
}

async function oversizedFixture(t) {
  const f = await fixture(t);
  const file = path.join(f.root, 'rollout-oversized.jsonl');
  await fs.writeFile(file, f.text('oversized'));
  // Sparse synthetic input reproduces the original > V8 string ceiling without
  // storing private content or allocating a huge fixture string in the test.
  await fs.truncate(file, 540 * 1024 * 1024);
  return { ...f, file };
}

test('discovery and both index builders exclude oversized artifacts without partial Sessions', async (t) => {
  const f = await oversizedFixture(t);
  const diagnostics = [];
  const projects = await codex.discoverProjects({ codexHome: f.home, onDiagnostic: (d) => diagnostics.push(d) });
  assert.equal(projects[0].sessionCount, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'CODEX_ROLLOUT_RECORD_TOO_LARGE');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build({ codexHome: f.home, repoRoot: f.repoRoot });
    try {
      assert.deepEqual(index.sessions.map((s) => s.id), ['healthy']);
      assert.equal(index.sourceDiagnostics.counts.CODEX_ROLLOUT_RECORD_TOO_LARGE, 1);
      assert.equal(index.totals.unknownFileCount, 1);
    } finally { await disposeIndexResources(index); }
  }
});

test('project statistics with an oversized record leave the HTTP process alive', { timeout: 30000 }, async (t) => {
  const f = await oversizedFixture(t);
  const child = spawn(process.execPath, ['-e', `
    const { createServer } = require('./server');
    const server = createServer(null, 0, { source: 'codex', codexHome: process.argv[1] });
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `, f.home], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())));
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Server exited ${code}: ${stderr}`)));
  });
  const get = async (route) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, stderr);
    return response.json();
  };
  assert.equal((await get('/api/projects?summary=1')).summary, true);
  const full = await get('/api/projects');
  assert.equal(full.projects[0].sessionCount, 1);
  assert.equal(full.sourceDiagnostics.counts.CODEX_ROLLOUT_RECORD_TOO_LARGE, 1);
  assert.equal((await get('/api/projects?summary=1')).summary, true);
  assert.equal(child.exitCode, null);
  assert.doesNotMatch(stderr, /Invalid string length|uncaught/i);
});
