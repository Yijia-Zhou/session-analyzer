'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CODE_MODE_REQUEST_EVIDENCE,
  buildCodeModePresentationIndexes,
  codeModeDeclaredRequestFact,
  codeModeExecSource,
  codeModePresentationFactsForEvent,
  codeModeRequestCatalog,
  isCodeModeScriptOperation,
  normalizeCodeModeRequest,
} = require('../src/codex-code-mode-presentation');

function operation(id, rawId) {
  return {
    id,
    layer: 'main',
    kind: 'code_mode_operation',
    toolName: 'exec',
    codeModeOperation: {
      id,
      outerCallId: id,
      phases: [{ kind: 'exec', callId: id, callRef: { rawId } }],
    },
  };
}

function raw(rawId, input, callId = 'operation') {
  return {
    rawId,
    recordType: 'response_item',
    payloadType: 'custom_tool_call',
    toolName: 'exec',
    callId,
    parsed: { payload: { name: 'exec', input } },
  };
}

test('Code Mode exec source follows the exact exec phase raw identity', () => {
  const event = operation('operation', 'exec-raw');
  const raws = new Map([
    ['other-raw', raw('other-raw', 'await tools.update_plan({});', 'other')],
    ['exec-raw', raw('exec-raw', 'await tools.shell_command({ command: "pwd" });')],
  ]);
  assert.equal(codeModeExecSource(event, raws), 'await tools.shell_command({ command: "pwd" });');
  assert.equal(codeModeExecSource({ ...event, kind: 'other_tool_call' }, raws), '');
});

test('Code Mode request query values accept only stable projector tool names', () => {
  assert.equal(normalizeCodeModeRequest(' shell_command '), 'shell_command');
  assert.equal(normalizeCodeModeRequest('web__run'), 'web__run');
  assert.equal(normalizeCodeModeRequest('Shell command'), '');
  assert.equal(normalizeCodeModeRequest('unknown_tool'), '');
  assert.equal(normalizeCodeModeRequest('../shell_command'), '');
  assert.equal(normalizeCodeModeRequest('__proto__'), '');
});

test('presentation index keeps only whole-program safe declared request facts', () => {
  const shell = operation('safe-shell', 'raw-shell');
  const multiple = operation('safe-multiple', 'raw-multiple');
  const dynamic = operation('dynamic', 'raw-dynamic');
  const session = {
    logicalEvents: [shell, multiple, dynamic],
    rawEvents: [
      raw('raw-shell', 'const result = await tools.shell_command({ command: "pwd" }); text(result);', 'safe-shell'),
      raw('raw-multiple', `
        await tools.update_plan({ plan: [] });
        await tools.update_plan({ plan: [] });
        await tools.web__run({ search_query: [{ q: "fixture" }] });
      `, 'safe-multiple'),
      raw('raw-dynamic', 'if (enabled) await tools.shell_command({ command: "pwd" });', 'dynamic'),
    ],
  };
  session.presentationIndexes = buildCodeModePresentationIndexes(session);

  assert.deepEqual(session.presentationIndexes.codeModeDeclaredRequests.get(shell.id), {
    toolNames: ['shell_command'],
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  });
  assert.deepEqual(session.presentationIndexes.codeModeDeclaredRequests.get(multiple.id), {
    toolNames: ['update_plan', 'web__run'],
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  });
  assert.equal(session.presentationIndexes.codeModeDeclaredRequests.has(dynamic.id), false);
  assert.deepEqual(codeModePresentationFactsForEvent(session, multiple.id), {
    codeModeDeclaredRequests: {
      toolNames: ['update_plan', 'web__run'],
      requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
    },
  });
});

test('presentation index keeps a direct output-member emission as a safe declared request', () => {
  const event = operation('output-member', 'raw-output-member');
  const session = {
    logicalEvents: [event],
    rawEvents: [raw(
      'raw-output-member',
      'const result = await tools.exec_command({ command: "pwd" }); text(result.output);',
      event.id,
    )],
  };
  session.presentationIndexes = buildCodeModePresentationIndexes(session);

  assert.equal(isCodeModeScriptOperation(event, session.presentationIndexes), false);
  assert.deepEqual(session.presentationIndexes.codeModeDeclaredRequests.get(event.id), {
    toolNames: ['exec_command'],
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  });
  assert.deepEqual(codeModePresentationFactsForEvent(session, event.id), {
    codeModeDeclaredRequests: {
      toolNames: ['exec_command'],
      requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
    },
  });
});

test('request facts do not mutate canonical events and projector failure contributes nothing', () => {
  const event = operation('operation', 'raw');
  const before = structuredClone(event);
  const rawById = new Map([['raw', raw('raw', 'await tools.unknown_tool({ value: 1 });')]]);
  assert.equal(codeModeDeclaredRequestFact(event, rawById), null);
  assert.deepEqual(event, before);
});

