'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { additionalToolsSummary } = require('../src/codex-turn-items');

// Synthetic rollout-shaped evidence pinned to rust-v0.162.0 protocol/items.rs,
// protocol/protocol.rs and rollout/policy.rs; no real transcript data.
const ID = 'aaaaaaaa-0162-4162-9162-aaaaaaaaaaaa';
const TURN = 'compatibility-turn';
const MARKER = '\n... command output truncated for persistence ...\n';
const event = (payload) => ({ type: 'event_msg', payload });
const response = (payload) => ({ type: 'response_item', payload });
const typed = (item, turn = TURN, thread = ID) => event({ type: 'item_completed', thread_id: thread, turn_id: turn, item });
const command = (id, fields = {}) => typed({ type: 'CommandExecution', id, command: ['echo', id], status: 'completed', exit_code: 0, aggregated_output: 'recorded output', ...fields });
const spawn = (id, child = 'child') => [response({ type: 'function_call', call_id: id, name: 'spawn_agent', arguments: JSON.stringify({ model: 'requested-model', reasoning_effort: 'high' }) }), response({ type: 'function_call_output', call_id: id, output: JSON.stringify({ agent_id: child }) })];
const started = (id, fields = {}) => event({ type: 'sub_agent_activity', event_id: id, kind: 'started', agent_thread_id: 'child', agent_path: '/root/task', model: 'resolved-model', reasoning_effort: 'medium', ...fields });

async function fixture(t, rows) {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0162-'));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const root = path.join(codexHome, 'sessions');
  await fs.mkdir(repoRoot);
  await fs.mkdir(root);
  const records = [{ type: 'session_meta', payload: { id: ID, cwd: repoRoot, cli_version: '0.100.0' } }, event({ type: 'task_started', turn_id: TURN }), ...rows].map((row, i) => ({ timestamp: new Date(Date.parse('2026-10-14T10:00:00Z') + i * 1000).toISOString(), ...row }));
  const file = path.join(root, `rollout-${ID}.jsonl`);
  await fs.writeFile(file, records.map(JSON.stringify).join('\n') + '\n');
  return { file, records, options: { codexHome, repoRoot } };
}

async function sessionFor(index, build) {
  const session = index.sessionsById.get(ID);
  return build === codex.buildSourceBackedIndex ? materializeSessionForIndex(index, session) : session;
}

