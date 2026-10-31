'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');

const {
  installWave1cM1BrowserSeam,
  installWave1cM2MutationLedger,
  deferred,
  openApp,
  openWave1bM2App,
  beginWave1cM2Operation,
  wave1cM2OperationRows,
  latestWave1cM1Lifecycle,
  assertEventCount,
  waitForTimelineAppendIdle,
  fillSearch,
  addSearchFilter,
  clearAllSearch,
  waitForSearchMarks,
  searchNavigationSnapshot,
  clickSearchNavigationAndWait,
  waitForDetailView,
  makeLongCodexHome,
  makeTransitionProfileIndex,
} = require('./browser-helpers');

async function resetWave1bM2RenderEvidence(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    window.__wave1bM2.resetRenders();
    resolve();
  })));
}

async function wave1bM2RenderCardCounts(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return page.evaluate(() => [...window.__wave1bM2.evidence.renderCardCounts]);
}

async function moveToLastSearchMark(page) {
  const snapshot = () => page.evaluate(() => {
    const active = document.querySelector('.searchMark.activeSearchMark');
    const match = document.querySelector('.searchInlineCount')?.textContent.match(/^(\d+) \/ (\d+)/);
    const current = Number(match?.[1] || 0);
    const total = Number(match?.[2] || 0);
    return {
      atLast: total > 0 && current === total,
      identity: `${active?.dataset.searchTargetId || ''}:${current}/${total}`,
    };
  });

  for (let i = 0; i < 50; i += 1) {
    const before = await snapshot();
    if (before.atLast) return;
    await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
    await page.waitForFunction((identity) => {
      const active = document.querySelector('.searchMark.activeSearchMark');
      const match = document.querySelector('.searchInlineCount')?.textContent.match(/^(\d+) \/ (\d+)/);
      const current = Number(match?.[1] || 0);
      const total = Number(match?.[2] || 0);
      return `${active?.dataset.searchTargetId || ''}:${current}/${total}` !== identity;
    }, before.identity);
  }
  assert.fail('search navigation did not reach the last live mark');
}

test('browser user scroll during the search-scroll guard still loads the next page', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  const before = await searchNavigationSnapshot(page);
  await clickSearchNavigationAndWait(page, 'next', before.id);

  const requestStart = requestedUrls.length;
  const timelinePane = page.locator('.timelinePane');
  await timelinePane.hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 300);
  await waitForTimelineAppendIdle(page);

  const paginationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(paginationRequests.some((url) => url.searchParams.get('offset') === '150'), true);
});

test('browser an above-threshold user scroll cannot authorize a later programmatic bottom scroll', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const timelinePane = page.locator('.timelinePane');

  await assertEventCount(page, 150);
  await timelinePane.hover();
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => document.querySelector('.timelinePane')?.scrollTop > 0);
  await page.waitForTimeout(180);
  const programmaticScrollStart = requestedUrls.length;
  await timelinePane.evaluate((pane) => {
    pane.querySelector('.event[data-event-id]:last-of-type')?.scrollIntoView({ block: 'end', behavior: 'auto' });
  });
  await page.waitForTimeout(300);

  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150);
  const leakedRequests = requestedUrls.slice(programmaticScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(leakedRequests.some((url) => url.searchParams.get('offset') === '150'), false);

  await timelinePane.evaluate((pane) => { pane.scrollTop = 0; });
  await timelinePane.hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 300);
  await waitForTimelineAppendIdle(page);
});

