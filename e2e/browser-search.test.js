'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');

const {
  repoRoot,
  deferred,
  buildFixtureIndex,
  openApp,
  openWave1cM1App,
  latestWave1cM1Lifecycle,
  switchHiddenLocale,
  selectPrimarySession,
  writeJsonl,
  assertEventCount,
  waitForTimelineAppendIdle,
  expectInputValue,
  fillSearch,
  addSearchFilter,
  clearAllSearch,
  switchToProjectScope,
  waitForProjectCards,
  waitForSearchMarks,
  waitForNoSearchMarks,
  searchNavigationSnapshot,
  clickSearchNavigationAndWait,
  waitForDetailView,
  makeLongCodexHome,
  makeTransitionProfileIndex,
} = require('./browser-helpers');

async function openColdLongSearchInspector(page) {
  await assertEventCount(page, 150);
  const committedSearch = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '150';
  });
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('37 occurrences'));
  await committedSearch;
  await page.locator('#searchInput').blur();
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail...'));
  return page.locator('#timeline .event.selected').getAttribute('data-event-id');
}

test('browser search HUD starts in current-session mode with persistent global Layer context', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  assert.equal(await page.locator('body').getAttribute('data-search-scope'), 'session');
  assert.equal(await page.locator('#searchHudScopeValue').textContent(), 'session');
  await page.locator('#searchHudScope').click();
  assert.equal(await page.locator('#searchAssist').getByRole('button', { name: 'Current session' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#searchAssist').getByRole('button', { name: 'Entire project' }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Find in current session');
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');

  await fillSearch(page, 'definitely-no-search-hit');
  await page.locator('#searchInput').press('Escape');
  await page.waitForSelector('[data-search-project-fallback]');
  assert.equal(await page.getByRole('button', { name: 'Search entire project' }).count(), 1);

  await page.locator('[data-search-project-fallback]').click();
  await page.waitForFunction(() => document.body.dataset.searchScope === 'project');
  assert.equal(await page.locator('#searchHudScopeValue').textContent(), 'project');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Search the entire project');
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  await page.waitForFunction(() => document.querySelector('#timeline .projectSearchState')?.textContent.includes('No project events match this expression.'));
});

test('browser search parameter popover exposes direct fixed filters, Escape layers, and the global Layer shortcut', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await page.locator('#searchFilterBtn').click();
  assert.equal(await page.locator('#searchAssistHeading').textContent(), 'Search options');
  assert.equal(await page.locator('#searchResultsSection').isHidden(), true);
  assert.equal(await page.locator('#searchAssistFooter').isHidden(), true);
  assert.equal(await page.locator('[data-search-filter-row]').count(), 3);
  assert.equal(await page.locator('[data-search-filter-row][hidden]').count(), 0);
  assert.equal(await page.locator('[data-search-filter-row="file"] label').textContent(), 'Touched file');
  assert.equal(await page.locator('#searchFileInput').getAttribute('placeholder'), 'Any touched file');
  assert.equal(await page.locator('#searchKindSelect').evaluate((select) => document.activeElement === select), true);
  const mainKindOrder = await page.locator('#searchKindSelect option').evaluateAll((options) => (
    options.map((option) => option.value).filter((value) => [
      'user_message',
      'assistant_message',
      'command',
      'patch',
      'error',
      'warning',
      'reasoning',
    ].includes(value))
  ));
  assert.deepEqual(
    mainKindOrder,
    ['user_message', 'assistant_message', 'command', 'patch', 'error', 'warning', 'reasoning'],
    'Main Kind options should follow the folding editor semantic order',
  );
  assert.deepEqual(
    await page.locator('#searchKindSelect optgroup').evaluateAll((groups) => groups.map((group) => group.label)),
    ['Conversation and plans', 'Work and tools', 'Issues and risks', 'Agent and system events'],
  );
  assert.equal(
    await page.locator('#searchKindSelect optgroup[label="Work and tools"] option[value="command"]').count(),
    1,
  );
  assert.equal(
    await page.locator('#searchKindSelect optgroup[label="Issues and risks"] option[value="error"]').count(),
    1,
  );
  assert.equal(
    await page.locator('#searchKindSelect optgroup[label="Agent and system events"] option[value="reasoning"]').count(),
    1,
  );

  const filterLayout = await page.locator('#searchFilterRows').evaluate((filters) => {
    const kind = filters.querySelector('[data-search-filter-row="kind"]')?.getBoundingClientRect();
    const status = filters.querySelector('[data-search-filter-row="status"]')?.getBoundingClientRect();
    const file = filters.querySelector('[data-search-filter-row="file"]')?.getBoundingClientRect();
    return {
      kindTop: kind?.top || 0,
      statusTop: status?.top || 0,
      kindBottom: kind?.bottom || 0,
      fileTop: file?.top || 0,
    };
  });
  assert.ok(Math.abs(filterLayout.kindTop - filterLayout.statusTop) < 2, 'Kind and Status should share one row');
  assert.ok(filterLayout.fileTop >= filterLayout.kindBottom, 'File should span the next row');

  await page.locator('#searchFileInput').fill('definitely-no-touched-file');
  assert.equal(await page.locator('#searchFileSuggestions').isVisible(), true);
  assert.equal(await page.locator('#searchFileSuggestions .fileSuggestionEmpty').textContent(), 'No matching touched files.');
  assert.equal(await page.locator('#searchFileInput').getAttribute('aria-expanded'), 'true');
  const suggestionOverlay = await page.locator('#searchFileSuggestions').evaluate((list) => {
    const input = document.querySelector('#searchFileInput').getBoundingClientRect();
    const rect = list.getBoundingClientRect();
    return {
      position: getComputedStyle(list).position,
      aligned: Math.abs(rect.left - input.left) < 2 && Math.abs(rect.width - input.width) < 2,
      insideViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
    };
  });
  assert.equal(suggestionOverlay.position, 'fixed');
  assert.equal(suggestionOverlay.aligned, true);
  assert.equal(suggestionOverlay.insideViewport, true);
  await page.locator('#searchFileInput').press('Escape');
  assert.equal(await page.locator('#searchFileSuggestions').isHidden(), true);
  await page.locator('#searchFileInput').fill('');

  await addSearchFilter(page, 'kind', 'patch');
  await addSearchFilter(page, 'status', 'failed');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 2');
  assert.match(await page.locator('#searchFilterBtn').getAttribute('title'), /Kind: Patch/);
  assert.match(await page.locator('#searchFilterBtn').getAttribute('title'), /Status: Failed/);

  await page.locator('#searchStatusSelect').selectOption('');
  await page.waitForFunction(() => document.querySelector('#searchFilterCount')?.textContent === 'Filters · 1');
  assert.equal(await page.locator('[data-search-filter-row="status"]').isVisible(), true);

  await page.locator('#searchLayerShortcut').click();
  assert.equal(await page.locator('#searchAssist').isHidden(), true);
  assert.equal(await page.locator('#layerSelect').evaluate((select) => document.activeElement === select), true);

  await page.locator('#searchFilterBtn').click();
  await page.locator('#searchClearAllBtn').click();
  await expectInputValue(page, '#searchInput', '');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters');
  assert.equal(await page.locator('#searchAssist').isHidden(), true);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);

  await page.locator('#searchHudScope').click();
  assert.equal(await page.locator('button[data-search-scope="session"]').evaluate((button) => document.activeElement === button), true);
  await page.locator('#searchAssistClose').click();
  assert.equal(await page.locator('#searchHudScope').evaluate((button) => document.activeElement === button), true);

});

