'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

// Synthetic source-shaped fixtures, not real CLI/daemon observations.
// Pinned authority: rust-v0.160.0 protocol/src/items.rs, protocol/protocol.rs,
// core/src/tools/events.rs and core/src/tools/handlers/dynamic.rs.
const ID = 'aaaaaaaa-0160-4160-9160-aaaaaaaaaaaa';
const TURN = 'typed-tools-turn';
const event = (payload) => ({ type: 'event_msg', payload });
const response = (payload) => ({ type: 'response_item', payload });
const duration = { secs: 1, nanos: 250000000 };
const typed = (item, fields = {}) => event({ type: 'item_completed', thread_id: ID, turn_id: TURN,
  item, completed_at_ms: 1790935210000, ...fields });

function scenarios() {
  const cases = [];
  for (const [suffix, status, exitCode, expected] of [
    ['success', 'completed', 0, 'success'], ['failure', 'failed', 2, 'failed'],
    ['declined', 'declined', null, 'declined'], ['unknown-exit', 'completed', null, 'completed'],
    ['missing-exit', 'completed', undefined, 'completed'],
    ['startup-failure', 'failed', null, 'failed'], ['partial', 'in_progress', null, 'incomplete'],
  ]) {
    const id = `command-${suffix}`;
    const result = `${id}-result`;
    const item = { type: 'CommandExecution', id, command: ['node', '-e', `print_${id}`], cwd: '/synthetic/repo',
      parsed_cmd: [], source: 'agent', status, process_id: status === 'declined' ? null : '42',
      stdout: result, stderr: status === 'failed' ? `${id}-error` : '', aggregated_output: result,
      ...(exitCode === undefined ? {} : { exit_code: exitCode }), duration };
    const legacy = event({ ...item, type: status === 'in_progress' ? 'exec_command_update' : 'exec_command_end', call_id: id });
    const call = response({ type: 'function_call', call_id: id, name: 'shell_command', arguments: JSON.stringify({ command: item.command.join(' '), cwd: item.cwd }) });
    const output = response({ type: 'function_call_output', call_id: id,
      output: `Wall time: 1.25 seconds\n${exitCode == null ? '' : `Process exited with code ${exitCode}\n`}Final output:\n${result}` });
    cases.push({ id, item, legacy, call, output, kind: 'command', status: expected, exitCode: exitCode ?? null, result, partial: status === 'in_progress' });
  }
  for (const status of ['completed', 'failed', 'declined']) {
    const id = `patch-${status}`;
    const result = `${id}-result`;
    const diff = `${id}-diff-only`;
    const changes = { [`${id}.txt`]: { type: 'update', unified_diff: `@@ -1 +1 @@\n-old\n+${diff}`, move_path: null } };
    const item = { type: 'FileChange', id, status, changes, stdout: result, stderr: status === 'failed' ? 'patch failed' : '' };
    const call = response({ type: 'custom_tool_call', call_id: id, name: 'apply_patch', input: `*** Begin Patch\n*** Update File: ${id}.txt\n-old\n+${diff}\n*** End Patch` });
    cases.push({ id, item, result, diff, call, output: response({ type: 'custom_tool_call_output', call_id: id, output: result }),
      legacy: event({ ...item, type: 'patch_apply_end', call_id: id, success: status === 'completed' }),
      kind: 'patch', status: status === 'completed' ? 'success' : status, files: Object.keys(changes) });
  }
  for (const failed of [false, true]) {
    const id = `mcp-${failed ? 'failure' : 'success'}`;
    const result = `${id}-result`;
    const item = { type: 'McpToolCall', id, server: 'fixture', tool: 'lookup', arguments: { query: id },
      status: failed ? 'failed' : 'completed', duration,
      result: failed ? null : { content: [{ type: 'text', text: result }], isError: false },
      error: failed ? { message: result } : null };
    cases.push({ id, item, result, kind: 'mcp_call', status: failed ? 'failed' : 'success',
      legacy: event({ type: 'mcp_tool_call_end', call_id: id, status: item.status,
        invocation: { server: item.server, tool: item.tool, arguments: item.arguments }, result: item.result, error: item.error, duration }),
      call: response({ type: 'function_call', call_id: id, name: 'mcp__fixture__lookup', arguments: JSON.stringify(item.arguments) }),
      output: response({ type: 'function_call_output', call_id: id, output: result }) });
  }
  for (const failed of [false, true]) {
    const id = `dynamic-${failed ? 'failure' : 'success'}`;
    const result = `${id}-result`;
    const item = { type: 'DynamicToolCall', id, namespace: 'fixture', tool: 'lookup', arguments: { query: id },
      status: failed ? 'failed' : 'completed', success: !failed, duration,
      content_items: [{ type: 'inputText', text: result }], error: failed ? result : null };
    cases.push({ id, item, result, kind: 'other_tool_call', status: failed ? 'failed' : 'success',
      legacy: event({ type: 'dynamic_tool_call_end', call_id: id, tool_name: 'fixture.lookup', status: item.status,
        result: item.content_items, success: item.success, error: item.error }),
      call: response({ type: 'function_call', call_id: id, name: 'fixture.lookup', arguments: JSON.stringify(item.arguments) }),
      output: response({ type: 'function_call_output', call_id: id, output: result }) });
  }
  return cases;
}

async function fixture(t, rows, initialTurn = event({ type: 'task_started', turn_id: TURN })) {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0160-typed-'));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const root = path.join(codexHome, 'sessions');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(repoRoot);
  const records = [{ type: 'session_meta', payload: { id: ID, cwd: repoRoot } },
    ...(initialTurn ? [initialTurn] : []), ...rows].map((row, i) => ({
    timestamp: new Date(Date.parse('2026-10-02T10:00:00.000Z') + i * 1000).toISOString(), ...row,
  }));
  const file = path.join(root, `rollout-${ID}.jsonl`);
  await fs.writeFile(file, records.map(JSON.stringify).join('\n') + '\n');
  return { file, records, options: { codexHome, repoRoot } };
}

function rowsFor(scenario, mode) {
  if (mode === 'legacy') return [scenario.legacy];
  if (mode === 'paginated') return [typed(scenario.item)];
  return [scenario.call, typed(scenario.item), ...(scenario.partial ? [] : [scenario.output])];
}

test('a scoped MCP terminal joins only the exact registration namespace and tool', async (t) => {
  const { createHash } = require('node:crypto');
  const scope = 'synthetic-registration-scope';
  const hash = (value) => createHash('sha1').update(value).digest('hex').slice(0, 12);
  const request = (id, namespace, name = 'echo') => response({ type: 'function_call', call_id: id, namespace, name, arguments: '{}' });
  const completion = (id, environmentId, failed) => typed({ type: 'McpToolCall', id, environmentId,
    server: 'notes', tool: 'echo', status: failed ? 'failed' : 'completed', result: { content: [], isError: failed } });
  const output = (id) => response({ type: 'function_call_output', call_id: id, output: 'MCP result ' + id });
  const localName = hash(scope) + '__notes';
  const rows = [
    request('first', 'mcp__' + localName), completion('first', scope, true),
    response({ ...output('first').payload, name: 'echo', namespace: 'mcp__' + localName }),
    request('second', hash('second-scope') + '__notes'), completion('second', 'second-scope', false), output('second'),
    request('conflict', localName), completion('conflict', 'other', true), output('conflict'),
    request('other-tool', localName, 'other'), completion('other-tool', scope, true), output('other-tool'),
    request('missing', localName), output('missing'),
  ];
  const f = await fixture(t, rows);
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  for (const [offset, status] of [[0, 'failed'], [3, 'success']]) {
    const owner = session.logicalEvents.find((e) => e.layer === 'main' && e.rawRefs.some((r) => r.line === offset + 3));
    assert.equal(owner.kind, 'mcp_call');
    assert.equal(owner.status, status);
    assert.deepEqual(owner.rawRefs.map((r) => r.line), [3, 4, 5].map((n) => n + offset));
  }
  for (const line of [10, 13]) {
    assert.equal(session.logicalEvents.find((e) => e.rawRefs.some((r) => r.line === line)).layer, 'protocol');
  }
  assert.equal(session.counts.toolCalls, 5);
  const failed = codex.query.getTimeline(index, session, { layer: 'main', kind: 'mcp_call', status: 'failed' });
  assert.equal(failed.events.length, 1);
  assert.equal(failed.events[0].status, 'failed');
});

test('verified scoped MCP short names stay distinct from native tools and pending cells', async (t) => {
  const scope = 'synthetic-registration-scope';
  const namespace = 'mcp__106cd32d0170__notes';
  const rows = [
    response({ type: 'custom_tool_call', name: 'exec', call_id: 'native', input: 'await yield_control()' }),
    response({ type: 'custom_tool_call_output', call_id: 'native', output: [
      { type: 'input_text', text: 'Script running with cell ID 14\nWall time 0.0 seconds\nOutput:\n' },
    ] }),
  ];
  for (const tool of ['wait', 'js_repl', 'create_goal', 'shell_command', 'apply_patch']) {
    rows.push(response({ type: 'function_call', namespace, name: tool, call_id: tool, arguments: '{"cell_id":"14"}' }),
      typed({ type: 'McpToolCall', id: tool, tool, server: 'notes', environmentId: scope, status: 'failed' }),
      response({ type: 'function_call_output', call_id: tool, output: 'failed' }));
  }
  const f = await fixture(t, rows);
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  const main = session.logicalEvents.filter(e => e.layer === 'main');
  const pending = main.find(e => e.kind === 'code_mode_operation');
  assert.deepEqual(pending.rawRefs.map(r => r.line), [3, 4]);
  assert.equal(main.length, 6);
  for (const [i, e] of main.filter(e => e !== pending).entries()) {
    assert.equal(e.kind, 'mcp_call');
    assert.equal(e.status, 'failed');
    assert.deepEqual(e.rawRefs.map(r => r.line), [5, 6, 7].map(n => n + i * 3));
    const raw = session.rawEvents.find(r => r.rawId === e.rawRefs[0].rawId);
    const record = await codex.readIndexedCodexRawRecord(index, session, raw);
    assert.equal(JSON.parse(record.raw).payload.name, rows[2 + i * 3].payload.name);
  }
});

