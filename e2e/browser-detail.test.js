'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  installWave1bM2SourceBundle,
  installWave1cM2MutationLedger,
  deferred,
  materializeIndexedSession,
  openApp,
  beginWave1cM2Operation,
  endWave1cM2Operation,
  wave1cM2OperationRows,
  settledWave1cM2OperationRows,
  switchHiddenLocale,
  assertEventCount,
  expectInputValue,
  fillSearch,
  waitForSearchMarks,
  waitForNoSearchMarks,
  waitForDetailView,
  makeTransitionProfileIndex,
} = require('./browser-helpers');

async function installWave1dAM1BrowserSeam(page) {
  await page.addInitScript(() => {
    const evidence = {
      detailRequests: [],
      detailBodies: [],
      visibleScans: [],
      lifecycle: [],
      revisions: [],
      detailRequestTransactionAssociations: 0,
      detailTransactions: [],
      observerFailuresArmed: false,
      failNextTimelineInnerHtml: false,
    };
    window.__wave1dAM1 = {
      evidence,
      reset() {
        evidence.detailRequests.length = 0;
        evidence.detailBodies.length = 0;
        evidence.visibleScans.length = 0;
        evidence.lifecycle.length = 0;
        evidence.revisions.length = 0;
        evidence.detailRequestTransactionAssociations = 0;
        evidence.detailTransactions.length = 0;
      },
      armObserverFailures() { evidence.observerFailuresArmed = true; },
      disarmObserverFailures() { evidence.observerFailuresArmed = false; },
      armTimelineRenderFailure() { evidence.failNextTimelineInnerHtml = true; },
    };
    const record = (collection, value) => {
      collection.push(structuredClone(value));
      if (evidence.observerFailuresArmed) throw new Error('synthetic Wave 1D-A observer failure');
    };
    window.__sessionAnalyzerTimelineLifecycleObserver = {
      recordLifecycle(value) { record(evidence.lifecycle, value); },
      recordRevision(value) { record(evidence.revisions, value); },
      recordDetailRequest(value) { record(evidence.detailRequests, value); },
      recordDetailBody(value) { record(evidence.detailBodies, value); },
      recordVisibleDetailScan(value) { record(evidence.visibleScans, value); },
    };

    const defineProperty = Object.defineProperty.bind(Object);
    Object.defineProperty = (target, property, descriptor) => {
      if (target instanceof Promise
          && typeof property === 'symbol'
          && property.description === 'detailRequestTransaction') {
        evidence.detailRequestTransactionAssociations += 1;
        evidence.detailTransactions.push({
          eventId: descriptor.value.event.id,
          requestSerial: descriptor.value.observerSerial,
        });
      }
      return defineProperty(target, property, descriptor);
    };
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(value) {
        if (this.id === 'timeline' && evidence.failNextTimelineInnerHtml) {
          evidence.failNextTimelineInnerHtml = false;
          throw new Error('synthetic Timeline fallback render failure');
        }
        return descriptor.set.call(this, value);
      },
    });
  });
}

async function openWave1dAM1App(t, index, options = {}) {
  const callerBeforeGoto = options.beforeGoto;
  return openApp(t, index, {
    ...options,
    beforeGoto: async (page) => {
      await installWave1bM2SourceBundle(page);
      await installWave1dAM1BrowserSeam(page);
      await installWave1cM2MutationLedger(page);
      if (callerBeforeGoto) await callerBeforeGoto(page);
    },
  });
}

async function installWave1dAM1SearchTracking(page) {
  await page.evaluate(() => {
    const targetsApi = window.sessionSearchTargets;
    const highlighter = window.sessionSearchHighlighter;
    const originalDiscover = targetsApi.discover.bind(targetsApi);
    const originalResetBindings = targetsApi.resetBindings.bind(targetsApi);
    const originalResetSurfaceBindings = targetsApi.resetSurfaceBindings.bind(targetsApi);
    const originalClear = highlighter.clear.bind(highlighter);
    const originalApply = highlighter.apply.bind(highlighter);
    const evidence = {
      latestTargets: [],
      resetBindingsCount: 0,
      resetSurfaceRows: [],
      clearRoots: [],
      applyRoots: [],
    };
    const rootKind = (root) => {
      if (root?.id === 'timeline') return 'timelineRoot';
      if (root?.id === 'detail') return 'detailRoot';
      if (root?.classList?.contains('event')) return 'timelineOwner';
      if (root?.classList?.contains('inspector')) return 'inspectorOwner';
      return 'other';
    };
    window.__wave1dAM1Search = {
      evidence,
      resetOperations() {
        evidence.resetBindingsCount = 0;
        evidence.resetSurfaceRows.length = 0;
        evidence.clearRoots.length = 0;
        evidence.applyRoots.length = 0;
      },
    };
    targetsApi.discover = (...args) => {
      const result = originalDiscover(...args);
      evidence.latestTargets = result.targets;
      return result;
    };
    targetsApi.resetBindings = (...args) => {
      evidence.resetBindingsCount += 1;
      return originalResetBindings(...args);
    };
    targetsApi.resetSurfaceBindings = (target, surface) => {
      evidence.resetSurfaceRows.push({ surface, targetKnown: evidence.latestTargets.includes(target) });
      return originalResetSurfaceBindings(target, surface);
    };
    highlighter.clear = (root, ...args) => {
      evidence.clearRoots.push(rootKind(root));
      return originalClear(root, ...args);
    };
    highlighter.apply = (root, ...args) => {
      evidence.applyRoots.push(rootKind(root));
      return originalApply(root, ...args);
    };
  });
}

async function openWave1dAM1ControlledOrdinaryDetail(t, options = {}) {
  const collapsedProfile = {
    id: `custom:wave-1d-a-controlled-${options.requestError ? 'error' : 'success'}`,
    name: 'Wave 1D-A controlled ordinary fixture',
    description: 'Delay one explicit ordinary detail request for settlement controls.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
  const gate = deferred();
  const started = deferred();
  const requests = { count: 0 };
  const app = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (page) => {
      await page.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        requests.count += 1;
        started.resolve();
        await gate.promise;
        if (options.requestError) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Synthetic Wave 1D-A controlled request failure' }),
          });
        } else if (options.tallDetail) {
          const response = await route.fetch();
          const detail = await response.json();
          detail.timelineSections = [{
            type: 'markdown',
            purpose: 'content',
            html: `<p>${Array.from({ length: 160 }, (_, index) => (
              `material detail line ${index}<br>`
            )).join('')}</p>`,
          }];
          await route.fulfill({
            status: response.status(),
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        } else {
          await route.continue();
        }
      });
    },
  });
  const owner = app.page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
  const eventId = await owner.getAttribute('data-event-id');
  assert.ok(eventId);
  await app.page.evaluate(() => window.__wave1dAM1.reset());
  if (options.observerAbsentBeforeRequest) {
    await app.page.evaluate(() => { delete window.__sessionAnalyzerTimelineLifecycleObserver; });
  } else if (options.observerFailuresBeforeRequest) {
    await app.page.evaluate(() => window.__wave1dAM1.armObserverFailures());
  }
  if (options.inspect) await owner.locator(':scope > .eventHeader > .eventKind').click();
  else await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await started.promise;
  await app.page.locator(`#timeline .event[data-event-id="${eventId}"].expanded .eventBody`).waitFor();
  if (options.inspect) await waitForDetailView(app.page, 'inspector');
  return { ...app, eventId, gate, requests };
}

