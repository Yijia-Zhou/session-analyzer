'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  parseArgs,
  recentSessions,
  simulateCandidateTriggers,
} = require('../scripts/materialized-session-cache-profile');

test('materialized cache profile parses bounded content-free options', () => {
  const options = parseArgs(['--source', 'codex', '--repo', '.']);
  assert.equal(options.source, 'codex');
  assert.equal(options.repo, path.resolve('.'));
  assert.equal(options.sourceHome, '');
  assert.equal(options.maxOpens, 24);
  assert.throws(
    () => parseArgs(['--source', 'codex', '--repo', '.', '--max-opens', '41']),
    /--max-opens must be an integer from 1 through 40/,
  );
});

test('materialized cache profile recent ordering is stable for equal timestamps', () => {
  const sessions = [
    { id: 'equal-a', updatedAt: '2026-08-20T00:00:00.000Z' },
    { id: 'equal-b', updatedAt: '2026-08-20T00:00:00.000Z' },
    { id: 'newest', updatedAt: '2026-08-21T00:00:00.000Z' },
  ];
  assert.deepEqual(recentSessions({ sessions }).map((session) => session.id), [
    'newest',
    'equal-a',
    'equal-b',
  ]);
});

test('materialized cache profile reports independent byte and count trigger ordinals', () => {
  const small = Array.from({ length: 13 }, (_, index) => ({
    id: `small-${index}`,
    bytes: 0,
    rawEventCount: 0,
    logicalEventCount: 0,
  }));
  const countDominated = simulateCandidateTriggers(small);
  assert.equal(countDominated.countTriggerOrdinal, 13);
  assert.equal(countDominated.byteTriggerOrdinal, null);
  assert.equal(countDominated.dominantTrigger, 'count');

  const byteDominated = simulateCandidateTriggers([
    {
      id: 'larger-than-budget',
      bytes: 256 * 1024 * 1024,
      rawEventCount: 0,
      logicalEventCount: 0,
    },
    ...small,
  ]);
  assert.equal(byteDominated.byteTriggerOrdinal, 1);
  assert.equal(byteDominated.countTriggerOrdinal, 13);
  assert.equal(byteDominated.dominantTrigger, 'bytes');

  const byteOnly = simulateCandidateTriggers([
    {
      id: 'only-larger-than-budget',
      bytes: 256 * 1024 * 1024,
      rawEventCount: 0,
      logicalEventCount: 0,
    },
  ]);
  assert.equal(byteOnly.byteTriggerOrdinal, 1);
  assert.equal(byteOnly.countTriggerOrdinal, null);
  assert.equal(byteOnly.dominantTrigger, 'bytes');
});