test('browser search HUD stays inert while the analyzer is disabled for project selection', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await page.locator('#searchFilterBtn').click();
  assert.equal(await page.locator('#searchAssist').isVisible(), true);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  assert.equal(await page.locator('#searchAssist').evaluate((popover) => popover.hidden), true);
  for (const selector of ['#searchHudScope', '#searchFilterBtn', '#searchInput']) {
    assert.equal(await page.locator(selector).evaluate((control) => control.disabled), true);
  }

  for (const selector of ['#searchHudScope', '#searchFilterBtn']) {
    await page.locator(selector).dispatchEvent('click');
    assert.equal(await page.locator('#searchAssist').evaluate((popover) => popover.hidden), true);
  }
  await page.locator('#searchInput').evaluate((input) => {
    input.value = 'disabled mutation';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectInputValue(page, '#searchInput', '');
  assert.equal(await page.locator('#searchAssist').evaluate((popover) => popover.hidden), true);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  assert.equal(await page.locator('#searchAssist').isVisible(), false);
  for (const selector of ['#searchHudScope', '#searchFilterBtn', '#searchInput']) {
    assert.equal(await page.locator(selector).evaluate((control) => control.disabled), false);
  }
});

test('browser project scope renders cards, aggregate summary, and filter-only results without jump targets', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await page.waitForFunction(() => document.querySelector('#timeline .projectSearchState')?.textContent.includes('Enter text or add a file'));
  assert.equal(await page.locator('[data-project-result-session-id]').count(), 0);
  assert.ok(await page.locator('[data-session-id]').count() > 0, 'empty project expression should show ordinary session rows');
  assert.equal(await page.locator('#detail').textContent(), '');

  await fillSearch(page, 'patch');
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('matching sessions'));
  assert.equal(await page.locator('#searchEnterHint').isVisible(), true);
  assert.equal(await page.locator('#searchEnterHint').textContent(), 'Press Enter to focus the first project result');

  const cards = await page.locator('[data-project-result-session-id]').evaluateAll((items) => items.map((item) => {
    const countText = item.querySelector('.projectResultCount')?.textContent || '';
    return {
      sessionId: item.dataset.projectResultSessionId,
      count: Number(countText.match(/\d+/)?.[0] || 0),
      text: item.textContent,
      highlighted: item.querySelectorAll('mark.projectSearchHighlight').length,
    };
  }));
  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => card.sessionId && card.count > 0));
  assert.ok(cards.some((card) => card.highlighted > 0), 'project snippets should highlight with project-only marks');
  assert.equal(await page.locator('.searchMark').count(), 0, 'project cards must not enter the session jump-target registry');
  assert.equal(await page.locator('[data-search-match-controls]').first().getAttribute('hidden'), null);
  assert.equal(await page.locator('[data-search-match-nav]').first().isHidden(), true);
  assert.match((await page.locator('.searchInlineCount').textContent()).trim(), /^\d+ sessions?$/);

  const summary = await page.locator('#resultSummary').textContent();
  assert.match(summary, /^\d+ matching sessions · \d+ matching events$/);
  assert.equal(Number(summary.match(/^(\d+)/)?.[1] || 0), cards.length);
  assert.equal(Number(summary.match(/· (\d+) matching events/)?.[1] || 0), cards.reduce((sum, card) => sum + card.count, 0));
  assert.equal(requestedUrls.some((value) => {
    const url = new URL(value, 'http://local');
    return url.pathname === '/api/sessions'
      && url.searchParams.get('q') === 'patch'
      && url.searchParams.get('sort') === 'latest-match-desc'
      && url.searchParams.get('layer') === 'main';
  }), true);

  await page.locator('#searchInput').press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('[data-project-result-session-id]'));

  const statusProjectResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/sessions'
      && url.searchParams.get('status') === 'failed'
      && url.searchParams.get('sort') === 'latest-match-desc'
      && !url.searchParams.has('q');
  });
  await fillSearch(page, '');
  await addSearchFilter(page, 'status', 'failed');
  await statusProjectResponse;
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#searchFilterCount')?.textContent === 'Filters · 1');
  assert.equal(requestedUrls.some((value) => {
    const url = new URL(value, 'http://local');
    return url.pathname === '/api/sessions'
      && url.searchParams.get('status') === 'failed'
      && url.searchParams.get('sort') === 'latest-match-desc'
      && !url.searchParams.has('q');
  }), true);
});

for (const supersede of [false, 'selection', 'query']) test(`project search first arrival ${supersede ? `yields to a newer ${supersede} during detail loading` : 'keeps a long-body tail match visible after detail settlement'}`, async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'project-tail-match-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  const id = 'aaaaaaaa-1004-4004-8004-aaaaaaaaaaaa';
  const text = `${'Synthetic long paragraph for search navigation.\n\n'.repeat(700)}TAIL_MATCH_742`;
  await writeJsonl(path.join(home, 'sessions', 'long.jsonl'), [
    { timestamp: '2026-10-04T10:00:00Z', type: 'session_meta', payload: { id, cwd: project } },
    { timestamp: '2026-10-04T10:00:00.500Z', type: 'event_msg', payload: { type: 'user_message', message: 'Earlier independent message' } },
    { timestamp: '2026-10-04T10:00:00.600Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch-origin',
      input: `*** Begin Patch\n${Array.from({ length: 21 }, (_, i) => `*** Update File: src/feature-${i}/a.js\n@@\n-before\n+after\n`).join('')}*** End Patch` } },
    { timestamp: '2026-10-04T10:00:00.700Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'patch-origin', output: 'Success' } },
    { timestamp: '2026-10-04T10:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: text } },
  ]);
  await writeJsonl(path.join(home, 'sessions', 'other.jsonl'), [
    { timestamp: '2026-10-04T11:00:00Z', type: 'session_meta', payload: { id: 'bbbbbbbb-1004-4004-8004-bbbbbbbbbbbb', cwd: project } },
    { timestamp: '2026-10-04T11:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'Unrelated later session' } },
  ]);
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  const detailStarted = deferred();
  const releaseDetail = deferred();
  const releasePatch = deferred();
  t.after(() => releaseDetail.resolve());
  t.after(() => releasePatch.resolve());
  const { page } = await openApp(t, index, { locale: 'en', beforeGoto: async (p) => {
    await p.route(`**/api/sessions/${id}/events/*/detail*`, async (route) => {
      const url = decodeURIComponent(route.request().url());
      if (url.includes(':logical:call:patch-origin/')) {
        await releasePatch.promise;
        return route.continue();
      }
      if (!url.includes(':logical:user:5/')) return route.continue();
      detailStarted.resolve();
      await releaseDetail.promise;
      await route.continue();
    });
  } });
  assert.notEqual(await page.locator('.sessionItem.active').getAttribute('data-session-id'), id);
  await switchToProjectScope(page);
  await fillSearch(page, 'TAIL_MATCH_742');
  await waitForProjectCards(page);
  await page.locator('[data-project-result-session-id]').first().focus();
  await page.keyboard.press('Enter');
  await detailStarted.promise;
  await page.waitForFunction(() => document.querySelector('.eventLoadingSnippet')?.textContent.includes('TAIL_MATCH_742'));
  if (supersede === 'selection') await page.locator('#timeline .event').filter({ hasText: 'Earlier independent message' }).locator('.eventKind').click();
  if (supersede === 'query') await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/timeline') && new URL(response.url()).searchParams.get('q') === 'NEW_QUERY_WITHOUT_MATCH'),
    fillSearch(page, 'NEW_QUERY_WITHOUT_MATCH'),
  ]);
  releaseDetail.resolve();
  if (!supersede) await page.waitForFunction(() => document.querySelector('.event.selected')?.innerText.length > 30000);
  releasePatch.resolve();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (supersede === 'query') {
    assert.equal(await page.locator('#searchInput').inputValue(), 'NEW_QUERY_WITHOUT_MATCH');
    assert.equal(await page.locator('#timeline mark.activeSearchMark').count(), 0);
    return;
  }
  if (supersede === 'selection') {
    assert.match(await page.locator('#timeline .event.selected').innerText(), /Earlier independent message/);
    return;
  }
  // HTTP/detail settlement does not finish Chromium's smooth scroll animation.
  // Wait for the actual arrival, retaining the same viewport geometry contract.
  await page.waitForFunction(() => {
    const mark = document.querySelector('#timeline mark.activeSearchMark');
    if (!mark) return false;
    const rect = mark.getBoundingClientRect();
    const pane = mark.closest('.timelinePane').getBoundingClientRect();
    return rect.top >= Math.max(0, pane.top) && rect.bottom <= Math.min(innerHeight, pane.bottom);
  });
  const geometry = await page.locator('#timeline mark.activeSearchMark').evaluate((mark) => {
    const rect = mark.getBoundingClientRect();
    const pane = mark.closest('.timelinePane').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, paneTop: Math.max(0, pane.top), paneBottom: Math.min(innerHeight, pane.bottom) };
  });
  assert.ok(geometry.top >= geometry.paneTop && geometry.bottom <= geometry.paneBottom, JSON.stringify(geometry));
});

