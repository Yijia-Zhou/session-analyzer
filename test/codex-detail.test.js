'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildEventDetail, buildIndex } = require('../src/codex');
const { createCodexDetailBuilder } = require('../src/codex-detail');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';

async function buildFixtureSession() {
  const index = await buildIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
  });
  return index.sessionsById.get(primaryFixtureSessionId);
}

function sectionTypes(detail) {
  return {
    timeline: detail.timelineSections.map((section) => section.type),
    inspector: detail.inspectorSections.map((section) => section.type),
  };
}

async function makeTempCodexHome(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-detail-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeTranscript(codexHome, cwd, id, records) {
  const dir = path.join(codexHome, 'sessions', '2026', '06', '12');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-06-12T10-00-00-${id}.jsonl`);
  await fsp.writeFile(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
}

test('codex detail module exports the detail builder factory', () => {
  assert.deepEqual(Object.keys(require('../src/codex-detail')), ['createCodexDetailBuilder']);
  assert.equal(typeof createCodexDetailBuilder, 'function');
});

test('raw detail keeps canonical source and traceability fields', async () => {
  const session = await buildFixtureSession();
  const raw = session.rawEvents.find((candidate) => candidate.rawId);
  const detail = buildEventDetail(session, raw.rawId, 'raw');

  assert.equal(detail.schemaVersion, 1);
  assert.equal(detail.sourceKind, 'codex');
  assert.equal(detail.layer, 'raw');
  assert.equal(detail.sourceRecordType, raw.recordType);
  assert.equal(detail.sourceEventType, raw.payloadType);
  assert.deepEqual(detail.sourceLocator, { type: 'jsonl_line', file: raw.source.file.replace(/\\/g, '/'), line: raw.source.line });
  assert.deepEqual(detail.rawRefs, [{
    rawId: raw.rawId,
    file: raw.source.file,
    line: raw.source.line,
    sourceLocator: { type: 'jsonl_line', file: raw.source.file.replace(/\\/g, '/'), line: raw.source.line },
    sourceRecordType: raw.recordType || '',
    sourceEventType: raw.payloadType || '',
  }]);
});

test('logical detail keeps source locator, meta, and raw refs without aggregate source row fields', async () => {
  const session = await buildFixtureSession();
  const event = session.logicalEvents.find((candidate) => candidate.kind === 'command');
  const detail = buildEventDetail(session, event.id, event.layer);

  assert.equal(detail.schemaVersion, 1);
  assert.equal(detail.sourceKind, 'codex');
  assert.deepEqual(detail.sourceLocator, event.sourceLocator);
  assert.deepEqual(detail.rawRefs, event.rawRefs);
  assert.ok(detail.meta);
  assert.equal(Object.hasOwn(detail, 'sourceRecordType'), false);
  assert.equal(Object.hasOwn(detail, 'sourceEventType'), false);
});

test('command, patch, and tool details keep stable section type boundaries', async () => {
  const session = await buildFixtureSession();
  const command = session.logicalEvents.find((candidate) => candidate.kind === 'command');
  const patch = session.logicalEvents.find((candidate) => candidate.kind === 'patch');
  const tool = session.logicalEvents.find((candidate) => candidate.kind === 'other_tool_call' && candidate.toolName === 'update_plan');

  assert.deepEqual(sectionTypes(buildEventDetail(session, command.id, command.layer)), {
    timeline: ['code', 'terminal', 'terminal'],
    inspector: ['kv', 'json'],
  });
  assert.deepEqual(sectionTypes(buildEventDetail(session, patch.id, patch.layer)), {
    timeline: ['patch'],
    inspector: ['kv', 'notice'],
  });
  assert.deepEqual(sectionTypes(buildEventDetail(session, tool.id, tool.layer)), {
    timeline: ['plan_update', 'code'],
    inspector: ['kv', 'json'],
  });
});

test('mcp call detail shows structured timeline summary instead of raw preview fallback', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'abababab-3333-4444-8888-abababababab';
  await writeTranscript(codexHome, repoRoot, id, [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:01.000Z',
      payload: {
        type: 'mcp_tool_call_begin',
        call_id: 'call-mcp-js',
        tool_name: 'js',
        arguments: { code: "nodeRepl.write('ok');", title: 'Smoke' },
        status: 'in_progress',
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'mcp_tool_call_end',
        call_id: 'call-mcp-js',
        tool_name: 'js',
        result: [{ type: 'text', text: 'ok' }],
        status: 'success',
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = Array.from(index.sessionsById.values()).find((candidate) => candidate.id === id);
  const event = session.logicalEvents.find((candidate) => candidate.kind === 'mcp_call' && candidate.toolName === 'js');
  const detail = buildEventDetail(session, event.id, event.layer);

  assert.deepEqual(detail.timelineSections.map((section) => section.title), ['JavaScript', 'Request', 'Result']);
  assert.equal(detail.timelineSections[0].type, 'code');
  assert.equal(detail.timelineSections[0].language, 'javascript');
  assert.match(detail.timelineSections[0].code, /nodeRepl\.write/);
  assert.equal(detail.timelineSections[2].type, 'terminal');
  assert.match(detail.timelineSections[2].text, /ok/);
  assert.deepEqual(detail.inspectorSections.map((section) => section.title), ['Tool context', 'Request', 'Response']);
});
test('mcp non-text result omits bare payload bytes from timeline summary', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'cdcdcdcd-3333-4444-8888-cdcdcdcdcdcd';
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  await writeTranscript(codexHome, repoRoot, id, [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:01.000Z',
      payload: {
        type: 'mcp_tool_call_begin',
        call_id: 'call-mcp-image',
        tool_name: 'render_preview',
        arguments: { prompt: 'render a preview' },
        status: 'in_progress',
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'mcp_tool_call_end',
        call_id: 'call-mcp-image',
        tool_name: 'render_preview',
        result: [{ type: 'image', data: pngBase64, mimeType: 'image/png' }],
        status: 'success',
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = Array.from(index.sessionsById.values()).find((candidate) => candidate.id === id);
  const event = session.logicalEvents.find((candidate) => candidate.kind === 'mcp_call' && candidate.toolName === 'render_preview');
  const detail = buildEventDetail(session, event.id, event.layer);
  const timelineJson = JSON.stringify(detail.timelineSections);

  assert.equal(timelineJson.includes(pngBase64), false);
  assert.match(timelineJson, /non-text MCP payload omitted/);
  assert.deepEqual(detail.inspectorSections.map((section) => section.title), ['Tool context', 'Request', 'Response']);
});

test('mcp typed error result stays visible in timeline fallback summary', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'efefefef-3333-4444-8888-efefefefefef';
  await writeTranscript(codexHome, repoRoot, id, [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:01.000Z',
      payload: {
        type: 'mcp_tool_call_begin',
        call_id: 'call-mcp-error',
        tool_name: 'lookup',
        arguments: { query: 'missing' },
        status: 'in_progress',
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'mcp_tool_call_end',
        call_id: 'call-mcp-error',
        tool_name: 'lookup',
        result: { type: 'error', message: 'lookup failed', status: 'failed' },
        status: 'failed',
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = Array.from(index.sessionsById.values()).find((candidate) => candidate.id === id);
  const event = session.logicalEvents.find((candidate) => candidate.kind === 'mcp_call' && candidate.toolName === 'lookup');
  const detail = buildEventDetail(session, event.id, event.layer);
  const timelineJson = JSON.stringify(detail.timelineSections);

  assert.match(timelineJson, /lookup failed/);
  assert.match(timelineJson, /failed/);
  assert.doesNotMatch(timelineJson, /non-text MCP payload omitted/);
});

test('mcp text resources and structured data stay visible in timeline summary', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'fdfdfdfd-3333-4444-8888-fdfdfdfdfdfd';
  await writeTranscript(codexHome, repoRoot, id, [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:01.000Z',
      payload: {
        type: 'mcp_tool_call_begin',
        call_id: 'call-mcp-resource',
        tool_name: 'resource_lookup',
        arguments: { path: 'README.md' },
        status: 'in_progress',
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'mcp_tool_call_end',
        call_id: 'call-mcp-resource',
        tool_name: 'resource_lookup',
        result: [
          { type: 'resource', mimeType: 'text/plain', text: 'plain text resource' },
          { type: 'result', data: { message: 'structured data result', status: 'complete' } },
        ],
        status: 'success',
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = Array.from(index.sessionsById.values()).find((candidate) => candidate.id === id);
  const event = session.logicalEvents.find((candidate) => candidate.kind === 'mcp_call' && candidate.toolName === 'resource_lookup');
  const detail = buildEventDetail(session, event.id, event.layer);
  const timelineJson = JSON.stringify(detail.timelineSections);

  assert.match(timelineJson, /plain text resource/);
  assert.match(timelineJson, /structured data result/);
  assert.match(timelineJson, /complete/);
  assert.doesNotMatch(timelineJson, /non-text MCP payload omitted/);
});
test('detail sections replace embedded data URLs with markers', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  await writeTranscript(codexHome, repoRoot, id, [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:01.000Z',
      payload: {
        type: 'dynamic_tool_call_begin',
        call_id: 'call-dynamic-image',
        tool_name: 'asset_lookup',
        request: { query: 'image', image_url: 'data:image/png;base64,request-secret' },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'dynamic_tool_call_end',
        call_id: 'call-dynamic-image',
        tool_name: 'asset_lookup',
        result: { image_url: 'data:image/png;base64,result-secret', count: 1 },
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = Array.from(index.sessionsById.values()).find((candidate) => candidate.id === id);
  const event = session.logicalEvents.find((candidate) => candidate.kind === 'other_tool_call' && candidate.toolName === 'asset_lookup');
  const detail = buildEventDetail(session, event.id, event.layer);
  const serialized = JSON.stringify([detail.timelineSections, detail.inspectorSections]);

  assert.doesNotMatch(serialized, /data:image\/png;base64/);
  assert.match(serialized, /embedded data URL omitted|data URL omitted|embedded image payload externalized/);
});

test('Code Mode detail prioritizes command and final output while folding wait trace into secondary detail', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-detail', turn_id: 'turn-code', input: 'const value = await tools.fixture(); text(value);' } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:02.000Z', payload: { type: 'custom_tool_call_output', call_id: 'exec-detail', turn_id: 'turn-code', output: 'Script running with cell ID 4242\nLive output:' } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:03.000Z', payload: { type: 'function_call', name: 'wait', call_id: 'wait-detail', turn_id: 'turn-code', arguments: '{"cell_id":"4242"}' } },
    { type: 'event_msg', timestamp: '2026-06-12T10:00:04.000Z', payload: { type: 'mcp_tool_call_end', call_id: 'nested-detail', turn_id: 'turn-code', tool_name: 'fixture_lookup', status: 'failed' } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:05.000Z', payload: { type: 'function_call_output', call_id: 'wait-detail', turn_id: 'turn-code', output: 'Script completed\nfixture result' } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.toolName === 'fixture_lookup');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });

  assert.deepEqual(detail.rawRefs.map((ref) => ref.line), [2, 3, 4, 6]);
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['code', 'terminal', 'code_mode_trace']);
  assert.deepEqual(detail.timelineSections.map((section) => section.title), ['Command', 'Final output', 'Execution trace']);
  assert.equal(detail.timelineSections[0].role, 'command');
  assert.match(detail.timelineSections[0].code, /tools\.fixture/);
  assert.equal(detail.timelineSections[1].text, 'Script completed\nfixture result');
  assert.equal(detail.timelineSections[2].expanded, undefined);
  assert.deepEqual(detail.timelineSections[2].phases.map((phase) => phase.title), ['Exec phase', 'Wait phase 1']);
  assert.match(detail.timelineSections[2].phases[0].output, /Script running with cell ID 4242/);
  assert.equal(detail.timelineSections[2].phases[1].output, '');
  assert.deepEqual(detail.inspectorSections[0], {
    type: 'kv',
    title: 'Operation metadata',
    entries: [
      { key: 'Evidence', value: 'output_observed' },
      { key: 'Observation', value: 'terminal' },
      { key: 'Cell', value: '4242' },
      { key: 'Poll count', value: '1' },
    ],
  });
  assert.deepEqual(detail.inspectorSections[1], {
    type: 'event_refs',
    title: 'Observed nested activity',
    items: [{ id: nested.id, label: 'MCP tool', kind: 'mcp_call', status: 'failed' }],
  });
  assert.equal(Object.hasOwn(detail, 'eventRefs'), false);
  assert.deepEqual(chineseDetail.timelineSections.map((section) => section.title), ['执行命令', '最终输出', '执行过程']);
  assert.deepEqual(chineseDetail.timelineSections[2].phases.map((phase) => phase.title), ['执行阶段', '等待阶段 1']);
  assert.deepEqual(chineseDetail.inspectorSections[0].entries, [
    { key: '证据状态', value: 'output_observed' },
    { key: '观测状态', value: 'terminal' },
    { key: '运行单元', value: '4242' },
    { key: '轮询次数', value: '1' },
  ]);
  assert.equal(chineseDetail.inspectorSections[1].title, '已观测嵌套活动');
});

test('Code Mode detail restores declared plan and shell structure with explicitly bounded results', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-1111-4444-9999-dddddddddddd';
  const input = [
    'const plan = await tools.update_plan({ explanation: \'fixture\', plan: [',
    "  { step: 'Inspect', status: 'in_progress' },",
    "  { step: 'Render', status: 'pending' },",
    '] });',
    "const command = await tools.shell_command({ command: 'Write-Output fixture', workdir: 'G:\\\\fixture', sandbox_permissions: 'require_escalated' });",
    'text(plan);',
    'text(command);',
  ].join('\n');
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-structured', turn_id: 'turn-code', input } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-structured',
        turn_id: 'turn-code',
        output: [
          { type: 'input_text', text: 'Script completed\nWall time 2.3 seconds\nOutput:\n' },
          { type: 'input_text', text: '{}' },
          { type: 'input_text', text: 'Exit code: 0\nWall time: 2.1 seconds\nOutput:\nfixture' },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const [plan, shell, source] = detail.timelineSections;

  assert.deepEqual(detail.timelineSections.map((section) => section.type), [
    'code_mode_tool_projection',
    'code_mode_tool_projection',
    'code_mode_source',
  ]);
  assert.deepEqual(detail.presentation, {
    variant: 'multi_tool',
    label: 'Multiple operations',
    toolName: '',
    declaredToolCount: 2,
    requestEvidence: 'declared_source',
    resultAssociation: 'bounded',
    hasUnassociatedOutput: false,
  });
  assert.equal(plan.toolName, 'update_plan');
  assert.equal(plan.requestEvidence, 'declared_source');
  assert.equal(plan.resultAssociation, 'bounded');
  assert.deepEqual(plan.requestSections[0].steps.map((step) => [step.step, step.status]), [
    ['Inspect', 'in_progress'],
    ['Render', 'pending'],
  ]);
  assert.deepEqual(plan.resultSections.map((section) => section.type), ['code_mode_source']);
  assert.equal(plan.resultSections[0].code, '{}');
  assert.equal(shell.toolName, 'shell_command');
  assert.equal(shell.resultAssociation, 'bounded');
  assert.deepEqual(shell.requestSections.map((section) => section.type), ['code', 'kv']);
  assert.match(shell.requestSections[0].code, /Write-Output fixture/);
  assert.ok(shell.requestSections[1].entries.some((entry) => entry.key === 'Sandbox permissions'
    && entry.value === 'require_escalated'));
  assert.deepEqual(shell.resultSections.map((section) => section.type), ['kv', 'terminal', 'code_mode_source']);
  assert.equal(shell.resultSections[0].entries[0].value, '0');
  assert.equal(shell.resultSections[1].text, 'fixture');
  assert.match(source.code, /tools\.update_plan/);
  assert.equal(detail.timelineSections.some((section) => section.title === 'Final output'), false);
  assert.deepEqual(detail.rawRefs.map((ref) => ref.line), [2, 3]);
  assert.equal(session.counts.toolCalls, 1);
  assert.equal(session.counts.failedCommands, 0);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }]);
  assert.equal(operation.tags.includes('Escalation requested'), false);
  assert.deepEqual(chineseDetail.timelineSections.map((section) => section.title), [
    '计划更新',
    '终端命令',
    '代码模式源码',
  ]);
  assert.equal(chineseDetail.presentation.label, '多个操作');
  assert.equal(chineseDetail.timelineSections[0].requestSections[0].title, '计划更新');
  assert.equal(chineseDetail.timelineSections[1].requestSections[1].title, '运行上下文');
  assert.ok(chineseDetail.timelineSections[1].requestSections[1].entries
    .some((entry) => entry.key === '沙箱权限'));
});

test('Code Mode single shell presentation unwraps the native command run and moves operation context to inspector', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-7777-4444-9999-dddddddddddd';
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-single-shell', input: "const result = await tools.shell_command({ command: 'Write-Output native', workdir: 'G:\\\\fixture', timeout_ms: 1000, timeoutMs: 2000 }); text(result);" } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-single-shell',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: 'Exit code: 0\nWall time: 1 second\nOutput:\nnative' },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });

  assert.deepEqual(detail.presentation, {
    variant: 'single_tool',
    label: 'Shell command',
    toolName: 'shell_command',
    declaredToolCount: 1,
    requestEvidence: 'declared_source',
    resultAssociation: 'bounded',
    hasUnassociatedOutput: false,
  });
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['code', 'terminal', 'code_mode_source']);
  assert.equal(detail.timelineSections[0].title, 'Command');
  assert.equal(detail.timelineSections[1].title, 'Output');
  assert.equal(detail.timelineSections[1].text, 'native');
  assert.deepEqual(detail.inspectorSections.map((section) => section.title), [
    'Operation metadata',
    'Projection evidence',
    'Run context',
    'Run result',
    'Code Mode source',
  ]);
  const runContext = detail.inspectorSections.find((section) => section.title === 'Run context');
  assert.deepEqual(runContext.entries.find((entry) => entry.key === 'Timeout ms'), {
    key: 'Timeout ms',
    value: '1000',
  });
  const chineseRunContext = chineseDetail.inspectorSections.find((section) => section.title === '运行上下文');
  assert.deepEqual(chineseRunContext.entries.find((entry) => entry.key === '超时毫秒数'), {
    key: '超时毫秒数',
    value: '1000',
  });
  assert.equal(detail.timelineSections.some((section) => section.type === 'code_mode_tool_projection'), false);
  assert.equal(chineseDetail.presentation.label, '终端命令');
  assert.equal(session.counts.toolCalls, 1);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }]);
});

test('Code Mode web projection renders structured request and safe Markdown result while retaining lifecycle evidence', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'eeeeeeee-7777-4444-9999-eeeeeeeeeeee';
  const input = "const result = await tools.web__run({ search_query: [{ q: 'site:example.test markdown', domains: ['example.test'] }], response_length: 'long' }); text(result);";
  const webResult = [
    '## Example result',
    '',
    '- [Safe source](https://example.test/docs)',
    '- **Rendered emphasis**',
    '- [Unsafe source](javascript:alert(1))',
    '',
    '<script>alert("unsafe")</script>',
    '',
    'citeturn0search0',
  ].join('\n');
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-single-web', turn_id: 'turn-web', input } },
    {
      type: 'event_msg',
      timestamp: '2026-06-12T10:00:01.500Z',
      payload: {
        type: 'web_search_end',
        call_id: 'exec-internal-web',
        turn_id: 'turn-web',
        query: 'site:example.test markdown',
        action: { type: 'search', queries: ['site:example.test markdown'] },
        status: 'completed',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-single-web',
        turn_id: 'turn-web',
        output: [
          { type: 'input_text', text: 'Script completed\nWall time 1.2 seconds\nOutput:\n' },
          { type: 'input_text', text: webResult },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const nestedWeb = session.logicalEvents.find((event) => event.kind === 'web_search');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const [request, result] = detail.timelineSections;

  assert.ok(nestedWeb);
  assert.deepEqual(detail.presentation, {
    variant: 'single_tool',
    label: 'Web search',
    toolName: 'web__run',
    declaredToolCount: 1,
    requestEvidence: 'declared_source',
    resultAssociation: 'bounded',
    hasUnassociatedOutput: false,
  });
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['web_request', 'markdown']);
  assert.equal(request.groups[0].title, 'Queries');
  assert.equal(request.groups[0].items[0].primary, 'site:example.test markdown');
  assert.deepEqual(request.groups[0].items[0].entries, [{ key: 'Domains', value: 'example.test' }]);
  assert.deepEqual(request.options, [{ key: 'Response length', value: 'long' }]);
  assert.equal(result.role, 'web_result');
  assert.match(result.html, /<h2>Example result<\/h2>/);
  assert.match(result.html, /href="https:\/\/example\.test\/docs"/);
  assert.match(result.html, /<strong>Rendered emphasis<\/strong>/);
  assert.doesNotMatch(result.html, /href="javascript:/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.match(result.html, /citeturn0search0/);
  assert.equal(detail.inspectorSections.some((section) => section.type === 'code_mode_source'
    && section.title === 'Associated result'), true);
  const eventRefs = detail.inspectorSections.find((section) => section.type === 'event_refs');
  assert.deepEqual(eventRefs.items.map((item) => item.id), [nestedWeb.id]);
  assert.equal(chineseDetail.presentation.label, '网页搜索');
  assert.equal(chineseDetail.timelineSections[0].title, '网络请求');
  assert.equal(chineseDetail.timelineSections[0].groups[0].title, '查询');
  assert.equal(chineseDetail.timelineSections[1].title, '网页结果');
  assert.equal(session.counts.toolCalls, 2);
  assert.deepEqual(session.analysis.toolUsage, [
    { name: 'exec', count: 1 },
    { name: 'web_search', count: 1 },
  ]);
});

test('Code Mode single request keeps operation output explicit and separate from the projected result', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-8888-4444-9999-dddddddddddd';
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-single-none', input: 'await tools.get_goal({});' } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:02.000Z', payload: { type: 'custom_tool_call_output', call_id: 'exec-single-none', output: 'Script completed\nouter-only output' } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });

  assert.equal(detail.presentation.variant, 'single_tool');
  assert.equal(detail.presentation.toolName, 'get_goal');
  assert.equal(detail.presentation.resultAssociation, 'none');
  assert.equal(detail.presentation.hasUnassociatedOutput, true);
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['code', 'terminal']);
  assert.equal(detail.timelineSections[1].title, 'Operation output');
  assert.match(detail.timelineSections[1].text, /outer-only output/);
  assert.equal(detail.timelineSections.some((section) => section.type === 'code_mode_tool_projection'), false);
  const projectionEvidence = detail.inspectorSections.find((section) => section.title === 'Projection evidence');
  const chineseProjectionEvidence = chineseDetail.inspectorSections.find((section) => section.title === '投影证据');
  assert.ok(projectionEvidence?.entries.some((entry) => entry.key === 'Result association note'
    && entry.value === 'No result output matched the supported shape'));
  assert.ok(chineseProjectionEvidence?.entries.some((entry) => entry.key === '结果关联说明'
    && entry.value === '未检测到满足受支持形态的结果输出'));
  assert.equal(detail.inspectorSections.some((section) => section.type === 'code_mode_source'
    && section.title === 'Code Mode source'), true);
  assert.equal(chineseDetail.timelineSections[1].title, '操作输出');
});

test('Code Mode result-association evidence does not imply an output was observed', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-7777-4444-9999-dddddddddddd';
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-single-no-output', input: 'const plan = await tools.update_plan({ plan: [] }); text(plan);' } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const projectionEvidence = detail.inspectorSections.find((section) => section.title === 'Projection evidence');

  assert.equal(detail.presentation.resultAssociation, 'none');
  assert.equal(detail.presentation.hasUnassociatedOutput, false);
  assert.ok(projectionEvidence?.entries.some((entry) => entry.key === 'Result association note'
    && entry.value === 'No result output matched the supported shape'));
});

test('Code Mode declared projection fails closed and keeps aggregate output for dynamic programs', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-2222-4444-9999-dddddddddddd';
  const input = "const args = { plan: [] }; const plan = await tools.update_plan(args); text(plan);";
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-dynamic', input } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-dynamic',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: '{}' },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');

  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['code', 'terminal']);
  assert.equal(detail.presentation.variant, 'raw_code_mode');
  assert.equal(detail.presentation.label, 'Script operation');
  assert.equal(detail.timelineSections[0].role, 'command');
  assert.match(detail.timelineSections[0].code, /update_plan\(args\)/);
  assert.equal(detail.timelineSections[1].text, '{}');
});

test('Code Mode bounded projections preserve long associated results without promoting extra events', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-3333-4444-9999-dddddddddddd';
  const result = `BEGIN-${'x'.repeat(5_000)}-END`;
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-long-result', input: 'const result = await tools.get_goal({}); text(result);' } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-long-result',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: result },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const fullResult = detail.timelineSections.at(-1);

  assert.deepEqual(detail.presentation, {
    variant: 'single_tool',
    label: 'Get goal',
    toolName: 'get_goal',
    declaredToolCount: 1,
    requestEvidence: 'declared_source',
    resultAssociation: 'bounded',
    hasUnassociatedOutput: false,
  });
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['code', 'code', 'code_mode_source']);
  assert.equal(fullResult.type, 'code_mode_source');
  assert.equal(fullResult.code, result);
  assert.match(fullResult.code, /-END$/);
  assert.equal(chineseDetail.presentation.label, '获取目标');
  assert.equal(chineseDetail.inspectorSections.some((section) => section.title === '代码模式源码'), true);
  assert.equal(session.counts.toolCalls, 1);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }]);
});

test('Code Mode detail bounds structured result interpretation before collaboration rendering', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-4444-4444-9999-dddddddddddd';
  const deeplyNestedResult = `${'{"status":'.repeat(6_000)}"completed"${'}'.repeat(6_000)}`;
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-deep-result', input: "const result = await tools.spawn_agent({ message: 'fixture', timeout_ms: 1000, agent_type: 'worker', model: 'fixture', reasoning_effort: 'high', fork_context: 'all' }); text(result);" } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-deep-result',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: deeplyNestedResult },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const collaboration = detail.timelineSections[0];

  assert.equal(detail.presentation.toolName, 'spawn_agent');
  assert.equal(detail.presentation.variant, 'single_tool');
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['collaboration', 'code_mode_source']);
  assert.equal(collaboration.type, 'collaboration');
  assert.equal(detail.timelineSections[1].code, deeplyNestedResult);
  assert.equal(chineseDetail.presentation.label, '启动子代理');
  assert.equal(chineseDetail.timelineSections[0].title, '启动子代理');
  assert.deepEqual(chineseDetail.timelineSections[0].fields.map((field) => field.key), [
    '超时毫秒数',
    '代理类型',
    '模型',
    '推理强度',
    '分支上下文',
  ]);
});

test('Code Mode image projections keep structured request fields localizable', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-5555-4444-9999-dddddddddddd';
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-view-image', input: "const result = await tools.view_image({ path: 'G:/fixture.png', detail: 'original' }); text(result);" } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-view-image',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: '{"width":1280,"height":720,"mimeType":"image/png"}' },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const imageRequest = detail.timelineSections[0];

  assert.equal(detail.presentation.toolName, 'view_image');
  assert.equal(detail.presentation.label, '图片检查');
  assert.equal(imageRequest.type, 'kv');
  assert.equal(imageRequest.title, '图片检查');
  assert.deepEqual(imageRequest.entries, [
    { key: '路径', value: 'G:/fixture.png' },
    { key: '精度', value: 'original' },
    { key: '尺寸', value: '1280 x 720' },
    { key: 'MIME 类型', value: 'image/png' },
  ]);
  assert.equal(detail.timelineSections.at(-1).code, '{"width":1280,"height":720,"mimeType":"image/png"}');
});

test('Code Mode collaboration projections do not translate agent names that collide with UI labels', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-6666-4444-9999-dddddddddddd';
  const result = JSON.stringify({
    agent_statuses: [
      { agent_nickname: 'Status', status: 'completed' },
      { agent_nickname: 'Model', status: 'running' },
      { agent_nickname: 'agent-1', status: 'pending' },
      { status: 'failed' },
    ],
  });
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-wait-agent', input: 'const result = await tools.wait_agent({ timeout_ms: 1000 }); text(result);' } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-wait-agent',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: result },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.subtype === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const statuses = detail.timelineSections[0].statuses;
  const chineseStatuses = chineseDetail.timelineSections[0].statuses;

  assert.deepEqual(statuses.map((item) => item.label), ['Status', 'Model', 'agent-1', 'Status']);
  assert.deepEqual(chineseStatuses.map((item) => item.label), ['Status', 'Model', 'agent-1', '状态']);
  assert.ok(chineseStatuses.every((item) => !Object.hasOwn(item, 'labelKind')));
  assert.deepEqual(chineseStatuses.map((item) => item.status), ['completed', 'running', 'pending', 'failed']);
});
