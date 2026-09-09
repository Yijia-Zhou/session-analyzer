'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { __testOnly, buildEventDetail, buildHydratedEventDetail } = require('../src/codex');
const { createCodexDetailBuilder } = require('../src/codex-detail');
const { knownCodeModeToolNames } = require('../src/codex-code-mode-declared');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';
const buildIndex = __testOnly.buildUncompactedIndexForDetailTests;

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
  const lines = records.map((record) => JSON.stringify(record)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029'));
  await fsp.writeFile(file, lines.join('\n') + '\n', 'utf8');
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

test('cache-observed token_count detail uses canonical accounting and keeps usage limits separate', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = '98989898-3333-4444-8888-989898989898';
  await writeTranscript(codexHome, repoRoot, id, [
    {
      type: 'session_meta',
      timestamp: '2026-09-03T00:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-03T00:00:01.000Z',
      payload: { type: 'turn_started', turn_id: 'turn-cache-detail' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-03T00:00:02.000Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 16_384,
            cached_input_tokens: 16_384,
            output_tokens: 233,
          },
          total_token_usage: {
            input_tokens: 999_999,
            cached_input_tokens: 999_999,
          },
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-09-03T00:00:03.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'synthetic cache detail anchor' }],
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-03T00:00:16.000Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 12_288,
            cached_input_tokens: 0,
            output_tokens: 589,
          },
          total_token_usage: {
            input_tokens: 1_000_000,
            cached_input_tokens: 999_999,
          },
        },
        rate_limits: {
          primary: {
            used_percent: 20,
            resets_at: '2026-09-04T00:00:00.000Z',
          },
        },
      },
    },
  ]);

  const index = await __testOnly.buildCacheObservationResidentOracleForTests({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const event = session.logicalEvents.find((candidate) => (
    candidate.subtype === 'token_count'
      && candidate.cacheObservation?.comparison?.state === 'cache_discontinuity'
  ));
  assert.ok(event);
  const detail = await buildHydratedEventDetail(index, session, event.id, event.layer, { locale: 'en' });
  assert.equal(detail.timelineSections[0].type, 'token_usage');
  assert.deepEqual(detail.timelineSections[0].items.map((item) => [item.label, item.formatted]), [
    ['Input', '12,288'],
    ['Cached input', '0'],
    ['Cache reuse', '0%'],
    ['Output', '589'],
  ]);
  assert.equal(JSON.stringify(detail).includes('9999999'), false);
  assert.equal(detail.inspectorSections.filter((section) => section.type === 'usage_limits').length, 1);
  assert.equal(detail.timelineSections.filter((section) => section.type === 'usage_limits').length, 0);
  const comparison = detail.inspectorSections.find((section) => section.title === 'Comparison Context');
  assert.deepEqual(comparison.entries.map((entry) => entry.key), [
    'Elapsed',
    'Input tokens',
    'Input-token delta',
    'Cached input',
    'Cache-read delta',
    'Cache reuse',
    'Comparison state',
  ]);
  assert.equal(comparison.entries.at(-1).value, 'Cache discontinuity');
  assert.equal(
    detail.inspectorSections.find((section) => section.type === 'notice').text,
    'This cache discontinuity is inferred from adjacent token accounting; the transcript does not provide explicit cache-expiry evidence.',
  );

  const localized = await buildHydratedEventDetail(index, session, event.id, event.layer, { locale: 'zh-CN' });
  assert.equal(localized.timelineSections[0].title, 'Token 使用情况');
  assert.deepEqual(localized.timelineSections[0].items.map((item) => item.label), [
    '输入',
    '缓存输入',
    '缓存复用',
    '输出',
  ]);
  assert.equal(
    localized.inspectorSections.find((section) => section.type === 'notice').text,
    '该缓存复用中断由相邻的 token accounting 推断；转录中没有提供显式的缓存过期证据。',
  );
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
    timeline: ['plan_update'],
    inspector: ['kv', 'json', 'code'],
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.toolName === 'fixture_lookup');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });

  assert.deepEqual(detail.rawRefs.map((ref) => ref.line), [2, 3, 4, 6]);
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['code', 'terminal']);
  assert.deepEqual(detail.timelineSections.map((section) => section.title), ['Command', 'Final output']);
  assert.equal(detail.timelineSections[0].role, 'command');
  assert.match(detail.timelineSections[0].code, /tools\.fixture/);
  assert.equal(detail.timelineSections[1].text, 'Script completed\nfixture result');
  assert.deepEqual(detail.inspectorSections[0], {
    purpose: 'context',
    type: 'kv',
    title: 'Operation metadata',
    entries: [
      { key: 'Evidence', value: 'output_observed' },
      { key: 'Observation', value: 'terminal' },
      { key: 'Cell', value: '4242' },
      { key: 'Poll count', value: '1' },
    ],
  });
  assert.equal(detail.inspectorSections[1].type, 'code_mode_trace');
  assert.equal(detail.inspectorSections[1].purpose, 'traceability');
  assert.equal(detail.inspectorSections[1].expanded, undefined);
  assert.deepEqual(detail.inspectorSections[1].phases.map((phase) => phase.title), ['Exec phase', 'Wait phase 1']);
  assert.match(detail.inspectorSections[1].phases[0].output, /Script running with cell ID 4242/);
  assert.equal(detail.inspectorSections[1].phases[1].output, '');
  assert.deepEqual(detail.inspectorSections[2], {
    purpose: 'traceability',
    type: 'event_refs',
    title: 'Observed nested activity',
    items: [{ id: nested.id, label: 'MCP tool', kind: 'mcp_call', status: 'failed' }],
  });
  assert.equal(Object.hasOwn(detail, 'eventRefs'), false);
  assert.deepEqual(chineseDetail.timelineSections.map((section) => section.title), ['执行命令', '最终输出']);
  assert.deepEqual(chineseDetail.inspectorSections[0].entries, [
    { key: '证据状态', value: 'output_observed' },
    { key: '观测状态', value: 'terminal' },
    { key: '运行单元', value: '4242' },
    { key: '轮询次数', value: '1' },
  ]);
  assert.equal(chineseDetail.inspectorSections[1].title, '执行过程');
  assert.deepEqual(chineseDetail.inspectorSections[1].phases.map((phase) => phase.title), ['执行阶段', '等待阶段 1']);
  assert.equal(chineseDetail.inspectorSections[2].title, '已观测嵌套活动');
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
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
    collapsedPreview: {
      kind: 'declared_sequence',
      label: 'Declared sequence',
      items: [
        {
          label: 'Plan update',
          detail: '2 steps · Inspect',
          detailKind: 'steps',
          detailCount: 2,
        },
        { label: 'Shell command', detail: 'Write-Output fixture' },
      ],
      omittedCount: 0,
    },
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
    'Shell 命令',
    '代码模式源码',
  ]);
  assert.equal(chineseDetail.presentation.label, '多个操作');
  assert.deepEqual(chineseDetail.presentation.collapsedPreview, {
    kind: 'declared_sequence',
    label: '声明顺序',
    items: [
      {
        label: '计划更新',
        detail: '2 个步骤 · Inspect',
        detailKind: 'steps',
        detailCount: 2,
      },
      { label: 'Shell 命令', detail: 'Write-Output fixture' },
    ],
    omittedCount: 0,
  });
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
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-single-shell', input: "const result = await tools.shell_command({ command: 'Write-Output native', workdir: 'G:\\\\fixture', timeout_ms: 1000, timeoutMs: 2000 }); text(result.output);" } },
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
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
    collapsedPreview: {
      kind: 'request_summary',
      label: 'Request',
      text: 'Write-Output native',
    },
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
  assert.equal(chineseDetail.presentation.label, 'Shell 命令');
  assert.equal(session.counts.toolCalls, 1);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }]);
});

