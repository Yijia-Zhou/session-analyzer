'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildIndex, buildEventDetail, discoverProjects, fileSuggestions, filterSessions, getTimeline, readRawLine, isPathInsideOrSame } = require('../src/codex');
const { createServer, parseArgs } = require('../server');
const { DISPLAY_STATES, EDITABLE_EVENT_KINDS, foldingProfiles } = require('../src/folding');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';

async function buildFixtureIndex() {
  return buildIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
  });
}

function primaryFixtureSession(index) {
  return index.sessionsById.get(primaryFixtureSessionId);
}

test('parseArgs leaves repo unset unless --repo is provided', () => {
  assert.equal(parseArgs(['node', 'server.js']).repo, null);
  assert.equal(parseArgs(['node', 'server.js', '--repo', 'G:\\vibe\\term-agent']).repo, 'G:\\vibe\\term-agent');
});

test('discoverProjects groups Codex sessions by cwd', async () => {
  const projects = await discoverProjects({ codexHome: fixtureCodexHome });
  const byRoot = new Map(projects.map((project) => [project.repoRoot, project]));

  assert.equal(byRoot.get('G:\\vibe\\term-agent').sessionCount, 10);
  assert.equal(byRoot.get('G:\\other\\repo').sessionCount, 3);
  assert.equal(typeof byRoot.get('G:\\vibe\\term-agent').exists, 'boolean');
});

test('buildIndex deduplicates mirrored messages and keeps protocol separately', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  assert.equal(index.totals.fileCount, 11);
  assert.equal(index.totals.candidateFileCount, 10);
  assert.equal(index.totals.indexedFileCount, 10);
  assert.equal(index.totals.skippedFileCount, 1);
  assert.equal(index.totals.unknownFileCount, 0);
  assert.equal(index.totals.sessionCount, 10);
  assert.equal(session.id, '11111111-1111-1111-1111-111111111111');
  assert.equal(session.title, 'fixture repo session');
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.assistantMessages, 1);
  assert.equal(session.counts.messages, 2);
  assert.equal(session.counts.reasoning, 1);
  assert.equal(session.counts.failedCommands, 1);
  assert.equal(session.counts.patches, 6);
  assert.equal(session.counts.compactions, 1);
  assert.equal(session.counts.planArtifacts, 1);
  assert.equal(session.counts.planEvents, 4);
  assert.ok(session.counts.protocol >= 3);
});

test('buildIndex keeps files whose later metadata cwd matches the repo', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessionsById.get('99999999-9999-9999-9999-999999999999');
  const afterWindowSession = index.sessionsById.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

  assert.ok(session);
  assert.equal(session.title, 'late matching cwd fixture');
  assert.equal(session.matchesRepo, true);
  assert.deepEqual([...session.cwdSet].sort(), ['G:\\other\\repo', 'G:\\vibe\\term-agent'].sort());
  assert.ok(afterWindowSession);
  assert.equal(afterWindowSession.title, 'late matching cwd after scan window fixture');
  assert.equal(afterWindowSession.matchesRepo, true);
  assert.deepEqual([...afterWindowSession.cwdSet].sort(), ['G:\\other\\repo', 'G:\\vibe\\term-agent'].sort());
});

test('buildIndex reports progress and supports cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    buildIndex({
      repoRoot: 'G:\\vibe\\term-agent',
      codexHome: fixtureCodexHome,
      signal: controller.signal,
      onProgress: () => {},
    }),
    { name: 'AbortError' },
  );

  const phases = [];
  await buildIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
    onProgress: (progress) => phases.push(progress.phase),
  });
  assert.ok(phases.includes('selecting'));
  assert.ok(phases.includes('parsing'));
  assert.equal(phases.at(-1), 'complete');
});