test('0.162 recorded outputs, startup settings and tool definitions preserve layers, searches and exact Raw', async (t) => {
  const output = 'head-' + 'x'.repeat(64000) + MARKER + '-command-tail';
  const f = await fixture(t, [command('combined', { aggregated_output: output }),
    typed({ type: 'McpToolCall', id: 'mcp', server: 'fixture', tool: 'lookup', status: 'completed', result: { content: [{ type: 'text', text: '{"preview":"…456 chars truncated…"} mcp-tail' }], isError: true } }),
    ...spawn('spawn'), started('spawn'),
    response({ type: 'additional_tools', role: 'developer', tools: [{ type: 'namespace', name: 'nested', tools: [{ type: 'function', name: 'lookup', parameters: { description: 'schema-tail' } }] }, { type: 'future', name: 'unknown-name', opaque: 'unknown-tail' }, null] }),
    { type: 'turn_context', payload: { turn_id: TURN, model: 'parent-model', summary: 'none' } },
  ]);
  for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    const session = await sessionFor(index, build);
    assert.equal(session.counts.toolCalls, 3);
    assert.equal(session.counts.userMessages, 0);
    const main = session.logicalEvents.filter((e) => e.layer === 'main');
    assert.equal(main.length, 3);
    const cmd = main.find((e) => e.kind === 'command');
    const mcp = main.find((e) => e.kind === 'mcp_call');
    const coord = main.find((e) => e.toolName === 'spawn_agent');
    assert.equal(mcp.status, 'failed');
    assert.equal(coord.rawRefs.length, 3);
    for (const q of ['command-tail', 'mcp-tail', 'resolved-model']) assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q }).searchEventCount, 1, q);
    assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'schema-tail' }).searchEventCount, 0);
    assert.equal(codex.query.getTimeline(index, session, { layer: 'protocol', q: 'schema-tail' }).searchEventCount, 1);
    assert.equal(codex.query.getTimeline(index, session, { layer: 'raw', q: 'unknown-tail' }).searchEventCount, 1);
    for (const locale of ['en', 'zh-CN']) {
      const detail = await codex.buildHydratedEventDetail(index, session, cmd.id, 'main', { locale });
      const terminal = detail.timelineSections.find((s) => s.type === 'terminal');
      assert.equal(terminal.stream, 'output');
      assert.equal(terminal.title, locale === 'en' ? 'Combined output' : '合并输出');
      assert.ok(detail.timelineSections.some((s) => s.type === 'notice'));
      const mcpDetail = await codex.buildHydratedEventDetail(index, session, mcp.id, 'main', { locale });
      assert.ok(mcpDetail.timelineSections.some((s) => s.type === 'notice'));
      const coordDetail = await codex.buildHydratedEventDetail(index, session, coord.id, 'main', { locale });
      const fields = coordDetail.timelineSections.find((s) => s.type === 'collaboration').fields;
      assert.ok(fields.some((field) => field.value === 'requested-model'));
      assert.ok(fields.some((field) => field.value === 'resolved-model'));
      assert.ok(coordDetail.inspectorSections.some((s) => s.title === (locale === 'en' ? 'Recorded subagent activity' : '已记录的子代理活动')));
      const tools = session.logicalEvents.find((e) => e.subtype === 'additional_tools');
      const toolDetail = await codex.buildHydratedEventDetail(index, session, tools.id, 'protocol', { locale });
      assert.match(JSON.stringify(toolDetail.timelineSections), /nested.lookup/);
      assert.ok(!JSON.stringify(toolDetail.timelineSections).includes('unknown-name'));
    }
    for (const raw of session.rawEvents) assert.deepEqual((await codex.readRawLine(index, raw.source.file, raw.source.line)).parsed, f.records[raw.source.line - 1]);
    const warm = await build({ ...f.options, previousIndex: index });
    if (build !== codex.__testOnly.buildUncompactedIndexForDetailTests) assert.equal(warm.totals.reusedFileCount, 1);
    const warmSession = await sessionFor(warm, build);
    assert.equal(warmSession.counts.toolCalls, 3);
    assert.equal(codex.query.getTimeline(warm, warmSession, { layer: 'main', q: 'resolved-model' }).searchEventCount, 1);
    assert.deepEqual((await codex.buildHydratedEventDetail(warm, warmSession, cmd.id, 'main', { locale: 'en' })).timelineSections,
      (await codex.buildHydratedEventDetail(index, session, cmd.id, 'main', { locale: 'en' })).timelineSections);
  }
  const before = await codex.buildSourceBackedIndex(f.options);
  await fs.appendFile(f.file, JSON.stringify({ timestamp: '2026-10-14T10:01:00Z', ...command('append') }) + '\n');
  const appended = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: before });
  assert.equal((await sessionFor(appended, codex.buildSourceBackedIndex)).counts.toolCalls, 4);
});

test('only exact source result fields establish truncation markers; legacy separate streams avoid aggregate duplicates', async (t) => {
  const f = await fixture(t, [command('wrong-field', { aggregated_output: 'complete', stdout: MARKER }),
    event({ type: 'exec_command_end', call_id: 'legacy', command: ['echo', 'legacy'], stdout: '', stderr: 'stderr-only', aggregated_output: 'stderr-only', exit_code: 1 }),
    typed({ type: 'McpToolCall', id: 'json', server: 'fixture', tool: 'lookup', status: 'completed', arguments: { query: '…12 chars truncated…' }, result: { content: [{ type: 'text', text: '{"plain":true}' }], isError: false } }),
    response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: MARKER }] }),
  ]);
  const index = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
  const session = index.sessionsById.get(ID);
  for (const e of session.logicalEvents.filter((e) => e.layer === 'main')) {
    const detail = await codex.buildHydratedEventDetail(index, session, e.id, 'main', { locale: 'en' });
    assert.ok(!JSON.stringify(detail.timelineSections).includes('Original output length is unknown'));
    assert.ok(!JSON.stringify(detail.timelineSections).includes('The truncation stage'));
    if (e.rawRefs.some((ref) => ref.line === 4)) {
      const terminals = detail.timelineSections.filter((s) => s.type === 'terminal');
      assert.equal(terminals.length, 1);
      assert.equal(terminals[0].stream, 'stderr');
    }
  }
});

