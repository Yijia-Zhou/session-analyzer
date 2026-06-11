'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const navigation = require('../src/browser/navigation');

test('search hits navigation category only appears for selected search hit events', () => {
  const events = [
    { id: 'user-1', kind: 'user_message', hasSearchHit: false, severity: 'normal' },
    { id: 'assistant-1', kind: 'assistant_message', hasSearchHit: true, severity: 'normal' },
    { id: 'command-1', kind: 'command', status: 'success', hasSearchHit: true, severity: 'normal' },
  ];

  const nonHitCategories = navigation.navigationCategoriesForEvent(events[0], events).map((category) => category.id);
  assert.equal(nonHitCategories.includes('search_hits'), false);

  const hitCategories = navigation.navigationCategoriesForEvent(events[1], events);
  const searchHitCategory = hitCategories.find((category) => category.id === 'search_hits');
  assert.ok(searchHitCategory);
  assert.deepEqual(searchHitCategory.matchesInResult.map((event) => event.id), ['assistant-1', 'command-1']);
});

test('navigation category helpers keep existing event categories', () => {
  const events = [
    { id: 'cmd-ok', kind: 'command', status: 'success', severity: 'normal' },
    { id: 'cmd-fail', kind: 'command', status: 'failed', severity: 'normal' },
    { id: 'plan', kind: 'other_tool_call', toolName: 'update_plan', severity: 'normal' },
  ];

  const failedCommandCategories = navigation.navigationCategoriesForEvent(events[1], events).map((category) => category.id);
  assert.ok(failedCommandCategories.includes('failed_commands'));
  assert.ok(failedCommandCategories.includes('commands'));
  assert.ok(failedCommandCategories.includes('errors_warnings'));

  const planCategories = navigation.navigationCategoriesForEvent(events[2], events).map((category) => category.id);
  assert.ok(planCategories.includes('update_plan'));
  assert.ok(planCategories.includes('plans'));
});
