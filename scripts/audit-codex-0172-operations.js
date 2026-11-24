'use strict';

// Offline reader probe. Every input below is synthetic. No writer or model is invoked.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { startHistoryServer } = require('../src/history-server');
const { runHistoryCli } = require('../src/history-cli');

const thread = 'aaaaaaaa-0172-4172-8172-aaaaaaaaaaaa';
const turn = 'bbbbbbbb-0172-4172-8172-bbbbbbbbbbbb';
const event = (type, fields) => ({ type: 'event_msg', payload: { type, ...fields } });
const item = (type, fields) => ({ type: 'response_item', payload: { type, ...fields } });
const textBlock = text => ({ type: 'input_text', text });
const scriptOutput = (status, ...text) => [textBlock(status + '\nWall time 0.0 seconds\nOutput:\n'), ...text.map(textBlock)];
const usage = { input_tokens: 20, cached_input_tokens: 4, cache_write_input_tokens: 3,
  output_tokens: 6, reasoning_output_tokens: 2, total_tokens: 26 };

function fixture(repoRoot) {
  return [
    { type: 'session_meta', payload: { id: thread, cwd: repoRoot } },
    event('task_started', { turn_id: turn }),
    { type: 'turn_context', payload: { turn_id: turn, model: 'synthetic-model', effort: 'high' } },
    item('custom_tool_call', { name: 'exec', call_id: 'exec-1', input: 'await yield_control(); text("synthetic-batch");' }),
    item('custom_tool_call_output', { call_id: 'exec-1', output: scriptOutput('Script running with cell ID 14') }),
    item('function_call', { name: 'wait', call_id: 'wait-1', arguments: JSON.stringify({ cell_id: '14' }) }),
    item('function_call_output', { call_id: 'wait-1', output: scriptOutput('Script completed', 'synthetic-batch') }),
    event('token_count', { info: { total_token_usage: usage, last_token_usage: usage,
      last_usage_includes_reasoning: false, model_context_window: 64000 }, rate_limits: null }),
    { type: 'token_usage_record', payload: { thread_id: thread, turn_id: turn, session_id: thread, root_turn_id: turn,
      response_id: 'synthetic-response-marker', usage, turn_token_usage: usage, thread_token_usage: usage } },
    { type: 'dynamic_tools_updated', payload: { thread_id: thread, tools: [
      { type: 'function', name: 'synthetic-catalog-marker', description: 'sample', inputSchema: { type: 'object' } },
    ] } },
    { type: 'dynamic_tools_updated', payload: { thread_id: thread, tools: [] } },
    // Upstream prefixes this namespace with the first 12 hex digits of SHA1(environmentId).
    item('function_call', { call_id: 'mcp-1', namespace: 'mcp__106cd32d0170__notes', name: 'echo', arguments: '{}' }),
    event('item_completed', { thread_id: thread, turn_id: turn, completed_at_ms: 1795478412000, item: {
      type: 'McpToolCall', id: 'mcp-1', server: 'notes', environmentId: 'synthetic-registration-scope', tool: 'echo',
      arguments: {}, status: 'failed', duration: { secs: 0, nanos: 0 },
      result: { content: [{ type: 'text', text: 'synthetic-mcp-result' }], isError: true },
    } }),
    item('function_call_output', { call_id: 'mcp-1', output: [textBlock('Wall time: 0.0000 seconds\nOutput:'), textBlock('synthetic-mcp-result')], internal_chat_message_metadata_passthrough: {
      tool_calls_complete: true, executed_tool_calls: [{ name: 'mcp__106cd32d0170__notes__echo', arguments: {} }],
    } }),
    item('custom_tool_call', { name: 'exec', call_id: 'exec-2', input: 'await yield_control(); text(["synthetic", "recovered", "batch"].join("-"));' }),
    item('custom_tool_call_output', { call_id: 'exec-2', output: scriptOutput('Script running with cell ID g2:14') }),
    item('function_call', { name: 'wait', call_id: 'wait-2', arguments: JSON.stringify({ cell_id: 'g2:14' }) }),
    item('function_call_output', { call_id: 'wait-2', output: scriptOutput('Script completed', 'synthetic-recovered-batch') }),
  ];
}