test('browser a scroll during an in-flight append cannot leak pagination authority after loading settles', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 450 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const timelinePane = page.locator('.timelinePane');
  let releaseAppend;
  const appendGate = new Promise((resolve) => { releaseAppend = resolve; });
  let markAppendStarted;
  const appendStarted = new Promise((resolve) => { markAppendStarted = resolve; });
  let gated = false;
  t.after(() => releaseAppend?.());
  await page.route('**/api/sessions/*/timeline?*', async (route) => {
    const url = new URL(route.request().url());
    if (!gated && url.searchParams.get('offset') === '150') {
      gated = true;
      markAppendStarted();
      await appendGate;
    }
    await route.continue();
  });

  await page.locator('#loadMoreBtn').click();
  await appendStarted;
  await timelinePane.evaluate(async (pane) => {
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    pane.scrollTop = 120;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  releaseAppend();
  await assertEventCount(page, 300);

  const programmaticScrollStart = requestedUrls.length;
  await timelinePane.evaluate((pane) => {
    pane.querySelector('.event[data-event-id]:last-of-type')?.scrollIntoView({ block: 'end', behavior: 'auto' });
  });
  await page.waitForTimeout(300);
  await waitForTimelineAppendIdle(page);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 300);
  const leakedRequests = requestedUrls.slice(programmaticScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(leakedRequests.some((url) => url.searchParams.get('offset') === '300'), false);
});

test('browser touch inertia keeps one pagination sequence until its later bottom scroll', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const requestStart = requestedUrls.length;

  await assertEventCount(page, 150);
  await page.locator('.timelinePane').evaluate(async (pane) => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    pane.dispatchEvent(new Event('touchmove', { bubbles: true }));
    pane.scrollTop = 120;
    await nextFrame();
    pane.scrollTop = 240;
    await nextFrame();
    pane.scrollTop = pane.scrollHeight;
    await nextFrame();
  });
  await assertEventCount(page, 300);
  await waitForTimelineAppendIdle(page);
  const paginationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(paginationRequests.map((url) => url.searchParams.get('offset')), ['150']);
});

test('browser reverse touch or pointer movement and modified scrolling input cannot authorize pagination', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const requestStart = requestedUrls.length;
  const timelinePane = page.locator('.timelinePane');

  const moveNearBottom = async () => {
    await timelinePane.evaluate(async (pane) => {
      pane.scrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight - 48);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  };
  const assertNotAppended = async (message) => {
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150, message);
  };

  await assertEventCount(page, 150);
  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    pane.dispatchEvent(new Event('touchmove', { bubbles: true }));
    pane.scrollTop = Math.max(0, pane.scrollTop - 12);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('reverse touch movement must not append');

  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    const pointerMove = new Event('pointermove', { bubbles: true });
    Object.defineProperty(pointerMove, 'buttons', { value: 1 });
    pane.dispatchEvent(pointerMove);
    pane.scrollTop = Math.max(0, pane.scrollTop - 12);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('reverse pointer movement must not append');

  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    pane.focus();
    pane.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', shiftKey: true }));
    pane.scrollTop = Math.max(0, pane.scrollTop - 12);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('Shift+Space must not append');

  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120, ctrlKey: true }));
    pane.scrollTop = pane.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('modified wheel input must not append');
  const paginationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(paginationRequests.some((url) => url.searchParams.get('offset') === '150'), false);
});

