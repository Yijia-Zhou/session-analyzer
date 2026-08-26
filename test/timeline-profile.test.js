'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  materializeSessionForIndex,
} = require('../src/source-adapters');
const {
  MIN_PROFILE_EVENT_COUNT,
  MIN_PROFILE_TEXT_BYTES,
  MAX_PROFILE_TEXT_BYTES,
  buildStrictProfileIndex,
  createProfileMaterializationTracker,
  createProfileServer,
  matchesContextTimelineResponse,
  matchesSessionTimelineResponse,
  parseArgs,
  profileAcceptance,
  profileServerOptions,
  requestConstraints,
} = require('../scripts/timeline-profile');
const {
  assertNoFixtureIdentityLiterals,
  computeTimelineProfileFixtureProof,
  createTimelineProfileFixture,
} = require('../scripts/timeline-profile-fixture');

test('timeline profile accepts only corpus sizes that satisfy its fixed late-hit scenarios', () => {
  assert.equal(MIN_PROFILE_EVENT_COUNT, 1651);
  assert.equal(parseArgs([]).eventCount, undefined);
  assert.equal(parseArgs(['--event-count', '1651']).eventCount, 1651);
  assert.equal(parseArgs(['--event-count', '1800']).eventCount, 1800);

  for (const value of ['1650', '1000', '1.5', 'Infinity', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--event-count', value]),
      /--event-count must be an integer greater than or equal to 1651/,
    );
  }
  assert.throws(
    () => parseArgs(['--event-count']),
    /--event-count must be an integer greater than or equal to 1651/,
  );
});

test('timeline profile accepts only bounded finite integer text payload sizes', () => {
  assert.equal(MIN_PROFILE_TEXT_BYTES, 256);
  assert.equal(MAX_PROFILE_TEXT_BYTES, 65536);
  assert.equal(parseArgs(['--text-bytes', '256']).searchableTextBytes, 256);
  assert.equal(parseArgs(['--text-bytes', '3700']).searchableTextBytes, 3700);
  assert.equal(parseArgs(['--text-bytes', '65536']).searchableTextBytes, 65536);

  for (const value of ['255', '1.5', '65537', 'Infinity', '1e309', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--text-bytes', value]),
      /--text-bytes must be an integer from 256 to 65536/,
    );
  }
  assert.throws(
    () => parseArgs(['--text-bytes']),
    /--text-bytes must be an integer from 256 to 65536/,
  );
});

test('context timeline response matcher treats a missing status parameter as no status filter', () => {
  const base = 'http://127.0.0.1:17890/api/sessions/session/timeline';
  assert.equal(matchesContextTimelineResponse(
    new URL(`${base}?q=context-profile-token&offset=0`),
    'context-profile-token',
  ), true);
  assert.equal(matchesContextTimelineResponse(
    new URL(`${base}?q=context-profile-token&status=failed&offset=0`),
    'context-profile-token',
    'failed',
  ), true);
  assert.equal(matchesContextTimelineResponse(
    new URL(`${base}?q=context-profile-token&status=failed&offset=0`),
    'context-profile-token',
  ), false);
});

test('session timeline response matcher binds a query response to its committed session', () => {
  const base = 'http://127.0.0.1:17890/api/sessions';
  const sessionId = '28282828-2828-4282-8282-282828282828';
  assert.equal(matchesSessionTimelineResponse(
    new URL(`${base}/${sessionId}/timeline?q=switch-query&offset=0`),
    sessionId,
    'switch-query',
  ), true);
  assert.equal(matchesSessionTimelineResponse(
    new URL(`${base}/other/timeline?q=switch-query&offset=0`),
    sessionId,
    'switch-query',
  ), false);
});

