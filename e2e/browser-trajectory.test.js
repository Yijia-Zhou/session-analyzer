'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const {
  primaryFixtureSessionId,
  deferred,
  buildFixtureIndex,
  materializeIndexedSession,
  openApp,
  openWave1bM2App,
  openWave1cM1App,
  openWave1cM2App,
  beginWave1cM2Operation,
  wave1cM2OperationRows,
  switchHiddenLocale,
  selectPrimarySession,
  assertEventCount,
  expectInputValue,
  fillSearch,
  addSearchFilter,
  clearAllSearch,
  switchToProjectScope,
  searchNavigationSnapshot,
  makeCacheObservationBrowserFixture,
  makeTransitionProfileIndex,
} = require('./browser-helpers');

async function trajectoryStickySnapshot(page, eventId = '') {
  return page.locator('.timelinePane').evaluate((pane, selectedEventId) => {
    const overview = pane.querySelector('.trajectoryOverview');
    const presentation = pane.querySelector('.trajectoryPresentation');
    const selected = selectedEventId
      ? pane.querySelector(`[data-trajectory-event-id="${CSS.escape(selectedEventId)}"]`)
      : pane.querySelector('[data-trajectory-event-id].selected');
    const sessionHeader = pane.querySelector('.sessionHeader');
    const presentationControl = pane.querySelector('.mainPresentationControl');
    const paneBounds = pane.getBoundingClientRect();
    const overviewBounds = overview?.getBoundingClientRect();
    const presentationBounds = presentation?.getBoundingClientRect();
    const selectedBounds = selected?.getBoundingClientRect();
    const sessionHeaderBounds = sessionHeader?.getBoundingClientRect();
    const presentationControlBounds = presentationControl?.getBoundingClientRect();
    const mobileTabs = document.querySelector('.mobileViewTabs');
    const mobileTabsBounds = mobileTabs?.getBoundingClientRect();
    const mobileTabsVisible = mobileTabs && getComputedStyle(mobileTabs).display !== 'none';
    return {
      scrollTop: pane.scrollTop,
      windowScrollY: window.scrollY,
      maxScrollTop: pane.scrollHeight - pane.clientHeight,
      paneTop: paneBounds.top,
      paneBottom: paneBounds.bottom,
      stickyBoundaryTop: mobileTabsVisible ? mobileTabsBounds.bottom : paneBounds.top,
      stickyViewportBottom: mobileTabsVisible ? window.innerHeight : paneBounds.bottom,
      overviewTop: overviewBounds?.top ?? null,
      overviewBottom: overviewBounds?.bottom ?? null,
      presentationBottom: presentationBounds?.bottom ?? null,
      selectedTop: selectedBounds?.top ?? null,
      selectedBottom: selectedBounds?.bottom ?? null,
      sessionHeaderBottom: sessionHeaderBounds?.bottom ?? null,
      presentationControlBottom: presentationControlBounds?.bottom ?? null,
      position: overview ? getComputedStyle(overview).position : '',
      backgroundColor: overview ? getComputedStyle(overview).backgroundColor : '',
    };
  }, eventId);
}

function assertTrajectoryOverviewPinned(snapshot) {
  assert.equal(snapshot.position, 'sticky');
  assert.ok(
    Math.abs(snapshot.overviewTop - snapshot.stickyBoundaryTop) <= 1.5,
    JSON.stringify(snapshot),
  );
  assert.ok(snapshot.overviewBottom <= snapshot.stickyViewportBottom + 1, JSON.stringify(snapshot));
}

function assertTrajectoryTargetUnobscured(snapshot) {
  assert.ok(snapshot.selectedTop >= snapshot.overviewBottom - 1, JSON.stringify(snapshot));
  assert.ok(snapshot.selectedBottom <= snapshot.stickyViewportBottom + 1, JSON.stringify(snapshot));
}

test('browser Trajectory preserves lane and error colors through selection, hover, and keyboard focus', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<button id="before">Before card</button><button class="trajectoryEvent">Event</button>');
  await page.addStyleTag({ path: path.join(__dirname, '..', 'public', 'styles.css') });
  const card = page.locator('.trajectoryEvent');
  const appearance = () => card.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return { left: style.borderLeftColor, width: bounds.width, height: bounds.height };
  });
  for (const lane of ['input', 'model', 'tools', 'other']) {
    for (const failed of [false, true]) {
      const classes = `trajectoryEvent lane-${lane}${failed ? ' error' : ''}`;
      await card.evaluate((element, value) => { element.className = value; }, classes);
      await page.mouse.move(1000, 700);
      await page.locator('#before').focus();
      const baseline = await appearance();
      for (const selected of [false, true]) {
        await card.evaluate((element, value) => element.classList.toggle('selected', value), selected);
        await page.mouse.move(1000, 700);
        await page.locator('#before').focus();
        assert.deepEqual(await appearance(), baseline, `${classes}: selected=${selected}`);
        await card.hover();
        assert.deepEqual(await appearance(), baseline, `${classes}: selected=${selected}, hover`);
        await page.mouse.move(1000, 700);
        await page.locator('#before').focus();
        await page.keyboard.press('Tab');
        assert.equal(await card.evaluate((element) => element.matches(':focus-visible')), true);
        assert.deepEqual(await appearance(), baseline, `${classes}: selected=${selected}, keyboard focus`);
      }
    }
  }
});

test('browser Main presentation switches to a reversible Trajectory ledger and remembers it across Layers', async (t) => {
  const collapsedProfile = {
    id: 'custom:trajectory-ledger-browser',
    name: 'Trajectory ledger browser fixture',
    description: 'Keep every event compact so lazy tool groups are observable.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const index = await buildFixtureIndex();
  const { page, requestedUrls } = await openWave1cM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await selectPrimarySession(page);

  const control = page.locator('#mainPresentationControl');
  assert.equal(await control.isVisible(), true);
  assert.equal(
    await control.locator('[data-main-presentation="timeline"]').getAttribute('aria-pressed'),
    'true',
  );
  const timelineIds = await page.locator('#timeline .event[data-event-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.dataset.eventId),
  );
  const timelineRequestCount = requestedUrls.filter((url) => url.includes('/timeline?')).length;
  const lifecycleStart = await page.evaluate(() => window.__wave1cM1.evidence.lifecycle.length);

  await control.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('#timeline .trajectoryPresentation');
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);
  assert.equal(
    Number(await page.locator('.trajectoryPresentation').getAttribute('data-event-count')),
    timelineIds.length,
  );
  const ledgerIdentity = await page.evaluate(() => {
    const narrativeEventIds = [...document.querySelectorAll(
      '.trajectoryNarrativeRow [data-trajectory-event-id]',
    )].map((node) => node.dataset.trajectoryEventId);
    const groups = [...document.querySelectorAll('.trajectoryToolGroup')].map((group) => ({
      open: group.open,
      eventCount: Number(group.dataset.eventCount),
      materializedCount: group.querySelectorAll('[data-trajectory-event-id]').length,
    }));
    return {
      representedCount: narrativeEventIds.length
        + groups.reduce((sum, group) => sum + group.eventCount, 0),
      groups,
      hasDuration: Boolean(document.querySelector('[class*="Duration"], [data-duration]')),
      hasMissingTurnSection: document.querySelector('#timeline')?.textContent.includes('No reliable turn'),
    };
  });
  assert.equal(ledgerIdentity.representedCount, timelineIds.length);
  assert.ok(ledgerIdentity.groups.length > 0);
  assert.ok(ledgerIdentity.groups.some((group) => !group.open && group.materializedCount === 0));
  assert.equal(ledgerIdentity.hasDuration, false);
  assert.equal(ledgerIdentity.hasMissingTurnSection, false);
  assert.equal(requestedUrls.filter((url) => url.includes('/timeline?')).length, timelineRequestCount);

  const enteredLifecycle = await page.evaluate((start) => (
    window.__wave1cM1.evidence.lifecycle.slice(start)
  ), lifecycleStart);
  assert.ok(enteredLifecycle.some((row) => row.mode === 'non-main' && row.ownerCount === 0));

  const closedGroup = page.locator('.trajectoryToolGroup:not([open])').first();
  const closedGroupId = await closedGroup.getAttribute('data-trajectory-tool-group-id');
  assert.ok(closedGroupId);
  assert.equal(await closedGroup.locator('[data-trajectory-event-id]').count(), 0);
  await closedGroup.locator(':scope > summary').click();
  const openedGroup = page.locator(`[data-trajectory-tool-group-id="${closedGroupId}"]`);
  await openedGroup.locator('[data-members-materialized="true"], [data-trajectory-event-id]').first().waitFor();
  const toolEvent = openedGroup.locator('[data-trajectory-event-id]:not(.hiddenByProfile)').first();
  const toolEventId = await toolEvent.getAttribute('data-trajectory-event-id');
  assert.ok(toolEventId);
  await toolEvent.click();
  await page.waitForFunction((eventId) => (
    document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId === eventId
      && Boolean(document.querySelector('#detail .inspector'))
  ), toolEventId);

  await page.locator('[data-detail-action="raw"]').click();
  await page.waitForSelector('#detail .rawRefsView');
  assert.equal(await page.locator('[data-trajectory-event-id].selected').getAttribute('data-trajectory-event-id'), toolEventId);

  const presentationRequestCount = requestedUrls.filter((url) => url.includes('/timeline?')).length;
  await control.locator('[data-main-presentation="timeline"]').click();
  await page.waitForSelector(`#timeline .event[data-event-id="${toolEventId}"].selected`);
  assert.equal(
    await page.locator(`#timeline .event[data-event-id="${toolEventId}"]`).evaluate((node) => node.classList.contains('collapsed')),
    true,
  );
  await control.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector(`[data-trajectory-event-id="${toolEventId}"].selected`);
  assert.equal(requestedUrls.filter((url) => url.includes('/timeline?')).length, presentationRequestCount);

  await page.locator('#layerSelect').selectOption('protocol');
  await page.waitForFunction(() => (
    document.querySelector('#layerSelect')?.value === 'protocol'
      && document.querySelectorAll('#timeline .event[data-event-id]').length > 0
  ));
  assert.equal(await control.isVisible(), false);
  assert.equal(await page.locator('body').getAttribute('data-remembered-main-presentation'), 'trajectory');
  assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'timeline');

  await page.locator('#layerSelect').selectOption('main');
  await page.waitForSelector('#timeline .trajectoryPresentation');
  assert.equal(await control.isVisible(), true);
  assert.equal(
    await control.locator('[data-main-presentation="trajectory"]').getAttribute('aria-pressed'),
    'true',
  );
});

