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

const canonical = {
  version: 1,
  project: {
    displayName: 'acme/task-board',
    relativePath: ['workspace', 'acme', 'task-board'],
    files: {
      'package.json': '{\n  "name": "@acme/task-board",\n  "private": true,\n  "scripts": {\n    "test": "node --test",\n    "build:check": "node scripts/check-build.js"\n  }\n}\n',
      'src/browser/app.js': '// Synthetic showcase source for the repository-scoped history.\n',
      'src/browser/search-navigation.js': 'export function materializeSearchTarget() {}\nexport function searchMatchCount() {}\n',
      'test/browser/search-navigation.test.js': 'test(\'search navigation preserves the selected match\', () => {});\n',
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
            ['Trace the existing search flow', 'completed'],
            ['Make match targets stable', 'completed'],
            ['Add a regression test', 'completed'],
            ['Run focused checks', 'in_progress'],
          ],
        },
        command(
          'rg -n "searchMatchCount|materializeSearchTarget" src/browser/search-navigation.js test/browser/search-navigation.test.js',
          'src/browser/search-navigation.js:18: export function materializeSearchTarget\ntest/browser/search-navigation.test.js:7: preserves the selected match',
        ),
        patch({
          'src/browser/search-navigation.js': {
            type: 'update',
            unified_diff: '@@ -18,3 +18,8 @@\n export function materializeSearchTarget() {\n+  return registerSearchMatch(target);\n }\n+\n+export function searchMatchCount(matches) {\n+  return matches.length;\n+}',
          },
          'test/browser/search-navigation.test.js': {
            type: 'update',
            unified_diff: '@@ -1,1 +1,7 @@\n+test(\'search navigation preserves the selected match\', () => {\n+  assert.equal(searchMatchCount([\'file\']), 1);\n+  assert.equal(materializeSearchTarget(\'file\').selected, true);\n+});',
          },
        }, 'Patch applied; search targets now keep their selected event.'),
        command(
          'npm test -- search-navigation',
          'Focused search navigation suite\nExpected next search target to be materialized',
          { status: 'failed', stderr: 'Expected next search target to be materialized', exitCode: 1 },
        ),
        patch({
          'src/browser/search-navigation.js': {
            type: 'update',
            unified_diff: '@@ -22,2 +22,4 @@\n export function searchMatchCount(matches) {\n-  return matches.length;\n+  const target = materializeSearchTarget(matches[0]);\n+  return { count: matches.length, target };\n }',
          },
        }, 'Patch applied; the jump target is materialized before navigation advances.'),
        command(
          'npm test -- search-navigation',
          'Focused search navigation suite\n12 tests passed',
        ),
        {
          type: 'assistant',
          turn: 'turn-1',
          text: 'Search navigation is now repository-scoped and traceable. The regression covered the failed jump, the follow-up fix, and the passing focused suite.',
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
      key: 'review-child',
      title: 'Review search navigation implementation',
      date: '2026-08-12',
      time: '2026-08-12T09-05-00',
      id: '66666666-6666-4666-8666-666666666666',
      derivedFrom: 'parent',
      materializedFrom: 'parent',
      derivedKind: 'review',
      agentNickname: 'Review',
      events: [
        { type: 'user', turn: 'review-turn-1', text: 'Review the search navigation implementation and report any release-blocking findings.' },
        { type: 'assistant', turn: 'review-turn-1', text: 'The inherited search-navigation context is available here; I will check the jump target and focused test result.' },
      ],
    },
  ],
};

module.exports = canonical;
