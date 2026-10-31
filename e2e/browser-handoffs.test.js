'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzerSessionId, buildClaudeSourceBackedIndex } = require('../src/claude');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');
const { suggestionRequestEvidence } = require('../scripts/timeline-profile');

const {
  repoRoot,
  installWave1bM2SourceBundle,
  installWave1cM1BrowserSeam,
  deferred,
  buildFixtureIndex,
  materializeIndexedSession,
  openApp,
  latestWave1cM1Lifecycle,
  openSourceSwitchChooser,
  makeClaudeSwitchFixture,
  confirmSourceAction,
  waitForProjectRoot,
  switchHiddenLocale,
  assertEventCount,
  fillSearch,
  addSearchFilter,
  switchToProjectScope,
  waitForProjectCards,
  makeTransitionProfileIndex,
  makeContextCodeModeCodexHome,
} = require('./browser-helpers');

async function installWave1aM2BrowserSeam(page) {
  await page.addInitScript(() => {
    const nativeFreeze = Object.freeze;
    const nativePromiseAll = Promise.all.bind(Promise);
    const nativeFetch = window.fetch.bind(window);
    const contextAliases = new Map();
    const evidence = {
      outcomes: [],
      handoffs: [],
      automaticSelectionSettlementCount: 0,
      settlementWatermark: 0,
      suggestionSequence: 0,
      suggestionRecords: [],
      pauseNextTriple: false,
      paused: false,
      release: null,
    };
    const contextAlias = (context) => {
      if (!contextAliases.has(context)) contextAliases.set(context, contextAliases.size + 1);
      return contextAliases.get(context);
    };
    window.__wave1aM2 = {
      evidence,
      armHandoffPause() {
        evidence.pauseNextTriple = true;
        evidence.paused = false;
        evidence.release = null;
      },
      releaseHandoff() {
        evidence.release?.();
      },
    };
    window.__sessionAnalyzerProfileObserver = {
      recordAutomaticSelectionSettled() {
        evidence.automaticSelectionSettlementCount += 1;
        evidence.settlementWatermark = evidence.suggestionSequence;
      },
      recordSuggestionHandoff(value) {
        evidence.handoffs.push(structuredClone(value));
      },
    };
    window.fetch = async (...args) => {
      let record = null;
      try {
        const url = new URL(
          args[0] instanceof Request ? args[0].url : String(args[0]),
          location.href,
        );
        if (url.pathname === '/api/file-suggestions') {
          evidence.suggestionSequence += 1;
          const layer = url.searchParams.get('layer') || '';
          record = {
            sequence: evidence.suggestionSequence,
            suggestionScope: url.searchParams.has('sessionId') ? 'session' : 'project',
            filterAlias: ['main', 'protocol', 'raw'].includes(layer)
              ? layer
              : (layer ? 'other' : 'none'),
            outcome: 'pending',
            httpStatus: 0,
          };
          evidence.suggestionRecords.push(record);
        }
      } catch {}
      try {
        const response = await nativeFetch(...args);
        if (record) {
          record.outcome = 'success';
          record.httpStatus = response.status;
        }
        return response;
      } catch (error) {
        if (record) record.outcome = 'failed';
        throw error;
      }
    };
    Object.freeze = function freeze(value) {
      const result = nativeFreeze(value);
      if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 3
            && keys[0] === 'suggestionRequestId'
            && keys[1] === 'suggestionContext'
            && keys[2] === 'suggestionCommitted') {
          evidence.outcomes.push({
            keys,
            suggestionRequestId: value.suggestionRequestId,
            suggestionContextAlias: contextAlias(value.suggestionContext),
            suggestionCommitted: value.suggestionCommitted,
            frozen: Object.isFrozen(result),
          });
        }
      }
      return result;
    };
    Promise.all = function all(iterable) {
      const values = Array.from(iterable);
      const result = nativePromiseAll(values);
      if (!evidence.pauseNextTriple || values.length !== 3) return result;
      evidence.pauseNextTriple = false;
      return result.then((resolved) => new Promise((resolve) => {
        evidence.paused = true;
        evidence.release = () => {
          evidence.paused = false;
          evidence.release = null;
          resolve(resolved);
        };
      }));
    };
  });
}

async function installWave1aM3BrowserSeam(page) {
  await page.addInitScript(() => {
    const evidence = {
      snapshots: [],
      lookups: [],
      cardIterations: [],
    };
    window.__wave1aM3 = {
      evidence,
      resetOperations() {
        evidence.lookups.length = 0;
        evidence.cardIterations.length = 0;
      },
    };
    window.__sessionAnalyzerProfileObserver = {
      recordStateSnapshot(value) {
        evidence.snapshots.push(structuredClone(value));
      },
      recordLookup(value) {
        evidence.lookups.push(structuredClone(value));
      },
      recordCardIteration(value) {
        evidence.cardIterations.push(structuredClone(value));
      },
    };
  });
}

async function recordFileSuggestionResponse(route, ledger) {
  const requestUrl = new URL(route.request().url());
  const response = await route.fetch();
  const body = await response.json();
  ledger.push({
    scope: requestUrl.searchParams.has('sessionId') ? 'session' : 'project',
    sessionId: requestUrl.searchParams.get('sessionId') || '',
    layer: requestUrl.searchParams.get('layer') || '',
    files: (body.files || []).map((item) => ({ file: item.file, count: item.count })),
  });
  await route.fulfill({ response, json: body });
}

