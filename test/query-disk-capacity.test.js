'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildProjectQueryStore, createProjectQueryStoreBuilder, disposeProjectQueryStore,
  PROJECT_QUERY_CHUNK_MAX_BYTES,
  projectQueryProjectionDigest, projectQueryProjectionDigestForSession,
  scanProjectQueryShard, validateProjectQueryStoreForCommit,
} = require('../src/project-query-store');
const { withQueryStoreBuildScope } = require('../src/project-query-disk');
const { createSessionQuery } = require('../src/session-query');
const { searchTextParts } = require('../src/search-text-stream');
const { capacitySession, capacityIndex } = require('../scripts/query-capacity-fixture');

function tempRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'query-disk-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('UTF-8 frame byte boundary selects storage representation without rejecting an event', async (t) => {
  const directory = tempRoot(t);
  const overhead = 8 + Buffer.byteLength('Synthetic preview');
  for (const delta of [-1, 0, 1]) {
    const text = `😀${'x'.repeat(PROJECT_QUERY_CHUNK_MAX_BYTES - overhead - 4 + delta)}`;
    const session = capacitySession(`boundary-${delta}`, 1, text, ['main']);
    const store = buildProjectQueryStore([session], { tempRoot: directory });
    try {
      assert.equal(store.schemaVersion, delta <= 0 ? 2 : 3);
      const query = createSessionQuery();
      const result = await query.filterSessions(capacityIndex(query, [session], store), { q: '😀', layer: 'main' });
      assert.equal(result.matchingEventTotal, 1);
      assert.equal(result.sessions[0].searchMatch.latestEvent.id, `${session.id}:main:0`);
    } finally { disposeProjectQueryStore(store); }
  }
});