test('profile acceptance enforces exact contracts without a total request order or latency gate', () => {
  const scenario = ({
    path = 'warm',
    role = 'primary',
    cards = 150,
    contextRows = 0,
    timelineOffsets = [0],
    materializerCalls = 0,
    materializerCallsByRole = {},
    activeTarget = null,
    markCount = 0,
    kindAlias = 'none',
  } = {}) => ({
    classification: { path, scenarioVersion: 1 },
    functional: {
      selectedSessionRole: role,
      loadedCount: cards,
      canonicalCardCount: cards,
      markCount,
      searchTargets: [],
      activeTarget,
      contextRowCount: contextRows,
      contextRowIsolation: null,
      canonicalUnchanged: true,
      selectionUnchanged: true,
      visibleErrorCount: 0,
    },
    requests: {
      records: [
        { sequence: 1, family: 'analysis' },
        { sequence: 2, family: 'fileSuggestions' },
        { sequence: 3, family: 'timeline', kindAlias },
      ],
      familyCounts: { timeline: timelineOffsets.length },
      timelineOffsets,
      eventEnvelopeCount: 0,
      detailCount: 0,
      constraints: {
        passed: true,
        unconstrainedSiblingFamilies: ['analysis', 'timeline', 'fileSuggestions'],
      },
    },
    work: {
      durationMs: 100,
      fullRenders: 1,
      cardGenerations: cards,
      highlightPasses: 1,
      highlightMarksCreated: 0,
      highlightedOwnerCount: 0,
      targetDiscoveryPasses: 1,
      contextRowInsertions: contextRows,
      materializerCalls,
      materializerCallsByRole,
    },
  });
  const context = scenario({ contextRows: 1 });
  context.functional.contextRowIsolation = true;
  context.requests.familyCounts.timeline = 0;
  context.requests.eventEnvelopeCount = 1;
  context.work.fullRenders = 0;
  context.work.cardGenerations = 0;
  context.work.highlightPasses = 0;
  context.work.highlightMarksCreated = 0;
  context.work.targetDiscoveryPasses = 0;
  const scenarios = {
    warmSearchPreload: scenario({ cards: 600, timelineOffsets: [0, 150, 300, 450] }),
    warmJumpToLateHit: scenario({
      cards: 1800,
      markCount: 1,
      activeTarget: { sessionRole: 'primary', ordinal: 1650 },
    }),
    warmDeepStructuredFilter: scenario({
      cards: 150,
      markCount: 150,
      kindAlias: 'assistant_message',
      timelineOffsets: [0],
    }),
    warmContextReveal: context,
    coldSessionSwitchDuringQuery: scenario({
      path: 'cold-switch-integration',
      role: 'secondary',
      cards: 40,
      materializerCalls: 1,
      materializerCallsByRole: { secondary: 1 },
    }),
  };
  const serverSetup = {
    buildInvocationCount: 1,
    commitValidationInvocationCount: 1,
    projectJobCount: 0,
    prewarmDisabled: true,
    createServerCount: 2,
    ownerMaterializerTotals: {
      warm: { totalCalls: 1, callsByRole: { primary: 1 } },
      coldSwitch: { totalCalls: 2, callsByRole: { primary: 1, secondary: 1 } },
    },
  };

  assert.deepEqual(profileAcceptance(scenarios, serverSetup), {
    structural: true,
    correctness: true,
    privacyAuditPassed: true,
    cleanupPassed: true,
    passed: true,
    failures: [],
    numericalLatencyGate: false,
  });
  assert.deepEqual(profileAcceptance({
    ...scenarios,
    warmSearchPreload: {
      ...scenarios.warmSearchPreload,
      requests: {
        ...scenarios.warmSearchPreload.requests,
        constraints: { passed: false },
      },
    },
  }, serverSetup).failures, ['warmSearchPreload: causal request constraints failed']);

  const changedSelection = {
    ...context,
    functional: {
      ...context.functional,
      selectedSessionRole: 'secondary',
      selectionUnchanged: false,
      canonicalUnchanged: true,
    },
  };
  assert.deepEqual(profileAcceptance({
    ...scenarios,
    warmContextReveal: changedSelection,
  }, serverSetup).failures, [
    'warmContextReveal: context row changed canonical state or isolation',
  ]);
  assert.deepEqual(profileAcceptance({
    ...scenarios,
    warmContextReveal: {
      ...context,
      work: { ...context.work, highlightedOwnerCount: 1 },
    },
  }, serverSetup).failures, [
    'warmContextReveal: canonical work reran',
  ]);
});