test('Wave 1A M2 browser preserves exact suggestion ownership, parameters, and content', async (t) => {
  const index = await buildFixtureIndex();
  const suggestions = [];
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await installWave1aM2BrowserSeam(targetPage);
      await targetPage.route('**/api/file-suggestions*', (route) => (
        recordFileSuggestionResponse(route, suggestions)
      ));
    },
  });
  const waitForSuggestion = () => page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/file-suggestions'
  ));
  const activeSessionId = await page.locator('.sessionItem.active').getAttribute('data-session-id');

  assert.deepEqual(suggestions.map(({ scope, sessionId, layer }) => ({ scope, sessionId, layer })), [{
    scope: 'session',
    sessionId: activeSessionId,
    layer: 'main',
  }]);
  await page.locator('#searchFileInput').focus();
  const renderedSuggestionFiles = await page.locator('[data-search-file-suggestion]').evaluateAll((items) => (
    items.map((item) => item.dataset.searchFileSuggestion)
  ));
  assert.deepEqual(renderedSuggestionFiles, suggestions[0].files.slice(0, 12).map((item) => item.file));
  assert.equal(
    await page.locator('#searchFileSuggestions .fileSuggestionEmpty').count(),
    suggestions[0].files.length ? 0 : 1,
    'empty suggestion content must remain exactly empty',
  );
  const initialEvidence = await page.evaluate(() => structuredClone(window.__wave1aM2.evidence));
  assert.equal(initialEvidence.outcomes.length, 1);
  assert.deepEqual(initialEvidence.outcomes[0], {
    keys: ['suggestionRequestId', 'suggestionContext', 'suggestionCommitted'],
    suggestionRequestId: initialEvidence.outcomes[0].suggestionRequestId,
    suggestionContextAlias: 1,
    suggestionCommitted: true,
    frozen: true,
  });
  assert.ok(Number.isSafeInteger(initialEvidence.outcomes[0].suggestionRequestId));
  assert.deepEqual(initialEvidence.handoffs, [{
    sessionsRequest: true,
    sessionsContext: true,
    delegatedSession: true,
    sessionScope: true,
    suggestionContext: true,
    suggestionRequest: true,
    passed: true,
  }]);
  assert.equal(initialEvidence.automaticSelectionSettlementCount, 1);
  assert.equal(initialEvidence.settlementWatermark, 1);
  assert.deepEqual(suggestionRequestEvidence(
    initialEvidence.suggestionRecords,
    initialEvidence.settlementWatermark,
    true,
  ), {
    records: [{
      sequence: 1,
      scope: 'session',
      layerAlias: 'main',
      outcome: 'success',
      httpStatus: 200,
      startedAfterAutomaticSelectionSettled: false,
    }],
    settlementWatermark: 1,
    scopeCounts: { session: 1, project: 0 },
    postSettlementSessionCount: 0,
  });

  const laterSession = page.locator('[data-session-id]:not(.active)').first();
  const laterSessionId = await laterSession.getAttribute('data-session-id');
  let response = waitForSuggestion();
  await laterSession.click();
  await response;
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), laterSessionId);
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'session',
    sessionId: laterSessionId,
    layer: 'main',
  });
  assert.equal(suggestions.length, 2, 'explicit Session selection owns one suggestion request');
  assert.deepEqual(await page.evaluate(() => ({
    count: window.__wave1aM2.evidence.automaticSelectionSettlementCount,
    watermark: window.__wave1aM2.evidence.settlementWatermark,
  })), { count: 1, watermark: 1 }, 'an explicit Session click must not record automatic settlement');

  response = waitForSuggestion();
  await switchToProjectScope(page);
  await response;
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'project',
    sessionId: '',
    layer: 'main',
  });

  response = waitForSuggestion();
  await page.locator('#layerSelect').selectOption('protocol');
  await response;
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'project',
    sessionId: '',
    layer: 'protocol',
  });

  response = waitForSuggestion();
  await page.locator('#searchHudScope').click();
  await page.locator('[data-search-scope="session"]').click();
  await response;
  await page.waitForFunction(() => document.body.dataset.searchScope === 'session');
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'session',
    sessionId: laterSessionId,
    layer: 'protocol',
  });

  response = waitForSuggestion();
  await page.locator('#layerSelect').selectOption('main');
  await response;
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'session',
    sessionId: laterSessionId,
    layer: 'main',
  });

  const beforeLocale = suggestions.length;
  response = waitForSuggestion();
  await switchHiddenLocale(page, 'zh-CN');
  await response;
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(suggestions.length, beforeLocale + 1, 'locale reload owns one Session suggestion');
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'session',
    sessionId: laterSessionId,
    layer: 'main',
  });

  const beforeProjectRefresh = suggestions.length;
  response = waitForSuggestion();
  await page.locator('#projectRefreshBtn').click();
  await response;
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false');
  assert.equal(suggestions.length, beforeProjectRefresh + 1, 'project replacement owns one Session suggestion');
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'session',
    sessionId: laterSessionId,
    layer: 'main',
  });

});

test('Wave 1A M2 browser project-result drill-down owns one Session suggestion', async (t) => {
  const index = await buildFixtureIndex();
  const suggestions = [];
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await installWave1aM2BrowserSeam(targetPage);
      await targetPage.route('**/api/file-suggestions*', (route) => (
        recordFileSuggestionResponse(route, suggestions)
      ));
    },
  });
  let response = page.waitForResponse((value) => new URL(value.url()).pathname === '/api/file-suggestions');
  await switchToProjectScope(page);
  await response;
  await fillSearch(page, 'patch');
  await waitForProjectCards(page);
  const drillSessionId = await page.locator('[data-project-result-session-id]').first().getAttribute('data-project-result-session-id');
  const beforeDrillDown = suggestions.length;
  response = page.waitForResponse((value) => new URL(value.url()).pathname === '/api/file-suggestions');
  await page.locator('[data-project-result-session-id]').first().click();
  await response;
  await page.waitForFunction(() => document.body.dataset.searchScope === 'session');
  assert.equal(suggestions.length, beforeDrillDown + 1);
  assert.deepEqual(suggestions.at(-1), {
    ...suggestions.at(-1),
    scope: 'session',
    sessionId: drillSessionId,
    layer: 'main',
  });
});

test('Wave 1A M2 browser keeps empty Sessions under one Project suggestion owner', async (t) => {
  const index = await buildFixtureIndex();
  const suggestions = [];
  const { page } = await openApp(t, index, {
    locale: 'en',
    activeSessionState: 'hidden',
    expectTimeline: false,
    beforeGoto: async (targetPage) => {
      await installWave1aM2BrowserSeam(targetPage);
      await targetPage.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({
          response,
          json: { ...body, sessions: [], total: 0 },
        });
      });
      await targetPage.route('**/api/file-suggestions*', (route) => (
        recordFileSuggestionResponse(route, suggestions)
      ));
    },
  });

  await page.waitForFunction(() => document.body.dataset.searchScope === 'project');
  assert.deepEqual(suggestions.map(({ scope, sessionId, layer }) => ({ scope, sessionId, layer })), [{
    scope: 'project',
    sessionId: '',
    layer: 'main',
  }]);
  assert.equal(await page.locator('[data-session-id]').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__wave1aM2.evidence), {
    outcomes: [],
    handoffs: [],
    automaticSelectionSettlementCount: 0,
    settlementWatermark: 0,
    suggestionSequence: 1,
    suggestionRecords: [{
      sequence: 1,
      suggestionScope: 'project',
      filterAlias: 'main',
      outcome: 'success',
      httpStatus: 200,
    }],
    pauseNextTriple: false,
    paused: false,
    release: null,
  });
});

