'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyObservedOutput,
  codeModeDisplayOutputText,
  codeModeOutputText,
  projectCodeModeOperations,
} = require('../src/codex-code-mode');
const { deriveCodeModeFacts } = require('../src/codex-code-mode-facts');

const CODE_MODE_FIXTURE_DIR = path.join(__dirname, 'fixtures', 'code-mode');

function raw(line, fields = {}) {
  const payloadType = fields.payloadType || '';
  const payload = {
    type: payloadType,
    ...(fields.payload || {}),
  };
  return {
    rawId: `session-redacted:raw:${line}`,
    sessionId: fields.sessionId || 'session-redacted',
    line,
    source: { file: fields.file || 'fixtures/code-mode/redacted.jsonl', line },
    turnId: fields.turnId || 'turn-a',
    recordType: fields.recordType || 'response_item',
    payloadType,
    canonicalType: fields.canonicalType || payloadType,
    callId: fields.callId || '',
    toolName: fields.toolName || '',
    output: fields.output || '',
    parsed: { payload },
  };
}

function execCall(line, callId, fields = {}) {
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'custom_tool_call',
    toolName: 'exec',
    callId,
    payload: { name: 'exec', input: '// redacted fixture' },
    ...fields,
  });
}

function execOutput(line, callId, output, fields = {}) {
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'custom_tool_call_output',
    callId,
    payload: { output },
    ...fields,
  });
}

function waitCall(line, callId, cellId, fields = {}) {
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'function_call',
    toolName: 'wait',
    callId,
    payload: { name: 'wait', arguments: JSON.stringify({ cell_id: cellId }) },
    ...fields,
  });
}

function waitOutput(line, callId, output, fields = {}) {
  return raw(line, {
    recordType: 'response_item',
    payloadType: 'function_call_output',
    callId,
    payload: { output },
    ...fields,
  });
}

function fixtureRawEvents(file) {
  const fixturePath = path.join(CODE_MODE_FIXTURE_DIR, file);
  const sourceFile = `test/fixtures/code-mode/${file}`;
  return fs.readFileSync(fixturePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const record = JSON.parse(line);
      const payload = record.payload || {};
      const lineNumber = index + 1;
      const outputValue = payload.output ?? payload.input ?? payload.arguments ?? '';
      return {
        rawId: `${file}:raw:${lineNumber}`,
        sessionId: file,
        line: lineNumber,
        source: { file: sourceFile, line: lineNumber },
        timestamp: record.timestamp || '',
        turnId: payload.turn_id || '',
        recordType: record.type || '',
        payloadType: payload.type || '',
        canonicalType: payload.type || '',
        callId: payload.call_id || '',
        toolName: payload.name || payload.tool_name || payload.tool || '',
        output: typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue),
        parsed: record,
      };
    });
}

test('projects a direct terminal exec without retaining JavaScript or output content', () => {
  const lifecycle = raw(2, {
    recordType: 'event_msg',
    payloadType: 'patch_apply_end',
  });
  const projection = projectCodeModeOperations([
    execCall(1, 'exec-direct'),
    lifecycle,
    execOutput(3, 'exec-direct', [{ type: 'text', text: 'Script failed\nredacted diagnostic' }]),
  ]);

  assert.equal(projection.operations.length, 1);
  assert.equal(projection.unassociatedWaits.length, 0);
  assert.deepEqual(projection.operations[0], {
    id: 'session-redacted:code-mode:exec-direct:1',
    sessionId: 'session-redacted',
    outerCallId: 'exec-direct',
    turnId: 'turn-a',
    cellId: '',
    evidenceState: 'output_observed',
    observationState: 'terminal',
    pairingIssue: '',
    phases: [{
      kind: 'exec',
      callId: 'exec-direct',
      targetCellId: '',
      evidenceState: 'output_observed',
      observationState: 'terminal',
      observedCellId: '',
      callRef: { rawId: 'session-redacted:raw:1', file: 'fixtures/code-mode/redacted.jsonl', line: 1 },
      outputRef: { rawId: 'session-redacted:raw:3', file: 'fixtures/code-mode/redacted.jsonl', line: 3 },
      span: {
        file: 'fixtures/code-mode/redacted.jsonl',
        startLine: 1,
        endLine: 3,
        startRawId: 'session-redacted:raw:1',
        endRawId: 'session-redacted:raw:3',
      },
    }],
    phaseSpans: [{
      phaseIndex: 0,
      kind: 'exec',
      callId: 'exec-direct',
      file: 'fixtures/code-mode/redacted.jsonl',
      startLine: 1,
      endLine: 3,
      startRawId: 'session-redacted:raw:1',
      endRawId: 'session-redacted:raw:3',
    }],
  });
  assert.doesNotMatch(JSON.stringify(projection), /redacted diagnostic|redacted fixture/);
});