test('browser replacement pagination requires current-context intent while explicit wheel and keyboard scrolling still append', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  await assertEventCount(page, 150);
  let previousOffset = 150;
  for (const expected of [300, 450, 600]) {
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('offset') === String(previousOffset);
    });
    await page.locator('#loadMoreBtn').click();
    await response;
    await assertEventCount(page, expected);
    previousOffset = expected;
  }
  const deepEventId = await page.locator('#timeline .event[data-event-id]').nth(501).getAttribute('data-event-id');
  await page.locator(`[data-event-id="${deepEventId}"]`).click();
  await waitForDetailView(page, 'inspector');
  await page.waitForSelector('#detail .eventNavigator .navPosition');

  const filterRequestStart = requestedUrls.length;
  const filterPageZero = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '0';
  });
  await addSearchFilter(page, 'kind', 'assistant_message');
  await filterPageZero;
  await assertEventCount(page, 150);
  await page.waitForTimeout(500);

  const filterRequests = requestedUrls.slice(filterRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(filterRequests.map((url) => url.searchParams.get('offset')), ['0']);
  assert.equal(await page.locator('#timeline .event.selected').count(), 0, 'deep selection outside page zero resets deterministically');
  assert.equal(await page.locator('.timelinePane').evaluate((pane) => pane.scrollTop), 0);

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 300);
  const explicitRequest = new URL(requestedUrls.filter((value) => value.includes('/timeline?')).at(-1), 'http://local');
  assert.equal(explicitRequest.searchParams.get('offset'), '150');

  const userScrollStart = requestedUrls.length;
  await page.locator('.timelinePane').hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 350);
  const userScrollRequests = requestedUrls.slice(userScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(userScrollRequests.map((url) => url.searchParams.get('offset')), ['300']);

  await page.locator('.timelinePane').evaluate((pane) => { pane.scrollTop = pane.scrollHeight; });
  const clearRequestStart = requestedUrls.length;
  const clearPageZero = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && !url.searchParams.has('kind')
      && url.searchParams.get('offset') === '0';
  });
  await clearAllSearch(page);
  await clearPageZero;
  await assertEventCount(page, 150);
  await page.waitForTimeout(500);
  const clearRequests = requestedUrls.slice(clearRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(clearRequests.map((url) => url.searchParams.get('offset')), ['0']);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  assert.equal(await page.locator('body').getAttribute('data-search-scope'), 'session');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /150\/700/);

  const keyboardScrollStart = requestedUrls.length;
  const keyboardTimelinePane = page.locator('.timelinePane');
  await page.waitForFunction(() => document.querySelector('.timelinePane')?.scrollTop === 0);
  await keyboardTimelinePane.click({ position: { x: 5, y: 5 } });
  assert.equal(await keyboardTimelinePane.evaluate((pane) => document.activeElement === pane), true);
  const keyboardAppend = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('offset') === '150';
  });
  await keyboardTimelinePane.press('End');
  await keyboardAppend;
  await assertEventCount(page, 300);
  const keyboardScrollRequests = requestedUrls.slice(keyboardScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(keyboardScrollRequests.map((url) => url.searchParams.get('offset')), ['150']);

  const retainedEvent = page.locator('#timeline .event[data-event-id]').nth(1);
  const retainedEventId = await retainedEvent.getAttribute('data-event-id');
  await retainedEvent.click();
  const retainedPageZero = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '0';
  });
  await addSearchFilter(page, 'kind', 'assistant_message');
  await retainedPageZero;
  await assertEventCount(page, 150);
  assert.equal(await page.locator('#timeline .event.selected').getAttribute('data-event-id'), retainedEventId);
});

test('browser Layer focus restoration keeps its explicit deep loads without a residual append', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  for (const expected of [300, 450, 600]) {
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('offset') === String(expected - 150);
    });
    await page.locator('#loadMoreBtn').click();
    await response;
    await assertEventCount(page, expected);
  }
  await page.locator('#timeline .event[data-event-id]').nth(501).click();
  await waitForDetailView(page, 'inspector');

  const layerRequestStart = requestedUrls.length;
  await page.locator('#layerSelect').selectOption('raw');
  await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'raw');
  await page.waitForFunction(() => document.querySelector('#timeline .event.selected'));
  await page.waitForFunction(() => !document.querySelector('#loadMoreBtn')?.textContent.includes('Loading'));
  await page.waitForTimeout(500);

  const rawRequests = requestedUrls.slice(layerRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('layer') === 'raw');
  assert.ok(rawRequests.some((url) => url.searchParams.get('offset') === '0'));
  assert.ok(rawRequests.some((url) => url.searchParams.get('offset') === '450'));
  assert.equal(rawRequests.some((url) => url.searchParams.get('offset') === '600'), false, rawRequests.map((url) => url.search).join('\n'));
  assert.ok(await page.locator('#timeline .event[data-event-id]').count() >= 502);
});

