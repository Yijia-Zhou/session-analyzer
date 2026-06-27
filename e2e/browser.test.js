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
  const requestedUrls = [];
  page.on('request', (request) => {
    const parsed = new URL(request.url());
    if (parsed.origin === baseUrl) {
      requestedPaths.push(parsed.pathname);
      requestedUrls.push(`${parsed.pathname}${parsed.search}`);
    }
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
  return { page, baseUrl, requestedPaths, requestedUrls };
}

async function switchHiddenLocale(page, locale) {
  await page.locator('#localeSelect').evaluate((select, nextLocale) => {
    select.value = nextLocale;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, locale);
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

async function waitForDetailView(page, type) {
  await page.waitForFunction((expected) => document.body.dataset.detailView === expected, type);
}

async function moveToLastSearchMark(page) {
  const snapshot = () => page.evaluate(() => {
    const marks = [...document.querySelectorAll('.searchMark')];
    const active = document.querySelector('.searchMark.activeSearchMark');
    const index = marks.indexOf(active);
    const root = active?.closest('#sessionList, #timeline, #detail')?.id || '';
    const eventId = active?.closest('[data-event-id]')?.dataset.eventId || '';
    return {
      atLast: marks.length > 0 && index === marks.length - 1,
      identity: `${root}:${eventId}:${active?.textContent || ''}:${index}`,
    };
  });

  for (let i = 0; i < 50; i += 1) {
    const before = await snapshot();
    if (before.atLast) return;
    await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
    await page.waitForFunction((identity) => {
      const marks = [...document.querySelectorAll('.searchMark')];
      const active = document.querySelector('.searchMark.activeSearchMark');
      const index = marks.indexOf(active);
      const root = active?.closest('#sessionList, #timeline, #detail')?.id || '';
      const eventId = active?.closest('[data-event-id]')?.dataset.eventId || '';
      return `${root}:${eventId}:${active?.textContent || ''}:${index}` !== identity;
    }, before.identity);
  }
  assert.fail('search navigation did not reach the last live mark');
}

async function openColdLongSearchInspector(page) {
  await assertEventCount(page, 150);
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.includes('37 full-text hits'));
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/timeline')
        && url.searchParams.get('q') === 'needle'
        && url.searchParams.get('offset') === '0'
        && url.searchParams.get('limit') === '150';
    }),
    page.locator('#searchInput').blur(),
  ]);
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail...'));
  return page.locator('#timeline .event.selected').getAttribute('data-event-id');
}

async function makeLongCodexHome(t, options = {}) {
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
  if (options.includeCommandDetailNeedles) {
    rows.push(
      {
        timestamp: '2026-06-11T09:00:00.100Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_begin',
          call_id: 'call-needle-detail',
          command: ['powershell.exe', '-Command', 'Write-Output detail'],
          cwd: longRepoRoot,
        },
      },
      {
        timestamp: '2026-06-11T09:00:00.200Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          call_id: 'call-needle-detail',
          command: ['powershell.exe', '-Command', 'Write-Output detail'],
          cwd: longRepoRoot,
          stdout: 'needle detail needle detail needle detail',
          stderr: '',
          exit_code: 0,
          status: 'completed',
        },
      },
    );
  }
  const eventCount = options.eventCount || 180;
  for (let i = 0; i < eventCount; i += 1) {
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
  return { codexHome, repoRoot: longRepoRoot, sessionId };
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
  assert.equal(await page.locator('.localeControl').isVisible(), false);
  assert.equal(await page.locator('#localeSelect').count(), 1);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), '搜索消息、命令、文件、输出');
  assert.equal(await page.locator('.mobileViewTab[data-mobile-view="events"]').textContent(), '事件');
  assert.equal(await page.locator('#searchStatusSelect option[value="complete"]').textContent(), '目标已完成');
  assert.equal(await page.locator('#searchStatusSelect option[value="completed"]').textContent(), '事件已完成');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /加载更多|已加载|加载中/);
  await fillSearch(page, 'zzzz-no-match');
  await page.waitForFunction(() => document.querySelector('[data-search-match-count]')?.textContent === '无匹配');
  await fillSearch(page, '');

  await switchHiddenLocale(page, 'en');
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

  await switchHiddenLocale(page, 'zh-CN');
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
    switchHiddenLocale(page, 'zh-CN'),
  ]);
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody');
});

test('browser find keeps loaded timeline range and clearing find does not reset pagination', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

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

test('browser search count separates jump targets from full-text hits', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page);

  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent === '1 / 9 jump targets · 11 full-text hits'
  ));
});