test('buildIndex keeps forked subagent identity separate from embedded parent metadata', async () => {
  const index = await buildFixtureIndex();
  const parent = index.sessions.find((session) => session.id === '11111111-1111-1111-1111-111111111111');
  const child = index.sessions.find((session) => session.id === '33333333-3333-3333-3333-333333333333');
  const review = index.sessions.find((session) => session.id === '55555555-5555-5555-5555-555555555555');
  const reviewWithoutParent = index.sessions.find((session) => session.id === '66666666-6666-6666-6666-666666666666');
  const ambiguousReview = index.sessions.find((session) => session.id === '88888888-8888-8888-8888-888888888888');
  const normalFork = index.sessions.find((session) => session.id === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

  assert.ok(parent);
  assert.ok(child);
  assert.ok(review);
  assert.ok(reviewWithoutParent);
  assert.ok(ambiguousReview);
  assert.ok(normalFork);
  assert.equal(child.parentSessionId, parent.id);
  assert.equal(child.forkedFromSessionId, parent.id);
  assert.equal(child.agentNickname, 'Fixture');
  assert.equal(child.title, 'Subagent Fixture: Check the fixture subagent path');
  assert.equal(review.parentSessionId, parent.id);
  assert.equal(review.forkedFromSessionId, parent.id);
  assert.equal(review.agentNickname, 'Review');
  assert.equal(review.title, 'Review session: Review Fixture: verify derived review session styling metadata');
  assert.equal(reviewWithoutParent.parentSessionId, parent.id);
  assert.equal(reviewWithoutParent.parentSessionInferred, true);
  assert.equal(reviewWithoutParent.title, 'Review session: Review the fixture code changes and provide prioritized findings.');
  assert.equal(ambiguousReview.parentSessionId, '');
  assert.equal(ambiguousReview.parentSessionInferred, false);
  assert.equal(normalFork.parentSessionId, '');
  assert.equal(normalFork.parentSessionInferred, false);
  assert.equal(normalFork.forkedFromSessionId, parent.id);
  assert.equal(normalFork.title, 'Normal fork fixture should stay primary');
  assert.equal(index.sessionsById.get(parent.id), parent);
  assert.equal(index.sessionsById.get(child.id), child);
  assert.equal(index.sessionsById.get(review.id), review);
  assert.equal(index.sessionsById.get(reviewWithoutParent.id), reviewWithoutParent);
  assert.equal(index.sessionsById.get(normalFork.id), normalFork);
  assert.ok(child.rawEvents.every((raw) => raw.sessionId === child.id));
  assert.ok(child.logicalEvents.every((event) => event.id.startsWith(`${child.id}:logical:`)));

  const summaries = filterSessions(index, { q: '', sort: 'updated-desc', layer: 'main' }).sessions;
  const childSummary = summaries.find((session) => session.id === child.id);
  const reviewSummary = summaries.find((session) => session.id === review.id);
  const reviewWithoutParentSummary = summaries.find((session) => session.id === reviewWithoutParent.id);
  const ambiguousReviewSummary = summaries.find((session) => session.id === ambiguousReview.id);
  const normalForkSummary = summaries.find((session) => session.id === normalFork.id);
  assert.equal(childSummary.parentSessionId, parent.id);
  assert.equal(childSummary.parentSessionTitle, parent.title);
  assert.equal(childSummary.forkedFromSessionId, parent.id);
  assert.equal(childSummary.forkedFromSessionTitle, parent.title);
  assert.equal(childSummary.agentNickname, 'Fixture');
  assert.equal(childSummary.isDerivedSession, true);
  assert.equal(childSummary.derivedKind, 'subagent');
  assert.equal(reviewSummary.parentSessionId, parent.id);
  assert.equal(reviewSummary.parentSessionTitle, parent.title);
  assert.equal(reviewSummary.forkedFromSessionId, parent.id);
  assert.equal(reviewSummary.forkedFromSessionTitle, parent.title);
  assert.equal(reviewSummary.agentNickname, 'Review');
  assert.equal(reviewSummary.isDerivedSession, true);
  assert.equal(reviewSummary.derivedKind, 'review');
  assert.equal(reviewWithoutParentSummary.parentSessionId, parent.id);
  assert.equal(reviewWithoutParentSummary.parentSessionInferred, true);
  assert.equal(reviewWithoutParentSummary.parentSessionTitle, parent.title);
  assert.equal(reviewWithoutParentSummary.isDerivedSession, true);
  assert.equal(reviewWithoutParentSummary.derivedKind, 'review');
  assert.equal(ambiguousReviewSummary.parentSessionId, '');
  assert.equal(ambiguousReviewSummary.parentSessionInferred, false);
  assert.equal(ambiguousReviewSummary.parentSessionTitle, '');
  assert.equal(ambiguousReviewSummary.isDerivedSession, true);
  assert.equal(ambiguousReviewSummary.derivedKind, 'review');
  assert.equal(normalForkSummary.parentSessionId, '');
  assert.equal(normalForkSummary.parentSessionInferred, false);
  assert.equal(normalForkSummary.parentSessionTitle, '');
  assert.equal(normalForkSummary.forkedFromSessionId, parent.id);
  assert.equal(normalForkSummary.forkedFromSessionTitle, parent.title);
  assert.equal(normalForkSummary.isDerivedSession, false);
  assert.equal(normalForkSummary.derivedKind, '');
});

test('buildIndex infers fallback titles from real user tasks after protocol wrappers', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessions.find((item) => item.id === '44444444-4444-4444-4444-444444444444');

  assert.ok(session);
  assert.equal(session.title, 'Repair fallback session titles');
  assert.equal(session.counts.userMessages, 1);

  const mainTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(mainTimeline.events.some((event) => event.preview.includes('Get-ChildItem')), false);

  const protocolTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'protocol',
  });
  const shellWrapper = protocolTimeline.events.find((event) => event.subtype === 'user_shell_command');
  assert.ok(shellWrapper);
  assert.equal(shellWrapper.preview, 'Get-ChildItem -Force');
});

