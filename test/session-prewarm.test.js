'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  initializeIndexRevisionState,
  installIndexRevision,
} = require('../src/index-revision-lease');
const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
  estimateMaterializedSessionBytes,
} = require('../src/materialized-session-owner');
const { runWithMaterializationObserver } = require('../src/materialization-observer');
const {
  DEFAULT_SESSION_PREWARM_POLICY,
  normalizeSessionPrewarmPolicy,
  runBoundedSessionPrewarm,
  scheduleBoundedSessionPrewarm,
} = require('../src/session-prewarm');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fixtureIndex(specifications) {
  const sessions = specifications.map((specification, position) => ({
    id: specification.id,
    bytes: specification.bytes || 0,
    rawEventCount: specification.rawEventCount || 0,
    logicalEventCount: specification.logicalEventCount || 0,
    startedAt: `2026-08-${String(position + 1).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: specification.updatedAt
      || `2026-08-${String(31 - position).padStart(2, '0')}T00:00:00.000Z`,
  }));
  return {
    sessions,
    sessionsById: new Map(sessions.map((session) => [session.id, session])),
  };
}

function fixtureLease(specifications, cacheOptions = {}) {
  const index = fixtureIndex(specifications);
  const retirementController = new AbortController();
  const materializedSessionOwner = createMaterializedSessionOwner({
    index,
    indexRevision: 1,
    retirementController,
    scheduler: createMaterializationScheduler(),
    ...cacheOptions,
  });
  return {
    index,
    indexRevision: 1,
    retirementController,
    materializedSessionOwner,
  };
}

test('default v1 policy stays at two candidates, one recent window, and bounded bytes', () => {
  assert.deepEqual(normalizeSessionPrewarmPolicy(), DEFAULT_SESSION_PREWARM_POLICY);
  assert.deepEqual(DEFAULT_SESSION_PREWARM_POLICY, {
    delayMs: 150,
    candidateCap: 2,
    scanLimit: 8,
    budgetBytes: 96 * 1024 * 1024,
    individualBytes: 48 * 1024 * 1024,
  });
});

test('bounded policy skips a large recent candidate and prewarms only the next two eligible Sessions', async () => {
  const index = fixtureIndex([
    { id: 'large', bytes: 40_000 },
    { id: 'eligible-a', bytes: 1_000 },
    { id: 'eligible-b', bytes: 2_000 },
    { id: 'eligible-c', bytes: 3_000 },
  ]);
  const state = initializeIndexRevisionState({ index });
  const calls = [];
  const result = await runBoundedSessionPrewarm(
    state.revisionLease,
    async (indexedSession) => {
      calls.push(indexedSession.id);
      return { id: `materialized-${indexedSession.id}` };
    },
    {
      candidateCap: 2,
      scanLimit: 4,
      budgetBytes: 30_000,
      individualBytes: 20_000,
    },
  );

  assert.deepEqual(calls, ['eligible-a', 'eligible-b']);
  assert.deepEqual(result, {
    status: 'completed',
    consideredCount: 3,
    attemptedCount: 2,
    completedCount: 2,
    notAdmittedCount: 0,
    promotedCount: 0,
    preemptedCount: 0,
    failedCount: 0,
  });
  assert.equal(state.revisionLease.materializedSessionOwner.cache.size, 2);
  assert.equal(state.revisionLease.materializedSessionOwner.stats().prewarmSkippedSize, 1);
});

test('existing foreground cache estimate reduces remaining prewarm capacity', async () => {
  const index = fixtureIndex([
    { id: 'recent-a', bytes: 1_000 },
    { id: 'recent-b', bytes: 1_000 },
    { id: 'foreground', bytes: 3_000, updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  const state = initializeIndexRevisionState({ index });
  const owner = state.revisionLease.materializedSessionOwner;
  const foreground = index.sessionsById.get('foreground');
  await owner.get(foreground, null, async () => ({ id: 'foreground-value' }));
  const foregroundEstimate = estimateMaterializedSessionBytes(foreground);
  const candidateEstimate = estimateMaterializedSessionBytes(index.sessionsById.get('recent-a'));
  const calls = [];
  await runBoundedSessionPrewarm(
    state.revisionLease,
    async (indexedSession) => {
      calls.push(indexedSession.id);
      return { id: indexedSession.id };
    },
    {
      candidateCap: 2,
      scanLimit: 3,
      budgetBytes: foregroundEstimate + candidateEstimate,
      individualBytes: candidateEstimate,
    },
  );

  assert.deepEqual(calls, ['recent-a']);
  assert.equal(owner.cache.size, 2);
  assert.equal(owner.estimatedMaterializedBytes, foregroundEstimate + candidateEstimate);
  assert.equal(owner.stats().prewarmSkippedBudget, 1);
});

test('prewarm stops immediately when foreground cache already meets the admission budget', async () => {
  const index = fixtureIndex([
    { id: 'recent', bytes: 1_000 },
    { id: 'foreground', bytes: 20_000, updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  const state = initializeIndexRevisionState({ index });
  const owner = state.revisionLease.materializedSessionOwner;
  await owner.get(index.sessionsById.get('foreground'), null, async () => ({ id: 'foreground' }));
  let prewarmCalls = 0;
  const result = await runBoundedSessionPrewarm(
    state.revisionLease,
    async () => {
      prewarmCalls += 1;
      return {};
    },
    {
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 10_000,
      individualBytes: 8_000,
    },
  );

  assert.equal(prewarmCalls, 0);
  assert.equal(result.consideredCount, 1);
  assert.equal(result.attemptedCount, 0);
  assert.equal(owner.stats().prewarmSkippedBudget, 1);
});

test('bounded prewarm reports completed work that weighted cache cannot admit without foreground eviction', async () => {
  const lease = fixtureLease([
    { id: 'recent-speculative', bytes: 1_000 },
    { id: 'foreground', bytes: 1_000, updatedAt: '2026-01-01T00:00:00.000Z' },
  ], {
    maxCachedSessions: 1,
    maxEstimatedMaterializedBytes: 100_000,
  });
  const owner = lease.materializedSessionOwner;
  const foreground = { id: 'foreground-value' };
  await owner.get(lease.index.sessionsById.get('foreground'), null, async () => foreground);
  let speculativeCalls = 0;
  const result = await runBoundedSessionPrewarm(
    lease,
    async () => {
      speculativeCalls += 1;
      return { id: 'speculative-value' };
    },
    {
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 30_000,
      individualBytes: 20_000,
    },
  );

  assert.deepEqual(result, {
    status: 'completed',
    consideredCount: 1,
    attemptedCount: 1,
    completedCount: 0,
    notAdmittedCount: 1,
    promotedCount: 0,
    preemptedCount: 0,
    failedCount: 0,
  });
  assert.equal(speculativeCalls, 1);
  assert.deepEqual([...owner.cache.keys()], ['foreground']);
  assert.equal(owner.cache.get('foreground').value, foreground);
  assert.equal(owner.stats().prewarmSkippedCacheCapacity, 1);
  assert.equal(owner.stats().foregroundEvictions, 0);
});

test('scheduled prewarm defers behind foreground and retirement cancels a pending revision wakeup', async () => {
  const index = fixtureIndex([
    { id: 'prewarm-a', bytes: 1_000 },
    { id: 'foreground-b', bytes: 1_000, updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  const state = initializeIndexRevisionState({ index });
  const foregroundGate = deferred();
  const foreground = state.revisionLease.materializedSessionOwner.get(
    index.sessionsById.get('foreground-b'),
    null,
    () => foregroundGate.promise,
  );
  await tick();

  let wake;
  let cleared = 0;
  const prewarmCalls = [];
  scheduleBoundedSessionPrewarm(
    state.revisionLease,
    async (indexedSession) => {
      prewarmCalls.push(indexedSession.id);
      return { id: indexedSession.id };
    },
    {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 30_000,
      individualBytes: 20_000,
      setTimer(callback, delayMs) {
        assert.equal(delayMs, 150);
        wake = callback;
        return 17;
      },
      clearTimer(handle) {
        assert.equal(handle, 17);
        cleared += 1;
      },
    },
  );
  const waking = wake();
  await tick();
  assert.deepEqual(prewarmCalls, []);
  foregroundGate.resolve({ id: 'foreground-value' });
  await foreground;
  await waking;
  assert.deepEqual(prewarmCalls, ['prewarm-a']);

  let retiredWake;
  let retiredCalls = 0;
  scheduleBoundedSessionPrewarm(
    state.revisionLease,
    async () => {
      retiredCalls += 1;
      return {};
    },
    {
      setTimer(callback) {
        retiredWake = callback;
        return 23;
      },
      clearTimer(handle) {
        assert.equal(handle, 23);
        cleared += 1;
      },
    },
  );
  installIndexRevision(state, fixtureIndex([{ id: 'replacement', bytes: 1_000 }]));
  assert.equal(cleared, 1);
  await retiredWake();
  assert.equal(retiredCalls, 0);
});

test('prewarm observation emits fixed content-free phase and state fields only', async () => {
  const index = fixtureIndex([{ id: 'secret-session-id', bytes: 1_000 }]);
  const state = initializeIndexRevisionState({ index });
  const events = [];
  await runWithMaterializationObserver(
    (event) => events.push(event),
    () => runBoundedSessionPrewarm(
      state.revisionLease,
      async () => ({ id: 'materialized-value' }),
      {
        candidateCap: 1,
        scanLimit: 1,
        budgetBytes: 20_000,
        individualBytes: 10_000,
      },
    ),
  );

  assert.ok(events.length >= 5);
  assert.ok(events.every((event) => (
    Object.keys(event).sort().join(',') === 'phase,state'
      && (event.phase.startsWith('session_prewarm_') || event.phase.startsWith('cache_'))
      && event.state === 'event'
  )));
  assert.ok(events.some((event) => event.phase === 'cache_admitted'));
  assert.ok(events.some((event) => event.phase === 'session_prewarm_completed'));
  assert.equal(JSON.stringify(events).includes('secret-session-id'), false);
  assert.equal(JSON.stringify(events).includes('materialized-value'), false);
});