test('browser Trajectory localizes presentation, lanes, grouping, and Sequence Zoom controls', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openWave1cM1App(t, index, { locale: 'zh-CN' });
  await selectPrimarySession(page);
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');

  assert.deepEqual(
    await page.locator('#mainPresentationControl button').allTextContents(),
    ['时间线', '轨迹'],
  );
  assert.deepEqual(
    await page.locator('.trajectoryOverviewLabels span').allTextContents(),
    ['输入', '模型', '工具'],
  );
  assert.equal(await page.locator('.trajectoryOverviewTitle').textContent(), '序列');
  assert.match(await page.locator('.trajectoryOverviewStatus').textContent(), /^已加载序列/);
  assert.equal(await page.locator('.trajectoryZoomScale').textContent(), '全览');
  assert.equal(await page.locator('[data-trajectory-sequence-zoom="fit"]').textContent(), '全览');
  assert.equal(await page.locator('.trajectoryToolGroupLabel').first().textContent(), '工具活动');
  assert.equal((await page.locator('#timeline').textContent()).includes('No reliable turn'), false);

  await switchHiddenLocale(page, 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.waitForFunction(() => document.querySelector('.trajectoryOverviewTitle')?.textContent === 'Sequence');
  assert.deepEqual(
    await page.locator('.trajectoryOverviewLabels span').allTextContents(),
    ['Input', 'Model', 'Tools'],
  );
  assert.equal(await page.locator('.trajectoryZoomScale').textContent(), 'Fit all');
});

test('browser Trajectory keeps compact controls and Inspector selection usable in the mobile Events flow', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 300,
    hitPositions: [],
    commonTermEvery: 0,
  });
  const { page } = await openWave1cM1App(t, index, {
    locale: 'en',
    viewport: { width: 390, height: 760 },
  });
  await page.locator('.mobileViewTab[data-mobile-view="events"]').click();
  await page.waitForFunction(() => document.body.dataset.mobileView === 'events');
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');

  const mobileLayout = await page.locator('.trajectoryOverview').evaluate((overview) => {
    const controls = overview.querySelector('.trajectoryOverviewHeaderActions').getBoundingClientRect();
    const bounds = overview.getBoundingClientRect();
    return {
      overviewLeft: bounds.left,
      overviewRight: bounds.right,
      controlsLeft: controls.left,
      controlsRight: controls.right,
      viewportWidth: window.innerWidth,
    };
  });
  assert.ok(mobileLayout.overviewLeft >= 0 && mobileLayout.overviewRight <= mobileLayout.viewportWidth);
  assert.ok(mobileLayout.controlsLeft >= mobileLayout.overviewLeft);
  assert.ok(mobileLayout.controlsRight <= mobileLayout.overviewRight);

  await page.evaluate(() => {
    const pane = document.querySelector('.timelinePane');
    const rows = [...pane.querySelectorAll('[data-trajectory-event-id]')];
    const target = rows[Math.min(rows.length - 1, 40)];
    window.scrollTo({
      top: window.scrollY + target.getBoundingClientRect().top - (window.innerHeight / 2),
      behavior: 'auto',
    });
  });
  await page.waitForTimeout(100);
  const mobileSticky = await trajectoryStickySnapshot(page);
  t.diagnostic(JSON.stringify({ mobileSticky }));
  assertTrajectoryOverviewPinned(mobileSticky);
  assert.ok(mobileSticky.windowScrollY > 0);
  assert.ok(mobileSticky.sessionHeaderBottom < mobileSticky.stickyBoundaryTop);
  assert.ok(mobileSticky.presentationControlBottom < mobileSticky.stickyBoundaryTop);
  assert.equal(mobileSticky.backgroundColor, 'rgb(248, 250, 251)');
  assert.ok(mobileSticky.overviewBottom <= mobileSticky.presentationBottom + 1);

  const firstEvent = page.locator('[data-trajectory-event-id]:not(.hiddenByProfile)').first();
  const firstEventId = await firstEvent.getAttribute('data-trajectory-event-id');
  await firstEvent.click();
  await page.waitForFunction((eventId) => (
    document.body.dataset.mobileView === 'detail'
      && Boolean(document.querySelector('#detail .inspector'))
      && document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId
  ), firstEventId);
  await page.locator('.mobileViewTab[data-mobile-view="events"]').click();
  await page.waitForFunction((eventId) => (
    document.body.dataset.mobileView === 'events'
      && document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId === eventId
  ), firstEventId);
});

for (const moveFocus of [false, true]) {
  test(`browser Trajectory detail settlement ${moveFocus ? 'does not steal moved focus' : 'preserves overview keyboard focus'}`, { timeout: 15000 }, async (t) => {
    const { index } = await makeTransitionProfileIndex(t, {
      eventCount: 300, hitPositions: [], commonTermEvery: 0,
    });
    const { page } = await openApp(t, index, { locale: 'en' });
    await page.locator('[data-main-presentation="trajectory"]').click();
    await page.waitForSelector('.trajectoryOverviewCanvas[data-render-mode]');
    await page.waitForLoadState('networkidle');
    const sequenceIds = await page.locator('[data-trajectory-event-id]').evaluateAll(
      (events) => events.map((event) => event.dataset.trajectoryEventId),
    );
    const targetId = sequenceIds.at(-1);
    const detailReady = deferred();
    const releaseDetail = deferred();
    await page.route('**/events/*/detail?*', async (route) => {
      if (!new URL(route.request().url()).pathname.endsWith(`/${encodeURIComponent(targetId)}/detail`)) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      detailReady.resolve();
      await releaseDetail.promise;
      await route.fulfill({ response });
    });
    try {
      await page.locator('.trajectoryOverviewViewport').press('End');
      await detailReady.promise;
      const oldViewport = await page.locator('.trajectoryOverviewViewport').elementHandle();
      if (moveFocus) await page.locator('#searchInput').focus();
      else await page.locator('.trajectoryOverviewViewport').focus();
      releaseDetail.resolve();
      await page.waitForFunction((node) => !node.isConnected, oldViewport);
      assert.equal(await page.evaluate((moved) => (
        document.activeElement === document.querySelector(moved ? '#searchInput' : '.trajectoryOverviewViewport')
      ), moveFocus), true);
      if (!moveFocus) {
        // Real keyboard input must work without Locator.press silently refocusing the new node.
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction((expected) => (
          document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === expected
            && document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId === expected
        ), sequenceIds.at(-2));
      } else {
        assert.equal(await page.locator('.trajectoryOverviewLocator').getAttribute('data-trajectory-overview-selected-id'), targetId);
      }
      await oldViewport.dispose();
    } finally {
      releaseDetail.resolve();
      await page.waitForLoadState('networkidle');
    }
  });
}

