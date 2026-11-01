'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');

const {
  repoRoot,
  installWave1bM2SourceBundle,
  deferred,
  buildFixtureIndex,
  materializeIndexedSession,
  openApp,
  openWave1cM1App,
  openWave1cM2App,
  beginWave1cM2Operation,
  wave1cM2OperationRows,
  settledWave1cM2OperationRows,
  latestWave1cM1Lifecycle,
  switchHiddenLocale,
  selectPrimarySession,
  assertEventCount,
  fillSearch,
  addSearchFilter,
  clearAllSearch,
  switchToProjectScope,
  waitForSearchMarks,
  makeTransitionProfileIndex,
  makeContextCodeModeCodexHome,
} = require('./browser-helpers');

async function installWave1cM1FailingObserver(page) {
  await page.addInitScript(() => {
    const evidence = {
      lifecycle: [],
      revisions: [],
    };
    window.__wave1cM1FailingObserver = evidence;
    window.__sessionAnalyzerTimelineLifecycleObserver = {
      recordRevision(value) {
        evidence.revisions.push(structuredClone(value));
        throw new Error('synthetic recordRevision observer failure');
      },
      recordLifecycle(value) {
        evidence.lifecycle.push(structuredClone(value));
        throw new Error('synthetic recordLifecycle observer failure');
      },
    };
  });
}

test('browser Wave 1C M1 production lifecycle reconciles Main renders and retires every non-Main root', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openWave1cM1App(t, index, { locale: 'en', skipProjectReindex: true });
  await selectPrimarySession(page);

  const initial = await page.evaluate(() => structuredClone(
    window.__wave1cM1.evidence.lifecycle.findLast((row) => (
      row.operation === 'replace' && row.mode === 'main'
    )),
  ));
  const initialCardCount = await page.locator('#timeline .event[data-event-id]').count();
  assert.equal(initial.mode, 'main');
  assert.equal(initial.ownerCount, initialCardCount);
  assert.equal(initial.createdOwnerCount + initial.reusedOwnerCount, initialCardCount);
  assert.deepEqual(Object.keys(initial.mountedPresentationToken).sort(), [
    'valid',
    'localePresentationRevision',
    'foldingPresentationRevision',
    'overridesRevision',
    'navigationRevealRevision',
    'searchTransientRevision',
    'temporaryRevealRevision',
    'detailPresentationRevision',
  ].sort(), 'mounted compatibility is a fixed-width scalar snapshot');

  const held = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    const index = cards.findIndex((card) => card.classList.contains('kind-command')
      && !card.classList.contains('expanded'));
    if (index < 0) throw new Error('expected a collapsed command card');
    window.__wave1cM1HeldArticle = cards[index];
    return { index };
  });
  const initialOwnerSerial = initial.ownerSerials[held.index];
  await page.evaluate(() => window.__wave1cM1.reset());
  await page.locator('#timeline .event[data-event-id]').nth(held.index).locator('[data-action="toggle"]').click();
  await page.waitForFunction(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'overridesRevision',
  ));
  await page.waitForFunction(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'detailPresentationRevision',
  ));
  const sameContext = await latestWave1cM1Lifecycle(page);
  assert.equal(sameContext.operation, 'adopt');
  assert.equal(sameContext.mode, 'main');
  assert.equal(sameContext.ownerCount, initialCardCount);
  assert.equal(sameContext.ownerSerials[held.index], initialOwnerSerial);
  assert.ok(sameContext.mountedPresentationToken.overridesRevision
    > initial.mountedPresentationToken.overridesRevision);
  assert.ok(sameContext.mountedPresentationToken.detailPresentationRevision
    > initial.mountedPresentationToken.detailPresentationRevision);
  assert.equal(await page.evaluate(() => window.__wave1cM1HeldArticle.isConnected), false);
  assert.equal(await page.evaluate((index) => (
    window.__wave1cM1HeldArticle === document.querySelectorAll('#timeline .event[data-event-id]')[index]
  ), held.index), false);

  await page.evaluate(() => window.__wave1cM1.reset());
  const nextProfile = await page.locator('#profileSelect option').evaluateAll((options) => {
    const select = document.querySelector('#profileSelect');
    return options.find((option) => option.value && option.value !== select.value)?.value || '';
  });
  assert.ok(nextProfile);
  await page.evaluate((profileId) => {
    const select = document.querySelector('#profileSelect');
    select.value = profileId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, nextProfile);
  await page.waitForFunction(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'foldingPresentationRevision',
  ));
  await page.waitForFunction(() => window.__wave1cM1.evidence.lifecycle.at(-1)
    ?.mountedPresentationToken.foldingPresentationRevision > 0);

  await page.locator('#layerSelect').selectOption('protocol');
  await page.waitForFunction(() => {
    const latest = window.__wave1cM1.evidence.lifecycle.at(-1);
    return document.querySelector('#layerSelect')?.value === 'protocol'
      && latest?.mode === 'non-main' && latest.ownerCount === 0;
  });
  await page.locator('#layerSelect').selectOption('raw');
  await page.waitForFunction(() => {
    const latest = window.__wave1cM1.evidence.lifecycle.at(-1);
    return document.querySelector('#layerSelect')?.value === 'raw'
      && latest?.mode === 'non-main' && latest.ownerCount === 0;
  });
  await page.locator('#layerSelect').selectOption('main');
  await page.waitForFunction(() => {
    const latest = window.__wave1cM1.evidence.lifecycle.at(-1);
    return document.querySelector('#layerSelect')?.value === 'main'
      && latest?.mode === 'main' && latest.ownerCount > 0;
  });
  const beforeProject = await latestWave1cM1Lifecycle(page);

  await switchToProjectScope(page);
  await page.waitForFunction(() => {
    const latest = window.__wave1cM1.evidence.lifecycle.at(-1);
    return latest?.mode === 'non-main' && latest.ownerCount === 0;
  });
  await page.locator('#searchHudScope').click();
  await page.locator('#searchAssist').getByRole('button', { name: 'Current session' }).click();
  await page.waitForFunction(() => {
    const latest = window.__wave1cM1.evidence.lifecycle.at(-1);
    return document.body.dataset.searchScope === 'session'
      && latest?.mode === 'main' && latest.ownerCount > 0;
  });
  const afterProject = await latestWave1cM1Lifecycle(page);
  assert.notEqual(afterProject.ownerSerials[0], beforeProject.ownerSerials[0]);
  assert.equal(afterProject.ownerCount, await page.locator('#timeline .event[data-event-id]').count());

  await page.evaluate(() => window.__wave1cM1.reset());
  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'localePresentationRevision',
  ));
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const latest = window.__wave1cM1.evidence.lifecycle.at(-1);
    return latest?.mode === 'main'
      && latest.mountedPresentationToken?.localePresentationRevision > 0;
  });
  const localized = await latestWave1cM1Lifecycle(page);
  assert.ok(localized.mountedPresentationToken.localePresentationRevision > 0);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => {
    const latest = window.__wave1cM1.evidence.lifecycle.at(-1);
    return document.body.dataset.projectMode === 'selecting'
      && latest?.mode === 'non-main' && latest.ownerCount === 0;
  });
});