test('browser Wave 1D-A M1 ordinary detail settles once with a body-only Timeline patch and scoped Inspector search', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-collapsed',
    name: 'Wave 1D-A collapsed fixture',
    description: 'Start ordinary detail only from explicit user intent.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 320,
    hitPositions: [],
    commonTermEvery: 1,
  });
  const detailGate = deferred();
  const detailStarted = deferred();
  let detailRequestCount = 0;
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        detailRequestCount += 1;
        detailStarted.resolve();
        await detailGate.promise;
        await route.continue();
      });
    },
  });
  await installWave1dAM1SearchTracking(page);
  await fillSearch(page, 'common-term');
  await waitForSearchMarks(page, 5);
  const eventId = await page.evaluate(() => (
    document.querySelector('#timeline mark.searchMark.activeSearchMark')
      ?.closest('.event[data-event-id]')?.dataset.eventId || ''
  ));
  assert.ok(eventId);
  await page.evaluate(() => window.__wave1dAM1.reset());
  await page.locator(`#timeline .event[data-event-id="${eventId}"] .eventKind`).click();
  await detailStarted.promise;
  await page.waitForSelector(`#timeline .event[data-event-id="${eventId}"].expanded .eventBody`);
  await waitForDetailView(page, 'inspector');
  await page.evaluate((ownerId) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`);
    const activeMark = article.querySelector('mark.searchMark.activeSearchMark')
      || article.querySelector('mark.searchMark');
    const target = window.__wave1dAM1Search.evidence.latestTargets.find(
      (candidate) => candidate.id === activeMark?.dataset.searchTargetId,
    );
    const unrelatedMark = [...document.querySelectorAll('#timeline mark.searchMark')]
      .find((mark) => !article.contains(mark));
    const unrelatedTarget = window.__wave1dAM1Search.evidence.latestTargets.find(
      (candidate) => candidate.id === unrelatedMark?.dataset.searchTargetId,
    );
    window.__wave1dAM1Identity = {
      article,
      contextSlot: article.previousElementSibling?.classList.contains('contextRevealSlot')
        ? article.previousElementSibling
        : null,
      header: article.querySelector(':scope > .eventHeader'),
      toggle: article.querySelector(':scope > .eventHeader > .eventToggle'),
      previews: [...article.querySelectorAll(':scope > .eventPreview')],
      affordance: article.querySelector(':scope > .enclosingOperationAffordance'),
      footer: article.querySelector(':scope > .eventFooterActions'),
      footerControls: [...article.querySelectorAll(':scope > .eventFooterActions button')],
      className: article.className,
      selected: article.classList.contains('selected'),
      unrelatedArticle: [...document.querySelectorAll('#timeline .event[data-event-id]')]
        .find((candidate) => candidate !== article),
      activeMark,
      activeTargetId: target?.id || '',
      target,
      unrelatedMark,
      unrelatedTarget,
      unrelatedTimelineBindings: unrelatedTarget?.bindings.timeline,
      unrelatedInspectorBindings: unrelatedTarget?.bindings.inspector,
      targetOrder: window.__wave1dAM1Search.evidence.latestTargets.map((candidate) => candidate.id),
    };
    window.__wave1dAM1Search.resetOperations();
  }, eventId);
  const settlementOperationId = await beginWave1cM2Operation(page);
  detailGate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`);
    return body && !body.textContent.includes('Loading structured detail');
  }, eventId);
  await page.waitForFunction(() => (
    document.querySelector('#detail .inspector')
      && !document.querySelector('#detail').textContent.includes('Loading structured detail')
  ));
  await endWave1cM2Operation(page);

  assert.equal(detailRequestCount, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const createdRows = causal.detailRequests.filter((row) => row.requestCreated);
  const reusedRows = causal.detailRequests.filter((row) => row.requestReused);
  assert.equal(createdRows.length, 1);
  assert.ok(reusedRows.length >= 1);
  assert.ok(reusedRows.every((row) => row.requestSerial === createdRows[0].requestSerial));
  assert.equal(causal.detailRequestTransactionAssociations, 1);
  assert.equal(causal.detailRequests.filter((row) => row.phase === 'acceptedMutation').length, 1);
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].acceptedMutation, 'success');
  assert.equal(settlements[0].settlementOutcome, 'bodyPatch');
  assert.equal(settlements[0].presentationFailed, false);
  assert.equal(settlements[0].acceptedStateReclassified, false);
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.equal(causal.detailBodies.length, 1);
  assert.equal(Object.hasOwn(causal.detailBodies[0], 'timelineRootReplacementCount'), false,
    'direct Timeline-root causality belongs to the focused MutationRecord ledger');
  assert.deepEqual({
    eventClassification: causal.detailBodies[0].eventClassification,
    expanded: causal.detailBodies[0].expanded,
    bodyPresent: causal.detailBodies[0].bodyPresent,
    articleIdentityPreserved: causal.detailBodies[0].articleIdentityPreserved,
    contextSlotIdentityPreserved: causal.detailBodies[0].contextSlotIdentityPreserved,
    headerIdentityPreserved: causal.detailBodies[0].headerIdentityPreserved,
    toggleIdentityPreserved: causal.detailBodies[0].toggleIdentityPreserved,
    previewIdentityPreserved: causal.detailBodies[0].previewIdentityPreserved,
    footerIdentityPreserved: causal.detailBodies[0].footerIdentityPreserved,
  }, {
    eventClassification: 'ordinary',
    expanded: true,
    bodyPresent: true,
    articleIdentityPreserved: true,
    contextSlotIdentityPreserved: true,
    headerIdentityPreserved: true,
    toggleIdentityPreserved: true,
    previewIdentityPreserved: true,
    footerIdentityPreserved: true,
  });
  const settlementRows = await wave1cM2OperationRows(page, settlementOperationId);
  assert.equal(settlementRows.length, 0, 'body settlement must not mutate direct Timeline children');

  const identity = await page.evaluate(() => {
    const before = window.__wave1dAM1Identity;
    const article = before.article;
    const active = document.querySelector('#timeline mark.searchMark.activeSearchMark');
    return {
      article: article.isConnected
        && article === document.querySelector(`#timeline .event[data-event-id="${CSS.escape(article.dataset.eventId)}"]`),
      contextSlot: before.contextSlot === null || before.contextSlot.isConnected,
      header: before.header === article.querySelector(':scope > .eventHeader'),
      toggle: before.toggle === article.querySelector(':scope > .eventHeader > .eventToggle'),
      previews: before.previews.length === article.querySelectorAll(':scope > .eventPreview').length
        && before.previews.every((node, index) => node === article.querySelectorAll(':scope > .eventPreview')[index]),
      affordance: before.affordance === article.querySelector(':scope > .enclosingOperationAffordance'),
      footer: before.footer === article.querySelector(':scope > .eventFooterActions'),
      footerControls: before.footerControls.every((node, index) => (
        node === article.querySelectorAll(':scope > .eventFooterActions button')[index]
      )),
      className: before.className === article.className,
      selected: before.selected === article.classList.contains('selected'),
      unrelatedArticle: before.unrelatedArticle.isConnected,
      unrelatedMark: before.unrelatedMark.isConnected,
      activeMarkRecreated: !before.activeMark.isConnected,
      activeTargetRestored: active?.dataset.searchTargetId === before.activeTargetId,
      targetObject: window.__wave1dAM1Search.evidence.latestTargets.includes(before.target),
      targetOrder: JSON.stringify(window.__wave1dAM1Search.evidence.latestTargets.map((candidate) => candidate.id))
        === JSON.stringify(before.targetOrder),
      unrelatedTarget: window.__wave1dAM1Search.evidence.latestTargets.includes(before.unrelatedTarget),
      unrelatedTimelineBindings: before.unrelatedTarget.bindings.timeline === before.unrelatedTimelineBindings,
      unrelatedInspectorBindings: before.unrelatedTarget.bindings.inspector === before.unrelatedInspectorBindings,
      activeTargetId: document.querySelector('#searchMetricsPanel').dataset.searchActiveTargetId,
      expectedActiveTargetId: before.activeTargetId,
      searchOps: {
        resetBindingsCount: window.__wave1dAM1Search.evidence.resetBindingsCount,
        resetSurfaceRows: structuredClone(window.__wave1dAM1Search.evidence.resetSurfaceRows),
        clearRoots: [...window.__wave1dAM1Search.evidence.clearRoots],
        applyRoots: [...window.__wave1dAM1Search.evidence.applyRoots],
      },
    };
  });
  assert.deepEqual({
    article: identity.article,
    contextSlot: identity.contextSlot,
    header: identity.header,
    toggle: identity.toggle,
    previews: identity.previews,
    affordance: identity.affordance,
    footer: identity.footer,
    footerControls: identity.footerControls,
    className: identity.className,
    selected: identity.selected,
    unrelatedArticle: identity.unrelatedArticle,
    unrelatedMark: identity.unrelatedMark,
    activeMarkRecreated: identity.activeMarkRecreated,
    activeTargetRestored: identity.activeTargetRestored,
    targetObject: identity.targetObject,
    targetOrder: identity.targetOrder,
    unrelatedTarget: identity.unrelatedTarget,
    unrelatedTimelineBindings: identity.unrelatedTimelineBindings,
    unrelatedInspectorBindings: identity.unrelatedInspectorBindings,
  }, {
    article: true,
    contextSlot: true,
    header: true,
    toggle: true,
    previews: true,
    affordance: true,
    footer: true,
    footerControls: true,
    className: true,
    selected: true,
    unrelatedArticle: true,
    unrelatedMark: true,
    activeMarkRecreated: true,
    activeTargetRestored: true,
    targetObject: true,
    targetOrder: true,
    unrelatedTarget: true,
    unrelatedTimelineBindings: true,
    unrelatedInspectorBindings: true,
  });
  assert.equal(identity.activeTargetId, identity.expectedActiveTargetId);
  assert.equal(identity.searchOps.resetBindingsCount, 0);
  assert.deepEqual(identity.searchOps.resetSurfaceRows.map((row) => row.surface).sort(), ['inspector', 'timeline']);
  assert.ok(identity.searchOps.resetSurfaceRows.every((row) => row.targetKnown));
  assert.deepEqual(identity.searchOps.clearRoots.sort(), ['inspectorOwner', 'timelineOwner']);
  assert.deepEqual(identity.searchOps.applyRoots.sort(), ['inspectorOwner', 'timelineOwner']);

  await page.evaluate(() => {
    window.__wave1dAM1Identity.prefixArticle = window.__wave1dAM1Identity.article;
  });
  const appendOperationId = await beginWave1cM2Operation(page);
  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 300);
  await endWave1cM2Operation(page);
  const appendRows = await wave1cM2OperationRows(page, appendOperationId);
  assert.equal(appendRows.filter((row) => row.commitKind === 'appendOnly').length, 1);
  assert.equal(appendRows.filter((row) => row.commitKind === 'replacement').length, 0);
  assert.equal(await page.evaluate(() => window.__wave1dAM1Identity.prefixArticle.isConnected), true);
});