test('request catalog counts operations once per tool and keeps stable machine values', () => {
  const sessions = [{
    presentationIndexes: {
      codeModeDeclaredRequests: new Map([
        ['first', { toolNames: ['shell_command', 'shell_command'], requestEvidence: CODE_MODE_REQUEST_EVIDENCE }],
        ['second', { toolNames: ['shell_command', 'update_plan'], requestEvidence: CODE_MODE_REQUEST_EVIDENCE }],
      ]),
    },
  }];
  assert.deepEqual(codeModeRequestCatalog(sessions, {
    label: (value) => ({ shell_command: 'Shell command', update_plan: 'Plan update' }[value]),
  }), [
    { value: 'update_plan', label: 'Plan update', count: 1, evidence: CODE_MODE_REQUEST_EVIDENCE },
    { value: 'shell_command', label: 'Shell command', count: 2, evidence: CODE_MODE_REQUEST_EVIDENCE },
  ]);
});

test('exact exec-source lookup fails closed unless one matching outer exec owns the raw record', () => {
  const event = operation('operation', 'raw');
  const source = 'await tools.get_goal({});';
  const record = raw('raw', source);
  const twoExecPhases = structuredClone(event);
  twoExecPhases.codeModeOperation.phases.push({
    kind: 'exec',
    callId: 'operation',
    callRef: { rawId: 'another-raw' },
  });
  const operationIdMismatch = structuredClone(event);
  operationIdMismatch.codeModeOperation.id = 'other-operation';
  const outerCallIdMismatch = structuredClone(event);
  outerCallIdMismatch.codeModeOperation.outerCallId = 'other-operation';

  const cases = [
    ['no exec phase', {
      ...event,
      codeModeOperation: { ...event.codeModeOperation, phases: [] },
    }, record],
    ['more than one exec phase', twoExecPhases, record],
    ['mismatched operation identity', operationIdMismatch, record],
    ['mismatched outer call identity', outerCallIdMismatch, record],
    ['wrong raw record type', event, { ...record, recordType: 'event_msg' }],
    ['wrong raw payload type', event, { ...record, payloadType: 'function_call' }],
    ['wrong raw tool name', event, { ...record, toolName: 'shell_command' }],
    ['wrong payload tool name', event, {
      ...record,
      parsed: { payload: { ...record.parsed.payload, name: 'shell_command' } },
    }],
    ['mismatched raw call id', event, { ...record, callId: 'other-operation' }],
  ];

  for (const [label, candidate, candidateRaw] of cases) {
    const rawById = new Map([['raw', candidateRaw]]);
    assert.equal(codeModeExecSource(candidate, rawById), '', label);
    assert.equal(codeModeDeclaredRequestFact(candidate, rawById), null, label);
  }
});

test('exact exec-source lookup gives an own input priority over raw output', () => {
  const event = operation('operation', 'raw');
  const ownInput = raw('raw', 'await tools.get_goal({});');
  ownInput.output = 'await tools.shell_command({ command: "sanitized fallback" });';

  const outputFallback = raw('raw', undefined);
  delete outputFallback.parsed.payload.input;
  outputFallback.output = 'await tools.update_plan({ plan: [] });';

  const inheritedInput = raw('raw', undefined);
  delete inheritedInput.parsed.payload.input;
  Object.setPrototypeOf(inheritedInput.parsed.payload, {
    input: 'await tools.get_goal({});',
  });
  inheritedInput.output = 'await tools.web__run({ search_query: [{ q: "sanitized fallback" }] });';

  const unusableOwnInput = raw('raw', null);
  unusableOwnInput.output = 'await tools.shell_command({ command: "sanitized fallback" });';

  assert.equal(codeModeExecSource(event, new Map([['raw', ownInput]])), ownInput.parsed.payload.input);
  assert.deepEqual(codeModeDeclaredRequestFact(event, new Map([['raw', ownInput]])), {
    toolNames: ['get_goal'],
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  });
  assert.equal(codeModeExecSource(event, new Map([['raw', outputFallback]])), outputFallback.output);
  assert.deepEqual(codeModeDeclaredRequestFact(event, new Map([['raw', outputFallback]])), {
    toolNames: ['update_plan'],
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  });
  assert.equal(codeModeExecSource(event, new Map([['raw', inheritedInput]])), inheritedInput.output);
  assert.deepEqual(codeModeDeclaredRequestFact(event, new Map([['raw', inheritedInput]])), {
    toolNames: ['web__run'],
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  });
  assert.equal(codeModeExecSource(event, new Map([['raw', unusableOwnInput]])), '');
  assert.equal(codeModeDeclaredRequestFact(event, new Map([['raw', unusableOwnInput]])), null);
});

