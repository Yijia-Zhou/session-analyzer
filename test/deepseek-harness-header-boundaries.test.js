'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../src/deepseek-harness-storage');
const { discoverDeepSeekProjects, buildDeepSeekIndex } = require('../src/deepseek-harness');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-header-boundary-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const sourceHome = path.join(root, 'sessions');
  const directory = path.join(sourceHome, 'project', 'boundary');
  await fsp.mkdir(repoRoot);
  await fsp.mkdir(directory, { recursive: true });
  return {
    repoRoot, sourceHome, file: path.join(directory, 'session.jsonl'),
    header: { type: 'session', version: 0, id: 'boundary', createdAt: 1,
      cwd: repoRoot, delegationDepth: 0, agentPreset: 'x' },
  };
}

function sizedLine(header, bytes) {
  const padding = bytes - Buffer.byteLength(`${JSON.stringify(header)}\n`);
  return `${JSON.stringify({ ...header, agentPreset: header.agentPreset + 'x'.repeat(padding) })}\n`;
}

for (const bytes of [65535, 65536, 65537, 131224]) {
  test(`DeepSeek ${bytes}-byte header survives discovery and indexing`, async (t) => {
    const f = await fixture(t);
    const line = sizedLine(f.header, bytes);
    assert.equal(Buffer.byteLength(line), bytes);
    await fsp.writeFile(f.file, line);
    assert.deepEqual(await storage.readSessionHeader(f.file), storage.parseHeaderText(line));
    const diagnostics = [];
    const projects = await discoverDeepSeekProjects({ ...f, onDiagnostic: (d) => diagnostics.push(d) });
    assert.equal(projects.length, 1);
    assert.equal(projects[0].repoRoot, f.repoRoot);
    assert.equal(projects[0].sessionCount, 1);
    assert.deepEqual(diagnostics, []);
    const index = await buildDeepSeekIndex(f);
    assert.equal(index.sessions.length, 1);
    assert.equal(index.sessions[0].sourceSessionId, f.header.id);
    assert.equal(index.sourceDiagnostics.totalCount, 0);
  });
}

test('DeepSeek preserves UTF-8 characters split across header read chunks', async (t) => {
  const f = await fixture(t);
  const prefix = JSON.stringify({ ...f.header, agentPreset: '' }).slice(0, -2);
  const line = `${prefix}${'x'.repeat(65535 - Buffer.byteLength(prefix))}中🙂"}\n`;
  assert.equal(Buffer.from(line)[65535], Buffer.from('中')[0]);
  await fsp.writeFile(f.file, line);
  assert.deepEqual(await storage.readSessionHeader(f.file), storage.parseHeaderText(line));
  assert.equal((await discoverDeepSeekProjects(f)).length, 1);
  const index = await buildDeepSeekIndex(f);
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sourceDiagnostics.totalCount, 0);
});

test('DeepSeek header budget is inclusive and missing newline remains invalid', async (t) => {
  const f = await fixture(t);
  const limit = storage.MAX_FIRST_RECORD_BYTES;
  const line = sizedLine(f.header, limit);
  await fsp.writeFile(f.file, line);
  assert.deepEqual(await storage.readSessionHeader(f.file), storage.parseHeaderText(line));
  for (const invalid of [sizedLine(f.header, limit + 1), sizedLine(f.header, 70000).trimEnd(), '']) {
    await fsp.writeFile(f.file, invalid);
    await assert.rejects(storage.readSessionHeader(f.file), { code: 'DEEPSEEK_STORAGE_INVALID' });
  }
  await fsp.writeFile(f.file, line);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(storage.readSessionHeader(f.file, 'none', controller.signal), { name: 'AbortError' });
});
