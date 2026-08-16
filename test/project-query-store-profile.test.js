'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseArgs,
  publicOptions,
  runtimeCommand,
  timingStats,
} = require('../scripts/project-query-store-profile');

test('project query profile accepts bounded options and redacts every local path', () => {
  const options = parseArgs([
    '--source', 'claude',
    '--repo', 'private-project',
    '--source-home', 'private-home',
    '--repeats', '5',
  ]);
  assert.equal(options.source, 'claude-code');
  assert.equal(options.repeats, 5);
  assert.deepEqual(publicOptions(options), {
    source: 'claude-code',
    repo: '<redacted>',
    sourceHome: '<redacted>',
    repeats: 5,
  });
  assert.doesNotMatch(JSON.stringify(publicOptions(options)), /private-(?:project|home)/);
});

test('project query profile reports exact repeat count, median, and range', () => {
  assert.deepEqual(timingStats([9, 3, 7, 5]), {
    repeatCount: 4,
    medianMs: 6,
    minMs: 3,
    maxMs: 9,
  });
  assert.throws(
    () => parseArgs(['--source', 'codex', '--repo', '.', '--repeats', '21']),
    { code: 'INVALID_PROFILE_ARGUMENT' },
  );
  assert.equal(
    runtimeCommand(['--expose-gc', '--max-old-space-size=4096']),
    'node --expose-gc --max-old-space-size=4096 scripts/project-query-store-profile.js',
  );
});
