'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  analyzerSessionId,
  buildClaudeIndex,
} = require('../src/claude');
const { filterSessions, getTimeline } = require('../src/codex');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'claude-loop-ultracode');

async function readFixture(name, repoRoot) {
  const source = await fsp.readFile(path.join(FIXTURE_ROOT, name), 'utf8');
  return source.trim().split(/\r?\n/u).map((line) => {
    const record = JSON.parse(line);
    if (record.cwd === '__REPO_ROOT__') record.cwd = repoRoot;
    return record;
  });
}

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function buildFixture(t, name) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-m4-'));
  const repoRoot = path.join(claudeHome, 'repo');
  const records = await readFixture(name, repoRoot);
  const sessionId = records[0].sessionId;
  const file = path.join(claudeHome, 'projects', '-m4-loop-ultracode', `${sessionId}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(file, records);
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  assert.ok(session, `${name} should produce a session`);
  return { index, session, records };
}

function rawFor(session, uuid) {
  const raw = session.rawEvents.find((candidate) => candidate.uuid === uuid);
  assert.ok(raw, `raw row ${uuid} should exist`);
  return raw;
}

function eventForRaw(session, uuid, predicate = () => true) {
  const raw = rawFor(session, uuid);
  const event = session.logicalEvents.find((candidate) => (
    predicate(candidate) && candidate.rawRefs.some((ref) => ref.rawId === raw.rawId)
  ));
  assert.ok(event, `raw row ${uuid} should remain reachable by the expected Logical Event`);
  return { raw, event };
}

function assertEveryRawReachable(session) {
  for (const raw of session.rawEvents) {
    assert.ok(
      session.logicalEvents.some((event) => event.rawRefs.some((ref) => ref.rawId === raw.rawId)),
      `Raw row ${raw.uuid || raw.rawId} should remain reachable`,
    );
  }
}

function toolInput(raw) {
  return raw.parsed?.message?.content?.find((block) => block.type === 'tool_use')?.input || null;
}

function timelineFilters(q = '') {
  return {
    offset: 0,
    limit: 100,
    layer: 'main',
    q,
    kind: '',
    status: '',
    tool: '',
    codeModeRequest: '',
    file: '',
    locale: 'en',
  };
}

test('dynamic /loop remains a command envelope while Goal and attributed assistant work stay source-backed', async (t) => {
  const { session } = await buildFixture(t, 'dynamic-loop-goal.jsonl');
  assert.equal(session.rawEvents.length, 5);

  const slash = eventForRaw(session, 'dynamic-loop-envelope', (event) => event.layer === 'protocol').event;
  assert.equal(slash.kind, 'protocol');
  assert.equal(slash.subtype, 'local_command');
  assert.match(slash.searchText, /\/loop/u);

  const goal = session.logicalEvents.find((event) => event.kind === 'goal');
  assert.ok(goal, 'source-backed Goal facts form a Goal lifecycle');
  assert.equal(goal.subtype, 'goal_status');
  assert.equal(goal.status, 'success');
  assert.deepEqual(goal.lifecycle, {
    kind: 'goal',
    phase: 'terminal',
    condition: 'Inspect synthetic state',
    initial: { met: false, sentinel: true },
    validations: [],
    terminal: {
      met: true,
      reason: 'Synthetic state inspected',
      iterations: 1,
      tokens: 12,
      durationMs: 48,
    },
  });
  assert.deepEqual(goal.provenance, { attributionSkill: 'synthetic-loop-skill' });
  assert.deepEqual(
    goal.rawRefs.map((ref) => ref.rawId),
    [
      rawFor(session, 'dynamic-loop-goal-initial'),
      rawFor(session, 'dynamic-loop-work'),
      rawFor(session, 'dynamic-loop-goal-terminal'),
    ].map((raw) => raw.rawId),
  );

  const work = eventForRaw(session, 'dynamic-loop-work', (event) => event.toolName === 'Read').event;
  assert.equal(work.kind, 'read');
  assert.equal(work.subtype, 'Read');
  assert.equal(work.model, 'synthetic-model');
  assert.equal(work.effort, 'high');
  assert.deepEqual(work.provenance, { attributionSkill: 'synthetic-loop-skill' });
  assert.equal(work.rawRefs.length, 2, 'the attributed Read work retains its paired call and result');

  assert.equal(session.logicalEvents.some((event) => event.kind === 'loop'), false);
  assert.equal(session.logicalEvents.some((event) => event.subtype === 'loop'), false);
  assert.equal(session.logicalEvents.some((event) => event.toolName.startsWith('Cron')), false);
  assertEveryRawReachable(session);
});

test('exact fixed cron lifecycle keeps four paired operations, provenance, and deletion evidence separate', async (t) => {
  const { index, session } = await buildFixture(t, 'cron-lifecycle.jsonl');
  const operations = [
    ['cron-create-call', 'cron-create-result', 'CronCreate'],
    ['cron-list-call', 'cron-list-result', 'CronList'],
    ['cron-wakeup-call', 'cron-wakeup-result', 'ScheduleWakeup'],
    ['cron-delete-call', 'cron-delete-result', 'CronDelete'],
  ];
  const events = operations.map(([callUuid, resultUuid, name]) => {
    const callRaw = rawFor(session, callUuid);
    const resultRaw = rawFor(session, resultUuid);
    const { event } = eventForRaw(session, callUuid, (candidate) => candidate.toolName === name);
    assert.equal(event.layer, 'main');
    assert.equal(event.kind, 'other_tool_call');
    assert.equal(event.subtype, name);
    assert.equal(event.toolName, name);
    assert.deepEqual(event.rawRefs.map((ref) => ref.rawId), [callRaw.rawId, resultRaw.rawId]);
    assert.ok(event.rawRefs.every((ref) => ref.sourceLocator?.type === 'jsonl_line'));
    assert.deepEqual(event.provenance, { attributionSkill: 'synthetic-cron-skill' });
    assert.equal(event.model, 'synthetic-cron-model');
    assert.equal(event.effort, 'high');
    return event;
  });
  assert.deepEqual(events.map((event) => event.toolName), operations.map(([, , name]) => name));

  const createInput = toolInput(rawFor(session, 'cron-create-call'));
  const listResult = rawFor(session, 'cron-list-result').parsed.toolUseResult;
  const wakeupInput = toolInput(rawFor(session, 'cron-wakeup-call'));
  const wakeupResult = rawFor(session, 'cron-wakeup-result').parsed.toolUseResult;
  const deleteInput = toolInput(rawFor(session, 'cron-delete-call'));
  const deleteResult = rawFor(session, 'cron-delete-result').parsed.toolUseResult;
  assert.equal(createInput.cron, 'synthetic schedule');
  assert.equal(createInput.recurring, true);
  assert.equal(listResult.jobs[0].id, 'synthetic-cron-42');
  assert.equal(listResult.jobs[0].cron, createInput.cron);
  assert.equal(listResult.jobs[0].prompt, createInput.prompt);
  assert.equal(listResult.jobs[0].recurring, createInput.recurring);
  assert.equal(Object.hasOwn(wakeupInput, 'id'), false, 'ScheduleWakeup has no cron ownership identifier');
  assert.equal(wakeupInput.stop, true);
  assert.equal(wakeupResult.stopped, true);
  assert.equal(Object.hasOwn(wakeupResult, 'id'), false, 'ScheduleWakeup result has no cron ownership identifier');
  assert.equal(deleteInput.id, 'synthetic-cron-42');
  assert.equal(deleteResult.id, 'synthetic-cron-42');
  assert.deepEqual(Object.keys(deleteResult), ['id']);

  const wakeup = events.find((event) => event.toolName === 'ScheduleWakeup');
  assert.doesNotMatch(wakeup.searchText, /deleted/u, 'stop:true is not deletion evidence');
  assert.equal(events.filter((event) => event.toolName === 'CronDelete').length, 1);
  assert.equal(session.logicalEvents.some((event) => event.kind === 'goal' || event.kind === 'loop'), false);

  const timeline = getTimeline(index, session.id, timelineFilters('synthetic-cron-skill'));
  assert.equal(timeline.total, 4);
  assert.equal(timeline.searchEventCount, 4);
  assert.equal(timeline.events.length, 4);
  assert.ok(timeline.events.every((event) => (
    event.provenance?.attributionSkill === 'synthetic-cron-skill'
  )));
  const search = filterSessions(index, {
    layer: 'main',
    q: 'synthetic-cron-skill',
    locale: 'en',
  });
  assert.equal(search.total, 1);
  assert.equal(search.sessions[0].searchMatch.eventCount, 4);
  assertEveryRawReachable(session);
});

test('ScheduleWakeup(stop:true) without CronDelete does not invent deletion evidence', async (t) => {
  const { session } = await buildFixture(t, 'cron-wakeup-without-delete.jsonl');
  const operations = session.logicalEvents.filter((event) => event.toolName);
  assert.deepEqual(operations.map((event) => event.toolName), [
    'CronCreate',
    'CronList',
    'ScheduleWakeup',
  ]);
  assert.equal(session.rawEvents.some((raw) => raw.toolName === 'CronDelete'), false);
  assert.equal(session.logicalEvents.some((event) => event.toolName === 'CronDelete'), false);
  assert.equal(session.logicalEvents.some((event) => event.kind === 'goal' || event.kind === 'loop'), false);
  assert.ok(operations.every((event) => event.kind === 'other_tool_call'));
  assert.doesNotMatch(JSON.stringify(session.logicalEvents), /deleted/u);
  assertEveryRawReachable(session);
});

test('duplicate Cron ownership keeps calls incomplete, results in Protocol/Raw, and never creates a composite', async (t) => {
  const { session } = await buildFixture(t, 'cron-ambiguous-owner.jsonl');
  assert.equal(session.rawEvents.length, 4);
  assert.equal(session.logicalEvents.some((event) => event.kind === 'goal' || event.kind === 'loop'), false);
  const calls = session.logicalEvents.filter((event) => event.toolName === 'CronCreate');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((event) => event.status === 'incomplete'));
  assert.ok(calls.every((event) => event.rawRefs.length === 1));

  for (const uuid of ['ambiguous-create-result-a', 'ambiguous-create-result-b']) {
    const raw = rawFor(session, uuid);
    const events = session.logicalEvents.filter((event) => (
      event.layer === 'protocol'
      && event.rawRefs.some((ref) => ref.rawId === raw.rawId)
    ));
    assert.equal(events.length, 1, `${uuid} should have one Protocol fallback`);
    assert.equal(events[0].rawRefs.length, 1, `${uuid} Protocol fallback should be Raw-local`);
  }
  assert.ok(calls.every((event) => !event.rawRefs.some((ref) => (
    ['ambiguous-create-result-a', 'ambiguous-create-result-b']
      .map((uuid) => rawFor(session, uuid).rawId)
      .includes(ref.rawId)
  ))));
  assertEveryRawReachable(session);
});

test('sparse and minimal full ultra_effort_enter rows stay independent Protocol/Raw facts', async (t) => {
  const { session } = await buildFixture(t, 'ultracode-sparse.jsonl');
  assert.equal(session.rawEvents.length, 5);
  const ultraRaws = session.rawEvents.filter((raw) => raw.payloadType === 'ultra_effort_enter');
  assert.equal(ultraRaws.length, 4);
  for (const raw of ultraRaws) {
    const events = session.logicalEvents.filter((event) => (
      event.layer === 'protocol'
      && event.kind === 'protocol'
      && event.subtype === 'ultra_effort_enter'
      && event.rawRefs.some((ref) => ref.rawId === raw.rawId)
    ));
    assert.equal(events.length, 1, `${raw.uuid} remains an independent Protocol event`);
    assert.deepEqual(events[0].rawRefs.map((ref) => ref.rawId), [raw.rawId]);
    assert.equal(events[0].tags.includes('ultracode'), false);
    assert.equal(events[0].tags.includes('ultra_effort'), false);
  }
  assert.deepEqual(rawFor(session, 'ultra-full-reminder').parsed.attachment, {
    type: 'ultra_effort_enter',
    reminderType: 'full',
  });
  assert.equal(session.logicalEvents.some((event) => event.kind === 'ultracode'), false);
  assert.equal(session.logicalEvents.some((event) => event.subtype === 'ultracode'), false);
  assert.equal(session.logicalEvents.some((event) => event.kind === 'goal' || event.kind === 'loop'), false);

  const assistant = eventForRaw(session, 'ultra-attributed-assistant', (event) => (
    event.kind === 'assistant_message'
  )).event;
  assert.equal(assistant.model, 'synthetic-ultra-model');
  assert.equal(assistant.effort, 'ultra');
  assert.deepEqual(assistant.provenance, { attributionSkill: 'synthetic-ultra-skill' });
  assertEveryRawReachable(session);
});
