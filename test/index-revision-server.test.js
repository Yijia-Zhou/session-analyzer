'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('../server');
const { buildProjectQueryStore } = require('../src/project-query-store');
const { getSourceAdapter } = require('../src/source-adapters');

function session(id, eventCount = 0) {
  const logicalEvents = Array.from({ length: eventCount }, (_, index) => ({
    id: `${id}:event:${index}`,
    sourceKind: 'codex',
    layer: 'main',
    kind: 'message',
    subtype: 'assistant_message',
    label: 'Assistant message',
    timestamp: `2026-08-16T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    status: '',
    toolName: '',
    preview: `target row ${index}`,
    searchText: `target searchable row ${index}`,
    touchedFiles: [],
    rawRefs: [],
    source: { file: `${id}.jsonl`, line: index + 1 },
  }));
  return {
    id,
    sourceKind: 'codex',
    title: id,
    sourceFile: `${id}.jsonl`,
    bytes: 1,
    lineCount: eventCount,
    cwdSet: new Set(['G:\\repo']),
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T01:00:00.000Z',
    counts: { messages: eventCount, toolCalls: 0, failedCommands: 0 },
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents,
    rawEvents: [],
    presentationIndexes: { codeModeDeclaredRequests: new Map() },
  };
}

function index(id, eventCount = 0, withStore = false) {
  const item = session(id, eventCount);
  const value = {
    sourceKind: 'codex',
    repoRoot: `G:\\repo\\${id}`,
    generatedAt: '2026-08-16T00:00:00.000Z',
    sessions: [item],
    sessionsById: new Map([[item.id, item]]),
    eventKinds: { main: [], protocol: [], raw: [] },
    totals: { sessionCount: 1, eventCount, rawEventCount: 0 },
  };
  if (withStore) {
    const query = getSourceAdapter('codex').query;
    const projected = { ...item, ...query.projectSessionMetadata(item) };
    value.sessions = [projected];
    value.sessionsById = new Map([[projected.id, projected]]);
    value.projectQueryStore = buildProjectQueryStore([projected], {
      presentationForEvent: query.projectQueryPresentation,
    });
  }
  return value;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('server retires an in-flight packed query and never emits a mixed revision response', async () => {
  const initial = index('initial', 20_000, true);
  const replacement = index('replacement');
  const server = createServer(initial, 1, {
    buildIndex: async () => replacement,
  });
  const base = await listen(server);
  try {
    const pendingQuery = fetch(`${base}/api/sessions?q=target&layer=main`);
    await new Promise((resolve) => setImmediate(resolve));
    const replacementResponse = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: replacement.repoRoot }),
    });
    assert.equal(replacementResponse.status, 202);
    const retiredAt = performance.now();
    const queryResponse = await pendingQuery;
    const retirementLatencyMs = performance.now() - retiredAt;
    assert.equal(queryResponse.status, 409);
    assert.equal((await queryResponse.json()).code, 'INDEX_REVISION_RETIRED');
    assert.ok(retirementLatencyMs < 100, `retirement took ${retirementLatencyMs.toFixed(1)}ms`);

    let stateResponse;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      stateResponse = await fetch(`${base}/api/state`);
      if (stateResponse.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.indexRevision, 2);
    assert.equal(state.repoRoot, replacement.repoRoot);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
