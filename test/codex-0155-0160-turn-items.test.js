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

async function fixture(t, rows) {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0160-typed-'));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const root = path.join(codexHome, 'sessions');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(repoRoot);
  const records = [{ type: 'session_meta', payload: { id: ID, cwd: repoRoot } },
    event({ type: 'task_started', turn_id: TURN }), ...rows].map((row, i) => ({
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
          assert.equal(foreign.kind, completion === 'valid' ? 'mcp_call' : 'other_tool_call');
          assert.equal(foreign.status, completion === 'valid' ? 'failed' : 'completed');
          const outputLine = f.records.length;
          assert.deepEqual(foreign.rawRefs.map(r => r.line), completion === 'valid' ? [5, 6, 7] : [5, outputLine]);
          const owners = [operation, foreign];
          if (completion.startsWith('conflicting')) {
            const protocol = session.logicalEvents.find(e => e.layer === 'protocol' && e.rawRefs.some(r => r.line === 6));
            assert.deepEqual(protocol.rawRefs.map(r => r.line), [6]);
            owners.push(protocol);
          }
          for (const owner of owners) {
            for (const ref of owner.rawRefs) {
              const raw = session.rawEvents.find(r => r.rawId === ref.rawId);
              const readback = await codex.readIndexedCodexRawRecord(index, session, raw);
              assert.deepEqual(JSON.parse(readback.raw), f.records[ref.line - 1]);
            }
          }
          const hits = codex.query.getTimeline(index, session, { layer: 'main', q: marker });
          assert.equal(hits.searchEventCount, 1);
          assert.equal(hits.events.find(e => e.hasSearchHit).id, foreign.id);
          const detail = await codex.buildHydratedEventDetail(index, session, operation.id, 'main');
          assert.equal(JSON.stringify(detail).includes(marker), false);
          const foreignDetail = await codex.buildHydratedEventDetail(index, session, foreign.id, 'main');
          assert.equal(foreignDetail.meta.status, foreign.status);
          assert.ok(JSON.stringify(foreignDetail).includes(marker));
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
    make('collision', 'notes', 'echo', { type: 'mcp_tool_call_end',
      invocation: { server: 'notes', tool: 'echo', environment_id: 'other' } }),
  ];
  for (const conflict of [{ name: 'different' }, { namespace: 'functions' }]) {
    const rows = make('output-' + Object.keys(conflict)[0], 'notes', 'echo');
    Object.assign(rows.at(-1).payload, conflict);
    cases.push(rows);
  }
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