test('decodes text arrays recursively and only accepts the canonical pending first line', () => {
  const nestedOutput = execOutput(1, 'exec-text', [{
    type: 'text',
    text: 'Script running with cell ID 12345\nLive output:\nfixture',
  }]);
  assert.equal(codeModeOutputText(nestedOutput), 'Script running with cell ID 12345\nLive output:\nfixture');
  assert.deepEqual(classifyObservedOutput(nestedOutput), {
    observationState: 'pending',
    cellId: '12345',
  });
  assert.deepEqual(classifyObservedOutput(execOutput(2, 'exec-malformed', 'Script running with cell ID abc')), {
    observationState: 'unknown',
    cellId: '',
  });
  assert.deepEqual(classifyObservedOutput(execOutput(3, 'exec-complete', 'Script terminated')), {
    observationState: 'terminal',
    cellId: '',
  });
  assert.deepEqual(classifyObservedOutput(execOutput(4, 'exec-arbitrary', 'Sanitized arbitrary output')), {
    observationState: 'unknown',
    cellId: '',
  });
});

test('Code Mode display output removes an empty outer status envelope without changing classification', () => {
  const output = execOutput(1, 'exec-display', [
    { type: 'input_text', text: 'Script completed\nWall time 3.3 seconds\nOutput:\n' },
    { type: 'input_text', text: 'Exit code: 0\nWall time: 3 seconds\nOutput:\n\u001b[32;1mFullName\u001b[0m' },
  ]);

  assert.equal(codeModeOutputText(output), 'Script completed\nWall time 3.3 seconds\nOutput:\n\nExit code: 0\nWall time: 3 seconds\nOutput:\n\u001b[32;1mFullName\u001b[0m');
  assert.deepEqual(classifyObservedOutput(output), { observationState: 'terminal', cellId: '' });
  assert.equal(codeModeDisplayOutputText(output), 'Exit code: 0\nWall time: 3 seconds\nOutput:\nFullName');
});

test('only exposes phase spans for ordered rows in the same physical source file', () => {
  const differentFiles = projectCodeModeOperations([
    execCall(1, 'exec-different-files', { file: 'fixtures/code-mode/a.jsonl' }),
    execOutput(2, 'exec-different-files', 'Script completed', { file: 'fixtures/code-mode/b.jsonl' }),
  ]).operations[0];
  const sameLine = projectCodeModeOperations([
    execCall(1, 'exec-same-line'),
    execOutput(1, 'exec-same-line', 'Script completed'),
  ]).operations[0];
  const invalidLineCall = execCall(1, 'exec-invalid-line');
  invalidLineCall.line = Number.NaN;
  const invalidLine = projectCodeModeOperations([
    invalidLineCall,
    execOutput(2, 'exec-invalid-line', 'Script completed'),
  ]).operations[0];

  assert.equal(differentFiles.evidenceState, 'output_observed');
  assert.equal(differentFiles.observationState, 'terminal');
  assert.equal(differentFiles.phases[0].span, null);
  assert.deepEqual(differentFiles.phaseSpans, []);
  assert.equal(sameLine.phases[0].span, null);
  assert.deepEqual(sameLine.phaseSpans, []);
  assert.equal(invalidLine.phases[0].span, null);
  assert.deepEqual(invalidLine.phaseSpans, []);
});

test('orders a pending exec and multi-wait chain by exact cell and call ids', () => {
  const projection = projectCodeModeOperations([
    waitOutput(9, 'wait-2', 'Script completed'),
    execCall(1, 'exec-chain'),
    waitCall(7, 'wait-2', '4242'),
    execOutput(3, 'exec-chain', 'Script running with cell ID 4242\nLive output:'),
    waitOutput(6, 'wait-1', [{ type: 'text', text: 'Script running with cell ID 4242\nLive output:' }]),
    waitCall(4, 'wait-1', '4242'),
  ]);
  const operation = projection.operations[0];

  assert.equal(operation.cellId, '4242');
  assert.equal(operation.evidenceState, 'output_observed');
  assert.equal(operation.observationState, 'terminal');
  assert.deepEqual(operation.phases.map((phase) => ({
    kind: phase.kind,
    callId: phase.callId,
    targetCellId: phase.targetCellId,
    evidenceState: phase.evidenceState,
    observationState: phase.observationState,
  })), [
    { kind: 'exec', callId: 'exec-chain', targetCellId: '', evidenceState: 'output_observed', observationState: 'pending' },
    { kind: 'wait', callId: 'wait-1', targetCellId: '4242', evidenceState: 'output_observed', observationState: 'pending' },
    { kind: 'wait', callId: 'wait-2', targetCellId: '4242', evidenceState: 'output_observed', observationState: 'terminal' },
  ]);
  assert.deepEqual(operation.phaseSpans.map((span) => [span.kind, span.startLine, span.endLine]), [
    ['exec', 1, 3],
    ['wait', 4, 6],
    ['wait', 7, 9],
  ]);
});