test('Code Mode single request summaries cover every safely projected tool type', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-7878-4444-9999-dddddddddddd';
  const cases = [
    { tool: 'apply_patch', request: { patch: '*** Begin Patch\n*** Update File: fixture.txt\n@@\n-old\n+new\n*** End Patch' }, expected: 'fixture.txt' },
    { tool: 'close_agent', request: { target: 'agent-close' }, expected: 'agent-close' },
    { tool: 'create_goal', request: { objective: 'Ship fixture' }, expected: 'Ship fixture' },
    { tool: 'exec_command', request: { command: 'Write-Output exec' }, expected: 'Write-Output exec' },
    { tool: 'followup_task', request: { target: 'agent-followup', message: 'Continue follow-up' }, expected: 'agent-followup · Continue follow-up' },
    { tool: 'get_goal', request: {}, expected: 'No arguments', detailKind: 'empty_request' },
    {
      tool: 'image_gen__imagegen',
      request: { prompt: 'Draw fixture data:text/plain;base64,QUJD' },
      expected: 'Draw fixture [embedded data URL omitted; see raw refs]',
    },
    { tool: 'interrupt_agent', request: { target: 'agent-interrupt' }, expected: 'agent-interrupt' },
    { tool: 'list_agents', request: { path_prefix: '/root/review' }, expected: '/root/review' },
    { tool: 'list_available_plugins_to_install', request: {}, expected: 'No arguments', detailKind: 'empty_request' },
    { tool: 'list_mcp_resource_templates', request: { server: 'template-server' }, expected: 'template-server' },
    { tool: 'list_mcp_resources', request: { server: 'resource-server' }, expected: 'resource-server' },
    { tool: 'read_mcp_resource', request: { server: 'reader-server', uri: 'fixture://resource' }, expected: 'fixture://resource · reader-server' },
    { tool: 'request_plugin_install', request: { plugin: 'fixture-plugin' }, expected: 'fixture-plugin' },
    {
      tool: 'request_user_input',
      request: { questions: [{ id: 'fixture', header: 'Fixture', question: 'Choose fixture?', options: [] }] },
      expected: 'Choose fixture?',
    },
    { tool: 'send_input', request: { target: 'agent-send', message: 'Continue fixture' }, expected: 'agent-send · Continue fixture' },
    { tool: 'send_message', request: { target: 'agent-message', message: 'Message fixture' }, expected: 'agent-message · Message fixture' },
    { tool: 'shell_command', request: { command: 'Write-Output shell' }, expected: 'Write-Output shell' },
    { tool: 'spawn_agent', request: { task_name: 'fixture-task', message: 'Inspect fixture' }, expected: 'fixture-task · Inspect fixture' },
    { tool: 'update_goal', request: { status: 'complete' }, expected: 'complete' },
    {
      tool: 'update_plan',
      request: { plan: [{ step: 'Plan fixture', status: 'in_progress' }] },
      expected: '1 step · Plan fixture',
      detailKind: 'steps',
    },
    { tool: 'view_image', request: { path: 'G:/fixture.png', detail: 'original' }, expected: 'G:/fixture.png · original' },
    { tool: 'wait_agent', request: { targets: ['agent-a', 'agent-b'], timeout_ms: 1000 }, expected: 'agent-a, agent-b · 1000' },
    { tool: 'web__run', request: { search_query: [{ q: 'fixture query' }] }, expected: 'fixture query' },
  ];
  assert.deepEqual(
    cases.map((item) => item.tool).sort(),
    knownCodeModeToolNames().sort(),
    'the summary matrix must change whenever the safe tool allowlist changes',
  );

  const rows = [{ type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } }];
  cases.forEach((item, index) => {
    const callId = `exec-single-summary-${index}`;
    const second = String((index * 2) + 1).padStart(2, '0');
    const outputSecond = String((index * 2) + 2).padStart(2, '0');
    rows.push(
      {
        type: 'response_item',
        timestamp: `2026-06-12T10:00:${second}.000Z`,
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: callId,
          input: `const result = await tools.${item.tool}(${JSON.stringify(item.request)}); text(result);`,
        },
      },
      {
        type: 'response_item',
        timestamp: `2026-06-12T10:00:${outputSecond}.000Z`,
        payload: { type: 'custom_tool_call_output', call_id: callId, output: 'Script completed\nOutput:\n{}' },
      },
    );
  });
  await writeTranscript(codexHome, repoRoot, id, rows);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operations = session.logicalEvents.filter((event) => event.kind === 'code_mode_operation');
  assert.equal(operations.length, cases.length);
  operations.forEach((operation, index) => {
    const detail = buildEventDetail(session, operation.id, 'main');
    const preview = detail.presentation.collapsedPreview;
    assert.equal(detail.presentation.variant, 'single_tool', cases[index].tool);
    assert.equal(preview.kind, 'request_summary', cases[index].tool);
    assert.equal(preview.label, 'Request', cases[index].tool);
    assert.equal(preview.text, cases[index].expected, cases[index].tool);
    assert.equal(preview.detailKind || '', cases[index].detailKind || '', cases[index].tool);
  });

  const execOperation = operations[cases.findIndex((item) => item.tool === 'exec_command')];
  const shellOperation = operations[cases.findIndex((item) => item.tool === 'shell_command')];
  assert.equal(buildEventDetail(session, execOperation.id, 'main').presentation.label, 'Exec command');
  assert.equal(buildEventDetail(session, shellOperation.id, 'main').presentation.label, 'Shell command');
  assert.equal(buildEventDetail(session, execOperation.id, 'main', { locale: 'zh-CN' }).presentation.label, 'Exec 命令');
  assert.equal(buildEventDetail(session, shellOperation.id, 'main', { locale: 'zh-CN' }).presentation.label, 'Shell 命令');

  const noArgumentOperation = operations[cases.findIndex((item) => item.tool === 'get_goal')];
  const chineseDetail = buildEventDetail(session, noArgumentOperation.id, 'main', { locale: 'zh-CN' });
  assert.deepEqual(chineseDetail.presentation.collapsedPreview, {
    kind: 'request_summary',
    label: '请求',
    text: '无参数',
    detailKind: 'empty_request',
  });
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
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
    collapsedPreview: {
      kind: 'request_summary',
      label: 'Request',
      text: 'site:example.test markdown',
    },
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const projectionEvidence = detail.inspectorSections.find((section) => section.title === 'Projection evidence');

  assert.equal(detail.presentation.resultAssociation, 'none');
  assert.equal(detail.presentation.hasUnassociatedOutput, false);
  assert.deepEqual(detail.presentation.collapsedPreview, {
    kind: 'request_summary',
    label: 'Request',
    text: 'Plan: empty list',
    detailKind: 'request_structure',
    detailField: 'Plan',
    detailShape: 'empty_list',
  });
  assert.deepEqual(chineseDetail.presentation.collapsedPreview, {
    kind: 'request_summary',
    label: '请求',
    text: '计划：空列表',
    detailKind: 'request_structure',
    detailField: 'Plan',
    detailShape: 'empty_list',
  });
  assert.ok(projectionEvidence?.entries.some((entry) => entry.key === 'Result association note'
    && entry.value === 'No result output matched the supported shape'));
});