test('scoped tool requests use only their own completion evidence across index paths', async (t) => {
  const scopes = ['mcp__106cd32d0170__notes', '106cd32d0170__notes'];
  const tools = ['create_goal', 'shell_command', 'apply_patch', 'js_repl', 'spawn_agent', 'request_user_input',
    'update_plan', 'view_image', 'js_repl_reset'];
  const cases = [];
  for (const [i, tool] of tools.entries()) {
    for (const [j, mode] of ['missing', 'rejected', 'valid'].entries()) {
      cases.push({ tool, namespace: scopes[(i + j) % 2], mode, kind: mode === 'valid' ? 'mcp_call' : 'other_tool_call',
        status: mode === 'valid' ? 'failed' : 'completed' });
    }
  }
  cases.push(
    { tool: 'js_repl', namespace: scopes[0], mode: 'request only', kind: 'other_tool_call', status: 'incomplete' },
    ...['apply_patch', 'js_repl'].map(tool => ({ tool, namespace: scopes[1], mode: 'missing', custom: true,
      kind: 'other_tool_call', status: 'completed' })),
    { tool: 'create_goal', mode: 'native', kind: 'goal', status: 'active' },
    { tool: 'shell_command', namespace: 'functions', mode: 'native', kind: 'command', status: 'failed' },
    { tool: 'apply_patch', mode: 'native', custom: true, kind: 'patch', status: 'success' },
    { tool: 'js_repl', mode: 'native', custom: true, kind: 'js_repl', status: 'success' },
    ...[undefined, 'collaboration', 'multi_agent_v1', 'agents'].map(namespace => ({ tool: 'spawn_agent', namespace,
      mode: 'native', kind: 'agent_coordination', status: 'success' })),
  );
  const rows = [];
  for (const [i, scenario] of cases.entries()) {
    const { tool, namespace, mode, custom } = scenario;
    const id = `call-${i}`;
    const request = `request_marker_${i}_end`;
    const receipt = `receipt_marker_${i}_end`;
    const args = tool === 'request_user_input' ? { questions: [{ id, header: 'Fixture', question: request, options: [] }] }
      : { command: request, objective: request };
    const first = rows.length + 3;
    scenario.mainLines = [first];
    scenario.detached = [];
    scenario.marker = mode === 'request only' ? request : receipt;
    rows.push(response({ call_id: id, name: tool, ...(namespace ? { namespace } : {}),
      ...(mode !== 'native' ? { status: 'declined' } : {}), ...(custom ? { type: 'custom_tool_call',
      input: tool === 'apply_patch' ? `*** Begin Patch\n*** Add File: fixture.txt\n+${request}\n*** End Patch` : request }
      : { type: 'function_call', arguments: JSON.stringify(args) }) }));
    if (mode === 'valid' || mode === 'rejected') {
      rows.push(typed({ type: 'McpToolCall', id, server: 'notes', tool,
        environmentId: mode === 'valid' ? 'synthetic-registration-scope' : 'conflicting-scope', status: 'failed' }));
      (mode === 'valid' ? scenario.mainLines : scenario.detached).push(rows.length + 2);
    }
    if (mode !== 'request only') {
      const output = tool === 'shell_command' ? `Exit code: 2\nWall time: 1.25 seconds\nOutput:\n${receipt}`
        : custom ? JSON.stringify({ output: receipt, metadata: { exit_code: 0 } }) : receipt;
      rows.push(response({ type: custom ? 'custom_tool_call_output' : 'function_call_output', call_id: id, output }));
      scenario.mainLines.push(rows.length + 2);
    }
    if (tool === 'spawn_agent') {
      scenario.startup = `activity_model_${i}_end`;
      rows.push(event({ type: 'sub_agent_activity', event_id: id, kind: 'started',
        agent_thread_id: 'synthetic-child', model: scenario.startup }));
      (mode === 'native' ? scenario.mainLines : scenario.detached).push(rows.length + 2);
    }
  }
  const f = await fixture(t, rows);
  const resident = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
  const compact = await codex.buildIndex(f.options);
  const cold = await codex.buildSourceBackedIndex(f.options);
  const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: cold });
  assert.equal(warm.totals.reusedFileCount, 1);
  for (const index of [resident, compact, cold, warm]) {
    const indexed = index.sessionsById.get(ID);
    assert.equal(indexed.counts.toolCalls, cases.length);
    const session = index === cold || index === warm ? await materializeSessionForIndex(index, indexed) : indexed;
    const main = session.logicalEvents.filter(e => e.layer === 'main');
    assert.equal(main.length, cases.length);
    for (const { tool, namespace, mode, custom, kind, status, mainLines, detached, marker, startup } of cases) {
      const label = `${namespace || 'default'} / ${tool} / ${mode}`;
      const owner = main.find(e => e.rawRefs[0].line === mainLines[0]);
      assert.deepEqual([owner?.kind, owner?.status], [kind, status], label);
      assert.deepEqual(owner.rawRefs.map(r => r.line), mainLines, label);
      for (const line of detached) {
        const owners = session.logicalEvents.filter(e => e.rawRefs.some(r => r.line === line));
        assert.deepEqual(owners.map(e => [e.layer, e.rawRefs.length]), [['protocol', 1]], label);
      }
      for (const line of [...mainLines, ...detached]) {
        const raw = session.rawEvents.find(r => r.source.line === line);
        const record = await codex.readIndexedCodexRawRecord(index, session, raw);
        assert.deepEqual(JSON.parse(record.raw), f.records[line - 1], label);
      }
      const detail = await codex.buildHydratedEventDetail(index, session, owner.id, 'main', { locale: 'en' });
      assert.equal(detail.meta.status, status, label);
      if (mode !== 'native') {
        const hits = codex.query.getTimeline(index, session, { layer: 'main', q: marker, kind, status });
        assert.deepEqual(hits.events.filter(e => e.hasSearchHit).map(e => e.id), [owner.id], label);
        assert.ok(JSON.stringify(detail).includes(marker), label);
        assert.ok(!detail.timelineSections.some(s => ['collaboration', 'user_input', 'plan_update'].includes(s.type)), label);
      }
      if (startup) {
        const hits = codex.query.getTimeline(index, session, { layer: 'main', q: startup });
        assert.equal(hits.searchEventCount, mode === 'native' ? 1 : 0, label);
        assert.equal(JSON.stringify(detail).includes(startup), mode === 'native', label);
      }
      if (tool === 'shell_command' || custom) {
        const raw = await codex.buildHydratedEventDetail(index, session, owner.rawRefs[0].rawId, 'raw', { locale: 'en' });
        const formatter = { shell_command: 'Command', apply_patch: 'Patch', js_repl: 'JavaScript' }[tool];
        assert.equal(raw.timelineSections.some(s => s.title === formatter), mode === 'native', label);
      }
    }
    assert.equal(indexed.counts.failedCommands, 1, 'only the native shell exit counts');
    assert.equal(indexed.counts.patches, 1, 'only the native patch counts');
  }
});

test('scoped shell names join matching MCP or dynamic evidence and isolate foreign lifecycle records', async (t) => {
  const namespace = '106cd32d0170__notes';
  const tool = 'shell_command';
  const invocation = { server: 'notes', tool, arguments: {}, environment_id: 'synthetic-registration-scope' };
  const end = (id, result, fields = {}) => event({ type: 'mcp_tool_call_end', call_id: id,
    invocation: { ...invocation, ...fields }, result });
  const cases = [
    [end('err', { Err: 'synthetic error' }), 'mcp_call', 'failed'],
    [end('ok-error', { Ok: { content: [], isError: true } }), 'mcp_call', 'failed'],
    [end('ok', { Ok: { content: [] } }), 'mcp_call', 'success'],
    [event({ type: 'mcp_tool_call_begin', call_id: 'begin', invocation }), 'mcp_call', 'completed'],
    [end('wrong-environment', { Err: 'foreign error' }, { environment_id: 'other' }), 'other_tool_call', 'completed', 'detached'],
    [end('unknown-result', { Ok: { content: [], isError: 'true' } }), 'other_tool_call', 'completed', 'detached'],
    [event({ type: 'exec_command_end', call_id: 'legacy-command', command: ['example'], exit_code: 9, status: 'failed' }),
      'other_tool_call', 'completed', 'detached'],
    ...['hook_completed', 'image_generation_end', 'dynamic_tool_call_end', 'approval_request_begin'].map(type =>
      [event({ type, call_id: type, status: 'failed' }), 'other_tool_call', 'completed', 'detached']),
    [typed({ type: 'CommandExecution', id: 'typed-command', command: ['example'], exit_code: 9, status: 'failed' }),
      'other_tool_call', 'completed', 'detached'],
    [typed({ type: 'DynamicToolCall', id: 'dynamic', namespace, tool, arguments: {}, status: 'completed',
      success: true, content_items: [{ type: 'inputText', text: 'dynamic result' }] }), 'other_tool_call', 'success'],
  ];
  const f = await fixture(t, cases.flatMap(([row]) => {
    const id = row.payload.call_id || row.payload.item.id;
    return [response({ type: 'function_call', call_id: id, namespace, name: tool, arguments: '{}', status: 'failed' }), row,
      response({ type: 'function_call_output', call_id: id, output: `receipt_${id}_end` })];
  }));
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  const main = session.logicalEvents.filter(e => e.layer === 'main');
  assert.equal(main.length, cases.length);
  assert.equal(session.counts.toolCalls, cases.length);
  assert.equal(session.counts.failedCommands, 0);
  const names = codex.query.getTimeline(index, session, { layer: 'main', q: namespace + '__' + tool });
  assert.equal(names.searchEventCount, cases.length);
  for (const [i, [row, kind, status, detached]] of cases.entries()) {
    const first = i * 3 + 3;
    const id = row.payload.call_id || row.payload.item.id;
    const owner = main.find(e => e.rawRefs.some(r => r.line === first));
    assert.deepEqual([owner.kind, owner.status], [kind, status], id);
    assert.deepEqual(owner.rawRefs.map(r => r.line), detached ? [first, first + 2] : [first, first + 1, first + 2], id);
    const owners = session.logicalEvents.filter(e => e.rawRefs.some(r => r.line === first + 1));
    assert.deepEqual(owners.map(e => [e.layer, e.rawRefs.length]), detached ? [['protocol', 1]] : [['main', 3]], id);
    for (let line = first; line <= first + 2; line += 1) {
      const raw = session.rawEvents.find(r => r.source.line === line);
      const record = await codex.readIndexedCodexRawRecord(index, session, raw);
      assert.deepEqual(JSON.parse(record.raw), f.records[line - 1], id);
    }
  }
});

test('scoped requests separate repeated IDs and retain disputed receipts in Protocol', async (t) => {
  const namespace = 'mcp__106cd32d0170__notes';
  const call_id = 'shared';
  const scoped = response({ type: 'function_call', call_id, name: 'shell_command', namespace, arguments: '{"command":"scoped"}' });
  const native = response({ type: 'function_call', call_id, name: 'shell_command', arguments: '{"command":"native"}' });
  const end = event({ type: 'mcp_tool_call_end', call_id,
    invocation: { environment_id: 'synthetic-registration-scope', server: 'notes', tool: 'shell_command', arguments: {} },
    result: { Err: 'scoped_legacy_error' } });
  const output = response({ type: 'function_call_output', call_id, output: 'plain_function_receipt' });
  const patch = response({ type: 'custom_tool_call', call_id, name: 'apply_patch',
    input: '*** Begin Patch\n*** Add File: synthetic.txt\n+example\n*** End Patch' });
  const customOutput = response({ type: 'custom_tool_call_output', call_id,
    output: '{"output":"custom_patch_receipt","metadata":{"exit_code":0}}' });
  const cases = [
    ...[[native, scoped], [scoped, native]].map(([first, second]) => ({
      name: `${first.payload.namespace ? 'scoped' : 'native'} shell first`, rows: [first, second, end, output],
      main: [['other_tool_call', 'incomplete', [3]], ['other_tool_call', 'incomplete', [4]]],
      detached: [[5, 'scoped_legacy_error'], [6, 'plain_function_receipt']],
    })),
    { name: 'one owner per channel', rows: [scoped, patch, customOutput, output],
      main: [['other_tool_call', 'completed', [3, 6]], ['patch', 'success', [4, 5]]], detached: [] },
    { name: 'wrong channel', rows: [scoped, customOutput],
      main: [['other_tool_call', 'incomplete', [3]]], detached: [[4, 'custom_patch_receipt']] },
    { name: 'next turn', rows: [scoped, event({ type: 'task_started', turn_id: 'another-turn' }), output],
      main: [['other_tool_call', 'incomplete', [3]]], detached: [[5, 'plain_function_receipt']] },
  ];
  for (const scenario of cases) await t.test(scenario.name, async (t) => {
    const f = await fixture(t, scenario.rows);
    const index = await codex.buildSourceBackedIndex(f.options);
    const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
    const main = session.logicalEvents.filter(e => e.layer === 'main').sort((a, b) => a.rawRefs[0].line - b.rawRefs[0].line);
    assert.equal(session.counts.toolCalls, scenario.main.length);
    assert.equal(new Set(main.map(e => e.id)).size, scenario.main.length);
    assert.deepEqual(main.map(e => [e.kind, e.status, e.rawRefs.map(r => r.line)]), scenario.main);
    for (const owner of main) {
      const request = f.records[owner.rawRefs[0].line - 1].payload;
      assert.equal(owner.toolName, request.namespace ? `${request.namespace}__${request.name}` : request.name);
    }
    for (const [line, marker] of scenario.detached) {
      const owners = session.logicalEvents.filter(e => e.rawRefs.some(r => r.line === line));
      assert.deepEqual(owners.map(e => [e.layer, e.rawRefs.map(r => r.line)]), [['protocol', [line]]]);
      for (const layer of ['main', 'protocol']) {
        const hits = codex.query.getTimeline(index, session, { layer, q: marker });
        assert.deepEqual(hits.events.filter(e => e.hasSearchHit).map(e => e.id), layer === 'protocol' ? [owners[0].id] : []);
      }
    }
  });
});

