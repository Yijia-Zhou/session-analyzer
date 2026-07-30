'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  goalResponseFromValue,
  goalSnapshotFromGoal,
  goalSnapshotFromRaw,
  goalSnapshotSignature,
  goalSnapshotTransition,
  normalizeGoalStatus,
} = require('../src/codex-goal');
const { createCodexLogicalBuilder } = require('../src/codex-logical');
const agentCoordination = require('../src/shared/agent-coordination');
const {
  projectCodeModeOperations,
} = require('../src/codex-code-mode');
const { deriveCodeModeFacts } = require('../src/codex-code-mode-facts');
const { CANONICAL_SCHEMA_VERSION, CODEX_SOURCE_KIND, rawRef } = require('../src/codex-source');
const toolLifecycleContract = require('../src/codex-tool-lifecycle-contract');

function titleCaseProtocolSubtype(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function displayValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function truncate(value, limit = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function makeLogicalBuilder(overrides = {}) {
  return createCodexLogicalBuilder({
    agentCoordination,
    codeMode: { deriveCodeModeFacts, projectCodeModeOperations },
    envelope: {
      CANONICAL_SCHEMA_VERSION,
      CODEX_SOURCE_KIND,
      sanitizeLogicalEnvelopeValue: (value) => value,
      rawRef,
    },
    goal: {
      goalResponseFromValue,
      goalSnapshotFromGoal,
      goalSnapshotFromRaw,
      goalSnapshotSignature,
      goalSnapshotTransition,
      normalizeGoalStatus,
    },
    protocol: {
      classifyProtocolText: (text, role) => {
        const source = String(text || '');
        if (role === 'developer') {
          if (source.startsWith('<permissions instructions>')) return 'developer_permissions';
          if (source.startsWith('<collaboration_mode>')) return 'developer_collaboration_mode';
          return '';
        }
        if (source.startsWith('# AGENTS.md instructions')) return 'agents_instructions';
        if (source.startsWith('<user_shell_command>')) return 'user_shell_command';
        return '';
      },
      humanizeProtocolSubtype: titleCaseProtocolSubtype,
      protocolLabelFor: (subtype, fallback = '') => fallback || titleCaseProtocolSubtype(subtype),
      protocolPreviewFor: (raw, subtype) => raw.preview || subtype,
    },
    tool: {
      ...toolLifecycleContract,
      commandArgsFromRaw: (raw) => raw?.commandArgs || null,
      commandToText: (command) => Array.isArray(command) ? command.join(' ') : String(command || ''),
      inferPatchSuccess: () => true,
      isFiniteNumberValue: (value) => Number.isFinite(Number(value)),
      numericExitCode: (...values) => {
        const value = values.find((candidate) => candidate != null && Number.isFinite(Number(candidate)));
        return value == null ? null : Number(value);
      },
      parseFormattedCommandOutput: () => null,
      parseOutputEnvelope: () => null,
      patchFilesFromPatchInput: () => [],
      touchFilesFromOutputText: () => [],
      ...(overrides.tool || {}),
    },
    text: {
      displayValue,
      firstNonEmpty,
      planUpdateText: (raw) => raw.searchText,
      relatedReasoning: (left, right) => Boolean(left && right && (left.includes(right) || right.includes(left))),
      truncate,
      uniqueNonEmpty,
    },
    usage: {
      tokenUsageItems: () => [],
      collectUsageLimitItems: () => [],
      rateLimitReachedType: () => '',
    },
  });
}

const logicalBuilder = makeLogicalBuilder();

function raw(line, fields = {}) {
  const payloadType = fields.payloadType || '';
  const recordType = fields.recordType || 'event_msg';
  const role = fields.role || '';
  const parsedPayload = {
    type: payloadType,
    ...(fields.payload || {}),
  };
  return {
    rawId: `session-1:raw:${line}`,
    sessionId: 'session-1',
    line,
    source: { file: '2026/06/10/session.jsonl', line },
    timestamp: Object.hasOwn(fields, 'timestamp') ? fields.timestamp : `2026-06-10T12:00:${String(line).padStart(2, '0')}.000Z`,
    turnId: fields.turnId || '',
    recordType,
    payloadType,
    canonicalType: fields.canonicalType || payloadType,
    role,
    callId: fields.callId || '',
    toolName: fields.toolName || '',
    status: fields.status || '',
    messageText: fields.messageText || '',
    searchText: fields.searchText || fields.messageText || fields.preview || payloadType,
    preview: fields.preview || fields.messageText || payloadType,
    commandText: fields.commandText || '',
    stdout: fields.stdout || '',
    stderr: fields.stderr || '',
    aggregatedOutput: fields.aggregatedOutput || '',
    exitCode: fields.exitCode ?? null,
    durationMs: fields.durationMs || 0,
    touchedFiles: fields.touchedFiles || [],
    output: fields.output || '',
    parsed: { payload: parsedPayload },
  };
}

test('logical builder folds raw rows into message, reasoning, protocol, and fallback events', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: 'hello' }),
    raw(2, { payloadType: 'user_message', messageText: 'hello' }),
    raw(3, { payloadType: 'agent_reasoning', messageText: '' }),
    raw(4, { recordType: 'response_item', payloadType: 'message', role: 'developer', messageText: '<permissions instructions>\nUse tests.' }),
    raw(5, { payloadType: 'thread_goal_updated', canonicalType: 'thread_goal_updated', preview: 'goal changed' }),
  ]);

  const user = logicalEvents.find((event) => event.kind === 'user_message');
  const reasoning = logicalEvents.find((event) => event.kind === 'reasoning');
  const developer = logicalEvents.find((event) => event.subtype === 'developer_permissions');
  const fallback = logicalEvents.find((event) => event.subtype === 'thread_goal_updated');

  assert.equal(user.schemaVersion, 1);
  assert.equal(user.sourceKind, 'codex');
  assert.deepEqual(user.rawRefs.map((ref) => ref.line), [1, 2]);
  assert.equal(reasoning.layer, 'protocol');
  assert.equal(reasoning.hasReadableReasoning, false);
  assert.equal(developer.layer, 'protocol');
  assert.equal(fallback.kind, 'protocol');
  assert.equal(fallback.sourceLocator.type, 'jsonl_line');
});

