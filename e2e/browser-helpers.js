'use strict';

// Shared synthetic fixtures and per-test browser/server helpers.
// Every caller keeps its own test context, browser, server and temporary directories.

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { chromium } = require('playwright');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { createServer } = require('../server');
const { createTimelineProfileFixture } = require('../scripts/timeline-profile-fixture');
const { measurePhase } = require('./browser-profile');

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
  await measurePhase(t, 'server-start', () => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)));
  t.after(() => measurePhase(t, 'server-cleanup', () => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  })));
  return `http://127.0.0.1:${server.address().port}`;
}

async function openApp(t, index, options = {}) {
  const baseUrl = await startServer(t, index, options);
  const browser = await measurePhase(t, 'browser-launch', () => chromium.launch());
  const context = await measurePhase(t, 'browser-context', () => browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 } }));
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
  t.after(() => measurePhase(t, 'browser-cleanup', async () => {
    await context.close();
    await browser.close();
  }));
  await measurePhase(t, 'page-ready', async () => {
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
  });
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

async function settledWave1cM2OperationRows(page, operationId) {
  // A response (or one animation frame) can precede JSON processing and render.
  // Keep the operation active until its canonical DOM commit reaches the ledger.
  // Accept any canonical mutation here, including appendOnly: correctness is
  // asserted by the caller, independently of synchronization.
  await page.waitForFunction((id) => window.__wave1cM2.evidence.rows.some((row) => (
    row.operationId === id && (row.addedCanonicalCount > 0 || row.removedCanonicalCount > 0)
  )), operationId);
  return wave1cM2OperationRows(page, operationId);
}

async function latestWave1cM1Lifecycle(page) {
  return page.evaluate(() => structuredClone(window.__wave1cM1.evidence.lifecycle.at(-1)));
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
  const target = { 'Confirm switch to Claude Code': 'claude-code', 'Confirm switch to DeepSeek Harness': 'deepseek-harness', 'Confirm switch to Codex': 'codex', 'Confirm switch to Future Source': 'future-source' }[expectedLabel];
  await page.waitForFunction(({ label, target }) => document.querySelector('#projectSourceAction')?.textContent === label || document.querySelector('#projectSourceSwitch')?.dataset.source === target, { label: expectedLabel, target });
  if (await page.locator('#projectSourceAction').isVisible()) await page.locator('#projectSourceAction').click();
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

async function assertEventCount(page, expected) {
  await page.waitForFunction((count) => document.querySelectorAll('#timeline .event[data-event-id]').length === count, expected);
}

async function waitForTimelineAppendIdle(page) {
  // Rendering appended events can precede follow-up transcript reads.
  // Use only after releasing request gates, before fixture cleanup or final request assertions.
  // These callers use the English locale for the loading label.
  await page.waitForFunction(() => !document.querySelector('#loadMoreBtn')?.textContent.includes('Loading'));
  await page.waitForLoadState('networkidle');
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
  const trajectoryDeepSessionId = 'adadadad-3333-4333-8333-adadadadadad';
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
  const deepMainPadding = Array.from({ length: 170 }, (_, index) => ({
    timestamp: timestamp(400 + index),
    type: 'response_item',
    payload: {
      type: 'message',
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: [{
        type: index % 2 === 0 ? 'input_text' : 'output_text',
        text: `Trajectory deep cache padding ${index}`,
      }],
    },
  }));
  const deepMainSuffix = Array.from({ length: 20 }, (_, index) => ({
    timestamp: timestamp(585 + index),
    type: 'response_item',
    payload: {
      type: 'message',
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: [{
        type: index % 2 === 0 ? 'output_text' : 'input_text',
        text: `Trajectory deep cache suffix ${index}`,
      }],
    },
  }));
  await writeJsonl(path.join(dir, `trajectory-deep-${trajectoryDeepSessionId}.jsonl`), [
    {
      timestamp: timestamp(398),
      type: 'session_meta',
      payload: { id: trajectoryDeepSessionId, cwd: cacheRepoRoot },
    },
    {
      timestamp: timestamp(399),
      type: 'event_msg',
      payload: { type: 'turn_started', turn_id: 'turn-cache-trajectory-deep' },
    },
    ...deepMainPadding,
    tokenCount(570, 16_384, 16_384, 200),
    {
      timestamp: timestamp(571),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Trajectory deep cache anchor' }],
      },
    },
    tokenCount(584, 12_288, 0, 250),
    ...deepMainSuffix,
    {
      timestamp: timestamp(605),
      type: 'event_msg',
      payload: { type: 'turn_complete', turn_id: 'turn-cache-trajectory-deep' },
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
    trajectoryDeepSessionId,
  };
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

module.exports = {
  addSearchFilter,
  assertEventCount,
  beginWave1cM2Operation,
  buildFixtureIndex,
  clearAllSearch,
  clickSearchNavigationAndWait,
  confirmSourceAction,
  deferred,
  endWave1cM2Operation,
  expectInputValue,
  fillSearch,
  fixtureCodexHome,
  installWave1bM2SourceBundle,
  installWave1cM1BrowserSeam,
  installWave1cM2MutationLedger,
  latestWave1cM1Lifecycle,
  makeCacheObservationBrowserFixture: (t, ...args) => measurePhase(t, 'fixture', () => makeCacheObservationBrowserFixture(t, ...args)),
  makeClaudeSwitchFixture: (t, ...args) => measurePhase(t, 'fixture', () => makeClaudeSwitchFixture(t, ...args)),
  makeCodeModeCodexHome: (t, ...args) => measurePhase(t, 'fixture', () => makeCodeModeCodexHome(t, ...args)),
  makeCodeModeSearchPreviewCodexHome: (t, ...args) => measurePhase(t, 'fixture', () => makeCodeModeSearchPreviewCodexHome(t, ...args)),
  makeContextCodeModeCodexHome: (t, ...args) => measurePhase(t, 'fixture', () => makeContextCodeModeCodexHome(t, ...args)),
  makeLongCodexHome: (t, ...args) => measurePhase(t, 'fixture', () => makeLongCodexHome(t, ...args)),
  makeTransitionProfileIndex: (t, ...args) => measurePhase(t, 'fixture', () => makeTransitionProfileIndex(t, ...args)),
  materializeIndexedSession,
  openApp,
  openSourceSwitchChooser,
  openWave1bM2App,
  openWave1cM1App,
  openWave1cM2App,
  primaryFixtureSessionId,
  repoRoot,
  searchNavigationSnapshot,
  selectPrimarySession,
  settledWave1cM2OperationRows,
  switchHiddenLocale,
  switchToProjectScope,
  waitForDetailView,
  waitForNoSearchMarks,
  waitForProjectCards,
  waitForProjectRoot,
  waitForSearchMarks,
  waitForTimelineAppendIdle,
  wave1cM2OperationRows,
  writeJsonl,
};
