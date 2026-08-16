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
  MAX_QUEUED_MATERIALIZATIONS,
  createMaterializationScheduler,
  createMaterializedSessionOwner,
} = require('../src/materialized-session-owner');

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

function fixtureIndex(ids) {
  const sessions = ids.map((id, index) => ({
    id,
    bytes: 100 + index,
    rawEventCount: index + 1,
    logicalEventCount: index + 2,
  }));
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
  });
  return { index, owner, retirementController, scheduler };
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
  });
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
  assert.equal(owner.cache.get('session-a'), value);
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
  assert.equal(owner.cache.get('session-a'), value);
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
  assert.equal(owner.cache.get('session-a'), value);
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
  assert.equal(owner.cache.get('session-a'), recovered);
  t.diagnostic(`oversized fixture peak allocation bytes: ${observedAllocationBytes}`);
});
