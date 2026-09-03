'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANONICAL_CONTRACT,
  INDEXED_SESSION_COUNT_FIELDS,
  createEmptyMaterializedPresentationIndexes,
  validateCanonicalIndexedSessionShape,
  validateCanonicalLogicalEventShape,
  validateCanonicalMaterializedSessionShape,
  validateCanonicalRawEventShape,
  validateCanonicalSessionShape,
} = require('../src/canonical-contract');
const { createSessionQuery } = require('../src/session-query');
const {
  buildProjectQueryStore,
  projectQueryProjectionDigest,
} = require('../src/project-query-store');
const {
  buildEventDetailForSession,
  getSourceAdapter,
  materializeSessionForIndex,
  materializeSessionWithAdapter,
  queryForIndex,
  readImagePreviewForSession,
  validateIndexOwnership,
} = require('../src/source-adapters');
const {
  defineSourceAdapter,
  SESSION_LIFECYCLE,
} = require('../src/source-adapter-contract');
const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
} = require('../src/materialized-session-owner');
const {
  COMPARISON_STATE,
  createCacheObservation,
} = require('../src/cache-observation');

function makeCanonicalIndex(sourceKind, options = {}) {
  const raw = {
    rawId: `${sourceKind}:raw:1`,
    sourceKind,
    timestamp: '2026-08-14T00:00:00.000Z',
    ...(options.rawLocator ? { sourceLocator: options.rawLocator } : {}),
  };
  const event = {
    id: `${sourceKind}:event:1`,
    sourceKind,
    kind: 'synthetic_event',
    layer: 'main',
    timestamp: raw.timestamp,
    rawRefs: [{ rawId: raw.rawId }],
    ...(options.eventLocator ? { sourceLocator: options.eventLocator } : {}),
  };
  const session = {
    id: `${sourceKind}:session:1`,
    sourceKind,
    rawEvents: [raw],
    logicalEvents: [event],
    counts: { messages: 0, toolCalls: 0, failedCommands: 0 },
    cwdSet: [],
  };
  return {
    sourceKind,
    repoRoot: '/synthetic/repository',
    sessions: [session],
    sessionsById: new Map([[session.id, session]]),
  };
}

function makeStrictIndexedSession(sourceKind = 'fixture-source') {
  const counts = Object.fromEntries(INDEXED_SESSION_COUNT_FIELDS.map((field) => [field, 0]));
  const session = {
    id: `${sourceKind}:session:strict`,
    sourceKind,
    sourceSessionId: 'source-session',
    sourceDerivedId: '',
    sourceClientVersion: '',
    projectAssociation: '',
    title: 'Strict fixture',
    sourceFile: '',
    agentNickname: '',
    primarySessionMetaKind: '',
    derivedRunId: '',
    bytes: 1,
    lineCount: 1,
    cwdSet: ['/synthetic/repository'],
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    counts,
    rawEventCount: 1,
    logicalEventCount: 1,
    parentSessionId: '',
    forkedFromSessionId: '',
    forkStorageMode: '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    parentSessionInferred: false,
    forkEvidence: null,
    inheritedContext: null,
    summary: {
      topTools: [],
      failedCommandCount: 0,
      patchedFiles: [],
      protocolCount: 0,
    },
    materializationDescriptor: {
      schemaVersion: 1,
      dependencySetId: 'dependencies-1',
      sourceSnapshotId: 'snapshot-1',
      payload: { locator: 'opaque-fixture' },
    },
    queryShardId: `${sourceKind}:session:strict`,
    queryProjectionDigest: 'A'.repeat(43),
  };
  session.queryProjectionDigest = projectQueryProjectionDigest(
    makeStrictMaterializedSession(session),
    queryContract().projectQueryPresentation,
  );
  return session;
}

function makeStrictMaterializedSession(indexedSession) {
  const carried = {};
  for (const [key, value] of Object.entries(indexedSession)) {
    if (key === 'materializationDescriptor'
        || key === 'queryShardId'
        || key === 'queryProjectionDigest') continue;
    carried[key] = value;
  }
  const raw = {
    rawId: `${indexedSession.sourceKind}:raw:strict`,
    sourceKind: indexedSession.sourceKind,
  };
  const event = {
    id: `${indexedSession.sourceKind}:event:strict`,
    sourceKind: indexedSession.sourceKind,
    kind: 'synthetic_event',
    layer: 'main',
    timestamp: '2026-08-16T00:00:00.000Z',
    rawRefs: [{ rawId: raw.rawId }],
  };
  return {
    ...carried,
    materializationSnapshotId: indexedSession.materializationDescriptor.sourceSnapshotId,
    rawEvents: [raw],
    logicalEvents: [event],
    analysis: {
      sessionId: indexedSession.id,
      title: indexedSession.title,
      counts: indexedSession.counts,
      toolUsage: [],
      failedCommands: [],
      slowCommands: [],
      patchedFiles: [],
      tokenStats: {},
      timelineStats: {},
      protocolStats: {},
    },
    presentationIndexes: createEmptyMaterializedPresentationIndexes(),
  };
}

function queryContract() {
  return {
    fileSuggestions() {},
    filterSessions() {},
    filtersFromSearchParams() {},
    getEvent() {},
    getTimeline() {},
    indexPresentation() {},
    matchTerms() {},
    projectFileSuggestions() {},
    projectQueryPresentation(session, event) {
      const fact = session?.presentationIndexes?.codeModeDeclaredRequests?.get(event?.id);
      return fact ? {
        scriptOperation: true,
        declaredRequestNames: [...fact.toolNames],
        requestEvidence: fact.requestEvidence,
      } : null;
    },
    projectSessionMetadata() {},
    sessionFileSuggestions() {},
  };
}

function makeLifecycleAdapter({
  kind,
  sessionLifecycle = SESSION_LIFECYCLE.RESIDENT_COMPLETE,
  materializeSession,
  strictOverrides = {},
} = {}) {
  const strictFields = sessionLifecycle === SESSION_LIFECYCLE.INDEXED_MATERIALIZED
    ? {
      validateMaterializationDescriptor() {},
      validateLegacyRawOwnerIndex() {},
      validateMaterializedPrivateState() {},
      materializationContextFields: [],
      materializedPrivateFields: [],
    }
    : {};
  return defineSourceAdapter({
    kind,
    label: 'Lifecycle fixture',
    homeOption: 'fixtureHome',
    homeLabel: 'Fixture home',
    sessionLifecycle,
    defaultHome() { return ''; },
    query: queryContract(),
    discoverConfiguredProjects() {},
    discoverProjects() {},
    buildIndex() {},
    materializeSession,
    buildEventDetail() {},
    readRawRecord() {},
    ...strictFields,
    ...strictOverrides,
  });
}

function makeStrictMaterializationBoundaryFixture(sourceKind = 'projection-source') {
  const indexedSession = makeStrictIndexedSession(sourceKind);
  const materializedSession = makeStrictMaterializedSession(indexedSession);
  indexedSession.queryProjectionDigest = projectQueryProjectionDigest(
    materializedSession,
    queryContract().projectQueryPresentation,
  );
  const dependencySet = {
    schemaVersion: 1,
    id: 'dependencies-1',
    sourceKind,
    entries: [],
  };
  const index = {
    sourceKind,
    repoRoot: '/synthetic/repository',
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    projectQueryStore: buildProjectQueryStore([materializedSession], {
      presentationForEvent: queryContract().projectQueryPresentation,
    }),
    materializationDependencies: new Map([[dependencySet.id, dependencySet]]),
    legacyRawOwners: {
      schemaVersion: 1,
      sourceKind,
      entryCount: 0,
      accountedBytes: 2,
      payload: {},
    },
  };
  return { dependencySet, index, indexedSession, materializedSession };
}

