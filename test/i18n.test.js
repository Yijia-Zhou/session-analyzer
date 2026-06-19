'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const i18n = require('../src/shared/i18n');
const { buildIndex, getTimeline, buildEventDetail, eventKindCatalog } = require('../src/codex');
const { createServer } = require('../server');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const fixtureRepo = 'G:\\vibe\\term-agent';
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';
const allowedZhTerms = new Set([
  'agents.md',
  'api',
  'chatgpt',
  'cli',
  'codex',
  'css',
  'dom',
  'dto',
  'figma',
  'function_call',
  'gb18030',
  'github',
  'html',
  'http',
  'https',
  'id',
  'js',
  'json',
  'jsonl',
  'markdown',
  'mcp',
  'mime',
  'node.js',
  'npm',
  'openai',
  'playwright',
  'powershell',
  'session',
  'sessions',
  'transcript',
  'uri',
  'url',
  'utf-8',
  'uuid',
  'agent',
  'review',
  'subagent',
]);
const allowedZhPhrases = [
  'JS REPL',
];

function stripAllowedNoise(value) {
  let text = String(value || '').replace(/\{[A-Za-z0-9_]+\}/g, ' ');
  for (const phrase of allowedZhPhrases) {
    text = text.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  return text;
}

function asciiTokens(value) {
  const stripped = stripAllowedNoise(value);
  return stripped.match(/[A-Za-z][A-Za-z0-9_]*(?:[.-][A-Za-z0-9_]+)*/g) || [];
}

function catalogStrings(source, pathParts = []) {
  if (Array.isArray(source)) {
    return source.flatMap((item, index) => catalogStrings(item, [...pathParts, String(index)]));
  }
  if (source && typeof source === 'object') {
    return Object.keys(source)
      .sort()
      .flatMap((key) => catalogStrings(source[key], [...pathParts, key]));
  }
  return typeof source === 'string' ? [{ path: pathParts.join('.'), value: source }] : [];
}

function requestJson(server, requestPath) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ hostname: '127.0.0.1', port, path: requestPath }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

test('i18n resolves supported locales and falls back predictably', () => {
  assert.equal(i18n.resolveLocale('zh'), 'zh-CN');
  assert.equal(i18n.resolveLocale('zh-CN,zh;q=0.9'), 'zh-CN');
  assert.equal(i18n.resolveLocale('en-US'), 'en');
  assert.equal(i18n.resolveLocale('fr-FR'), 'en');
  assert.equal(i18n.t('zh-CN', 'ui', 'mainTimeline'), '主时间线');
  assert.equal(i18n.displayStateLabel('expanded', 'zh-CN'), '展开');
  assert.equal(i18n.eventKindLabel('command', 'zh-CN'), '命令');
  assert.equal(i18n.eventKindLabel('goal', 'zh-CN'), '目标');
  assert.equal(i18n.eventKindLabel('goal_context', 'zh-CN'), '目标上下文');
  assert.equal(i18n.statusLabel('blocked', 'zh-CN'), '已阻塞');
  assert.equal(i18n.humanize('mcp_tool_call'), 'MCP Tool Call');
  assert.equal(i18n.humanize('js_repl'), 'JS REPL');
});

test('known label lookup translates exact keys and English catalog values without losing fallback compatibility', () => {
  assert.equal(i18n.lookupKnownLabel('Failed command', 'zh-CN'), '失败命令');
  assert.equal(i18n.lookupKnownLabel('Goal complete', 'zh-CN'), '目标已完成');
  assert.equal(i18n.lookupKnownLabel('Incomplete goal call', 'zh-CN'), '目标调用未完成');
  assert.equal(i18n.lookupKnownLabel('user_message', 'zh-CN'), '用户消息');
  assert.equal(i18n.lookupKnownLabel('User message', 'zh-CN'), '用户消息');
  assert.equal(i18n.lookupKnownLabel('Web search', 'zh-CN'), '网页搜索');
  assert.equal(i18n.lookupKnownLabel('Image Generation', 'zh-CN'), '图片生成');
  assert.equal(i18n.lookupKnownLabel('No such label', 'zh-CN'), '');
  assert.equal(i18n.knownLabel('No such label', 'zh-CN'), 'No such label');
});

test('strict known label lookup does not treat default-locale fallback as a zh-CN hit', () => {
  const zhLogicalLabels = i18n.catalogs['zh-CN'].logicalLabel;
  const original = zhLogicalLabels['Failed command'];
  delete zhLogicalLabels['Failed command'];
  try {
    assert.equal(i18n.lookupKnownLabel('Failed command', 'zh-CN'), '');
    assert.equal(i18n.knownLabel('Failed command', 'zh-CN'), 'Failed command');
  } finally {
    zhLogicalLabels['Failed command'] = original;
  }
});

test('unknown display labels use shared humanization without changing machine values', () => {
  const catalog = eventKindCatalog([{
    logicalEvents: [
      { layer: 'main', kind: 'future_toolCall' },
      { layer: 'protocol', kind: 'protocol', subtype: 'mcp_custom_event' },
    ],
    rawEvents: [
      { recordType: 'event_msg', payloadType: 'future_raw_type' },
    ],
  }]);

  assert.deepEqual(catalog.main[0], { value: 'future_toolCall', label: 'Future Tool Call', count: 1 });
  assert.deepEqual(catalog.protocol[0], { value: 'mcp_custom_event', label: 'MCP Custom Event', count: 1 });
  assert.deepEqual(catalog.raw[0], { value: 'future_raw_type', label: 'future_raw_type', count: 1 });
});