test('scoped lifecycle evidence respects terminal agreement, tool family and turn ownership', async (t) => {
  const call_id = 'reused-call';
  const namespace = 'mcp__106cd32d0170__notes';
  const environment = 'synthetic-registration-scope';
  const tool = 'shell_command';
  const scoped = response({ type: 'function_call', call_id, namespace, name: tool, arguments: '{}' });
  const receipt = response({ type: 'function_call_output', call_id, output: 'current_function_marker' });
  const legacyEnd = (failed, environmentId = environment, server = 'notes') => event({ type: 'mcp_tool_call_end', call_id,
    invocation: { server, tool, environment_id: environmentId, arguments: {} },
    result: failed ? { Err: 'legacy_terminal_marker' } : { Ok: { content: [{ type: 'text', text: 'legacy_terminal_marker' }] } } });
  const typedEnd = (failed, environmentId = environment, marker = 'typed_terminal_marker') => typed({ type: 'McpToolCall', id: call_id, server: 'notes', tool, environmentId,
    arguments: {}, status: failed ? 'failed' : 'completed',
    ...(failed ? { error: { message: marker } } : { result: { content: [{ type: 'text', text: marker }], isError: false } }) });
  const patch = response({ type: 'custom_tool_call', call_id, name: 'apply_patch',
    input: '*** Begin Patch\n*** Add File: synthetic.txt\n+example\n*** End Patch' });
  const patchReceipt = response({ type: 'custom_tool_call_output', call_id,
    output: '{"output":"patch_receipt_marker","metadata":{"exit_code":0}}' });
  const commandEnd = event({ type: 'exec_command_end', call_id, command: ['synthetic'], status: 'failed',
    exit_code: 1, aggregated_output: 'command_terminal_marker' });
  const patchEnd = event({ type: 'patch_apply_end', call_id, success: true, status: 'completed',
    changes: { 'synthetic.txt': { type: 'add', content: 'example' } }, stdout: 'synthetic patch applied', stderr: '' });
  const scopedCustom = response({ type: 'custom_tool_call', call_id, namespace, name: 'custom', input: 'synthetic input' });
  const customReceipt = response({ type: 'custom_tool_call_output', call_id, output: 'scoped_custom_marker' });
  const child = 'bbbbbbbb-0110-4110-8110-bbbbbbbbbbbb';
  const orphan = response({ type: 'function_call_output', call_id, output: 'orphan_receipt_marker' });
  const dynamicEnd = (identity, outcome) => event({ type: 'dynamic_tool_call_end', call_id, ...identity, ...outcome });
  const qualifiedDynamic = { tool_name: namespace + '.' + tool };
  const dynamicSuccess = { success: true, status: 'completed', result: 'dynamic_end_marker' };
  const dynamicCompleted = dynamicEnd(qualifiedDynamic, { status: 'completed', result: 'dynamic_end_marker' });
  const typedDynamicFailure = typed({ type: 'DynamicToolCall', id: call_id, namespace, tool, arguments: {},
    status: 'failed', success: false, error: 'dynamic_failure_marker' });
  const typedDynamicSuccess = typed({ type: 'DynamicToolCall', id: call_id, namespace, tool, arguments: {},
    status: 'completed', success: true, content_items: [{ type: 'inputText', text: 'dynamic_success_marker' }] });
  const dynamicDecline = event({ type: 'dynamic_tool_call_declined', call_id, ...qualifiedDynamic, reason: 'decline_marker' });
  const mcpDecline = event({ type: 'mcp_tool_call_declined', call_id,
    invocation: { server: 'notes', tool, environment_id: environment, arguments: {} }, reason: 'decline_marker' });
  const foreignTypedEnd = typedEnd(false, 'foreign-environment', 'second_terminal_marker');
  const independentDynamic = response({ type: 'function_call', call_id, namespace: 'fixture', name: 'lookup', arguments: '{}' });
  const dynamicRequest = event({ type: 'dynamic_tool_call_request', callId: call_id, turnId: TURN, startedAtMs: 1,
    namespace, tool, arguments: { query: 'transport_request_marker' } });
  const dynamicResponse = event({ type: 'dynamic_tool_call_response', call_id, turn_id: TURN, completed_at_ms: 2,
    namespace, tool, arguments: {}, content_items: [], success: false, error: 'transport_response_marker', duration });
  const stamped = (row, turn_id) => response({ ...row.payload, internal_chat_message_metadata_passthrough: { turn_id } });
  const oldReceipt = stamped(response({ ...receipt.payload, output: 'old_receipt_marker' }), 'previous-turn');
  const cases = [
    ...[[scoped, receipt], [scopedCustom, customReceipt]].map(([call, output]) => ({
      name: `${call.payload.type} cannot own a response stamped for a previous turn`,
      rows: [stamped(call, TURN), stamped(output, 'previous-turn')],
      main: [['other_tool_call', 'incomplete', [3]]], detached: [4], markers: [[4, output.payload.output]] })),
    { name: 'a foreign response stamp leaves the typed failure and current receipt searchable',
      rows: [scoped, oldReceipt, typedEnd(true), stamped(receipt, TURN)],
      main: [['mcp_call', 'failed', [3, 5, 6]]], detached: [4],
      markers: [[4, 'old_receipt_marker'], [5, 'typed_terminal_marker'], [6, 'current_function_marker']] },
    { name: 'turn_context identifies a foreign receipt even when the request is unstamped',
      initialTurn: { type: 'turn_context', payload: { turn_id: TURN } },
      rows: [scoped, oldReceipt, receipt], main: [['other_tool_call', 'completed', [3, 5]]], detached: [4],
      markers: [[4, 'old_receipt_marker'], [5, 'current_function_marker']] },
    ...[false, true].map(withLocal => ({ name: `the verified terminal supplies a turn in a fragment (local receipt=${withLocal})`,
      initialTurn: null,
      rows: [scoped, oldReceipt, typedEnd(true), ...(withLocal ? [stamped(receipt, TURN)] : [])],
      main: [['mcp_call', 'failed', withLocal ? [2, 4, 5] : [2, 4]]], detached: [3],
      markers: [[3, 'old_receipt_marker'], [4, 'typed_terminal_marker']] })),
    { name: 'a foreign terminal cannot supply a turn for a fragment',
      initialTurn: null, rows: [scoped, typedEnd(true, 'elsewhere'), oldReceipt],
      main: [['other_tool_call', 'completed', [2, 4]]], detached: [3],
      markers: [[3, 'typed_terminal_marker'], [4, 'old_receipt_marker']] },
    { name: 'a request stamped for another turn cannot take the current typed failure',
      rows: [stamped(scoped, 'previous-turn'), typedEnd(true), stamped(receipt, TURN)],
      main: [['other_tool_call', 'incomplete', [3]]], detached: [4, 5],
      markers: [[4, 'typed_terminal_marker'], [5, 'current_function_marker']] },
    { name: 'an unstamped historical request and a current stamped receipt can share a typed terminal',
      rows: [scoped, typedEnd(true), stamped(receipt, TURN)],
      main: [['mcp_call', 'failed', [3, 4, 5]]], detached: [],
      markers: [[4, 'typed_terminal_marker'], [5, 'current_function_marker']] },
    { name: 'an independent native function excludes an old stamped receipt before counting outputs',
      rows: [scopedCustom, independentDynamic, oldReceipt, stamped(receipt, TURN), customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['other_tool_call', 'completed', [4, 6]]], detached: [5],
      markers: [[5, 'old_receipt_marker'], [6, 'current_function_marker']] },
    { name: 'dynamic transport mirrors leave the verified typed failure on its request',
      rows: [scoped, dynamicRequest, typedDynamicFailure, dynamicResponse, receipt],
      main: [['other_tool_call', 'failed', [3, 5, 7]]], detached: [4, 6],
      markers: [[4, 'transport_request_marker'], [5, 'dynamic_failure_marker'], [6, 'transport_response_marker']] },
    { name: 'dynamic transport alone leaves the request outcome unverified',
      rows: [scoped, dynamicRequest, dynamicResponse, receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'transport_request_marker'], [5, 'transport_response_marker']] },
    { name: 'same-turn dynamic transport cannot attest an MCP terminal',
      rows: [scoped, dynamicRequest, typedEnd(true), receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'transport_request_marker'], [5, 'typed_terminal_marker']] },
    { name: 'a dynamic transport request naming another turn cannot dispute the local MCP failure',
      rows: [scoped, event({ ...dynamicRequest.payload, turnId: 'other-turn' }), typedEnd(true), receipt],
      main: [['mcp_call', 'failed', [3, 5, 6]]], detached: [4],
      markers: [[4, 'transport_request_marker'], [5, 'typed_terminal_marker']] },
    ...[
      [{ namespace: 'functions', name: 'lookup' }, {}],
      [{ name: 'lookup' }, { namespace: 'functions' }],
      [{ name: 'fixture.lookup' }, { namespace: 'fixture' }],
    ].map(([request, registration]) => ({ name: `independent dynamic failure keeps its registered name for ${JSON.stringify(request)}`,
      rows: [scopedCustom, response({ type: 'function_call', call_id, ...request, arguments: '{}' }),
        typed({ type: 'DynamicToolCall', id: call_id, ...registration, tool: 'lookup', status: 'failed', success: false,
          error: 'dynamic_failure_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['other_tool_call', 'failed', [4, 5, 6]]], detached: [],
      markers: [[5, 'dynamic_failure_marker'], [6, 'current_function_marker']] })),
    { name: 'a lone legacy qualified function retains its same-turn dynamic failure without a typed thread ID',
      rows: [scoped, event({ type: 'item_completed', turn_id: TURN, item: typedDynamicFailure.payload.item }), receipt],
      main: [['other_tool_call', 'failed', [3, 4, 5]]], detached: [],
      markers: [[4, 'dynamic_failure_marker'], [5, 'current_function_marker']] },
    { name: 'a lone qualified function retains its in-scope dynamic failure without a typed turn ID',
      rows: [scoped, event({ type: 'item_completed', thread_id: ID, item: typedDynamicFailure.payload.item }), receipt],
      main: [['other_tool_call', 'failed', [3, 4, 5]]], detached: [],
      markers: [[4, 'dynamic_failure_marker'], [5, 'current_function_marker']] },
    ...[false, true].map(withCustom => ({ name: `a typed failure missing its thread ID disputes legacy success (custom=${withCustom})`,
      rows: [scoped, event({ type: 'item_completed', turn_id: TURN, item: typedDynamicFailure.payload.item }),
        dynamicEnd(qualifiedDynamic, dynamicSuccess), receipt, ...(withCustom ? [scopedCustom, customReceipt] : [])],
      main: [['other_tool_call', 'completed', [3, 6]], ...(withCustom ? [['other_tool_call', 'completed', [7, 8]]] : [])],
      detached: [4, 5], markers: [[4, 'dynamic_failure_marker'], [5, 'dynamic_end_marker'], [6, 'current_function_marker']] })),
    ...[environment, 'foreign-environment'].map(environmentId => {
      const local = environmentId === environment;
      return { name: `a typed item with no tool and environment ${environmentId} is checked by physical item ID`,
        rows: [scoped, typedEnd(true), typed({ type: 'McpToolCall', id: call_id, environmentId, server: 'notes',
          status: 'completed', arguments: { query: 'partial_marker' } }), receipt],
        main: local ? [['other_tool_call', 'completed', [3, 6]]] : [['mcp_call', 'failed', [3, 4, 6]]],
        detached: local ? [4, 5] : [5], markers: [[4, 'typed_terminal_marker'], [5, 'partial_marker']] };
    }),
    ...[
      [typed({ type: 'DynamicToolCall', id: call_id, namespace: 'foreign', status: 'failed' }), true],
      [typed({ type: 'DynamicToolCall', id: call_id, namespace, status: 'failed' }), false],
      [typed({ type: 'McpToolCall', id: call_id, environmentId: environment, server: 'other', status: 'failed' }), true],
      [typed({ type: 'McpToolCall', id: call_id, environmentId: environment, tool: 'other', status: 'failed' }), true],
      [typed({ type: 'McpToolCall', id: call_id, server: 'other', status: 'failed' }), true],
      [event({ type: 'dynamic_tool_call_request', call_id, namespace: 'foreign' }), true],
      [event({ type: 'dynamic_tool_call_request', call_id, namespace }), false],
    ].map(([partial, foreign]) => ({ name: `partial ${JSON.stringify(partial.payload.item || partial.payload)} beside verified MCP failure`,
      rows: [scoped, partial, typedEnd(true), receipt],
      main: foreign ? [['mcp_call', 'failed', [3, 5, 6]]] : [['other_tool_call', 'completed', [3, 6]]],
      detached: foreign ? [4] : [4, 5], markers: [[5, 'typed_terminal_marker']] })),
    ...['dynamic_tool_call_request', 'dynamic_tool_call_response'].map(type => ({
      name: `foreign ${type} remains Protocol beside an exact typed MCP failure`,
      rows: [scoped, event({ type, call_id, turn_id: TURN, namespace: 'foreign', tool: 'other',
        arguments: { query: 'transport_marker' } }), typedEnd(true), receipt],
      main: [['mcp_call', 'failed', [3, 5, 6]]], detached: [4],
      markers: [[4, 'transport_marker'], [5, 'typed_terminal_marker']] })),
    ...[
      ['false without status', { success: false }, 'failed'],
      ['an unknown success flag', { success: 'unknown' }, 'completed'],
      ['a neutral completion', { status: 'completed' }, 'completed'],
    ].map(([label, outcome, status]) => ({ name: `an independent dynamic function reports ${label}`,
      rows: [scopedCustom, independentDynamic,
        dynamicEnd({ tool_name: 'fixture.lookup' }, { ...outcome, result: 'dynamic_end_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['other_tool_call', status, [4, 5, 6]]], detached: [],
      markers: [[5, 'dynamic_end_marker'], [6, 'current_function_marker'], [7, 'scoped_custom_marker']] })),
    { name: 'opposing ends of the independent dynamic function stay disputed',
      rows: [scopedCustom, independentDynamic, dynamicEnd({ tool_name: 'fixture.lookup' }, dynamicSuccess),
        dynamicEnd({ tool_name: 'fixture.lookup' }, { success: false, result: 'second_terminal_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['other_tool_call', 'completed', [4, 7]]], detached: [5, 6],
      markers: [[5, 'dynamic_end_marker'], [6, 'second_terminal_marker'], [7, 'current_function_marker'], [8, 'scoped_custom_marker']] },
    { name: 'an exact scoped dynamic begin without an end or receipt stays incomplete',
      rows: [scoped, event({ type: 'dynamic_tool_call_begin', call_id, ...qualifiedDynamic, arguments: { query: 'begin_marker' } })],
      main: [['other_tool_call', 'incomplete', [3, 4]]], detached: [], markers: [[4, 'begin_marker']] },
    { name: 'an in-progress typed dynamic item keeps its request and physical evidence',
      rows: [scoped, typed({ type: 'DynamicToolCall', id: call_id, namespace, tool, status: 'in_progress', arguments: {} })],
      main: [['other_tool_call', 'incomplete', [3, 4]]], detached: [], markers: [] },
    ...[
      event({ ...dynamicDecline.payload, success: false }),
      dynamicEnd(qualifiedDynamic, { status: 'declined', success: false, result: 'decline_marker' }),
      typed({ type: 'DynamicToolCall', id: call_id, namespace, tool, arguments: {}, status: 'declined', success: false,
        content_items: [{ type: 'inputText', text: 'decline_marker' }] }),
    ].map(decline => ({ name: `a false success flag preserves explicit decline on ${decline.payload.type}`,
      rows: [scoped, decline, receipt], main: [['other_tool_call', 'declined', [3, 4, 5]]], detached: [],
      markers: [[4, 'decline_marker'], [5, 'current_function_marker']] })),
    ...[['dynamic', dynamicDecline, 'other_tool_call'], ['MCP', mcpDecline, 'mcp_call']].flatMap(([family, decline, kind]) =>
      [false, true].map(withReceipt => ({ name: `an exact scoped ${family} decline ${withReceipt ? 'with' : 'without'} a receipt`,
        rows: withReceipt ? [scoped, decline, receipt] : [scoped, decline],
        main: [[kind, 'declined', withReceipt ? [3, 4, 5] : [3, 4]]], detached: [],
        markers: withReceipt ? [[4, 'decline_marker'], [5, 'current_function_marker']] : [[4, 'decline_marker']] }))),
    ...[
      [dynamicDecline, typedDynamicFailure, 'dynamic_failure_marker'],
      [dynamicDecline, dynamicEnd(qualifiedDynamic, dynamicSuccess), 'dynamic_end_marker'],
      [mcpDecline, typedEnd(true), 'typed_terminal_marker'],
      [mcpDecline, legacyEnd(false), 'legacy_terminal_marker'],
    ].map(([decline, other, marker]) => ({ name: `${decline.payload.type} conflicts with ${marker}`,
      rows: [scoped, decline, other, receipt], main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'decline_marker'], [5, marker], [6, 'current_function_marker']] })),
    ...[false, true].map(foreignFirst => ({ name: `an explicitly foreign typed MCP terminal comes ${foreignFirst ? 'before' : 'after'} the exact terminal`,
      rows: [scoped, ...(foreignFirst ? [foreignTypedEnd, typedEnd(true)] : [typedEnd(true), foreignTypedEnd]), receipt],
      main: [['mcp_call', 'failed', [3, foreignFirst ? 5 : 4, 6]]], detached: [foreignFirst ? 4 : 5],
      markers: [[foreignFirst ? 5 : 4, 'typed_terminal_marker'], [foreignFirst ? 4 : 5, 'second_terminal_marker'], [6, 'current_function_marker']] })),
    ...[['a repeated registration', environment], ['an unknown registration', null]].map(([label, otherEnvironment]) => ({
      name: `typed MCP candidates remain disputed with ${label}`,
      rows: [scoped, typedEnd(true), typedEnd(true, otherEnvironment, 'second_terminal_marker'), receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'typed_terminal_marker'], [5, 'second_terminal_marker'], [6, 'current_function_marker']] })),
    ...['begin', 'update', 'declined'].map(phase => ({ name: `a foreign dynamic ${phase} preserves an exact typed MCP failure`,
      rows: [scoped, event({ type: 'dynamic_tool_call_' + phase, call_id, tool_name: namespace + '.other', message: 'foreign_phase_marker' }),
        typedEnd(true), receipt], main: [['mcp_call', 'failed', [3, 5, 6]]], detached: [4],
      markers: [[4, 'foreign_phase_marker'], [5, 'typed_terminal_marker'], [6, 'current_function_marker']] })),
    ...[
      ['send_input', 'matching id', { id: child }, true], ['send_input', 'different id', { id: ID }, false],
      ['send_input', 'matching target UUID', { target: child }, true], ['send_input', 'different target UUID', { target: ID }, false],
      ['send_input', 'matching compact id', { id: child.replaceAll('-', '').toUpperCase() }, true],
      ['send_input', 'different compact id', { id: ID.replaceAll('-', '') }, false],
      ['send_input', 'a path target', { target: '/root/reviewer' }, true],
      ['close_agent', 'different id', { id: ID }, false], ['send_message', 'different target', { target: ID }, false],
      ['send_message', 'matching target on an unrelated interaction', { target: child }, false],
      ['close_agent', 'matching braced target', { target: '{' + child + '}' }, true],
      ['close_agent', 'different braced target', { target: '{' + ID + '}' }, false],
      ['close_agent', 'an opaque braced compact target', { target: '{' + ID.replaceAll('-', '') + '}' }, true],
      ['wait_agent', 'a requested subset', { targets: [ID, child] }, true], ['wait_agent', 'a foreign target', { targets: [ID] }, false],
      ['wait_agent', 'matching URN target', { targets: ['urn:uuid:' + child.toUpperCase()] }, true],
      ['wait_agent', 'different URN target', { targets: ['urn:uuid:' + ID] }, false],
      ['wait_agent', 'an invalid UUID and path spelling', { targets: ['URN:UUID:' + ID] }, false],
      ['wait_agent', 'a UUID and an alias', { targets: [ID, '/root/reviewer'] }, true],
    ].map(([name, label, args, matches]) => ({ name: `native ${name} with ${label} beside a scoped custom request`,
      rows: [scopedCustom, response({ type: 'function_call', call_id, name,
        arguments: JSON.stringify(['send_input', 'send_message'].includes(name) ? { ...args, message: 'synthetic input' } : args) }),
        event({ call_id, sender_thread_id: ID, status: 'failed', ...(name === 'wait_agent'
          ? { type: 'collab_waiting_end', statuses: { [child]: { errored: 'receiver_marker' } } }
          : { type: name === 'close_agent' ? 'collab_close_end' : 'collab_agent_interaction_end',
            receiver_thread_id: child, receiver_agent_nickname: 'receiver_marker' }) }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['agent_coordination', matches ? 'failed' : 'success', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'receiver_marker'], [6, 'current_function_marker'], [7, 'scoped_custom_marker']] })),
    ...[
      ['the original message', { message: 'sent text' }, 'sent text', true],
      ['a redacted historical prompt', { message: 'sent text' }, '', true],
      ['a different interaction prompt', { message: 'sent text' }, 'other text', false],
      ['an unknown string-message field', { message: 'sent text', extra: true }, 'sent text', false],
      ['a v2 message in the v1 namespace', { message: 'sent text' }, 'sent text', false, 'multi_agent_v1'],
      ['a valid relative agent path', { target: 'review/team', message: 'sent text' }, 'sent text', true],
      ['a redacted prompt with a relative path', { target: 'review/team', message: 'sent text' }, '', false],
      ['an invalid path', { target: '/other/reviewer', message: 'sent text' }, 'sent text', false],
      ['historical text items', { items: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }, 'first\nsecond', true],
      ['an extra string field ignored by the items writer', { items: [{ type: 'text', text: 'sent text' }], message: 'ignored' }, 'sent text', true],
      ['a wrongly typed interrupt on historical items', { items: [{ type: 'text', text: 'sent text' }], interrupt: 'false' }, 'sent text', false],
    ].map(([label, args, prompt, matches, namespace]) => ({ name: `legacy send_message with ${label} beside a scoped custom request`,
      rows: [scopedCustom, response({ type: 'function_call', call_id, name: 'send_message',
        ...(namespace ? { namespace } : {}), arguments: JSON.stringify({ target: child, ...args }) }),
        event({ type: 'collab_agent_interaction_end', call_id, sender_thread_id: ID, receiver_thread_id: child,
          receiver_agent_nickname: 'receiver_marker', prompt, status: 'running' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['agent_coordination', 'success', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'receiver_marker'], [6, 'current_function_marker']] })),
    ...[
      ['a matching historical ids wait', undefined, { ids: [ID, child] }, { statuses: { [child]: 'running' } }, true],
      ['an unrelated historical ids wait', undefined, { ids: [ID] }, { statuses: { [child]: 'running' } }, false],
      ['a complete targeted begin', 'multi_agent_v1', { targets: [child, ID] }, { receiver_thread_ids: [child, ID] }, true],
      ['a V1 wait with ignored fields', 'multi_agent_v1', { targets: [child], ids: [ID], extra: true }, { statuses: { [child]: 'running' } }, true],
      ['a V1 wait with ignored foreign ids', 'multi_agent_v1', { targets: [child], ids: [ID] }, { statuses: { [ID]: 'running' } }, false],
      ['a partial targeted begin', 'multi_agent_v1', { targets: [child, ID] }, { receiver_thread_ids: [child] }, false],
      ['a reversed targeted begin', 'multi_agent_v1', { targets: [child, ID] }, { receiver_thread_ids: [ID, child] }, false],
      ['a historical path begin', undefined, { targets: [ID, '/root/reviewer'] }, { receiver_thread_ids: [ID, child] }, true],
      ['a repeated path with one receiver', undefined, { targets: ['reviewer', 'reviewer'] }, { receiver_thread_ids: [child, child] }, true],
      ['a repeated path with two receivers', undefined, { targets: ['reviewer', 'reviewer'] }, { receiver_thread_ids: [child, ID] }, false],
      ['a repeated path with two final statuses', undefined, { targets: ['reviewer', 'reviewer'] }, { statuses: { [child]: 'running', [ID]: 'running' } }, false],
      ['an invalid path segment', undefined, { targets: ['review/../missing'] }, { statuses: { [child]: 'running' } }, false],
      ['a targeted timeout', 'multi_agent_v1', { targets: [ID, child] }, { statuses: {} }, true],
      ['a missing V1 target list', 'multi_agent_v1', {}, { statuses: {} }, false],
      ['a mailbox begin', 'agents', {}, { receiver_thread_ids: [] }, true],
      ['a mailbox end', 'collaboration', { timeout_ms: 10000 }, { statuses: {} }, true],
      ['a mailbox begin with a receiver', undefined, {}, { receiver_thread_ids: [child] }, false],
      ['a mailbox end with a receiver', 'collaboration', { timeout_ms: 10000 }, { statuses: { [child]: 'running' } }, false],
      ['a mailbox end with receiver metadata', 'agents', {}, { statuses: {}, agent_statuses: [{ thread_id: child, status: 'running' }] }, false],
      ['a mailbox end missing the recorded status map', 'collaboration', {}, {}, false],
      ['an explicit target in the mailbox namespace', 'collaboration', { targets: [child] }, { statuses: { [child]: 'running' } }, false],
    ].map(([label, namespace, args, evidence, matches]) => {
      const begin = Object.hasOwn(evidence, 'receiver_thread_ids');
      const phase = begin ? { type: 'collab_waiting_begin', started_at_ms: 1786000000123 }
        : { type: 'collab_waiting_end', completed_at_ms: 1786000000123 };
      return { name: `native wait_agent with ${label} beside a scoped custom request`,
        rows: [scopedCustom, response({ type: 'function_call', call_id, name: 'wait_agent',
          ...(namespace ? { namespace } : {}), arguments: JSON.stringify(args) }),
          event({ ...phase, sender_thread_id: ID, call_id, ...evidence }), receipt, customReceipt],
        main: [['other_tool_call', 'completed', [3, 7]], ['agent_coordination', 'success', matches ? [4, 5, 6] : [4, 6]]],
        detached: matches ? [] : [5], markers: [[5, '1786000000123'], [6, 'current_function_marker']] };
    }),
    ...[[scoped, receipt], [scopedCustom, customReceipt]].flatMap(([call, output]) =>
      [{ name: 'other' }, { namespace: namespace + '_other' }].map(identity => ({
        name: `${call.payload.type} keeps a compatible receipt beside an explicit foreign ${Object.keys(identity)[0]}`,
        rows: [call, response({ ...output.payload, ...identity, output: 'foreign_receipt_marker' }),
          response({ ...output.payload, name: call.payload.name, namespace })],
        main: [['other_tool_call', 'completed', [3, 5]]], detached: [4],
        markers: [[4, 'foreign_receipt_marker'], [5, output.payload.output]],
      }))),
    { name: 'a foreign receipt leaves an exact legacy failure with its request',
      rows: [scoped, legacyEnd(true), response({ ...receipt.payload, name: 'other' })],
      main: [['mcp_call', 'failed', [3, 4]]], detached: [5],
      markers: [[4, 'legacy_terminal_marker'], [5, 'current_function_marker']] },
    ...['notes', 'other-notes'].map(server => ({ name: `a foreign legacy success from ${server} does not contradict local typed failure`,
      rows: [scoped, typedEnd(true), legacyEnd(false, 'other-environment', server), receipt],
      main: [['mcp_call', 'failed', [3, 4, 6]]], detached: [5],
      markers: [[4, 'typed_terminal_marker'], [5, 'legacy_terminal_marker'], [6, 'current_function_marker']] })),
    { name: 'an independent custom patch preserves a scoped function typed failure',
      rows: [scoped, patch, typedEnd(true), patchEnd, patchReceipt, receipt],
      main: [['mcp_call', 'failed', [3, 5, 8]], ['patch', 'success', [4, 6, 7]]], detached: [],
      markers: [[5, 'typed_terminal_marker'], [7, 'patch_receipt_marker'], [8, 'current_function_marker']] },
    { name: 'scoped requests on two channels give the typed MCP row only to its function owner',
      rows: [response({ ...scopedCustom.payload, name: tool }), scoped, typedEnd(true), customReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 6]], ['mcp_call', 'failed', [4, 5, 7]]], detached: [],
      markers: [[5, 'typed_terminal_marker'], [6, 'scoped_custom_marker'], [7, 'current_function_marker']] },
    ...[
      ['exact identity', qualifiedDynamic, true],
      ['missing name', {}, false],
      ['different tool', { tool_name: namespace + '.other' }, false],
      ['different explicit namespace', { ...qualifiedDynamic, namespace: 'elsewhere' }, false],
    ].map(([label, fields, matches]) => ({ name: `scoped legacy dynamic failure with ${label}`,
      rows: [scoped, dynamicEnd(fields, { status: 'failed', success: false, error: 'dynamic_end_marker' }), receipt],
      main: [['other_tool_call', matches ? 'failed' : 'completed', matches ? [3, 4, 5] : [3, 5]]], detached: matches ? [] : [4],
      markers: [[4, 'dynamic_end_marker'], [5, 'current_function_marker']] })),
    { name: 'a scoped legacy dynamic end reports failure through success alone',
      rows: [scoped, dynamicEnd(qualifiedDynamic, { success: false, result: 'dynamic_end_marker' }), receipt],
      main: [['other_tool_call', 'failed', [3, 4, 5]]], detached: [],
      markers: [[4, 'dynamic_end_marker'], [5, 'current_function_marker']] },
    { name: 'an independent custom patch preserves a scoped typed dynamic failure',
      rows: [scoped, patch, typedDynamicFailure, patchEnd, patchReceipt, receipt],
      main: [['other_tool_call', 'failed', [3, 5, 8]], ['patch', 'success', [4, 6, 7]]], detached: [],
      markers: [[5, 'dynamic_failure_marker'], [7, 'patch_receipt_marker'], [8, 'current_function_marker']] },
    ...[
      [typedDynamicFailure, 'dynamic_failure_marker', dynamicSuccess],
      [typedDynamicSuccess, 'dynamic_success_marker', { success: false, error: 'dynamic_end_marker' }],
    ].map(([typedTerminal, marker, legacyOutcome]) => ({ name: `a custom patch cannot resolve a ${typedTerminal.payload.item.status} typed dynamic conflict`,
      rows: [scoped, patch, typedTerminal, dynamicEnd(qualifiedDynamic, legacyOutcome), patchEnd, patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 9]], ['patch', 'success', [4, 7, 8]]], detached: [5, 6],
      markers: [[5, marker], [6, 'dynamic_end_marker'], [8, 'patch_receipt_marker'], [9, 'current_function_marker']] })),
    ...[
      ['legacy', dynamicEnd(qualifiedDynamic, { success: false, error: 'dynamic_failure_marker' })],
      ['typed', typedDynamicFailure],
    ].map(([source, failure]) => ({ name: `a ${source} dynamic failure conflicts with an exact legacy dynamic success`,
      rows: [scoped, failure, dynamicEnd(qualifiedDynamic, dynamicSuccess), receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'dynamic_failure_marker'], [5, 'dynamic_end_marker'], [6, 'current_function_marker']] })),
    { name: 'a legacy dynamic completion preserves the explicit failure of its typed mirror',
      rows: [scoped, typedDynamicFailure, dynamicCompleted, receipt],
      main: [['other_tool_call', 'failed', [3, 4, 5, 6]]], detached: [],
      markers: [[4, 'dynamic_failure_marker'], [5, 'dynamic_end_marker'], [6, 'current_function_marker']] },
    { name: 'a scoped legacy dynamic completion without an outcome stays completed',
      rows: [scoped, dynamicCompleted, receipt], main: [['other_tool_call', 'completed', [3, 4, 5]]], detached: [],
      markers: [[4, 'dynamic_end_marker'], [5, 'current_function_marker']] },
    { name: 'a scoped typed MCP failure and exact legacy dynamic success dispute their common request',
      rows: [scoped, typedEnd(true), dynamicEnd(qualifiedDynamic, dynamicSuccess), receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'typed_terminal_marker'], [5, 'dynamic_end_marker'], [6, 'current_function_marker']] },
    ...[['foreign name', { tool_name: namespace + '.other' }], ['foreign namespace', { ...qualifiedDynamic, namespace: 'elsewhere' }]]
      .map(([label, identity]) => ({ name: `a legacy dynamic end with ${label} leaves an exact typed MCP failure intact`,
        rows: [scoped, typedEnd(true), dynamicEnd(identity, dynamicSuccess), receipt],
        main: [['mcp_call', 'failed', [3, 4, 6]]], detached: [5],
        markers: [[4, 'typed_terminal_marker'], [5, 'dynamic_end_marker'], [6, 'current_function_marker']] })),
    ...[['missing', {}, true], ['same', { sender_thread_id: ID }, true], ['foreign', { sender_thread_id: child }, false]]
      .map(([label, fields, matches]) => ({ name: `native spawn beside a scoped custom call with ${label} sender`,
        rows: [scopedCustom, response({ type: 'function_call', call_id, namespace: 'collaboration', name: 'spawn_agent', arguments: '{}' }),
          event({ type: 'collab_agent_spawn_end', call_id, new_thread_id: 'spawn_child_marker', status: 'failed', ...fields }),
          receipt, customReceipt],
        main: [['other_tool_call', 'completed', [3, 7]], ['agent_coordination', matches ? 'failed' : 'success', matches ? [4, 5, 6] : [4, 6]]],
        detached: matches ? [] : [5], markers: [[5, 'spawn_child_marker'], [6, 'current_function_marker'], [7, 'scoped_custom_marker']] })),
    { name: 'typed failure followed by legacy success', rows: [scoped, typedEnd(true), legacyEnd(false), receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'typed_terminal_marker'], [5, 'legacy_terminal_marker'], [6, 'current_function_marker']] },
    { name: 'legacy failure followed by typed success', rows: [scoped, legacyEnd(true), typedEnd(false), receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, 'legacy_terminal_marker'], [5, 'typed_terminal_marker'], [6, 'current_function_marker']] },
    { name: 'agreeing typed and legacy terminals share their request', rows: [scoped, typedEnd(true), legacyEnd(true), receipt],
      main: [['mcp_call', 'failed', [3, 4, 5, 6]]], detached: [], markers: [[6, 'current_function_marker']] },
    { name: 'a foreign typed failure does not contradict local legacy success',
      rows: [scoped, typedEnd(true, 'other-environment'), legacyEnd(false), receipt],
      main: [['mcp_call', 'success', [3, 5, 6]]], detached: [4],
      markers: [[4, 'typed_terminal_marker'], [6, 'current_function_marker']] },
    { name: 'custom patch cannot own a command end', rows: [scoped, patch, commandEnd, patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', 'success', [4, 6]]], detached: [5],
      markers: [[5, 'command_terminal_marker'], [6, 'patch_receipt_marker'], [7, 'current_function_marker']] },
    { name: 'custom patch keeps a matching patch end', rows: [scoped, patch, patchEnd, patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', 'success', [4, 5, 6]]], detached: [],
      markers: [[6, 'patch_receipt_marker'], [7, 'current_function_marker']] },
    { name: 'native MCP function keeps only its matching legacy invocation beside a scoped custom call',
      rows: [scopedCustom, response({ type: 'function_call', call_id, name: 'mcp__repo__lookup', arguments: '{}' }),
        event({ type: 'mcp_tool_call_end', call_id, invocation: { server: 'repo', tool: 'lookup', arguments: {} },
          result: { Ok: { content: [{ type: 'text', text: 'native_mcp_marker' }] } } }),
        event({ type: 'mcp_tool_call_end', call_id, invocation: { server: 'other', tool: 'lookup', arguments: {} },
          result: { Err: 'foreign_mcp_marker' } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['mcp_call', 'success', [4, 5, 7]]], detached: [6],
      markers: [[5, 'native_mcp_marker'], [6, 'foreign_mcp_marker'], [7, 'current_function_marker'], [8, 'scoped_custom_marker']] },
    ...['collaboration', 'agents', 'multi_agent_v1'].map(namespace => ({
      name: `${namespace}.spawn_agent keeps its failed lifecycle and excludes a close beside a scoped custom call`,
      rows: [scopedCustom, response({ type: 'function_call', call_id, namespace, name: 'spawn_agent', arguments: '{}' }),
        event({ type: 'collab_agent_spawn_end', call_id, new_thread_id: 'synthetic-child', status: 'failed' }),
        event({ type: 'collab_close_end', call_id, status: { completed: 'foreign_close_marker' } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['agent_coordination', 'failed', [4, 5, 7]]], detached: [6],
      markers: [[6, 'foreign_close_marker'], [7, 'current_function_marker'], [8, 'scoped_custom_marker']] })),
    ...[
      ['legacy agent IDs', { ids: [child], timeout_ms: 10000 }, true],
      ['a different agent target', { ids: [ID], timeout_ms: 10000 }, false],
      ['a Code Mode cell', { cell_id: '14' }, false],
      ['mixed agent IDs and cell', { ids: [child], cell_id: '14', timeout_ms: 10000 }, false],
    ].map(([name, args, isAgentWait]) => ({ name: `bare wait with ${name}`,
      rows: [scopedCustom, response({ type: 'function_call', call_id, name: 'wait', arguments: JSON.stringify(args) }),
        event({ type: 'collab_waiting_end', call_id, sender_thread_id: ID, statuses: { [child]: { completed: 'child_completed_marker' } } }),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], isAgentWait ? ['agent_coordination', 'success', [4, 5, 6]]
        : ['other_tool_call', 'completed', [4, 6]]], detached: isAgentWait ? [] : [5],
      markers: [[5, 'child_completed_marker'], [6, 'current_function_marker'], [7, 'scoped_custom_marker']] })),
    { name: 'a qualified dynamic function owns only the end naming its tool',
      rows: [scopedCustom, response({ type: 'function_call', call_id, namespace: 'fixture', name: 'lookup', arguments: '{}' }),
        event({ type: 'dynamic_tool_call_end', call_id, tool_name: 'fixture.lookup', status: 'failed', success: false,
          error: 'dynamic_failure_marker' }),
        event({ type: 'dynamic_tool_call_end', call_id, tool_name: 'other.lookup', status: 'completed', success: true,
          result: 'foreign_dynamic_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['other_tool_call', 'failed', [4, 5, 7]]], detached: [6],
      markers: [[5, 'dynamic_failure_marker'], [6, 'foreign_dynamic_marker'], [7, 'current_function_marker']] },
    { name: 'native image generation keeps its image end and excludes a command end',
      rows: [scopedCustom, response({ type: 'function_call', call_id, namespace: 'image_gen', name: 'imagegen', arguments: '{}' }),
        event({ type: 'image_generation_end', call_id, status: 'completed', revised_prompt: 'synthetic image',
          saved_path: 'output/synthetic.png' }),
        response({ type: 'image_generation_call', id: call_id, status: 'completed',
          result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' }),
        commandEnd, receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 9]], ['other_tool_call', 'success', [4, 5, 6, 8]]], detached: [7],
      imageLine: 6, markers: [[7, 'command_terminal_marker'], [8, 'current_function_marker']] },
    ...[
      ['Err without status', { type: 'mcp_tool_call_end', result: { Err: 'native_mcp_error_marker' } }, 'failed'],
      ['explicit legacy failure', { type: 'mcp_tool_call_end', result: null, status: 'failed',
        error: { message: 'native_mcp_error_marker' } }, 'failed'],
      ['declined', { type: 'mcp_tool_call_declined' }, 'declined'],
    ].map(([name, terminal, status]) => ({ name: `a flat native MCP function preserves ${name}`,
      rows: [scopedCustom, response({ type: 'function_call', call_id, name: 'mcp__repo__lookup', arguments: '{}' }),
        event({ ...terminal, call_id, invocation: { server: 'repo', tool: 'lookup', arguments: {} } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['mcp_call', status, [4, 5, 6]]], detached: [],
      markers: status === 'failed' ? [[5, 'native_mcp_error_marker'], [6, 'current_function_marker']] : [[6, 'current_function_marker']] })),
    { name: 'a previous turn orphan does not dispute the current receipt', rows: [
      orphan, event({ type: 'task_started', turn_id: 'later-turn' }), scoped, legacyEnd(true), receipt],
      main: [['mcp_call', 'failed', [5, 6, 7]]], detached: [3],
      markers: [[3, 'orphan_receipt_marker'], [7, 'current_function_marker']] },
    { name: 'a same-turn orphan before the request does not dispute its typed terminal',
      rows: [orphan, scoped, typedEnd(true), receipt], main: [['mcp_call', 'failed', [4, 5, 6]]], detached: [3],
      markers: [[3, 'orphan_receipt_marker'], [6, 'current_function_marker']] },
    { name: 'same-turn competing requests still dispute their receipt', rows: [scoped, scoped, legacyEnd(true), receipt],
      main: [['other_tool_call', 'incomplete', [3]], ['other_tool_call', 'incomplete', [4]]], detached: [5, 6],
      markers: [[5, 'legacy_terminal_marker'], [6, 'current_function_marker']] },
    { name: 'same-turn competing receipts stay disputed', rows: [scoped, legacyEnd(true), receipt, orphan],
      main: [['other_tool_call', 'incomplete', [3]]], detached: [4, 5, 6],
      markers: [[4, 'legacy_terminal_marker'], [5, 'current_function_marker'], [6, 'orphan_receipt_marker']] },
  ];
  for (const scenario of cases) await t.test(scenario.name, async (t) => {
    const f = await fixture(t, scenario.rows, scenario.initialTurn);
    const resident = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
    const compact = await codex.buildIndex(f.options);
    const cold = await codex.buildSourceBackedIndex(f.options);
    const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: cold });
    assert.equal(warm.totals.reusedFileCount, 1);
    for (const index of [resident, compact, cold, warm]) {
      const indexed = index.sessionsById.get(ID);
      assert.equal(indexed.counts.toolCalls, scenario.main.length);
      const session = index === cold || index === warm ? await materializeSessionForIndex(index, indexed) : indexed;
      const main = session.logicalEvents.filter(e => e.layer === 'main').sort((a, b) => a.rawRefs[0].line - b.rawRefs[0].line);
      assert.deepEqual(main.map(e => [e.kind, e.status, e.rawRefs.map(r => r.line)]), scenario.main);
      assert.equal(indexed.counts.failedCommands, 0);
      assert.equal(indexed.counts.patches, scenario.main.filter(([kind]) => kind === 'patch').length);
      for (const status of new Set(scenario.main.map(([, status]) => status))) {
        const timeline = codex.query.getTimeline(index, session, { layer: 'main', status });
        assert.deepEqual(timeline.events.map(e => e.id).sort(), main.filter(e => e.status === status).map(e => e.id).sort());
      }
      for (const owner of main) {
        const detail = await codex.buildHydratedEventDetail(index, session, owner.id, 'main');
        assert.equal(detail.meta.status, owner.status);
        const detailText = JSON.stringify(detail);
        for (const [line, marker] of scenario.markers) {
          if (scenario.detached.includes(line)) assert.equal(detailText.includes(marker), false, marker);
        }
      }
      const owners = new Map();
      for (const line of [...scenario.main.flatMap(([, , lines]) => lines), ...scenario.detached]) {
        const matches = session.logicalEvents.filter(e => e.rawRefs.some(r => r.line === line));
        assert.equal(matches.length, 1);
        const [owner] = matches;
        owners.set(line, owner);
        if (scenario.detached.includes(line)) assert.deepEqual([owner.layer, owner.rawRefs.length], ['protocol', 1]);
        const ref = owner.rawRefs.find(r => r.line === line);
        const raw = session.rawEvents.find(r => r.rawId === ref.rawId);
        if (line === scenario.imageLine) assert.deepEqual(raw.embeddedImages.map(image => image.mimeType), ['image/png']);
        assert.deepEqual(JSON.parse((await codex.readIndexedCodexRawRecord(index, session, raw)).raw), f.records[line - 1]);
      }
      for (const [line, marker] of scenario.markers) {
        const owner = owners.get(line);
        for (const layer of ['main', 'protocol']) {
          const hits = codex.query.getTimeline(index, session, { layer, q: marker });
          assert.deepEqual(hits.events.filter(e => e.hasSearchHit).map(e => e.id), layer === owner.layer ? [owner.id] : [], marker);
        }
      }
    }
  });
});

test('a scoped wait cannot take ownership of a pending native cell', async (t) => {
  const namespace = 'mcp__106cd32d0170__notes';
  const marker = 'scoped-reader-output';
  for (const cellId of ['14', 'g2:14']) {
    for (const completion of ['missing', 'valid', 'conflicting environment', 'conflicting output']) {
      await t.test(`${cellId} / ${completion}`, async (t) => {
        const rows = [
          response({ type: 'custom_tool_call', name: 'exec', call_id: 'native', input: 'await yield_control()' }),
          response({ type: 'custom_tool_call_output', call_id: 'native', output: [
            { type: 'input_text', text: `Script running with cell ID ${cellId}\nWall time 0.0 seconds\nOutput:\n` },
          ] }),
          response({ type: 'function_call', name: 'wait', namespace, call_id: 'foreign',
            arguments: JSON.stringify({ cell_id: cellId }) }),
        ];
        if (completion !== 'missing') rows.push(typed({
          type: 'McpToolCall', id: 'foreign', server: 'notes', tool: 'wait', arguments: { cell_id: cellId }, status: 'failed',
          environmentId: completion === 'conflicting environment' ? 'other' : 'synthetic-registration-scope',
          error: { message: 'synthetic failure' },
        }));
        rows.push(response({ type: 'function_call_output', call_id: 'foreign',
          ...(completion === 'conflicting output' ? { name: 'different' } : {}),
          output: `Script completed\nWall time 0.0 seconds\nOutput:\n${marker}` }));
        const f = await fixture(t, rows);
        const resident = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
        const compact = await codex.buildIndex(f.options);
        const cold = await codex.buildSourceBackedIndex(f.options);
        const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: cold });
        assert.equal(warm.totals.reusedFileCount, 1);
        for (const index of [resident, compact, cold, warm]) {
          const indexed = index.sessionsById.get(ID);
          assert.equal(indexed.counts.toolCalls, 2);
          const session = index === cold || index === warm ? await materializeSessionForIndex(index, indexed) : indexed;
          const main = session.logicalEvents.filter(e => e.layer === 'main');
          assert.equal(main.length, 2);
          const operation = main.find(e => e.kind === 'code_mode_operation');
          const foreign = main.find(e => e !== operation);
          assert.equal(operation.codeModeOperation.observationState, 'pending');
          assert.equal(operation.codeModeOperation.cellId, cellId);
          assert.deepEqual(operation.rawRefs.map(r => r.line), [3, 4]);
          const verified = completion === 'valid' || completion === 'conflicting output';
          assert.equal(foreign.kind, verified ? 'mcp_call' : 'other_tool_call');
          assert.equal(foreign.status, verified ? 'failed' : 'completed');
          const outputLine = f.records.length;
          const detachedOutput = completion === 'conflicting output';
          const expectedLines = [5];
          if (verified) expectedLines.push(6);
          if (!detachedOutput) expectedLines.push(outputLine);
          assert.deepEqual(foreign.rawRefs.map(r => r.line), expectedLines);
          const outputOwners = session.logicalEvents.filter(e => e.rawRefs.some(r => r.line === outputLine));
          assert.equal(outputOwners.length, 1);
          const [outputOwner] = outputOwners;
          assert.equal(outputOwner.layer, detachedOutput ? 'protocol' : 'main');
          const owners = [operation, foreign];
          if (detachedOutput || completion === 'conflicting environment') {
            const line = detachedOutput ? outputLine : 6;
            const matches = session.logicalEvents.filter(e => e.rawRefs.some(r => r.line === line));
            assert.deepEqual(matches.map(e => [e.layer, e.rawRefs.map(r => r.line)]), [['protocol', [line]]]);
            owners.push(matches[0]);
          }
          for (const owner of owners) {
            for (const ref of owner.rawRefs) {
              const raw = session.rawEvents.find(r => r.rawId === ref.rawId);
              const readback = await codex.readIndexedCodexRawRecord(index, session, raw);
              assert.deepEqual(JSON.parse(readback.raw), f.records[ref.line - 1]);
            }
          }
          for (const layer of ['main', 'protocol']) {
            const hits = codex.query.getTimeline(index, session, { layer, q: marker });
            assert.deepEqual(hits.events.filter(e => e.hasSearchHit).map(e => e.id), layer === outputOwner.layer ? [outputOwner.id] : []);
          }
          const detail = await codex.buildHydratedEventDetail(index, session, operation.id, 'main');
          assert.equal(JSON.stringify(detail).includes(marker), false);
          const foreignDetail = await codex.buildHydratedEventDetail(index, session, foreign.id, 'main');
          assert.equal(foreignDetail.meta.status, foreign.status);
          assert.equal(JSON.stringify(foreignDetail).includes(marker), !detachedOutput);
        }
      });
    }
  }
});

test('ambiguous Code Mode results retain physical owners and independent search evidence', async (t) => {
  const foreign = 'mcp__106cd32d0170__notes';
  const request = (tool, namespace) => response({
    name: tool, call_id: 'shared', ...(namespace ? { namespace } : {}),
    ...(tool === 'exec' ? { type: 'custom_tool_call', input: 'await yield_control()' }
      : { type: 'function_call', arguments: '{"cell_id":"g2:14"}' }),
  });
  const result = (tool, marker, fields = {}) => response({
    type: tool === 'exec' ? 'custom_tool_call_output' : 'function_call_output', call_id: 'shared',
    output: `Script completed\nWall time 0.0 seconds\nOutput:\n${marker}`, ...fields,
  });
  const pending = [
    response({ type: 'custom_tool_call', name: 'exec', call_id: 'pending', input: 'await yield_control()' }),
    response({ type: 'custom_tool_call_output', call_id: 'pending', output: 'Script running with cell ID g2:14' }),
  ];
  const first = 'first-wire-receipt';
  const second = 'second-wire-receipt';
  const cases = [
    { name: 'competing custom execs', rows: [request('exec'), request('exec', foreign), result('exec', first), result('exec', second)],
      main: [[3], [4]], detached: [5, 6], state: 'unknown' },
    { name: 'competing function waits', rows: [...pending, request('wait'), request('wait', foreign), result('wait', first), result('wait', second)],
      main: [[3, 4], [5], [6]], detached: [7, 8], state: 'pending' },
    { name: 'competing waits with a legacy MCP lifecycle', rows: [...pending, request('wait'), request('wait', foreign),
      ...['mcp_tool_call_begin', 'mcp_tool_call_end'].map(type => event({ type, call_id: 'shared',
        invocation: { environment_id: 'synthetic-registration-scope', server: 'notes', tool: 'wait', arguments: { cell_id: 'g2:14' } },
        ...(type === 'mcp_tool_call_end' ? { result: { Err: 'synthetic failure' } } : {}) })),
      result('wait', first)], main: [[3, 4], [5], [6]], detached: [7, 8, 9], state: 'pending' },
    { name: 'contradictory exec output scope', rows: [request('exec'), result('exec', first, { namespace: foreign })],
      main: [[3]], detached: [4], state: 'unknown' },
    { name: 'contradictory wait output name', rows: [...pending, request('wait'), result('wait', first, { name: 'other' })],
      main: [[3, 4], [5]], detached: [6], state: 'pending' },
    { name: 'same ID on independent channels', rows: [request('exec'), request('wait', foreign), result('exec', first), result('wait', second)],
      main: [[3, 5], [4, 6]], detached: [], state: 'terminal' },
    { name: 'a disputed custom output leaves independent command evidence with its function call',
      rows: [request('exec'), result('exec', first, { name: 'other' }),
        response({ type: 'function_call', call_id: 'shared', name: 'shell_command', arguments: '{"command":"synthetic"}' }),
        event({ type: 'exec_command_end', call_id: 'shared', command: ['synthetic'], exit_code: 1, status: 'failed' }),
        result('wait', second)], main: [[3], [5, 6, 7]], detached: [4], state: 'unknown', commandStatus: 'failed' },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (t) => {
      const f = await fixture(t, scenario.rows);
      const index = await codex.buildSourceBackedIndex(f.options);
      const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
      const main = session.logicalEvents.filter(e => e.layer === 'main').sort((a, b) => a.rawRefs[0].line - b.rawRefs[0].line);
      assert.equal(session.counts.toolCalls, scenario.main.length);
      assert.deepEqual(main.map(e => e.rawRefs.map(r => r.line)), scenario.main);
      assert.equal(new Set(main.map(e => e.id)).size, main.length);
      const operations = main.filter(e => e.kind === 'code_mode_operation');
      assert.equal(operations.length, 1);
      assert.equal(operations[0].codeModeOperation.observationState, scenario.state);
      if (scenario.commandStatus) assert.equal(main.find(e => e.kind === 'command').status, scenario.commandStatus);
      for (let line = 3; line <= f.records.length; line++) {
        const record = f.records[line - 1];
        const owners = session.logicalEvents.filter(e => e.rawRefs.some(r => r.line === line));
        assert.equal(owners.length, 1);
        const [owner] = owners;
        const isDetached = scenario.detached.includes(line);
        assert.equal(owner.layer, isDetached ? 'protocol' : 'main');
        if (isDetached) assert.deepEqual(owner.rawRefs.map(r => r.line), [line]);
        const ref = owner.rawRefs.find(r => r.line === line);
        const raw = session.rawEvents.find(r => r.rawId === ref.rawId);
        assert.deepEqual(JSON.parse((await codex.readIndexedCodexRawRecord(index, session, raw)).raw), record);
        const marker = [first, second].find(word => record.payload.output?.includes(word));
        if (!marker) continue;
        for (const layer of ['protocol', 'main']) {
          const hits = codex.query.getTimeline(index, session, { layer, q: marker });
          assert.deepEqual(hits.events.filter(e => e.hasSearchHit).map(e => e.id), layer === owner.layer ? [owner.id] : []);
        }
      }
    });
  }
});

test('scoped MCP registration rejects incompatible peer rows and names outside producer limits', async (t) => {
  const make = (id, server, tool, extra) => [
    response({ type: 'function_call', call_id: id, namespace: 'mcp__106cd32d0170__' + server, name: tool, arguments: '{}' }),
    typed({ type: 'McpToolCall', id, server, tool, environmentId: 'synthetic-registration-scope', status: 'failed' }),
    ...(extra ? [event({ ...extra, call_id: id })] : []),
    response({ type: 'function_call_output', call_id: id, output: 'result' }),
  ];
  const cases = [
    make('minus', 'my-notes', 'echo'), make('long', 'notes', 'x'.repeat(103)),
    make('cmd', 'notes', 'echo', { type: 'exec_command_end', exit_code: 0 }),
  ];
  for (const status of [undefined, 'inProgress', 'unrecognized']) {
    const rows = make('status-' + status, 'notes', 'echo');
    rows[1].payload.item.status = status;
    cases.push(rows);
  }
  const f = await fixture(t, cases.flat());
  const index = await codex.buildIndex(f.options);
  const session = index.sessionsById.get(ID);
  let typedLine = 4;
  for (const rows of cases) {
    const owner = session.logicalEvents.find(e => e.rawRefs.some(r => r.line === typedLine));
    assert.equal(owner.layer, 'protocol');
    assert.deepEqual(owner.rawRefs.map(r => r.line), [typedLine]);
    typedLine += rows.length;
  }
});

test('typed tool outcomes preserve semantic status, counts, files and search across Legacy/Paginated/mixed paths', async (t) => {
  for (const scenario of scenarios()) {
    await t.test(scenario.id, async (t) => {
      for (const mode of ['paginated', 'mixed', 'legacy']) {
        const f = await fixture(t, rowsFor(scenario, mode));
        let baseline;
        for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
          const index = await build(f.options);
          const session = build === codex.buildSourceBackedIndex
            ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
          const main = session.logicalEvents.filter((e) => e.layer === 'main');
          assert.equal(main.length, 1, `${mode} main count`);
          const e = main[0];
          assert.equal(e.kind, scenario.kind, `${mode} kind`);
          assert.equal(e.status, scenario.status, `${mode} status`);
          assert.equal(session.counts.toolCalls, 1, `${mode} tool count`);
          assert.equal(session.counts.failedCommands, scenario.kind === 'command' && scenario.status === 'failed' ? 1 : 0);
          assert.equal(session.counts.errors, 0, 'tool failures do not fabricate standalone errors');
          assert.equal(session.counts.issueEvents, ['failed', 'declined', 'incomplete'].includes(scenario.status) ? 1 : 0);
          if (scenario.kind === 'command') {
            assert.equal(e.outputStats.exitCode ?? null, scenario.exitCode, `${mode} exit code`);
            if (!scenario.partial) assert.equal(e.outputStats.durationMs, 1250, `${mode} duration`);
          }
          if (scenario.files) {
            assert.deepEqual(e.touchedFiles, scenario.files);
            assert.equal(session.counts.patches, 1);
            assert.deepEqual(session.analysis.patchedFiles.map((file) => file.file), scenario.files);
          }
          assert.equal(e.rawRefs.length, rowsFor(scenario, mode).length, `${mode} exact provenance`);
          const projection = { kind: e.kind, status: e.status, outputStats: e.outputStats, touchedFiles: e.touchedFiles, counts: session.counts };
          if (baseline) assert.deepEqual(projection, baseline, `${mode} representation parity`);
          else baseline = projection;
          const timeline = codex.query.getTimeline(index, session, { layer: 'main', q: scenario.result, limit: 100 });
          assert.equal(timeline.searchEventCount, 1, `${mode} searchable result`);
          assert.equal(codex.query.getEvent(index, session, e.id, { layer: 'main' }).id, e.id);
          const detail = await codex.buildHydratedEventDetail(index, session, e.id, 'main', { locale: 'en' });
          assert.ok(detail);
          assert.match(JSON.stringify(detail), new RegExp(scenario.result), `${mode} hydrated result`);
          if (scenario.diff) {
            assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: scenario.diff }).searchEventCount, 1, `${mode} searchable change content`);
            assert.ok(JSON.stringify(detail).includes(scenario.diff), `${mode} hydrated change content`);
          }
          for (const ref of e.rawRefs) {
            const raw = session.rawEvents.find((r) => r.rawId === ref.rawId);
            const hydrated = await codex.readRawLine(index, raw.source.file, raw.source.line);
            assert.deepEqual(hydrated.parsed, f.records[raw.source.line - 1], `${mode} original wire preserved`);
          }
        }
      }
    });
  }
});