test('browser rapid query filter and Session replacement aborts old work and settles latest intent', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const failed = [];
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/timeline')) failed.push(request.failure()?.errorText || '');
  });

  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  let slowCount = 0;
  let markFirst;
  let markSecond;
  const firstSlowRequest = new Promise((resolve) => { markFirst = resolve; });
  const secondSlowRequest = new Promise((resolve) => { markSecond = resolve; });
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== 'slow-query') {
      await route.continue();
      return;
    }
    slowCount += 1;
    if (slowCount === 1) markFirst();
    if (slowCount === 2) markSecond();
    await slowGate;
    try {
      await route.continue();
    } catch {}
  });

  await fillSearch(page, 'slow-query');
  await firstSlowRequest;
  await addSearchFilter(page, 'kind', 'assistant_message');
  await secondSlowRequest;
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 20);
  releaseSlow();
  await page.waitForTimeout(400);

  assert.ok(failed.length >= 2, `expected both superseded timeline requests to abort, received ${failed.join(', ')}`);
  assert.ok(failed.every((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), failed.join(', '));
  const newSessionRequests = requestedUrls
    .filter((value) => value.includes(`/api/sessions/${fixture.secondarySessionId}/timeline?`))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(newSessionRequests.at(-1).searchParams.get('offset'), '0');
  assert.equal(await page.locator('.timelinePane').evaluate((pane) => pane.scrollTop), 0);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
  assert.equal((await page.locator('#loadMoreBtn').textContent()).includes('Loading'), false);
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser intentional timeline abort permits an immediate same-surface retry without stale cleanup', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  const failed = [];
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/timeline')) failed.push(request.failure()?.errorText || '');
  });

  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  let markSlow;
  const slowStarted = new Promise((resolve) => { markSlow = resolve; });
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== 'slow-query') {
      await route.continue();
      return;
    }
    markSlow();
    await slowGate;
    try {
      await route.continue();
    } catch {}
  });

  await fillSearch(page, 'slow-query');
  await slowStarted;
  await fillSearch(page, 'far-needle');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length === 600);
  releaseSlow();
  await page.waitForTimeout(300);

  assert.ok(failed.some((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), failed.join(', '));
  assert.equal(await page.locator('#searchInput').inputValue(), 'far-needle');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /600\/700/);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser real timeline errors remain visible and leave explicit retry available', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  let failNext = true;
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (failNext && url.searchParams.get('offset') === '150') {
      failNext = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic timeline failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic timeline failure'));
  assert.equal(await page.locator('#loadMoreBtn').isEnabled(), true);
  assert.equal((await page.locator('#loadMoreBtn').textContent()).includes('Loading'), false);

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 300);
  assert.match(await page.locator('#loadMoreBtn').textContent(), /300\/700/);
});

test('browser successful page-zero append retry recommits automatic pagination', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  let failReplacement = true;
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (failReplacement && url.searchParams.get('offset') === '0') {
      failReplacement = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic replacement failure' }),
      });
      return;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await page.locator(`[data-session-id="${fixture.longSessionId}"]`).click();
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic replacement failure'));
  assert.equal(await page.locator('#loadMoreBtn').isEnabled(), true);

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 150);

  await page.locator('.timelinePane').hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 300);

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local').searchParams.get('offset'));
  assert.deepEqual(offsets, ['0', '0', '150']);
});

test('browser retries a failed replacement in its new structured context before normal append resumes', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  let failReplacement = true;
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (failReplacement
        && url.searchParams.get('kind') === 'assistant_message'
        && url.searchParams.get('offset') === '0') {
      failReplacement = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic structured replacement failure' }),
      });
      return;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await addSearchFilter(page, 'kind', 'assistant_message');
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic structured replacement failure'));
  assert.equal(await page.locator('#loadMoreBtn').isEnabled(), true);
  assert.equal(await page.locator('#loadMoreBtn').textContent(), 'Retry timeline');

  const retryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '0'
      && response.status() === 200;
  });
  await page.locator('#loadMoreBtn').click();
  await retryResponse;
  await assertEventCount(page, 150);

  const appendResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '150'
      && response.status() === 200;
  });
  await page.locator('#loadMoreBtn').click();
  await appendResponse;
  await assertEventCount(page, 300);

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('kind') === 'assistant_message')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['0', '0', '150']);
});

test('browser search navigation loads only the next hit page before wrapping', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('37 occurrences'));

  const inspectorRequestStart = requestedUrls.length;
  await moveToLastSearchMark(page);

  const inspectorRequests = requestedUrls.slice(inspectorRequestStart)
    .filter((value) => value.includes('/timeline?'));
  assert.equal(
    inspectorRequests.some((value) => new URL(value, 'http://local').searchParams.get('limit') === '500'),
    false,
    `search-origin inspector should not preload navigation events: ${inspectorRequests.join(', ')}`,
  );

  const beforeBoundary = await searchNavigationSnapshot(page);
  assert.equal(beforeBoundary.current, beforeBoundary.total);
  const boundaryRequestStart = requestedUrls.length;
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();

  await assertEventCount(page, 300);
  await page.waitForFunction(() => (
    document.querySelector('#timeline mark.searchMark.activeSearchMark')
      ?.closest('[data-event-id]')
      ?.textContent
      ?.includes('Long timeline row 153')
  ));
  await waitForTimelineAppendIdle(page);
  const afterBoundary = await searchNavigationSnapshot(page);
  assert.ok(afterBoundary.total > beforeBoundary.total);
  assert.ok(afterBoundary.current > beforeBoundary.current);
  assert.notEqual(afterBoundary.id, beforeBoundary.id);

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

