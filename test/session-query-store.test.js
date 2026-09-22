'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createEmptyMaterializedPresentationIndexes } = require('../src/canonical-contract');
const { createCacheObservation } = require('../src/cache-observation');
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
    presentationIndexes: createEmptyMaterializedPresentationIndexes(),
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

test('file activity uses exact recorded project paths, separates patch evidence and paginates without source-file matches', () => {
  const events = [
    logicalEvent('patch', { kind: 'patch', touchedFiles: ['G:\\repo\\src\\a.js'] }),
    logicalEvent('mention', { touchedFiles: ['src/a.js'] }),
    logicalEvent('substring', { touchedFiles: ['src/a.js.map'] }),
    logicalEvent('source-only', { sourceFile: 'G:\\repo\\src\\a.js', rawRefFile: 'G:\\repo\\src\\a.js' }),
    logicalEvent('protocol', { layer: 'protocol', touchedFiles: ['src/a.js'] }),
  ];
  const session = completeSession('file-activity', events);
  const index = fullIndex([session]);
  const query = getSourceAdapter('codex').query;
  assert.throws(() => query.getFileActivity(index, { ...session, sourceKind: 'claude-code' }, 'src/a.js'),
    (error) => error.code === 'SOURCE_OWNERSHIP_MISMATCH');
  const first = query.getFileActivity(index, session, './SRC/a.js', { locale: 'en', limit: 1 });
  assert.equal(first.total, 2);
  assert.deepEqual(first.events.map((item) => [item.id, item.association]), [['patch', 'patch_record']]);
  const second = query.getFileActivity(index, session, 'src/a.js', { offset: 1, limit: 1 });
  assert.deepEqual(second.events.map((item) => [item.id, item.association]), [['mention', 'recorded_path']]);
  assert.equal(query.getFileActivity(index, session, 'src/missing.js').total, 0);
  index.repoRoot = '/repo';
  session.logicalEvents = [logicalEvent('upper', { touchedFiles: ['src/A.js'] }), logicalEvent('lower', { touchedFiles: ['/repo/src/a.js'] })];
  assert.deepEqual(query.getFileActivity(index, session, 'src/a.js').events.map((item) => item.id), ['lower']);
});

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

test('file activity coalesces redundant relative separators and dot segments without merging distinct paths', () => {
  const query = getSourceAdapter('codex').query;
  for (const repoRoot of ['G:\\repo', '/repo']) {
    const paths = ['src/a.js', 'src/./a.js', 'src//a.js', '././src/./a.js', 'src/A.js', 'src/a.js.map', 'src/link/../a.js'];
    const session = completeSession('path-variants', paths.map((file, i) => logicalEvent(`path-${i}`, { touchedFiles: [file] })));
    const index = { ...fullIndex([session]), repoRoot };
    const expected = repoRoot.startsWith('/') ? 4 : 5;
    for (const file of paths.slice(0, 4)) {
      const result = query.getFileActivity(index, session, file, { limit: 2 });
      assert.equal(result.total, expected, `${repoRoot}: ${file}`);
      assert.deepEqual(result.events.map((event) => event.id), ['path-0', 'path-1']);
      assert.equal(query.getFileActivity(index, session, file, { offset: 2 }).events.length, expected - 2);
    }
    assert.equal(query.getFileActivity(index, session, 'src/a.js.map').total, 1);
    assert.equal(query.getFileActivity(index, session, '').total, 0);
    assert.deepEqual(session.logicalEvents.map((event) => event.touchedFiles[0]), paths);
  }
});

test('file activity retains external path roots and counts each event once across equivalent spellings', () => {
  const session = completeSession('path-roots', [
    logicalEvent('unc', { touchedFiles: ['\\\\server\\share\\src\\.\\a.js', '//server/share/src//a.js'] }),
    logicalEvent('other-share', { touchedFiles: ['//other/share/src/a.js'] }),
    logicalEvent('relative', { touchedFiles: ['src/./a.js', './src//a.js'] }),
  ]);
  const index = fullIndex([session]);
  const query = getSourceAdapter('codex').query;
  assert.deepEqual(query.getFileActivity(index, session, '//server/share/src/a.js').events.map((event) => event.id), ['unc']);
  assert.deepEqual(query.getFileActivity(index, session, 'src/a.js').events.map((event) => event.id), ['relative']);
  assert.equal(query.getFileActivity(index, session, '//missing/share/src/a.js').total, 0);
});