test('Wave 1A M2 browser source and project replacements each own one Session suggestion', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const suggestions = [];
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (targetPage) => {
      await installWave1aM2BrowserSeam(targetPage);
      await targetPage.route('**/api/file-suggestions*', (route) => (
        recordFileSuggestionResponse(route, suggestions)
      ));
    },
  });
  const suggestionResponse = () => page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/file-suggestions'
  ));
  const chooseProject = async (root) => {
    const response = suggestionResponse();
    await page.evaluate((projectRoot) => {
      const project = [...document.querySelectorAll('.projectItem[data-project-root]')]
        .find((item) => item.dataset.projectRoot === projectRoot);
      project?.click();
    }, root);
    await response;
    await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
    await page.waitForSelector('.sessionItem.active');
  };

  await waitForProjectRoot(page, repoRoot);
  await chooseProject(repoRoot);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].scope, 'session');
  assert.ok(suggestions[0].sessionId);
  assert.equal(suggestions[0].layer, 'main');

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.locator('[data-source-choice="claude-code"]').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  await chooseProject(fixture.claudeRepo);
  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions[1], {
    ...suggestions[1],
    scope: 'session',
    sessionId: analyzerSessionId(fixture.sessionId),
    layer: 'main',
  });
  assert.equal(
    await page.locator('.sessionItem.active').getAttribute('data-session-id'),
    analyzerSessionId(fixture.sessionId),
  );
  await page.locator('#searchFileInput').focus();
  assert.deepEqual(
    await page.locator('[data-search-file-suggestion]').evaluateAll((items) => (
      items.map((item) => item.dataset.searchFileSuggestion)
    )),
    suggestions[1].files.slice(0, 12).map((item) => item.file),
  );
});

test('Wave 1A M2 browser executes every outer handoff guard before skip or fallback', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM2BrowserSeam,
  });
  const suggestionResponse = () => page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/file-suggestions'
  ));
  const handoffCount = () => page.evaluate(() => window.__wave1aM2.evidence.handoffs.length);
  const pauseOuterLoad = async () => {
    const before = await handoffCount();
    await page.evaluate(() => window.__wave1aM2.armHandoffPause());
    const response = suggestionResponse();
    await page.locator('#sortSelect').dispatchEvent('change');
    await response;
    await page.waitForFunction(() => window.__wave1aM2.evidence.paused);
    return before;
  };
  const releaseAndRead = async (before) => {
    await page.evaluate(() => window.__wave1aM2.releaseHandoff());
    await page.waitForFunction((count) => window.__wave1aM2.evidence.handoffs.length > count, before);
    return page.evaluate(() => structuredClone(window.__wave1aM2.evidence.handoffs.at(-1)));
  };

  let heldSessions = false;
  let sessionsStarted = deferred();
  let sessionsRelease = deferred();
  await page.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
    if (heldSessions) {
      sessionsStarted.resolve();
      await sessionsRelease.promise;
      heldSessions = false;
    }
    await route.continue();
  });
  t.after(() => sessionsRelease.resolve());

  let before = await pauseOuterLoad();
  heldSessions = true;
  sessionsStarted = deferred();
  sessionsRelease = deferred();
  await page.locator('#sortSelect').dispatchEvent('change');
  await sessionsStarted.promise;
  assert.deepEqual(await releaseAndRead(before), {
    sessionsRequest: false,
    sessionsContext: true,
    delegatedSession: true,
    sessionScope: true,
    suggestionContext: true,
    suggestionRequest: true,
    passed: false,
  });
  sessionsRelease.resolve();
  await page.waitForFunction((count) => window.__wave1aM2.evidence.handoffs.length > count, before + 1);

  before = await pauseOuterLoad();
  const committedSort = await page.locator('#sortSelect').inputValue();
  const mismatchedSort = committedSort === 'events-desc' ? 'updated-desc' : 'events-desc';
  await page.evaluate((value) => {
    document.querySelector('#sortSelect').value = value;
  }, mismatchedSort);
  assert.deepEqual(await releaseAndRead(before), {
    sessionsRequest: true,
    sessionsContext: false,
    delegatedSession: true,
    sessionScope: true,
    suggestionContext: true,
    suggestionRequest: true,
    passed: false,
  });
  await page.evaluate((value) => {
    document.querySelector('#sortSelect').value = value;
  }, committedSort);

  before = await pauseOuterLoad();
  let response = suggestionResponse();
  await page.locator('#layerSelect').selectOption('protocol');
  await response;
  assert.deepEqual(await releaseAndRead(before), {
    sessionsRequest: true,
    sessionsContext: true,
    delegatedSession: true,
    sessionScope: true,
    suggestionContext: false,
    suggestionRequest: false,
    passed: false,
  });

  before = await pauseOuterLoad();
  const laterSession = page.locator('[data-session-id]:not(.active)').first();
  response = suggestionResponse();
  await laterSession.click();
  await response;
  assert.deepEqual(await releaseAndRead(before), {
    sessionsRequest: true,
    sessionsContext: true,
    delegatedSession: false,
    sessionScope: true,
    suggestionContext: false,
    suggestionRequest: false,
    passed: false,
  });

  before = await pauseOuterLoad();
  response = suggestionResponse();
  await switchToProjectScope(page);
  await response;
  assert.deepEqual(await releaseAndRead(before), {
    sessionsRequest: true,
    sessionsContext: true,
    delegatedSession: true,
    sessionScope: false,
    suggestionContext: false,
    suggestionRequest: false,
    passed: false,
  });
});

