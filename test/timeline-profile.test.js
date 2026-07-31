'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIndex, getTimeline } = require('../src/codex');
const {
  MIN_PROFILE_EVENT_COUNT,
  MIN_PROFILE_TEXT_BYTES,
  MAX_PROFILE_TEXT_BYTES,
  matchesContextTimelineResponse,
  matchesSessionTimelineResponse,
  parseArgs,
  profileAcceptance,
} = require('../scripts/timeline-profile');
const { createTimelineProfileFixture } = require('../scripts/timeline-profile-fixture');

test('timeline profile accepts only corpus sizes that satisfy its fixed late-hit scenarios', () => {
  assert.equal(MIN_PROFILE_EVENT_COUNT, 1651);
  assert.equal(parseArgs([]).eventCount, undefined);
  assert.equal(parseArgs(['--event-count', '1651']).eventCount, 1651);
  assert.equal(parseArgs(['--event-count', '1800']).eventCount, 1800);

  for (const value of ['1650', '1000', '1.5', 'Infinity', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--event-count', value]),
      /--event-count must be an integer greater than or equal to 1651/,
    );
  }
  assert.throws(
    () => parseArgs(['--event-count']),
    /--event-count must be an integer greater than or equal to 1651/,
  );
});

test('timeline profile accepts only bounded finite integer text payload sizes', () => {
  assert.equal(MIN_PROFILE_TEXT_BYTES, 256);
  assert.equal(MAX_PROFILE_TEXT_BYTES, 65536);
  assert.equal(parseArgs(['--text-bytes', '256']).searchableTextBytes, 256);
  assert.equal(parseArgs(['--text-bytes', '3700']).searchableTextBytes, 3700);
  assert.equal(parseArgs(['--text-bytes', '65536']).searchableTextBytes, 65536);

  for (const value of ['255', '1.5', '65537', 'Infinity', '1e309', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--text-bytes', value]),
      /--text-bytes must be an integer from 256 to 65536/,
    );
  }
  assert.throws(
    () => parseArgs(['--text-bytes']),
    /--text-bytes must be an integer from 256 to 65536/,
  );
});

test('context timeline response matcher treats a missing status parameter as no status filter', () => {
  const base = 'http://127.0.0.1:17890/api/sessions/session/timeline';
  assert.equal(matchesContextTimelineResponse(
    new URL(`${base}?q=context-profile-token&offset=0`),
    'context-profile-token',
  ), true);
  assert.equal(matchesContextTimelineResponse(
    new URL(`${base}?q=context-profile-token&status=failed&offset=0`),
    'context-profile-token',
    'failed',
  ), true);
  assert.equal(matchesContextTimelineResponse(
    new URL(`${base}?q=context-profile-token&status=failed&offset=0`),
    'context-profile-token',
  ), false);
});

test('session timeline response matcher binds a query response to its committed session', () => {
  const base = 'http://127.0.0.1:17890/api/sessions';
  const sessionId = '28282828-2828-4282-8282-282828282828';
  assert.equal(matchesSessionTimelineResponse(
    new URL(`${base}/${sessionId}/timeline?q=switch-query&offset=0`),
    sessionId,
    'switch-query',
  ), true);
  assert.equal(matchesSessionTimelineResponse(
    new URL(`${base}/other/timeline?q=switch-query&offset=0`),
    sessionId,
    'switch-query',
  ), false);
});

test('profile acceptance keeps stable scenarios exact while allowing only reduced switch transient work', () => {
  const scenario = (overrides = {}) => ({
    durationMs: 100,
    apiRequestCount: 2,
    timelineRequestCount: 1,
    detailRequestCount: 0,
    eventEnvelopeRequestCount: 0,
    fullRenders: 4,
    cardGenerations: 400,
    highlightPasses: 2,
    highlightMarksCreated: 20,
    highlightedOwnerCount: 2,
    targetDiscoveryPasses: 3,
    finalCards: 40,
    finalMarks: 2,
    searchTargetIds: ['target'],
    longTasks: { totalMs: 10, maxMs: 5 },
    ...overrides,
  });
  const featureOff = {
    searchPreload: scenario(),
    jumpToLateHit: scenario(),
    switchDuringQuery: scenario(),
    deepStructuredFilter: scenario(),
  };
  const contextReveal = {
    timelineRequestCount: 0,
    eventEnvelopeRequestCount: 1,
    detailRequestCount: 0,
    fullRenders: 0,
    cardGenerations: 0,
    highlightPasses: 0,
    highlightMarksCreated: 0,
    targetDiscoveryPasses: 0,
    canonicalUnchanged: true,
    contextRows: 1,
    contextRowInsertions: 1,
    isolatedRow: true,
  };
  const featureOn = {
    searchPreload: scenario(),
    jumpToLateHit: scenario(),
    switchDuringQuery: scenario({
      fullRenders: 2,
      cardGenerations: 200,
      highlightPasses: 1,
      highlightMarksCreated: 10,
      targetDiscoveryPasses: 1,
    }),
    deepStructuredFilter: scenario(),
    contextReveal,
  };

  assert.deepEqual(profileAcceptance(featureOff, featureOn), { passed: true, failures: [] });

  assert.deepEqual(profileAcceptance(featureOff, {
    ...featureOn,
    switchDuringQuery: scenario({ fullRenders: 5 }),
  }).failures, ['switchDuringQuery: fullRenders increased']);
  assert.deepEqual(profileAcceptance(featureOff, {
    ...featureOn,
    deepStructuredFilter: scenario({ cardGenerations: 401 }),
  }).failures, ['deepStructuredFilter: cardGenerations changed']);
});

test('Code Mode context fixture preserves the 1,800-event Main corpus and late-hit position', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-profile-fixture-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const fixture = await createTimelineProfileFixture(root, { includeContextReveal: true });
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = index.sessionsById.get(fixture.longSessionId);
  const mainEvents = session.logicalEvents.filter((event) => event.layer === 'main');

  assert.equal(mainEvents.length, 1800);
  const timeline = getTimeline(index, fixture.longSessionId, {
    offset: 0,
    limit: 1800,
    layer: 'main',
    q: 'far-needle',
    kind: '',
    status: '',
    tool: '',
    file: '',
    locale: 'en',
  });
  assert.equal(timeline.total, 1800);
  assert.equal(timeline.events.findIndex((event) => event.hasSearchHit), 1650);
});
