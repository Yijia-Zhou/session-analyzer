'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { chromium } = require('playwright');
const { analyzerSessionId, buildClaudeSourceBackedIndex } = require('../src/claude');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
} = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { createServer } = require('../server');
const { createTimelineProfileFixture } = require('../scripts/timeline-profile-fixture');
const { suggestionRequestEvidence } = require('../scripts/timeline-profile');

const fixtureCodexHome = path.join(__dirname, '..', 'test', 'fixtures', 'codex-home');
const repoRoot = 'G:\\vibe\\term-agent';
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';
let wave1bM2SourceBundlePromise;

function wave1bM2SourceBundle() {
  if (!wave1bM2SourceBundlePromise) {
    wave1bM2SourceBundlePromise = esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'src', 'browser', 'entry.js')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      sourcemap: false,
      splitting: false,
      minify: true,
      logLevel: 'silent',
      write: false,
    }).then((result) => result.outputFiles[0].text);
  }
  return wave1bM2SourceBundlePromise;
}

async function installWave1bM2SourceBundle(page) {
  const body = await wave1bM2SourceBundle();
  await page.route('**/assets/app.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body,
  }));
}

async function installWave1bM2BrowserSeam(page) {
  await page.addInitScript(() => {
    const evidence = { renderCardCounts: [] };
    window.__wave1bM2 = {
      evidence,
      resetRenders() { evidence.renderCardCounts.length = 0; },
    };
    document.addEventListener('DOMContentLoaded', () => {
      const timeline = document.querySelector('#timeline');
      if (!timeline) return;
      new MutationObserver(() => {
        evidence.renderCardCounts.push(
          timeline.querySelectorAll('.event[data-event-id]').length,
        );
      }).observe(timeline, { childList: true });
    }, { once: true });
  });
}

async function installWave1cM1BrowserSeam(page) {
  await page.addInitScript(() => {
    const evidence = {
      lifecycle: [],
      revisions: [],
    };
    window.__wave1cM1 = {
      evidence,
      reset() {
        evidence.lifecycle.length = 0;
        evidence.revisions.length = 0;
      },
    };
    window.__sessionAnalyzerTimelineLifecycleObserver = {
      recordLifecycle(value) {
        evidence.lifecycle.push(structuredClone(value));
      },
      recordRevision(value) {
        evidence.revisions.push(structuredClone(value));
      },
    };
  });
}

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

async function installWave1dAM1BrowserSeam(page) {
  await page.addInitScript(() => {
    const evidence = {
      detailRequests: [],
      detailBodies: [],
      visibleScans: [],
      lifecycle: [],
      revisions: [],
      detailRequestTransactionAssociations: 0,
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

async function installWave1cM2MutationLedger(page) {
  await page.addInitScript(() => {
    const evidence = { rows: [] };
    let activeOperationId = 0;
    let nextOperationId = 1;
    let sequence = 0;
    window.__wave1cM2 = {
      evidence,
      beginOperation() {
        activeOperationId = nextOperationId;
        nextOperationId += 1;
        return activeOperationId;
      },
      endOperation() { activeOperationId = 0; },
      reset() { evidence.rows.length = 0; },
    };
    document.addEventListener('DOMContentLoaded', () => {
      const timeline = document.querySelector('#timeline');
      if (!timeline) return;
      const directCanonicalCards = (nodes) => [...nodes].filter((node) => (
        node.nodeType === Node.ELEMENT_NODE
          && node.matches('.event[data-event-id]:not(.temporaryReferenceReveal)')
      ));
      let canonicalById = new Map(
        directCanonicalCards(timeline.children).map((node) => [node.dataset.eventId, node]),
      );
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.target !== timeline || record.type !== 'childList') continue;
          const preCanonical = new Map(canonicalById);
          const removedCards = directCanonicalCards(record.removedNodes);
          const addedCards = directCanonicalCards(record.addedNodes);
          for (const node of removedCards) {
            if (canonicalById.get(node.dataset.eventId) === node) {
              canonicalById.delete(node.dataset.eventId);
            }
          }
          const addedIdsAbsentFromPreState = addedCards.every((node) => (
            !preCanonical.has(node.dataset.eventId)
          ));
          for (const node of addedCards) canonicalById.set(node.dataset.eventId, node);
          const everyPreExistingNodePreserved = [...preCanonical].every(([eventId, node]) => (
            canonicalById.get(eventId) === node
          ));
          const preCanonicalCount = preCanonical.size;
          const removedCanonicalCount = removedCards.length;
          const addedCanonicalCount = addedCards.length;
          const finalCanonicalCount = canonicalById.size;
          let commitKind = 'other';
          if (preCanonicalCount === 0
              && removedCanonicalCount === 0
              && addedCanonicalCount > 0
              && finalCanonicalCount === addedCanonicalCount) {
            commitKind = 'initialMount';
          } else if (preCanonicalCount > 0
              && removedCanonicalCount === 0
              && addedCanonicalCount > 0
              && addedIdsAbsentFromPreState
              && everyPreExistingNodePreserved
              && finalCanonicalCount === preCanonicalCount + addedCanonicalCount) {
            commitKind = 'appendOnly';
          } else if (preCanonicalCount > 0
              && removedCanonicalCount > 0
              && addedCanonicalCount === 0
              && finalCanonicalCount === 0) {
            commitKind = 'clear';
          } else if (removedCanonicalCount > 0 && finalCanonicalCount > 0) {
            commitKind = 'replacement';
          }
          sequence += 1;
          evidence.rows.push({
            sequence,
            operationId: activeOperationId,
            commitKind,
            preCanonicalCount,
            removedCanonicalCount,
            addedCanonicalCount,
            finalCanonicalCount,
            addedIdsAbsentFromPreState,
            everyPreExistingNodePreserved,
          });
        }
      }).observe(timeline, { childList: true });
    }, { once: true });
  });
}

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function buildFixtureIndex() {
  return buildIndex({ repoRoot, codexHome: fixtureCodexHome });
}

async function materializeIndexedSession(index, sessionId = index.sessions[0]?.id) {
  const indexedSession = index.sessionsById.get(sessionId);
  assert.ok(indexedSession, `expected indexed session ${sessionId}`);
  return materializeSessionForIndex(index, indexedSession);
}

async function startServer(t, index, options = {}) {
  const server = createServer(index, 1, {
    codexHome: index.codexHome,
    ...(options.skipProjectReindex ? {} : { repo: index.repoRoot }),
    sessionPrewarm: Object.hasOwn(options, 'sessionPrewarm')
      ? options.sessionPrewarm
      : false,
    ...(options.serverOptions || {}),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function openApp(t, index, options = {}) {
  const baseUrl = await startServer(t, index, options);
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
  if (options.beforeGoto) await options.beforeGoto(page);
  await page.goto(baseUrl);
  assert.ok(requestedPaths.includes('/assets/app.js'), 'browser should load the generated app bundle');
  for (const oldScript of ['/app.js', '/renderers.js', '/folding.js', '/command-highlighting.js', '/search-query.js', '/search-controls.js', '/highlight.js', '/navigation.js', '/event-chips.js']) {
    assert.equal(requestedPaths.includes(oldScript), false, `browser should not load old source script ${oldScript}`);
  }
  await page.waitForFunction(() => window.sessionFolding && window.sessionRenderers && window.sessionSearchControls);
  await page.waitForSelector('.sessionItem.active', { state: options.activeSessionState || 'visible' });
  if (options.expectTimeline !== false) {
    await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length > 0);
  }
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing !== 'true');
  return { page, baseUrl, requestedPaths, requestedUrls };
}

async function openWave1bM2App(t, index, options = {}) {
  const callerBeforeGoto = options.beforeGoto;
  return openApp(t, index, {
    ...options,
    beforeGoto: async (page) => {
      await installWave1bM2SourceBundle(page);
      await installWave1bM2BrowserSeam(page);
      if (callerBeforeGoto) await callerBeforeGoto(page);
    },
  });
}

async function openWave1cM1App(t, index, options = {}) {
  const callerBeforeGoto = options.beforeGoto;
  return openApp(t, index, {
    ...options,
    beforeGoto: async (page) => {
      await installWave1bM2SourceBundle(page);
      await installWave1cM1BrowserSeam(page);
      if (callerBeforeGoto) await callerBeforeGoto(page);
    },
  });
}

async function openWave1cM2App(t, index, options = {}) {
  const callerBeforeGoto = options.beforeGoto;
  return openApp(t, index, {
    ...options,
    beforeGoto: async (page) => {
      await installWave1bM2SourceBundle(page);
      await installWave1cM1BrowserSeam(page);
      await installWave1cM2MutationLedger(page);
      if (callerBeforeGoto) await callerBeforeGoto(page);
    },
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

async function beginWave1cM2Operation(page) {
  return page.evaluate(() => {
    window.__wave1cM2.reset();
    return window.__wave1cM2.beginOperation();
  });
}

async function endWave1cM2Operation(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    window.__wave1cM2.endOperation();
    resolve();
  })));
}

async function wave1cM2OperationRows(page, operationId) {
  await endWave1cM2Operation(page);
  return page.evaluate((id) => (
    window.__wave1cM2.evidence.rows.filter((row) => row.operationId === id)
  ), operationId);
}

async function latestWave1cM1Lifecycle(page) {
  return page.evaluate(() => structuredClone(window.__wave1cM1.evidence.lifecycle.at(-1)));
}

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

async function openSourceSwitchChooser(t, options = {}) {
  const server = createServer(null, 0, {
    source: 'codex',
    codexHome: fixtureCodexHome,
    claudeHome: path.join(os.tmpdir(), 'session-analyzer-unused-claude'),
    ...options.server,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const storageEntries = {
    'sessionAnalyzer.locale': options.locale || 'en',
    ...(options.localStorage || {}),
  };
  await context.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, value);
    }
  }, storageEntries);
  const page = await context.newPage();
  page.on('pageerror', (error) => assert.fail(error.stack || error.message));
  t.after(async () => {
    await context.close();
    await browser.close();
  });
  if (options.beforeGoto) await options.beforeGoto(page);
  await page.goto(baseUrl);
  await page.waitForFunction(() => !document.querySelector('#projectSourceSwitch')?.hidden);
  return { page, baseUrl };
}

async function makeClaudeSwitchFixture(t) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-source-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-switch-fixture');
  const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const record = (fields) => ({
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: claudeRepo,
    sessionId,
    version: '2.1.220',
    ...fields,
  });
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    record({
      type: 'user',
      parentUuid: null,
      uuid: 'switch-browser-user',
      timestamp: '2026-08-07T12:00:00.000Z',
      message: { role: 'user', content: 'Switch browser task' },
    }),
    record({
      type: 'assistant',
      parentUuid: 'switch-browser-user',
      uuid: 'switch-browser-assistant',
      timestamp: '2026-08-07T12:00:01.000Z',
      message: {
        id: 'switch-browser-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Switch browser answer' }],
      },
    }),
  ]);
  return { claudeHome, claudeRepo, sessionId };
}

async function confirmSourceAction(page, expectedLabel) {
  await page.waitForFunction((label) => document.querySelector('#projectSourceAction')?.textContent === label, expectedLabel);
  await page.locator('#projectSourceAction').click();
}

async function waitForProjectRoot(page, repoRootPath) {
  await page.waitForFunction((root) => (
    [...document.querySelectorAll('.projectItem[data-project-root]')].some((item) => item.dataset.projectRoot === root)
  ), repoRootPath);
}

async function switchHiddenLocale(page, locale) {
  await page.evaluate((nextLocale) => {
    const select = document.querySelector('#localeSelect');
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

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function makeMaterializedCodexForkFixture(t, options = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-materialized-browser-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const fixtureRepo = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '09');
  const parentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const derivedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await fsp.mkdir(fixtureRepo, { recursive: true });
  const timestamp = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();
  const parentRecords = [
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 0), type: 'session_meta', payload: { id: parentId, cwd: fixtureRepo } },
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inherited browser task' }] } },
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 2), type: 'event_msg', payload: { type: 'user_message', message: 'Inherited browser task', images: [], local_images: [], text_elements: [] } },
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 3), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Inherited browser answer' }] } },
    ...Array.from({ length: 160 }, (_, index) => ({
      timestamp: timestamp('2026-08-09T10:00:00.000Z', index + 4),
      type: 'turn_context',
      payload: { turn_id: `parent-turn-${index}`, cwd: fixtureRepo, marker: `parent-context-${index}` },
    })),
  ];
  const childRecords = [
    { timestamp: '2026-08-09T10:10:00.000Z', type: 'session_meta', payload: { id: childId, forked_from_id: parentId, cwd: fixtureRepo, thread_source: 'user' } },
    ...parentRecords.map((record, index) => ({ ...structuredClone(record), timestamp: timestamp('2026-08-09T09:00:00.000Z', index) })),
    { timestamp: '2026-08-09T10:11:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Own browser continuation' }] } },
    { timestamp: '2026-08-09T10:11:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Own browser continuation', images: [], local_images: [], text_elements: [] } },
    { timestamp: '2026-08-09T10:11:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Own browser answer' }] } },
  ];
  await writeJsonl(path.join(sessionDir, `rollout-parent-${parentId}.jsonl`), parentRecords);
  await writeJsonl(path.join(sessionDir, `rollout-child-${childId}.jsonl`), childRecords);
  if (options.derived) {
    await writeJsonl(path.join(sessionDir, `rollout-derived-${derivedId}.jsonl`), [
      {
        timestamp: '2026-08-09T10:12:00.000Z',
        type: 'session_meta',
        payload: {
          id: derivedId,
          forked_from_id: childId,
          cwd: fixtureRepo,
          source: { subagent: { thread_spawn: { parent_thread_id: childId, agent_nickname: 'Fixture' } } },
          agent_nickname: 'Fixture',
        },
      },
      { timestamp: '2026-08-09T10:12:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Derived browser task' } },
    ]);
  }
  const index = await buildIndex({ repoRoot: fixtureRepo, codexHome });
  return { index, parentId, childId, derivedId };
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

async function addSearchFilter(page, key, value) {
  await page.locator('#searchFilterBtn').click();
  const control = page.locator(`[data-search-filter-control="${key}"]`);
  if (key === 'file') {
    await control.fill(value);
    await control.press('Enter');
  } else {
    await control.selectOption(value);
  }
  await page.waitForFunction(
    ({ key: filterKey, value: filterValue }) => document.querySelector(`[data-search-filter-control="${filterKey}"]`)?.value === filterValue,
    { key, value },
  );
}

async function clearAllSearch(page) {
  await page.locator('#searchFilterBtn').click();
  await page.locator('#searchClearAllBtn').click();
  await expectInputValue(page, '#searchInput', '');
}

async function switchToProjectScope(page) {
  await page.locator('#searchHudScope').click();
  await page.locator('#searchAssist').getByRole('button', { name: 'Entire project' }).click();
  await page.waitForFunction(() => document.body.dataset.searchScope === 'project');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Search the entire project');
}

async function waitForProjectCards(page, minimum = 1) {
  await page.waitForFunction((count) => document.querySelectorAll('[data-project-result-session-id]').length >= count, minimum);
}

async function waitForSearchMarks(page, minimum = 1) {
  await page.waitForFunction((count) => document.querySelectorAll('.searchMark').length >= count, minimum);
}

async function waitForNoSearchMarks(page) {
  await page.waitForFunction(() => document.querySelectorAll('.searchMark').length === 0);
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

async function searchNavigationSnapshot(page) {
  return page.evaluate(() => {
    const label = document.querySelector('.searchInlineCount')?.textContent || '';
    const match = label.match(/^(\d+) \/ (\d+)/);
    const active = document.querySelector('.searchMark.activeSearchMark');
    const metrics = document.querySelector('#searchMetricsPanel');
    const ids = JSON.parse(metrics?.dataset.searchTargetIds || '[]');
    const activeId = metrics?.dataset.searchActiveTargetId || '';
    const bindings = ids.map((id) => {
      const nodes = [...document.querySelectorAll('[data-search-target-id]')]
        .filter((node) => node.dataset.searchTargetId === id);
      return {
        id,
        ownerId: JSON.parse(id).at(-1),
        surfaces: [...new Set(nodes.map((node) => node.dataset.searchTargetSurface))].sort(),
        live: nodes.length > 0,
      };
    });
    return {
      current: Number(match?.[1] || 0),
      total: Number(match?.[2] || 0),
      id: activeId,
      surface: active?.dataset.searchTargetSurface || '',
      ownerId: active?.dataset.searchTargetOwner || (activeId ? JSON.parse(activeId).at(-1) : ''),
      ids,
      bindings,
    };
  });
}

async function clickSearchNavigationAndWait(page, direction, previousId) {
  await page.locator(`.searchInlineMatches [data-search-match-nav="${direction}"]`).click();
  await page.waitForFunction((id) => (
    Boolean(document.querySelector('#searchMetricsPanel')?.dataset.searchActiveTargetId)
      && document.querySelector('#searchMetricsPanel')?.dataset.searchActiveTargetId !== id
  ), previousId);
  return searchNavigationSnapshot(page);
}

async function waitForDetailView(page, type) {
  await page.waitForFunction((expected) => document.body.dataset.detailView === expected, type);
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
  if (options.includeFoldableSearchTargets) {
    for (let i = 0; i < 3; i += 1) {
      rows.push(
        {
          timestamp: `2026-06-11T09:00:0${i + 1}.100Z`,
          type: 'event_msg',
          payload: {
            type: 'exec_command_begin',
            call_id: `call-foldable-${i}`,
            command: ['powershell.exe', '-Command', `Write-Output ordinary-${i}`],
            cwd: longRepoRoot,
          },
        },
        {
          timestamp: `2026-06-11T09:00:0${i + 1}.200Z`,
          type: 'event_msg',
          payload: {
            type: 'exec_command_end',
            call_id: `call-foldable-${i}`,
            command: ['powershell.exe', '-Command', `Write-Output ordinary-${i}`],
            cwd: longRepoRoot,
            stdout: `fold only target ${i} ${'ordinary output '.repeat(80)}fold only target ${i}`,
            stderr: '',
            exit_code: 0,
            status: 'completed',
          },
        },
      );
    }
  }
  const eventCount = options.eventCount || 180;
  const needleText = Array.from({ length: options.needleRepeats || 1 }, () => 'needle').join(' ');
  const needleIndices = Array.isArray(options.needleIndices) ? new Set(options.needleIndices) : null;
  for (let i = 0; i < eventCount; i += 1) {
    rows.push({
      timestamp: `2026-06-11T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      type: 'response_item',
      payload: {
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Long timeline row ${i} ${(needleIndices ? needleIndices.has(i) : i % 17 === 0) ? needleText : 'ordinary'}` }],
      },
    });
  }
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { sourceKind: 'codex', codexHome, repoRoot: longRepoRoot, sessionId };
}