test('Code Mode request previews distinguish omitted, null, and empty-object arguments', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-7788-4444-9999-dddddddddddd';
  const inputs = [
    'const result = await tools.get_goal(); text(result);',
    'const result = await tools.get_goal(null); text(result);',
    'const result = await tools.get_goal({}); text(result);',
    "const result = await tools.get_goal({ 'field-data:text/plain,private-payload': [] }); text(result);",
  ];
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    ...inputs.map((input, index) => ({
      type: 'response_item',
      timestamp: `2026-06-12T10:00:0${index + 1}.000Z`,
      payload: { type: 'custom_tool_call', name: 'exec', call_id: `exec-request-presence-${index}`, input },
    })),
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operations = session.logicalEvents.filter((event) => event.kind === 'code_mode_operation');
  const previews = operations.map((operation) => buildEventDetail(session, operation.id, 'main').presentation.collapsedPreview);
  const chinesePreviews = operations.map((operation) => (
    buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' }).presentation.collapsedPreview
  ));

  assert.equal(previews.length, 4);
  assert.deepEqual(previews[0], {
    kind: 'request_summary', label: 'Request', text: 'No arguments', detailKind: 'empty_request',
  });
  assert.deepEqual(previews[1], {
    kind: 'request_summary',
    label: 'Request',
    text: 'Request: null',
    detailKind: 'request_structure',
    detailField: 'Request',
    detailShape: 'null_value',
  });
  assert.deepEqual(previews[2], {
    kind: 'request_summary', label: 'Request', text: 'No arguments', detailKind: 'empty_request',
  });
  assert.deepEqual(previews[3], {
    kind: 'request_summary',
    label: 'Request',
    text: 'Field [embedded data URL omitted; see raw refs]: empty list',
    detailKind: 'request_structure',
    detailField: 'Field [embedded data URL omitted; see raw refs]',
    detailShape: 'empty_list',
  });
  assert.equal(chinesePreviews[0].text, '无参数');
  assert.equal(chinesePreviews[1].text, '请求：空值');
  assert.equal(chinesePreviews[2].text, '无参数');
  assert.doesNotMatch(JSON.stringify([previews[3], chinesePreviews[3]]), /private|payload/);
});

