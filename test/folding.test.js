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
    codeModeRequestStates: {},
    fallback: 'summary',
    conditions: [
      { id: 'searchHit', state: 'summary' },
      { id: 'failedStatus', state: 'expanded' },
      { id: 'touchedFiles', state: 'collapsed' },
    ],
  });
});

test('normalizes Code Mode request rules and preserves historical and reserved keys', () => {
  const normalized = folding.normalizeRules({
    codeModeRequestStates: JSON.parse('{"shell_command":"collapsed","historical_tool":"summary","__proto__":"expanded","constructor":"hidden","":"expanded","bad":"unknown"}'),
  });
  assert.deepEqual(
    plain(normalized.codeModeRequestStates),
    JSON.parse('{"__proto__":"expanded","constructor":"hidden","historical_tool":"summary","shell_command":"collapsed"}'),
  );
  assert.equal(Object.getPrototypeOf(normalized.codeModeRequestStates), null);
});

test('Code Mode request rules use presentation facts and most-visible priority', () => {
  const event = {
    kind: 'code_mode_operation',
    severity: 'normal',
    presentationFacts: {
      codeModeDeclaredRequests: {
        toolNames: ['shell_command', 'shell_command', 'update_plan'],
        requestEvidence: 'declared_source',
      },
    },
  };
  const rules = {
    kindStates: { other_tool_call: 'collapsed' },
    codeModeRequestStates: {
      shell_command: 'hidden',
      update_plan: 'expanded',
    },
    fallback: 'summary',
  };
  assert.equal(folding.displayStateFromRules(event, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({
    ...event,
    presentationFacts: {
      codeModeDeclaredRequests: {
        toolNames: ['shell_command'],
        requestEvidence: 'declared_source',
      },
    },
  }, rules), 'hidden');
  assert.equal(folding.displayStateFromRules({
    ...event,
    presentationFacts: undefined,
  }, {
    codeModeRequestStates: { shell_command: 'expanded' },
    fallback: 'hidden',
  }), 'hidden');
});

test('unset Code Mode request rules inherit corresponding ordinary tool folding', () => {
  const rules = {
    kindStates: {
      command: 'collapsed',
      patch: 'expanded',
      goal: 'summary',
      other_tool_call: 'hidden',
    },
    codeModeRequestStates: {},
    fallback: 'hidden',
    conditions: [
      { id: 'updatePlanCall', state: 'expanded' },
      { id: 'userInputRequest', state: 'summary' },
      { id: 'reviewCommand', state: 'expanded' },
      { id: 'touchedFiles', state: 'expanded' },
      { id: 'failedStatus', state: 'expanded' },
    ],
  };
  assert.equal(folding.ordinaryKindForCodeModeRequest('shell_command'), 'command');
  assert.equal(folding.ordinaryKindForCodeModeRequest('exec_command'), 'command');
  assert.equal(folding.ordinaryKindForCodeModeRequest('apply_patch'), 'patch');
  assert.equal(folding.ordinaryKindForCodeModeRequest('create_goal'), 'goal');
  assert.equal(folding.ordinaryKindForCodeModeRequest('web__run'), 'other_tool_call');
  assert.equal(folding.ordinaryKindForCodeModeRequest('spawn_agent'), 'agent_coordination');
  assert.equal(folding.ordinaryKindForCodeModeRequest('list_agents'), 'agent_coordination');

  assert.equal(folding.inheritedCodeModeRequestState('shell_command', rules), 'collapsed');
  assert.equal(folding.inheritedCodeModeRequestState('apply_patch', rules), 'expanded');
  assert.equal(folding.inheritedCodeModeRequestState('create_goal', rules), 'summary');
  assert.equal(folding.inheritedCodeModeRequestState('update_plan', rules), 'expanded');
  assert.equal(folding.inheritedCodeModeRequestState('request_user_input', rules), 'summary');
  assert.equal(folding.inheritedCodeModeRequestState('web__run', rules), 'hidden');
  assert.equal(folding.inheritedCodeModeRequestState('spawn_agent', rules), 'hidden');

  const operation = (toolNames) => ({
    kind: 'code_mode_operation',
    status: 'success',
    severity: 'normal',
    presentationFacts: {
      codeModeDeclaredRequests: {
        toolNames,
        requestEvidence: 'declared_source',
      },
    },
  });
  assert.equal(folding.displayStateFromRules(operation(['shell_command']), rules), 'collapsed');
  assert.equal(folding.displayStateFromRules(operation(['apply_patch']), rules), 'expanded');
  assert.equal(folding.displayStateFromRules(operation(['shell_command', 'request_user_input']), rules), 'summary');
  assert.equal(folding.displayStateFromRules(operation(['update_plan']), {
    ...rules,
    codeModeRequestStates: { update_plan: 'hidden' },
  }), 'hidden');
});

test('Scripted operations inherit ordinary Other tool call folding unless explicitly set', () => {
  const event = {
    kind: 'code_mode_operation',
    status: 'success',
    severity: 'normal',
  };
  const rules = {
    kindStates: {
      other_tool_call: 'collapsed',
      code_mode_operation: 'expanded',
    },
    fallback: 'hidden',
  };
  assert.equal(folding.displayStateFromRules(event, rules), 'collapsed');
  assert.equal(folding.displayStateFromRules(event, {
    ...rules,
    conditions: [{ id: 'codeModeScriptOperation', state: 'summary' }],
  }), 'summary');
});

test('built-in profiles inherit only safe ordinary-call folding facts', () => {
  const operation = (toolName) => ({
    kind: 'code_mode_operation',
    status: 'success',
    severity: 'normal',
    preview: 'npm test',
    touchedFiles: [],
    presentationFacts: {
      codeModeDeclaredRequests: {
        toolNames: [toolName],
        requestEvidence: 'declared_source',
      },
    },
  });
  assert.equal(folding.displayStateFromRules(operation('update_plan'), profileRules('conversation')), 'expanded');
  assert.equal(folding.displayStateFromRules(operation('request_user_input'), profileRules('conversation')), 'expanded');
  assert.equal(folding.displayStateFromRules(operation('shell_command'), profileRules('conversation')), 'hidden');
  assert.equal(folding.displayStateFromRules(operation('apply_patch'), profileRules('changes')), 'expanded');
  assert.equal(folding.displayStateFromRules(operation('shell_command'), profileRules('changes')), 'hidden');
  assert.equal(folding.displayStateFromRules(operation('create_goal'), profileRules('planning')), 'expanded');
  assert.equal(folding.displayStateFromRules(operation('web__run'), profileRules('planning')), 'collapsed');
});

test('declared update_plan requests do not match the canonical update-plan condition', () => {
  const event = {
    kind: 'code_mode_operation',
    severity: 'normal',
    presentationFacts: {
      codeModeDeclaredRequests: {
        toolNames: ['update_plan'],
        requestEvidence: 'declared_source',
      },
    },
  };
  assert.equal(folding.conditionMatches('updatePlanCall', event), false);
  assert.equal(folding.displayStateFromRules(event, {
    codeModeRequestStates: { update_plan: 'collapsed' },
    conditions: [{ id: 'updatePlanCall', state: 'expanded' }],
    fallback: 'hidden',
  }), 'collapsed');
});

test('planning condition matches update_plan calls and protocol plan updates', () => {
  const toolUpdate = { kind: 'other_tool_call', subtype: 'update_plan', toolName: 'update_plan', severity: 'normal' };
  const protocolUpdate = { kind: 'plan_update', subtype: 'plan_update', toolName: '', severity: 'normal' };
  assert.equal(folding.conditionMatches('updatePlanCall', toolUpdate), true);
  assert.equal(folding.conditionMatches('updatePlanCall', protocolUpdate), true);
  assert.equal(folding.displayStateFromRules(protocolUpdate, profileRules('planning')), 'expanded');
  assert.equal(folding.displayStateFromRules(toolUpdate, profileRules('planning')), 'expanded');
  assert.equal(folding.conditionMatches('updatePlanCall', { label: 'update_plan' }), false);
});

test('Scripted operation folding condition matches only unprojected Code Mode calls', () => {
  const scriptOperation = {
    kind: 'code_mode_operation',
    toolName: 'exec',
  };
  const projectedOperation = {
    ...scriptOperation,
    presentationFacts: {
      codeModeDeclaredRequests: {
        toolNames: ['update_plan'],
        requestEvidence: 'declared_source',
      },
    },
  };
  assert.equal(folding.conditionMatches('codeModeScriptOperation', scriptOperation), true);
  assert.equal(folding.conditionMatches('codeModeScriptOperation', projectedOperation), false);
  assert.equal(folding.conditionMatches('updatePlanCall', scriptOperation), false);
  assert.equal(folding.conditionMatches('userInputRequest', scriptOperation), false);
  assert.equal(folding.conditionMatches('codeModeScriptOperation', {
    kind: 'other_tool_call',
    subtype: 'update_plan',
    toolName: 'update_plan',
  }), false);
  assert.ok(folding.CONDITION_DEFINITIONS.some((condition) => condition.id === 'codeModeScriptOperation'));
  assert.equal(folding.CONDITION_DEFINITIONS.some((condition) => condition.id === 'codeModeOperation'), false);
  assert.equal(folding.displayStateFromRules(scriptOperation, {
    kindStates: { other_tool_call: 'collapsed' },
    conditions: [{ id: 'codeModeScriptOperation', state: 'expanded' }],
  }), 'expanded');
  assert.equal(folding.displayStateFromRules(projectedOperation, {
    kindStates: { other_tool_call: 'collapsed' },
    codeModeRequestStates: { update_plan: 'summary' },
    conditions: [{ id: 'codeModeScriptOperation', state: 'expanded' }],
  }), 'summary');
});

test('obsolete all-Code-Mode conditions are rejected', () => {
  const normalized = folding.normalizeRules({
    conditions: [
      { id: 'codeModeOperation', state: 'collapsed' },
      { id: 'codeModeScriptOperation', state: 'expanded' },
    ],
  });
  assert.deepEqual(normalized.conditions, [{ id: 'codeModeScriptOperation', state: 'expanded' }]);
});

test('planning profile expands only planning anchors and collapses known non-planning events', () => {
  const rules = profileRules('planning');
  assert.equal(folding.displayStateFromRules({ kind: 'proposed_plan', subtype: 'proposed_plan', toolName: '', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'goal', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'other_tool_call', subtype: 'update_plan', toolName: 'update_plan', severity: 'normal' }, rules), 'expanded');
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
  assert.equal(folding.displayStateFromRules({ kind: 'other_tool_call', subtype: 'update_plan', toolName: 'update_plan', severity: 'normal' }, rules), 'expanded');
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

test('Scripted operation condition leaves every built-in profile default unchanged', () => {
  const ordinaryTool = {
    kind: 'other_tool_call',
    subtype: 'ordinary_tool_call',
    toolName: 'exec',
    status: 'success',
    severity: 'normal',
  };
  const codeModeOperation = { ...ordinaryTool, kind: 'code_mode_operation' };
  for (const profile of foldingProfiles) {
    assert.equal(profile.rules.conditions.some((condition) => condition.id === 'codeModeScriptOperation'), false, profile.id);
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
    'agentSystem',
    'other',
  ]);
  assert.equal(folding.editableKindGroup('user_message').groupId, 'conversationPlanning');
  assert.equal(folding.editableKindGroup('command').groupId, 'commonWork');
  assert.equal(folding.editableKindGroup('error').groupId, 'issuesRisks');
  assert.equal(folding.editableKindGroup('mcp_call').groupId, 'commonWork');
  assert.equal(folding.editableKindGroup('js_repl').groupId, 'commonWork');
  assert.equal(folding.editableKindGroup('other_tool_call').groupId, 'commonWork');
  assert.equal(folding.editableKindGroup('agent_coordination').groupId, 'agentSystem');
  assert.equal(folding.editableKindGroup('hook').groupId, 'agentSystem');
  assert.equal(folding.editableKindGroup('subagent').groupId, 'agentSystem');
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