test('typed-only import preserves counts through reuse and incremental append', async (t) => {
  const [first, second] = scenarios();
  const f = await fixture(t, [typed(first.item)]);
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const cold = await build(f.options);
    const warm = await build({ ...f.options, previousIndex: cold });
    assert.equal(warm.sessionsById.get(ID).counts.toolCalls, 1);
    assert.equal(warm.totals.reusedFileCount, 1);
  }
  const beforeAppend = await codex.buildSourceBackedIndex(f.options);
  await fs.appendFile(f.file, JSON.stringify({ timestamp: '2026-10-02T10:01:00Z', ...typed(second.item) }) + '\n');
  const updated = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: beforeAppend });
  const session = await materializeSessionForIndex(updated, updated.sessionsById.get(ID));
  assert.equal(session.counts.toolCalls, 2);
  assert.equal(session.counts.failedCommands, 1);
  assert.equal(session.logicalEvents.filter((e) => e.kind === 'command').length, 2);
});

test('foreign threads, repeated item IDs and conflicting turn evidence preserve Protocol fallback', async (t) => {
  const scenario = scenarios()[0];
  for (const [label, rows] of [
    ['foreign thread', [typed(scenario.item, { thread_id: 'bbbbbbbb-0160-4160-9160-bbbbbbbbbbbb', turn_id: 'foreign-turn' })]],
    ['repeated item', [typed(scenario.item), typed(scenario.item)]],
    ['different explicit turn', [{ ...scenario.call, payload: { ...scenario.call.payload, turn_id: 'other-turn' } }, typed(scenario.item)]],
    ['same call ID different tool family', [{ ...scenario.call, payload: { ...scenario.call.payload, name: 'mcp__fixture__lookup' } }, typed(scenario.item)]],
    ['task boundary without response turn ID', [scenario.call, event({ type: 'task_complete', turn_id: TURN }),
      event({ type: 'task_started', turn_id: 'next-turn' }), typed(scenario.item, { turn_id: 'next-turn' })]],
    ['ambiguous call identity', [scenario.call, scenario.call, typed(scenario.item)]],
  ]) {
    await t.test(label, async (t) => {
      const f = await fixture(t, rows);
      const index = await codex.buildSourceBackedIndex(f.options);
      const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
      const typedIds = new Set(session.rawEvents.filter((r) => r.payloadType === 'item_completed').map((r) => r.rawId));
      assert.ok(typedIds.size);
      for (const rawId of typedIds) {
        const owners = session.logicalEvents.filter((e) => e.rawRefs.some((ref) => ref.rawId === rawId));
        assert.equal(owners.length, 1);
        assert.equal(owners[0].layer, 'protocol');
        assert.equal(owners[0].rawRefs.length, 1);
        if (label === 'foreign thread') {
          assert.equal(owners[0].turnId, '', 'foreign evidence does not create an owned turn');
          assert.equal(session.counts.turns, 1);
        }
      }
    });
  }
});

