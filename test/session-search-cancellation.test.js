'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('../server');
const { createEmptyMaterializedPresentationIndexes } = require('../src/canonical-contract');
const { getSourceAdapter } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { strictClaudeIndexFromComplete } = require('./strict-claude-fixture');
const { createSessionQuery } = require('../src/session-query');

const DENSE_BYTES = 64 * 1024 * 1024;

function completeIndex(id, dense = false) {
  const logicalEvents = [dense ? 'x'.repeat(DENSE_BYTES) : 'quiet body', 'quiet body'].map((searchText, ordinal) => ({
    id: `${id}:${ordinal}`, sourceKind: 'claude-code', layer: 'main', kind: 'message',
    subtype: 'assistant_message', label: 'Assistant message', timestamp: '2026-10-02T00:00:00.000Z',
    status: '', toolName: '', preview: ordinal ? 'quiet body' : 'dense body', searchText,
    touchedFiles: [], rawRefs: [], source: { file: `${id}.jsonl`, line: ordinal + 1 },
  }));
  const session = {
    id, sourceKind: 'claude-code', title: id, sourceFile: `${id}.jsonl`, bytes: dense ? DENSE_BYTES : 20,
    lineCount: 2, cwdSet: new Set(['G:\\synthetic']), parentSessionId: '', parentSessionInferred: false,
    forkedFromSessionId: '', agentNickname: '', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    counts: { messages: 2, toolCalls: 0, failedCommands: 0 },
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents, rawEvents: [], presentationIndexes: createEmptyMaterializedPresentationIndexes(),
  };
  Object.assign(session, getSourceAdapter('claude-code').query.projectSessionMetadata(session));
  return { sourceKind: 'claude-code', repoRoot: `G:\\synthetic\\${id}`, generatedAt: '2026-10-02T00:00:00.000Z',
    sessions: [session], sessionsById: new Map([[id, session]]), eventKinds: { main: [], protocol: [], raw: [] },
    totals: { sessionCount: 1, eventCount: 2, rawEventCount: 0 } };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('warm 64 MiB session HTTP search counts exactly, yields to state, cancels and retires', { timeout: 60000 }, async (t) => {
  const complete = completeIndex('dense-session', true);
  const initial = strictClaudeIndexFromComplete(complete);
  const replacementComplete = completeIndex('replacement-session');
  const replacement = strictClaudeIndexFromComplete(replacementComplete);
  t.after(() => { disposeProjectQueryStore(initial.projectQueryStore); disposeProjectQueryStore(replacement.projectQueryStore); });
  let materializeCalls = 0;
  const query = getSourceAdapter('claude-code').query;
  const originalTimeline = query.getTimelineAsync;
  assert.equal(typeof originalTimeline, 'function');
  let nextObservation = null;
  // Observe the real scanner without replacing its work or introducing a gate.
  query.getTimelineAsync = async function observedTimeline(...args) {
    const observation = nextObservation;
    nextObservation = null;
    if (!observation) return originalTimeline.apply(this, args);
    observation.signal = args[3]?.signal;
    observation.started.resolve();
    try { return await originalTimeline.apply(this, args); }
    catch (error) { observation.error = error; throw error; }
    finally { observation.finished = true; observation.done.resolve(); }
  };
  t.after(() => { query.getTimelineAsync = originalTimeline; });
  function observeNext() {
    assert.equal(nextObservation, null);
    const observation = { started: deferred(), done: deferred(), finished: false, error: null };
    nextObservation = observation;
    return observation;
  }

  const server = createServer(initial, 0, { sessionPrewarm: false, debugErrors: true,
    buildIndex: async () => replacement,
    materializeSession: async (_index, indexedSession) => {
      materializeCalls += 1;
      return indexedSession.id === complete.sessions[0].id ? complete.sessions[0] : replacementComplete.sessions[0];
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const timeline = `${base}/api/sessions/dense-session/timeline?q=x&limit=1&indexRevision=1`;
  const warm = await fetch(`${base}/api/sessions/dense-session/analysis`);
  assert.equal(warm.status, 200);
  await warm.json();
  assert.equal(materializeCalls, 1);

  await t.test('exact dense count and unrelated HTTP state finish before the scan does', async () => {
    const observation = observeNext();
    const pending = fetch(timeline);
    await observation.started.promise;
    assert.equal(observation.finished, false);
    assert.ok(observation.signal);
    const state = await fetch(`${base}/api/state`);
    assert.equal(state.status, 200);
    assert.equal((await state.json()).indexRevision, 1);
    assert.equal(observation.finished, false, 'state must complete while the real dense scan is in progress');
    const response = await pending;
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.searchMatchCount, 67108864);
    assert.equal(body.searchEventCount, 1);
    assert.equal(body.total, 2);
    assert.deepEqual(body.events.map(event => event.id), ['dense-session:0']);
    assert.equal(body.events[0].hasSearchHit, true);
    assert.equal(materializeCalls, 1, 'search uses the already-warm Materialized Session');

    const later = await fetch(`${timeline}&offset=1`);
    assert.equal(later.status, 200);
    const secondPage = await later.json();
    assert.equal(secondPage.searchMatchCount, 67108864);
    assert.equal(secondPage.total, 2);
    assert.deepEqual(secondPage.events.map(event => event.id), ['dense-session:1']);
    assert.equal(secondPage.events[0].hasSearchHit, false, 'q does not remove non-hit events from timeline pagination');
    assert.equal(materializeCalls, 1);
  });

  await t.test('client abort reaches the real warm scanner before completion', async () => {
    const observation = observeNext();
    const controller = new AbortController();
    const pending = fetch(timeline, { signal: controller.signal }).then(response => ({ response }), error => ({ error }));
    await observation.started.promise;
    assert.equal(observation.finished, false);
    controller.abort();
    const result = await pending;
    assert.equal(result.error?.name, 'AbortError');
    await observation.done.promise;
    assert.equal(observation.signal.aborted, true);
    assert.equal(observation.error?.name, 'AbortError');
    assert.equal(materializeCalls, 1);
    const state = await fetch(`${base}/api/state`);
    assert.equal(state.status, 200);
    await state.json();
  });

  await t.test('index replacement retires an in-progress warm scan with HTTP 409', async () => {
    const observation = observeNext();
    const pending = fetch(timeline);
    await observation.started.promise;
    assert.equal(observation.finished, false);
    const update = await fetch(`${base}/api/project`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoRoot: replacement.repoRoot }) });
    assert.equal(update.status, 202);
    await update.json();
    const response = await pending;
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'INDEX_REVISION_RETIRED');
    await observation.done.promise;
    assert.equal(observation.signal.aborted, true);
    assert.equal(observation.error?.code, 'INDEX_REVISION_RETIRED');
    assert.equal(materializeCalls, 1);
    const state = await fetch(`${base}/api/state`);
    assert.equal(state.status, 200);
    const current = await state.json();
    assert.equal(current.indexRevision, 2);
    assert.equal(current.repoRoot, replacement.repoRoot);
  });
});

