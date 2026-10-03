'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { projectCodeModeOperations, codeModeDisplayOutputText, codeModeAssociableOutputFragments } = require('../src/codex-code-mode');
const { deriveCodeModeFacts } = require('../src/codex-code-mode-facts');

// Synthetic normalized source rows, not captured writer output. The envelopes
// preserve the existing rollout response_item contract. Ordering cases are
// adversarial coverage for rust-v0.155.0–rust-v0.160.0 review, especially
// https://github.com/openai/codex/pull/48123 (early yield) and /48207 (queued
// termination output). No actual TUI/daemon writer or instant_interrupt flag
// was exercised; these tests must not be reported as real-client evidence.
function row(line, type, fields = {}, turnId = '') {
  const recordType = ['custom_tool_call', 'custom_tool_call_output', 'function_call', 'function_call_output'].includes(type)
    ? 'response_item' : 'event_msg';
  return {
    rawId: `synthetic:raw:${line}`,
    sessionId: 'synthetic',
    line,
    source: { file: 'synthetic-code-mode.jsonl', line },
    recordType,
    payloadType: type,
    canonicalType: type,
    turnId,
    callId: fields.call_id || '',
    toolName: fields.name || '',
    parsed: { type: recordType, payload: { type, ...fields } },
  };
}

const exec = (line = 1) => row(line, 'custom_tool_call', { name: 'exec', call_id: 'exec', input: 'text(await tools.exec_command({cmd:"echo synthetic"}));' });
const yielded = (line = 2) => row(line, 'custom_tool_call_output', { call_id: 'exec', output: 'Script running with cell ID 42\nLive output:\nfirst' });
const wait = (line = 3, id = 'wait') => row(line, 'function_call', { name: 'wait', call_id: id, arguments: '{"cell_id":"42"}' });
const result = (line, id, output) => row(line, 'function_call_output', { call_id: id, output });

test('synthetic same-turn steering preserves multiple yields and queued termination output', () => {
  const output = [
    { type: 'input_text', text: 'Script terminated\nWall time 1 seconds\nOutput:\n' },
    { type: 'input_text', text: 'queued-before-termination' },
  ];
  const raws = [
    exec(), yielded(), wait(), row(4, 'user_message', { message: 'synthetic steering' }),
    result(5, 'wait', 'Script running with cell ID 42\nLive output:\nsecond'),
    wait(6, 'wait-2'), result(7, 'wait-2', output),
  ];
  const projection = projectCodeModeOperations(raws);
  assert.equal(projection.operations.length, 1);
  assert.equal(projection.operations[0].observationState, 'terminal');
  assert.equal(projection.operations[0].phases.length, 3);
  assert.deepEqual(projection.unassociatedWaits, []);
  assert.equal(codeModeDisplayOutputText(raws.at(-1)), 'queued-before-termination');
  assert.deepEqual(codeModeAssociableOutputFragments(raws.at(-1)), []);
});

for (const boundary of ['task_complete', 'task_started', 'turn_aborted']) {
  test(`synthetic late wait output cannot enclose activity across ${boundary}`, () => {
    const independent = row(5, 'patch_apply_end', { call_id: 'independent', success: true });
    const raws = [exec(), yielded(), wait(), row(4, boundary), independent, result(6, 'wait', 'Script terminated\nqueued-output')];
    const projection = projectCodeModeOperations(raws);
    const operation = projection.operations[0];
    const facts = deriveCodeModeFacts({
      projection,
      rawEvents: raws,
      logicalEvents: [{ id: 'independent-event', rawRefs: [{ rawId: independent.rawId, file: independent.source.file, line: independent.line }] }],
      lifecycleTypes: new Set(['patch_apply_end']),
    });
    assert.deepEqual(facts.operationFacts[0].eventRefs, []);
    assert.equal(operation.phases[1].span, null);
    assert.equal(operation.phases[1].outputRef.rawId, raws.at(-1).rawId);
    assert.match(facts.operationFacts[0].searchableText, /queued-output/);
  });
}

test('synthetic new-turn waits stay orphaned and absent terminal output is not failure', () => {
  const projection = projectCodeModeOperations([exec(), yielded(), row(3, 'task_started'), wait(4)]);
  assert.equal(projection.operations[0].observationState, 'unobserved_terminal');
  assert.equal(projection.operations[0].phases.length, 1);
  assert.equal(projection.unassociatedWaits[0].reason, 'orphan_cell');
  assert.equal(Object.hasOwn(projection.operations[0], 'status'), false);
  assert.equal(projectCodeModeOperations([exec()]).operations[0].observationState, 'unknown');
  assert.equal(projectCodeModeOperations([exec(), yielded()]).operations[0].observationState, 'pending');
});