test('browser Wave 1B M2 automatic preload coalesces three pages into one append flush', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-preload-collapsed',
    name: 'Wave 1C preload collapsed fixture',
    description: 'Avoid unrelated detail fallback during the publication-phase assertion.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 700,
    needleIndices: [650],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openWave1bM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await installWave1cM1BrowserSeam(targetPage);
      await installWave1cM2MutationLedger(targetPage);
    },
  });
  const suffixStarted = deferred();
  const suffixRelease = deferred();
  t.after(() => suffixRelease.resolve());
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '150') {
      suffixStarted.resolve();
      await suffixRelease.promise;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await resetWave1bM2RenderEvidence(page);
  const operationId = await beginWave1cM2Operation(page);
  await fillSearch(page, 'needle');
  await suffixStarted.promise;
  await assertEventCount(page, 150);
  const prefix = await latestWave1cM1Lifecycle(page);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    window.__wave1cM1SearchPrefix = cards;
    window.__wave1cM1SearchPrefixById = new Map(cards.map((card) => [card.dataset.eventId, card]));
    window.__wave1cM1.reset();
  });
  suffixRelease.resolve();
  await assertEventCount(page, 600);
  const rows = await wave1cM2OperationRows(page, operationId);

  const requests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('q') === 'needle');
  assert.deepEqual(requests.map((url) => ({
    offset: url.searchParams.get('offset'),
    limit: url.searchParams.get('limit'),
  })), [
    { offset: '0', limit: '150' },
    { offset: '150', limit: '150' },
    { offset: '300', limit: '150' },
    { offset: '450', limit: '150' },
  ]);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 600);
  assert.equal((await searchNavigationSnapshot(page)).total, 0);
  assert.equal(await page.locator('[data-search-load-more-targets]').count(), 1);
  assert.deepEqual(
    [...new Set(await wave1bM2RenderCardCounts(page))],
    [150, 600],
  );
  const publication = await page.evaluate(() => structuredClone(
    window.__wave1cM1.evidence.lifecycle.find((item) => (
      item.operation === 'append' && item.ownerCount === 600 && item.createdOwnerCount === 450
    )),
  ));
  assert.ok(publication, 'search batch publication must register only the 450-card suffix');
  assert.equal(publication.sameCanonicalContext, true);
  assert.equal(publication.reusedOwnerCount, 0);
  assert.equal(publication.createdOwnerCount, 450);
  assert.equal(publication.ownerSerials[0], prefix.ownerSerials[0]);
  assert.equal(await page.evaluate(() => window.__wave1cM1SearchPrefix.filter((card) => (
    card.isConnected
      && window.__wave1cM1SearchPrefixById.get(card.dataset.eventId) === card
      && document.querySelector(`#timeline .event[data-event-id="${CSS.escape(card.dataset.eventId)}"]`) === card
  )).length), 150);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 1);
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 1);
  assert.equal(rows.reduce((total, row) => total + row.addedCanonicalCount, 0), 600);
});

test('browser Wave 1B M2 navigation later-page failure flushes earlier current-owner progress once and stops', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 900,
    needleIndices: [800],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openWave1bM2App(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);
  let failed = false;
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (!failed && url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '750') {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic Wave 1B navigation failure' }),
      });
      return;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await resetWave1bM2RenderEvidence(page);
  await page.locator('#searchInput').press('Enter');
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic Wave 1B navigation failure'));
  await assertEventCount(page, 750);
  await page.waitForFunction(() => !document.querySelector('[data-search-navigation-pending]'));

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('q') === 'needle')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['600', '750']);
  assert.equal(failed, true);
  const finalSearch = await searchNavigationSnapshot(page);
  assert.equal(finalSearch.id, '');
  assert.equal(finalSearch.total, 0);
  assert.deepEqual(await wave1bM2RenderCardCounts(page), [750]);
});