function makeCacheObservationMaterializationFixture(sourceKind = 'fixture-source') {
  const fixture = makeStrictMaterializationBoundaryFixture(sourceKind);
  const { index, indexedSession, materializedSession } = fixture;
  const mainEvent = materializedSession.logicalEvents[0];
  const previousRaw = {
    rawId: `${sourceKind}:raw:cache:previous`,
    sourceKind,
  };
  const currentRaw = {
    rawId: `${sourceKind}:raw:cache:current`,
    sourceKind,
  };
  const previousCandidate = { inputTokens: 16_384, cachedInputTokens: 16_384 };
  const currentCandidate = { inputTokens: 12_288, cachedInputTokens: 8_192 };
  const previousEvent = {
    id: `${sourceKind}:event:cache:previous`,
    sourceKind,
    kind: 'protocol',
    subtype: 'token_count',
    layer: 'protocol',
    timestamp: '2026-08-16T00:01:00.000Z',
    rawRefs: [{ rawId: previousRaw.rawId }],
    cacheObservation: createCacheObservation(previousCandidate).cacheObservation,
  };
  const currentEvent = {
    id: `${sourceKind}:event:cache:current`,
    sourceKind,
    kind: 'protocol',
    subtype: 'token_count',
    layer: 'protocol',
    timestamp: '2026-08-16T00:02:00.000Z',
    rawRefs: [{ rawId: currentRaw.rawId }],
    cacheObservation: createCacheObservation(currentCandidate, previousCandidate, {
      previousEventId: previousEvent.id,
      previousTimestamp: previousEvent.timestamp,
      currentTimestamp: '2026-08-16T00:02:00.000Z',
    }).cacheObservation,
  };
  materializedSession.rawEvents.push(previousRaw, currentRaw);
  materializedSession.logicalEvents.push(previousEvent, currentEvent);
  indexedSession.rawEventCount = materializedSession.rawEvents.length;
  indexedSession.logicalEventCount = materializedSession.logicalEvents.length;
  materializedSession.rawEventCount = indexedSession.rawEventCount;
  materializedSession.logicalEventCount = indexedSession.logicalEventCount;
  indexedSession.counts.protocol = 2;
  materializedSession.counts.protocol = 2;
  materializedSession.analysis.counts = materializedSession.counts;
  materializedSession.presentationIndexes.cacheDiscontinuityLinks
    .protocolEventIdsByMainEventId.set(mainEvent.id, [currentEvent.id]);
  materializedSession.presentationIndexes.cacheDiscontinuityLinks
    .mainEventIdByProtocolEventId.set(currentEvent.id, mainEvent.id);
  indexedSession.queryProjectionDigest = projectQueryProjectionDigest(
    materializedSession,
    queryContract().projectQueryPresentation,
  );
  return { ...fixture, mainEvent, previousEvent, currentEvent };
}

function validateStrictFixture(fixture) {
  return validateCanonicalMaterializedSessionShape(
    fixture.indexedSession,
    fixture.materializedSession,
    fixture.indexedSession.sourceKind,
    { index: fixture.index },
  );
}

test('Codex and Claude complete synthetic Sessions satisfy the same shared contract', () => {
  assert.deepEqual(CANONICAL_CONTRACT.index, ['sourceKind', 'repoRoot', 'sessions', 'sessionsById']);
  assert.deepEqual(CANONICAL_CONTRACT.session.slice(0, 4), ['id', 'sourceKind', 'rawEvents', 'logicalEvents']);
  assert.deepEqual(CANONICAL_CONTRACT.logicalEvent, [
    'id', 'sourceKind', 'kind', 'layer', 'timestamp', 'rawRefs',
  ]);

  for (const [sourceKind, locator] of [
    ['codex', { type: 'jsonl_line', file: 'codex.jsonl', line: 1 }],
    ['claude-code', { type: 'jsonl_line', file: 'claude.jsonl', line: 1 }],
  ]) {
    const index = makeCanonicalIndex(sourceKind, { rawLocator: locator, eventLocator: locator });
    const residentAdapter = makeLifecycleAdapter({
      kind: sourceKind,
      materializeSession: async ({ indexedSession }) => indexedSession,
    });
    assert.equal(validateIndexOwnership(index, { adapter: residentAdapter }), sourceKind);
    const session = index.sessions[0];
    assert.equal(validateCanonicalSessionShape(session, sourceKind), sourceKind);
    assert.equal(validateCanonicalRawEventShape(session.rawEvents[0], sourceKind), sourceKind);
    assert.equal(validateCanonicalLogicalEventShape(session.logicalEvents[0], sourceKind), sourceKind);
  }
});

test('production adapters expose strict Codex and Claude through one lifecycle seam', () => {
  assert.equal(
    getSourceAdapter('codex').sessionLifecycle,
    SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
  );
  assert.equal(
    getSourceAdapter('claude-code').sessionLifecycle,
    SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
  );
});

