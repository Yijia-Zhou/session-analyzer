'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  initializeIndexRevisionState,
  installIndexRevision,
  materializeSessionWithLease,
  retiredError,
} = require('../src/index-revision-lease');
const {
  CACHE_ORIGIN_FOREGROUND,
  CACHE_ORIGIN_SPECULATIVE,
  DEFAULT_MATERIALIZED_SESSION_CACHE_POLICY,
  MAX_QUEUED_MATERIALIZATIONS,
  createMaterializationScheduler,
  createMaterializedSessionOwner,
  estimateMaterializedSessionBytes,
} = require('../src/materialized-session-owner');
const { runWithMaterializationObserver } = require('../src/materialization-observer');

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
  const sessions = specifications.map((specification, index) => {
    const fields = typeof specification === 'string' ? { id: specification } : specification;
    return {
      id: fields.id,
      bytes: fields.bytes ?? (100 + index),
      rawEventCount: fields.rawEventCount ?? (index + 1),
      logicalEventCount: fields.logicalEventCount ?? (index + 2),
    };
  });
  return {
    sessions,
    sessionsById: new Map(sessions.map((session) => [session.id, session])),
  };
}

function fixtureOwner(ids, options = {}) {
  const index = fixtureIndex(ids);
  const retirementController = new AbortController();
  const scheduler = options.scheduler || createMaterializationScheduler({
    warn: options.warn,
  });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision: options.indexRevision || 1,
    retirementController,
    scheduler,
    maxEstimatedMaterializedBytes: options.maxEstimatedMaterializedBytes,
    maxCachedSessions: options.maxCachedSessions,
  });
  return { index, owner, retirementController, scheduler };
}

function assertCacheAccounting(owner) {
  const entries = [...owner.cache.values()];
  const estimatedBytes = entries.reduce((total, entry) => total + entry.estimatedBytes, 0);
  assert.equal(owner.estimatedMaterializedBytes, estimatedBytes);
  assert.equal(owner.stats().estimatedMaterializedBytes, estimatedBytes);
  assert.equal(owner.stats().cacheSessionCount, entries.length);
  const oversize = entries.filter(
    (entry) => entry.estimatedBytes > owner.maxEstimatedMaterializedBytes,
  );
  if (oversize.length > 0) {
    assert.equal(entries.length, 1);
    assert.equal(oversize[0].origin, CACHE_ORIGIN_FOREGROUND);
  } else {
    assert.ok(estimatedBytes <= owner.maxEstimatedMaterializedBytes);
    assert.ok(entries.length <= owner.maxCachedSessions);
  }
}

test('MaterializedSessionOwner coalesces one cold job and caches exact object identity', async () => {
  const { index, owner } = fixtureOwner(['session-a']);
  const gate = deferred();
  const value = { id: 'materialized-a' };
  let calls = 0;
  const materialize = async () => {
    calls += 1;
    return gate.promise;
  };

  const first = owner.get(index.sessions[0], null, materialize);
  const second = owner.get(index.sessions[0], null, materialize);
  await tick();
  assert.equal(calls, 1);
  gate.resolve(value);
  assert.equal(await first, value);
  assert.equal(await second, value);
  assert.equal(await owner.get(index.sessions[0], null, materialize), value);
  assert.equal(calls, 1);
  assert.deepEqual(owner.stats(), {
    indexRevision: 1,
    retired: false,
    maxEstimatedMaterializedBytes: 256 * 1024 * 1024,
    maxCachedSessions: 12,
    cacheSessionCount: 1,
    estimatedMaterializedBytes: 6756,
    queuedJobCount: 0,
    activeJobCount: 0,
    waiterCount: 0,
    hits: 1,
    misses: 1,
    coalesced: 1,
    admitted: 1,
    busy: 0,
    started: 1,
    completed: 1,
    failed: 0,
    waiterAborts: 0,
    jobAborts: 0,
    retiredJobs: 0,
    peakCacheSessionCount: 1,
    peakEstimatedMaterializedBytes: 6756,
    cacheAdmissions: 1,
    cacheTouches: 1,
    cachePromotions: 0,
    evictions: 0,
    evictedEstimatedBytes: 0,
    speculativeEvictions: 0,
    foregroundEvictions: 0,
    oversizeForegroundAdmissions: 0,
    speculativeAdmissionRejections: 0,
    prewarmScheduled: 0,
    prewarmStarted: 0,
    prewarmCompleted: 0,
    prewarmPromoted: 0,
    prewarmPreempted: 0,
    prewarmFailed: 0,
    prewarmSkippedBusy: 0,
    prewarmSkippedSize: 0,
    prewarmSkippedBudget: 0,
    prewarmSkippedCached: 0,
    prewarmSkippedCacheCapacity: 0,
    prewarmRetired: 0,
    prewarmCacheHits: 0,
  });
});

