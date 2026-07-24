'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const folding = require('../src/shared/folding');
const { foldingProfiles } = require('../src/folding');

function profileRules(id) {
  return foldingProfiles.find((profile) => profile.id === id).rules;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('display states have a fixed most-visible priority', () => {
  assert.deepEqual(folding.DISPLAY_STATE_PRIORITY, {
    hidden: 0,
    collapsed: 1,
    summary: 2,
    expanded: 3,
  });
  assert.deepEqual(folding.CONDITION_DISPLAY_STATES, ['expanded', 'summary', 'collapsed']);
  const event = { kind: 'patch', touchedFiles: ['public/app.js'], severity: 'normal' };
  assert.equal(folding.displayStateFromRules(event, {
    kindStates: { patch: 'collapsed' },
    fallback: 'hidden',
    conditions: [{ id: 'touchedFiles', state: 'summary' }, { id: 'importantEvent', state: 'expanded' }],
  }), 'expanded');
});

test('changes profile keeps successful and failed patches with files expanded', () => {
  const rules = profileRules('changes');
  assert.equal(folding.displayStateFromRules({ kind: 'patch', status: 'success', touchedFiles: ['a.js'], severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'patch', status: 'failed', touchedFiles: ['a.js'], severity: 'normal' }, rules), 'expanded');
});

test('changes profile collapses ordinary touched-file events', () => {
  assert.equal(folding.displayStateFromRules({
    kind: 'other_tool_call',
    touchedFiles: ['a.js'],
    severity: 'normal',
  }, profileRules('changes')), 'collapsed');
});

test('changes profile collapses failed events even without touched files', () => {
  assert.equal(folding.displayStateFromRules({
    kind: 'mcp_call',
    status: 'failed',
    severity: 'normal',
  }, profileRules('changes')), 'collapsed');
});

test('changes profile recognizes common verification commands', () => {
  const rules = profileRules('changes');
  for (const preview of ['pytest -q', 'npx eslint .', 'node --check public/app.js', 'cargo clippy', 'go vet ./...']) {
    assert.equal(folding.displayStateFromRules({ kind: 'command', preview, severity: 'normal' }, rules), 'summary', preview);
  }
  assert.equal(folding.displayStateFromRules({ kind: 'command', preview: 'node server.js', severity: 'normal' }, rules), 'hidden');
});

test('narrative profile collapses ordinary high-frequency tool events', () => {
  const rules = profileRules('narrative');
  for (const kind of ['command', 'mcp_call', 'js_repl', 'other_tool_call', 'web_search']) {
    assert.equal(folding.displayStateFromRules({ kind, status: 'success', severity: 'normal' }, rules), 'collapsed', kind);
  }
  assert.equal(folding.displayStateFromRules({ kind: 'hook', status: 'completed', severity: 'normal' }, rules), 'summary');
  assert.equal(folding.displayStateFromRules({ kind: 'developer_message', severity: 'normal' }, rules), 'expanded');
});

test('matching condition order does not change the most visible result', () => {
  const event = { kind: 'other_tool_call', hasSearchHit: true, severity: 'error' };
  const conditions = [
    { id: 'searchHit', state: 'expanded' },
    { id: 'importantEvent', state: 'collapsed' },
  ];
  const rules = { kindStates: {}, fallback: 'hidden', conditions };
  assert.equal(folding.displayStateFromRules(event, rules), 'expanded');
  assert.equal(folding.displayStateFromRules(event, { ...rules, conditions: [...conditions].reverse() }), 'expanded');
});

test('fallback applies only when neither a kind nor condition rule matches', () => {
  const rules = {
    kindStates: { command: 'collapsed' },
    fallback: 'hidden',
    conditions: [{ id: 'failedStatus', state: 'expanded' }],
  };
  assert.equal(folding.displayStateFromRules({ kind: 'command', status: 'success' }, rules), 'collapsed');
  assert.equal(folding.displayStateFromRules({ kind: 'command', status: 'failed' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'reasoning', status: 'success' }, rules), 'hidden');
});

test('rule normalization rejects invalid conditions and stabilizes duplicates', () => {
  assert.deepEqual(plain(folding.normalizeRules({
    kindStates: { patch: 'expanded', bad: 'invalid' },
    fallback: 'invalid',
    conditions: [
      { id: 'failedStatus', state: 'summary' },
      { id: 'unknown', state: 'expanded' },
      { id: 'searchHit', state: 'collapsed' },
      { id: 'failedStatus', state: 'expanded' },
      { id: 'touchedFiles', state: 'collapsed' },
      { id: 'searchHit', state: 'summary' },
    ],
  })), {
    kindStates: { patch: 'expanded' },
    fallback: 'summary',
    conditions: [
      { id: 'searchHit', state: 'summary' },
      { id: 'failedStatus', state: 'expanded' },
      { id: 'touchedFiles', state: 'collapsed' },
    ],
  });
});

test('planning condition matches update_plan calls and protocol plan updates', () => {
  assert.equal(folding.conditionMatches('updatePlanCall', { kind: 'other_tool_call', toolName: 'update_plan' }), true);
  assert.equal(folding.conditionMatches('updatePlanCall', { kind: 'plan_update' }), true);
  assert.equal(folding.displayStateFromRules({ kind: 'plan_update', severity: 'normal' }, profileRules('planning')), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'other_tool_call', toolName: 'update_plan', severity: 'normal' }, profileRules('planning')), 'expanded');
});