test('compatibility materialization rejects cancellation, foreign ownership, and broken Raw references', async () => {
  const residentAdapter = makeLifecycleAdapter({
    kind: 'claude-code',
    materializeSession: async ({ indexedSession }) => indexedSession,
  });
  const controller = new AbortController();
  controller.abort();
  const cancelledIndex = makeCanonicalIndex('claude-code');
  await assert.rejects(
    materializeSessionWithAdapter(cancelledIndex, cancelledIndex.sessions[0], residentAdapter, {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );

  const ownerIndex = makeCanonicalIndex('claude-code');
  const foreignSession = makeCanonicalIndex('claude-code').sessions[0];
  await assert.rejects(
    materializeSessionWithAdapter(ownerIndex, foreignSession, residentAdapter),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const brokenIndex = makeCanonicalIndex('claude-code');
  brokenIndex.sessions[0].logicalEvents[0].rawRefs.push({ rawId: 'claude-code:raw:missing' });
  await assert.rejects(
    materializeSessionWithAdapter(brokenIndex, brokenIndex.sessions[0], residentAdapter),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );

  const unverifiableIndex = makeCanonicalIndex('claude-code');
  const revocable = Proxy.revocable({}, {});
  unverifiableIndex.unrelatedAdapterState = revocable.proxy;
  revocable.revoke();
  await assert.rejects(
    materializeSessionWithAdapter(
      unverifiableIndex,
      unverifiableIndex.sessions[0],
      residentAdapter,
    ),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && /could not be fingerprinted/.test(error.message)
      && error.cause instanceof TypeError,
  );
});

test('materialization dispatch observes post-await cancellation and resident non-mutation', async () => {
  const index = makeCanonicalIndex('codex');
  const controller = new AbortController();
  let releaseMaterialization;
  const delayedAdapter = makeLifecycleAdapter({
    kind: 'codex',
    materializeSession: async ({ indexedSession }) => {
      await new Promise((resolve) => { releaseMaterialization = resolve; });
      return indexedSession;
    },
  });
  const pending = materializeSessionWithAdapter(
    index,
    index.sessions[0],
    delayedAdapter,
    { signal: controller.signal },
  );
  await Promise.resolve();
  controller.abort();
  releaseMaterialization();
  await assert.rejects(pending, { name: 'AbortError' });

  const mutatingIndex = makeCanonicalIndex('claude-code');
  const mutatingAdapter = makeLifecycleAdapter({
    kind: 'claude-code',
    materializeSession: async ({ indexedSession }) => {
      indexedSession.counts.messages += 1;
      return indexedSession;
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      mutatingIndex,
      mutatingIndex.sessions[0],
      mutatingAdapter,
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );

  const deepMutationIndex = makeCanonicalIndex('codex');
  const deepMutationSession = deepMutationIndex.sessions[0];
  const secondRaw = {
    ...deepMutationSession.rawEvents[0],
    rawId: 'codex:raw:2',
  };
  deepMutationSession.rawEvents.push(secondRaw);
  deepMutationSession.logicalEvents[0].rawRefs.push({ rawId: secondRaw.rawId });
  const deepMutatingAdapter = makeLifecycleAdapter({
    kind: 'codex',
    materializeSession: async ({ indexedSession }) => {
      indexedSession.rawEvents[0].preview = 'mutated preview';
      indexedSession.logicalEvents[0].rawRefs.reverse();
      return indexedSession;
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      deepMutationIndex,
      deepMutationSession,
      deepMutatingAdapter,
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );
});

test('strict Indexed and Materialized Session validators enforce the future lifecycle shape', () => {
  const indexedSession = makeStrictIndexedSession();
  const materializedSession = makeStrictMaterializedSession(indexedSession);
  assert.equal(validateCanonicalIndexedSessionShape(indexedSession, 'fixture-source'), 'fixture-source');
  assert.equal(
    validateCanonicalMaterializedSessionShape(
      indexedSession,
      materializedSession,
      'fixture-source',
    ),
    materializedSession,
  );

  assert.throws(
    () => validateCanonicalIndexedSessionShape({
      ...indexedSession,
      rawEvents: [],
    }, 'fixture-source'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => validateCanonicalIndexedSessionShape({
      ...indexedSession,
      cwdSet: new Set(indexedSession.cwdSet),
    }, 'fixture-source'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => validateCanonicalIndexedSessionShape({
      ...indexedSession,
      counts: { ...indexedSession.counts, sourceSpecific: 1 },
    }, 'fixture-source'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  assert.throws(
    () => validateCanonicalMaterializedSessionShape(
      indexedSession,
      { ...materializedSession, title: 'Recomputed title' },
      'fixture-source',
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => validateCanonicalMaterializedSessionShape(
      indexedSession,
      { ...materializedSession, materializationSnapshotId: 'newer-snapshot' },
      'fixture-source',
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => validateCanonicalMaterializedSessionShape(
      indexedSession,
      { ...materializedSession, unregisteredParsedGraph: new Map([['raw', {}]]) },
      'fixture-source',
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => validateCanonicalMaterializedSessionShape(
      indexedSession,
      {
        ...materializedSession,
        analysis: {
          ...materializedSession.analysis,
          parsedCorrelation: new Set(['raw']),
        },
      },
      'fixture-source',
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => validateCanonicalMaterializedSessionShape(
      indexedSession,
      {
        ...materializedSession,
        presentationIndexes: {
          ...materializedSession.presentationIndexes,
          alternateEvents: [{ id: 'shadow' }],
        },
      },
      'fixture-source',
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );
  assert.equal(
    validateCanonicalMaterializedSessionShape(
      indexedSession,
      {
        ...materializedSession,
        analysis: {
          ...materializedSession.analysis,
          slowCommands: [{
            id: 'command-without-exit-code',
            exitCode: undefined,
          }],
        },
      },
      'fixture-source',
    ).analysis.slowCommands[0].exitCode,
    undefined,
  );

  let getterCalled = false;
  const accessorArray = [];
  Object.defineProperty(accessorArray, 0, {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'unsafe';
    },
  });
  const indexedWithPayload = (payload) => ({
    ...indexedSession,
    materializationDescriptor: {
      ...indexedSession.materializationDescriptor,
      payload,
    },
  });
  assert.throws(
    () => validateCanonicalIndexedSessionShape(indexedWithPayload(accessorArray), 'fixture-source'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.equal(getterCalled, false);

  const symbolArray = ['safe'];
  symbolArray[Symbol('unsafe')] = 'value';
  assert.throws(
    () => validateCanonicalIndexedSessionShape(indexedWithPayload(symbolArray), 'fixture-source'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  const extraKeyArray = ['safe'];
  extraKeyArray.extra = 'value';
  assert.throws(
    () => validateCanonicalIndexedSessionShape(indexedWithPayload(extraKeyArray), 'fixture-source'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('strict synthetic adapter traverses Indexed to Materialized dispatch without resident arrays', async () => {
  const indexedSession = makeStrictIndexedSession();
  const materializedSession = makeStrictMaterializedSession(indexedSession);
  const dependencySet = {
    schemaVersion: 1,
    id: 'dependencies-1',
    sourceKind: indexedSession.sourceKind,
    entries: [],
  };
  const index = {
    sourceKind: indexedSession.sourceKind,
    repoRoot: '/synthetic/repository',
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    projectQueryStore: buildProjectQueryStore([materializedSession]),
    materializationDependencies: new Map([['dependencies-1', dependencySet]]),
    legacyRawOwners: {
      schemaVersion: 1,
      sourceKind: indexedSession.sourceKind,
      entryCount: 0,
      accountedBytes: 2,
      payload: {},
    },
  };
  let receivedDependencySet = null;
  const adapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async (context) => {
      receivedDependencySet = context.dependencySet;
      return materializedSession;
    },
  });

  assert.equal(Object.hasOwn(indexedSession, 'rawEvents'), false);
  assert.equal(Object.hasOwn(indexedSession, 'logicalEvents'), false);
  assert.equal(
    await materializeSessionWithAdapter(index, indexedSession, adapter, { indexRevision: 3 }),
    materializedSession,
  );
  assert.equal(receivedDependencySet, dependencySet);

  const mutatingValidatorIndex = {
    ...index,
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    materializationDependencies: new Map([['dependencies-1', dependencySet]]),
    legacyRawOwners: { ...index.legacyRawOwners },
  };
  const mutatingValidatorAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => materializedSession,
    strictOverrides: {
      validateMaterializationDescriptor({ materializationContext }) {
        materializationContext.repoRoot = '/mutated-by-validator';
      },
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      mutatingValidatorIndex,
      indexedSession,
      mutatingValidatorAdapter,
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );

  const mutatingMaterializerIndex = {
    ...index,
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    materializationDependencies: new Map([['dependencies-1', dependencySet]]),
    legacyRawOwners: { ...index.legacyRawOwners },
  };
  const mutatingMaterializerAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async ({ materializationContext }) => {
      materializationContext.repoRoot = '/mutated-by-materializer';
      return materializedSession;
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      mutatingMaterializerIndex,
      indexedSession,
      mutatingMaterializerAdapter,
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );

  const extendingMaterializationContextAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async ({ materializationContext }) => {
      materializationContext.unregistered = 'mutation';
      return materializedSession;
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      mutatingMaterializerIndex,
      indexedSession,
      extendingMaterializationContextAdapter,
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );

  const mutatingPrivateValidatorIndex = {
    ...index,
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    materializationDependencies: new Map([['dependencies-1', dependencySet]]),
    legacyRawOwners: { ...index.legacyRawOwners },
  };
  const privateMutationResult = makeStrictMaterializedSession(indexedSession);
  const mutatingPrivateValidatorAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => privateMutationResult,
    strictOverrides: {
      validateMaterializedPrivateState({ session }) {
        session.title = 'mutated by private validator';
      },
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      mutatingPrivateValidatorIndex,
      indexedSession,
      mutatingPrivateValidatorAdapter,
    ),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
  );

  const freshStrictIndex = () => ({
    ...index,
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    materializationDependencies: new Map([['dependencies-1', dependencySet]]),
    legacyRawOwners: { ...index.legacyRawOwners },
  });
  const throwingMutationCases = [
    {
      name: 'descriptor validator',
      adapter: makeLifecycleAdapter({
        kind: indexedSession.sourceKind,
        sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
        materializeSession: async () => makeStrictMaterializedSession(indexedSession),
        strictOverrides: {
          validateMaterializationDescriptor({ materializationContext }) {
            materializationContext.repoRoot = '/descriptor-mutated-before-throw';
            throw new Error('descriptor rejected');
          },
        },
      }),
    },
    {
      name: 'materializer',
      adapter: makeLifecycleAdapter({
        kind: indexedSession.sourceKind,
        sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
        materializeSession: async ({ materializationContext }) => {
          materializationContext.repoRoot = '/materializer-mutated-before-throw';
          throw new Error('materializer rejected');
        },
      }),
    },
    {
      name: 'private validator',
      adapter: makeLifecycleAdapter({
        kind: indexedSession.sourceKind,
        sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
        materializeSession: async () => makeStrictMaterializedSession(indexedSession),
        strictOverrides: {
          validateMaterializedPrivateState({ session }) {
            session.title = 'private state mutated before throw';
            throw new Error('private state rejected');
          },
        },
      }),
    },
  ];
  for (const fixture of throwingMutationCases) {
    await assert.rejects(
      materializeSessionWithAdapter(
        freshStrictIndex(),
        indexedSession,
        fixture.adapter,
      ),
      (error) => {
        assert.equal(error.code, 'MATERIALIZATION_CONTRACT_VIOLATION', fixture.name);
        assert.ok(error.cause instanceof Error, fixture.name);
        return true;
      },
    );
  }
  const mutatingLegacyValidatorAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => makeStrictMaterializedSession(indexedSession),
    strictOverrides: {
      validateLegacyRawOwnerIndex({ sessionIds }) {
        sessionIds.add('legacy-mutated-before-throw');
        throw new Error('legacy owner rejected');
      },
    },
  });
  assert.throws(
    () => validateIndexOwnership(freshStrictIndex(), { adapter: mutatingLegacyValidatorAdapter }),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && error.cause instanceof Error,
  );

  const validatorRejectionCases = [
    {
      name: 'descriptor validator',
      override: {
        validateMaterializationDescriptor() {
          throw new Error('descriptor rejected without mutation');
        },
      },
    },
    {
      name: 'private validator',
      override: {
        validateMaterializedPrivateState() {
          throw new Error('private rejected without mutation');
        },
      },
    },
  ];
  for (const fixture of validatorRejectionCases) {
    const rejectingAdapter = makeLifecycleAdapter({
      kind: indexedSession.sourceKind,
      sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
      materializeSession: async () => makeStrictMaterializedSession(indexedSession),
      strictOverrides: fixture.override,
    });
    await assert.rejects(
      materializeSessionWithAdapter(
        freshStrictIndex(),
        indexedSession,
        rejectingAdapter,
      ),
      (error) => {
        assert.equal(error.code, 'MATERIALIZATION_CONTRACT_VIOLATION', fixture.name);
        assert.ok(error.cause instanceof Error, fixture.name);
        return true;
      },
    );
  }
  const rejectingLegacyValidatorAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => makeStrictMaterializedSession(indexedSession),
    strictOverrides: {
      validateLegacyRawOwnerIndex() {
        throw new Error('legacy rejected without mutation');
      },
    },
  });
  assert.throws(
    () => validateIndexOwnership(freshStrictIndex(), { adapter: rejectingLegacyValidatorAdapter }),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && error.cause instanceof Error,
  );

  const promiseReturningValidatorAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => makeStrictMaterializedSession(indexedSession),
    strictOverrides: {
      validateMaterializationDescriptor() {
        return Promise.resolve('not a synchronous validator result');
      },
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      freshStrictIndex(),
      indexedSession,
      promiseReturningValidatorAdapter,
    ),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && /must return undefined synchronously/.test(error.cause?.message || ''),
  );

  const unprintableRejection = Object.create(null);
  const unprintableRejectionAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => makeStrictMaterializedSession(indexedSession),
    strictOverrides: {
      validateMaterializationDescriptor() {
        throw unprintableRejection;
      },
    },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      freshStrictIndex(),
      indexedSession,
      unprintableRejectionAdapter,
    ),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && error.cause === unprintableRejection
      && /unprintable adapter rejection/.test(error.message),
  );

  const sourceFailure = new Error('source became stale');
  sourceFailure.code = 'INDEXED_SOURCE_STALE';
  const sourceFailureAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => { throw sourceFailure; },
  });
  await assert.rejects(
    materializeSessionWithAdapter(
      freshStrictIndex(),
      indexedSession,
      sourceFailureAdapter,
    ),
    (error) => error === sourceFailure,
  );
});

test('future strict adapters receive only bounded declared context and selected materialization inputs', async () => {
  const indexedSession = makeStrictIndexedSession('future-source');
  const materializedSession = makeStrictMaterializedSession(indexedSession);
  const dependencySet = {
    schemaVersion: 1,
    id: 'dependencies-1',
    sourceKind: indexedSession.sourceKind,
    entries: [],
  };
  const projectQueryStore = buildProjectQueryStore([materializedSession], {
    presentationForEvent: queryContract().projectQueryPresentation,
  });
  let unrelatedGraphInspected = false;
  const index = {
    sourceKind: indexedSession.sourceKind,
    repoRoot: '/synthetic/repository',
    fixtureRoot: '/synthetic/source-root',
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    projectQueryStore,
    materializationDependencies: new Map([[dependencySet.id, dependencySet]]),
    legacyRawOwners: {
      schemaVersion: 1,
      sourceKind: indexedSession.sourceKind,
      entryCount: 0,
      accountedBytes: 2,
      payload: {},
    },
    unrelatedQueryBytes: Buffer.alloc(32 * 1024 * 1024),
    unrelatedGraph: new Proxy({}, {
      ownKeys() {
        unrelatedGraphInspected = true;
        throw new Error('unrelated Index graph must not be inspected');
      },
    }),
  };
  let materializerCalls = 0;
  const adapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async ({ materializationContext, indexedSession: selected, dependencySet: selectedDependencies }) => {
      materializerCalls += 1;
      assert.deepEqual(materializationContext, {
        sourceKind: indexedSession.sourceKind,
        repoRoot: index.repoRoot,
        fixtureRoot: index.fixtureRoot,
      });
      assert.equal(selected, indexedSession);
      assert.equal(selectedDependencies, dependencySet);
      assert.equal(Object.hasOwn(materializationContext, 'projectQueryStore'), false);
      assert.equal(Object.hasOwn(materializationContext, 'sessionsById'), false);
      return materializedSession;
    },
    strictOverrides: {
      materializationContextFields: ['fixtureRoot'],
      validateMaterializationDescriptor({ materializationContext }) {
        assert.equal(materializationContext.fixtureRoot, index.fixtureRoot);
      },
    },
  });
  assert.equal(validateIndexOwnership(index, { adapter }), indexedSession.sourceKind);
  assert.equal(
    await materializeSessionWithAdapter(index, indexedSession, adapter),
    materializedSession,
  );
  assert.equal(materializerCalls, 1);
  assert.equal(unrelatedGraphInspected, false);
});

test('strict materialization fails closed when query projection facts drift at equal counts', async () => {
  const indexedSession = makeStrictIndexedSession('projection-source');
  const materializedSession = makeStrictMaterializedSession(indexedSession);
  Object.assign(materializedSession.rawEvents[0], {
    timestamp: '2026-08-16T00:00:00.000Z',
    recordType: 'message',
    payloadType: 'message',
    role: 'user',
    status: 'completed',
    preview: 'raw one',
    searchText: 'raw one searchable',
    touchedFiles: ['/synthetic/repository/raw-one.txt'],
    source: { file: '/synthetic/repository/source.jsonl' },
  });
  const secondRaw = {
    ...materializedSession.rawEvents[0],
    rawId: `${indexedSession.sourceKind}:raw:strict:2`,
    preview: 'raw two',
    searchText: 'raw two searchable',
    touchedFiles: ['/synthetic/repository/raw-two.txt'],
  };
  materializedSession.rawEvents.push(secondRaw);
  materializedSession.rawEventCount = 2;
  indexedSession.rawEventCount = 2;
  Object.assign(materializedSession.logicalEvents[0], {
    status: 'completed',
    toolName: 'fixture_tool',
    preview: 'logical preview',
    searchText: 'logical searchable text',
    touchedFiles: ['/synthetic/repository/logical.txt'],
    source: { file: '/synthetic/repository/source.jsonl' },
    rawRefs: [
      { rawId: materializedSession.rawEvents[0].rawId },
      { rawId: materializedSession.rawEvents[1].rawId },
    ],
  });
  materializedSession.presentationIndexes.codeModeDeclaredRequests.set(
    materializedSession.logicalEvents[0].id,
    { toolNames: ['fixture_tool'], requestEvidence: 'declared_source' },
  );
  indexedSession.queryProjectionDigest = projectQueryProjectionDigest(
    materializedSession,
    queryContract().projectQueryPresentation,
  );
  const dependencySet = {
    schemaVersion: 1,
    id: 'dependencies-1',
    sourceKind: indexedSession.sourceKind,
    entries: [],
  };
  const index = {
    sourceKind: indexedSession.sourceKind,
    repoRoot: '/synthetic/repository',
    sessions: [indexedSession],
    sessionsById: new Map([[indexedSession.id, indexedSession]]),
    projectQueryStore: buildProjectQueryStore([materializedSession], {
      presentationForEvent: queryContract().projectQueryPresentation,
    }),
    materializationDependencies: new Map([[dependencySet.id, dependencySet]]),
    legacyRawOwners: {
      schemaVersion: 1,
      sourceKind: indexedSession.sourceKind,
      entryCount: 0,
      accountedBytes: 2,
      payload: {},
    },
  };
  const driftCases = [
    ['event ID', (session) => {
      const originalId = session.logicalEvents[0].id;
      const presentation = session.presentationIndexes.codeModeDeclaredRequests.get(originalId);
      session.logicalEvents[0].id = 'projection-source:event:other';
      session.presentationIndexes.codeModeDeclaredRequests.delete(originalId);
      session.presentationIndexes.codeModeDeclaredRequests.set(session.logicalEvents[0].id, presentation);
    }],
    ['kind/status', (session) => {
      session.logicalEvents[0].kind = 'different_kind';
      session.logicalEvents[0].status = 'failed';
    }],
    ['text', (session) => {
      session.logicalEvents[0].preview = 'different preview';
      session.logicalEvents[0].searchText = 'different searchable text';
    }],
    ['files', (session) => {
      session.logicalEvents[0].touchedFiles = ['/synthetic/repository/different.txt'];
    }],
    ['presentation', (session) => {
      session.presentationIndexes.codeModeDeclaredRequests.get(session.logicalEvents[0].id).toolNames = [
        'different_tool',
      ];
    }],
    ['Raw physical ordinal', (session) => { session.rawEvents.reverse(); }],
  ];
  for (const [name, mutate] of driftCases) {
    const drifted = structuredClone(materializedSession);
    mutate(drifted);
    const adapter = makeLifecycleAdapter({
      kind: indexedSession.sourceKind,
      sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
      materializeSession: async () => drifted,
    });
    await assert.rejects(
      materializeSessionWithAdapter(index, indexedSession, adapter),
      (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
        && /query projection does not match/.test(error.message),
      name,
    );
  }

  const projectionMutationError = new Error('query presentation rejected');
  const mutatingProjectionQuery = queryContract();
  mutatingProjectionQuery.projectQueryPresentation = (session) => {
    session.title = 'mutated before query rejection';
    throw projectionMutationError;
  };
  const mutatingProjectionAdapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => structuredClone(materializedSession),
    strictOverrides: { query: mutatingProjectionQuery },
  });
  await assert.rejects(
    materializeSessionWithAdapter(index, indexedSession, mutatingProjectionAdapter),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && /must not mutate/.test(error.message)
      && error.cause === projectionMutationError,
  );
});

test('query projection normalizes an unverifiable post-hook mutation to the stable materialization code', async () => {
  const { index, indexedSession, materializedSession } = makeStrictMaterializationBoundaryFixture();
  const projectionQuery = queryContract();
  projectionQuery.projectQueryPresentation = (session) => {
    const revocable = Proxy.revocable({}, {});
    session.analysis.tokenStats = revocable.proxy;
    revocable.revoke();
    return null;
  };
  const adapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => structuredClone(materializedSession),
    strictOverrides: { query: projectionQuery },
  });
  await assert.rejects(
    materializeSessionWithAdapter(index, indexedSession, adapter),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && /left the Materialized Session unverifiable/.test(error.message)
      && error.cause instanceof TypeError,
  );
});

test('query projection keeps hook rejection precedence when mutation makes fingerprinting impossible', async () => {
  const { index, indexedSession, materializedSession } = makeStrictMaterializationBoundaryFixture();
  const projectionRejection = new Error('projection rejected after mutation');
  const projectionQuery = queryContract();
  projectionQuery.projectQueryPresentation = (session) => {
    const revocable = Proxy.revocable({}, {});
    session.analysis.tokenStats = revocable.proxy;
    revocable.revoke();
    throw projectionRejection;
  };
  const adapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => structuredClone(materializedSession),
    strictOverrides: { query: projectionQuery },
  });
  await assert.rejects(
    materializeSessionWithAdapter(index, indexedSession, adapter),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && /left the Materialized Session unverifiable/.test(error.message)
      && error.cause === projectionRejection,
  );
});

test('adapter-private state that cannot be fingerprinted fails with the stable materialization code', async () => {
  const { index, indexedSession, materializedSession } = makeStrictMaterializationBoundaryFixture();
  const revocable = Proxy.revocable({}, {});
  const returned = structuredClone(materializedSession);
  returned._fixturePrivate = revocable.proxy;
  revocable.revoke();
  const adapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => returned,
    strictOverrides: { materializedPrivateFields: ['_fixturePrivate'] },
  });
  await assert.rejects(
    materializeSessionWithAdapter(index, indexedSession, adapter),
    (error) => error.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
      && /inputs could not be fingerprinted/.test(error.message)
      && error.cause instanceof TypeError,
  );
});

test('materialization phase observation is content-free and preserves strict admission', async () => {
  const { index, indexedSession, materializedSession } = makeStrictMaterializationBoundaryFixture();
  const adapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => structuredClone(materializedSession),
  });
  const events = [];
  const result = await materializeSessionWithAdapter(index, indexedSession, adapter, {
    onMaterializationPhase(event) {
      events.push(event);
    },
  });

  assert.equal(result.id, indexedSession.id);
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => Object.keys(event).every((key) => (
    key === 'phase' || key === 'state'
  ))));
  assert.deepEqual(events.map(({ phase, state }) => `${phase}:${state}`), [
    'materialized_pre_adapter_validation:start',
    'materialized_pre_adapter_validation:end',
    'adapter_materialization:start',
    'adapter_materialization:end',
    'materialized_post_adapter_ownership:start',
    'materialized_post_adapter_ownership:end',
    'materialized_canonical_validation:start',
    'materialized_canonical_validation:end',
    'materialized_private_validation:start',
    'materialized_private_fingerprint_capture:start',
    'materialized_private_fingerprint_capture:end',
    'materialized_private_callback:start',
    'materialized_private_callback:end',
    'materialized_private_fingerprint_recheck:start',
    'materialized_private_fingerprint_recheck:end',
    'materialized_private_validation:end',
    'materialized_fingerprint_reuse:start',
    'materialized_fingerprint_reuse:end',
    'materialized_projection:start',
    'materialized_projection:end',
    'materialized_fingerprint_recheck:start',
    'materialized_fingerprint_recheck:end',
    'materialized_final_admission_check:start',
    'materialized_final_admission_check:end',
  ]);
});