test('typed nested command retains one Code Mode phase owner with physical item_completed provenance', async (t) => {
  const scenario = scenarios()[0];
  const f = await fixture(t, [
    response({ type: 'custom_tool_call', call_id: 'outer-exec', name: 'exec', input: 'text(await tools.exec_command({cmd:"synthetic"}));' }),
    typed(scenario.item),
    response({ type: 'custom_tool_call_output', call_id: 'outer-exec', output: 'Script completed\nouter result' }),
  ]);
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
    const operation = session.logicalEvents.find((e) => e.kind === 'code_mode_operation');
    const command = session.logicalEvents.find((e) => e.kind === 'command');
    assert.ok(operation);
    assert.ok(command);
    assert.ok(operation.codeModeOperation.eventRefs.includes(command.id));
    assert.equal(command.rawRefs.length, 1);
    assert.equal(command.rawRefs[0].sourceEventType, 'item_completed');
    assert.equal(session.counts.toolCalls, 2, 'one outer operation plus one actually observed nested command');
  }
});

test('completed typed dynamic tools need affirmative success evidence across representations and mirrors', async (t) => {
  for (const [name, fields, expected] of [
    ['missing', {}, 'completed'], ['null', { success: null }, 'completed'],
    ['true', { success: true }, 'success'], ['false', { success: false }, 'failed'],
    ['error', { success: true, error: 'synthetic-error' }, 'failed'],
    ['failed-status', { success: true, status: 'failed' }, 'failed'],
    ['nonboolean', { success: 'true' }, 'completed'],
  ]) await t.test(name, async (t) => {
    const id = `dynamic-evidence-${name}`;
    const marker = `${id}-result`;
    const item = { type: 'DynamicToolCall', id, namespace: 'fixture', tool: 'lookup',
      arguments: {}, status: 'completed', content_items: [{ type: 'inputText', text: marker }], ...fields };
    for (const mixed of [false, true]) {
      const rows = mixed ? [response({ type: 'function_call', call_id: id, name: 'fixture.lookup', arguments: '{}' }),
        typed(item), response({ type: 'function_call_output', call_id: id, output: marker })] : [typed(item)];
      const f = await fixture(t, rows);
      for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
        const index = await build(f.options);
        const session = build === codex.buildSourceBackedIndex
          ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
        const main = session.logicalEvents.filter((e) => e.layer === 'main');
        assert.equal(main.length, 1);
        const e = main[0];
        assert.equal(e.status, expected, 'completion does not prove successful execution');
        assert.equal(e.severity, expected === 'failed' ? 'error' : 'normal');
        assert.equal(session.counts.toolCalls, 1);
        assert.equal(session.counts.issueEvents, expected === 'failed' ? 1 : 0);
        assert.equal(e.rawRefs.length, rows.length);
        const detail = await codex.buildHydratedEventDetail(index, session, e.id, 'main');
        assert.equal(detail.meta.status, expected);
        assert.ok(JSON.stringify(detail).includes(marker));
        const found = codex.query.getTimeline(index, session, { layer: 'main', q: marker, status: expected });
        assert.equal(found.searchEventCount, 1);
        assert.ok(found.events.some((candidate) => candidate.id === e.id));
        for (const ref of e.rawRefs) assert.deepEqual((await codex.readRawLine(index, ref.file, ref.line)).parsed, f.records[ref.line - 1]);
      }
    }
  });
});

