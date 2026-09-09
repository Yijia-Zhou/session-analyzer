'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const {
  buildProjectQueryStore,
  validateProjectQueryStore,
} = require('../src/project-query-store');
const { createSessionQuery } = require('../src/session-query');

const ROWS_PER_LAYER = 4_097;

function logical(layer, index) {
  const hit = index === ROWS_PER_LAYER - 1;
  return {
    id: `${layer}:${index}`,
    sourceKind: 'fixture-source',
    layer,
    kind: layer === 'main' ? 'message' : 'protocol',
    subtype: layer === 'main' ? 'assistant_message' : 'turn_context',
    label: '',
    timestamp: `2026-08-16T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    status: '',
    toolName: '',
    preview: hit ? 'late layer needle' : `ordinary ${layer} row ${index}`,
    searchText: hit ? 'late layer needle in canonical search' : `search ${layer} row ${index}`,
    touchedFiles: [],
    rawRefs: [],
    source: { file: `${layer}.jsonl`, line: index + 1 },
  };
}

function raw(index) {
  const hit = index === ROWS_PER_LAYER - 1;
  return {
    rawId: `raw:${index}`,
    sourceKind: 'fixture-source',
    timestamp: `2026-08-16T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    recordType: 'event_msg',
    payloadType: 'message',
    role: 'assistant',
    status: '',
    toolName: '',
    preview: hit ? 'late layer needle' : `ordinary raw row ${index}`,
    searchText: hit ? 'late layer needle in canonical search' : `search raw row ${index}`,
    touchedFiles: [],
    source: { file: 'raw.jsonl', line: index + 1 },
  };
}

function fixtureIndex() {
  const session = {
    id: 'performance-session',
    sourceKind: 'fixture-source',
    title: 'Performance fixture',
    sourceFile: 'fixture.jsonl',
    bytes: 1,
    lineCount: ROWS_PER_LAYER * 3,
    cwdSet: [],
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T01:00:00.000Z',
    counts: { messages: 0, toolCalls: 0, failedCommands: 0 },
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents: [
      ...Array.from({ length: ROWS_PER_LAYER }, (_, index) => logical('main', index)),
      ...Array.from({ length: ROWS_PER_LAYER }, (_, index) => logical('protocol', index)),
    ],
    rawEvents: Array.from({ length: ROWS_PER_LAYER }, (_, index) => raw(index)),
  };
  return {
    sourceKind: 'fixture-source',
    repoRoot: '/fixture',
    sessions: [session],
    sessionsById: new Map([[session.id, session]]),
  };
}

test('packed Main, Protocol, and Raw cold scans preserve the oracle within the M3 bound', async (t) => {
  const query = createSessionQuery();
  const oracle = fixtureIndex();
  const projectedSessions = oracle.sessions.map((session) => ({
    ...session,
    ...query.projectSessionMetadata(session),
  }));
  const packed = {
    ...oracle,
    sessions: projectedSessions,
    sessionsById: new Map(projectedSessions.map((session) => [session.id, session])),
    projectQueryStore: buildProjectQueryStore(projectedSessions),
  };
  validateProjectQueryStore(packed.projectQueryStore, projectedSessions.map((session) => session.id));
  const timings = {};
  for (const layer of ['main', 'protocol', 'raw']) {
    const filters = { q: 'late layer needle', layer, locale: 'en' };
    const oracleStarted = performance.now();
    const expected = query.filterSessions(oracle, filters);
    const oracleMs = performance.now() - oracleStarted;
    let chunks = 0;
    const packedStarted = performance.now();
    const actual = await query.filterSessions(packed, filters, {
      onChunk() { chunks += 1; },
    });
    const packedMs = performance.now() - packedStarted;
    timings[layer] = { oracleMs, packedMs, chunks };
    assert.deepEqual(actual, expected);
    assert.equal(chunks, 2);
    assert.ok(
      packedMs < Math.max(2_000, oracleMs * 2),
      `${layer} cold scan ${packedMs.toFixed(1)}ms exceeded its M3 bound`,
    );
  }
  t.diagnostic(JSON.stringify({
    rowsPerLayer: ROWS_PER_LAYER,
    accountedBytes: packed.projectQueryStore.accountedBytes,
    timings,
  }));
});

test('metadata-only structural filtering hydrates one preview chunk and no search text scan', async (t) => {
  const query = createSessionQuery();
  const oracle = fixtureIndex();
  const projectedSessions = oracle.sessions.map((session) => ({
    ...session,
    ...query.projectSessionMetadata(session),
  }));
  const packed = {
    ...oracle,
    sessions: projectedSessions,
    sessionsById: new Map(projectedSessions.map((session) => [session.id, session])),
    projectQueryStore: buildProjectQueryStore(projectedSessions),
  };
  validateProjectQueryStore(packed.projectQueryStore, projectedSessions.map((session) => session.id));
  const filters = { q: '', kind: 'message', layer: 'main', locale: 'en' };
  const expected = query.filterSessions(oracle, filters);
  let metadataChunks = 0;
  let hydratedTextChunks = 0;
  const started = performance.now();
  const actual = await query.filterSessions(packed, filters, {
    onChunk() { metadataChunks += 1; },
    onTextChunk() { hydratedTextChunks += 1; },
  });
  const packedMs = performance.now() - started;
  assert.deepEqual(actual, expected);
  assert.equal(metadataChunks, 2);
  assert.equal(hydratedTextChunks, 1);
  assert.ok(packedMs < 2_000, `metadata-only packed scan ${packedMs.toFixed(1)}ms exceeded its bound`);
  t.diagnostic(JSON.stringify({
    rows: ROWS_PER_LAYER,
    metadataChunks,
    hydratedTextChunks,
    packedMs,
  }));
});