test('strict materialization reuses the verified private fingerprint for query guarding', async () => {
  const { index, indexedSession, materializedSession } = makeStrictMaterializationBoundaryFixture();
  const adapter = makeLifecycleAdapter({
    kind: indexedSession.sourceKind,
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    materializeSession: async () => structuredClone(materializedSession),
  });
  const phaseEvents = [];
  const operationTotals = new Map();
  await materializeSessionWithAdapter(index, indexedSession, adapter, {
    onMaterializationPhase({ phase, state }) {
      phaseEvents.push(`${phase}:${state}`);
    },
    onProjectionChunk({ phase, operations }) {
      operationTotals.set(phase, (operationTotals.get(phase) || 0) + operations);
    },
  });

  assert.equal(operationTotals.has('materialized_fingerprint_capture'), false);
  assert.ok(operationTotals.get('materialized_private_validator_capture') > 0);
  assert.equal(
    operationTotals.get('materialized_private_validator_recheck'),
    operationTotals.get('materialized_private_validator_capture'),
  );
  assert.ok(operationTotals.get('materialized_fingerprint_recheck') > 0);
  assert.ok(
    operationTotals.get('materialized_private_validator_capture')
      > operationTotals.get('materialized_fingerprint_recheck'),
  );
  assert.deepEqual(
    phaseEvents.filter((event) => event.startsWith('materialized_fingerprint_')),
    [
      'materialized_fingerprint_reuse:start',
      'materialized_fingerprint_reuse:end',
      'materialized_fingerprint_recheck:start',
      'materialized_fingerprint_recheck:end',
    ],
  );
});

