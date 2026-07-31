'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRESENTATION_CLAIMED_RAW_POLICY,
  deriveCodeModeFacts,
  uniqueSearchableText,
} = require('../src/codex-code-mode-facts');
const { projectCodeModeOperations } = require('../src/codex-code-mode');
const { rawRef } = require('../src/codex-source');

function raw(line, fields = {}) {
  const payloadType = fields.payloadType || '';
  const recordType = fields.recordType || 'event_msg';
  const payload = {
    type: payloadType,
    ...(fields.payload || {}),
  };
  return {
    rawId: `facts-session:raw:${line}`,
    sessionId: 'facts-session',
    line,
    source: { file: 'fixtures/code-mode/facts.jsonl', line },
    timestamp: `2026-07-14T01:00:${String(line).padStart(2, '0')}.000Z`,
    turnId: 'turn-facts',
    recordType,
    payloadType,
    canonicalType: payloadType,
    role: fields.role || '',
    callId: fields.callId || payload.call_id || '',
    toolName: fields.toolName || payload.name || '',
    status: fields.status || '',
    output: fields.output || '',
    parsed: { type: recordType, payload },
  };
}

function execCall(line, callId, input) {
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'custom_tool_call',
    callId,
    toolName: 'exec',
    output: input,
    payload: { name: 'exec', call_id: callId, input },
  });
}

function execOutput(line, callId, output) {
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'custom_tool_call_output',
    callId,
    output,
    payload: { call_id: callId, output },
  });
}

function waitCall(line, callId, cellId) {
  const args = JSON.stringify({ cell_id: cellId });
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'function_call',
    callId,
    toolName: 'wait',
    output: args,
    payload: { name: 'wait', call_id: callId, arguments: args },
  });
}

function waitOutput(line, callId, output) {
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'function_call_output',
    callId,
    output,
    payload: { call_id: callId, output },
  });
}

function logical(id, raws, fields = {}) {
  return {
    id,
    layer: fields.layer || 'main',
    kind: fields.kind || 'other_tool_call',
    subtype: fields.subtype || '',
    callId: fields.callId || '',
    rawRefs: raws.map(rawRef),
  };
}