test('weighted cache defaults are fixed and invalid injected limits fail closed', () => {
  assert.deepEqual(DEFAULT_MATERIALIZED_SESSION_CACHE_POLICY, {
    maxEstimatedMaterializedBytes: 256 * 1024 * 1024,
    maxCachedSessions: 12,
  });
  assert.throws(
    () => fixtureOwner(['session-a'], { maxEstimatedMaterializedBytes: 0 }),
    /maxEstimatedMaterializedBytes must be a positive safe integer/,
  );
  assert.throws(
    () => fixtureOwner(['session-a'], { maxCachedSessions: 0 }),
    /maxCachedSessions must be a positive safe integer/,
  );
});

test('foreground cache hit touches MRU and count admission evicts true foreground LRU', async () => {
  const { index, owner } = fixtureOwner(['session-a', 'session-b', 'session-c'], {
    maxCachedSessions: 2,
    maxEstimatedMaterializedBytes: 100_000,
  });
  const values = new Map(index.sessions.map((session) => [session.id, { id: session.id }]));
  const materialize = async (session) => values.get(session.id);
  await owner.get(index.sessions[0], null, () => materialize(index.sessions[0]));
  await owner.get(index.sessions[1], null, () => materialize(index.sessions[1]));
  const beforeTouch = owner.cache.get('session-a').lastAccessSequence;
  assert.equal(await owner.get(index.sessions[0], null, () => assert.fail('cache miss')), values.get('session-a'));
  assert.ok(owner.cache.get('session-a').lastAccessSequence > beforeTouch);

  await owner.get(index.sessions[2], null, () => materialize(index.sessions[2]));
  assertCacheAccounting(owner);
  assert.deepEqual([...owner.cache.keys()].sort(), ['session-a', 'session-c']);
  assert.equal(owner.stats().foregroundEvictions, 1);
  assert.equal(owner.stats().evictions, 1);
  assert.equal(owner.stats().cacheSessionCount, 2);
  assert.equal(
    owner.stats().evictedEstimatedBytes,
    estimateMaterializedSessionBytes(index.sessions[1]),
  );
});

test('access sequence rebases deterministically before safe-integer exhaustion', async () => {
  const { index, owner } = fixtureOwner(['session-a', 'session-b', 'session-c'], {
    maxCachedSessions: 2,
    maxEstimatedMaterializedBytes: 100_000,
  });
  await owner.get(index.sessions[0], null, async () => ({ id: 'a' }));
  await owner.get(index.sessions[1], null, async () => ({ id: 'b' }));
  owner.cache.get('session-a').lastAccessSequence = Number.MAX_SAFE_INTEGER - 1;
  owner.cache.get('session-b').lastAccessSequence = Number.MAX_SAFE_INTEGER;
  owner.accessSequence = Number.MAX_SAFE_INTEGER;

  await owner.get(index.sessions[0], null, () => assert.fail('cache miss'));
  assert.equal(owner.accessSequence, 3);
  assert.equal(owner.cache.get('session-b').lastAccessSequence, 2);
  assert.equal(owner.cache.get('session-a').lastAccessSequence, 3);
  await owner.get(index.sessions[2], null, async () => ({ id: 'c' }));
  assert.deepEqual([...owner.cache.keys()].sort(), ['session-a', 'session-c']);
});

test('estimated byte budget evicts LRU even while the count cap has room', async () => {
  const specifications = ['session-a', 'session-b', 'session-c'].map((id) => ({
    id,
    bytes: 1_000,
    rawEventCount: 0,
    logicalEventCount: 0,
  }));
  const perEntryBytes = estimateMaterializedSessionBytes(specifications[0]);
  const { index, owner } = fixtureOwner(specifications, {
    maxCachedSessions: 3,
    maxEstimatedMaterializedBytes: perEntryBytes * 2,
  });
  for (const session of index.sessions) {
    await owner.get(session, null, async () => ({ id: session.id }));
    assertCacheAccounting(owner);
  }
  assert.deepEqual([...owner.cache.keys()], ['session-b', 'session-c']);
  assert.equal(owner.estimatedMaterializedBytes, perEntryBytes * 2);
  assert.equal(owner.stats().cacheSessionCount, 2);
  assert.equal(owner.stats().foregroundEvictions, 1);
  assert.equal(owner.stats().evictions, 1);
  assert.equal(owner.stats().evictedEstimatedBytes, perEntryBytes);
  assert.equal(owner.stats().cacheAdmissions, 3);
  assert.equal(owner.stats().peakCacheSessionCount, 2);
  assert.equal(owner.stats().peakEstimatedMaterializedBytes, perEntryBytes * 2);
});

