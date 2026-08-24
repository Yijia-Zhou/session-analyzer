'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildDeepSeekIndex, deepSeekAdapter } = require('../src/deepseek-harness');
const {
  buildEventDetailForSession,
  materializeSessionForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-command-plan-state', 'sessions');
const FIXTURE_FILE = path.join(
  FIXTURE_ROOT,
  '--synthetic-deepseek-command-plan-state--',
  'command-plan-state',
  'session.jsonl',
);
const FIXTURE_REPO = '/synthetic/deepseek-command-plan-state';
const FIXTURE_SHA256 = 'ec6d6e43f199caf15237f398614521542e90db8d4ceffd74899ada4f1d9e518a';

async function buildFor(repoRoot, sourceHome = FIXTURE_ROOT) {
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot });
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  return { index, indexed, materialized };
}

async function assertProjectionParity(index, indexed, materialized) {
  const digest = await projectQueryProjectionDigestAsync(
    materialized,
    deepSeekAdapter.query.projectQueryPresentation,
  );
  assert.equal(digest, indexed.queryProjectionDigest);
}

async function makeSyntheticFixture(t, id, records, headerFields = {}) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-command-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-command-home-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  t.after(() => fsp.rm(repoRoot, { recursive: true, force: true }));
  const sessionDir = path.join(sourceHome, '--synthetic-project--', id);
  await fsp.mkdir(sessionDir, { recursive: true });
  const header = {
    type: 'session', version: 0, id, createdAt: 1, cwd: repoRoot, delegationDepth: 0,
    ...headerFields,
  };
  await fsp.writeFile(
    path.join(sessionDir, 'session.jsonl'),
    `${[header, ...records].map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );
  return { sourceHome, repoRoot };
}

function at(type, seq, data) {
  return { type, seq, time: 1000 + seq, data };
}

function run(seq, commandId, name = 'feedback', args = ' hello') {
  return at('command/run', seq, { commandId, name, args, source: { kind: 'user' } });
}

function done(seq, commandId, kind = 'success', text = 'Recorded.') {
  return at('command/done', seq, { commandId, kind, text });
}

function commandEvents(session) {
  return session.logicalEvents.filter(event => event.subtype === 'command/lifecycle');
}

function planEvents(session) {
  return session.logicalEvents.filter(event => event.subtype === 'plan/mode' && event.planModeState);
}

function rawSeqs(event) {
  return event.rawRefs.map(ref => ref.sourceLocator.seq);
}

function assertNoCommandPlanProvenance(session) {
  for (const event of session.logicalEvents) {
    assert.equal(Object.hasOwn(event, 'commandPlanProvenance'), false);
    assert.equal(Object.hasOwn(event, 'eventRefs'), false);
    assert.equal(Object.hasOwn(event, 'relations'), false);
  }
}

test('sanitized Batch A shape projects two Protocol command lifecycles and two independent plan states', async () => {
  const bytes = await fsp.readFile(FIXTURE_FILE);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FIXTURE_SHA256);
  const { index, indexed, materialized } = await buildFor(FIXTURE_REPO);
  const commands = commandEvents(materialized);
  const plans = planEvents(materialized);
  assert.equal(commands.length, 2);
  assert.equal(plans.length, 2);
  assert.deepEqual(commands.map(event => rawSeqs(event)), [[0, 3], [4, 6]]);
  assert.deepEqual(plans.map(event => rawSeqs(event)), [[1], [5]]);
  assert.deepEqual(plans.map(event => event.planModeState.active), [true, false]);
  assert.deepEqual(commands.map(event => event.status), ['success', 'success']);
  assert.equal(materialized.logicalEvents.filter(event => event.layer === 'main').length, 0);
  assert.equal(indexed.counts.planEvents, 0);
  assert.equal(indexed.counts.planArtifacts, 0);
  assertNoCommandPlanProvenance(materialized);

  const owners = [...commands, ...plans].flatMap(event => event.rawRefs.map(ref => ref.rawId));
  assert.equal(owners.length, new Set(owners).size);
  for (const event of [...commands, ...plans]) {
    const detail = await buildEventDetailForSession(index, materialized, event.id, 'protocol');
    validateStructuredLogicalDetailDto(detail);
    assert.ok(detail.inspectorSections.every(section => section.type !== 'event_refs'));
  }
  const commandDetail = await buildEventDetailForSession(index, materialized, commands[0].id, 'protocol');
  assert.ok(commandDetail.timelineSections.some(section => (
    section.type === 'kv' && section.entries.some(entry => entry.key === 'Command' && entry.value === 'plan')
  )));
  assert.ok(commandDetail.inspectorSections.some(section => (
    section.type === 'kv' && section.entries.some(entry => entry.key === 'Command ID')
  )));
  const planDetail = await buildEventDetailForSession(index, materialized, plans[0].id, 'protocol');
  assert.ok(planDetail.timelineSections.some(section => (
    section.type === 'kv' && section.entries.some(entry => entry.key === 'Plan mode' && entry.value === 'enabled')
  )));
  await assertProjectionParity(index, indexed, materialized);
});

test('success and error settlements remain Protocol application control with exact endpoint ownership', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'settlements', [
    run(0, 'cmd-success', 'compact', ''),
    done(1, 'cmd-success', 'success', ''),
    run(2, 'cmd-error', 'feedback', ' nope'),
    done(3, 'cmd-error', 'error', 'Rejected.'),
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const commands = commandEvents(materialized);
  assert.deepEqual(commands.map(event => event.status), ['success', 'failed']);
  assert.deepEqual(commands.map(event => rawSeqs(event)), [[0, 1], [2, 3]]);
  assert.equal(materialized.logicalEvents.filter(event => event.layer === 'main').length, 0);
});

test('partial, duplicate, reversed, empty, and malformed command evidence fails closed', async (t) => {
  const cases = [
    { name: 'run-only', rows: [run(0, 'cmd-a')] },
    { name: 'done-only', rows: [done(0, 'cmd-a')] },
    { name: 'duplicate-run', rows: [run(0, 'cmd-a'), run(1, 'cmd-a'), done(2, 'cmd-a')] },
    { name: 'duplicate-done', rows: [run(0, 'cmd-a'), done(1, 'cmd-a'), done(2, 'cmd-a')] },
    { name: 'done-before-run', rows: [done(0, 'cmd-a'), run(1, 'cmd-a')] },
    { name: 'empty-id', rows: [run(0, '   '), done(1, '   ')] },
    {
      name: 'malformed-run',
      rows: [at('command/run', 0, { commandId: 'cmd-a', name: '', source: { kind: 'user' } }), done(1, 'cmd-a')],
    },
    {
      name: 'uppercase-command-name',
      rows: [run(0, 'cmd-a', 'Plan'), done(1, 'cmd-a')],
    },
    {
      name: 'spaced-command-name',
      rows: [run(0, 'cmd-a', 'bad name'), done(1, 'cmd-a')],
    },
    {
      name: 'dotted-command-name',
      rows: [run(0, 'cmd-a', 'foo.bar'), done(1, 'cmd-a')],
    },
    {
      name: 'malformed-done',
      rows: [run(0, 'cmd-a'), at('command/done', 1, { commandId: 'cmd-a', kind: 'unknown' })],
    },
    {
      name: 'empty-error-text',
      rows: [run(0, 'cmd-a'), done(1, 'cmd-a', 'error', '')],
    },
    {
      name: 'whitespace-error-text',
      rows: [run(0, 'cmd-a'), done(1, 'cmd-a', 'error', '   ')],
    },
  ];
  for (const candidate of cases) {
    await t.test(candidate.name, async (subtest) => {
      const fixture = await makeSyntheticFixture(subtest, candidate.name, candidate.rows);
      const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
      assert.equal(commandEvents(materialized).length, 0);
      assert.equal(materialized.logicalEvents.filter(event => (
        event.subtype === 'command/run' || event.subtype === 'command/done'
      )).length, candidate.rows.length);
    });
  }
});

test('different command IDs pair independently across unrelated non-adjacent records', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'independent-nonadjacent', [
    run(0, 'cmd-a', 'feedback', ' first'),
    run(1, 'cmd-b', 'compact', ''),
    at('session/title', 2, { title: 'Intervening', source: 'fallback', messageSeqs: [] }),
    done(3, 'cmd-b', 'success', 'B done'),
    done(4, 'cmd-a', 'success', 'A done'),
  ]);
  const { index, indexed, materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const commands = commandEvents(materialized);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands.map(event => event.commandLifecycle.commandId).sort(), ['cmd-a', 'cmd-b']);
  assert.deepEqual(commands.map(event => rawSeqs(event)).sort(), [[0, 4], [1, 3]]);
  await assertProjectionParity(index, indexed, materialized);
});

test('current-source-backed sourceEventSeq remains a fact without becoming an event relation', async (t) => {
  const rows = [
    at('session/title', 0, { title: 'Authority', source: 'fallback', messageSeqs: [] }),
    run(1, 'cmd-source', 'compact', ''),
    { ...done(2, 'cmd-source', 'success', 'Compacted.'), data: {
      commandId: 'cmd-source', kind: 'success', text: 'Compacted.', sourceEventSeq: 0,
    } },
  ];
  const fixture = await makeSyntheticFixture(t, 'source-event-seq', rows);
  const { index, materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const command = commandEvents(materialized)[0];
  assert.equal(command.commandLifecycle.sourceEventSeq, 0);
  assertNoCommandPlanProvenance(materialized);
  const detail = await buildEventDetailForSession(index, materialized, command.id, 'protocol');
  assert.ok(detail.inspectorSections.some(section => (
    section.type === 'kv'
    && section.entries.some(entry => entry.key === 'Source event seq' && entry.value === '0')
  )));
  assert.ok(detail.inspectorSections.every(section => section.type !== 'event_refs'));
});

test('plan state admits only exact boolean child-owned rows and keeps one Raw owner per state', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'plan-validation', [
    at('plan/mode', 0, { active: true }),
    at('plan/mode', 1, { active: false }),
    at('plan/mode', 2, { active: 'true' }),
    at('plan/mode', 3, { active: true, extra: 'invalid' }),
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const plans = planEvents(materialized);
  assert.deepEqual(plans.map(event => event.planModeState.active), [true, false]);
  assert.deepEqual(plans.map(event => rawSeqs(event)), [[0], [1]]);
  const generic = materialized.logicalEvents.filter(event => event.subtype === 'plan/mode' && !event.planModeState);
  assert.equal(generic.length, 2);
  assert.equal(materialized.logicalEvents.filter(event => event.layer === 'main').length, 0);
});

test('seed ownership prevents inherited command pairing and inherited plan-state projection', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'seed-boundary', [
    run(0, 'cmd-shared', 'plan', ' on'),
    at('plan/mode', 1, { active: true }),
    run(2, 'cmd-shared', 'plan', ' off'),
    done(3, 'cmd-shared', 'success', 'Done.'),
  ], {
    parentSession: 'parent-command-session', origin: 'subagent', seedLength: 2, delegationDepth: 1,
  });
  const { index, indexed, materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  assert.equal(materialized.forkStorageMode, 'materialized');
  assert.equal(commandEvents(materialized).length, 0);
  assert.equal(planEvents(materialized).length, 0);
  assert.deepEqual(materialized.logicalEvents.map(event => event.subtype), ['command/run', 'command/done']);
  await assertProjectionParity(index, indexed, materialized);
});

test('immediate, queued, and disagreeing command/plan facts never create provenance', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'no-command-plan-provenance', [
    run(0, 'cmd-immediate', 'plan', ' on'),
    at('plan/mode', 1, { active: true }),
    done(2, 'cmd-immediate', 'success', 'On.'),
    run(3, 'cmd-queued', 'plan', ' on'),
    done(4, 'cmd-queued', 'success', 'Queued.'),
    at('session/title', 5, { title: 'Intervening', source: 'fallback', messageSeqs: [] }),
    at('plan/mode', 6, { active: false }),
  ]);
  const { index, indexed, materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  assert.equal(commandEvents(materialized).length, 2);
  assert.deepEqual(planEvents(materialized).map(event => event.planModeState.active), [true, false]);
  assertNoCommandPlanProvenance(materialized);
  for (const event of [...commandEvents(materialized), ...planEvents(materialized)]) {
    const detail = await buildEventDetailForSession(index, materialized, event.id, 'protocol');
    assert.ok(detail.inspectorSections.every(section => section.type !== 'event_refs'));
  }
  await assertProjectionParity(index, indexed, materialized);
});
