'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANONICAL_CONTRACT,
  INDEXED_SESSION_COUNT_FIELDS,
  validateCanonicalIndexedSessionShape,
  validateCanonicalLogicalEventShape,
  validateCanonicalMaterializedSessionShape,
  validateCanonicalRawEventShape,
  validateCanonicalSessionShape,
} = require('../src/canonical-contract');
const { createSessionQuery } = require('../src/session-query');
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
  return {
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
  };
}

function makeStrictMaterializedSession(indexedSession) {
  const carried = {};
  for (const [key, value] of Object.entries(indexedSession)) {
    if (key === 'materializationDescriptor' || key === 'queryShardId') continue;
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
    presentationIndexes: { codeModeDeclaredRequests: new Map() },
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

test('Codex and Claude canonical synthetic indexes satisfy the same shared contract', () => {
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
    assert.equal(validateIndexOwnership(index), sourceKind);
    const session = index.sessions[0];
    assert.equal(validateCanonicalSessionShape(session, sourceKind), sourceKind);
    assert.equal(validateCanonicalRawEventShape(session.rawEvents[0], sourceKind), sourceKind);
    assert.equal(validateCanonicalLogicalEventShape(session.logicalEvents[0], sourceKind), sourceKind);
  }
});

test('production adapters expose resident compatibility materialization through one lifecycle seam', async () => {
  for (const sourceKind of ['codex', 'claude-code']) {
    const adapter = getSourceAdapter(sourceKind);
    assert.equal(adapter.sessionLifecycle, SESSION_LIFECYCLE.RESIDENT_COMPLETE);
    const index = makeCanonicalIndex(sourceKind);
    const indexedSession = index.sessions[0];
    const before = {
      rawEvents: indexedSession.rawEvents,
      logicalEvents: indexedSession.logicalEvents,
      counts: { ...indexedSession.counts },
    };
    const materializedSession = await materializeSessionForIndex(index, indexedSession, {
      indexRevision: 7,
    });

    assert.equal(materializedSession, indexedSession);
    assert.equal(index.sessionsById.get(indexedSession.id), indexedSession);
    assert.equal(indexedSession.rawEvents, before.rawEvents);
    assert.equal(indexedSession.logicalEvents, before.logicalEvents);
    assert.deepEqual(indexedSession.counts, before.counts);
  }
});

test('compatibility materialization rejects cancellation, foreign ownership, and broken Raw references', async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelledIndex = makeCanonicalIndex('codex');
  await assert.rejects(
    materializeSessionForIndex(cancelledIndex, cancelledIndex.sessions[0], {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );

  const ownerIndex = makeCanonicalIndex('codex');
  const foreignSession = makeCanonicalIndex('codex').sessions[0];
  await assert.rejects(
    materializeSessionForIndex(ownerIndex, foreignSession),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const brokenIndex = makeCanonicalIndex('claude-code');
  brokenIndex.sessions[0].logicalEvents[0].rawRefs.push({ rawId: 'claude-code:raw:missing' });
  await assert.rejects(
    materializeSessionForIndex(brokenIndex, brokenIndex.sessions[0]),
    { code: 'MATERIALIZATION_CONTRACT_VIOLATION' },
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
      validateMaterializationDescriptor({ index: callbackIndex }) {
        callbackIndex.repoRoot = '/mutated-by-validator';
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
    materializeSession: async ({ index: callbackIndex }) => {
      callbackIndex.repoRoot = '/mutated-by-materializer';
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
          validateMaterializationDescriptor({ index: callbackIndex }) {
            callbackIndex.repoRoot = '/descriptor-mutated-before-throw';
            throw new Error('descriptor rejected');
          },
        },
      }),
    },
    {
      name: 'legacy validator',
      adapter: makeLifecycleAdapter({
        kind: indexedSession.sourceKind,
        sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
        materializeSession: async () => makeStrictMaterializedSession(indexedSession),
        strictOverrides: {
          validateLegacyRawOwnerIndex({ index: callbackIndex }) {
            callbackIndex.repoRoot = '/legacy-mutated-before-throw';
            throw new Error('legacy owner rejected');
          },
        },
      }),
    },
    {
      name: 'materializer',
      adapter: makeLifecycleAdapter({
        kind: indexedSession.sourceKind,
        sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
        materializeSession: async ({ index: callbackIndex }) => {
          callbackIndex.repoRoot = '/materializer-mutated-before-throw';
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
      name: 'legacy validator',
      override: {
        validateLegacyRawOwnerIndex() {
          throw new Error('legacy rejected without mutation');
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

test('source-specific locator fields remain optional and opaque to the shared contract', () => {
  const index = makeCanonicalIndex('claude-code');
  assert.equal(validateIndexOwnership(index), 'claude-code');
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
  const index = makeCanonicalIndex('codex');
  Object.defineProperty(index, 'sessions', {
    configurable: true,
    get() {
      throw new Error('sessions getter must not be invoked');
    },
  });

  assert.throws(
    () => validateIndexOwnership(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.equal(
    validateIndexOwnership(index, { allowUninspectableSessions: true }),
    'codex',
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
