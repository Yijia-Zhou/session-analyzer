'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildProjectQueryStore } = require('../src/project-query-store');
const { getSourceAdapter } = require('../src/source-adapters');

const COMPLETE_COUNTS = Object.freeze({
  turns: 1,
  messages: 1,
  userMessages: 0,
  assistantMessages: 1,
  reasoning: 0,
  toolCalls: 1,
  failedCommands: 1,
  issueEvents: 0,
  patches: 0,
  compactions: 0,
  aborts: 0,
  errors: 0,
  protocol: 1,
  planArtifacts: 0,
  planEvents: 0,
});

function logicalEvent(id, options = {}) {
  return {
    id,
    schemaVersion: 1,
    sourceKind: 'codex',
    layer: options.layer || 'main',
    kind: options.kind || 'command',
    subtype: options.subtype || options.kind || 'command',
    label: options.label || 'Command',
    timestamp: options.timestamp || '2026-08-16T00:00:00.000Z',
    turnId: '',
    role: '',
    preview: options.preview || '',
    searchText: options.searchText ?? options.preview ?? '',
    severity: 'normal',
    status: options.status || 'failed',
    toolName: options.toolName || 'shell',
    hasLongOutput: false,
    hasReadableReasoning: false,
    tags: [],
    touchedFiles: options.touchedFiles || [],
    outputStats: {},
    source: { file: options.sourceFile || `${id}.jsonl`, line: 1 },
    sourceLocator: { type: 'jsonl_line', file: `${id}.jsonl`, line: 1 },
    rawRefs: [{ file: options.rawRefFile || `${id}.jsonl`, line: 1, rawId: `${id}:raw` }],
    channels: ['event_msg'],
  };
}

function rawForEvent(event, options = {}) {
  return {
    rawId: event.rawRefs[0].rawId,
    sourceKind: 'codex',
    timestamp: event.timestamp,
    turnId: '',
    recordType: 'event_msg',
    payloadType: options.payloadType || 'message',
    role: 'assistant',
    preview: options.preview || event.preview,
    searchText: options.searchText || event.searchText,
    status: event.status,
    toolName: event.toolName,
    touchedFiles: options.touchedFiles || [],
    source: { file: event.rawRefs[0].file, line: 1 },
  };
}

function completeSession(id, events) {
  const rawEvents = events.map((event) => rawForEvent(event));
  return {
    id,
    sourceKind: 'codex',
    sourceSessionId: id,
    sourceDerivedId: '',
    sourceClientVersion: '',
    projectAssociation: '',
    title: `Session ${id}`,
    sourceFile: `${id}.jsonl`,
    bytes: 100,
    lineCount: 10,
    cwdSet: new Set(['G:\\repo']),
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    forkStorageMode: '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    forkEvidence: null,
    inheritedContext: null,
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    agentNickname: '',
    primarySessionMetaKind: '',
    derivedRunId: '',
    derivedRelationship: null,
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: events.at(-1)?.timestamp || '2026-08-16T00:00:00.000Z',
    counts: { ...COMPLETE_COUNTS },
    analysis: {
      toolUsage: [{ tool: 'shell', count: 1 }],
      failedCommands: [{ id: 'failure' }],
      patchedFiles: ['G:\\repo\\src\\a.js'],
      protocolStats: [{ kind: 'warning', count: 1 }],
    },
    logicalEvents: events,
    rawEvents,
    presentationIndexes: { codeModeDeclaredRequests: new Map() },
  };
}