test('browser Wave 1B M2 forward late-target navigation flushes at the first hit page and settles detail', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1_000,
    needleIndices: [800],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openWave1bM2App(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);
  const requestStart = requestedUrls.length;
  await resetWave1bM2RenderEvidence(page);
  await page.locator('#searchInput').press('Enter');
  await assertEventCount(page, 900);
  await page.waitForFunction(() => (
    document.querySelector('#timeline mark.searchMark.activeSearchMark')
      ?.closest('[data-event-id]')
      ?.textContent
      ?.includes('Long timeline row 800')
  ));
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail'));

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('q') === 'needle')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['600', '750']);
  assert.deepEqual(
    [...new Set(await wave1bM2RenderCardCounts(page))],
    [900],
  );
  assert.ok((await page.locator('#timeline .event.selected').textContent()).includes('Long timeline row 800'));
});

test('browser Wave 1B M2 reverse navigation loads the remaining suffix to end before wrapping', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1_000,
    needleIndices: [100, 800],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openWave1bM2App(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);
  await page.waitForFunction(() => (
    JSON.parse(document.querySelector('#searchMetricsPanel')?.dataset.searchTargetIds || '[]').length === 1
  ));
  const requestStart = requestedUrls.length;
  await resetWave1bM2RenderEvidence(page);
  await page.locator('#searchInput').press('Shift+Enter');
  await assertEventCount(page, 1_000);
  await page.waitForFunction(() => (
    document.querySelector('#timeline mark.searchMark.activeSearchMark')
      ?.closest('[data-event-id]')
      ?.textContent
      ?.includes('Long timeline row 800')
  ));

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('q') === 'needle')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['600', '750', '900']);
  assert.deepEqual(
    [...new Set(await wave1bM2RenderCardCounts(page))],
    [1_000],
  );
});

test('browser Wave 1B M2 explicit load-more coalesces no-hit pages through the first new hit', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1_000,
    needleIndices: [100, 800],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openWave1bM2App(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]')?.disabled);
  const beforeTargets = (await searchNavigationSnapshot(page)).total;
  assert.equal(beforeTargets, 1);
  const requestStart = requestedUrls.length;
  await resetWave1bM2RenderEvidence(page);
  await page.locator('[data-search-load-more-targets]').click();
  await assertEventCount(page, 900);
  await page.waitForFunction(() => (
    JSON.parse(document.querySelector('#searchMetricsPanel')?.dataset.searchTargetIds || '[]').length === 2
  ));

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('q') === 'needle')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['600', '750']);
  assert.deepEqual(
    [...new Set(await wave1bM2RenderCardCounts(page))],
    [900],
  );
  assert.equal(await page.locator('[data-search-load-more-targets]').count(), 1);
});

test('browser Wave 1B M2 failed preload attempt consumes budget and current preload continues', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 700,
    needleIndices: [650],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openWave1bM2App(t, index, { locale: 'en' });
  let failed = false;
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (!failed && url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '300') {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic Wave 1B preload failure' }),
      });
      return;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await resetWave1bM2RenderEvidence(page);
  await fillSearch(page, 'needle');
  await assertEventCount(page, 450);
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]')?.disabled);
  assert.ok((await page.locator('#stateLine').textContent()).includes('synthetic Wave 1B preload failure'));

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('q') === 'needle')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['0', '150', '300', '300']);
  assert.equal(failed, true);
  assert.deepEqual(
    [...new Set(await wave1bM2RenderCardCounts(page))],
    [150, 300, 450],
  );
});

test('browser Wave 1B M2 load-more later-page failure flushes progress and clears pending without exhausting', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1_000,
    needleIndices: [100],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openWave1bM2App(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);
  let failed = false;
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (!failed && url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '750') {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic Wave 1B load-more failure' }),
      });
      return;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await resetWave1bM2RenderEvidence(page);
  await page.locator('[data-search-load-more-targets]').click();
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic Wave 1B load-more failure'));
  await assertEventCount(page, 750);
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]')?.disabled);

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('q') === 'needle')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['600', '750']);
  assert.equal(failed, true);
  assert.deepEqual(await wave1bM2RenderCardCounts(page), [750]);
  assert.equal(await page.locator('[data-search-load-more-targets]').count(), 1);
});

