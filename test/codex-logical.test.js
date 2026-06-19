'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCodexLogicalBuilder } = require('../src/codex-logical');
const { CANONICAL_SCHEMA_VERSION, CODEX_SOURCE_KIND, rawRef } = require('../src/codex-source');

const TOOL_EVENT_TYPES = new Set([
  'exec_command_begin',
  'exec_command_end',
  'patch_apply_begin',
  'patch_apply_end',
  'mcp_tool_call_begin',
  'mcp_tool_call_end',
  'image_generation_call_begin',
  'image_generation_call_end',
  'image_generation_end',
  'dynamic_tool_call_begin',
  'dynamic_tool_call_end',
  'dynamic_tool_call_declined',
  'approval_request_begin',
  'approval_request_declined',
  'hook_begin',
  'hook_end',
  'collab_agent_spawn_begin',
  'collab_agent_spawn_end',
]);

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
    envelope: {
      CANONICAL_SCHEMA_VERSION,
      CODEX_SOURCE_KIND,
      sanitizeLogicalEnvelopeValue: (value) => value,
      rawRef,
    },
    protocol: {
      classifyProtocolText: (text, role) => {
        const source = String(text || '');
        if (role === 'developer') return 'developer_instruction';
        if (source.startsWith('# AGENTS.md instructions')) return 'agents_instructions';
        if (source.startsWith('<user_shell_command>')) return 'user_shell_command';
        return '';
      },
      humanizeProtocolSubtype: titleCaseProtocolSubtype,
      protocolLabelFor: (subtype, fallback = '') => fallback || titleCaseProtocolSubtype(subtype),
      protocolPreviewFor: (raw, subtype) => raw.preview || subtype,
    },
    tool: {
      TOOL_EVENT_TYPES,
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
    raw(4, { recordType: 'response_item', payloadType: 'message', role: 'developer', messageText: '# AGENTS.md instructions\nUse tests.' }),
    raw(5, { payloadType: 'thread_goal_updated', canonicalType: 'thread_goal_updated', preview: 'goal changed' }),
  ]);

  const user = logicalEvents.find((event) => event.kind === 'user_message');
  const reasoning = logicalEvents.find((event) => event.kind === 'reasoning');
  const developer = logicalEvents.find((event) => event.subtype === 'developer_instruction');
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

test('logical builder uses terminal lifecycle rows for generic protocol tool labels', () => {
  const logicalEvents = logicalBuilder.buildLogicalEvents([
    raw(1, { payloadType: 'dynamic_tool_call_begin', callId: 'call-dynamic', toolName: 'asset_lookup', preview: 'begin query' }),
    raw(2, { payloadType: 'dynamic_tool_call_end', callId: 'call-dynamic', toolName: 'asset_lookup', preview: 'done' }),
    raw(3, { payloadType: 'image_generation_call_begin', callId: 'call-image', toolName: 'image_generation', preview: 'draw' }),
    raw(4, { payloadType: 'image_generation_call_end', callId: 'call-image', toolName: 'image_generation', preview: 'image done' }),
    raw(5, { payloadType: 'approval_request_begin', callId: 'call-approval', toolName: 'approval', preview: 'approve' }),
    raw(6, { payloadType: 'approval_request_declined', callId: 'call-approval', toolName: 'approval', status: 'declined', preview: 'declined' }),
    raw(7, { payloadType: 'hook_begin', callId: 'call-hook', toolName: 'pre_apply_hook', preview: 'hook' }),
    raw(8, { payloadType: 'hook_end', callId: 'call-hook', toolName: 'pre_apply_hook', preview: 'hook done' }),
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
      label: byCall.get('call-hook').label,
      status: byCall.get('call-hook').status,
      severity: byCall.get('call-hook').severity,
      rawLines: byCall.get('call-hook').rawRefs.map((ref) => ref.line),
    },
    collab: {
      label: byCall.get('call-collab').label,
      status: byCall.get('call-collab').status,
      severity: byCall.get('call-collab').severity,
      rawLines: byCall.get('call-collab').rawRefs.map((ref) => ref.line),
    },
  }, {
    dynamic: { label: 'Dynamic Tool Call End', status: 'success', severity: 'normal', rawLines: [1, 2] },
    image: { label: 'Image Generation', status: 'success', severity: 'normal', rawLines: [3, 4] },
    approval: { label: 'Approval Request Declined', status: 'declined', severity: 'warning', rawLines: [5, 6] },
    hook: { label: 'Hook End', status: 'success', severity: 'normal', rawLines: [7, 8] },
    collab: { label: 'Collab Agent Spawn End', status: 'success', severity: 'normal', rawLines: [9, 10] },
  });
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