test('Wave 1A M2 browser leaves revision recovery as the bounded suggestion owner', async (t) => {
  const index = await buildFixtureIndex();
  const requests = [];
  const marker = 'wave-1a-revision-stale-suggestion';
  let mismatchPending = true;
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM2BrowserSeam,
  });
  const initialOutcomeCount = await page.evaluate(() => window.__wave1aM2.evidence.outcomes.length);
  await page.route('**/api/file-suggestions*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const response = await route.fetch();
    const body = await response.json();
    requests.push({
      scope: requestUrl.searchParams.has('sessionId') ? 'session' : 'project',
      layer: requestUrl.searchParams.get('layer') || '',
      mismatched: mismatchPending,
    });
    if (mismatchPending) {
      mismatchPending = false;
      await route.fulfill({
        response,
        json: {
          ...body,
          indexRevision: body.indexRevision + 1,
          files: [{ file: marker, count: 999 }],
        },
      });
      return;
    }
    await route.fulfill({ response, json: body });
  });
  await page.evaluate((text) => {
    window.__wave1aRevisionMarkerSeen = document.body.textContent.includes(text);
    new MutationObserver(() => {
      if (document.body.textContent.includes(text)) window.__wave1aRevisionMarkerSeen = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, marker);

  await page.locator('#layerSelect').selectOption('protocol');
  await page.waitForFunction((count) => (
    window.__wave1aM2.evidence.outcomes.length > count
      && window.__wave1aM2.evidence.outcomes.at(-1).suggestionCommitted === true
      && window.__wave1aM2.evidence.handoffs.at(-1).passed === true
  ), initialOutcomeCount);
  assert.equal(mismatchPending, false);
  assert.deepEqual(requests, [
    { scope: 'session', layer: 'protocol', mismatched: true },
    { scope: 'session', layer: 'protocol', mismatched: false },
  ]);
  assert.equal(await page.evaluate(() => window.__wave1aRevisionMarkerSeen), false);
});

test('Wave 1A M2 browser keeps the newer same-context suggestion pending without a third fallback', async (t) => {
  const index = await buildFixtureIndex();
  const { page, baseUrl } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM2BrowserSeam,
  });
  const statePayload = await (await fetch(`${baseUrl}/api/state`)).json();
  const indexRevision = (statePayload.currentState || statePayload).indexRevision;
  const initialRequestId = await page.evaluate(() => window.__wave1aM2.evidence.outcomes.at(-1).suggestionRequestId);
  const oldRelease = deferred();
  const newerRelease = deferred();
  const oldStarted = deferred();
  const newerStarted = deferred();
  const failed = [];
  let oldRequest;
  let requestCount = 0;
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === '/api/file-suggestions') failed.push(request.url());
  });
  await page.route('**/api/file-suggestions*', async (route) => {
    requestCount += 1;
    const ordinal = requestCount;
    if (ordinal === 1) {
      oldRequest = route.request();
      oldStarted.resolve();
      await oldRelease.promise;
    } else if (ordinal === 2) {
      newerStarted.resolve();
      await newerRelease.promise;
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          indexRevision,
          files: [{ file: `wave-1a-pending-${ordinal}`, count: ordinal }],
        }),
      });
    } catch {
      // The deliberately superseded request is expected to be gone.
    }
  });
  t.after(() => {
    oldRelease.resolve();
    newerRelease.resolve();
  });

  const sortValue = await page.locator('#sortSelect').inputValue();
  const nextSort = sortValue === 'events-desc' ? 'updated-desc' : 'events-desc';
  await page.evaluate(() => window.__wave1aM2.armHandoffPause());
  await page.locator('#sortSelect').selectOption(nextSort);
  await oldStarted.promise;
  const oldAborted = page.waitForEvent('requestfailed', {
    predicate: (request) => request === oldRequest,
    timeout: 10000,
  });
  const selectedSessionId = await page.locator('.sessionItem.active').getAttribute('data-session-id');
  await page.locator(`[data-session-id="${selectedSessionId}"]`).click();
  await newerStarted.promise;
  await page.waitForFunction(() => window.__wave1aM2.evidence.paused);

  await page.evaluate(() => window.__wave1aM2.releaseHandoff());
  await page.waitForFunction(() => window.__wave1aM2.evidence.handoffs.length >= 2);
  // The app handoff and Playwright's network failure notification settle separately.
  await oldAborted;
  assert.equal(requestCount, 2, 'the superseded outer load must not start a third fallback');
  assert.deepEqual((await page.evaluate(() => window.__wave1aM2.evidence.handoffs.at(-1))), {
    sessionsRequest: true,
    sessionsContext: true,
    delegatedSession: true,
    sessionScope: true,
    suggestionContext: true,
    suggestionRequest: false,
    passed: false,
  });
  assert.equal(failed.length, 1, 'only the older delegated request should be aborted');

  newerRelease.resolve();
  await page.locator('#searchFileInput').focus();
  await page.waitForFunction(() => (
    document.querySelector('[data-search-file-suggestion]')?.dataset.searchFileSuggestion === 'wave-1a-pending-2'
  ));
  oldRelease.resolve();
  assert.equal(requestCount, 2);
  assert.equal(failed.length, 1, 'the newer pending request must not be aborted');
  assert.deepEqual((await page.evaluate(() => window.__wave1aM2.evidence.outcomes.slice(-2))), [
    {
      keys: ['suggestionRequestId', 'suggestionContext', 'suggestionCommitted'],
      suggestionRequestId: initialRequestId + 1,
      suggestionContextAlias: 1,
      suggestionCommitted: false,
      frozen: true,
    },
    {
      keys: ['suggestionRequestId', 'suggestionContext', 'suggestionCommitted'],
      suggestionRequestId: initialRequestId + 2,
      suggestionContextAlias: 1,
      suggestionCommitted: true,
      frozen: true,
    },
  ]);
});