test('browser Wave 1C M1 canonical-context changes reject colliding-ID owner reuse across repeated Session switches', { timeout: 60000 }, async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 320, secondaryEventCount: 40 });
  const { page } = await openWave1cM1App(t, index, { locale: 'en' });
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  const collisionId = await page.locator('#timeline .event[data-event-id]').first().getAttribute('data-event-id');
  assert.ok(collisionId);
  const detailGate = deferred();
  const detailStarted = deferred();
  t.after(() => detailGate.resolve());
  await page.route(`**/api/sessions/${fixture.secondarySessionId}/events/*/detail*`, async (route) => {
    let response;
    try { response = await route.fetch({ timeout: 30000 }); }
    catch (error) {
      detailStarted.resolve({ error });
      await route.abort();
      return;
    }
    detailStarted.resolve({});
    await detailGate.promise;
    await route.fulfill({ response });
  });
  await page.route(`**/api/sessions/${fixture.secondarySessionId}/timeline*`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.events?.length) body.events[0] = { ...body.events[0], id: collisionId };
    await route.fulfill({ response, json: body });
  });

  const waitForReplacement = async (sessionId, lifecycleStart, previousContextSerial) => {
    const replacement = await page.waitForFunction(({ sessionId, lifecycleStart, previousContextSerial, collisionId }) => {
      const rows = window.__wave1cM1.evidence.lifecycle;
      // Detail settlement can publish an adopt after the replacement. Capture
      // the first new-context Main replacement, rather than the latest operation.
      const snapshot = rows.slice(lifecycleStart).find((row) => row.operation === 'replace'
        && row.mode === 'main' && row.ownerCount > 0
        && row.mountedCanonicalContextSerial !== previousContextSerial);
      const mounted = rows.at(-1);
      const cards = document.querySelectorAll('#timeline .event[data-event-id]');
      const retired = window.__wave1cM1RetiredArticles.at(-1);
      if (document.querySelector('.sessionItem.active')?.dataset.sessionId !== sessionId
          || !snapshot || mounted.mountedCanonicalContextSerial !== snapshot.mountedCanonicalContextSerial
          || cards.length !== snapshot.ownerCount || cards[0]?.dataset.eventId !== collisionId
          || !retired || retired.isConnected
          || !snapshot.ownerSerials.every((serial, index) => mounted.ownerSerials[index] === serial)) return null;
      return structuredClone(snapshot);
    }, { sessionId, lifecycleStart, previousContextSerial, collisionId });
    try { return await replacement.jsonValue(); }
    finally { await replacement.dispose(); }
  };

  const initial = await latestWave1cM1Lifecycle(page);
  const initialOwnerSerial = initial.ownerSerials[0];
  await page.evaluate(() => {
    window.__wave1cM1RetiredArticles = [document.querySelector('#timeline .event[data-event-id]')];
    window.__wave1cM1.reset();
  });
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('No secondary Session detail response became ready within 30 seconds')), 30000);
    detailStarted.promise.then(({ error }) => {
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve();
    });
  });
  const secondaryMount = await waitForReplacement(fixture.secondarySessionId, 0, initial.mountedCanonicalContextSerial);
  const adoptionStart = await page.evaluate(() => window.__wave1cM1.evidence.lifecycle.length);
  detailGate.resolve();
  // Exercise the legal late-detail ordering before selecting replacement evidence.
  await page.waitForFunction(({ start, serial }) => window.__wave1cM1.evidence.lifecycle.slice(start)
    .some((row) => row.operation === 'adopt' && row.mountedCanonicalContextSerial === serial),
  { start: adoptionStart, serial: secondaryMount.mountedCanonicalContextSerial });
  const secondary = await waitForReplacement(fixture.secondarySessionId, 0, initial.mountedCanonicalContextSerial);
  assert.equal(secondary.sameCanonicalContext, false);
  assert.notEqual(secondary.ownerSerials[0], initialOwnerSerial);
  assert.equal(await page.evaluate(() => window.__wave1cM1RetiredArticles[0].isConnected), false);

  let previous = secondary;
  for (const sessionId of [fixture.longSessionId, fixture.secondarySessionId, fixture.longSessionId]) {
    const lifecycleStart = await page.evaluate(() => {
      window.__wave1cM1RetiredArticles.push(document.querySelector('#timeline .event[data-event-id]'));
      return window.__wave1cM1.evidence.lifecycle.length;
    });
    await page.locator(`[data-session-id="${sessionId}"]`).click();
    await page.waitForSelector(`[data-session-id="${sessionId}"].active`);
    const snapshot = await waitForReplacement(sessionId, lifecycleStart, previous.mountedCanonicalContextSerial);
    assert.equal(snapshot.sameCanonicalContext, false);
    assert.equal(snapshot.reusedOwnerCount, 0);
    assert.equal(snapshot.ownerSerials.some((serial) => previous.ownerSerials.includes(serial)), false);
    assert.equal(snapshot.ownerCount, await page.locator('#timeline .event[data-event-id]').count());
    assert.ok(snapshot.ownerCount <= 150, 'owner count must describe only the current Session mount');
    previous = snapshot;
  }
  assert.equal(await page.evaluate(() => window.__wave1cM1RetiredArticles.every((node) => !node.isConnected)), true);
});

