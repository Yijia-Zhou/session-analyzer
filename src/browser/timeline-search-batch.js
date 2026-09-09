'use strict';

const SEARCH_BATCH_KINDS = Object.freeze({
  PRELOAD: 'search-preload',
  NAVIGATION: 'search-navigation',
  LOAD_MORE: 'search-load-more',
});

const NAVIGATION_DIRECTIONS = new Set(['forward', 'reverse']);
const BATCH_KINDS = new Set(Object.values(SEARCH_BATCH_KINDS));
const METADATA_FIELDS = Object.freeze([
  'total',
  'searchMatchCount',
  'searchEventCount',
  'eventKinds',
  'codeModeRequests',
]);

function invariant(message) {
  const error = new Error(`Timeline search batch invariant: ${message}`);
  error.code = 'TIMELINE_SEARCH_BATCH_INVARIANT';
  return error;
}

function requireBatch(batch) {
  if (!batch || typeof batch !== 'object' || !BATCH_KINDS.has(batch.kind)) {
    throw invariant('batch is invalid');
  }
  return batch;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw invariant(`${label} must be a non-negative integer`);
  return value;
}

function requireIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw invariant('identity must be an object');
  }
  return Object.freeze({ ...identity });
}

function requireOwnerIds(values, label) {
  if (!values || typeof values[Symbol.iterator] !== 'function') {
    throw invariant(`${label} must be iterable`);
  }
  const ids = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !value) throw invariant(`${label} must contain non-empty strings`);
    ids.add(value);
  }
  return ids;
}

function latestTotal(batch) {
  return batch.latestMetadata?.total ?? batch.baseTimelineTotal;
}

function loadedOffset(batch) {
  return batch.baseOffset + batch.acceptedEvents.length;
}

function finishDecision(batch, reason, extras = {}) {
  const flush = batch.acceptedEvents.length > 0;
  return Object.freeze({
    action: flush ? 'flush' : 'stop',
    reason,
    flush,
    continueAfterError: false,
    preserveExhausted: false,
    result: null,
    ...extras,
  });
}

function continueDecision(reason) {
  return Object.freeze({
    action: 'continue',
    reason,
    flush: false,
    continueAfterError: false,
    preserveExhausted: false,
    result: null,
  });
}

function createTimelineSearchBatch(options = {}) {
  const kind = options.kind;
  if (!BATCH_KINDS.has(kind)) throw invariant('batch kind is not supported');
  const baseOffset = requireNonNegativeInteger(options.baseOffset, 'baseOffset');
  const baseTimelineTotal = requireNonNegativeInteger(options.baseTimelineTotal, 'baseTimelineTotal');
  if (baseTimelineTotal < baseOffset) throw invariant('baseTimelineTotal must not precede baseOffset');
  const knownTargetOwnerIds = requireOwnerIds(options.knownTargetOwnerIds || [], 'knownTargetOwnerIds');
  const navigationDirection = kind === SEARCH_BATCH_KINDS.NAVIGATION
    ? options.navigationDirection
    : '';
  if (kind === SEARCH_BATCH_KINDS.NAVIGATION && !NAVIGATION_DIRECTIONS.has(navigationDirection)) {
    throw invariant('navigationDirection must be forward or reverse');
  }
  const preloadMaxAttempts = kind === SEARCH_BATCH_KINDS.PRELOAD
    ? requireNonNegativeInteger(options.preloadMaxAttempts ?? 3, 'preloadMaxAttempts')
    : 0;
  const preloadMinTargetCount = kind === SEARCH_BATCH_KINDS.PRELOAD
    ? requireNonNegativeInteger(options.preloadMinTargetCount ?? 5, 'preloadMinTargetCount')
    : 0;
  const attemptsConsumed = kind === SEARCH_BATCH_KINDS.PRELOAD
    ? requireNonNegativeInteger(options.consumedPreloadAttempts ?? 0, 'consumedPreloadAttempts')
    : 0;
  if (attemptsConsumed > preloadMaxAttempts) {
    throw invariant('consumedPreloadAttempts exceeds preloadMaxAttempts');
  }
  return {
    kind,
    identity: requireIdentity(options.identity),
    baseOffset,
    baseTimelineTotal,
    navigationDirection,
    preloadMaxAttempts,
    preloadMinTargetCount,
    attemptsConsumed,
    attemptsStarted: 0,
    knownTargetOwnerIds,
    projectedHitOwnerIds: new Set(knownTargetOwnerIds),
    acceptedEvents: [],
    acceptedById: new Map(),
    latestMetadata: null,
    priorLoadMoreExhausted: Boolean(options.priorLoadMoreExhausted),
    activeAttempt: false,
    retired: false,
    published: false,
    preloadSuccessorEligible: false,
    preloadSuccessorTaken: false,
  };
}