test('Wave 1A M2 browser keeps a newer committed same-context suggestion authoritative', async (t) => {
  const index = await buildFixtureIndex();
  const { page, baseUrl } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM2BrowserSeam,
  });
  const statePayload = await (await fetch(`${baseUrl}/api/state`)).json();
  const indexRevision = (statePayload.currentState || statePayload).indexRevision;
  const initialRequestId = await page.evaluate(() => window.__wave1aM2.evidence.outcomes.at(-1).suggestionRequestId);
  const oldRelease = deferred();
  const oldStarted = deferred();
  let requestCount = 0;
  const failed = [];
  let oldRequest;
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === '/api/file-suggestions') failed.push(request.url());
  });
  await page.route('**/api/file-suggestions*', async (route) => {
    requestCount += 1;
    const ordinal = requestCount;
    if (ordinal === 1) {
      oldRequest = route.request();
      oldStarted.resolve();
      await oldRelease.promise;
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          indexRevision,
          files: [{ file: `wave-1a-committed-${ordinal}`, count: ordinal }],
        }),
      });
    } catch {
      // The deliberately superseded request is expected to be gone.
    }
  });
  t.after(() => oldRelease.resolve());

  const sortValue = await page.locator('#sortSelect').inputValue();
  const nextSort = sortValue === 'events-desc' ? 'updated-desc' : 'events-desc';
  await page.evaluate(() => window.__wave1aM2.armHandoffPause());
  await page.locator('#sortSelect').selectOption(nextSort);
  await oldStarted.promise;
  const oldAborted = page.waitForEvent('requestfailed', {
    predicate: (request) => request === oldRequest,
    timeout: 10000,
  });
  const selectedSessionId = await page.locator('.sessionItem.active').getAttribute('data-session-id');
  await page.locator(`[data-session-id="${selectedSessionId}"]`).click();
  await page.locator('#searchFileInput').focus();
  await page.waitForFunction(() => (
    document.querySelector('[data-search-file-suggestion]')?.dataset.searchFileSuggestion === 'wave-1a-committed-2'
  ));
  await page.waitForFunction(() => window.__wave1aM2.evidence.paused);

  await page.evaluate(() => window.__wave1aM2.releaseHandoff());
  await page.waitForFunction(() => window.__wave1aM2.evidence.handoffs.length >= 2);
  oldRelease.resolve();
  await oldAborted;
  assert.equal(requestCount, 2, 'the superseded outer load must not start a third fallback');
  assert.equal(failed.length, 1, 'the committed newer request must not be aborted');
  assert.equal(await page.locator('[data-search-file-suggestion]').first().getAttribute('data-search-file-suggestion'), 'wave-1a-committed-2');
  assert.deepEqual((await page.evaluate(() => window.__wave1aM2.evidence.handoffs.at(-1))), {
    sessionsRequest: true,
    sessionsContext: true,
    delegatedSession: true,
    sessionScope: true,
    suggestionContext: true,
    suggestionRequest: false,
    passed: false,
  });
  assert.deepEqual((await page.evaluate(() => window.__wave1aM2.evidence.outcomes.slice(-2))), [
    {
      keys: ['suggestionRequestId', 'suggestionContext', 'suggestionCommitted'],
      suggestionRequestId: initialRequestId + 1,
      suggestionContextAlias: 1,
      suggestionCommitted: false,
      frozen: true,
    },
    {
      keys: ['suggestionRequestId', 'suggestionContext', 'suggestionCommitted'],
      suggestionRequestId: initialRequestId + 2,
      suggestionContextAlias: 1,
      suggestionCommitted: true,
      frozen: true,
    },
  ]);
});

test('Wave 1A M3 browser publishes first-page, append, and Session-switch Map parity with positive card gets', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 320 });
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM3BrowserSeam,
  });
  await assertEventCount(page, 150);

  const initial = await page.evaluate(() => {
    const evidence = window.__wave1aM3.evidence;
    const enclosingLookups = evidence.lookups.filter((item) => item.purpose === 'enclosingAffordance');
    const enclosingCards = evidence.cardIterations.filter((item) => item.purpose === 'enclosingAffordance');
    return {
      snapshot: evidence.snapshots.at(-1),
      cardIterations: enclosingCards.reduce((total, item) => total + item.cardIterations, 0),
      lookupRequests: enclosingLookups.reduce((total, item) => total + item.lookupRequests, 0),
      mapGets: enclosingLookups.reduce((total, item) => total + item.mapGets, 0),
      arrayComparisons: enclosingLookups.reduce((total, item) => total + item.arrayComparisons, 0),
      backends: [...new Set(enclosingLookups.map((item) => item.backend))],
    };
  });
  assert.deepEqual(initial.snapshot, {
    arrayLength: 150,
    mapSize: 150,
    uniqueIdCount: 150,
    objectIdentityParity: true,
    committedContextBound: true,
    offsetMatches: true,
    pendingReplacement: false,
    backend: 'map',
    parityPassed: true,
  });
  assert.ok(initial.cardIterations > 0, 'enclosing-affordance evidence must have a positive card count');
  assert.equal(initial.lookupRequests, initial.cardIterations);
  assert.equal(initial.mapGets, initial.cardIterations);
  assert.equal(initial.arrayComparisons, 0);
  assert.deepEqual(initial.backends, ['map']);

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 300);
  assert.deepEqual(await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1)), {
    arrayLength: 300,
    mapSize: 300,
    uniqueIdCount: 300,
    objectIdentityParity: true,
    committedContextBound: true,
    offsetMatches: true,
    pendingReplacement: false,
    backend: 'map',
    parityPassed: true,
  });

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 320);
  assert.equal((await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1).parityPassed)), true);

  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 40);
  assert.deepEqual(await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1)), {
    arrayLength: 40,
    mapSize: 40,
    uniqueIdCount: 40,
    objectIdentityParity: true,
    committedContextBound: true,
    offsetMatches: true,
    pendingReplacement: false,
    backend: 'map',
    parityPassed: true,
  });
  assert.ok((await page.evaluate(() => window.__wave1aM3.evidence.snapshots)).some((snapshot) => (
    snapshot.arrayLength === 0 && snapshot.mapSize === 0 && snapshot.parityPassed
  )), 'Session switch must retire the prior pair through an empty committed reset');
});