test('synthetic late exec and changed turn IDs cannot establish a nested physical span', () => {
  const output = row(4, 'custom_tool_call_output', { call_id: 'exec', output: 'Script completed' });
  for (const boundary of [row(2, 'turn_aborted'), row(2, 'user_message', {}, 'turn-2')]) {
    const call = { ...exec(), turnId: 'turn-1' };
    const projection = projectCodeModeOperations([call, boundary, output]);
    assert.equal(projection.operations[0].phases[0].span, null);
    assert.equal(projection.operations[0].phases[0].outputRef.rawId, output.rawId);
  }
});

test('synthetic pending exec output arriving after a boundary cannot reopen a wait chain', () => {
  const projection = projectCodeModeOperations([exec(), row(2, 'task_complete'), yielded(3), wait(4)]);
  assert.equal(projection.operations[0].observationState, 'unobserved_terminal');
  assert.equal(projection.operations[0].phases[0].observationState, 'pending');
  assert.equal(projection.operations[0].phases.length, 1);
  assert.equal(projection.unassociatedWaits[0].reason, 'orphan_cell');
});

test('synthetic explicit turn change closes a pending cell whose exec has no turn ID', () => {
  const projection = projectCodeModeOperations([
    row(0, 'turn_context', {}, 'turn-1'), exec(), yielded(),
    row(3, 'turn_context', {}, 'turn-2'), wait(4), result(5, 'wait', 'Script completed'),
  ]);
  assert.equal(projection.operations[0].observationState, 'unobserved_terminal');
  assert.equal(projection.operations[0].phases.length, 1);
  assert.equal(projection.unassociatedWaits[0].reason, 'orphan_cell');
});

test('synthetic late-output ownership survives cold, compact, reused and appended source paths', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-0155-0160-code-mode-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'aaaaaaaa-0160-4160-8160-aaaaaaaaaaaa';
  const file = path.join(codexHome, 'sessions', `rollout-${id}.jsonl`);
  const records = [
    { type: 'session_meta', payload: { id, cwd: repoRoot } },
    ...[exec(), yielded(), wait(), row(4, 'turn_aborted'), row(5, 'patch_apply_end', {
      call_id: 'independent', success: true, changes: { 'synthetic.txt': { type: 'add', content: 'synthetic patch' } },
    })].map((raw) => raw.parsed),
  ];
  const encode = (rows) => rows.map((record) => JSON.stringify({ timestamp: '2026-10-02T00:00:00.000Z', ...record })).join('\n') + '\n';
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, encode(records));
  const before = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  await fsp.appendFile(file, encode([result(6, 'wait', 'Script terminated\nqueued-output').parsed]));
  const appended = await codex.buildSourceBackedIndex({ repoRoot, codexHome, previousIndex: before });
  const reused = await codex.buildSourceBackedIndex({ repoRoot, codexHome, previousIndex: appended });
  assert.equal(reused.totals.reusedFileCount, 1);
  const cold = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  const compact = await codex.buildIndex({ repoRoot, codexHome });
  for (const index of [appended, reused, cold, compact]) {
    const indexed = index.sessionsById.get(id);
    const session = index === compact ? indexed : await materializeSessionForIndex(index, indexed);
    const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
    const patch = session.logicalEvents.find((event) => event.kind === 'patch');
    assert.ok(operation);
    assert.ok(patch);
    assert.deepEqual(operation.codeModeOperation.eventRefs, []);
    assert.equal(operation.codeModeOperation.observationState, 'unobserved_terminal');
    assert.equal(session.counts.toolCalls, 2);
    assert.equal(session.counts.failedCommands, 0);
    assert.equal(session.counts.userMessages, 0);
    const timeline = codex.getTimeline(index, session, { layer: 'main', q: 'queued-output', limit: 100, offset: 0 });
    assert.equal(timeline.searchEventCount, 1);
    assert.equal(timeline.events.find((event) => event.hasSearchHit).id, operation.id);
    assert.equal(Object.hasOwn(codex.getEvent(index, session, patch.id, { layer: 'main' }), 'presentationContext'), false);
    const detail = await codex.buildHydratedEventDetail(index, session, operation.id, 'main');
    assert.match(JSON.stringify(detail), /queued-output/);
    assert.ok(operation.rawRefs.some((ref) => ref.line === 7));
  }
});

