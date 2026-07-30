'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildEventDetail,
  buildIndex,
  eventKindCatalog,
  getEvent,
  getTimeline,
} = require('../src/codex');
const {
  CODE_MODE_REQUEST_EVIDENCE,
} = require('../src/shared/code-mode-presentation-contract');

async function candidateIndex(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-code-mode-a-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '14');
  await fsp.mkdir(dir, { recursive: true });
  const records = [
    { type: 'session_meta', timestamp: '2026-07-14T00:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-a', turn_id: 'turn-a', input: "const value = await tools.shell_command({ command: 'echo fixture', sandbox_permissions: 'require_escalated' }); text(value);" } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:02.000Z', payload: { type: 'custom_tool_call_output', call_id: 'exec-a', turn_id: 'turn-a', output: 'Script running with cell ID 4242\nexec-output-token' } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:03.000Z', payload: { type: 'function_call', name: 'wait', call_id: 'wait-a', turn_id: 'turn-a', arguments: '{"cell_id":"4242"}' } },
    { type: 'event_msg', timestamp: '2026-07-14T00:00:04.000Z', payload: { type: 'mcp_tool_call_end', call_id: 'nested-a', turn_id: 'turn-a', tool_name: 'nested-search-token', status: 'failed' } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:05.000Z', payload: { type: 'function_call_output', call_id: 'wait-a', turn_id: 'turn-a', output: 'Script completed\nwait-output-token' } },
  ];
  await fsp.writeFile(path.join(dir, `rollout-${id}.jsonl`), `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');
  return { id, index: await buildIndex({ repoRoot, codexHome }) };
}

function timeline(index, id, filters = {}) {
  return getTimeline(index, id, { layer: 'main', offset: 0, limit: 100, locale: 'en', ...filters });
}

test('candidate A counts and searches one operation plus nested activity while waits own nothing', async (t) => {
  const { id, index } = await candidateIndex(t);
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.toolName === 'nested-search-token');

  assert.equal(session.counts.toolCalls, 2);
  assert.equal(session.counts.failedCommands, 0);
  assert.equal(session.counts.issueEvents, 1);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }, { name: 'nested-search-token', count: 1 }]);
  assert.deepEqual(session.analysis.timelineStats.find((item) => item.name === 'code_mode_operation'), {
    name: 'code_mode_operation',
    count: 1,
  });
  assert.equal(session.analysis.timelineStats.some((item) => item.name === 'other_tool_call'), false);
  assert.equal(session.logicalEvents.some((event) => event.toolName === 'wait'), false);
  assert.deepEqual(operation.codeModeOperation.eventRefs, [nested.id]);
  assert.deepEqual(session.presentationIndexes.codeModeDeclaredRequests.get(operation.id), {
    toolNames: ['shell_command'],
    requestEvidence: 'declared_source',
  });
  assert.deepEqual(index.codeModeRequests, [{
    value: 'shell_command',
    label: 'shell_command',
    count: 1,
    evidence: 'declared_source',
  }]);

  for (const query of ['require_escalated', 'exec-output-token', 'wait-output-token']) {
    const result = timeline(index, id, { q: query });
    assert.equal(result.searchEventCount, 1, query);
    assert.equal(result.events[0].id, operation.id, query);
  }
  const nestedResult = timeline(index, id, { q: 'nested-search-token' });
  assert.equal(nestedResult.searchEventCount, 1);
  assert.deepEqual(nestedResult.events.filter((event) => event.hasSearchHit).map((event) => event.id), [nested.id]);
  const failed = timeline(index, id, { status: 'failed' });
  assert.deepEqual(failed.events.map((event) => event.id), [nested.id]);
  const declaredShell = timeline(index, id, { codeModeRequest: 'shell_command' });
  assert.deepEqual(declaredShell.events.map((event) => event.id), [operation.id]);
  assert.deepEqual(declaredShell.events[0].presentationFacts, {
    codeModeDeclaredRequests: {
      toolNames: ['shell_command'],
      requestEvidence: CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE,
    },
  });
  assert.deepEqual(declaredShell.codeModeRequests, [{
    value: 'shell_command',
    label: 'Shell command',
    count: 1,
    evidence: 'declared_source',
  }]);
  assert.deepEqual(timeline(index, id, { codeModeRequest: 'shell_command', status: 'failed' }).events, []);

  const publicOperation = timeline(index, id).events.find((event) => event.id === operation.id);
  assert.equal(Object.hasOwn(publicOperation, 'eventRefs'), false);
  assert.equal(Object.hasOwn(publicOperation, 'codeModeOperation'), false);
  assert.deepEqual(publicOperation.tags, []);

  const detail = buildEventDetail(session, operation.id, 'main');
  assert.equal(detail.presentation.requestEvidence, CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE);
  assert.equal(Object.hasOwn(detail.presentation, 'codeModeDeclaredRequests'), false);
  assert.equal(Object.hasOwn(declaredShell.events[0].presentationFacts, 'variant'), false);
  assert.equal(Object.hasOwn(declaredShell.events[0].presentationFacts, 'resultAssociation'), false);
});

test('public Code Mode context is parity-safe, omits unproven parents, and preserves kind filtering', async (t) => {
  const { id, index } = await candidateIndex(t);
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.toolName === 'nested-search-token');
  const expectedContext = {
    relation: 'enclosed_by_code_mode_operation',
    codeModeParentId: operation.id,
  };

  const fromTimeline = timeline(index, id).events.find((event) => event.id === nested.id);
  const fromEvent = getEvent(index, id, nested.id, { layer: 'main', locale: 'en' });
  assert.deepEqual(fromTimeline.presentationContext, expectedContext);
  assert.deepEqual(fromEvent.presentationContext, expectedContext);
  assert.equal(Object.hasOwn(nested, 'presentationContext'), false);
  assert.equal(Object.hasOwn(timeline(index, id).events.find((event) => event.id === operation.id), 'presentationContext'), false);

  operation.codeModeOperation = { ...operation.codeModeOperation, eventRefs: [] };
  assert.equal(Object.hasOwn(timeline(index, id).events.find((event) => event.id === nested.id), 'presentationContext'), false);

  operation.codeModeOperation = { ...operation.codeModeOperation, eventRefs: [nested.id] };
  session.logicalEvents.push({
    ...operation,
    id: 'ambiguous-code-mode-parent',
    codeModeOperation: { ...operation.codeModeOperation, eventRefs: [nested.id] },
  });
  assert.equal(Object.hasOwn(timeline(index, id).events.find((event) => event.id === nested.id), 'presentationContext'), false);

  assert.deepEqual(timeline(index, id, { kind: 'code_mode_operation' }).events.map((event) => event.id), [operation.id, 'ambiguous-code-mode-parent']);
  assert.deepEqual(timeline(index, id, { kind: 'code_mode_script_operation' }).events.map((event) => event.id), ['ambiguous-code-mode-parent']);
  assert.deepEqual(timeline(index, id, { kind: 'other_tool_call' }).events.map((event) => event.id), []);
});

test('Main kind catalog adds Code Mode operations and the exact script fallback facet', () => {
  const catalog = eventKindCatalog([{
    logicalEvents: [
      { layer: 'main', kind: 'code_mode_operation' },
      { layer: 'main', kind: 'other_tool_call', subtype: 'update_plan' },
      { layer: 'main', kind: 'command', subtype: 'shell_command' },
      { layer: 'protocol', kind: 'protocol', subtype: 'task_started' },
    ],
    rawEvents: [],
  }], { locale: 'en' });

  assert.deepEqual(catalog.main.find((item) => item.value === 'other_tool_call'), {
    value: 'other_tool_call', label: 'Other tool call', count: 1,
  });
  assert.deepEqual(catalog.main.find((item) => item.value === 'code_mode_operation'), {
    value: 'code_mode_operation', label: 'Code Mode tool call', count: 1,
  });
  assert.deepEqual(catalog.main.find((item) => item.value === 'code_mode_script_operation'), {
    value: 'code_mode_script_operation', label: 'Scripted operation', count: 1, matchField: 'presentation_fallback',
  });
  assert.equal(catalog.main.some((item) => item.value === 'update_plan'), false);
  assert.equal(catalog.main.some((item) => item.value === 'shell_command'), false);
});

test('duplicate outer call ids contribute two operations while their ambiguous output is claimed once', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-code-mode-a-duplicate-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '14');
  await fsp.mkdir(dir, { recursive: true });
  const records = [
    { type: 'session_meta', timestamp: '2026-07-14T00:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'duplicate-outer', input: 'first outer script' } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:02.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'duplicate-outer', input: 'second outer script' } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:03.000Z', payload: { type: 'custom_tool_call_output', call_id: 'duplicate-outer', output: 'Script completed\nambiguous output' } },
  ];
  await fsp.writeFile(path.join(dir, `rollout-${id}.jsonl`), `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operations = session.logicalEvents.filter((event) => event.kind === 'code_mode_operation');
  assert.equal(operations.length, 2);
  assert.equal(session.logicalEvents.filter((event) => event.layer === 'main').length, 2);
  assert.equal(session.counts.toolCalls, 2);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 2 }]);
  assert.equal(operations.some((event) => event.rawRefs.some((ref) => ref.line === 4)), false);
  assert.equal(timeline(index, id, { q: 'ambiguous output' }).searchEventCount, 0);
});