test('Code Mode declared sequence sanitizes request keys before humanizing separators', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-7799-4444-9999-dddddddddddd';
  const input = [
    "const first = await tools.get_goal({ 'field-data:text/plain,private-payload': [] });",
    "const second = await tools.get_goal({ 'field_data:text/plain,private_payload': [] });",
    'text(first);',
    'text(second);',
  ].join('\n');
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-request-key-redaction', input } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const preview = buildEventDetail(session, operation.id, 'main').presentation.collapsedPreview;

  assert.equal(preview.kind, 'declared_sequence');
  assert.equal(preview.items.length, 2);
  for (const item of preview.items) {
    assert.equal(item.detail, 'Field [embedded data URL omitted; see raw refs]: empty list');
    assert.equal(item.detailField, 'Field [embedded data URL omitted; see raw refs]');
  }
  assert.doesNotMatch(JSON.stringify(preview), /private|payload/);
});

test('Code Mode declared projection fails closed and keeps an outer-source excerpt for dynamic programs', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-2222-4444-9999-dddddddddddd';
  const input = [
    'const args = { plan: [] };',
    'const plan = await tools.update_plan(args);',
    'const goal = await tools.get_goal(args);',
    'const input = await tools.request_user_input(args);',
    'text(plan);',
  ].join('\n');
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');

  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['code', 'terminal']);
  assert.equal(detail.presentation.variant, 'raw_code_mode');
  assert.equal(detail.presentation.label, 'Scripted operation');
  assert.deepEqual(detail.presentation.collapsedPreview, {
    kind: 'source_excerpt',
    label: 'Source',
    text: 'const plan = await update_plan(args);',
    summaryLines: [
      'const plan = await update_plan(args);',
      'const goal = await get_goal(args);',
    ],
    hasMoreSource: true,
  });
  assert.equal(detail.timelineSections[0].role, 'command');
  assert.match(detail.timelineSections[0].code, /tools\.update_plan\(args\)/);
  assert.equal(detail.timelineSections[1].text, '{}');
});