async function makeCacheObservationBrowserFixture(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-cache-browser-'));
  const cacheRepoRoot = path.join(codexHome, 'repo');
  const dir = path.join(codexHome, 'sessions', '2026', '09', '03');
  const discontinuitySessionId = 'abababab-3333-4333-8333-abababababab';
  const ordinarySessionId = 'cdcdcdcd-3333-4333-8333-cdcdcdcdcdcd';
  const singleSessionId = 'efefefef-3333-4333-8333-efefefefefef';
  const codeModeSessionId = 'acacacac-3333-4333-8333-acacacacacac';
  await fsp.mkdir(cacheRepoRoot, { recursive: true });
  const timestamp = (seconds) => new Date(Date.parse('2026-09-03T10:00:00.000Z') + seconds * 1_000).toISOString();
  const tokenCount = (seconds, inputTokens, cachedInputTokens, outputTokens) => ({
    timestamp: timestamp(seconds),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: inputTokens,
          cached_input_tokens: cachedInputTokens,
          output_tokens: outputTokens,
        },
        total_token_usage: {
          input_tokens: 9_999_999,
          cached_input_tokens: 9_999_999,
          output_tokens: 9_999_999,
        },
      },
    },
  });
  const padding = Array.from({ length: 151 }, (_, index) => ({
    timestamp: timestamp(index + 2),
    type: 'turn_context',
    payload: {
      turn_id: 'turn-cache-browser',
      cwd: cacheRepoRoot,
      model: 'gpt-cache-browser',
      fixture_index: index,
    },
  }));
  await writeJsonl(path.join(dir, `cache-${discontinuitySessionId}.jsonl`), [
    {
      timestamp: timestamp(0),
      type: 'session_meta',
      payload: { id: discontinuitySessionId, cwd: cacheRepoRoot },
    },
    {
      timestamp: timestamp(1),
      type: 'event_msg',
      payload: { type: 'turn_started', turn_id: 'turn-cache-browser' },
    },
    ...padding,
    tokenCount(154, 16_384, 16_384, 233),
    {
      timestamp: timestamp(155),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Synthetic cache browser anchor' }],
      },
    },
    tokenCount(168, 12_288, 0, 589),
    tokenCount(169, 24_576, 24_576, 377),
    tokenCount(171, 18_432, 0, 610),
    {
      timestamp: timestamp(172),
      type: 'event_msg',
      payload: { type: 'turn_complete', turn_id: 'turn-cache-browser' },
    },
  ]);
  await writeJsonl(path.join(dir, `ordinary-${ordinarySessionId}.jsonl`), [
    {
      timestamp: timestamp(-100),
      type: 'session_meta',
      payload: { id: ordinarySessionId, cwd: cacheRepoRoot },
    },
    {
      timestamp: timestamp(-99),
      type: 'event_msg',
      payload: { type: 'turn_started', turn_id: 'turn-cache-ordinary' },
    },
    tokenCount(-98, 16_384, 16_384, 200),
    {
      timestamp: timestamp(-97),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Synthetic ordinary cache usage' }],
      },
    },
    tokenCount(-96, 17_000, 16_000, 250),
    {
      timestamp: timestamp(-95),
      type: 'event_msg',
      payload: { type: 'turn_complete', turn_id: 'turn-cache-ordinary' },
    },
  ]);
  await writeJsonl(path.join(dir, `single-${singleSessionId}.jsonl`), [
    {
      timestamp: timestamp(200),
      type: 'session_meta',
      payload: { id: singleSessionId, cwd: cacheRepoRoot },
    },
    {
      timestamp: timestamp(201),
      type: 'event_msg',
      payload: { type: 'turn_started', turn_id: 'turn-cache-single' },
    },
    tokenCount(202, 16_384, 16_384, 200),
    {
      timestamp: timestamp(203),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Synthetic single discontinuity anchor' }],
      },
    },
    tokenCount(204, 12_288, 0, 250),
    {
      timestamp: timestamp(205),
      type: 'event_msg',
      payload: { type: 'turn_complete', turn_id: 'turn-cache-single' },
    },
  ]);
  await writeJsonl(path.join(dir, `code-mode-${codeModeSessionId}.jsonl`), [
    {
      timestamp: timestamp(300),
      type: 'session_meta',
      payload: { id: codeModeSessionId, cwd: cacheRepoRoot },
    },
    {
      timestamp: timestamp(301),
      type: 'event_msg',
      payload: { type: 'turn_started', turn_id: 'turn-cache-code-mode' },
    },
    tokenCount(302, 16_384, 16_384, 200),
    {
      timestamp: timestamp(303),
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'exec-cache-navigation',
        turn_id: 'turn-cache-code-mode',
        input: "const result = await tools.exec_command({ cmd: 'Write-Output cache-navigation' }); text(result);",
      },
    },
    {
      timestamp: timestamp(304),
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-cache-navigation',
        turn_id: 'turn-cache-code-mode',
        output: 'Script completed\nExit code: 0\nOutput:\ncache-navigation',
      },
    },
    tokenCount(305, 12_288, 0, 250),
    {
      timestamp: timestamp(306),
      type: 'event_msg',
      payload: { type: 'turn_complete', turn_id: 'turn-cache-code-mode' },
    },
  ]);
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const index = await buildIndex({ repoRoot: cacheRepoRoot, codexHome });
  return {
    codexHome,
    index,
    repoRoot: cacheRepoRoot,
    discontinuitySessionId,
    ordinarySessionId,
    singleSessionId,
    codeModeSessionId,
  };
}

async function makePrewarmSizeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-prewarm-size-'));
  const fixtureRepo = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '21');
  const largeId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const smallId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  await fsp.mkdir(fixtureRepo, { recursive: true });
  await writeJsonl(path.join(sessionDir, `large-${largeId}.jsonl`), [
    { timestamp: '2026-08-21T10:00:00.000Z', type: 'session_meta', payload: { id: largeId, cwd: fixtureRepo } },
    { timestamp: '2026-08-21T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'L'.repeat(64 * 1024) }] } },
  ]);
  await writeJsonl(path.join(sessionDir, `small-${smallId}.jsonl`), [
    { timestamp: '2026-08-21T09:00:00.000Z', type: 'session_meta', payload: { id: smallId, cwd: fixtureRepo } },
    { timestamp: '2026-08-21T09:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'small eligible Session' }] } },
  ]);
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const index = await buildIndex({ repoRoot: fixtureRepo, codexHome });
  return { index, largeId, smallId };
}

async function makeTransitionProfileIndex(t, options = {}) {
  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-transition-'));
  const fixture = await createTimelineProfileFixture(baseDir, {
    eventCount: options.eventCount || 700,
    searchableTextBytes: options.searchableTextBytes || 512,
    hitPositions: options.hitPositions || [650],
    commonTermEvery: options.commonTermEvery || 1,
    detailHeavyPositions: options.detailHeavyPositions || [],
    includeContextReveal: options.includeContextReveal === true,
    contextRevealIndex: options.contextRevealIndex,
    secondaryEventCount: options.secondaryEventCount || 40,
  });
  t.after(() => fsp.rm(baseDir, { recursive: true, force: true }));
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  return { fixture, index };
}

async function makeCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-'));
  const codeModeRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '15');
  const file = path.join(dir, `rollout-2026-07-15T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(codeModeRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-15T01:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: codeModeRepoRoot } },
    { timestamp: '2026-07-15T01:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect Code Mode hierarchy.' }] } },
    { timestamp: '2026-07-15T01:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-hierarchy', turn_id: 'turn-code-mode', input: 'const result = await tools.wait_agent({ timeout_ms: 1000 }); text(result);' } },
    { timestamp: '2026-07-15T01:00:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-hierarchy', turn_id: 'turn-code-mode', output: 'Script running with cell ID 7373\nInitial output' } },
    { timestamp: '2026-07-15T01:00:04.000Z', type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait-browser-1', turn_id: 'turn-code-mode', arguments: '{"cell_id":"7373"}' } },
    { timestamp: '2026-07-15T01:00:05.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-browser-1', turn_id: 'turn-code-mode', output: 'Script running with cell ID 7373\nIntermediate output' } },
    { timestamp: '2026-07-15T01:00:06.000Z', type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait-browser-2', turn_id: 'turn-code-mode', arguments: '{"cell_id":"7373"}' } },
    { timestamp: '2026-07-15T01:00:07.000Z', type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'nested-browser-hierarchy', turn_id: 'turn-code-mode', tool_name: 'fixture', status: 'completed' } },
    { timestamp: '2026-07-15T01:00:08.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-browser-2', turn_id: 'turn-code-mode', output: [{ type: 'input_text', text: 'Script completed\nWall time 3.3 seconds\nOutput:\n' }, { type: 'input_text', text: 'Exit code: 0\nOutput:\n\u001b[32;1mFinal browser output\u001b[0m' }] } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: codeModeRepoRoot };
}

async function makeContextCodeModeCodexHome(t, options = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-context-'));
  const contextRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cacacaca-caca-caca-caca-cacacacacaca';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '22');
  const file = path.join(dir, `rollout-2026-07-22T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(contextRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-22T01:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: contextRepoRoot } },
    { timestamp: '2026-07-22T01:00:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-context', turn_id: 'turn-context', input: "const value = await tools.fixture({ status: 'failed' }); text(value);" } },
    { timestamp: '2026-07-22T01:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-context', turn_id: 'turn-context', output: 'Script running with cell ID 4242\nexec-context-output' } },
    { timestamp: '2026-07-22T01:00:03.000Z', type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait-browser-context', turn_id: 'turn-context', arguments: '{"cell_id":"4242"}' } },
    { timestamp: '2026-07-22T01:00:04.000Z', type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'nested-browser-context', turn_id: 'turn-context', tool_name: 'nested-context-token', status: 'failed' } },
    { timestamp: '2026-07-22T01:00:05.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-browser-context', turn_id: 'turn-context', output: 'Script completed\ncontext-wait-output' } },
  ];
  for (let index = 0; index < Number(options.extraMessageCount || 0); index += 1) {
    rows.push({
      timestamp: new Date(Date.parse('2026-07-22T01:01:00.000Z') + (index * 1000)).toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: [{
          type: index % 2 === 0 ? 'input_text' : 'output_text',
          text: `Context append filler ${index}`,
        }],
      },
    });
  }
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: contextRepoRoot, sessionId };
}

async function makeRawCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-raw-'));
  const rawRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cececece-cece-cece-cece-cececececece';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '15');
  const file = path.join(dir, `rollout-2026-07-15T10-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(rawRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-15T02:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: rawRepoRoot } },
    {
      timestamp: '2026-07-15T02:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'exec-browser-raw',
        input: [
          'const args = { plan: [] };',
          'const plan = await tools.update_plan(args);',
          'const goal = await tools.get_goal(args);',
          'const input = await tools.request_user_input(args);',
          'text(plan);',
        ].join('\n'),
      },
    },
    { timestamp: '2026-07-15T02:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-raw', output: 'Script completed\nOutput:\n{}' } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: rawRepoRoot };
}

async function makeSingleLineRawCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-raw-single-line-'));
  const rawRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cfcfcfcf-cfcf-cfcf-cfcf-cfcfcfcfcfcf';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '15');
  const file = path.join(dir, 'rollout-2026-07-15T10-10-00-' + sessionId + '.jsonl');
  const source = 'const result = await tools.shell_command(args); // ' + 'single logical source preview '.repeat(20);
  await fsp.mkdir(rawRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-15T02:10:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: rawRepoRoot } },
    {
      timestamp: '2026-07-15T02:10:01.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'exec-browser-raw-single-line',
        input: source,
      },
    },
    { timestamp: '2026-07-15T02:10:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-raw-single-line', output: 'Script completed\nOutput:\n{}' } },
  ];
  await fsp.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: rawRepoRoot };
}

async function makeAdaptiveCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-adaptive-'));
  const adaptiveRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'dededede-dede-dede-dede-dededededede';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '16');
  const file = path.join(dir, `rollout-2026-07-16T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(adaptiveRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const singleSource = [
    "const plan = await tools.update_plan({ explanation: 'single fixture', plan: [",
    "  { step: 'Inspect single', status: 'in_progress' },",
    "  { step: 'Finish single', status: 'pending' },",
    '] });',
    'text(plan);',
  ].join('\n');
  const multiSource = [
    "const plan = await tools.update_plan({ plan: [{ step: 'Inspect multi', status: 'in_progress' }] });",
    "const command = await tools.shell_command({ command: 'Write-Output multi' });",
    'text(plan);',
    'text(command);',
  ].join('\n');
  const requestOnlySource = "const plan = await tools.update_plan({ plan: [{ step: 'Request only', status: 'pending' }] }); text(plan);";
  const rows = [
    { timestamp: '2026-07-16T01:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: adaptiveRepoRoot } },
    { timestamp: '2026-07-16T01:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect adaptive Code Mode presentation.' }] } },
    { timestamp: '2026-07-16T01:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-single', turn_id: 'turn-single', input: singleSource } },
    { timestamp: '2026-07-16T01:00:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-single', turn_id: 'turn-single', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: '{}' }] } },
    { timestamp: '2026-07-16T01:00:04.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-multi', turn_id: 'turn-multi', input: multiSource } },
    { timestamp: '2026-07-16T01:00:05.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-multi', turn_id: 'turn-multi', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: '{}' }, { type: 'input_text', text: 'Exit code: 0\nWall time: 1 second\nOutput:\nmulti' }] } },
    { timestamp: '2026-07-16T01:00:06.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-request-only', turn_id: 'turn-request-only', input: requestOnlySource } },
    { timestamp: '2026-07-16T01:00:07.000Z', type: 'response_item', payload: { type: 'function_call', name: 'fixture_other_tool', call_id: 'ordinary-browser-tool', turn_id: 'turn-ordinary', arguments: '{}' } },
    { timestamp: '2026-07-16T01:00:08.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'ordinary-browser-tool', turn_id: 'turn-ordinary', output: 'ordinary fixture output' } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: adaptiveRepoRoot };
}

async function makeCodeModeSearchPreviewCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-search-'));
  const searchRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'dfdfdfdf-dfdf-dfdf-dfdf-dfdfdfdfdfdf';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '16');
  const file = path.join(dir, `rollout-2026-07-16T09-30-00-${sessionId}.jsonl`);
  await fsp.mkdir(searchRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const singleSource = "const plan = await tools.update_plan({ plan: [{ step: 'Visible single request', status: 'pending' }] }); text(plan);";
  const multiSource = [
    "const plan = await tools.update_plan({ plan: [{ step: 'Visible multi request', status: 'pending' }] });",
    "const command = await tools.shell_command({ command: 'Write-Output visible-multi-command' });",
    'text(plan);',
    'text(command);',
  ].join('\n');
  const execSource = [
    "const command = await tools.exec_command({ command: 'Write-Output visible-exec-command' });",
    'text(command.output);',
  ].join('\n');
  const rawSource = [
    'const args = { plan: [] };',
    'const plan = await tools.update_plan(args);',
    'const goal = await tools.get_goal(args);',
    "const hidden = 'raw source navigation needle';",
    'text(plan);',
  ].join('\n');
  const rows = [
    { timestamp: '2026-07-16T01:30:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: searchRepoRoot } },
    { timestamp: '2026-07-16T01:30:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-search-single', input: singleSource } },
    { timestamp: '2026-07-16T01:30:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-search-single', output: 'Script completed\nOutput:\n{"message":"single result navigation needle"}' } },
    { timestamp: '2026-07-16T01:30:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-search-multi', input: multiSource } },
    { timestamp: '2026-07-16T01:30:04.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-search-multi', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: '{"message":"multi result navigation needle"}' }, { type: 'input_text', text: 'Exit code: 0\nOutput:\nordinary output' }] } },
    { timestamp: '2026-07-16T01:30:04.500Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-search-exec', input: execSource } },
    { timestamp: '2026-07-16T01:30:04.750Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-search-exec', output: 'Script completed\nOutput:\nexec command output' } },
    { timestamp: '2026-07-16T01:30:05.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-search-raw', input: rawSource } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: searchRepoRoot, sessionId };
}