test('file activity preserves parent segments before making absolute paths project-relative', () => {
  const query = getSourceAdapter('codex').query;
  for (const repoRoot of ['/repo', 'G:\\repo', '\\\\server\\share\\repo']) {
    const root = repoRoot.replace(/\\/g, '/');
    const paths = [`${root}/src/link/../a.js`, 'src/link/../a.js', `${root}/src/a.js`, 'src/a.js',
      `${root}-other/src/link/../a.js`, `${root}/../outside/a.js`, '../outside/a.js'];
    const session = completeSession('parent-paths', paths.map((file, i) => logicalEvent(`parent-${i}`, { touchedFiles: [file] })));
    const index = { ...fullIndex([session]), repoRoot };
    for (const input of [paths[0], paths[1], `${root}/src//./link/../a.js`]) {
      assert.deepEqual(query.getFileActivity(index, session, input).events.map((event) => event.id), ['parent-0', 'parent-1'], input);
    }
    assert.deepEqual(query.getFileActivity(index, session, 'src/a.js').events.map((event) => event.id), ['parent-2', 'parent-3']);
    assert.deepEqual(query.getFileActivity(index, session, paths[4]).events.map((event) => event.id), ['parent-4']);
    assert.deepEqual(query.getFileActivity(index, session, paths[5]).events.map((event) => event.id), ['parent-5', 'parent-6']);
    assert.deepEqual(session.logicalEvents.map((event) => event.touchedFiles[0]), paths);
  }
});

test('file activity identity does not trim literal filename whitespace or use display formatting', () => {
  const paths = ['/repo/src/a.js ', 'src/a.js ', 'src/a.js', ' src/a.js'];
  const session = completeSession('literal-paths', paths.map((file, i) => logicalEvent(`literal-${i}`, { touchedFiles: [file] })));
  const index = { ...fullIndex([session]), repoRoot: '/repo' };
  const query = getSourceAdapter('codex').query;
  assert.deepEqual(query.getFileActivity(index, session, 'src/a.js ').events.map((event) => event.id), ['literal-0', 'literal-1']);
  assert.deepEqual(query.getFileActivity(index, session, 'src/a.js').events.map((event) => event.id), ['literal-2']);
  assert.deepEqual(query.getFileActivity(index, session, ' src/a.js').events.map((event) => event.id), ['literal-3']);
});

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