test('browser Wave 1D-A M1 preserves the non-zero mounted Timeline scroller across a material body patch', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t, {
    tallDetail: true,
  });
  await page.evaluate((ownerId) => {
    const timeline = document.querySelector('#timeline');
    const scroller = timeline.closest('.timelinePane');
    const article = timeline.querySelector(`.event[data-event-id="${CSS.escape(ownerId)}"]`);
    const body = article.querySelector(':scope > .eventBody');
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.min(400, maxScrollTop);
    if (scroller.scrollTop <= 0) throw new Error('expected a non-zero Timeline scroll position');

    const originalClear = window.sessionSearchHighlighter.clear.bind(
      window.sessionSearchHighlighter,
    );
    const capturedScrollTop = scroller.scrollTop;
    const identity = {
      timeline,
      scroller,
      capturedScrollTop,
      article,
      contextSlot: article.previousElementSibling?.classList.contains('contextRevealSlot')
        ? article.previousElementSibling
        : null,
      header: article.querySelector(':scope > .eventHeader'),
      toggle: article.querySelector(':scope > .eventHeader > .eventToggle'),
      previews: [...article.querySelectorAll(':scope > .eventPreview')],
      footer: article.querySelector(':scope > .eventFooterActions'),
      beforeBodyHeight: body.getBoundingClientRect().height,
      scrollPerturbed: false,
    };
    window.sessionSearchHighlighter.clear = (root, ...args) => {
      const result = originalClear(root, ...args);
      if (!identity.scrollPerturbed && root === article) {
        const nextScrollTop = Math.min(
          scroller.scrollHeight - scroller.clientHeight,
          capturedScrollTop + 137,
        );
        scroller.scrollTop = nextScrollTop === capturedScrollTop
          ? Math.max(0, capturedScrollTop - 137)
          : nextScrollTop;
        identity.scrollPerturbed = scroller.scrollTop !== capturedScrollTop;
      }
      return result;
    };
    window.__wave1dAM1ScrollIdentity = identity;
  }, eventId);
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement && row.settlementOutcome === 'bodyPatch',
  ));
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(
      `#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`,
    );
    return body && !body.textContent.includes('Loading structured detail');
  }, eventId);
  await endWave1cM2Operation(page);

  assert.equal(requests.count, 1);
  assert.equal((await wave1cM2OperationRows(page, operationId)).length, 0);
  assert.deepEqual(await page.evaluate(() => {
    const before = window.__wave1dAM1ScrollIdentity;
    const article = before.article;
    const currentScroller = before.timeline.closest('.timelinePane');
    const currentPreviews = [...article.querySelectorAll(':scope > .eventPreview')];
    const nextBody = article.querySelector(':scope > .eventBody');
    return {
      scrollWasExplicitlyPerturbed: before.scrollPerturbed,
      scrollerIdentity: before.scroller === currentScroller && before.scroller.isConnected,
      scrollTop: currentScroller.scrollTop,
      expectedScrollTop: before.capturedScrollTop,
      bodyHeightChangedMaterially: nextBody.getBoundingClientRect().height
        > before.beforeBodyHeight + 1000,
      articleIdentity: article.isConnected
        && article === document.querySelector(
          `#timeline .event[data-event-id="${CSS.escape(article.dataset.eventId)}"]`,
        ),
      contextSlotIdentity: before.contextSlot === null || before.contextSlot.isConnected,
      headerIdentity: before.header === article.querySelector(':scope > .eventHeader'),
      toggleIdentity: before.toggle === article.querySelector(':scope > .eventHeader > .eventToggle'),
      previewIdentity: before.previews.length === currentPreviews.length
        && before.previews.every((node, index) => node === currentPreviews[index]),
      footerIdentity: before.footer === article.querySelector(':scope > .eventFooterActions'),
    };
  }), {
    scrollWasExplicitlyPerturbed: true,
    scrollerIdentity: true,
    scrollTop: await page.evaluate(() => window.__wave1dAM1ScrollIdentity.capturedScrollTop),
    expectedScrollTop: await page.evaluate(() => window.__wave1dAM1ScrollIdentity.capturedScrollTop),
    bodyHeightChangedMaterially: true,
    articleIdentity: true,
    contextSlotIdentity: true,
    headerIdentity: true,
    toggleIdentity: true,
    previewIdentity: true,
    footerIdentity: true,
  });
});

test('browser Wave 1D-A M1 no-observer body patch shares one request without a Promise evidence pointer', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t, {
    observerAbsentBeforeRequest: true,
  });
  await page.evaluate((ownerId) => {
    const originalMapGet = Map.prototype.get;
    const probe = {
      ownerId,
      armed: false,
      adoptionCount: 0,
      fallbackOnlyCanonicalGetCount: 0,
      restore() { Map.prototype.get = originalMapGet; },
    };
    Map.prototype.get = function get(key) {
      if (probe.armed && key === probe.ownerId) probe.fallbackOnlyCanonicalGetCount += 1;
      return originalMapGet.call(this, key);
    };
    window.__wave1dAM1NoObserverBody = probe;
    window.__sessionAnalyzerTimelineLifecycleObserver = {
      recordLifecycle(value) {
        if (value.operation !== 'adopt') return;
        probe.adoptionCount += 1;
        probe.armed = true;
        queueMicrotask(() => { probe.armed = false; });
      },
    };
  }, eventId);
  await page.locator(
    `#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventKind`,
  ).click();
  await waitForDetailView(page, 'inspector');
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(
      `#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`,
    );
    return window.__wave1dAM1NoObserverBody.adoptionCount === 1
      && body
      && !body.textContent.includes('Loading structured detail');
  }, eventId);
  await page.waitForFunction(() => (
    document.querySelector('#detail .inspector')
      && !document.querySelector('#detail').textContent.includes('Loading structured detail')
  ));
  await page.evaluate(() => new Promise((resolve) => queueMicrotask(resolve)));
  await endWave1cM2Operation(page);

  assert.equal(requests.count, 1);
  assert.equal((await wave1cM2OperationRows(page, operationId)).length, 0);
  assert.deepEqual(await page.evaluate(() => {
    const probe = window.__wave1dAM1NoObserverBody;
    probe.restore();
    return {
      adoptionCount: probe.adoptionCount,
      fallbackOnlyCanonicalGetCount: probe.fallbackOnlyCanonicalGetCount,
      detailRequestRecords: window.__wave1dAM1.evidence.detailRequests.length,
      detailBodyRecords: window.__wave1dAM1.evidence.detailBodies.length,
      revisionRecords: window.__wave1dAM1.evidence.revisions.length,
      detailRequestTransactionAssociations:
        window.__wave1dAM1.evidence.detailRequestTransactionAssociations,
    };
  }), {
    adoptionCount: 1,
    fallbackOnlyCanonicalGetCount: 0,
    detailRequestRecords: 0,
    detailBodyRecords: 0,
    revisionRecords: 0,
    detailRequestTransactionAssociations: 0,
  });
});

test('browser Wave 1D-A M1 no-observer full fallback performs no fallback-only DOM probe', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t);
  await page.evaluate((ownerId) => {
    document.querySelector(
      `#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`,
    )?.remove();
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    const childrenDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'children');
    const probe = {
      ownerId,
      armed: false,
      timelineReplacementSetCount: 0,
      fallbackOnlyArticleChildrenReadCount: 0,
      restore() {
        Object.defineProperty(Element.prototype, 'innerHTML', innerHtmlDescriptor);
        Object.defineProperty(Element.prototype, 'children', childrenDescriptor);
      },
    };
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...innerHtmlDescriptor,
      get() { return innerHtmlDescriptor.get.call(this); },
      set(value) {
        const result = innerHtmlDescriptor.set.call(this, value);
        if (this.id === 'timeline') {
          probe.timelineReplacementSetCount += 1;
          probe.armed = true;
          queueMicrotask(() => { probe.armed = false; });
        }
        return result;
      },
    });
    Object.defineProperty(Element.prototype, 'children', {
      ...childrenDescriptor,
      get() {
        if (probe.armed && this.dataset?.eventId === probe.ownerId) {
          probe.fallbackOnlyArticleChildrenReadCount += 1;
        }
        return childrenDescriptor.get.call(this);
      },
    });
    window.__wave1dAM1NoObserverFallback = probe;
    window.__wave1dAM1.reset();
    window.__sessionAnalyzerTimelineLifecycleObserver = {};
  }, eventId);
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(
      `#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`,
    );
    return window.__wave1dAM1NoObserverFallback.timelineReplacementSetCount === 1
      && body
      && !body.textContent.includes('Loading structured detail');
  }, eventId);
  await page.evaluate(() => new Promise((resolve) => queueMicrotask(resolve)));
  await endWave1cM2Operation(page);

  assert.equal(requests.count, 1);
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 1);
  assert.deepEqual(await page.evaluate(() => {
    const probe = window.__wave1dAM1NoObserverFallback;
    probe.restore();
    return {
      timelineReplacementSetCount: probe.timelineReplacementSetCount,
      fallbackOnlyArticleChildrenReadCount: probe.fallbackOnlyArticleChildrenReadCount,
      detailRequestRecords: window.__wave1dAM1.evidence.detailRequests.length,
      detailBodyRecords: window.__wave1dAM1.evidence.detailBodies.length,
      revisionRecords: window.__wave1dAM1.evidence.revisions.length,
    };
  }), {
    timelineReplacementSetCount: 1,
    fallbackOnlyArticleChildrenReadCount: 0,
    detailRequestRecords: 0,
    detailBodyRecords: 0,
    revisionRecords: 0,
  });
});

