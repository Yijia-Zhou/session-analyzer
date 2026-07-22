'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { buildIndex } = require('../src/codex');
const { createServer } = require('../server');
const { createTimelineProfileFixture } = require('./timeline-profile-fixture');

const MIN_PROFILE_EVENT_COUNT = 1651;
const MIN_PROFILE_TEXT_BYTES = 256;
const MAX_PROFILE_TEXT_BYTES = 65536;

function parseArgs(argv) {
  const options = { label: 'profile', output: '', headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--headed') options.headed = true;
    else if (value === '--label') options.label = argv[++index] || options.label;
    else if (value === '--output') options.output = argv[++index] || '';
    else if (value === '--event-count') {
      const eventCount = Number(argv[++index]);
      if (!Number.isInteger(eventCount) || eventCount < MIN_PROFILE_EVENT_COUNT) {
        throw new Error(`--event-count must be an integer greater than or equal to ${MIN_PROFILE_EVENT_COUNT}`);
      }
      options.eventCount = eventCount;
    }
    else if (value === '--text-bytes') {
      const searchableTextBytes = Number(argv[++index]);
      if (!Number.isInteger(searchableTextBytes)
          || searchableTextBytes < MIN_PROFILE_TEXT_BYTES
          || searchableTextBytes > MAX_PROFILE_TEXT_BYTES) {
        throw new Error(`--text-bytes must be an integer from ${MIN_PROFILE_TEXT_BYTES} to ${MAX_PROFILE_TEXT_BYTES}`);
      }
      options.searchableTextBytes = searchableTextBytes;
    }
    else throw new Error(`Unknown option: ${value}`);
  }
  return options;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

async function installPageInstrumentation(context) {
  await context.addInitScript(() => {
    const metrics = {
      startedAt: 0,
      fullRenders: 0,
      cardGenerations: 0,
      highlightPasses: 0,
      highlightMarksCreated: 0,
      highlightedOwners: new Set(),
      longTasks: [],
    };
    const reset = () => {
      metrics.startedAt = performance.now();
      metrics.fullRenders = 0;
      metrics.cardGenerations = 0;
      metrics.highlightPasses = 0;
      metrics.highlightMarksCreated = 0;
      metrics.highlightedOwners = new Set();
      metrics.longTasks = [];
      performance.clearResourceTimings();
    };
    const snapshot = () => {
      const timeline = document.querySelector('#timeline');
      const longDurations = metrics.longTasks.map((entry) => entry.duration);
      return {
        fullRenders: metrics.fullRenders,
        cardGenerations: metrics.cardGenerations,
        highlightPasses: metrics.highlightPasses,
        highlightMarksCreated: metrics.highlightMarksCreated,
        highlightedOwnerCount: metrics.highlightedOwners.size,
        finalCards: timeline?.querySelectorAll('.event[data-event-id]').length || 0,
        finalMarks: document.querySelectorAll('.searchMark').length,
        finalDomNodes: document.querySelectorAll('*').length,
        finalTimelineNodes: timeline?.querySelectorAll('*').length || 0,
        longTasks: {
          count: longDurations.length,
          totalMs: longDurations.reduce((sum, value) => sum + value, 0),
          maxMs: longDurations.length ? Math.max(...longDurations) : 0,
          durations: longDurations,
        },
        resources: performance.getEntriesByType('resource').map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          transferSize: entry.transferSize,
        })),
        loadedLabel: document.querySelector('#loadMoreBtn')?.textContent || '',
        loadMoreDisabled: Boolean(document.querySelector('#loadMoreBtn')?.disabled),
        activeSessionId: document.querySelector('.sessionItem.active')?.dataset.sessionId || '',
        timelineScrollTop: document.querySelector('.timelinePane')?.scrollTop || 0,
      };
    };
    Object.defineProperty(window, '__timelineProfile', { value: { reset, snapshot }, configurable: false });

    const observeTimeline = () => {
      const timeline = document.querySelector('#timeline');
      if (!timeline) return;
      new MutationObserver((records) => {
        let highlightMutation = false;
        for (const record of records) {
          if (record.target === timeline && (record.addedNodes.length || record.removedNodes.length)) {
            metrics.fullRenders += 1;
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              metrics.cardGenerations += Number(node.matches?.('.event[data-event-id]'));
              metrics.cardGenerations += node.querySelectorAll?.('.event[data-event-id]').length || 0;
            }
          }
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            const marks = [
              ...(node.matches?.('.searchMark') ? [node] : []),
              ...(node.querySelectorAll?.('.searchMark') || []),
            ];
            if (marks.length) highlightMutation = true;
            metrics.highlightMarksCreated += marks.length;
            for (const mark of marks) {
              if (mark.dataset.searchTargetOwner) metrics.highlightedOwners.add(mark.dataset.searchTargetOwner);
            }
          }
        }
        if (highlightMutation) metrics.highlightPasses += 1;
      }).observe(timeline, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeTimeline, { once: true });
    else observeTimeline();
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= metrics.startedAt) metrics.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  });
}