function indexedSession(session) {
  return {
    id: session.id,
    sourceKind: session.sourceKind,
    sourceSessionId: session.sourceSessionId,
    sourceDerivedId: session.sourceDerivedId,
    sourceClientVersion: session.sourceClientVersion,
    projectAssociation: session.projectAssociation,
    title: session.title,
    sourceFile: session.sourceFile,
    agentNickname: session.agentNickname,
    primarySessionMetaKind: session.primarySessionMetaKind,
    derivedRunId: session.derivedRunId,
    bytes: session.bytes,
    lineCount: session.lineCount,
    cwdSet: [...session.cwdSet],
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    counts: { ...session.counts },
    rawEventCount: session.rawEvents.length,
    logicalEventCount: session.logicalEvents.length,
    parentSessionId: session.parentSessionId,
    forkedFromSessionId: session.forkedFromSessionId,
    forkStorageMode: session.forkStorageMode,
    forkedAt: session.forkedAt,
    forkPointUuid: session.forkPointUuid,
    forkContinuationState: session.forkContinuationState,
    supersededBySessionId: session.supersededBySessionId,
    supersededAt: session.supersededAt,
    supersededReason: session.supersededReason,
    parentSessionInferred: session.parentSessionInferred,
    forkEvidence: session.forkEvidence,
    inheritedContext: session.inheritedContext,
    derivedRelationship: session.derivedRelationship,
    summary: {
      topTools: session.analysis.toolUsage,
      failedCommandCount: session.analysis.failedCommands.length,
      patchedFiles: session.analysis.patchedFiles,
      protocolCount: 1,
    },
    materializationDescriptor: {
      schemaVersion: 1,
      dependencySetId: `dependency:${session.id}`,
      sourceSnapshotId: `snapshot:${session.id}`,
      payload: {},
    },
    queryShardId: session.id,
  };
}

function fixture() {
  const firstMain = logicalEvent('first-main', {
    kind: 'code_mode_operation',
    timestamp: '2026-08-16T01:00:00.000Z',
    preview: 'alpha\n target in preview',
    touchedFiles: ['G:\\repo\\src\\a.js'],
    sourceFile: 'G:\\repo\\src\\source.js',
    rawRefFile: 'G:\\repo\\raw\\first.jsonl',
  });
  const firstProtocol = logicalEvent('first-protocol', {
    layer: 'protocol',
    kind: 'protocol',
    subtype: 'warning',
    label: 'Warning',
    timestamp: '2026-08-16T02:00:00.000Z',
    preview: 'protocol alpha target',
    touchedFiles: ['G:\\repo\\src\\protocol.js'],
  });
  const secondMain = logicalEvent('second-main', {
    timestamp: '2026-08-16T03:00:00.000Z',
    preview: 'no preview hit',
    searchText: 'alpha target in canonical search',
    touchedFiles: ['G:\\repo\\SRC\\A.js'],
  });
  const first = completeSession('first', [firstMain, firstProtocol]);
  const second = completeSession('second', [secondMain]);
  first.presentationIndexes.codeModeDeclaredRequests.set(firstMain.id, {
    toolNames: ['shell_command'],
    requestEvidence: 'declared_source',
  });
  return [first, second];
}

function fullIndex(sessions) {
  return {
    sourceKind: 'codex',
    repoRoot: 'G:\\repo',
    sessions,
    sessionsById: new Map(sessions.map((session) => [session.id, session])),
  };
}

function packedIndex(oracle, query) {
  const sessions = oracle.sessions.map((session) => ({
    ...session,
    ...query.projectSessionMetadata(session),
  }));
  return {
    ...oracle,
    sessions,
    sessionsById: new Map(sessions.map((session) => [session.id, session])),
    projectQueryStore: buildProjectQueryStore(sessions, {
      presentationForEvent: query.projectQueryPresentation,
    }),
  };
}

test('packed project query path has exact full-event oracle parity', async () => {
  const query = getSourceAdapter('codex').query;
  const sessions = fixture();
  const oracle = fullIndex(sessions);
  const packed = packedIndex(oracle, query);
  const filters = [
    { q: 'alpha target', layer: 'main', sort: 'latest-match-desc', locale: 'en' },
    { q: '', status: 'failed', file: 'src/a.js', layer: 'main', locale: 'zh-CN' },
    { q: 'protocol alpha', layer: 'protocol', locale: 'zh-CN' },
    { q: '', tool: 'ell', layer: 'main', sort: 'events-desc', locale: 'en' },
    { q: '', codeModeRequest: 'shell_command', layer: 'main', locale: 'en' },
  ];
  for (const filter of filters) {
    assert.deepEqual(await query.filterSessions(packed, filter), query.filterSessions(oracle, filter));
  }
  assert.deepEqual(
    await query.projectFileSuggestions(packed, { layer: 'main' }),
    query.fileSuggestions(oracle, { layer: 'main' }),
  );
  assert.deepEqual(
    await query.fileSuggestions(packed, { layer: 'main' }),
    query.fileSuggestions(oracle, { layer: 'main' }),
  );
});