test('timeline main layer returns logical events without duplicate user or assistant messages', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const timeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });

  const userEvents = timeline.events.filter((event) => event.kind === 'user_message');
  const assistantEvents = timeline.events.filter((event) => event.kind === 'assistant_message');
  const planEvents = timeline.events.filter((event) => event.kind === 'plan_artifact');
  const reviewEvents = timeline.events.filter((event) => event.kind === 'review');

  assert.equal(userEvents.length, 1);
  assert.equal(assistantEvents.length, 1);
  assert.equal(planEvents.length, 1);
  assert.equal(reviewEvents.length, 4);
  assert.equal(reviewEvents[0].label, 'Review started');
  assert.equal(reviewEvents[0].preview, 'Review started: current changes');
  assert.equal(reviewEvents[1].label, 'Review completed');
  assert.match(reviewEvents[1].preview, /Review completed: patch is correct - 0 findings - No findings\./);
  const reviewStartDetail = buildEventDetail(session, reviewEvents[0].id, 'main');
  assert.deepEqual(reviewStartDetail.sections.find((section) => section.title === 'Review request').entries, [
    { key: 'Status', value: 'Started' },
    { key: 'Target', value: 'Uncommitted changes' },
    { key: 'Hint', value: 'current changes' },
  ]);
  const reviewDoneDetail = buildEventDetail(session, reviewEvents[1].id, 'main');
  assert.deepEqual(reviewDoneDetail.sections.find((section) => section.title === 'Review result').entries, [
    { key: 'Status', value: 'Completed' },
    { key: 'Correctness', value: 'patch is correct' },
    { key: 'Findings', value: '0' },
  ]);
  assert.equal(reviewDoneDetail.sections.some((section) => section.title === 'Findings' && section.text === 'No findings were reported.'), true);
  const reviewFindingDetail = buildEventDetail(session, reviewEvents[3].id, 'main');
  const findingSummary = reviewFindingDetail.sections.find((section) => section.title === 'Review result');
  assert.deepEqual(findingSummary.entries, [
    { key: 'Status', value: 'Completed' },
    { key: 'Correctness', value: 'patch has issue' },
    { key: 'Confidence', value: '0.77' },
    { key: 'Findings', value: '1' },
  ]);
  const findingsSection = reviewFindingDetail.sections.find((section) => section.title === 'Findings');
  assert.match(findingsSection.html, /Guard duplicate rows/);
  assert.match(findingsSection.html, /P2 \| confidence 0\.61 \| G:\\vibe\\term-agent\\src\\sessions\.js:lines 42-45/);
  assert.equal(userEvents[0].rawRefs.length, 2);
  assert.equal(assistantEvents[0].rawRefs.length, 2);
  assert.equal(planEvents[0].rawRefs.length, 2);

  assert.equal(timeline.events.some((event) => event.kind === 'token'), false);
  assert.equal(session.analysis.tokenStats.maxObserved, 0);
});

test('timeline protocol layer exposes injected records and raw layer keeps all rows', async () => {
  const index = await buildFixtureIndex();
  const protocolTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'protocol',
  });
  assert.ok(protocolTimeline.events.some((event) => event.subtype === 'agents_instructions'));
  assert.ok(protocolTimeline.events.some((event) => event.subtype === 'developer_permissions'));
  assert.ok(protocolTimeline.events.some((event) => event.subtype === 'environment_context'));
  const protocolBySubtype = new Map(protocolTimeline.events.map((event) => [event.subtype, event]));
  assert.equal(protocolBySubtype.get('agents_instructions').label, 'AGENTS.md instructions');
  assert.equal(protocolBySubtype.get('agents_instructions').preview, 'Repository instructions for G:\\vibe\\term-agent');
  assert.equal(protocolBySubtype.get('developer_permissions').label, 'Developer permissions');
  assert.equal(protocolBySubtype.get('developer_permissions').preview, 'Filesystem sandboxing defines which files can be read or written.');
  assert.equal(protocolBySubtype.get('environment_context').label, 'Environment context');
  assert.equal(protocolBySubtype.get('environment_context').preview, 'cwd: G:\\vibe\\term-agent; shell: powershell');
  assert.equal(protocolBySubtype.get('session_meta').label, 'Session metadata');
  assert.equal(protocolBySubtype.get('turn_context').preview, 'turn_id: turn-1; cwd: G:\\vibe\\term-agent; model: gpt-5');
  assert.equal(protocolBySubtype.get('token_count').label, 'Token count');
  assert.match(protocolBySubtype.get('token_count').preview, /5 hour usage limit: 12% remaining; Resets/);
  assert.match(protocolBySubtype.get('token_count').preview, /Weekly usage limit: 67% remaining; Resets/);
  assert.equal(protocolBySubtype.get('session_configured').label, 'Session configured');
  assert.equal(protocolBySubtype.get('session_configured').preview, 'thread_name: configured fixture title; cwd: G:\\vibe\\term-agent; model: gpt-5.1');
  assert.equal(protocolBySubtype.get('thread_goal_updated').label, 'Thread goal updated');
  assert.equal(protocolBySubtype.get('thread_goal_updated').preview, 'Keep protocol coverage readable.');

  const rawTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'raw',
  });
  assert.ok(rawTimeline.total > protocolTimeline.total);
  assert.ok(rawTimeline.events.some((event) => event.recordType === 'response_item'));
});