test('Wave 1A M3 browser keeps delayed-replacement cards interactive and measures exact positive C-to-C gets', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 320 });
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM3BrowserSeam,
  });
  await assertEventCount(page, 150);
  const kind = await page.locator('#searchKindSelect option').evaluateAll((options) => (
    options.map((option) => option.value).find(Boolean) || ''
  ));
  assert.ok(kind, 'fixture should expose a structural Kind filter');
  const replacementStarted = deferred();
  const replacementRelease = deferred();
  await page.route('**/api/sessions/*/timeline?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('kind') === kind && requestUrl.searchParams.get('offset') === '0') {
      replacementStarted.resolve();
      await replacementRelease.promise;
    }
    await route.continue();
  });
  t.after(() => replacementRelease.resolve());

  const oldCard = page.locator('#timeline .event[data-event-id]').first();
  const oldEventId = await oldCard.getAttribute('data-event-id');
  await addSearchFilter(page, 'kind', kind);
  await replacementStarted.promise;
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150);
  const pendingSnapshot = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1));
  assert.equal(pendingSnapshot.arrayLength, 150);
  assert.equal(pendingSnapshot.mapSize, 150);
  assert.equal(pendingSnapshot.parityPassed, true);
  assert.equal(pendingSnapshot.pendingReplacement, true);

  await page.evaluate(() => window.__wave1aM3.resetOperations());
  await oldCard.click();
  await page.waitForFunction((eventId) => (
    document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
      && document.body.dataset.detailView === 'inspector'
  ), oldEventId);
  const pendingOperations = await page.evaluate(() => {
    const evidence = window.__wave1aM3.evidence;
    const lookups = evidence.lookups.filter((item) => item.purpose === 'enclosingAffordance');
    const cards = evidence.cardIterations.filter((item) => item.purpose === 'enclosingAffordance');
    return {
      cardIterations: cards.reduce((total, item) => total + item.cardIterations, 0),
      lookupRequests: lookups.reduce((total, item) => total + item.lookupRequests, 0),
      mapGets: lookups.reduce((total, item) => total + item.mapGets, 0),
      arrayComparisons: lookups.reduce((total, item) => total + item.arrayComparisons, 0),
    };
  });
  assert.equal(pendingOperations.cardIterations, 150);
  assert.equal(pendingOperations.lookupRequests, 150);
  assert.equal(pendingOperations.mapGets, 150);
  assert.equal(pendingOperations.arrayComparisons, 0);

  replacementRelease.resolve();
  await page.waitForFunction(() => (
    window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false
      && window.__wave1aM3.evidence.snapshots.at(-1)?.parityPassed === true
  ));
  const committedSnapshot = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1));
  assert.equal(committedSnapshot.arrayLength, committedSnapshot.mapSize);
  assert.equal(committedSnapshot.arrayLength, committedSnapshot.uniqueIdCount);
  assert.equal(committedSnapshot.objectIdentityParity, true);
  assert.equal(committedSnapshot.committedContextBound, true);
  assert.equal(committedSnapshot.offsetMatches, true);
});

test('Wave 1A M3 browser rejects duplicate replacement IDs before publishing either committed structure', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 320 });
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM3BrowserSeam,
  });
  await assertEventCount(page, 150);
  const before = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1));
  const kind = await page.locator('#searchKindSelect option').evaluateAll((options) => (
    options.map((option) => option.value).find(Boolean) || ''
  ));
  let injected = false;
  await page.route('**/api/sessions/*/timeline?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (injected || requestUrl.searchParams.get('kind') !== kind || requestUrl.searchParams.get('offset') !== '0') {
      await route.continue();
      return;
    }
    injected = true;
    const response = await route.fetch();
    const body = await response.json();
    assert.ok(body.events.length > 0);
    await route.fulfill({
      response,
      json: {
        ...body,
        events: [body.events[0], body.events[0]],
        total: 2,
      },
    });
  });

  await addSearchFilter(page, 'kind', kind);
  await page.waitForFunction(() => (
    document.querySelector('#stateLine')?.dataset.state === 'error'
      && document.querySelector('#stateLine')?.textContent.includes('Timeline event state invariant')
  ));
  assert.equal(injected, true);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150);
  const rejected = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1));
  assert.equal(rejected.arrayLength, before.arrayLength);
  assert.equal(rejected.mapSize, before.mapSize);
  assert.equal(rejected.uniqueIdCount, before.uniqueIdCount);
  assert.equal(rejected.objectIdentityParity, true);
  assert.equal(rejected.committedContextBound, true);
  assert.equal(rejected.offsetMatches, true);
  assert.equal(rejected.pendingReplacement, true);
  assert.equal(rejected.parityPassed, true);

  const retryResponse = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return requestUrl.pathname.endsWith('/timeline')
      && requestUrl.searchParams.get('kind') === kind
      && requestUrl.searchParams.get('offset') === '0';
  });
  await page.locator('#loadMoreBtn').click();
  await retryResponse;
  await page.waitForFunction(() => (
    window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false
      && window.__wave1aM3.evidence.snapshots.at(-1)?.parityPassed === true
  ));
  const recovered = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1));
  assert.equal(recovered.arrayLength, recovered.mapSize);
  assert.equal(recovered.arrayLength, recovered.uniqueIdCount);
});

test('Wave 1A M3 browser prevents a delayed stale Layer response from publishing', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 320 });
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM3BrowserSeam,
  });
  const staleStarted = deferred();
  const staleRelease = deferred();
  const failures = [];
  page.on('requestfailed', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.endsWith('/timeline') && requestUrl.searchParams.get('layer') === 'protocol') {
      failures.push(request.url());
    }
  });
  await page.route('**/api/sessions/*/timeline?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('layer') === 'protocol' && requestUrl.searchParams.get('offset') === '0') {
      staleStarted.resolve();
      await staleRelease.promise;
    }
    try {
      await route.continue();
    } catch {
      // The superseded protocol request is intentionally gone.
    }
  });
  t.after(() => staleRelease.resolve());

  await page.locator('#layerSelect').selectOption('protocol');
  await staleStarted.promise;
  await page.locator('#layerSelect').selectOption('raw');
  await page.waitForFunction(() => (
    document.querySelector('#layerSelect')?.value === 'raw'
      && window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false
      && window.__wave1aM3.evidence.snapshots.at(-1)?.parityPassed === true
  ));
  const rawSnapshot = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1));
  staleRelease.resolve();
  await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'raw');
  assert.equal(failures.length, 1);
  assert.deepEqual(await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1)), rawSnapshot);
  assert.equal(rawSnapshot.arrayLength, rawSnapshot.mapSize);
  assert.equal(rawSnapshot.arrayLength, rawSnapshot.uniqueIdCount);
});

