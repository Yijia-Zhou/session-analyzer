'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { buildIndex } = require('../src/codex');
const { createServer } = require('../server');

const fixtureCodexHome = path.join(__dirname, '..', 'test', 'fixtures', 'codex-home');
const repoRoot = 'G:\\vibe\\term-agent';
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';

async function buildFixtureIndex() {
  return buildIndex({ repoRoot, codexHome: fixtureCodexHome });
}

async function startServer(t, index) {
  const server = createServer(index, 1, { codexHome: index.codexHome, repo: index.repoRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function openApp(t, index, options = {}) {
  const baseUrl = await startServer(t, index);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 } });
  if (options.localStorage) {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, value);
      }
    }, options.localStorage);
  }
  if (options.locale) {
    await context.addInitScript((locale) => {
      localStorage.setItem('sessionAnalyzer.locale', locale);
    }, options.locale);
  }
  const page = await context.newPage();
  const requestedPaths = [];
  page.on('request', (request) => {
    const parsed = new URL(request.url());
    if (parsed.origin === baseUrl) requestedPaths.push(parsed.pathname);
  });
  page.on('pageerror', (error) => assert.fail(error.stack || error.message));
  t.after(async () => {
    await context.close();
    await browser.close();
  });
  await page.goto(baseUrl);
  assert.ok(requestedPaths.includes('/assets/app.js'), 'browser should load the generated app bundle');
  for (const oldScript of ['/app.js', '/renderers.js', '/folding.js', '/command-highlighting.js', '/search-query.js', '/highlight.js', '/navigation.js', '/event-chips.js']) {
    assert.equal(requestedPaths.includes(oldScript), false, `browser should not load old source script ${oldScript}`);
  }
  await page.waitForFunction(() => window.sessionFolding && window.sessionRenderers && window.sessionSearchQuery);
  await page.waitForSelector('.sessionItem.active', { state: options.activeSessionState || 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length > 0);
  return { page, baseUrl, requestedPaths };
}

async function selectPrimarySession(page) {
  const session = page.locator(`[data-session-id="${primaryFixtureSessionId}"]`);
  await session.click();
  await assertEventCount(page, 29);
  await expectInputValue(page, '#searchInput', '');
}

async function assertEventCount(page, expected) {
  await page.waitForFunction((count) => document.querySelectorAll('#timeline .event[data-event-id]').length === count, expected);
}

async function expectInputValue(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: target, expected: value }) => document.querySelector(target)?.value === value,
    { selector, expected },
  );
}

async function fillSearch(page, value) {
  await page.locator('#searchInput').fill(value);
  await page.locator('#searchInput').dispatchEvent('input');
}

async function waitForSearchMarks(page, minimum = 1) {
  await page.waitForFunction((count) => document.querySelectorAll('.searchMark').length >= count, minimum);
}

async function waitForNoSearchMarks(page) {
  await page.waitForFunction(() => document.querySelectorAll('.searchMark').length === 0);
}

async function makeLongCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-'));
  const longRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'edededed-eded-eded-eded-edededededed';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '11');
  const file = path.join(dir, `rollout-2026-06-11T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(longRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    {
      timestamp: '2026-06-11T09:00:00.000Z',
      type: 'session_meta',
      payload: { id: sessionId, cwd: longRepoRoot },
    },
  ];
  for (let i = 0; i < 180; i += 1) {
    rows.push({
      timestamp: `2026-06-11T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      type: 'response_item',
      payload: {
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Long timeline row ${i} ${i % 17 === 0 ? 'needle' : 'ordinary'}` }],
      },
    });
  }
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: longRepoRoot };
}

async function makeHookCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-hook-'));
  const hookRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'abababab-abab-abab-abab-abababababab';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '12');
  const file = path.join(dir, `rollout-2026-06-12T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(hookRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    {
      timestamp: '2026-06-12T09:00:00.000Z',
      type: 'session_meta',
      payload: { id: sessionId, cwd: hookRepoRoot },
    },
  ];
  for (let i = 0; i < 170; i += 1) {
    rows.push({
      timestamp: `2026-06-12T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      type: 'response_item',
      payload: {
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Catalog seed row ${i}` }],
      },
    });
  }
  rows.push(
    {
      timestamp: '2026-06-12T09:03:00.000Z',
      type: 'event_msg',
      payload: { type: 'hook_begin', call_id: 'call-hook', tool_name: 'pre_apply_hook', hook: 'pre-apply' },
    },
    {
      timestamp: '2026-06-12T09:03:01.000Z',
      type: 'event_msg',
      payload: { type: 'hook_end', call_id: 'call-hook', tool_name: 'pre_apply_hook', status: 'completed' },
    },
  );
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: hookRepoRoot, sessionId };
}

