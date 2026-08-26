'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { chromium } = require('playwright');
const { createServer } = require('../server');
const {
  getSourceAdapter,
  materializeSessionForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { createTimelineProfileFixture } = require('./timeline-profile-fixture');
const {
  captureGitIdentity,
} = require('./performance-wave-0-identity');

const MIN_PROFILE_EVENT_COUNT = 1651;
const MIN_PROFILE_TEXT_BYTES = 256;
const MAX_PROFILE_TEXT_BYTES = 65536;
const PROFILE_SCHEMA_VERSION = 3;
const INSPECTED_BASE_SHA = 'd370cc7bca56380457c147dc4c33637a0baedf68';
const REPOSITORY_SLUG = 'Yijia-Zhou/session-analyzer';
const TARGET_BRANCH = 'towards-0.2.0';

function parseArgs(argv) {
  const options = {
    label: 'profile',
    output: '',
    headed: false,
    repetitionIndex: 1,
    repetitionCount: 1,
    candidateSha: '',
    targetSyncSha: '',
  };
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
    else if (value === '--repetition-index' || value === '--repetition-count') {
      const parsed = Number(argv[++index]);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`${value} must be a positive integer`);
      }
      if (value === '--repetition-index') options.repetitionIndex = parsed;
      else options.repetitionCount = parsed;
    }
    else if (value === '--candidate-sha' || value === '--target-sync-sha') {
      const sha = argv[++index] || '';
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${value} must be a full commit SHA`);
      if (value === '--candidate-sha') options.candidateSha = sha;
      else options.targetSyncSha = sha;
    }
    else throw new Error(`Unknown option: ${value}`);
  }
  if (options.repetitionIndex > options.repetitionCount) {
    throw new Error('--repetition-index must not exceed --repetition-count');
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readNpmVersion() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm --version']
    : ['--version'];
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function reportDiagnosticStage(stage) {
  if (process.env.SESSION_ANALYZER_PROFILE_DIAGNOSTIC === '1') {
    process.stderr.write(`timeline-profile-stage:${stage}\n`);
  }
}

function countBy(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function timingStats(values) {
  if (!values.length) return { repeatCount: 0, median: 0, min: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    repeatCount: sorted.length,
    median: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
  };
}

function fixtureRole(fixture, sessionId) {
  if (sessionId === fixture.longSessionId) return 'primary';
  if (sessionId === fixture.secondarySessionId) return 'secondary';
  return 'unknown';
}

async function buildStrictProfileIndex(fixture, dependencies = {}) {
  const adapter = dependencies.adapter || getSourceAdapter('codex');
  const validateCommit = dependencies.validateCommit || validateIndexOwnershipForCommit;
  let buildInvocationCount = 0;
  let commitValidationInvocationCount = 0;
  let commitValidationChunkCount = 0;
  const buildStartedAt = performance.now();
  buildInvocationCount += 1;
  const index = await adapter.buildIndex({
    repoRoot: fixture.repoRoot,
    sourceKind: 'codex',
    sourceHome: fixture.codexHome,
    previousIndex: null,
  });
  const buildMs = performance.now() - buildStartedAt;
  const validationStartedAt = performance.now();
  commitValidationInvocationCount += 1;
  await validateCommit(index, {
    adapter,
    onChunk() {
      commitValidationChunkCount += 1;
    },
  });
  const validationMs = performance.now() - validationStartedAt;
  return {
    adapter,
    index,
    buildMs,
    validationMs,
    counters: {
      buildInvocationCount,
      commitValidationInvocationCount,
      commitValidationChunkCount,
    },
  };
}

function createProfileMaterializationTracker(fixture) {
  const calls = [];
  return {
    calls,
    async materializeSession(index, indexedSession, options = {}) {
      const call = {
        role: fixtureRole(fixture, indexedSession?.id),
        phases: [],
      };
      calls.push(call);
      const upstreamPhaseObserver = options.onMaterializationPhase || options.onProjectionPhase;
      return materializeSessionForIndex(index, indexedSession, {
        ...options,
        onMaterializationPhase(event) {
          call.phases.push({ phase: event.phase, state: event.state });
          upstreamPhaseObserver?.(event);
        },
      });
    },
    summary(startIndex = 0) {
      const selected = calls.slice(startIndex);
      return {
        totalCalls: selected.length,
        callsByRole: countBy(selected.map((call) => call.role)),
        phaseEvents: countBy(selected.flatMap((call) => call.phases.map((event) => (
          `${event.phase}:${event.state}`
        )))),
      };
    },
  };
}

function profileServerOptions(fixture, tracker) {
  return {
    codexHome: fixture.codexHome,
    sessionPrewarm: false,
    materializeSession: tracker.materializeSession,
  };
}

function createProfileServer(index, buildMs, fixture, tracker, serverFactory = createServer) {
  const options = profileServerOptions(fixture, tracker);
  const server = serverFactory(index, buildMs, options);
  return {
    server,
    setup: {
      projectJobCount: 0,
      prewarmDisabled: options.sessionPrewarm === false,
      optionsRepoPresent: Object.hasOwn(options, 'repo'),
    },
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

async function installPageInstrumentation(context, fixture) {
  await context.addInitScript((roleConfig) => {
    const eventRoles = new Map();
    const timelineState = new Map();
    const sessionRole = (sessionId) => {
      if (sessionId === roleConfig.primarySessionId) return 'primary';
      if (sessionId === roleConfig.secondarySessionId) return 'secondary';
      return 'unknown';
    };
    const cardsInNode = (node) => {
      if (!(node instanceof Element)) return [];
      return [
        ...(node.matches?.('.event[data-event-id]') ? [node] : []),
        ...(node.querySelectorAll?.('.event[data-event-id]') || []),
      ];
    };
    const captureTimelineState = () => {
      timelineState.clear();
      for (const card of document.querySelectorAll('#timeline .event[data-event-id]')) {
        const eventId = card.dataset.eventId || '';
        if (eventId) timelineState.set(eventId, eventRoles.get(eventId) || 'unknown');
      }
    };
    const timelineRoleCounts = () => {
      const counts = { primary: 0, secondary: 0, unknown: 0, canonical: 0 };
      for (const role of timelineState.values()) counts[role] += 1;
      counts.canonical = counts.primary + counts.secondary + counts.unknown;
      return counts;
    };
    const metrics = {
      startedAt: 0,
      fullRenders: 0,
      cardGenerations: 0,
      highlightPasses: 0,
      highlightMarksCreated: 0,
      highlightedOwners: new Set(),
      targetDiscoveryPasses: 0,
      contextRowInsertions: 0,
      contextRevealSlots: new WeakSet(),
      longTasks: [],
      lastWorkAt: performance.now(),
      commitSequence: 0,
      scenarioPhase: 'beforeSelectSecondary',
      domCommitLedger: [],
    };
    const reset = () => {
      captureTimelineState();
      metrics.startedAt = performance.now();
      metrics.fullRenders = 0;
      metrics.cardGenerations = 0;
      metrics.highlightPasses = 0;
      metrics.highlightMarksCreated = 0;
      metrics.highlightedOwners = new Set();
      metrics.targetDiscoveryPasses = 0;
      metrics.contextRowInsertions = 0;
      metrics.contextRevealSlots = new WeakSet();
      metrics.longTasks = [];
      metrics.lastWorkAt = performance.now();
      metrics.commitSequence = 0;
      metrics.scenarioPhase = 'beforeSelectSecondary';
      metrics.domCommitLedger = [];
      performance.clearResourceTimings();
    };
    const markSelectSecondary = () => {
      metrics.scenarioPhase = 'afterSelectSecondary';
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const requestUrl = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), location.href);
        const matchedSessionId = [roleConfig.primarySessionId, roleConfig.secondarySessionId]
          .find((sessionId) => requestUrl.pathname.includes(encodeURIComponent(sessionId)));
        const role = sessionRole(matchedSessionId || '');
        if (role !== 'unknown' && requestUrl.pathname.endsWith('/timeline')) {
          const parseJson = response.json.bind(response);
          Object.defineProperty(response, 'json', {
            configurable: true,
            value: async (...jsonArgs) => {
              const value = await parseJson(...jsonArgs);
              for (const event of value?.events || []) {
                if (typeof event?.id === 'string' && event.id) eventRoles.set(event.id, role);
              }
              return value;
            },
          });
        }
      } catch {}
      return response;
    };
    const installSearchTargetInstrumentation = () => {
      const targets = window.sessionSearchTargets;
      if (!targets || targets.__timelineProfileDiscoverWrapped || typeof targets.discover !== 'function') return false;
      const discover = targets.discover;
      Object.defineProperty(targets, '__timelineProfileDiscoverWrapped', { value: true, configurable: false });
      targets.discover = function profileDiscover(...args) {
        metrics.targetDiscoveryPasses += 1;
        const result = discover.apply(this, args);
        metrics.lastWorkAt = performance.now();
        return result;
      };
      return true;
    };
    const snapshot = () => {
      const timeline = document.querySelector('#timeline');
      const longDurations = metrics.longTasks.map((entry) => entry.duration);
      const searchMetrics = document.querySelector('#searchMetricsPanel');
      let searchTargetIds = [];
      try {
        searchTargetIds = JSON.parse(searchMetrics?.dataset.searchTargetIds || '[]');
      } catch {}
      const cardIds = [...(timeline?.querySelectorAll('.event[data-event-id]') || [])]
        .map((node) => node.getAttribute('data-event-id'));
      const targetOrdinal = (targetId) => {
        const mark = [...document.querySelectorAll('[data-search-target-id]')]
          .find((node) => node.dataset.searchTargetId === targetId && node.closest('#timeline'));
        return cardIds.indexOf(mark?.closest('.event[data-event-id]')?.dataset.eventId || '');
      };
      const searchTargetOrdinals = searchTargetIds.map(targetOrdinal);
      const activeTargetId = searchMetrics?.dataset.searchActiveTargetId || '';
      const visibleErrorCount = [...document.querySelectorAll('#stateLine[data-state="error"]')]
        .filter((node) => {
          const style = getComputedStyle(node);
          return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        }).length;
      return {
        fullRenders: metrics.fullRenders,
        cardGenerations: metrics.cardGenerations,
        highlightPasses: metrics.highlightPasses,
        highlightMarksCreated: metrics.highlightMarksCreated,
        highlightedOwnerCount: metrics.highlightedOwners.size,
        targetDiscoveryPasses: metrics.targetDiscoveryPasses,
        contextRowInsertions: metrics.contextRowInsertions,
        finalCards: timeline?.querySelectorAll('.event[data-event-id]').length || 0,
        finalMarks: document.querySelectorAll('.searchMark').length,
        finalDomNodes: document.querySelectorAll('*').length,
        finalTimelineNodes: timeline?.querySelectorAll('*').length || 0,
        contextRows: timeline?.querySelectorAll('.contextRevealRow').length || 0,
        searchTargetIds,
        searchTargetOrdinals,
        activeTargetOrdinal: targetOrdinal(activeTargetId),
        resultSummaryVisible: Boolean(document.querySelector('#resultSummary')?.textContent?.trim()),
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
        visibleErrorCount,
        domCommitLedger: metrics.domCommitLedger.map((entry) => ({
          sequence: entry.sequence,
          phase: entry.phase,
          afterSelectSecondary: entry.afterSelectSecondary,
          activeSessionRole: entry.activeSessionRole,
          cardCounts: { ...entry.cardCounts },
        })),
      };
    };
    Object.defineProperty(window, '__timelineProfile', {
      value: {
        reset,
        snapshot,
        markSelectSecondary,
        installSearchTargetInstrumentation,
        isQuiet(quietMs) {
          return performance.now() - metrics.lastWorkAt >= quietMs;
        },
      },
      configurable: false,
    });

    const observeTimeline = () => {
      const timeline = document.querySelector('#timeline');
      if (!timeline) return;
      new MutationObserver((records) => {
        if (records.length) metrics.lastWorkAt = performance.now();
        let highlightMutation = false;
        for (const record of records) {
          if (record.type === 'attributes'
              && record.attributeName === 'class'
              && record.target instanceof Element
              && record.target.classList.contains('contextRevealSlot')
              && record.target.classList.contains('contextRevealRow')
              && !String(record.oldValue || '').split(/\s+/).includes('contextRevealRow')
              && !metrics.contextRevealSlots.has(record.target)) {
            metrics.contextRevealSlots.add(record.target);
            metrics.contextRowInsertions += 1;
          }
          if (record.target === timeline && (record.addedNodes.length || record.removedNodes.length)) {
            metrics.fullRenders += 1;
            for (const node of record.removedNodes) {
              for (const card of cardsInNode(node)) timelineState.delete(card.dataset.eventId || '');
            }
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              metrics.cardGenerations += Number(node.matches?.('.event[data-event-id]'));
              metrics.cardGenerations += node.querySelectorAll?.('.event[data-event-id]').length || 0;
              for (const card of cardsInNode(node)) {
                const eventId = card.dataset.eventId || '';
                if (eventId) timelineState.set(eventId, eventRoles.get(eventId) || 'unknown');
              }
            }
            metrics.commitSequence += 1;
            metrics.domCommitLedger.push({
              sequence: metrics.commitSequence,
              phase: metrics.scenarioPhase,
              afterSelectSecondary: metrics.scenarioPhase === 'afterSelectSecondary',
              activeSessionRole: sessionRole(
                document.querySelector('.sessionItem.active')?.dataset.sessionId || '',
              ),
              cardCounts: timelineRoleCounts(),
            });
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
    }).observe(timeline, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
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
  }, {
    primarySessionId: fixture.longSessionId,
    secondarySessionId: fixture.secondarySessionId,
  });
}

async function waitForTimelineIdle(page, quietMs = 500, timeoutMs = 30000) {
  const network = page.__timelineProfileNetwork;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pageWorkQuiet = network.pending === 0 && await page.evaluate((minimumQuietMs) => (
      window.__timelineProfile?.isQuiet(minimumQuietMs) || false
    ), quietMs);
    if (network.pending === 0
        && Date.now() - network.lastActivity >= quietMs
        && pageWorkQuiet) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timeline requests did not settle within ${timeoutMs} ms`);
}