test('browser Wave 1C M1 empty Session rendering and project reset keep the Main owner registry empty', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openWave1cM1App(t, index, {
    locale: 'en',
    expectTimeline: false,
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/timeline*', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({
          response,
          json: {
            ...body,
            events: [],
            total: 0,
            searchMatchCount: 0,
            searchEventCount: 0,
          },
        });
      });
    },
  });
  await page.waitForFunction(() => window.__wave1cM1.evidence.lifecycle.length > 0);
  const empty = await latestWave1cM1Lifecycle(page);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);
  assert.equal(empty.mode, 'non-main');
  assert.equal(empty.ownerCount, 0);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => (
    document.body.dataset.projectMode === 'selecting'
      && window.__wave1cM1.evidence.lifecycle.at(-1)?.ownerCount === 0
  ));
});

test('browser Wave 1C M2 manual Main append preserves prefix presentation through one atomic append', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-collapsed',
    name: 'Wave 1C collapsed fixture',
    description: 'Keep unrelated visible owners from requesting detail during the append identity assertion.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 320,
    detailHeavyPositions: [100],
  });
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  await assertEventCount(page, 150);
  const detailCard = page.locator('#timeline .event[data-event-id]').nth(100);
  const detailEventId = await detailCard.getAttribute('data-event-id');
  const detailResponse = page.waitForResponse((response) => (
    decodeURIComponent(new URL(response.url()).pathname).endsWith(`/events/${detailEventId}/detail`)
      && response.ok()
  ));
  await detailCard.click();
  await detailResponse;
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return card?.classList.contains('selected')
      && card.classList.contains('expanded')
      && card.querySelector('.eventBody')
      && !card.textContent.includes('Loading structured detail');
  }, detailEventId);

  await page.evaluate((eventId) => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    const selectedArticle = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    const focusedControl = selectedArticle.querySelector('.eventToggle');
    focusedControl.focus();
    const pane = document.querySelector('.timelinePane');
    pane.scrollTop = Math.max(1, Math.min(5000, pane.scrollHeight - pane.clientHeight));
    window.__wave1cM2Manual = {
      prefixCards: cards,
      prefixById: new Map(cards.map((card) => [card.dataset.eventId, card])),
      selectedArticle,
      detailBody: selectedArticle.querySelector('.eventBody'),
      focusedControl,
      scrollTop: pane.scrollTop,
    };
    window.__wave1cM1.reset();
  }, detailEventId);
  const operationId = await beginWave1cM2Operation(page);

  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await assertEventCount(page, 300);
  const rows = await wave1cM2OperationRows(page, operationId);
  const identity = await page.evaluate(() => {
    const before = window.__wave1cM2Manual;
    const afterCards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    const pane = document.querySelector('.timelinePane');
    return {
      preserved: before.prefixCards.filter((card) => (
        card.isConnected && before.prefixById.get(card.dataset.eventId) === card
          && document.querySelector(`#timeline .event[data-event-id="${CSS.escape(card.dataset.eventId)}"]`) === card
      )).length,
      prefixCount: before.prefixCards.length,
      newCount: afterCards.filter((card) => !before.prefixCards.includes(card)).length,
      focusPreserved: document.activeElement === before.focusedControl,
      selectionPreserved: before.selectedArticle.isConnected
        && before.selectedArticle.classList.contains('selected'),
      detailPreserved: before.detailBody.isConnected
        && before.selectedArticle.querySelector('.eventBody') === before.detailBody,
      scrollTop: pane.scrollTop,
      beforeScrollTop: before.scrollTop,
    };
  });
  assert.deepEqual(identity, {
    preserved: 150,
    prefixCount: 150,
    newCount: 150,
    focusPreserved: true,
    selectionPreserved: true,
    detailPreserved: true,
    scrollTop: identity.beforeScrollTop,
    beforeScrollTop: identity.beforeScrollTop,
  });
  assert.ok(identity.beforeScrollTop > 0);
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 1);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 0);
  assert.deepEqual(rows.filter((row) => row.commitKind === 'appendOnly').map((row) => ({
    pre: row.preCanonicalCount,
    added: row.addedCanonicalCount,
    removed: row.removedCanonicalCount,
    final: row.finalCanonicalCount,
  })), [{ pre: 150, added: 150, removed: 0, final: 300 }]);
  const lifecycle = await page.evaluate(() => structuredClone(
    window.__wave1cM1.evidence.lifecycle.find((item) => (
      item.operation === 'append' && item.ownerCount === 300
    )),
  ));
  assert.equal(lifecycle.createdOwnerCount, 150);
});