test('Wave 1A M3 browser keeps a Code Mode context row outside the canonical Map', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const nested = session.logicalEvents.find((candidate) => candidate.toolName === 'nested-context-token');
  assert.ok(nested);
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: installWave1aM3BrowserSeam,
  });
  await addSearchFilter(page, 'status', 'failed');
  await page.waitForFunction((nestedId) => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return cards.length === 1 && cards[0].dataset.eventId === nestedId;
  }, nested.id);
  await page.locator('#searchAssistClose').click();
  const before = await page.evaluate(() => structuredClone(window.__wave1aM3.evidence.snapshots.at(-1)));
  assert.equal(before.arrayLength, 1);
  assert.equal(before.mapSize, 1);
  assert.equal(before.parityPassed, true);

  await page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="reveal-context-parent"]`).click();
  await page.waitForSelector('.contextRevealRow');
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 1);
  assert.equal(await page.locator('.contextRevealRow').count(), 1);
  assert.deepEqual(await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1)), before);
});

test('Wave 1A M3 browser keeps true temporary-event enclosing affordances on the indexed Map seam', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((candidate) => candidate.toolName === 'nested-context-token');
  assert.ok(operation && nested);
  const temporaryEventId = 'wave-1a-true-temporary-event';
  const temporaryParentId = 'wave-1a-true-temporary-parent';
  const parentStarted = deferred();
  const parentRelease = deferred();
  t.after(() => parentRelease.resolve());

  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await installWave1bM2SourceBundle(targetPage);
      await installWave1cM1BrowserSeam(targetPage);
      await installWave1aM3BrowserSeam(targetPage);
      await targetPage.route('**/api/sessions/*/events/**', async (route) => {
        const requestUrl = new URL(route.request().url());
        const decodedPath = decodeURIComponent(requestUrl.pathname);
        const fetchActualEvent = async (actualEventId, requestedEventId) => {
          const actualUrl = new URL(requestUrl);
          actualUrl.pathname = requestUrl.pathname.replace(
            encodeURIComponent(requestedEventId),
            encodeURIComponent(actualEventId),
          );
          const response = await route.fetch({ url: actualUrl.href });
          assert.equal(response.ok(), true);
          return { response, body: await response.json() };
        };

        if (decodedPath.endsWith(`/events/${operation.id}/detail`)) {
          const response = await route.fetch();
          const body = await response.json();
          const refs = [...(body.timelineSections || []), ...(body.inspectorSections || [])]
            .find((section) => section.type === 'event_refs');
          assert.ok(refs?.items?.length, 'Code Mode detail must expose its nested event reference');
          refs.items[0] = {
            ...refs.items[0],
            id: temporaryEventId,
            label: 'True temporary nested activity',
          };
          await route.fulfill({ response, json: body });
          return;
        }
        if (decodedPath.endsWith(`/events/${temporaryEventId}`)) {
          const { response, body } = await fetchActualEvent(nested.id, temporaryEventId);
          await targetPage.evaluate(() => window.__wave1aM3.resetOperations());
          await route.fulfill({
            response,
            json: {
              ...body,
              id: temporaryEventId,
              presentationContext: {
                relation: 'enclosed_by_code_mode_operation',
                codeModeParentId: temporaryParentId,
              },
            },
          });
          return;
        }
        if (decodedPath.endsWith(`/events/${temporaryParentId}`)) {
          const { response, body } = await fetchActualEvent(operation.id, temporaryParentId);
          parentStarted.resolve();
          await parentRelease.promise;
          await route.fulfill({ response, json: { ...body, id: temporaryParentId } });
          return;
        }
        await route.continue();
      });
    },
  });

  const before = await page.evaluate(() => structuredClone(window.__wave1aM3.evidence.snapshots.at(-1)));
  assert.equal(before.parityPassed, true);
  await page.locator(`#timeline .event[data-event-id="${operation.id}"]`).click();
  const eventRef = page.locator(`#detail [data-event-ref-id="${temporaryEventId}"], #detail [data-target-event-id="${temporaryEventId}"]`);
  await eventRef.waitFor();
  await page.evaluate(() => window.__wave1cM1.reset());
  await eventRef.click();

  const temporaryCard = page.locator(`#timeline .event[data-event-id="${temporaryEventId}"]`);
  await temporaryCard.waitFor();
  await page.waitForFunction((eventId) => (
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`)
      ?.classList.contains('selected')
  ), temporaryEventId);
  assert.equal(await temporaryCard.getAttribute('class').then((value) => value.includes('temporaryReferenceReveal')), true);
  assert.equal(await temporaryCard.locator('.temporaryReferenceChip').count(), 1);
  assert.equal(await page.evaluate(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'temporaryRevealRevision',
  )), true);
  assert.ok((await latestWave1cM1Lifecycle(page))
    .mountedPresentationToken.temporaryRevealRevision > 0);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), before.arrayLength + 1);
  assert.deepEqual(await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1)), before);

  const affordance = temporaryCard.locator('[data-action="reveal-context-parent"]');
  assert.equal(await affordance.isHidden(), false, 'selection must reveal the temporary card affordance');
  assert.equal(await affordance.getAttribute('aria-hidden'), 'false');
  assert.equal(await affordance.isDisabled(), false);
  const afterTemporaryRender = await page.evaluate(() => structuredClone(window.__wave1aM3.evidence));
  assert.deepEqual(afterTemporaryRender.lookups[0], {
    purpose: 'canonical',
    backend: 'map',
    lookupRequests: 1,
    mapGets: 1,
    arrayComparisons: 0,
  }, 'a layer-aware reference first checks canonical membership through the indexed get');
  assert.ok(afterTemporaryRender.lookups.some((lookup) => lookup.purpose === 'canonical'
    && lookup.backend === 'map' && lookup.lookupRequests === 1 && lookup.mapGets === 0 && lookup.arrayComparisons === 0),
  'renderTimeline still checks temporary membership through Map has without scanning the canonical array');

  await affordance.click();
  await parentStarted.promise;
  assert.equal(await affordance.isHidden(), false);
  assert.equal(await affordance.getAttribute('aria-hidden'), 'false');
  assert.equal(await affordance.isDisabled(), true, 'pending context reveal must disable the temporary card affordance');
  assert.deepEqual(await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1)), before);
  parentRelease.resolve();
  await page.waitForSelector('.contextRevealRow');
  await page.waitForFunction((eventId) => !document.querySelector(
    `#timeline .event[data-event-id="${CSS.escape(eventId)}"] [data-action="reveal-context-parent"]`,
  )?.disabled, temporaryEventId);

  const operations = await page.evaluate(() => {
    const evidence = window.__wave1aM3.evidence;
    const enclosingLookups = evidence.lookups.filter((item) => item.purpose === 'enclosingAffordance');
    const enclosingCards = evidence.cardIterations.filter((item) => item.purpose === 'enclosingAffordance');
    return {
      cardIterations: enclosingCards.reduce((total, item) => total + item.cardIterations, 0),
      lookupRequests: enclosingLookups.reduce((total, item) => total + item.lookupRequests, 0),
      mapGets: enclosingLookups.reduce((total, item) => total + item.mapGets, 0),
      arrayComparisons: evidence.lookups.reduce((total, item) => total + item.arrayComparisons, 0),
      backends: [...new Set(enclosingLookups.map((item) => item.backend))],
      snapshot: structuredClone(evidence.snapshots.at(-1)),
    };
  });
  assert.ok(operations.cardIterations > 0);
  assert.equal(operations.lookupRequests, operations.cardIterations);
  assert.equal(operations.mapGets, operations.cardIterations);
  assert.equal(operations.arrayComparisons, 0);
  assert.deepEqual(operations.backends, ['map']);
  assert.deepEqual(operations.snapshot, before, 'temporary and context rows must not mutate canonical parity or size');
});

