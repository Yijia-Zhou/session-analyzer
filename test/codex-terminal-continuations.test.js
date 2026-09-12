'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { terminalSourceEvidence, parseTerminalReceipt, buildTerminalContinuations } = require('../src/codex-terminal-continuations');

const records = JSON.parse('[' + fs.readFileSync(path.join(__dirname, 'fixtures/background-terminal/continuation.jsonl'), 'utf8').trim().split('\n').join(',') + ']');
const meta = records[0];
function call(id, name, args) {
  return { type: 'response_item', payload: { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) } };
}
function output(id, result = 'running', processId = 1234) {
  const line = result === 'running' ? `Process running with session ID ${processId}` : `Process exited with code ${result}`;
  return { type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: `Wall time: 1.0000 seconds\n${line}\nOutput:\n` } };
}
const e = () => call('e', 'exec_command', { cmd: 'npm test' });
const w = (id = 'w') => call(id, 'write_stdin', { session_id: 1234 });
function project(items, options = {}) {
  const rawEvents = [meta, ...items].map((record, index) => ({
    rawId: `r${index}`, line: index + 1, sourceKind: 'codex', sessionId: 's', source: { file: 'rollout.jsonl', line: index + 1 },
    timestamp: record.timestamp || '',
    recordType: record.type, payloadType: record.payload?.type || '', toolName: record.payload?.name || '',
    callId: record.payload?.call_id || '', output: record.payload?.arguments ?? record.payload?.output ?? '',
    terminalSourceEvidence: terminalSourceEvidence(record),
  }));
  const groups = new Map();
  for (const raw of rawEvents) if (raw.callId) {
    if (!groups.has(raw.callId)) groups.set(raw.callId, []);
    groups.get(raw.callId).push(raw);
  }
  const logicalEvents = [...groups].map(([id, raws]) => ({ id, sourceKind: 'codex', kind: 'other_tool_call', layer: 'main',
    toolName: raws.find((raw) => raw.toolName)?.toolName || '', rawRefs: raws.map((raw) => ({ rawId: raw.rawId, line: raw.line })) }));
  if (options.reverseLogical) logicalEvents.reverse();
  return buildTerminalContinuations({ rawEvents, logicalEvents, ...options });
}

test('recognized direct formatter headers prove access; body lookalikes and conflicts do not', () => {
  assert.deepEqual(parseTerminalReceipt(records[2].payload.output), { processId: 1234 });
  assert.deepEqual(parseTerminalReceipt(records[6].payload.output), { exitCode: 1 });
  assert.deepEqual(parseTerminalReceipt(records[2].payload.output + 'Process running with session ID 5678'), { processId: 1234 });
  for (const text of [
    'Output:\nProcess running with session ID 1234',
    'Wall time: 1.0000 seconds\nProcess running with session ID 1234\nProcess exited with code 0\nOutput:\n',
    'Wall time: 1.0000 seconds\nProcess running with session ID 1234\nProcess running with session ID 1234\nOutput:\n',
    '{"session_id":1234}', 'unknown process', 'write_stdin rejected: no',
    'Wall time: 1.0000 seconds\nProcess running with session ID 2147483648\nOutput:\n',
  ]) assert.equal(parseTerminalReceipt(text), null);
});

test('sequential poll/input and nonzero exit associate without merging; reused IDs open a fresh epoch', () => {
  const result = project(records.slice(1));
  assert.deepEqual([...result.backgroundTerminalContinuations], [['w1', { originEventId: 'e1' }], ['w2', { originEventId: 'e1' }]]);
  assert.deepEqual([...result.backgroundTerminalOrigins], [['e1', { processId: 1234, commandPreview: 'npm test' }]]);
  const reused = project([e(), output('e'), w(), output('w', 0), call('e2', 'exec_command', { cmd: 'node build.js' }), output('e2'), w('w2'), output('w2')]);
  assert.equal(reused.backgroundTerminalContinuations.get('w2').originEventId, 'e2');
  assert.equal(reused.backgroundTerminalContinuations.get('w').originEventId, 'e');
});

test('competing creation is excluded through W output, including creators crossing the left boundary', () => {
  const creator = call('other', 'exec_command', { cmd: 'other' });
  for (const items of [
    [e(), output('e'), w(), creator, output('w'), output('other', 1)],
    [e(), output('e'), creator, output('other', 'running', 5678), w(), output('w')],
    [creator, e(), output('other'), output('e'), w(), output('w')],
    [creator, e(), output('e'), w(), output('w')],
  ]) assert.equal(project(items).backgroundTerminalContinuations.size, 0);
});

