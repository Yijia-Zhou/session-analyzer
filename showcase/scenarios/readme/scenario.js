'use strict';

// Human-authored canonical story. The materializer turns this compact model into
// real Codex JSONL records; do not put absolute paths or machine-specific data here.
// derivedKind is consumed by the materializer for derived provenance metadata.

const patch = (files, output = 'Patch applied.') => ({
  type: 'patch',
  files,
  output,
});

const command = (commandText, output, options = {}) => ({
  type: 'command',
  command: commandText,
  output,
  status: options.status || 'success',
  stderr: options.stderr || '',
  exitCode: options.exitCode == null ? (options.status === 'failed' ? 1 : 0) : options.exitCode,
});

// Readable synthetic snapshots, not a replay of a real task-board session.
const navigationSource = `export function materializeSearchTarget(match) {
  return {
    sessionId: match.sessionId,
    eventId: match.eventId,
  };
}

export function searchMatchCount(matches) {
  return matches.length;
}
`;
const testSource = `import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeSearchTarget, searchMatchCount } from '../../src/browser/search-navigation.js';

const match = { sessionId: 'session-b', eventId: 'event-7', event: { id: 'event-7' } };
test('search-navigation counts no matches', () => assert.equal(searchMatchCount([]), 0));
test('search-navigation counts one match', () => assert.equal(searchMatchCount([match]), 1));
test('search-navigation counts repeated occurrences', () => assert.equal(searchMatchCount([match, match]), 2));
test('search-navigation keeps the session ID', () => assert.equal(materializeSearchTarget(match).sessionId, 'session-b'));
test('search-navigation keeps the event ID', () => assert.equal(materializeSearchTarget(match).eventId, 'event-7'));
test('search-navigation creates a separate target', () => assert.notEqual(materializeSearchTarget(match), match));
test('search-navigation leaves the match unchanged', () => {
  const before = structuredClone(match);
  materializeSearchTarget(match);
  assert.deepEqual(match, before);
});
test('search-navigation leaves the match list unchanged', () => {
  const matches = [match];
  searchMatchCount(matches);
  assert.deepEqual(matches, [match]);
});
test('search-navigation accepts another session', () => assert.equal(materializeSearchTarget({ ...match, sessionId: 'session-c' }).sessionId, 'session-c'));
test('search-navigation accepts another event', () => assert.equal(materializeSearchTarget({ ...match, eventId: 'event-8' }).eventId, 'event-8'));
test('search-navigation returns a numeric count', () => {
  assert.equal(typeof searchMatchCount([match]), 'number');
});
`;
const regressionTest = `test('search-navigation materializes the next search target', () => {
  const target = materializeSearchTarget(match);
  assert.ok(target.event, 'Expected next search target to be materialized');
  assert.equal(target.event.id, target.eventId);
  assert.equal(target.selected, true);
});
`;
const firstNavigationSource = navigationSource.replace(
  '    eventId: match.eventId,', '    eventId: match.eventId,\n    selected: true,',
);
const testNames = [
  'counts no matches', 'counts one match', 'counts repeated occurrences',
  'keeps the session ID', 'keeps the event ID', 'creates a separate target',
  'leaves the match unchanged', 'leaves the match list unchanged',
  'accepts another session', 'accepts another event', 'returns a numeric count',
  'materializes the next search target',
];
// Node spec-reporter layout adapted from the isolated video probe. Timings and
// suite totals remain authored; this is not evidence of an executed full story.
const suiteOutput = (failed) => [
  ...testNames.map((name, index) => `${failed && index === 11 ? '✖' : '✔'} search-navigation ${name} (1.0ms)`),
  'ℹ tests 12', 'ℹ suites 0', `ℹ pass ${failed ? 11 : 12}`, `ℹ fail ${failed ? 1 : 0}`,
  'ℹ cancelled 0', 'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 100.0',
  ...(failed ? [
    '', '✖ failing tests:', '',
    'test at test/browser/search-navigation.test.js:27:1',
    '✖ search-navigation materializes the next search target (1.0ms)',
    '  AssertionError [ERR_ASSERTION]: Expected next search target to be materialized',
    '      at TestContext.<anonymous> (test/browser/search-navigation.test.js:29:10) {',
    '    generatedMessage: false,', "    code: 'ERR_ASSERTION',", '    actual: undefined,',
    '    expected: true,', "    operator: '==',", "    diff: 'simple'", '  }',
  ] : []),
].join('\n');