test('browser Wave 1C M2 append preserves the active prefix context reveal slot and row', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-context-collapsed',
    name: 'Wave 1C context collapsed fixture',
    description: 'Keep context append presentation stable.',
    rules: { fallback: 'collapsed', kindStates: { code_mode_operation: 'hidden' }, conditions: [] },
  };
  const fixture = await makeContextCodeModeCodexHome(t, { extraMessageCount: 320 });
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.toolName === 'nested-context-token');
  assert.ok(operation && nested);
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
      'sessionAnalyzer.overrides': JSON.stringify({
        [fixture.sessionId]: { [operation.id]: 'hidden' },
      }),
    },
  });
  const nestedCard = page.locator(`#timeline .event[data-event-id="${nested.id}"]`);
  await nestedCard.click();
  const affordance = nestedCard.locator('[data-action="reveal-context-parent"]');
  await affordance.waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction((eventId) => {
    const button = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] [data-action="reveal-context-parent"]`);
    return button && !button.disabled;
  }, nested.id);
  await affordance.click();
  await page.waitForSelector('.contextRevealRow');
  await page.waitForLoadState('networkidle');
  await page.evaluate((eventId) => {
    const slot = document.querySelector(`.contextRevealSlot[data-context-source-id="${CSS.escape(eventId)}"]`);
    window.__wave1cM2Context = {
      article: document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`),
      slot,
      rowChild: slot.firstElementChild,
    };
  }, nested.id);
  const operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await assertEventCount(page, 300);
  const rows = await wave1cM2OperationRows(page, operationId);
  assert.deepEqual(await page.evaluate(() => {
    const held = window.__wave1cM2Context;
    return {
      article: held.article.isConnected
        && document.querySelector(`#timeline .event[data-event-id="${CSS.escape(held.article.dataset.eventId)}"]`) === held.article,
      slot: held.slot.isConnected && held.slot.classList.contains('contextRevealRow'),
      rowChild: held.rowChild.isConnected && held.slot.firstElementChild === held.rowChild,
      rowCount: document.querySelectorAll('.contextRevealRow').length,
    };
  }), { article: true, slot: true, rowChild: true, rowCount: 1 });
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 1);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 0);
});