test('browser project return surfaces preserve query, filters, cards, scope and focus', { timeout: 45000 }, async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 1600, height: 900 } });
  await switchToProjectScope(page);
  await fillSearch(page, 'patch');
  const projectResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/sessions' && url.searchParams.get('q') === 'patch'
      && url.searchParams.get('kind') === 'patch' && url.searchParams.get('sort') === 'latest-match-desc';
  });
  await addSearchFilter(page, 'kind', 'patch');
  const projectResults = (await (await projectResponse).json()).sessions;
  await page.waitForLoadState('networkidle');
  await waitForProjectCards(page);
  const cards = () => page.locator('[data-project-result-session-id]').evaluateAll((elements) =>
    elements.map((element) => ({ id: element.dataset.projectResultSessionId, text: element.textContent })));
  const expectedCards = await cards();
  assert.ok(expectedCards.length > 0);
  const latestEventId = projectResults.find((session) => session.id === expectedCards[0].id).searchMatch.latestEvent.id;
  for (const surface of ['header', 'sorted-header', 'inspector', 'mobile-inspector']) {
    let releaseAnalysis;
    let analysisStarted;
    const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve; });
    const analysisRequest = new Promise((resolve) => { analysisStarted = resolve; });
    const holdAnalysis = async (route) => {
      analysisStarted();
      await analysisGate;
      await route.continue();
    };
    if (surface === 'header') {
      t.after(() => releaseAnalysis());
      await page.route('**/api/sessions/*/analysis*', holdAnalysis);
    }
    await page.setViewportSize({ width: surface === 'mobile-inspector' ? 390 : 1600, height: 900 });
    await page.locator('[data-project-result-session-id]').first().click();
    const headerReturn = page.locator('#sessionHeader [data-search-back-to-project]');
    await headerReturn.waitFor({ state: 'visible' });
    if (surface === 'header') await analysisRequest;
    assert.equal(await page.locator('.timelinePane [data-search-back-to-project]').count(), 1);
    assert.equal(await page.locator('#timeline [data-search-back-to-project], #resultSummary [data-search-back-to-project]').count(), 0);
    const inspector = page.locator('.detailPane [data-detail-action="back-to-project-results"]');
    if (surface !== 'header') {
      // A selected row can precede the final drill-down render. Let its analysis,
      // suggestions and search-detail work settle before opening the Inspector.
      await page.waitForLoadState('networkidle');
      const latestEvent = page.locator(`#timeline .event[data-event-id="${latestEventId}"].selected`);
      await latestEvent.waitFor({ state: 'visible' });
      await latestEvent.locator(':scope > .eventHeader > .eventKind').click();
      await inspector.waitFor({ state: 'visible' });
      assert.equal(await inspector.count(), 1);
    }
    if (surface === 'sorted-header') {
      await page.locator('#sortSelect').selectOption('events-desc');
      await page.waitForFunction(() => document.querySelectorAll('#timeline .event').length > 0
        && !document.querySelector('#timeline .event.selected')
        && document.body.dataset.detailView === 'profileRules');
      assert.equal(await page.locator('.timelinePane [data-search-back-to-project]').count(), 1,
        'session reload must preserve the sole center return action after resetting Inspector');
      assert.equal(await inspector.count(), 0);
    }
    if (surface === 'mobile-inspector') {
      await page.locator('.mobileViewTab[data-mobile-view="detail"]').click();
    }
    await (surface.endsWith('header') ? headerReturn : inspector).click();
    if (surface === 'header') {
      await waitForProjectCards(page);
      releaseAnalysis();
    }
    await page.waitForLoadState('networkidle');
    if (surface === 'header') await page.unroute('**/api/sessions/*/analysis*', holdAnalysis);
    await waitForProjectCards(page);
    assert.equal(await page.locator('body').getAttribute('data-search-scope'), 'project');
    assert.equal(await page.locator('#searchInput').inputValue(), 'patch');
    assert.equal(await page.locator('#searchKindSelect').inputValue(), 'patch');
    assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
    assert.deepEqual(await cards(), expectedCards);
    await page.waitForFunction((id) => document.activeElement?.dataset.projectResultSessionId === id, expectedCards[0].id);
  }
});

test('browser project result drill-down loads a deep latest event and returns to project cards', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, {
    locale: 'en',
    viewport: { width: 390, height: 760 },
    activeSessionState: 'attached',
  });

  await switchToProjectScope(page);
  await fillSearch(page, 'needle');
  await waitForProjectCards(page);
  await page.locator('#searchInput').press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('[data-project-result-session-id]'));
  const focusedSessionId = await page.evaluate(() => document.activeElement?.dataset.projectResultSessionId || '');
  assert.equal(focusedSessionId, longFixture.sessionId);

  const requestStart = requestedUrls.length;
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'session'
      && document.body.dataset.mobileView === 'events'
      && document.querySelector('#timeline .event.selected')?.textContent.includes('Long timeline row 170')
  ));
  const clickedBackToProject = await page.waitForFunction(() => {
    if (document.querySelectorAll('#timeline .event[data-event-id]').length !== 171) return false;
    const button = document.querySelector('#sessionHeader [data-search-back-to-project]');
    if (!button) return false;
    button.click();
    return true;
  }).then((handle) => handle.jsonValue());
  assert.equal(clickedBackToProject, true);
  assert.equal(requestedUrls.slice(requestStart).some((value) => {
    const url = new URL(value, 'http://local');
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '171'
      && url.searchParams.get('q') === 'needle';
  }), true);
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && document.body.dataset.mobileView === 'sessions'
      && document.querySelectorAll('[data-project-result-session-id]').length > 0
  ));
  await page.waitForFunction((sessionId) => document.activeElement?.dataset.projectResultSessionId === sessionId, longFixture.sessionId);
  assert.equal(await page.locator('#timeline .projectSearchState').count(), 1);
});

test('browser discards a stale project response before exposing drill-down', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  let staleResponsePending = true;
  await page.route('**/api/sessions*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!staleResponsePending
        || requestUrl.pathname !== '/api/sessions'
        || requestUrl.searchParams.get('q') !== 'patch'
        || requestUrl.searchParams.get('sort') !== 'latest-match-desc') {
      await route.continue();
      return;
    }
    staleResponsePending = false;
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, indexRevision: body.indexRevision + 1 },
    });
  });

  await switchToProjectScope(page);
  const requestStart = requestedUrls.length;
  const stateReload = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/state');
  await fillSearch(page, 'patch');
  await stateReload;
  await waitForProjectCards(page);
  assert.equal(requestedUrls.slice(requestStart).some((value) => (
    new URL(value, 'http://local').pathname.endsWith('/timeline')
  )), false);
  await page.locator('[data-project-result-session-id]').first().click();
  await page.waitForFunction(() => document.body.dataset.searchScope === 'session');
});

test('browser discards revision-mismatched ordinary Session rows before rendering', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  const marker = 'stale-session-row-from-newer-revision';
  let staleResponsePending = true;
  await page.route('**/api/sessions*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!staleResponsePending
        || requestUrl.pathname !== '/api/sessions'
        || requestUrl.searchParams.get('sort') !== 'events-desc'
        || requestUrl.searchParams.get('q')) {
      await route.continue();
      return;
    }
    staleResponsePending = false;
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        indexRevision: body.indexRevision + 1,
        sessions: body.sessions.map((session, itemIndex) => (
          itemIndex === 0 ? { ...session, title: marker } : session
        )),
      },
    });
  });
  await page.evaluate((text) => {
    window.__sawRevisionMismatchMarker = document.body.textContent.includes(text);
    new MutationObserver(() => {
      if (document.body.textContent.includes(text)) window.__sawRevisionMismatchMarker = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, marker);

  const stateReload = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/state');
  await page.locator('#sortSelect').selectOption('events-desc');
  await stateReload;
  await page.waitForFunction(() => document.querySelectorAll('[data-session-id]').length > 0);
  assert.equal(staleResponsePending, false);
  assert.equal(await page.evaluate(() => window.__sawRevisionMismatchMarker), false);
});

test('browser discards revision-mismatched file suggestions and coalesces recovery', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  const marker = 'stale-file-suggestion-from-newer-revision';
  let staleResponsePending = true;
  await page.route('**/api/file-suggestions*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!staleResponsePending || requestUrl.searchParams.get('layer') !== 'protocol') {
      await route.continue();
      return;
    }
    staleResponsePending = false;
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        indexRevision: body.indexRevision + 1,
        files: [{ file: marker, count: 999 }],
      },
    });
  });
  await page.evaluate((text) => {
    window.__sawRevisionMismatchMarker = document.body.textContent.includes(text);
    new MutationObserver(() => {
      if (document.body.textContent.includes(text)) window.__sawRevisionMismatchMarker = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, marker);

  const stateReload = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/state');
  await page.locator('#layerSelect').selectOption('protocol');
  await stateReload;
  await page.waitForFunction(() => document.querySelectorAll('[data-session-id]').length > 0);
  assert.equal(staleResponsePending, false);
  assert.equal(await page.evaluate(() => window.__sawRevisionMismatchMarker), false);
});

test('browser retries coalesced recovery when a nested query detects another revision', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const sessionMarker = 'stale-session-from-first-revision-change';
  const suggestionMarker = 'stale-suggestion-from-nested-revision-change';
  let sessionMismatchPending = true;
  let suggestionMismatchPending = true;
  let nestedMismatchArmed = false;

  await page.route('**/api/sessions*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!sessionMismatchPending
        || requestUrl.pathname !== '/api/sessions'
        || requestUrl.searchParams.get('sort') !== 'events-desc'
        || requestUrl.searchParams.get('q')) {
      await route.continue();
      return;
    }
    sessionMismatchPending = false;
    const response = await route.fetch();
    const body = await response.json();
    nestedMismatchArmed = true;
    await route.fulfill({
      response,
      json: {
        ...body,
        indexRevision: body.indexRevision + 1,
        sessions: body.sessions.map((session, itemIndex) => (
          itemIndex === 0 ? { ...session, title: sessionMarker } : session
        )),
      },
    });
  });
  await page.route('**/api/file-suggestions*', async (route) => {
    if (!nestedMismatchArmed || !suggestionMismatchPending) {
      await route.continue();
      return;
    }
    suggestionMismatchPending = false;
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        indexRevision: body.indexRevision + 1,
        files: [{ file: suggestionMarker, count: 999 }],
      },
    });
  });
  await page.evaluate(([firstMarker, secondMarker]) => {
    window.__sawOverlappingRevisionMarker = document.body.textContent.includes(firstMarker)
      || document.body.textContent.includes(secondMarker);
    new MutationObserver(() => {
      if (document.body.textContent.includes(firstMarker)
          || document.body.textContent.includes(secondMarker)) {
        window.__sawOverlappingRevisionMarker = true;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, [sessionMarker, suggestionMarker]);

  const requestStart = requestedUrls.length;
  let recoveryStateResponses = 0;
  const secondRecoveryState = page.waitForResponse((response) => {
    if (new URL(response.url()).pathname !== '/api/state') return false;
    recoveryStateResponses += 1;
    return recoveryStateResponses === 2;
  });
  await page.locator('#sortSelect').selectOption('events-desc');
  await secondRecoveryState;
  await page.waitForFunction(() => document.querySelectorAll('[data-session-id]').length > 0);

  const recoveryStateRequests = requestedUrls.slice(requestStart).filter((value) => (
    new URL(value, 'http://local').pathname === '/api/state'
  ));
  assert.equal(sessionMismatchPending, false);
  assert.equal(suggestionMismatchPending, false);
  assert.ok(recoveryStateRequests.length >= 2);
  assert.equal(await page.evaluate(() => window.__sawOverlappingRevisionMarker), false);
});

test('browser project return ignores stale selected-session analysis responses', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await fillSearch(page, 'patch');
  await waitForProjectCards(page);

  let releaseAnalysis;
  const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve; });
  let delayedOnce = false;
  t.after(() => releaseAnalysis?.());
  await page.route('**/api/sessions/*/analysis', async (route) => {
    if (!delayedOnce) {
      delayedOnce = true;
      await analysisGate;
    }
    await route.continue();
  });

  await page.locator('[data-project-result-session-id]').first().click();
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'session'
      && document.querySelector('#sessionHeader [data-search-back-to-project]')
  ));
  await page.evaluate(() => document.querySelector('#sessionHeader [data-search-back-to-project]')?.click());
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && document.querySelectorAll('[data-project-result-session-id]').length > 0
  ));
  releaseAnalysis();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#analysisPanel .metric').count(), 0);
  assert.equal(await page.locator('#timeline .projectSearchState').count(), 1);
});