test('browser Trajectory overview exposes only the loaded canonical sequence and shares selection identity', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 300,
    hitPositions: [],
    commonTermEvery: 0,
  });
  const { page } = await openWave1cM1App(t, index, { locale: 'en' });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryOverviewCanvas[data-render-mode]');

  assert.deepEqual(
    await page.locator('.trajectoryOverviewLabels span').allTextContents(),
    ['Input', 'Model', 'Tools'],
  );
  assert.equal(await page.locator('.trajectoryOverviewStatus').textContent(), 'Loaded prefix · 150/300');
  assert.equal(await page.locator('.trajectoryOverview [data-event-id]').count(), 0);
  const initialOverviewShape = await page.locator('.trajectoryOverview').evaluate((overview) => ({
    nodeCount: overview.querySelectorAll('*').length,
    canvasCount: overview.querySelectorAll('canvas').length,
    locatorCount: overview.querySelectorAll('.trajectoryOverviewLocator').length,
    eventCount: Number(overview.querySelector('canvas')?.dataset.eventCount),
    renderedItemCount: Number(overview.querySelector('canvas')?.dataset.renderedItemCount),
    plotWidth: Number(overview.querySelector('canvas')?.dataset.plotWidth),
  }));
  assert.deepEqual(
    { canvasCount: initialOverviewShape.canvasCount, locatorCount: initialOverviewShape.locatorCount },
    { canvasCount: 1, locatorCount: 1 },
  );
  assert.equal(initialOverviewShape.eventCount, 150);
  assert.ok(initialOverviewShape.nodeCount < 30);
  assert.ok(initialOverviewShape.renderedItemCount <= initialOverviewShape.plotWidth);

  const canvas = page.locator('.trajectoryOverviewCanvas');
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox);
  await canvas.click({ position: { x: canvasBox.width * 0.52, y: canvasBox.height * 0.5 } });
  await page.waitForFunction(() => (
    Boolean(document.querySelector('.trajectoryOverviewLocator[data-trajectory-overview-selected-id]:not([hidden])'))
      && Boolean(document.querySelector('[data-trajectory-event-id].selected'))
      && Boolean(document.querySelector('#detail .inspector'))
  ));
  const selectedId = await page.locator('.trajectoryOverviewLocator').getAttribute(
    'data-trajectory-overview-selected-id',
  );
  assert.ok(selectedId);
  assert.equal(
    await page.locator('[data-trajectory-event-id].selected').getAttribute('data-trajectory-event-id'),
    selectedId,
  );
  const locatorVisibility = await page.locator('.trajectoryOverviewLocator').evaluate((locator) => {
    const viewport = locator.closest('.trajectoryOverviewViewport').getBoundingClientRect();
    const bounds = locator.getBoundingClientRect();
    return bounds.left >= viewport.left && bounds.right <= viewport.right;
  });
  assert.equal(locatorVisibility, true);

  const sequenceIds = await page.locator('[data-trajectory-event-id]').evaluateAll(
    (events) => events.map((event) => event.dataset.trajectoryEventId),
  );
  assert.equal(sequenceIds.length, 150);
  const overviewViewport = page.locator('.trajectoryOverviewViewport');
  const pressSequenceKey = async (key, eventId) => {
    await overviewViewport.press(key);
    await page.waitForFunction((expectedId) => (
      document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === expectedId
        && document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId === expectedId
    ), eventId);
  };
  await pressSequenceKey('Home', sequenceIds[0]);
  await pressSequenceKey('End', sequenceIds.at(-1));
  await pressSequenceKey('ArrowLeft', sequenceIds.at(-2));
  await pressSequenceKey('ArrowRight', sequenceIds.at(-1));
  const keyboardSelectedId = sequenceIds.at(-1);
  assert.equal(
    await page.locator('[data-trajectory-event-id].selected').getAttribute('data-trajectory-event-id'),
    keyboardSelectedId,
  );

  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(() => (
    document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '300'
      && document.querySelector('.trajectoryOverviewStatus')?.textContent === 'Loaded sequence · 300'
      && document.querySelector('.trajectoryOverviewCanvas')?.dataset.eventCount === '300'
  ));
  const loadedOverviewShape = await page.locator('.trajectoryOverview').evaluate((overview) => ({
    nodeCount: overview.querySelectorAll('*').length,
    mode: overview.querySelector('canvas')?.dataset.renderMode,
    renderedItemCount: Number(overview.querySelector('canvas')?.dataset.renderedItemCount),
    plotWidth: Number(overview.querySelector('canvas')?.dataset.plotWidth),
  }));
  assert.equal(loadedOverviewShape.nodeCount, initialOverviewShape.nodeCount);
  assert.equal(loadedOverviewShape.mode, 'density');
  assert.ok(loadedOverviewShape.renderedItemCount <= loadedOverviewShape.plotWidth);
  assert.equal(
    await page.locator('.trajectoryOverviewLocator').getAttribute('data-trajectory-overview-selected-id'),
    keyboardSelectedId,
  );

  const firstInput = page.locator('[data-trajectory-event-id][data-lane="input"]:not(.hiddenByProfile)').first();
  const firstInputId = await firstInput.getAttribute('data-trajectory-event-id');
  assert.ok(firstInputId);
  await firstInput.click();
  const nextEvent = page.locator('[data-detail-action="navigate-event"][data-nav-direction="next"]');
  await nextEvent.waitFor();
  await page.waitForFunction(() => (
    !document.querySelector('[data-detail-action="navigate-event"][data-nav-direction="next"]')?.disabled
  ));
  await nextEvent.click();
  await page.waitForFunction((previousId) => (
    document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId !== previousId
      && document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId
        === document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId
  ), firstInputId);
});

test('browser Trajectory overview selects a full-height Other marker by canonical X', async (t) => {
  const index = await buildFixtureIndex();
  const materialized = await materializeIndexedSession(index, primaryFixtureSessionId);
  const mainEvents = materialized.logicalEvents.filter((event) => event.layer === 'main');
  const otherIndex = mainEvents.findIndex((event) => event.kind === 'error');
  assert.ok(otherIndex >= 0);
  const otherEvent = mainEvents[otherIndex];
  const { page } = await openWave1cM1App(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  await page.locator('[data-main-presentation="trajectory"]').click();
  const canvas = page.locator('.trajectoryOverviewCanvas[data-render-mode="markers"]');
  await canvas.waitFor();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);

  await canvas.click({
    position: {
      x: bounds.width * ((otherIndex + 0.5) / mainEvents.length),
      y: bounds.height / 6,
    },
  });
  await page.waitForFunction((eventId) => (
    document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId
      && document.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`)?.classList.contains('selected')
      && Boolean(document.querySelector('#detail .inspector'))
  ), otherEvent.id);
  assert.equal(
    await page.locator('[data-trajectory-event-id].selected').getAttribute('data-lane'),
    'other',
  );
});

test('browser Trajectory locator follows its lane and selected detail owns Primary content only in Trajectory', async (t) => {
  const index = await buildFixtureIndex();
  const session = await materializeIndexedSession(index, primaryFixtureSessionId);
  const mainEvents = session.logicalEvents.filter((event) => event.layer === 'main');
  const inputEvent = mainEvents.find((event) => event.kind === 'user_message');
  const modelEvent = mainEvents.find((event) => event.kind === 'assistant_message');
  const toolEvent = mainEvents.find((event) => (
    event.kind === 'command' && event.toolName === 'shell_command' && event.status === 'failed'
  ));
  assert.ok(inputEvent);
  assert.ok(modelEvent);
  assert.ok(toolEvent);

  const { page } = await openWave1cM1App(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  await page.locator('[data-main-presentation="trajectory"]').click();
  const canvas = page.locator('.trajectoryOverviewCanvas[data-render-mode="markers"]');
  await canvas.waitFor();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);

  const selectOverviewEvent = async (event, laneFraction) => {
    const sequenceIndex = mainEvents.findIndex((candidate) => candidate.id === event.id);
    assert.ok(sequenceIndex >= 0);
    await canvas.click({
      position: {
        x: bounds.width * ((sequenceIndex + 0.5) / mainEvents.length),
        y: bounds.height * laneFraction,
      },
    });
    await page.waitForFunction(({ eventId, title }) => (
      document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId
        && document.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`)?.classList.contains('selected')
        && document.querySelector('#detail .detailViewTitle h2')?.textContent.trim() === title
    ), { eventId: event.id, title: event.label });
  };
  const assertLocatorLane = async (lane, laneFraction) => {
    const position = await page.locator('.trajectoryOverviewLocator').evaluate((locator) => {
      const plotBounds = locator.parentElement.getBoundingClientRect();
      const locatorBounds = locator.getBoundingClientRect();
      const knobTop = Number.parseFloat(getComputedStyle(locator, '::before').top);
      return {
        lane: locator.dataset.lane,
        knobY: (locatorBounds.top - plotBounds.top) + knobTop,
        plotHeight: plotBounds.height,
      };
    });
    assert.equal(position.lane, lane);
    assert.ok(Math.abs(position.knobY - (position.plotHeight * laneFraction)) <= 0.75);
  };

  await selectOverviewEvent(toolEvent, 1 / 2);
  await assertLocatorLane('tools', 5 / 6);

  await selectOverviewEvent(inputEvent, 1 / 6);
  await assertLocatorLane('input', 1 / 6);
  await page.waitForSelector('#detail .inspectorDetailBody .mdBlock h1');
  assert.match(
    await page.locator('#detail .inspectorDetailBody').innerText(),
    /Fix the alpha parser regression.*parser.*inspect/s,
  );
  assert.equal(
    (await page.locator('#detail .detailViewHeader [data-detail-action="raw"]').textContent()).trim(),
    `Raw · ${inputEvent.rawRefs.length}`,
  );
  assert.equal(await page.locator('#detail .inspectorMetadataSection').count(), 1);
  assert.equal(await page.locator('#detail .inspectorSourcePath').count(), 1);

  await selectOverviewEvent(modelEvent, 1 / 2);
  await assertLocatorLane('model', 1 / 2);

  await selectOverviewEvent(toolEvent, 5 / 6);
  await assertLocatorLane('tools', 5 / 6);
  await page.waitForSelector('#detail .inspectorDetailBody .commandRun');
  const selectedToolState = await page.locator(
    `[data-trajectory-event-id="${toolEvent.id}"]`,
  ).evaluate((event) => ({
    selected: event.classList.contains('selected'),
    groupOpen: event.closest('.trajectoryToolGroup')?.open === true,
    membersMaterialized: event.closest('.trajectoryToolGroup')?.dataset.membersMaterialized === 'true',
  }));
  assert.deepEqual(selectedToolState, {
    selected: true,
    groupOpen: true,
    membersMaterialized: true,
  });
  const trajectoryDetailText = await page.locator('#detail .inspectorDetailBody').innerText();
  const commandIndex = trajectoryDetailText.indexOf('powershell.exe -Command npm test');
  const stdoutIndex = trajectoryDetailText.indexOf('alpha failed');
  const stderrIndex = trajectoryDetailText.indexOf('parser stack');
  const argumentsIndex = trajectoryDetailText.indexOf('ARGUMENTS');
  const contextIndex = trajectoryDetailText.indexOf('RUN CONTEXT');
  assert.ok(commandIndex >= 0);
  assert.ok(stdoutIndex > commandIndex);
  assert.ok(stderrIndex > stdoutIndex);
  assert.ok(argumentsIndex > stderrIndex);
  assert.ok(contextIndex > argumentsIndex);
  assert.equal(
    (await page.locator('#detail .detailViewHeader [data-detail-action="raw"]').textContent()).trim(),
    `Raw · ${toolEvent.rawRefs.length}`,
  );
  assert.equal(await page.locator('#detail .inspectorMetadataSection').count(), 1);
  assert.equal(await page.locator('#detail .inspectorSourcePath').count(), 1);

  await page.locator('[data-main-presentation="timeline"]').click();
  const timelineCard = page.locator(`#timeline .event[data-event-id="${toolEvent.id}"]`);
  await timelineCard.waitFor();
  await page.waitForFunction(() => (
    Boolean(document.querySelector('#detail .inspectorDetailBody .jsonBlock'))
      && Boolean(document.querySelector('#detail .inspectorDetailBody .kvWrap'))
      && !document.querySelector('#detail .inspectorDetailBody .commandRun')
  ));
  assert.doesNotMatch(await page.locator('#detail .inspectorDetailBody').innerText(), /alpha failed|parser stack/);
  if (!await timelineCard.evaluate((card) => card.classList.contains('expanded'))) {
    await timelineCard.locator('[data-action="toggle"]').first().click();
  }
  await timelineCard.locator('.eventBody .commandRun').waitFor();
  assert.match(await timelineCard.locator('.eventBody').innerText(), /npm test.*alpha failed.*parser stack/s);
  assert.equal(await page.locator('#detail .inspectorDetailBody .commandRun').count(), 0);
  assert.equal(
    (await page.locator('#detail .detailViewHeader [data-detail-action="raw"]').textContent()).trim(),
    `Raw · ${toolEvent.rawRefs.length}`,
  );
});