test('browser locale bootstrap keeps narrow screens on sessions view', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { viewport: { width: 390, height: 760 }, locale: 'zh-CN', activeSessionState: 'attached' });

  await page.waitForFunction(() => document.body.dataset.mobileView === 'sessions');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');

  await fillSearch(page, 'patch');
  await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('patch'));
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');
});

test('browser locale localizes static shell and dirty profile dialog', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('logical events'));
  assert.equal(await page.locator('#dirtyProfileTitle').textContent(), 'Unsaved folding strategy changes');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Search messages, commands, files, output');

  await page.locator('#localeSelect').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), '搜索消息、命令、文件、输出');
  assert.equal(await page.locator('.mobileViewTab[data-mobile-view="events"]').textContent(), '事件');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /加载更多|已加载|加载中/);
  await fillSearch(page, 'zzzz-no-match');
  await page.waitForFunction(() => document.querySelector('[data-search-match-count]')?.textContent === '无匹配');
  await fillSearch(page, '');

  await page.locator('#localeSelect').selectOption('en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  await selectPrimarySession(page);
  const messagesMetricTitle = await page.locator('.metric', { hasText: 'Messages' }).getAttribute('title');
  assert.match(messagesMetricTitle || '', /Switch to conversation reading folding strategy/);
  assert.equal((messagesMetricTitle || '').includes('切换到'), false);
  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.locator('#detail [data-profile-picker]').selectOption('conversation');
  await page.waitForSelector('#dirtyProfileDialog:not([hidden])');

  assert.equal(await page.locator('#dirtyProfileTitle').textContent(), 'Unsaved folding strategy changes');
  assert.equal(await page.locator('#dirtyProfileMessage').textContent(), 'Before switching strategies, save the current changes, discard them, or stay on the current strategy.');
  assert.equal(await page.locator('[data-dirty-profile-choice="save"]').textContent(), 'Save and switch');
  assert.equal(await page.locator('[data-dirty-profile-choice="discard"]').textContent(), 'Discard and switch');
  assert.equal(await page.locator('[data-dirty-profile-choice="cancel"]').textContent(), 'Cancel');
});

test('browser locale switch preserves unsaved folding draft', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');

  await page.locator('#localeSelect').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');

  await expectInputValue(page, '#detail [data-profile-kind="command"]', 'expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));
});

test('browser locale switch reloads cached expanded event detail', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  const detailResponseFor = (locale) => (response) => {
    const parsed = new URL(response.url());
    return parsed.pathname.includes('/events/')
      && parsed.pathname.endsWith('/detail')
      && parsed.searchParams.get('locale') === locale
      && response.status() === 200;
  };

  const event = page.locator('#timeline .event.kind-command').first();
  await Promise.all([
    page.waitForResponse(detailResponseFor('en')),
    event.click(),
  ]);
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody');

  await Promise.all([
    page.waitForResponse(detailResponseFor('zh-CN')),
    page.locator('#localeSelect').selectOption('zh-CN'),
  ]);
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody');
});

test('browser find keeps loaded timeline range and clearing find does not reset pagination', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index);

  await assertEventCount(page, 150);
  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 180);

  await fillSearch(page, 'needle');
  await assertEventCount(page, 180);
  await waitForSearchMarks(page);

  await page.locator('#resultSummary [data-clear-filter="q"]').click();
  await expectInputValue(page, '#searchInput', '');
  await assertEventCount(page, 180);
  await waitForNoSearchMarks(page);
});