test('browser project query transitions clear stale cards and counts before the new context commits', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await fillSearch(page, 'patch');
  await waitForProjectCards(page);
  const previousSummary = await page.locator('#resultSummary').textContent();
  assert.match(previousSummary, /^\d+ matching sessions · \d+ matching events$/);

  let releaseSearch;
  let markSearchSeen;
  const searchGate = new Promise((resolve) => { releaseSearch = resolve; });
  const searchSeen = new Promise((resolve) => { markSearchSeen = resolve; });
  t.after(() => releaseSearch?.());
  await page.route('**/api/sessions*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sessions'
        && url.searchParams.get('q') === 'alpha'
        && url.searchParams.get('sort') === 'latest-match-desc') {
      markSearchSeen();
      await searchGate;
    }
    await route.continue();
  });

  await fillSearch(page, 'alpha');
  await searchSeen;
  assert.equal(await page.locator('[data-project-result-session-id]').count(), 0);
  assert.equal((await page.locator('.searchInlineCount').textContent()).trim(), 'Searching…');
  assert.equal((await page.locator('#searchMetricsPanel').textContent()).trim(), 'Searching…');
  assert.equal((await page.locator('#resultSummary').textContent()).trim(), '');
  assert.match(await page.locator('#timeline .projectSearchState').textContent(), /Searching…/);

  releaseSearch();
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('matching sessions'));
  assert.doesNotMatch((await page.locator('#searchMetricsPanel').textContent()).trim(), /Searching/);
  assert.match((await page.locator('.searchInlineCount').textContent()).trim(), /^\d+ sessions?$/);
});

test('browser superseded project results abort and an immediate retry settles Searching state', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await switchToProjectScope(page);
  const failures = [];
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/sessions') failures.push(request.failure()?.errorText || '');
  });
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  let markSlow;
  const slowStarted = new Promise((resolve) => { markSlow = resolve; });
  await page.route('**/api/sessions?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== 'slow-project') {
      await route.continue();
      return;
    }
    markSlow();
    await slowGate;
    try {
      await route.continue();
    } catch {}
  });

  await fillSearch(page, 'slow-project');
  await slowStarted;
  await fillSearch(page, 'fixture');
  await waitForProjectCards(page);
  releaseSlow();
  await page.waitForTimeout(300);

  assert.ok(failures.some((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), failures.join(', '));
  assert.equal(await page.locator('#searchInput').inputValue(), 'fixture');
  assert.equal((await page.locator('#timeline').textContent()).includes('Searching'), false);
  assert.ok(await page.locator('[data-project-result-session-id]').count() > 0);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
});

test('browser project search commits after folding profile changes during an in-flight request', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);

  let releaseProjectSearch;
  let markProjectSearchSeen;
  const projectSearchGate = new Promise((resolve) => { releaseProjectSearch = resolve; });
  const projectSearchSeen = new Promise((resolve) => { markProjectSearchSeen = resolve; });
  let delayedOnce = false;
  t.after(() => releaseProjectSearch?.());
  await page.route('**/api/sessions*', async (route) => {
    const url = new URL(route.request().url());
    if (!delayedOnce
        && url.pathname === '/api/sessions'
        && url.searchParams.get('q') === 'patch'
        && url.searchParams.get('sort') === 'latest-match-desc') {
      delayedOnce = true;
      markProjectSearchSeen();
      await projectSearchGate;
    }
    await route.continue();
  });

  await fillSearch(page, 'patch');
  await projectSearchSeen;
  await page.evaluate(() => {
    const select = document.querySelector('#profileSelect');
    select.value = 'debug';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  releaseProjectSearch();
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('matching sessions'));
  assert.equal(await page.locator('#profileSelect').inputValue(), 'debug');
});

test('browser project scope profile changes do not repopulate the detail pane', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await fillSearch(page, 'patch');
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#timeline .projectSearchState'));
  assert.equal(await page.locator('#detail').textContent(), '');

  await page.evaluate(() => {
    const select = document.querySelector('#profileSelect');
    select.value = 'debug';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value === 'debug');
  assert.equal(await page.locator('#detail').textContent(), '');
  assert.equal(await page.locator('#timeline .projectSearchState').count(), 1);
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

  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  assert.equal(await page.locator('#searchAssist').getAttribute('data-mode'), 'results');
  assert.equal(await page.locator('#resultSummary').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Clear all' }).count(), 0);

  await page.locator('#searchInput').press('Escape');
  assert.equal(await page.locator('#searchAssist').isVisible(), false);
  assert.equal(await page.locator('#resultSummary').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Clear all' }).count(), 0);

  await clearAllSearch(page);
  await assertEventCount(page, 180);
  await waitForNoSearchMarks(page);
});

test('browser search count separates discovered jump targets from full-text occurrences', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page);

  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent === '1 / 9 targets'
      && document.querySelector('#searchMetricsPanel')?.textContent.includes('11 occurrences')
  ));
});

test('browser search discovery waits for a structured result view to commit', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await fillSearch(page, 'src');
  await waitForSearchMarks(page);

  let releaseTimeline;
  let markTimelineRequestSeen;
  const timelineGate = new Promise((resolve) => { releaseTimeline = resolve; });
  const timelineRequestSeen = new Promise((resolve) => { markTimelineRequestSeen = resolve; });
  t.after(() => releaseTimeline());
  await page.route('**/api/sessions/*/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('kind') === 'patch') {
      markTimelineRequestSeen();
      await timelineGate;
    }
    await route.continue();
  });

  await addSearchFilter(page, 'kind', 'patch');
  await timelineRequestSeen;
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('.searchMark').count(),
    0,
    'old DOM must not register targets under the pending structured-search key',
  );
  assert.equal(await page.locator('[data-search-match-nav="next"]').first().isDisabled(), true);

  releaseTimeline();
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length > 0 && events.every((event) => event.classList.contains('kind-patch'));
  });
  await waitForSearchMarks(page);
  const committed = await searchNavigationSnapshot(page);
  assert.equal(committed.total, await page.locator('.searchMark').count());
});