test('browser Wave 1C M2 suffix search discovery preserves prefix mark, target, binding, and active identity', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-search-collapsed',
    name: 'Wave 1C search collapsed fixture',
    description: 'Expose stable summary text without detail fallback.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 320,
    hitPositions: [],
    commonTermEvery: 1,
  });
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await page.evaluate(() => {
    const targetsApi = window.sessionSearchTargets;
    const highlighter = window.sessionSearchHighlighter;
    const originalDiscover = targetsApi.discover.bind(targetsApi);
    const originalApply = highlighter.apply.bind(highlighter);
    const evidence = {
      captureAppend: false,
      discoverCalls: [],
      prefixApplyCount: 0,
      suffixApplyCount: 0,
      initialTarget: null,
      initialMark: null,
      prefixNodes: null,
      latestTargets: [],
    };
    window.__wave1cM2Search = evidence;
    targetsApi.discover = (targets, searchKey, events, options) => {
      const existingTarget = evidence.initialTarget;
      const result = originalDiscover(targets, searchKey, events, options);
      evidence.latestTargets = result.targets;
      if (!evidence.initialTarget && result.targets.length) evidence.initialTarget = result.targets[0];
      if (evidence.captureAppend) {
        evidence.discoverCalls.push({
          eventCount: events.length,
          baseTimelineIndex: Number(options?.baseTimelineIndex || 0),
          existingTargetPreserved: !existingTarget || result.targets.includes(existingTarget),
          addedTimelineIndices: result.addedIds.map((id) => (
            result.targets.find((target) => target.id === id)?.timelineIndex
          )),
        });
      }
      return result;
    };
    highlighter.apply = (root, terms) => {
      if (evidence.captureAppend) {
        if (evidence.prefixNodes.has(root)) evidence.prefixApplyCount += 1;
        else evidence.suffixApplyCount += 1;
      }
      return originalApply(root, terms);
    };
  });
  await fillSearch(page, 'common-term');
  await assertEventCount(page, 150);
  await waitForSearchMarks(page, 5);
  await page.waitForFunction(() => window.__wave1cM2Search.initialTarget?.bindings.timeline.some(
    (node) => node.isConnected,
  ));
  await page.evaluate(() => {
    const evidence = window.__wave1cM2Search;
    const activeMark = document.querySelector('#timeline mark.searchMark.activeSearchMark');
    const target = evidence.latestTargets.find((candidate) => candidate.id === activeMark?.dataset.searchTargetId)
      || evidence.initialTarget;
    evidence.initialTarget = target;
    evidence.initialMark = activeMark || target.bindings.timeline.find((node) => node.isConnected);
    evidence.initialTargetId = target.id;
    evidence.initialBinding = window.sessionSearchTargets.liveBinding(target, 'timeline');
    evidence.prefixNodes = new Set(document.querySelectorAll('#timeline .event[data-event-id]'));
    evidence.captureAppend = true;
  });
  const operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await assertEventCount(page, 300);
  const rows = await wave1cM2OperationRows(page, operationId);
  const searchIdentity = await page.evaluate(() => {
    const evidence = window.__wave1cM2Search;
    const target = evidence.initialTarget;
    return {
      targetObjectPreserved: evidence.discoverCalls.every((call) => call.existingTargetPreserved),
      bindingPreserved: target.bindings.timeline.includes(evidence.initialBinding)
        && window.sessionSearchTargets.liveBinding(target, 'timeline') === evidence.initialBinding,
      markPreserved: evidence.initialMark.isConnected
        && evidence.initialBinding === evidence.initialMark,
      activePreserved: evidence.initialMark.classList.contains('activeSearchMark')
        && evidence.initialMark.dataset.searchTargetId === evidence.initialTargetId,
      discoverCalls: structuredClone(evidence.discoverCalls),
      prefixApplyCount: evidence.prefixApplyCount,
      suffixApplyCount: evidence.suffixApplyCount,
    };
  });
  assert.equal(searchIdentity.targetObjectPreserved, true);
  assert.equal(searchIdentity.bindingPreserved, true);
  assert.equal(searchIdentity.markPreserved, true);
  assert.equal(searchIdentity.activePreserved, true);
  assert.equal(searchIdentity.prefixApplyCount, 0);
  assert.equal(searchIdentity.suffixApplyCount, 150);
  assert.deepEqual(searchIdentity.discoverCalls.map((call) => ({
    eventCount: call.eventCount,
    baseTimelineIndex: call.baseTimelineIndex,
  })), [{ eventCount: 150, baseTimelineIndex: 150 }]);
  assert.deepEqual(searchIdentity.discoverCalls[0].addedTimelineIndices, Array.from({ length: 150 }, (_, index) => index + 150));
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 1);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 0);
});