test('opaque, malformed, missing, duplicate, lifecycle and source-boundary evidence fails closed', () => {
  const prefix = [e(), output('e')];
  const badOutput = { type: 'response_item', payload: { type: 'function_call_output', call_id: 'w', output: 'unknown process' } };
  const barrier = (type, payload = {}) => ({ type, payload });
  const cases = [
    [...prefix, w()], [...prefix, w(), badOutput],
    [...prefix, w(), output('w'), output('w')], [...prefix, w(), w(), output('w')],
    [...prefix, w(), output('w', 'running', 5678)],
    [...prefix, w(), output('w', 0), w('later'), output('later')],
    [...prefix, w(), w('overlap'), output('w'), output('overlap')],
    [call('opaque', 'exec', { code: 'work()' }), output('opaque', 0), ...prefix, w(), output('w')],
    [...prefix, call('opaque', 'unknown_tool', {}), w(), output('w')],
    [...prefix, barrier('compacted'), w(), output('w')],
    [...prefix, meta, w(), output('w')],
    [...prefix, barrier('event_msg', { type: 'turn_resumed' }), w(), output('w')],
    [...prefix, barrier('unknown_record'), w(), output('w')],
    [...prefix, { ...w(), payload: { ...w().payload, arguments: '{"session_id":1234,"session_id":5678}' } }, output('w')],
  ];
  for (const [index, items] of cases.entries()) {
    const relations = project(items).backgroundTerminalContinuations;
    if (index === 5) { assert.equal(relations.has('later'), false); assert.equal(relations.has('w'), true); }
    else assert.equal(relations.size, 0, `case ${index}`);
  }
  assert.equal(project([...prefix, w(), output('w')], { forkedFromSessionId: 'parent' }).backgroundTerminalContinuations.size, 0);
});

test('native format gate rejects inherited, paginated, dynamic and unknown metadata', () => {
  assert.equal(terminalSourceEvidence(meta), 'native-local-direct-v1');
  for (const payload of [
    { ...meta.payload, history_mode: 'paginated' }, { ...meta.payload, forked_from_id: 'parent' },
    { ...meta.payload, dynamic_tools: [{ name: 'exec_command' }] }, { ...meta.payload, source: 'unknown' },
    { ...meta.payload, session_id: undefined }, { ...meta.payload, originator: 'exporter' },
  ]) assert.equal(terminalSourceEvidence({ ...meta, payload }), 'barrier');
});

test('initial settings and passive world state are admitted, later settings are a runtime boundary', () => {
  const settings = { type: 'event_msg', payload: { type: 'thread_settings_applied' } };
  const world = { type: 'world_state', payload: {} };
  assert.equal(project([settings, world, e(), output('e'), world, w(), output('w')]).backgroundTerminalContinuations.size, 1);
  assert.equal(project([e(), output('e'), settings, w(), output('w')]).backgroundTerminalContinuations.size, 0);
});

test('physical order owns association while command summaries remain bounded and optional', () => {
  const inverted = project([
    { ...e(), timestamp: '2030-01-01T00:00:00Z' }, output('e'),
    { ...w(), timestamp: '2020-01-01T00:00:00Z' }, output('w'),
  ], { reverseLogical: true });
  assert.equal(inverted.backgroundTerminalContinuations.get('w').originEventId, 'e');
  for (const cmd of [' \n\t', '😀'.repeat(500)]) {
    const result = project([call('e', 'exec_command', { cmd }), output('e'), w(), output('w')]);
    assert.equal(result.backgroundTerminalContinuations.size, 1);
    assert.equal(Array.from(result.backgroundTerminalOrigins.get('e').commandPreview).length, cmd.startsWith(' ') ? 0 : 160);
  }
  assert.equal(project([e(), e(), output('e'), w(), output('w')]).backgroundTerminalContinuations.size, 0);
  assert.equal(project([output('missing'), w(), output('w')]).backgroundTerminalContinuations.size, 0);
  const conflicting = output('w');
  conflicting.payload.name = 'exec_command';
  assert.equal(project([e(), output('e'), w(), conflicting]).backgroundTerminalContinuations.size, 0);
  assert.equal(project([e(), output('e'), { type: 'response_item', payload: { type: 'function_call', name: 'write_stdin', namespace: 'functions', call_id: 'w', arguments: '{"session_id":1234}' } }, output('w')]).backgroundTerminalContinuations.size, 0);
});