test('current protocol plan, severity, lifecycle aliases, and incomplete tool records are readable', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const timeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 200,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });

  const planUpdates = timeline.events.filter((event) => event.kind === 'plan_update');
  assert.equal(planUpdates.length, 2);
  assert.deepEqual(planUpdates.map((event) => event.label), ['Plan update', 'Plan delta']);
  assert.equal(planUpdates[0].preview, 'Protocol plan update fixture');
  assert.equal(planUpdates[1].preview, 'Verify folding completed');

  const warningEvents = timeline.events.filter((event) => event.kind === 'warning');
  assert.deepEqual(warningEvents.map((event) => [event.subtype, event.severity]), [
    ['warning', 'warning'],
    ['guardian_warning', 'warning'],
  ]);
  const streamError = timeline.events.find((event) => event.subtype === 'stream_error');
  assert.equal(streamError.kind, 'error');
  assert.equal(streamError.severity, 'error');

  const aliasTurns = timeline.events.filter((event) => event.kind === 'turn' && event.turnId === 'turn-alias');
  assert.deepEqual(aliasTurns.map((event) => event.label), ['task_started', 'task_complete']);

  const incompleteCommand = timeline.events.find((event) => event.preview.includes('npm run watch'));
  assert.equal(incompleteCommand.kind, 'command');
  assert.equal(incompleteCommand.status, 'incomplete');
  assert.equal(incompleteCommand.severity, 'warning');

  const declinedCommand = timeline.events.find((event) => event.preview.includes('git commit'));
  assert.equal(declinedCommand.status, 'declined');
  assert.equal(declinedCommand.severity, 'warning');

  const incompletePatch = timeline.events.find((event) => event.preview.includes('src/incomplete.js'));
  assert.equal(incompletePatch.kind, 'patch');
  assert.equal(incompletePatch.status, 'incomplete');
  assert.deepEqual(incompletePatch.rawRefs.map((ref) => ref.line), [41]);

  const declinedPatch = timeline.events.find((event) => event.preview.includes('src/declined.js'));
  assert.equal(declinedPatch.status, 'declined');
  assert.equal(declinedPatch.severity, 'warning');

  const mcpBegin = timeline.events.find((event) => event.toolName === 'mcp__fixture__lookup');
  assert.equal(mcpBegin.kind, 'mcp');
  assert.equal(mcpBegin.status, 'incomplete');
  assert.equal(mcpBegin.rawRefs.length, 1);

  const planDetail = buildEventDetail(session, planUpdates[0].id, 'main');
  assert.equal(planDetail.sections[0].type, 'markdown');
  assert.match(planDetail.sections[0].html, /Protocol plan update fixture/);
});

test('tool logical events merge new and old format patch records and search still works', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  const searched = filterSessions(index, { q: 'alpha', sort: 'updated-desc', layer: 'main' });
  assert.equal(searched.total, 1);

  const parserTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: 'parser.js',
    layer: 'main',
  });
  assert.equal(parserTimeline.total, 1);
  assert.equal(parserTimeline.events[0].kind, 'patch');
  assert.equal(parserTimeline.events[0].status, 'success');
  const parserDetail = buildEventDetail(session, parserTimeline.events[0].id, 'main');
  assert.deepEqual(parserDetail.sections.find((section) => section.title === 'Patch files').entries, [
    { key: 'G:\\vibe\\term-agent\\src\\parser.js', value: '+1 / -1' },
  ]);

  const legacyTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: 'legacy.js',
    layer: 'main',
  });
  assert.equal(legacyTimeline.total, 1);
  assert.equal(legacyTimeline.events[0].kind, 'patch');
  assert.equal(legacyTimeline.events[0].status, 'success');
  const legacyDetail = buildEventDetail(session, legacyTimeline.events[0].id, 'main');
  assert.deepEqual(legacyDetail.sections.find((section) => section.title === 'Patch files').entries, [
    { key: 'src/legacy.js', value: '+1 / -1' },
  ]);

  const statsTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: 'stats.js',
    layer: 'main',
  });
  assert.equal(statsTimeline.total, 1);
  assert.equal(statsTimeline.events[0].kind, 'patch');
  assert.equal(statsTimeline.events[0].status, 'success');
  const statsDetail = buildEventDetail(session, statsTimeline.events[0].id, 'main');
  assert.deepEqual(statsDetail.sections.find((section) => section.title === 'Patch files').entries, [
    { key: 'G:\\vibe\\term-agent\\src\\stats.js', value: '+2 / -1' },
  ]);

  const failedTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: 'failed',
    tool: '',
    file: 'failed.js',
    layer: 'main',
  });
  assert.equal(failedTimeline.total, 1);
  assert.equal(failedTimeline.events[0].kind, 'patch');
  assert.equal(failedTimeline.events[0].label, 'Patch failed');
  assert.equal(failedTimeline.events[0].status, 'failed');
  const failedDetail = buildEventDetail(session, failedTimeline.events[0].id, 'main');
  assert.deepEqual(failedDetail.sections.find((section) => section.title === 'Patch files').entries, [
    { key: 'src/failed.js', value: '+1 / -1' },
  ]);

  const outputOnlyCommandTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: 'rg -n -F',
    kind: 'command',
    status: 'success',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(outputOnlyCommandTimeline.total, 1);
  assert.equal(outputOnlyCommandTimeline.events[0].label, 'Command');
  assert.equal(outputOnlyCommandTimeline.events[0].status, 'success');
  assert.equal(outputOnlyCommandTimeline.events[0].outputStats.exitCode, 0);
  assert.match(outputOnlyCommandTimeline.events[0].preview, /rg -n -F 'alpha' 'src'/);
});