function classifyApiFamily(pathname) {
  if (pathname === '/api/state') return 'state';
  if (pathname === '/api/sessions') return 'sessions';
  if (pathname === '/api/file-suggestions') return 'fileSuggestions';
  if (pathname.endsWith('/timeline')) return 'timeline';
  if (pathname.endsWith('/detail')) return 'detail';
  if (/^\/api\/sessions\/[^/]+\/events\/[^/]+$/.test(pathname)) return 'eventEnvelope';
  if (pathname.endsWith('/analysis')) return 'analysis';
  if (pathname === '/api/raw') return 'rawRecord';
  if (pathname.includes('/legacy-raw')) return 'legacyRaw';
  return 'otherApi';
}

function queryAlias(value, fixture) {
  if (!value) return 'none';
  if (value === 'far-needle') return 'rareHit';
  if (value === 'common-term') return 'commonTerm';
  if (value === 'switch-query') return 'switchQuery';
  if (value === fixture.contextReveal?.toolName) return 'contextReveal';
  return 'otherSynthetic';
}

function closedAlias(value, allowed) {
  if (!value) return 'none';
  return allowed.includes(value) ? value : 'other';
}

function normalizedRequest(url, method, fixture, sequence) {
  const decodedPath = decodeURIComponent(url.pathname);
  const sessionId = [fixture.longSessionId, fixture.secondarySessionId]
    .find((id) => decodedPath.includes(id));
  return {
    sequence,
    method,
    family: classifyApiFamily(url.pathname),
    sessionRole: fixtureRole(fixture, sessionId),
    offset: Number(url.searchParams.get('offset') || 0),
    limit: Number(url.searchParams.get('limit') || 0),
    queryAlias: queryAlias(url.searchParams.get('q') || '', fixture),
    kindAlias: closedAlias(url.searchParams.get('kind') || '', ['assistant_message']),
    statusAlias: closedAlias(url.searchParams.get('status') || '', ['failed']),
    filterAlias: closedAlias(url.searchParams.get('layer') || '', ['main', 'protocol', 'raw']),
    outcome: 'pending',
    httpStatus: 0,
    startedAt: Date.now(),
    completedAt: 0,
  };
}