test('browser search discovery excludes the previous timeline while switching sessions', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  await fillSearch(page, 'src');
  await waitForSearchMarks(page);

  const targetSession = page.locator('.sessionItem:not(.active)').first();
  const targetSessionId = await targetSession.getAttribute('data-session-id');
  assert.ok(targetSessionId);
  let releaseTimeline;
  let markTimelineRequestSeen;
  const timelineGate = new Promise((resolve) => { releaseTimeline = resolve; });
  const timelineRequestSeen = new Promise((resolve) => { markTimelineRequestSeen = resolve; });
  t.after(() => releaseTimeline());
  await page.route(`**/api/sessions/${targetSessionId}/timeline*`, async (route) => {
    markTimelineRequestSeen();
    await timelineGate;
    await route.continue();
  });

  await targetSession.click();
  await timelineRequestSeen;
  assert.equal(
    await page.locator('.searchMark').count(),
    0,
    'the previous session DOM must not register targets under the next session key',
  );
  assert.equal(await page.locator('[data-search-match-nav="next"]').first().isDisabled(), true);

  const timelineResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/api/sessions/${targetSessionId}/timeline`)
  ));
  releaseTimeline();
  await timelineResponse;
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
      && document.querySelectorAll('#timeline .event[data-event-id]').length > 0
  ), targetSessionId);
  const committed = await searchNavigationSnapshot(page);
  assert.equal(committed.total, await page.locator('.searchMark').count());
});

test('browser search discovery waits for localized timeline content to commit', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);

  let releaseTimeline;
  let markTimelineRequestSeen;
  const timelineGate = new Promise((resolve) => { releaseTimeline = resolve; });
  const timelineRequestSeen = new Promise((resolve) => { markTimelineRequestSeen = resolve; });
  t.after(() => releaseTimeline());
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('locale') === 'zh-CN') {
      markTimelineRequestSeen();
      await timelineGate;
    }
    await route.continue();
  });

  await switchHiddenLocale(page, 'zh-CN');
  await timelineRequestSeen;
  assert.equal(
    await page.locator('.searchMark').count(),
    0,
    'the previous locale DOM must not register targets under the next locale key',
  );
  assert.equal(await page.locator('[data-search-match-nav="next"]').first().isDisabled(), true);

  const timelineResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('locale') === 'zh-CN';
  });
  releaseTimeline();
  await timelineResponse;
  await waitForSearchMarks(page, 9);
  const committed = await searchNavigationSnapshot(page);
  assert.equal(committed.total, await page.locator('.searchMark').count());
});

test('browser search target identities and denominator stay stable across inspector redraws', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  assert.equal(
    await page.locator('[data-search-load-more-targets]').count(),
    0,
    'a fully loaded timeline must not expose a no-op Load more action',
  );
  const initial = await searchNavigationSnapshot(page);
  assert.ok(initial.total >= 4, `expected enough patch events, got ${initial.total}`);
  assert.equal(initial.total, initial.ids.length);
  assert.equal(new Set(initial.ids).size, initial.ids.length);
  assert.ok(initial.bindings.every((binding) => !binding.surfaces.includes('inspector')));

  const inspectorCounts = new Map();
  let previous = initial;
  for (let i = 0; i < initial.total; i += 1) {
    const next = await clickSearchNavigationAndWait(page, 'next', previous.id);
    assert.deepEqual(next.ids, initial.ids, 'Inspector navigation must not add, remove, or reorder canonical IDs');
    assert.equal(next.total, initial.total);
    const selectedId = await page.evaluate(() => document.querySelector('#timeline .event.selected')?.dataset.eventId || '');
    if (selectedId) inspectorCounts.set(selectedId, await page.locator('#detail mark.searchMark').count());
    previous = next;
    if (new Set(inspectorCounts.values()).size > 1) break;
  }
  assert.ok([...inspectorCounts.values()].some((count) => count > 0), 'Inspector highlights should remain visible');
  assert.ok(new Set(inspectorCounts.values()).size > 1, 'fixture should exercise different inspector match counts');
  assert.ok((await searchNavigationSnapshot(page)).bindings.some((binding) => binding.surfaces.includes('inspector')));

  if (await page.locator('[data-detail-action="close"]').count()) {
    await page.locator('[data-detail-action="close"]').click();
    await waitForDetailView(page, 'profileRules');
  }
  const closed = await searchNavigationSnapshot(page);
  assert.deepEqual(closed.ids, initial.ids, 'closing Inspector must not alter canonical membership');
  assert.ok(closed.bindings.every((binding) => !binding.surfaces.includes('inspector')));
});

test('browser manual fold replaces occurrence bindings without changing event-anchor membership', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1,
    includeFoldableSearchTargets: true,
  });
  const index = await buildIndex(longFixture);
  const hiddenCommandProfile = {
    id: 'custom:hidden-foldable-command',
    name: 'Hidden foldable command search test',
    description: 'Keep command body matches unavailable until search navigation expands them.',
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

  await fillSearch(page, 'fold only target');
  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 3 targets')
      && document.querySelector('#searchMetricsPanel')?.textContent.includes('6 occurrences')
  ));

  const empty = await searchNavigationSnapshot(page);
  const first = await clickSearchNavigationAndWait(page, 'next', empty.id);
  const second = await clickSearchNavigationAndWait(page, 'next', first.id);
  assert.notEqual(second.ownerId, first.ownerId, 'event-anchor navigation must advance once per event');
  assert.deepEqual(second.ids, empty.ids);
  const knownTotal = second.total;

  const event = page.locator(`#timeline .event[data-event-id="${first.ownerId}"]`);
  await event.locator('.eventHeader [data-action="toggle"]').click();
  await page.waitForFunction(({ eventId }) => {
    const owner = document.querySelector(`#timeline .event[data-event-id="${eventId}"]`);
    return owner && !owner.classList.contains('expanded');
  }, { eventId: first.ownerId });
  const folded = await searchNavigationSnapshot(page);
  assert.deepEqual(folded.ids, empty.ids);
  assert.equal(folded.total, knownTotal);

  await page.locator('.searchInlineMatches [data-search-match-nav="previous"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-search-navigation-pending]'));
  const reverse = await searchNavigationSnapshot(page);
  assert.equal(reverse.total, knownTotal);
  assert.deepEqual(reverse.ids, empty.ids, 'folding changes bindings, not canonical membership');
});

test('browser search registry follows folding profile rule revisions', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1,
    includeFoldableSearchTargets: true,
  });
  const index = await buildIndex(longFixture);
  const expandedCommandProfile = {
    id: 'custom:search-rule-revision',
    name: 'Search rule revision test',
    description: 'Exercises registry invalidation while the profile ID stays unchanged.',
    rules: {
      kindStates: { command: 'expanded' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([expandedCommandProfile]),
      'sessionAnalyzer.profile': expandedCommandProfile.id,
    },
  });

  await fillSearch(page, 'fold only target');
  await waitForSearchMarks(page, 6);
  if (await page.locator('[data-detail-action="close"]').count()) {
    await page.locator('[data-detail-action="close"]').click();
    await waitForDetailView(page, 'profileRules');
  }
  const initial = await searchNavigationSnapshot(page);
  assert.equal(initial.total, 3, `expected one canonical target per matching command event, got ${initial.total}`);

  await page.locator('#detail [data-profile-kind="command"]').selectOption('hidden');
  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.kind-command.hiddenByProfile').length === 3
  ));
  await waitForNoSearchMarks(page);
  const hiddenDraft = await searchNavigationSnapshot(page);
  assert.equal(hiddenDraft.total, 3, 'hidden matching events remain canonical but have no live bindings');
  assert.notDeepEqual(hiddenDraft.ids, initial.ids, 'a rule revision must replace the prior search-key identities');
  assert.equal(await page.locator('#profileSelect').inputValue(), expandedCommandProfile.id);

  await page.locator('#detail [data-detail-action="save-profile"]').click();
  assert.equal(await page.locator('#profileSelect').inputValue(), expandedCommandProfile.id);
  assert.deepEqual((await searchNavigationSnapshot(page)).ids, hiddenDraft.ids, 'same-ID save must preserve the committed hidden-rule identities');

  await page.locator('#detail [data-profile-kind="command"]').selectOption('expanded');
  await waitForSearchMarks(page, 6);
  const expandedDraft = await searchNavigationSnapshot(page);
  assert.equal(expandedDraft.total, 3);
  assert.equal(await page.locator('.searchMark').count(), 6, 'occurrence highlights must not multiply event anchors');

  await page.locator('#detail [data-detail-action="cancel-profile"]').click();
  await waitForNoSearchMarks(page);
  assert.deepEqual((await searchNavigationSnapshot(page)).ids, hiddenDraft.ids, 'cancel must restore the saved canonical context');
});

test('browser rapid search navigation is serialized without skips or duplicates', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  const initial = await searchNavigationSnapshot(page);
  assert.equal(initial.current, 1);

  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.startsWith('4 /'));
  const advanced = await searchNavigationSnapshot(page);
  assert.equal(advanced.current, 4);
  assert.notEqual(advanced.id, initial.id);

  await page.locator('.searchInlineMatches [data-search-match-nav="previous"]').evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.startsWith('1 /'));
  const restored = await searchNavigationSnapshot(page);
  assert.equal(restored.id, initial.id);
});