test('browser Trajectory sequence zoom keeps long overviews bounded and selection-aware without pan snapback', async (t) => {
  const eventCount = 1000;
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount,
    hitPositions: [],
    commonTermEvery: 0,
  });
  const { page, requestedUrls } = await openWave1cM1App(t, index, { locale: 'en' });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryOverviewCanvas[data-render-mode]');

  let expected = 150;
  while (expected < eventCount) {
    await page.locator('#loadMoreBtn').click();
    expected = Math.min(eventCount, expected + 150);
    await page.waitForFunction((count) => (
      document.querySelector('.trajectoryPresentation')?.dataset.eventCount === String(count)
    ), expected);
  }
  assert.equal(await page.locator('.trajectoryPresentation').getAttribute('data-event-count'), '1000');

  const overview = page.locator('.trajectoryOverview');
  const viewport = page.locator('.trajectoryOverviewViewport');
  const canvas = page.locator('.trajectoryOverviewCanvas');
  const initialShape = await overview.evaluate((node) => {
    const scroll = node.querySelector('.trajectoryOverviewViewport');
    const drawing = node.querySelector('.trajectoryOverviewCanvas');
    return {
      nodeCount: node.querySelectorAll('*').length,
      zoom: Number(node.dataset.sequenceZoom),
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      mode: drawing.dataset.renderMode,
      renderedItemCount: Number(drawing.dataset.renderedItemCount),
      plotWidth: Number(drawing.dataset.plotWidth),
    };
  });
  assert.equal(initialShape.zoom, 1);
  assert.equal(initialShape.mode, 'density');
  assert.ok(initialShape.nodeCount < 40);
  assert.ok(initialShape.scrollWidth <= initialShape.clientWidth + 1);
  assert.ok(initialShape.renderedItemCount <= initialShape.plotWidth);

  const densityHitTargets = await overview.evaluate((node) => {
    const drawing = node.querySelector('.trajectoryOverviewCanvas');
    const eventCount = Number(drawing.dataset.eventCount);
    const plotWidth = Number(drawing.dataset.plotWidth);
    const binCount = Math.max(1, Math.min(eventCount, Math.floor(plotWidth)));
    const events = [...document.querySelectorAll('[data-trajectory-event-id][data-sequence-index]')]
      .map((event) => ({
        eventId: event.dataset.trajectoryEventId,
        index: Number(event.dataset.sequenceIndex),
        lane: event.dataset.lane,
      }));
    const binIndex = (sequenceIndex) => Math.min(
      binCount - 1,
      Math.floor(((sequenceIndex + 0.5) / eventCount) * binCount),
    );
    const input = events.find((event) => {
      if (event.lane !== 'input') return false;
      const localBin = binIndex(event.index);
      return events.some((candidate) => (
        candidate.lane === 'model' && binIndex(candidate.index) === localBin
      ));
    });
    const localModel = events
      .filter((event) => event.lane === 'model' && binIndex(event.index) === binIndex(input.index))
      .sort((left, right) => (
        Math.abs(left.index - input.index) - Math.abs(right.index - input.index)
        || left.index - right.index
      ))[0];
    return {
      fraction: (input.index + 0.5) / eventCount,
      xNearestId: input.eventId,
      localModelId: localModel.eventId,
    };
  });
  assert.ok(densityHitTargets.xNearestId);
  assert.ok(densityHitTargets.localModelId);
  const clickDensityLane = async (laneFraction, eventId) => {
    const bounds = await canvas.boundingBox();
    assert.ok(bounds);
    await canvas.click({
      position: {
        x: bounds.width * densityHitTargets.fraction,
        y: bounds.height * laneFraction,
      },
    });
    await page.waitForFunction((expectedId) => (
      document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === expectedId
        && document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId === expectedId
    ), eventId);
  };
  await clickDensityLane(1 / 2, densityHitTargets.localModelId);
  await clickDensityLane(5 / 6, densityHitTargets.xNearestId);

  const anchorRow = page.locator('[data-trajectory-event-id]').nth(799);
  const anchorId = await anchorRow.getAttribute('data-trajectory-event-id');
  assert.ok(anchorId);
  await anchorRow.click();
  await page.waitForFunction((eventId) => (
    document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId
  ), anchorId);

  await page.locator('[data-trajectory-sequence-zoom="in"]').click();
  await page.waitForFunction(() => (
    document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '2'
      && document.querySelector('.trajectoryOverviewViewport')?.scrollLeft > 0
  ));
  const firstZoomAnchor = await page.locator('.trajectoryOverviewLocator').evaluate((locator) => {
    const viewportNode = locator.closest('.trajectoryOverviewViewport');
    const viewportBounds = viewportNode.getBoundingClientRect();
    const locatorBounds = locator.getBoundingClientRect();
    return {
      visible: locatorBounds.left >= viewportBounds.left && locatorBounds.right <= viewportBounds.right,
      relative: (locatorBounds.left - viewportBounds.left) / viewportBounds.width,
    };
  });
  assert.equal(firstZoomAnchor.visible, true);
  assert.ok(firstZoomAnchor.relative >= 0.35 && firstZoomAnchor.relative <= 0.7);

  await page.locator('[data-trajectory-sequence-zoom="in"]').click();
  await page.waitForFunction(() => document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '4');
  await page.locator('[data-trajectory-sequence-zoom="in"]').click();
  await page.waitForFunction(() => (
    document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '8'
      && document.querySelector('.trajectoryOverviewCanvas')?.dataset.renderMode === 'markers'
  ));
  const zoomedShape = await overview.evaluate((node) => {
    const scroll = node.querySelector('.trajectoryOverviewViewport');
    const drawing = node.querySelector('.trajectoryOverviewCanvas');
    return {
      nodeCount: node.querySelectorAll('*').length,
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      eventCount: Number(drawing.dataset.eventCount),
      renderedItemCount: Number(drawing.dataset.renderedItemCount),
      plotWidth: Number(drawing.dataset.plotWidth),
    };
  });
  assert.equal(zoomedShape.nodeCount, initialShape.nodeCount);
  assert.equal(zoomedShape.eventCount, eventCount);
  assert.equal(zoomedShape.renderedItemCount, eventCount);
  t.diagnostic(JSON.stringify({ initialShape, zoomedShape }));
  assert.ok(zoomedShape.scrollWidth <= (zoomedShape.clientWidth * 8) + 8);
  assert.ok(zoomedShape.scrollWidth >= (zoomedShape.clientWidth * 8) - 8);

  const readInputMarkerGlyph = (sequenceIndex) => canvas.evaluate((drawing, args) => {
    const plotWidth = Number(drawing.dataset.plotWidth);
    const plotHeight = drawing.getBoundingClientRect().height;
    const pixelScaleX = drawing.width / plotWidth;
    const pixelScaleY = drawing.height / plotHeight;
    const centerX = ((args.sequenceIndex + 0.5) / args.eventCount) * plotWidth;
    const centerY = plotHeight / 6;
    const sampleLeft = Math.max(0, Math.floor((centerX - 4) * pixelScaleX));
    const sampleTop = Math.max(0, Math.floor((centerY - 6) * pixelScaleY));
    const sampleRight = Math.min(drawing.width, Math.ceil((centerX + 4) * pixelScaleX));
    const sampleBottom = Math.min(drawing.height, Math.ceil((centerY + 6) * pixelScaleY));
    const sampleWidth = sampleRight - sampleLeft;
    const sampleHeight = sampleBottom - sampleTop;
    const pixels = drawing.getContext('2d').getImageData(
      sampleLeft,
      sampleTop,
      sampleWidth,
      sampleHeight,
    ).data;
    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const offset = ((y * sampleWidth) + x) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const alpha = pixels[offset + 3];
        if (alpha === 0 || red >= 120 || green < 90 || green > 170 || blue >= 160) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return {
      width: maxX < minX ? 0 : (maxX - minX + 1) / pixelScaleX,
      height: maxY < minY ? 0 : (maxY - minY + 1) / pixelScaleY,
    };
  }, { sequenceIndex, eventCount });
  const markerGlyphAt8x = await readInputMarkerGlyph(400);
  assert.ok(markerGlyphAt8x.width >= 2.5 && markerGlyphAt8x.width <= 3.5);
  assert.ok(markerGlyphAt8x.height >= 7.5 && markerGlyphAt8x.height <= 8.5);

  await page.locator('[data-trajectory-sequence-zoom="in"]').click();
  await page.waitForFunction(() => (
    document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '16'
      && document.querySelector('.trajectoryOverviewCanvas')?.dataset.renderMode === 'markers'
  ));
  const markerGlyphAt16x = await readInputMarkerGlyph(400);
  assert.ok(Math.abs(markerGlyphAt16x.width - markerGlyphAt8x.width) <= 0.1);
  assert.ok(Math.abs(markerGlyphAt16x.height - markerGlyphAt8x.height) <= 0.1);
  t.diagnostic(JSON.stringify({ markerGlyphAt8x, markerGlyphAt16x }));
  await page.locator('[data-trajectory-sequence-zoom="out"]').click();
  await page.waitForFunction(() => document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '8');
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const timelinePane = page.locator('.timelinePane');
  const horizontalBeforeNarrativeScroll = await overview.evaluate((node) => ({
    zoom: node.dataset.sequenceZoom,
    scrollLeft: node.querySelector('.trajectoryOverviewViewport').scrollLeft,
  }));
  await timelinePane.evaluate((pane) => {
    const rows = [...pane.querySelectorAll('[data-trajectory-event-id]')];
    const target = rows[Math.min(rows.length - 1, 80)];
    const paneBounds = pane.getBoundingClientRect();
    pane.scrollTop += target.getBoundingClientRect().top - paneBounds.top - (pane.clientHeight / 2);
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector('.timelinePane');
    const overviewNode = pane?.querySelector('.trajectoryOverview');
    if (!pane || !overviewNode || pane.scrollTop <= 0) return false;
    return Math.abs(overviewNode.getBoundingClientRect().top - pane.getBoundingClientRect().top) <= 1.5;
  });
  const afterNarrativeScroll = await overview.evaluate((node) => ({
    zoom: node.dataset.sequenceZoom,
    scrollLeft: node.querySelector('.trajectoryOverviewViewport').scrollLeft,
  }));
  assert.deepEqual(afterNarrativeScroll, horizontalBeforeNarrativeScroll);
  const beforeOverviewClick = await trajectoryStickySnapshot(page);
  assert.ok(beforeOverviewClick.scrollTop > 0);
  assertTrajectoryOverviewPinned(beforeOverviewClick);
  assert.ok(beforeOverviewClick.sessionHeaderBottom < beforeOverviewClick.paneTop);
  assert.ok(beforeOverviewClick.presentationControlBottom < beforeOverviewClick.paneTop);

  const zoomedClickTarget = await viewport.evaluate((node, count) => {
    const viewportBounds = node.getBoundingClientRect();
    const drawing = node.querySelector('.trajectoryOverviewCanvas');
    const canvasBounds = drawing.getBoundingClientRect();
    const visibleTargetX = viewportBounds.left + (viewportBounds.width * 0.35);
    let sequenceIndex = Math.round(
      ((((visibleTargetX - canvasBounds.left) / canvasBounds.width) * count) - 0.5),
    );
    sequenceIndex = Math.max(0, Math.min(count - 1, sequenceIndex));
    if (sequenceIndex % 2 !== 0) sequenceIndex += sequenceIndex < count - 1 ? 1 : -1;
    const narrative = document.querySelector(
      `[data-trajectory-event-id][data-sequence-index="${sequenceIndex}"]`,
    );
    return {
      eventId: narrative?.dataset.trajectoryEventId || '',
      sequenceIndex,
      x: canvasBounds.left + (((sequenceIndex + 0.5) / count) * canvasBounds.width),
      y: canvasBounds.top + (canvasBounds.height / 6),
      expectedTitle: narrative?.querySelector('.trajectoryEventType')?.textContent.trim() || '',
    };
  }, eventCount);
  assert.ok(zoomedClickTarget.eventId);
  assert.ok(zoomedClickTarget.expectedTitle);
  assert.notEqual(zoomedClickTarget.eventId, anchorId);
  const zoomedDetailResponse = page.waitForResponse((response) => (
    decodeURIComponent(new URL(response.url()).pathname)
      .endsWith(`/events/${zoomedClickTarget.eventId}/detail`)
      && response.ok()
  ));
  await page.mouse.click(zoomedClickTarget.x, zoomedClickTarget.y);
  await zoomedDetailResponse;
  await page.waitForFunction(({ eventId, expectedTitle }) => (
    document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId
      && document.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`)?.classList.contains('selected')
      && document.querySelector('#detail .inspector')
      && document.querySelector('#detail .detailViewTitle h2')?.textContent.trim() === expectedTitle
  ), zoomedClickTarget);
  await page.waitForTimeout(300);
  const afterOverviewClick = await trajectoryStickySnapshot(page, zoomedClickTarget.eventId);
  t.diagnostic(JSON.stringify({ beforeOverviewClick, afterOverviewClick }));
  assert.ok(Math.abs(afterOverviewClick.scrollTop - beforeOverviewClick.scrollTop) <= 1);
  assertTrajectoryOverviewPinned(afterOverviewClick);

  await page.locator('[data-trajectory-sequence-zoom="in"]').click();
  await page.waitForFunction(() => document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '16');
  const stickyZoomed = await trajectoryStickySnapshot(page, zoomedClickTarget.eventId);
  assertTrajectoryOverviewPinned(stickyZoomed);
  assert.ok(Math.abs(stickyZoomed.scrollTop - afterOverviewClick.scrollTop) <= 1);
  await page.locator('[data-trajectory-sequence-zoom="out"]').click();
  await page.waitForFunction(() => document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '8');
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  await viewport.evaluate((node) => { node.scrollLeft = 0; });
  await viewport.hover();
  await page.mouse.wheel(0, 420);
  await page.waitForFunction(() => document.querySelector('.trajectoryOverviewViewport')?.scrollLeft > 300);
  const freelyPanned = await viewport.evaluate((node) => node.scrollLeft);
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await viewport.evaluate((node) => node.scrollLeft)) - freelyPanned) <= 1);
  assert.equal(
    await page.locator('.trajectoryOverviewLocator').getAttribute('data-trajectory-overview-selected-id'),
    zoomedClickTarget.eventId,
  );

  await page.waitForTimeout(100);
  const timelineRequestUrls = requestedUrls.filter((url) => url.includes('/timeline?'));
  await page.locator('[data-main-presentation="timeline"]').evaluate((button) => button.click());
  await page.waitForSelector('#timeline .event[data-event-id]');
  await page.locator('[data-main-presentation="trajectory"]').evaluate((button) => button.click());
  await page.waitForFunction((expectedScroll) => {
    const node = document.querySelector('.trajectoryOverviewViewport');
    return document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '8'
      && Math.abs(node.scrollLeft - expectedScroll) <= 2;
  }, freelyPanned);
  const continuityGeometry = await trajectoryStickySnapshot(page, zoomedClickTarget.eventId);
  assertTrajectoryOverviewPinned(continuityGeometry);
  assertTrajectoryTargetUnobscured(continuityGeometry);
  const switchedTimelineRequestUrls = requestedUrls.filter((url) => url.includes('/timeline?'));
  t.diagnostic(JSON.stringify({
    presentationSwitchRequests: switchedTimelineRequestUrls.slice(timelineRequestUrls.length),
  }));
  assert.equal(switchedTimelineRequestUrls.length, timelineRequestUrls.length);

  await viewport.scrollIntoViewIfNeeded();
  const viewportBox = await viewport.boundingBox();
  assert.ok(viewportBox);
  await page.mouse.move(viewportBox.x + (viewportBox.width * 0.7), viewportBox.y + (viewportBox.height * 0.5));
  await page.mouse.down();
  await page.mouse.move(
    viewportBox.x + (viewportBox.width * 0.45),
    viewportBox.y + (viewportBox.height * 0.5),
    { steps: 5 },
  );
  await page.mouse.up();
  const draggedScroll = await viewport.evaluate((node) => node.scrollLeft);
  t.diagnostic(JSON.stringify({ freelyPanned, draggedScroll }));
  assert.ok(draggedScroll > freelyPanned + 50);
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await viewport.evaluate((node) => node.scrollLeft)) - draggedScroll) <= 1);
  assert.equal(
    await page.locator('.trajectoryOverviewLocator').getAttribute('data-trajectory-overview-selected-id'),
    zoomedClickTarget.eventId,
  );
  assert.equal(
    await page.locator('[data-trajectory-event-id].selected').getAttribute('data-trajectory-event-id'),
    zoomedClickTarget.eventId,
  );
  assert.equal(
    (await page.locator('#detail .detailViewTitle h2').textContent()).trim(),
    zoomedClickTarget.expectedTitle,
  );

  const firstRow = page.locator('[data-trajectory-event-id]').first();
  const firstId = await firstRow.getAttribute('data-trajectory-event-id');
  await firstRow.click();
  await page.waitForFunction((eventId) => {
    const locator = document.querySelector('.trajectoryOverviewLocator');
    const viewportNode = document.querySelector('.trajectoryOverviewViewport');
    if (locator?.dataset.trajectoryOverviewSelectedId !== eventId || !viewportNode) return false;
    const viewportBounds = viewportNode.getBoundingClientRect();
    const locatorBounds = locator.getBoundingClientRect();
    return locatorBounds.left >= viewportBounds.left && locatorBounds.right <= viewportBounds.right;
  }, firstId);
  assert.ok((await viewport.evaluate((node) => node.scrollLeft)) < initialShape.clientWidth);

  await page.locator('[data-trajectory-sequence-zoom="fit"]').click();
  await page.waitForFunction(() => {
    const overviewNode = document.querySelector('.trajectoryOverview');
    const viewportNode = document.querySelector('.trajectoryOverviewViewport');
    return overviewNode?.dataset.sequenceZoom === '1'
      && viewportNode?.scrollLeft === 0
      && document.querySelector('.trajectoryOverviewCanvas')?.dataset.renderMode === 'density';
  });
  await timelinePane.evaluate((pane) => { pane.scrollTop = pane.scrollHeight; });
  await page.waitForFunction(() => {
    const pane = document.querySelector('.timelinePane');
    return pane && Math.abs(pane.scrollTop - (pane.scrollHeight - pane.clientHeight)) <= 1;
  });
  const tailContainment = await trajectoryStickySnapshot(page);
  assert.ok(tailContainment.maxScrollTop > 0);
  assert.ok(tailContainment.overviewBottom <= tailContainment.presentationBottom + 1, JSON.stringify(tailContainment));
  t.diagnostic(JSON.stringify({ continuityGeometry, tailContainment }));
});

test('browser Trajectory characterizes the existing 1800-event performance shape without overview DOM growth', async (t) => {
  const eventCount = 1800;
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount,
    hitPositions: [],
    commonTermEvery: 0,
  });
  const { page, requestedUrls } = await openWave1cM1App(t, index, { locale: 'en' });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryOverviewCanvas[data-render-mode]');
  const initialOverviewNodeCount = await page.locator('.trajectoryOverview').evaluate(
    (node) => node.querySelectorAll('*').length,
  );

  const loadMoreStartedAt = Date.now();
  let expected = 150;
  while (expected < eventCount) {
    await page.locator('#loadMoreBtn').click();
    expected = Math.min(eventCount, expected + 150);
    await page.waitForFunction((count) => (
      document.querySelector('.trajectoryPresentation')?.dataset.eventCount === String(count)
    ), expected);
  }
  const loadMoreElapsedMs = Date.now() - loadMoreStartedAt;
  const fitShape = await page.locator('.trajectoryPresentation').evaluate((presentation) => {
    const overview = presentation.querySelector('.trajectoryOverview');
    const drawing = presentation.querySelector('.trajectoryOverviewCanvas');
    return {
      eventCount: Number(presentation.dataset.eventCount),
      overviewNodeCount: overview.querySelectorAll('*').length,
      narrativeRowCount: presentation.querySelectorAll('.trajectoryNarrativeRow').length,
      toolGroupCount: presentation.querySelectorAll('.trajectoryToolGroup').length,
      fitMode: drawing.dataset.renderMode,
      fitRenderedItemCount: Number(drawing.dataset.renderedItemCount),
      fitPlotWidth: Number(drawing.dataset.plotWidth),
    };
  });
  assert.equal(fitShape.eventCount, eventCount);
  assert.equal(fitShape.overviewNodeCount, initialOverviewNodeCount);
  assert.equal(fitShape.narrativeRowCount, eventCount);
  assert.equal(fitShape.toolGroupCount, 0);
  assert.equal(fitShape.fitMode, 'density');
  assert.ok(fitShape.fitRenderedItemCount <= fitShape.fitPlotWidth);

  const timelineRequestCount = requestedUrls.filter((url) => url.includes('/timeline?')).length;
  const timelineStartedAt = Date.now();
  await page.locator('[data-main-presentation="timeline"]').click();
  await page.waitForFunction((count) => (
    document.querySelectorAll('#timeline .event[data-event-id]').length === count
  ), eventCount);
  const timelineReturnMs = Date.now() - timelineStartedAt;
  const trajectoryStartedAt = Date.now();
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction((count) => (
    document.querySelector('.trajectoryPresentation')?.dataset.eventCount === String(count)
  ), eventCount);
  const trajectoryReturnMs = Date.now() - trajectoryStartedAt;
  assert.equal(requestedUrls.filter((url) => url.includes('/timeline?')).length, timelineRequestCount);

  const zoomStartedAt = Date.now();
  for (const zoom of ['2', '4', '8', '16']) {
    await page.locator('[data-trajectory-sequence-zoom="in"]').click();
    await page.waitForFunction((value) => (
      document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === value
    ), zoom);
  }
  await page.waitForFunction(() => (
    document.querySelector('.trajectoryOverviewCanvas')?.dataset.renderMode === 'markers'
  ));
  const zoomElapsedMs = Date.now() - zoomStartedAt;
  const zoomedShape = await page.locator('.trajectoryOverview').evaluate((overview) => {
    const viewport = overview.querySelector('.trajectoryOverviewViewport');
    const drawing = overview.querySelector('.trajectoryOverviewCanvas');
    return {
      overviewNodeCount: overview.querySelectorAll('*').length,
      zoom: Number(overview.dataset.sequenceZoom),
      viewportWidth: viewport.clientWidth,
      canvasWidth: Number(drawing.dataset.plotWidth),
      mode: drawing.dataset.renderMode,
      renderedItemCount: Number(drawing.dataset.renderedItemCount),
    };
  });
  assert.equal(zoomedShape.overviewNodeCount, initialOverviewNodeCount);
  assert.equal(zoomedShape.zoom, 16);
  assert.equal(zoomedShape.mode, 'markers');
  assert.equal(zoomedShape.renderedItemCount, eventCount);
  assert.ok(zoomedShape.canvasWidth <= (zoomedShape.viewportWidth * 16) + 16);
  t.diagnostic(JSON.stringify({
    shape: fitShape,
    loadMoreElapsedMs,
    timelineReturnMs,
    trajectoryReturnMs,
    zoomElapsedMs,
    zoomedShape,
  }));
});

test('browser project-search drill-down restores Trajectory and anchors the exact loaded-prefix event', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 300,
    hitPositions: [250],
    commonTermEvery: 30,
  });
  const { page } = await openWave1cM1App(t, index, { locale: 'en' });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');

  await switchToProjectScope(page);
  assert.equal(await page.locator('#mainPresentationControl').isVisible(), false);
  assert.equal(await page.locator('body').getAttribute('data-remembered-main-presentation'), 'trajectory');
  await fillSearch(page, 'far-needle');
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .projectResultCard').length === 1);
  await page.locator('#sessionList .projectResultCard').click();
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'session'
      && Boolean(document.querySelector('.trajectoryPresentation'))
      && Boolean(document.querySelector('.trajectoryOverviewLocator[data-trajectory-overview-selected-id]'))
  ));

  const targetId = await page.locator('.trajectoryOverviewLocator').getAttribute(
    'data-trajectory-overview-selected-id',
  );
  assert.ok(targetId);
  assert.equal(
    await page.locator('[data-trajectory-event-id].selected').getAttribute('data-trajectory-event-id'),
    targetId,
  );
  await page.waitForFunction((eventId) => {
    const pane = document.querySelector('.timelinePane');
    const overview = pane?.querySelector('.trajectoryOverview');
    const selected = pane?.querySelector(
      `[data-trajectory-event-id="${CSS.escape(eventId)}"]`,
    );
    if (!pane || !overview || !selected) return false;
    const paneBounds = pane.getBoundingClientRect();
    const overviewBounds = overview.getBoundingClientRect();
    const selectedBounds = selected.getBoundingClientRect();
    return Math.abs(overviewBounds.top - paneBounds.top) <= 1.5
      && selectedBounds.top >= overviewBounds.bottom - 1
      && selectedBounds.bottom <= paneBounds.bottom + 1;
  }, targetId);
  const drillDownGeometry = await trajectoryStickySnapshot(page, targetId);
  assertTrajectoryOverviewPinned(drillDownGeometry);
  assertTrajectoryTargetUnobscured(drillDownGeometry);
  const loadedState = await page.locator('.trajectoryPresentation').evaluate((presentation) => ({
    loaded: Number(presentation.dataset.eventCount),
    status: presentation.querySelector('.trajectoryOverviewStatus')?.textContent || '',
  }));
  assert.ok(loadedState.loaded >= 251 && loadedState.loaded <= 300);
  assert.equal(
    loadedState.status,
    loadedState.loaded < 300
      ? `Loaded prefix · ${loadedState.loaded}/300`
      : 'Loaded sequence · 300',
  );
  assert.equal(
    await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator('#timeline [data-search-back-to-project]').count(), 0);
  assert.equal(await page.locator('#sessionHeader [data-search-back-to-project]').count(), 1);
});

test('browser Trajectory search reveals a collapsed Tool Activity Group and structured filters reuse folding semantics', async (t) => {
  const index = await buildFixtureIndex();
  const session = await materializeIndexedSession(index, primaryFixtureSessionId);
  const commandEvents = session.logicalEvents.filter((event) => event.kind === 'command');
  const failedCommand = commandEvents.find((event) => (
    event.kind === 'command' && event.status === 'failed'
  ));
  assert.ok(failedCommand);
  const hiddenCommandProfile = {
    id: 'custom:trajectory-hidden-command',
    name: 'Trajectory hidden command search test',
    description: 'Hide commands so canonical search navigation must reveal a lazy tool member.',
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
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');

  const initialGroupState = await page.evaluate((eventId) => {
    const group = [...document.querySelectorAll('.trajectoryToolGroup')]
      .find((candidate) => candidate.__trajectoryEventIds?.has(eventId));
    return group && {
      open: group.open,
      hidden: group.classList.contains('hiddenByProfile'),
      memberCount: group.querySelectorAll('[data-trajectory-event-id]').length,
    };
  }, failedCommand.id);
  assert.deepEqual(initialGroupState, { open: false, hidden: false, memberCount: 0 });

  await page.evaluate(() => window.__wave1cM1.reset());
  await fillSearch(page, 'alpha failed');
  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 1 targets')
      && document.querySelector('#searchMetricsPanel')?.textContent.includes('1 occurrences')
  ));
  const searchTargetsBeforeDetail = await searchNavigationSnapshot(page);
  assert.equal(searchTargetsBeforeDetail.total, 1);
  assert.equal(
    await page.locator(`[data-trajectory-event-id="${failedCommand.id}"]`).count(),
    0,
    'search discovery keeps a hidden lazy member unmaterialized until canonical navigation requests it',
  );

  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await page.waitForTimeout(500);
  const searchReveal = await page.evaluate((eventId) => {
    const member = document.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`);
    const group = [...document.querySelectorAll('.trajectoryToolGroup')]
      .find((candidate) => candidate.__trajectoryEventIds?.has(eventId));
    return {
      hasMember: Boolean(member),
      groupOpen: Boolean(group?.open),
      memberClasses: member?.className || '',
      memberMarkCount: member?.querySelectorAll('mark.searchMark').length || 0,
      memberActiveMarkCount: member?.querySelectorAll('mark.searchMark.activeSearchMark').length || 0,
      selectedId: document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId || '',
      locatorId: document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId || '',
      inspector: Boolean(document.querySelector('#detail .inspector')),
    };
  }, failedCommand.id);
  t.diagnostic(JSON.stringify({ searchReveal, failedCommandId: failedCommand.id }));
  assert.equal(searchReveal.hasMember, true);
  assert.equal(searchReveal.groupOpen, true);
  assert.match(searchReveal.memberClasses, /(?:^|\s)state-expanded(?:\s|$)/);
  assert.match(searchReveal.memberClasses, /(?:^|\s)selected(?:\s|$)/);
  assert.ok(searchReveal.memberActiveMarkCount > 0);
  assert.equal(searchReveal.selectedId, failedCommand.id);
  assert.equal(searchReveal.locatorId, failedCommand.id);
  assert.equal(searchReveal.inspector, true);
  assert.equal(await page.evaluate(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'searchTransientRevision',
  )), true);
  assert.equal(await page.locator('#detail .inspector').count(), 1);
  await page.waitForSelector('#detail .commandRun mark.searchMark');
  const searchTargetsAfterDetail = await searchNavigationSnapshot(page);
  assert.equal(searchTargetsAfterDetail.total, searchTargetsBeforeDetail.total);
  assert.deepEqual(searchTargetsAfterDetail.ids, searchTargetsBeforeDetail.ids);

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await page.waitForFunction((eventId) => {
    const group = [...document.querySelectorAll('.trajectoryToolGroup')]
      .find((candidate) => candidate.__trajectoryEventIds?.has(eventId));
    const member = group?.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`);
    return group && !group.querySelector('mark.searchMark')
      && ((!group.open && !member) || (group.open && member?.classList.contains('hiddenByProfile')));
  }, failedCommand.id);

  await addSearchFilter(page, 'kind', 'command');
  await page.waitForTimeout(500);
  const structuredFilterState = await page.evaluate((eventId) => {
    const presentation = document.querySelector('.trajectoryPresentation');
    const group = [...document.querySelectorAll('.trajectoryToolGroup')]
      .find((candidate) => candidate.__trajectoryEventIds?.has(eventId));
    return {
      eventCount: presentation?.dataset.eventCount || '',
      groupCount: document.querySelectorAll('.trajectoryToolGroup').length,
      groupEventCount: group?.dataset.eventCount || '',
      groupClasses: group?.className || '',
      containsEvent: Boolean(group?.__trajectoryEventIds?.has(eventId)),
      selectedId: document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId || '',
    };
  }, failedCommand.id);
  t.diagnostic(JSON.stringify({ structuredFilterState }));
  assert.equal(structuredFilterState.eventCount, String(commandEvents.length));
  assert.ok(structuredFilterState.groupCount > 0);
  assert.ok(Number(structuredFilterState.groupEventCount) > 0);
  assert.match(structuredFilterState.groupClasses, /(?:^|\s)state-collapsed(?:\s|$)/);
  assert.doesNotMatch(structuredFilterState.groupClasses, /(?:^|\s)hiddenByProfile(?:\s|$)/);
  assert.equal(structuredFilterState.containsEvent, true);
  assert.equal(
    await page.locator('.trajectoryOverviewCanvas').getAttribute('data-event-count'),
    String(commandEvents.length),
  );
  await page.evaluate((eventId) => {
    const group = [...document.querySelectorAll('.trajectoryToolGroup')]
      .find((candidate) => candidate.__trajectoryEventIds?.has(eventId));
    group.querySelector(':scope > summary').click();
  }, failedCommand.id);
  await page.waitForSelector(`[data-trajectory-event-id="${failedCommand.id}"]`);
  assert.equal(
    await page.locator(`[data-trajectory-event-id="${failedCommand.id}"]`).getAttribute('data-display-state'),
    'collapsed',
  );

  await clearAllSearch(page);
  await page.waitForFunction(() => document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '29');
  const savedOverrides = await page.evaluate(() => JSON.parse(
    localStorage.getItem('sessionAnalyzer.overrides') || '{}',
  ));
  assert.equal(savedOverrides[primaryFixtureSessionId]?.[failedCommand.id], undefined);
  await page.locator('[data-main-presentation="timeline"]').click();
  await page.locator(
    `#timeline .event[data-event-id="${failedCommand.id}"].hiddenByProfile`,
  ).waitFor({ state: 'attached' });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.evaluate(() => {
    const select = document.querySelector('#profileSelect');
    select.value = 'narrative';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction((eventId) => {
    const member = document.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`);
    return member?.classList.contains('state-expanded')
      && member.closest('.trajectoryToolGroup')?.open;
  }, failedCommand.id);
  assert.equal(await page.locator('#profileSelect').inputValue(), 'narrative');
});

test('browser Timeline remains keyed after a Trajectory round trip and the next Main Load more append', async (t) => {
  const collapsedProfile = {
    id: 'custom:trajectory-keyed-round-trip',
    name: 'Trajectory keyed round-trip fixture',
    description: 'Keep the Main prefix stable while proving the accepted Wave 1C append path.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 320 });
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await assertEventCount(page, 150);
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '150');
  await page.locator('[data-main-presentation="timeline"]').click();
  await assertEventCount(page, 150);

  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    window.__trajectoryKeyedRoundTrip = {
      cards,
      byId: new Map(cards.map((card) => [card.dataset.eventId, card])),
    };
  });
  const operationId = await beginWave1cM2Operation(page);
  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 300);
  const rows = await wave1cM2OperationRows(page, operationId);
  const identity = await page.evaluate(() => {
    const before = window.__trajectoryKeyedRoundTrip;
    return {
      preserved: before.cards.filter((card) => (
        card.isConnected
          && before.byId.get(card.dataset.eventId) === card
          && document.querySelector(`#timeline .event[data-event-id="${CSS.escape(card.dataset.eventId)}"]`) === card
      )).length,
      prefixCount: before.cards.length,
    };
  });
  assert.deepEqual(identity, { preserved: 150, prefixCount: 150 });
  assert.deepEqual(rows.filter((row) => row.commitKind === 'appendOnly').map((row) => ({
    pre: row.preCanonicalCount,
    added: row.addedCanonicalCount,
    removed: row.removedCanonicalCount,
    final: row.finalCanonicalCount,
  })), [{ pre: 150, added: 150, removed: 0, final: 300 }]);
  assert.equal(rows.some((row) => row.commitKind === 'replacement'), false);
});