test('logical builder promotes meaningful goal snapshots and keeps accounting heartbeats in protocol', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      payloadType: 'thread_goal_updated',
      payload: {
        threadId: 'thread-1',
        goal: {
          threadId: 'thread-1',
          objective: 'Ship goal timeline support',
          status: 'active',
          tokenBudget: 2000,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 100,
          updatedAt: 100,
        },
      },
    }),
    raw(2, {
      payloadType: 'thread_goal_updated',
      payload: {
        threadId: 'thread-1',
        goal: {
          threadId: 'thread-1',
          objective: 'Ship goal timeline support',
          status: 'active',
          tokenBudget: 2000,
          tokensUsed: 600,
          timeUsedSeconds: 30,
          createdAt: 100,
          updatedAt: 130,
        },
      },
    }),
    raw(3, {
      payloadType: 'thread_goal_updated',
      payload: {
        threadId: 'thread-1',
        goal: {
          threadId: 'thread-1',
          objective: 'Ship goal timeline support',
          status: 'blocked',
          tokenBudget: 2000,
          tokensUsed: 600,
          timeUsedSeconds: 31,
          createdAt: 100,
          updatedAt: 131,
        },
      },
    }),
    raw(4, { payloadType: 'thread_goal_updated', preview: 'legacy goal metadata' }),
    raw(5, {
      payloadType: 'thread_goal_updated',
      payload: {
        threadId: 'thread-2',
        goal: {
          threadId: 'thread-2',
          objective: 'Resume an existing goal',
          status: 'active',
          tokensUsed: 900,
          timeUsedSeconds: 45,
          createdAt: 50,
          updatedAt: 95,
        },
      },
    }),
    raw(6, {
      payloadType: 'thread_goal_updated',
      payload: {
        threadId: 'thread-3',
        goal: {
          threadId: 'thread-3',
          objective: 'Wait for usage availability',
          status: 'usageLimited',
          tokensUsed: 900,
          timeUsedSeconds: 45,
          createdAt: 60,
          updatedAt: 105,
        },
      },
    }),
  ]);

  const goalEvents = logicalEvents.filter((event) => event.kind === 'goal');
  const protocolEvents = logicalEvents.filter((event) => event.layer === 'protocol' && event.subtype === 'thread_goal_updated');

  assert.deepEqual(goalEvents.map((event) => event.rawRefs[0].line), [1, 3, 5, 6]);
  assert.deepEqual(goalEvents.map((event) => event.label), ['Goal created', 'Goal blocked', 'Goal status', 'Goal usage limited']);
  assert.equal(goalEvents[1].severity, 'warning');
  assert.equal(goalEvents[3].status, 'usage_limited');
  assert.equal(goalEvents[3].severity, 'warning');
  assert.deepEqual(protocolEvents.map((event) => event.rawRefs[0].line), [2, 4]);
});

test('logical builder explains token-budget-only transitions including budget removal', () => {
  const snapshot = (tokenBudget, updatedAt, includeBudget = true) => ({
    threadId: 'thread-budget',
    objective: 'Keep the budget readable',
    status: 'active',
    tokensUsed: 100,
    timeUsedSeconds: 10,
    createdAt: 100,
    updatedAt,
    ...(includeBudget ? { tokenBudget } : {}),
  });
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'thread_goal_updated', payload: { goal: snapshot(1000, 100) } }),
    raw(2, { payloadType: 'thread_goal_updated', payload: { goal: snapshot(2000, 110) } }),
    raw(3, { payloadType: 'thread_goal_updated', payload: { goal: snapshot(undefined, 120, false) } }),
  ]);
  const goalEvents = logicalEvents.filter((event) => event.kind === 'goal');

  assert.deepEqual(goalEvents.map((event) => event.label), ['Goal status', 'Goal updated', 'Goal updated']);
  assert.match(goalEvents[1].preview, /budget: 2000/);
  assert.match(goalEvents[2].preview, /budget: unbounded/);
  assert.ok(goalEvents.every((event) => event.preview.indexOf('budget:') < event.preview.indexOf('Keep the budget readable')));
});

