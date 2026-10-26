'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, discoverPiProjects } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord,
  validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { createPiEntryReference, resolvePiEntryReference } = require('../src/pi-navigation');
const { disposeProjectQueryStore } = require('../src/project-query-store');

async function roundTrip(t, relativeFiles) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-path-roundtrip-'));
  const repoRoot = path.join(sourceHome, 'project');
  const sessionsRoot = path.join(sourceHome, 'sessions');
  let index;
  t.after(async () => {
    if (index) disposeProjectQueryStore(index.projectQueryStore);
    await fs.rm(sourceHome, { recursive: true, force: true });
  });
  await fs.mkdir(repoRoot);
  await fs.mkdir(sessionsRoot);
  const timestamp = '2026-10-26T05:00:00.000Z';
  const originals = new Map();
  for (const [number, relative] of relativeFiles.entries()) {
    const nativeId = `path-${number}`;
    const record = { type: 'message', id: 'question', parentId: null, timestamp,
      message: { role: 'user', content: `Exact artifact ${nativeId}`, timestamp: Date.parse(timestamp) } };
    const line = JSON.stringify(record);
    const text = JSON.stringify({ type: 'session', version: 3, id: nativeId, cwd: repoRoot, timestamp }) + '\n' + line + '\n';
    const file = path.join(sessionsRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    originals.set(relative, { nativeId, file, line, text });
  }
  const projects = await discoverPiProjects({ sourceHome });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].sessionCount, relativeFiles.length);
  const diagnostics = [];
  index = await buildPiIndex({ sourceHome, repoRoot, onDiagnostic: (item) => diagnostics.push(item) });
  assert.equal(index.sessions.length, relativeFiles.length, 'all discovered files survive the second indexing read');
  assert.deepEqual(diagnostics, []);
  assert.equal(index.totals.skippedFileCount, 0);
  await validateIndexOwnershipForCommit(index);
  assert.deepEqual(index.sessions.map((item) => item.sourceFile).sort(), [...relativeFiles].sort());
  for (const stored of index.sessions) {
    const original = originals.get(stored.sourceFile);
    assert.equal(stored.sourceSessionId, original.nativeId, 'literal backslash cannot alias a directory separator');
    const session = await materializeSessionForIndex(index, stored);
    const event = session.logicalEvents.find((item) => item.kind === 'user_message');
    assert.equal(event.sourceLocator.file, stored.sourceFile);
    const detail = await buildEventDetailForSession(index, session, event.id, 'main');
    assert.ok(detail.timelineSections.some((section) => section.html?.includes(`Exact artifact ${original.nativeId}`)));
    const raw = await readIndexedRawRecord(index, session, event.rawRefs[0].rawId);
    assert.equal(raw.raw, original.line);
    assert.equal(raw.sourceLocator.file, stored.sourceFile);
    const { reference } = await createPiEntryReference(index, stored, event.id, 'main');
    const resolved = await resolvePiEntryReference(index, reference);
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.target.sessionId, stored.id);
    assert.equal(resolved.target.eventId, event.id);
    assert.equal(resolved.target.layer, 'main');
    assert.equal(await fs.readFile(original.file, 'utf8'), original.text);
  }
}

test('pi nested artifact paths round-trip through index, detail, Raw and native bookmarks', async (t) => {
  await roundTrip(t, ['nested/saved.jsonl']);
});

test('pi POSIX literal backslashes in filenames and directory names remain distinct from separators', {
  skip: process.platform === 'win32' ? 'Windows reserves backslash as a path separator' : false,
}, async (t) => {
  await roundTrip(t, ['history\\copy.jsonl', 'history/copy.jsonl', 'dir\\name/saved.jsonl', 'dir/name/saved.jsonl']);
});
