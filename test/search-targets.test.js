'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const searchTargets = require('../src/browser/search-targets');

test('canonical target identity ignores presentation surface and occurrence order', () => {
  const id = searchTargets.targetId('query-key', 'event-1');
  assert.equal(id, searchTargets.targetId('query-key', 'event-1'));
  assert.notEqual(id, searchTargets.targetId('query-key', 'event-2'));
  assert.deepEqual(JSON.parse(id), ['query-key', 'event-1']);
});

test('canonical discovery deduplicates events and orders them by logical timeline position', () => {
  const result = searchTargets.discover([], 'key', [
    { id: 'later', timelineIndex: 8, hasSearchHit: true },
    { id: 'ignored', timelineIndex: 1, hasSearchHit: false },
    { id: 'earlier', timelineIndex: 2, hasSearchHit: true },
    { id: 'later', timelineIndex: 8, hasSearchHit: true },
  ]);
  assert.deepEqual(result.targets.map((target) => target.ownerId), ['earlier', 'later']);
  assert.deepEqual(result.addedIds, [
    searchTargets.targetId('key', 'later'),
    searchTargets.targetId('key', 'earlier'),
  ]);
});

test('binding replacement does not change membership or active identity', () => {
  const { targets } = searchTargets.discover([], 'key', [
    { id: 'event-1', timelineIndex: 1, hasSearchHit: true },
    { id: 'event-2', timelineIndex: 2, hasSearchHit: true },
  ]);
  const activeId = targets[1].id;
  const oldTimeline = { isConnected: true };
  const inspector = { isConnected: true };
  searchTargets.bind(targets[1], 'timeline', oldTimeline);
  searchTargets.bind(targets[1], 'inspector', inspector);
  assert.equal(searchTargets.activeIndex(targets, activeId), 1);

  searchTargets.resetBindings(targets);
  const replacement = { isConnected: true };
  searchTargets.bind(targets[1], 'timeline', replacement);
  assert.equal(searchTargets.liveBinding(targets[1], 'timeline'), replacement);
  assert.equal(searchTargets.activeIndex(targets, activeId), 1);
  assert.equal(targets.length, 2);
});

test('surface-local binding reset preserves target, order, and the other surface', () => {
  const { targets } = searchTargets.discover([], 'key', [
    { id: 'event-1', timelineIndex: 1, hasSearchHit: true },
    { id: 'event-2', timelineIndex: 2, hasSearchHit: true },
  ]);
  const target = targets[0];
  const otherTarget = targets[1];
  const timelineBinding = { isConnected: true };
  const inspectorBinding = { isConnected: true };
  const otherBinding = { isConnected: true };
  searchTargets.bind(target, 'timeline', timelineBinding);
  searchTargets.bind(target, 'inspector', inspectorBinding);
  searchTargets.bind(otherTarget, 'timeline', otherBinding);
  const originalTargets = [...targets];
  const originalInspectorBindings = target.bindings.inspector;
  const originalOtherBindings = otherTarget.bindings.timeline;

  assert.deepEqual(searchTargets.resetSurfaceBindings(target, 'timeline'), [timelineBinding]);
  assert.deepEqual(target.bindings.timeline, []);
  assert.equal(target.bindings.inspector, originalInspectorBindings);
  assert.deepEqual(target.bindings.inspector, [inspectorBinding]);
  assert.equal(otherTarget.bindings.timeline, originalOtherBindings);
  assert.deepEqual(otherTarget.bindings.timeline, [otherBinding]);
  assert.deepEqual(targets, originalTargets);
  assert.equal(searchTargets.resetSurfaceBindings(target, 'unknown'), null);
  assert.equal(searchTargets.resetSurfaceBindings(null, 'timeline'), null);
});

test('late discovery preserves active lookup after deterministic insertion', () => {
  const initial = searchTargets.discover([], 'key', [
    { id: 'event-2', timelineIndex: 2, hasSearchHit: true },
  ]).targets;
  const activeId = initial[0].id;
  const next = searchTargets.discover(initial, 'key', [
    { id: 'event-1', timelineIndex: 1, hasSearchHit: true },
  ]).targets;
  assert.equal(searchTargets.activeIndex(next, activeId), 1);
  assert.equal(next[1].id, activeId);
});

test('suffix discovery uses a canonical base index and preserves one-shot identity and order', () => {
  const events = [
    { id: 'event-0', hasSearchHit: false },
    { id: 'event-1', hasSearchHit: true },
    { id: 'event-2', hasSearchHit: true },
    { id: 'event-3', hasSearchHit: false },
    { id: 'event-4', hasSearchHit: true },
  ];
  const oneShot = searchTargets.discover([], 'key', events);
  const prefix = searchTargets.discover([], 'key', events.slice(0, 2));
  const prefixTarget = prefix.targets[0];
  const suffix = searchTargets.discover(prefix.targets, 'key', events.slice(2), {
    baseTimelineIndex: 2,
  });

  assert.deepEqual(
    suffix.targets.map(({ id, ownerId, timelineIndex }) => ({ id, ownerId, timelineIndex })),
    oneShot.targets.map(({ id, ownerId, timelineIndex }) => ({ id, ownerId, timelineIndex })),
  );
  assert.equal(suffix.targets.find((target) => target.id === prefixTarget.id), prefixTarget);
  assert.deepEqual(suffix.targets.map((target) => target.timelineIndex), [1, 2, 4]);
  assert.equal(new Set(suffix.targets.map((target) => target.id)).size, suffix.targets.length);
});

test('base index defaults to zero while explicit finite timeline indices win', () => {
  const legacy = searchTargets.discover([], 'key', [
    { id: 'event-a', hasSearchHit: true },
    { id: 'event-b', hasSearchHit: true },
  ]);
  assert.deepEqual(legacy.targets.map((target) => target.timelineIndex), [0, 1]);

  const offset = searchTargets.discover([], 'key', [
    { id: 'event-a', hasSearchHit: true },
    { id: 'event-b', timelineIndex: 7, hasSearchHit: true },
  ], { baseTimelineIndex: 20 });
  assert.deepEqual(offset.targets.map((target) => target.timelineIndex), [7, 20]);
});

test('discovery exhaustion and context reset are explicit', () => {
  assert.deepEqual(searchTargets.discoveryOutcome(['new-id'], false), { grew: true, exhausted: false });
  assert.deepEqual(searchTargets.discoveryOutcome([], true), { grew: false, exhausted: false });
  assert.deepEqual(searchTargets.discoveryOutcome([], false), { grew: false, exhausted: true });
  assert.notEqual(
    searchTargets.targetId('old-key', 'event-1'),
    searchTargets.targetId('new-key', 'event-1'),
  );
});
