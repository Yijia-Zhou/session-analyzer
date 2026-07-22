'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_PROFILE_EVENT_COUNT,
  MIN_PROFILE_TEXT_BYTES,
  MAX_PROFILE_TEXT_BYTES,
  parseArgs,
} = require('../scripts/timeline-profile');

test('timeline profile accepts only corpus sizes that satisfy its fixed late-hit scenarios', () => {
  assert.equal(MIN_PROFILE_EVENT_COUNT, 1651);
  assert.equal(parseArgs([]).eventCount, undefined);
  assert.equal(parseArgs(['--event-count', '1651']).eventCount, 1651);
  assert.equal(parseArgs(['--event-count', '1800']).eventCount, 1800);

  for (const value of ['1650', '1000', '1.5', 'Infinity', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--event-count', value]),
      /--event-count must be an integer greater than or equal to 1651/,
    );
  }
  assert.throws(
    () => parseArgs(['--event-count']),
    /--event-count must be an integer greater than or equal to 1651/,
  );
});

test('timeline profile accepts only bounded finite integer text payload sizes', () => {
  assert.equal(MIN_PROFILE_TEXT_BYTES, 256);
  assert.equal(MAX_PROFILE_TEXT_BYTES, 65536);
  assert.equal(parseArgs(['--text-bytes', '256']).searchableTextBytes, 256);
  assert.equal(parseArgs(['--text-bytes', '3700']).searchableTextBytes, 3700);
  assert.equal(parseArgs(['--text-bytes', '65536']).searchableTextBytes, 65536);

  for (const value of ['255', '1.5', '65537', 'Infinity', '1e309', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--text-bytes', value]),
      /--text-bytes must be an integer from 256 to 65536/,
    );
  }
  assert.throws(
    () => parseArgs(['--text-bytes']),
    /--text-bytes must be an integer from 256 to 65536/,
  );
});