test('shared packed query implementation preserves Claude project semantics in both locales', async () => {
  const query = getSourceAdapter('claude-code').query;
  const sessions = fixture().map((source) => {
    const session = structuredClone(source);
    session.sourceKind = 'claude-code';
    for (const event of session.logicalEvents) event.sourceKind = 'claude-code';
    for (const raw of session.rawEvents) raw.sourceKind = 'claude-code';
    session.presentationIndexes = { codeModeDeclaredRequests: new Map() };
    return session;
  });
  const oracle = {
    ...fullIndex(sessions),
    sourceKind: 'claude-code',
  };
  const packed = packedIndex(oracle, query);
  for (const locale of ['en', 'zh-CN']) {
    for (const filters of [
      { q: 'alpha target', layer: 'main', locale },
      { q: 'protocol alpha', status: 'failed', layer: 'protocol', locale },
      { q: '', tool: 'shell', layer: 'main', sort: 'events-desc', locale },
    ]) {
      assert.deepEqual(await query.filterSessions(packed, filters), query.filterSessions(oracle, filters));
    }
  }
});

test('array-free Indexed fixtures support project query while event APIs require Materialized input', async () => {
  const query = getSourceAdapter('codex').query;
  const sessions = fixture();
  const oracle = fullIndex(sessions);
  const projectQueryStore = buildProjectQueryStore(sessions, {
    presentationForEvent: query.projectQueryPresentation,
  });
  const indexedSessions = sessions.map(indexedSession);
  const indexed = {
    sourceKind: 'codex',
    repoRoot: oracle.repoRoot,
    sessions: indexedSessions,
    sessionsById: new Map(indexedSessions.map((session) => [session.id, session])),
    projectQueryStore,
  };
  assert.deepEqual(
    await query.filterSessions(indexed, { q: 'alpha target', layer: 'main', locale: 'en' }),
    query.filterSessions(oracle, { q: 'alpha target', layer: 'main', locale: 'en' }),
  );
  assert.throws(
    () => query.getTimeline(indexed, 'first', { layer: 'main', offset: 0, limit: 20 }),
    { code: 'MATERIALIZED_SESSION_REQUIRED' },
  );
  const materialized = { ...sessions[0], ...query.projectSessionMetadata(sessions[0]) };
  assert.equal(query.getTimeline(indexed, materialized, {
    layer: 'main', offset: 0, limit: 20, q: '', kind: '', status: '', tool: '', file: '',
  }).events[0].id, 'first-main');
});

test('legacy production projections do not read retained complete arrays for list or project behavior', async () => {
  const query = getSourceAdapter('codex').query;
  const sourceSessions = fixture();
  const packed = packedIndex(fullIndex(sourceSessions), query);
  for (const session of packed.sessions) {
    Object.defineProperty(session, 'rawEvents', {
      configurable: true,
      get() { throw new Error('project query read retained rawEvents'); },
    });
    Object.defineProperty(session, 'logicalEvents', {
      configurable: true,
      get() { throw new Error('project query read retained logicalEvents'); },
    });
    Object.defineProperty(session, 'analysis', {
      configurable: true,
      get() { throw new Error('project query read retained analysis'); },
    });
  }
  assert.equal((await query.filterSessions(packed, { sort: 'events-desc' })).total, 2);
  assert.equal((await query.filterSessions(packed, { q: 'alpha target', layer: 'main' })).total, 2);
  assert.deepEqual(await query.projectFileSuggestions(packed, { layer: 'main' }), [
    { file: 'src/a.js', count: 2 },
  ]);
});