test('keeps incomplete and end-of-file pending operations distinct', () => {
  const projection = projectCodeModeOperations([
    execCall(1, 'exec-incomplete'),
    execCall(3, 'exec-pending'),
    execOutput(4, 'exec-pending', 'Script running with cell ID 8080\nLive output:'),
    raw(5, { recordType: 'event_msg', payloadType: 'warning', turnId: 'turn-a' }),
  ]);
  const byCall = new Map(projection.operations.map((operation) => [operation.outerCallId, operation]));

  assert.equal(byCall.get('exec-incomplete').evidenceState, 'call_only');
  assert.equal(byCall.get('exec-incomplete').observationState, 'unknown');
  assert.equal(byCall.get('exec-incomplete').phases[0].span, null);
  assert.equal(byCall.get('exec-pending').evidenceState, 'output_observed');
  assert.equal(byCall.get('exec-pending').observationState, 'pending');
  assert.equal(byCall.get('exec-pending').cellId, '8080');
});

test('only an explicit completed or new turn boundary makes pending unobserved', () => {
  const taskComplete = raw(3, {
    recordType: 'event_msg',
    payloadType: 'task_complete',
    canonicalType: 'task_complete',
    turnId: 'turn-a',
  });
  const nextTurn = raw(13, {
    recordType: 'event_msg',
    payloadType: 'task_started',
    canonicalType: 'task_started',
    turnId: 'turn-b',
  });
  const projection = projectCodeModeOperations([
    execCall(1, 'exec-ended'),
    execOutput(2, 'exec-ended', 'Script running with cell ID 1001\nLive output:'),
    taskComplete,
    execCall(10, 'exec-next-turn', { turnId: 'turn-a' }),
    execOutput(11, 'exec-next-turn', 'Script running with cell ID 1002\nLive output:', { turnId: 'turn-a' }),
    raw(12, { recordType: 'event_msg', payloadType: 'warning', turnId: 'turn-a' }),
    nextTurn,
  ]);
  assert.deepEqual(projection.operations.map((operation) => operation.observationState), [
    'unobserved_terminal',
    'unobserved_terminal',
  ]);
});

test('associates parallel cells exactly and preserves orphan waits', () => {
  const projection = projectCodeModeOperations([
    execCall(1, 'exec-a'),
    execOutput(2, 'exec-a', 'Script running with cell ID 2001\nLive output:'),
    execCall(3, 'exec-b'),
    execOutput(4, 'exec-b', 'Script running with cell ID 2002\nLive output:'),
    waitCall(5, 'wait-b', '2002'),
    waitOutput(6, 'wait-b', 'Script completed'),
    waitCall(7, 'wait-orphan', '9999'),
    waitOutput(8, 'wait-orphan', 'Script completed'),
    waitCall(9, 'wait-a', '2001'),
    waitOutput(10, 'wait-a', 'Script terminated'),
  ]);
  const byCall = new Map(projection.operations.map((operation) => [operation.outerCallId, operation]));

  assert.deepEqual(byCall.get('exec-a').phases.map((phase) => phase.callId), ['exec-a', 'wait-a']);
  assert.deepEqual(byCall.get('exec-b').phases.map((phase) => phase.callId), ['exec-b', 'wait-b']);
  assert.equal(byCall.get('exec-a').observationState, 'terminal');
  assert.equal(byCall.get('exec-b').observationState, 'terminal');
  assert.deepEqual(projection.unassociatedWaits.map((wait) => ({
    reason: wait.reason,
    callId: wait.phase.callId,
  })), [{ reason: 'orphan_cell', callId: 'wait-orphan' }]);
});

