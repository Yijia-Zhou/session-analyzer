'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
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
} = require('../src/browser/timeline-event-state');

function event(id, label = '') {
  return { id, label };
}

function assertInvariant(callback) {
  assert.throws(callback, (error) => (
    error?.code === TIMELINE_EVENT_STATE_INVARIANT
      && /^Timeline event state invariant: /.test(error.message)
  ));
}

test('timeline event state initializes and resets one empty committed pair', () => {
  const state = createTimelineEventState();
  assert.deepEqual(timelineEventStateParitySnapshot(state, ''), {
    arrayLength: 0,
    mapSize: 0,
    uniqueIdCount: 0,
    objectIdentityParity: true,
    committedContextBound: true,
    offsetMatches: true,
    pendingReplacement: false,
    backend: 'map',
    parityPassed: true,
  });
  commitTimelineEventReplacement(state, 'session-a/main', [event('a')]);
  const priorMap = state.currentEventsById;
  resetTimelineEventState(state);
  assert.equal(state.timelineDataContext, '');
  assert.deepEqual(state.currentEvents, []);
  assert.equal(state.currentEventsById.size, 0);
  assert.notEqual(state.currentEventsById, priorMap);
  assert.equal(state.offset, 0);
  assert.equal(assertTimelineEventState(state).parityPassed, true);
});

test('replacement publishes exact objects and leaves the prior pair intact on invalid input', () => {
  const state = createTimelineEventState();
  const first = event('first');
  const second = event('second');
  commitTimelineEventReplacement(state, 'session-a/main', [first, second]);
  assert.equal(state.currentEventsById.get('first'), first);
  assert.equal(state.currentEventsById.get('second'), second);
  const committed = {
    timelineDataContext: state.timelineDataContext,
    currentEvents: state.currentEvents,
    currentEventsById: state.currentEventsById,
    offset: state.offset,
  };
  for (const invalid of [
    [event('duplicate'), event('duplicate')],
    [event('')],
    [{ label: 'missing' }],
    [null],
  ]) {
    assertInvariant(() => commitTimelineEventReplacement(state, 'session-b/main', invalid));
    assert.deepEqual(state, committed);
  }
});

test('append validates before publish and preserves every prior event identity', () => {
  const state = createTimelineEventState();
  const first = event('first');
  const second = event('second');
  commitTimelineEventReplacement(state, 'session-a/main', [first]);
  const priorArray = state.currentEvents;
  const priorMap = state.currentEventsById;
  appendTimelineEvents(state, [second]);
  assert.notEqual(state.currentEvents, priorArray);
  assert.notEqual(state.currentEventsById, priorMap);
  assert.equal(state.currentEvents[0], first);
  assert.equal(state.currentEvents[1], second);
  assert.equal(state.currentEventsById.get('first'), first);
  assert.equal(state.currentEventsById.get('second'), second);
  assert.equal(state.offset, 2);
  const committedArray = state.currentEvents;
  const committedMap = state.currentEventsById;
  for (const invalid of [
    [event('second')],
    [event('third'), event('third')],
    [event('')],
    [{}],
  ]) {
    assertInvariant(() => appendTimelineEvents(state, invalid));
    assert.equal(state.currentEvents, committedArray);
    assert.equal(state.currentEventsById, committedMap);
    assert.equal(state.offset, 2);
  }
});

test('page validation preserves exact objects and mutates neither committed nor local lookups', () => {
  const committed = new Map([['committed', event('committed')]]);
  const local = new Map([['local', event('local')]]);
  const first = event('first');
  const second = event('second');
  const additions = validateTimelineEventAdditions([first, second], [committed, local]);
  assert.deepEqual([...additions.keys()], ['first', 'second']);
  assert.equal(additions.get('first'), first);
  assert.equal(additions.get('second'), second);
  assert.deepEqual([...committed.keys()], ['committed']);
  assert.deepEqual([...local.keys()], ['local']);

  for (const invalid of [
    [event('committed')],
    [event('local')],
    [event('duplicate'), event('duplicate')],
    [event('')],
    [{}],
  ]) {
    assertInvariant(() => validateTimelineEventAdditions(invalid, [committed, local]));
    assert.deepEqual([...committed.keys()], ['committed']);
    assert.deepEqual([...local.keys()], ['local']);
  }
  assertInvariant(() => validateTimelineEventAdditions([event('third')], [committed, {}]));
});

test('parity detects a foreign Map, wrong identity, size, context, and offset', () => {
  const state = createTimelineEventState();
  const first = event('first');
  commitTimelineEventReplacement(state, 'session-a/main', [first]);
  assert.equal(timelineEventStateParitySnapshot(state, 'session-b/main').pendingReplacement, true);
  assert.equal(timelineEventStateParitySnapshot(state, 'session-b/main').committedContextBound, true);

  const mutations = [
    () => { state.currentEventsById = new Map([['first', first]]); },
    () => { state.currentEventsById.set('first', event('first')); },
    () => { state.currentEventsById.set('extra', event('extra')); },
    () => { state.offset = 2; },
  ];
  for (const mutate of mutations) {
    commitTimelineEventReplacement(state, 'session-a/main', [first]);
    mutate();
    assert.equal(timelineEventStateParitySnapshot(state).parityPassed, false);
    assertInvariant(() => appendTimelineEvents(state, [event('next')]));
  }
});

