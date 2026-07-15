'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildIndex, getTimeline } = require('../src/codex');

async function candidateIndex(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-code-mode-a-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '14');
  await fsp.mkdir(dir, { recursive: true });
  const records = [
    { type: 'session_meta', timestamp: '2026-07-14T00:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-07-14T00:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-a', turn_id: 'turn-a', input: "const value = await tools.fixture({ sandbox_permissions: 'require_escalated' }); text(value);" } },
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
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.toolName === 'nested-search-token');

  assert.equal(session.counts.toolCalls, 2);
  assert.equal(session.counts.failedCommands, 0);
  assert.equal(session.counts.issueEvents, 1);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }, { name: 'nested-search-token', count: 1 }]);
  assert.equal(session.logicalEvents.some((event) => event.toolName === 'wait'), false);
  assert.deepEqual(operation.codeModeOperation.eventRefs, [nested.id]);

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

  const publicOperation = timeline(index, id).events.find((event) => event.id === operation.id);
  assert.equal(Object.hasOwn(publicOperation, 'eventRefs'), false);
  assert.equal(Object.hasOwn(publicOperation, 'codeModeOperation'), false);
  assert.deepEqual(publicOperation.tags, []);
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
  const operations = session.logicalEvents.filter((event) => event.subtype === 'code_mode_operation');
  assert.equal(operations.length, 2);
  assert.equal(session.logicalEvents.filter((event) => event.layer === 'main').length, 2);
  assert.equal(session.counts.toolCalls, 2);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 2 }]);
  assert.equal(operations.some((event) => event.rawRefs.some((ref) => ref.line === 4)), false);
  assert.equal(timeline(index, id, { q: 'ambiguous output' }).searchEventCount, 0);
});