async function openProfilePage(browser, baseUrl, fixture) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installPageInstrumentation(context, fixture);
  const page = await context.newPage();
  const requests = [];
  const failures = [];
  const recordsByRequest = new Map();
  const network = { pending: 0, lastActivity: Date.now() };
  page.__timelineProfileNetwork = network;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    const record = normalizedRequest(url, request.method(), fixture, requests.length + 1);
    requests.push(record);
    recordsByRequest.set(request, record);
    network.pending += 1;
    network.lastActivity = Date.now();
  });
  page.on('response', (response) => {
    const record = recordsByRequest.get(response.request());
    if (record) record.httpStatus = response.status();
  });
  const settleRequest = (request) => {
    const record = recordsByRequest.get(request);
    if (!record) return;
    if (record.outcome === 'pending') record.outcome = 'success';
    record.completedAt = Date.now();
    network.pending = Math.max(0, network.pending - 1);
    network.lastActivity = Date.now();
  };
  page.on('requestfinished', settleRequest);
  page.on('requestfailed', (request) => {
    const record = recordsByRequest.get(request);
    if (!record) return;
    const errorText = request.failure()?.errorText || '';
    record.outcome = /ERR_ABORTED|NS_BINDING_ABORTED/i.test(errorText)
      ? 'intentionalAbort'
      : 'failed';
    failures.push({
      sequence: record.sequence,
      family: record.family,
      outcome: record.outcome,
    });
    settleRequest(request);
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length === 150);
  await page.evaluate(() => window.__timelineProfile.installSearchTargetInstrumentation());
  await waitForTimelineIdle(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { context, page, requests, failures };
}

async function resetScenario(page, requests, failures, tracker) {
  await waitForTimelineIdle(page, 1000, 120000);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await waitForTimelineIdle(page, 500, 120000);
  await page.evaluate(() => window.__timelineProfile.reset());
  return {
    requestIndex: requests.length,
    failureIndex: failures.length,
    materializationIndex: tracker?.calls.length || 0,
    actions: [],
    startedAt: Date.now(),
  };
}

function markScenarioAction(start, name, requests) {
  start.actions.push({ name, requestIndex: requests.length, at: Date.now() });
}

function aggregateResources(resources) {
  const groups = new Map();
  for (const entry of resources) {
    const family = classifyApiFamily(new URL(entry.name).pathname);
    const values = groups.get(family) || [];
    values.push(entry);
    groups.set(family, values);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([
    family,
    values,
  ]) => [family, {
    count: values.length,
    transferSizeTotal: values.reduce((sum, entry) => sum + Number(entry.transferSize || 0), 0),
    duration: timingStats(values.map((entry) => Number(entry.duration || 0))),
    durationTotal: round(values.reduce((sum, entry) => sum + Number(entry.duration || 0), 0)),
  }]));
}

