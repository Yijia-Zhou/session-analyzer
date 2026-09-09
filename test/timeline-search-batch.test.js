'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SEARCH_BATCH_KINDS,
  acceptTimelineSearchBatchPage,
  beginTimelineSearchBatchAttempt,
  createTimelineSearchBatch,
  failTimelineSearchBatchAttempt,
  retireTimelineSearchBatch,
  takeTimelineSearchBatchPublication,
  takeTimelineSearchPreloadSuccessor,
  timelineSearchBatchIdentityMatches,
  timelineSearchBatchPublishEligible,
  timelineSearchBatchSnapshot,
} = require('../src/browser/timeline-search-batch');

const identity = Object.freeze({ sessionId: 'session-a', context: 'main/query-a' });

function events(start, count, hitIndexes = []) {
  const hits = new Set(hitIndexes);
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${start + index}`,
    hasSearchHit: hits.has(index),
  }));
}

function page(items, total, suffix = '') {
  return {
    events: items,
    additionsById: new Map(items.map((item) => [item.id, item])),
    metadata: {
      total,
      searchMatchCount: 7,
      searchEventCount: 3,
      eventKinds: [`kind${suffix}`],
      codeModeRequests: [`request${suffix}`],
    },
  };
}

function beginAndAccept(batch, items, total, suffix = '') {
  const attempt = beginTimelineSearchBatchAttempt(batch);
  assert.equal(attempt.started, true);
  return acceptTimelineSearchBatchPage(batch, page(items, total, suffix));
}

test('closed batch kinds and navigation directions fail before creating local state', () => {
  assert.throws(() => createTimelineSearchBatch({
    kind: 'other', identity, baseOffset: 0, baseTimelineTotal: 1,
  }), /batch kind is not supported/);
  assert.throws(() => createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.NAVIGATION,
    identity,
    baseOffset: 0,
    baseTimelineTotal: 1,
    navigationDirection: 'sideways',
  }), /navigationDirection/);
});

test('preload preserves remaining budgets for zero through three previously consumed attempts', () => {
  for (const consumed of [0, 1, 2, 3]) {
    const batch = createTimelineSearchBatch({
      kind: SEARCH_BATCH_KINDS.PRELOAD,
      identity,
      baseOffset: 150,
      baseTimelineTotal: 1_800,
      consumedPreloadAttempts: consumed,
      preloadMaxAttempts: 3,
      preloadMinTargetCount: 5,
    });
    let started = 0;
    while (true) {
      const attempt = beginTimelineSearchBatchAttempt(batch);
      if (!attempt.started) {
        assert.equal(attempt.decision.reason, 'attempt-budget');
        break;
      }
      started += 1;
      const decision = acceptTimelineSearchBatchPage(batch, page(events(150 + started, 1), 1_800));
      if (decision.action !== 'continue') {
        assert.equal(decision.reason, 'attempt-budget');
        break;
      }
    }
    assert.equal(started, 3 - consumed);
    assert.equal(timelineSearchBatchSnapshot(batch).attemptsConsumed, 3);
  }
});

test('failed preload attempt is consumed exactly once and permits only an eligible successor', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.PRELOAD,
    identity,
    baseOffset: 150,
    baseTimelineTotal: 1_800,
    consumedPreloadAttempts: 1,
    preloadMaxAttempts: 3,
    preloadMinTargetCount: 5,
  });
  assert.equal(beginTimelineSearchBatchAttempt(batch).attemptsConsumed, 2);
  const failure = failTimelineSearchBatchAttempt(batch);
  assert.equal(failure.flush, false);
  assert.equal(failure.continueAfterError, true);
  assert.equal(timelineSearchBatchSnapshot(batch).attemptsConsumed, 2);
  assert.equal(beginTimelineSearchBatchAttempt(batch).attemptsConsumed, 3);
  const finalFailure = failTimelineSearchBatchAttempt(batch);
  assert.equal(finalFailure.continueAfterError, false);
  assert.equal(timelineSearchBatchSnapshot(batch).attemptsConsumed, 3);
});

test('preload partial-error flush transfers committed progress and budget to one fresh successor', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.PRELOAD,
    identity,
    baseOffset: 150,
    baseTimelineTotal: 1_800,
    preloadMaxAttempts: 3,
    preloadMinTargetCount: 5,
  });
  const accepted = events(150, 2, [0]);
  assert.equal(beginAndAccept(batch, accepted, 1_800).action, 'continue');
  assert.equal(beginTimelineSearchBatchAttempt(batch).attemptsConsumed, 2);
  const failure = failTimelineSearchBatchAttempt(batch);
  assert.equal(failure.flush, true);
  assert.equal(failure.continueAfterError, true);
  assert.throws(
    () => beginTimelineSearchBatchAttempt(batch),
    /must publish before a successor attempt/,
  );
  const publication = takeTimelineSearchBatchPublication(batch, identity);
  assert.equal(publication.events[0], accepted[0]);
  assert.equal(takeTimelineSearchPreloadSuccessor(batch, { ...identity, context: 'stale' }), null);
  const successor = takeTimelineSearchPreloadSuccessor(batch, identity);
  assert.ok(successor);
  assert.deepEqual(timelineSearchBatchSnapshot(successor), {
    kind: SEARCH_BATCH_KINDS.PRELOAD,
    identity: { ...identity },
    baseOffset: 152,
    baseTimelineTotal: 1_800,
    loadedOffset: 152,
    latestTotal: 1_800,
    navigationDirection: '',
    attemptsConsumed: 2,
    attemptsStarted: 0,
    acceptedEventIds: [],
    projectedHitOwnerCount: 1,
    activeAttempt: false,
    retired: false,
    published: false,
    preloadSuccessorEligible: false,
    preloadSuccessorTaken: false,
    priorLoadMoreExhausted: false,
  });
  assert.equal(beginTimelineSearchBatchAttempt(successor).attemptsConsumed, 3);
  assert.equal(takeTimelineSearchPreloadSuccessor(batch, identity), null);
});

test('preload uses projected unique hit owners without timelineIndex and stops at the minimum', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.PRELOAD,
    identity,
    baseOffset: 150,
    baseTimelineTotal: 1_800,
    knownTargetOwnerIds: ['known-a', 'known-b', 'known-c', 'known-d'],
    preloadMaxAttempts: 3,
    preloadMinTargetCount: 5,
  });
  const items = events(150, 2, [1]);
  assert.equal(Object.hasOwn(items[0], 'timelineIndex'), false);
  const decision = beginAndAccept(batch, items, 1_800);
  assert.equal(decision.action, 'flush');
  assert.equal(decision.reason, 'target-minimum');
  assert.equal(timelineSearchBatchSnapshot(batch).projectedHitOwnerCount, 5);
});

test('preload starts no request when known target owners already meet the minimum', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.PRELOAD,
    identity,
    baseOffset: 150,
    baseTimelineTotal: 1_800,
    knownTargetOwnerIds: ['known-a', 'known-b'],
    preloadMaxAttempts: 3,
    preloadMinTargetCount: 2,
  });
  const attempt = beginTimelineSearchBatchAttempt(batch);
  assert.equal(attempt.started, false);
  assert.equal(attempt.decision.reason, 'target-minimum');
  assert.equal(timelineSearchBatchSnapshot(batch).attemptsConsumed, 0);
  assert.equal(timelineSearchBatchSnapshot(batch).attemptsStarted, 0);
});

test('preload empty pages consume attempts and may retry the same effective offset', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.PRELOAD,
    identity,
    baseOffset: 150,
    baseTimelineTotal: 1_800,
    preloadMaxAttempts: 2,
    preloadMinTargetCount: 5,
  });
  const first = beginTimelineSearchBatchAttempt(batch);
  assert.equal(first.offset, 150);
  assert.equal(acceptTimelineSearchBatchPage(batch, page([], 1_800)).action, 'continue');
  const second = beginTimelineSearchBatchAttempt(batch);
  assert.equal(second.offset, 150);
  const final = acceptTimelineSearchBatchPage(batch, page([], 1_800));
  assert.equal(final.action, 'stop');
  assert.equal(final.reason, 'attempt-budget');
});

test('forward navigation accumulates no-hit pages and flushes at the first hit candidate', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.NAVIGATION,
    navigationDirection: 'forward',
    identity,
    baseOffset: 600,
    baseTimelineTotal: 1_800,
  });
  assert.equal(beginAndAccept(batch, events(600, 2), 1_800).action, 'continue');
  const decision = beginAndAccept(batch, events(602, 2, [0]), 1_800);
  assert.equal(decision.action, 'flush');
  assert.equal(decision.reason, 'forward-hit-candidate');
  assert.deepEqual(timelineSearchBatchSnapshot(batch).acceptedEventIds, [
    'event-600', 'event-601', 'event-602', 'event-603',
  ]);
});

test('reverse navigation ignores intermediate future hits and loads to the end', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.NAVIGATION,
    navigationDirection: 'reverse',
    identity,
    baseOffset: 600,
    baseTimelineTotal: 604,
  });
  const intermediate = beginAndAccept(batch, events(600, 2, [0]), 604);
  assert.equal(intermediate.action, 'continue');
  assert.equal(intermediate.reason, 'reverse-load-to-end');
  const final = beginAndAccept(batch, events(602, 2, [1]), 604);
  assert.equal(final.action, 'flush');
  assert.equal(final.reason, 'timeline-end');
});

test('navigation no-growth stops and current error flushes only prior accepted progress', () => {
  const empty = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.NAVIGATION,
    navigationDirection: 'forward',
    identity,
    baseOffset: 1,
    baseTimelineTotal: 10,
  });
  assert.equal(beginAndAccept(empty, [], 10).action, 'stop');

  const partial = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.NAVIGATION,
    navigationDirection: 'forward',
    identity,
    baseOffset: 1,
    baseTimelineTotal: 10,
  });
  assert.equal(beginAndAccept(partial, events(1, 1), 10).action, 'continue');
  beginTimelineSearchBatchAttempt(partial);
  const failure = failTimelineSearchBatchAttempt(partial);
  assert.equal(failure.flush, true);
  assert.equal(failure.continueAfterError, false);
});

test('explicit load-more stops at the first new owner and computes exhausted at end/no-growth', () => {
  const hit = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.LOAD_MORE,
    identity,
    baseOffset: 2,
    baseTimelineTotal: 8,
    knownTargetOwnerIds: ['event-2'],
  });
  const decision = beginAndAccept(hit, events(2, 2, [0, 1]), 8);
  assert.equal(decision.action, 'flush');
  assert.equal(decision.result, true);
  assert.equal(decision.exhausted, false);

  const end = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.LOAD_MORE,
    identity,
    baseOffset: 2,
    baseTimelineTotal: 4,
  });
  const endDecision = beginAndAccept(end, events(2, 2), 4);
  assert.equal(endDecision.result, false);
  assert.equal(endDecision.exhausted, true);

  const noGrowth = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.LOAD_MORE,
    identity,
    baseOffset: 2,
    baseTimelineTotal: 8,
  });
  const noGrowthDecision = beginAndAccept(noGrowth, [], 8);
  assert.equal(noGrowthDecision.result, false);
  assert.equal(noGrowthDecision.exhausted, false);
});

test('explicit load-more error preserves prior exhausted state and never continues', () => {
  for (const priorLoadMoreExhausted of [false, true]) {
    const batch = createTimelineSearchBatch({
      kind: SEARCH_BATCH_KINDS.LOAD_MORE,
      identity,
      baseOffset: 1,
      baseTimelineTotal: 10,
      priorLoadMoreExhausted,
    });
    beginTimelineSearchBatchAttempt(batch);
    const failure = failTimelineSearchBatchAttempt(batch);
    assert.equal(failure.continueAfterError, false);
    assert.equal(failure.preserveExhausted, true);
    assert.equal(timelineSearchBatchSnapshot(batch).priorLoadMoreExhausted, priorLoadMoreExhausted);
  }
});

test('latest metadata wins and publication preserves exact event objects without mutating inputs', () => {
  const committed = [events(0, 1)[0]];
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.NAVIGATION,
    navigationDirection: 'reverse',
    identity,
    baseOffset: committed.length,
    baseTimelineTotal: 3,
  });
  const first = events(1, 1);
  const second = events(2, 1);
  assert.equal(beginAndAccept(batch, first, 3, '-first').action, 'continue');
  assert.equal(beginAndAccept(batch, second, 3, '-second').action, 'flush');
  assert.deepEqual(committed.map((item) => item.id), ['event-0']);
  const publication = takeTimelineSearchBatchPublication(batch, identity);
  assert.equal(publication.events[0], first[0]);
  assert.equal(publication.events[1], second[0]);
  assert.deepEqual(publication.metadata.eventKinds, ['kind-second']);
  assert.deepEqual(publication.metadata.codeModeRequests, ['request-second']);
  assert.equal(timelineSearchBatchPublishEligible(batch, identity), false);
});

test('stale identity and retirement prevent publication eligibility', () => {
  const batch = createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.NAVIGATION,
    navigationDirection: 'forward',
    identity,
    baseOffset: 0,
    baseTimelineTotal: 2,
  });
  const decision = beginAndAccept(batch, events(0, 1, [0]), 2);
  assert.equal(decision.flush, true);
  assert.equal(timelineSearchBatchIdentityMatches(batch, identity), true);
  assert.equal(timelineSearchBatchIdentityMatches(batch, { ...identity, context: 'new' }), false);
  assert.equal(timelineSearchBatchPublishEligible(batch, { ...identity, context: 'new' }), false);
  retireTimelineSearchBatch(batch);
  assert.equal(timelineSearchBatchPublishEligible(batch, identity), false);
  assert.throws(() => takeTimelineSearchBatchPublication(batch, identity), /not eligible to publish/);
});