test('browser search count hit testing keeps input and navigation controls distinct', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  assert.equal(await page.locator('#searchMetricsPanel [data-search-match-nav]').count(), 2);
  assert.equal(await page.locator('#searchMetricsPanel .searchMetricTargets [data-search-match-nav]').count(), 2);
  assert.equal(await page.locator('#searchMetricsPanel .searchMetricsFooter [data-search-match-nav]').count(), 0);
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]')?.disabled);
  const loadMoreBefore = await searchNavigationSnapshot(page);
  const discoveredBefore = Number((await page.locator('.searchMetricTargets strong').textContent()).match(/\/\s*(\d+)/)?.[1] || 0);
  await page.locator('[data-search-load-more-targets]').click();
  await page.waitForFunction((count) => {
    const text = document.querySelector('.searchMetricTargets strong')?.textContent || '';
    const discovered = Number(text.match(/\/\s*(\d+)/)?.[1] || 0);
    return discovered > count || !document.querySelector('[data-search-load-more-targets]');
  }, discoveredBefore);
  const loadMoreAfter = await searchNavigationSnapshot(page);
  assert.equal(loadMoreAfter.id, loadMoreBefore.id, 'loading more targets should preserve the active target');
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  const panelBefore = await searchNavigationSnapshot(page);
  await page.locator('#searchMetricsPanel [data-search-match-nav="next"]').click();
  await page.waitForFunction((id) => document.querySelector('.searchMark.activeSearchMark')?.dataset.searchTargetId !== id, panelBefore.id);
  const panelNext = await searchNavigationSnapshot(page);
  assert.equal(panelNext.current, panelBefore.current + 1);
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  assert.equal(await page.locator('#searchAssist').getAttribute('data-mode'), 'results');
  await page.locator('#searchMetricsPanel [data-search-match-nav="previous"]').click();
  await page.waitForFunction((id) => document.querySelector('.searchMark.activeSearchMark')?.dataset.searchTargetId === id, panelBefore.id);
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  await page.locator('#searchInput').press('Escape');
  await page.locator('#searchInput').blur();
  const countBox = await page.locator('.searchInlineCount').boundingBox();
  assert.ok(countBox);
  await page.mouse.click(countBox.x + countBox.width / 2, countBox.y + countBox.height / 2);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);

  const before = await searchNavigationSnapshot(page);
  const next = await clickSearchNavigationAndWait(page, 'next', before.id);
  assert.equal(next.current, before.current + 1);
  const previous = await clickSearchNavigationAndWait(page, 'previous', next.id);
  assert.equal(previous.id, before.id);
});

test('browser canonical Load more scans multiple pages once and becomes idempotent at exhaustion', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 620,
    needleIndices: [0, 1, 2, 3, 4, 455],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent === '1 / 5 targets');
  const before = await searchNavigationSnapshot(page);
  const beforeState = await page.evaluate(() => ({
    selected: document.querySelector('#timeline .event.selected')?.dataset.eventId || '',
    detail: document.body.dataset.detailView,
    scrollTop: document.querySelector('.timelinePane')?.scrollTop || 0,
  }));
  assert.equal(beforeState.detail, 'profileRules');
  const requestStart = requestedUrls.length;

  await page.locator('[data-search-load-more-targets]').click();
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 6 targets'));
  const after = await searchNavigationSnapshot(page);
  const afterState = await page.evaluate(() => ({
    selected: document.querySelector('#timeline .event.selected')?.dataset.eventId || '',
    detail: document.body.dataset.detailView,
    scrollTop: document.querySelector('.timelinePane')?.scrollTop || 0,
  }));
  assert.deepEqual(after.ids.slice(0, before.ids.length), before.ids);
  assert.equal(after.ids.length, before.ids.length + 1);
  assert.equal(after.id, before.id);
  assert.deepEqual(afterState, beforeState, 'discovery must preserve selection, detail, and scroll');
  const discoveryRequests = requestedUrls.slice(requestStart)
      .filter((value) => value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '150')
  assert.deepEqual(
    discoveryRequests.map((value) => new URL(value, 'http://local').searchParams.get('offset')),
    ['150', '300', '450'],
    discoveryRequests.join('\n'),
  );

  await page.locator('[data-search-load-more-targets]').click();
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]'));
  const exhausted = await searchNavigationSnapshot(page);
  assert.deepEqual(exhausted.ids, after.ids);
  assert.equal(exhausted.id, before.id);
  const allOffsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '150')
    .map((value) => new URL(value, 'http://local').searchParams.get('offset'));
  assert.deepEqual(allOffsets, ['150', '300', '450', '600']);
  assert.equal(new Set(allOffsets).size, allOffsets.length, 'no timeline page may be requested twice');
});

test('browser query edits invalidate an in-flight canonical discovery', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 620,
    needleIndices: [0, 1, 2, 3, 4, 455],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent === '1 / 5 targets');

  let releaseOldPage;
  let markOldPageStarted;
  const oldPageRelease = new Promise((resolve) => { releaseOldPage = resolve; });
  const oldPageStarted = new Promise((resolve) => { markOldPageStarted = resolve; });
  t.after(() => releaseOldPage());
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '150') {
      markOldPageStarted();
      await oldPageRelease;
    }
    await route.continue();
  });

  await page.locator('[data-search-load-more-targets]').click();
  await oldPageStarted;
  await fillSearch(page, 'ordinary');
  releaseOldPage();
  await page.waitForFunction(() => {
    const ids = JSON.parse(document.querySelector('#searchMetricsPanel')?.dataset.searchTargetIds || '[]');
    return ids.length > 0 && ids.every((id) => JSON.parse(id)[0].split('\u001f')[4] === 'ordinary');
  });
  const committed = await searchNavigationSnapshot(page);
  assert.ok(committed.ids.length > 0);
  assert.ok(committed.ids.every((id) => JSON.parse(id)[0].split('\u001f')[4] === 'ordinary'));
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser rapid navigation and Load more interleaving commits one ordered activation', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 320,
    needleIndices: [0, 1, 2, 3, 4, 155],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent === '1 / 5 targets');
  const before = await searchNavigationSnapshot(page);

  await page.locator('[data-search-load-more-targets]').click();
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 6 targets')
      && !document.querySelector('[data-search-navigation-pending]')
      && !document.querySelector('[data-search-load-more-targets][disabled]')
  ));
  const after = await searchNavigationSnapshot(page);
  assert.equal(after.id, before.ids[1]);
  assert.equal(after.current, 2);
  assert.equal(after.ids.length, 6);
  assert.equal(new Set(after.ids).size, after.ids.length);
});

test('browser canonical membership is independent of responsive detail visibility and event layer chrome', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 1280, height: 900 } });
  await selectPrimarySession(page);
  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  const desktop = await searchNavigationSnapshot(page);

  for (const width of [900, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(50);
    assert.deepEqual((await searchNavigationSnapshot(page)).ids, desktop.ids);
  }

  for (const layer of ['protocol', 'raw', 'main']) {
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('layer') === layer;
    });
    await page.locator('#layerSelect').selectOption(layer);
    await response;
    await page.waitForFunction((expected) => document.querySelector('#layerSelect')?.value === expected, layer);
    const snapshot = await searchNavigationSnapshot(page);
    assert.equal(snapshot.ids.length, new Set(snapshot.ids).size);
    assert.ok(snapshot.bindings.every((binding) => (
      binding.surfaces.every((surface) => ['timeline', 'inspector'].includes(surface))
    )));
  }
});

test('browser large full-text counts stay unabridged beside canonical event targets in both locales', async (t) => {
  const longFixture = await makeLongCodexHome(t, { needleRepeats: 20 });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 1365, height: 900 } });
  const fullTextTotal = 987654321;

  await page.route('**/timeline*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (new URL(route.request().url()).searchParams.get('q') === 'needle') data.searchMatchCount = fullTextTotal;
    await route.fulfill({ response, json: data });
  });
  await fillSearch(page, 'needle');
  await page.waitForFunction((count) => document.querySelector('#searchMetricsPanel')?.textContent.includes(String(count)), fullTextTotal);

  const assertLayout = async ({ expectedText, compactHidden }) => {
    const layout = await page.evaluate(() => {
      const row = document.querySelector('.searchInputRow');
      const input = document.querySelector('#searchInput');
      const controls = document.querySelector('.searchInlineMatches');
      const count = document.querySelector('.searchInlineCount');
      const metrics = document.querySelector('#searchMetricsPanel');
      const rowRect = row.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      const style = getComputedStyle(count);
      const match = count.textContent.match(/^(\d+) \/ (\d+)/);
      return {
        text: metrics.textContent,
        jumpTotal: Number(match?.[2] || 0),
        compactDisplay: style.display,
        singleLine: Math.abs(inputRect.top - controlsRect.top) < rowRect.height,
        separated: inputRect.right <= controlsRect.left,
        rowHeight: rowRect.height,
      };
    });
    assert.ok(layout.text.includes(expectedText));
    assert.equal(layout.jumpTotal, 9, 'large occurrence totals must not inflate event-anchor membership');
    assert.equal(layout.singleLine, true);
    assert.equal(layout.separated, true);
    assert.ok(layout.rowHeight <= 48, `expected one-line HUD, got ${layout.rowHeight}px`);
    assert.equal(layout.compactDisplay === 'none', compactHidden);
  };

  await assertLayout({ expectedText: `${fullTextTotal} occurrences`, compactHidden: false });
  await page.setViewportSize({ width: 900, height: 900 });
  await assertLayout({ expectedText: `${fullTextTotal} occurrences`, compactHidden: false });
  await page.setViewportSize({ width: 390, height: 760 });
  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction((count) => document.querySelector('#searchMetricsPanel')?.textContent.includes(`${count} 处`), fullTextTotal);
  await assertLayout({ expectedText: `${fullTextTotal} 处`, compactHidden: true });
});

test('browser focused search input reopens assist through residual navigation scroll', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.locator('#searchInput').press('Escape');
  assert.equal(await page.locator('#searchAssist').isVisible(), false);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);
  await page.locator('#searchInput').click();
  assert.equal(await page.locator('#searchAssist').isVisible(), true);

  await page.locator('#searchInput').press('Enter');
  await page.locator('#searchInput').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);
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