test('browser Wave 1D-A M1 collapsed-before-settlement adopts the token without Timeline DOM or highlight work', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-no-dom',
    name: 'Wave 1D-A no-DOM fixture',
    description: 'Collapse an ordinary owner before its detail settles.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
  const detailGate = deferred();
  const detailStarted = deferred();
  let detailRequestCount = 0;
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        detailRequestCount += 1;
        detailStarted.resolve();
        await detailGate.promise;
        await route.continue();
      });
    },
  });
  await installWave1dAM1SearchTracking(page);
  const owner = page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
  const eventId = await owner.getAttribute('data-event-id');
  assert.ok(eventId);
  await page.evaluate(() => window.__wave1dAM1.reset());
  await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await detailStarted.promise;
  await page.locator(`#timeline .event[data-event-id="${eventId}"].expanded .eventBody`).waitFor();
  await page.locator(`#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`).click();
  await page.locator(`#timeline .event[data-event-id="${eventId}"].collapsed`).waitFor();
  await page.evaluate((ownerId) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`);
    window.__wave1dAM1NoDomIdentity = {
      article,
      header: article.querySelector(':scope > .eventHeader'),
      toggle: article.querySelector(':scope > .eventHeader > .eventToggle'),
      marks: [...document.querySelectorAll('#timeline mark.searchMark')],
    };
    window.__wave1dAM1Search.resetOperations();
  }, eventId);
  const operationId = await beginWave1cM2Operation(page);
  detailGate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await endWave1cM2Operation(page);

  assert.equal(detailRequestCount, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].acceptedMutation, 'success');
  assert.equal(settlements[0].settlementOutcome, 'noDomAdoption');
  assert.equal(settlements[0].presentationFailed, false);
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.equal(causal.lifecycle.filter((row) => row.operation === 'adopt').length, 1);
  assert.deepEqual(causal.detailBodies.map((row) => ({
    expanded: row.expanded,
    bodyPresent: row.bodyPresent,
  })), [{ expanded: false, bodyPresent: false }]);
  assert.equal((await wave1cM2OperationRows(page, operationId)).length, 0);
  const noDom = await page.evaluate(() => {
    const before = window.__wave1dAM1NoDomIdentity;
    const article = before.article;
    return {
      article: article.isConnected
        && article === document.querySelector(`#timeline .event[data-event-id="${CSS.escape(article.dataset.eventId)}"]`),
      header: before.header === article.querySelector(':scope > .eventHeader'),
      toggle: before.toggle === article.querySelector(':scope > .eventHeader > .eventToggle'),
      bodyCount: article.querySelectorAll(':scope > .eventBody').length,
      marks: before.marks.every((mark) => mark.isConnected),
      searchOps: {
        resetBindingsCount: window.__wave1dAM1Search.evidence.resetBindingsCount,
        resetSurfaceCount: window.__wave1dAM1Search.evidence.resetSurfaceRows.length,
        clearCount: window.__wave1dAM1Search.evidence.clearRoots.length,
        applyCount: window.__wave1dAM1Search.evidence.applyRoots.length,
      },
    };
  });
  assert.deepEqual(noDom, {
    article: true,
    header: true,
    toggle: true,
    bodyCount: 0,
    marks: true,
    searchOps: { resetBindingsCount: 0, resetSurfaceCount: 0, clearCount: 0, applyCount: 0 },
  });
  await page.locator(`#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`).click();
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`);
    return body && !body.textContent.includes('Loading structured detail');
  }, eventId);
  assert.equal(detailRequestCount, 1, 'cached accepted detail must not create a second request');
});

test('browser Wave 1D-A M1 accepted ordinary request errors patch only the mounted detail body', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-error',
    name: 'Wave 1D-A error fixture',
    description: 'Keep the ordinary error settlement body-local.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
  const detailGate = deferred();
  const detailStarted = deferred();
  let detailRequestCount = 0;
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        detailRequestCount += 1;
        detailStarted.resolve();
        await detailGate.promise;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic Wave 1D-A detail failure' }),
        });
      });
    },
  });
  const owner = page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
  const eventId = await owner.getAttribute('data-event-id');
  assert.ok(eventId);
  await page.evaluate(() => window.__wave1dAM1.reset());
  await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await detailStarted.promise;
  await page.evaluate((ownerId) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`);
    window.__wave1dAM1ErrorIdentity = {
      article,
      header: article.querySelector(':scope > .eventHeader'),
      toggle: article.querySelector(':scope > .eventHeader > .eventToggle'),
      footer: article.querySelector(':scope > .eventFooterActions'),
    };
  }, eventId);
  const operationId = await beginWave1cM2Operation(page);
  detailGate.resolve();
  await page.locator(`#timeline .event[data-event-id="${eventId}"] > .eventBody [data-action="retry-detail"]`).waitFor();
  await endWave1cM2Operation(page);

  assert.equal(detailRequestCount, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].acceptedMutation, 'error');
  assert.equal(settlements[0].settlementOutcome, 'bodyPatch');
  assert.equal(settlements[0].presentationFailed, false);
  assert.equal(settlements[0].acceptedStateReclassified, false);
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.equal((await wave1cM2OperationRows(page, operationId)).length, 0);
  assert.deepEqual(await page.evaluate(() => {
    const before = window.__wave1dAM1ErrorIdentity;
    return {
      article: before.article.isConnected,
      header: before.header === before.article.querySelector(':scope > .eventHeader'),
      toggle: before.toggle === before.article.querySelector(':scope > .eventHeader > .eventToggle'),
      footer: before.footer === before.article.querySelector(':scope > .eventFooterActions'),
    };
  }), { article: true, header: true, toggle: true, footer: true });
});

test('browser Wave 1D-A M1 visible collapsed Main Code Mode remains hydrated through one full fallback', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-code-mode',
    name: 'Wave 1D-A Code Mode fixture',
    description: 'Keep every owner collapsed while preserving Code Mode hydration.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 200,
    hitPositions: [],
    includeContextReveal: true,
    contextRevealIndex: 0,
  });
  const session = await materializeIndexedSession(index, fixture.longSessionId);
  const operation = session.logicalEvents.find((event, indexValue) => (
    indexValue < 5 && event.kind === 'code_mode_operation'
  ));
  assert.ok(operation);
  const detailGate = deferred();
  const detailStarted = deferred();
  let detailRequestCount = 0;
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        detailRequestCount += 1;
        detailStarted.resolve();
        await detailGate.promise;
        await route.continue();
      });
    },
  });
  await detailStarted.promise;
  const operationId = await beginWave1cM2Operation(page);
  detailGate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement && row.settlementOutcome === 'fullRenderFallback',
  ));
  await page.waitForFunction(() => window.__wave1dAM1.evidence.visibleScans.some(
    (row) => row.mountedArticleCount > row.candidateArticleCount,
  ));

  assert.equal(detailRequestCount, 1, 'collapsed visible Main Code Mode should hydrate exactly once');
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  assert.equal(causal.detailRequests.filter((row) => row.requestCreated).length, 1);
  assert.equal(causal.detailRequests.filter((row) => row.phase === 'acceptedMutation').length, 1);
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].acceptedMutation, 'success');
  assert.equal(settlements[0].settlementOutcome, 'fullRenderFallback');
  assert.equal(settlements[0].presentationErrorStage, 'none');
  assert.equal(settlements[0].presentationFailed, false);
  assert.equal(settlements[0].acceptedStateReclassified, false);
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.deepEqual(causal.detailBodies.map((row) => row.eventClassification), ['codeMode']);
  assert.equal(Object.hasOwn(causal.detailBodies[0], 'timelineRootReplacementCount'), false);
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 1);
  assert.equal(causal.lifecycle.filter((row) => row.operation === 'adopt').length, 0);
  const scans = causal.visibleScans.filter((row) => row.mountedArticleCount > 0);
  assert.ok(scans.length > 0);
  assert.ok(scans.some((row) => row.candidateArticleCount > 0
    && row.candidateArticleCount < row.mountedArticleCount));
  assert.ok(scans.every((row) => row.articleGeometryReadCount === row.candidateArticleCount));
  assert.ok(scans.every((row) => row.scrollportGeometryReadCount === 1));
  const operationCard = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);
  await operationCard.waitFor();
  assert.equal(await operationCard.evaluate((node) => node.classList.contains('collapsed')), true);
});

test('browser Wave 1D-A M1 accepted Code Mode request error remains one full fallback', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-code-mode-error',
    name: 'Wave 1D-A Code Mode error fixture',
    description: 'Keep the visible Code Mode request collapsed and fail its detail request.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 50,
    hitPositions: [],
    includeContextReveal: true,
    contextRevealIndex: 0,
  });
  const detailGate = deferred();
  const detailStarted = deferred();
  let detailRequestCount = 0;
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        detailRequestCount += 1;
        detailStarted.resolve();
        await detailGate.promise;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic Code Mode detail failure' }),
        });
      });
    },
  });
  await detailStarted.promise;
  const operationId = await beginWave1cM2Operation(page);
  detailGate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  assert.equal(detailRequestCount, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlement = causal.detailRequests.find((row) => row.presentationSettlement);
  assert.equal(settlement.acceptedMutation, 'error');
  assert.equal(settlement.settlementOutcome, 'fullRenderFallback');
  assert.equal(settlement.presentationFailed, false);
  assert.equal(settlement.acceptedStateReclassified, false);
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.deepEqual(causal.detailBodies.map((row) => row.eventClassification), ['codeMode']);
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 1);
});