async function inspect(index, mode) {
  const indexed = index.sessionsById.get(thread);
  assert.ok(indexed, 'fixture must be indexed');
  const session = mode.startsWith('source') ? await materializeSessionForIndex(index, indexed) : indexed;
  const op = session.logicalEvents.find(event => event.kind === 'code_mode_operation');
  assert.ok(op);
  const opDetail = await codex.buildHydratedEventDetail(index, session, op.id, 'main');
  const query = (layer, q) => codex.getTimeline(index, session, { layer, q, limit: 100 }).searchEventCount;
  const token = session.rawEvents.find(raw => raw.recordType === 'token_usage_record');
  const raw = await codex.buildHydratedEventDetail(index, session, token.rawId, 'raw');
  assert.match(JSON.stringify(raw), /synthetic-response-marker/);
  const mcpOwners = session.logicalEvents.filter(event => event.rawRefs.some(ref => [12, 13, 14].includes(ref.line)));
  const recoveredOwners = session.logicalEvents.filter(event => event.rawRefs.some(ref => ref.line >= 15));
  return {
    mode, reusedFiles: index.totals.reusedFileCount || 0,
    phases: op.codeModeOperation.phases.length, status: op.codeModeOperation.observationState,
    tools: session.counts.toolCalls, batchInDetail: JSON.stringify(opDetail).includes('synthetic-batch'),
    batchMainHits: query('main', 'synthetic-batch'),
    responseMainHits: query('main', 'synthetic-response-marker'),
    responseProtocolHits: query('protocol', 'synthetic-response-marker'),
    responseRawHits: query('raw', 'synthetic-response-marker'), responseRawLine: token.source.line,
    catalogProtocolHits: query('protocol', 'synthetic-catalog-marker'),
    scopeMainHits: query('main', 'synthetic-registration-scope'),
    scopeRawHits: query('raw', 'synthetic-registration-scope'),
    mcpOwners: mcpOwners.map(event => ({ kind: event.kind, layer: event.layer, status: event.status, refs: event.rawRefs.map(ref => ref.line) })),
    recoveredOwners: recoveredOwners.map(event => ({ kind: event.kind, layer: event.layer,
      phases: event.codeModeOperation?.phases.length, observed: event.codeModeOperation?.observationState, refs: event.rawRefs.map(ref => ref.line) })),
  };
}

async function inspectHistory(options) {
  const server = await startHistoryServer({ source: 'codex', repo: options.repoRoot, codexHome: options.codexHome, port: 0 });
  async function invoke(operation, args) {
    let output = '';
    const code = await runHistoryCli([operation, '--endpoint', server.endpoint, ...args], {
      stdout: { write(value) { output += value; } },
    });
    const result = JSON.parse(output);
    assert.equal(code, 0, result.error?.code);
    return result;
  }
  try {
    const status = await invoke('status', []);
    const lookup = (layer, query) => invoke('search', ['--context', status.contextRef, '--layer', layer,
      '--query', query, '--limit', '5', '--presentation', 'full']);
    const recovered = await lookup('main', 'synthetic-recovered-batch');
    const failed = await lookup('protocol', 'synthetic-registration-scope');
    const failedMain = await lookup('main', 'synthetic-mcp-result');
    assert.deepEqual(failedMain.items.map(({ kind, status }) => [kind, status]), [['mcp_call', 'failed']]);
    const raw = await lookup('raw', 'synthetic-registration-scope');
    const read = await invoke('read', ['--context', status.contextRef, '--ref', raw.items[0].ref, '--parts', 'raw']);
    return { recoveredMain: recovered.items.map(x => ({ kind: x.kind, status: x.status })),
      scopeProtocol: failed.items.length, scopeRaw: raw.items.length,
      mcpMain: failedMain.items.map(({ kind, status }) => ({ kind, status })),
      readScope: JSON.stringify(read.items).includes('synthetic-registration-scope') };
  } finally {
    await server.close();
  }
}

async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0172-operations-'));
  const indexes = [];
  try {
    const options = { codexHome: home, repoRoot: path.join(home, 'repo') };
    await fs.mkdir(options.repoRoot);
    await fs.mkdir(path.join(home, 'sessions'));
    const rows = fixture(options.repoRoot).map((row, index) => JSON.stringify({
      timestamp: new Date(Date.UTC(2026, 10, 24, 0, 0, index)).toISOString(), ...row,
    }));
    await fs.writeFile(path.join(home, 'sessions', 'rollout-' + thread + '.jsonl'), rows.join('\n') + '\n');
    const results = [];
    for (const [mode, build] of [
      ['resident', codex.__testOnly.buildUncompactedIndexForDetailTests],
      ['compact', codex.buildIndex], ['source-cold', codex.buildSourceBackedIndex],
      ['source-warm', codex.buildSourceBackedIndex],
    ]) {
      const index = await build({ ...options, previousIndex: mode === 'source-warm' ? indexes.at(-1) : null });
      indexes.push(index);
      const result = await inspect(index, mode);
      if (mode === 'source-warm') assert.equal(result.reusedFiles, 1);
      results.push(result);
    }
    console.log(JSON.stringify({ paths: results, history: await inspectHistory(options) }, null, 2));
  } finally {
    for (const index of indexes) if (index.projectQueryStore) disposeProjectQueryStore(index.projectQueryStore);
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('codex-0172-operations-'));
    await fs.rm(home, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
