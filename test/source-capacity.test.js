'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const storage = require('../src/deepseek-harness-storage');
const { discoverDeepSeekProjects, buildDeepSeekIndex } = require('../src/deepseek-harness');
const { buildClaudeSourceBackedIndex } = require('../src/claude');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'source-capacity-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const sourceHome = path.join(root, 'sessions');
  await fsp.mkdir(repoRoot);
  await fsp.mkdir(sourceHome);
  return { root, repoRoot, sourceHome };
}

function header(repoRoot, extra = {}) {
  return { type: 'session', version: 0, id: 'capacity', createdAt: 1,
    cwd: repoRoot, delegationDepth: 0, ...extra };
}

// A standards-compliant single-segment Zstd frame with raw blocks lets us
// independently vary encoded and decoded bytes, without random fixtures.
function rawFrame(text) {
  const bytes = Buffer.from(text);
  const prefix = Buffer.alloc(9);
  prefix.writeUInt32LE(0xFD2FB528);
  prefix[4] = 0xA0;
  prefix.writeUInt32LE(bytes.length, 5);
  const pieces = [prefix];
  for (let offset = 0; offset < bytes.length; offset += 128 * 1024) {
    const block = bytes.subarray(offset, offset + 128 * 1024);
    const control = Buffer.alloc(3);
    control.writeUIntLE((block.length << 3) | (offset + block.length === bytes.length ? 1 : 0), 0, 3);
    pieces.push(control, block);
  }
  return Buffer.concat(pieces);
}

for (const compression of ['none', 'zstd']) {
  test(`DeepSeek ${compression} >4 MiB first record survives discovery and indexing`, async (t) => {
    const f = await fixture(t);
    const dir = path.join(f.sourceHome, 'project', 'capacity');
    await fsp.mkdir(dir, { recursive: true });
    // v0 accepts opaque extension fields; they do not become searchable text
    // or UI metadata. This is a valid large header, not a giant fake identity.
    const line = `${JSON.stringify(header(f.repoRoot, { extension: '界'.repeat(1_400_000) }))}\n`;
    const bytes = compression === 'none' ? Buffer.from(line) : rawFrame(line);
    assert.ok(bytes.length > 4 * 1024 * 1024);
    const file = path.join(dir, `session.jsonl${compression === 'zstd' ? '.zstd' : ''}`);
    await fsp.writeFile(file, bytes);
    assert.equal((await storage.readSessionHeader(file)).id, 'capacity');
    const projects = await discoverDeepSeekProjects(f);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].sessionCount, 1);
    const index = await buildDeepSeekIndex(f);
    assert.equal(index.sessions.length, 1);
    assert.equal(index.sourceDiagnostics.totalCount, 0);
  });

  test(`DeepSeek ${compression} header state and decoded capacity are distinct`, async (t) => {
    const f = await fixture(t);
    const dir = path.join(f.sourceHome, 'project', 'capacity');
    await fsp.mkdir(dir, { recursive: true });
    const line = `${JSON.stringify(header(f.repoRoot, { extension: '界🙂'.repeat(1000) }))}\n`;
    const file = path.join(dir, `session.jsonl${compression === 'zstd' ? '.zstd' : ''}`);
    const bytes = compression === 'none' ? Buffer.from(line) : zstdCompressSync(Buffer.from(line));
    await fsp.writeFile(file, bytes);
    assert.equal((await storage.readSessionHeader(file, compression, undefined, { maxChars: line.length })).id, 'capacity');
    await assert.rejects(storage.readSessionHeader(file, compression, undefined, { maxChars: line.length - 1 }),
      { code: 'DEEPSEEK_HEADER_RESOURCE_EXHAUSTED' });
    for (const [value, code] of [[bytes.subarray(0, bytes.length - 1), 'DEEPSEEK_HEADER_UNCOMMITTED'],
      [Buffer.alloc(0), 'DEEPSEEK_STORAGE_EMPTY']]) {
      await fsp.writeFile(file, value);
      await assert.rejects(storage.readSessionHeader(file), { code });
      const index = await buildDeepSeekIndex(f);
      assert.equal(index.sessions.length, 0);
      assert.equal(index.sourceDiagnostics.counts[code], 1);
    }
    const invalid = Buffer.from('{}\n');
    await fsp.writeFile(file, compression === 'none' ? invalid : zstdCompressSync(invalid));
    await assert.rejects(storage.readSessionHeader(file), { code: 'DEEPSEEK_STORAGE_INVALID' });
  });

  test(`DeepSeek ${compression} header cancellation interrupts I/O and closes the file`, async (t) => {
    const f = await fixture(t);
    const file = path.join(f.root, `session.jsonl${compression === 'zstd' ? '.zstd' : ''}`);
    const text = `${JSON.stringify(header(f.repoRoot, { extension: 'x'.repeat(300000) }))}\n`;
    await fsp.writeFile(file, compression === 'none' ? Buffer.from(text) : rawFrame(text));
    const original = fsp.open;
    const controller = new AbortController();
    let closed = false;
    let reads = 0;
    t.mock.method(fsp, 'open', async (...args) => {
      const handle = await original(...args);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = async (...readArgs) => {
        const value = await read(...readArgs);
        if (++reads === 2) controller.abort();
        return value;
      };
      handle.close = async () => { await close(); closed = true; };
      return handle;
    });
    await assert.rejects(storage.readSessionHeader(file, compression, controller.signal), { name: 'AbortError' });
    assert.equal(closed, true);
    assert.equal(reads, 2);
  });
}