test('browser Wave 1D-A M1 local presentation failure falls back without reclassifying accepted success', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t);
  await page.evaluate((ownerId) => {
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`)?.remove();
  }, eventId);
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`);
    return body && !body.textContent.includes('Loading structured detail');
  }, eventId);
  await endWave1cM2Operation(page);

  assert.equal(requests.count, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.deepEqual({
    acceptedMutation: settlements[0].acceptedMutation,
    settlementOutcome: settlements[0].settlementOutcome,
    presentationErrorStage: settlements[0].presentationErrorStage,
    acceptedStateReclassified: settlements[0].acceptedStateReclassified,
    presentationFailed: settlements[0].presentationFailed,
  }, {
    acceptedMutation: 'success',
    settlementOutcome: 'fullRenderFallback',
    presentationErrorStage: 'local',
    acceptedStateReclassified: false,
    presentationFailed: false,
  });
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 1);
  assert.equal(await page.locator(`#timeline .event[data-event-id="${eventId}"] [data-action="retry-detail"]`).count(), 0);
});

test('browser Wave 1D-A M1 fallback render failure preserves accepted success and one settlement', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t);
  await page.evaluate((ownerId) => {
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`)?.remove();
    window.__wave1dAM1.armTimelineRenderFailure();
  }, eventId);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.deepEqual({
    acceptedMutation: settlements[0].acceptedMutation,
    settlementOutcome: settlements[0].settlementOutcome,
    presentationErrorStage: settlements[0].presentationErrorStage,
    acceptedStateReclassified: settlements[0].acceptedStateReclassified,
    presentationFailed: settlements[0].presentationFailed,
  }, {
    acceptedMutation: 'success',
    settlementOutcome: 'fullRenderFallback',
    presentationErrorStage: 'fallback',
    acceptedStateReclassified: false,
    presentationFailed: true,
  });
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.match(await page.locator('#stateLine').innerText(), /synthetic Timeline fallback render failure/i);

  await page.locator(`#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`).click();
  await page.locator(`#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`).click();
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`);
    return body && !body.textContent.includes('Loading structured detail');
  }, eventId);
  assert.equal(requests.count, 1);
  assert.equal(await page.locator(`#timeline .event[data-event-id="${eventId}"] [data-action="retry-detail"]`).count(), 0);
  assert.equal((await page.evaluate(() => window.__wave1dAM1.evidence.revisions.filter(
    (row) => row.revisionKind === 'detailPresentationRevision',
  ).length)), 1);
});

test('browser Wave 1D-A M1 fallback render failure preserves accepted request error authority', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t, {
    requestError: true,
  });
  await page.evaluate((ownerId) => {
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`)?.remove();
    window.__wave1dAM1.armTimelineRenderFailure();
  }, eventId);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.deepEqual({
    acceptedMutation: settlements[0].acceptedMutation,
    settlementOutcome: settlements[0].settlementOutcome,
    presentationErrorStage: settlements[0].presentationErrorStage,
    acceptedStateReclassified: settlements[0].acceptedStateReclassified,
    presentationFailed: settlements[0].presentationFailed,
  }, {
    acceptedMutation: 'error',
    settlementOutcome: 'fullRenderFallback',
    presentationErrorStage: 'fallback',
    acceptedStateReclassified: false,
    presentationFailed: true,
  });
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);

  await page.locator(`#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`).click();
  await page.locator(`#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`).click();
  await page.locator(`#timeline .event[data-event-id="${eventId}"] [data-action="retry-detail"]`).waitFor();
  assert.match(await page.locator(`#timeline .event[data-event-id="${eventId}"]`).innerText(), /controlled request failure/i);
  assert.equal(requests.count, 1);
  assert.equal((await page.evaluate(() => window.__wave1dAM1.evidence.detailRequests.filter(
    (row) => row.presentationSettlement,
  ).length)), 1);
});

test('browser Wave 1D-A M1 focused observer failures cannot interrupt an ordinary body settlement', async (t) => {
  const { page, eventId, gate } = await openWave1dAM1ControlledOrdinaryDetail(t, {
    observerFailuresBeforeRequest: true,
  });
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await page.waitForFunction((ownerId) => {
    const body = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"] > .eventBody`);
    return body && !body.textContent.includes('Loading structured detail');
  }, eventId);
  const settlement = await page.evaluate(() => structuredClone(
    window.__wave1dAM1.evidence.detailRequests.find((row) => row.presentationSettlement),
  ));
  assert.equal(settlement.settlementOutcome, 'bodyPatch');
  assert.equal(settlement.presentationFailed, false);
  assert.equal(await page.evaluate(() => (
    window.__wave1dAM1.evidence.detailRequestTransactionAssociations
  )), 1, 'a throwing installed observer still activates the evidence association');
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
});

test('browser Wave 1D-A M1 unsafe selected Inspector makes the complete transaction one full fallback', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t, {
    inspect: true,
  });
  await page.evaluate(() => document.querySelector('#detail .inspector')?.remove());
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await page.waitForFunction(() => (
    document.querySelector('#detail .inspector')
      && !document.querySelector('#detail').textContent.includes('Loading structured detail')
  ));
  await endWave1cM2Operation(page);

  assert.equal(requests.count, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  assert.ok(causal.detailRequests.filter((row) => row.requestReused).length >= 1);
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1);
  assert.deepEqual({
    settlementOutcome: settlements[0].settlementOutcome,
    presentationErrorStage: settlements[0].presentationErrorStage,
    presentationFailed: settlements[0].presentationFailed,
    acceptedStateReclassified: settlements[0].acceptedStateReclassified,
  }, {
    settlementOutcome: 'fullRenderFallback',
    presentationErrorStage: 'local',
    presentationFailed: false,
    acceptedStateReclassified: false,
  });
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 1);
  assert.equal(await page.locator(`#timeline .event[data-event-id="${eventId}"]`).count(), 1);
});

test('browser Wave 1D-A M1 intentional detail abort produces no accepted mutation or Timeline settlement', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-abort',
    name: 'Wave 1D-A abort fixture',
    description: 'Abort one pending ordinary detail through a Layer transition.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    const control = { count: 0, started: false };
    window.__wave1dAbortControl = control;
    window.fetch = (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!url.pathname.includes('/events/') || !url.pathname.endsWith('/detail')) {
        return nativeFetch(input, init);
      }
      if (control.started) return nativeFetch(input, init);
      control.count += 1;
      control.started = true;
      return new Promise((resolve, reject) => {
        const rejectAbort = () => reject(new DOMException('Synthetic detail abort', 'AbortError'));
        if (init.signal?.aborted) rejectAbort();
        else init.signal?.addEventListener('abort', rejectAbort, { once: true });
      });
    };
  });
  const owner = page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
  await page.evaluate(() => window.__wave1dAM1.reset());
  await owner.locator(':scope > .eventHeader > .eventKind').click();
  await page.waitForFunction(() => window.__wave1dAbortControl.started);
  await waitForDetailView(page, 'inspector');
  await page.locator('#layerSelect').selectOption('protocol');
  await expectInputValue(page, '#layerSelect', 'protocol');
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.phase === 'requestSettled' && row.settlementOutcome === 'abort',
  ));

  assert.equal(await page.evaluate(() => window.__wave1dAbortControl.count), 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const requestSettlement = causal.detailRequests.find((row) => row.phase === 'requestSettled');
  const abortedRequestRows = causal.detailRequests.filter(
    (row) => row.requestSerial === requestSettlement.requestSerial,
  );
  assert.equal(abortedRequestRows.filter((row) => row.requestCreated).length, 1);
  assert.equal(abortedRequestRows.filter((row) => row.phase === 'acceptedMutation').length, 0);
  assert.equal(abortedRequestRows.filter((row) => row.presentationSettlement).length, 0);
  assert.equal(requestSettlement.acceptedMutation, 'none');
  assert.equal(requestSettlement.settlementOutcome, 'abort');
  assert.equal(requestSettlement.acceptedStateReclassified, false);
  assert.equal(causal.detailBodies.filter(
    (row) => row.requestSerial === requestSettlement.requestSerial,
  ).length, 0);
});

test('browser Wave 1D-A M1 stale detail response produces no accepted mutation or Timeline settlement', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-stale',
    name: 'Wave 1D-A stale fixture',
    description: 'Resolve an obsolete background detail after a Session switch.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 200,
    hitPositions: [],
    secondaryEventCount: 40,
  });
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    const control = { count: 0, started: false, release: null };
    window.__wave1dStaleControl = control;
    window.fetch = (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!url.pathname.includes('/events/') || !url.pathname.endsWith('/detail') || control.started) {
        return nativeFetch(input, init);
      }
      control.count += 1;
      control.started = true;
      return new Promise((resolve, reject) => {
        control.release = () => nativeFetch(input, { ...init, signal: undefined }).then(resolve, reject);
      });
    };
  });
  const owner = page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
  await page.evaluate(() => window.__wave1dAM1.reset());
  await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await page.waitForFunction(() => window.__wave1dStaleControl.started);
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 40);
  await page.evaluate(() => window.__wave1dStaleControl.release());
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.phase === 'requestSettled' && row.settlementOutcome === 'stale',
  ));

  assert.equal(await page.evaluate(() => window.__wave1dStaleControl.count), 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const staleRow = causal.detailRequests.find((row) => row.settlementOutcome === 'stale');
  const staleRequestRows = causal.detailRequests.filter((row) => row.requestSerial === staleRow.requestSerial);
  assert.equal(staleRequestRows.filter((row) => row.requestCreated).length, 1);
  assert.equal(staleRequestRows.filter((row) => row.phase === 'acceptedMutation').length, 0);
  assert.equal(staleRequestRows.filter((row) => row.presentationSettlement).length, 0);
  assert.equal(staleRow.acceptedMutation, 'none');
  assert.equal(staleRow.acceptedStateReclassified, false);
  assert.equal(causal.detailBodies.filter((row) => row.requestSerial === staleRow.requestSerial).length, 0);
});