test('logical builder merges goal snapshots with matching create or update tool events', () => {
  const currentGoal = {
    threadId: 'thread-1',
    objective: 'Ship goal timeline support',
    status: 'complete',
    tokenBudget: 2000,
    tokensUsed: 1000,
    timeUsedSeconds: 60,
    createdAt: 100,
    updatedAt: 160,
  };
  const partialLegacyGoal = {
    thread_id: 'thread-1',
    created_at: 100,
    updated_at: 160,
  };
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      recordType: 'response_item',
      payloadType: 'function_call',
      callId: 'call-goal',
      toolName: 'update_goal',
      output: JSON.stringify({ objective: 'Ship goal timeline support' }),
    }),
    raw(2, {
      payloadType: 'thread_goal_updated',
      payload: { threadId: 'thread-1', goal: currentGoal },
    }),
    raw(3, {
      recordType: 'response_item',
      payloadType: 'function_call_output',
      callId: 'call-goal',
      output: JSON.stringify({ status: 'complete', goal: partialLegacyGoal }),
    }),
  ]);
  const goalEvents = logicalEvents.filter((event) => event.kind === 'goal');

  assert.equal(goalEvents.length, 1);
  assert.equal(goalEvents[0].toolName, 'update_goal');
  assert.equal(goalEvents[0].status, 'complete');
  assert.match(goalEvents[0].preview, /Ship goal timeline support/);
  assert.match(goalEvents[0].preview, /budget: 2000/);
  assert.match(goalEvents[0].preview, /tokens: 1000/);
  assert.deepEqual(goalEvents[0].rawRefs.map((ref) => ref.line), [1, 2, 3]);
  assert.deepEqual(goalEvents[0].channels, ['response_item', 'event_msg']);
  assert.equal(logicalEvents.some((event) => event.layer === 'protocol' && event.subtype === 'thread_goal_updated'), false);
});

test('logical builder does not merge an earlier goal snapshot into a future no-op tool call', () => {
  const goal = {
    threadId: 'thread-resumed',
    objective: 'Preserve the resumed lifecycle event',
    status: 'active',
    createdAt: 100,
    updatedAt: 160,
  };
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      payloadType: 'thread_goal_updated',
      payload: { goal },
    }),
    raw(10, {
      recordType: 'response_item',
      payloadType: 'function_call',
      callId: 'call-future-goal',
      toolName: 'update_goal',
      output: JSON.stringify({ status: 'active' }),
    }),
    raw(11, {
      recordType: 'response_item',
      payloadType: 'function_call_output',
      callId: 'call-future-goal',
      output: JSON.stringify({ goal }),
    }),
  ]);
  const goalEvents = logicalEvents.filter((event) => event.kind === 'goal');

  assert.equal(goalEvents.length, 2);
  assert.deepEqual(goalEvents[0].rawRefs.map((ref) => ref.line), [1]);
  assert.deepEqual(goalEvents[1].rawRefs.map((ref) => ref.line), [10, 11]);
});

test('logical builder requires proximity and compatible turns before merging goal snapshots', () => {
  const goal = {
    threadId: 'thread-local',
    objective: 'Keep matching local',
    status: 'active',
    createdAt: 100,
    updatedAt: 160,
  };
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      recordType: 'response_item',
      payloadType: 'function_call',
      callId: 'call-distant-goal',
      toolName: 'update_goal',
      output: JSON.stringify({ status: 'active' }),
      turnId: 'turn-a',
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'function_call_output',
      callId: 'call-distant-goal',
      output: JSON.stringify({ goal }),
      turnId: 'turn-a',
    }),
    raw(5, {
      payloadType: 'thread_goal_updated',
      payload: { goal },
      turnId: 'turn-a',
    }),
    raw(10, {
      recordType: 'response_item',
      payloadType: 'function_call',
      callId: 'call-other-turn-goal',
      toolName: 'update_goal',
      output: JSON.stringify({ status: 'active' }),
      turnId: 'turn-b',
    }),
    raw(11, {
      recordType: 'response_item',
      payloadType: 'function_call_output',
      callId: 'call-other-turn-goal',
      output: JSON.stringify({ goal: { ...goal, updatedAt: 170 } }),
      turnId: 'turn-b',
    }),
    raw(12, {
      payloadType: 'thread_goal_updated',
      payload: { goal: { ...goal, updatedAt: 170 } },
      turnId: 'turn-c',
    }),
  ]);
  const goalEvents = logicalEvents.filter((event) => event.kind === 'goal');
  const protocolSnapshots = logicalEvents.filter((event) => event.layer === 'protocol' && event.subtype === 'thread_goal_updated');

  assert.equal(goalEvents.length, 3);
  assert.ok(goalEvents.every((event) => event.rawRefs.length <= 2));
  assert.deepEqual(goalEvents.map((event) => event.rawRefs[0].line), [1, 5, 10]);
  assert.deepEqual(protocolSnapshots.map((event) => event.rawRefs[0].line), [12]);
});

test('logical builder consumes a matching goal tool candidate only once', () => {
  const goal = {
    threadId: 'thread-once',
    objective: 'Merge one mirrored snapshot',
    status: 'complete',
    createdAt: 100,
    updatedAt: 160,
  };
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      recordType: 'response_item',
      payloadType: 'function_call',
      callId: 'call-once-goal',
      toolName: 'update_goal',
      output: JSON.stringify({ status: 'complete' }),
      turnId: 'turn-a',
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'function_call_output',
      callId: 'call-once-goal',
      output: JSON.stringify({ goal }),
      turnId: 'turn-a',
    }),
    raw(3, { payloadType: 'thread_goal_updated', payload: { goal }, turnId: 'turn-a' }),
    raw(4, { payloadType: 'thread_goal_updated', payload: { goal }, turnId: 'turn-a' }),
  ]);
  const goalEvents = logicalEvents.filter((event) => event.kind === 'goal');
  const protocolSnapshots = logicalEvents.filter((event) => event.layer === 'protocol' && event.subtype === 'thread_goal_updated');

  assert.equal(goalEvents.length, 1);
  assert.deepEqual(goalEvents[0].rawRefs.map((ref) => ref.line), [1, 2, 3]);
  assert.deepEqual(protocolSnapshots.map((event) => event.rawRefs[0].line), [4]);
});

