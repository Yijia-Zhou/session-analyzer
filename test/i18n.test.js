'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const i18n = require('../src/shared/i18n');
const { buildIndex, getTimeline, buildEventDetail } = require('../src/codex');
const { createServer } = require('../server');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const fixtureRepo = 'G:\\vibe\\term-agent';
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';

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
  assert.equal(i18n.t('zh-CN', 'ui', 'mainTimeline'), 'Main timeline');
  assert.equal(i18n.displayStateLabel('expanded', 'zh-CN'), '展开');
  assert.equal(i18n.eventKindLabel('command', 'zh-CN'), 'Command');
});

test('timeline/detail locale changes display fields without changing machine fields', async () => {
  const index = await buildIndex({ codexHome: fixtureCodexHome, repoRoot: fixtureRepo });
  const session = index.sessions.find((item) => item.logicalEvents.some((event) => event.layer === 'main'));
  const timeline = getTimeline(index, session.id, { layer: 'main', offset: 0, limit: 20, q: '', locale: 'zh-CN' });
  const event = timeline.events.find((item) => item.kind === 'command') || timeline.events[0];
  const detail = buildEventDetail(session, event.id, event.layer, { locale: 'zh-CN' });

  assert.equal(event.schemaVersion, 1);
  assert.equal(event.sourceKind, 'codex');
  assert.equal(event.layer, 'main');
  assert.ok(event.rawRefs.every((ref) => ref.sourceLocator?.type === 'jsonl_line'));
  assert.equal(detail.kind, event.kind);
  assert.equal(detail.sourceKind, 'codex');
});

test('locale keeps curated protocol labels more specific than event kind', async () => {
  const index = await buildIndex({ codexHome: fixtureCodexHome, repoRoot: fixtureRepo });
  const session = index.sessionsById.get(primaryFixtureSessionId);
  const timeline = getTimeline(index, session.id, { layer: 'protocol', offset: 0, limit: 200, q: '', locale: 'zh-CN' });
  const event = timeline.events.find((item) => item.kind === 'reasoning' && item.label === 'Empty reasoning');

  assert.ok(event, 'protocol timeline should preserve the curated Empty reasoning label');
  const detail = buildEventDetail(session, event.id, 'protocol', { locale: 'zh-CN' });
  assert.equal(detail.title, 'Empty reasoning');
  assert.equal(detail.kind, 'reasoning');
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
