'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOpenCodeFixture, insertSession, insertMessage, TIME } = require('./helpers/opencode-fixture');
const { buildOpenCodeIndex, opencodeAdapter, discoverOpenCodeProjects } = require('../src/opencode');
const { validateIndexOwnershipForCommit, materializeSessionForIndex, readIndexedRawRecord,
  buildEventDetailForSession, supportedSourceKinds } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');
const storage = require('../src/opencode-storage');

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-opencode-integration-'));
  const value = createOpenCodeFixture({ dbPath: path.join(root, 'source', 'opencode.db'),
    repoRoot: path.join(root, 'project'), ...overrides });
  const indexes = [];
  t.after(async () => {
    for (const index of indexes) await disposeIndexResources(index);
    value.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { ...value, root, sourceHome: value.dbPath, indexes,
    snapshotBase: path.join(root, 'snapshots') };
}
async function indexFor(f, options = {}) {
  const index = await buildOpenCodeIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot,
    snapshotBase: f.snapshotBase, ...options });
  f.indexes.push(index);
  await validateIndexOwnershipForCommit(index);
  return index;
}
async function userEvidence(index) {
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  const event = session.logicalEvents.find((item) => item.kind === 'user_message');
  const raw = await readIndexedRawRecord(index, session, event.rawRefs[0].rawId);
  return { session, event, raw };
}

test('OpenCode is a native source; canonical indexes retain descriptors instead of transcript payloads', async (t) => {
  const f = await fixture(t);
  assert.ok(supportedSourceKinds().includes('opencode'));
  assert.equal(opencodeAdapter.sessionLifecycle, 'indexed-materialized-v1');
  const projects = await discoverOpenCodeProjects({ sourceHome: f.sourceHome });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].repoRoot, f.repoRoot);
  const index = await indexFor(f);
  const indexed = index.sessions[0];
  assert.equal(indexed.lineCount, 0, 'SQLite rows must not be represented as file lines');
  assert.equal(Object.hasOwn(indexed, 'rawEvents'), false);
  assert.equal(Object.hasOwn(indexed, 'logicalEvents'), false);
  const { session, event, raw } = await userEvidence(index);
  assert.equal(await projectQueryProjectionDigestAsync(session, opencodeAdapter.query.projectQueryPresentation),
    indexed.queryProjectionDigest);
  assert.equal(raw.sourceLocator.type, 'sqlite_row');
  assert.equal(raw.sourceLocator.table, 'session_message');
  assert.equal(raw.sourceLocator.messageID, f.messageId);
  assert.equal(raw.sourceLocator.snapshotId, indexed.materializationDescriptor.sourceSnapshotId);
  const expected = { ...f.db.prepare('SELECT * FROM session_message WHERE id=?').get(f.messageId) };
  assert.deepEqual(JSON.parse(raw.raw), expected, 'Raw returns the original relational row including data text');
  const detail = await buildEventDetailForSession(index, session, event.id, 'main');
  assert.match(JSON.stringify(detail), /OpenCode fixture question/);
});

test('OpenCode Index retains the capture boundary canonical project identity for UNC input', async (t) => {
  const f = await fixture(t);
  const canonicalRoot = '\\\\server\\share\\project';
  // Exercise the adapter's producer/consumer boundary on every host. Storage
  // tests separately cover accepting native paths and rejecting foreign paths.
  t.mock.method(storage, 'captureOpenCodeProject', async () => ({
    source: { databasePath: f.sourceHome }, manifest: { repoRoot: canonicalRoot },
    sessions: [], snapshotRoot: f.snapshotBase, dispose: async () => {},
  }));
  const index = await buildOpenCodeIndex({ sourceHome: f.sourceHome, repoRoot: '//server/share/project' });
  f.indexes.push(index);
  assert.equal(index.repoRoot, canonicalRoot);
});

test('same-ID updates do not alter old search, Detail or Raw; a rebuild captures new content', async (t) => {
  const f = await fixture(t, { userText: 'OLD_SNAPSHOT_MARKER' });
  const old = await indexFor(f);
  const original = await userEvidence(old);
  const before = { ...f.db.prepare('SELECT seq,time_updated FROM session_message WHERE id=?').get(f.messageId) };
  const data = JSON.parse(original.raw.parsed.data);
  data.text = 'NEW_SNAPSHOT_MARKER';
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify(data), f.messageId);
  assert.deepEqual({ ...f.db.prepare('SELECT seq,time_updated FROM session_message WHERE id=?').get(f.messageId) }, before);
  const fresh = await indexFor(f);
  const updated = await userEvidence(fresh);
  assert.equal(fresh.sessions[0].id, old.sessions[0].id);
  assert.notEqual(fresh.sessions[0].materializationDescriptor.sourceSnapshotId,
    old.sessions[0].materializationDescriptor.sourceSnapshotId);
  assert.match(updated.raw.raw, /NEW_SNAPSHOT_MARKER/);
  assert.match((await readIndexedRawRecord(old, original.session, original.event.rawRefs[0].rawId)).raw, /OLD_SNAPSHOT_MARKER/);
  assert.match(JSON.stringify(await buildEventDetailForSession(old, original.session, original.event.id, 'main')),
    /OLD_SNAPSHOT_MARKER/);
  await assert.rejects(buildEventDetailForSession(fresh, original.session, original.event.id, 'main'),
    { code: 'INDEXED_SOURCE_STALE' });
});