test('ambiguous, conflicting and non-started activity never supplies resolved settings', async (t) => {
  const rows = [];
  for (const [id, activities] of [
    ['wrong-child', [started('wrong-child', { agent_thread_id: 'other-child' })]],
    ['duplicate', [started('duplicate'), started('duplicate')]],
    ['other-kind', [started('other-kind', { kind: 'completed' })]],
    ['null', [started('null', { model: null, reasoning_effort: null })]],
    ['oversize', [started('oversize', { model: 'z'.repeat(513) })]],
    ['foreign', [started('foreign', { thread_id: 'foreign-thread' })]],
    ['cross-turn', [typed({ type: 'SubAgentActivity', id: 'cross-turn', kind: 'started', agent_thread_id: 'child', model: 'resolved-model' }, 'different-turn')]],
  ]) rows.push(...spawn(id), ...activities);
  const conflictingOutput = spawn('conflicting-output-ids');
  conflictingOutput[1].payload.output = JSON.stringify({ agent_id: 'child', new_thread_id: 'different-child' });
  rows.push(...conflictingOutput, started('conflicting-output-ids'));
  const f = await fixture(t, rows);
  const index = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
  const session = index.sessionsById.get(ID);
  for (const e of session.logicalEvents.filter((e) => e.toolName === 'spawn_agent')) {
    const detail = await codex.buildHydratedEventDetail(index, session, e.id, 'main', { locale: 'en' });
    const fields = detail.timelineSections.find((s) => s.type === 'collaboration').fields;
    assert.ok(!fields.some((field) => field.key === 'Resolved startup model'));
    assert.ok(!e.searchText.includes('resolved-model'));
  }
  assert.ok(session.logicalEvents.some((e) => e.layer === 'protocol' && e.preview.includes('SubAgentActivity')) || session.logicalEvents.some((e) => e.layer === 'protocol'));
});

test('additional tool summaries bound supported definitions and retain malformed fallback', () => {
  const summary = additionalToolsSummary({ type: 'additional_tools', role: 'developer', tools: Array.from({ length: 500 }, (_, i) => ({ type: 'function', name: `tool-${i}`, parameters: { huge: 'x'.repeat(2000) } })) });
  assert.equal(summary.names.length, 24);
  assert.equal(summary.shortened, true);
  assert.ok(summary.count <= 256);
  assert.equal(additionalToolsSummary({ type: 'additional_tools', role: 'developer', tools: {} }).valid, false);
  assert.ok(additionalToolsSummary({ type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'x'.repeat(161) }] }).names[0].endsWith('…'));
});

test('startup search redacts opaque data URLs and unknown additional-tools envelopes remain generic', async (t) => {
  const opaque = 'OPAQUE_STARTUP_BYTES';
  const f = await fixture(t, [...spawn('media'), started('media', { model: `data:image/png;base64,${opaque}`, agent_path: 'unadmitted-path' }),
    event({ type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'unknown-envelope-tool' }] })]);
  for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    const session = await sessionFor(index, build);
    const owner = session.logicalEvents.find((e) => e.toolName === 'spawn_agent');
    assert.ok(!owner.searchText.includes(opaque));
    assert.ok(!owner.searchText.includes('unadmitted-path'));
    assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: opaque }).searchEventCount, 0);
    const unknown = session.logicalEvents.find((e) => e.subtype === 'additional_tools');
    const detail = await codex.buildHydratedEventDetail(index, session, unknown.id, 'protocol', { locale: 'en' });
    assert.ok(!JSON.stringify(detail.timelineSections).includes('Top-level definition entries'));
    assert.match(JSON.stringify(detail.inspectorSections), /unknown-envelope-tool/);
    const raw = session.rawEvents.find((r) => r.source.line === 5);
    assert.equal((await codex.readRawLine(index, raw.source.file, raw.source.line)).parsed.payload.model, `data:image/png;base64,${opaque}`);
  }
});