test('last-waiter cancellation throughout final verification never admits the Session to cache', async () => {
  const verificationPhases = [
    'materialized_private_validator_capture',
    'materialized_private_validator_recheck',
    'materialized_fingerprint_reuse',
    'materialized_projection',
    'materialized_fingerprint_recheck',
  ];
  for (const targetPhase of verificationPhases) {
    const { index, indexedSession, materializedSession } = makeStrictMaterializationBoundaryFixture();
    const adapter = makeLifecycleAdapter({
      kind: indexedSession.sourceKind,
      sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
      materializeSession: async () => structuredClone(materializedSession),
    });
    const scheduler = createMaterializationScheduler({ warn() {} });
    const owner = createMaterializedSessionOwner({
      index,
      indexRevision: 1,
      retirementController: new AbortController(),
      scheduler,
    });
    const waiterController = new AbortController();
    let notifyVerification;
    const verificationStarted = new Promise((resolve) => { notifyVerification = resolve; });
    const pending = owner.get(indexedSession, waiterController.signal, ({ signal }) => (
      materializeSessionWithAdapter(index, indexedSession, adapter, {
        signal,
        onProjectionChunk(chunk) {
          if (chunk.phase === targetPhase) notifyVerification();
        },
        onMaterializationPhase({ phase, state }) {
          if (targetPhase === 'materialized_fingerprint_reuse'
              && phase === targetPhase
              && state === 'start') {
            notifyVerification();
            waiterController.abort();
          }
        },
      })
    ));
    await verificationStarted;
    if (targetPhase !== 'materialized_fingerprint_reuse') waiterController.abort();
    await assert.rejects(pending, { name: 'AbortError' }, targetPhase);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(owner.cache.has(indexedSession.id), false, targetPhase);
    assert.equal(owner.stats().completed, 0, targetPhase);
  }
});