test('metadata-only changes and deletion create new captures without rewriting surviving old evidence', async (t) => {
  const f = await fixture(t);
  const old = await indexFor(f);
  const original = await userEvidence(old);
  f.db.prepare('UPDATE session_v2 SET title=? WHERE id=?').run('METADATA_CHANGED', f.sessionId);
  const renamed = await indexFor(f);
  assert.equal(renamed.sessions[0].title, 'METADATA_CHANGED');
  assert.notEqual(renamed.sessions[0].materializationDescriptor.sourceSnapshotId,
    old.sessions[0].materializationDescriptor.sourceSnapshotId);
  f.db.prepare('DELETE FROM session_message WHERE seq>=2').run();
  const reverted = await indexFor(f);
  assert.equal(reverted.sessions[0].rawEventCount, 2, 'one metadata row and one surviving message');
  f.db.prepare('DELETE FROM session_message').run();
  f.db.prepare('DELETE FROM session_v2').run();
  const removed = await indexFor(f);
  assert.equal(removed.sessions.length, 0);
  assert.match((await readIndexedRawRecord(old, original.session, original.event.rawRefs[0].rawId)).raw,
    /OpenCode fixture question/);
});

test('parent/subagent sessions are discovered and fork histories retain their separate identity', async (t) => {
  const f = await fixture(t);
  insertSession(f.db, { id: 'ses_child', parent_id: f.sessionId, directory: f.repoRoot, title: 'Child' });
  insertMessage(f.db, { id: 'msg_child', session_id: 'ses_child' });
  insertSession(f.db, { id: 'ses_fork', fork_session_id: f.sessionId, directory: f.repoRoot, title: 'Fork',
    cost: 0, tokens_input: 0, tokens_output: 0 });
  insertMessage(f.db, { id: 'msg_fork', session_id: 'ses_fork' });
  const index = await indexFor(f);
  assert.equal(index.sessions.length, 3);
  const byNative = new Map(index.sessions.map((s) => [s.sourceSessionId, s]));
  assert.equal(byNative.get('ses_child').parentSessionId, byNative.get(f.sessionId).id);
  assert.equal(byNative.get('ses_fork').parentSessionId, '');
  assert.equal(byNative.get('ses_fork').forkedFromSessionId, byNative.get(f.sessionId).id);
});

test('snapshot tampering fails both warm detail and Raw without a live-database fallback', async (t) => {
  const f = await fixture(t);
  const index = await indexFor(f);
  const { session, event } = await userEvidence(index);
  const file = path.join(index.snapshotRoot, index.sessions[0].materializationDescriptor.payload.fileName);
  const data = await fs.readFile(file, 'utf8');
  await fs.chmod(file, 0o600);
  await fs.writeFile(file, data.replace('OpenCode fixture question', 'TAMPERED fixture content'));
  await assert.rejects(readIndexedRawRecord(index, session, event.rawRefs[0].rawId), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(buildEventDetailForSession(index, session, event.id, 'main'), { code: 'INDEXED_SOURCE_STALE' });
});

test('capture and build failures clean candidates while the previous captured revision remains readable', async (t) => {
  const f = await fixture(t);
  const index = await indexFor(f);
  const { session, event } = await userEvidence(index);
  const before = (await fs.readdir(f.snapshotBase)).sort();
  await assert.rejects(buildOpenCodeIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot,
    snapshotBase: f.snapshotBase, limits: { maxMessages: 1 } }), { code: 'OPENCODE_CAPTURE_LIMIT' });
  await assert.rejects(buildOpenCodeIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot,
    snapshotBase: f.snapshotBase, limits: { maxQueryBytes: 1 } }), { code: 'OPENCODE_BUDGET_EXCEEDED' });
  await assert.rejects(buildOpenCodeIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot,
    snapshotBase: f.snapshotBase, onProgress(progress) {
      if (progress.phase === 'parsing') throw Object.assign(new Error('Synthetic build failure'), { code: 'TEST_BUILD_FAILURE' });
    } }), { code: 'TEST_BUILD_FAILURE' });
  assert.deepEqual((await fs.readdir(f.snapshotBase)).sort(), before);
  assert.match((await readIndexedRawRecord(index, session, event.rawRefs[0].rawId)).raw, /OpenCode fixture question/);
});

test('history search and evidence refs read the captured OpenCode source without its executable', async (t) => {
  const f = await fixture(t, { userText: 'HISTORY_OPENCODE_MARKER' });
  const service = await createHistoryService({ repo: f.repoRoot, source: 'opencode', opencodeHome: f.sourceHome });
  try {
    const status = await service.execute('status');
    assert.equal(status.coverage.source, 'opencode');
    assert.equal(status.coverage.sessionCount, 1);
    const result = await service.execute('search', { query: 'HISTORY_OPENCODE_MARKER' });
    assert.equal(result.scan.matchedSessions, 1);
    const detail = await service.execute('read', { refs: [result.items[0].ref], parts: ['message', 'raw'] });
    assert.ok(detail.items[0].rawRefs.length);
    const raw = await service.execute('read', { refs: detail.items[0].rawRefs, parts: ['raw'] });
    assert.match(JSON.stringify(raw), /HISTORY_OPENCODE_MARKER/);
  } finally { await service.close(); }
});