test('foreground admission prefers a newer speculative victim over older foreground state', async () => {
  const { index, owner } = fixtureOwner(['foreground-a', 'speculative-p', 'foreground-b'], {
    maxCachedSessions: 2,
    maxEstimatedMaterializedBytes: 100_000,
  });
  const foregroundA = { id: 'foreground-a' };
  const speculativeP = { id: 'speculative-p' };
  const foregroundB = { id: 'foreground-b' };
  await owner.get(index.sessions[0], null, async () => foregroundA);
  await tick();
  assert.deepEqual(await owner.prewarm(index.sessions[1], async () => speculativeP), {
    status: 'completed',
  });
  assert.equal(owner.cache.get('speculative-p').origin, CACHE_ORIGIN_SPECULATIVE);

  await owner.get(index.sessions[2], null, async () => foregroundB);
  assertCacheAccounting(owner);
  assert.deepEqual([...owner.cache.keys()].sort(), ['foreground-a', 'foreground-b']);
  assert.equal(owner.stats().speculativeEvictions, 1);
  assert.equal(owner.stats().foregroundEvictions, 0);
});

test('evicted prewarm leaves no stale hit metadata and foreground rematerializes normally', async () => {
  const { index, owner } = fixtureOwner(['predicted', 'foreground'], {
    maxCachedSessions: 1,
    maxEstimatedMaterializedBytes: 100_000,
  });
  let predictedCalls = 0;
  await owner.prewarm(index.sessions[0], async () => {
    predictedCalls += 1;
    return { id: `predicted-${predictedCalls}` };
  });
  await owner.get(index.sessions[1], null, async () => ({ id: 'foreground' }));
  assert.equal(owner.cache.has('predicted'), false);
  assert.equal(owner.stats().speculativeEvictions, 1);

  const reopened = await owner.get(index.sessions[0], null, async () => {
    predictedCalls += 1;
    return { id: `predicted-${predictedCalls}` };
  });
  assert.equal(reopened.id, 'predicted-2');
  assert.equal(predictedCalls, 2);
  assert.equal(owner.cache.get('predicted').origin, CACHE_ORIGIN_FOREGROUND);
  assert.equal(owner.stats().prewarmCacheHits, 0);
  assert.equal(owner.stats().cachePromotions, 0);
  assertCacheAccounting(owner);
});

test('foreground use promotes a cached prewarm once and protects it as normal LRU state', async () => {
  const { index, owner } = fixtureOwner(['predicted', 'unused', 'foreground'], {
    maxCachedSessions: 2,
    maxEstimatedMaterializedBytes: 100_000,
  });
  const predicted = { id: 'predicted' };
  assert.deepEqual(await owner.prewarm(index.sessions[0], async () => predicted), {
    status: 'completed',
  });
  assert.equal(owner.cache.get('predicted').origin, CACHE_ORIGIN_SPECULATIVE);
  assert.equal(await owner.get(index.sessions[0], null, () => assert.fail('cache miss')), predicted);
  assert.equal(await owner.get(index.sessions[0], null, () => assert.fail('cache miss')), predicted);
  assert.equal(owner.cache.get('predicted').origin, CACHE_ORIGIN_FOREGROUND);
  assert.equal(owner.stats().prewarmCacheHits, 1);
  assert.equal(owner.stats().cachePromotions, 1);

  assert.deepEqual(await owner.prewarm(index.sessions[1], async () => ({ id: 'unused' })), {
    status: 'completed',
  });
  await owner.get(index.sessions[2], null, async () => ({ id: 'foreground' }));
  assertCacheAccounting(owner);
  assert.equal(owner.cache.has('predicted'), true);
  assert.equal(owner.cache.has('unused'), false);
  assert.equal(owner.stats().speculativeEvictions, 1);
});

test('speculative admission replaces only older speculative state', async () => {
  const { index, owner } = fixtureOwner(['speculative-a', 'speculative-b'], {
    maxCachedSessions: 1,
    maxEstimatedMaterializedBytes: 100_000,
  });
  await owner.prewarm(index.sessions[0], async () => ({ id: 'a' }));
  assert.deepEqual(await owner.prewarm(index.sessions[1], async () => ({ id: 'b' })), {
    status: 'completed',
  });
  assert.deepEqual([...owner.cache.keys()], ['speculative-b']);
  assertCacheAccounting(owner);
  assert.equal(owner.stats().speculativeEvictions, 1);
  assert.equal(owner.stats().speculativeAdmissionRejections, 0);
});