test('Code Mode raw source excerpt records a complete two-line summary without a continuation signal', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-2233-4444-9999-dddddddddddd';
  const input = [
    'const plan = await tools.update_plan(args);',
    'text(plan);',
  ].join('\n');
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-dynamic-complete', input } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');

  assert.equal(detail.presentation.variant, 'raw_code_mode');
  assert.deepEqual(detail.presentation.collapsedPreview, {
    kind: 'source_excerpt',
    label: 'Source',
    text: 'const plan = await update_plan(args);',
    summaryLines: [
      'const plan = await update_plan(args);',
      'text(plan);',
    ],
    hasMoreSource: false,
  });
});

test('Code Mode raw source excerpt splits every ECMAScript line terminator', async (t) => {
  const cases = [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
  ];

  for (const [caseIndex, [name, separator]] of cases.entries()) {
    await t.test(name, async (subtest) => {
      const codexHome = await makeTempCodexHome(subtest);
      const repoRoot = path.join(codexHome, 'repo');
      const suffix = String(caseIndex + 1).padStart(12, '0');
      const id = `dddddddd-2266-4444-9999-${suffix}`;
      const input = [
        'const plan = await tools.update_plan(args);',
        'const goal = await tools.get_goal(args);',
      ].join(separator);
      await writeTranscript(codexHome, repoRoot, id, [
        { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
        { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: `exec-dynamic-${suffix}`, input } },
      ]);

      const index = await buildIndex({ repoRoot, codexHome });
      const session = index.sessionsById.get(id);
      const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
      const detail = buildEventDetail(session, operation.id, 'main');

      assert.equal(detail.presentation.variant, 'raw_code_mode');
      assert.deepEqual(detail.presentation.collapsedPreview.summaryLines, [
        'const plan = await update_plan(args);',
        'const goal = await get_goal(args);',
      ]);
      assert.equal(detail.presentation.collapsedPreview.hasMoreSource, false);
    });
  }
});

test('Code Mode raw source excerpt bounds retained candidates for newline-dense oversized source', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-2277-4444-9999-dddddddddddd';
  const filler = Array.from({ length: 20_000 }, (_, index) => `// filler ${index}`).join('\n');
  const input = [
    filler,
    'const plan = await tools.update_plan(args);',
    'const goal = await tools.get_goal(args);',
    'text(plan);',
  ].join('\n');
  assert.ok(input.length > 100_000);
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-oversized-dense-source', input } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');

  assert.equal(detail.presentation.variant, 'raw_code_mode');
  assert.deepEqual(detail.presentation.collapsedPreview.summaryLines, [
    'const plan = await update_plan(args);',
    'const goal = await get_goal(args);',
  ]);
  assert.equal(detail.presentation.collapsedPreview.hasMoreSource, true);
});