test('derives presentation-neutral raw, search, nested-event, and phase-event facts', () => {
  const rawEvents = [
    execCall(1, 'exec-facts', 'const outerNeedle = "shared-script";'),
    raw(2, { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
    raw(3, { payloadType: 'patch_apply_begin', callId: 'nested-patch' }),
    raw(4, { payloadType: 'patch_apply_end', callId: 'nested-patch' }),
    raw(5, { payloadType: 'patch_apply_end_extra', callId: 'lookalike' }),
    execOutput(6, 'exec-facts', 'Script running with cell ID 4242\nLive output:\nfirst-output'),
    waitCall(7, 'wait-facts', '4242'),
    raw(8, { payloadType: 'mcp_tool_call_end', callId: 'nested-mcp' }),
    waitOutput(9, 'wait-facts', 'Script completed\nfinal-output'),
  ];
  const projection = projectCodeModeOperations(rawEvents);
  const logicalEvents = [
    logical('phase-exec', [rawEvents[0], rawEvents[2], rawEvents[5]]),
    logical('ordinary-main', [rawEvents[1]], { callId: 'exec-facts' }),
    logical('nested-patch', [rawEvents[2], rawEvents[3]], { kind: 'patch' }),
    logical('lookalike-lifecycle', [rawEvents[4]], { kind: 'patch' }),
    logical('phase-wait', [rawEvents[6], rawEvents[8]]),
    logical('nested-mcp', [rawEvents[7]], { kind: 'mcp_call' }),
    logical('cross-span', [rawEvents[3], rawEvents[7]], { kind: 'mcp_call' }),
  ];
  const projectionBefore = JSON.stringify(projection);
  const logicalBefore = JSON.stringify(logicalEvents);
  const facts = deriveCodeModeFacts({
    projection,
    rawEvents,
    logicalEvents,
    lifecycleTypes: new Set(['patch_apply_begin', 'patch_apply_end', 'mcp_tool_call_end']),
  });
  const operationFacts = facts.operationFacts[0];

  assert.equal(facts.claimedRawPolicy, PRESENTATION_CLAIMED_RAW_POLICY);
  assert.deepEqual(operationFacts.rawRefs.map((ref) => ref.rawId), [
    'facts-session:raw:1',
    'facts-session:raw:6',
    'facts-session:raw:7',
    'facts-session:raw:9',
  ]);
  assert.deepEqual(operationFacts.eventRefs, ['nested-patch', 'nested-mcp']);
  assert.deepEqual(operationFacts.phaseEventRefs, [
    { phaseIndex: 0, callRawId: 'facts-session:raw:1', eventId: 'phase-exec' },
    { phaseIndex: 1, callRawId: 'facts-session:raw:7', eventId: 'phase-wait' },
  ]);
  assert.match(operationFacts.searchableText, /shared-script/);
  assert.match(operationFacts.searchableText, /first-output/);
  assert.match(operationFacts.searchableText, /final-output/);
  assert.doesNotMatch(operationFacts.searchableText, /nested-patch|nested-mcp/);
  assert.equal(operationFacts.eventRefs.includes('ordinary-main'), false);
  assert.equal(operationFacts.eventRefs.includes('cross-span'), false);
  assert.equal(operationFacts.eventRefs.includes('lookalike-lifecycle'), false);
  assert.equal(JSON.stringify(projection), projectionBefore);
  assert.equal(JSON.stringify(logicalEvents), logicalBefore);
});

test('requires an exact lifecycle Set and never uses lifecycle name prefixes', () => {
  const rawEvents = [
    execCall(1, 'exec-exact-set', 'fixture script'),
    raw(2, { payloadType: 'patch_apply_end_extra', callId: 'nested-lookalike' }),
    execOutput(3, 'exec-exact-set', 'Script completed'),
  ];
  const projection = projectCodeModeOperations(rawEvents);
  const logicalEvents = [logical('nested-lookalike', [rawEvents[1]], { kind: 'patch' })];

  assert.throws(() => deriveCodeModeFacts({
    projection,
    rawEvents,
    logicalEvents,
    lifecycleTypes: ['patch_apply_end'],
  }), /exact Set/);
  assert.deepEqual(deriveCodeModeFacts({
    projection,
    rawEvents,
    logicalEvents,
    lifecycleTypes: new Set(['patch_apply_end']),
  }).operationFacts[0].eventRefs, []);
});

test('matches phase Logical Events by call raw identity rather than call id', () => {
  const rawEvents = [
    execCall(1, 'same-call-id', 'fixture script'),
    raw(2, { payloadType: 'patch_apply_end', callId: 'nested-call' }),
    execOutput(3, 'same-call-id', 'Script completed'),
  ];
  const projection = projectCodeModeOperations(rawEvents);
  const logicalEvents = [
    logical('call-id-only-imposter', [rawEvents[1]], { callId: 'same-call-id' }),
    logical('actual-phase-event', [rawEvents[0], rawEvents[2]]),
  ];
  const facts = deriveCodeModeFacts({
    projection,
    rawEvents,
    logicalEvents,
    lifecycleTypes: new Set(),
  });

  assert.deepEqual(facts.operationFacts[0].phaseEventRefs, [{
    phaseIndex: 0,
    callRawId: 'facts-session:raw:1',
    eventId: 'actual-phase-event',
  }]);

  const ambiguousFacts = deriveCodeModeFacts({
    projection,
    rawEvents,
    logicalEvents: [
      ...logicalEvents,
      logical('duplicate-phase-owner', rawEvents),
    ],
    lifecycleTypes: new Set(['patch_apply_end']),
  });
  assert.equal(ambiguousFacts.operationFacts[0].phaseEventRefs[0].eventId, '');
  assert.deepEqual(ambiguousFacts.operationFacts[0].eventRefs, ['call-id-only-imposter']);
});

test('claims ambiguous outer output without assigning it to duplicate call-only operations', () => {
  const rawEvents = [
    execCall(1, 'duplicate-outer', 'first outer script'),
    execCall(2, 'duplicate-outer', 'second outer script'),
    execOutput(3, 'duplicate-outer', 'Script completed\nambiguous output'),
  ];
  const projection = projectCodeModeOperations(rawEvents);
  const logicalEvents = [
    logical('phase-first', [rawEvents[0]]),
    logical('phase-second', [rawEvents[1]]),
    logical('fallback-output-owner', [rawEvents[2]]),
  ];
  const facts = deriveCodeModeFacts({
    projection,
    rawEvents,
    logicalEvents,
    lifecycleTypes: new Set(),
  });

  assert.equal(projection.operations.length, 2);
  assert.ok(projection.operations.every((operation) => operation.evidenceState === 'call_only'));
  assert.deepEqual(facts.operationFacts.map((operation) => operation.rawRefs.map((ref) => ref.rawId)), [
    ['facts-session:raw:1'],
    ['facts-session:raw:2'],
  ]);
  assert.deepEqual(facts.operationFacts.map((operation) => operation.phaseEventRefs[0].eventId), [
    'phase-first',
    'phase-second',
  ]);
  assert.deepEqual(facts.claimedRawIds, [
    'facts-session:raw:1',
    'facts-session:raw:2',
    'facts-session:raw:3',
  ]);
  assert.ok(facts.operationFacts.every((operation) => operation.eventRefs.length === 0));
  assert.ok(facts.operationFacts.every((operation) => !operation.searchableText.includes('ambiguous output')));
  assert.ok(facts.operationFacts.every((operation) => operation.phaseEventRefs[0].eventId !== 'fallback-output-owner'));
});

test('deduplicates accumulated searchable text without losing later content', () => {
  assert.equal(uniqueSearchableText([
    'outer script',
    'first output',
    'first output\nfinal output',
    'final output',
  ]), 'outer script\nfirst output\nfinal output');
});