test('speculative rejection is atomic when evicting speculative state would still require foreground eviction', async () => {
  const specifications = [
    { id: 'foreground', bytes: 1_000, rawEventCount: 0, logicalEventCount: 0 },
    { id: 'speculative-kept', bytes: 1_000, rawEventCount: 0, logicalEventCount: 0 },
    { id: 'speculative-rejected', bytes: 6_000, rawEventCount: 0, logicalEventCount: 0 },
  ];
  const smallBytes = estimateMaterializedSessionBytes(specifications[0]);
  const { index, owner } = fixtureOwner(specifications, {
    maxCachedSessions: 3,
    maxEstimatedMaterializedBytes: smallBytes * 2,
  });
  await owner.get(index.sessions[0], null, async () => ({ id: 'foreground' }));
  await tick();
  await owner.prewarm(index.sessions[1], async () => ({ id: 'speculative-kept' }));
  const beforeEntries = [...owner.cache.keys()];
  const beforeBytes = owner.estimatedMaterializedBytes;

  assert.deepEqual(await owner.prewarm(index.sessions[2], async () => ({ id: 'rejected' })), {
    status: 'completed-not-admitted',
  });
  assert.deepEqual([...owner.cache.keys()], beforeEntries);
  assertCacheAccounting(owner);
  assert.equal(owner.estimatedMaterializedBytes, beforeBytes);
  assert.equal(owner.stats().evictions, 0);
  assert.equal(owner.stats().speculativeAdmissionRejections, 1);
  assert.equal(owner.stats().prewarmSkippedCacheCapacity, 1);
});

test('speculative admission never evicts foreground state at the count cap', async () => {
  const { index, owner } = fixtureOwner(['foreground', 'speculative'], {
    maxCachedSessions: 1,
    maxEstimatedMaterializedBytes: 100_000,
  });
  const foreground = { id: 'foreground' };
  await owner.get(index.sessions[0], null, async () => foreground);
  await tick();
  assert.deepEqual(await owner.prewarm(index.sessions[1], async () => ({ id: 'speculative' })), {
    status: 'completed-not-admitted',
  });
  assert.equal(owner.cache.get('foreground').value, foreground);
  assert.equal(owner.cache.has('speculative'), false);
  assertCacheAccounting(owner);
  assert.equal(owner.stats().foregroundEvictions, 0);
});

test('oversize foreground becomes the sole warm resident and later normal admission recovers policy bounds', async () => {
  const specifications = [
    { id: 'small-a', bytes: 0, rawEventCount: 0, logicalEventCount: 0 },
    { id: 'oversize', bytes: 10_000, rawEventCount: 0, logicalEventCount: 0 },
    { id: 'small-b', bytes: 0, rawEventCount: 0, logicalEventCount: 0 },
  ];
  const { index, owner } = fixtureOwner(specifications, {
    maxCachedSessions: 3,
    maxEstimatedMaterializedBytes: 5_000,
  });
  let oversizeCalls = 0;
  await owner.get(index.sessions[0], null, async () => ({ id: 'small-a' }));
  const oversize = { id: 'oversize' };
  assert.equal(await owner.get(index.sessions[1], null, async () => {
    oversizeCalls += 1;
    return oversize;
  }), oversize);
  assert.deepEqual([...owner.cache.keys()], ['oversize']);
  assertCacheAccounting(owner);
  assert.ok(owner.estimatedMaterializedBytes > owner.maxEstimatedMaterializedBytes);
  assert.equal(await owner.get(index.sessions[1], null, () => assert.fail('cache miss')), oversize);
  assert.equal(oversizeCalls, 1);
  assert.equal(owner.stats().oversizeForegroundAdmissions, 1);
  assert.equal(
    owner.stats().peakEstimatedMaterializedBytes,
    estimateMaterializedSessionBytes(index.sessions[1]),
  );

  await owner.get(index.sessions[2], null, async () => ({ id: 'small-b' }));
  assertCacheAccounting(owner);
  assert.deepEqual([...owner.cache.keys()], ['small-b']);
  assert.ok(owner.estimatedMaterializedBytes <= owner.maxEstimatedMaterializedBytes);
  assert.equal(owner.stats().foregroundEvictions, 2);
  assert.equal(
    owner.stats().evictedEstimatedBytes,
    estimateMaterializedSessionBytes(index.sessions[0])
      + estimateMaterializedSessionBytes(index.sessions[1]),
  );
});