async function waitForTimelineIdle(page, quietMs = 500, timeoutMs = 30000) {
  const network = page.__timelineProfileNetwork;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (network.pending === 0 && Date.now() - network.lastActivity >= quietMs) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timeline requests did not settle within ${timeoutMs} ms`);
}

async function openProfilePage(browser, baseUrl, fixture) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installPageInstrumentation(context);
  const page = await context.newPage();
  const requests = [];
  const failures = [];
  const network = { pending: 0, lastActivity: Date.now() };
  page.__timelineProfileNetwork = network;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    const family = url.pathname.endsWith('/timeline')
      ? 'timeline'
      : (url.pathname.endsWith('/detail')
        ? 'detail'
        : (url.pathname === '/api/raw'
          ? 'raw'
          : (url.pathname.endsWith('/analysis') ? 'analysis' : 'other')));
    requests.push({
      family,
      url: `${url.pathname}${url.search}`,
      offset: Number(url.searchParams.get('offset') || 0),
      limit: Number(url.searchParams.get('limit') || 0),
      q: url.searchParams.get('q') || '',
      kind: url.searchParams.get('kind') || '',
      startedAt: Date.now(),
    });
    network.pending += 1;
    network.lastActivity = Date.now();
  });
  const settleRequest = (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    network.pending = Math.max(0, network.pending - 1);
    network.lastActivity = Date.now();
  };
  page.on('requestfinished', settleRequest);
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    settleRequest(request);
    if (!url.pathname.startsWith('/api/')) return;
    failures.push({ url: request.url(), error: request.failure()?.errorText || '' });
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length === 150);
  return { context, page, requests, failures };
}

async function resetScenario(page, requests, failures) {
  await page.evaluate(() => window.__timelineProfile.reset());
  return { requestIndex: requests.length, failureIndex: failures.length, startedAt: Date.now() };
}

async function scenarioSummary(page, requests, failures, start) {
  await waitForTimelineIdle(page);
  const browserMetrics = await page.evaluate(() => window.__timelineProfile.snapshot());
  const scenarioRequests = requests.slice(start.requestIndex);
  const scenarioFailures = failures.slice(start.failureIndex);
  const timelineRequests = scenarioRequests.filter((request) => request.family === 'timeline');
  const timelineResources = browserMetrics.resources.filter((entry) => new URL(entry.name).pathname.endsWith('/timeline'));
  const durations = timelineResources.map((entry) => entry.duration);
  return {
    durationMs: Date.now() - start.startedAt,
    apiRequestCount: scenarioRequests.length,
    requestFamilies: Object.fromEntries([...new Set(scenarioRequests.map((request) => request.family))]
      .sort()
      .map((family) => [family, scenarioRequests.filter((request) => request.family === family).length])),
    timelineRequestCount: timelineRequests.length,
    timelineRequests: timelineRequests.map(({ offset, limit, q, kind }) => ({ offset, limit, q, kind })),
    detailRequestCount: scenarioRequests.filter((request) => request.family === 'detail').length,
    timelineResourceMs: round(durations.reduce((sum, value) => sum + value, 0)),
    timelineResourceP95Ms: round(percentile(durations, 0.95)),
    failedRequestCount: scenarioFailures.length,
    intentionalAbortCount: scenarioFailures.filter((failure) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)).length,
    failedRequests: scenarioFailures,
    fullRenders: browserMetrics.fullRenders,
    cardGenerations: browserMetrics.cardGenerations,
    highlightPasses: browserMetrics.highlightPasses,
    highlightMarksCreated: browserMetrics.highlightMarksCreated,
    highlightedOwnerCount: browserMetrics.highlightedOwnerCount,
    finalCards: browserMetrics.finalCards,
    finalMarks: browserMetrics.finalMarks,
    finalDomNodes: browserMetrics.finalDomNodes,
    finalTimelineNodes: browserMetrics.finalTimelineNodes,
    longTasks: {
      count: browserMetrics.longTasks.count,
      totalMs: round(browserMetrics.longTasks.totalMs),
      maxMs: round(browserMetrics.longTasks.maxMs),
    },
    loadedLabel: browserMetrics.loadedLabel,
    loadMoreDisabled: browserMetrics.loadMoreDisabled,
    activeSessionId: browserMetrics.activeSessionId,
    timelineScrollTop: round(browserMetrics.timelineScrollTop),
  };
}

async function primeRareSearch(page) {
  await page.locator('#searchInput').fill('far-needle');
  await page.locator('#searchInput').dispatchEvent('input');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length === 600, null, { timeout: 60000 });
  await waitForTimelineIdle(page);
}

async function jumpToRareHit(page) {
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('#searchMetricsPanel');
    return document.querySelectorAll('#timeline .event[data-event-id]').length >= 1651
      && Boolean(panel?.dataset.searchActiveTargetId);
  }, null, { timeout: 120000 });
  await waitForTimelineIdle(page, 700, 120000);
}

async function runProfile(baseUrl, browser, fixture) {
  const first = await openProfilePage(browser, baseUrl, fixture);
  try {
    let start = await resetScenario(first.page, first.requests, first.failures);
    await primeRareSearch(first.page);
    const searchPreload = await scenarioSummary(first.page, first.requests, first.failures, start);

    start = await resetScenario(first.page, first.requests, first.failures);
    await jumpToRareHit(first.page);
    const jumpToLateHit = await scenarioSummary(first.page, first.requests, first.failures, start);

    start = await resetScenario(first.page, first.requests, first.failures);
    const queryRequest = first.page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'switch-query';
    });
    await first.page.locator('#searchInput').fill('switch-query');
    await first.page.locator('#searchInput').dispatchEvent('input');
    await queryRequest;
    await first.page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
    await first.page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
    await first.page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length === 40, null, { timeout: 120000 });
    const switchDuringQuery = await scenarioSummary(first.page, first.requests, first.failures, start);

    const second = await openProfilePage(browser, baseUrl, fixture);
    try {
      await primeRareSearch(second.page);
      await jumpToRareHit(second.page);
      await second.page.locator('#searchInput').fill('common-term');
      await second.page.locator('#searchInput').dispatchEvent('input');
      await second.page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/timeline')
          && url.searchParams.get('q') === 'common-term'
          && url.searchParams.get('offset') === '1500';
      }, { timeout: 120000 });
      await waitForTimelineIdle(second.page, 700, 120000);
      await second.page.evaluate(() => {
        const pane = document.querySelector('.timelinePane');
        pane.scrollTop = pane.scrollHeight;
      });
      await waitForTimelineIdle(second.page, 500, 120000);
      await second.page.evaluate(() => {
        const pane = document.querySelector('.timelinePane');
        pane.scrollTop = pane.scrollHeight;
      });
      await second.page.waitForTimeout(100);
      start = await resetScenario(second.page, second.requests, second.failures);
      await second.page.locator('#searchFilterBtn').click();
      await second.page.locator('[data-search-filter-control="kind"]').selectOption('assistant_message');
      await second.page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/timeline')
          && url.searchParams.get('kind') === 'assistant_message'
          && url.searchParams.get('offset') === '0';
      }, { timeout: 120000 });
      await second.page.waitForTimeout(1200);
      const deepStructuredFilter = await scenarioSummary(second.page, second.requests, second.failures, start);
      return { searchPreload, jumpToLateHit, switchDuringQuery, deepStructuredFilter };
    } finally {
      await second.context.close();
    }
  } finally {
    await first.context.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-timeline-profile-'));
  let server;
  let browser;
  try {
    const fixture = await createTimelineProfileFixture(tempRoot, options);
    const indexStartedAt = Date.now();
    const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
    const indexMs = Date.now() - indexStartedAt;
    server = createServer(index, 1, { codexHome: fixture.codexHome, repo: fixture.repoRoot });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: !options.headed });
    const browserVersion = browser.version();
    const asset = await fsp.readFile(path.join(__dirname, '..', 'public', 'assets', 'app.js'));
    const sourceRevision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const summary = {
      schemaVersion: 1,
      label: options.label,
      recordedAt: new Date().toISOString(),
      environment: {
        sourceRevision,
        runtimeAssetSha256: crypto.createHash('sha256').update(asset).digest('hex'),
        node: process.version,
        chromium: browserVersion,
        platform: `${process.platform} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model || '',
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        viewport: { width: 1440, height: 1000 },
      },
      fixture: fixture.parameters,
      indexMs,
      scenarios: await runProfile(baseUrl, browser, fixture),
    };
    const json = `${JSON.stringify(summary, null, 2)}\n`;
    if (options.output) {
      const outputPath = path.resolve(options.output);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, json, 'utf8');
    }
    process.stdout.write(json);
  } finally {
    await browser?.close();
    await closeServer(server);
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MIN_PROFILE_EVENT_COUNT,
  MIN_PROFILE_TEXT_BYTES,
  MAX_PROFILE_TEXT_BYTES,
  parseArgs,
};