test('presentation index retains only name-only facts for safe single, multi, and duplicate declarations', () => {
  const single = operation('safe-single', 'raw-single');
  const multiple = operation('safe-multiple', 'raw-multiple');
  const duplicate = operation('safe-duplicate', 'raw-duplicate');
  const session = {
    logicalEvents: [single, multiple, duplicate],
    rawEvents: [
      raw('raw-single', 'await tools.shell_command({ command: "sanitized single" });', single.id),
      raw('raw-multiple', `
        await tools.update_plan({ plan: [] });
        await tools.web__run({ search_query: [{ q: 'sanitized multi' }] });
      `, multiple.id),
      raw('raw-duplicate', `
        await tools.shell_command({ command: 'sanitized first' });
        await tools.update_plan({ plan: [] });
        await tools.shell_command({ command: 'sanitized duplicate' });
      `, duplicate.id),
    ],
  };
  const indexes = buildCodeModePresentationIndexes(session);

  assert.deepEqual([...indexes.codeModeDeclaredRequests.entries()], [
    [single.id, { toolNames: ['shell_command'], requestEvidence: CODE_MODE_REQUEST_EVIDENCE }],
    [multiple.id, { toolNames: ['update_plan', 'web__run'], requestEvidence: CODE_MODE_REQUEST_EVIDENCE }],
    [duplicate.id, { toolNames: ['shell_command', 'update_plan'], requestEvidence: CODE_MODE_REQUEST_EVIDENCE }],
  ]);
  for (const fact of indexes.codeModeDeclaredRequests.values()) {
    assert.deepEqual(Object.keys(fact).sort(), ['requestEvidence', 'toolNames']);
    assert.doesNotMatch(JSON.stringify(fact), /sanitized (single|multi|first|duplicate)/);
  }
});

test('whole-program fallback sources never create presentation facts', () => {
  const sourceTooLarge = `${' '.repeat(100_001)}await tools.get_goal({});`;
  const tooManyCalls = Array.from({ length: 25 }, () => 'await tools.get_goal({});').join('\n');
  let tooDeepLiteral = 'true';
  for (let depth = 0; depth < 17; depth += 1) tooDeepLiteral = `{ value: ${tooDeepLiteral} }`;
  const tooManyLiteralNodes = Array.from({ length: 1_001 }, (_, index) => String(index)).join(', ');
  const cases = [
    ['dynamic-arguments', 'const request = { command: "sanitized" }; await tools.shell_command(request);'],
    ['branch', 'if (enabled) await tools.update_plan({ plan: [] });'],
    ['loop', 'for (const item of items) await tools.update_plan({ plan: [] });'],
    ['concurrency', 'await Promise.all([tools.update_plan({ plan: [] })]);'],
    ['unknown-tool', 'await tools.unknown_tool({ value: "sanitized" });'],
    ['syntax-error', 'await tools.update_plan({ plan: [] };'],
    ['source-budget', sourceTooLarge],
    ['call-budget', tooManyCalls],
    ['literal-depth-budget', `await tools.update_plan(${tooDeepLiteral});`],
    ['literal-node-budget', `await tools.update_plan({ plan: [${tooManyLiteralNodes}] });`],
  ];
  const session = {
    logicalEvents: cases.map(([id]) => operation(id, `raw-${id}`)),
    rawEvents: cases.map(([id, source]) => raw(`raw-${id}`, source, id)),
  };
  const indexes = buildCodeModePresentationIndexes(session);

  assert.equal(indexes.codeModeDeclaredRequests.size, 0);
  for (const [id] of cases) {
    assert.equal(indexes.codeModeDeclaredRequests.has(id), false, id);
    assert.equal(codeModePresentationFactsForEvent({ presentationIndexes: indexes }, id), null, id);
  }
});

test('building presentation indexes leaves logical and raw serializations unchanged', () => {
  const safe = operation('safe', 'raw-safe');
  const unsupported = operation('unsupported', 'raw-unsupported');
  const session = {
    logicalEvents: [safe, unsupported],
    rawEvents: [
      raw('raw-safe', 'await tools.shell_command({ command: "sanitized immutable" });', safe.id),
      raw('raw-unsupported', 'if (enabled) await tools.update_plan({ plan: [] });', unsupported.id),
    ],
  };
  const logicalBefore = JSON.stringify(session.logicalEvents);
  const rawBefore = JSON.stringify(session.rawEvents);

  session.presentationIndexes = buildCodeModePresentationIndexes(session);

  assert.equal(JSON.stringify(session.logicalEvents), logicalBefore);
  assert.equal(JSON.stringify(session.rawEvents), rawBefore);
  assert.deepEqual(session.presentationIndexes.codeModeDeclaredRequests.get(safe.id), {
    toolNames: ['shell_command'],
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  });
  assert.equal(session.presentationIndexes.codeModeDeclaredRequests.has(unsupported.id), false);
});