test('browser intentional navigation abort invalidates an incomplete same-key cache', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  const eventId = await openColdLongSearchInspector(page);
  assert.ok(eventId);
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  t.after(() => releaseFirst());
  let navigationRequestCount = 0;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    const isNavigationRequest = url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
    if (!isNavigationRequest) {
      await route.continue();
      return;
    }
    navigationRequestCount += 1;
    if (navigationRequestCount === 1) {
      markFirstStarted();
      await firstGate;
    }
    try {
      await route.continue();
    } catch {}
  });

  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await firstStarted;
  await page.waitForSelector('#detail .eventNavigator .navStatus');

  const retry = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
  });
  const aborted = page.waitForEvent('requestfailed', (request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('limit') === '500';
  });
  await fillSearch(page, 'different-query');
  await fillSearch(page, 'needle');
  await page.locator('[data-detail-action="close"]').click();
  releaseFirst();
  await aborted;
  await page.waitForTimeout(100);

  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await retry;
  await page.waitForSelector('#detail .eventNavigator .navPosition');
  assert.equal(navigationRequestCount, 2);
});

test('browser previous search navigation scans backward wrap through UI pages', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  const committedSearch = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '150';
  });
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('37 occurrences'));
  await committedSearch;
  await page.locator('#searchInput').blur();
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
  await waitForTimelineAppendIdle(page);

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

test('browser search navigation preserves inspector marks while ignoring raw-detail chrome', async (t) => {
  const longFixture = await makeLongCodexHome(t, { includeCommandDetailNeedles: true });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await page.locator('#timeline .event.kind-command').first().click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail...'));
  await fillSearch(page, 'cwd');
  await page.waitForSelector('#detail mark.searchMark');
  const beforeInspector = await searchNavigationSnapshot(page);

  const inspectorTargetIds = await page.locator('#detail mark.searchMark').evaluateAll((marks) => (
    marks.map((mark) => mark.dataset.searchTargetId).filter(Boolean)
  ));
  assert.ok(await page.locator('#detail mark.searchMark').count() > 0, 'Inspector occurrences remain highlighted');
  assert.ok(inspectorTargetIds.every((id) => beforeInspector.ids.includes(id)));
  assert.ok(new Set(inspectorTargetIds).size <= 1, 'one Inspector event may bind at most one event anchor');

  let releaseRawRequest;
  let markRawRequestStarted;
  const rawRequestRelease = new Promise((resolve) => { releaseRawRequest = resolve; });
  const rawRequestStarted = new Promise((resolve) => { markRawRequestStarted = resolve; });
  await page.route('**/api/sessions/*/raw/*', async (route) => {
    markRawRequestStarted();
    await rawRequestRelease;
    await route.continue();
  });
  await page.locator('#detail [data-detail-action="raw"]').click();
  await rawRequestStarted;
  await waitForDetailView(page, 'rawRefs');
  await page.waitForSelector('#detail .rawRefsView');
  assert.equal(await page.locator('#detail').textContent().then((text) => text.includes('Loading...')), true);
  assert.equal(await page.locator('#detail mark.searchMark').count(), 0);

  releaseRawRequest();
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.toLowerCase().includes('cwd'));
  assert.equal(await page.locator('#detail mark.searchMark').count(), 0);
  assert.deepEqual((await searchNavigationSnapshot(page)).ids, beforeInspector.ids, 'Raw refs transition must not change membership');

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('14 occurrences'));
  assert.equal(await page.locator('#detail mark.searchMark').count(), 0);
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
  const { page } = await openWave1cM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenCommandProfile]),
      'sessionAnalyzer.profile': hiddenCommandProfile.id,
    },
  });
  await selectPrimarySession(page);

  await page.waitForFunction(() => document.querySelector('#timeline .event.kind-command.hiddenByProfile'));
  await page.evaluate(() => window.__wave1cM1.reset());
  await fillSearch(page, 'alpha failed');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 1 targets')
    && document.querySelector('#searchMetricsPanel')?.textContent.includes('1 occurrences'));

  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await page.waitForFunction(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'searchTransientRevision',
  ));
  assert.ok((await latestWave1cM1Lifecycle(page))
    .mountedPresentationToken.searchTransientRevision > 0);
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

  await fillSearch(page, '');
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

test('browser stale detail and Raw refs offer localized project reindex recovery', async (t) => {
  const index = await buildFixtureIndex();
  const installStaleRoutes = async (targetPage) => {
    await targetPage.route('**/api/sessions/*/events/*/detail*', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Indexed source changed; reindex required',
        code: 'INDEXED_SOURCE_STALE',
      }),
    }));
    await targetPage.route('**/api/sessions/*/raw/*', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Indexed source changed; reindex required',
        code: 'INDEXED_SOURCE_STALE',
      }),
    }));
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installStaleRoutes,
  });
  await selectPrimarySession(page);

  await page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(page, 'inspector');
  await page.waitForSelector('#detail [data-detail-action="reindex-project"]');
  assert.match(await page.locator('#detail').innerText(), /source transcript changed after this index was built/i);
  assert.equal(await page.locator('#detail [data-detail-action="retry-detail"]').count(), 0);

  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForSelector('#detail .rawRefsView [data-detail-action="reindex-project"]');
  assert.match(await page.locator('#detail .rawRefsView').innerText(), /source transcript changed after this index was built/i);
  assert.equal(await page.locator('#detail [data-detail-action="retry-detail"]').count(), 0);

  const refreshRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/api/project' && request.method() === 'POST'
  ));
  await page.locator('#detail [data-detail-action="reindex-project"]').click();
  await refreshRequest;

  const zhApp = await openApp(t, index, {
    locale: 'zh-CN',
    beforeGoto: installStaleRoutes,
  });
  await selectPrimarySession(zhApp.page);
  await zhApp.page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(zhApp.page, 'inspector');
  await zhApp.page.waitForSelector('#detail [data-detail-action="reindex-project"]');
  assert.match(await zhApp.page.locator('#detail').innerText(), /来源转录已发生变化/);
  assert.equal(await zhApp.page.locator('#detail [data-detail-action="reindex-project"]').innerText(), '重新索引当前项目');

  const transientApp = await openApp(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail*', (route) => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic transient detail failure' }),
      }));
    },
  });
  await selectPrimarySession(transientApp.page);
  await transientApp.page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(transientApp.page, 'inspector');
  await transientApp.page.waitForSelector('#detail [data-detail-action="retry-detail"]');
  assert.match(await transientApp.page.locator('#detail').innerText(), /Synthetic transient detail failure/);
  assert.equal(await transientApp.page.locator('#detail [data-detail-action="reindex-project"]').count(), 0);
});

test('browser obsolete detail and Raw Reference requests abort without redrawing the replacement view', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(targetId);
  const targetDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(targetId)}/detail`;
  const failures = [];
  page.on('requestfailed', (request) => failures.push({
    path: new URL(request.url()).pathname,
    error: request.failure()?.errorText || '',
  }));

  let releaseDetail;
  const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  let markDetail;
  const detailStarted = new Promise((resolve) => { markDetail = resolve; });
  let firstDetail = true;
  await page.route((url) => new URL(String(url)).pathname === targetDetailPath, async (route) => {
    if (!firstDetail) {
      await route.continue();
      return;
    }
    firstDetail = false;
    markDetail();
    await detailGate;
    try {
      await route.continue();
    } catch {}
  });

  await target.click();
  await detailStarted;
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 40);
  releaseDetail();
  await page.waitForTimeout(300);
  assert.ok(failures.some((failure) => (
    failure.path === targetDetailPath && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)
  )));
  assert.equal(await page.locator(`[data-session-id="${fixture.secondarySessionId}"].active`).count(), 1);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 40);

  await page.locator(`[data-session-id="${fixture.longSessionId}"]`).click();
  await assertEventCount(page, 150);
  await page.locator(`[data-event-id="${targetId}"]`).click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail'));

  const fixtureIndex = await buildFixtureIndex();
  const secondApp = await openApp(t, fixtureIndex, { locale: 'en' });
  await selectPrimarySession(secondApp.page);
  await secondApp.page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(secondApp.page, 'inspector');
  const rawFailures = [];
  secondApp.page.on('requestfailed', (request) => {
    if (/^\/api\/sessions\/[^/]+\/raw\/[^/]+$/.test(new URL(request.url()).pathname)) {
      rawFailures.push(request.failure()?.errorText || '');
    }
  });
  let releaseRaw;
  const rawGate = new Promise((resolve) => { releaseRaw = resolve; });
  let markRaw;
  const rawStarted = new Promise((resolve) => { markRaw = resolve; });
  let rawRequestCount = 0;
  await secondApp.page.route('**/api/sessions/*/raw/*', async (route) => {
    rawRequestCount += 1;
    if (rawRequestCount > 1) {
      await route.continue();
      return;
    }
    markRaw();
    await rawGate;
    try {
      await route.continue();
    } catch {}
  });
  await secondApp.page.locator('[data-detail-action="raw"]').click();
  await rawStarted;
  await waitForDetailView(secondApp.page, 'rawRefs');
  await secondApp.page.locator('[data-detail-action="inspect"]').click();
  await waitForDetailView(secondApp.page, 'inspector');
  releaseRaw();
  await secondApp.page.waitForTimeout(300);
  assert.ok(rawFailures.some((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), rawFailures.join(', '));
  await secondApp.page.locator('[data-detail-action="raw"]').click();
  await waitForDetailView(secondApp.page, 'rawRefs');
  await secondApp.page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading'));
});

test('browser project scope aborts in-flight selected structured detail before it can restore a session Inspector', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(targetId);
  const targetDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(targetId)}/detail`;
  let releaseDetail;
  const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  let markDetail;
  const detailStarted = new Promise((resolve) => { markDetail = resolve; });
  let firstDetail = true;
  await page.route((url) => new URL(String(url)).pathname === targetDetailPath, async (route) => {
    if (!firstDetail) {
      await route.continue();
      return;
    }
    firstDetail = false;
    markDetail();
    await detailGate;
    try {
      await route.continue();
    } catch {}
  });

  await target.click();
  await detailStarted;
  const detailAbort = page.waitForEvent('requestfailed', (request) => (
    new URL(request.url()).pathname === targetDetailPath
      && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(request.failure()?.errorText || '')
  ));

  await switchToProjectScope(page);
  releaseDetail();
  await detailAbort;
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && Boolean(document.querySelector('#timeline .projectSearchState'))
      && document.querySelector('#detail')?.textContent === ''
  ));
  assert.equal(await page.locator(`[data-event-id="${targetId}"]`).count(), 0);
});