const canonical = {
  version: 1,
  project: {
    displayName: 'acme/task-board',
    relativePath: ['workspace', 'acme', 'task-board'],
    files: {
      'package.json': '{\n  "name": "@acme/task-board",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "test": "node --test --test-reporter=spec --test-name-pattern",\n    "build:check": "node scripts/check-build.js"\n  }\n}\n',
      'src/browser/app.js': '// Synthetic search entry; callers open target.event in the selected session.\nexport { materializeSearchTarget, searchMatchCount } from "./search-navigation.js";\n',
      'src/browser/search-navigation.js': navigationSource,
      'test/browser/search-navigation.test.js': testSource,
    },
  },
  sessions: [
    {
      key: 'parent',
      title: 'Add project-wide search navigation',
      date: '2026-08-12',
      time: '2026-08-12T09-00-00',
      id: '11111111-1111-4111-8111-111111111111',
      events: [
        {
          type: 'user',
          turn: 'turn-1',
          text: 'Add project-wide search navigation so I can find a file or command across this repository and jump into the exact work item.',
        },
        {
          type: 'plan',
          turn: 'turn-1',
          explanation: 'Trace the existing search flow, make match targets stable, add a regression test, then rerun the focused checks.',
          steps: [
            ['Trace the existing search flow', 'in_progress'],
            ['Make match targets stable', 'pending'],
            ['Add a regression test', 'pending'],
            ['Run focused checks', 'pending'],
          ],
        },
        command(
          'rg -n "export function" src/browser/search-navigation.js',
          '1:export function materializeSearchTarget(match) {\n8:export function searchMatchCount(matches) {',
        ),
        command(
          "sed -n '1,80p' src/browser/app.js src/browser/search-navigation.js test/browser/search-navigation.test.js",
          '// Synthetic search entry; callers open target.event in the selected session.\nexport { materializeSearchTarget, searchMatchCount } from "./search-navigation.js";\n' + navigationSource + testSource,
        ),
        patch({
          'src/browser/search-navigation.js': {
            type: 'update',
            unified_diff: '@@ -1,6 +1,7 @@\n export function materializeSearchTarget(match) {\n   return {\n     sessionId: match.sessionId,\n     eventId: match.eventId,\n+    selected: true,\n   };\n }',
          },
          'test/browser/search-navigation.test.js': {
            type: 'update',
            unified_diff: '@@ -26,1 +26,7 @@\n ' + testSource.trimEnd().split('\n').at(-1) + '\n' + regressionTest.trimEnd().split('\n').map((line) => '+' + line).join('\n'),
          },
        }, 'Patch applied; targets retain their IDs and selection state; regression test added.'),
        command(
          'npm test -- search-navigation',
          suiteOutput(true),
          { status: 'failed', exitCode: 1 },
        ),
        command(
          "sed -n '1,11p' src/browser/search-navigation.js; sed -n '27,32p' test/browser/search-navigation.test.js",
          firstNavigationSource + regressionTest,
        ),
        patch({
          'src/browser/search-navigation.js': {
            type: 'update',
            unified_diff: '@@ -3,5 +3,6 @@\n     sessionId: match.sessionId,\n     eventId: match.eventId,\n     selected: true,\n+    event: match.event,\n   };\n }',
          },
        }, 'Patch applied; the jump target is materialized before navigation advances.'),
        command(
          'npm test -- search-navigation',
          suiteOutput(false),
        ),
        {
          type: 'assistant',
          turn: 'turn-1',
          text: 'Search navigation is now repository-scoped and traceable. The missing event was fixed after inspecting the failed assertion. 12 tests passed.',
        },
      ],
    },
    {
      key: 'stale-rows',
      title: 'Fix stale project rows after source switch',
      date: '2026-08-11',
      time: '2026-08-11T16-20-00',
      id: '22222222-2222-4222-8222-222222222222',
      events: [
        { type: 'user', turn: 'turn-1', text: 'Fix stale project rows after switching transcript sources.' },
        command('npm test -- project-switch', 'Project switch suite\n8 tests passed'),
        { type: 'assistant', turn: 'turn-1', text: 'Project rows now refresh from the active transcript source.' },
      ],
    },
    {
      key: 'count-review',
      title: 'Review search count navigation',
      date: '2026-08-11',
      time: '2026-08-11T13-40-00',
      id: '33333333-3333-4333-8333-333333333333',
      events: [
        { type: 'user', turn: 'turn-1', text: 'Review the search count and next-match navigation behavior.' },
        command('npm test -- search-count', 'Search count suite\n10 tests passed'),
        { type: 'assistant', turn: 'turn-1', text: 'The count and jump feedback agree on the same set of targets.' },
      ],
    },
    {
      key: 'relationship-display',
      title: 'Improve fork relationship display',
      date: '2026-08-10',
      time: '2026-08-10T18-05-00',
      id: '44444444-4444-4444-8444-444444444444',
      events: [
        { type: 'user', turn: 'turn-1', text: 'Improve the way parent and derived session relationships appear in the history list.' },
        command('npm test -- relationships', 'Relationship display suite\n7 tests passed'),
        { type: 'assistant', turn: 'turn-1', text: 'Relationship labels stay attached to the relevant repository history.' },
      ],
    },
    {
      key: 'browser-coverage',
      title: 'Update browser regression coverage',
      date: '2026-08-10',
      time: '2026-08-10T11-15-00',
      id: '55555555-5555-4555-8555-555555555555',
      events: [
        { type: 'user', turn: 'turn-1', text: 'Update browser regression coverage for timeline selection and detail loading.' },
        command('npm run build:check', 'Build check passed'),
        { type: 'assistant', turn: 'turn-1', text: 'The browser regression coverage now protects the readable timeline path.' },
      ],
    },
    {
      key: 'subagent-child',
      title: 'Write search navigation usage examples',
      date: '2026-08-12',
      time: '2026-08-12T09-05-00',
      id: '66666666-6666-4666-8666-666666666666',
      derivedFrom: 'parent',
      materializedFrom: 'parent',
      derivedKind: 'subagent',
      agentNickname: 'Docs',
      events: [
        { type: 'user', turn: 'docs-turn-1', text: 'Write usage examples for project-wide search navigation. Use the inherited implementation context to explain finding a match and opening its event.' },
        { type: 'assistant', turn: 'docs-turn-1', text: 'I will use the inherited search flow and test context to draft examples for finding a match, opening its event, and moving to the next result.' },
      ],
    },
  ],
};

module.exports = canonical;