async function makeWebCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-web-'));
  const webRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'efefefef-efef-efef-efef-efefefefefef';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '16');
  const file = path.join(dir, `rollout-2026-07-16T10-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(webRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const source = "const result = await tools.web__run({ search_query: [{ q: 'site:example.test browser markdown', domains: ['example.test'] }], response_length: 'long' }); text(result);";
  const result = [
    '## Example browser result',
    '',
    '- [Safe source](https://example.test/docs)',
    '- **Rendered browser emphasis**',
    '- [Unsafe source](javascript:alert(1))',
    '',
    '<script>alert("unsafe")</script>',
    '',
    'citeturn0search0',
  ].join('\n');
  const rows = [
    { timestamp: '2026-07-16T02:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: webRepoRoot } },
    { timestamp: '2026-07-16T02:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect Web Code Mode presentation.' }] } },
    { timestamp: '2026-07-16T02:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-web', turn_id: 'turn-web', input: source } },
    { timestamp: '2026-07-16T02:00:02.500Z', type: 'event_msg', payload: { type: 'web_search_end', call_id: 'internal-browser-web', turn_id: 'turn-web', query: 'site:example.test browser markdown', action: { type: 'search', queries: ['site:example.test browser markdown'] }, status: 'completed' } },
    { timestamp: '2026-07-16T02:00:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-web', turn_id: 'turn-web', output: [{ type: 'input_text', text: 'Script completed\nWall time 1.2 seconds\nOutput:\n' }, { type: 'input_text', text: result }] } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: webRepoRoot };
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

test('browser retries one bounded materialization-busy GET before showing an error', async (t) => {
  const index = await buildFixtureIndex();
  let attempts = 0;
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/timeline?*', async (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.searchParams.get('offset') === '0' && attempts === 0) {
          attempts += 1;
          await route.fulfill({
            status: 503,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
            body: JSON.stringify({
              error: 'Internal server error',
              code: 'MATERIALIZATION_BUSY',
            }),
          });
          return;
        }
        attempts += 1;
        await route.continue();
      });
    },
  });
  assert.ok(attempts >= 2);
  assert.equal((await page.locator('#stateLine').textContent()).includes('Internal server error'), false);
});

test('browser receives a prewarm cache hit before first Session paint', async (t) => {
  const fixture = await makeLongCodexHome(t, { eventCount: 20 });
  const index = await buildIndex(fixture);
  const wakeReady = deferred();
  let wake;
  let wakeOutcome;
  let materializationCalls = 0;
  let releasedSessionsAt = 0;
  let timelineRequestedAt = 0;
  let timelineRespondedAt = 0;
  let releasedSessions = false;
  const { page } = await openApp(t, index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 8 * 1024 * 1024,
      individualBytes: 4 * 1024 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 61;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        materializationCalls += 1;
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      targetPage.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/timeline')) timelineRequestedAt ||= performance.now();
      });
      targetPage.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('/timeline')) timelineRespondedAt ||= performance.now();
      });
      await targetPage.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
        if (!releasedSessions && new URL(route.request().url()).pathname === '/api/sessions') {
          releasedSessions = true;
          await wakeReady.promise;
          wakeOutcome = await wake();
          releasedSessionsAt = performance.now();
        }
        await route.continue();
      });
    },
  });

  assert.equal(materializationCalls, 1);
  assert.equal(wakeOutcome.completedCount, 1);
  assert.equal(wakeOutcome.failedCount, 0);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.sessionId);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'prewarm-hit',
    requestHeaderMs: timelineRespondedAt - timelineRequestedAt,
    sessionsReleaseToPaintMs: performance.now() - releasedSessionsAt,
    materializationCalls,
  }));
});

test('browser foreground selection beats the idle timer without duplicate materialization', async (t) => {
  const fixture = await makeLongCodexHome(t, { eventCount: 20 });
  const index = await buildIndex(fixture);
  const wakeReady = deferred();
  let wake;
  let materializationCalls = 0;
  let navigationStartedAt = 0;
  let timelineRequestedAt = 0;
  let timelineRespondedAt = 0;
  const { page } = await openApp(t, index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 8 * 1024 * 1024,
      individualBytes: 4 * 1024 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 71;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        materializationCalls += 1;
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      navigationStartedAt = performance.now();
      targetPage.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/timeline')) timelineRequestedAt ||= performance.now();
      });
      targetPage.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('/timeline')) timelineRespondedAt ||= performance.now();
      });
    },
  });
  await wakeReady.promise;
  const outcome = await wake();

  assert.equal(materializationCalls, 1);
  assert.equal(outcome.attemptedCount, 0);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.sessionId);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'foreground-beats-timer',
    requestHeaderMs: timelineRespondedAt - timelineRequestedAt,
    navigationToPaintMs: performance.now() - navigationStartedAt,
    materializationCalls,
  }));
});

test('browser wrong prediction preempts a speculative derived Session before opening the visible root', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t, { derived: true });
  const wakeReady = deferred();
  const speculativeStarted = deferred();
  let wake;
  let waking;
  let releasedSessions = false;
  let abortObservedAt = 0;
  let foregroundStartedAt = 0;
  const order = [];
  const { page } = await openApp(t, fixture.index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 3,
      budgetBytes: 8 * 1024 * 1024,
      individualBytes: 4 * 1024 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 81;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        if (indexedSession.id === fixture.derivedId) {
          order.push('speculative:start');
          speculativeStarted.resolve();
          return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              abortObservedAt = performance.now();
              order.push('speculative:abort');
              reject(options.signal.reason);
            }, { once: true });
          });
        }
        if (indexedSession.id === fixture.childId) {
          foregroundStartedAt = performance.now();
          order.push('foreground:start');
        }
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
        if (!releasedSessions && new URL(route.request().url()).pathname === '/api/sessions') {
          releasedSessions = true;
          await wakeReady.promise;
          waking = wake();
          await speculativeStarted.promise;
        }
        await route.continue();
      });
    },
  });
  const outcome = await waking;

  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.childId);
  assert.deepEqual(order.slice(0, 3), [
    'speculative:start',
    'speculative:abort',
    'foreground:start',
  ]);
  assert.equal(outcome.preemptedCount, 1);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'wrong-prediction',
    abortToForegroundStartMs: foregroundStartedAt - abortObservedAt,
  }));
});

test('browser startup prewarm skips an oversized top candidate and continues to one eligible recent Session', async (t) => {
  const fixture = await makePrewarmSizeCodexHome(t);
  const wakeReady = deferred();
  let wake;
  let wakeOutcome;
  let releasedSessions = false;
  const materializedIds = [];
  const { page } = await openApp(t, fixture.index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 2,
      budgetBytes: 1024 * 1024,
      individualBytes: 32 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 91;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        materializedIds.push(indexedSession.id);
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
        if (!releasedSessions && new URL(route.request().url()).pathname === '/api/sessions') {
          releasedSessions = true;
          await wakeReady.promise;
          wakeOutcome = await wake();
        }
        await route.continue();
      });
    },
  });

  assert.deepEqual(materializedIds, [fixture.smallId, fixture.largeId]);
  assert.equal(wakeOutcome.consideredCount, 2);
  assert.equal(wakeOutcome.completedCount, 1);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.largeId);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'large-candidate-skip',
    prewarmMaterializationCalls: 1,
    foregroundMaterializationCalls: 1,
  }));
});

test('browser locale bootstrap keeps narrow screens on sessions view', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { viewport: { width: 390, height: 760 }, locale: 'zh-CN', activeSessionState: 'attached' });

  await page.waitForFunction(() => document.body.dataset.mobileView === 'sessions');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');

  await fillSearch(page, 'patch');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');
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
  const index = await buildFixtureIndex();
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

  await page.locator('.trajectoryOverviewViewport').press('ArrowRight');
  await page.waitForFunction((previousId) => (
    document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId !== previousId
  ), selectedId);
  const keyboardSelectedId = await page.locator('.trajectoryOverviewLocator').getAttribute(
    'data-trajectory-overview-selected-id',
  );
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

  await viewport.evaluate((node) => { node.scrollLeft = 0; });
  await viewport.hover();
  await page.mouse.wheel(0, 420);
  await page.waitForFunction(() => document.querySelector('.trajectoryOverviewViewport')?.scrollLeft > 300);
  const freelyPanned = await viewport.evaluate((node) => node.scrollLeft);
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await viewport.evaluate((node) => node.scrollLeft)) - freelyPanned) <= 1);
  assert.equal(
    await page.locator('.trajectoryOverviewLocator').getAttribute('data-trajectory-overview-selected-id'),
    anchorId,
  );

  await page.waitForTimeout(100);
  const timelineRequestUrls = requestedUrls.filter((url) => url.includes('/timeline?'));
  await page.locator('[data-main-presentation="timeline"]').click();
  await page.waitForSelector('#timeline .event[data-event-id]');
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction((expectedScroll) => {
    const node = document.querySelector('.trajectoryOverviewViewport');
    return document.querySelector('.trajectoryOverview')?.dataset.sequenceZoom === '8'
      && Math.abs(node.scrollLeft - expectedScroll) <= 2;
  }, freelyPanned);
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
  assert.equal(await page.locator('#timeline [data-search-back-to-project]').count(), 1);
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

test('browser locale localizes static shell and dirty profile dialog', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('logical events'));
  assert.equal(await page.locator('#dirtyProfileTitle').textContent(), 'Unsaved folding strategy changes');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Find in current session');
  assert.equal(await page.locator('#searchKindLabel').textContent(), 'Kind');
  assert.equal(await page.locator('.localeControl').isVisible(), false);
  assert.equal(await page.locator('#localeSelect').count(), 1);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), '在当前 session 中查找');
  assert.equal(await page.locator('#searchKindLabel').textContent(), '类型');
  assert.equal(
    await page.locator('#searchKindSelect optgroup').first().getAttribute('label'),
    '对话与计划',
  );
  assert.equal(await page.locator('.mobileViewTab[data-mobile-view="events"]').textContent(), '事件');
  assert.equal(await page.locator('#searchStatusGoalGroup').getAttribute('label'), '目标生命周期');
  assert.equal(await page.locator('#searchStatusExecutionGroup').getAttribute('label'), '执行结果');
  assert.equal(await page.locator('#searchStatusEventGroup').getAttribute('label'), '事件生命周期');
  assert.equal(await page.locator('#searchStatusSelect option[value="complete"]').textContent(), '目标已完成');
  assert.equal(await page.locator('#searchStatusSelect option[value="completed"]').textContent(), '事件已完成');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /加载更多|已加载|加载中/);
  await fillSearch(page, 'zzzz-no-match');
  await page.waitForFunction(() => document.querySelector('[data-search-match-count]')?.textContent === '0 / 0 个目标');
  await fillSearch(page, '');

  await switchHiddenLocale(page, 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  await selectPrimarySession(page);
  const timelineHeaderText = await page.locator('#timeline .eventHeader').allTextContents();
  assert.equal(await page.locator('#timeline .eventHeader .channelChip').count(), 0);
  assert.doesNotMatch(timelineHeaderText.join('\n'), /(?:^|\s)\d+ raw(?:\s|$)|event_msg|response_item/);
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

test('browser presents Claude pointer fork context without child search or event ownership', async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-pointer-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const parentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sourceRecord = (sessionId, fields) => ({
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: claudeRepo,
    sessionId,
    version: '2.1.220',
    ...fields,
  });
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    sourceRecord(parentId, {
      type: 'user',
      parentUuid: null,
      message: { role: 'user', content: 'Inherited task' },
      uuid: 'pointer-parent-user',
      timestamp: '2026-07-31T12:00:00.000Z',
    }),
    sourceRecord(parentId, {
      type: 'assistant',
      parentUuid: 'pointer-parent-user',
      message: {
        id: 'pointer-parent-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Inherited answer' }],
      },
      uuid: 'pointer-parent-assistant',
      timestamp: '2026-07-31T12:00:01.000Z',
    }),
    sourceRecord(parentId, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'pointer-parent-assistant',
      content: '<command-name>/fork</command-name>',
      uuid: 'pointer-fork-command',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    sourceRecord(parentId, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'pointer-fork-command',
      content: '<local-command-stdout>session waiting for a prompt · Pointer child ⑂ · bbbbbbbb</local-command-stdout>',
      uuid: 'pointer-fork-output',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    sourceRecord(parentId, {
      type: 'user',
      parentUuid: 'pointer-fork-output',
      message: { role: 'user', content: 'Parent-only continuation' },
      uuid: 'pointer-parent-after-fork',
      timestamp: '2026-07-31T12:00:03.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Pointer child ⑂', sessionId: childId },
    { type: 'agent-name', agentName: 'Pointer child ⑂', sessionId: childId },
  ]);

  const index = await buildClaudeSourceBackedIndex({ repoRoot: claudeRepo, claudeHome });
  const pointerChild = index.sessionsById.get(analyzerSessionId(childId));
  const forkPointTarget = pointerChild?.inheritedContext?.forkPointTarget;
  assert.equal(forkPointTarget?.layer, 'main');
  assert.ok(forkPointTarget?.eventId);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${analyzerSessionId(childId)}"]`).click();

  const context = page.locator('[data-inherited-context]');
  await context.waitFor();
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);
  assert.match(await page.locator('.sessionHeader').innerText(), /Pointer-backed fork/);
  assert.match(await page.locator('.sessionHeader').innerText(), /Waiting for prompt/);
  assert.match(await context.innerText(), /2 inherited Raw Records at the fork point support 2 Main and 0 Protocol events/);
  assert.match(await context.innerText(), /Fork point pointer-/);

  await context.locator('summary').click();
  assert.equal(await context.locator('.inheritedContextEvent').count(), 2);
  assert.match(await context.innerText(), /Inherited task/);
  assert.match(await context.innerText(), /Inherited answer/);
  assert.doesNotMatch(await context.innerText(), /Parent-only continuation/);

  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'Inherited task';
  });
  await fillSearch(page, 'Inherited task');
  await searchResponse;
  await waitForNoSearchMarks(page);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);

  const parentTimelinePath = `/api/sessions/${encodeURIComponent(analyzerSessionId(parentId))}/timeline`;
  let signalParentTimeline;
  let releaseParentTimeline;
  const parentTimelineStarted = new Promise((resolve) => { signalParentTimeline = resolve; });
  const parentTimelineRelease = new Promise((resolve) => { releaseParentTimeline = resolve; });
  await page.route((url) => new URL(String(url)).pathname === parentTimelinePath, async (route) => {
    signalParentTimeline();
    await parentTimelineRelease;
    await route.continue();
  });
  const parentTimelineResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === parentTimelinePath
  ));

  await context.getByRole('button', { name: 'Open parent session' }).click();
  try {
    await parentTimelineStarted;
    await expectInputValue(page, '#searchInput', '');
    await expectInputValue(page, '#layerSelect', forkPointTarget.layer);
    await page.waitForFunction(() => document.querySelector('.sessionHeader h2')?.textContent === 'Inherited task');
    assert.equal(await page.locator('[data-inherited-context]').count(), 0);
  } finally {
    releaseParentTimeline();
  }
  await parentTimelineResponse;
  await page.waitForFunction((eventId) => (
    document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), forkPointTarget.eventId);

  const { page: fallbackPage } = await openApp(t, index, {
    locale: 'en',
    skipProjectReindex: true,
    beforeGoto: async (targetlessPage) => {
      await targetlessPage.route('**/api/sessions*', async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        const pointerSession = data.sessions.find((session) => session.id === analyzerSessionId(childId));
        if (pointerSession) pointerSession.inheritedContext.forkPointTarget = null;
        await route.fulfill({ response, json: data });
      });
    },
  });
  await fallbackPage.locator(`[data-session-id="${analyzerSessionId(childId)}"]`).click();
  const fallbackContext = fallbackPage.locator('[data-inherited-context]');
  await fallbackContext.waitFor();
  assert.equal(
    await fallbackContext.getByRole('button', { name: 'Open parent session' }).getAttribute('data-inherited-target-event'),
    '',
  );
  const fallbackSearchResponse = fallbackPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'Inherited task';
  });
  await fillSearch(fallbackPage, 'Inherited task');
  await fallbackSearchResponse;
  const fallbackParentResponse = fallbackPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === parentTimelinePath && url.searchParams.get('q') === 'Inherited task';
  });
  await fallbackContext.getByRole('button', { name: 'Open parent session' }).click();
  await fallbackParentResponse;
  await expectInputValue(fallbackPage, '#searchInput', 'Inherited task');
  await expectInputValue(fallbackPage, '#layerSelect', 'main');
});

test('browser presents materialized fork ownership, earlier-branch hierarchy, Raw segments, and fork-point navigation', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t);
  const { page } = await openApp(t, fixture.index, { locale: 'en', skipProjectReindex: true });
  const childBranch = page.locator(`[data-session-branch-id="${fixture.childId}"]`);
  const childCard = childBranch.locator(`:scope > .sessionRow [data-session-id="${fixture.childId}"]`);
  const toggle = childBranch.locator(`:scope > .sessionRow [data-session-children-toggle="${fixture.childId}"]`);
  assert.match(await childCard.innerText(), /Continues from earlier branch/);
  assert.doesNotMatch(await childCard.innerText(), /Fork · from/);
  assert.equal((await toggle.textContent()).trim(), 'Earlier branch');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator(`[data-session-id="${fixture.parentId}"]`).isVisible(), false);

  await toggle.click();
  const earlier = childBranch.locator(`[data-session-id="${fixture.parentId}"]`);
  assert.equal(await earlier.isVisible(), true);
  assert.match(await earlier.innerText(), /Earlier branch/);
  assert.match(await earlier.innerText(), /did not continue after the current branch was created/);
  await earlier.click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, fixture.parentId);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'direct selection expands the earlier branch ancestor');

  await childCard.click();
  const context = page.locator('[data-inherited-context]');
  await context.waitFor();
  assert.match(await page.locator('.sessionHeader').innerText(), /Materialized fork/);
  assert.match(await context.innerText(), /Inherited through/);
  assert.match(await context.innerText(), /not counted as this session's continuation activity/);
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event')].some((event) => event.textContent.includes('Own browser continuation')));
  assert.equal(await page.locator('#timeline .event').filter({ hasText: 'Inherited browser task' }).count(), 0);
  assert.equal(await page.locator('#timeline .event').filter({ hasText: 'Own browser continuation' }).count(), 1);

  await page.locator('#layerSelect').selectOption('raw');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .rawForkSegmentHeading').length >= 2);
  assert.deepEqual(
    await page.locator('#timeline .rawForkSegmentHeading').allTextContents(),
    ['Fork metadata', 'Inherited context'],
  );
  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#timeline .rawForkSegmentHeading').length === 3);
  assert.deepEqual(
    await page.locator('#timeline .rawForkSegmentHeading').allTextContents(),
    ['Fork metadata', 'Inherited context', 'Fork continuation'],
    'pagination re-render keeps one heading per contiguous segment',
  );

  const parentButton = context.getByRole('button', { name: 'Open parent session' });
  await parentButton.click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, fixture.parentId);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  const selected = page.locator('#timeline .event.selected');
  await selected.waitFor();
  await page.waitForFunction(() => (
    document.querySelector('#timeline .event.selected')?.textContent.includes('Inherited browser answer')
  ));
  assert.match(await selected.innerText(), /Inherited browser answer/);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.waitForFunction((id) => (
    document.querySelector(`[data-session-children-toggle="${CSS.escape(id)}"]`)?.textContent.includes('较早分支')
  ), fixture.childId);
  assert.match(await toggle.innerText(), /较早分支/);

  await page.locator('#layerSelect').selectOption('raw');
  await page.locator('#searchHudScope').click();
  await page.locator('#searchAssist button[data-search-scope="project"]').click();
  await fillSearch(page, 'Inherited browser task');
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .projectResultCard').length === 2);
  assert.equal(await page.locator('#sessionList .projectResultCard').count(), 2);
  assert.equal(await page.locator('#sessionList .sessionChildrenToggle').count(), 0, 'project search stays flat');
  const projectResultChipText = (await page.locator('#sessionList .projectResultCard .chip').allTextContents()).join(' | ');
  assert.doesNotMatch(projectResultChipText, /Codex/);
});