test('browser Wave 1D-A M1 detail-only phrase marks do not invent a canonical navigation target', async (t) => {
  const detailOnlyPhrase = 'detail-only-wave-token';
  const collapsedProfile = {
    id: 'custom:wave-1d-a-detail-only-search',
    name: 'Wave 1D-A detail-only search fixture',
    description: 'Add one visual phrase only when ordinary detail settles.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        const response = await route.fetch();
        const detail = await response.json();
        detail.timelineSections = [{
          type: 'markdown',
          purpose: 'content',
          html: `<p>${detailOnlyPhrase}</p>`,
        }];
        await route.fulfill({
          status: response.status(),
          contentType: 'application/json',
          body: JSON.stringify(detail),
        });
      });
    },
  });
  await installWave1dAM1SearchTracking(page);
  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === detailOnlyPhrase;
  });
  await fillSearch(page, detailOnlyPhrase);
  await searchResponse;
  await assertEventCount(page, 150);
  await waitForNoSearchMarks(page);
  assert.equal(await page.locator('#searchMetricsPanel').getAttribute('data-search-target-ids'), '[]');

  const owner = page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
  const eventId = await owner.getAttribute('data-event-id');
  assert.ok(eventId);
  await page.evaluate(() => window.__wave1dAM1.reset());
  await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  const visualMark = page.locator(
    `#timeline .event[data-event-id="${eventId}"] > .eventBody mark.searchMark`,
  );
  await visualMark.waitFor();
  assert.equal(await visualMark.textContent(), detailOnlyPhrase);
  assert.equal(await visualMark.getAttribute('data-search-target-id'), null);
  assert.equal(await page.locator('#searchMetricsPanel').getAttribute('data-search-target-ids'), '[]');
  assert.equal(await page.evaluate(() => window.__wave1dAM1Search.evidence.latestTargets.length), 0);
  const settlement = await page.evaluate(() => structuredClone(
    window.__wave1dAM1.evidence.detailRequests.find((row) => row.presentationSettlement),
  ));
  assert.equal(settlement.settlementOutcome, 'bodyPatch');
  assert.equal(settlement.acceptedStateReclassified, false);
});

test('browser Wave 1D-A M1 ordinary body phrase removal binds a local excerpt without touching other owners', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-remove-body-phrase',
    name: 'Wave 1D-A phrase removal fixture',
    description: 'Remove the query phrase when ordinary detail replaces its loading body.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 200,
    hitPositions: [],
    commonTermEvery: 1,
  });
  const gate = deferred();
  const started = deferred();
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        started.resolve();
        await gate.promise;
        const response = await route.fetch();
        const detail = await response.json();
        detail.timelineSections = [{
          type: 'markdown',
          purpose: 'content',
          html: '<p>replacement detail without the searched phrase</p>',
        }];
        await route.fulfill({
          status: response.status(),
          contentType: 'application/json',
          body: JSON.stringify(detail),
        });
      });
    },
  });
  await installWave1dAM1SearchTracking(page);
  await fillSearch(page, 'common-term');
  await waitForSearchMarks(page, 5);
  const owner = page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
  const eventId = await owner.getAttribute('data-event-id');
  assert.ok(eventId);
  await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await started.promise;
  const loadingMark = page.locator(
    `#timeline .event[data-event-id="${eventId}"] > .eventBody mark.searchMark`,
  ).first();
  await loadingMark.waitFor();
  await page.evaluate((ownerId) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`);
    window.__wave1dAM1RemovedBodyMark = article.querySelector(':scope > .eventBody mark.searchMark');
    window.__wave1dAM1RemovedBodyTarget = window.__wave1dAM1Search.evidence.latestTargets.find(
      (target) => target.id === window.__wave1dAM1RemovedBodyMark.dataset.searchTargetId,
    );
    window.__wave1dAM1UnrelatedPhraseMark = [...document.querySelectorAll('#timeline mark.searchMark')]
      .find((mark) => !article.contains(mark));
    window.__wave1dAM1.reset();
    window.__wave1dAM1Search.resetOperations();
  }, eventId);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  const marks = await page.evaluate((ownerId) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`);
    return {
      oldBodyMarkDisconnected: !window.__wave1dAM1RemovedBodyMark.isConnected,
      bodyMarkCount: [...article.querySelectorAll(':scope > .eventBody mark.searchMark')]
        .filter((mark) => !mark.closest('.searchSupplement')).length,
      excerptMarkCount: article.querySelectorAll('.searchSupplement:not([hidden]) mark.searchMark').length,
      ownerMarkCount: article.querySelectorAll('mark.searchMark').length,
      targetPreserved: window.__wave1dAM1Search.evidence.latestTargets.includes(
        window.__wave1dAM1RemovedBodyTarget,
      ),
      targetTimelineBindingCount: window.__wave1dAM1RemovedBodyTarget.bindings.timeline.length,
      unrelatedMarkPreserved: window.__wave1dAM1UnrelatedPhraseMark.isConnected,
      resetBindingsCount: window.__wave1dAM1Search.evidence.resetBindingsCount,
      resetSurfaces: window.__wave1dAM1Search.evidence.resetSurfaceRows.map((row) => row.surface),
      clearRoots: [...window.__wave1dAM1Search.evidence.clearRoots],
      applyRoots: [...window.__wave1dAM1Search.evidence.applyRoots],
    };
  }, eventId);
  assert.equal(marks.oldBodyMarkDisconnected, true);
  assert.equal(marks.bodyMarkCount, 0);
  assert.equal(marks.excerptMarkCount, 1);
  assert.equal(marks.ownerMarkCount, 1);
  assert.equal(marks.targetPreserved, true);
  assert.equal(marks.targetTimelineBindingCount, 1);
  assert.equal(marks.unrelatedMarkPreserved, true);
  assert.equal(marks.resetBindingsCount, 0);
  assert.deepEqual(marks.resetSurfaces, ['timeline']);
  assert.deepEqual(marks.clearRoots, ['timelineOwner']);
  assert.deepEqual(marks.applyRoots, ['timelineOwner']);
});

test('browser Wave 1D-A M1 eight accepted ordinary details produce eight request-owned settlements', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-eight',
    name: 'Wave 1D-A eight-detail fixture',
    description: 'Hold eight explicitly expanded ordinary detail requests.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 50, hitPositions: [] });
  const detailGate = deferred();
  const allStarted = deferred();
  let detailRequestCount = 0;
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        detailRequestCount += 1;
        if (detailRequestCount === 8) allStarted.resolve();
        await detailGate.promise;
        await route.continue();
      });
    },
  });
  await page.evaluate(() => window.__wave1dAM1.reset());
  const ownerIds = await page.locator(
    '#timeline .event[data-event-id]:not(.kind-code-mode-operation)',
  ).evaluateAll((events) => events.slice(0, 8).map((event) => event.dataset.eventId));
  assert.equal(ownerIds.length, 8);
  for (const eventId of ownerIds) {
    await page.locator(
      `#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`,
    ).click();
  }
  await allStarted.promise;
  const operationId = await beginWave1cM2Operation(page);
  detailGate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.filter(
    (row) => row.presentationSettlement,
  ).length === 8);
  await endWave1cM2Operation(page);

  assert.equal(detailRequestCount, 8);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const created = causal.detailRequests.filter((row) => row.requestCreated);
  const accepted = causal.detailRequests.filter((row) => row.phase === 'acceptedMutation');
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(created.length, 8);
  assert.equal(accepted.length, 8);
  assert.equal(settlements.length, 8);
  assert.equal(new Set(settlements.map((row) => row.requestSerial)).size, 8);
  assert.ok(settlements.every((row) => row.acceptedMutation === 'success'
    && row.settlementOutcome === 'bodyPatch'
    && row.presentationFailed === false
    && row.acceptedStateReclassified === false));
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 8);
  assert.equal(causal.detailBodies.length, 8);
  assert.equal((await wave1cM2OperationRows(page, operationId)).length, 0);
});

