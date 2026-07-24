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

test('temporary referenced events are revealed beside their source without mutating filtered results', () => {
  const events = [
    { id: 'operation', kind: 'other_tool_call' },
    { id: 'next', kind: 'assistant_message' },
  ];
  const referenced = { id: 'nested-failure', kind: 'command', status: 'failed' };

  const revealed = navigation.withTemporaryEventReveal(events, {
    sourceEventId: 'operation',
    event: referenced,
  });
  assert.deepEqual(revealed.map((event) => event.id), ['operation', 'nested-failure', 'next']);
  assert.deepEqual(events.map((event) => event.id), ['operation', 'next']);
  assert.equal(navigation.withTemporaryEventReveal(revealed, { event: referenced }), revealed);
});

test('temporary reference detail history returns to source with synchronized selection and removes target', () => {
  const source = { id: 'operation', kind: 'other_tool_call' };
  const target = { id: 'nested-failure', kind: 'command', status: 'failed' };
  const filteredEvents = [source];
  const reveal = { sourceEventId: source.id, event: target };
  const targetState = navigation.reconcileTemporaryEventReveal({
    reveal,
    detailView: { type: 'inspector', eventId: target.id },
    history: [{ type: 'inspector', eventId: source.id }],
  });
  assert.equal(targetState.selectedEventId, target.id);
  assert.equal(targetState.reveal, reveal);
  assert.deepEqual(navigation.withTemporaryEventReveal(filteredEvents, targetState.reveal).map((event) => event.id), [source.id, target.id]);

  const backState = navigation.reconcileTemporaryEventReveal({
    reveal: targetState.reveal,
    detailView: targetState.history[0],
    history: [],
  });
  assert.equal(backState.selectedEventId, source.id);
  assert.equal(backState.reveal, null);
  assert.deepEqual(backState.history, []);
  assert.deepEqual(navigation.withTemporaryEventReveal(filteredEvents, backState.reveal).map((event) => event.id), [source.id]);
});

test('leaving a temporary target for another event or profile removes stale target history', () => {
  const reveal = { sourceEventId: 'source', event: { id: 'temporary-target' } };
  for (const detailView of [
    { type: 'inspector', eventId: 'ordinary-event' },
    { type: 'profileRules' },
  ]) {
    const result = navigation.reconcileTemporaryEventReveal({
      reveal,
      detailView,
      history: [
        { type: 'inspector', eventId: 'source' },
        { type: 'inspector', eventId: 'temporary-target' },
      ],
    });
    assert.equal(result.reveal, null);
    assert.equal(result.selectedEventId, detailView.eventId || '');
    assert.deepEqual(result.history.map((view) => view.eventId), ['source']);
  }
});

test('enclosing operation affordance is gated by presentation relevance without translating relation data', () => {
  const nested = {
    id: 'nested',
    presentationContext: {
      relation: 'enclosed_by_code_mode_operation',
      codeModeParentId: 'parent',
    },
  };
  assert.equal(navigation.enclosingOperationParentId(nested), 'parent');
  assert.equal(navigation.shouldShowEnclosingOperationAffordance(nested, 'collapsed', {}), false);
  assert.equal(navigation.shouldShowEnclosingOperationAffordance(nested, 'collapsed', { status: 'failed' }), true);
  assert.equal(navigation.shouldShowEnclosingOperationAffordance(nested, 'collapsed', {}, 'nested'), true);
  assert.equal(navigation.shouldShowEnclosingOperationAffordance(nested, 'expanded', {}), true);
  assert.equal(navigation.enclosingOperationParentId({ presentationContext: { relation: '其它关系', codeModeParentId: 'parent' } }), '');
});

test('context reveal reconciliation keeps a distinct source slot while structural context changes invalidate it', () => {
  const source = {
    id: 'nested',
    presentationContext: { relation: 'enclosed_by_code_mode_operation', codeModeParentId: 'parent' },
  };
  const reveal = {
    sessionId: 'session',
    layerId: 'main',
    dataContext: 'context-a',
    foldingContext: 'profile-a',
    detailGeneration: 3,
    sourceEventId: 'nested',
    parentEventId: 'parent',
    parentEvent: { id: 'parent' },
  };
  assert.equal(navigation.contextRevealSourceIndex([source], reveal), 0);
  assert.equal(navigation.reconcileContextReveal({
    reveal,
    sessionId: 'session',
    layerId: 'main',
    dataContext: 'context-a',
    foldingContext: 'profile-a',
    detailGeneration: 3,
    events: [source],
  }), reveal);
  assert.equal(navigation.reconcileContextReveal({
    reveal,
    sessionId: 'session',
    layerId: 'main',
    dataContext: 'context-b',
    foldingContext: 'profile-a',
    detailGeneration: 3,
    events: [source],
  }), null);
  assert.equal(navigation.reconcileContextReveal({
    reveal,
    sessionId: 'session',
    layerId: 'main',
    dataContext: 'context-a',
    foldingContext: 'profile-b',
    detailGeneration: 3,
    events: [source],
  }), null);
  assert.equal(navigation.reconcileContextReveal({
    reveal,
    sessionId: 'session',
    layerId: 'main',
    dataContext: 'context-a',
    foldingContext: 'profile-a',
    detailGeneration: 4,
    events: [source],
  }), null);
  assert.equal(navigation.reconcileContextReveal({
    reveal,
    sessionId: 'session',
    layerId: 'main',
    dataContext: 'context-a',
    events: [{ ...source, presentationContext: { ...source.presentationContext, codeModeParentId: 'other' } }],
  }), null);
});