test('Code Mode folding condition matches only the canonical operation subtype', () => {
  const codeModeOperation = {
    kind: 'other_tool_call',
    subtype: 'code_mode_operation',
    toolName: 'exec',
    presentation: { variant: 'single_tool', toolName: 'update_plan' },
  };
  assert.equal(folding.conditionMatches('codeModeOperation', codeModeOperation), true);
  assert.equal(folding.conditionMatches('updatePlanCall', codeModeOperation), false);
  assert.equal(folding.conditionMatches('userInputRequest', codeModeOperation), false);
  assert.equal(folding.conditionMatches('codeModeOperation', {
    kind: 'other_tool_call',
    subtype: 'update_plan',
    toolName: 'update_plan',
  }), false);
  assert.equal(folding.conditionMatches('codeModeOperation', {
    kind: 'other_tool_call',
    subtype: 'request_user_input',
    toolName: 'request_user_input',
  }), false);
  assert.ok(folding.CONDITION_DEFINITIONS.some((condition) => condition.id === 'codeModeOperation'));
});

test('planning profile expands only planning anchors and collapses known non-planning events', () => {
  const rules = profileRules('planning');
  assert.equal(folding.displayStateFromRules({ kind: 'proposed_plan', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'goal', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'other_tool_call', toolName: 'update_plan', severity: 'normal' }, rules), 'expanded');
  for (const kind of ['user_message', 'assistant_message', 'patch', 'command', 'developer_message', 'review', 'compaction', 'user_shell_command']) {
    assert.equal(folding.displayStateFromRules({ kind, severity: 'normal' }, rules), 'collapsed', kind);
  }
  assert.equal(folding.displayStateFromRules({ kind: 'future_event_kind', severity: 'normal' }, rules), 'hidden');
});

test('search profile expands hits and collapses important events', () => {
  const rules = profileRules('search');
  assert.equal(folding.displayStateFromRules({ kind: 'command', hasSearchHit: true, severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'goal', severity: 'normal' }, rules), 'collapsed');
  assert.equal(folding.displayStateFromRules({ kind: 'mcp_call', status: 'failed', severity: 'normal' }, rules), 'collapsed');
  assert.equal(folding.displayStateFromRules({ kind: 'mcp_call', status: 'success', severity: 'normal' }, rules), 'hidden');
});

test('debug profile hides ordinary events by default', () => {
  const rules = profileRules('debug');
  assert.equal(folding.displayStateFromRules({ kind: 'command', status: 'success', severity: 'normal' }, rules), 'hidden');
  assert.equal(folding.displayStateFromRules({ kind: 'command', status: 'failed', severity: 'normal' }, rules), 'expanded');
});

test('conversation profile keeps plan updates and user input requests expanded', () => {
  const rules = profileRules('conversation');
  assert.equal(folding.displayStateFromRules({ kind: 'other_tool_call', toolName: 'update_plan', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'other_tool_call', toolName: 'request_user_input', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'reasoning', hasReadableReasoning: true, severity: 'normal' }, rules), 'summary');
  assert.equal(folding.displayStateFromRules({ kind: 'reasoning', hasReadableReasoning: false, severity: 'normal' }, rules), 'hidden');
  assert.equal(folding.displayStateFromRules({ kind: 'goal', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'compaction', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'other_tool_call', toolName: 'view_image', severity: 'normal' }, rules), 'hidden');
  assert.equal(folding.displayStateFromRules({ kind: 'hook', severity: 'normal' }, rules), 'hidden');
  assert.equal(folding.displayStateFromRules({ kind: 'developer_message', hasSearchHit: true, severity: 'normal' }, {
    kindStates: {},
    fallback: 'hidden',
    conditions: [{ id: 'searchHit', state: 'expanded' }],
  }), 'expanded');
});