test('browser project scope aborts in-flight Raw References before they can restore a session detail view', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  await page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(page, 'inspector');

  let releaseRaw;
  const rawGate = new Promise((resolve) => { releaseRaw = resolve; });
  let markRaw;
  const rawStarted = new Promise((resolve) => { markRaw = resolve; });
  let firstRaw = true;
  await page.route('**/api/sessions/*/raw/*', async (route) => {
    if (!firstRaw) {
      await route.continue();
      return;
    }
    firstRaw = false;
    markRaw();
    await rawGate;
    try {
      await route.continue();
    } catch {}
  });

  await page.locator('[data-detail-action="raw"]').click();
  await rawStarted;
  const rawAbort = page.waitForEvent('requestfailed', (request) => (
    /^\/api\/sessions\/[^/]+\/raw\/[^/]+$/.test(new URL(request.url()).pathname)
      && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(request.failure()?.errorText || '')
  ));

  await switchToProjectScope(page);
  releaseRaw();
  await rawAbort;
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && Boolean(document.querySelector('#timeline .projectSearchState'))
      && document.querySelector('#detail')?.textContent === ''
  ));
});

test('browser Layer transitions abort an in-flight selected detail instead of restoring the previous-layer Inspector', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(targetId);
  const targetDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(targetId)}/detail`;
  let releaseDetail;
  const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  let markDetail;
  const detailStarted = new Promise((resolve) => { markDetail = resolve; });
  let firstDetail = true;
  await page.route((url) => new URL(String(url)).pathname === targetDetailPath, async (route) => {
    if (!firstDetail) {
      await route.continue();
      return;
    }
    firstDetail = false;
    markDetail();
    await detailGate;
    try {
      await route.continue();
    } catch {}
  });

  await target.click();
  await detailStarted;
  const detailAbort = page.waitForEvent('requestfailed', (request) => (
    new URL(request.url()).pathname === targetDetailPath
      && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(request.failure()?.errorText || '')
  ));
  const protocolTimeline = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('layer') === 'protocol'
      && url.searchParams.get('offset') === '0';
  });

  await page.locator('#layerSelect').selectOption('protocol');
  await protocolTimeline;
  releaseDetail();
  await detailAbort;
  await page.waitForFunction(() => (
    document.querySelector('#layerSelect')?.value === 'protocol'
      && !document.querySelector('#detail')?.textContent.includes('Synthetic timeline event 0100.')
  ));
});

test('browser delayed background detail prefetch does not redraw the selected Inspector', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const background = page.locator('#timeline .event[data-event-id]').nth(21);
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const backgroundId = await background.getAttribute('data-event-id');
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(backgroundId);
  assert.ok(targetId);
  const backgroundDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(backgroundId)}/detail`;
  let releaseBackground;
  const backgroundGate = new Promise((resolve) => { releaseBackground = resolve; });
  let markBackgroundStarted;
  const backgroundStarted = new Promise((resolve) => { markBackgroundStarted = resolve; });
  await page.route((url) => new URL(String(url)).pathname === backgroundDetailPath, async (route) => {
    markBackgroundStarted();
    await backgroundGate;
    try {
      await route.continue();
    } catch {}
  });

  const backgroundToggle = background.locator('.eventHeader [data-action="toggle"]');
  if (await background.evaluate((event) => event.classList.contains('expanded'))) {
    await backgroundToggle.click();
    await page.waitForFunction((eventId) => {
      const event = [...document.querySelectorAll('#timeline .event[data-event-id]')]
        .find((candidate) => candidate.dataset.eventId === eventId);
      return Boolean(event && !event.classList.contains('expanded'));
    }, backgroundId);
  }
  await backgroundToggle.click();
  await backgroundStarted;

  await target.click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction((eventId) => {
    const targetEvent = [...document.querySelectorAll('#timeline .event[data-event-id]')]
      .find((candidate) => candidate.dataset.eventId === eventId);
    const detail = document.querySelector('#detail')?.textContent || '';
    return Boolean(targetEvent?.classList.contains('selected'))
      && !detail.includes('Loading structured detail')
      && !document.querySelector('#detail .navStatus');
  }, targetId);
  const selectedInspector = await page.locator('#detail').innerHTML();
  const backgroundResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === backgroundDetailPath && response.status() === 200
  ));

  releaseBackground();
  await backgroundResponse;
  await page.waitForFunction(({ backgroundId: currentBackgroundId, targetId: currentTargetId }) => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    const backgroundEvent = events.find((candidate) => candidate.dataset.eventId === currentBackgroundId);
    const targetEvent = events.find((candidate) => candidate.dataset.eventId === currentTargetId);
    return Boolean(backgroundEvent?.classList.contains('expanded')
      && !backgroundEvent.textContent.includes('Loading structured detail')
      && targetEvent?.classList.contains('selected')
      && !backgroundEvent.classList.contains('selected'));
  }, { backgroundId, targetId });
  assert.equal(await page.locator('#detail').innerHTML(), selectedInspector);
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

  await addSearchFilter(page, 'kind', 'patch');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length > 0 && events.every((event) => event.classList.contains('kind-patch'));
  });
  await waitForDetailView(page, 'profileRules');
});

test('browser search input treats operator-like text literally and GUI filters stay authoritative', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  const requestStart = requestedUrls.length;

  await page.locator('#layerSelect').selectOption('raw');
  await expectInputValue(page, '#layerSelect', 'raw');
  await addSearchFilter(page, 'kind', 'exec_command_end');
  await addSearchFilter(page, 'file', 'src/parser.js');

  const committedTimeline = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('layer') === 'raw'
      && url.searchParams.get('q') === 'alpha owner:me status:failed'
      && url.searchParams.get('kind') === 'exec_command_end'
      && url.searchParams.get('file') === 'src/parser.js'
      && !url.searchParams.has('status');
  });
  await fillSearch(page, 'alpha owner:me status:failed');
  await committedTimeline;

  await expectInputValue(page, '#searchInput', 'alpha owner:me status:failed');
  assert.equal(await page.locator('#searchInput').getAttribute('aria-invalid'), null);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'raw');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 2');
  assert.equal(await page.locator('#searchKindSelect').inputValue(), 'exec_command_end');
  assert.equal(await page.locator('#searchFileInput').inputValue(), 'src/parser.js');
  assert.equal(requestedUrls.slice(requestStart).some((value) => value.startsWith('/api/sessions?')), false);

  await addSearchFilter(page, 'status', 'failed');
  await expectInputValue(page, '#searchInput', 'alpha owner:me status:failed');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 3');

  await clearAllSearch(page);
  await expectInputValue(page, '#layerSelect', 'raw');
  assert.equal(await page.locator('#layerSelect').inputValue(), 'raw');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters');
});

test('browser assist filter transition keeps the next free-text edit on the find-refresh path', async (t) => {
  const fixture = await makeLongCodexHome(t);
  const index = await buildIndex(fixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await page.locator('#searchInput').click();
  await addSearchFilter(page, 'file', fixture.sessionId);
  await assertEventCount(page, 150);
  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 180);
  const requestStart = requestedUrls.length;

  const findResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('file') === fixture.sessionId
      && url.searchParams.get('q') === 'alpha';
  });
  await fillSearch(page, 'alpha');
  const response = await findResponse;
  const url = new URL(response.url());
  assert.equal(url.searchParams.get('limit'), '180');
  await assertEventCount(page, 180);
  assert.equal(requestedUrls.slice(requestStart).some((value) => value.startsWith('/api/sessions?')), false);
});

test('browser read from here clears structured filters and preserves free text', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await fillSearch(page, 'failed');
  await addSearchFilter(page, 'kind', 'patch');
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