test('browser fork-point navigation temporarily reveals a profile-hidden target without changing saved folds', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t);
  const child = fixture.index.sessionsById.get(fixture.childId);
  const targetEventId = child?.inheritedContext?.forkPointTarget?.eventId || '';
  assert.ok(targetEventId);
  const hiddenAssistantProfile = {
    id: 'custom:hidden-fork-point-assistant',
    name: 'Hidden fork-point assistant',
    description: 'Hide the inherited assistant event selected by fork-point navigation.',
    rules: {
      kindStates: { assistant_message: 'hidden' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const savedOverrides = {
    [fixture.parentId]: { [targetEventId]: 'hidden' },
  };
  const { page } = await openWave1cM1App(t, fixture.index, {
    locale: 'en',
    skipProjectReindex: true,
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenAssistantProfile]),
      'sessionAnalyzer.profile': hiddenAssistantProfile.id,
      'sessionAnalyzer.overrides': JSON.stringify(savedOverrides),
    },
  });

  const context = page.locator('[data-inherited-context]');
  await context.waitFor();
  await page.evaluate(() => window.__wave1cM1.reset());
  await context.getByRole('button', { name: 'Open parent session' }).click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, fixture.parentId);
  const selected = page.locator(`#timeline .event[data-event-id="${targetEventId}"].selected`);
  await selected.waitFor();
  assert.equal(await selected.isVisible(), true);
  assert.equal(await selected.evaluate((node) => node.classList.contains('hiddenByProfile')), false);
  assert.equal(await selected.evaluate((node) => node.classList.contains('summary')), true);
  assert.equal(
    await selected.evaluate((node) => node.classList.contains('temporaryReferenceReveal')),
    false,
    'fork-point navigation reveal is not a temporaryEventReveal membership probe',
  );
  assert.equal(
    await page.evaluate(({ sessionId, eventId }) => (
      JSON.parse(localStorage.getItem('sessionAnalyzer.overrides'))?.[sessionId]?.[eventId]
    ), { sessionId: fixture.parentId, eventId: targetEventId }),
    'hidden',
    'fork-point reveal must not overwrite the saved folding override',
  );
  assert.equal(await page.evaluate(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'navigationRevealRevision',
  )), true);
  assert.ok((await latestWave1cM1Lifecycle(page))
    .mountedPresentationToken.navigationRevealRevision > 0);
});

test('browser labels mixed Derived and Earlier children as related sessions', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t, { derived: true });
  const { page } = await openApp(t, fixture.index, { locale: 'en', skipProjectReindex: true });
  const toggle = page.locator(`[data-session-children-toggle="${fixture.childId}"]`);
  assert.equal((await toggle.textContent()).trim(), '2 related sessions');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show 2 related sessions');
  await toggle.click();
  assert.match(await page.locator(`[data-session-id="${fixture.parentId}"]`).innerText(), /Earlier branch/);
  assert.match(await page.locator(`[data-session-id="${fixture.derivedId}"]`).innerText(), /Subagent Fixture · from/);
});

test('browser Raw refs preserve malformed Claude source text instead of rendering null', async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-malformed-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const sessionId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  const file = path.join(container, `${sessionId}.jsonl`);
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(file, [{
    type: 'user',
    message: { role: 'user', content: 'Inspect malformed evidence' },
    cwd: claudeRepo,
    sessionId,
    uuid: 'malformed-parent-user',
    timestamp: '2026-07-31T12:30:00.000Z',
  }]);
  const malformedLine = '{"type":"assistant","message":';
  await fsp.appendFile(file, `${malformedLine}\n`, 'utf8');

  const index = await buildClaudeSourceBackedIndex({ repoRoot: claudeRepo, claudeHome });
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator('#layerSelect').selectOption('protocol');
  await expectInputValue(page, '#layerSelect', 'protocol');
  const eventId = `${analyzerSessionId(sessionId)}:logical:protocol:2`;
  const malformedEvent = page.locator(`#timeline .event[data-event-id="${eventId}"]`);
  await malformedEvent.waitFor();
  await malformedEvent.click();
  await waitForDetailView(page, 'inspector');
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading...'));
  assert.equal((await page.locator('#detail .rawRefsView pre').textContent()).trim(), malformedLine);
});

test('browser groups derived sessions under their parent and collapses them by default', async (t) => {
  const index = await buildFixtureIndex();
  const childSessionId = '33333333-3333-3333-3333-333333333333';
  const orphanReviewSessionId = '88888888-8888-8888-8888-888888888888';
  const normalForkSessionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const expectedChildCount = index.sessions.filter((session) => session.parentSessionId === primaryFixtureSessionId).length;
  const { page } = await openApp(t, index, { locale: 'en', skipProjectReindex: true });
  const sessionChipText = (await page.locator('#sessionList .sessionItem .chip').allTextContents()).join(' | ');
  assert.doesNotMatch(sessionChipText, /Codex/);
  assert.doesNotMatch(sessionChipText, /protocol/i);

  const parentBranch = page.locator(`[data-session-branch-id="${primaryFixtureSessionId}"]`);
  const toggle = parentBranch.locator(`:scope > .sessionRow [data-session-children-toggle="${primaryFixtureSessionId}"]`);
  const children = parentBranch.locator(':scope > .sessionChildren');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.match(await toggle.getAttribute('aria-label'), new RegExp(`Show ${expectedChildCount} child sessions`));
  assert.equal((await toggle.textContent()).trim(), `${expectedChildCount} child sessions`);
  assert.equal(await toggle.locator('.sessionChildrenChevron').getAttribute('aria-hidden'), 'true');
  const bridgePlacement = await parentBranch.locator(':scope > .sessionRow').evaluate((row) => {
    const card = row.querySelector('.sessionItem').getBoundingClientRect();
    const control = row.querySelector('.sessionChildrenToggle').getBoundingClientRect();
    return {
      centerDelta: Math.abs((card.left + card.right) / 2 - (control.left + control.right) / 2),
      edgeDelta: Math.abs(card.bottom - (control.top + control.bottom) / 2),
    };
  });
  assert.ok(bridgePlacement.centerDelta <= 1, `expected centered bridge, got ${bridgePlacement.centerDelta}`);
  assert.ok(bridgePlacement.edgeDelta <= 1, `expected bottom-edge bridge, got ${bridgePlacement.edgeDelta}`);
  assert.equal(await children.getAttribute('hidden'), '');
  assert.equal(await page.locator(`[data-session-id="${orphanReviewSessionId}"]`).isVisible(), true);
  assert.equal(await page.locator(`[data-session-id="${normalForkSessionId}"]`).isVisible(), true);

  await toggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await children.getAttribute('hidden'), null);
  const child = children.locator(`[data-session-id="${childSessionId}"]`);
  assert.equal(await child.isVisible(), true);
  assert.match(await child.textContent(), /Subagent Fixture.*from/s);

  await child.click();
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, childSessionId);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
});

test('browser uses singular child session labels for one derived child', async (t) => {
  const residentIndex = await buildResidentCodexIndex({ repoRoot, codexHome: fixtureCodexHome });
  const childSessionId = '33333333-3333-3333-3333-333333333333';
  const retainedSessions = residentIndex.sessions.filter(
    (session) => session.parentSessionId !== primaryFixtureSessionId || session.id === childSessionId,
  );
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-single-child-browser-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const sessionsRoot = path.join(codexHome, 'sessions');
  await fsp.mkdir(sessionsRoot, { recursive: true });
  await Promise.all(retainedSessions.map((session) => (
    fsp.copyFile(session.sourceAbsFile, path.join(sessionsRoot, path.basename(session.sourceAbsFile)))
  )));
  const index = await buildIndex({ repoRoot, codexHome });
  const { page } = await openApp(t, index, { locale: 'en', skipProjectReindex: true });

  const toggle = page.locator(`[data-session-children-toggle="${primaryFixtureSessionId}"]`);
  assert.equal((await toggle.textContent()).trim(), '1 child session');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show 1 child session');

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-label'), 'Hide 1 child session');
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

test('browser single-tool Code Mode keeps native request and operation output primary while moving trace to inspector', async (t) => {
  const fixture = await makeCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation, 'fixture should create one Code Mode operation');
  const { page } = await openApp(t, index, { locale: 'en' });
  const renderedEventIds = await page.locator('#timeline .event[data-event-id]').evaluateAll((events) => events.map((eventNode) => eventNode.dataset.eventId));
  assert.ok(renderedEventIds.includes(operation.id), `expected Code Mode event in ${JSON.stringify(renderedEventIds)}`);
  const event = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);

  await page.waitForFunction((eventId) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`)?.classList.contains('code-mode-single-tool'), operation.id);
  assert.equal(await event.locator('.eventKind').textContent(), 'Wait for subagent');
  const compactHeader = await event.locator('.eventHeader').textContent();
  assert.match(compactHeader, /Code Mode/);
  assert.doesNotMatch(compactHeader, /Unassociated|Unattributed/);
  assert.doesNotMatch(compactHeader, /Declared request|response_item|2 raw|wait_agent/);
  assert.equal(compactHeader.includes('exec'), false);
  const requestPreview = event.locator('.codeModeRequestSummaryPreview');
  assert.equal(await requestPreview.count(), 1);
  assert.match(await requestPreview.textContent(), /Request.*1000/s);

  await event.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operation.id}"] .collaborationBlock`);
  assert.match(await event.locator('.collaborationBlock').textContent(), /Wait for subagent.*Timeout ms.*1000/s);
  assert.match(await event.locator('.terminalBlock').textContent(), /Operation output.*Final browser output/s);
  assert.equal((await event.locator('.terminalBlock').textContent()).includes('Script completed'), false);
  assert.doesNotMatch(await event.locator('.terminalBlock').textContent(), /\[32;1m|\[0m/);
  assert.equal(await event.locator('.codeModeTrace').count(), 0);
  assert.equal((await event.textContent()).includes('Operation metadata'), false);

  await waitForDetailView(page, 'inspector');
  await page.waitForSelector('#detail .inspectorDetailBody');
  assert.match(await page.locator('#detail .inspectorDetailBody').textContent(), /Operation metadata.*Poll count.*2.*Code Mode source.*Projection evidence.*wait_agent.*Result association note.*No result output matched the supported shape.*Execution trace.*Observed nested activity.*MCP tool/s);
  assert.deepEqual(
    (await page.locator('#detail .inspector > .inspectorSection > h3').allTextContents()).map((value) => value.trim()),
    ['Details', 'Metadata', 'Source'],
  );
  const metadataText = await page.locator('#detail .inspectorMetadataSection').textContent();
  assert.doesNotMatch(metadataText, /Status|Severity/);
  const rawAction = page.locator('#detail .detailViewHeader [data-detail-action="raw"]');
  assert.equal(await rawAction.count(), 1);
  assert.equal((await rawAction.textContent()).trim(), `Raw · ${operation.rawRefs.length}`);
  assert.equal(await page.locator('#detail .inspector [data-detail-action="raw"]').count(), 0);
  const inspectorTrace = page.locator('#detail .codeModeTrace');
  assert.equal(await inspectorTrace.getAttribute('open'), null);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.waitForFunction((eventId) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .terminalBlock`)?.textContent.includes('操作输出'), operation.id);
  assert.equal(await event.locator('.eventKind').textContent(), '等待子代理');
  assert.match(await event.locator('.eventHeader').textContent(), /代码模式/);
  assert.doesNotMatch(await event.locator('.eventHeader').textContent(), /未关联|未归属/);
  assert.equal((await event.locator('.eventHeader').textContent()).includes('wait_agent'), false);

  await event.click();
  await waitForDetailView(page, 'inspector');
  await page.waitForSelector('#detail .codeModeTrace');
  assert.equal((await page.locator('#detail .detailViewHeader [data-detail-action="raw"]').textContent()).trim(), `原始记录 · ${operation.rawRefs.length}`);
  const localizedInspectorTrace = page.locator('#detail .codeModeTrace');
  await localizedInspectorTrace.locator('summary').click();
  assert.notEqual(await localizedInspectorTrace.getAttribute('open'), null);
  assert.match(await localizedInspectorTrace.textContent(), /执行阶段.*Initial output.*等待阶段 1.*Intermediate output.*等待阶段 2/s);
  assert.equal((await localizedInspectorTrace.textContent()).includes('Final browser output'), false);
});

test('browser nested Code Mode context reveals a distinct parent row without changing search owners or fold overrides', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((candidate) => candidate.toolName === 'nested-context-token');
  assert.ok(operation && nested);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ operationId, nestedId }) => (
    Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`))
      && Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(nestedId)}"]`))
  ), { operationId: operation.id, nestedId: nested.id });
  await fillSearch(page, 'nested-context-token');
  await waitForSearchMarks(page);

  await addSearchFilter(page, 'status', 'failed');
  await page.waitForFunction((nestedId) => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return cards.length === 1 && cards[0].dataset.eventId === nestedId;
  }, nested.id);
  await page.locator('#searchAssistClose').click();
  const beforeSearch = await page.evaluate(() => ({
    result: document.querySelector('#resultSummary')?.textContent || '',
    owners: [...document.querySelectorAll('[data-search-target-owner]')].map((node) => node.getAttribute('data-search-target-owner')),
  }));
  const affordance = page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="reveal-context-parent"]`);
  await affordance.click();
  await page.waitForSelector('.contextRevealRow');
  const revealed = await page.locator('.contextRevealRow').evaluate((row, nestedId) => {
    const slot = row.closest('.contextRevealSlot');
    const child = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(nestedId)}"]`);
    return {
      isEvent: row.classList.contains('event'),
      eventId: row.getAttribute('data-event-id'),
      searchOwner: row.getAttribute('data-search-target-owner'),
      beforeChild: slot?.nextElementSibling === child,
    };
  }, nested.id);
  assert.deepEqual(revealed, { isEvent: false, eventId: null, searchOwner: null, beforeChild: true });
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 1);
  assert.equal(await page.locator('#resultSummary').textContent(), beforeSearch.result);
  const afterOwners = await page.locator('[data-search-target-owner]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-search-target-owner')));
  assert.deepEqual(afterOwners, beforeSearch.owners);
  const overridesBefore = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides'));

  await page.locator('.contextRevealAction').click();
  await page.waitForSelector('#detail .detailView');
  assert.equal(await page.locator('.contextRevealRow').count(), 0);
  assert.equal(await page.locator(`#timeline .event[data-event-id="${operation.id}"]`).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides')), overridesBefore);

  await page.locator('[data-detail-action="close"]').click();
  await page.locator('#searchFilterBtn').click();
  await page.locator('#searchStatusSelect').selectOption('');
  await page.locator('#searchAssistClose').click();
  await page.waitForFunction((operationId) => Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`)), operation.id);
  await page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="reveal-context-parent"]`).click();
  await page.waitForFunction((operationId) => document.querySelector(`#timeline .event.selected[data-event-id="${CSS.escape(operationId)}"]`), operation.id);
});

test('browser nested Code Mode context late responses are invalidated by detail, fold, profile, and Main presentation transitions', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((candidate) => candidate.toolName === 'nested-context-token');
  assert.ok(operation && nested);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ operationId, nestedId }) => (
    Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`))
      && Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(nestedId)}"]`))
  ), { operationId: operation.id, nestedId: nested.id });
  await fillSearch(page, 'nested-context-token');
  await waitForSearchMarks(page);
  await addSearchFilter(page, 'status', 'failed');
  await page.waitForFunction((nestedId) => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return cards.length === 1 && cards[0].dataset.eventId === nestedId;
  }, nested.id);
  await page.locator('#searchAssistClose').click();

  const parentPath = `/api/sessions/${fixture.sessionId}/events/${encodeURIComponent(operation.id)}`;
  const parentPayload = JSON.stringify(operation);
  const gates = [];
  await page.route((url) => new URL(String(url)).pathname === parentPath, async (route) => {
    const gate = gates.shift();
    if (!gate) {
      await route.continue();
      return;
    }
    gate.startedResolve();
    await gate.releasePromise;
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: parentPayload });
    } catch {
      // The transition under test may abort the request before the late response is delivered.
    } finally {
      gate.finishedResolve();
    }
  });

  const queueParentGate = () => {
    let releaseResolve;
    let startedResolve;
    let finishedResolve;
    const gate = {
      releasePromise: new Promise((resolve) => { releaseResolve = resolve; }),
      started: new Promise((resolve) => { startedResolve = resolve; }),
      finished: new Promise((resolve) => { finishedResolve = resolve; }),
      release: () => releaseResolve(),
      startedResolve: () => startedResolve(),
      finishedResolve: () => finishedResolve(),
    };
    gates.push(gate);
    return gate;
  };
  const revealAndWaitForRequest = async (gate) => {
    await page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="reveal-context-parent"]`).click();
    await gate.started;
  };
  const assertContextRowGone = async () => {
    await page.waitForFunction(() => !document.querySelector('.contextRevealRow'));
    assert.equal(await page.locator('.contextRevealRow').count(), 0);
  };

  const detailGate = queueParentGate();
  await revealAndWaitForRequest(detailGate);
  await page.locator(`#timeline .event[data-event-id="${nested.id}"] .eventKind`).click();
  await waitForDetailView(page, 'inspector');
  await assertContextRowGone();
  detailGate.release();
  await detailGate.finished;

  const rawGate = queueParentGate();
  await revealAndWaitForRequest(rawGate);
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await assertContextRowGone();
  rawGate.release();
  await rawGate.finished;

  const foldGate = queueParentGate();
  await revealAndWaitForRequest(foldGate);
  await page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="toggle"]`).first().click();
  await assertContextRowGone();
  foldGate.release();
  await foldGate.finished;

  const profileGate = queueParentGate();
  await revealAndWaitForRequest(profileGate);
  await page.locator('#profileSelect').selectOption('debug');
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value === 'debug');
  await assertContextRowGone();
  profileGate.release();
  await profileGate.finished;

  const presentationGate = queueParentGate();
  await revealAndWaitForRequest(presentationGate);
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  await assertContextRowGone();
  presentationGate.release();
  await presentationGate.finished;
  assert.equal(await page.locator('.contextRevealRow').count(), 0);
});

test('browser Code Mode raw fallback keeps a shared origin tag instead of the outer exec tool tag', async (t) => {
  const fixture = await makeRawCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation);

  const { page } = await openApp(t, index, { locale: 'en' });
  const event = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return card?.classList.contains('collapsed') && card.classList.contains('code-mode-raw-code-mode');
  }, operation.id);
  assert.equal(await event.locator('.eventKind').textContent(), 'Scripted operation');
  assert.match(await event.locator('.eventHeader').textContent(), /Code Mode/);
  assert.equal(await event.locator('.codeModeChip').count(), 1);
  assert.equal(await event.locator('.toolChip').count(), 0);
  const rawPreview = event.locator('.codeModeSourceExcerptPreview');
  assert.equal(await rawPreview.count(), 1);
  assert.match(await rawPreview.textContent(), /Source.*update_plan\(args\)/s);
  assert.equal((await rawPreview.textContent()).includes('tools.'), false);
  assert.equal((await rawPreview.textContent()).includes('{}'), false);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction((eventId) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .eventKind`)?.textContent === '脚本化操作', operation.id);
  assert.match(await event.locator('.eventHeader').textContent(), /代码模式/);
  assert.equal(await event.locator('.toolChip').count(), 0);
  assert.match(await rawPreview.textContent(), /源码.*update_plan\(args\)/s);
});