test('source-specific locator fields remain optional and opaque to the shared contract', () => {
  const index = makeCanonicalIndex('claude-code');
  const residentAdapter = makeLifecycleAdapter({
    kind: 'claude-code',
    materializeSession: async ({ indexedSession }) => indexedSession,
  });
  assert.equal(validateIndexOwnership(index, { adapter: residentAdapter }), 'claude-code');
  assert.equal(Object.hasOwn(index.sessions[0].rawEvents[0], 'sourceLocator'), false);
  assert.equal(Object.hasOwn(index.sessions[0].logicalEvents[0], 'sourceLocator'), false);
});

test('canonical index ownership rejects non-canonical sourceKind before query use', () => {
  const index = makeCanonicalIndex('codex');
  index.sourceKind = 'CODEX';

  assert.throws(
    () => validateIndexOwnership(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => queryForIndex(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('canonical dispatch rejects whitespace-padded ownership without normalizing it', async () => {
  const index = makeCanonicalIndex('codex');
  index.sourceKind = ' codex ';

  assert.throws(
    () => queryForIndex(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const sessionIndex = makeCanonicalIndex('claude-code');
  sessionIndex.sessions[0].sourceKind = ' claude-code ';
  await assert.rejects(
    buildEventDetailForSession(
      sessionIndex,
      sessionIndex.sessions[0],
      sessionIndex.sessions[0].logicalEvents[0].id,
      'main',
    ),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('missing canonical index and session fields fail clearly', () => {
  const index = makeCanonicalIndex('codex');
  assert.throws(
    () => validateIndexOwnership({ ...index, repoRoot: '' }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const session = index.sessions[0];
  const missingEvents = { ...session };
  delete missingEvents.logicalEvents;
  const brokenIndex = {
    ...index,
    sessions: [missingEvents],
    sessionsById: new Map([[missingEvents.id, missingEvents]]),
  };
  assert.throws(
    () => validateIndexOwnership(brokenIndex),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('missing event ownership fails at shared query consumption instead of defaulting to Codex', () => {
  const index = makeCanonicalIndex('claude-code');
  delete index.sessions[0].logicalEvents[0].sourceKind;
  const query = createSessionQuery();

  assert.throws(
    () => query.getTimeline(index, index.sessions[0].id, {
      layer: 'main',
      offset: 0,
      limit: 10,
      q: '',
      locale: 'en',
    }),
    { code: 'MISSING_SOURCE_OWNERSHIP' },
  );
});

test('raw timeline and raw event lookup enforce index to session to raw ownership', () => {
  const index = makeCanonicalIndex('claude-code');
  index.sessions[0].rawEvents[0].sourceKind = 'codex';
  const query = createSessionQuery();

  assert.throws(
    () => query.getTimeline(index, index.sessions[0].id, {
      layer: 'raw',
      offset: 0,
      limit: 10,
      q: '',
      locale: 'en',
    }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
  assert.throws(
    () => query.getEvent(index, index.sessions[0].id, index.sessions[0].rawEvents[0].rawId, {
      layer: 'raw',
      locale: 'en',
    }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('logical timeline consumption enforces index to session to event ownership', () => {
  const index = makeCanonicalIndex('claude-code');
  index.sessions[0].logicalEvents[0].sourceKind = 'codex';
  const query = createSessionQuery();

  assert.throws(
    () => query.getTimeline(index, index.sessions[0].id, {
      layer: 'main',
      offset: 0,
      limit: 10,
      q: '',
      locale: 'en',
    }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('file suggestions reject a session owned by another source', () => {
  const index = makeCanonicalIndex('claude-code');
  index.sessions[0].sourceKind = 'codex';
  const query = createSessionQuery();

  assert.throws(
    () => query.fileSuggestions(index, { layer: 'main' }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('canonical event ownership mismatches fail clearly', () => {
  const index = makeCanonicalIndex('codex');
  const event = index.sessions[0].logicalEvents[0];
  const raw = index.sessions[0].rawEvents[0];

  assert.throws(
    () => validateCanonicalLogicalEventShape(event, 'claude-code'),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
  assert.throws(
    () => validateCanonicalRawEventShape(raw, 'claude-code'),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('canonical logical and raw events require exact sourceKind spelling', () => {
  for (const [sourceKind, invalidSourceKind] of [
    ['codex', 'CODEX'],
    ['claude-code', 'Claude-Code'],
  ]) {
    const index = makeCanonicalIndex(sourceKind);
    const event = { ...index.sessions[0].logicalEvents[0], sourceKind: invalidSourceKind };
    const raw = { ...index.sessions[0].rawEvents[0], sourceKind: invalidSourceKind };

    assert.throws(
      () => validateCanonicalLogicalEventShape(event, sourceKind),
      { code: 'CANONICAL_CONTRACT_VIOLATION' },
    );
    assert.throws(
      () => validateCanonicalRawEventShape(raw, sourceKind),
      { code: 'CANONICAL_CONTRACT_VIOLATION' },
    );
  }

  for (const sourceKind of ['codex', 'claude-code']) {
    const index = makeCanonicalIndex(sourceKind);
    assert.equal(
      validateCanonicalLogicalEventShape(index.sessions[0].logicalEvents[0], sourceKind),
      sourceKind,
    );
    assert.equal(
      validateCanonicalRawEventShape(index.sessions[0].rawEvents[0], sourceKind),
      sourceKind,
    );
  }
});

test('canonical logical and raw events reject surrounding sourceKind whitespace', () => {
  for (const [sourceKind, invalidSourceKinds] of [
    ['codex', [' codex', 'codex ']],
    ['claude-code', [' claude-code ']],
  ]) {
    const index = makeCanonicalIndex(sourceKind);
    for (const invalidSourceKind of invalidSourceKinds) {
      const event = { ...index.sessions[0].logicalEvents[0], sourceKind: invalidSourceKind };
      const raw = { ...index.sessions[0].rawEvents[0], sourceKind: invalidSourceKind };

      assert.throws(
        () => validateCanonicalLogicalEventShape(event, sourceKind),
        { code: 'CANONICAL_CONTRACT_VIOLATION' },
      );
      assert.throws(
        () => validateCanonicalRawEventShape(raw, sourceKind),
        { code: 'CANONICAL_CONTRACT_VIOLATION' },
      );
    }
  }
});

test('accessor-backed sessions are not canonical-valid without explicit opt-in', () => {
  const index = makeCanonicalIndex('claude-code');
  const residentAdapter = makeLifecycleAdapter({
    kind: 'claude-code',
    materializeSession: async ({ indexedSession }) => indexedSession,
  });
  Object.defineProperty(index, 'sessions', {
    configurable: true,
    get() {
      throw new Error('sessions getter must not be invoked');
    },
  });

  assert.throws(
    () => validateIndexOwnership(index, { adapter: residentAdapter }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.equal(
    validateIndexOwnership(index, {
      allowUninspectableSessions: true,
      adapter: residentAdapter,
    }),
    'claude-code',
  );
});

test('detail dispatch validates logical and raw ownership before adapter rendering', async () => {
  const logicalIndex = makeCanonicalIndex('claude-code');
  const logicalSession = logicalIndex.sessions[0];
  logicalSession.logicalEvents[0].sourceKind = 'codex';
  await assert.rejects(
    buildEventDetailForSession(
      logicalIndex,
      logicalSession,
      logicalSession.logicalEvents[0].id,
      'main',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const rawIndex = makeCanonicalIndex('claude-code');
  const rawSession = rawIndex.sessions[0];
  rawSession.rawEvents[0].sourceKind = 'codex';
  await assert.rejects(
    buildEventDetailForSession(
      rawIndex,
      rawSession,
      rawSession.rawEvents[0].rawId,
      'raw',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('logical detail validates every referenced Raw Event before adapter rendering', async () => {
  const crossOwnedIndex = makeCanonicalIndex('claude-code');
  const crossOwnedSession = crossOwnedIndex.sessions[0];
  const foreignRaw = {
    ...makeCanonicalIndex('codex').sessions[0].rawEvents[0],
    rawId: 'codex:raw:foreign',
  };
  crossOwnedSession.rawEvents.push(foreignRaw);
  crossOwnedSession.logicalEvents[0].rawRefs.push({ rawId: foreignRaw.rawId });

  await assert.rejects(
    buildEventDetailForSession(
      crossOwnedIndex,
      crossOwnedSession,
      crossOwnedSession.logicalEvents[0].id,
      'main',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const missingRawIndex = makeCanonicalIndex('claude-code');
  const missingRawSession = missingRawIndex.sessions[0];
  missingRawSession.logicalEvents[0].rawRefs.push({ rawId: 'claude-code:raw:missing' });
  await assert.rejects(
    buildEventDetailForSession(
      missingRawIndex,
      missingRawSession,
      missingRawSession.logicalEvents[0].id,
      'main',
    ),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const multiRawIndex = makeCanonicalIndex('claude-code');
  const multiRawSession = multiRawIndex.sessions[0];
  const secondRaw = {
    ...multiRawSession.rawEvents[0],
    rawId: 'claude-code:raw:2',
  };
  multiRawSession.rawEvents.push(secondRaw);
  multiRawSession.logicalEvents[0].rawRefs.push({ rawId: secondRaw.rawId });
  const detail = await buildEventDetailForSession(
    multiRawIndex,
    multiRawSession,
    multiRawSession.logicalEvents[0].id,
    'main',
  );
  assert.deepEqual(
    detail.rawRefs.map((reference) => reference.rawId),
    ['claude-code:raw:1', 'claude-code:raw:2'],
  );
});

test('image preview dispatch validates logical and raw ownership before adapter access', async () => {
  const logicalIndex = makeCanonicalIndex('codex');
  const logicalSession = logicalIndex.sessions[0];
  logicalSession.logicalEvents[0].sourceKind = 'claude-code';
  await assert.rejects(
    readImagePreviewForSession(
      logicalIndex,
      logicalSession,
      logicalSession.logicalEvents[0].id,
      'image-1-0',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const rawIndex = makeCanonicalIndex('codex');
  const rawSession = rawIndex.sessions[0];
  rawSession.rawEvents[0].sourceKind = 'claude-code';
  await assert.rejects(
    readImagePreviewForSession(
      rawIndex,
      rawSession,
      rawSession.logicalEvents[0].id,
      'image-1-0',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const missingRawIndex = makeCanonicalIndex('codex');
  const missingRawSession = missingRawIndex.sessions[0];
  missingRawSession.logicalEvents[0].rawRefs.push({ rawId: 'codex:raw:missing' });
  await assert.rejects(
    readImagePreviewForSession(
      missingRawIndex,
      missingRawSession,
      missingRawSession.logicalEvents[0].id,
      'image-1-0',
    ),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('sessions and sessionsById must contain the same canonical Session set', () => {
  const index = makeCanonicalIndex('codex');
  const extra = makeCanonicalIndex('codex').sessions[0];
  extra.id = 'codex:session:extra';
  assert.throws(
    () => validateIndexOwnership({
      ...index,
      sessionsById: new Map([...index.sessionsById, [extra.id, extra]]),
    }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  assert.throws(
    () => validateIndexOwnership({ ...index, sessionsById: new Map() }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('canonical optional cacheObservation accepts the exact protocol token_count shape', () => {
  const fixture = makeCacheObservationMaterializationFixture();
  assert.equal(
    validateCanonicalLogicalEventShape(fixture.currentEvent, fixture.indexedSession.sourceKind),
    fixture.indexedSession.sourceKind,
  );
  assert.equal(
    fixture.currentEvent.cacheObservation.comparison.state,
    COMPARISON_STATE.CACHE_DISCONTINUITY,
  );
  assert.equal(Object.hasOwn(fixture.currentEvent.cacheObservation, 'isDiscontinuity'), false);
  assert.equal(validateStrictFixture(fixture), fixture.materializedSession);

  const withoutObservation = structuredClone(fixture.currentEvent);
  delete withoutObservation.cacheObservation;
  assert.equal(
    validateCanonicalLogicalEventShape(withoutObservation, fixture.indexedSession.sourceKind),
    fixture.indexedSession.sourceKind,
  );
});

test('canonical cacheObservation rejects malformed shape, vocabulary, and event ownership', () => {
  const fixture = makeCacheObservationMaterializationFixture();
  const cases = [
    ['redundant boolean', (event) => { event.cacheObservation.isDiscontinuity = true; }],
    ['schema version', (event) => { event.cacheObservation.schemaVersion = 2; }],
    ['unsafe accounting', (event) => { event.cacheObservation.inputTokens = Infinity; }],
    ['inconsistent uncached input', (event) => { event.cacheObservation.uncachedInputTokens += 1; }],
    ['unknown state', (event) => { event.cacheObservation.comparison.state = 'cache_valid'; }],
    ['prototype-only missing state', (event) => {
      event.cacheObservation.comparison.state = 'missing_token_accounting';
    }],
    ['unknown reason code', (event) => {
      event.cacheObservation.comparison.state = COMPARISON_STATE.COMPARABLE;
      event.cacheObservation.comparison.reasonCodes = ['unknown_gate'];
    }],
    ['non-token subtype', (event) => { event.subtype = 'turn_context'; }],
    ['non-protocol layer', (event) => { event.layer = 'main'; }],
  ];
  for (const [name, mutate] of cases) {
    const event = structuredClone(fixture.currentEvent);
    mutate(event);
    assert.throws(
      () => validateCanonicalLogicalEventShape(event, fixture.indexedSession.sourceKind),
      { code: 'CANONICAL_CONTRACT_VIOLATION' },
      name,
    );
  }
});

test('Materialized cache context validates previous ownership, values, and Raw order', () => {
  for (const [name, mutate] of [
    ['foreign previous event', (fixture) => {
      fixture.currentEvent.cacheObservation.comparison.previousEventId = 'missing-event';
    }],
    ['mismatched previous values', (fixture) => {
      fixture.previousEvent.cacheObservation.inputTokens += 1;
      fixture.previousEvent.cacheObservation.uncachedInputTokens += 1;
      fixture.previousEvent.cacheObservation.reuseBasisPoints = 9_999;
    }],
    ['non-causal Raw order', (fixture) => {
      const previousIndex = fixture.materializedSession.rawEvents.indexOf(
        fixture.materializedSession.rawEvents.find(
          (raw) => raw.rawId === fixture.previousEvent.rawRefs[0].rawId,
        ),
      );
      const currentIndex = fixture.materializedSession.rawEvents.indexOf(
        fixture.materializedSession.rawEvents.find(
          (raw) => raw.rawId === fixture.currentEvent.rawRefs[0].rawId,
        ),
      );
      [fixture.materializedSession.rawEvents[previousIndex], fixture.materializedSession.rawEvents[currentIndex]] = [
        fixture.materializedSession.rawEvents[currentIndex],
        fixture.materializedSession.rawEvents[previousIndex],
      ];
    }],
  ]) {
    const fixture = makeCacheObservationMaterializationFixture();
    mutate(fixture);
    assert.throws(
      () => validateStrictFixture(fixture),
      { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
      name,
    );
  }
});

test('canonical empty cache-link shape is uniform for every production source kind', () => {
  for (const sourceKind of ['codex', 'claude-code', 'deepseek-harness']) {
    const fixture = makeStrictMaterializationBoundaryFixture(sourceKind);
    assert.deepEqual(
      Object.keys(fixture.materializedSession.presentationIndexes),
      ['codeModeDeclaredRequests', 'cacheDiscontinuityLinks'],
    );
    assert.equal(
      fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks
        .protocolEventIdsByMainEventId.size,
      0,
    );
    assert.equal(
      fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks
        .mainEventIdByProtocolEventId.size,
      0,
    );
    assert.equal(validateStrictFixture(fixture), fixture.materializedSession);
  }
});

test('canonical cache-link indexes reject missing, extra, custom, and non-inverse structures', () => {
  const cases = [
    ['missing nested key', (fixture) => {
      delete fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks
        .mainEventIdByProtocolEventId;
    }],
    ['extra nested key', (fixture) => {
      fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks.extra = new Map();
    }],
    ['custom Map property', (fixture) => {
      fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks
        .protocolEventIdsByMainEventId.extra = true;
    }],
    ['custom Map accessor', (fixture) => {
      Object.defineProperty(
        fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks
          .mainEventIdByProtocolEventId,
        'unsafe',
        { enumerable: true, get() { throw new Error('must not run'); } },
      );
    }],
    ['missing reverse link', (fixture) => {
      fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks
        .mainEventIdByProtocolEventId.clear();
    }],
    ['duplicate forward target', (fixture) => {
      fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks
        .protocolEventIdsByMainEventId.set(
          fixture.mainEvent.id,
          [fixture.currentEvent.id, fixture.currentEvent.id],
        );
    }],
    ['non-discontinuity target', (fixture) => {
      const links = fixture.materializedSession.presentationIndexes.cacheDiscontinuityLinks;
      links.protocolEventIdsByMainEventId.set(fixture.mainEvent.id, [fixture.previousEvent.id]);
      links.mainEventIdByProtocolEventId.clear();
      links.mainEventIdByProtocolEventId.set(fixture.previousEvent.id, fixture.mainEvent.id);
    }],
  ];
  for (const [name, mutate] of cases) {
    const fixture = makeCacheObservationMaterializationFixture();
    mutate(fixture);
    assert.throws(
      () => validateStrictFixture(fixture),
      (error) => error?.code === 'MATERIALIZATION_CONTRACT_VIOLATION'
        && !/must not run/u.test(error.message),
      name,
    );
  }
});