test('file suggestions come from analyzed session touched files', async () => {
  const index = await buildFixtureIndex();
  const suggestions = fileSuggestions(index).map((item) => item.file);

  assert.ok(suggestions.includes('src/parser.js'));
  assert.ok(suggestions.includes('src/legacy.js'));
  assert.equal(suggestions.includes('public/app.js'), false);
});

test('web search logical events merge end/call rows and expose structured detail', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  const webTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: 'web_search',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(webTimeline.total, 3);

  const completedSearch = webTimeline.events.find((event) => event.rawRefs.length === 2);
  assert.ok(completedSearch);
  assert.equal(completedSearch.label, 'Web search');
  assert.equal(completedSearch.status, 'completed');
  assert.equal(completedSearch.toolName, 'web_search');
  assert.deepEqual(completedSearch.channels, ['event_msg', 'response_item']);

  const openPageSearch = webTimeline.events.find((event) => event.preview.includes('https://example.test/docs'));
  assert.ok(openPageSearch);
  assert.deepEqual(openPageSearch.channels, ['event_msg', 'response_item']);
  assert.deepEqual(openPageSearch.rawRefs.map((ref) => ref.line), [16, 17]);

  const orphanSearch = webTimeline.events.find((event) => event.rawRefs.length === 1 && event.preview.includes('orphan web search end fixture'));
  assert.ok(orphanSearch);
  assert.equal(orphanSearch.status, 'completed');
  assert.deepEqual(orphanSearch.channels, ['event_msg']);

  const searchedTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: 'detail extraction',
    kind: 'web_search',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(searchedTimeline.total, 3);
  assert.equal(searchedTimeline.searchMatchCount, 2);
  assert.equal(searchedTimeline.events[0].id, completedSearch.id);
  assert.equal(searchedTimeline.events[0].hasSearchHit, true);
  assert.match(searchedTimeline.events[0].snippet, /detail extraction/);

  const detail = buildEventDetail(session, completedSearch.id, 'main');
  const actionSection = detail.sections.find((section) => section.title === 'Search action');
  assert.equal(actionSection.type, 'json');
  assert.equal(actionSection.value.query, 'normalization web search fixture');

  const metadataSection = detail.sections.find((section) => section.title === 'Search metadata');
  assert.deepEqual(metadataSection.entries, [
    { key: 'status', value: 'completed' },
  ]);

  const payloadSection = detail.sections.find((section) => section.title === 'Search payload');
  assert.equal(payloadSection.type, 'json');
  assert.equal(payloadSection.value.query, 'normalization web search fixture');
  assert.equal(payloadSection.value.results[0].snippet, 'web search detail extraction result');
});