test('unknown dynamic outcome stays completed after incremental append and warm reuse', async (t) => {
  const id = 'dynamic-appended';
  const f = await fixture(t, [response({ type: 'function_call', call_id: id, name: 'fixture.lookup', arguments: '{}' })]);
  const initial = await codex.buildSourceBackedIndex(f.options);
  await fs.appendFile(f.file, JSON.stringify(typed({ type: 'DynamicToolCall', id, namespace: 'fixture', tool: 'lookup',
    arguments: {}, status: 'completed', success: null, content_items: [{ type: 'inputText', text: 'appended-marker' }] })) + '\n');
  const appended = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: initial });
  const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: appended });
  for (const index of [appended, warm]) {
    const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
    const e = session.logicalEvents.find((e) => e.layer === 'main');
    assert.equal(e.status, 'completed');
    assert.equal(session.counts.toolCalls, 1);
    assert.equal(session.counts.issueEvents, 0);
  }
});

test('attempted-call metadata and unknown typed items do not fabricate executed tool events', async (t) => {
  const attempted = { executed_tool_calls: [{ name: 'fictional_execution', arguments: { cmd: 'never run' },
    tool_result_metadata: { success: true } }], cell_id: 'metadata-only', tool_calls_complete: true };
  const f = await fixture(t, [
    response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'visible answer' }],
      internal_chat_message_metadata_passthrough: attempted }),
    typed({ type: 'FutureToolItem', id: 'fictional-id', call_id: 'fictional-call', tool: 'fictional_execution',
      status: 'completed', internal_chat_message_metadata_passthrough: attempted }),
  ]);
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
    assert.equal(session.counts.toolCalls, 0);
    assert.equal(session.counts.assistantMessages, 1);
    assert.ok(session.logicalEvents.every((e) => e.layer === 'protocol' || e.kind === 'assistant_message'));
    const raw = session.rawEvents.find((r) => r.payloadType === 'item_completed');
    const preserved = await codex.readRawLine(index, raw.source.file, raw.source.line);
    assert.deepEqual(preserved.parsed.payload.item.internal_chat_message_metadata_passthrough, attempted);
  }
});
