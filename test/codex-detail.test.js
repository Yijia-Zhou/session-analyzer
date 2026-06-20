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