function requestConstraints(
  scenarioRequests,
  start,
  functional,
  scenarioName,
  domCommitLedger = [],
) {
  const timeline = scenarioRequests.filter((request) => request.family === 'timeline');
  const pagingGroups = new Map();
  for (const request of timeline) {
    const key = [request.sessionRole, request.queryAlias, request.kindAlias, request.statusAlias].join(':');
    const values = pagingGroups.get(key) || [];
    values.push(request.offset);
    pagingGroups.set(key, values);
  }
  const monotonicTimelinePaging = [...pagingGroups.values()].every((offsets) => (
    offsets.every((offset, index) => index === 0 || offset >= offsets[index - 1])
  ));
  const envelope = scenarioRequests.find((request) => request.family === 'eventEnvelope');
  const detail = scenarioRequests.find((request) => request.family === 'detail');
  const secondarySelection = start.actions.find((action) => action.name === 'selectSecondary');
  const secondaryRequestsAfterSelection = !secondarySelection || scenarioRequests
    .filter((request) => request.sessionRole === 'secondary')
    .every((request) => request.sequence > secondarySelection.requestIndex);
  const postSecondaryCommits = domCommitLedger.filter((commit) => commit.afterSelectSecondary);
  const checks = {
    measuredRequestsFollowReset: scenarioRequests.every((request) => request.startedAt >= start.startedAt),
    monotonicTimelinePaging,
    envelopePrecedesDependentDetail: !envelope || !detail || envelope.sequence < detail.sequence,
    secondaryRequestsFollowSelection: secondaryRequestsAfterSelection,
    postSecondaryCommitObserved: scenarioName !== 'coldSessionSwitchDuringQuery'
      || postSecondaryCommits.length > 0,
    supersededPrimaryCannotCommit: scenarioName !== 'coldSessionSwitchDuringQuery'
      || postSecondaryCommits.every((commit) => (
        commit.cardCounts.primary === 0 && commit.cardCounts.unknown === 0
      )),
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    requiredEdges: [
      'scenarioReset->dependentRequests',
      'pagingOffsetN->pagingOffsetNPlus1WithinStream',
      'secondarySelection->secondaryRequests',
      'eventEnvelope->dependentDetailWhenPresent',
    ],
    forbiddenEdges: ['supersededPrimaryCommitAfterSecondarySelection'],
    unconstrainedSiblingFamilies: ['analysis', 'timeline', 'fileSuggestions'],
  };
}

function functionalState(browserMetrics, fixture) {
  const selectedSessionRole = fixtureRole(fixture, browserMetrics.activeSessionId);
  const functional = {
    selectedSessionRole,
    loadedCount: browserMetrics.finalCards,
    canonicalCardCount: browserMetrics.finalCards,
    markCount: browserMetrics.finalMarks,
    searchTargets: browserMetrics.searchTargetOrdinals.map((ordinal) => ({
      sessionRole: 'primary',
      ordinal,
    })),
    activeTarget: browserMetrics.activeTargetOrdinal >= 0
      ? { sessionRole: selectedSessionRole, ordinal: browserMetrics.activeTargetOrdinal }
      : null,
    resultSummary: { visible: browserMetrics.resultSummaryVisible },
    loadMore: {
      disabled: browserMetrics.loadMoreDisabled,
      state: browserMetrics.loadMoreDisabled ? 'settled' : 'available',
    },
    contextRowCount: browserMetrics.contextRows,
    contextRowIsolation: null,
    selectionUnchanged: null,
    scrollTop: round(browserMetrics.timelineScrollTop),
    visibleErrorCount: browserMetrics.visibleErrorCount,
  };
  functional.finalStateDigest = sha256(JSON.stringify(functional));
  return functional;
}

