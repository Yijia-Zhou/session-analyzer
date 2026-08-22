'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseArgs,
  publicOptions,
  runtimeCommand,
  selectMaterializationCandidates,
  timingStats,
} = require('../scripts/project-query-store-profile');
const lifecycleComparison = require('../scripts/cold-session-lifecycle-comparison');

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

test('materialization profile selects deterministic decile, median, and maximum classes', () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    id: `session-${String(index + 1).padStart(2, '0')}`,
    bytes: (index + 1) * 100,
  }));
  const selected = selectMaterializationCandidates(sessions);
  assert.equal(selected.candidateCount, 10);
  assert.deepEqual(
    Object.fromEntries(
      ['small', 'medium', 'large', 'largest'].map((name) => [
        name,
        { ordinal: selected[name].ordinal, bytes: selected[name].session.bytes },
      ]),
    ),
    {
      small: { ordinal: 1, bytes: 100 },
      medium: { ordinal: 5, bytes: 500 },
      large: { ordinal: 9, bytes: 900 },
      largest: { ordinal: 10, bytes: 1000 },
    },
  );
  assert.equal(selectMaterializationCandidates([{ id: 'empty', bytes: 0 }]), null);
});

test('controlled lifecycle comparison accepts only bounded content-free fixture options', () => {
  assert.deepEqual(
    lifecycleComparison.parseArgs([
      '--pre-root', '.',
      '--event-count', '2400',
      '--text-bytes', '4096',
      '--warm-repeats', '5',
    ]),
    {
      preRoot: require('node:path').resolve('.'),
      eventCount: 2400,
      textBytes: 4096,
      warmRepeats: 5,
    },
  );
  assert.throws(
    () => lifecycleComparison.parseArgs(['--pre-root', '.', '--warm-repeats', '11']),
    { code: 'INVALID_PROFILE_ARGUMENT' },
  );
  for (const args of [
    ['--pre-root', '.', '--event-count', '20001'],
    ['--pre-root', '.', '--text-bytes', '65537'],
    ['--pre-root', '.', '--event-count', '2000', '--text-bytes', '40000'],
  ]) {
    assert.throws(
      () => lifecycleComparison.parseArgs(args),
      { code: 'INVALID_PROFILE_ARGUMENT' },
    );
  }
});