test('cold-switch constraints reject a stale primary DOM commit even after final recovery', () => {
  const scenarioRequests = [{
    sequence: 1,
    family: 'timeline',
    sessionRole: 'secondary',
    queryAlias: 'switchQuery',
    kindAlias: 'none',
    statusAlias: 'none',
    offset: 0,
    startedAt: 2,
  }];
  const start = {
    startedAt: 1,
    actions: [{ name: 'selectSecondary', requestIndex: 0, at: 2 }],
  };
  const finalFunctionalState = {
    selectedSessionRole: 'secondary',
    canonicalCardCount: 40,
    visibleErrorCount: 0,
  };
  const staleThenRecoveredLedger = [
    {
      sequence: 1,
      phase: 'afterSelectSecondary',
      afterSelectSecondary: true,
      activeSessionRole: 'secondary',
      cardCounts: { primary: 150, secondary: 0, unknown: 0, canonical: 150 },
    },
    {
      sequence: 2,
      phase: 'afterSelectSecondary',
      afterSelectSecondary: true,
      activeSessionRole: 'secondary',
      cardCounts: { primary: 0, secondary: 40, unknown: 0, canonical: 40 },
    },
  ];
  const constraints = requestConstraints(
    scenarioRequests,
    start,
    finalFunctionalState,
    'coldSessionSwitchDuringQuery',
    staleThenRecoveredLedger,
  );
  assert.equal(constraints.checks.postSecondaryCommitObserved, true);
  assert.equal(constraints.checks.supersededPrimaryCannotCommit, false);
  assert.equal(constraints.passed, false);
});

test('Code Mode context fixture preserves the 1,800-event Main corpus and late-hit position', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-profile-fixture-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const fixture = await createTimelineProfileFixture(root, { includeContextReveal: true });
  const built = await buildStrictProfileIndex(fixture);
  const { adapter, index } = built;
  assert.equal(built.counters.buildInvocationCount, 1);
  assert.equal(built.counters.commitValidationInvocationCount, 1);
  const tracker = createProfileMaterializationTracker(fixture);
  const serverOptions = profileServerOptions(fixture, tracker);
  assert.equal(serverOptions.sessionPrewarm, false);
  assert.equal(Object.hasOwn(serverOptions, 'repo'), false);
  assert.equal(typeof serverOptions.materializeSession, 'function');
  let capturedServerArgs;
  const fakeServer = {};
  const created = createProfileServer(index, built.buildMs, fixture, tracker, (...args) => {
    capturedServerArgs = args;
    return fakeServer;
  });
  assert.equal(created.server, fakeServer);
  assert.equal(capturedServerArgs[0], index);
  assert.equal(capturedServerArgs[1], built.buildMs);
  assert.equal(capturedServerArgs[2].sessionPrewarm, false);
  assert.equal(Object.hasOwn(capturedServerArgs[2], 'repo'), false);
  assert.deepEqual(created.setup, {
    projectJobCount: 0,
    prewarmDisabled: true,
    optionsRepoPresent: false,
  });
  const indexedSession = index.sessionsById.get(fixture.longSessionId);
  for (const field of [
    'rawEvents',
    'logicalEvents',
    'analysis',
    'presentationIndexes',
    '_logicalEvents',
    '_canonicalRawDigests',
    '_reviewMarkers',
    'parsed',
  ]) {
    assert.equal(Object.hasOwn(indexedSession, field), false, `strict Indexed Session retained ${field}`);
  }
  const session = await materializeSessionForIndex(index, indexedSession);
  const secondary = await materializeSessionForIndex(
    index,
    index.sessionsById.get(fixture.secondarySessionId),
  );
  const mainEvents = session.logicalEvents.filter((event) => event.layer === 'main');

  assert.equal(mainEvents.length, 1800);
  assert.equal(secondary.logicalEvents.filter((event) => event.layer === 'main').length, 40);
  const nested = session.logicalEvents.find((event) => event.toolName === fixture.contextReveal.toolName);
  const parent = session.logicalEvents.find((event) => (
    event.kind === 'code_mode_operation'
      && event.codeModeOperation?.eventRefs?.includes(nested?.id)
  ));
  assert.ok(nested);
  assert.ok(parent);
  const timeline = adapter.query.getTimeline(index, session, {
    offset: 0,
    limit: 1800,
    layer: 'main',
    q: 'far-needle',
    kind: '',
    status: '',
    tool: '',
    file: '',
    locale: 'en',
  });
  assert.equal(timeline.total, 1800);
  assert.equal(timeline.events.findIndex((event) => event.hasSearchHit), 1650);
});

