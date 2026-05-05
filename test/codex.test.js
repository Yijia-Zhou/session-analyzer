'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildIndex, buildEventDetail, filterSessions, getTimeline, readRawLine, isPathInsideOrSame } = require('../src/codex');
const { createServer } = require('../server');
const { foldingProfiles } = require('../src/folding');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');

async function buildFixtureIndex() {
  return buildIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
  });
}

test('buildIndex deduplicates mirrored messages and keeps protocol separately', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessions[0];

  assert.equal(index.totals.fileCount, 2);
  assert.equal(index.totals.sessionCount, 1);
  assert.equal(session.id, '11111111-1111-1111-1111-111111111111');
  assert.equal(session.title, 'fixture repo session');
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.assistantMessages, 1);
  assert.equal(session.counts.messages, 2);
  assert.equal(session.counts.reasoning, 1);
  assert.equal(session.counts.failedCommands, 1);
  assert.equal(session.counts.patches, 4);
  assert.equal(session.counts.compactions, 1);
  assert.equal(session.counts.planArtifacts, 1);
  assert.ok(session.counts.protocol >= 3);
});

test('timeline main layer returns logical events without duplicate user or assistant messages', async () => {
  const index = await buildFixtureIndex();
  const timeline = getTimeline(index, index.sessions[0].id, {
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

  assert.equal(userEvents.length, 1);
  assert.equal(assistantEvents.length, 1);
  assert.equal(planEvents.length, 1);
  assert.equal(userEvents[0].rawRefs.length, 2);
  assert.equal(assistantEvents[0].rawRefs.length, 2);
  assert.equal(planEvents[0].rawRefs.length, 2);
});

test('timeline protocol layer exposes injected records and raw layer keeps all rows', async () => {
  const index = await buildFixtureIndex();
  const protocolTimeline = getTimeline(index, index.sessions[0].id, {
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

  const rawTimeline = getTimeline(index, index.sessions[0].id, {
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

test('tool logical events merge new and old format patch records and search still works', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessions[0];

  const searched = filterSessions(index, { q: 'alpha', sort: 'updated-desc', layer: 'main' });
  assert.equal(searched.total, 1);

  const parserTimeline = getTimeline(index, index.sessions[0].id, {
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

  const legacyTimeline = getTimeline(index, index.sessions[0].id, {
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

  const statsTimeline = getTimeline(index, index.sessions[0].id, {
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

  const failedTimeline = getTimeline(index, index.sessions[0].id, {
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
});

test('buildEventDetail extracts structured sections for messages, tools, protocol, empty reasoning, and raw records', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessions[0];

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

test('detail endpoint returns structured event detail with sections and raw refs', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessions[0];
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

test('readRawLine returns the original JSONL row for drill-down', async () => {
  const index = await buildFixtureIndex();
  const raw = await readRawLine(index, index.sessions[0].sourceFile, 12);
  assert.equal(raw.parsed.type, 'event_msg');
  assert.equal(raw.parsed.payload.type, 'agent_message');
});

test('path containment and folding profiles expose expected presets', () => {
  assert.equal(isPathInsideOrSame('G:\\vibe\\term-agent\\src', 'G:\\vibe\\term-agent'), true);
  assert.equal(isPathInsideOrSame('G:\\vibe\\term-agent-other', 'G:\\vibe\\term-agent'), false);
  assert.ok(foldingProfiles.some((profile) => profile.id === 'narrative'));
  assert.ok(foldingProfiles.some((profile) => profile.id === 'debug'));
  assert.ok(foldingProfiles.some((profile) => profile.id === 'compact'));
});