test('browser Code Mode summary presents a readable source excerpt instead of raw code', async (t) => {
  const fixture = await makeRawCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation);

  const summaryProfile = {
    id: 'custom:code-mode-summary',
    name: 'Code Mode summary test',
    description: 'Shows Code Mode operations in summary state.',
    rules: {
      kindStates: { other_tool_call: 'summary' },
      fallback: 'hidden',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([summaryProfile]),
      'sessionAnalyzer.profile': summaryProfile.id,
    },
  });
  const event = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return card?.classList.contains('summary')
      && card.classList.contains('code-mode-raw-code-mode')
      && Boolean(card.querySelector('.codeModeSummaryPreview'));
  }, operation.id);

  const summaryPreview = event.locator('.codeModeSummaryPreview');
  assert.equal(await event.locator('.eventKind').textContent(), 'Scripted operation');
  assert.equal(await event.locator('.toolChip').count(), 0);
  assert.equal(await summaryPreview.count(), 1);
  assert.equal(await summaryPreview.locator('code').count(), 0);
  assert.equal(await summaryPreview.locator('.codeModeSummaryExcerptBodySingleLine').count(), 0);
  assert.equal(await summaryPreview.locator('.codeModeCollapsedPreviewLabel').textContent(), 'Source');
  const previewChrome = await summaryPreview.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      borderLeftWidth: style.borderLeftWidth,
    };
  });
  assert.deepEqual(previewChrome, {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderTopWidth: '0px',
    borderLeftWidth: '0px',
  });
  const summaryLines = summaryPreview.locator('.codeModeSummaryExcerptLine');
  assert.equal(await summaryLines.count(), 2);
  assert.match(await summaryLines.nth(0).textContent(), /update_plan\(args\)/);
  assert.match(await summaryLines.nth(1).textContent(), /get_goal\(args\)/);
  assert.equal((await summaryPreview.textContent()).includes('tools.'), false);
  const continuation = summaryPreview.locator('.codeModeSummaryExcerptContinuation');
  assert.equal(await continuation.count(), 1);
  assert.equal(await continuation.locator('[aria-hidden="true"]').textContent(), '…');
  assert.match(await summaryPreview.textContent(), /Additional source not shown\./);
  assert.equal((await summaryPreview.textContent()).includes('request_user_input(args)'), false);

  await event.locator('.eventToggle').first().click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operation.id}"].expanded .commandRun`);
  await event.locator('.eventToggle').first().click();
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return card?.classList.contains('summary') && Boolean(card.querySelector('.codeModeSummaryPreview'));
  }, operation.id);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
      return card?.classList.contains('summary')
      && card.querySelector('.eventKind')?.textContent === '脚本化操作'
      && Boolean(card.querySelector('.codeModeSummaryPreview .codeModeSummaryExcerptLine'));
  }, operation.id);
  assert.match(await summaryPreview.textContent(), /源码.*还有未显示的源码。/s);
  assert.equal(await summaryPreview.locator('code').count(), 0);
});

test('browser Code Mode summary keeps one logical source line to one visual row', async (t) => {
  const fixture = await makeSingleLineRawCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation);

  const summaryProfile = {
    id: 'custom:code-mode-summary-single-line',
    name: 'Code Mode summary single-line test',
    description: 'Shows one raw source line with the summary presentation.',
    rules: {
      kindStates: { other_tool_call: 'summary' },
      fallback: 'hidden',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([summaryProfile]),
      'sessionAnalyzer.profile': summaryProfile.id,
    },
  });
  await page.setViewportSize({ width: 820, height: 900 });
  const event = page.locator('#timeline .event[data-event-id="' + operation.id + '"]');
  await page.waitForFunction((eventId) => {
    const card = document.querySelector('#timeline .event[data-event-id="' + CSS.escape(eventId) + '"]');
    return card?.classList.contains('summary')
      && card?.classList.contains('code-mode-raw-code-mode')
      && Boolean(card.querySelector('.codeModeSummaryExcerptLine'));
  }, operation.id);

  const summaryPreview = event.locator('.codeModeSummaryPreview');
  const summaryLine = summaryPreview.locator('.codeModeSummaryExcerptLine');
  assert.equal(await summaryLine.count(), 1);
  assert.equal(await summaryPreview.locator('.codeModeSummaryExcerptBodySingleLine').count(), 0);
  assert.equal(await summaryPreview.locator('code').count(), 0);
  const metrics = await summaryLine.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      whiteSpace: style.whiteSpace,
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  assert.equal(metrics.whiteSpace, 'nowrap');
  assert.ok(metrics.height <= metrics.lineHeight * 1.2, JSON.stringify(metrics));
});

test('browser Code Mode adaptively unwraps one declared tool and labels multiple declared tools without changing counts', async (t) => {
  const fixture = await makeAdaptiveCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operations = session.logicalEvents.filter((candidate) => candidate.kind === 'code_mode_operation');
  const single = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-browser-single');
  const multi = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-browser-multi');
  const requestOnly = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-browser-request-only');
  assert.ok(single && multi && requestOnly);
  assert.equal(session.counts.toolCalls, 4);
  assert.deepEqual(session.analysis.toolUsage, [
    { name: 'exec', count: 3 },
    { name: 'fixture_other_tool', count: 1 },
  ]);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ singleId, multiId, requestOnlyId }) => {
    const singleEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(singleId)}"]`);
    const multiEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(multiId)}"]`);
    const requestOnlyEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(requestOnlyId)}"]`);
    return singleEvent?.classList.contains('code-mode-single-tool')
      && multiEvent?.classList.contains('code-mode-multi-tool')
      && requestOnlyEvent?.classList.contains('code-mode-single-tool');
  }, { singleId: single.id, multiId: multi.id, requestOnlyId: requestOnly.id });

  const singleEvent = page.locator(`#timeline .event[data-event-id="${single.id}"]`);
  const multiEvent = page.locator(`#timeline .event[data-event-id="${multi.id}"]`);
  const requestOnlyEvent = page.locator(`#timeline .event[data-event-id="${requestOnly.id}"]`);
  assert.equal(await singleEvent.locator('.eventKind').textContent(), 'Plan update');
  assert.match(await singleEvent.locator('.eventHeader').textContent(), /Code Mode/);
  assert.doesNotMatch(await singleEvent.locator('.eventHeader').textContent(), /Result output/);
  assert.doesNotMatch(await singleEvent.locator('.eventHeader').textContent(), /Declared request|response_item|2 raw|update_plan/);
  assert.equal(await singleEvent.locator('.toolChip').count(), 0, 'the native single-tool title makes the tool-name chip redundant');
  const singlePreview = singleEvent.locator('.codeModeRequestSummaryPreview');
  assert.equal(await singlePreview.count(), 1);
  assert.match(await singlePreview.textContent(), /Request.*2 steps.*Inspect single/s);
  const requestOnlyPreview = requestOnlyEvent.locator('.codeModeRequestSummaryPreview');
  assert.equal(await requestOnlyPreview.count(), 1);
  assert.match(await requestOnlyPreview.textContent(), /Request.*1 step.*Request only/s);
  await singleEvent.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${single.id}"] .planUpdateBlock`);
  assert.equal(await singleEvent.locator('.codeModeToolProjection').count(), 0);
  assert.equal(await singleEvent.locator('.codeModeSource').count(), 1, 'associated result remains folded in the timeline');
  assert.equal((await singleEvent.locator('.codeModeSource').textContent()).includes('const plan'), false);

  assert.equal(await multiEvent.locator('.eventKind').textContent(), 'Multiple operations');
  const multiHeader = await multiEvent.locator('.eventHeader').textContent();
  assert.match(multiHeader, /2 tools/);
  assert.doesNotMatch(multiHeader, /Result output/);
  assert.doesNotMatch(multiHeader, /Declared request|response_item|2 raw/);
  assert.equal(await multiEvent.locator('.toolChip').count(), 0);
  const multiPreview = multiEvent.locator('.codeModeDeclaredSequencePreview');
  assert.equal(await multiPreview.count(), 1);
  assert.match(await multiPreview.textContent(), /Declared sequence.*Plan update.*1 step.*Inspect multi.*Shell command.*Write-Output multi/s);
  await multiEvent.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${multi.id}"] .codeModeToolProjection`);
  assert.equal(await multiEvent.locator('.codeModeToolProjection').count(), 2);
  assert.equal(await multiEvent.locator('.codeModeSource').count(), 3, 'two associated results plus outer source remain folded');
  await multiEvent.locator('.eventToggle').click();
  await page.waitForFunction((eventId) => {
    const event = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return event && !event.classList.contains('expanded') && Boolean(event.querySelector('.codeModeDeclaredSequencePreview'));
  }, multi.id);
  if (await page.locator('[data-detail-action="close"]').count()) {
    await page.locator('[data-detail-action="close"]').click();
    await waitForDetailView(page, 'profileRules');
  }
  await page.locator('#detail [data-profile-kind="other_tool_call"]').selectOption('summary');
  await page.locator('#resetFoldsBtn').click();
  await page.waitForFunction((eventId) => {
    const event = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return event?.classList.contains('summary') && Boolean(event.querySelector('.codeModeDeclaredSequencePreview.codeModeSummaryPreview'));
  }, multi.id);
  assert.equal(await multiPreview.locator('code').count(), 0);
  await page.waitForFunction((eventId) => {
    const event = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return event?.classList.contains('summary')
      && Boolean(event.querySelector('.codeModeRequestSummaryPreview.codeModeSummaryPreview'));
  }, requestOnly.id);
  assert.match(await requestOnlyPreview.textContent(), /Request.*1 step.*Request only/s);

  assert.equal(await requestOnlyEvent.locator('.eventKind').textContent(), 'Plan update');
  assert.match(await requestOnlyEvent.locator('.eventHeader').textContent(), /Code Mode/);
  assert.doesNotMatch(await requestOnlyEvent.locator('.eventHeader').textContent(), /Result output|Unassociated output/);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(({ singleId, multiId, requestOnlyId }) => {
    const label = (id) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"] .eventKind`)?.textContent;
    return label(singleId) === '计划更新'
      && label(multiId) === '多个操作'
      && label(requestOnlyId) === '计划更新';
  }, { singleId: single.id, multiId: multi.id, requestOnlyId: requestOnly.id });
  assert.match(await multiEvent.locator('.eventHeader').textContent(), /2 个工具/);
  assert.doesNotMatch(await multiEvent.locator('.eventHeader').textContent(), /结果输出/);
  assert.equal((await multiEvent.locator('.eventHeader').textContent()).includes('代码模式'), true, 'the Code Mode chip retains the shared origin identity');
  assert.equal(await multiEvent.locator('.codeModeChip').count(), 1);
  assert.match(await multiPreview.textContent(), /声明顺序.*计划更新.*1 个步骤.*Inspect multi.*Shell 命令.*Write-Output multi/s);
  assert.doesNotMatch(await requestOnlyEvent.locator('.eventHeader').textContent(), /结果输出|未关联输出/);
  assert.match(await requestOnlyPreview.textContent(), /请求.*1 个步骤.*Request only/s);
});

test('browser search-hit snippets stay navigable ahead of every folded Code Mode preview', async (t) => {
  const fixture = await makeCodeModeSearchPreviewCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operations = session.logicalEvents.filter((candidate) => candidate.kind === 'code_mode_operation');
  const single = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-search-single');
  const multi = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-search-multi');
  const raw = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-search-raw');
  assert.ok(single && multi && raw);

  const overrides = {
    [session.id]: {
      [single.id]: 'collapsed',
      [multi.id]: 'summary',
      [raw.id]: 'collapsed',
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: { 'sessionAnalyzer.overrides': JSON.stringify(overrides) },
  });
  const cases = [
    { event: single, state: 'collapsed', query: 'single result navigation needle', preview: '.codeModeRequestSummaryPreview' },
    { event: multi, state: 'summary', query: 'multi result navigation needle', preview: '.codeModeDeclaredSequencePreview' },
    { event: raw, state: 'collapsed', query: 'raw source navigation needle', preview: '.codeModeSourceExcerptPreview' },
  ];

  for (const item of cases) {
    const event = page.locator(`#timeline .event[data-event-id="${item.event.id}"]`);
    await page.waitForSelector(`#timeline .event[data-event-id="${item.event.id}"].${item.state} ${item.preview}`);
    await fillSearch(page, item.query);
    await page.waitForFunction(({ eventId, query }) => {
      const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
      return card?.classList.contains('searchHit')
        && (card.classList.contains('collapsed') || card.classList.contains('summary'))
        && card.querySelector('.eventPreview .searchMark')?.textContent.toLowerCase() === query;
    }, { eventId: item.event.id, query: item.query });
    assert.equal(await event.locator(item.preview).count(), 0, 'the bounded preview must yield to the active search snippet');
    const beforeNavigation = await searchNavigationSnapshot(page);
    const binding = beforeNavigation.bindings.find((candidate) => candidate.ownerId === item.event.id);
    assert.ok(binding?.live);
    assert.deepEqual(binding.surfaces, ['timeline']);
    await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
    await page.waitForFunction((eventId) => (
      document.querySelector(`.searchMark.activeSearchMark[data-search-target-owner="${CSS.escape(eventId)}"]`)
    ), item.event.id);
    assert.ok(await event.locator('.eventPreview .searchMark.activeSearchMark').count());
    assert.ok(await event.evaluate((node, state) => node.classList.contains(state), item.state));
    await fillSearch(page, '');
    await page.waitForSelector(`#timeline .event[data-event-id="${item.event.id}"].${item.state} ${item.preview}`);
  }
});

test('browser Code Mode presents web requests structurally, renders safe Markdown, and compacts associated lifecycle evidence', async (t) => {
  const fixture = await makeWebCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  const webLifecycle = session.logicalEvents.find((candidate) => candidate.kind === 'web_search');
  assert.ok(operation && webLifecycle);
  assert.equal(session.counts.toolCalls, 2);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }, { name: 'web_search', count: 1 }]);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ operationId, lifecycleId }) => {
    const operationEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`);
    const lifecycleEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(lifecycleId)}"]`);
    return operationEvent?.classList.contains('code-mode-single-tool')
      && lifecycleEvent?.classList.contains('code-mode-web-lifecycle');
  }, { operationId: operation.id, lifecycleId: webLifecycle.id });

  const operationEvent = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);
  const lifecycleEvent = page.locator(`#timeline .event[data-event-id="${webLifecycle.id}"]`);
  assert.equal(await operationEvent.locator('.eventKind').textContent(), 'Web search');
  assert.match(await operationEvent.locator('.eventHeader').textContent(), /Code Mode/);
  assert.doesNotMatch(await operationEvent.locator('.eventHeader').textContent(), /Result output/);
  assert.equal(await operationEvent.locator('.toolChip').count(), 0);
  assert.equal(await lifecycleEvent.locator('.eventKind').textContent(), 'Web activity observed');
  assert.equal(await lifecycleEvent.locator('.eventPreview').count(), 0);
  assert.equal(await lifecycleEvent.locator('.toolChip').count(), 0);

  await operationEvent.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operation.id}"] .webRequestBlock`);
  assert.match(await operationEvent.locator('.webRequestBlock').textContent(), /Web request.*Queries.*site:example\.test browser markdown.*Domains.*example\.test.*Response length.*long/s);
  const markdown = operationEvent.locator('.webResultMarkdown');
  assert.equal(await markdown.locator('h2').textContent(), 'Example browser result');
  assert.equal(await markdown.locator('strong').textContent(), 'Rendered browser emphasis');
  assert.equal(await markdown.locator('a[href="https://example.test/docs"]').count(), 1);
  assert.equal(await markdown.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await markdown.locator('script').count(), 0);
  assert.match(await markdown.textContent(), /citeturn0search0/);
  assert.equal((await operationEvent.textContent()).includes('Script completed'), false);
  assert.equal((await operationEvent.textContent()).includes('Associated result'), false);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(({ operationId, lifecycleId }) => {
    const label = (id) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"] .eventKind`)?.textContent;
    return label(operationId) === '网页搜索' && label(lifecycleId) === '已观测网页活动';
  }, { operationId: operation.id, lifecycleId: webLifecycle.id });
  assert.match(await operationEvent.locator('.webRequestBlock').textContent(), /网络请求.*查询.*域名.*响应长度/s);
  assert.match(await operationEvent.locator('.webResultMarkdown').textContent(), /网页结果.*Example browser result/s);
});