test('oversize speculative completion is not admitted and leaves foreground cache untouched', async () => {
  const specifications = [
    { id: 'foreground', bytes: 0, rawEventCount: 0, logicalEventCount: 0 },
    { id: 'oversize-speculative', bytes: 10_000, rawEventCount: 0, logicalEventCount: 0 },
  ];
  const { index, owner } = fixtureOwner(specifications, {
    maxCachedSessions: 2,
    maxEstimatedMaterializedBytes: 5_000,
  });
  const foreground = { id: 'foreground' };
  await owner.get(index.sessions[0], null, async () => foreground);
  await tick();
  assert.deepEqual(await owner.prewarm(index.sessions[1], async () => ({ id: 'oversize' })), {
    status: 'completed-not-admitted',
  });
  assert.deepEqual([...owner.cache.keys()], ['foreground']);
  assertCacheAccounting(owner);
  assert.equal(owner.cache.get('foreground').value, foreground);
  assert.equal(owner.stats().evictions, 0);
  assert.equal(owner.stats().speculativeAdmissionRejections, 1);
});

test('eviction removes owner retention without invalidating an in-flight local Session reference', async () => {
  const { index, owner } = fixtureOwner(['session-a', 'session-b'], {
    maxCachedSessions: 1,
    maxEstimatedMaterializedBytes: 100_000,
  });
  const release = deferred();
  const sessionA = { id: 'session-a', analysis: { retained: true } };
  const request = (async () => {
    const localSession = await owner.get(index.sessions[0], null, async () => sessionA);
    await release.promise;
    return localSession.analysis.retained;
  })();
  await tick();
  await owner.get(index.sessions[1], null, async () => ({ id: 'session-b' }));
  assert.equal(owner.cache.has('session-a'), false);
  release.resolve();
  assert.equal(await request, true);
});

test('cache observer phases remain fixed and content-free across promotion, eviction, oversize, and rejection', async () => {
  const specifications = [
    { id: 'secret-predicted', bytes: 0, rawEventCount: 0, logicalEventCount: 0 },
    { id: 'secret-oversize', bytes: 10_000, rawEventCount: 0, logicalEventCount: 0 },
    { id: 'secret-rejected', bytes: 11_000, rawEventCount: 0, logicalEventCount: 0 },
  ];
  const { index, owner } = fixtureOwner(specifications, {
    maxCachedSessions: 1,
    maxEstimatedMaterializedBytes: 5_000,
  });
  const events = [];
  await runWithMaterializationObserver((event) => events.push(event), async () => {
    await owner.prewarm(index.sessions[0], async () => ({ secret: 'predicted-value' }));
    await owner.get(index.sessions[0], null, () => assert.fail('cache miss'));
    await owner.get(index.sessions[1], null, async () => ({ secret: 'oversize-value' }));
    await tick();
    await owner.prewarm(index.sessions[2], async () => ({ secret: 'rejected-value' }));
  });
  const phases = new Set(events.map((event) => event.phase));
  for (const phase of [
    'cache_admitted',
    'cache_promoted',
    'cache_touched',
    'cache_evicted',
    'cache_oversize_admitted',
    'cache_speculative_rejected',
  ]) {
    assert.equal(phases.has(phase), true, phase);
  }
  assert.ok(events.every((event) => (
    Object.keys(event).sort().join(',') === 'phase,state' && event.state === 'event'
  )));
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('secret-'), false);
  assert.equal(serialized.includes('predicted-value'), false);
});

test('one waiter abort does not cancel another waiter for the same active Session', async () => {
  const { index, owner } = fixtureOwner(['session-a']);
  const firstController = new AbortController();
  const secondController = new AbortController();
  const gate = deferred();
  let jobSignal;
  const first = owner.get(index.sessions[0], firstController.signal, ({ signal }) => {
    jobSignal = signal;
    return gate.promise;
  });
  const second = owner.get(index.sessions[0], secondController.signal, () => gate.promise);
  await tick();
  firstController.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(jobSignal.aborted, false);
  const value = { id: 'shared-value' };
  gate.resolve(value);
  assert.equal(await second, value);
  assert.equal(owner.cache.get('session-a').value, value);
});

test('successful prewarm populates the normal cache with exact foreground identity', async () => {
  const { index, owner } = fixtureOwner(['session-a']);
  const value = { id: 'prewarmed-a' };
  let calls = 0;
  const materialize = async () => {
    calls += 1;
    return value;
  };

  assert.deepEqual(await owner.prewarm(index.sessions[0], materialize), { status: 'completed' });
  assert.equal(await owner.get(index.sessions[0], null, materialize), value);
  assert.equal(calls, 1);
  assert.equal(owner.cache.get('session-a').value, value);
});