test('logical builder folds mirrored user messages with trailing whitespace differences', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: 'open the browser' }),
    raw(2, { payloadType: 'user_message', messageText: 'open the browser\n' }),
  ]);
  const userMessages = logicalEvents.filter((event) => event.kind === 'user_message');

  assert.equal(userMessages.length, 1);
  assert.deepEqual(userMessages[0].rawRefs.map((ref) => ref.line), [1, 2]);
  assert.deepEqual(userMessages[0].channels, ['response_item', 'event_msg']);
  assert.equal(userMessages[0].searchText, 'open the browser');
});

test('logical builder folds mirrored assistant messages with trailing whitespace differences', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'agent_message', messageText: 'I will inspect it.\n' }),
    raw(2, { recordType: 'response_item', payloadType: 'message', role: 'assistant', messageText: 'I will inspect it.' }),
  ]);
  const assistantMessages = logicalEvents.filter((event) => event.kind === 'assistant_message');

  assert.equal(assistantMessages.length, 1);
  assert.deepEqual(assistantMessages[0].rawRefs.map((ref) => ref.line), [1, 2]);
  assert.deepEqual(assistantMessages[0].channels, ['event_msg', 'response_item']);
  assert.equal(assistantMessages[0].searchText, 'I will inspect it.');
});

test('logical builder does not fold mirrored-looking messages with internal whitespace differences', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: 'open the browser' }),
    raw(2, { payloadType: 'user_message', messageText: 'open  the browser' }),
  ]);
  const userMessages = logicalEvents.filter((event) => event.kind === 'user_message');

  assert.equal(userMessages.length, 2);
  assert.deepEqual(userMessages.map((event) => event.rawRefs.map((ref) => ref.line)), [[1], [2]]);
});

test('logical builder treats response-item-only user shell command wrappers as main user shell command events', () => {
  const shellText = [
    '<user_shell_command>',
    '<command>',
    'git fetch origin',
    '</command>',
    '<result>',
    'Exit code: 0',
    'Duration: 7.9050 seconds',
    'Output:',
    'From github.com:Yijia-Zhou/session-analyzer',
    ' * [new branch]      main       -> origin/main',
    '',
    '</result>',
    '</user_shell_command>',
  ].join('\n');
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'session_meta', preview: 'session metadata' }),
    raw(2, { payloadType: 'thread_goal_updated', canonicalType: 'thread_goal_updated', preview: 'goal changed' }),
    raw(3, { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: shellText }),
    raw(4, { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: 'Repair fallback session titles' }),
  ]);

  const userMessages = logicalEvents.filter((event) => event.kind === 'user_message');
  const shellWrapper = logicalEvents.find((event) => event.subtype === 'user_shell_command');

  assert.ok(shellWrapper);
  assert.equal(shellWrapper.kind, 'user_shell_command');
  assert.equal(shellWrapper.layer, 'main');
  assert.match(shellWrapper.preview, /git fetch origin/);
  assert.match(shellWrapper.searchText, /git fetch origin/);
  assert.deepEqual(shellWrapper.rawRefs.map((ref) => ref.line), [3]);
  assert.deepEqual(shellWrapper.channels, ['response_item']);
  assert.equal(userMessages.length, 1);
  assert.equal(userMessages[0].preview, 'Repair fallback session titles');
  assert.deepEqual(userMessages[0].rawRefs.map((ref) => ref.line), [4]);
});

test('logical builder treats event-msg-only user shell command wrappers as main user shell command events', () => {
  const shellText = '<user_shell_command>\nGet-ChildItem -Force\n</user_shell_command>';
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'user_message', messageText: shellText }),
  ]);
  const shellWrapper = logicalEvents.find((event) => event.subtype === 'user_shell_command');

  assert.ok(shellWrapper);
  assert.equal(shellWrapper.kind, 'user_shell_command');
  assert.equal(shellWrapper.layer, 'main');
  assert.deepEqual(shellWrapper.rawRefs.map((ref) => ref.line), [1]);
  assert.deepEqual(shellWrapper.channels, ['event_msg']);
  assert.equal(logicalEvents.some((event) => event.kind === 'user_message'), false);
});

test('logical builder folds mirrored user shell command wrapper rows into one main event', () => {
  const shellText = '<user_shell_command>\nGet-ChildItem -Force\n</user_shell_command>';
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: shellText }),
    raw(2, { payloadType: 'user_message', messageText: shellText }),
  ]);
  const shellWrappers = logicalEvents.filter((event) => event.subtype === 'user_shell_command');

  assert.equal(shellWrappers.length, 1);
  assert.equal(shellWrappers[0].kind, 'user_shell_command');
  assert.equal(shellWrappers[0].layer, 'main');
  assert.deepEqual(shellWrappers[0].rawRefs.map((ref) => ref.line), [1, 2]);
  assert.deepEqual(shellWrappers[0].channels, ['response_item', 'event_msg']);
  assert.equal(logicalEvents.some((event) => event.kind === 'user_message'), false);
});

test('logical builder folds mirrored user shell command wrappers with trailing whitespace differences', () => {
  const shellText = '<user_shell_command>\nGet-ChildItem -Force\n</user_shell_command>';
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: shellText }),
    raw(2, { payloadType: 'user_message', messageText: `${shellText}\n` }),
  ]);
  const shellWrappers = logicalEvents.filter((event) => event.subtype === 'user_shell_command');

  assert.equal(shellWrappers.length, 1);
  assert.deepEqual(shellWrappers[0].rawRefs.map((ref) => ref.line), [1, 2]);
  assert.deepEqual(shellWrappers[0].channels, ['response_item', 'event_msg']);
  assert.equal(logicalEvents.some((event) => event.kind === 'user_message'), false);
});