test('oversized three-layer events retain identity and full project search across UTF-8/text boundaries', async (t) => {
  const directory = tempRoot(t);
  const text = `${'a'.repeat(256 * 1024 - 1)}中文😀boundary ${'b'.repeat(4 * 1024 * 1024)} A${' \t'.repeat(180000)}B tailNeedle`;
  const session = capacitySession('oversized', 1, text);
  const store = buildProjectQueryStore([session], { tempRoot: directory });
  t.after(() => disposeProjectQueryStore(store));
  assert.equal(store.schemaVersion, 3);
  assert.equal(projectQueryProjectionDigestForSession(store, session.id), projectQueryProjectionDigest(session));
  await validateProjectQueryStoreForCommit(store, [session.id]);
  const query = createSessionQuery();
  const index = capacityIndex(query, [session], store);
  for (const layer of ['main', 'protocol', 'raw']) {
    assert.equal(store.shardsBySessionId.get(session.id)[layer].rowCount, 1);
    for (const q of ['中文😀boundary', 'A B', 'tailNeedle']) {
      const result = await query.filterSessions(index, { q, layer });
      assert.equal(result.total, 1, `${layer}: ${q}`);
      assert.equal(result.matchingEventTotal, 1);
      assert.equal(result.sessions[0].searchMatch.eventCount, 1);
      assert.equal(result.sessions[0].searchMatch.latestEvent.id, `oversized:${layer}:0`);
      assert.ok(result.sessions[0].searchMatch.latestEvent.snippet.length <= 266);
    }
  }
  disposeProjectQueryStore(store);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('adaptive spill preserves existing memory rows, projection digests and structural filters', async (t) => {
  const directory = tempRoot(t);
  const first = capacitySession('first');
  const second = capacitySession('second');
  const builder = createProjectQueryStoreBuilder({ memoryRows: 3, tempRoot: directory });
  const firstDigest = builder.addSession(first);
  assert.deepEqual(fs.readdirSync(directory), []);
  builder.addSession(second);
  const store = builder.finish();
  t.after(() => disposeProjectQueryStore(store));
  assert.equal(store.schemaVersion, 3);
  assert.equal(projectQueryProjectionDigestForSession(store, first.id), firstDigest);
  await validateProjectQueryStoreForCommit(store, [first.id, second.id]);
  const query = createSessionQuery();
  const index = capacityIndex(query, [first, second], store);
  const hits = await query.filterSessions(index, { q: 'needle', layer: 'main', file: 'src/capacity.js' });
  assert.equal(hits.matchingEventTotal, 2);
  assert.equal((await query.filterSessions(index, { q: 'needle', layer: 'main', status: 'failed' })).total, 0);
});

test('disk manifest depends on values rather than V8 object or string representations', async (t) => {
  const directory = tempRoot(t);
  const session = capacitySession('manifest-values');
  const store = buildProjectQueryStore([session], { memoryRows: 0, tempRoot: directory });
  t.after(() => disposeProjectQueryStore(store));
  const shards = store.shardsBySessionId.get(session.id);
  for (const layer of ['main', 'protocol', 'raw']) for (const page of shards[layer].pages) {
    const start = page.start;
    page.start = start + 0.5;
    page.start = start;
    const digest = page.digest;
    page.digest = (`中${digest}`).slice(1);
    assert.equal(page.digest, digest);
  }
  if (typeof global.gc === 'function') global.gc();
  await validateProjectQueryStoreForCommit(store, [session.id]);
  const query = createSessionQuery();
  assert.equal((await query.filterSessions(capacityIndex(query, [session], store), { q: 'needle', layer: 'main' })).total, 1);
});

test('disk build, commit and query cancellation clean temporary ownership while preserving a finished store', async (t) => {
  const directory = tempRoot(t);
  const large = capacitySession('large', 1, 'z'.repeat(8 * 1024 * 1024), ['main']);
  const store = buildProjectQueryStore([large], { tempRoot: directory });
  t.after(() => disposeProjectQueryStore(store));
  const reason = new Error('synthetic cancellation');
  for (const operation of ['query', 'commit']) {
    const controller = new AbortController();
    setImmediate(() => controller.abort(reason));
    const pending = operation === 'commit'
      ? validateProjectQueryStoreForCommit(store, [large.id], { signal: controller.signal })
      : scanProjectQueryShard(store, large.id, 'main', {
        signal: controller.signal, includeText: true,
        searchTextParts: (preview, text, signal) => searchTextParts(preview, text, 'missing', signal),
      }, () => {});
    await assert.rejects(pending, error => error === reason);
    assert.equal(fs.readdirSync(directory).length, 1);
  }
  const controller = new AbortController();
  const builder = createProjectQueryStoreBuilder({ signal: controller.signal, tempRoot: directory });
  setImmediate(() => controller.abort(reason));
  await assert.rejects(builder.addSessionAsync(large), error => error === reason);
  assert.equal(fs.readdirSync(directory).length, 1, 'aborted builder directory removed');
  const query = createSessionQuery();
  assert.equal((await query.filterSessions(capacityIndex(query, [large], store), { q: 'zzz', layer: 'main' })).total, 1);
  await assert.rejects(withQueryStoreBuildScope(async () => {
    buildProjectQueryStore([capacitySession('discarded')], { memoryRows: 0, tempRoot: directory });
    throw reason;
  }), error => error === reason);
  assert.equal(fs.readdirSync(directory).length, 1, 'failed build scope only cleans its own store');
});

test('disk resource exhaustion removes failed replacement storage and preserves committed search', async (t) => {
  const directory = tempRoot(t);
  const oldSession = capacitySession('committed');
  const store = buildProjectQueryStore([oldSession], { memoryRows: 0, tempRoot: directory });
  t.after(() => disposeProjectQueryStore(store));
  const originalWrite = fs.writeSync;
  fs.writeSync = () => { const error = new Error('synthetic full disk'); error.code = 'ENOSPC'; throw error; };
  try {
    assert.throws(() => buildProjectQueryStore([capacitySession('replacement')], { memoryRows: 0, tempRoot: directory }),
      { code: 'PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED' });
  } finally { fs.writeSync = originalWrite; }
  assert.equal(fs.readdirSync(directory).length, 1);
  const query = createSessionQuery();
  assert.equal((await query.filterSessions(capacityIndex(query, [oldSession], store), { q: 'needle', layer: 'main' })).total, 1);
});
