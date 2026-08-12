'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  __testOnly,
  buildEventDetail,
  buildIndex,
  fileSuggestions,
  filterSessions,
  getTimeline,
} = require('../src/codex');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const repoRoot = 'G:\\vibe\\term-agent';
const COMPACT_RAW_KEYS = new Set([
  'aggregatedOutput',
  'callId',
  'canonicalType',
  'commandText',
  'durationMs',
  'embeddedImages',
  'exitCode',
  'line',
  'maxObservedTokens',
  'messageText',
  'output',
  'payloadType',
  'preview',
  'rawId',
  'rawIndex',
  'recordType',
  'reviewLifecyclePhase',
  'reviewThreadId',
  'role',
  'searchText',
  'sessionId',
  'sessionMetaId',
  'source',
  'sourceClientVersion',
  'sourceKind',
  'sourceLineDigest',
  'sourceLocator',
  'status',
  'stderr',
  'stdout',
  'threadName',
  'timestamp',
  'toolName',
  'touchedFiles',
  'turnId',
  'typeKey',
]);

function runtimeRawProjection(raw) {
  const { parsed, _canonicalRawDigest, ...projection } = raw;
  return projection;
}

function timeline(index, sessionId, layer) {
  return getTimeline(index, sessionId, {
    layer,
    offset: 0,
    limit: 10_000,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
  });
}

function assertNoReachableParsedGraph(root) {
  const pending = [root];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Map) {
      for (const [key, entry] of value) pending.push(key, entry);
      continue;
    }
    if (value instanceof Set) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    assert.equal(Object.hasOwn(value, 'parsed'), false, 'committed index retains a parsed source subtree');
    for (const entry of Object.values(value)) pending.push(entry);
  }
}

test('default Codex index retains only the explicit compact Raw projection', async () => {
  const index = await buildIndex({ repoRoot, codexHome: fixtureCodexHome });
  assertNoReachableParsedGraph(index);
  for (const session of index.sessions) {
    assert.equal(session.residentRepresentation, 'codex-compact-v1');
    for (const raw of session.rawEvents) {
      assert.equal(Object.hasOwn(raw, 'parsed'), false, raw.rawId);
      assert.equal(Object.hasOwn(raw, 'payload'), false, raw.rawId);
      assert.equal(Object.hasOwn(raw, '_canonicalRawDigest'), false, raw.rawId);
      assert.match(raw.sourceLineDigest, /^[A-Za-z0-9_-]{43}$/, raw.rawId);
      for (const key of Object.keys(raw)) {
        assert.equal(COMPACT_RAW_KEYS.has(key), true, `${raw.rawId}:${key}`);
      }
    }
  }
});

test('sync detail fails explicitly when a compact Session has not been source-hydrated', async () => {
  const index = await buildIndex({ repoRoot, codexHome: fixtureCodexHome });
  const session = index.sessions[0];
  const event = session.logicalEvents[0];
  assert.throws(
    () => buildEventDetail(session, event.id, event.layer),
    { code: 'DETAIL_SOURCE_HYDRATION_REQUIRED' },
  );
});

test('compaction closes scalar and locator slots over malformed source-shaped values', () => {
  const sourceObject = { nested: { source: 'must not survive' } };
  const compact = __testOnly.compactCodexRawEvent({
    rawId: sourceObject,
    sessionId: 'session',
    source: { file: 'file.jsonl', line: 1, payload: sourceObject },
    sourceLocator: { type: 'jsonl_line', file: 'file.jsonl', line: 1, payload: sourceObject },
    recordType: sourceObject,
    payloadType: sourceObject,
    role: sourceObject,
    status: sourceObject,
    toolName: sourceObject,
    sourceClientVersion: sourceObject,
    touchedFiles: ['kept.txt', sourceObject],
    embeddedImages: [],
  });

  assert.equal(compact.rawId, '');
  assert.equal(compact.recordType, '');
  assert.equal(compact.payloadType, '');
  assert.equal(compact.role, '');
  assert.equal(compact.status, '');
  assert.equal(compact.toolName, '');
  assert.equal(compact.sourceClientVersion, '');
  assert.deepEqual(compact.sourceLocator, { type: 'jsonl_line', file: 'file.jsonl', line: 1 });
  assert.deepEqual(compact.touchedFiles, ['kept.txt']);
  assert.equal(JSON.stringify(compact).includes('must not survive'), false);
});