test('browser inspector search reacquires live marks after redraw', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await page.locator('#searchInput').press('Enter');
  await page.waitForSelector('#detail .searchMark');
  const firstDetailTitle = await page.locator('#detail h2').first().textContent();

  await page.locator('[data-search-match-nav="next"]').first().click();
  await page.waitForFunction((title) => document.querySelector('#detail h2')?.textContent !== title, firstDetailTitle);
  await page.waitForSelector('#detail .searchMark.activeSearchMark, #detail .searchMark');
});

test('browser read from here clears structured filters and preserves free text', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await fillSearch(page, 'failed kind:patch');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length > 0 && events.every((event) => event.classList.contains('kind-patch'));
  });
  await page.locator('#timeline .event.kind-patch.status-failed').first().click();
  await page.waitForSelector('[data-detail-action="read-from-here"]');
  const selectedId = await page.locator('#timeline .event.selected').first().getAttribute('data-event-id');

  await page.locator('[data-detail-action="read-from-here"]').click();
  await expectInputValue(page, '#searchInput', 'failed');
  await expectInputValue(page, '#layerSelect', 'main');
  await assertEventCount(page, 29);
  await page.waitForFunction((id) => document.querySelector('#timeline .event.selected')?.dataset.eventId === id, selectedId);
});

test('browser folding profile edits save, cancel, and repair invalid localStorage state', async (t) => {
  const index = await buildFixtureIndex();
  const { page, baseUrl } = await openApp(t, index);
  await selectPrimarySession(page);

  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="subagent"]').count(), 0);
  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));
  await page.locator('#detail [data-detail-action="save-profile"]').click();
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value.startsWith('custom:'));
  const savedProfileId = await page.locator('#profileSelect').inputValue();

  await page.reload();
  await page.waitForSelector('.sessionItem.active');
  await selectPrimarySession(page);
  await expectInputValue(page, '#profileSelect', savedProfileId);
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));

  await page.locator('[data-profile-kind="command"]').selectOption('hidden');
  await page.waitForSelector('#detail [data-detail-action="cancel-profile"]');
  await page.locator('#detail [data-detail-action="cancel-profile"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));

  await page.evaluate(() => localStorage.setItem('sessionAnalyzer.profile', 'missing-profile'));
  await page.goto(baseUrl);
  await page.waitForSelector('.sessionItem.active');
  await expectInputValue(page, '#profileSelect', 'narrative');
  const repaired = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.profile'));
  assert.equal(repaired, 'narrative');
});

test('browser folding profile seeds dynamic kinds from the full session catalog', async (t) => {
  const fixture = await makeHookCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const { page } = await openApp(t, index);

  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.kind-hook').length === 0);
  await page.waitForSelector('#detail [data-profile-kind="hook"]');
  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').inputValue(), 'summary');
});

test('browser folding profile ignores inherited dynamic kinds in legacy custom profiles', async (t) => {
  const index = await buildFixtureIndex();
  const legacyProfile = {
    id: 'custom:legacy',
    name: 'Legacy custom profile',
    description: 'Saved before custom profile base ids were available.',
    rules: {
      kindStates: {
        user_message: 'expanded',
        assistant_message: 'expanded',
        hook: 'summary',
      },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([legacyProfile]),
    },
  });
  await selectPrimarySession(page);

  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').count(), 0);
});

test('browser issues metric toggles error-focus profile without losing session or adding filters', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  const issuesMetric = page.locator('.metric', { hasText: 'Issues' }).first();
  await issuesMetric.click();
  await expectInputValue(page, '#profileSelect', 'debug');
  await expectInputValue(page, '#searchInput', '');
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, primaryFixtureSessionId);
  assert.equal(await issuesMetric.getAttribute('aria-pressed'), 'true');

  await issuesMetric.click();
  await expectInputValue(page, '#profileSelect', 'narrative');
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, primaryFixtureSessionId);
});

test('browser expanded event collapse works with mouse and keyboard controls', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  const firstEvent = page.locator('#timeline .event[data-event-id]').first();
  const headerToggle = firstEvent.locator('.eventHeader [data-action="toggle"]');
  const footerToggle = firstEvent.locator('.eventFooterActions [data-action="toggle"]');
  await firstEvent.click();
  await page.waitForFunction(() => document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
  await footerToggle.click();
  await page.waitForFunction(() => !document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));

  await headerToggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
  await footerToggle.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
});