function timelineSearchBatchIdentityMatches(batch, currentIdentity) {
  requireBatch(batch);
  if (!currentIdentity || typeof currentIdentity !== 'object' || Array.isArray(currentIdentity)) return false;
  const capturedKeys = Object.keys(batch.identity).sort();
  const currentKeys = Object.keys(currentIdentity).sort();
  if (capturedKeys.length !== currentKeys.length) return false;
  return capturedKeys.every((key, index) => (
    key === currentKeys[index] && Object.is(batch.identity[key], currentIdentity[key])
  ));
}

function beginTimelineSearchBatchAttempt(batch) {
  requireBatch(batch);
  if (batch.retired || batch.published) throw invariant('retired or published batch cannot start an attempt');
  if (batch.activeAttempt) throw invariant('an attempt is already active');
  if (batch.preloadSuccessorEligible) {
    throw invariant('accepted preload progress must publish before a successor attempt');
  }
  if (batch.kind === SEARCH_BATCH_KINDS.PRELOAD
      && batch.projectedHitOwnerIds.size >= batch.preloadMinTargetCount) {
    return { started: false, decision: finishDecision(batch, 'target-minimum') };
  }
  if (loadedOffset(batch) >= latestTotal(batch)) {
    return { started: false, decision: finishDecision(batch, 'timeline-end', {
      result: batch.kind === SEARCH_BATCH_KINDS.LOAD_MORE ? false : null,
      exhausted: batch.kind === SEARCH_BATCH_KINDS.LOAD_MORE,
    }) };
  }
  if (batch.kind === SEARCH_BATCH_KINDS.PRELOAD
      && batch.attemptsConsumed >= batch.preloadMaxAttempts) {
    return { started: false, decision: finishDecision(batch, 'attempt-budget') };
  }
  batch.activeAttempt = true;
  batch.attemptsStarted += 1;
  if (batch.kind === SEARCH_BATCH_KINDS.PRELOAD) batch.attemptsConsumed += 1;
  return Object.freeze({
    started: true,
    offset: loadedOffset(batch),
    attemptNumber: batch.attemptsStarted,
    attemptsConsumed: batch.attemptsConsumed,
  });
}

function requireAcceptedPage(page) {
  if (!page || typeof page !== 'object' || !Array.isArray(page.events)) {
    throw invariant('accepted page is invalid');
  }
  if (!(page.additionsById instanceof Map) || page.additionsById.size !== page.events.length) {
    throw invariant('accepted page additions must match events');
  }
  for (const event of page.events) {
    if (!event || typeof event.id !== 'string' || page.additionsById.get(event.id) !== event) {
      throw invariant('accepted page additions must preserve exact event objects');
    }
  }
  const metadata = page.metadata;
  if (!metadata || typeof metadata !== 'object') throw invariant('accepted page metadata is invalid');
  requireNonNegativeInteger(metadata.total, 'metadata.total');
  return metadata;
}

function acceptedPageDecision(batch, pageHitOwnerIds, grew) {
  const atEnd = loadedOffset(batch) >= latestTotal(batch);
  if (batch.kind === SEARCH_BATCH_KINDS.PRELOAD) {
    if (batch.projectedHitOwnerIds.size >= batch.preloadMinTargetCount) {
      return finishDecision(batch, 'target-minimum');
    }
    if (atEnd) return finishDecision(batch, 'timeline-end');
    if (batch.attemptsConsumed >= batch.preloadMaxAttempts) {
      return finishDecision(batch, 'attempt-budget');
    }
    return continueDecision(grew ? 'preload-needs-more-targets' : 'preload-empty-retry');
  }
  if (batch.kind === SEARCH_BATCH_KINDS.NAVIGATION) {
    if (batch.navigationDirection === 'forward' && pageHitOwnerIds.size > 0) {
      return finishDecision(batch, 'forward-hit-candidate');
    }
    if (!grew) return finishDecision(batch, 'no-growth');
    if (atEnd) return finishDecision(batch, 'timeline-end');
    return continueDecision(batch.navigationDirection === 'reverse'
      ? 'reverse-load-to-end'
      : 'forward-needs-hit');
  }
  const hasNewHit = [...pageHitOwnerIds].some((id) => !batch.knownTargetOwnerIds.has(id));
  if (hasNewHit) return finishDecision(batch, 'new-hit-candidate', { result: true, exhausted: false });
  if (!grew) return finishDecision(batch, 'no-growth', { result: false, exhausted: atEnd });
  if (atEnd) return finishDecision(batch, 'timeline-end', { result: false, exhausted: true });
  return continueDecision('load-more-needs-new-hit');
}