test('browser Wave 1D-A M1 no-DOM outcome completes affected Inspector scope before classification', async (t) => {
  const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t, {
    inspect: true,
  });
  await installWave1dAM1SearchTracking(page);
  await page.locator(
    `#timeline .event[data-event-id="${eventId}"] > .eventHeader > .eventToggle`,
  ).click();
  await page.locator(`#timeline .event[data-event-id="${eventId}"].collapsed`).waitFor();
  await page.evaluate((ownerId) => {
    window.__wave1dAM1NoDomInspectorArticle = document.querySelector(
      `#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`,
    );
    window.__wave1dAM1Search.resetOperations();
  }, eventId);
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await page.waitForFunction(() => (
    document.querySelector('#detail .inspector')
      && !document.querySelector('#detail').textContent.includes('Loading structured detail')
  ));
  await endWave1cM2Operation(page);

  assert.equal(requests.count, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlement = causal.detailRequests.find((row) => row.presentationSettlement);
  assert.equal(settlement.settlementOutcome, 'noDomAdoption');
  assert.equal(settlement.presentationFailed, false);
  assert.equal((await wave1cM2OperationRows(page, operationId)).length, 0);
  const scoped = await page.evaluate(() => ({
    articlePreserved: window.__wave1dAM1NoDomInspectorArticle.isConnected,
    timelineBodyCount: window.__wave1dAM1NoDomInspectorArticle.querySelectorAll(
      ':scope > .eventBody',
    ).length,
    resetBindingsCount: window.__wave1dAM1Search.evidence.resetBindingsCount,
    clearRoots: [...window.__wave1dAM1Search.evidence.clearRoots],
    applyRoots: [...window.__wave1dAM1Search.evidence.applyRoots],
  }));
  assert.deepEqual(scoped, {
    articlePreserved: true,
    timelineBodyCount: 0,
    resetBindingsCount: 0,
    clearRoots: ['inspectorOwner'],
    applyRoots: [],
  });
});

for (const ownerFault of ['duplicate-body', 'disconnected-article']) {
  test(`browser Wave 1D-A M1 ${ownerFault} fails closed to one full fallback`, async (t) => {
    const { page, eventId, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t);
    await page.evaluate(({ ownerId, fault }) => {
      const article = document.querySelector(
        `#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`,
      );
      if (fault === 'duplicate-body') {
        const body = article.querySelector(':scope > .eventBody');
        body.after(body.cloneNode(true));
      } else {
        article.remove();
      }
    }, { ownerId: eventId, fault: ownerFault });
    const operationId = await beginWave1cM2Operation(page);
    gate.resolve();
    await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
      (row) => row.presentationSettlement,
    ));
    await page.locator(`#timeline .event[data-event-id="${eventId}"]`).waitFor();
    await endWave1cM2Operation(page);

    assert.equal(requests.count, 1);
    const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
    const settlement = causal.detailRequests.find((row) => row.presentationSettlement);
    assert.equal(settlement.settlementOutcome, 'fullRenderFallback');
    assert.equal(settlement.presentationFailed, false);
    assert.equal(settlement.acceptedStateReclassified, false);
    assert.equal((await wave1cM2OperationRows(page, operationId))
      .filter((row) => row.commitKind === 'replacement').length, 1);
  });
}

test('browser Wave 1D-A M1 stale context-slot ownership fails closed to one full fallback', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1d-a-context-slot',
    name: 'Wave 1D-A context-slot fixture',
    description: 'Corrupt one ordinary owner context-slot relation before settlement.',
    rules: {
      fallback: 'collapsed',
      kindStates: { code_mode_operation: 'hidden' },
      conditions: [],
    },
  };
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 50,
    hitPositions: [],
    includeContextReveal: true,
    contextRevealIndex: 0,
  });
  const session = await materializeIndexedSession(index, fixture.longSessionId);
  const nested = session.logicalEvents.find((event) => (
    event.toolName === fixture.contextReveal.toolName
  ));
  assert.ok(nested);
  assert.notEqual(nested.kind, 'code_mode_operation');
  const codeMode = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  assert.ok(codeMode);
  const gate = deferred();
  const started = deferred();
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname !== `/api/sessions/${encodeURIComponent(session.id)}/events/${encodeURIComponent(nested.id)}/detail`) {
          await route.continue();
          return;
        }
        started.resolve();
        await gate.promise;
        await route.continue();
      });
    },
  });
  const owner = page.locator(`#timeline .event[data-event-id="${nested.id}"]`);
  await owner.waitFor();
  // The visible context slot hydrates its Code Mode owner during startup even
  // though that owner's card is hidden. Its fallback must settle before the
  // target request's corruption/measurement window starts.
  await page.waitForFunction((eventId) => {
    const { detailTransactions, detailRequests } = window.__wave1dAM1.evidence;
    const transaction = detailTransactions.find((row) => row.eventId === eventId);
    return transaction && detailRequests.some((row) => (
      row.requestSerial === transaction.requestSerial && row.presentationSettlement
    ));
  }, codeMode.id);
  await page.evaluate(() => window.__wave1dAM1.reset());
  await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await started.promise;
  const transaction = await page.evaluate((eventId) => (
    window.__wave1dAM1.evidence.detailTransactions.find((row) => row.eventId === eventId)
  ), nested.id);
  assert.ok(transaction);
  await page.evaluate((ownerId) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`);
    const slot = article.previousElementSibling;
    if (!slot?.classList.contains('contextRevealSlot')) throw new Error('expected context slot');
    article.parentElement.append(slot);
  }, nested.id);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction((serial) => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.requestSerial === serial && row.presentationSettlement,
  ), transaction.requestSerial);
  await endWave1cM2Operation(page);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlements = causal.detailRequests.filter((row) => row.presentationSettlement);
  assert.equal(settlements.length, 1, JSON.stringify(causal));
  const [settlement] = settlements;
  assert.equal(settlement.requestSerial, transaction.requestSerial);
  assert.deepEqual(causal.detailTransactions, [transaction]);
  assert.equal(settlement.settlementOutcome, 'fullRenderFallback');
  assert.equal(settlement.presentationFailed, false);
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 1, JSON.stringify({ target: nested.id, causal }));
});

test('browser Wave 1D-A M1 another presentation revision between detail tokens forces full fallback', async (t) => {
  const { page, gate, requests } = await openWave1dAM1ControlledOrdinaryDetail(t);
  await page.evaluate(() => {
    const observer = window.__sessionAnalyzerTimelineLifecycleObserver;
    let injected = false;
    window.__sessionAnalyzerTimelineLifecycleObserver = {
      ...observer,
      recordRevision(value) {
        observer.recordRevision(value);
        if (!injected && value.revisionKind === 'detailPresentationRevision') {
          injected = true;
          document.querySelector('#resetFoldsBtn').click();
        }
      },
    };
  });
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await endWave1cM2Operation(page);

  assert.equal(requests.count, 1);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlement = causal.detailRequests.find((row) => row.presentationSettlement);
  assert.equal(settlement.settlementOutcome, 'fullRenderFallback');
  assert.equal(settlement.presentationFailed, false);
  assert.equal(settlement.acceptedStateReclassified, false);
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 1);
  assert.equal(causal.revisions.filter((row) => row.revisionKind === 'overridesRevision').length, 2,
    'the initial expansion and injected reset each own one override revision');
  assert.equal(causal.lifecycle.filter((row) => row.operation === 'adopt').length, 0);
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 2,
  'the concurrent override render and request-owned fallback remain distinct');
});

for (const retrySurface of ['timeline', 'inspector']) {
  test(`browser Wave 1D-A M1 ${retrySurface} retry revision remains fail-closed`, async (t) => {
    const collapsedProfile = {
      id: `custom:wave-1d-a-${retrySurface}-retry`,
      name: 'Wave 1D-A retry fixture',
      description: 'Make one accepted error precede an explicit retry.',
      rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
    };
    const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
    let detailRequestCount = 0;
    const { page } = await openWave1dAM1App(t, index, {
      locale: 'en',
      localStorage: {
        'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
        'sessionAnalyzer.profile': collapsedProfile.id,
      },
      beforeGoto: async (targetPage) => {
        await targetPage.route('**/api/sessions/*/events/*/detail?*', async (route) => {
          detailRequestCount += 1;
          if (detailRequestCount === 1) {
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Synthetic retry precursor' }),
            });
          } else {
            await route.continue();
          }
        });
      },
    });
    const owner = page.locator('#timeline .event[data-event-id]:not(.kind-code-mode-operation)').first();
    const eventId = await owner.getAttribute('data-event-id');
    assert.ok(eventId);
    if (retrySurface === 'inspector') {
      await owner.locator(':scope > .eventHeader > .eventKind').click();
      await page.locator('#detail [data-detail-action="retry-detail"]').waitFor();
    } else {
      await owner.locator(':scope > .eventHeader > .eventToggle').click();
      await page.locator(
        `#timeline .event[data-event-id="${eventId}"] [data-action="retry-detail"]`,
      ).waitFor();
    }
    assert.equal(detailRequestCount, 1);
    await page.evaluate(() => window.__wave1dAM1.reset());
    const operationId = await beginWave1cM2Operation(page);
    if (retrySurface === 'inspector') {
      await page.locator('#detail [data-detail-action="retry-detail"]').click();
    } else {
      await page.locator(
        `#timeline .event[data-event-id="${eventId}"] [data-action="retry-detail"]`,
      ).click();
    }
    await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
      (row) => row.presentationSettlement,
    ));
    await endWave1cM2Operation(page);

    assert.equal(detailRequestCount, 2);
    const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
    const settlement = causal.detailRequests.find((row) => row.presentationSettlement);
    assert.equal(settlement.acceptedMutation, 'success');
    assert.equal(settlement.settlementOutcome, 'fullRenderFallback');
    assert.equal(settlement.presentationFailed, false);
    assert.equal(settlement.acceptedStateReclassified, false);
    assert.equal(causal.revisions.filter((row) => row.revisionKind === 'detailPresentationRevision').length, 2);
    assert.equal(causal.lifecycle.filter((row) => row.operation === 'adopt').length, 0);
    assert.equal((await wave1cM2OperationRows(page, operationId))
      .filter((row) => row.commitKind === 'replacement').length, 1);
    assert.equal(await page.locator(
      retrySurface === 'inspector'
        ? '#detail [data-detail-action="retry-detail"]'
        : `#timeline .event[data-event-id="${eventId}"] [data-action="retry-detail"]`,
    ).count(), 0);
  });
}

