'use strict';

const TIMELINE_EVENT_STATE_INVARIANT = 'TIMELINE_EVENT_STATE_INVARIANT';
const PROFILE_PURPOSES = new Set(['canonical', 'enclosingAffordance']);
const committedMapContexts = new WeakMap();

function invariant(message) {
  const error = new Error(`Timeline event state invariant: ${message}`);
  error.code = TIMELINE_EVENT_STATE_INVARIANT;
  return error;
}

function closedProfilePurpose(value) {
  return PROFILE_PURPOSES.has(value) ? value : 'other';
}

function optionalProfileObserver(explicitObserver) {
  if (explicitObserver && typeof explicitObserver === 'object') return explicitObserver;
  const observer = globalThis.__sessionAnalyzerProfileObserver;
  return observer && typeof observer === 'object' ? observer : null;
}

function recordProfileEvent(observer, method, value) {
  try {
    observer?.[method]?.(value);
  } catch {}
}

function validateTimelineEventAdditions(events, existingMaps = []) {
  if (!Array.isArray(events)) throw invariant('canonical events must be an array');
  if (!Array.isArray(existingMaps) || existingMaps.some((lookup) => !(lookup instanceof Map))) {
    throw invariant('existing lookups must be Maps');
  }
  const nextMap = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object') throw invariant('canonical event must be an object');
    if (typeof event.id !== 'string' || event.id.length === 0) {
      throw invariant('canonical event ID must be a non-empty string');
    }
    if (nextMap.has(event.id) || existingMaps.some((lookup) => lookup.has(event.id))) {
      throw invariant('canonical event IDs must be unique');
    }
    nextMap.set(event.id, event);
  }
  return nextMap;
}

function createTimelineEventState() {
  const currentEventsById = new Map();
  committedMapContexts.set(currentEventsById, '');
  return {
    timelineDataContext: '',
    currentEvents: [],
    currentEventsById,
    offset: 0,
  };
}

function commitTimelineEventReplacement(state, timelineDataContext, currentEvents) {
  if (!state || typeof state !== 'object') throw invariant('state owner must be an object');
  if (typeof timelineDataContext !== 'string') {
    throw invariant('committed timeline context must be a string');
  }
  const currentEventsById = validateTimelineEventAdditions(currentEvents);
  committedMapContexts.set(currentEventsById, timelineDataContext);
  state.timelineDataContext = timelineDataContext;
  state.currentEvents = currentEvents;
  state.currentEventsById = currentEventsById;
  state.offset = currentEvents.length;
  return state;
}

function resetTimelineEventState(state) {
  return commitTimelineEventReplacement(state, '', []);
}

function timelineEventStateParitySnapshot(state, desiredTimelineDataContext, options = {}) {
  const currentEvents = Array.isArray(state?.currentEvents) ? state.currentEvents : [];
  const currentEventsById = state?.currentEventsById;
  const mapBackend = currentEventsById instanceof Map;
  const uniqueIds = new Set();
  let uniqueNonEmptyIds = true;
  let objectIdentityParity = mapBackend;
  for (const event of currentEvents) {
    const eventId = typeof event?.id === 'string' ? event.id : '';
    if (!eventId || uniqueIds.has(eventId)) uniqueNonEmptyIds = false;
    else uniqueIds.add(eventId);
    if (!mapBackend || !eventId || currentEventsById.get(eventId) !== event) {
      objectIdentityParity = false;
    }
  }
  const uniqueIdCount = uniqueIds.size;
  const committedContextBound = mapBackend
    && committedMapContexts.get(currentEventsById) === state?.timelineDataContext;
  const offsetMatches = Number.isSafeInteger(state?.offset)
    && state.offset === currentEvents.length;
  const parityPassed = mapBackend
    && currentEventsById.size === currentEvents.length
    && uniqueNonEmptyIds
    && uniqueIdCount === currentEvents.length
    && objectIdentityParity
    && committedContextBound
    && offsetMatches;
  const snapshot = {
    arrayLength: currentEvents.length,
    mapSize: mapBackend ? currentEventsById.size : 0,
    uniqueIdCount,
    objectIdentityParity,
    committedContextBound,
    offsetMatches,
    pendingReplacement: typeof desiredTimelineDataContext === 'string'
      && desiredTimelineDataContext !== state?.timelineDataContext,
    backend: mapBackend ? 'map' : 'other',
    parityPassed,
  };
  recordProfileEvent(optionalProfileObserver(options.observer), 'recordStateSnapshot', snapshot);
  return snapshot;
}