test('browser Wave 1C M2 appended visible Code Mode owner starts existing detail hydration', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-hydration-collapsed',
    name: 'Wave 1C hydration collapsed fixture',
    description: 'Only Code Mode auto-hydration should run.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { fixture, index } = await makeTransitionProfileIndex(t, {
    eventCount: 320,
    includeContextReveal: true,
    contextRevealIndex: 150,
  });
  const session = await materializeIndexedSession(index, fixture.longSessionId);
  const operation = session.logicalEvents.find((event, indexValue) => (
    indexValue >= 150 && event.kind === 'code_mode_operation'
  ));
  assert.ok(operation);
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  const detailStarted = deferred();
  const detailRelease = deferred();
  t.after(() => detailRelease.resolve());
  await page.route('**/api/sessions/*/events/*/detail*', async (route) => {
    const pathName = decodeURIComponent(new URL(route.request().url()).pathname);
    if (pathName.endsWith(`/events/${operation.id}/detail`)) {
      detailStarted.resolve();
      await detailRelease.promise;
    }
    await route.continue();
  });
  await page.locator('.timelinePane').evaluate((pane) => { pane.scrollTop = pane.scrollHeight; });
  const operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await detailStarted.promise;
  await assertEventCount(page, 300);
  const rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 1);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 0);
  detailRelease.resolve();
});

test('browser Wave 1C M2 preparation and post-insertion failures retain honest separate fallback mutations', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-fallback-collapsed',
    name: 'Wave 1C fallback collapsed fixture',
    description: 'Avoid unrelated detail replacement during fallback assertions.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 500 });
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    let armed = true;
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        if (armed && this instanceof HTMLTemplateElement) {
          armed = false;
          Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
          throw new Error('synthetic detached preparation failure');
        }
        return descriptor.set.call(this, value);
      },
    });
    window.__wave1cM2FailurePrefix = [...document.querySelectorAll('#timeline .event[data-event-id]')];
  });
  let operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await assertEventCount(page, 300);
  let rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 0);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 1);
  assert.equal(await page.evaluate(() => window.__wave1cM2FailurePrefix.every((node) => !node.isConnected)), true);

  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected');
    const prefixNodes = new Set(document.querySelectorAll('#timeline .event[data-event-id]'));
    let armed = true;
    Object.defineProperty(Node.prototype, 'isConnected', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get() {
        const connected = descriptor.get.call(this);
        if (armed && connected && this.nodeType === Node.ELEMENT_NODE
            && this.matches?.('.event[data-event-id]') && !prefixNodes.has(this)) {
          armed = false;
          Object.defineProperty(Node.prototype, 'isConnected', descriptor);
          throw new Error('synthetic post-insertion registration failure');
        }
        return connected;
      },
    });
    window.__wave1cM2PostInsertionPrefix = [...prefixNodes];
  });
  operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await assertEventCount(page, 450);
  rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 1);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 1);
  assert.ok(rows.findIndex((row) => row.commitKind === 'appendOnly')
    < rows.findIndex((row) => row.commitKind === 'replacement'));
  assert.equal(await page.evaluate(() => window.__wave1cM2PostInsertionPrefix.every((node) => !node.isConnected)), true);
  const latest = await latestWave1cM1Lifecycle(page);
  assert.equal(latest.ownerCount, 450);
  assert.equal(latest.ownerSerials.length, 450);
});