test('browser topbar width priorities keep search, Layer, and folding controls responsive', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { viewport: { width: 1280, height: 900 }, locale: 'en' });

  const readLayout = () => page.locator('.searchbar').evaluate((searchbar) => {
    const rect = (selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      return { top: bounds.top, left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
    };
    return {
      project: rect('.projectHeader'),
      sessions: rect('.sessionsPane'),
      searchbar: rect('.searchbar'),
      search: rect('.searchField'),
      layer: rect('#layerSelect'),
      folds: rect('.foldControls'),
      detailControls: rect('.topbarDetailControls'),
      timeline: rect('.timelinePane'),
      detail: rect('.detailPane'),
    };
  });

  let layout = await readLayout();
  assert.ok(Math.abs(layout.project.left - layout.sessions.left) < 1
    && Math.abs(layout.project.right - layout.sessions.right) < 1,
  'project header should share the sessions workspace column');
  assert.ok(layout.search.width <= 760.5, `expected capped search width, got ${layout.search.width}`);
  assert.ok(Math.abs(layout.search.left - (layout.timeline.left + 16)) < 1,
    'search should align with the padded timeline content edge');
  assert.ok(layout.search.left + layout.search.width <= layout.timeline.left + layout.timeline.width + 1,
    'search should not cross the timeline right boundary');
  assert.ok(Math.abs(layout.detailControls.left - layout.detail.left) < 1
    && Math.abs(layout.detailControls.right - layout.detail.right) < 1,
  'detail controls should occupy the same workspace column as the detail pane');
  assert.ok(layout.layer.width >= 129 && layout.layer.width <= 171);
  const topbarChrome = await page.locator('.topbar').evaluate((topbar) => {
    const chrome = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return { background: style.backgroundColor, borderLeft: style.borderLeftWidth, borderRight: style.borderRightWidth };
    };
    return {
      topbar: chrome('.topbar'),
      regions: ['.projectHeader', '.searchField', '.topbarDetailControls'].map(chrome),
    };
  });
  assert.notEqual(topbarChrome.topbar.background, 'rgba(0, 0, 0, 0)');
  assert.equal(topbarChrome.regions.every((region) => region.background === 'rgba(0, 0, 0, 0)'
    && region.borderLeft === '0px' && region.borderRight === '0px'), true,
  'workspace alignment should not visually split the topbar');

  await page.setViewportSize({ width: 820, height: 900 });
  layout = await readLayout();
  assert.ok(layout.search.top < layout.detailControls.top, 'search should occupy the first compact-medium row');
  assert.ok(layout.layer.left >= layout.detailControls.left && layout.layer.right <= layout.detailControls.right);
  assert.ok(layout.folds.width === 0
    || (layout.folds.left >= layout.detailControls.left && layout.folds.right <= layout.detailControls.right));
  assert.ok(Math.abs(layout.search.width - (layout.searchbar.width - 32)) < 2,
    'search should span the compact-medium workspace column with shared padding');

  await page.locator('#searchFilterBtn').click();
  const assistLayout = await page.locator('#searchAssist').evaluate((assist) => {
    const field = document.querySelector('.searchField').getBoundingClientRect();
    const bounds = assist.getBoundingClientRect();
    return { fieldWidth: field.width, assistWidth: bounds.width, aligned: Math.abs(field.left - bounds.left) < 2 };
  });
  assert.equal(assistLayout.aligned, true);
  assert.equal(Math.round(assistLayout.assistWidth), Math.round(Math.min(560, Math.max(500, assistLayout.fieldWidth))));
  await page.locator('#searchAssistClose').click();

  await fillSearch(page, 'patch');
  const resultsAlignment = await page.locator('#searchAssist').evaluate((assist) => {
    const input = document.querySelector('#searchInput').getBoundingClientRect();
    const metrics = document.querySelector('#searchMetricsPanel').getBoundingClientRect();
    return { inputLeft: input.left, metricsLeft: metrics.left, assistMode: assist.dataset.mode };
  });
  assert.equal(resultsAlignment.assistMode, 'results');
  assert.ok(Math.abs(resultsAlignment.inputLeft - resultsAlignment.metricsLeft) < 2,
    'results metrics should align with the free-text input');
  await page.locator('#searchInput').fill('');
  await page.locator('#searchInput').press('Escape');

  await page.setViewportSize({ width: 760, height: 900 });
  layout = await readLayout();
  assert.ok(layout.search.top < layout.detailControls.top && layout.layer.top >= layout.detailControls.top,
    'narrow controls should stack in priority order');
  assert.ok(Math.abs(layout.search.width - layout.layer.width) < 2);
  assert.ok(layout.folds.width === 0 || Math.abs(layout.layer.width - layout.folds.width) < 2);
});

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

test('browser project chrome separates project switching from session-list reindexing', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedPaths } = await openApp(t, index, { locale: 'en' });
  const refreshButton = page.locator('#projectRefreshBtn');

  assert.equal(await page.locator('.projectMark').isVisible(), true);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Change project');
  assert.equal(await refreshButton.getAttribute('title'), 'Reindex current project');
  assert.equal(await refreshButton.evaluate((button) => button.parentElement?.classList.contains('sessionListTitleGroup')), true);

  const selectedSessionId = await page.locator('.sessionItem.active').getAttribute('data-session-id');
  let releasePost;
  let markPostStarted;
  const postGate = new Promise((resolve) => {
    releasePost = resolve;
  });
  const postStarted = new Promise((resolve) => {
    markPostStarted = resolve;
  });
  await page.route('**/api/project', async (route) => {
    markPostStarted();
    await postGate;
    await route.continue();
  });

  await refreshButton.click();
  await postStarted;
  assert.equal(await refreshButton.isDisabled(), true);
  assert.equal(await refreshButton.getAttribute('data-refreshing'), 'true');
  assert.equal(await page.locator('#projectSwitchControl').isDisabled(), true);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), selectedSessionId);
  assert.match(await page.locator('#projectRefreshStatus').textContent(), /Reindexing|Preparing/);

  releasePost();
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false');
  assert.equal(await page.locator('#projectRefreshStatus').textContent(), 'Project reindexed');
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), selectedSessionId);
  assert.equal(requestedPaths.includes('/api/project'), true);
});

test('browser chooser switches transcript source and refreshes project candidates', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const dshHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-dsh-'));
  t.after(() => fsp.rm(dshHome, { recursive: true, force: true }));
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome, dshHome },
  });

  await waitForProjectRoot(page, repoRoot);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixtureCodexHome));
  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to Claude Code');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  // With DeepSeek Harness registered as the third source, the generic
  // chooser cycles Claude Code -> DeepSeek Harness -> Codex.
  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to DeepSeek Harness');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to DeepSeek Harness');
  await page.waitForFunction(() => document.querySelector('#projectSourceSwitch')?.dataset.source === 'deepseek-harness');
  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to Codex');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Codex');
  await waitForProjectRoot(page, repoRoot);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
});

test('browser source replacement preserves the remembered Main Trajectory presentation without stale event ownership', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot': repoRoot },
  });
  await page.waitForFunction(() => (
    document.body.dataset.projectMode === 'analyzing'
      && Boolean(document.querySelector('.sessionItem.active'))
      && document.querySelectorAll('#timeline .event[data-event-id]').length > 0
  ));
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  const originalEvent = page.locator('[data-trajectory-event-id]').first();
  const originalEventId = await originalEvent.getAttribute('data-trajectory-event-id');
  assert.ok(originalEventId);
  await originalEvent.click();
  await page.waitForFunction((eventId) => (
    document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId
  ), originalEventId);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  assert.equal(await page.locator('#mainPresentationControl').isVisible(), false);
  assert.equal(await page.locator('body').getAttribute('data-remembered-main-presentation'), 'trajectory');
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  await page.evaluate((root) => {
    const project = [...document.querySelectorAll('.projectItem[data-project-root]')]
      .find((item) => item.dataset.projectRoot === root);
    project?.click();
  }, fixture.claudeRepo);
  await page.waitForFunction((sessionId) => (
    document.body.dataset.projectMode === 'analyzing'
      && document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
      && Boolean(document.querySelector('.trajectoryPresentation'))
  ), analyzerSessionId(fixture.sessionId));

  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.equal(await page.locator('body').getAttribute('data-remembered-main-presentation'), 'trajectory');
  assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'trajectory');
  assert.equal(
    await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator(`[data-event-id="${originalEventId}"]`).count(), 0);
  assert.equal(await page.locator('.trajectoryOverviewLocator[data-trajectory-overview-selected-id]').count(), 0);
  assert.equal(await page.locator('.trajectoryPresentation').getAttribute('data-event-count'), '2');
});

test('browser source switch cycles through every supported registry source', async (t) => {
  const sourceOptions = [
    { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
    { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    { kind: 'deepseek-harness', label: 'DeepSeek Harness', homeOption: 'dshHome', homeLabel: 'DeepSeek sessions root' },
    { kind: 'future-source', label: 'Future Source', homeOption: 'futureSourceHome', homeLabel: 'Future Source home' },
  ];
  const homes = {
    codex: path.join(os.tmpdir(), 'browser-cycle-codex'),
    'claude-code': path.join(os.tmpdir(), 'browser-cycle-claude'),
    'deepseek-harness': path.join(os.tmpdir(), 'browser-cycle-dsh'),
    'future-source': path.join(os.tmpdir(), 'browser-cycle-future'),
  };
  let currentSource = 'codex';
  const sourcePayload = () => ({
    sourceKind: currentSource,
    sourceHome: homes[currentSource],
    sourceConfigs: Object.fromEntries(Object.keys(homes).map((kind) => [kind, { home: homes[kind] }])),
    codexHome: homes.codex,
    claudeHome: homes['claude-code'],
    dshHome: homes['deepseek-harness'],
    futureSourceHome: homes['future-source'],
    supportedSources: sourceOptions.map((option) => option.kind),
    sourceOptions,
    projects: [],
    projectSelected: false,
  });
  const posts = [];
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: sourcePayload() }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sourcePayload()),
        });
      });
      await p.route('**/api/source', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        posts.push(body.source);
        currentSource = body.source;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sourcePayload()),
        });
      });
    },
  });

  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to Claude Code');
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await page.waitForFunction(() => document.querySelector('#projectSourceAction')?.textContent === 'Switch to DeepSeek Harness');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to DeepSeek Harness');
  await page.waitForFunction(() => document.querySelector('#projectSourceAction')?.textContent === 'Switch to Future Source');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Future Source');
  await page.waitForFunction(() => document.querySelector('#projectSourceAction')?.textContent === 'Switch to Codex');
  assert.deepEqual(posts, ['claude-code', 'deepseek-harness', 'future-source']);
});

test('browser hydration prefers canonical source configs over conflicting legacy home fields', async (t) => {
  const canonicalCodexHome = path.join(os.tmpdir(), 'canonical-codex-home');
  const canonicalClaudeHome = path.join(os.tmpdir(), 'canonical-claude-home');
  const payload = {
    sourceKind: 'codex',
    sourceHome: canonicalCodexHome,
    sourceConfigs: {
      codex: { home: canonicalCodexHome },
      'claude-code': { home: canonicalClaudeHome },
    },
    codexHome: path.join(os.tmpdir(), 'legacy-codex-home'),
    claudeHome: path.join(os.tmpdir(), 'legacy-claude-home'),
    supportedSources: ['codex', 'claude-code'],
    sourceOptions: [
      { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
      { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    ],
    projects: [],
    projectSelected: false,
  };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: payload }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      });
    },
  });

  await page.waitForFunction(({ codex, claude }) => (
    document.querySelector('#projectCodexHomeInput')?.value === codex
      && document.querySelector('#projectClaudeHomeInput')?.value === claude
  ), { codex: canonicalCodexHome, claude: canonicalClaudeHome });
  assert.equal(await page.locator('#projectSourceHome').textContent(), '');
});

test('browser does not fall back to a legacy home when a canonical source config is malformed', async (t) => {
  const canonicalClaudeHome = path.join(os.tmpdir(), 'canonical-claude-home');
  const legacyCodexHome = path.join(os.tmpdir(), 'legacy-codex-home');
  const payload = {
    sourceKind: 'codex',
    sourceHome: '',
    sourceConfigs: {
      codex: {},
      'claude-code': { home: canonicalClaudeHome },
    },
    codexHome: legacyCodexHome,
    claudeHome: path.join(os.tmpdir(), 'legacy-claude-home'),
    supportedSources: ['codex', 'claude-code'],
    sourceOptions: [
      { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
      { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    ],
    projects: [],
    projectSelected: false,
  };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: payload }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      });
    },
  });

  await page.waitForFunction(() => Boolean(document.querySelector('#projectCodexHomeInput')));
  assert.deepEqual(await page.evaluate(() => ({
    codex: document.querySelector('#projectCodexHomeInput')?.value || '',
    claude: document.querySelector('#projectClaudeHomeInput')?.value || '',
  })), { codex: '', claude: canonicalClaudeHome });
});

test('browser clears stale source config and active home after a later malformed canonical hydration', async (t) => {
  const canonicalCodexHome = path.join(os.tmpdir(), 'canonical-codex-home');
  const canonicalClaudeHome = path.join(os.tmpdir(), 'canonical-claude-home');
  const initialPayload = {
    sourceKind: 'codex',
    sourceHome: canonicalCodexHome,
    sourceConfigs: {
      codex: { home: canonicalCodexHome },
      'claude-code': { home: canonicalClaudeHome },
    },
    codexHome: path.join(os.tmpdir(), 'legacy-codex-home'),
    claudeHome: path.join(os.tmpdir(), 'legacy-claude-home'),
    supportedSources: ['codex', 'claude-code'],
    sourceOptions: [
      { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
      { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    ],
    projects: [],
    projectSelected: false,
  };
  const malformedPayload = {
    ...initialPayload,
    sourceHome: '',
    sourceConfigs: {
      codex: {},
      'claude-code': { home: canonicalClaudeHome },
    },
  };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: initialPayload }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(malformedPayload),
        });
      });
    },
  });

  await page.waitForFunction((expectedClaudeHome) => (
    document.querySelector('#projectCodexHomeInput')?.value === ''
      && document.querySelector('#projectClaudeHomeInput')?.value === expectedClaudeHome
  ), canonicalClaudeHome);
  assert.equal(await page.locator('#projectSourceHome').textContent(), '');
});

test('browser clears old project rows before successor discovery settles after a source switch', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  let projectPosts = 0;
  let holdSuccessorFull = false;
  let releaseSuccessorFull;
  const successorFullGate = new Promise((resolve) => {
    releaseSuccessorFull = resolve;
  });
  let markSuccessorFullStarted;
  const successorFullStarted = new Promise((resolve) => {
    markSuccessorFullStarted = resolve;
  });
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
        if (url.pathname === '/api/project' && request.method() === 'POST') projectPosts += 1;
      });
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          if (sourcePosts === 0) {
            await route.continue();
            return;
          }
          const response = await route.fetch();
          const data = await response.json();
          data.projects = [];
          await route.fulfill({ response, json: data });
          return;
        }
        if (sourcePosts > 0 && !holdSuccessorFull) {
          holdSuccessorFull = true;
          markSuccessorFullStarted();
          await successorFullGate;
        }
        await route.continue();
      });
    },
  });
  t.after(() => releaseSuccessorFull());

  await waitForProjectRoot(page, repoRoot);
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await successorFullStarted;

  assert.equal(await page.locator('.projectItem[data-project-root]').count(), 0);
  assert.equal(projectPosts, 0);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);

  releaseSuccessorFull();
  await waitForProjectRoot(page, fixture.claudeRepo);
});

test('browser does not resurrect cached project rows when reopening the chooser', async (t) => {
  let summaryCalls = 0;
  let releaseReopenSummary;
  const reopenSummaryGate = new Promise((resolve) => {
    releaseReopenSummary = resolve;
  });
  let markReopenSummaryStarted;
  const reopenSummaryStarted = new Promise((resolve) => {
    markReopenSummaryStarted = resolve;
  });
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') !== '1') {
          await route.continue();
          return;
        }
        summaryCalls += 1;
        if (summaryCalls === 2) {
          markReopenSummaryStarted();
          await reopenSummaryGate;
        }
        await route.continue();
      });
    },
  });
  t.after(() => releaseReopenSummary());

  await waitForProjectRoot(page, repoRoot);
  await page.locator('.projectItem[data-project-root]').first().click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await reopenSummaryStarted;

  assert.equal(await page.locator('.projectItem[data-project-root]').count(), 0);

  releaseReopenSummary();
  await waitForProjectRoot(page, repoRoot);
});

test('browser chooser shows the server source before any switch', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { source: 'claude-code', claudeHome: fixture.claudeHome },
  });

  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to DeepSeek Harness');
  const chooserOrder = await page.locator('.projectChooserHeader').evaluate((header) => (
    [...header.children].map((child) => child.id || child.tagName)
  ));
  assert.ok(chooserOrder.indexOf('projectStatus') < chooserOrder.indexOf('projectProgress'));
  assert.ok(chooserOrder.indexOf('projectProgress') < chooserOrder.indexOf('projectSourceSwitch'));
});

test('browser chooser keeps sparse project rows content-sized', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { source: 'claude-code', claudeHome: fixture.claudeHome },
  });

  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(await page.locator('.projectItem').count(), 1);
  await page.locator('#projectHomeEditor summary').click();

  const layout = await page.locator('#projectList').evaluate((list) => {
    const item = list.querySelector('.projectItem');
    const main = item?.querySelector('.projectMain');
    return {
      listHeight: list.getBoundingClientRect().height,
      itemHeight: item?.getBoundingClientRect().height || 0,
      mainHeight: main?.getBoundingClientRect().height || 0,
    };
  });
  assert.ok(layout.listHeight > layout.itemHeight + 80, 'fixture should leave unused vertical space below the only project');
  assert.ok(layout.itemHeight <= 100, `project row should stay content-sized, got ${layout.itemHeight}px`);
  assert.ok(layout.mainHeight <= 64, `project main content should not stretch, got ${layout.mainHeight}px`);
});

test('browser last-selected repo is scoped per source and migrates legacy Codex storage', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot': repoRoot },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  const migrated = await page.evaluate(() => ({
    legacy: localStorage.getItem('sessionAnalyzer.repoRoot'),
    codex: localStorage.getItem('sessionAnalyzer.repoRoot.codex'),
    claude: localStorage.getItem('sessionAnalyzer.repoRoot.claude-code'),
  }));
  assert.equal(migrated.legacy, null);
  assert.equal(migrated.codex, repoRoot);
  assert.equal(migrated.claude, null);

  await page.evaluate(() => localStorage.setItem('sessionAnalyzer.repoRoot', 'stale-legacy-repo'));
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.waitForFunction(() => localStorage.getItem('sessionAnalyzer.repoRoot') === null);
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(await page.locator('.projectItem.lastSelected').count(), 0);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Select project');
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.repoRoot.claude-code')), null);
});