function profileTimelineEventStateSnapshot(state, desiredTimelineDataContext, options = {}) {
  const observer = optionalProfileObserver(options.observer);
  let recordStateSnapshot;
  try {
    recordStateSnapshot = observer?.recordStateSnapshot;
  } catch {
    return null;
  }
  if (typeof recordStateSnapshot !== 'function') return null;
  return timelineEventStateParitySnapshot(state, desiredTimelineDataContext, {
    ...options,
    observer: {
      recordStateSnapshot(value) {
        return recordStateSnapshot.call(observer, value);
      },
    },
  });
}

function assertTimelineEventState(state) {
  const snapshot = timelineEventStateParitySnapshot(state);
  if (!snapshot.parityPassed) throw invariant('committed array and Map parity failed');
  return snapshot;
}

function appendTimelineEvents(state, nextEvents) {
  assertTimelineEventState(state);
  const additionsById = validateTimelineEventAdditions(nextEvents, [state.currentEventsById]);
  const currentEvents = state.currentEvents.concat(nextEvents);
  const currentEventsById = new Map(state.currentEventsById);
  for (const [eventId, event] of additionsById) currentEventsById.set(eventId, event);
  committedMapContexts.set(currentEventsById, state.timelineDataContext);
  state.currentEvents = currentEvents;
  state.currentEventsById = currentEventsById;
  state.offset = currentEvents.length;
  return state;
}

function timelineEventById(state, eventId, options = {}) {
  if (!(state?.currentEventsById instanceof Map)) {
    throw invariant('committed lookup must be a Map');
  }
  const purpose = closedProfilePurpose(options.purpose);
  recordProfileEvent(optionalProfileObserver(options.observer), 'recordLookup', {
    purpose,
    backend: 'map',
    lookupRequests: 1,
    mapGets: 1,
    arrayComparisons: 0,
  });
  return state.currentEventsById.get(eventId) || null;
}

function hasTimelineEvent(state, eventId, options = {}) {
  if (!(state?.currentEventsById instanceof Map)) {
    throw invariant('committed lookup must be a Map');
  }
  const purpose = closedProfilePurpose(options.purpose);
  recordProfileEvent(optionalProfileObserver(options.observer), 'recordLookup', {
    purpose,
    backend: 'map',
    lookupRequests: 1,
    mapGets: 0,
    arrayComparisons: 0,
  });
  return state.currentEventsById.has(eventId);
}

function forEachIndexedTimelineCard(cards, lookup, visit, options = {}) {
  if (!cards || typeof cards[Symbol.iterator] !== 'function') {
    throw invariant('mounted cards must be iterable');
  }
  if (typeof lookup !== 'function') throw invariant('card lookup must be a function');
  if (typeof visit !== 'function') throw invariant('card visitor must be a function');
  const purpose = closedProfilePurpose(options.purpose || 'enclosingAffordance');
  const observer = optionalProfileObserver(options.observer);
  let iterations = 0;
  for (const card of cards) {
    iterations += 1;
    recordProfileEvent(observer, 'recordCardIteration', { purpose, cardIterations: 1 });
    const event = lookup(card?.dataset?.eventId || '', purpose);
    visit(card, event || null);
  }
  return iterations;
}

module.exports = {
  TIMELINE_EVENT_STATE_INVARIANT,
  appendTimelineEvents,
  assertTimelineEventState,
  closedProfilePurpose,
  commitTimelineEventReplacement,
  createTimelineEventState,
  forEachIndexedTimelineCard,
  hasTimelineEvent,
  profileTimelineEventStateSnapshot,
  resetTimelineEventState,
  timelineEventById,
  timelineEventStateParitySnapshot,
  validateTimelineEventAdditions,
};