test('Wave 1A M3 browser distinguishes retained query replacement from full locale, project, and revision resets', async (t) => {
  const { index } = await makeTransitionProfileIndex(t, { eventCount: 320 });
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await installWave1bM2SourceBundle(targetPage);
      await installWave1cM1BrowserSeam(targetPage);
      await installWave1aM3BrowserSeam(targetPage);
    },
  });
  const assertLatestParity = async () => {
    const snapshot = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.at(-1));
    assert.equal(snapshot.arrayLength, snapshot.mapSize);
    assert.equal(snapshot.arrayLength, snapshot.uniqueIdCount);
    assert.equal(snapshot.objectIdentityParity, true);
    assert.equal(snapshot.committedContextBound, true);
    assert.equal(snapshot.offsetMatches, true);
    assert.equal(snapshot.pendingReplacement, false);
    assert.equal(snapshot.backend, 'map');
    assert.equal(snapshot.parityPassed, true);
    return snapshot;
  };

  let beforeSnapshots = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.length);
  const queryResponse = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return requestUrl.pathname.endsWith('/timeline')
      && requestUrl.searchParams.get('q') === 'far-needle'
      && requestUrl.searchParams.get('offset') === '0';
  });
  await fillSearch(page, 'far-needle');
  await queryResponse;
  await page.waitForFunction((count) => (
    window.__wave1aM3.evidence.snapshots.length > count
      && window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false
  ), beforeSnapshots);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false);
  await assertLatestParity();

  beforeSnapshots = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.length);
  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction((count) => (
    document.documentElement.lang === 'zh-CN'
      && window.__wave1aM3.evidence.snapshots.length > count
      && window.__wave1aM3.evidence.snapshots.at(-1)?.arrayLength > 0
      && window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false
  ), beforeSnapshots);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false);
  await assertLatestParity();
  const localeSnapshots = await page.evaluate((start) => window.__wave1aM3.evidence.snapshots.slice(start), beforeSnapshots);
  assert.ok(localeSnapshots.some((snapshot) => (
    snapshot.arrayLength === 0 && snapshot.mapSize === 0 && snapshot.parityPassed
  )), `locale reload through loadSessions must retire the prior Session pair: ${JSON.stringify(localeSnapshots)}`);

  beforeSnapshots = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.length);
  await page.locator('#projectRefreshBtn').click();
  await page.waitForFunction((count) => (
    document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false'
      && window.__wave1aM3.evidence.snapshots.length > count
      && window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false
  ), beforeSnapshots);
  await assertLatestParity();
  assert.ok((await page.evaluate((start) => window.__wave1aM3.evidence.snapshots.slice(start), beforeSnapshots)).some((snapshot) => (
    snapshot.arrayLength === 0 && snapshot.mapSize === 0 && snapshot.parityPassed
  )), 'project replacement must retire the prior committed pair');

  let mismatchPending = true;
  let suggestionRequests = 0;
  let protocolTimelineResponses = 0;
  const secondSuggestion = deferred();
  const secondProtocolTimeline = deferred();
  page.on('response', (response) => {
    const requestUrl = new URL(response.url());
    if (requestUrl.pathname.endsWith('/timeline') && requestUrl.searchParams.get('layer') === 'protocol') {
      protocolTimelineResponses += 1;
      if (protocolTimelineResponses === 2) secondProtocolTimeline.resolve();
    }
  });
  await page.route('**/api/file-suggestions*', async (route) => {
    suggestionRequests += 1;
    if (suggestionRequests === 2) secondSuggestion.resolve();
    const response = await route.fetch();
    const body = await response.json();
    if (mismatchPending) {
      mismatchPending = false;
      await route.fulfill({ response, json: { ...body, indexRevision: body.indexRevision + 1 } });
      return;
    }
    await route.fulfill({ response, json: body });
  });
  beforeSnapshots = await page.evaluate(() => window.__wave1aM3.evidence.snapshots.length);
  await page.evaluate(() => {
    window.__wave1cM1RevisionRecoveryArticle = document.querySelector('#timeline .event[data-event-id]');
    window.__wave1cM1.reset();
  });
  await page.locator('#layerSelect').selectOption('protocol');
  await Promise.all([secondSuggestion.promise, secondProtocolTimeline.promise]);
  await page.waitForFunction((count) => (
    window.__wave1aM3.evidence.snapshots.length > count
      && window.__wave1aM3.evidence.snapshots.at(-1)?.pendingReplacement === false
      && window.__wave1aM3.evidence.snapshots.at(-1)?.parityPassed === true
  ), beforeSnapshots);
  assert.equal(mismatchPending, false);
  assert.equal(suggestionRequests, 2);
  await assertLatestParity();
  assert.ok((await page.evaluate((start) => window.__wave1aM3.evidence.snapshots.slice(start), beforeSnapshots)).some((snapshot) => (
    snapshot.arrayLength === 0 && snapshot.mapSize === 0 && snapshot.parityPassed
  )), 'revision recovery must make prior entries unreachable before rebuilding');
  assert.equal(await page.evaluate(() => window.__wave1cM1RevisionRecoveryArticle.isConnected), false);
  assert.equal(await page.evaluate(() => window.__wave1cM1.evidence.lifecycle.some((snapshot) => (
    snapshot.mode === 'non-main' && snapshot.ownerCount === 0
  ))), true, 'revision recovery root replacement must not retain a retired Main owner');
});