test('parity and append prevalidation stay linear at multiple prefix sizes', () => {
  const instrumentArray = (array) => {
    const counters = { visits: 0, nestedComparators: 0 };
    Object.defineProperty(array, Symbol.iterator, {
      configurable: true,
      value: function* countingIterator() {
        for (let index = 0; index < this.length; index += 1) {
          counters.visits += 1;
          yield this[index];
        }
      },
    });
    for (const method of ['some', 'every', 'find', 'findIndex']) {
      Object.defineProperty(array, method, {
        configurable: true,
        value() {
          counters.nestedComparators += 1;
          throw new Error(`nested array comparator invoked: ${method}`);
        },
      });
    }
    return counters;
  };
  const instrumentMap = (map) => {
    const counters = { gets: 0, has: 0 };
    const mapGet = map.get.bind(map);
    const mapHas = map.has.bind(map);
    map.get = (key) => {
      counters.gets += 1;
      return mapGet(key);
    };
    map.has = (key) => {
      counters.has += 1;
      return mapHas(key);
    };
    return counters;
  };

  for (const prefixSize of [0, 1, 64, 10_000]) {
    const state = createTimelineEventState();
    commitTimelineEventReplacement(
      state,
      'session-a/main',
      Array.from({ length: prefixSize }, (_, index) => event(`prefix-${index}`)),
    );
    const prefixCounters = instrumentArray(state.currentEvents);
    const mapCounters = instrumentMap(state.currentEventsById);
    const snapshot = timelineEventStateParitySnapshot(state);
    assert.equal(snapshot.parityPassed, true);
    assert.equal(prefixCounters.visits, prefixSize);
    assert.equal(prefixCounters.nestedComparators, 0);
    assert.equal(mapCounters.gets, prefixSize);
    assert.equal(mapCounters.has, 0);

    prefixCounters.visits = 0;
    mapCounters.gets = 0;
    const page = [event(`append-${prefixSize}-a`), event(`append-${prefixSize}-b`)];
    const pageCounters = instrumentArray(page);
    appendTimelineEvents(state, page);
    assert.equal(prefixCounters.visits, prefixSize);
    assert.equal(prefixCounters.nestedComparators, 0);
    assert.equal(pageCounters.visits, page.length);
    assert.equal(pageCounters.nestedComparators, 0);
    assert.equal(mapCounters.gets, prefixSize);
    assert.equal(mapCounters.has, page.length);
  }
});

test('profile snapshots perform no parity work without a state-snapshot observer', () => {
  const prior = globalThis.__sessionAnalyzerProfileObserver;
  delete globalThis.__sessionAnalyzerProfileObserver;
  try {
    const eventCount = 1_000;
    const state = createTimelineEventState();
    commitTimelineEventReplacement(
      state,
      'session-a/main',
      Array.from({ length: eventCount }, (_, index) => event(`event-${index}`)),
    );
    let arrayVisits = 0;
    let mapGets = 0;
    Object.defineProperty(state.currentEvents, Symbol.iterator, {
      configurable: true,
      value: function* countingIterator() {
        for (let index = 0; index < this.length; index += 1) {
          arrayVisits += 1;
          yield this[index];
        }
      },
    });
    const mapGet = state.currentEventsById.get.bind(state.currentEventsById);
    state.currentEventsById.get = (key) => {
      mapGets += 1;
      return mapGet(key);
    };

    assert.equal(profileTimelineEventStateSnapshot(state, 'session-a/main'), null);
    assert.equal(profileTimelineEventStateSnapshot(state, 'session-a/main', {
      observer: { recordLookup() {} },
    }), null);
    const inaccessibleObserver = {};
    Object.defineProperty(inaccessibleObserver, 'recordStateSnapshot', {
      get() { throw new Error('observer getter failure'); },
    });
    assert.equal(profileTimelineEventStateSnapshot(state, 'session-a/main', {
      observer: inaccessibleObserver,
    }), null);
    assert.equal(arrayVisits, 0);
    assert.equal(mapGets, 0);

    const records = [];
    const snapshot = profileTimelineEventStateSnapshot(state, 'session-b/main', {
      observer: { recordStateSnapshot(value) { records.push(value); } },
    });
    assert.equal(arrayVisits, eventCount);
    assert.equal(mapGets, eventCount);
    assert.equal(snapshot.parityPassed, true);
    assert.equal(snapshot.pendingReplacement, true);
    assert.deepEqual(records, [snapshot]);
  } finally {
    if (prior === undefined) delete globalThis.__sessionAnalyzerProfileObserver;
    else globalThis.__sessionAnalyzerProfileObserver = prior;
  }
});

