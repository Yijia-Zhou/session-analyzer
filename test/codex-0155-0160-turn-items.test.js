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