for (const invalidIdKind of ['duplicate', 'empty']) {
  test(`browser Wave 1B M2 later-page ${invalidIdKind} ID failure excludes that page and flushes prior progress`, async (t) => {
    const longFixture = await makeLongCodexHome(t, {
      eventCount: 900,
      needleIndices: [800],
    });
    const index = await buildIndex(longFixture);
    const { page, requestedUrls } = await openWave1bM2App(t, index, { locale: 'en' });
    await fillSearch(page, 'needle');
    await assertEventCount(page, 600);
    let corrupted = false;
    await page.route('**/timeline*', async (route) => {
      const url = new URL(route.request().url());
      if (!corrupted && url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '750') {
        corrupted = true;
        const response = await route.fetch();
        const body = await response.json();
        body.events[0].id = invalidIdKind === 'duplicate' ? body.events[1].id : '';
        await route.fulfill({ response, json: body });
        return;
      }
      await route.continue();
    });

    const requestStart = requestedUrls.length;
    await resetWave1bM2RenderEvidence(page);
    await page.locator('#searchInput').press('Enter');
    await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('Timeline event state invariant'));
    await assertEventCount(page, 750);
    await page.waitForFunction(() => !document.querySelector('[data-search-navigation-pending]'));

    const offsets = requestedUrls.slice(requestStart)
      .filter((value) => value.includes('/timeline?'))
      .map((value) => new URL(value, 'http://local'))
      .filter((url) => url.searchParams.get('q') === 'needle')
      .map((url) => url.searchParams.get('offset'));
    assert.deepEqual(offsets, ['600', '750']);
    assert.equal(corrupted, true);
    assert.deepEqual(await wave1bM2RenderCardCounts(page), [750]);
  });
}

test('browser Wave 1B M2 query supersession discards accepted local pages without an old flush', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 900,
    needleIndices: [800],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openWave1bM2App(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);

  const paused = deferred();
  const release = deferred();
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '750') {
      paused.resolve();
      await release.promise;
      try { await route.continue(); } catch {}
      return;
    }
    await route.continue();
  });

  await resetWave1bM2RenderEvidence(page);
  await page.locator('#searchInput').press('Enter');
  await paused.promise;
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 600);
  const replacement = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'ordinary'
      && url.searchParams.get('offset') === '500';
  });
  await fillSearch(page, 'ordinary');
  await replacement;
  await assertEventCount(page, 600);
  release.resolve();
  await page.waitForTimeout(300);

  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 600);
  assert.equal(await page.locator('#searchInput').inputValue(), 'ordinary');
  assert.equal((await wave1bM2RenderCardCounts(page)).includes(750), false);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
});

test('browser Wave 1B M2 Session supersession discards primary local pages and preserves the 40-card secondary state', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 900,
    hitPositions: [800],
  });
  const { page } = await openWave1bM2App(t, index, { locale: 'en' });
  await fillSearch(page, 'far-needle');
  await assertEventCount(page, 600);

  const paused = deferred();
  const release = deferred();
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'far-needle' && url.searchParams.get('offset') === '750') {
      paused.resolve();
      await release.promise;
      try { await route.continue(); } catch {}
      return;
    }
    await route.continue();
  });

  await resetWave1bM2RenderEvidence(page);
  await page.locator('#searchInput').press('Enter');
  await paused.promise;
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 600);
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 40);
  release.resolve();
  await page.waitForTimeout(300);

  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 40);
  assert.equal((await wave1bM2RenderCardCounts(page)).includes(750), false);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser Wave 1B M2 same-key replacement keeps newer preload pending ownership', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 700,
    needleIndices: [650],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openWave1bM2App(t, index, { locale: 'en' });
  const oldPaused = deferred();
  const oldRelease = deferred();
  const newPaused = deferred();
  const newRelease = deferred();
  let offset300Count = 0;
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '300') {
      offset300Count += 1;
      const gate = offset300Count === 1
        ? { paused: oldPaused, release: oldRelease }
        : { paused: newPaused, release: newRelease };
      gate.paused.resolve();
      await gate.release.promise;
      try { await route.continue(); } catch {}
      return;
    }
    await route.continue();
  });

  await fillSearch(page, 'needle');
  await oldPaused.promise;
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150);
  await page.locator(`[data-session-id="${longFixture.sessionId}"]`).click();
  await newPaused.promise;
  assert.equal(await page.locator('[data-search-load-more-targets]').isDisabled(), true);
  oldRelease.resolve();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-search-load-more-targets]').isDisabled(), true);
  newRelease.resolve();
  await assertEventCount(page, 600);
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]')?.disabled);

  assert.equal(offset300Count, 2);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 600);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
});