test('does not guess across duplicate active cells or ambiguous outer call ids', () => {
  const projection = projectCodeModeOperations([
    execCall(1, 'exec-same-a'),
    execOutput(2, 'exec-same-a', 'Script running with cell ID 3001\nLive output:'),
    execCall(3, 'exec-same-b'),
    execOutput(4, 'exec-same-b', 'Script running with cell ID 3001\nLive output:'),
    waitCall(5, 'wait-ambiguous-cell', '3001'),
    waitOutput(6, 'wait-ambiguous-cell', 'Script completed'),
    execCall(10, 'exec-duplicate'),
    execCall(11, 'exec-duplicate'),
    execOutput(12, 'exec-duplicate', 'Script completed'),
  ]);
  const duplicateOperations = projection.operations.filter((operation) => operation.outerCallId === 'exec-duplicate');

  assert.equal(projection.unassociatedWaits[0].reason, 'ambiguous_cell');
  assert.ok(projection.operations.filter((operation) => operation.cellId === '3001')
    .every((operation) => operation.observationState === 'pending'));
  assert.equal(duplicateOperations.length, 2);
  assert.ok(duplicateOperations.every((operation) => operation.pairingIssue === 'ambiguous_call_id'));
  assert.ok(duplicateOperations.every((operation) => operation.evidenceState === 'call_only'));
  assert.ok(duplicateOperations.every((operation) => operation.observationState === 'unknown'));
});

test('formal sanitized fixtures cover the Code Mode operation scenarios', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CODE_MODE_FIXTURE_DIR, 'manifest.json'), 'utf8'));
  const scenarios = new Set(manifest.fixtures.map((fixture) => fixture.scenario));

  assert.deepEqual(scenarios, new Set([
    'direct_terminal_with_nested_lifecycle',
    'pending_multi_wait',
    'incomplete_tail',
    'unobserved_terminal',
    'outer_js_is_not_nested_evidence',
  ]));

  for (const fixture of manifest.fixtures) {
    const rawEvents = fixtureRawEvents(fixture.file);
    const projection = projectCodeModeOperations(rawEvents);
    const operation = projection.operations.find((candidate) => candidate.outerCallId === fixture.outerCallId);
    assert.ok(operation, `${fixture.file} should project its outer exec`);
    assert.equal(operation.observationState, fixture.observationState, fixture.file);
    assert.equal(operation.phases.length, fixture.phaseCount, fixture.file);
    assert.doesNotMatch(JSON.stringify(projection), /require_escalated|tools\.|Sanitized fixture output/);
  }

  const direct = projectCodeModeOperations(fixtureRawEvents('direct-terminal.jsonl')).operations[0];
  const chain = projectCodeModeOperations(fixtureRawEvents('pending-multi-wait.jsonl')).operations[0];
  assert.ok(direct.phaseSpans.some((span) => span.startLine < 2 && span.endLine > 2));
  assert.ok(chain.phaseSpans.some((span) => span.startLine < 6 && span.endLine > 6));
  assert.equal(direct.phaseSpans[0].file, 'test/fixtures/code-mode/direct-terminal.jsonl');
});

test('associates nested lifecycle ownership only inside one unique closed phase span', () => {
  const rawEvents = [
    execCall(1, 'exec-a'),
    execCall(2, 'exec-b'),
    execOutput(9, 'exec-b', 'Script completed'),
    execOutput(10, 'exec-a', 'Script completed'),
    execCall(20, 'exec-unique'),
    execOutput(30, 'exec-unique', 'Script completed'),
  ];
  const projection = projectCodeModeOperations(rawEvents);
  const lifecycleTypes = new Set(['mcp_tool_call_begin', 'mcp_tool_call_end']);
  const nestedEvent = (id, lines) => ({
    id,
    rawRefs: lines.map((line) => ({
      rawId: `${id}:${line}`,
      file: 'fixtures/code-mode/redacted.jsonl',
      line,
      sourceEventType: line === lines[0] ? 'mcp_tool_call_begin' : 'mcp_tool_call_end',
    })),
  });

  const facts = deriveCodeModeFacts({
    projection,
    rawEvents,
    logicalEvents: [
      nestedEvent('ambiguous', [3, 4]),
      nestedEvent('cross-boundary', [8, 21]),
      nestedEvent('unique', [22, 23]),
    ],
    lifecycleTypes,
  });

  assert.deepEqual(projection.operations.map((operation) => [
    operation.outerCallId,
    facts.operationFacts.find((item) => item.operationId === operation.id).eventRefs,
  ]), [
    ['exec-a', []],
    ['exec-b', []],
    ['exec-unique', ['unique']],
  ]);
});