test('logical builder uses terminal lifecycle rows for generic protocol tool labels', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'dynamic_tool_call_begin', callId: 'call-dynamic', toolName: 'asset_lookup', preview: 'begin query' }),
    raw(2, { payloadType: 'dynamic_tool_call_end', callId: 'call-dynamic', toolName: 'asset_lookup', preview: 'done' }),
    raw(3, { payloadType: 'image_generation_call_begin', callId: 'call-image', toolName: 'image_generation', preview: 'draw' }),
    raw(4, { payloadType: 'image_generation_call_end', callId: 'call-image', toolName: 'image_generation', preview: 'image done' }),
    raw(5, { payloadType: 'approval_request_begin', callId: 'call-approval', toolName: 'approval', preview: 'approve' }),
    raw(6, { payloadType: 'approval_request_declined', callId: 'call-approval', toolName: 'approval', status: 'declined', preview: 'declined' }),
    raw(7, { payloadType: 'hook_begin', callId: 'call-hook', toolName: 'pre_apply_hook', payload: { hook: 'pre-apply' }, preview: 'hook' }),
    raw(8, { payloadType: 'hook_end', callId: 'call-hook', toolName: 'pre_apply_hook', status: 'completed', preview: 'hook done' }),
    raw(9, { payloadType: 'collab_agent_spawn_begin', callId: 'call-collab', preview: 'spawn' }),
    raw(10, { payloadType: 'collab_agent_spawn_end', callId: 'call-collab', status: 'pending_init', preview: 'spawned' }),
  ]);
  const byCall = new Map(logicalEvents.map((event) => [event.id.split(':call:')[1], event]));

  assert.deepEqual({
    dynamic: {
      label: byCall.get('call-dynamic').label,
      status: byCall.get('call-dynamic').status,
      severity: byCall.get('call-dynamic').severity,
      rawLines: byCall.get('call-dynamic').rawRefs.map((ref) => ref.line),
    },
    image: {
      label: byCall.get('call-image').label,
      status: byCall.get('call-image').status,
      severity: byCall.get('call-image').severity,
      rawLines: byCall.get('call-image').rawRefs.map((ref) => ref.line),
    },
    approval: {
      label: byCall.get('call-approval').label,
      status: byCall.get('call-approval').status,
      severity: byCall.get('call-approval').severity,
      rawLines: byCall.get('call-approval').rawRefs.map((ref) => ref.line),
    },
    hook: {
      kind: byCall.get('call-hook').kind,
      label: byCall.get('call-hook').label,
      status: byCall.get('call-hook').status,
      severity: byCall.get('call-hook').severity,
      rawLines: byCall.get('call-hook').rawRefs.map((ref) => ref.line),
    },
    collab: {
      kind: byCall.get('call-collab').kind,
      label: byCall.get('call-collab').label,
      status: byCall.get('call-collab').status,
      severity: byCall.get('call-collab').severity,
      rawLines: byCall.get('call-collab').rawRefs.map((ref) => ref.line),
    },
  }, {
    dynamic: { label: 'Dynamic Tool Call End', status: 'success', severity: 'normal', rawLines: [1, 2] },
    image: { label: 'Image Generation', status: 'success', severity: 'normal', rawLines: [3, 4] },
    approval: { label: 'Approval Request Declined', status: 'declined', severity: 'warning', rawLines: [5, 6] },
    hook: { kind: 'hook', label: 'pre-apply', status: 'completed', severity: 'normal', rawLines: [7, 8] },
    collab: { kind: 'agent_coordination', label: 'Collab Agent Spawn End', status: 'success', severity: 'normal', rawLines: [9, 10] },
  });
});

test('logical builder keeps descriptor representative priority across lifecycle transitions', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'dynamic_tool_call_begin', callId: 'call-transition', preview: 'begin' }),
    raw(2, { payloadType: 'dynamic_tool_call_end', callId: 'call-transition', preview: 'terminal' }),
    raw(3, { payloadType: 'dynamic_tool_call_update', callId: 'call-transition', preview: 'late progress' }),
    raw(4, { payloadType: 'approval_request_begin', callId: 'call-declined', preview: 'approval begin' }),
    raw(5, { payloadType: 'approval_request_declined', callId: 'call-declined', status: 'declined', preview: 'declined' }),
    raw(6, { payloadType: 'approval_request_end', callId: 'call-declined', preview: 'later terminal' }),
  ]);
  const byCall = new Map(logicalEvents.map((event) => [event.id.split(':call:')[1], event]));

  assert.deepEqual({
    label: byCall.get('call-transition').label,
    preview: byCall.get('call-transition').preview,
    rawLines: byCall.get('call-transition').rawRefs.map((ref) => ref.line),
  }, {
    label: 'Dynamic Tool Call End',
    preview: 'terminal',
    rawLines: [1, 2, 3],
  });
  assert.deepEqual({
    label: byCall.get('call-declined').label,
    preview: byCall.get('call-declined').preview,
    status: byCall.get('call-declined').status,
    severity: byCall.get('call-declined').severity,
    rawLines: byCall.get('call-declined').rawRefs.map((ref) => ref.line),
  }, {
    label: 'Approval Request Declined',
    preview: 'declined',
    status: 'declined',
    severity: 'warning',
    rawLines: [4, 5, 6],
  });
});