test('browser home directory edits preserve or drop Return by active identity', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
      });
    },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.locator('#projectHomeEditor summary').click();

  const inactiveClaudeHome = path.join(fixture.claudeHome, 'inactive-claude');
  await page.locator('#projectClaudeHomeInput').fill(inactiveClaudeHome);
  const sourcePostsBeforeInactiveEdit = sourcePosts;
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction((value) => document.querySelector('#projectClaudeHomeInput')?.value === value, inactiveClaudeHome);
  await page.waitForFunction(() => document.querySelector('#projectHomeApplyBtn')?.disabled === false);
  assert.ok(sourcePosts > sourcePostsBeforeInactiveEdit);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');

  const emptyCodexHome = path.join(fixture.claudeHome, 'empty-codex');
  await page.locator('#projectCodexHomeInput').fill(emptyCodexHome);
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceConfirm')?.hidden === false);
  assert.match(await page.locator('#projectSourceConfirm').textContent(), /current project/);
  const sourcePostsBeforeConfirm = sourcePosts;
  await page.locator('#projectCodexHomeInput').fill('relative-codex-home');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Home paths must be absolute'));
  assert.equal(sourcePosts, sourcePostsBeforeConfirm);

  await page.locator('#projectCodexHomeInput').fill(emptyCodexHome);
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('.projectSwitchHint')?.textContent === 'Select project');
  await page.waitForFunction(() => document.querySelectorAll('.projectItem').length === 0);
});

test('browser re-enables source controls and reconciles discovery after a failed source commit', async (t) => {
  let releaseFirstFull;
  const firstFullGate = new Promise((resolve) => {
    releaseFirstFull = resolve;
  });
  let fullCalls = 0;
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
      });
      await p.route('**/api/source', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":"synthetic failure"}',
        });
      });
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          await firstFullGate;
        }
        await route.continue();
      });
    },
  });

  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceAction')?.textContent === 'Confirm switch to Claude Code');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Source switch failed'));
  assert.equal(sourcePosts, 1);
  assert.equal(await page.locator('#projectSourceAction').isDisabled(), false);
  assert.equal(await page.locator('#projectSourceCancel').isHidden(), true);
  releaseFirstFull();
  await waitForProjectRoot(page, repoRoot);
  assert.ok(fullCalls >= 2, 'failed source commit should start a successor discovery');
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
});

test('browser reconciles lost source mutation responses against authoritative state', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: path.join(fixture.claudeHome, 'unused') },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      await p.route('**/api/source', async (route) => {
        sourcePosts += 1;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort('connectionreset');
      });
    },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.locator('#projectHomeEditor summary').click();

  await page.locator('#projectClaudeHomeInput').fill(fixture.claudeHome);
  const inactiveHomeDiscovery = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/projects' && !url.searchParams.has('summary') && response.status() === 200;
  });
  await page.locator('#projectHomeApplyBtn').click();
  await inactiveHomeDiscovery;
  assert.equal(sourcePosts, 1);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');
  assert.equal(await page.locator('#projectSourceError').textContent(), '');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(sourcePosts, 2);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Select project');
  assert.equal(await page.locator('#projectSourceError').textContent(), '');
});

test('browser locks Return, project selection, and home inputs while a source mutation is in flight', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseSourcePost;
  const sourcePostGate = new Promise((resolve) => {
    releaseSourcePost = resolve;
  });
  let markSourcePostStarted;
  const sourcePostStarted = new Promise((resolve) => {
    markSourcePostStarted = resolve;
  });
  let projectPosts = 0;
  let stateRequests = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/project' && request.method() === 'POST') projectPosts += 1;
        if (url.pathname === '/api/state' && request.method() === 'GET') stateRequests += 1;
      });
      await p.route('**/api/source', async (route) => {
        markSourcePostStarted();
        await sourcePostGate;
        await route.continue();
      });
    },
  });
  t.after(() => releaseSourcePost());

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await waitForProjectRoot(page, repoRoot);
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await sourcePostStarted;

  const projectPostsBeforeSyntheticClicks = projectPosts;
  const stateRequestsBeforeSyntheticClicks = stateRequests;
  const projectRows = page.locator('.projectItem[data-project-root]');
  const projectRowCount = await projectRows.count();
  assert.ok(projectRowCount > 0);
  assert.equal(await page.locator('.projectItem[data-project-root]:disabled').count(), projectRowCount);
  assert.equal(await page.locator('#projectSwitchControl').isDisabled(), true);
  assert.equal(await page.locator('#projectCodexHomeInput').isDisabled(), true);
  assert.equal(await page.locator('#projectClaudeHomeInput').isDisabled(), true);
  await projectRows.first().dispatchEvent('click');
  await page.locator('#projectSwitchControl').dispatchEvent('click');
  const lateClaudeDraft = path.join(fixture.claudeHome, 'late-unsent-draft');
  await page.locator('#projectClaudeHomeInput').evaluate((input, value) => {
    input.disabled = false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, lateClaudeDraft);
  await page.waitForTimeout(50);
  assert.equal(projectPosts, projectPostsBeforeSyntheticClicks);
  assert.equal(stateRequests, stateRequestsBeforeSyntheticClicks);
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'selecting');

  releaseSourcePost();
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(await page.locator('.projectItem:disabled').count(), 0);
  assert.equal(await page.locator('#projectSwitchControl').isDisabled(), false);
  assert.equal(await page.locator('#projectClaudeHomeInput').inputValue(), lateClaudeDraft);
});

test('browser ignores a non-409 failure from invalidated project discovery', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseObsoleteFull;
  const obsoleteFullGate = new Promise((resolve) => {
    releaseObsoleteFull = resolve;
  });
  let markObsoleteFullStarted;
  const obsoleteFullStarted = new Promise((resolve) => {
    markObsoleteFullStarted = resolve;
  });
  let markObsoleteFullSettled;
  const obsoleteFullSettled = new Promise((resolve) => {
    markObsoleteFullSettled = resolve;
  });
  let fullCalls = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          markObsoleteFullStarted();
          await obsoleteFullGate;
          await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"obsolete discovery failure"}' });
          markObsoleteFullSettled();
          return;
        }
        await route.continue();
      });
    },
  });
  t.after(() => releaseObsoleteFull());

  await obsoleteFullStarted;
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  const successorStatus = await page.locator('#projectStatus').textContent();

  releaseObsoleteFull();
  await obsoleteFullSettled;
  await page.waitForTimeout(100);
  assert.ok(fullCalls >= 2, 'source switch should start a successor discovery');
  assert.equal(await page.locator('#projectStatus').textContent(), successorStatus);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  await waitForProjectRoot(page, fixture.claudeRepo);
});

test('browser keeps home-directory edits while project discovery settles', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseFull;
  const fullGate = new Promise((resolve) => {
    releaseFull = resolve;
  });
  const typedCodexHome = path.join(fixture.claudeHome, 'typed-codex');
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        await fullGate;
        await route.continue();
      });
    },
  });

  await page.locator('#projectHomeEditor summary').click();
  await page.locator('#projectCodexHomeInput').fill(typedCodexHome);
  releaseFull();
  await page.waitForFunction(() => document.querySelectorAll('.projectItem[data-project-root]').length > 0);
  assert.equal(await page.locator('#projectCodexHomeInput').inputValue(), typedCodexHome);
});

test('browser shows empty-state guidance after project discovery fails', async (t) => {
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"synthetic failure"}' });
      });
    },
  });

  await page.waitForFunction(() => document.querySelector('#projectSourceKind')?.textContent.includes('Try switching to'));
  const emptySummary = page.locator('.projectSourceSummary[data-empty="true"]');
  await emptySummary.waitFor();
  assert.equal(await emptySummary.evaluate((element) => getComputedStyle(element).fontWeight), '600');
  assert.equal(await page.locator('.projectItem').count(), 0);
});

test('browser skips home-change confirmation for path-equivalent inputs', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.locator('#projectHomeEditor summary').click();
  const equivalentHome = process.platform === 'win32'
    ? `${fixtureCodexHome.toUpperCase()}\\`
    : `${fixtureCodexHome}/`;
  await page.locator('#projectCodexHomeInput').fill(equivalentHome);
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction((value) => document.querySelector('#projectCodexHomeInput')?.value === value, fixtureCodexHome);
  assert.equal(await page.locator('#projectSourceConfirm').isHidden(), true);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');
});

test('browser treats backslashes as literal characters in POSIX home paths', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  const posixCodexHome = '/home/me/.codex';
  const posixDshHome = '/home/me/.dsh/sessions';
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        Object.assign(data, {
          sourceKind: 'codex',
          sourceHome: posixCodexHome,
          codexHome: posixCodexHome,
          claudeHome: '/home/me/.claude',
          dshHome: posixDshHome,
          sourceConfigs: {
            ...data.sourceConfigs,
            codex: { home: posixCodexHome },
            'claude-code': { home: '/home/me/.claude' },
            'deepseek-harness': { home: posixDshHome },
          },
        });
        await route.fulfill({ response, json: data });
      });
      await p.route('**/api/source', async (route) => {
        sourcePosts += 1;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unexpected source mutation"}' });
      });
    },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.waitForFunction((value) => document.querySelector('#projectCodexHomeInput')?.value === value, posixCodexHome);
  await page.locator('#projectHomeEditor summary').click();
  await page.locator('#projectCodexHomeInput').fill(`${posixCodexHome}\\`);
  await page.locator('#projectHomeApplyBtn').click();

  assert.equal(await page.locator('#projectSourceConfirm').isHidden(), false);
  assert.match(await page.locator('#projectSourceConfirm').textContent(), /current project/);
  assert.equal(sourcePosts, 0);
});

test('browser source switch carries unapplied home-directory edits', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: path.join(fixture.claudeHome, 'unused') },
  });
  await waitForProjectRoot(page, repoRoot);

  await page.locator('#projectHomeEditor summary').click();
  const draftClaudeHome = fixture.claudeHome;
  await page.locator('#projectClaudeHomeInput').fill(draftClaudeHome);
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  await page.waitForFunction((value) => document.querySelector('#projectClaudeHomeInput')?.value === value, draftClaudeHome);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(draftClaudeHome));
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
});

test('browser reapplies inactive home edits with a successor discovery while scan is in flight', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseFirstFull;
  const firstFullGate = new Promise((resolve) => {
    releaseFirstFull = resolve;
  });
  let fullCalls = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          await firstFullGate;
        }
        await route.continue();
      });
    },
  });

  await page.locator('#projectHomeEditor summary').click();
  const inactiveHome = path.join(fixture.claudeHome, 'inactive-race');
  await page.locator('#projectClaudeHomeInput').fill(inactiveHome);
  const sourcePost = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/source'
    && response.request().method() === 'POST'
  ));
  await page.locator('#projectHomeApplyBtn').click();
  await sourcePost;
  releaseFirstFull();

  await waitForProjectRoot(page, repoRoot);
  await page.waitForFunction((value) => document.querySelector('#projectClaudeHomeInput')?.value === value, inactiveHome);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixtureCodexHome));
});

test('browser applies source config from a 202 indexing-job state', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let resolveIndex;
  const buildIndex = () => new Promise((resolve) => {
    resolveIndex = resolve;
  });
  const { page } = await openSourceSwitchChooser(t, {
    server: {
      source: 'claude-code',
      claudeHome: fixture.claudeHome,
      repo: fixture.claudeRepo,
      buildIndex,
    },
  });

  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  resolveIndex(await buildClaudeSourceBackedIndex({
    repoRoot: fixture.claudeRepo,
    claudeHome: fixture.claudeHome,
  }));
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
});

test('browser keeps discovery alive when source confirmation fails empty or relative home validation', async (t) => {
  let releaseFirstFull;
  const firstFullGate = new Promise((resolve) => {
    releaseFirstFull = resolve;
  });
  let fullCalls = 0;
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
      });
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          await firstFullGate;
        }
        await route.continue();
      });
    },
  });

  await page.locator('#projectHomeEditor summary').click();
  await page.locator('#projectClaudeHomeInput').fill('');
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Home paths must not be empty'));
  assert.equal(sourcePosts, 0);

  await page.locator('#projectClaudeHomeInput').fill('relative-claude-home');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Home paths must be absolute'));
  assert.equal(sourcePosts, 0);

  releaseFirstFull();
  await waitForProjectRoot(page, repoRoot);
  assert.equal(sourcePosts, 0);
});

test('browser reindex retries transient status and committed-session transport failures', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  let statusAttempts = 0;
  let sessionAttempts = 0;

  await page.route('**/api/project/status?*', async (route) => {
    statusAttempts += 1;
    if (statusAttempts === 1) {
      await route.abort('connectionrefused');
      return;
    }
    await route.continue();
  });
  await page.route('**/api/sessions?*', async (route) => {
    sessionAttempts += 1;
    if (sessionAttempts === 1) {
      await route.abort('connectionrefused');
      return;
    }
    await route.continue();
  });

  await page.locator('#projectRefreshBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false');

  assert.equal(await page.locator('#projectRefreshStatus').textContent(), 'Project reindexed');
  assert.ok(statusAttempts >= 2, 'status polling should retry after a transport failure');
  assert.ok(sessionAttempts >= 2, 'committed session loading should retry through the succeeded job');
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
  assert.match((await page.locator('.searchInlineCount').textContent()).trim(), /^\d+ sessions$/);

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
    const button = document.querySelector('#timeline [data-search-back-to-project], #resultSummary [data-search-back-to-project]');
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
  await page.locator('#projectSourceAction').click();
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
  let requestCount = 0;
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === '/api/file-suggestions') failed.push(request.url());
  });
  await page.route('**/api/file-suggestions*', async (route) => {
    requestCount += 1;
    const ordinal = requestCount;
    if (ordinal === 1) {
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
  const selectedSessionId = await page.locator('.sessionItem.active').getAttribute('data-session-id');
  await page.locator(`[data-session-id="${selectedSessionId}"]`).click();
  await newerStarted.promise;
  await page.waitForFunction(() => window.__wave1aM2.evidence.paused);

  await page.evaluate(() => window.__wave1aM2.releaseHandoff());
  await page.waitForFunction(() => window.__wave1aM2.evidence.handoffs.length >= 2);
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
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === '/api/file-suggestions') failed.push(request.url());
  });
  await page.route('**/api/file-suggestions*', async (route) => {
    requestCount += 1;
    const ordinal = requestCount;
    if (ordinal === 1) {
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
  const eventRef = page.locator(`#detail [data-event-ref-id="${temporaryEventId}"]`);
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
    mapGets: 0,
    arrayComparisons: 0,
  }, 'the first post-envelope lookup is the specific renderTimeline temporary-membership Map has');

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
  assert.match((await page.locator('.searchInlineCount').textContent()).trim(), /^\d+ sessions$/);
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

  const paginationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(paginationRequests.some((url) => url.searchParams.get('offset') === '150'), true);
  await page.waitForFunction(() => !document.querySelector('#loadMoreBtn')?.textContent.includes('Loading'));
  await page.waitForLoadState('networkidle');
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

test('browser Wave 1C M1 canonical-context changes reject colliding-ID owner reuse across repeated Session switches', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 320, secondaryEventCount: 40 });
  const { page } = await openWave1cM1App(t, index, { locale: 'en' });
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  const collisionId = await page.locator('#timeline .event[data-event-id]').first().getAttribute('data-event-id');
  assert.ok(collisionId);
  await page.route(`**/api/sessions/${fixture.secondarySessionId}/timeline*`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.events?.length) body.events[0] = { ...body.events[0], id: collisionId };
    await route.fulfill({ response, json: body });
  });

  const initial = await latestWave1cM1Lifecycle(page);
  const initialOwnerSerial = initial.ownerSerials[0];
  await page.evaluate(() => {
    window.__wave1cM1RetiredArticles = [document.querySelector('#timeline .event[data-event-id]')];
    window.__wave1cM1.reset();
  });
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await page.waitForFunction((eventId) => (
    document.querySelector('#timeline .event[data-event-id]')?.dataset.eventId === eventId
  ), collisionId);
  const secondary = await latestWave1cM1Lifecycle(page);
  assert.equal(secondary.sameCanonicalContext, false);
  assert.notEqual(secondary.ownerSerials[0], initialOwnerSerial);
  assert.equal(await page.evaluate(() => window.__wave1cM1RetiredArticles[0].isConnected), false);

  for (const sessionId of [fixture.longSessionId, fixture.secondarySessionId, fixture.longSessionId]) {
    await page.evaluate(() => {
      window.__wave1cM1RetiredArticles.push(document.querySelector('#timeline .event[data-event-id]'));
    });
    await page.locator(`[data-session-id="${sessionId}"]`).click();
    await page.waitForSelector(`[data-session-id="${sessionId}"].active`);
    await page.waitForFunction(() => window.__wave1cM1.evidence.lifecycle.at(-1)?.mode === 'main');
    const snapshot = await latestWave1cM1Lifecycle(page);
    assert.equal(snapshot.ownerCount, await page.locator('#timeline .event[data-event-id]').count());
    assert.ok(snapshot.ownerCount <= 150, 'owner count must describe only the current Session mount');
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
  const ref = page.locator(`#detail [data-event-ref-id="${temporaryEventId}"]`);
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

test('browser Wave 1C M2 replacements, Session switch, Protocol, and Raw remain full-render controls', async (t) => {
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
  let rows = await wave1cM2OperationRows(page, operationId);
  assert.ok(rows.some((row) => row.commitKind === 'replacement'));
  assert.equal(rows.some((row) => row.commitKind === 'appendOnly'), false);
  assert.equal(await oldArticle.evaluate((node) => node.isConnected), false);

  operationId = await beginWave1cM2Operation(page);
  const filterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('kind') === 'user_message'
      && url.searchParams.get('offset') === '0';
  });
  await addSearchFilter(page, 'kind', 'user_message');
  await filterResponse;
  rows = await wave1cM2OperationRows(page, operationId);
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

test('browser Wave 1D-A M1 ordinary body phrase removal recreates only affected-owner marks', async (t) => {
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
      bodyMarkCount: article.querySelectorAll(':scope > .eventBody mark.searchMark').length,
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
  assert.equal(marks.ownerMarkCount, 0);
  assert.equal(marks.targetPreserved, true);
  assert.equal(marks.targetTimelineBindingCount, 0);
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
        await route.continue();
      });
    },
  });
  const owner = page.locator(`#timeline .event[data-event-id="${nested.id}"]`);
  await owner.waitFor();
  await page.evaluate(() => window.__wave1dAM1.reset());
  await owner.locator(':scope > .eventHeader > .eventToggle').click();
  await started.promise;
  await page.evaluate((ownerId) => {
    const article = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(ownerId)}"]`);
    const slot = article.previousElementSibling;
    if (!slot?.classList.contains('contextRevealSlot')) throw new Error('expected context slot');
    article.parentElement.append(slot);
  }, nested.id);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const operationId = await beginWave1cM2Operation(page);
  gate.resolve();
  await page.waitForFunction(() => window.__wave1dAM1.evidence.detailRequests.some(
    (row) => row.presentationSettlement,
  ));
  await endWave1cM2Operation(page);
  const causal = await page.evaluate(() => structuredClone(window.__wave1dAM1.evidence));
  const settlement = causal.detailRequests.find((row) => row.presentationSettlement);
  assert.equal(settlement.settlementOutcome, 'fullRenderFallback');
  assert.equal(settlement.presentationFailed, false);
  assert.equal((await wave1cM2OperationRows(page, operationId))
    .filter((row) => row.commitKind === 'replacement').length, 1);
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
  rows = await wave1cM2OperationRows(page, operationId);
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

