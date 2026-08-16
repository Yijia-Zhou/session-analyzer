'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PROJECT_QUERY_CHUNK_MAX_ROWS,
  PROJECT_QUERY_GZIP_MIN_BYTES,
  buildProjectQueryStore,
  scanProjectQueryShard,
  validateProjectQueryStore,
} = require('../src/project-query-store');

function fixtureSession() {
  return {
    id: 'session-1',
    logicalEvents: [
      {
        id: 'main-1',
        layer: 'main',
        timestamp: '2026-08-16T00:00:00.000Z',
        kind: 'tool',
        subtype: 'command',
        status: 'failed',
        toolName: 'shell',
        label: 'Command',
        preview: 'alpha target',
        searchText: 'alpha target in output',
        source: { file: '/repo/source.js' },
        touchedFiles: ['/repo/touched.js'],
        rawRefs: [{ file: '/repo/raw.jsonl' }],
      },
      {
        id: 'protocol-1',
        layer: 'protocol',
        timestamp: '2026-08-16T00:00:01.000Z',
        kind: 'protocol',
        subtype: 'turn_context',
        status: '',
        toolName: '',
        label: '',
        preview: 'protocol preview',
        searchText: 'protocol search',
        source: { file: '/repo/protocol.jsonl' },
        touchedFiles: [],
        rawRefs: [],
      },
    ],
    rawEvents: [{
      rawId: 'raw-1',
      timestamp: '2026-08-16T00:00:02.000Z',
      recordType: 'response_item',
      payloadType: 'message',
      role: 'assistant',
      status: '',
      toolName: '',
      preview: 'raw preview',
      searchText: 'raw search',
      source: { file: '/repo/raw.jsonl' },
      touchedFiles: ['/repo/raw-touched.js'],
    }],
  };
}

test('ProjectQueryStore packs three source-neutral layer shards and decodes bounded rows', async () => {
  const session = fixtureSession();
  const store = buildProjectQueryStore([session], {
    presentationForEvent(owner, event) {
      assert.equal(owner, session);
      if (event.id !== 'main-1') return null;
      return {
        scriptOperation: true,
        declaredRequestNames: ['shell'],
        requestEvidence: 'declared_source',
      };
    },
  });
  assert.equal(validateProjectQueryStore(store, ['session-1']), store);
  assert.ok(store.accountedBytes > 0);
  assert.deepEqual([...store.shardsBySessionId.keys()], ['session-1']);
  assert.equal(store.shardsBySessionId.get('session-1').main.rowCount, 1);
  assert.equal(store.shardsBySessionId.get('session-1').protocol.textChunks[0].codec, 'identity');
  assert.equal(store.shardsBySessionId.get('session-1').raw.textChunks[0].codec, 'identity');

  const rows = [];
  await scanProjectQueryShard(store, 'session-1', 'main', { includeText: true }, (row) => rows.push(row));
  assert.deepEqual(rows, [{
    eventId: 'main-1',
    timestamp: '2026-08-16T00:00:00.000Z',
    physicalLayerOrdinal: 0,
    kind: 'tool',
    subtype: 'command',
    status: 'failed',
    toolName: 'shell',
    labelFact: {
      sourceLabel: 'Command',
      recordType: '',
      payloadType: 'command',
    },
    filterFiles: ['/repo/source.js', '/repo/touched.js', '/repo/raw.jsonl'],
    suggestionFiles: ['/repo/touched.js'],
    presentation: {
      scriptOperation: true,
      declaredRequestNames: ['shell'],
      requestEvidence: 'declared_source',
    },
    preview: 'alpha target',
    searchText: 'alpha target in output',
  }]);
});

test('ProjectQueryStore compresses only large Protocol and Raw text chunks', async () => {
  const session = fixtureSession();
  session.logicalEvents[1].searchText = 'p'.repeat(PROJECT_QUERY_GZIP_MIN_BYTES);
  session.rawEvents[0].searchText = 'r'.repeat(PROJECT_QUERY_GZIP_MIN_BYTES);
  const store = buildProjectQueryStore([session]);
  assert.equal(store.shardsBySessionId.get(session.id).main.textChunks[0].codec, 'identity');
  assert.equal(store.shardsBySessionId.get(session.id).protocol.textChunks[0].codec, 'gzip-1');
  assert.equal(store.shardsBySessionId.get(session.id).raw.textChunks[0].codec, 'gzip-1');

  const protocolRows = [];
  await scanProjectQueryShard(store, session.id, 'protocol', { includeText: true }, (row) => {
    protocolRows.push(row);
  });
  assert.equal(protocolRows[0].searchText.length, PROJECT_QUERY_GZIP_MIN_BYTES);
});

test('ProjectQueryStore yields after every bounded chunk and observes cancellation', async () => {
  const session = fixtureSession();
  session.logicalEvents = Array.from({ length: PROJECT_QUERY_CHUNK_MAX_ROWS + 1 }, (_, index) => ({
    ...session.logicalEvents[0],
    id: `event-${index}`,
    preview: `preview-${index}`,
    searchText: `search-${index}`,
  }));
  const store = buildProjectQueryStore([session]);
  const controller = new AbortController();
  let chunks = 0;
  const startedAt = performance.now();
  await assert.rejects(
    scanProjectQueryShard(store, session.id, 'main', {
      includeText: true,
      signal: controller.signal,
      onChunk() {
        chunks += 1;
        controller.abort();
      },
    }, () => {}),
    (error) => error.name === 'AbortError',
  );
  assert.equal(chunks, 1);
  assert.ok(performance.now() - startedAt < 100);
});

test('ProjectQueryStore validates exact Index session ownership and counted storage', () => {
  const store = buildProjectQueryStore([fixtureSession()]);
  assert.throws(
    () => validateProjectQueryStore(store, ['another-session']),
    { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' },
  );
  store.accountedBytes += 1;
  assert.throws(
    () => validateProjectQueryStore(store, ['session-1']),
    { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' },
  );
});

test('ProjectQueryStore projection digest is derived from encoded row facts', () => {
  const claimedDigestStore = buildProjectQueryStore([fixtureSession()]);
  claimedDigestStore.shardsBySessionId.get('session-1').projectionDigest = 'A'.repeat(43);
  assert.throws(
    () => validateProjectQueryStore(claimedDigestStore, ['session-1']),
    (error) => error.code === 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION'
      && /projection digest does not match encoded rows/.test(error.message),
  );

  const mutatedRowStore = buildProjectQueryStore([fixtureSession()]);
  const main = mutatedRowStore.shardsBySessionId.get('session-1').main;
  assert.notEqual(main.kind[0], 0);
  main.kind[0] = 0;
  assert.throws(
    () => validateProjectQueryStore(mutatedRowStore, ['session-1']),
    (error) => error.code === 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION'
      && /projection digest does not match encoded rows/.test(error.message),
  );
});

test('ProjectQueryStore schema is closed and rejects accessors without invoking them', () => {
  const extraStore = buildProjectQueryStore([fixtureSession()]);
  extraStore.unregisteredRows = [];
  assert.throws(
    () => validateProjectQueryStore(extraStore, ['session-1']),
    { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' },
  );

  const accessorStore = buildProjectQueryStore([fixtureSession()]);
  const shard = accessorStore.shardsBySessionId.get('session-1').main;
  let getterCalled = false;
  Object.defineProperty(shard, 'kind', {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled = true;
      return new Uint32Array(shard.rowCount);
    },
  });
  assert.throws(
    () => validateProjectQueryStore(accessorStore, ['session-1']),
    { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' },
  );
  assert.equal(getterCalled, false);
});