test('browser search navigation loads only the next hit page before wrapping', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.includes('37 full-text hits'));

  const inspectorRequestStart = requestedUrls.length;
  await moveToLastSearchMark(page);

  const inspectorRequests = requestedUrls.slice(inspectorRequestStart)
    .filter((value) => value.includes('/timeline?'));
  assert.equal(
    inspectorRequests.some((value) => new URL(value, 'http://local').searchParams.get('limit') === '500'),
    false,
    `search-origin inspector should not preload navigation events: ${inspectorRequests.join(', ')}`,
  );

  const boundaryRequestStart = requestedUrls.length;
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();

  await assertEventCount(page, 300);
  await page.waitForFunction(() => (
    document.querySelector('#timeline mark.searchMark.activeSearchMark')
      ?.closest('[data-event-id]')
      ?.textContent
      ?.includes('Long timeline row 153')
  ));

  const boundaryRequests = requestedUrls.slice(boundaryRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(boundaryRequests.length, 1, `expected one UI timeline page, got ${boundaryRequests.map((url) => url.href).join(', ')}`);
  assert.equal(boundaryRequests[0].searchParams.get('offset'), '150');
  assert.equal(boundaryRequests[0].searchParams.get('limit'), '150');
  assert.equal(boundaryRequests[0].searchParams.get('q'), 'needle');
  assert.equal(boundaryRequests.some((url) => url.searchParams.get('limit') === '500'), false);
  assert.equal(boundaryRequests.some((url) => Number(url.searchParams.get('offset')) >= 300), false);
});

test('browser search inspector hides idle navigation and user confirmation loads it', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  const transientRequestStart = requestedUrls.length;
  const eventId = await openColdLongSearchInspector(page);
  assert.ok(eventId);
  assert.equal(await page.locator('#detail .eventNavigator').count(), 0);
  assert.equal(await page.locator('#detail .navStatus').count(), 0);
  assert.equal(
    requestedUrls.slice(transientRequestStart).some((value) => (
      value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '500'
    )),
    false,
  );

  let releaseNavigation;
  const navigationGate = new Promise((resolve) => { releaseNavigation = resolve; });
  t.after(() => releaseNavigation());
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle'
        && url.searchParams.get('offset') === '0'
        && url.searchParams.get('limit') === '500') {
      await navigationGate;
    }
    await route.continue();
  });

  const navigationRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
  });
  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await navigationRequest;
  await page.waitForSelector('#detail .eventNavigator .navStatus');
  releaseNavigation();

  await page.waitForSelector('#detail .eventNavigator .navPosition');
  assert.equal(await page.locator('#detail .navStatus').count(), 0);
  assert.equal(await page.locator('#timeline .event.selected').getAttribute('data-event-id'), eventId);

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'inspector');
});

test('browser inspector navigation failure clears loading and explicit click retries', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  const eventId = await openColdLongSearchInspector(page);
  assert.ok(eventId);
  const requestStart = requestedUrls.length;
  const previousStateLine = await page.locator('#stateLine').textContent();
  let failNavigation = true;
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (failNavigation && url.searchParams.get('limit') === '500') {
      failNavigation = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await page.waitForFunction((previous) => document.querySelector('#stateLine')?.textContent !== previous, previousStateLine);
  await page.waitForFunction(() => !document.querySelector('#detail .eventNavigator'));

  const navigationRequests = requestedUrls.slice(requestStart).filter((value) => (
    value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '500'
  ));
  assert.equal(navigationRequests.length, 1);
  assert.equal(await page.locator('#detail .navStatus').count(), 0);

  const retryRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
  });
  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await retryRequest;
  await page.waitForSelector('#detail .eventNavigator .navPosition');

  const retriedNavigationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('limit') === '500');
  assert.deepEqual(retriedNavigationRequests.map((url) => url.searchParams.get('offset')), ['0', '0', '500']);
  assert.equal(await page.locator('#detail .navStatus').count(), 0);
});

test('browser previous search navigation scans backward wrap through UI pages', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.includes('37 full-text hits'));
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/timeline')
        && url.searchParams.get('q') === 'needle'
        && url.searchParams.get('offset') === '0'
        && url.searchParams.get('limit') === '150';
    }),
    page.locator('#searchInput').blur(),
  ]);
  await assertEventCount(page, 150);

  const boundaryRequestStart = requestedUrls.length;
  await page.locator('.searchInlineMatches [data-search-match-nav="previous"]').click();
  await Promise.all([
    assertEventCount(page, 620),
    page.waitForFunction(() => (
      document.querySelector('#timeline mark.searchMark.activeSearchMark')
        ?.closest('[data-event-id]')
        ?.textContent
        ?.includes('Long timeline row 612')
    )),
  ]);

  const boundaryRequests = requestedUrls.slice(boundaryRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(
    boundaryRequests.map((url) => ({
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit'),
      q: url.searchParams.get('q'),
    })),
    [
      { offset: '150', limit: '150', q: 'needle' },
      { offset: '300', limit: '150', q: 'needle' },
      { offset: '450', limit: '150', q: 'needle' },
      { offset: '600', limit: '150', q: 'needle' },
    ],
  );
  assert.equal(boundaryRequests.some((url) => url.searchParams.get('offset') === '0'), false);
  assert.equal(boundaryRequests.some((url) => url.searchParams.get('limit') === '500'), false);
});