test('Session timeline projects bounded cache facts without changing ProjectQueryStore inputs', () => {
  const previous = logicalEvent('cache-previous', {
    layer: 'protocol',
    kind: 'protocol',
    subtype: 'token_count',
    label: 'Token count',
    timestamp: '2026-08-16T01:00:00.000Z',
    preview: 'canonical previous preview',
    searchText: 'canonical previous search',
  });
  const anchor = logicalEvent('cache-anchor', {
    kind: 'assistant_message',
    subtype: 'assistant_message',
    label: 'Assistant message',
    timestamp: '2026-08-16T01:00:05.000Z',
    preview: 'canonical main preview',
    searchText: 'canonical main search',
  });
  const current = logicalEvent('cache-current', {
    layer: 'protocol',
    kind: 'protocol',
    subtype: 'token_count',
    label: 'Token count',
    timestamp: '2026-08-16T01:00:14.000Z',
    preview: 'canonical current preview',
    searchText: 'canonical current search',
  });
  previous.cacheObservation = createCacheObservation({
    inputTokens: 16_384,
    cachedInputTokens: 16_384,
    outputTokens: 233,
  }).cacheObservation;
  current.cacheObservation = createCacheObservation({
    inputTokens: 12_288,
    cachedInputTokens: 0,
    outputTokens: 589,
  }, previous.cacheObservation, {
    previousEventId: previous.id,
    previousTimestamp: previous.timestamp,
    currentTimestamp: current.timestamp,
  }).cacheObservation;
  const item = completeSession('cache-presentation', [previous, anchor, current]);
  item.presentationIndexes.cacheDiscontinuityLinks.protocolEventIdsByMainEventId.set(
    anchor.id,
    [current.id],
  );
  item.presentationIndexes.cacheDiscontinuityLinks.mainEventIdByProtocolEventId.set(
    current.id,
    anchor.id,
  );
  const query = getSourceAdapter('codex').query;
  const index = fullIndex([item]);
  const withoutCache = structuredClone(item);
  for (const event of withoutCache.logicalEvents) delete event.cacheObservation;
  withoutCache.presentationIndexes.cacheDiscontinuityLinks.protocolEventIdsByMainEventId.clear();
  withoutCache.presentationIndexes.cacheDiscontinuityLinks.mainEventIdByProtocolEventId.clear();
  const packedBefore = buildProjectQueryStore([withoutCache], {
    presentationForEvent: query.projectQueryPresentation,
  });

  const mainTimeline = query.getTimeline(index, item, {
    layer: 'main', offset: 0, limit: 50, locale: 'en',
  });
  assert.deepEqual(mainTimeline.events[0].presentationFacts, {
    cacheDiscontinuityLink: { protocolEventId: current.id, count: 1 },
  });
  const protocolTimeline = query.getTimeline(index, item, {
    layer: 'protocol', offset: 0, limit: 50, locale: 'en',
  });
  const currentDto = protocolTimeline.events.find((event) => event.id === current.id);
  const previousDto = protocolTimeline.events.find((event) => event.id === previous.id);
  assert.equal(previousDto.presentationFacts.cacheUsage.discontinuity, null);
  assert.deepEqual(currentDto.presentationFacts, {
    cacheUsage: {
      inputTokens: 12_288,
      cachedInputTokens: 0,
      reuseBasisPoints: 0,
      outputTokens: 589,
      discontinuity: {
        elapsedMs: 14_000,
        previousCachedInputTokens: 16_384,
      },
      mainContextEventId: anchor.id,
    },
  });
  assert.equal(currentDto.label, 'Token count');
  assert.equal(currentDto.preview, current.preview);
  assert.equal(JSON.stringify(currentDto).includes('reasonCodes'), false);
  assert.equal(JSON.stringify(currentDto).includes('previousInputTokens'), false);
  assert.equal(JSON.stringify(currentDto).includes('cacheObservation'), false);
  assert.equal(JSON.stringify(protocolTimeline).includes('explicit_lifecycle'), false);
  assert.equal(query.getEvent(index, item, current.id, {
    layer: 'protocol', locale: 'en',
  }).presentationFacts.cacheUsage.mainContextEventId, anchor.id);
  const rawTimeline = query.getTimeline(index, item, {
    layer: 'raw', offset: 0, limit: 50, locale: 'en',
  });
  assert.equal(rawTimeline.events.some((event) => Object.hasOwn(event, 'presentationFacts')), false);

  const packedAfter = buildProjectQueryStore([item], {
    presentationForEvent: query.projectQueryPresentation,
  });
  assert.deepEqual(packedAfter, packedBefore);
});

test('Project Scope q semantics count matching Events rather than text occurrences', async () => {
  const query = getSourceAdapter('codex').query;
  const sessions = fixture();
  sessions[0].logicalEvents[0].preview = 'alpha target alpha target alpha target';
  sessions[0].logicalEvents[0].searchText = 'alpha target alpha target alpha target alpha target';
  sessions[1].logicalEvents[0].searchText = 'alpha target alpha target';
  const oracle = fullIndex(sessions);
  const result = await query.filterSessions(
    packedIndex(oracle, query),
    { q: 'alpha target', layer: 'main', locale: 'en' },
  );
  assert.equal(result.total, 2);
  assert.equal(result.matchingEventTotal, 2);
  assert.deepEqual(result.sessions.map((session) => session.searchMatch.eventCount), [1, 1]);
  assert.deepEqual(
    Object.keys(result.sessions[0].searchMatch).sort(),
    ['eventCount', 'latestEvent'],
  );
});

test('packed Project Scope boolean matching avoids occurrence enumeration and preserves expression semantics', async () => {
  const query = getSourceAdapter('codex').query;
  const sessions = fixture();
  sessions[0].logicalEvents[0].preview = 'prefix Alpha [target]\n value suffix';
  sessions[0].logicalEvents[0].searchText = 'Alpha [target] value Alpha [target] value';
  sessions[1].logicalEvents[0].preview = 'no matching preview';
  sessions[1].logicalEvents[0].searchText = 'no matching canonical search text';
  const packed = packedIndex(fullIndex(sessions), query);
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'matchAll');
  let matchAllCalls = 0;
  let result;
  Object.defineProperty(String.prototype, 'matchAll', {
    ...descriptor,
    value() {
      matchAllCalls += 1;
      throw new Error('Project Scope boolean matching enumerated occurrences');
    },
  });
  try {
    result = await query.filterSessions(packed, {
      q: '  alpha [target]   value  ',
      layer: 'main',
      locale: 'en',
    });
  } finally {
    Object.defineProperty(String.prototype, 'matchAll', descriptor);
  }
  assert.equal(matchAllCalls, 0);
  assert.equal(result.total, 1);
  assert.equal(result.matchingEventTotal, 1);
  assert.equal(result.sessions[0].searchMatch.eventCount, 1);
  assert.deepEqual(result.sessions[0].searchMatch.latestEvent, {
    id: 'first-main',
    timestamp: '2026-08-16T01:00:00.000Z',
    label: 'Command',
    snippet: 'prefix Alpha [target] value suffix',
    timelineIndex: 0,
  });
});