test('buildEventDetail extracts structured sections for messages, tools, protocol, empty reasoning, and raw records', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  const userEvent = session.logicalEvents.find((event) => event.kind === 'user_message');
  const userDetail = buildEventDetail(session, userEvent.id, 'main');
  assert.equal(userDetail.sections[0].title, 'Message');
  assert.equal(userDetail.sections[0].hideTitle, true);
  assert.match(userDetail.sections[0].html, /<h1>Fix the alpha parser regression<\/h1>/);
  assert.match(userDetail.sections[0].html, /<table>/);
  assert.match(userDetail.sections[0].html, /<li>render markdown<\/li>/);
  assert.match(userDetail.sections[0].html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(userDetail.sections[0].html, /href="javascript:/i);

  const assistantEvent = session.logicalEvents.find((event) => event.kind === 'assistant_message');
  const assistantDetail = buildEventDetail(session, assistantEvent.id, 'main');
  assert.equal(assistantDetail.sections[0].type, 'markdown');
  assert.equal(assistantDetail.sections[0].hideTitle, true);
  assert.match(assistantDetail.sections[0].html, /inspect the parser first/i);
  assert.deepEqual(Object.keys(assistantDetail.meta), ['timestamp', 'turnId', 'status', 'severity', 'toolName', 'touchedFiles', 'outputStats', 'channels', 'source']);

  const commandEvent = session.logicalEvents.find((event) => event.kind === 'command');
  const commandDetail = buildEventDetail(session, commandEvent.id, 'main');
  assert.equal(commandDetail.sections[0].type, 'code');
  assert.equal(commandDetail.sections[1].type, 'kv');
  assert.equal(commandDetail.sections[1].hideTitle, undefined);
  assert.ok(commandDetail.sections.some((section) => section.type === 'terminal' && section.stream === 'stderr'));
  assert.ok(commandDetail.sections.some((section) => section.type === 'json' && section.title === 'Command arguments'));
  assert.equal(commandDetail.sections.filter((section) => section.type === 'code').length, 1);
  assert.equal(commandDetail.sections.some((section) => section.title === 'Tool output'), false);

  const patchEvents = session.logicalEvents.filter((event) => event.kind === 'patch');
  const newPatchDetail = buildEventDetail(session, patchEvents[0].id, 'main');
  const oldPatchDetail = buildEventDetail(session, patchEvents[1].id, 'main');
  assert.equal(newPatchDetail.sections[0].type, 'diff');
  assert.equal(oldPatchDetail.sections[0].type, 'diff');

  const planEvent = session.logicalEvents.find((event) => event.kind === 'plan_artifact');
  const planDetail = buildEventDetail(session, planEvent.id, 'main');
  assert.equal(planDetail.sections[0].type, 'markdown');
  assert.equal(planDetail.sections[0].hideTitle, true);
  assert.doesNotMatch(planDetail.sections[0].html, /proposed_plan/i);
  assert.ok(planDetail.sections.some((section) => section.type === 'raw_json'));
  assert.equal(planDetail.sections.find((section) => section.type === 'raw_json').expanded, false);

  const protocolEvent = session.logicalEvents.find((event) => event.subtype === 'agents_instructions');
  const protocolDetail = buildEventDetail(session, protocolEvent.id, 'protocol');
  assert.equal(protocolDetail.sections[0].type, 'markdown');
  assert.equal(protocolDetail.sections[0].hideTitle, true);

  const envEvent = session.logicalEvents.find((event) => event.subtype === 'environment_context');
  const envDetail = buildEventDetail(session, envEvent.id, 'protocol');
  assert.equal(envDetail.sections[0].type, 'kv');
  assert.equal(envDetail.sections[1].type, 'raw_json');

  const sessionMetaEvent = session.logicalEvents.find((event) => event.subtype === 'session_meta');
  const sessionMetaDetail = buildEventDetail(session, sessionMetaEvent.id, 'protocol');
  assert.equal(sessionMetaDetail.sections[0].type, 'kv');
  assert.equal(sessionMetaDetail.sections[1].type, 'raw_json');

  const emptyReasoningEvent = session.logicalEvents.find((event) => event.kind === 'reasoning' && event.label === 'Empty reasoning');
  const emptyReasoningDetail = buildEventDetail(session, emptyReasoningEvent.id, 'protocol');
  assert.equal(emptyReasoningDetail.sections[0].type, 'notice');
  assert.equal(emptyReasoningDetail.sections[0].hideTitle, true);

  const tokenEvent = session.logicalEvents.find((event) => event.subtype === 'token_count');
  const tokenDetail = buildEventDetail(session, tokenEvent.id, 'protocol');
  const usageLimits = tokenDetail.sections.find((section) => section.title === 'Usage limits');
  assert.equal(usageLimits.type, 'usage_limits');
  assert.deepEqual(usageLimits.items.map((item) => [item.label, item.remaining]), [
    ['5 hour usage limit', '12%'],
    ['Weekly usage limit', '67%'],
  ]);

  const rawRecord = session.rawEvents.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'task_started');
  const rawDetail = buildEventDetail(session, rawRecord.rawId, 'raw');
  assert.equal(rawDetail.sections.at(-1).type, 'raw_json');
  assert.equal(rawDetail.sections.at(-1).expanded, true);

  const rawUserRecord = session.rawEvents.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'user_message');
  const rawUserDetail = buildEventDetail(session, rawUserRecord.rawId, 'raw');
  assert.equal(rawUserDetail.sections[0].type, 'markdown');
  assert.equal(rawUserDetail.sections[0].hideTitle, true);
  assert.match(rawUserDetail.sections[0].html, /<h1>Fix the alpha parser regression<\/h1>/);
  assert.equal(rawUserDetail.sections.find((section) => section.type === 'kv').entries.some((entry) => entry.key === 'message'), false);
  assert.equal(rawUserDetail.sections.at(-1).type, 'raw_json');
  assert.equal(rawUserDetail.sections.at(-1).expanded, true);

  const rawEnvironmentRecord = session.rawEvents.find((raw) => raw.messageText.startsWith('<environment_context>'));
  const rawEnvironmentDetail = buildEventDetail(session, rawEnvironmentRecord.rawId, 'raw');
  assert.equal(rawEnvironmentDetail.sections[0].type, 'kv');
  assert.equal(rawEnvironmentDetail.sections[0].title, 'Protocol fields');
  assert.equal(rawEnvironmentDetail.sections.some((section) => section.title === 'Message'), false);

  const rawCommandCall = session.rawEvents.find((raw) => raw.payloadType === 'function_call' && raw.toolName === 'shell_command');
  const rawCommandCallDetail = buildEventDetail(session, rawCommandCall.rawId, 'raw');
  assert.equal(rawCommandCallDetail.sections[0].type, 'code');
  assert.equal(rawCommandCallDetail.sections[0].title, 'Command');
  assert.equal(rawCommandCallDetail.sections.some((section) => section.title === 'Payload'), false);

  const rawPatchCall = session.rawEvents.find((raw) => raw.payloadType === 'custom_tool_call' && raw.toolName === 'apply_patch');
  const rawPatchCallDetail = buildEventDetail(session, rawPatchCall.rawId, 'raw');
  assert.equal(rawPatchCallDetail.sections[0].type, 'diff');
  assert.equal(rawPatchCallDetail.sections[0].title, 'Patch');
  assert.equal(rawPatchCallDetail.sections.some((section) => section.title === 'Payload'), false);

  const rawPatchEnd = session.rawEvents.find((raw) => raw.payloadType === 'patch_apply_end');
  const rawPatchEndDetail = buildEventDetail(session, rawPatchEnd.rawId, 'raw');
  assert.equal(rawPatchEndDetail.sections[0].type, 'kv');
  assert.equal(rawPatchEndDetail.sections[0].title, 'Patch files');
});