test('browser Trajectory overview pan stays isolated while timeline-pane user scroll retains automatic pagination', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 300,
    hitPositions: [],
    commonTermEvery: 0,
  });
  const { page, requestedUrls } = await openWave1cM1App(t, index, { locale: 'en' });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '150');
  await page.locator('[data-trajectory-sequence-zoom="in"]').click();
  await page.waitForFunction(() => document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '2');

  const requestStart = requestedUrls.length;
  const overviewViewport = page.locator('.trajectoryOverviewViewport');
  await overviewViewport.hover();
  await page.mouse.wheel(0, 100000);
  await page.waitForFunction(() => document.querySelector('.trajectoryOverviewViewport')?.scrollLeft > 0);
  await page.mouse.wheel(0, 100000);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.trajectoryPresentation').getAttribute('data-event-count'), '150');
  assert.equal(requestedUrls.slice(requestStart).some((url) => (
    url.includes('/timeline?') && new URL(url, 'http://local').searchParams.get('offset') === '150'
  )), false);

  const timelinePane = page.locator('.timelinePane');
  await timelinePane.hover();
  await page.mouse.wheel(0, 100000);
  await page.waitForFunction(() => document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '300');
  assert.equal(requestedUrls.slice(requestStart).some((url) => (
    url.includes('/timeline?') && new URL(url, 'http://local').searchParams.get('offset') === '150'
  )), true);
});