test('logical builder leaves unknown lifecycle lookalikes in protocol fallback', () => {
  const lookalikeTypes = [
    'exec_command_output_delta',
    'patch_apply_updated',
    'dynamic_tool_call_response',
    'hook_complete',
    'collab_resume_end',
  ];
  const logicalEvents = logicalBuilder.buildLogicalEvents(lookalikeTypes
    .map((payloadType, index) => raw(index + 1, {
      payloadType,
      callId: `lookalike-${index}`,
      preview: `unknown ${payloadType}`,
    })));

  assert.deepEqual(logicalEvents.map((event) => ({
    kind: event.kind,
    subtype: event.subtype,
    layer: event.layer,
    rawLines: event.rawRefs.map((ref) => ref.line),
  })), lookalikeTypes.map((payloadType, index) => ({
    kind: 'protocol',
    subtype: payloadType,
    layer: 'protocol',
    rawLines: [index + 1],
  })));
});

test('logical builder excludes a same-call lookalike from lifecycle semantics but retains its raw reference', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      payloadType: 'dynamic_tool_call_begin',
      callId: 'call-mixed-lookalike',
      preview: 'admitted begin',
      searchText: 'admitted-begin-search',
    }),
    raw(2, {
      payloadType: 'dynamic_tool_call_end',
      callId: 'call-mixed-lookalike',
      preview: 'admitted terminal',
      searchText: 'admitted-terminal-search',
    }),
    raw(3, {
      payloadType: 'dynamic_tool_call_future_end',
      callId: 'call-mixed-lookalike',
      preview: 'unknown future terminal',
      searchText: 'unknown-lookalike-search',
    }),
  ]);
  const event = logicalEvents.find((candidate) => candidate.id.endsWith(':call:call-mixed-lookalike'));

  assert.ok(event);
  assert.equal(event.label, 'Dynamic Tool Call End');
  assert.equal(event.preview, 'admitted terminal');
  assert.match(event.searchText, /admitted-begin-search/);
  assert.match(event.searchText, /admitted-terminal-search/);
  assert.doesNotMatch(event.searchText, /unknown-lookalike-search/);
  assert.deepEqual(event.rawRefs.map((ref) => ({
    line: ref.line,
    sourceEventType: ref.sourceEventType,
  })), [
    { line: 1, sourceEventType: 'dynamic_tool_call_begin' },
    { line: 2, sourceEventType: 'dynamic_tool_call_end' },
    { line: 3, sourceEventType: 'dynamic_tool_call_future_end' },
  ]);
  assert.equal(logicalEvents.some((candidate) => (
    candidate.layer === 'protocol'
    && candidate.subtype === 'dynamic_tool_call_future_end'
  )), false);
});

test('logical builder excludes same-call lookalikes from lifecycle outcome inference', () => {
  const lookalikes = [
    { payloadType: 'dynamic_tool_call_future_end' },
    { payloadType: 'dynamic_tool_call_future_declined' },
    { payloadType: 'dynamic_tool_call_future_status', status: 'failed' },
  ];

  for (const [index, lookalike] of lookalikes.entries()) {
    const callId = `call-outcome-lookalike-${index}`;
    const logicalEvents = logicalBuilder.buildLogicalEvents([
      raw(1, {
        payloadType: 'dynamic_tool_call_begin',
        callId,
        preview: 'admitted begin',
        searchText: 'admitted-begin-search',
      }),
      raw(2, {
        ...lookalike,
        callId,
        preview: 'unknown outcome',
        searchText: 'unknown-outcome-search',
      }),
    ]);
    const event = logicalEvents.find((candidate) => candidate.id.endsWith(`:call:${callId}`));

    assert.ok(event);
    assert.equal(event.status, 'incomplete');
    assert.equal(event.severity, 'warning');
    assert.equal(event.label, 'Dynamic Tool Call Begin');
    assert.deepEqual(event.rawRefs.map((ref) => ref.line), [1, 2]);
    assert.doesNotMatch(event.searchText, /unknown-outcome-search/);
  }
});

test('logical builder classifies direct subagent coordination tools independently', () => {
  const toolNames = [
    'spawn_agent',
    'list_agents',
    'wait_agent',
    'send_message',
    'send_input',
    'followup_task',
    'interrupt_agent',
    'close_agent',
  ];
  const logicalEvents = logicalBuilder.buildLogicalEvents(toolNames.map((toolName, index) => raw(index + 1, {
    recordType: 'response_item',
    payloadType: 'function_call',
    callId: `call-${toolName}`,
    toolName,
    output: '{}',
  })));

  assert.deepEqual(logicalEvents.map((event) => ({
    kind: event.kind,
    subtype: event.subtype,
    toolName: event.toolName,
  })), toolNames.map((toolName) => ({
    kind: 'agent_coordination',
    subtype: toolName,
    toolName,
  })));
});

test('logical builder supports new hook lifecycle rows and ungrouped declined hooks', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'hook_started', callId: 'call-hook-new', toolName: 'SessionStart', payload: { hook_name: 'SessionStart' }, preview: 'starting hook' }),
    raw(2, { payloadType: 'hook_completed', callId: 'call-hook-new', toolName: 'SessionStart', status: 'completed', preview: 'hook complete' }),
    raw(3, { payloadType: 'hook_declined', toolName: 'Stop', status: 'declined', preview: 'hook declined' }),
  ]);
  const grouped = logicalEvents.find((event) => event.rawRefs.some((ref) => ref.line === 1));
  const declined = logicalEvents.find((event) => event.rawRefs.some((ref) => ref.line === 3));

  assert.equal(grouped.kind, 'hook');
  assert.equal(grouped.label, 'SessionStart');
  assert.equal(grouped.status, 'completed');
  assert.deepEqual(grouped.rawRefs.map((ref) => ref.line), [1, 2]);
  assert.equal(declined.kind, 'hook');
  assert.equal(declined.label, 'Stop');
  assert.equal(declined.status, 'declined');
  assert.equal(declined.severity, 'warning');
});