test('browser Wave 1D-A M1 visible-detail scheduling keeps candidate-first geometry across every trigger', async (t) => {
  const hiddenProfile = {
    id: 'custom:wave-1d-a-hidden-scan',
    name: 'Wave 1D-A hidden scan fixture',
    description: 'Keep non-candidates mounted but hidden before geometry.',
    rules: { fallback: 'hidden', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenProfile]),
      'sessionAnalyzer.profile': hiddenProfile.id,
    },
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__wave1dAM1.reset());

  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForFunction(() => window.__wave1dAM1.evidence.visibleScans.length >= 1);
  await page.evaluate(() => document.querySelector('.timelinePane').dispatchEvent(new Event('scroll')));
  await page.waitForFunction(() => window.__wave1dAM1.evidence.visibleScans.length >= 2);
  await page.evaluate(() => document.querySelector('[data-mobile-view="events"]').click());
  await page.waitForFunction(() => window.__wave1dAM1.evidence.visibleScans.length >= 3);

  await page.evaluate(() => {
    document.querySelector(
      '#timeline .event[data-event-id]:not(.kind-code-mode-operation) > .eventHeader > .eventToggle',
    ).click();
  });
  await page.waitForFunction(() => window.__wave1dAM1.evidence.visibleScans.length >= 4);
  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 200);
  await page.waitForFunction(() => window.__wave1dAM1.evidence.visibleScans.some(
    (scan) => scan.mountedArticleCount === 200,
  ));

  const scans = await page.evaluate(() => structuredClone(
    window.__wave1dAM1.evidence.visibleScans,
  ));
  assert.ok(scans.length >= 5);
  for (const scan of scans) {
    assert.equal(scan.articleGeometryReadCount, scan.candidateArticleCount);
    assert.equal(scan.scrollportGeometryReadCount, 1);
    assert.ok(scan.candidateArticleCount < scan.mountedArticleCount);
  }
  assert.ok(scans.slice(0, 3).every((scan) => scan.mountedArticleCount === 150
    && scan.candidateArticleCount === 0
    && scan.articleGeometryReadCount === 0));
  const expandedScan = scans.slice(3).find((scan) => (
    scan.mountedArticleCount === 150 && scan.candidateArticleCount === 1
  ));
  assert.ok(expandedScan);
  assert.equal(expandedScan.articleGeometryReadCount, 1);
  const appendScan = scans.find((scan) => scan.mountedArticleCount === 200);
  assert.ok(appendScan);
  assert.equal(appendScan.candidateArticleCount, 1);
  assert.equal(appendScan.articleGeometryReadCount, 1);
});

test('mobile document scrolling hydrates automatically expanded visible details without pagination', { timeout: 30000 }, async (t) => {
  const expandedProfile = {
    id: 'custom:mobile-visible-details',
    name: 'Mobile visible details fixture',
    description: 'Automatically expand ordinary events before they enter the viewport.',
    rules: { fallback: 'expanded', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [] });
  const { page, requestedPaths } = await openWave1dAM1App(t, index, {
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    activeSessionState: 'attached',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([expandedProfile]),
      'sessionAnalyzer.profile': expandedProfile.id,
    },
  });
  await page.locator('.mobileViewTab[data-mobile-view="events"]').click();
  await page.waitForLoadState('networkidle');
  const target = page.locator('#timeline .event[data-event-id]').nth(149);
  const eventId = await target.getAttribute('data-event-id');
  assert.ok(await target.evaluate((node) => node.classList.contains('expanded')
    && node.getBoundingClientRect().top > innerHeight));
  assert.match(await target.locator('.eventBody').innerText(), /结构化详情加载中/);
  const timelineRequestsBefore = requestedPaths.filter((pathname) => pathname.endsWith('/timeline')).length;
  const gate = deferred();
  const started = deferred();
  t.after(() => gate.resolve());
  let detailRequests = 0;
  await page.route('**/api/sessions/*/events/*/detail?*', async (route) => {
    if (decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)) !== eventId) {
      await route.continue();
      return;
    }
    detailRequests += 1;
    started.resolve();
    await gate.promise;
    await route.continue().catch(() => {});
  });
  await page.evaluate(() => window.__wave1dAM1.reset());
  await target.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  assert.ok(await page.evaluate(() => window.scrollY > 1000));
  assert.equal(await page.locator('.timelinePane').evaluate((node) => node.scrollTop), 0);
  await page.waitForFunction((id) => window.__wave1dAM1.evidence.detailTransactions.some(
    (row) => row.eventId === id,
  ), eventId, { timeout: 3000 });
  await started.promise;
  const scanCount = await page.evaluate(() => window.__wave1dAM1.evidence.visibleScans.length);
  await page.evaluate(() => window.scrollBy(0, -1));
  await page.waitForFunction((count) => window.__wave1dAM1.evidence.visibleScans.length > count, scanCount);
  assert.equal(detailRequests, 1, 'repeated document scrolls share the pending detail request');
  assert.equal(await page.evaluate(() => document.querySelector('#timeline').contains(document.activeElement)), false);
  const scrollYBeforeSettlement = await page.evaluate(() => window.scrollY);
  gate.resolve();
  await page.waitForFunction((id) => {
    const evidence = window.__wave1dAM1.evidence;
    const transaction = evidence.detailTransactions.find((row) => row.eventId === id);
    return evidence.detailRequests.some((row) => row.requestSerial === transaction?.requestSerial
      && row.presentationSettlement);
  }, eventId);
  assert.equal(await page.evaluate(() => window.scrollY), scrollYBeforeSettlement,
    'focus outside the Timeline retains absolute document scroll during detail settlement');
  assert.doesNotMatch(await target.locator('.eventBody').innerText(), /结构化详情加载中/);
  assert.match(await target.locator('.eventBody').innerText(), /Synthetic timeline event 0149/);
  assert.equal(await target.evaluate((node) => node.classList.contains('expanded')), true);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150);
  assert.equal(requestedPaths.filter((pathname) => pathname.endsWith('/timeline')).length, timelineRequestsBefore);
  const evidence = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const transaction = evidence.detailTransactions.find((row) => row.eventId === eventId);
  assert.equal(evidence.detailRequests.filter((row) => row.requestSerial === transaction.requestSerial
    && row.presentationSettlement).length, 1);
  for (const scan of evidence.visibleScans) {
    assert.equal(scan.articleGeometryReadCount, scan.candidateArticleCount);
    assert.equal(scan.scrollportGeometryReadCount, 1);
  }

  for (const view of ['sessions', 'detail']) {
    await page.locator(`.mobileViewTab[data-mobile-view="${view}"]`).click();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.__wave1dAM1.reset());
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.__wave1dAM1.evidence.visibleScans.length), 0,
      `document scrolling does not scan the hidden mobile Timeline in ${view}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.__wave1dAM1.reset());
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.__wave1dAM1.evidence.visibleScans.length), 0,
    'desktop document scrolling leaves detail loading to the Timeline pane');
});

test('browser Wave 1D-A M1 query, profile, and locale transitions remain full-render controls', async (t) => {
  const firstProfile = {
    id: 'custom:wave-1d-a-control-one',
    name: 'Wave 1D-A control one',
    description: 'First collapsed full-render control.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const secondProfile = {
    id: 'custom:wave-1d-a-control-two',
    name: 'Wave 1D-A control two',
    description: 'Second collapsed full-render control.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 200,
    hitPositions: [],
    commonTermEvery: 1,
  });
  const { page } = await openWave1dAM1App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([firstProfile, secondProfile]),
      'sessionAnalyzer.profile': firstProfile.id,
    },
  });

  let operationId = await beginWave1cM2Operation(page);
  await page.evaluate((profileId) => {
    const select = document.querySelector('#profileSelect');
    select.value = profileId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, secondProfile.id);
  await expectInputValue(page, '#profileSelect', secondProfile.id);
  let rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 1);

  operationId = await beginWave1cM2Operation(page);
  const queryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'common-term';
  });
  await fillSearch(page, 'common-term');
  await queryResponse;
  rows = await settledWave1cM2OperationRows(page, operationId);
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);
  assert.ok(rows.some((row) => row.commitKind === 'replacement'));

  operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => {
    window.__wave1dAM1LocaleOldArticle = document.querySelector(
      '#timeline .event[data-event-id]',
    );
  });
  const localeResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('locale') === 'zh-CN';
  });
  await switchHiddenLocale(page, 'zh-CN');
  await localeResponse;
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.waitForFunction(() => (
    window.__wave1dAM1LocaleOldArticle
      && !window.__wave1dAM1LocaleOldArticle.isConnected
      && document.querySelectorAll('#timeline .event[data-event-id]').length > 0
  ));
  rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);
  assert.ok(rows.some((row) => ['replacement', 'clear', 'initialMount'].includes(row.commitKind)));
});