test('synthetic persisted inter-agent communications do not become human messages or extra turns', async (t) => {
  // Pinned wire: rust-v0.160.0 history/src/rollout_payload.rs::RolloutItemWire
  // and protocol/src/protocol.rs::InterAgentCommunication. These records are
  // durable per rollout/src/policy.rs; trigger_turn is not delivery evidence.
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-0160-communication-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'bbbbbbbb-0160-4160-8160-bbbbbbbbbbbb';
  const communication = (triggerTurn) => ({ type: 'inter_agent_communication', payload: {
    id: 'amsg_synthetic', author: '/root/worker', recipient: '/root', other_recipients: [],
    content: 'synthetic mailbox notification', trigger_turn: triggerTurn,
  } });
  const records = [
    { type: 'session_meta', payload: { id, cwd: repoRoot } },
    row(2, 'task_started', { turn_id: 'turn-1' }).parsed,
    communication(false),
    { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Synthetic final answer' }] } },
    row(5, 'task_complete', { turn_id: 'turn-1' }).parsed,
    communication(true),
    { type: 'inter_agent_communication_metadata', payload: { trigger_turn: false } },
  ];
  await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'sessions', `rollout-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  const session = await materializeSessionForIndex(index, index.sessionsById.get(id));
  assert.equal(session.counts.userMessages, 0);
  assert.equal(session.counts.assistantMessages, 1);
  assert.equal(session.counts.toolCalls, 0);
  const communications = session.logicalEvents.filter((event) => event.rawRefs.some((ref) => [3, 6, 7].includes(ref.line)));
  assert.equal(communications.length, 3);
  assert.ok(communications.every((event) => event.layer === 'protocol'));
  assert.equal(session.logicalEvents.filter((event) => event.subtype === 'task_started').length, 1);
});

test('synthetic paginated nested lifecycle retains original refs and unique Code Mode ownership', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-0160-typed-nested-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'cccccccc-0160-4160-8160-cccccccccccc';
  const records = [
    { type: 'session_meta', payload: { id, cwd: repoRoot } },
    exec().parsed,
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: id, turn_id: 'turn-1', item: {
      type: 'FileChange', id: 'nested-patch', status: 'completed',
      changes: { 'synthetic.txt': { type: 'add', content: 'synthetic patch' } },
    } } },
    row(4, 'custom_tool_call_output', { call_id: 'exec', output: 'Script completed' }).parsed,
  ];
  await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'sessions', `rollout-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  let index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  for (let pass = 0; pass < 2; pass += 1) {
    const session = await materializeSessionForIndex(index, index.sessionsById.get(id));
    const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
    const patch = session.logicalEvents.find((event) => event.kind === 'patch');
    assert.ok(patch);
    assert.deepEqual(operation.codeModeOperation.eventRefs, [patch.id]);
    assert.equal(session.counts.toolCalls, 2);
    assert.equal(patch.rawRefs[0].sourceEventType, 'item_completed');
    assert.equal(codex.getEvent(index, session, patch.id, { layer: 'main' }).presentationContext.codeModeParentId, operation.id);
    const detail = await codex.buildHydratedEventDetail(index, session, patch.id, 'main');
    assert.match(JSON.stringify(detail), /synthetic.txt/);
    index = await codex.buildSourceBackedIndex({ repoRoot, codexHome, previousIndex: index });
  }
});

test('synthetic malformed response content cannot crash typed mirror comparison', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-0160-malformed-mirror-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'eeeeeeee-0160-4160-8160-eeeeeeeeeeee';
  const records = [
    { type: 'session_meta', payload: { id, cwd: repoRoot } },
    { type: 'response_item', payload: { type: 'message', id: 'message-1', role: 'assistant', content: {} } },
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: id, item: { type: 'AgentMessage', id: 'message-1', content: [] } } },
  ];
  await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'sessions', `rollout-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  const session = await materializeSessionForIndex(index, index.sessionsById.get(id));
  assert.equal(session.rawEvents.length, records.length);
});

test('synthetic image Extension fallback keeps opaque result bytes out of search', () => {
  const { codexFullSearchText, codexSearchValue } = require('../src/codex-source');
  const payload = { type: 'item_completed', thread_id: 'foreign-thread', item: {
    type: 'Extension', kind: 'image_gen.generation', id: 'image-1', status: 'completed',
    result: 'OPAQUE_SYNTHETIC_IMAGE_BYTES', revisedPrompt: 'synthetic visible prompt',
  } };
  for (const searchText of [codexFullSearchText(payload), codexSearchValue(payload)]) {
    assert.doesNotMatch(searchText, /OPAQUE_SYNTHETIC_IMAGE_BYTES/);
    assert.match(searchText, /synthetic visible prompt/);
  }
  assert.equal(payload.item.result, 'OPAQUE_SYNTHETIC_IMAGE_BYTES');
});