test('logical builder surfaces unwrapped developer messages as possible hook output', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      recordType: 'response_item',
      payloadType: 'message',
      role: 'developer',
      messageText: 'session-analyzer guardrails:\n- repo: .',
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'message',
      role: 'developer',
      messageText: '<collaboration_mode>\n# Collaboration Mode: Default',
    }),
  ]);
  const developerMessage = logicalEvents.find((event) => event.kind === 'developer_message');
  const wrapper = logicalEvents.find((event) => event.subtype === 'developer_collaboration_mode');

  assert.equal(developerMessage.label, 'Developer message');
  assert.deepEqual(developerMessage.tags, ['Possible hook output']);
  assert.match(developerMessage.searchText, /Possible hook output/);
  assert.equal(wrapper.layer, 'protocol');
});

test('logical builder pairs web search rows without changing ids, refs, status, or search text', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      payloadType: 'web_search_end',
      parsed: {},
      payload: { action: { type: 'search', query: 'release hardening' } },
      searchText: 'release hardening result',
      preview: 'search end',
      status: 'completed',
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'web_search_call',
      payload: { action: { type: 'search', query: 'release hardening' } },
      searchText: 'release hardening call',
      preview: 'search call',
    }),
    raw(3, {
      payloadType: 'web_search_end',
      payload: { action: { type: 'search', query: 'orphan' } },
      searchText: 'orphan web search end fixture',
      preview: 'orphan web search end fixture',
      status: 'completed',
    }),
  ]);

  const paired = logicalEvents.find((event) => event.kind === 'web_search' && event.rawRefs.length === 2);
  const orphan = logicalEvents.find((event) => event.kind === 'web_search' && event.rawRefs.length === 1);

  assert.equal(paired.id, 'session-1:logical:web_search:1');
  assert.deepEqual(paired.rawRefs.map((ref) => ref.line), [1, 2]);
  assert.deepEqual(paired.channels, ['event_msg', 'response_item']);
  assert.equal(paired.status, 'completed');
  assert.match(paired.searchText, /release hardening result/);
  assert.match(paired.searchText, /release hardening call/);
  assert.equal(orphan.preview, 'orphan web search end fixture');
  assert.deepEqual(orphan.rawRefs.map((ref) => ref.line), [3]);
});

test('logical builder keeps adjacent web search call/end rows separate without action key or timestamps', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      payloadType: 'web_search_end',
      payload: {},
      timestamp: '',
      preview: 'end without key',
      status: 'completed',
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'web_search_call',
      payload: {},
      timestamp: '',
      preview: 'call without key',
    }),
  ]);

  const searchEvents = logicalEvents.filter((event) => event.kind === 'web_search');
  assert.equal(searchEvents.length, 2);
  assert.deepEqual(searchEvents.map((event) => event.rawRefs.map((ref) => ref.line)), [[1], [2]]);
});

test('logical builder requires the same turn for unkeyed web search timestamp fallback', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      payloadType: 'web_search_end',
      payload: {},
      timestamp: '2026-06-10T12:00:00.000Z',
      turnId: 'turn-a',
      preview: 'first unkeyed end',
      status: 'completed',
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'web_search_call',
      payload: {},
      timestamp: '2026-06-10T12:00:00.200Z',
      turnId: 'turn-b',
      preview: 'second unkeyed call',
    }),
    raw(3, {
      payloadType: 'web_search_end',
      payload: {},
      timestamp: '2026-06-10T12:00:00.300Z',
      turnId: 'turn-b',
      preview: 'second unkeyed end',
      status: 'completed',
    }),
  ]);

  const searchEvents = logicalEvents.filter((event) => event.kind === 'web_search');
  assert.deepEqual(searchEvents.map((event) => event.rawRefs.map((ref) => ref.line)), [[1], [2, 3]]);
  assert.equal(searchEvents[0].preview, 'first unkeyed end');
  assert.match(searchEvents[1].searchText, /second unkeyed call/);
  assert.match(searchEvents[1].searchText, /second unkeyed end/);
});

test('logical builder keeps raw line order for the whole batch when an event is missing a timestamp', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, {
      payloadType: 'warning',
      timestamp: '2026-06-10T12:00:10.000Z',
      preview: 'later timestamped warning',
    }),
    raw(2, {
      payloadType: 'thread_goal_updated',
      canonicalType: 'thread_goal_updated',
      timestamp: '',
      preview: 'untimestamped protocol row',
    }),
    raw(3, {
      payloadType: 'warning',
      timestamp: '2026-06-10T12:00:00.000Z',
      preview: 'earlier timestamped warning',
    }),
  ]);

  assert.deepEqual(logicalEvents.map((event) => event.rawRefs[0]?.line), [1, 2, 3]);
  assert.deepEqual(logicalEvents.map((event) => event.preview), [
    'later timestamped warning',
    'untimestamped protocol row',
    'earlier timestamped warning',
  ]);
});

test('logical builder marks patch calls with unknown success as incomplete warnings', () => {
  const builder = makeLogicalBuilder({
    tool: {
      inferPatchSuccess: () => null,
      patchFilesFromPatchInput: () => ['src/unknown.js'],
      parseOutputEnvelope: (text) => JSON.parse(text),
    },
  });
  const logicalEvents = builder.buildLogicalEvents([
    raw(1, {
      recordType: 'response_item',
      payloadType: 'custom_tool_call',
      toolName: 'apply_patch',
      callId: 'call-patch-unknown',
      output: '*** Begin Patch\n*** Update File: src/unknown.js\n*** End Patch',
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'custom_tool_call_output',
      toolName: 'apply_patch',
      callId: 'call-patch-unknown',
      output: '{"output":"Patch request sent.","metadata":{"duration_seconds":0.1}}',
    }),
  ]);

  assert.deepEqual(logicalEvents.filter((event) => event.kind === 'patch').map((event) => ({
    status: event.status,
    severity: event.severity,
    label: event.label,
    touchedFiles: event.touchedFiles,
  })), [{
    status: 'incomplete',
    severity: 'warning',
    label: 'Incomplete patch',
    touchedFiles: ['src/unknown.js'],
  }]);
});