test('late typed startup append and warm reuse admit settings identically; malformed declarations remain searchable Protocol', async (t) => {
  const f = await fixture(t, [...spawn('late'), response({ type: 'additional_tools', role: 'developer', tools: { malformed: 'malformed-search-tail' } }),
    { type: 'turn_context', payload: { turn_id: TURN } },
    { type: 'turn_context', payload: { turn_id: TURN, summary: 'none' } }]);
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const cold = await build(f.options);
    const initial = await sessionFor(cold, build);
    assert.equal(codex.query.getTimeline(cold, initial, { layer: 'main', q: 'resolved-model' }).searchEventCount, 0);
    const declaration = initial.logicalEvents.find((e) => e.subtype === 'additional_tools');
    const detail = await codex.buildHydratedEventDetail(cold, initial, declaration.id, 'protocol', { locale: 'en' });
    assert.match(JSON.stringify(detail.inspectorSections), /malformed-search-tail/);
    assert.equal(codex.query.getTimeline(cold, initial, { layer: 'protocol', q: 'malformed-search-tail' }).searchEventCount, 1);
    for (const context of initial.logicalEvents.filter((e) => e.subtype === 'turn_context')) {
      const contextDetail = await codex.buildHydratedEventDetail(cold, initial, context.id, 'protocol', { locale: 'en' });
      assert.match(JSON.stringify(contextDetail), /compatibility-only evidence/);
      assert.ok(!JSON.stringify(contextDetail).includes('effective setting'));
    }
    const activity = started('late').payload;
    const { type, event_id, ...fields } = activity;
    await fs.appendFile(f.file, JSON.stringify({ timestamp: '2026-10-14T10:01:00Z', ...typed({ type: 'SubAgentActivity', id: event_id, ...fields }) }) + '\n');
    const appended = await build({ ...f.options, previousIndex: cold });
    const session = await sessionFor(appended, build);
    assert.equal(session.counts.toolCalls, 1);
    const owner = session.logicalEvents.find((e) => e.toolName === 'spawn_agent');
    assert.equal(owner.rawRefs.length, 3);
    assert.equal(codex.query.getTimeline(appended, session, { layer: 'main', q: 'resolved-model' }).searchEventCount, 1);
    assert.match(JSON.stringify((await codex.buildHydratedEventDetail(appended, session, owner.id, 'main', { locale: 'en' })).timelineSections), /Resolved startup model/);
    const warm = await build({ ...f.options, previousIndex: appended });
    assert.equal(codex.query.getTimeline(warm, await sessionFor(warm, build), { layer: 'main', q: 'resolved-model' }).searchEventCount, 1);
    // Remove only our synthetic appended row before running the other index route.
    await fs.writeFile(f.file, f.records.map(JSON.stringify).join('\n') + '\n');
  }
});

test('Code Mode preserves nested command link and owning detail truncation evidence', async (t) => {
  const f = await fixture(t, [response({ type: 'custom_tool_call', name: 'exec', call_id: 'outer', turn_id: TURN,
    input: "const result = await tools.shell_command({command: 'echo synthetic'}); text(result);" }),
    response({ type: 'function_call', name: 'shell_command', call_id: 'nested', turn_id: TURN, parent_call_id: 'outer', arguments: JSON.stringify({ command: 'echo synthetic' }) }),
    command('nested', { aggregated_output: 'head' + MARKER + 'tail' }),
    response({ type: 'custom_tool_call_output', call_id: 'outer', turn_id: TURN, output: 'Script completed\nOutput:\nhead' + MARKER + 'tail' })]);
  const index = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
  const session = index.sessionsById.get(ID);
  const operation = session.logicalEvents.find((e) => e.kind === 'code_mode_operation');
  const detail = await codex.buildHydratedEventDetail(index, session, operation.id, 'main', { locale: 'en' });
  const nested = session.logicalEvents.find((e) => e.kind === 'command');
  assert.ok(detail.inspectorSections.some((section) => section.type === 'event_refs' && section.items.some((item) => item.id === nested.id)));
  const nestedDetail = await codex.buildHydratedEventDetail(index, session, nested.id, 'main', { locale: 'en' });
  assert.match(JSON.stringify(nestedDetail), /Recorded aggregated output contains the Codex persistence truncation marker/);
  assert.equal(nestedDetail.timelineSections.find((section) => section.type === 'terminal').stream, 'output');
});