function acceptTimelineSearchBatchPage(batch, page) {
  requireBatch(batch);
  if (!batch.activeAttempt) throw invariant('no active attempt can accept a page');
  const metadata = requireAcceptedPage(page);
  for (const [eventId, event] of page.additionsById) {
    if (batch.acceptedById.has(eventId)) throw invariant('accepted page duplicates local batch state');
    batch.acceptedById.set(eventId, event);
  }
  batch.acceptedEvents.push(...page.events);
  batch.latestMetadata = Object.fromEntries(METADATA_FIELDS.map((field) => [field, metadata[field]]));
  const pageHitOwnerIds = new Set();
  for (const event of page.events) {
    if (event.hasSearchHit === true) {
      pageHitOwnerIds.add(event.id);
      batch.projectedHitOwnerIds.add(event.id);
    }
  }
  batch.activeAttempt = false;
  return acceptedPageDecision(batch, pageHitOwnerIds, page.events.length > 0);
}

function failTimelineSearchBatchAttempt(batch) {
  requireBatch(batch);
  if (!batch.activeAttempt) throw invariant('no active attempt can fail');
  batch.activeAttempt = false;
  const flush = batch.acceptedEvents.length > 0;
  if (batch.kind === SEARCH_BATCH_KINDS.PRELOAD) {
    const continueAfterError = !batch.retired
      && batch.attemptsConsumed < batch.preloadMaxAttempts
      && batch.projectedHitOwnerIds.size < batch.preloadMinTargetCount
      && loadedOffset(batch) < latestTotal(batch);
    batch.preloadSuccessorEligible = flush && continueAfterError;
    return Object.freeze({
      action: 'error',
      reason: 'current-attempt-error',
      flush,
      continueAfterError,
      preserveExhausted: false,
      result: null,
    });
  }
  return Object.freeze({
    action: 'error',
    reason: 'current-attempt-error',
    flush,
    continueAfterError: false,
    preserveExhausted: batch.kind === SEARCH_BATCH_KINDS.LOAD_MORE,
    result: null,
  });
}

function retireTimelineSearchBatch(batch) {
  requireBatch(batch);
  batch.retired = true;
  batch.activeAttempt = false;
  batch.preloadSuccessorEligible = false;
  return batch;
}

function timelineSearchBatchPublishEligible(batch, currentIdentity) {
  requireBatch(batch);
  return !batch.retired
    && !batch.published
    && !batch.activeAttempt
    && batch.acceptedEvents.length > 0
    && timelineSearchBatchIdentityMatches(batch, currentIdentity);
}

function takeTimelineSearchBatchPublication(batch, currentIdentity) {
  if (!timelineSearchBatchPublishEligible(batch, currentIdentity)) {
    throw invariant('batch is not eligible to publish');
  }
  batch.published = true;
  return {
    events: [...batch.acceptedEvents],
    additionsById: new Map(batch.acceptedById),
    metadata: batch.latestMetadata ? { ...batch.latestMetadata } : null,
  };
}

function takeTimelineSearchPreloadSuccessor(batch, currentIdentity) {
  requireBatch(batch);
  if (batch.kind !== SEARCH_BATCH_KINDS.PRELOAD) {
    throw invariant('only preload batches can create a successor');
  }
  const eligible = batch.published
    && batch.preloadSuccessorEligible
    && !batch.preloadSuccessorTaken
    && !batch.retired
    && timelineSearchBatchIdentityMatches(batch, currentIdentity)
    && batch.projectedHitOwnerIds.size < batch.preloadMinTargetCount
    && loadedOffset(batch) < latestTotal(batch)
    && batch.attemptsConsumed < batch.preloadMaxAttempts;
  if (!eligible) return null;
  batch.preloadSuccessorTaken = true;
  return createTimelineSearchBatch({
    kind: SEARCH_BATCH_KINDS.PRELOAD,
    identity: batch.identity,
    baseOffset: loadedOffset(batch),
    baseTimelineTotal: latestTotal(batch),
    consumedPreloadAttempts: batch.attemptsConsumed,
    preloadMaxAttempts: batch.preloadMaxAttempts,
    preloadMinTargetCount: batch.preloadMinTargetCount,
    knownTargetOwnerIds: batch.projectedHitOwnerIds,
  });
}

function timelineSearchBatchSnapshot(batch) {
  requireBatch(batch);
  return {
    kind: batch.kind,
    identity: { ...batch.identity },
    baseOffset: batch.baseOffset,
    baseTimelineTotal: batch.baseTimelineTotal,
    loadedOffset: loadedOffset(batch),
    latestTotal: latestTotal(batch),
    navigationDirection: batch.navigationDirection,
    attemptsConsumed: batch.attemptsConsumed,
    attemptsStarted: batch.attemptsStarted,
    acceptedEventIds: batch.acceptedEvents.map((event) => event.id),
    projectedHitOwnerCount: batch.projectedHitOwnerIds.size,
    activeAttempt: batch.activeAttempt,
    retired: batch.retired,
    published: batch.published,
    preloadSuccessorEligible: batch.preloadSuccessorEligible,
    preloadSuccessorTaken: batch.preloadSuccessorTaken,
    priorLoadMoreExhausted: batch.priorLoadMoreExhausted,
  };
}

module.exports = {
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
};