test('compact and parse-resident builds preserve timeline, search, analysis, fork, and presentation behavior', async () => {
  const options = { repoRoot, codexHome: fixtureCodexHome };
  const resident = await __testOnly.buildUncompactedIndexForDetailTests(options);
  const compact = await buildIndex(options);

  assert.deepEqual(compact.totals, resident.totals);
  assert.deepEqual(compact.eventKinds, resident.eventKinds);
  assert.deepEqual(compact.codeModeRequests, resident.codeModeRequests);
  assert.deepEqual(fileSuggestions(compact, ''), fileSuggestions(resident, ''));
  assert.deepEqual(
    filterSessions(compact, { q: 'alpha', sort: 'updated-desc', layer: 'main' }),
    filterSessions(resident, { q: 'alpha', sort: 'updated-desc', layer: 'main' }),
  );

  for (const compactSession of compact.sessions) {
    const residentSession = resident.sessionsById.get(compactSession.id);
    assert.ok(residentSession);
    assert.deepEqual(compactSession.rawEvents, residentSession.rawEvents.map(runtimeRawProjection));
    assert.deepEqual(compactSession.logicalEvents, residentSession.logicalEvents);
    assert.deepEqual(compactSession.counts, residentSession.counts);
    assert.deepEqual(compactSession.analysis, residentSession.analysis);
    assert.deepEqual(compactSession.presentationIndexes, residentSession.presentationIndexes);
    for (const key of [
      'title',
      'transcriptTitle',
      'startedAt',
      'updatedAt',
      'transcriptUpdatedAt',
      'parentSessionId',
      'parentSessionInferred',
      'forkedFromSessionId',
      'forkStorageMode',
      'forkedAt',
      'forkContinuationState',
      'supersededBySessionId',
      'supersededAt',
      'supersededReason',
    ]) {
      assert.deepEqual(compactSession[key], residentSession[key], `${compactSession.id}:${key}`);
    }
    for (const layer of ['main', 'protocol', 'raw']) {
      assert.deepEqual(timeline(compact, compactSession.id, layer), timeline(resident, residentSession.id, layer));
    }
  }
});

test('no-change reindex shares immutable compact payload arrays without mutating the committed index', async () => {
  const options = { repoRoot, codexHome: fixtureCodexHome };
  const committed = await buildIndex(options);
  const committedSerialization = JSON.stringify(committed.sessions);
  const replacement = await buildIndex({ ...options, previousIndex: committed });

  assert.equal(replacement.totals.reusedFileCount, committed.totals.sessionCount);
  assert.equal(JSON.stringify(committed.sessions), committedSerialization);
  for (const oldSession of committed.sessions) {
    const newSession = replacement.sessionsById.get(oldSession.id);
    assert.ok(newSession);
    assert.notEqual(newSession, oldSession);
    assert.equal(newSession.rawEvents, oldSession.rawEvents);
    assert.equal(newSession._logicalEvents, oldSession._logicalEvents);
    if (oldSession._canonicalRawDigests) {
      assert.equal(newSession._canonicalRawDigests, oldSession._canonicalRawDigests);
    }
  }
});

test('default reindex refuses to reuse a previous parse-resident Session graph', async () => {
  const options = { repoRoot, codexHome: fixtureCodexHome };
  const resident = await __testOnly.buildUncompactedIndexForDetailTests(options);
  assert.ok(resident.sessions.some((session) => session.rawEvents.some((raw) => Object.hasOwn(raw, 'parsed'))));

  const compact = await buildIndex({ ...options, previousIndex: resident });
  assert.equal(compact.totals.reusedFileCount, 0);
  assertNoReachableParsedGraph(compact);
  assert.ok(compact.sessions.every((session) => session.residentRepresentation === 'codex-compact-v1'));
});
