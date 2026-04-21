'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildIndex, filterSessions, getTimeline, readRawLine, isPathInsideOrSame } = require('../src/codex');
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
  assert.equal(session.counts.patches, 2);
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
});

test('readRawLine returns the original JSONL row for drill-down', async () => {
  const index = await buildFixtureIndex();
  const raw = await readRawLine(index, index.sessions[0].sourceFile, 11);
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