test('browser folding profile exposes declared Code Mode requests and previews request rules immediately', async (t) => {
  const fixture = await makeCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const { page } = await openApp(t, index);

  const codeModeSection = page.locator('#detail [data-profile-section="code-mode"]');
  await codeModeSection.waitFor();
  const eventKindGroupNames = await page.locator(
    '#detail .profileRuleSection',
  ).first().locator(':scope > .profileRuleList > .profileRuleGroup > h4').allTextContents();
  const commonWorkIndex = eventKindGroupNames.findIndex((name) => /Work and tools|工作与工具/.test(name));
  const codeModeIndex = eventKindGroupNames.findIndex((name) => /Code Mode tool calls|Code Mode 工具调用/.test(name));
  assert.ok(commonWorkIndex >= 0);
  assert.equal(codeModeIndex, -1);
  assert.match(
    await codeModeSection.locator('xpath=ancestor::section[contains(@class, "profileRuleGroup")]/h4').textContent(),
    /Work and tools|工作与工具/,
  );
  assert.equal(
    await page.locator('#detail .profileDetailHeader').evaluate((header) => getComputedStyle(header).position),
    'sticky',
  );
  assert.equal(await page.locator('#detail .profileStrategyDescription').count(), 1);
  const stickyHeaderPosition = await page.locator('.detailPane').evaluate((pane) => {
    pane.scrollTop = pane.scrollHeight;
    const header = pane.querySelector('.profileDetailHeader');
    const paneRect = pane.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return {
      scrollable: pane.scrollHeight > pane.clientHeight,
      scrollTop: pane.scrollTop,
      paneTop: paneRect.top,
      panePaddingTop: Number.parseFloat(getComputedStyle(pane).paddingTop) || 0,
      headerTop: headerRect.top,
    };
  });
  if (stickyHeaderPosition.scrollable) {
    assert.ok(stickyHeaderPosition.scrollTop > 0);
    assert.ok(
      Math.abs(
        stickyHeaderPosition.headerTop
        - stickyHeaderPosition.paneTop
        - stickyHeaderPosition.panePaddingTop
      ) <= 2,
      `expected sticky profile header at detail-pane top: ${JSON.stringify(stickyHeaderPosition)}`,
    );
  }
  assert.equal(await codeModeSection.locator('[data-profile-condition="codeModeScriptOperation"]').count(), 1);
  assert.equal(
    await page.locator('#detail [data-profile-condition="codeModeScriptOperation"]').count(),
    1,
  );
  assert.equal(await page.locator('#detail [data-profile-kind="code_mode_script_operation"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="command"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="error"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-default-kinds]').count(), 0);
  assert.match(await codeModeSection.locator(':scope > p > strong').textContent(), /Code Mode tool calls|Code Mode 工具调用/);
  assert.equal(await codeModeSection.locator('h4').count(), 0);
  assert.equal(await codeModeSection.locator('[data-profile-condition="codeModeOperation"]').count(), 0);
  assert.match(
    await codeModeSection.locator('[data-profile-condition="codeModeScriptOperation"] option:checked').textContent(),
    /Inherit:|继承：/,
  );
  assert.equal(await codeModeSection.locator('.codeModeRuleCard, .codeModeRequestDetails, .profileRuleCount').count(), 0);
  for (const profileId of ['conversation', 'changes', 'debug', 'search', 'compact']) {
    await page.evaluate((id) => {
      const select = document.querySelector('#detail [data-profile-picker]');
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, profileId);
    await page.waitForFunction((id) => document.querySelector('#profileSelect')?.value === id, profileId);
    if (await page.locator('#detail [data-detail-action="close"]').count()) {
      await page.locator('#detail [data-detail-action="close"]').click();
    }
    await waitForDetailView(page, 'profileRules');
    const placement = await page.evaluate(() => {
      const section = document.querySelector('#detail [data-profile-section="code-mode"]');
      return {
        profile: document.querySelector('#detail [data-profile-picker]')?.value || '',
        count: document.querySelectorAll('#detail [data-profile-section="code-mode"]').length,
        inGroup: Boolean(section?.closest('.profileRuleGroup')),
        inDefaults: Boolean(section?.closest('[data-profile-default-kinds]')),
      };
    });
    assert.deepEqual(placement, {
      profile: profileId,
      count: 1,
      inGroup: true,
      inDefaults: false,
    }, `${profileId} keeps Code Mode controls in the explicit Work and tools group`);
  }
  await page.evaluate(() => {
    const select = document.querySelector('#detail [data-profile-picker]');
    select.value = 'narrative';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value === 'narrative');
  if (await page.locator('#detail [data-detail-action="close"]').count()) {
    await page.locator('#detail [data-detail-action="close"]').click();
  }
  await page.waitForFunction(() => (
    document.querySelector('#detail [data-profile-picker]')?.value === 'narrative'
    && document.querySelectorAll('#detail [data-profile-section="code-mode"]').length === 1
  ));
  const requestRule = page.locator('#detail [data-profile-code-mode-request="wait_agent"]');
  await requestRule.waitFor();
  const rowText = await requestRule.locator('xpath=..').textContent();
  assert.match(rowText, /Wait for subagent|等待子代理/);
  assert.match(rowText, /wait_agent/);
  assert.match(rowText, /Inherit:|继承：/);
  assert.match(await requestRule.locator('option[value=""]').textContent(), /Collapsed|折叠/);

  assert.equal(
    await page.locator('#detail [data-profile-kind="other_tool_call"]').count(),
    0,
    'zero-count ordinary tool kinds stay hidden even when Code Mode requests inherit their rules',
  );

  await requestRule.selectOption('expanded');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.code-mode-single-tool')]
    .some((event) => event.classList.contains('expanded')));
  assert.equal(await requestRule.locator('xpath=..').locator('.profileRuleChanged').count(), 1);
});

test('browser structured filters keep profile-hidden Code Mode request results visible', async (t) => {
  const fixture = await makeCodeModeSearchPreviewCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const hiddenProfile = {
    id: 'custom:hidden-code-mode-filter-results',
    name: 'Hidden Code Mode filter results',
    description: 'Exercises the structured-filter visibility floor.',
    rules: {
      kindStates: {},
      codeModeRequestStates: {},
      fallback: 'hidden',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenProfile]),
      'sessionAnalyzer.profile': hiddenProfile.id,
    },
  });

  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.hiddenByProfile').length >= 3
  ));
  assert.equal(await page.locator('#searchKindSelect option[value="code_mode_operation"]').count(), 0);
  assert.equal(await page.locator('[data-search-filter-row="codeModeRequest"]').count(), 0);
  assert.equal(
    await page.locator('#searchKindSelect optgroup[data-kind-group="code-mode"]').getAttribute('label'),
    '↳ Code Mode tool call',
  );
  const execRequestOption = page.locator('#searchKindSelect option[value="code_mode_request:exec_command"]');
  assert.equal(await execRequestOption.count(), 1);
  assert.match(await execRequestOption.textContent(), /^Declared: Exec command \(1\)$/);
  assert.doesNotMatch(await execRequestOption.textContent(), /\(exec_command\)/);
  assert.match(
    await page.locator('#searchKindSelect option[value="code_mode_request:shell_command"]').textContent(),
    /Declared: Shell command \(1\)/,
  );
  assert.doesNotMatch(
    await page.locator('#searchKindSelect option[value="code_mode_request:shell_command"]').textContent(),
    /\(shell_command\)/,
  );
  assert.match(
    await page.locator('#searchKindSelect option[value="code_mode_script_operation"]').textContent(),
    /Scripted operation \(1\)/,
  );
  await addSearchFilter(page, 'kind', 'code_mode_request:exec_command');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:exec_command');

  await addSearchFilter(page, 'kind', 'code_mode_request:shell_command');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:shell_command');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters · 1');

  await addSearchFilter(page, 'kind', 'code_mode_script_operation');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_script_operation');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters · 1');

  await clearAllSearch(page);
  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.hiddenByProfile').length >= 3
  ));
  await switchToProjectScope(page);
  await page.waitForFunction(() => (
    document.querySelector('#searchKindSelect option[value="code_mode_request:exec_command"]')?.textContent
      === 'Declared: Exec command (1)'
    && document.querySelector('#searchKindSelect option[value="code_mode_request:shell_command"]')?.textContent
      === 'Declared: Shell command (1)'
  ));
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

test('browser projects source-backed Cache Observation evidence and navigates Main to Protocol to Main', async (t) => {
  const fixture = await makeCacheObservationBrowserFixture(t);
  const materialized = await materializeIndexedSession(
    fixture.index,
    fixture.discontinuitySessionId,
  );
  const links = materialized.presentationIndexes.cacheDiscontinuityLinks;
  assert.equal(links.protocolEventIdsByMainEventId.size, 1);
  const [mainEventId, protocolEventIds] = [...links.protocolEventIdsByMainEventId][0];
  assert.equal(protocolEventIds.length, 2);
  const protocolEvents = materialized.logicalEvents.filter((event) => event.layer === 'protocol');
  assert.ok(protocolEvents.findIndex((event) => event.id === protocolEventIds[0]) >= 150);
  const codeModeMaterialized = await materializeIndexedSession(
    fixture.index,
    fixture.codeModeSessionId,
  );
  const codeModeLinks = codeModeMaterialized.presentationIndexes.cacheDiscontinuityLinks;
  assert.equal(codeModeLinks.protocolEventIdsByMainEventId.size, 1);
  const [codeModeMainEventId, codeModeProtocolEventIds] = [...codeModeLinks.protocolEventIdsByMainEventId][0];
  assert.equal(codeModeProtocolEventIds.length, 1);
  assert.equal(
    codeModeMaterialized.logicalEvents.find((event) => event.id === codeModeMainEventId)?.kind,
    'code_mode_operation',
  );

  const consoleProblems = [];
  const { page, requestedUrls } = await openApp(t, fixture.index, {
    locale: 'en',
    skipProjectReindex: true,
    beforeGoto: async (browserPage) => {
      browserPage.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          consoleProblems.push(`${message.type()}: ${message.text()}`);
        }
      });
    },
  });
  await page.locator(`[data-session-id="${fixture.discontinuitySessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.discontinuitySessionId);

  const mainAnchor = page.locator(`#timeline .event[data-event-id="${mainEventId}"]`);
  const affordance = mainAnchor.locator('.cacheDiscontinuityAffordance');
  await affordance.waitFor();
  assert.equal(await page.locator('#timeline .cacheDiscontinuityAffordance').count(), 1);
  assert.equal((await affordance.textContent()).trim(), '2 cache discontinuities · View evidence');
  assert.equal(await mainAnchor.locator('.cacheUsagePreview').count(), 0);
  assert.equal(await page.locator('#analysisPanel').getByText(/Cache reuse|Discontinuities|Cache health/).count(), 0);

  await addSearchFilter(page, 'kind', 'assistant_message');
  await page.waitForFunction((eventId) => (
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .cacheDiscontinuityAffordance`)
  ), mainEventId);
  await page.keyboard.press('Escape');
  const overridesBeforeNavigation = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides'));

  await affordance.click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'protocol'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: protocolEventIds[0] });
  const protocolTarget = page.locator(`#timeline .event[data-event-id="${protocolEventIds[0]}"]`);
  assert.equal(await protocolTarget.count(), 1);
  assert.equal(await protocolTarget.evaluate((element) => element.classList.contains('temporaryReferenceReveal')), true);
  assert.ok(requestedUrls.some((url) => (
    url.includes('/timeline?')
      && url.includes('layer=protocol')
      && url.includes('kind=assistant_message')
  )));
  assert.equal((await protocolTarget.locator('.eventKind').textContent()).trim(), 'Token usage');
  assert.equal(await protocolTarget.locator('.cacheDiscontinuityChip').textContent(), 'Cache discontinuity');
  assert.match(await protocolTarget.locator('.cacheUsagePreview').textContent(), /Input.*12\.3k.*Cached.*0.*0%.*Output.*589/s);
  assert.match(await protocolTarget.locator('.cacheDiscontinuityContext').textContent(), /after 14s.*cached 16\.4k → 0/s);
  assert.ok(requestedUrls.some((url) => (
    url.includes(`/events/${encodeURIComponent(protocolEventIds[0])}?`)
      && !url.includes('/detail')
  )));

  await page.waitForFunction(() => (
    document.querySelector('#detail')?.textContent.includes('Comparison Context')
      && document.querySelector('#detail')?.textContent.includes('explicit cache-expiry evidence')
  ));
  const inspectorText = await page.locator('#detail').textContent();
  assert.match(inspectorText, /Input12,288/);
  assert.match(inspectorText, /Cached input0/);
  assert.match(inspectorText, /Input-token delta−4,096 \(−25%\)/);
  assert.match(inspectorText, /Cache-read delta−16,384/);
  assert.match(inspectorText, /Cache reuse100% → 0%/);
  assert.match(inspectorText, /Comparison stateCache discontinuity/);
  assert.equal(inspectorText.includes('reasonCodes'), false);

  const reverse = page.locator('#detail [data-detail-action="navigate-linked-event"]');
  assert.equal((await reverse.textContent()).trim(), 'View Main context');
  await reverse.click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'main'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: mainEventId });
  await expectInputValue(page, '#searchKindSelect', 'assistant_message');
  assert.equal(await page.locator('#timeline .temporaryReferenceReveal').count(), 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides')),
    overridesBeforeNavigation,
  );
  assert.equal(await page.locator(`#timeline .event[data-event-id="${mainEventId}"] .cacheDiscontinuityAffordance`).count(), 1);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => (
    document.querySelector('#timeline .cacheDiscontinuityAffordance')?.textContent
      === '2 次缓存复用中断 · 查看证据'
  ));

  await clearAllSearch(page);

  await page.locator(`[data-session-id="${fixture.singleSessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.singleSessionId);
  assert.equal(
    (await page.locator('#timeline .cacheDiscontinuityAffordance').textContent()).trim(),
    '缓存复用中断 · 查看证据',
  );

  await page.locator(`[data-session-id="${fixture.ordinarySessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.ordinarySessionId);
  assert.equal(await page.locator('#timeline .cacheDiscontinuityAffordance').count(), 0);
  assert.equal(await page.locator('#analysisPanel').getByText(/缓存复用|缓存健康/).count(), 0);
  await page.locator('#layerSelect').selectOption('protocol');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .cacheUsageEvent').length === 2);
  assert.equal(await page.locator('#timeline .cacheDiscontinuityChip').count(), 0);
  assert.equal(await page.locator('#timeline .cacheDiscontinuityContext').count(), 0);
  assert.equal(await page.locator('#timeline .cacheUsageEvent .eventKind').last().textContent(), 'Token 使用情况');
  await page.locator('#timeline .cacheUsageEvent').last().click();
  await page.locator('#detail .tokenUsageBlock').waitFor();
  assert.equal(await page.locator('#detail [data-detail-action="navigate-linked-event"]').count(), 0);

  await switchHiddenLocale(page, 'en');
  const mainLayerResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('layer') === 'main';
  });
  await page.locator('#layerSelect').selectOption('main');
  await mainLayerResponse;
  await page.locator(`[data-session-id="${fixture.codeModeSessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.codeModeSessionId);
  const codeModeAnchor = page.locator(`#timeline .event[data-event-id="${codeModeMainEventId}"]`);
  const codeModeAffordance = codeModeAnchor.locator('.cacheDiscontinuityAffordance');
  await codeModeAffordance.waitFor();

  await addSearchFilter(page, 'kind', 'code_mode_request:exec_command');
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:exec_command');
  await page.waitForFunction((eventId) => (
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .cacheDiscontinuityAffordance`)
  ), codeModeMainEventId);
  await page.keyboard.press('Escape');
  const linkedRequestStart = requestedUrls.length;

  await codeModeAffordance.click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'protocol'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: codeModeProtocolEventIds[0] });
  const codeModeProtocolTarget = page.locator(`#timeline .event[data-event-id="${codeModeProtocolEventIds[0]}"]`);
  assert.equal(await codeModeProtocolTarget.evaluate((element) => element.classList.contains('temporaryReferenceReveal')), true);
  const linkedProtocolRequests = requestedUrls.slice(linkedRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('layer') === 'protocol');
  assert.ok(linkedProtocolRequests.length > 0);
  assert.ok(linkedProtocolRequests.every((url) => !url.searchParams.has('codeModeRequest')));
  assert.ok(linkedProtocolRequests.some((url) => url.searchParams.get('kind') === 'code_mode_operation'));
  assert.equal(await page.locator('#searchKindSelect').inputValue(), '');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 1');
  assert.match(await page.locator('#searchFilterBtn').getAttribute('title'), /Code Mode tool call/);
  assert.doesNotMatch(await page.locator('#searchFilterBtn').getAttribute('title'), /Exec command|Declared/);

  await page.locator('#detail [data-detail-action="navigate-linked-event"]').click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'main'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: codeModeMainEventId });
  assert.equal(await page.locator('#searchKindSelect').inputValue(), '');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 1');
  assert.doesNotMatch(await page.locator('#searchFilterBtn').getAttribute('title'), /Exec command|Declared/);

  await addSearchFilter(page, 'kind', 'code_mode_request:exec_command');
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:exec_command');
  await page.keyboard.press('Escape');
  const manualRequestStart = requestedUrls.length;
  const manualProtocolResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('layer') === 'protocol';
  });
  await page.locator('#layerSelect').selectOption('protocol');
  await manualProtocolResponse;
  const manualProtocolRequests = requestedUrls.slice(manualRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('layer') === 'protocol');
  assert.ok(manualProtocolRequests.length > 0);
  assert.ok(manualProtocolRequests.every((url) => !url.searchParams.has('codeModeRequest')));
  assert.equal(await page.locator('#searchKindSelect').inputValue(), '');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 1');
  assert.deepEqual(consoleProblems, []);
});