test('override normalization drops malformed branches and retains valid manual states', () => {
  assert.deepEqual(plain(folding.normalizeOverrides({
    sessionA: { event1: 'expanded', event2: 'invalid', event3: 'collapsed' },
    sessionB: 'malformed',
    sessionC: null,
  })), {
    sessionA: { event1: 'expanded', event3: 'collapsed' },
  });
  assert.deepEqual(plain(folding.normalizeOverrides('malformed')), {});
});

test('server built-in profiles normalize through the shared module', () => {
  for (const profile of foldingProfiles) {
    assert.deepEqual(profile.rules, folding.normalizeRules(profile.rules), profile.id);
  }
});

test('Code Mode condition leaves every built-in profile default unchanged', () => {
  const ordinaryTool = {
    kind: 'other_tool_call',
    subtype: 'ordinary_tool_call',
    toolName: 'exec',
    status: 'success',
    severity: 'normal',
  };
  const codeModeOperation = { ...ordinaryTool, subtype: 'code_mode_operation' };
  for (const profile of foldingProfiles) {
    assert.equal(profile.rules.conditions.some((condition) => condition.id === 'codeModeOperation'), false, profile.id);
    assert.equal(
      folding.displayStateFromRules(codeModeOperation, profile.rules),
      folding.displayStateFromRules(ordinaryTool, profile.rules),
      profile.id,
    );
  }
});

test('editable kind grouping prioritizes familiar event types without affecting unknown dynamic kinds', () => {
  assert.deepEqual(folding.EDITABLE_KIND_GROUPS.map((group) => group.id), [
    'conversationPlanning',
    'commonWork',
    'issuesRisks',
    'toolsAndInternals',
    'other',
  ]);
  assert.equal(folding.editableKindGroup('user_message').groupId, 'conversationPlanning');
  assert.equal(folding.editableKindGroup('command').groupId, 'commonWork');
  assert.equal(folding.editableKindGroup('error').groupId, 'issuesRisks');
  assert.equal(folding.editableKindGroup('hook').groupId, 'toolsAndInternals');
  assert.equal(folding.editableKindGroup('subagent').groupId, 'toolsAndInternals');
  assert.equal(folding.editableKindGroup('future_event_kind').groupId, 'other');
  assert.equal(folding.EDITABLE_EVENT_KINDS.includes('hook'), false);
  assert.equal(folding.EDITABLE_EVENT_KINDS.includes('subagent'), false);
  assert.equal(folding.isDynamicEditableKind('hook'), true);
  assert.equal(folding.isDynamicEditableKind('subagent'), true);
  assert.equal(folding.isDynamicEditableKind('command'), false);
  assert.ok(folding.editableKindGroup('user_message').groupPriority < folding.editableKindGroup('hook').groupPriority);
  assert.ok(folding.editableKindGroup('command').groupPriority < folding.editableKindGroup('future_event_kind').groupPriority);
});

test('reserved object keys remain ordinary folding keys without prototype inheritance', () => {
  const fallbackRules = { kindStates: {}, fallback: 'hidden' };
  for (const kind of ['toString', 'constructor', '__proto__']) {
    assert.equal(folding.displayStateFromRules({ kind, severity: 'normal' }, fallbackRules), 'hidden');
  }

  const explicitRules = folding.normalizeRules({
    kindStates: JSON.parse('{"__proto__":"expanded","constructor":"summary"}'),
    fallback: 'hidden',
  });
  assert.equal(folding.displayStateFromRules({ kind: '__proto__', severity: 'normal' }, explicitRules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'constructor', severity: 'normal' }, explicitRules), 'summary');

  const overrides = folding.normalizeOverrides(JSON.parse('{"__proto__":{"event":"expanded"},"session":{"__proto__":"collapsed"}}'));
  assert.equal(Object.getPrototypeOf(overrides), null);
  assert.equal(Object.getPrototypeOf(overrides.session), null);
  assert.equal(overrides.__proto__.event, 'expanded');
  assert.equal(overrides.session.__proto__, 'collapsed');
  overrides.session.event = 'summary';
  assert.equal(overrides.session.event, 'summary');
});