test('packed Project Scope boolean matching short-circuits searchText after a preview hit', async () => {
  const query = getSourceAdapter('codex').query;
  const sessions = fixture();
  const packed = packedIndex(fullIndex(sessions), query);
  const descriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, 'test');
  const testedFields = [];
  Object.defineProperty(RegExp.prototype, 'test', {
    ...descriptor,
    value(text) {
      if (this.source === 'alpha\\s+target' && this.flags === 'i') {
        testedFields.push(String(text));
      }
      return descriptor.value.call(this, text);
    },
  });
  try {
    const result = await query.filterSessions(packed, {
      q: 'alpha target',
      layer: 'main',
      locale: 'en',
    });
    assert.equal(result.total, 2);
    assert.equal(result.matchingEventTotal, 2);
  } finally {
    Object.defineProperty(RegExp.prototype, 'test', descriptor);
  }
  assert.deepEqual(testedFields, [
    'alpha\n target in preview',
    'no preview hit',
    'alpha target in canonical search',
  ]);
});

test('Current Session search retains exact occurrence counts and empty-query false semantics', () => {
  const query = getSourceAdapter('codex').query;
  const sessions = fixture();
  sessions[0].logicalEvents[0].preview = 'alpha target alpha target alpha target';
  sessions[0].logicalEvents[0].searchText = 'alpha target alpha target alpha target alpha target';
  const packed = packedIndex(fullIndex(sessions), query);
  const materialized = {
    ...sessions[0],
    ...query.projectSessionMetadata(sessions[0]),
  };
  const filters = {
    layer: 'main',
    offset: 0,
    limit: 20,
    q: 'alpha target',
    kind: '',
    status: '',
    tool: '',
    file: '',
    locale: 'en',
  };
  const counted = query.getTimeline(packed, materialized, filters);
  assert.equal(counted.searchMatchCount, 4);
  assert.equal(counted.searchEventCount, 1);
  assert.equal(counted.events[0].hasSearchHit, true);

  const empty = query.getTimeline(packed, materialized, { ...filters, q: '   ' });
  assert.equal(empty.searchMatchCount, 0);
  assert.equal(empty.searchEventCount, 0);
  assert.equal(empty.events[0].hasSearchHit, false);
});

test('shared packed query implementation preserves Claude and DeepSeek project semantics', async () => {
  for (const sourceKind of ['claude-code', 'deepseek-harness']) {
    const query = getSourceAdapter(sourceKind).query;
    const sessions = fixture().map((source) => {
      const session = structuredClone(source);
      session.sourceKind = sourceKind;
      for (const event of session.logicalEvents) event.sourceKind = sourceKind;
      for (const raw of session.rawEvents) raw.sourceKind = sourceKind;
      session.presentationIndexes = createEmptyMaterializedPresentationIndexes();
      return session;
    });
    const oracle = {
      ...fullIndex(sessions),
      sourceKind,
    };
    const packed = packedIndex(oracle, query);
    for (const locale of ['en', 'zh-CN']) {
      for (const filters of [
        { q: 'alpha target', layer: 'main', locale },
        { q: 'protocol alpha', status: 'failed', layer: 'protocol', locale },
        { q: '', tool: 'shell', layer: 'main', sort: 'events-desc', locale },
      ]) {
        assert.deepEqual(
          await query.filterSessions(packed, filters),
          query.filterSessions(oracle, filters),
          `${sourceKind}/${locale}/${JSON.stringify(filters)}`,
        );
      }
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
    Object.defineProperty(session, 'presentationIndexes', {
      configurable: true,
      get() { throw new Error('project query read retained presentationIndexes'); },
    });
  }
  assert.equal((await query.filterSessions(packed, { sort: 'events-desc' })).total, 2);
  assert.equal((await query.filterSessions(packed, { q: 'alpha target', layer: 'main' })).total, 2);
  assert.deepEqual(await query.projectFileSuggestions(packed, { layer: 'main' }), [
    { file: 'src/a.js', count: 2 },
  ]);
  assert.deepEqual(query.indexPresentation(packed, { locale: 'en' }), {
    codeModeRequests: [],
  });
});
