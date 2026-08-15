'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectStructuredDetailFacts,
  filterInspectorMetadata,
} = require('../src/browser/detail-presentation');

test('structured Inspector facts come from machine payload shapes rather than titles', () => {
  const sections = [
    {
      purpose: 'context',
      type: 'kv',
      title: 'Arbitrary localized title',
      entries: [
        { key: 'tool', value: 'shell_command', fact: 'tool' },
        { key: 'durationMs', value: '250', fact: 'duration' },
      ],
    },
    {
      purpose: 'context',
      type: 'patch',
      title: 'Changed resources',
      files: [{ path: 'src/app.js', hunks: [] }],
    },
    {
      purpose: 'content',
      type: 'code_mode_tool_projection',
      title: 'Atomic operation',
      toolName: 'update_plan',
      requestSections: [],
      resultSections: [],
    },
  ];
  const facts = collectStructuredDetailFacts(sections);

  assert.equal(facts.toolNames.has('shell_command'), true);
  assert.equal(facts.durations.has('250'), true);
  assert.equal(facts.filePaths.has('src/app.js'), true);
  assert.equal(facts.toolNames.has('update_plan'), true);
  assert.equal(facts.providers.has('Arbitrary localized title'), false);
});

test('Inspector metadata keeps common facts after detail and removes only authoritative duplicates', () => {
  const sections = [{
    purpose: 'context',
    type: 'kv',
    title: 'Localized context',
    entries: [
      { key: 'tool', value: 'shell_command', fact: 'tool' },
      { key: 'durationMs', value: '250', fact: 'duration' },
      { key: 'src/app.js', value: 'updated', fact: 'touchedFile' },
    ],
  }];
  const items = [
    { id: 'time', value: '2026-08-15 10:00' },
    { id: 'tool', value: 'shell_command' },
    { id: 'duration', value: '250 ms', aliases: ['250'] },
    { id: 'touchedFiles', value: 'src/app.js', sourceValues: ['src/app.js'] },
    { id: 'provider', value: 'OpenAI' },
  ];

  assert.deepEqual(
    filterInspectorMetadata(items, sections).map((item) => item.id),
    ['time', 'provider'],
  );
});

test('Inspector metadata is not hidden by scalar collisions in unrelated KV entries', () => {
  const sections = [{
    purpose: 'request',
    type: 'kv',
    title: 'Request',
    entries: [
      { key: 'note', value: 'OpenAI' },
      { key: 'retries', value: '0' },
      { key: 'timeout', value: '250' },
    ],
  }];
  const items = [
    { id: 'provider', value: 'OpenAI' },
    { id: 'exitCode', value: '0' },
    { id: 'duration', value: '250 ms', aliases: ['250'] },
  ];

  assert.deepEqual(filterInspectorMetadata(items, sections), items);
});

test('Inspector metadata does not deduplicate against prose, titles, Raw JSON, or other-event references', () => {
  const sections = [
    { purpose: 'content', type: 'markdown', title: 'OpenAI', html: '<p>shell_command</p>' },
    { purpose: 'fallback', type: 'raw_json', title: 'Raw JSON', value: { provider: 'OpenAI' } },
    {
      purpose: 'traceability',
      type: 'event_refs',
      title: 'Other events',
      items: [{ id: 'event-2', label: 'shell_command', kind: 'tool', status: 'completed' }],
    },
  ];
  const items = [
    { id: 'tool', value: 'shell_command' },
    { id: 'provider', value: 'OpenAI' },
  ];

  assert.deepEqual(filterInspectorMetadata(items, sections), items);
});
