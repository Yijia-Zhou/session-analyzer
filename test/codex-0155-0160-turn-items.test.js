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
    ...(initialTurn ? [initialTurn] : []), ...(typeof rows === 'function' ? rows(repoRoot) : rows)].map((row, i) => ({
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

test('Raw request sections use the recorded namespace for native command, patch and JavaScript formatting', async (t) => {
  const cases = [];
  const rows = [];
  for (const namespace of ['mcp__notes', undefined, null, '', 'functions']) {
    for (const [tool, fields, titles] of [
      ['shell_command', { type: 'function_call', arguments: '{"command":"echo synthetic","workdir":"/synthetic"}' },
        ['Command', 'Run context', 'Command arguments']],
      ['apply_patch', { type: 'custom_tool_call', input: '*** Begin Patch\n*** Add File: fixture.txt\n+synthetic\n*** End Patch' }, ['Patch']],
      ['js_repl', { type: 'custom_tool_call', input: 'console.log("synthetic")' }, ['JavaScript']],
    ]) {
      const call_id = 'raw-format-' + cases.length;
      if (namespace === 'mcp__notes' && tool === 'shell_command') {
        rows.push(response({ type: 'custom_tool_call', call_id, namespace: 'mcp__106cd32d0170__notes', name: 'custom', input: 'synthetic' }));
      }
      rows.push(response({ ...fields, call_id, name: tool, ...(namespace === undefined ? {} : { namespace }) }));
      cases.push({ tool, namespace, titles, line: rows.length + 2 });
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
    const session = index === cold || index === warm ? await materializeSessionForIndex(index, indexed) : indexed;
    const sectionTitles = [];
    for (const { tool, namespace, titles, line } of cases) {
      const raw = session.rawEvents.find(r => r.source.line === line);
      if (namespace === 'mcp__notes' && tool === 'shell_command') {
        const owner = session.logicalEvents.find(e => e.rawRefs.some(ref => ref.rawId === raw.rawId));
        assert.deepEqual([owner.layer, owner.kind, owner.toolName], ['main', 'mcp_call', 'mcp__notes__shell_command']);
      }
      const detail = await codex.buildHydratedEventDetail(index, session, raw.rawId, 'raw', { locale: 'en' });
      const sections = [...detail.timelineSections, ...detail.inspectorSections];
      sectionTitles.push(sections.map(s => s.title).filter(title => titles.includes(title) || title === 'Payload'));
      assert.deepEqual(sections.find(s => s.type === 'raw_json').value, f.records[line - 1]);
    }
    assert.deepEqual(sectionTitles, cases.map(({ namespace, titles }) => namespace === 'mcp__notes' ? ['Payload'] : titles));
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
    changes: { 'synthetic.txt': { type: 'add', content: 'example\n' } }, stdout: 'synthetic patch applied', stderr: '' });
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
  const historicalMcp = (name = 'mcp__notes__echo', namespace, args = '{}') => response({ type: 'function_call', call_id,
    name, ...(namespace == null ? {} : { namespace }), arguments: args });
  const historicalItem = { type: 'McpToolCall', id: call_id, server: 'notes', tool: 'echo', arguments: {},
    status: 'failed', error: { message: 'historical_typed_marker' } };
  const historicalEnd = (failed, fields = {}) => event({ type: 'mcp_tool_call_end', call_id,
    invocation: { server: 'notes', tool: 'echo', arguments: {} }, ...fields,
    result: failed ? { Err: 'historical_legacy_marker' } : { Ok: { content: [{ type: 'text', text: 'historical_legacy_marker' }] } } });
  const foreignTypedEnd = typedEnd(false, 'foreign-environment', 'second_terminal_marker');
  const independentDynamic = response({ type: 'function_call', call_id, namespace: 'fixture', name: 'lookup', arguments: '{}' });
  const shell = response({ type: 'function_call', call_id, namespace: 'functions', name: 'shell_command',
    arguments: '{"command":"echo fail"}' });
  const commandItem = { type: 'CommandExecution', id: call_id, command: ['echo', 'fail'], cwd: 'C:/repo',
    source: 'agent', status: 'failed', parsed_cmd: [], exit_code: 72, aggregated_output: 'typed_command_marker' };
  const wait = response({ type: 'function_call', call_id, namespace: 'multi_agent_v1', name: 'wait_agent',
    arguments: JSON.stringify({ targets: [child] }) });
  const waitItem = { type: 'CollabAgentToolCall', id: call_id, tool: 'wait', status: 'failed', sender_thread_id: ID,
    receiver_thread_ids: [child], receiver_agents: [{ thread_id: child }], agents_states: { [child]: { errored: 'typed_wait_marker' } } };
  const emptyWaitItem = { type: 'CollabAgentToolCall', id: call_id, tool: 'wait', status: 'completed', sender_thread_id: ID,
    receiver_thread_ids: [], receiver_agents: [] };
  const timeoutItem = { ...emptyWaitItem, agents_states: {} };
  const pathWait = response({ type: 'function_call', call_id, name: 'wait_agent', arguments: '{"targets":["/root/reviewer"]}' });
  const waitBegin = (id, fields = {}) => event({ type: 'collab_waiting_begin', call_id, sender_thread_id: ID, receiver_thread_ids: [id], ...fields });
  const waitEnd = id => event({ type: 'collab_waiting_end', call_id, sender_thread_id: ID, statuses: { [id]: { errored: 'path_end_marker' } } });
  const patchItem = { type: 'FileChange', id: call_id, status: 'failed', changes: { 'synthetic.txt': { type: 'add', content: 'example\n' } },
    stdout: '', stderr: 'typed_patch_marker' };
  const dynamicRequest = event({ type: 'dynamic_tool_call_request', callId: call_id, turnId: TURN, startedAtMs: 73590123,
    namespace, tool, arguments: {} });
  const dynamicResponse = event({ type: 'dynamic_tool_call_response', call_id, turn_id: TURN, completed_at_ms: 2,
    namespace, tool, arguments: {}, content_items: [], success: false, error: 'transport_response_marker', duration });
  const stamped = (row, turn_id) => response({ ...row.payload, internal_chat_message_metadata_passthrough: { turn_id } });
  const oldReceipt = stamped(response({ ...receipt.payload, output: 'old_receipt_marker' }), 'previous-turn');
  const cases = [
    ...[[scoped, receipt], [scopedCustom, customReceipt]].map(([call, output]) => ({
      name: `${call.payload.type} cannot own a response stamped for a previous turn`,
      rows: [stamped(call, TURN), stamped(output, 'previous-turn')],
      main: [['other_tool_call', 'incomplete', [3]]], detached: [4], markers: [[4, output.payload.output]] })),
    ...[
      ['foreign legacy success', { b: 2, a: [1, 3] }, { a: [3, 1], b: 2 }, 'failed', [4], [5]],
      ['foreign typed failure', { b: 2, a: [1, 3, 4] }, { a: [1, 3], b: 2 }, 'success', [5], [4]],
      ['conflicting outcomes with equal arguments', { b: 2, a: [1, 3] }, { a: [1, 3], b: 2 }, 'completed', [], [4, 5]],
    ].map(([label, typedArgs, legacyArgs, status, owned, detached]) => {
      const item = typedEnd(true).payload.item;
      const end = legacyEnd(false).payload;
      return { name: 'scoped MCP invocation arguments with ' + label,
        rows: [response({ ...scoped.payload, arguments: '{"a":[1,3],"b":2}' }),
          typed({ ...item, arguments: typedArgs }), event({ ...end, invocation: { ...end.invocation, arguments: legacyArgs } }), receipt],
        main: [[owned.length ? 'mcp_call' : 'other_tool_call', status, [3, ...owned, 6]]],
        detached, markers: [[4, 'typed_terminal_marker'], [5, 'legacy_terminal_marker']] };
    }),
    ...[false, true].flatMap(historical => [false, true].map(foreignTyped => {
      const first = historical ? '-9007199254740992' : '9007199254740992';
      const other = historical ? '-9007199254740993' : '9007199254740993';
      const args = value => ({ x: [{ rid: JSON.rawJSON(value) }] });
      const request = historical ? historicalMcp() : scoped;
      const start = historical ? [scopedCustom] : [];
      const line = start.length + 3;
      const item = historical ? historicalItem : typedEnd(true).payload.item;
      const end = (historical ? historicalEnd(false) : legacyEnd(false)).payload;
      return { name: 'exact MCP integers for ' + (historical ? 'historical' : 'scoped') + ' with foreign ' + (foreignTyped ? 'typed' : 'legacy'),
        rows: [...start, response({ ...request.payload, arguments: JSON.stringify(args(first)) }),
          typed({ ...item, arguments: args(foreignTyped ? other : first) }),
          event({ ...end, invocation: { ...end.invocation, arguments: args(foreignTyped ? first : other) } }), receipt],
        main: [...(historical ? [['other_tool_call', 'incomplete', [3]]] : []),
          ['mcp_call', foreignTyped ? 'success' : 'failed', [line, line + (foreignTyped ? 2 : 1), line + 3]]],
        detached: [line + (foreignTyped ? 1 : 2)], markers: [[line + 1, historical ? 'historical_typed_marker' : 'typed_terminal_marker'],
          [line + 2, historical ? 'historical_legacy_marker' : 'legacy_terminal_marker']] };
    })),
    ...[
      ['largest safe integer', '9007199254740991', '9007199254740991', true, true],
      ['largest writer integer', '18446744073709551615', '18446744073709551615', true, true],
      ['unverified integer that could dispute the failure', '18446744073709551615', '18446744073709551616', false, false],
      ['unverified integer with an explicitly foreign key', '18446744073709551615', '18446744073709551616', true, false],
    ].map(([label, requested, competing, keepTyped, keepLegacy]) => {
      const args = (n, marker) => ({ id: JSON.rawJSON(n), key: marker });
      const end = legacyEnd(keepLegacy).payload;
      const key = label.endsWith('foreign key') ? 'other' : 'local';
      return { name: 'scoped MCP precision with ' + label,
        rows: [response({ ...scoped.payload, arguments: JSON.stringify(args(requested, 'local')) }),
          typed({ ...typedEnd(true).payload.item, arguments: args(requested, 'local') }),
          event({ ...end, invocation: { ...end.invocation, arguments: args(competing, key) } }), receipt],
        main: [[keepTyped ? 'mcp_call' : 'other_tool_call', keepTyped ? 'failed' : 'completed', [3, ...(keepTyped ? [4] : []), ...(keepLegacy ? [5] : []), 6]]],
        detached: [...(keepTyped ? [] : [4]), ...(keepLegacy ? [] : [5])], markers: [[4, 'typed_terminal_marker'], [5, 'legacy_terminal_marker']] };
    }),
    ...[
      ['safe integer', Number.MAX_SAFE_INTEGER, true, true, true],
      ['unverified wide integer and agreeing outcome', JSON.rawJSON('9007199254740993'), true, true, false],
      ['unverified wide integer and conflicting outcome', JSON.rawJSON('9007199254740993'), false, false, false],
    ].map(([label, id, legacyFailed, keepTyped, keepLegacy]) => {
      const end = legacyEnd(legacyFailed).payload;
      return { name: 'large physical MCP terminal with ' + label,
        rows: [response({ ...scoped.payload, arguments: JSON.stringify({ id }) }), typed({ ...typedEnd(true).payload.item, arguments: { id } }),
          event({ ...end, invocation: { ...end.invocation, arguments: { id } }, padding: 'x'.repeat(64 * 1024) }), receipt],
        main: [[keepTyped ? 'mcp_call' : 'other_tool_call', keepTyped ? 'failed' : 'completed', [3, ...(keepTyped ? [4] : []), ...(keepLegacy ? [5] : []), 6]]],
        detached: [...(keepTyped ? [] : [4]), ...(keepLegacy ? [] : [5])], markers: [[4, 'typed_terminal_marker'], [5, 'legacy_terminal_marker']] };
    }),
    ...[
      ['ordinary prefix in a value', { query: 'data:image/' }, false],
      ['unsupported MIME and incomplete header in a key', { 'data:image/png;base64': 'data:image/svg+xml;base64,AAAA' }, false],
      ['ordinary prefix in a long request', { query: 'data:image/png' }, true],
    ].map(([label, args, longRequest]) => ({
      name: 'ordinary MCP arguments with ' + label + ' keep the exact typed failure',
      rows: [response({ ...scoped.payload, arguments: (longRequest ? ' '.repeat(64 * 1024) : '') + JSON.stringify(args) }),
        typed({ ...typedEnd(true).payload.item, arguments: args,
          error: { message: 'typed_terminal_marker' + (longRequest ? '' : 'x'.repeat(64 * 1024)) } }), receipt],
      main: [['mcp_call', 'failed', [3, 4, 5]]], detached: [], markers: [[4, 'typed_terminal_marker'], [5, 'current_function_marker']] })),
    ...[false, true].flatMap(isLegacy => [
      ['same image', 'data:image/png;base64,AAAA', 'data:image/png;base64,AAAA', true],
      ['different images', 'data:image/png;base64,AAAA', 'data:image/png;base64,BBBB', false],
      ['literal placeholder', '[embedded image payload externalized; open raw refs for source]', 'data:image/png;base64,BBBB', false],
      ['reversed literal placeholder', 'data:image/png;base64,AAAA', '[embedded image payload externalized; open raw refs for source]', false],
      ['same literal', '[embedded image payload externalized; open raw refs for source]', '[embedded image payload externalized; open raw refs for source]', true],
      ['escaped slash', 'data:image/png;base64,AAAA', 'data:image/png;base64,AAAA', true],
      ['same large integer', 'data:image/png;base64,AAAA', 'data:image/png;base64,AAAA', true],
      ['different adjacent integers', 'data:image/png;base64,AAAA', 'data:image/png;base64,AAAA', false],
    ].map(([label, first, second, matches]) => {
      const id = label.includes('integer') ? '9007199254740993' : '1';
      let text = JSON.stringify({ i: [first], n: JSON.rawJSON(id) });
      if (label === 'escaped slash') text = text.replace('image/', 'image\\/');
      const args = { n: JSON.rawJSON(label === 'different adjacent integers' ? '9007199254740992' : id), i: [second] };
      const end = legacyEnd(true).payload;
      const terminal = isLegacy ? event({ ...end, invocation: { ...end.invocation, arguments: args } }) : typed({ ...typedEnd(true).payload.item, arguments: args });
      return { name: 'scoped MCP original attachment arguments ' + label + ' ' + (isLegacy ? 'legacy' : 'typed'),
        rows: [response({ ...scoped.payload, arguments: text }), terminal, receipt],
        main: [[matches ? 'mcp_call' : 'other_tool_call', matches ? 'failed' : 'completed', matches ? [3, 4, 5] : [3, 5]]],
        detached: matches ? [] : [4], markers: [[4, isLegacy ? 'legacy_terminal_marker' : 'typed_terminal_marker']] };
    })),
    ...[true, false].map(foreignTyped => {
      const image = 'data:image/png;base64,AAAA', other = 'data:image/png;base64,BBBB';
      const args = value => ({ x: 'prefix ' + value });
      return { name: 'historical MCP keeps verified original attachment beside foreign ' + (foreignTyped ? 'typed' : 'legacy') + ' outcome',
        rows: [scopedCustom, historicalMcp('echo', 'mcp__notes', JSON.stringify(args(image))),
          typed({ ...historicalItem, arguments: args(foreignTyped ? other : image) }),
          historicalEnd(false, { invocation: { server: 'notes', tool: 'echo', arguments: args(foreignTyped ? image : other) } }), receipt, customReceipt],
        main: [['other_tool_call', 'completed', [3, 8]], ['mcp_call', foreignTyped ? 'success' : 'failed', [4, foreignTyped ? 6 : 5, 7]]],
        detached: [foreignTyped ? 5 : 6], markers: [[5, 'historical_typed_marker'], [6, 'historical_legacy_marker']] };
    }),
    { name: 'an oversized image-bearing MCP request remains unverified',
      rows: [response({ ...scoped.payload, arguments: JSON.stringify({ i: 'data:image/png;base64,' + 'A'.repeat(64 * 1024) }) }),
        typed({ ...typedEnd(true).payload.item, arguments: { i: 'data:image/png;base64,AAAA' } }), receipt],
      main: [['other_tool_call', 'completed', [3, 5]]], detached: [4], markers: [[4, 'typed_terminal_marker']] },
    { name: 'a typed terminal omitting arguments cannot verify a request containing a nonfinite JSON number',
      rows: [response({ ...scoped.payload, arguments: '{"n":1e9999}' }), typed({ ...typedEnd(true).payload.item, arguments: undefined }), receipt],
      main: [['other_tool_call', 'completed', [3, 5]]], detached: [4], markers: [[4, 'typed_terminal_marker']] },
    ...[['invalid JSON', '{', false], ['writer whitespace', ' \t\n', true], ['nonfinite number', '{"n":1e9999}', false]].map(([label, text, matches]) => {
      const end = legacyEnd(true).payload;
      return { name: 'scoped MCP invocation parses ' + label,
        rows: [response({ ...scoped.payload, arguments: text }), typed({ ...typedEnd(true).payload.item, arguments: null }),
          event({ ...end, invocation: { server: 'notes', tool, environment_id: environment } })],
        main: [[matches ? 'mcp_call' : 'other_tool_call', matches ? 'failed' : 'incomplete', matches ? [3, 4, 5] : [3]]],
        detached: matches ? [] : [4, 5], markers: [[4, 'typed_terminal_marker'], [5, 'legacy_terminal_marker']] };
    }),
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
    ...[
      ['typed failure', typed({ ...typedDynamicFailure.payload.item, arguments: { q: 'B' } }), 'dynamic_failure_marker'],
      ['legacy end', dynamicEnd({ ...qualifiedDynamic, arguments: { q: 'B' } }, dynamicSuccess), 'dynamic_end_marker'],
      ['legacy begin request', event({ type: 'dynamic_tool_call_begin', call_id, ...qualifiedDynamic, request: { q: 'B' } }), ''],
      ['transport request', event({ ...dynamicRequest.payload, arguments: { q: 'B' } }), '73590123'],
      ['transport response', event({ ...dynamicResponse.payload, arguments: { q: 'B' } }), 'transport_response_marker'],
    ].flatMap(([label, foreign, marker]) => [false, true].map(withMcp => ({
      name: 'foreign dynamic arguments in ' + label + (withMcp ? ' beside an exact MCP failure' : ' beside a receipt'),
      rows: [response({ ...scoped.payload, arguments: '{"q":"A"}' }), foreign,
        ...(withMcp ? [typed({ ...typedEnd(true).payload.item, arguments: { q: 'A' } })] : []), receipt],
      main: [withMcp ? ['mcp_call', 'failed', [3, 5, 6]] : ['other_tool_call', 'completed', [3, 5]]],
      detached: [4], markers: [...(marker ? [[4, marker]] : []), ...(withMcp ? [[5, 'typed_terminal_marker']] : [])],
    }))),
    ...[
      ['object key order', '{"b":2,"a":[1,3]}', { a: [1, 3], b: 2 }, true],
      ['native JSON string', '"{}"', '{}', true],
      ['string and object', '"{}"', {}, false],
      ['absent historical field', '{}', undefined, true],
      ['JSON null', 'null', null, true],
      ['blank wire arguments', ' \t', null, false],
      ['invalid JSON', '{', undefined, false],
      ['adjacent wide integers', '{"n":9007199254740992}', { n: JSON.rawJSON('9007199254740993') }, false],
      ['equal wide integers', '{"n":9007199254740993}', { n: JSON.rawJSON('9007199254740993') }, true],
      ['two original images', '{"i":"data:image/png;base64,AAAA"}', { i: 'data:image/png;base64,BBBB' }, false],
      ['an original image', '{"i":"data:image/png;base64,AAAA"}', { i: 'data:image/png;base64,AAAA' }, true],
    ].map(([label, text, args, matches]) => ({ name: 'dynamic argument evidence for ' + label,
      rows: [response({ ...scoped.payload, arguments: text }), typed({ ...typedDynamicFailure.payload.item, arguments: args }), receipt],
      main: [['other_tool_call', matches ? 'failed' : 'completed', matches ? [3, 4, 5] : [3, 5]]],
      detached: matches ? [] : [4], markers: [[4, 'dynamic_failure_marker']],
    })),
    ...[
      ['a typed dynamic completion', false, false],
      ['a transport response', true, false],
      ['a transport response with a foreign key', true, true],
    ].map(([label, transport, foreign]) => {
      const args = { n: JSON.rawJSON('9007199254740993'), key: 'local' };
      const recorded = { ...args, key: foreign ? 'other' : 'local' };
      // Padding the physical carrier prevents the optional exact-number reparse.
      const terminal = transport ? event({ ...dynamicResponse.payload, arguments: recorded, padding: 'x'.repeat(64 * 1024) })
        : typed({ ...typedDynamicFailure.payload.item, arguments: recorded, error: 'dynamic_failure_marker' + 'x'.repeat(64 * 1024) });
      return { name: 'unverified dynamic integer in ' + label,
        rows: [response({ ...scoped.payload, arguments: JSON.stringify(args) }), terminal, typed({ ...typedEnd(true).payload.item, arguments: args }), receipt],
        main: [foreign ? ['mcp_call', 'failed', [3, 5, 6]] : ['other_tool_call', 'completed', [3, 6]]],
        detached: foreign ? [4] : [4, 5], markers: [[4, transport ? 'transport_response_marker' : 'dynamic_failure_marker'], [5, 'typed_terminal_marker']] };
    }),
    ...[
      ['same outcome', { success: false }, true],
      ['neutral completion', { status: 'completed' }, true],
      ['conflicting outcome', { success: true }, false],
    ].map(([label, outcome, keepTyped]) => {
      const args = { n: JSON.rawJSON('9007199254740993') };
      return { name: 'unverified legacy dynamic arguments with ' + label,
        rows: [response({ ...scoped.payload, arguments: JSON.stringify(args) }), typed({ ...typedDynamicFailure.payload.item, arguments: args }),
          dynamicEnd({ ...qualifiedDynamic, arguments: args }, { ...outcome, result: 'dynamic_end_marker' + 'x'.repeat(64 * 1024) }), receipt],
        main: [['other_tool_call', keepTyped ? 'failed' : 'completed', keepTyped ? [3, 4, 6] : [3, 6]]],
        detached: keepTyped ? [5] : [4, 5], markers: [[4, 'dynamic_failure_marker'], [5, 'dynamic_end_marker']] };
    }),
    ...[
      ['exact request', { command: 'echo fail' }, false],
      ['foreign request', { command: 'echo another' }, true],
    ].map(([label, args, keepCommand]) => ({ name: 'native command failure with a dynamic transport ' + label,
      rows: [scopedCustom, shell, typed(commandItem), event({ ...dynamicResponse.payload, namespace: 'functions', arguments: args }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', keepCommand ? 'failed' : 'completed', keepCommand ? [4, 5, 7] : [4, 7]]],
      detached: keepCommand ? [6] : [5, 6], markers: [[5, 'typed_command_marker'], [6, 'transport_response_marker']],
    })),
    { name: 'an independent dynamic call keeps its exact image arguments beside a foreign typed completion',
      rows: [scopedCustom, response({ ...independentDynamic.payload, arguments: '{"i":"data:image/png;base64,AAAA"}' }),
        typed({ ...typedDynamicSuccess.payload.item, namespace: 'fixture', tool: 'lookup', arguments: { i: 'data:image/png;base64,BBBB' } }),
        typed({ ...typedDynamicFailure.payload.item, namespace: 'fixture', tool: 'lookup', arguments: { i: 'data:image/png;base64,AAAA' } }),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['other_tool_call', 'failed', [4, 6, 7]]], detached: [5],
      markers: [[5, 'dynamic_success_marker'], [6, 'dynamic_failure_marker'], [7, 'current_function_marker']] },
    { name: 'dynamic transport mirrors leave the verified typed failure on its request',
      rows: [scoped, dynamicRequest, typedDynamicFailure, dynamicResponse, receipt],
      main: [['other_tool_call', 'failed', [3, 5, 7]]], detached: [4, 6],
      markers: [[4, '73590123'], [5, 'dynamic_failure_marker'], [6, 'transport_response_marker']] },
    { name: 'dynamic transport alone leaves the request outcome unverified',
      rows: [scoped, dynamicRequest, dynamicResponse, receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, '73590123'], [5, 'transport_response_marker']] },
    { name: 'same-turn dynamic transport cannot attest an MCP terminal',
      rows: [scoped, dynamicRequest, typedEnd(true), receipt],
      main: [['other_tool_call', 'completed', [3, 6]]], detached: [4, 5],
      markers: [[4, '73590123'], [5, 'typed_terminal_marker']] },
    { name: 'a dynamic transport request naming another turn cannot dispute the local MCP failure',
      rows: [scoped, event({ ...dynamicRequest.payload, turnId: 'other-turn' }), typedEnd(true), receipt],
      main: [['mcp_call', 'failed', [3, 5, 6]]], detached: [4],
      markers: [[4, '73590123'], [5, 'typed_terminal_marker']] },
    ...[true, false].map(withBoundary => {
      const first = withBoundary ? 3 : 2;
      return { name: 'a foreign transport response leaves the local failure and receipt in their turn, opening boundary=' + withBoundary,
        initialTurn: withBoundary ? event({ type: 'task_started', turn_id: TURN }) : null,
        rows: [scoped, event({ ...dynamicResponse.payload, turn_id: 'other-turn' }), typedEnd(true), receipt],
        main: [['mcp_call', 'failed', [first, first + 2, first + 3]]], detached: [first + 1],
        markers: [[first + 1, 'transport_response_marker'], [first + 2, 'typed_terminal_marker'], [first + 3, 'current_function_marker']] };
    }),
    { name: 'a foreign transport response cannot suppress a later real boundary',
      rows: [scoped, event({ ...dynamicResponse.payload, turn_id: 'other-turn' }),
        event({ type: 'task_started', turn_id: TURN }), typedEnd(true), receipt],
      main: [['other_tool_call', 'incomplete', [3]]], detached: [4, 6, 7],
      markers: [[4, 'transport_response_marker'], [6, 'typed_terminal_marker']] },
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
          status: 'completed', arguments: {}, result: { content: [{ type: 'text', text: 'partial_marker' }] } }), receipt],
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
      rows: [response({ ...scoped.payload, arguments: '{"query":"begin_marker"}' }),
        event({ type: 'dynamic_tool_call_begin', call_id, ...qualifiedDynamic, arguments: { query: 'begin_marker' } })],
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
    ...[
      ['the direct command', {}, true], ['the native shell wrapper', { command: ['/bin/sh', '-c', 'echo fail'] }, true],
      ['a different command', { command: ['echo', 'other'] }, false], ['a user shell command', { source: 'user_shell' }, false],
      ['a unified exec command', { source: 'unified_exec_startup' }, false],
    ].map(([label, fields, matches]) => ({ name: `native typed shell with ${label}`,
      rows: [scopedCustom, shell, typed({ ...commandItem, ...fields }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', matches ? 'failed' : 'completed', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_command_marker']], commandExit: matches ? 72 : undefined })),
    ...[
      ['matching participants', {}, true], ['a foreign sender', { sender_thread_id: child }, false],
      ['a foreign receiver', { receiver_thread_ids: [ID] }, false],
      ['a foreign receiver agent', { receiver_agents: [{ thread_id: ID }] }, false],
      ['a foreign agent state', { agents_states: { [ID]: { errored: 'typed_wait_marker' } } }, false],
      ['a wrong action', { tool: 'close_agent' }, false],
      ['failure contradicting a completed child', { agents_states: { [child]: { completed: 'typed_wait_marker' } } }, false],
      ['completion contradicting an errored child', { status: 'completed' }, false],
    ].map(([label, fields, matches]) => ({ name: `native typed V1 wait with ${label}`,
      rows: [scopedCustom, wait, typed({ ...waitItem, ...fields }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['agent_coordination', matches ? 'failed' : 'success', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_wait_marker']] })),
    ...[
      ['the requested file', patchItem.changes, true],
      ['a different path', { 'other.txt': { type: 'add', content: 'example\n' } }, false],
      ['a different edit', { 'synthetic.txt': { type: 'delete', content: 'example\n' } }, false],
      ['different contents', { 'synthetic.txt': { type: 'add', content: 'other\n' } }, false],
    ].map(([label, changes, matches]) => ({ name: `native typed patch with ${label}`,
      rows: [scoped, patch, typed({ ...patchItem, changes }), patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', matches ? 'failed' : 'success', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_patch_marker']] })),
    { name: 'native typed patch and the other function\'s scoped MCP failure each keep their own terminal',
      rows: [scoped, patch, typed(patchItem), typedEnd(true), patchReceipt, receipt],
      main: [['mcp_call', 'failed', [3, 6, 8]], ['patch', 'failed', [4, 5, 7]]], detached: [],
      markers: [[5, 'typed_patch_marker'], [6, 'typed_terminal_marker']] },
    ...['stdout', 'stderr'].map(key => ({ name: 'conflicting copied patch stream ' + key,
      rows: [scoped, patch, typed({ ...patchItem, [key]: 'typed_stream_marker' }),
        event({ type: 'patch_apply_end', call_id, changes: patchItem.changes, success: false, status: 'failed',
          [key]: 'legacy_stream_marker' }), receipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', 'incomplete', [4]]], detached: [5, 6],
      markers: [[5, 'typed_stream_marker'], [6, 'legacy_stream_marker']] })),
    { name: 'native typed shell and opposing legacy terminal stay in Protocol',
      rows: [scopedCustom, shell, typed(commandItem), event({ source: commandItem.source, command: commandItem.command, type: 'exec_command_end',
        call_id, status: 'completed', exit_code: 0, aggregated_output: 'legacy_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'completed', [4, 7]]], detached: [5, 6],
      markers: [[5, 'typed_command_marker'], [6, 'legacy_command_marker']] },
    { name: 'native typed shell and duplicate typed terminals stay in Protocol',
      rows: [scopedCustom, shell, typed(commandItem), typed({ ...commandItem, aggregated_output: 'second_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'completed', [4, 7]]], detached: [5, 6],
      markers: [[5, 'typed_command_marker'], [6, 'second_command_marker']] },
    ...[
      ['a user shell', { source: 'user_shell' }, true], ['a distinct directory', { cwd: 'C:/other' }, true],
      ['a distinct command', { command: ['echo', 'another'] }, true], ['an unknown source', { source: 'unknown' }, false],
    ].map(([label, fields, foreign]) => ({ name: 'native typed shell beside ' + label,
      rows: [scopedCustom, response({ ...shell.payload, arguments: '{"command":"echo fail","workdir":"C:/repo"}' }),
        typed(commandItem), typed({ ...commandItem, ...fields, status: 'completed',
        exit_code: 0, aggregated_output: 'second_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', foreign ? 'failed' : 'completed', foreign ? [4, 5, 7] : [4, 7]]],
      detached: foreign ? [6] : [5, 6], markers: [[5, 'typed_command_marker'], [6, 'second_command_marker']] })),
    ...[false, true].flatMap(reversed => [false, true].map(withLegacy => {
      const success = typed({ ...commandItem, cwd: '/unrelated', status: 'completed', exit_code: 0, aggregated_output: 'second_command_marker' });
      const candidates = [typed(commandItem), success];
      if (reversed) candidates.reverse();
      const legacy = withLegacy ? [event({ type: 'exec_command_end', call_id, cwd: commandItem.cwd, source: 'agent', command: commandItem.command,
        status: 'failed', exit_code: 72, aggregated_output: 'legacy_command_marker' })] : [];
      return { name: 'unspecified workdir with two typed candidates, reversed=' + reversed + ', legacy=' + withLegacy,
        rows: [scopedCustom, shell, ...candidates, ...legacy, receipt, customReceipt],
        main: [['other_tool_call', 'completed', [3, 8 + legacy.length]], ['command', 'completed', [4, 7 + legacy.length]]],
        detached: [5, 6, ...(withLegacy ? [7] : [])], markers: [[reversed ? 6 : 5, 'typed_command_marker'],
          [reversed ? 5 : 6, 'second_command_marker'], ...(withLegacy ? [[7, 'legacy_command_marker']] : [])] };
    })),
    ...[true, false].map(agrees => ({ name: 'unspecified workdir and distinct typed/legacy directories, agreement=' + agrees,
      rows: [scopedCustom, shell, typed({ ...commandItem, cwd: '/unrelated' }), event({ type: 'exec_command_end', call_id, command: commandItem.command,
        source: 'agent', cwd: 'C:/repo', status: agrees ? 'failed' : 'completed', exit_code: agrees ? 72 : 0,
        aggregated_output: 'legacy_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'completed', [4, 7]]], detached: [5, 6],
      markers: [[5, 'typed_command_marker'], [6, 'legacy_command_marker']] })),
    { name: 'native typed wait beside a foreign receiver with the same item ID',
      rows: [scopedCustom, wait, typed(waitItem), typed({ ...waitItem, receiver_thread_ids: [ID], receiver_agents: [{ thread_id: ID }],
        agents_states: { [ID]: { completed: 'foreign_child_marker' } }, status: 'completed' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['agent_coordination', 'failed', [4, 5, 7]]], detached: [6],
      markers: [[5, 'typed_wait_marker'], [6, 'foreign_child_marker']] },
    { name: 'native typed patch beside another patch path with the same item ID',
      rows: [scoped, patch, typed(patchItem), typed({ ...patchItem, changes: { 'other.txt': { type: 'add', content: 'else\n' } },
        status: 'completed', stderr: 'foreign_patch_marker' }), patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['patch', 'failed', [4, 5, 7]]], detached: [6],
      markers: [[5, 'typed_patch_marker'], [6, 'foreign_patch_marker']] },
    ...[
      ['a foreign namespace', { ...shell.payload, namespace: 'fixture' }, typed(commandItem), 'command'],
      ['a missing typed turn', shell.payload, event({ type: 'item_completed', thread_id: ID, item: commandItem }), 'command'],
      ['a foreign thread', shell.payload, typed(commandItem, { thread_id: child }), 'command'],
      ['a duplicate argument', { ...shell.payload, arguments: '{"command":"other","command":"echo fail"}' }, typed(commandItem), 'command'],
      ['a wrong lifecycle family', shell.payload, typed(waitItem), 'command'],
    ].map(([label, request, item, kind]) => ({ name: 'native typed evidence stays Protocol for ' + label,
      rows: [scopedCustom, response(request), item, receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], [kind, 'completed', [4, 6]]], detached: [5], markers: [] })),
    ...[true, false].map(withReceipt => {
      const begin = event({ type: 'exec_command_begin', call_id, command: commandItem.command, source: 'agent' });
      const ends = [0, 1].map(exit_code => event({ type: 'exec_command_end', call_id, command: commandItem.command, source: 'agent',
        exit_code, status: exit_code ? 'failed' : 'completed', aggregated_output: 'duplicate_command_marker_' + exit_code }));
      if (!withReceipt) ends.reverse();
      return { name: 'two plausible legacy command ends stay disputed, receipt=' + withReceipt,
        rows: [scopedCustom, shell, begin, ...ends, ...(withReceipt ? [receipt] : []), customReceipt],
        main: [['other_tool_call', 'completed', [3, withReceipt ? 9 : 8]],
          ['command', withReceipt ? 'completed' : 'incomplete', withReceipt ? [4, 5, 8] : [4, 5]]],
        detached: [6, 7], markers: [[6, ends[0].payload.aggregated_output], [7, ends[1].payload.aggregated_output]], commandExit: undefined };
    }),
    { name: 'only locally matching legacy command ends can dispute each other',
      rows: [scopedCustom, shell, event({ type: 'exec_command_end', call_id, command: ['different'], exit_code: 0,
        status: 'completed', aggregated_output: 'foreign_command_marker' }), event({ type: 'exec_command_end', call_id,
        command: commandItem.command, exit_code: 1, status: 'failed', aggregated_output: 'local_command_marker' }), customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', 'failed', [4, 6]]], detached: [5],
      markers: [[5, 'foreign_command_marker'], [6, 'local_command_marker']], commandExit: 1 },
    ...['typed', 'legacy'].flatMap(format => [true, false].map(matches => ({
      name: 'legacy command success and a ' + format + ' dynamic failure with ' + (matches ? 'matching' : 'foreign') + ' arguments',
      rows: [scopedCustom, shell, event({ type: 'exec_command_end', call_id, command: commandItem.command, source: 'agent',
        status: 'completed', exit_code: 0, aggregated_output: 'legacy_command_marker' }),
        format === 'typed' ? typed({ type: 'DynamicToolCall', id: call_id, tool: 'shell_command',
          arguments: { command: matches ? 'echo fail' : 'echo other' }, status: 'failed', success: false, error: 'dynamic_failure_marker' })
          : dynamicEnd({ tool_name: 'shell_command', arguments: { command: matches ? 'echo fail' : 'echo other' } },
          { success: false, error: 'dynamic_failure_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', matches ? 'completed' : 'success', matches ? [4, 7] : [4, 5, 7]]],
      detached: matches ? [5, 6] : [6], markers: [[5, 'legacy_command_marker'], [6, 'dynamic_failure_marker'],
        [7, 'current_function_marker'], [8, 'scoped_custom_marker']], commandExit: matches ? undefined : 0,
    }))),
    ...[child, ID].map(secondReceiver => ({
      name: 'legacy UUID wait results with ' + (secondReceiver === child ? 'two eligible ends' : 'one eligible end'),
      rows: [scopedCustom, wait, waitBegin(child), event({ type: 'collab_waiting_end', call_id, sender_thread_id: ID,
        statuses: { [child]: { completed: 'first_wait_marker' } } }),
        event({ type: 'collab_waiting_end', call_id, sender_thread_id: ID, statuses: { [secondReceiver]: { errored: 'second_wait_marker' } } }),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 9]], ['agent_coordination', 'success', secondReceiver === child ? [4, 5, 8] : [4, 5, 6, 8]]],
      detached: secondReceiver === child ? [6, 7] : [7], markers: [[6, 'first_wait_marker'], [7, 'second_wait_marker'],
        [8, 'current_function_marker'], [9, 'scoped_custom_marker']],
    })),
    { name: 'legacy patch end and decline both stay disputed',
      rows: [scoped, patch, patchEnd, event({ type: 'patch_apply_declined', call_id, changes: patchItem.changes }), receipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', 'incomplete', [4]]], detached: [5, 6], markers: [] },
    { name: 'a unique native command keeps its typed failure beside duplicate scoped custom requests',
      rows: [scopedCustom, shell, scopedCustom, typed(commandItem), receipt, customReceipt],
      main: [['other_tool_call', 'incomplete', [3]], ['command', 'failed', [4, 6, 7]], ['other_tool_call', 'incomplete', [5]]],
      detached: [8], markers: [[6, 'typed_command_marker'], [8, 'scoped_custom_marker']], commandExit: 72 },
    { name: 'an ambiguous custom channel cannot own the unique function command failure',
      rows: [scopedCustom, shell, patch, typed(commandItem), receipt, customReceipt],
      main: [['other_tool_call', 'incomplete', [3]], ['command', 'failed', [4, 6, 7]], ['other_tool_call', 'incomplete', [5]]],
      detached: [8], markers: [[6, 'typed_command_marker'], [8, 'scoped_custom_marker']], commandExit: 72 },
    { name: 'an ambiguous function channel cannot own the unique custom patch failure',
      rows: [scoped, patch, shell, typed(patchItem), patchReceipt, receipt],
      main: [['other_tool_call', 'incomplete', [3]], ['patch', 'failed', [4, 6, 7]], ['other_tool_call', 'incomplete', [5]]],
      detached: [8], markers: [[6, 'typed_patch_marker'], [8, 'current_function_marker']] },
    ...[false, true].map(withTyped => ({
      name: 'two patch requests dispute an unlabelled legacy end, typed=' + withTyped,
      rows: [scoped, response({ type: 'function_call', name: 'apply_patch', call_id, arguments: JSON.stringify({ input: patch.payload.input }) }),
        patch, patchEnd, ...(withTyped ? [typed(patchItem)] : []), receipt],
      main: [['other_tool_call', 'incomplete', [3]], ['other_tool_call', 'incomplete', [4]],
        ['patch', withTyped ? 'failed' : 'incomplete', withTyped ? [5, 7] : [5]]],
      detached: [6, withTyped ? 8 : 7], markers: [[6, 'synthetic patch applied'], ...(withTyped ? [[7, 'typed_patch_marker']] : [])] })),
    ...[true, false].map(plausible => {
      const input = edits => ['*** Begin Patch', '*** Update File: synthetic.txt', '@@', ...edits, '*** End Patch'].join('\n');
      const changes = { 'synthetic.txt': { type: 'update', unified_diff: '@@ -1,2 +1,2 @@\n stay\n-before\n+after\n' } };
      return { name: 'legacy update beside a historical replacement with compatible net edits=' + plausible,
        rows: [scoped, response({ type: 'function_call', name: 'apply_patch', call_id, arguments: JSON.stringify({
          input: input(['-stay', '-before', '+stay', plausible ? '+after' : '+else']) }) }),
          response({ ...patch.payload, input: input([' stay', '-before', '+after']) }), typed({ ...patchItem, changes }),
          event({ type: 'patch_apply_end', call_id, changes, success: false, status: 'failed' }), receipt],
        main: [['other_tool_call', 'incomplete', [3]], ['other_tool_call', 'incomplete', [4]],
          ['patch', 'failed', plausible ? [5, 6] : [5, 6, 7]]], detached: [...(plausible ? [7] : []), 8],
        markers: [[6, 'typed_patch_marker'], [8, 'current_function_marker']] };
    }),
    { name: 'native typed shell before its request stays in Protocol',
      rows: [scopedCustom, typed(commandItem), shell, receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', 'completed', [5, 6]]], detached: [4], markers: [[4, 'typed_command_marker']] },
    { name: 'native typed shell excludes a legacy terminal for another command',
      rows: [scopedCustom, shell, typed(commandItem), event({ type: 'exec_command_end', call_id, command: ['different'],
        source: 'agent', status: 'completed', exit_code: 0, aggregated_output: 'foreign_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'failed', [4, 5, 7]]], detached: [6],
      markers: [[5, 'typed_command_marker'], [6, 'foreign_command_marker']], commandExit: 72 },
    ...['failed', 'completed'].map(status => ({ name: 'native typed shell excludes the ' + status + ' end from another workdir',
      rows: [scopedCustom, response({ ...shell.payload, arguments: '{"command":"echo fail","workdir":"/work/a"}' }),
        typed({ ...commandItem, cwd: '/work/a' }), event({ type: 'exec_command_end', call_id, command: commandItem.command,
          source: 'agent', cwd: '/different', status, exit_code: status === 'failed' ? 72 : 0, aggregated_output: 'foreign_workdir_marker' }),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'failed', [4, 5, 7]]], detached: [6],
      markers: [[5, 'typed_command_marker'], [6, 'foreign_workdir_marker']], commandExit: 72 })),
    ...[
      ['matching fields', { command: ['/bin/sh', '-c', 'echo fail'], source: 'agent', cwd: 'file:///work/a' }, true],
      ['historical missing fields', {}, true],
      ['foreign argv', { command: ['echo', 'elsewhere'] }, false],
      ['foreign source', { command: ['echo', 'fail'], source: 'user_shell' }, false],
      ['foreign cwd', { cwd: '/other' }, false],
      ['malformed argv', { command: [null] }, false],
    ].map(([label, fields, matches]) => ({ name: 'legacy command begin and end with ' + label,
      rows: [scopedCustom, response({ ...shell.payload, arguments: '{"command":"echo fail","workdir":"/work/a"}' }),
        event({ type: 'exec_command_begin', call_id, ...fields }),
        event({ type: 'exec_command_end', call_id, ...fields, exit_code: 71, status: 'failed', aggregated_output: 'legacy_command_marker' }),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', matches ? 'failed' : 'completed', matches ? [4, 5, 6, 7] : [4, 7]]],
      detached: matches ? [] : [5, 6], markers: [[6, 'legacy_command_marker']], commandExit: matches ? 71 : undefined })),
    ...[
      ['matching absolute path', cwd => ({ [path.join(cwd, 'synthetic.txt')]: patchItem.changes['synthetic.txt'] }), true],
      ['historical empty map', () => ({}), true],
      ['foreign path', () => ({ 'other.txt': { type: 'add', content: 'example\n' } }), false],
      ['foreign contents', () => ({ 'synthetic.txt': { type: 'add', content: 'elsewhere\n' } }), false],
      ['foreign change type', () => ({ 'synthetic.txt': { type: 'delete', content: 'example\n' } }), false],
      ['malformed changes', () => ['synthetic.txt'], false],
    ].map(([label, changes, matches]) => ({ name: 'legacy patch begin and end with ' + label,
      rows: cwd => [scoped, patch, event({ type: 'patch_apply_begin', call_id, changes: changes(cwd) }),
        event({ type: 'patch_apply_end', call_id, changes: changes(cwd), status: 'failed', success: false, stderr: 'legacy_patch_marker' }),
        patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['patch', matches ? 'failed' : 'success', matches ? [4, 5, 6, 7] : [4, 7]]],
      detached: matches ? [] : [5, 6], markers: [[6, 'legacy_patch_marker']] })),
    { name: 'legacy patch begin and end without changes',
      rows: [scoped, patch, event({ type: 'patch_apply_begin', call_id }),
        event({ type: 'patch_apply_end', call_id, status: 'failed', success: false, stderr: 'legacy_patch_marker' }), patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['patch', 'failed', [4, 5, 6, 7]]], detached: [], markers: [[6, 'legacy_patch_marker']] },
    { name: 'legacy write_stdin records the running command in both phases',
      rows: [scopedCustom, response({ ...shell.payload, name: 'write_stdin', arguments: '{"session_id":10,"chars":"hello"}' }),
        event({ type: 'exec_command_begin', call_id, command: ['running-program'], source: 'unified_exec_interaction', process_id: '10' }),
        event({ type: 'exec_command_end', call_id, command: ['running-program'], source: 'unified_exec_interaction', process_id: '10',
          exit_code: 71, status: 'failed', aggregated_output: 'legacy_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'failed', [4, 5, 6, 7]]], detached: [], markers: [[6, 'legacy_command_marker']], commandExit: 71 },
    { name: 'legacy write_stdin cannot own the startup command with the same ID',
      rows: [scopedCustom, response({ ...shell.payload, name: 'write_stdin', arguments: '{"session_id":10,"chars":"hello"}' }),
        event({ type: 'exec_command_end', call_id, command: ['running-program'], source: 'unified_exec_startup',
          exit_code: 71, status: 'failed', aggregated_output: 'legacy_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['other_tool_call', 'completed', [4, 6]]], detached: [5], markers: [[5, 'legacy_command_marker']] },
    ...[
      ['exec_command', false, ['/bin/bash', '-c'], true], ['exec_command', false, ['/bin/bash', '-lc'], false],
      ['shell_command', true, ['/bin/zsh', '-c'], false], ['shell_command', true, ['/bin/zsh', '-lc'], true],
      ['shell_command', false, ['pwsh.exe', '-NoProfile', '-Command'], true], ['shell_command', false, ['pwsh.exe', '-Command'], false],
      ['exec_command', true, ['powershell.exe', '-NoProfile', '-Command'], false], ['exec_command', true, ['powershell.exe', '-Command'], true],
      ['exec_command', false, ['cmd.exe', '/c'], true], ['exec_command', true, ['cmd.exe', '/c'], true],
      ['exec_command', 'false', ['/bin/bash', '-c'], false],
    ].map(([name, login, wrapper, matches]) => ({ name: 'native typed ' + name + ' with login=' + JSON.stringify(login) + ' and ' + wrapper.join(' '),
      initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd: commandItem.cwd } },
      rows: [scopedCustom, response({ ...shell.payload, name, arguments: JSON.stringify({ [name === 'exec_command' ? 'cmd' : 'command']: 'echo fail', login }) }),
        typed({ ...commandItem, source: name === 'exec_command' ? 'unified_exec_startup' : 'agent', command: [...wrapper, 'echo fail'] }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', matches ? 'failed' : 'completed', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_command_marker']], commandExit: matches ? 72 : undefined })),
    ...[
      ['relative child', '/work/base', 'sub', 'file:///work/base/sub', true],
      ['empty default', '/work/base', '', 'file:///work/base', true],
      ...[undefined, null, ''].flatMap(workdir => [
        ['default ' + String(workdir) + ' agrees', '/work/base', workdir, 'file:///work/base', true],
        ['default ' + String(workdir) + ' conflicts', '/work/base', workdir, 'file:///work/foreign', false],
        ['default ' + String(workdir) + ' is unknown', '', workdir, 'file:///work/base', false],
        ['default ' + String(workdir) + ' in a named environment', '/work/base', workdir, 'file:///work/base', false, 'another'],
      ]),
      ['parent component', '/work/base', '../other', 'file:///work/other', true],
      ['Windows directory', 'D:/work/base', 'sub', 'file:///D:/work/base/sub', true],
      ['UNC relative child', '//fixture-host/share/base', 'sub', 'file://fixture-host/share/base/sub', true],
      ['POSIX directory with a similar UNC spelling', '/fixture-host/share/base', 'sub', 'file://fixture-host/share/base/sub', false],
      ['foreign directory', '/work/base', 'sub', 'file:///other/sub', false],
      ['missing default', '', 'sub', 'file:///work/base/sub', false],
      ['selected environment lacks a cwd', '/work/base', 'sub', 'file:///work/base/sub', false, 'another'],
    ].map(([label, cwd, workdir, terminalCwd, matches, environment_id]) => ({ name: 'exec_command workdir with ' + label,
      initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd } },
      rows: [scopedCustom, response({ ...shell.payload, name: 'exec_command', arguments: JSON.stringify({ cmd: 'echo fail', workdir, environment_id }) }),
        typed({ ...commandItem, source: 'unified_exec_startup', cwd: terminalCwd }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', matches ? 'failed' : 'completed', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_command_marker']], commandExit: matches ? 72 : undefined })),
    ...[undefined, null, ''].map(workdir => ({
      name: 'default exec_command directory ' + String(workdir) + ' separates otherwise identical terminals',
      initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd: '/work/base' } },
      rows: [scopedCustom, response({ ...shell.payload, name: 'exec_command', arguments: JSON.stringify({ cmd: 'echo fail', workdir }) }),
        typed({ ...commandItem, source: 'unified_exec_startup', cwd: 'file:///work/base' }),
        typed({ ...commandItem, source: 'unified_exec_startup', cwd: 'file:///work/foreign', exit_code: 0, status: 'completed', aggregated_output: 'foreign_directory_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'failed', [4, 5, 7]]], detached: [6],
      markers: [[5, 'typed_command_marker'], [6, 'foreign_directory_marker']], commandExit: 72 })),
    ...['//fixture-host/share/base', '\\\\fixture-host\\share\\base', '/fixture-host/share/base'].flatMap(cwd => [true, false].map(uncFirst => {
      const unc = cwd !== '/fixture-host/share/base';
      const uncEnd = typed({ ...commandItem, source: 'unified_exec_startup', cwd: 'file://fixture-host/share/base' });
      const posixEnd = typed({ ...commandItem, source: 'unified_exec_startup', cwd: 'file:///fixture-host/share/base', exit_code: 0,
        status: 'completed', aggregated_output: 'posix_directory_marker' });
      const uncLine = uncFirst ? 5 : 6, posixLine = uncFirst ? 6 : 5;
      return { name: 'default command directory ' + cwd + ' with UNC terminal first=' + uncFirst,
        initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd } },
        rows: [scopedCustom, response({ ...shell.payload, name: 'exec_command', arguments: '{"cmd":"echo fail"}' }),
          ...(uncFirst ? [uncEnd, posixEnd] : [posixEnd, uncEnd]), receipt, customReceipt],
        main: [['other_tool_call', 'completed', [3, 8]], ['command', unc ? 'failed' : 'success', [4, unc ? uncLine : posixLine, 7]]],
        detached: [unc ? posixLine : uncLine], markers: [[uncLine, 'typed_command_marker'], [posixLine, 'posix_directory_marker']], commandExit: unc ? 72 : 0 };
    })),
    { name: 'native command path and typed file URI identify the same recorded workdir',
      rows: [scopedCustom, response({ ...shell.payload, arguments: '{"command":"echo fail","workdir":"/work/a"}' }),
        typed({ ...commandItem, cwd: 'file:///work/a' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', 'failed', [4, 5, 6]]], detached: [],
      markers: [[5, 'typed_command_marker']], commandExit: 72 },
    ...[
      ['bash', '/bin/bash', '-c', true], ['/usr/local/bin/bash', '/bin/bash', '-c', true],
      ['powershell', 'C:/Program Files/PowerShell/7/pwsh.exe', '-NoProfile', true],
      ['bash', '/bin/zsh', '-c', false], ['bash', '/bin/bash', '-lc', false],
      ['/bin/bash-copy', '/bin/bash', '-c', false], ['bash', '/opt/bash/wrapper', '-c', false],
    ].map(([selector, executable, flag, matches]) => ({ name: 'exec_command shell selector ' + selector + ' resolved to ' + executable + ' ' + flag,
      initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd: commandItem.cwd } },
      rows: [scopedCustom, response({ ...shell.payload, name: 'exec_command', arguments: JSON.stringify({ cmd: 'echo hi', shell: selector, login: false }) }),
        typed({ ...commandItem, source: 'unified_exec_startup', command: [executable, flag, ...(flag === '-NoProfile' ? ['-Command'] : []), 'echo hi'] }),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', matches ? 'failed' : 'completed', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_command_marker']], commandExit: matches ? 72 : undefined })),
    ...[
      ['file:///work/repo', '/bin/sh', '-c', true], ['C:/repo', 'cmd.exe', '/c', true],
      ['/work/repo', '/usr/bin/sh', '-c', false], ['C:/repo', 'C:/Windows/System32/cmd.exe', '/c', false],
      ['/work/repo', '/bin/sh', '-lc', false], ['/work/repo', 'cmd.exe', '/c', false], ['C:/repo', '/bin/sh', '-c', false],
    ].map(([cwd, executable, flag, matches]) => ({ name: 'unknown shell selector with ' + executable + ' ' + flag + ' in ' + cwd,
      initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd: cwd === 'file:///work/repo' ? '/work/repo' : cwd } },
      rows: [scopedCustom, response({ ...shell.payload, name: 'exec_command', arguments: '{"cmd":"echo hi","shell":"fish","login":false}' }),
        typed({ ...commandItem, source: 'unified_exec_startup', cwd, command: [executable, flag, 'echo hi'] }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', matches ? 'failed' : 'completed', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_command_marker']], commandExit: matches ? 72 : undefined })),
    ...[
      ['same absolute add', patch.payload.input, patchItem.changes['synthetic.txt'], true],
      ['another add', patch.payload.input, { type: 'add', content: 'other\n' }, false],
      ['writer trimmed context', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n first\n second\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -2,2 +2,2 @@\n second\n-before\n+after\n' }, true],
      ['writer trimmed context with a section selector', '*** Begin Patch\n*** Update File: synthetic.txt\n@@ section\n first\n second\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -8,2 +8,2 @@\n second\n-before\n+after\n' }, true],
      ...[[1, false], [2, true]].map(([line, matches]) => ['a named section before the replacement at line ' + line,
        '*** Begin Patch\n*** Update File: synthetic.txt\n@@ section\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -' + line + ' +' + line + ' @@\n-before\n+after\n' }, matches]),
      ['a whitespace-only hunk header', '*** Begin Patch\n*** Update File: synthetic.txt\n@@  \n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -1 +1 @@\n-before\n+after\n' }, true],
      ...[
        ['fully observed matching selector', '@@ -1,2 +1,2 @@\n section\n', true],
        ['fully observed missing selector', '@@ -1,2 +1,2 @@\n unrelated\n', false],
        ['selector before an unobserved prefix', '@@ -2,2 +2,2 @@\n unrelated\n', true],
      ].map(([label, prefix, matches]) => [label, '*** Begin Patch\n*** Update File: synthetic.txt\n@@ section\n-old\n+new\n*** End Patch',
        { type: 'update', unified_diff: prefix + '-old\n+new\n' }, matches]),
      ['writer coalesced adjacent chunks', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-a\n+A\n@@\n-b\n+B\n*** End Patch',
        { type: 'update', unified_diff: '@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n' }, true],
      ...[['last', true], ['LAST', false]].map(([line, matches]) => ['append preserves the unterminated old line as ' + line,
        '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -1 +1,2 @@\n-last\n\\ No newline at end of file\n+' + line + '\n+after\n' }, matches]),
      ...[[1, false], [4, true]].map(([line, matches]) => ['required context before a replacement at line ' + line,
        '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n required\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -' + line + ' +' + line + ' @@\n-before\n+after\n' }, matches]),
      ...[['adjacent edits', '@@ -1,3 +1,3 @@\n-a\n+A\n same\n-b\n+B\n', true],
        ['distant edits', '@@ -1,2 +1,2 @@\n-a\n+A\n same\n@@ -20,2 +20,2 @@\n same\n-b\n+B\n', false],
      ].map(([label, diff, matches]) => ['one request hunk with ' + label,
        '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-a\n+A\n same\n-b\n+B\n*** End Patch',
        { type: 'update', unified_diff: diff }, matches]),
      ['writer added context at EOF', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n+after\n*** End of File\n*** End Patch',
        { type: 'update', unified_diff: '@@ -3 +3,2 @@\n last\n+after\n' }, true],
      ...[
        ['append with trailing old data', '+after', '@@ -1 +1,2 @@\n+after\n existing\n', false],
        ['append after the last observed old line', '+after', '@@ -5 +5,2 @@\n existing\n+after\n', true],
        ['insert with requested trailing context', '+after\n existing', '@@ -1 +1,2 @@\n+after\n existing\n', true],
        ['required old context beyond marked EOF', '-old\n+new\n need', '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n', false],
        ['cropped context without an old EOF marker', '-old\n+new\n need', '@@ -1 +1 @@\n-old\n+new\n', true],
        ['optional trailing empty context at marked EOF', '-old\n+new\n ', '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n', true],
        ['explicit EOF before recorded old data', '-old\n+new\n*** End of File', '@@ -1,2 +1,2 @@\n-old\n+new\n later\n', false],
        ['explicit EOF across the full chunk', '-old\n+new\n later\n*** End of File', '@@ -1,2 +1,2 @@\n-old\n+new\n later\n', true],
        ['explicit EOF on the last of two request hunks', '-a\n+A\n@@\n-b\n+B\n*** End of File',
          '@@ -2 +2 @@\n-a\n+A\n@@ -8 +8 @@\n-b\n+B\n', true],
      ].map(([label, body, diff, matches]) => [label, '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n' + body + '\n*** End Patch',
        { type: 'update', unified_diff: diff }, matches]),
      ...[
        ['writer-matched old whitespace', ' required  \n-  "before"-x\t\n+"after"', true],
        ['writer-matched old punctuation', ' required\n-“before”—x\n+"after"', true],
        ['altered added whitespace', ' required\n-"before"-x\n+"after"  ', false],
        ['altered added punctuation', ' required\n-"before"-x\n+“after”', false],
        ['unsupported old punctuation', ' required\n-"before"⁃x\n+"after"', false],
      ].map(([label, diff, matches]) => [label, '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n required\n-"before"-x\n+"after"\n*** End Patch',
        { type: 'update', unified_diff: '@@ -1,2 +1,2 @@\n' + diff + '\n' }, matches]),
      ['conflicting left context', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n alpha region\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -19,2 +19,2 @@\n omega region\n-before\n+after\n' }, false],
      ['conflicting right context', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-before\n+after\n alpha region\n*** End Patch',
        { type: 'update', unified_diff: '@@ -19,2 +19,2 @@\n-before\n+after\n omega region\n' }, false],
      ...[true, false].map(matches => ['two edits with ' + (matches ? 'matching' : 'conflicting') + ' second hunk context',
        '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n alpha\n-before\n+after\n@@\n omega\n-before\n+after\n last\n*** End Patch',
        { type: 'update', unified_diff: '@@ -2,2 +2,2 @@\n alpha\n-before\n+after\n@@ -20,3 +20,3 @@\n'
          + (matches ? ' omega\n' : ' alpha\n') + '-before\n+after\n last\n' }, matches]),
      ['one edit split across foreign hunks', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -2,2 +2 @@\n alpha\n-before\n@@ -19 +18,2 @@\n omega\n+after\n' }, false],
      ['same edit text in separate recorded hunks', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -2 +1,0 @@\n-before\n@@ -19,0 +19 @@\n+after\n' }, false],
      ['different replacement', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -1 +1 @@\n-before\n+other\n' }, false],
      ...[
        ['overstated range', '@@ -1,99 +1,99 @@\n', false],
        ['nonempty range at line zero', '@@ -0 +0 @@\n', false],
        ['inconsistent old and new origins', '@@ -5 +9 @@\n', false],
        ['historical bare hunk header', '@@\n', true], ['historical edit lines', '', true],
      ].map(([label, header, matches]) => [label, '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: header + '-before\n+after\n' }, matches]),
      ['insertion into an empty file', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -0,0 +1 @@\n+after\n' }, true],
      ['unterminated old line', '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n-before\n+after\n*** End Patch',
        { type: 'update', unified_diff: '@@ -1 +1 @@\n-before\n\\ No newline at end of file\n+after\n' }, true],
    ].flatMap(([label, input, change, matches]) => [{ name: 'historical function apply_patch with ' + label,
      rows: cwd => [scopedCustom, response({ type: 'function_call', name: 'apply_patch', call_id, arguments: JSON.stringify({ input }) }),
        event({ type: 'patch_apply_end', call_id, changes: { [path.join(cwd, 'synthetic.txt')]: change },
          status: 'failed', success: false, stderr: 'legacy_patch_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', matches ? 'failed' : 'incomplete', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'legacy_patch_marker']] },
    { name: 'typed FileChange with ' + label,
      rows: cwd => [scoped, response({ ...patch.payload, input }),
        typed({ ...patchItem, changes: { [path.join(cwd, 'synthetic.txt')]: change } }), receipt],
      main: [['other_tool_call', 'completed', [3, 6]], ['patch', matches ? 'failed' : 'incomplete', matches ? [4, 5] : [4]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_patch_marker']] }]),
    ...[
      ['a different replacement', '@@ -1,2 +1,2 @@\n required\n-before\n+WRONG\n', true],
      ['a provably impossible position', '@@ -1 +1 @@\n-before\n+after\n', true],
      ['an incomplete diff', '@@ -1,2 +1,2 @@\n-before\n+WRONG\n', false],
      ['a malformed range with matching edits', '@@ -1,99 +1,99 @@\n required\n-before\n+after\n', false],
      ['a nonempty range starting at zero', '@@ -0,2 +0,2 @@\n required\n-before\n+WRONG\n', false],
      ['a writer-compatible old line', '@@ -1,2 +1,2 @@\n required  \n-before\t\n+after\n', false],
      ['another plausible completion', '@@ -1,2 +1,2 @@\n required\n-before\n+after\n', false],
      ['writer coalescing adjacent edits', '@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n', false, '-a\n+A\n@@\n-b\n+B',
        '@@ -1 +1 @@\n-a\n+A\n@@ -5 +5 @@\n-b\n+B\n'],
      ['coalesced edits with different inserted text', '@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+OTHER\n', true, '-a\n+A\n@@\n-b\n+B',
        '@@ -1 +1 @@\n-a\n+A\n@@ -5 +5 @@\n-b\n+B\n'],
      ['an unverified regrouping with balanced edit text', '@@ -1,3 +1,3 @@\n required\n-repeat\n-before\n+after\n+repeat\n', false],
      ['writer adding a final newline before appending', '@@ -1 +1,2 @@\n-last\n\\ No newline at end of file\n+last\n+after\n', false,
        '+after', '@@ -1 +1,2 @@\n last\n+after\n'],
    ].flatMap(([label, otherDiff, foreign, body = ' required\n-before\n+after', localDiff = '@@ -1,2 +1,2 @@\n required\n-before\n+after\n']) =>
      ['typed', 'legacy'].map(format => {
      const local = { 'synthetic.txt': { type: 'update', unified_diff: localDiff } };
      const changes = { 'synthetic.txt': { type: 'update', unified_diff: otherDiff } };
      const otherEnd = format === 'typed' ? typed({ ...patchItem, status: 'completed', changes, stderr: 'second_patch_marker' })
        : event({ type: 'patch_apply_end', call_id, changes, status: 'completed', success: true, stdout: 'second_patch_marker' });
      return { name: 'typed patch failure beside ' + label + ' in ' + format,
        rows: [scoped, response({ ...patch.payload, input: '*** Begin Patch\n*** Update File: synthetic.txt\n@@\n' + body + '\n*** End Patch' }),
          typed({ ...patchItem, changes: local }), otherEnd, receipt],
        main: [['other_tool_call', 'completed', [3, 7]], ['patch', foreign ? 'failed' : 'incomplete', foreign ? [4, 5] : [4]]],
        detached: foreign ? [6] : [5, 6], markers: [[5, 'typed_patch_marker'], [6, 'second_patch_marker']] };
    })),
    ...[
      ['recorded process and text', { process_id: '10', interaction_input: 'hi' }, true],
      ['another process', { process_id: '11', interaction_input: 'hi' }, false],
      ['another input', { process_id: '10', interaction_input: 'bye' }, false],
      ['historical missing process and text', {}, true],
    ].map(([label, fields, matches]) => ({ name: 'legacy write_stdin identity with ' + label,
      rows: [scopedCustom, response({ ...shell.payload, name: 'write_stdin', arguments: '{"session_id":10,"chars":"hi"}' }),
        event({ type: 'exec_command_begin', call_id, source: 'unified_exec_interaction', command: ['running-program'], ...fields }),
        event({ type: 'exec_command_end', call_id, source: 'unified_exec_interaction', command: ['running-program'], ...fields,
          status: 'failed', exit_code: 71, aggregated_output: 'legacy_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], [matches ? 'command' : 'other_tool_call', matches ? 'failed' : 'completed', matches ? [4, 5, 6, 7] : [4, 7]]],
      detached: matches ? [] : [5, 6], markers: [[6, 'legacy_command_marker']] })),
    ...['agents', 'collaboration'].map(namespace => ({ name: namespace + ' mailbox wait cannot own a V1 targeted terminal',
      rows: [scopedCustom, response({ ...wait.payload, namespace }), typed(waitItem), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['agent_coordination', 'success', [4, 6]]], detached: [5],
      markers: [[5, 'typed_wait_marker']] })),
    ...[true, false].map(matches => ({ name: 'session cwd absolute patch key, matches=' + matches,
      rows: cwd => [scoped, patch, typed({ ...patchItem,
        changes: { [path.join(cwd, ...(matches ? [] : ['elsewhere']), 'synthetic.txt')]: { type: 'add', content: 'example\n' } } }),
        patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', matches ? 'failed' : 'success', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_patch_marker']] })),
    ...[
      ['current turn', '/work/a', '/work/a/moved.txt', true], ['foreign move', '/work/a', '/other/moved.txt', false],
      ['missing current cwd', '', '/work/a/moved.txt', false],
    ].map(([label, cwd, move_path, matches]) => ({ name: 'absolute typed patch with ' + label,
      rows: [{ type: 'turn_context', payload: { turn_id: TURN, cwd } }, scoped,
        response({ ...patch.payload, input: '*** Begin Patch\n*** Update File: original.txt\n*** Move to: moved.txt\n-before\n+after\n*** End Patch' }),
        typed({ ...patchItem, changes: { '/work/a/original.txt': { type: 'update', unified_diff: '@@\n-before\n+after\n', move_path } } }),
        patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [4, 8]], ['patch', matches ? 'failed' : 'success', matches ? [5, 6, 7] : [5, 7]]],
      detached: matches ? [] : [6], markers: [[6, 'typed_patch_marker']] })),
    ...[false, true].flatMap(isTyped => [
      ['foreign destination', 'elsewhere.txt', true], ['explicitly no move', null, true],
      ['same destination', '/work/dir/moved.txt', false], ['malformed destination', 17, false],
    ].map(([label, destination, foreign]) => {
      const changes = move_path => ({ 'source.txt': { type: 'update', move_path, unified_diff: '@@ -1 +1 @@\n-before\n+after\n' } });
      return { name: (isTyped ? 'typed' : 'legacy') + ' competing patch with ' + label,
        initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd: '/work/dir' } },
        rows: [scoped, response({ ...patch.payload, input: '*** Begin Patch\n*** Update File: source.txt\n*** Move to: moved.txt\n-before\n+after\n*** End Patch' }),
          typed({ ...patchItem, changes: changes('moved.txt') }),
          isTyped ? typed({ ...patchItem, status: 'completed', changes: changes(destination), stderr: 'competing_patch_marker' })
            : event({ ...patchEnd.payload, changes: changes(destination), stdout: 'competing_patch_marker' }), receipt],
        main: [['other_tool_call', 'completed', [3, 7]], ['patch', foreign ? 'failed' : 'incomplete', foreign ? [4, 5] : [4]]],
        detached: foreign ? [6] : [5, 6], markers: [[5, 'typed_patch_marker'], [6, 'competing_patch_marker']] };
    })),
    { name: 'native typed shell and agreeing legacy evidence both belong to the command',
      rows: [scopedCustom, shell, typed(commandItem), event({ type: 'exec_command_end', call_id, command: commandItem.command,
        source: 'agent', status: 'failed', exit_code: 72, aggregated_output: 'typed_command_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'failed', [4, 5, 6, 7]]], detached: [],
      markers: [[5, 'typed_command_marker']], commandExit: 72 },
    ...[
      ['process_id', { process_id: '222' }],
      ['aggregated_output', { aggregated_output: 'different_command_output' }],
      ...['stdout', 'stderr', 'formatted_output'].map(key => [key, { [key]: 'different_command_output' }]),
    ].map(([key, fields]) => ({ name: 'conflicting recorded command mirror ' + key,
      rows: [scopedCustom, shell, typed({ ...commandItem, process_id: '111', stdout: 'out', stderr: 'err', formatted_output: 'out err' }), event({ type: 'exec_command_end', call_id,
        command: commandItem.command, status: 'failed', exit_code: 72, process_id: '111',
        aggregated_output: commandItem.aggregated_output, ...fields }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'completed', [4, 7]]], detached: [5, 6],
      markers: key === 'aggregated_output' ? [[5, 'typed_command_marker'], [6, 'different_command_output']] : [], commandExit: undefined })),
    { name: 'native typed shell and same-registration typed dynamic outcome are disputed',
      rows: [scopedCustom, shell, typed(commandItem), typed({ type: 'DynamicToolCall', id: call_id, tool, status: 'completed',
        arguments: { command: 'echo fail' }, success: true }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', 'completed', [4, 7]]], detached: [5, 6], markers: [[5, 'typed_command_marker']] },
    ...[
      [typed({ type: 'DynamicToolCall', id: call_id, status: 'failed' }), false],
      [event({ type: 'dynamic_tool_call_begin', call_id, tool_name: tool }), false],
      [event({ type: 'dynamic_tool_call_request', call_id, tool, namespace: 'functions' }), false],
      [event({ type: 'dynamic_tool_call_request', callId: call_id, turnId: 'previous-turn', tool, namespace: 'functions' }), true],
      [typed({ type: 'DynamicToolCall', id: call_id, tool: 'different', status: 'failed' }), true],
    ].map(([other, foreign]) => ({ name: 'native typed shell alongside ' + JSON.stringify(other.payload),
      rows: [scopedCustom, shell, typed(commandItem), other, receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['command', foreign ? 'failed' : 'completed', foreign ? [4, 5, 7] : [4, 7]]],
      detached: foreign ? [6] : [5, 6], markers: [[5, 'typed_command_marker']] })),
    ...[
      ['exec_command', { cmd: 'echo fail' }, { source: 'unified_exec_startup', command: ['/bin/bash', '-lc', 'echo fail'] }],
      ['shell', { command: ['echo', 'fail'] }, {}],
      ['shell_command', { command: 'echo fail' }, {}, ''],
    ].map(([name, args, fields, namespace]) => ({ name: 'native typed failure of ' + name,
      initialTurn: { type: 'turn_context', payload: { turn_id: TURN, cwd: commandItem.cwd } },
      rows: [scopedCustom, response({ type: 'function_call', call_id, name, ...(namespace === undefined ? {} : { namespace }), arguments: JSON.stringify(args) }),
        typed({ ...commandItem, ...fields }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['command', 'failed', [4, 5, 6]]], detached: [],
      markers: [[5, 'typed_command_marker']], commandExit: 72 })),
    ...[true, false].map(agrees => ({ name: 'native typed V1 wait with legacy states, agreement=' + agrees,
      rows: [scopedCustom, wait, typed(waitItem), event({ type: 'collab_waiting_end', call_id, sender_thread_id: ID,
        statuses: agrees ? waitItem.agents_states : { [child]: { completed: 'legacy_wait_marker' } } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['agent_coordination', agrees ? 'failed' : 'success', agrees ? [4, 5, 6, 7] : [4, 7]]],
      detached: agrees ? [] : [5, 6], markers: [[5, 'typed_wait_marker']] })),
    ...[
      ['the resolved receiver', [waitBegin(child), waitEnd(child)], [5, 6], [], 6],
      ['a different receiver', [waitBegin(child), waitEnd(ID)], [5], [6], 6],
      ['an end without a begin', [waitEnd(child)], [5], [], 5],
      ['a foreign sender on the begin', [waitBegin(ID, { sender_thread_id: child }), waitEnd(child)], [6], [5], 6],
      ['duplicate begins', [waitBegin(child), waitBegin(child), waitEnd(child)], [], [5, 6, 7], 7],
      ['conflicting begins', [waitBegin(child), waitBegin(ID), waitEnd(child)], [], [5, 6, 7], 7],
      ['a conflicting begin after a matched end', [waitBegin(child), waitEnd(child), waitBegin(ID)], [5, 6], [7], 6],
      ['a late begin after an end-only fragment', [waitEnd(child), waitBegin(ID)], [5], [6], 5],
    ].map(([label, lifecycle, owned, detached, endLine]) => ({ name: 'historical path wait with ' + label,
      rows: [scopedCustom, pathWait, ...lifecycle, receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, lifecycle.length + 6]], ['agent_coordination', 'success', [4, ...owned, lifecycle.length + 5]]],
      detached, markers: [[endLine, 'path_end_marker']] })),
    ...[false, true].map(withBegin => {
      const next = withBegin ? child : ID;
      const second = event({ ...waitEnd(next).payload, status: 'failed', statuses: { [next]: { errored: 'later_wait_marker' } } });
      const firstEnd = withBegin ? 6 : 5;
      return { name: 'a later path-wait lifecycle cannot change the accepted end, initial begin=' + withBegin,
        rows: [scopedCustom, pathWait, ...(withBegin ? [waitBegin(child)] : []), waitEnd(child), waitBegin(next), second, receipt, customReceipt],
        main: [['other_tool_call', 'completed', [3, firstEnd + 4]], ['agent_coordination', 'success',
          [4, ...(withBegin ? [5] : []), firstEnd, firstEnd + 3]]],
        detached: [firstEnd + 1, firstEnd + 2], markers: [[firstEnd, 'path_end_marker'], [firstEnd + 2, 'later_wait_marker']] };
    }),
    { name: 'two eligible legacy ends for one path wait are ambiguous',
      rows: [scopedCustom, pathWait, waitEnd(child), event({ ...waitEnd(ID).payload, status: 'failed',
        statuses: { [ID]: { errored: 'competing_wait_marker' } } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['agent_coordination', 'success', [4, 7]]],
      detached: [5, 6], markers: [[5, 'path_end_marker'], [6, 'competing_wait_marker']] },
    ...[child, ID].map(receiver => ({
      name: 'a dynamic end beside a path-wait end for ' + (receiver === child ? 'the resolved receiver' : 'a foreign receiver'),
      rows: [scopedCustom, pathWait, waitBegin(child), waitEnd(receiver),
        dynamicEnd({ tool_name: 'wait_agent', arguments: { targets: ['/root/reviewer'] } }, { success: false, error: 'dynamic_wait_marker' }),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 9]], ['agent_coordination', receiver === child ? 'success' : 'failed',
        receiver === child ? [4, 5, 8] : [4, 5, 7, 8]]], detached: receiver === child ? [6, 7] : [6],
      markers: [[6, 'path_end_marker'], [7, 'dynamic_wait_marker'], [8, 'current_function_marker']],
    })),
    ...[true, false].map(timedOut => ({ name: 'historical path wait with conflicting begins and ' + (timedOut ? 'a timeout' : 'an explicit UUID result'),
      rows: [scopedCustom, response({ ...pathWait.payload, arguments: JSON.stringify({ targets: [ID, '/root/reviewer'] }) }),
        waitBegin(ID, { receiver_thread_ids: [ID, child] }), waitBegin(ID, { receiver_thread_ids: [ID, ID] }),
        timedOut ? event({ type: 'collab_waiting_end', call_id, sender_thread_id: ID, statuses: {} }) : waitEnd(ID),
        receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 9]], ['agent_coordination', 'success', [4, 7, 8]]], detached: [5, 6],
      markers: timedOut ? [[8, 'current_function_marker']] : [[7, 'path_end_marker']] })),
    ...[
      ['a completed empty result', timeoutItem, true], ['failure with no failed child', { ...timeoutItem, status: 'failed' }, false],
      ['missing states', emptyWaitItem, false], ['malformed states', { ...timeoutItem, agents_states: [] }, false],
      ['a reported state', { ...timeoutItem, agents_states: waitItem.agents_states }, false],
      ['receiver metadata', { ...timeoutItem, receiver_agents: waitItem.receiver_agents }, false],
      ['a foreign sender', { ...timeoutItem, sender_thread_id: child }, false],
    ].map(([label, item, matches]) => ({ name: 'targeted V1 timeout with ' + label,
      rows: [scopedCustom, wait, typed(item), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['agent_coordination', 'success', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[6, 'current_function_marker']] })),
    { name: 'targeted V1 timeout with a competing typed completion',
      rows: [scopedCustom, wait, typed(timeoutItem), typed(waitItem), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['agent_coordination', 'success', [4, 7]]], detached: [5, 6],
      markers: [[6, 'typed_wait_marker']] },
    { name: 'targeted V1 timeout without a function receipt',
      rows: [scopedCustom, wait, typed(timeoutItem), customReceipt],
      main: [['other_tool_call', 'completed', [3, 6]], ['agent_coordination', 'success', [4, 5]]], detached: [],
      markers: [[6, 'scoped_custom_marker']] },
    ...[
      ['update', '*** Update File: synthetic.txt\n context\n-before\n+after',
        { type: 'update', unified_diff: '@@ -1,2 +1,2 @@\n context\n-before\n+after\n', move_path: null }, true],
      ['different update context', '*** Update File: synthetic.txt\n context\n-before\n+after',
        { type: 'update', unified_diff: '@@ -1,2 +1,2 @@\n elsewhere\n-before\n+after\n', move_path: null }, false],
      ['delete', '*** Delete File: synthetic.txt', { type: 'delete', content: 'before\n' }, true],
    ].map(([label, hunk, change, matches]) => ({ name: 'native typed patch with ' + label,
      rows: [scoped, response({ ...patch.payload, input: '*** Begin Patch\n' + hunk + '\n*** End Patch' }),
        typed({ ...patchItem, changes: { 'synthetic.txt': change } }), patchReceipt, receipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['patch', matches ? 'failed' : 'success', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, 'typed_patch_marker']] })),
    ...[
      ['default namespace', historicalMcp(), true],
      ['functions namespace', historicalMcp('mcp__notes__echo', 'functions'), false],
      ['separate namespace', historicalMcp('echo', 'mcp__notes'), true],
      ['native short namesake', historicalMcp('shell_command', 'mcp__notes'), true, 'shell_command'],
    ].map(([label, request, withReceipt, tool = 'echo']) => ({
      name: 'historical MCP typed failure with ' + label, rows: [scopedCustom, request,
        typed({ ...historicalItem, tool }), ...(withReceipt ? [receipt] : []), customReceipt],
      main: [['other_tool_call', 'completed', [3, withReceipt ? 7 : 6]], ['mcp_call', 'failed', withReceipt ? [4, 5, 6] : [4, 5]]],
      detached: [], markers: [[5, 'historical_typed_marker']] })),
    ...[
      ['agreeing', typed(historicalItem), historicalEnd(true), true, true],
      ['conflicting', typed(historicalItem), historicalEnd(false), false, true],
      ['conflicting in reverse order without a receipt', historicalEnd(false), typed(historicalItem), false, false],
      ['conflicting legacy explicit status', typed(historicalItem), event({ ...historicalEnd(false).payload,
        result: null, status: 'completed', message: 'historical_legacy_marker' }), false, true],
    ].map(([label, first, second, agrees, withReceipt]) => ({
      name: 'historical MCP terminals ' + label, rows: [scopedCustom, historicalMcp(), first, second, ...(withReceipt ? [receipt] : []), customReceipt],
      main: [['other_tool_call', 'completed', [3, withReceipt ? 8 : 7]], ['mcp_call', agrees ? 'failed' : withReceipt ? 'completed' : 'incomplete',
        [4, ...(agrees ? [5, 6] : []), ...(withReceipt ? [7] : [])]]],
      detached: agrees ? [] : [5, 6], markers: [first, second].map((r, i) => [5 + i, r.payload.item ? 'historical_typed_marker' : 'historical_legacy_marker']) })),
    ...[
      ['foreign environment', { environmentId: environment }, true],
      ['foreign server', { server: 'other' }, true],
      ['duplicate registration', {}, false],
      ['incomplete registration', { tool: null }, false],
    ].map(([label, registration, foreign]) => ({ name: 'historical MCP typed failure alongside ' + label,
      rows: [scopedCustom, historicalMcp(), typed(historicalItem), typed({ ...historicalItem, ...registration,
        error: { message: 'second_mcp_marker' } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['mcp_call', foreign ? 'failed' : 'completed', foreign ? [4, 5, 7] : [4, 7]]],
      detached: foreign ? [6] : [5, 6], markers: [[5, 'historical_typed_marker'], [6, 'second_mcp_marker']] })),
    { name: 'historical MCP with ambiguous flat name separators keeps both candidate registrations in Protocol',
      rows: [scopedCustom, historicalMcp('mcp__notes___echo'), typed({ ...historicalItem, server: 'notes_' }),
        historicalEnd(false, { invocation: { server: 'notes', tool: '_echo' } }), customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['mcp_call', 'incomplete', [4]]], detached: [5, 6],
      markers: [[5, 'historical_typed_marker'], [6, 'historical_legacy_marker']] },
    { name: 'historical MCP conflicting terminals with a status on the ordinary receipt',
      rows: [scopedCustom, historicalMcp(), historicalEnd(true), typed({ ...historicalItem, status: 'completed', error: null,
        result: { content: [{ type: 'text', text: 'historical_typed_marker' }] } }), response({ ...receipt.payload, status: 'failed' }), customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['mcp_call', 'completed', [4, 7]]], detached: [5, 6],
      markers: [[5, 'historical_legacy_marker'], [6, 'historical_typed_marker'], [7, 'current_function_marker']] },
    { name: 'historical MCP with an exact registration but no typed thread ID',
      rows: [scopedCustom, historicalMcp(), event({ type: 'item_completed', turn_id: TURN, item: historicalItem }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['mcp_call', 'completed', [4, 6]]], detached: [5],
      markers: [[5, 'historical_typed_marker'], [6, 'current_function_marker']] },
    ...[
      ['flat without a terminal', historicalMcp(), true, 'mcp__notes__echo'],
      ['ambiguous flat without a terminal', historicalMcp('mcp__notes___echo'), true, 'mcp__notes___echo'],
      ['separate namespace without a receipt', historicalMcp('shell_command', 'mcp__notes'), false, 'mcp__notes__shell_command'],
      ['separate namespace with a receipt', historicalMcp('shell_command', 'mcp__notes'), true, 'mcp__notes__shell_command'],
    ].map(([label, request, withReceipt, toolName]) => ({ name: 'historical MCP ordinary return ' + label,
      rows: [scopedCustom, request, ...(withReceipt ? [receipt] : []), customReceipt],
      main: [['other_tool_call', 'completed', [3, withReceipt ? 6 : 5]], ['mcp_call', withReceipt ? 'completed' : 'incomplete', withReceipt ? [4, 5] : [4]]],
      detached: [], functionName: toolName, markers: withReceipt ? [[5, 'current_function_marker']] : [] })),
    { name: 'historical MCP with only a typed failure from another environment',
      rows: [scopedCustom, historicalMcp(), typed({ ...historicalItem, environmentId: environment }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['mcp_call', 'completed', [4, 6]]], detached: [5],
      markers: [[5, 'historical_typed_marker'], [6, 'current_function_marker']] },
    ...[true, false].map(withTerminal => ({
      name: 'historical MCP beside duplicate scoped custom requests ' + (withTerminal ? 'retains its failure' : 'keeps its qualified name'),
      rows: [scopedCustom, historicalMcp('shell_command', 'mcp__notes'), scopedCustom,
        ...(withTerminal ? [typed({ ...historicalItem, tool: 'shell_command' })] : []), receipt, customReceipt],
      main: [['other_tool_call', 'incomplete', [3]], ['mcp_call', withTerminal ? 'failed' : 'completed', withTerminal ? [4, 6, 7] : [4, 6]],
        ['other_tool_call', 'incomplete', [5]]], detached: [withTerminal ? 8 : 7], functionName: 'mcp__notes__shell_command',
      markers: [...(withTerminal ? [[6, 'historical_typed_marker']] : []), [withTerminal ? 8 : 7, 'scoped_custom_marker']] })),
    { name: 'a verified patch end on the disputed custom channel leaves the historical MCP failure intact',
      rows: [scopedCustom, historicalMcp(), patch, patchEnd, typed(historicalItem), receipt, customReceipt],
      main: [['other_tool_call', 'incomplete', [3]], ['mcp_call', 'failed', [4, 7, 8]], ['other_tool_call', 'incomplete', [5]]],
      detached: [6, 9], markers: [[6, 'synthetic patch applied'], [7, 'historical_typed_marker'], [9, 'scoped_custom_marker']] },
    { name: 'historical MCP spelling with an exact independent dynamic completion',
      rows: [scopedCustom, historicalMcp('shell_command', 'mcp__notes'), typed({ type: 'DynamicToolCall', id: call_id,
        namespace: 'mcp__notes', tool: 'shell_command', status: 'failed', success: false, error: 'dynamic_failure_marker' }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['other_tool_call', 'failed', [4, 5, 6]]], detached: [],
      functionName: 'mcp__notes__shell_command', markers: [[5, 'dynamic_failure_marker']] },
    ...[true, false].flatMap(isTyped => [
      ['object key order', '{"a":[1,2],"b":{"x":0}}', { b: { x: 0 }, a: [1, 2] }, true],
      ['different nested value', '{"a":[1,2],"b":{"x":0}}', { b: { x: 1 }, a: [1, 2] }, false],
      ['different scalar', '"argument"', 'elsewhere', false],
      ['different array order', '[1,2]', [2, 1], false],
    ].map(([label, requested, recorded, matches]) => ({
      name: 'historical MCP ' + (isTyped ? 'typed' : 'legacy') + ' arguments with ' + label,
      rows: [scopedCustom, historicalMcp(undefined, undefined, requested), isTyped ? typed({ ...historicalItem, arguments: recorded })
        : historicalEnd(true, { invocation: { server: 'notes', tool: 'echo', arguments: recorded } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['mcp_call', matches ? 'failed' : 'completed', matches ? [4, 5, 6] : [4, 6]]],
      detached: matches ? [] : [5], markers: [[5, isTyped ? 'historical_typed_marker' : 'historical_legacy_marker']] }))),
    ...[true, false].map(foreignTyped => ({
      name: 'historical MCP arguments exclude the opposing ' + (foreignTyped ? 'typed' : 'legacy') + ' terminal',
      rows: [scopedCustom, historicalMcp(), typed({ ...historicalItem, arguments: foreignTyped ? { other: true } : {} }),
        historicalEnd(false, { invocation: { server: 'notes', tool: 'echo', arguments: foreignTyped ? {} : { other: true } } }), receipt, customReceipt],
      main: [['other_tool_call', 'completed', [3, 8]], ['mcp_call', foreignTyped ? 'success' : 'failed', [4, foreignTyped ? 6 : 5, 7]]],
      detached: [foreignTyped ? 5 : 6], markers: [[5, 'historical_typed_marker'], [6, 'historical_legacy_marker']] })),
    ...[
      ['invalid token', '!', false, true],
      ['trailing comma', '{"q":1,}', false, false],
      ['BOM alone', '\uFEFF', false, true],
      ['empty', '', true, true],
      ['whitespace', ' \t\n\u0085', true, false],
      ['JSON null', 'null', true, true],
    ].map(([label, args, accepts, withReceipt]) => ({
      name: 'historical MCP invocation parses ' + label,
      rows: [scopedCustom, historicalMcp('echo', 'mcp__notes', args), typed({ ...historicalItem, arguments: null }),
        historicalEnd(true, { invocation: { server: 'notes', tool: 'echo' } }), ...(withReceipt ? [receipt] : []), customReceipt],
      main: [['other_tool_call', 'completed', [3, withReceipt ? 8 : 7]],
        ['mcp_call', accepts ? 'failed' : withReceipt ? 'completed' : 'incomplete', [4, ...(accepts ? [5, 6] : []), ...(withReceipt ? [7] : [])]]],
      detached: accepts ? [] : [5, 6], functionName: 'mcp__notes__echo', markers: [[5, 'historical_typed_marker'], [6, 'historical_legacy_marker']] })),
    { name: 'historical MCP legacy invocation without recorded arguments keeps the typed failure',
      rows: [scopedCustom, historicalMcp(), typed(historicalItem), historicalEnd(true, { invocation: { server: 'notes', tool: 'echo' } }), customReceipt],
      main: [['other_tool_call', 'completed', [3, 7]], ['mcp_call', 'failed', [4, 5, 6]]], detached: [],
      markers: [[5, 'historical_typed_marker'], [6, 'historical_legacy_marker']] },
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
      if (scenario.functionName) {
        assert.equal(main[1].toolName, scenario.functionName);
        const hits = codex.query.getTimeline(index, session, { layer: 'main', q: scenario.functionName });
        assert.deepEqual(hits.events.filter(e => e.hasSearchHit).map(e => e.id), [main[1].id]);
      }
      assert.equal(indexed.counts.failedCommands, scenario.main.filter(([kind, status]) => kind === 'command' && status === 'failed').length);
      if (Object.hasOwn(scenario, 'commandExit')) assert.equal(main.find(e => e.kind === 'command').outputStats.exitCode, scenario.commandExit);
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
        assert.equal((await codex.readIndexedCodexRawRecord(index, session, raw)).raw, JSON.stringify(f.records[line - 1]));
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
  const stamp = (row, turn_id) => response({ ...row.payload, internal_chat_message_metadata_passthrough: { turn_id } });
  const scopedFunction = response({ type: 'function_call', call_id: 'shared', namespace: foreign, name: 'lookup', arguments: '{}' });
  const scopedResult = response({ type: 'function_call_output', call_id: 'shared', output: 'scoped function receipt' });
  const stampedExec = stamp(request('exec'), TURN);
  const foreignExecResult = stamp(result('exec', first), 'previous-turn');
  const currentExecResult = stamp(result('exec', second), TURN);
  const oldWait = stamp(response({ ...request('wait').payload, arguments: '{"cell_id":"g2:14","yield_time_ms":7314}' }), 'previous-turn');
  const scopedCustom = request('exec', foreign);
  const scopedCustomResult = result('exec', 'scoped custom receipt');
  const fragment = event({ type: 'task_started' });
  const localWait = stamp(response({ ...request('wait').payload, call_id: 'local-wait' }), TURN);
  const localWaitResult = stamp(response({ ...result('wait', second).payload, call_id: 'local-wait' }), TURN);
  const cases = [
    ...[false, true].map(conflict => {
      const commandEnd = (argv, code, text) => event({ type: 'exec_command_end', call_id: 'shared', source: 'agent',
        command: ['/bin/sh', '-c', argv], status: code ? 'failed' : 'completed', exit_code: code, aggregated_output: text });
      return { name: 'isolated custom exec leaves the independent command with ' + (conflict ? 'two plausible ends' : 'one matching end'),
        rows: [scopedCustom, request('exec'), response({ type: 'function_call', call_id: 'shared', name: 'shell_command', arguments: '{"command":"echo local"}' }),
          commandEnd(conflict ? 'echo local' : 'echo foreign', 0, first), commandEnd('echo local', 8, second),
          response({ type: 'function_call_output', call_id: 'shared', output: 'ordinary receipt' }), scopedCustomResult],
        main: [[3], [4], conflict ? [5, 8] : [5, 7, 8]], detached: conflict ? [6, 7, 9] : [6, 9],
        state: 'unknown', commandStatus: conflict ? 'completed' : 'failed', commandExit: conflict ? null : 8 };
    }),
    ...[true, false].map(withReceipt => ({ name: 'a foreign stamped native wait cannot reserve a current cell ' + (withReceipt ? 'with a receipt' : 'without a receipt'),
      rows: [...pending, scopedCustom, oldWait, ...(withReceipt ? [stamp(result('wait', first), 'previous-turn')] : []), scopedCustomResult,
        response({ ...request('wait').payload, call_id: 'local-wait' }), response({ ...result('wait', second).payload, call_id: 'local-wait' })],
      main: withReceipt ? [[3, 4, 9, 10], [5, 8], [6]] : [[3, 4, 8, 9], [5, 7], [6]], detached: withReceipt ? [7] : [],
      state: 'terminal', unpairedWait: 6, requestMarker: [6, '7314'] })),
    { name: 'a foreign stamped exec remains its own call-only operation', rows: [scopedFunction,
      stamp(request('exec'), 'previous-turn'), foreignExecResult, currentExecResult, scopedResult],
      main: [[3, 7], [4]], detached: [5, 6], state: 'unknown' },
    { name: 'matching wait and receipt stamps in a fragment without a recorded turn', initialTurn: event({ type: 'task_started' }),
      rows: [...pending, scopedCustom, oldWait, stamp(result('wait', first), 'previous-turn'), scopedCustomResult],
      main: [[3, 4, 6, 7], [5, 8]], detached: [], state: 'terminal' },
    ...['exec', 'receipt', 'both'].map(evidence => ({
      name: 'a fragment cell stamped on ' + evidence + ' excludes a wait from another turn', initialTurn: fragment,
      rows: [evidence === 'receipt' ? pending[0] : stamp(pending[0], TURN), evidence === 'exec' ? pending[1] : stamp(pending[1], TURN),
        scopedCustom, oldWait, stamp(result('wait', first), 'previous-turn'), scopedCustomResult, localWait, localWaitResult],
      main: [[3, 4, 9, 10], [5, 8], [6]], detached: [7], state: 'terminal', unpairedWait: 6, requestMarker: [6, '7314'],
    })),
    { name: 'a fragment cell accepts a wait stamped for its own turn', initialTurn: fragment,
      rows: [stamp(pending[0], TURN), stamp(pending[1], TURN), scopedCustom, stamp(request('wait'), TURN),
        stamp(result('wait', first), TURN), scopedCustomResult, localWait, localWaitResult],
      main: [[3, 4, 6, 7], [5, 8], [9, 10]], detached: [], state: 'terminal' },
    { name: 'a fragment cell distinguishes receipts on an unstamped wait before counting them', initialTurn: fragment,
      rows: [stamp(pending[0], TURN), pending[1], scopedCustom, request('wait'), stamp(result('wait', first), 'previous-turn'),
        stamp(result('wait', second), TURN), scopedCustomResult],
      main: [[3, 4, 6, 8], [5, 9]], detached: [7], state: 'terminal' },
    { name: 'an accepted pending wait can supply the turn of a fragment cell', initialTurn: fragment,
      rows: [...pending, response({ ...request('wait').payload, call_id: 'poll' }),
        stamp(response({ type: 'function_call_output', call_id: 'poll', output: 'Script running with cell ID g2:14' }), TURN),
        scopedCustom, oldWait, stamp(result('wait', first), 'previous-turn'), scopedCustomResult, localWait, localWaitResult],
      main: [[3, 4, 5, 6, 11, 12], [7, 10], [8]], detached: [9], state: 'terminal', unpairedWait: 8, requestMarker: [8, '7314'] },
    { name: 'a wait outside a scoped ID collision retains ordinary pairing',
      rows: [...pending, oldWait, stamp(result('wait', first), 'previous-turn')],
      main: [[3, 4, 5, 6]], detached: [], state: 'terminal' },
    { name: 'a foreign stamped exec receipt beside a scoped function', rows: [scopedFunction, stampedExec, foreignExecResult, scopedResult],
      main: [[3, 6], [4]], detached: [5], state: 'unknown' },
    { name: 'a current stamped exec receipt beside a scoped function', rows: [scopedFunction, stampedExec, currentExecResult, scopedResult],
      main: [[3, 6], [4, 5]], detached: [], state: 'terminal' },
    ...[false, true].map(reverse => ({ name: 'current and foreign stamped exec receipts, foreign ' + (reverse ? 'last' : 'first'),
      rows: [scopedFunction, stampedExec, ...(reverse ? [currentExecResult, foreignExecResult] : [foreignExecResult, currentExecResult]), scopedResult],
      main: [[3, 7], [4, reverse ? 5 : 6]], detached: [reverse ? 6 : 5], state: 'terminal' })),
    { name: 'two current stamped exec receipts beside a scoped function', rows: [scopedFunction, stampedExec,
      stamp(result('exec', first), TURN), currentExecResult, scopedResult],
      main: [[3, 7], [4]], detached: [5, 6], state: 'unknown' },
    { name: 'current and foreign stamped native wait receipts beside a scoped custom tool',
      rows: [...pending, request('exec', foreign), stamp(request('wait'), TURN),
        stamp(result('wait', first), 'previous-turn'), stamp(result('wait', second), TURN), result('exec', 'scoped custom receipt')],
      main: [[3, 4, 6, 8], [5, 9]], detached: [7], state: 'terminal' },
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
  for (const scenario of cases) await t.test(scenario.name, async (t) => {
    const f = await fixture(t, scenario.rows, scenario.initialTurn);
    const resident = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
    const compact = await codex.buildIndex(f.options);
    const cold = await codex.buildSourceBackedIndex(f.options);
    const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: cold });
    assert.equal(warm.totals.reusedFileCount, 1);
    for (const index of [resident, compact, cold, warm]) {
      const indexed = index.sessionsById.get(ID);
      const session = index === cold || index === warm ? await materializeSessionForIndex(index, indexed) : indexed;
      const main = session.logicalEvents.filter(e => e.layer === 'main').sort((a, b) => a.rawRefs[0].line - b.rawRefs[0].line);
      assert.equal(session.counts.toolCalls, scenario.main.length);
      assert.deepEqual(main.map(e => e.rawRefs.map(r => r.line)), scenario.main);
      assert.equal(new Set(main.map(e => e.id)).size, main.length);
      const operations = main.filter(e => e.kind === 'code_mode_operation');
      assert.equal(operations.length, 1);
      assert.equal(operations[0].codeModeOperation.observationState, scenario.state);
      if (scenario.unpairedWait) {
        const wait = main.find(e => e.rawRefs[0].line === scenario.unpairedWait);
        assert.deepEqual([wait.kind, wait.status], ['other_tool_call', 'incomplete']);
      }
      if (scenario.commandStatus) assert.equal(main.find(e => e.kind === 'command').status, scenario.commandStatus);
      if ('commandExit' in scenario) assert.equal(main.find(e => e.kind === 'command').outputStats?.exitCode ?? null, scenario.commandExit);
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
        const marker = line === scenario.requestMarker?.[0] ? scenario.requestMarker[1]
          : [first, second].find(word => (record.payload.output || record.payload.aggregated_output)?.includes(word));
        if (!marker) continue;
        for (const event of isDetached ? [...main, owner] : main) {
          const detail = await codex.buildHydratedEventDetail(index, session, event.id, event.layer);
          assert.equal(JSON.stringify(detail).includes(marker), event.id === owner.id, marker);
        }
        for (const layer of ['protocol', 'main']) {
          const hits = codex.query.getTimeline(index, session, { layer, q: marker });
          assert.deepEqual(hits.events.filter(e => e.hasSearchHit).map(e => e.id), layer === owner.layer ? [owner.id] : []);
        }
      }
    }
  });
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