test('zh-CN catalog only keeps approved English terms in display text', () => {
  const offenders = [];
  for (const entry of catalogStrings(i18n.catalogs['zh-CN'])) {
    const unexpected = asciiTokens(entry.value)
      .filter((token) => !allowedZhTerms.has(token.toLowerCase()));
    if (unexpected.length) {
      offenders.push(`${entry.path}: ${JSON.stringify(entry.value)} -> ${[...new Set(unexpected)].join(', ')}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test('timeline/detail locale changes display fields without changing machine fields', async () => {
  const index = await buildIndex({ codexHome: fixtureCodexHome, repoRoot: fixtureRepo });
  const session = index.sessionsById.get(primaryFixtureSessionId);
  const timeline = getTimeline(index, session.id, { layer: 'main', offset: 0, limit: 200, q: '', locale: 'zh-CN' });
  const userMessage = timeline.events.find((item) => item.kind === 'user_message');
  const failedCommand = timeline.events.find((item) => item.kind === 'command' && item.status === 'failed');
  const patchApplied = timeline.events.find((item) => item.kind === 'patch' && item.status === 'success');

  assert.ok(userMessage, 'fixture should include a user message event');
  assert.ok(failedCommand, 'fixture should include a failed command event');
  assert.ok(patchApplied, 'fixture should include a successful patch event');

  const userDetail = buildEventDetail(session, userMessage.id, userMessage.layer, { locale: 'zh-CN' });
  const failedCommandDetail = buildEventDetail(session, failedCommand.id, failedCommand.layer, { locale: 'zh-CN' });
  const patchAppliedDetail = buildEventDetail(session, patchApplied.id, patchApplied.layer, { locale: 'zh-CN' });

  assert.equal(userMessage.label, '用户消息');
  assert.equal(failedCommand.label, '失败命令');
  assert.equal(patchApplied.label, '补丁已应用');
  assert.equal(userDetail.title, '用户消息');
  assert.equal(failedCommandDetail.title, '失败命令');
  assert.equal(patchAppliedDetail.title, '补丁已应用');

  assert.equal(userMessage.schemaVersion, 1);
  assert.equal(failedCommand.sourceKind, 'codex');
  assert.equal(patchApplied.layer, 'main');
  assert.ok(failedCommand.rawRefs.every((ref) => ref.sourceLocator?.type === 'jsonl_line'));
  assert.equal(userDetail.kind, 'user_message');
  assert.equal(failedCommandDetail.kind, 'command');
  assert.equal(patchAppliedDetail.kind, 'patch');
  assert.equal(failedCommand.status, 'failed');
  assert.equal(patchApplied.status, 'success');
  assert.equal(failedCommandDetail.sourceKind, 'codex');
});

test('locale keeps curated protocol labels more specific than event kind', async () => {
  const index = await buildIndex({ codexHome: fixtureCodexHome, repoRoot: fixtureRepo });
  const session = index.sessionsById.get(primaryFixtureSessionId);
  const timeline = getTimeline(index, session.id, { layer: 'protocol', offset: 0, limit: 200, q: '', locale: 'zh-CN' });
  const event = timeline.events.find((item) => item.kind === 'reasoning' && !item.hasReadableReasoning);

  assert.ok(event, 'protocol timeline should preserve the curated Empty reasoning label');
  const detail = buildEventDetail(session, event.id, 'protocol', { locale: 'zh-CN' });
  assert.equal(event.label, '空推理');
  assert.equal(detail.title, '空推理');
  assert.equal(detail.kind, 'reasoning');
});

test('raw timeline and detail labels localize display text without changing raw machine fields', async () => {
  const index = await buildIndex({ codexHome: fixtureCodexHome, repoRoot: fixtureRepo });
  const session = index.sessionsById.get(primaryFixtureSessionId);
  const timeline = getTimeline(index, session.id, { layer: 'raw', offset: 0, limit: 20, q: '', locale: 'zh-CN' });
  const event = timeline.events.find((item) => item.payloadType === 'task_started');
  const kindOption = timeline.eventKinds.raw.find((item) => item.value === 'task_started');

  assert.ok(event);
  assert.ok(kindOption);
  const detail = buildEventDetail(session, event.id, 'raw', { locale: 'zh-CN' });
  assert.equal(event.label, '任务开始');
  assert.equal(kindOption.label, '任务开始');
  assert.equal(detail.title, '任务开始');
  assert.equal(event.recordType, 'event_msg');
  assert.equal(event.payloadType, 'task_started');
  assert.equal(event.sourceRecordType, 'event_msg');
  assert.equal(event.sourceEventType, 'task_started');
  assert.equal(detail.sourceRecordType, 'event_msg');
  assert.equal(detail.sourceEventType, 'task_started');
});

test('state API localizes display resources while preserving ids', async () => {
  const index = await buildIndex({ codexHome: fixtureCodexHome, repoRoot: fixtureRepo });
  const server = createServer(index, 1, { codexHome: fixtureCodexHome });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { status, body } = await requestJson(server, '/api/state?locale=zh-CN');
    assert.equal(status, 200);
    assert.equal(body.locale, 'zh-CN');
    assert.ok(body.supportedLocales.includes('en'));
    assert.ok(body.supportedLocales.includes('zh-CN'));
    const narrative = body.foldingProfiles.find((profile) => profile.id === 'narrative');
    assert.equal(narrative.name, '叙事时间线');
    assert.equal(narrative.rules.fallback, 'summary');
    assert.ok(body.eventKinds.main.every((item) => item.value && item.label));
    const rawAgentMessage = body.eventKinds.raw.find((item) => item.value === 'agent_message');
    assert.equal(rawAgentMessage.label, 'agent 消息');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