test('browser Trajectory discards stale long-session search pages after a Session transition', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 900,
    hitPositions: [800],
  });
  const { page } = await openWave1bM2App(t, index, { locale: 'en' });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  await fillSearch(page, 'far-needle');
  await page.waitForFunction(() => document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '600');

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

  await page.locator('#searchInput').press('Enter');
  await paused.promise;
  assert.equal(await page.locator('.trajectoryPresentation').getAttribute('data-event-count'), '600');
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
      && document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '40'
      && document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '1'
  ), fixture.secondarySessionId);
  release.resolve();
  await page.waitForTimeout(300);

  assert.equal(await page.locator('.trajectoryPresentation').getAttribute('data-event-count'), '40');
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.secondarySessionId);
  assert.equal(await page.locator('body').getAttribute('data-remembered-main-presentation'), 'trajectory');
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser Trajectory keeps an unloaded Cache Main context detached from canonical sequence', async (t) => {
  const fixture = await makeCacheObservationBrowserFixture(t);
  const materialized = await materializeIndexedSession(
    fixture.index,
    fixture.trajectoryDeepSessionId,
  );
  const links = materialized.presentationIndexes.cacheDiscontinuityLinks;
  assert.equal(links.protocolEventIdsByMainEventId.size, 1);
  const [mainEventId, protocolEventIds] = [...links.protocolEventIdsByMainEventId][0];
  assert.equal(protocolEventIds.length, 1);
  const mainEvents = materialized.logicalEvents.filter((event) => event.layer === 'main');
  const mainIndex = mainEvents.findIndex((event) => event.id === mainEventId);
  assert.ok(mainIndex >= 150);
  assert.ok(mainIndex < mainEvents.length - 1);

  const { page } = await openApp(t, fixture.index, {
    locale: 'en',
    skipProjectReindex: true,
  });
  await page.locator(`[data-session-id="${fixture.trajectoryDeepSessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.trajectoryDeepSessionId);
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => (
    document.querySelector('.trajectoryPresentation')?.dataset.eventCount === '150'
  ));
  assert.equal(
    (await page.locator('.trajectoryOverviewStatus').textContent()).trim(),
    `Loaded prefix · 150/${mainEvents.length}`,
  );

  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction((eventCount) => (
    document.querySelector('.trajectoryPresentation')?.dataset.eventCount === String(eventCount)
  ), mainEvents.length);
  const deepMainEvent = page.locator(`[data-trajectory-event-id="${mainEventId}"]`);
  await deepMainEvent.waitFor();
  assert.equal(await deepMainEvent.getAttribute('data-sequence-index'), String(mainIndex));
  await deepMainEvent.click();

  await page.locator('#layerSelect').selectOption('protocol');
  const protocolEvent = page.locator(`#timeline .event[data-event-id="${protocolEventIds[0]}"]`);
  await protocolEvent.waitFor();
  await protocolEvent.click();
  const reverse = page.locator('#detail [data-detail-action="navigate-linked-event"]');
  await reverse.waitFor();
  assert.equal((await reverse.textContent()).trim(), 'View Main context');
  await reverse.click();

  await page.waitForFunction(({ eventId }) => {
    const detached = document.querySelector(`[data-trajectory-detached-event-id="${CSS.escape(eventId)}"]`);
    return document.querySelector('#layerSelect')?.value === 'main'
      && Boolean(document.querySelector('.trajectoryPresentation'))
      && detached?.querySelector('.event.temporaryReferenceReveal.selected');
  }, { eventId: mainEventId });
  const detachedState = await page.evaluate((eventId) => {
    const presentation = document.querySelector('.trajectoryPresentation');
    const detached = document.querySelector(`[data-trajectory-detached-event-id="${CSS.escape(eventId)}"]`);
    const representedCount = presentation.querySelectorAll('.trajectoryNarrativeRow').length
      + [...presentation.querySelectorAll('.trajectoryToolGroup')]
        .reduce((sum, group) => sum + Number(group.dataset.eventCount || 0), 0);
    return {
      detachedOutsidePresentation: !detached.closest('.trajectoryPresentation'),
      detachedCardId: detached.querySelector('.event')?.dataset.eventId || '',
      detachedSelected: detached.querySelector('.event')?.classList.contains('selected') || false,
      presentationCount: Number(presentation.dataset.eventCount),
      representedCount,
      overviewEventCount: Number(presentation.querySelector('.trajectoryOverviewCanvas')?.dataset.eventCount),
      loadedStatus: presentation.querySelector('.trajectoryOverviewStatus')?.textContent || '',
      targetInNarrative: Boolean(presentation.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`)),
      targetInGroup: [...presentation.querySelectorAll('.trajectoryToolGroup')]
        .some((group) => group.__trajectoryEventIds?.has(eventId)),
      locatorId: presentation.querySelector('.trajectoryOverviewLocator')
        ?.dataset.trajectoryOverviewSelectedId || '',
    };
  }, mainEventId);
  assert.deepEqual(detachedState, {
    detachedOutsidePresentation: true,
    detachedCardId: mainEventId,
    detachedSelected: true,
    presentationCount: 150,
    representedCount: 150,
    overviewEventCount: 150,
    loadedStatus: `Loaded prefix · 150/${mainEvents.length}`,
    targetInNarrative: false,
    targetInGroup: false,
    locatorId: '',
  });
  assert.equal(
    (await page.locator('.trajectoryDetachedReferenceHeader h3').textContent()).trim(),
    'Referenced event outside loaded sequence',
  );

  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(({ eventId, eventCount, sequenceIndex }) => {
    const target = document.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`);
    return !document.querySelector('[data-trajectory-detached-event-id]')
      && document.querySelector('.trajectoryPresentation')?.dataset.eventCount === String(eventCount)
      && target?.dataset.sequenceIndex === String(sequenceIndex)
      && target.classList.contains('selected')
      && document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId;
  }, { eventId: mainEventId, eventCount: mainEvents.length, sequenceIndex: mainIndex });
  assert.equal(
    await page.locator('.trajectoryOverviewCanvas').getAttribute('data-event-count'),
    String(mainEvents.length),
  );
  assert.equal(
    (await page.locator('.trajectoryOverviewStatus').textContent()).trim(),
    `Loaded sequence · ${mainEvents.length}`,
  );
});