test('logical builder emits one neutral Code Mode operation and uniquely links nested lifecycle events', () => {
  const events = logicalBuilder.buildLogicalEvents([
    raw(1, {
      recordType: 'response_item', payloadType: 'custom_tool_call', callId: 'exec-code-mode', toolName: 'exec', turnId: 'turn-code',
      output: "for (const item of items) await tools.shell_command({ command: item, sandbox_permissions: 'require_escalated' });",
      payload: { name: 'exec', input: 'sanitized JavaScript' },
    }),
    raw(2, { payloadType: 'patch_apply_end', callId: 'nested-patch', toolName: 'apply_patch', turnId: 'turn-code', status: 'completed', searchText: 'nested-patch-only' }),
    raw(3, {
      recordType: 'response_item', payloadType: 'custom_tool_call_output', callId: 'exec-code-mode', turnId: 'turn-code',
      output: 'Script running with cell ID 4242\nLive output: outer-exec-only',
      payload: { output: 'Script running with cell ID 4242\nLive output: outer-exec-only' },
    }),
    raw(4, {
      recordType: 'response_item', payloadType: 'function_call', callId: 'wait-code-mode', toolName: 'wait', turnId: 'turn-code',
      output: '{"cell_id":"4242"}', payload: { name: 'wait', arguments: '{"cell_id":"4242"}' },
    }),
    raw(5, { payloadType: 'mcp_tool_call_begin', callId: 'nested-mcp', toolName: 'fixture_lookup', turnId: 'turn-code', status: 'in_progress', searchText: 'nested-mcp-only begin' }),
    raw(6, { payloadType: 'mcp_tool_call_end', callId: 'nested-mcp', toolName: 'fixture_lookup', turnId: 'turn-code', status: 'failed', searchText: 'nested-mcp-only end' }),
    raw(7, {
      recordType: 'response_item', payloadType: 'function_call_output', callId: 'wait-code-mode', turnId: 'turn-code',
      output: 'Script completed\nouter-wait-only', payload: { output: 'Script completed\nouter-wait-only' },
    }),
    raw(8, { recordType: 'response_item', payloadType: 'function_call', callId: 'direct-tool', toolName: 'view_image', output: '{"path":"fixture.png"}' }),
    raw(9, { recordType: 'response_item', payloadType: 'function_call_output', callId: 'direct-tool', output: '{"ok":true}' }),
  ]);
  const operation = events.find((event) => event.kind === 'code_mode_operation');
  const nestedPatch = events.find((event) => event.kind === 'patch');
  const nestedMcp = events.find((event) => event.kind === 'mcp_call');

  assert.ok(operation);
  assert.deepEqual({
    kind: operation.kind,
    subtype: operation.subtype,
    toolName: operation.toolName,
    status: operation.status,
    severity: operation.severity,
    rawLines: operation.rawRefs.map((ref) => ref.line),
  }, {
    kind: 'code_mode_operation', subtype: '', toolName: 'exec', status: '', severity: 'normal', rawLines: [1, 3, 4, 7],
  });
  assert.equal(events.some((event) => event.toolName === 'wait'), false);
  assert.deepEqual(operation.codeModeOperation.eventRefs, [nestedPatch.id, nestedMcp.id]);
  assert.deepEqual(nestedPatch.rawRefs.map((ref) => ref.line), [2]);
  assert.equal(nestedPatch.status, 'success');
  assert.equal(nestedPatch.severity, 'normal');
  assert.deepEqual(nestedMcp.rawRefs.map((ref) => ref.line), [5, 6]);
  assert.equal(nestedMcp.status, 'failed');
  assert.equal(nestedMcp.severity, 'error');
  assert.match(operation.searchText, /sanitized JavaScript/);
  assert.doesNotMatch(operation.searchText, /require_escalated/);
  assert.match(operation.searchText, /outer-exec-only/);
  assert.match(operation.searchText, /outer-wait-only/);
  assert.doesNotMatch(operation.searchText, /nested-(?:patch|mcp)-only/);
  assert.deepEqual(operation.tags, []);
  assert.equal(events.filter((event) => event.toolName === 'shell_command').length, 0);
  assert.ok(events.some((event) => event.toolName === 'view_image'));
});

test('logical builder leaves an empty Code Mode source preview empty', () => {
  const events = logicalBuilder.buildLogicalEvents([
    raw(1, {
      recordType: 'response_item',
      payloadType: 'custom_tool_call',
      callId: 'exec-code-mode-empty-source',
      toolName: 'exec',
      turnId: 'turn-code-empty-source',
      output: '',
      payload: { name: 'exec', input: '' },
    }),
    raw(2, {
      recordType: 'response_item',
      payloadType: 'custom_tool_call_output',
      callId: 'exec-code-mode-empty-source',
      turnId: 'turn-code-empty-source',
      output: 'Script completed\nOutput:\n',
      payload: { output: 'Script completed\nOutput:\n' },
    }),
  ]);

  const operation = events.find((event) => event.kind === 'code_mode_operation');
  assert.ok(operation);
  assert.equal(operation.label, 'Code Mode operation');
  assert.equal(operation.preview, '');
});