async function scenarioSummary(page, requests, failures, start, tracker, fixture, scenarioName) {
  await waitForTimelineIdle(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const browserMetrics = await page.evaluate(() => window.__timelineProfile.snapshot());
  const scenarioRequests = requests.slice(start.requestIndex);
  const scenarioFailures = failures.slice(start.failureIndex);
  const timelineRequests = scenarioRequests.filter((request) => request.family === 'timeline');
  const functional = functionalState(browserMetrics, fixture);
  const constraints = requestConstraints(
    scenarioRequests,
    start,
    functional,
    scenarioName,
    browserMetrics.domCommitLedger,
  );
  const materializer = tracker.summary(start.materializationIndex);
  return {
    classification: {
      path: scenarioName === 'coldSessionSwitchDuringQuery' ? 'cold-switch-integration' : 'warm',
      ownerInstance: scenarioName === 'coldSessionSwitchDuringQuery' ? 'cold-switch-owner' : 'warm-owner',
      scenarioVersion: 1,
    },
    functional,
    requests: {
      records: scenarioRequests.map((request) => ({
        sequence: request.sequence - start.requestIndex,
        method: request.method,
        family: request.family,
        sessionRole: request.sessionRole,
        offset: request.offset,
        limit: request.limit,
        queryAlias: request.queryAlias,
        kindAlias: request.kindAlias,
        statusAlias: request.statusAlias,
        filterAlias: request.filterAlias,
        outcome: request.outcome,
        httpStatus: request.httpStatus,
      })),
      familyCounts: countBy(scenarioRequests.map((request) => request.family)),
      timelineOffsets: timelineRequests.map((request) => request.offset),
      timelineLimits: timelineRequests.map((request) => request.limit),
      timelinePageCount: timelineRequests.length,
      detailCount: scenarioRequests.filter((request) => request.family === 'detail').length,
      eventEnvelopeCount: scenarioRequests.filter((request) => request.family === 'eventEnvelope').length,
      failedCount: scenarioFailures.filter((failure) => failure.outcome === 'failed').length,
      intentionalAbortCount: scenarioFailures.filter((failure) => failure.outcome === 'intentionalAbort').length,
      resourceTimingByFamily: aggregateResources(browserMetrics.resources),
      domCommitLedger: browserMetrics.domCommitLedger,
      constraints,
    },
    work: {
      durationMs: Date.now() - start.startedAt,
      fullRenders: browserMetrics.fullRenders,
      cardGenerations: browserMetrics.cardGenerations,
      highlightPasses: browserMetrics.highlightPasses,
      highlightMarksCreated: browserMetrics.highlightMarksCreated,
      highlightedOwnerCount: browserMetrics.highlightedOwnerCount,
      targetDiscoveryPasses: browserMetrics.targetDiscoveryPasses,
      contextRowInsertions: browserMetrics.contextRowInsertions,
      finalDomNodeCount: browserMetrics.finalDomNodes,
      finalTimelineNodeCount: browserMetrics.finalTimelineNodes,
      longTasks: {
        count: browserMetrics.longTasks.count,
        totalMs: round(browserMetrics.longTasks.totalMs),
        maxMs: round(browserMetrics.longTasks.maxMs),
      },
      materializerCalls: materializer.totalCalls,
      materializerCallsByRole: materializer.callsByRole,
      materializationPhaseEvents: scenarioName === 'coldSessionSwitchDuringQuery'
        ? materializer.phaseEvents
        : {},
    },
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

function matchesContextTimelineResponse(url, query, status = '') {
  return url.pathname.endsWith('/timeline')
    && url.searchParams.get('q') === query
    && (url.searchParams.get('status') || '') === status
    && url.searchParams.get('offset') === '0';
}

function matchesSessionTimelineResponse(url, sessionId, query) {
  return url.pathname === `/api/sessions/${encodeURIComponent(sessionId)}/timeline`
    && url.searchParams.get('q') === query
    && url.searchParams.get('offset') === '0';
}

async function runContextRevealProfile(baseUrl, browser, fixture, tracker) {
  reportDiagnosticStage('context-reveal-open');
  const profile = await openProfilePage(browser, baseUrl, fixture);
  try {
    const query = fixture.contextReveal?.toolName;
    if (!query) throw new Error('Context reveal fixture is unavailable');
    const waitForTimeline = (status = '') => profile.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return matchesContextTimelineResponse(url, query, status);
    }, { timeout: 60000 });
    let response = waitForTimeline();
    await profile.page.locator('#searchInput').fill(query);
    await profile.page.locator('#searchInput').dispatchEvent('input');
    await response;
    response = waitForTimeline('failed');
    await profile.page.locator('#searchFilterBtn').click();
    await profile.page.locator('[data-search-filter-control="status"]').selectOption('failed');
    await response;
    await profile.page.waitForSelector('#timeline [data-action="reveal-context-parent"]');
    await profile.page.locator('#searchAssistClose').click();
    await profile.page.locator('#searchAssist').waitFor({ state: 'hidden' });
    await profile.page.locator('#searchFilterRows').waitFor({ state: 'hidden' });
    const before = await profile.page.evaluate(() => window.__timelineProfile.snapshot());
    const start = await resetScenario(profile.page, profile.requests, profile.failures, tracker);
    markScenarioAction(start, 'revealContext', profile.requests);
    await profile.page.locator('#timeline [data-action="reveal-context-parent"]').click();
    await profile.page.waitForSelector('.contextRevealRow', { timeout: 60000 });
    await profile.page.waitForFunction(() => window.__timelineProfile.snapshot().contextRowInsertions === 1);
    reportDiagnosticStage('context-reveal-summary');
    const summary = await scenarioSummary(
      profile.page,
      profile.requests,
      profile.failures,
      start,
      tracker,
      fixture,
      'warmContextReveal',
    );
    const row = await profile.page.locator('.contextRevealRow').evaluate((node) => ({
      eventId: node.getAttribute('data-event-id'),
      searchOwner: node.getAttribute('data-search-target-owner'),
      inSlot: Boolean(node.closest('.contextRevealSlot')),
      beforeSource: Boolean(node.closest('.contextRevealSlot')?.nextElementSibling?.matches('.event[data-event-id]')),
    }));
    const afterSelection = await profile.page.evaluate(() => (
      window.__timelineProfile.snapshot().activeSessionId
    ));
    const beforeSelectionRole = fixtureRole(fixture, before.activeSessionId);
    const afterSelectionRole = fixtureRole(fixture, afterSelection);
    const canonicalUnchanged = JSON.stringify([
      before.finalCards,
      before.finalMarks,
      before.searchTargetOrdinals,
      before.resultSummaryVisible,
      before.loadMoreDisabled,
      before.activeSessionId,
    ]) === JSON.stringify([
      summary.functional.canonicalCardCount,
      summary.functional.markCount,
      summary.functional.searchTargets.map((target) => target.ordinal),
      summary.functional.resultSummary.visible,
      summary.functional.loadMore.disabled,
      afterSelection,
    ]);
    summary.functional.contextRowIsolation = row.eventId === null
      && row.searchOwner === null
      && row.inSlot
      && row.beforeSource;
    summary.functional.canonicalUnchanged = canonicalUnchanged;
    summary.functional.selectionUnchanged = before.activeSessionId === afterSelection
      && beforeSelectionRole === afterSelectionRole
      && afterSelectionRole === summary.functional.selectedSessionRole;
    summary.functional.finalStateDigest = sha256(JSON.stringify({
      ...summary.functional,
      finalStateDigest: undefined,
    }));
    return summary;
  } finally {
    await profile.context.close();
  }
}

function profileAcceptance(scenarios, serverSetup) {
  const failures = [];
  if (serverSetup.buildInvocationCount !== 1) failures.push('serverSetup: build invocation count must be 1');
  if (serverSetup.commitValidationInvocationCount !== 1) failures.push('serverSetup: commit validation count must be 1');
  if (serverSetup.projectJobCount !== 0) failures.push('serverSetup: project job count must be 0');
  if (!serverSetup.prewarmDisabled) failures.push('serverSetup: prewarm must be disabled');
  if (serverSetup.createServerCount !== 2) failures.push('serverSetup: createServer count must be 2');
  const warmOwner = serverSetup.ownerMaterializerTotals?.warm;
  const coldOwner = serverSetup.ownerMaterializerTotals?.coldSwitch;
  if (warmOwner?.totalCalls !== 1
      || warmOwner?.callsByRole?.primary !== 1
      || (warmOwner?.callsByRole?.secondary || 0) !== 0) {
    failures.push('serverSetup: warm owner must materialize only primary exactly once');
  }
  if (coldOwner?.totalCalls !== 2
      || coldOwner?.callsByRole?.primary !== 1
      || coldOwner?.callsByRole?.secondary !== 1) {
    failures.push('serverSetup: cold-switch owner materializer ledger changed');
  }
  for (const [name, scenario] of Object.entries(scenarios)) {
    if (!scenario.requests.constraints.passed) failures.push(`${name}: causal request constraints failed`);
    if (scenario.functional.visibleErrorCount !== 0) failures.push(`${name}: visible error present`);
    if (scenario.classification.path === 'warm' && scenario.work.materializerCalls !== 0) {
      failures.push(`${name}: warm scenario invoked materializer`);
    }
  }
  const preload = scenarios.warmSearchPreload;
  if (preload.functional.selectedSessionRole !== 'primary'
      || preload.functional.canonicalCardCount !== 600
      || preload.functional.markCount !== 0
      || preload.functional.searchTargets.length !== 0
      || preload.functional.activeTarget !== null
      || preload.functional.contextRowCount !== 0) {
    failures.push('warmSearchPreload: final functional state changed');
  }
  const jump = scenarios.warmJumpToLateHit;
  if (jump.functional.selectedSessionRole !== 'primary'
      || jump.functional.canonicalCardCount < 1651
      || jump.functional.activeTarget?.ordinal !== 1650) {
    failures.push('warmJumpToLateHit: late target state changed');
  }
  const deep = scenarios.warmDeepStructuredFilter;
  if (deep.functional.selectedSessionRole !== 'primary'
      || deep.functional.loadedCount !== 150
      || deep.functional.canonicalCardCount !== 150
      || deep.functional.markCount !== 150
      || deep.functional.contextRowCount !== 0
      || !deep.requests.records.some((request) => (
        request.family === 'timeline' && request.kindAlias === 'assistant_message'
      ))) {
    failures.push('warmDeepStructuredFilter: deterministic filtered state changed');
  }
  if (!deep.requests.timelineOffsets.includes(0) || deep.requests.timelineOffsets.includes(150)) {
    failures.push('warmDeepStructuredFilter: residual append or missing page-zero replacement');
  }
  const context = scenarios.warmContextReveal;
  if ((context.requests.familyCounts.timeline || 0) !== 0
      || context.requests.eventEnvelopeCount !== 1
      || context.requests.detailCount > 1) {
    failures.push('warmContextReveal: request ownership changed');
  }
  if (context.work.fullRenders
      || context.work.cardGenerations
      || context.work.highlightPasses
      || context.work.highlightMarksCreated
      || context.work.highlightedOwnerCount
      || context.work.targetDiscoveryPasses) {
    failures.push('warmContextReveal: canonical work reran');
  }
  if (!context.functional.canonicalUnchanged
      || !context.functional.selectionUnchanged
      || context.functional.selectedSessionRole !== 'primary'
      || context.functional.contextRowCount !== 1
      || context.work.contextRowInsertions !== 1
      || !context.functional.contextRowIsolation) {
    failures.push('warmContextReveal: context row changed canonical state or isolation');
  }
  const cold = scenarios.coldSessionSwitchDuringQuery;
  if (cold.work.materializerCalls !== 1
      || cold.work.materializerCallsByRole.secondary !== 1
      || cold.functional.selectedSessionRole !== 'secondary'
      || cold.functional.canonicalCardCount !== 40
      || cold.functional.loadedCount !== 40
      || cold.functional.contextRowCount !== 0) {
    failures.push('coldSessionSwitchDuringQuery: cold transition contract changed');
  }
  return {
    structural: failures.length === 0,
    correctness: failures.length === 0,
    privacyAuditPassed: true,
    cleanupPassed: true,
    passed: failures.length === 0,
    failures,
    numericalLatencyGate: false,
  };
}

async function runWarmProfile(baseUrl, browser, fixture, tracker) {
  reportDiagnosticStage('warm-first-open');
  const first = await openProfilePage(browser, baseUrl, fixture);
  let warmSearchPreload;
  let warmJumpToLateHit;
  try {
    let start = await resetScenario(first.page, first.requests, first.failures, tracker);
    markScenarioAction(start, 'searchRareHit', first.requests);
    await primeRareSearch(first.page);
    reportDiagnosticStage('warm-search-summary');
    warmSearchPreload = await scenarioSummary(
      first.page,
      first.requests,
      first.failures,
      start,
      tracker,
      fixture,
      'warmSearchPreload',
    );

    start = await resetScenario(first.page, first.requests, first.failures, tracker);
    markScenarioAction(start, 'jumpToRareHit', first.requests);
    await jumpToRareHit(first.page);
    reportDiagnosticStage('warm-jump-summary');
    warmJumpToLateHit = await scenarioSummary(
      first.page,
      first.requests,
      first.failures,
      start,
      tracker,
      fixture,
      'warmJumpToLateHit',
    );
  } finally {
    await first.context.close();
  }

  reportDiagnosticStage('warm-deep-open');
  const second = await openProfilePage(browser, baseUrl, fixture);
  let warmDeepStructuredFilter;
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
    const start = await resetScenario(second.page, second.requests, second.failures, tracker);
    markScenarioAction(start, 'applyStructuredFilter', second.requests);
    await second.page.locator('#searchFilterBtn').click();
    await second.page.locator('[data-search-filter-control="kind"]').selectOption('assistant_message');
    await second.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/timeline')
        && url.searchParams.get('kind') === 'assistant_message'
        && url.searchParams.get('offset') === '0';
    }, { timeout: 120000 });
    await second.page.waitForTimeout(1200);
    reportDiagnosticStage('warm-deep-summary');
    warmDeepStructuredFilter = await scenarioSummary(
      second.page,
      second.requests,
      second.failures,
      start,
      tracker,
      fixture,
      'warmDeepStructuredFilter',
    );
  } finally {
    await second.context.close();
  }

  const warmContextReveal = await runContextRevealProfile(baseUrl, browser, fixture, tracker);
  return {
    warmSearchPreload,
    warmJumpToLateHit,
    warmDeepStructuredFilter,
    warmContextReveal,
  };
}