test('browser Wave 1C M2 temporary reveal makes Main append fall back without incremental publication', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t, { extraMessageCount: 320 });
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.toolName === 'nested-context-token');
  assert.ok(operation && nested);
  const temporaryEventId = 'wave-1c-temporary-append-event';
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/events/**', async (route) => {
        const requestUrl = new URL(route.request().url());
        const decodedPath = decodeURIComponent(requestUrl.pathname);
        if (decodedPath.endsWith(`/events/${operation.id}/detail`)) {
          const response = await route.fetch();
          const body = await response.json();
          const refs = [...(body.timelineSections || []), ...(body.inspectorSections || [])]
            .find((section) => section.type === 'event_refs');
          assert.ok(refs?.items?.length);
          refs.items[0] = { ...refs.items[0], id: temporaryEventId, label: 'Temporary append reference' };
          await route.fulfill({ response, json: body });
          return;
        }
        if (decodedPath.endsWith(`/events/${temporaryEventId}`)) {
          const actualUrl = new URL(requestUrl);
          actualUrl.pathname = requestUrl.pathname.replace(
            encodeURIComponent(temporaryEventId),
            encodeURIComponent(nested.id),
          );
          const response = await route.fetch({ url: actualUrl.href });
          const body = await response.json();
          await route.fulfill({ response, json: { ...body, id: temporaryEventId } });
          return;
        }
        await route.continue();
      });
    },
  });
  await page.locator(`#timeline .event[data-event-id="${operation.id}"]`).click();
  const ref = page.locator(`#detail [data-event-ref-id="${temporaryEventId}"], #detail [data-target-event-id="${temporaryEventId}"]`);
  await ref.waitFor();
  await ref.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${temporaryEventId}"].temporaryReferenceReveal`);
  await page.evaluate(() => {
    window.__wave1cM2TemporaryPrefix = [...document.querySelectorAll(
      '#timeline .event[data-event-id]:not(.temporaryReferenceReveal)',
    )];
  });
  const operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await page.waitForFunction(() => document.querySelectorAll(
    '#timeline .event[data-event-id]:not(.temporaryReferenceReveal)',
  ).length === 300);
  const rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.filter((row) => row.commitKind === 'appendOnly').length, 0);
  assert.equal(rows.filter((row) => row.commitKind === 'replacement').length, 1);
  assert.equal(await page.evaluate(() => window.__wave1cM2TemporaryPrefix.every((node) => !node.isConnected)), true);
  assert.equal(await page.locator(`#timeline .event[data-event-id="${temporaryEventId}"].temporaryReferenceReveal`).count(), 1);
  const latest = await latestWave1cM1Lifecycle(page);
  assert.equal(latest.ownerCount, 300);
});

for (const delayResponseProcessing of [false, true]) {
test(`browser Wave 1C M2 replacements, Session switch, Protocol, and Raw remain full-render controls${delayResponseProcessing ? ' with gated response processing' : ''}`, async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-controls-collapsed',
    name: 'Wave 1C controls collapsed fixture',
    description: 'Avoid detail fallback during replacement controls.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 320 });
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });

  let oldArticle = await page.locator('#timeline .event[data-event-id]').first().elementHandle();
  let operationId = await beginWave1cM2Operation(page);
  const queryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'common-term'
      && url.searchParams.get('offset') === '0';
  });
  await fillSearch(page, 'common-term');
  await queryResponse;
  let rows = await settledWave1cM2OperationRows(page, operationId);
  assert.ok(rows.some((row) => row.commitKind === 'replacement'));
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);
  assert.equal(await oldArticle.evaluate((node) => node.isConnected), false);

  if (delayResponseProcessing) {
    await page.evaluate(() => {
      const original = Response.prototype.json;
      const gate = {};
      gate.promise = new Promise((resolve) => { gate.release = resolve; });
      window.__wave1cM2ResponseGate = gate;
      Response.prototype.json = async function (...args) {
        const url = new URL(this.url);
        const body = await original.apply(this, args);
        if (url.pathname.endsWith('/timeline') && url.searchParams.get('kind') === 'user_message') {
          Response.prototype.json = original;
          gate.paused = true;
          await gate.promise;
        }
        return body;
      };
    });
  }
  operationId = await beginWave1cM2Operation(page);
  const filterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('kind') === 'user_message'
      && url.searchParams.get('offset') === '0';
  });
  await addSearchFilter(page, 'kind', 'user_message');
  await filterResponse;
  const committedRows = settledWave1cM2OperationRows(page, operationId);
  if (delayResponseProcessing) {
    await page.waitForFunction(() => window.__wave1cM2ResponseGate.paused === true);
    let settled = false;
    committedRows.then(() => { settled = true; });
    // Reproduce the old legal window deterministically, across its rAF boundary.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate((id) => window.__wave1cM2.evidence.rows
      .filter((row) => row.operationId === id).length, operationId), 0);
    assert.equal(settled, false, 'operation must remain active while response processing is paused');
    await page.evaluate(() => window.__wave1cM2ResponseGate.release());
  }
  rows = await committedRows;
  assert.ok(rows.some((row) => ['replacement', 'clear', 'initialMount'].includes(row.commitKind)));
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);

  await clearAllSearch(page);
  await assertEventCount(page, 150);
  oldArticle = await page.locator('#timeline .event[data-event-id]').first().elementHandle();
  operationId = await beginWave1cM2Operation(page);
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 40);
  rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);
  assert.equal(await oldArticle.evaluate((node) => node.isConnected), false);
  assert.equal((await latestWave1cM1Lifecycle(page)).sameCanonicalContext, false);

  await page.locator(`[data-session-id="${fixture.longSessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  await page.locator('#layerSelect').selectOption('raw');
  await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'raw'
    && document.querySelectorAll('#timeline .event[data-event-id]').length === 150
    && window.__wave1cM1.evidence.lifecycle.at(-1)?.mode === 'non-main'
    && window.__wave1cM1.evidence.lifecycle.at(-1)?.ownerCount === 0);
  assert.equal((await latestWave1cM1Lifecycle(page)).ownerCount, 0);
  operationId = await beginWave1cM2Operation(page);
  await page.evaluate(() => document.querySelector('#loadMoreBtn').click());
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length > 150);
  rows = await wave1cM2OperationRows(page, operationId);
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);
  assert.ok(rows.some((row) => ['replacement', 'clear', 'initialMount'].includes(row.commitKind)));
  assert.equal((await latestWave1cM1Lifecycle(page)).ownerCount, 0);

  await page.locator('#layerSelect').selectOption('protocol');
  await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'protocol'
    && window.__wave1cM1.evidence.lifecycle.at(-1)?.mode === 'non-main'
    && window.__wave1cM1.evidence.lifecycle.at(-1)?.ownerCount === 0);
  assert.equal((await latestWave1cM1Lifecycle(page)).ownerCount, 0);
});
}

test('browser Wave 1C M2 late-hit batch publication preserves 600 prefix cards and appends 1200', async (t) => {
  const collapsedProfile = {
    id: 'custom:wave-1c-late-hit-collapsed',
    name: 'Wave 1C late-hit collapsed fixture',
    description: 'Keep publication identity observable before target detail refinement.',
    rules: { fallback: 'collapsed', kindStates: {}, conditions: [] },
  };
  const { index } = await makeTransitionProfileIndex(t, {
    eventCount: 1800,
    hitPositions: [1700],
    commonTermEvery: 1,
  });
  const { page } = await openWave1cM2App(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([collapsedProfile]),
      'sessionAnalyzer.profile': collapsedProfile.id,
    },
  });
  await fillSearch(page, 'far-needle');
  await assertEventCount(page, 600);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    window.__wave1cM2LatePrefix = cards;
    window.__wave1cM2LatePrefixById = new Map(cards.map((card) => [card.dataset.eventId, card]));
  });
  const operationId = await beginWave1cM2Operation(page);
  await page.locator('#searchInput').press('Enter');
  await assertEventCount(page, 1800);
  const rows = await wave1cM2OperationRows(page, operationId);
  const identity = await page.evaluate(() => ({
    preserved: window.__wave1cM2LatePrefix.filter((card) => (
      card.isConnected
        && window.__wave1cM2LatePrefixById.get(card.dataset.eventId) === card
        && document.querySelector(`#timeline .event[data-event-id="${CSS.escape(card.dataset.eventId)}"]`) === card
    )).length,
    newCount: [...document.querySelectorAll('#timeline .event[data-event-id]')]
      .filter((card) => !window.__wave1cM2LatePrefix.includes(card)).length,
  }));
  assert.deepEqual(identity, { preserved: 600, newCount: 1200 });
  assert.deepEqual(rows.filter((row) => row.commitKind === 'appendOnly').map((row) => ({
    pre: row.preCanonicalCount,
    added: row.addedCanonicalCount,
    final: row.finalCanonicalCount,
  })), [{ pre: 600, added: 1200, final: 1800 }]);
  assert.equal(rows.some((row) => row.commitKind === 'replacement'), false);
});

test('browser Wave 1C M1 observer failures cannot interrupt revision, detail, render, parity, or highlight effects', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, {
    locale: 'en',
    skipProjectReindex: true,
    beforeGoto: async (targetPage) => {
      await installWave1bM2SourceBundle(targetPage);
      await installWave1cM1FailingObserver(targetPage);
    },
  });
  await selectPrimarySession(page);

  const initialLifecycleCount = await page.evaluate(() => (
    window.__wave1cM1FailingObserver.lifecycle.length
  ));
  assert.ok(initialLifecycleCount > 0);
  const command = page.locator('#timeline .event.kind-command:not(.expanded)').first();
  const eventId = await command.getAttribute('data-event-id');
  assert.ok(eventId);
  const detailResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/events/${encodeURIComponent(eventId)}/detail`)
      && response.ok();
  });
  await command.locator('[data-action="toggle"]').click();
  await detailResponse;
  await page.waitForFunction((id) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"]`);
    return article?.classList.contains('expanded')
      && article.querySelector('.eventBody')
      && !article.textContent.includes('Loading structured detail');
  }, eventId);

  const observerOutcome = await page.evaluate(() => {
    const evidence = window.__wave1cM1FailingObserver;
    const latest = evidence.lifecycle.at(-1);
    const cards = document.querySelectorAll('#timeline .event[data-event-id]').length;
    return {
      lifecycleAttempts: evidence.lifecycle.length,
      revisionKinds: evidence.revisions.map((item) => item.revisionKind),
      ownerCount: latest.ownerCount,
      ownerSerialCount: latest.ownerSerials.length,
      cards,
      stateError: document.querySelector('#stateLine')?.dataset.state === 'error',
      observerTextVisible: document.body.textContent.includes('synthetic record'),
    };
  });
  assert.ok(observerOutcome.lifecycleAttempts > initialLifecycleCount);
  assert.ok(observerOutcome.revisionKinds.includes('overridesRevision'));
  assert.ok(observerOutcome.revisionKinds.includes('detailPresentationRevision'));
  assert.equal(observerOutcome.ownerCount, observerOutcome.cards);
  assert.equal(observerOutcome.ownerSerialCount, observerOutcome.cards);
  assert.equal(observerOutcome.stateError, false);
  assert.equal(observerOutcome.observerTextVisible, false);

  await fillSearch(page, 'src');
  await waitForSearchMarks(page);
  assert.ok(await page.locator('#timeline mark.searchMark').count() > 0,
    'post-render search/highlight synchronization must continue after lifecycle observation throws');
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
});