test('browser search navigation ignores detail marks when checking unmaterialized hits', async (t) => {
  const longFixture = await makeLongCodexHome(t, { includeCommandDetailNeedles: true });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await page.locator('#timeline .event.kind-command').first().click();
  await waitForDetailView(page, 'inspector');
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('needle detail needle detail needle detail'));
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 14);
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.includes('14 full-text hits'));

  const liveMarks = await page.locator('.searchMark').count();
  assert.ok(liveMarks >= 14, `expected detail marks to raise live marks to at least backend hits, got ${liveMarks}`);
  assert.ok(await page.locator('#timeline mark.searchMark').count() < 14);
  assert.ok(await page.locator('#detail mark.searchMark').count() >= 3);

  await moveToLastSearchMark(page);
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await Promise.all([
    assertEventCount(page, 181),
    page.waitForFunction(() => (
      document.querySelector('#timeline mark.searchMark.activeSearchMark')
        ?.closest('[data-event-id]')
        ?.textContent
        ?.includes('Long timeline row 153')
    )),
  ]);
});

test('browser search navigation temporarily expands hidden command detail targets', async (t) => {
  const index = await buildFixtureIndex();
  const hiddenCommandProfile = {
    id: 'custom:hidden-command',
    name: 'Hidden command search test',
    description: 'Hide commands so search navigation must materialize command details.',
    rules: {
      kindStates: { command: 'hidden' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenCommandProfile]),
      'sessionAnalyzer.profile': hiddenCommandProfile.id,
    },
  });
  await selectPrimarySession(page);

  await page.waitForFunction(() => document.querySelector('#timeline .event.kind-command.hiddenByProfile'));
  await fillSearch(page, 'alpha failed');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent === '0 / 0 jump targets · 1 full-text hits');

  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody mark.searchMark.activeSearchMark');

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await page.waitForFunction(() => document.querySelector('#timeline .event.kind-command.hiddenByProfile'));
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

test('browser search-transient detail closes when free text no longer matches', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await page.locator('#searchInput').press('Enter');
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, 'definitely-no-search-hit');
  await waitForNoSearchMarks(page);
  await waitForDetailView(page, 'profileRules');

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await page.locator('#searchInput').press('Enter');
  await waitForDetailView(page, 'inspector');

  await page.locator('#resultSummary [data-clear-filter="q"]').click();
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'profileRules');
});

test('browser user-confirmed inspector and raw refs persist across free-text changes', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, 'definitely-no-search-hit');
  await waitForNoSearchMarks(page);
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'inspector');

  await page.locator('[data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');

  await fillSearch(page, 'definitely-no-search-hit');
  await waitForNoSearchMarks(page);
  await waitForDetailView(page, 'rawRefs');

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'rawRefs');
});

test('browser passive search refresh does not downgrade user-confirmed detail views', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await page.locator('#timeline .event[data-event-id]:not(.kind-patch)').first().click();
  await waitForDetailView(page, 'inspector');
  const confirmedTitle = await page.locator('#detail h2').textContent();

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await waitForDetailView(page, 'inspector');
  assert.equal(await page.locator('#detail h2').textContent(), confirmedTitle);

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'inspector');
  assert.equal(await page.locator('#detail h2').textContent(), confirmedTitle);

  await page.locator('[data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction((title) => document.querySelector('#detail h2')?.textContent !== title, confirmedTitle);
  const rawTitle = await page.locator('#detail h2').textContent();

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await waitForDetailView(page, 'rawRefs');
  assert.equal(await page.locator('#detail h2').textContent(), rawTitle);

  await page.locator('#searchInput').press('Enter');
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction((title) => document.querySelector('#detail h2')?.textContent !== title, rawTitle);

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'profileRules');
});

test('browser user-confirmed detail closes when structured filters remove the selected event', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await page.locator('#timeline .event[data-event-id]:not(.kind-patch)').first().click();
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, 'kind:patch');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length > 0 && events.every((event) => event.classList.contains('kind-patch'));
  });
  await waitForDetailView(page, 'profileRules');
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
  const fallbackPlacement = await page.locator('#detail [data-profile-fallback]').evaluate((select) => ({
    inDefaultDetailsSummary: Boolean(document.querySelector('#detail .profileRuleDetails:first-of-type summary')?.contains(select)),
    inSectionHeader: Boolean(select.closest('.profileRuleSectionHeader')),
  }));
  assert.deepEqual(fallbackPlacement, { inDefaultDetailsSummary: true, inSectionHeader: false });
  await page.locator('#detail [data-profile-fallback]').selectOption('collapsed');
  await expectInputValue(page, '#detail [data-profile-fallback]', 'collapsed');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForSelector('#detail [data-detail-action="cancel-profile"]');
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