test('command terminal sections repair UTF-8 text decoded as GB18030', () => {
  const decodeUtf8AsGb18030 = (text) => new TextDecoder('gb18030').decode(Buffer.from(text, 'utf8'));
  const rawCall = {
    rawId: 'fixture:raw:1',
    recordType: 'response_item',
    payloadType: 'function_call',
    toolName: 'shell_command',
    output: JSON.stringify({
      command: "Get-Content -Path 'analysis_output\\fine_omni_events.py'",
      workdir: 'G:\\vibe\\video-spotter',
    }),
    parsed: { payload: {} },
    source: { file: 'fixture.jsonl', line: 1 },
  };
  const rawOutput = {
    rawId: 'fixture:raw:2',
    recordType: 'response_item',
    payloadType: 'function_call_output',
    output: [
      'Exit code: 0',
      'Wall time: 0.1 seconds',
      'Output:',
      `# AI ${decodeUtf8AsGb18030('功能测试视频事件定位工作流')}`,
      '本文档总结 `荣耀-OCR表格提取` 和 `2-语音转文字` 两个场景。',
      'ASCII question? stays as question.',
      `## ${decodeUtf8AsGb18030('已验证场景')}`,
      `VIDEO_DIR = ROOT / "test_videos" / "${decodeUtf8AsGb18030('荣耀-OCR表格提取')}"`,
      `WINDOWS = {"${decodeUtf8AsGb18030('语料1.mp4')}": {"capture_done": (10.8, 12.4)}}`,
      `- ${decodeUtf8AsGb18030('抽帧与 seek 策略')}`,
      'Lost punctuation: 鍜? 銆? 锛? 鈥?',
    ].join('\n'),
    parsed: { payload: {} },
    source: { file: 'fixture.jsonl', line: 2 },
  };
  const event = {
    id: 'fixture:logical:call:1',
    kind: 'command',
    layer: 'main',
    label: 'Command',
    status: 'success',
    severity: 'normal',
    toolName: 'shell_command',
    outputStats: { exitCode: 0 },
    touchedFiles: [],
    rawRefs: [
      { rawId: rawCall.rawId, file: 'fixture.jsonl', line: 1 },
      { rawId: rawOutput.rawId, file: 'fixture.jsonl', line: 2 },
    ],
    channels: ['response_item'],
  };
  const session = {
    rawEvents: [rawCall, rawOutput],
    logicalEvents: [event],
  };

  const detail = buildEventDetail(session, event.id, 'main');
  const stdout = detail.sections.find((section) => section.type === 'terminal' && section.title === 'stdout');
  assert.ok(stdout);
  assert.match(stdout.text, /功能测试视频事件定位工作/);
  assert.match(stdout.text, /功能测试视频事件定位工作□/);
  assert.match(stdout.text, /本文档总结 `荣耀-OCR表格提取` 和 `2-语音转文字` 两个场景。/);
  assert.match(stdout.text, /ASCII question\? stays as question\./);
  assert.match(stdout.text, /已验证场/);
  assert.match(stdout.text, /已验证场□/);
  assert.match(stdout.text, /荣耀-OCR表格提取/);
  assert.match(stdout.text, /语料1\.mp4/);
  assert.match(stdout.text, /抽帧/);
  assert.match(stdout.text, /策略/);
  assert.match(stdout.text, /Lost punctuation: □ □ □ □/);
  assert.doesNotMatch(stdout.text, /\uFFFD\?/);
  assert.doesNotMatch(stdout.text, /鍔熻兘|鑽|璇枡|绛栫暐/);
});