test('semantic fixture proof is root-independent and changes with semantic parameters', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-profile-proof-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const baseOptions = {
    eventCount: 8,
    searchableTextBytes: 256,
    hitPositions: [5],
    includeContextReveal: true,
    contextRevealIndex: 2,
  };
  const first = await createTimelineProfileFixture(path.join(root, 'first-root'), baseOptions);
  const second = await createTimelineProfileFixture(path.join(root, 'second-root'), baseOptions);
  assert.equal(first.semanticFixtureProof, second.semanticFixtureProof);

  const changedEventCount = await createTimelineProfileFixture(path.join(root, 'event-count'), {
    ...baseOptions,
    eventCount: 9,
  });
  const changedTextBytes = await createTimelineProfileFixture(path.join(root, 'text-bytes'), {
    ...baseOptions,
    searchableTextBytes: 257,
  });
  const changedHitPositions = await createTimelineProfileFixture(path.join(root, 'hit-positions'), {
    ...baseOptions,
    hitPositions: [6],
  });
  assert.notEqual(first.semanticFixtureProof, changedEventCount.semanticFixtureProof);
  assert.notEqual(first.semanticFixtureProof, changedTextBytes.semanticFixtureProof);
  assert.notEqual(first.semanticFixtureProof, changedHitPositions.semanticFixtureProof);
});

test('semantic fixture proof normalizes mixed separators, sorts keys, and rejects identity residue', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-profile-canonical-proof-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const primaryId = 'synthetic-primary-literal';
  const secondaryId = 'synthetic-secondary-literal';
  const firstRoot = path.join(root, 'first');
  const secondRoot = path.join(root, 'second');
  await fsp.mkdir(firstRoot, { recursive: true });
  await fsp.mkdir(secondRoot, { recursive: true });
  const mixedSeparators = (value) => {
    let index = 0;
    return value.replace(/[\\/]/g, () => ((index += 1) % 2 ? '/' : '\\'));
  };
  const firstFile = path.join(firstRoot, 'primary.jsonl');
  const secondFile = path.join(secondRoot, 'primary.jsonl');
  await fsp.writeFile(firstFile, `${JSON.stringify({
    cwd: firstRoot,
    session_id: primaryId,
    nested: { b: 2, a: 1 },
  })}\n`, 'utf8');
  await fsp.writeFile(secondFile, `${JSON.stringify({
    nested: { a: 1, b: 2 },
    session_id: primaryId,
    cwd: mixedSeparators(secondRoot),
  })}\n`, 'utf8');
  const parameters = { eventCount: 1, searchableTextBytes: 256, hitPositions: [0] };
  const firstProof = await computeTimelineProfileFixtureProof({
    files: [{ name: 'primary-session.jsonl', file: firstFile }],
    parameters,
    repoRoot: firstRoot,
    longSessionId: primaryId,
    secondarySessionId: secondaryId,
  });
  const secondProof = await computeTimelineProfileFixtureProof({
    files: [{ name: 'primary-session.jsonl', file: secondFile }],
    parameters: { hitPositions: [0], searchableTextBytes: 256, eventCount: 1 },
    repoRoot: secondRoot,
    longSessionId: primaryId,
    secondarySessionId: secondaryId,
  });
  assert.equal(firstProof, secondProof);
  assert.throws(() => assertNoFixtureIdentityLiterals(
    `${mixedSeparators(firstRoot)} ${primaryId}`,
    { repoRoot: firstRoot, sessionIds: [primaryId, secondaryId] },
  ), /retained a generated absolute path or literal Session ID/);
});