test('foreground get promotes an active same-Session prewarm without restart or cancellation', async () => {
  const { index, owner } = fixtureOwner(['session-a']);
  const gate = deferred();
  let calls = 0;
  let jobSignal;
  const materialize = async ({ signal }) => {
    calls += 1;
    jobSignal = signal;
    return gate.promise;
  };

  const prewarm = owner.prewarm(index.sessions[0], materialize);
  await tick();
  const foreground = owner.get(index.sessions[0], null, materialize);
  assert.deepEqual(await prewarm, { status: 'promoted' });
  assert.equal(calls, 1);
  assert.equal(jobSignal.aborted, false);
  const value = { id: 'promoted-a' };
  gate.resolve(value);
  assert.equal(await foreground, value);
  assert.equal(owner.cache.get('session-a').value, value);
  assert.equal(owner.cache.get('session-a').origin, CACHE_ORIGIN_FOREGROUND);
  assert.equal(owner.stats().prewarmPromoted, 1);
  assert.equal(owner.stats().prewarmCacheHits, 0);
});

test('foreground get for a different Session preempts speculative work before starting', async () => {
  const { index, owner } = fixtureOwner(['session-a', 'session-b']);
  const order = [];
  const never = deferred();
  const prewarm = owner.prewarm(index.sessions[0], async ({ signal }) => {
    order.push('a:start');
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        order.push('a:abort');
        reject(signal.reason);
      }, { once: true });
    });
    return never.promise;
  });
  await tick();

  const foregroundValue = { id: 'foreground-b' };
  const foreground = owner.get(index.sessions[1], null, async () => {
    order.push('b:start');
    return foregroundValue;
  });
  assert.deepEqual(await prewarm, { status: 'preempted' });
  assert.equal(await foreground, foregroundValue);
  assert.deepEqual(order, ['a:start', 'a:abort', 'b:start']);
  assert.equal(owner.cache.has('session-a'), false);
  assert.equal(owner.cache.get('session-b').value, foregroundValue);
});

test('foreground get removes a queued unrelated prewarm before its materializer starts', async () => {
  const { index, owner } = fixtureOwner(['session-a', 'session-b']);
  let prewarmCalls = 0;
  const prewarm = owner.prewarm(index.sessions[0], async () => {
    prewarmCalls += 1;
    return { id: 'unexpected-a' };
  });
  const foregroundValue = { id: 'foreground-b' };
  const foreground = owner.get(index.sessions[1], null, async () => foregroundValue);

  assert.deepEqual(await prewarm, { status: 'preempted' });
  assert.equal(await foreground, foregroundValue);
  assert.equal(prewarmCalls, 0);
  assert.equal(owner.cache.has('session-a'), false);
  assert.equal(owner.cache.get('session-b').value, foregroundValue);
});

test('only one speculative materialization may be active or pending', async () => {
  const { index, owner } = fixtureOwner(['session-a', 'session-b']);
  const gate = deferred();
  let secondCalls = 0;
  const first = owner.prewarm(index.sessions[0], () => gate.promise);
  await tick();
  assert.deepEqual(await owner.prewarm(index.sessions[1], async () => {
    secondCalls += 1;
    return { id: 'unexpected-b' };
  }), { status: 'skipped-busy' });
  assert.equal(secondCalls, 0);
  gate.resolve({ id: 'prewarmed-a' });
  assert.deepEqual(await first, { status: 'completed' });
});

test('failed speculative materialization is silent, uncached, and retryable by foreground', async () => {
  const { index, owner } = fixtureOwner(['session-a']);
  const failure = new Error('synthetic speculative failure');
  failure.code = 'INDEXED_SOURCE_STALE';
  assert.deepEqual(await owner.prewarm(index.sessions[0], async () => {
    throw failure;
  }), { status: 'failed', code: 'INDEXED_SOURCE_STALE' });
  assert.equal(owner.cache.size, 0);

  const value = { id: 'foreground-retry' };
  assert.equal(await owner.get(index.sessions[0], null, async () => value), value);
  assert.equal(owner.cache.get('session-a').value, value);
});

test('last queued waiter abort removes the FIFO job without calling its adapter', async () => {
  const { index, owner } = fixtureOwner(['active', 'queued']);
  const activeGate = deferred();
  const active = owner.get(index.sessions[0], null, () => activeGate.promise);
  await tick();
  const queuedController = new AbortController();
  let queuedCalls = 0;
  const queued = owner.get(index.sessions[1], queuedController.signal, async () => {
    queuedCalls += 1;
    return { id: 'queued' };
  });
  queuedController.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(owner.queue.length, 0);
  activeGate.resolve({ id: 'active' });
  await active;
  await tick();
  assert.equal(queuedCalls, 0);
});