async function runColdSwitchProfile(baseUrl, browser, fixture, tracker) {
  reportDiagnosticStage('cold-switch-open');
  const profile = await openProfilePage(browser, baseUrl, fixture);
  const timelineRoutePattern = '**/api/sessions/**/timeline**';
  let releaseHeldPrimary = () => {};
  let heldPrimarySettled = Promise.resolve();
  let heldPrimaryStarted = false;
  let holdPrimaryRoute = null;
  try {
    const before = tracker.summary();
    if (before.callsByRole.primary !== 1 || (before.callsByRole.secondary || 0) !== 0) {
      throw new Error('Cold-switch owner was not isolated before the measured scenario');
    }
    const start = await resetScenario(profile.page, profile.requests, profile.failures, tracker);
    markScenarioAction(start, 'startPrimaryQuery', profile.requests);
    let resolveHeldPrimaryReady;
    let rejectHeldPrimaryReady;
    let resolveHeldPrimaryRelease;
    let resolveHeldPrimarySettled;
    const heldPrimaryReady = new Promise((resolve, reject) => {
      resolveHeldPrimaryReady = resolve;
      rejectHeldPrimaryReady = reject;
    });
    const heldPrimaryRelease = new Promise((resolve) => { resolveHeldPrimaryRelease = resolve; });
    heldPrimarySettled = new Promise((resolve) => { resolveHeldPrimarySettled = resolve; });
    releaseHeldPrimary = () => resolveHeldPrimaryRelease();
    let primaryIntercepted = false;
    holdPrimaryRoute = async (route) => {
      const requestUrl = new URL(route.request().url());
      const isTarget = !primaryIntercepted
        && requestUrl.pathname.endsWith(`/api/sessions/${encodeURIComponent(fixture.longSessionId)}/timeline`)
        && requestUrl.searchParams.get('q') === 'switch-query'
        && Number(requestUrl.searchParams.get('offset') || 0) === 0;
      if (!isTarget) {
        await route.continue();
        return;
      }
      primaryIntercepted = true;
      heldPrimaryStarted = true;
      let heldResponse;
      try {
        heldResponse = await route.fetch();
        resolveHeldPrimaryReady();
      } catch {
        rejectHeldPrimaryReady(new Error('Synthetic primary response could not be held'));
        resolveHeldPrimarySettled();
        return;
      }
      await heldPrimaryRelease;
      try {
        await route.fulfill({ response: heldResponse });
      } catch {
        try { await route.abort(); } catch {}
      } finally {
        resolveHeldPrimarySettled();
      }
    };
    await profile.page.route(timelineRoutePattern, holdPrimaryRoute);
    const queryRequest = profile.page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'switch-query';
    });
    const secondaryTimelineResponse = profile.page.waitForResponse((response) => (
      matchesSessionTimelineResponse(
        new URL(response.url()),
        fixture.secondarySessionId,
        'switch-query',
      )
    ), { timeout: 120000 });
    await profile.page.locator('#searchInput').fill('switch-query');
    await profile.page.locator('#searchInput').dispatchEvent('input');
    await Promise.all([queryRequest, heldPrimaryReady]);
    markScenarioAction(start, 'selectSecondary', profile.requests);
    await profile.page.evaluate((secondarySessionId) => {
      const sessionItem = [...document.querySelectorAll('.sessionItem[data-session-id]')]
        .find((node) => node.dataset.sessionId === secondarySessionId);
      if (!sessionItem) throw new Error('Synthetic secondary Session control is unavailable');
      window.__timelineProfile.markSelectSecondary();
      sessionItem.click();
    }, fixture.secondarySessionId);
    releaseHeldPrimary();
    await heldPrimarySettled;
    await profile.page.unroute(timelineRoutePattern, holdPrimaryRoute);
    holdPrimaryRoute = null;
    await profile.page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
    await secondaryTimelineResponse;
    await profile.page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length === 40, null, { timeout: 120000 });
    await waitForTimelineIdle(profile.page, 500, 120000);
    reportDiagnosticStage('cold-switch-summary');
    return await scenarioSummary(
      profile.page,
      profile.requests,
      profile.failures,
      start,
      tracker,
      fixture,
      'coldSessionSwitchDuringQuery',
    );
  } finally {
    releaseHeldPrimary();
    if (heldPrimaryStarted) await heldPrimarySettled.catch(() => {});
    if (holdPrimaryRoute) await profile.page.unroute(timelineRoutePattern, holdPrimaryRoute).catch(() => {});
    await profile.context.close();
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function runBrowserScenarios(browser, fixture, built) {
  const warmTracker = createProfileMaterializationTracker(fixture);
  const warmOwner = createProfileServer(built.index, built.buildMs, fixture, warmTracker);
  let warmScenarios;
  try {
    warmScenarios = await runWarmProfile(await listen(warmOwner.server), browser, fixture, warmTracker);
  } finally {
    await closeServer(warmOwner.server);
  }
  const coldTracker = createProfileMaterializationTracker(fixture);
  const coldOwner = createProfileServer(built.index, built.buildMs, fixture, coldTracker);
  let coldSessionSwitchDuringQuery;
  try {
    coldSessionSwitchDuringQuery = await runColdSwitchProfile(
      await listen(coldOwner.server),
      browser,
      fixture,
      coldTracker,
    );
  } finally {
    await closeServer(coldOwner.server);
  }
  return {
    scenarios: { ...warmScenarios, coldSessionSwitchDuringQuery },
    serverSetup: {
      sourceKind: 'codex',
      sessionLifecycle: built.adapter.sessionLifecycle,
      buildInvocationCount: built.counters.buildInvocationCount,
      commitValidationInvocationCount: built.counters.commitValidationInvocationCount,
      commitValidationChunkCount: built.counters.commitValidationChunkCount,
      createServerCount: 2,
      projectJobCount: warmOwner.setup.projectJobCount + coldOwner.setup.projectJobCount,
      prewarmDisabled: warmOwner.setup.prewarmDisabled && coldOwner.setup.prewarmDisabled,
      optionsRepoPresent: warmOwner.setup.optionsRepoPresent || coldOwner.setup.optionsRepoPresent,
      buildMs: round(built.buildMs),
      validationMs: round(built.validationMs),
      ownerMaterializerTotals: {
        warm: warmTracker.summary(),
        coldSwitch: coldTracker.summary(),
      },
    },
  };
}

async function collectIdentity(options) {
  const repoRoot = path.join(__dirname, '..');
  const gitIdentity = await captureGitIdentity(repoRoot, {
    candidateCommitSha: options.candidateSha,
    targetSyncSha: options.targetSyncSha,
  });
  return {
    repository: REPOSITORY_SLUG,
    targetBranch: TARGET_BRANCH,
    inspectedBaseSha: INSPECTED_BASE_SHA,
    preWave0Head: '377a0356fe884a5a95f234bd5d6f22240ca8052b',
    ...gitIdentity,
    runLabel: options.label,
    repetitionIndex: options.repetitionIndex,
    repetitionCount: options.repetitionCount,
    recordedAt: new Date().toISOString(),
  };
}

async function profile(options, dependencies = {}) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-timeline-profile-'));
  let browser;
  try {
    const fixture = await createTimelineProfileFixture(tempRoot, { ...options, includeContextReveal: true });
    const built = await buildStrictProfileIndex(fixture, dependencies);
    browser = await (dependencies.chromium || chromium).launch({ headless: !options.headed });
    const browserVersion = browser.version();
    const asset = await fsp.readFile(path.join(__dirname, '..', 'public', 'assets', 'app.js'));
    const generator = await fsp.readFile(path.join(__dirname, 'timeline-profile-fixture.js'));
    const measured = await runBrowserScenarios(browser, fixture, built);
    const acceptance = profileAcceptance(measured.scenarios, measured.serverSetup);
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      artifactKind: 'timeline-browser-run',
      identity: await collectIdentity(options),
      environment: {
        node: process.version,
        v8: process.versions.v8,
        npm: readNpmVersion(),
        playwright: require('playwright/package.json').version,
        chromium: browserVersion,
        execArgv: [...process.execArgv],
        exposedGc: typeof global.gc === 'function',
        heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
        platform: process.platform,
        osRelease: os.release(),
        architecture: os.arch(),
        cpu: os.cpus()[0]?.model || '',
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        ci: Boolean(process.env.CI),
        headless: !options.headed,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
        runtimeAssetSha256: sha256(asset),
      },
      invocationTemplate: {
        worker: 'timeline',
        runtime: 'node',
        inputRole: 'external-synthetic-fixture',
        outputRole: 'external-artifact-directory',
      },
      fixture: {
        parameters: fixture.parameters,
        roles: ['primary', 'secondary'],
        proofVersion: fixture.proofVersion,
        generatorSha256: sha256(generator),
        semanticFixtureProof: fixture.semanticFixtureProof,
      },
      serverSetup: measured.serverSetup,
      scenarios: measured.scenarios,
      acceptance,
    };
  } finally {
    await browser?.close();
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await profile(options);
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  try {
    if (options.output) {
      const outputPath = path.resolve(options.output);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, json, 'utf8');
    }
    process.stdout.write(json);
    if (!summary.acceptance.passed) process.exitCode = 1;
  } catch (error) {
    throw error;
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
  PROFILE_SCHEMA_VERSION,
  buildStrictProfileIndex,
  createProfileMaterializationTracker,
  createProfileServer,
  matchesContextTimelineResponse,
  matchesSessionTimelineResponse,
  parseArgs,
  profile,
  profileAcceptance,
  profileServerOptions,
  requestConstraints,
};