test('exact get and membership use only the committed Map and retain miss semantics', () => {
  const state = createTimelineEventState();
  const first = event('first');
  const temporary = event('temporary');
  commitTimelineEventReplacement(state, 'session-a/main', [first]);
  assert.equal(timelineEventById(state, 'first'), first);
  assert.equal(timelineEventById(state, 'temporary'), null);
  assert.equal(hasTimelineEvent(state, 'first'), true);
  assert.equal(hasTimelineEvent(state, temporary.id), false);
  assert.equal(state.currentEventsById.size, 1);
});

test('card iteration performs one counting Map get per card independent of array length', () => {
  class CountingMap extends Map {
    get(key) {
      this.getCount = (this.getCount || 0) + 1;
      return super.get(key);
    }
  }
  for (const canonicalCount of [4, 400]) {
    const canonical = Array.from({ length: canonicalCount }, (_, index) => event(`event-${index}`));
    const state = createTimelineEventState();
    commitTimelineEventReplacement(state, 'session-a/main', canonical);
    const countingMap = new CountingMap(state.currentEventsById);
    state.currentEventsById = countingMap;
    const cards = [
      { dataset: { eventId: 'event-0' } },
      { dataset: { eventId: 'missing' } },
      { dataset: { eventId: 'event-2' } },
      { dataset: {} },
    ];
    const visited = [];
    const iterations = forEachIndexedTimelineCard(
      cards,
      (eventId, purpose) => timelineEventById(state, eventId, { purpose }),
      (card, item) => visited.push([card, item]),
    );
    assert.equal(iterations, cards.length);
    assert.equal(countingMap.getCount, cards.length);
    assert.equal(visited[0][1], canonical[0]);
    assert.equal(visited[1][1], null);
    assert.equal(visited[2][1], canonical[2]);
    assert.equal(visited[3][1], null);
  }
});

test('profiling observer receives only closed aliases, counts, booleans, and backend class', () => {
  const records = [];
  const observer = {
    recordLookup(value) { records.push(['lookup', value]); },
    recordCardIteration(value) { records.push(['card', value]); },
    recordStateSnapshot(value) { records.push(['state', value]); },
  };
  const state = createTimelineEventState();
  const secretId = 'private-session-event-identity';
  const secretContent = 'private transcript content';
  commitTimelineEventReplacement(state, 'private desired context', [event(secretId, secretContent)]);
  timelineEventStateParitySnapshot(state, 'new private desired context', { observer });
  forEachIndexedTimelineCard(
    [{ dataset: { eventId: secretId }, textContent: secretContent }],
    (eventId, purpose) => timelineEventById(state, eventId, { purpose, observer }),
    () => {},
    { purpose: 'enclosingAffordance', observer },
  );
  timelineEventById(state, secretId, { purpose: secretContent, observer });
  const serialized = JSON.stringify(records);
  assert.equal(serialized.includes(secretId), false);
  assert.equal(serialized.includes(secretContent), false);
  assert.equal(serialized.includes('private desired context'), false);
  assert.equal(serialized.includes('new private desired context'), false);
  assert.equal(closedProfilePurpose(secretContent), 'other');
  assert.deepEqual(records.map(([kind, value]) => [kind, Object.keys(value).sort()]), [
    ['state', [
      'arrayLength', 'backend', 'committedContextBound', 'mapSize', 'objectIdentityParity',
      'offsetMatches', 'parityPassed', 'pendingReplacement', 'uniqueIdCount',
    ]],
    ['card', ['cardIterations', 'purpose']],
    ['lookup', ['arrayComparisons', 'backend', 'lookupRequests', 'mapGets', 'purpose']],
    ['lookup', ['arrayComparisons', 'backend', 'lookupRequests', 'mapGets', 'purpose']],
  ]);
});

test('non-profile use is inert and observer failures cannot affect timeline results', () => {
  const prior = globalThis.__sessionAnalyzerProfileObserver;
  delete globalThis.__sessionAnalyzerProfileObserver;
  try {
    const state = createTimelineEventState();
    const first = event('first');
    commitTimelineEventReplacement(state, 'session-a/main', [first]);
    assert.equal(timelineEventById(state, first.id), first);
    assert.equal(Object.hasOwn(globalThis, '__sessionAnalyzerProfileObserver'), false);
    const throwingObserver = {
      recordLookup() { throw new Error('observer failure'); },
      recordCardIteration() { throw new Error('observer failure'); },
    };
    assert.equal(forEachIndexedTimelineCard(
      [{ dataset: { eventId: first.id } }],
      (eventId, purpose) => timelineEventById(state, eventId, { purpose, observer: throwingObserver }),
      (card, item) => assert.equal(item, first),
      { observer: throwingObserver },
    ), 1);
  } finally {
    if (prior === undefined) delete globalThis.__sessionAnalyzerProfileObserver;
    else globalThis.__sessionAnalyzerProfileObserver = prior;
  }
});