test('distinct cold Sessions start in FIFO order under the global active-one limit', async () => {
  const { index, owner } = fixtureOwner(['first', 'second', 'third']);
  const gates = [deferred(), deferred(), deferred()];
  const started = [];
  const pending = index.sessions.map((session, position) => owner.get(
    session,
    null,
    async () => {
      started.push(session.id);
      return gates[position].promise;
    },
  ));
  await tick();
  assert.deepEqual(started, ['first']);
  gates[0].resolve({ id: 'first-value' });
  await tick();
  assert.deepEqual(started, ['first', 'second']);
  gates[1].resolve({ id: 'second-value' });
  await tick();
  assert.deepEqual(started, ['first', 'second', 'third']);
  gates[2].resolve({ id: 'third-value' });
  assert.deepEqual((await Promise.all(pending)).map((value) => value.id), [
    'first-value',
    'second-value',
    'third-value',
  ]);
});

test('owner FIFO admits 32 distinct queued Sessions, coalesces before admission, and rejects the next', async () => {
  const ids = Array.from({ length: MAX_QUEUED_MATERIALIZATIONS + 2 }, (_, index) => `session-${index}`);
  const { index, owner, retirementController } = fixtureOwner(ids);
  const activeGate = deferred();
  const active = owner.get(index.sessions[0], null, () => activeGate.promise);
  await tick();

  const queued = [];
  for (let position = 1; position <= MAX_QUEUED_MATERIALIZATIONS; position += 1) {
    queued.push(owner.get(index.sessions[position], null, async () => ({ position })));
  }
  const coalesced = owner.get(index.sessions[1], null, async () => ({ unexpected: true }));
  await assert.rejects(
    owner.get(index.sessions.at(-1), null, async () => ({ overflow: true })),
    (error) => error.code === 'MATERIALIZATION_BUSY'
      && error.statusCode === 503
      && error.retryAfterSeconds === 1,
  );
  assert.equal(owner.queue.length, MAX_QUEUED_MATERIALIZATIONS);

  const retirement = retiredError();
  owner.retire(retirement);
  retirementController.abort(retirement);
  activeGate.resolve({ id: 'discarded-active' });
  await assert.rejects(active, { code: 'INDEX_REVISION_RETIRED' });
  const results = await Promise.allSettled([...queued, coalesced]);
  assert.ok(results.every((result) => (
    result.status === 'rejected' && result.reason.code === 'INDEX_REVISION_RETIRED'
  )));
});

test('the global slot remains occupied until an abort-ignoring old job settles', async () => {
  const warnings = [];
  const scheduler = createMaterializationScheduler({ warn: (message) => warnings.push(message) });
  const oldFixture = fixtureOwner(['old'], { scheduler, indexRevision: 1 });
  const newFixture = fixtureOwner(['new'], { scheduler, indexRevision: 2 });
  const oldController = new AbortController();
  const oldGate = deferred();
  const old = oldFixture.owner.get(
    oldFixture.index.sessions[0],
    oldController.signal,
    () => oldGate.promise,
  );
  await tick();
  oldController.abort();
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(scheduler.active.size, 1);

  const newGate = deferred();
  let newCalls = 0;
  const next = newFixture.owner.get(newFixture.index.sessions[0], null, () => {
    newCalls += 1;
    return newGate.promise;
  });
  await tick();
  assert.equal(newCalls, 0);
  oldGate.resolve({ id: 'ignored-old-value' });
  await tick();
  assert.equal(newCalls, 1);
  newGate.resolve({ id: 'new-value' });
  assert.equal((await next).id, 'new-value');
  assert.deepEqual(warnings, ['Materialization completed after cancellation; result discarded.']);
});

test('same-Session retry after the last active waiter aborts waits for the old adapter to settle', async () => {
  const { index, owner } = fixtureOwner(['session-a'], { warn: () => {} });
  const controller = new AbortController();
  const oldGate = deferred();
  const first = owner.get(index.sessions[0], controller.signal, () => oldGate.promise);
  await tick();
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });

  const retryGate = deferred();
  let retryCalls = 0;
  const retry = owner.get(index.sessions[0], null, () => {
    retryCalls += 1;
    return retryGate.promise;
  });
  await tick();
  assert.equal(retryCalls, 0);
  oldGate.resolve({ id: 'discarded-old' });
  await tick();
  assert.equal(retryCalls, 1);
  const value = { id: 'retry-value' };
  retryGate.resolve(value);
  assert.equal(await retry, value);
  assert.equal(owner.cache.get('session-a').value, value);
});