for (const excluded of [false, true]) {
  test(`many small ${excluded ? 'structurally excluded' : 'matching'} events yield to cancellation without a large text field`, async () => {
    const index = completeIndex('small-events');
    const session = index.sessions[0];
    session.logicalEvents = Array.from({ length: 1024 }, (_, ordinal) => ({
      ...session.logicalEvents[0], id: `small:${ordinal}`, preview: '', searchText: 'x',
    }));
    let visited = 0;
    const query = createSessionQuery({ presentation: { matchesEvent() { visited += 1; return true; } } });
    const controller = new AbortController();
    const reason = new Error('queued small-event cancellation');
    setImmediate(() => controller.abort(reason));
    await assert.rejects(query.getTimelineAsync(index, session, {
      layer: 'main', q: 'x', status: excluded ? 'failed' : '', offset: 0, limit: 1,
    }, { signal: controller.signal }), error => error === reason);
    assert.ok(visited > 0 && visited < session.logicalEvents.length,
      'cancellation runs after scanning starts and before every row is visited');
    assert.ok(session.logicalEvents.every(event => !Object.hasOwn(event, 'searchMatch')));
  });
}

test('concurrent Protocol and Raw timeline queries keep exact independent counts and leave the cached session untouched', async () => {
  const index = completeIndex('parallel-layers');
  const session = index.sessions[0];
  session.logicalEvents = ['x x y', 'y y'].map((searchText, ordinal) => ({
    ...session.logicalEvents[ordinal], id: `protocol:${ordinal}`, layer: 'protocol', preview: '', searchText,
  }));
  session.rawEvents = session.logicalEvents.map((event, ordinal) => ({
    rawId: `raw:${ordinal}`, sourceKind: 'claude-code', timestamp: event.timestamp,
    recordType: 'assistant', payloadType: 'message', role: 'assistant', status: '', toolName: '',
    preview: '', searchText: event.searchText, source: event.source, touchedFiles: [],
  }));
  const before = structuredClone(session);
  const query = createSessionQuery();
  const requests = ['protocol', 'raw'].flatMap(layer => ['x', 'y'].map(q => ({ layer, q, offset: 0, limit: 2 })));
  const results = await Promise.all(requests.map(filters => query.getTimelineAsync(index, session, filters)));
  results.forEach((result, ordinal) => {
    const { layer, q } = requests[ordinal];
    assert.equal(result.total, 2);
    assert.equal(result.searchMatchCount, q === 'x' ? 2 : 3);
    assert.equal(result.searchEventCount, q === 'x' ? 1 : 2);
    assert.deepEqual(result.events.map(event => event.hasSearchHit), q === 'x' ? [true, false] : [true, true]);
    assert.deepEqual(result.events.map(event => event.id), [`${layer}:0`, `${layer}:1`]);
    assert.ok(result.events.every(event => !Object.hasOwn(event, 'searchText') && !Object.hasOwn(event, 'searchMatch')));
  });
  assert.deepEqual(session, before);
});