test('Code Mode raw source excerpt scans newline-dense oversized source without a tool token', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-2288-4444-9999-dddddddddddd';
  const input = Array.from({ length: 20_000 }, (_, index) => `// ordinary ${index}`).join('\n');
  assert.ok(input.length > 100_000);
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-oversized-no-tool-source', input } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');

  assert.equal(detail.presentation.variant, 'raw_code_mode');
  assert.deepEqual(detail.presentation.collapsedPreview.summaryLines, [
    '// ordinary 0',
    '// ordinary 1',
  ]);
  assert.equal(detail.presentation.collapsedPreview.hasMoreSource, true);
});

test('Code Mode raw source excerpt marks an individually truncated source line as incomplete', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-2244-4444-9999-dddddddddddd';
  const input = `const plan = await tools.update_plan(args); // ${'x'.repeat(220)}`;
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-dynamic-truncated', input } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const preview = detail.presentation.collapsedPreview;

  assert.equal(detail.presentation.variant, 'raw_code_mode');
  assert.equal(preview.kind, 'source_excerpt');
  assert.equal(preview.summaryLines.length, 1);
  assert.equal(preview.hasMoreSource, true);
  assert.match(preview.text, /…$/);
  assert.equal(preview.summaryLines[0], preview.text);
});

test('Code Mode raw source excerpt redacts a multiline data URL before selecting summary lines', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-2255-4444-9999-dddddddddddd';
  const templateQuote = String.fromCharCode(96);
  const input = [
    'const result = await tools.shell_command({ command: ' + templateQuote + 'data:text/plain;base64,QUJD',
    'REVGR0g=' + templateQuote + ', timeout_ms: options.timeoutMs });',
    'text(result);',
  ].join('\n');
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-dynamic-data-url', input } },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const preview = detail.presentation.collapsedPreview;
  const previewText = preview.summaryLines.join('\n');

  assert.equal(detail.presentation.variant, 'raw_code_mode');
  assert.match(previewText, /\[embedded data URL omitted; see raw refs\]/);
  assert.match(preview.summaryLines[1], /^text\(result\);$/);
  assert.doesNotMatch(previewText, /QUJD|REVGR0g=/);
  assert.doesNotMatch(detail.timelineSections[0].code, /QUJD|REVGR0g=/);
});

