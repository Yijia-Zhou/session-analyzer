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

test('discovery exhaustion and context reset are explicit', () => {
  assert.deepEqual(searchTargets.discoveryOutcome(['new-id'], false), { grew: true, exhausted: false });
  assert.deepEqual(searchTargets.discoveryOutcome([], true), { grew: false, exhausted: false });
  assert.deepEqual(searchTargets.discoveryOutcome([], false), { grew: false, exhausted: true });
  assert.notEqual(
    searchTargets.targetId('old-key', 'event-1'),
    searchTargets.targetId('new-key', 'event-1'),
  );
});