test('DeepSeek discovery isolates a header resource failure and retains healthy artifacts', async (t) => {
  const f = await fixture(t);
  for (const id of ['capacity', 'healthy']) {
    const dir = path.join(f.sourceHome, 'project', id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'session.jsonl'), `${JSON.stringify(header(f.repoRoot,
      { id, ...(id === 'capacity' ? { extension: 'x'.repeat(1000) } : {}) }))}\n`);
  }
  const original = storage.readSessionHeader;
  t.mock.method(storage, 'readSessionHeader', (file, compression, signal) =>
    original(file, compression, signal, { maxChars: 500 }));
  const diagnostics = [];
  const projects = await discoverDeepSeekProjects({ ...f, onDiagnostic: (d) => diagnostics.push(d) });
  assert.equal(projects[0].sessionCount, 1);
  assert.equal(diagnostics[0].code, 'DEEPSEEK_HEADER_RESOURCE_EXHAUSTED');
  const index = await buildDeepSeekIndex(f);
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessions[0].sourceSessionId, 'healthy');
  assert.equal(index.sourceDiagnostics.counts.DEEPSEEK_HEADER_RESOURCE_EXHAUSTED, 1);
});

test('Claude compact tree evidence supports first index, reuse, rebuild and cancellation', async (t) => {
  const f = await fixture(t);
  const container = path.join(f.root, 'projects', 'capacity');
  await fsp.mkdir(container, { recursive: true });
  const file = path.join(container, 'capacity.jsonl');
  const row = (content, uuid) => `${JSON.stringify({ type: 'user', sessionId: 'capacity',
    cwd: f.repoRoot, uuid, timestamp: '2026-09-01T00:00:00.000Z',
    message: { role: 'user', content } })}\n`;
  await fsp.writeFile(file, row('first', 'one'));
  const options = { claudeHome: f.root, repoRoot: f.repoRoot };
  const first = await buildClaudeSourceBackedIndex(options);
  const reused = await buildClaudeSourceBackedIndex({ ...options, previousIndex: first });
  assert.equal(first.sessions.length, 1);
  assert.equal(reused.projectQueryStore, first.projectQueryStore);
  await fsp.mkdir(path.join(container, 'extra'));
  await fsp.writeFile(path.join(container, 'extra', 'note.txt'), 'tree changed');
  await fsp.appendFile(file, row('tail', 'two'));
  const rebuilt = await buildClaudeSourceBackedIndex({ ...options, previousIndex: reused });
  assert.equal(rebuilt.sessions[0].rawEventCount, 2);
  assert.notEqual(rebuilt.projectQueryStore, reused.projectQueryStore);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildClaudeSourceBackedIndex({ ...options, signal: controller.signal }), { name: 'AbortError' });
});