test('revision replacement retires waiters and cache while the new owner shares the old global slot', async () => {
  const oldIndex = fixtureIndex(['cached', 'active']);
  const state = initializeIndexRevisionState({ index: oldIndex, warn: () => {} });
  const oldLease = state.revisionLease;
  const cachedValue = { id: 'cached-value' };
  assert.equal(await materializeSessionWithLease(
    oldLease,
    oldIndex.sessions[0],
    null,
    async () => cachedValue,
  ), cachedValue);

  const oldGate = deferred();
  const oldActive = materializeSessionWithLease(
    oldLease,
    oldIndex.sessions[1],
    null,
    () => oldGate.promise,
  );
  await tick();
  const newIndex = fixtureIndex(['new']);
  const newLease = installIndexRevision(state, newIndex);
  await assert.rejects(oldActive, { code: 'INDEX_REVISION_RETIRED', statusCode: 409 });
  assert.equal(oldLease.materializedSessionOwner.cache.size, 0);

  let newCalls = 0;
  const newGate = deferred();
  const current = materializeSessionWithLease(
    newLease,
    newIndex.sessions[0],
    null,
    () => {
      newCalls += 1;
      return newGate.promise;
    },
  );
  await tick();
  assert.equal(newCalls, 0);
  oldGate.resolve({ id: 'discarded-old' });
  await tick();
  assert.equal(newCalls, 1);
  const currentValue = { id: 'current-value' };
  newGate.resolve(currentValue);
  assert.equal(await current, currentValue);
});

test('revision replacement aborts active prewarm and never admits it into the next owner', async () => {
  const oldIndex = fixtureIndex(['prewarm-old']);
  const state = initializeIndexRevisionState({ index: oldIndex, warn: () => {} });
  let activeSignal;
  const prewarm = state.revisionLease.materializedSessionOwner.prewarm(
    oldIndex.sessions[0],
    ({ signal }) => {
      activeSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  );
  await tick();
  const oldOwner = state.revisionLease.materializedSessionOwner;
  const nextIndex = fixtureIndex(['replacement']);
  const nextLease = installIndexRevision(state, nextIndex);

  assert.deepEqual(await prewarm, { status: 'retired' });
  assert.equal(activeSignal.aborted, true);
  assert.equal(oldOwner.cache.size, 0);
  assert.equal(nextLease.materializedSessionOwner.cache.size, 0);
  assert.equal(oldOwner.stats().prewarmRetired, 1);
});

test('failed materialization is never cached and the next request retries', async () => {
  const { index, owner } = fixtureOwner(['session-a']);
  const stale = new Error('stale');
  stale.code = 'INDEXED_SOURCE_STALE';
  stale.statusCode = 409;
  let calls = 0;
  const value = { id: 'retry-value' };
  const recovered = await owner.get(index.sessions[0], null, async () => {
    calls += 1;
    throw stale;
  }).catch((error) => {
    assert.equal(error, stale);
    assert.equal(owner.cache.size, 0);
    return owner.get(index.sessions[0], null, async () => {
      calls += 1;
      return value;
    });
  });
  assert.equal(recovered, value);
  assert.equal(calls, 2);
  assert.equal(owner.cache.get('session-a').value, value);
  assert.equal(owner.stats().failed, 1);
});

test('oversized single-Session failure coalesces one allocation and leaves the owner usable', async (t) => {
  const { index, owner } = fixtureOwner(['session-a']);
  const allocationBytes = 16 * 1024 * 1024;
  const gate = deferred();
  let retainedAllocation;
  let calls = 0;
  let observedAllocationBytes = 0;
  const failure = new Error('Materialization exceeded its safe fixture boundary');
  failure.code = 'MATERIALIZATION_FAILED';
  failure.statusCode = 500;
  const materialize = async () => {
    calls += 1;
    const before = process.memoryUsage().arrayBuffers;
    retainedAllocation = Buffer.alloc(allocationBytes);
    observedAllocationBytes = process.memoryUsage().arrayBuffers - before;
    await gate.promise;
    throw failure;
  };

  const first = owner.get(index.sessions[0], null, materialize);
  const second = owner.get(index.sessions[0], null, materialize);
  await tick();
  assert.equal(calls, 1);
  assert.ok(observedAllocationBytes >= allocationBytes);
  gate.resolve();
  await assert.rejects(first, { code: 'MATERIALIZATION_FAILED', statusCode: 500 });
  await assert.rejects(second, { code: 'MATERIALIZATION_FAILED', statusCode: 500 });
  assert.equal(owner.cache.size, 0);
  assert.equal(owner.stats().failed, 1);

  retainedAllocation = null;
  const recovered = { id: 'recovered' };
  assert.equal(await owner.get(index.sessions[0], null, async () => recovered), recovered);
  assert.equal(owner.cache.get('session-a').value, recovered);
  t.diagnostic(`oversized fixture peak allocation bytes: ${observedAllocationBytes}`);
});