test('Code Mode raw source excerpt redacts whitespace-wrapped non-base64 data URLs', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const templateQuote = String.fromCharCode(96);
  const variants = [
    { label: 'tab', separator: '\t' },
    { label: 'carriage return', separator: '\r' },
    { label: 'template newline', separator: '\n' },
  ];
  for (const [index, variant] of variants.entries()) {
    const id = 'dddddddd-226' + index + '-4444-9999-dddddddddddd';
    const input = 'const result = await tools.shell_command({ command: '
      + templateQuote + 'data:text/plain,SECRET' + variant.separator + 'LEAKED'
      + templateQuote + ', timeout_ms: options.timeoutMs });\ntext(result);';
    await writeTranscript(codexHome, repoRoot, id, [
      { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
      { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-dynamic-generic-data-url-' + index, input } },
    ]);
  }

  const index = await buildIndex({ repoRoot, codexHome });
  for (const [variantIndex, variant] of variants.entries()) {
    const id = 'dddddddd-226' + variantIndex + '-4444-9999-dddddddddddd';
    const session = index.sessionsById.get(id);
    const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
    const detail = buildEventDetail(session, operation.id, 'main');
    const preview = detail.presentation.collapsedPreview;
    const rendered = JSON.stringify({
      text: preview.text,
      summaryLines: preview.summaryLines,
      command: detail.timelineSections[0].code,
    });

    assert.equal(detail.presentation.variant, 'raw_code_mode', variant.label);
    assert.match(rendered, /\[embedded data URL omitted; see raw refs\]/, variant.label);
    assert.doesNotMatch(rendered, /SECRET|LEAKED/, variant.label);
  }
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
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
    collapsedPreview: {
      kind: 'request_summary',
      label: 'Request',
      text: 'No arguments',
      detailKind: 'empty_request',
    },
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const collaboration = detail.timelineSections[0];

  assert.equal(detail.presentation.toolName, 'spawn_agent');
  assert.equal(detail.presentation.variant, 'single_tool');
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['collaboration', 'code', 'code_mode_source']);
  assert.equal(collaboration.type, 'collaboration');
  assert.equal(detail.timelineSections[1].title, 'Response summary');
  assert.equal(detail.timelineSections[1].code.endsWith('...'), true);
  assert.ok(detail.timelineSections[1].code.length < deeplyNestedResult.length);
  assert.equal(detail.timelineSections[2].code, deeplyNestedResult);
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const imageRequest = detail.timelineSections[0];

  assert.equal(detail.presentation.toolName, 'view_image');
  assert.equal(detail.presentation.label, '图片检查');
  assert.deepEqual(detail.presentation.collapsedPreview, {
    kind: 'request_summary',
    label: '请求',
    text: 'G:/fixture.png · original',
  });
  assert.doesNotMatch(detail.presentation.collapsedPreview.text, /1280|720|image\/png/);
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

test('Code Mode declared sequence keeps image preview details request-only', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-5566-4444-9999-dddddddddddd';
  const input = [
    'const image = await tools.view_image({});',
    "const plan = await tools.update_plan({ plan: [{ step: 'x', status: 'pending' }] });",
    'text(image);',
    'text(plan);',
  ].join('\n');
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T10:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T10:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-multi-view-image', input } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T10:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-multi-view-image',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: '{"width":1280,"height":720,"mimeType":"image/png"}' },
          { type: 'input_text', text: '{}' },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const preview = detail.presentation.collapsedPreview;
  const imageProjection = detail.timelineSections[0];

  assert.equal(detail.presentation.variant, 'multi_tool');
  assert.deepEqual(preview.items, [
    { label: 'Image inspection', detail: 'No arguments', detailKind: 'empty_request' },
    {
      label: 'Plan update',
      detail: '1 step · x',
      detailKind: 'steps',
      detailCount: 1,
    },
  ]);
  assert.deepEqual(imageProjection.requestSections[0].entries, [
    { key: 'Dimensions', value: '1280 x 720' },
    { key: 'MIME type', value: 'image/png' },
  ]);
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
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const chineseDetail = buildEventDetail(session, operation.id, 'main', { locale: 'zh-CN' });
  const statuses = detail.timelineSections[0].statuses;
  const chineseStatuses = chineseDetail.timelineSections[0].statuses;

  assert.deepEqual(statuses.map((item) => item.label), ['Status', 'Model', 'agent-1', 'Status']);
  assert.deepEqual(chineseStatuses.map((item) => item.label), ['Status', 'Model', 'agent-1', '状态']);
  assert.ok(chineseStatuses.every((item) => !Object.hasOwn(item, 'labelKind')));
  assert.deepEqual(chineseStatuses.map((item) => item.status), ['completed', 'running', 'pending', 'failed']);
});

test('Code Mode list_agents projections retain agent statuses and task messages', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-7777-4444-9999-dddddddddddd';
  const result = JSON.stringify({
    agents: [
      { agent_name: 'worker-a', agent_status: 'running', last_task_message: 'Inspect the parser.' },
      { agent_name: 'worker-b', agent_status: 'completed', last_task_message: 'Tests complete.' },
    ],
  });
  await writeTranscript(codexHome, repoRoot, id, [
    { type: 'session_meta', timestamp: '2026-06-12T11:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-06-12T11:00:01.000Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-list-agents', input: 'const result = await tools.list_agents({}); text(result);' } },
    {
      type: 'response_item',
      timestamp: '2026-06-12T11:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-list-agents',
        output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: result },
        ],
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const detail = buildEventDetail(session, operation.id, 'main');
  const projection = detail.timelineSections[0];

  assert.equal(projection.type, 'collaboration');
  assert.deepEqual(projection.fields.find((field) => field.key === 'Agent count'), { key: 'Agent count', value: '2' });
  assert.deepEqual(projection.statuses, [
    { label: 'worker-a', status: 'running' },
    { label: 'worker-b', status: 'completed' },
  ]);
  assert.match(projection.resultHtml, /Inspect the parser/);
  assert.match(projection.resultHtml, /Tests complete/);
  assert.equal(detail.timelineSections.some((section) => section.title === 'Response summary'), false);
});