test('browser Wave 1B M2 same-key replacement makes stale navigation skip replacement-state scanning', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 900,
    needleIndices: [800],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openWave1bM2App(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);
  const oldPaused = deferred();
  const oldRelease = deferred();
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '750') {
      oldPaused.resolve();
      await oldRelease.promise;
      try { await route.continue(); } catch {}
      return;
    }
    await route.continue();
  });

  await resetWave1bM2RenderEvidence(page);
  await page.locator('#searchInput').press('Enter');
  await oldPaused.promise;
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 600);
  const replacement = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0';
  });
  await page.locator(`[data-session-id="${longFixture.sessionId}"]`).click();
  await replacement;
  oldRelease.resolve();
  await assertEventCount(page, 600);
  await page.waitForFunction(() => !document.querySelector('[data-search-navigation-pending]'));

  assert.equal((await wave1bM2RenderCardCounts(page)).includes(750), false);
  assert.equal((await searchNavigationSnapshot(page)).id, '');
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
});

test('browser Wave 1B M2 same-key replacement invalidates navigation during async detail activation', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1,
    includeFoldableSearchTargets: true,
  });
  const index = await buildIndex(longFixture);
  const hiddenCommandProfile = {
    id: 'custom:wave1b-stale-navigation-detail',
    name: 'Wave 1B stale navigation detail test',
    description: 'Keep command body matches unavailable until search navigation expands them.',
    rules: {
      kindStates: { command: 'hidden' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openWave1bM2App(t, index, {
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
  await waitForDetailView(page, 'profileRules');

  const detailStarted = deferred();
  const detailRelease = deferred();
  let detailRequestCount = 0;
  await page.route('**/api/sessions/*/events/*/detail*', async (route) => {
    detailRequestCount += 1;
    if (detailRequestCount > 1) {
      await route.continue();
      return;
    }
    detailStarted.resolve();
    await detailRelease.promise;
    try { await route.continue(); } catch {}
  });

  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await detailStarted.promise;
  const replacement = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'fold only target'
      && url.searchParams.get('offset') === '0';
  });
  await page.locator(`[data-session-id="${longFixture.sessionId}"]`).click();
  await replacement;
  detailRelease.resolve();
  await page.waitForFunction(() => !document.querySelector('[data-search-navigation-pending]'));
  await waitForDetailView(page, 'profileRules');

  assert.equal(detailRequestCount, 1);
  assert.equal((await searchNavigationSnapshot(page)).id, '');
  assert.equal(await page.locator('#timeline .event.selected').count(), 0);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
});

test('browser Wave 1B M2 same-key replacement protects newer pending and exhausted from stale load-more cleanup', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1_000,
    needleIndices: [100],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openWave1bM2App(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await assertEventCount(page, 600);
  const oldPaused = deferred();
  const oldRelease = deferred();
  const newPaused = deferred();
  const newRelease = deferred();
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '750') {
      oldPaused.resolve();
      await oldRelease.promise;
      try { await route.continue(); } catch {}
      return;
    }
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '300') {
      newPaused.resolve();
      await newRelease.promise;
      try { await route.continue(); } catch {}
      return;
    }
    await route.continue();
  });

  await page.locator('[data-search-load-more-targets]').click();
  await oldPaused.promise;
  const replacement = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0';
  });
  await page.locator(`[data-session-id="${longFixture.sessionId}"]`).click();
  await replacement;
  await newPaused.promise;
  assert.equal(await page.locator('[data-search-load-more-targets]').isDisabled(), true);
  oldRelease.resolve();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-search-load-more-targets]').isDisabled(), true);
  newRelease.resolve();
  await assertEventCount(page, 600);
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]')?.disabled);

  assert.equal(await page.locator('[data-search-load-more-targets]').count(), 1);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 600);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
});