test('detail endpoint returns structured event detail with sections and raw refs', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const planEvent = session.logicalEvents.find((event) => event.kind === 'plan_artifact');
  const server = createServer(index, 1);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/sessions/${encodeURIComponent(session.id)}/events/${encodeURIComponent(planEvent.id)}/detail?layer=main`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, planEvent.id);
    assert.equal(body.layer, 'main');
    assert.equal(body.sections[0].type, 'markdown');
    assert.ok(body.rawRefs.length >= 1);
    assert.deepEqual(Object.keys(body.meta), ['timestamp', 'turnId', 'status', 'severity', 'toolName', 'touchedFiles', 'outputStats', 'channels', 'source']);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('project endpoints require and select a browser-chosen project', async () => {
  const server = createServer(null, 0, { codexHome: fixtureCodexHome });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const stateBefore = await fetch(`${base}/api/state`);
    assert.equal(stateBefore.status, 409);
    assert.equal((await stateBefore.json()).error, 'Project not selected');

    const projectsRes = await fetch(`${base}/api/projects`);
    assert.equal(projectsRes.status, 200);
    const projectsBody = await projectsRes.json();
    assert.ok(projectsBody.projects.some((project) => project.repoRoot === 'G:\\vibe\\term-agent'));

    const selectRes = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'G:\\vibe\\term-agent' }),
    });
    assert.equal(selectRes.status, 202);
    const selectBody = await selectRes.json();
    assert.equal(selectBody.job.repoRoot, 'G:\\vibe\\term-agent');
    assert.equal(selectBody.job.status, 'running');

    let statusBody = null;
    for (let i = 0; i < 20; i += 1) {
      const statusRes = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(selectBody.job.id)}`);
      assert.equal(statusRes.status, 200);
      statusBody = await statusRes.json();
      if (statusBody.job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(statusBody.job.status, 'succeeded');
    assert.equal(statusBody.state.repoRoot, 'G:\\vibe\\term-agent');
    assert.equal(statusBody.state.totals.sessionCount, 10);
    assert.equal(statusBody.state.totals.skippedFileCount, 1);

    const sessionsRes = await fetch(`${base}/api/sessions`);
    assert.equal(sessionsRes.status, 200);
    assert.equal((await sessionsRes.json()).total, 10);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('state reports active project job even when an old index exists', async () => {
  const index = await buildFixtureIndex();
  let releaseIndex = null;
  const server = createServer(index, 1, {
    codexHome: fixtureCodexHome,
    buildIndex: () => new Promise((resolve) => {
      releaseIndex = () => resolve(index);
    }),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const selectRes = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'G:\\vibe\\term-agent' }),
    });
    assert.equal(selectRes.status, 202);
    const selectBody = await selectRes.json();

    const stateRes = await fetch(`${base}/api/state`);
    assert.equal(stateRes.status, 202);
    const stateBody = await stateRes.json();
    assert.equal(stateBody.job.id, selectBody.job.id);
    assert.equal(stateBody.currentState.repoRoot, 'G:\\vibe\\term-agent');
    releaseIndex();
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('cancelling an active project job preserves the previous index', async () => {
  const index = await buildFixtureIndex();
  const server = createServer(index, 1, {
    codexHome: fixtureCodexHome,
    buildIndex: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('Indexing cancelled');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const selectRes = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'G:\\vibe\\term-agent' }),
    });
    assert.equal(selectRes.status, 202);
    const selectBody = await selectRes.json();

    const cancelRes = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(selectBody.job.id)}`, {
      method: 'DELETE',
    });
    assert.equal(cancelRes.status, 200);
    assert.equal((await cancelRes.json()).job.status, 'cancelled');

    const stateRes = await fetch(`${base}/api/state`);
    assert.equal(stateRes.status, 200);
    const stateBody = await stateRes.json();
    assert.equal(stateBody.repoRoot, 'G:\\vibe\\term-agent');
    assert.equal(stateBody.totals.sessionCount, 10);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('readRawLine returns the original JSONL row for drill-down', async () => {
  const index = await buildFixtureIndex();
  const raw = await readRawLine(index, primaryFixtureSession(index).sourceFile, 12);
  assert.equal(raw.parsed.type, 'event_msg');
  assert.equal(raw.parsed.payload.type, 'agent_message');
});

test('path containment and folding profiles expose expected presets', () => {
  assert.equal(isPathInsideOrSame('G:\\vibe\\term-agent\\src', 'G:\\vibe\\term-agent'), true);
  assert.equal(isPathInsideOrSame('G:\\vibe\\term-agent-other', 'G:\\vibe\\term-agent'), false);
  assert.ok(foldingProfiles.some((profile) => profile.id === 'narrative'));
  assert.ok(foldingProfiles.some((profile) => profile.id === 'debug'));
  assert.ok(foldingProfiles.some((profile) => profile.id === 'compact'));
  assert.equal(EDITABLE_EVENT_KINDS.includes('protocol'), false);
  assert.equal(EDITABLE_EVENT_KINDS.includes('event'), false);
  assert.equal(EDITABLE_EVENT_KINDS.includes('review'), true);
  for (const profile of foldingProfiles) {
    assert.ok(profile.rules, `${profile.id} has rule data`);
    assert.ok(DISPLAY_STATES.includes(profile.rules.fallback), `${profile.id} has a valid fallback`);
    for (const state of Object.values(profile.rules.kindStates || {})) {
      assert.ok(DISPLAY_STATES.includes(state), `${profile.id} has a valid kind state`);
    }
    for (const condition of profile.rules.conditions || []) {
      assert.ok(condition.id, `${profile.id} condition has an id`);
      assert.ok(DISPLAY_STATES.includes(condition.state), `${profile.id} condition has a valid state`);
    }
  }
  const narrative = foldingProfiles.find((profile) => profile.id === 'narrative');
  assert.equal(narrative.rules.kindStates.user_message, 'expanded');
  assert.equal(narrative.rules.kindStates.reasoning, 'collapsed');
  const compact = foldingProfiles.find((profile) => profile.id === 'compact');
  assert.equal(compact.rules.fallback, 'collapsed');
});
