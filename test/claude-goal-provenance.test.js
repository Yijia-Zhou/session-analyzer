'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  analyzerSessionId,
  buildClaudeIndex,
  readClaudeRawRecord,
} = require('../src/claude');
const { filterSessions, getTimeline } = require('../src/codex');
const { buildClaudeEventDetail } = require('../src/claude-detail');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'claude-goal-provenance');

async function readFixture(name, repoRoot) {
  const text = await fsp.readFile(path.join(FIXTURE_ROOT, name), 'utf8');
  return text.trim().split(/\r?\n/).map((line) => {
    const record = JSON.parse(line);
    if (record.cwd === '__REPO_ROOT__') record.cwd = repoRoot;
    return record;
  });
}

async function makeClaudeHome(t) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-goal-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  return claudeHome;
}

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(
    file,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
}

async function buildFixture(t, fixtureName) {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const records = await readFixture(fixtureName, repoRoot);
  const sessionId = records[0].sessionId;
  const file = path.join(claudeHome, 'projects', '-synthetic-goals', `${sessionId}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(file, records);
  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  assert.ok(session, `fixture ${fixtureName} should produce a session`);
  return { claudeHome, repoRoot, file, records, index, session, sessionId };
}

function eventForRaw(session, uuid) {
  const raw = session.rawEvents.find((candidate) => candidate.uuid === uuid);
  assert.ok(raw, `raw row ${uuid} should exist`);
  const event = session.logicalEvents.find((candidate) => (
    candidate.rawRefs.some((ref) => ref.rawId === raw.rawId)
  ));
  assert.ok(event, `raw row ${uuid} should remain reachable`);
  return { raw, event };
}

function assertEveryRawReachable(session) {
  for (const raw of session.rawEvents) {
    assert.ok(
      session.logicalEvents.some((event) => event.rawRefs.some((ref) => ref.rawId === raw.rawId)),
      `raw row ${raw.uuid || raw.rawId} should remain reachable through a Logical Event`,
    );
  }
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

test('Claude goal_status facts form one exact lifecycle while hook/error evidence stays independently visible', async (t) => {
  const fixture = await buildFixture(t, 'goal-complete.jsonl');
  const { index, session } = fixture;

  const goals = session.logicalEvents.filter((event) => event.kind === 'goal');
  assert.equal(goals.length, 1);
  const [goal] = goals;
  assert.equal(goal.subtype, 'goal_status');
  assert.equal(goal.layer, 'main');
  assert.equal(goal.status, 'success');
  assert.equal(goal.lifecycle.kind, 'goal');
  assert.equal(goal.lifecycle.phase, 'terminal');
  assert.equal(goal.lifecycle.condition, 'Run synthetic goal checks');
  assert.deepEqual(goal.lifecycle.initial, { met: false, sentinel: true });
  assert.deepEqual(goal.lifecycle.terminal, {
    met: true,
    reason: 'All synthetic checks passed',
    iterations: 3,
    tokens: 42,
    durationMs: 120,
  });
  assert.deepEqual(goal.lifecycle.validations, [
    {
      status: 'failed',
      durationMs: 12,
      toolUseId: 'goal-stop-failed',
      hasOutput: true,
      preventedContinuation: false,
      errorCount: 1,
    },
    {
      status: 'success',
      durationMs: 9,
      toolUseId: 'goal-stop-success',
      hasOutput: false,
      preventedContinuation: false,
      errorCount: 0,
    },
  ]);
  assert.equal(goal.outputStats.durationMs, 120);
  assert.deepEqual(goal.provenance, { attributionSkill: 'synthetic-goal-skill' });

  const initial = eventForRaw(session, 'goal-complete-initial').raw;
  const provenance = eventForRaw(session, 'goal-complete-final-assistant').raw;
  const terminal = eventForRaw(session, 'goal-complete-terminal').raw;
  const failedHook = eventForRaw(session, 'goal-complete-hook-failed').raw;
  const failedHookError = eventForRaw(session, 'goal-complete-hook-error').raw;
  const successfulHook = eventForRaw(session, 'goal-complete-hook-success').raw;
  assert.deepEqual(
    goal.rawRefs.map((ref) => ref.rawId),
    [initial, failedHookError, failedHook, provenance, terminal, successfulHook].map((raw) => raw.rawId),
  );
  assert.ok(goal.rawRefs.every((ref) => ref.sourceLocator?.type === 'jsonl_line'));

  const stopHook = session.logicalEvents.find((event) => (
    event.layer === 'protocol' && event.subtype === 'stop_hook_summary'
  ));
  const hookError = session.logicalEvents.find((event) => (
    event.layer === 'protocol' && event.subtype === 'hook_non_blocking_error'
  ));
  assert.ok(stopHook, 'Stop-hook summary remains an independent Protocol event');
  assert.ok(hookError, 'hook_non_blocking_error remains an independent Protocol event');
  assert.ok(stopHook.rawRefs.some((ref) => ref.rawId === failedHook.rawId));
  assert.ok(hookError.rawRefs.some((ref) => ref.rawId === failedHookError.rawId));
  assert.ok(goal.rawRefs.some((ref) => ref.rawId === failedHook.rawId));
  assert.ok(goal.rawRefs.some((ref) => ref.rawId === failedHookError.rawId));

  const rawDetail = buildClaudeEventDetail(session, failedHookError.rawId, 'raw', { locale: 'en' });
  assert.match(JSON.stringify(rawDetail.inspectorSections), /synthetic hook failed/);
  const readback = await readClaudeRawRecord(index, session, failedHookError);
  assert.equal(readback.parsed.attachment.type, 'hook_non_blocking_error');
  assert.equal(readback.parsed.attachment.exitCode, 1);
  assertEveryRawReachable(session);
});

test('Claude incomplete goals stay in_progress and unsafe or prose-only sequences fail closed', async (t) => {
  const incomplete = await buildFixture(t, 'goal-incomplete.jsonl');
  const incompleteGoals = incomplete.session.logicalEvents.filter((event) => event.kind === 'goal');
  assert.equal(incompleteGoals.length, 1);
  assert.equal(incompleteGoals[0].status, 'in_progress');
  assert.equal(incompleteGoals[0].lifecycle.kind, 'goal');
  assert.equal(incompleteGoals[0].lifecycle.phase, 'active');
  assert.equal(incompleteGoals[0].lifecycle.terminal, null);
  assert.deepEqual(incompleteGoals[0].lifecycle.initial, { met: false, sentinel: true });
  assert.deepEqual(incompleteGoals[0].lifecycle.validations, []);
  assertEveryRawReachable(incomplete.session);

  const invalid = await buildFixture(t, 'goal-invalid.jsonl');
  const invalidGoals = invalid.session.logicalEvents.filter((event) => event.kind === 'goal');
  assert.equal(invalidGoals.length, 0, 'malformed, duplicate, regressive, terminal-only, and prose evidence cannot complete a goal');
  assert.ok(invalid.session.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.subtype === 'goal_status'
  )));
  assert.ok(invalid.session.logicalEvents.some((event) => (
    event.kind === 'assistant_message' && event.searchText.includes('met true')
  )));
  assertEveryRawReachable(invalid.session);
});

test('Claude assistant attributionSkill becomes one reusable provenance fact across blocks, search, timeline, and detail', async (t) => {
  const fixture = await buildFixture(t, 'provenance-valid.jsonl');
  const { index, session } = fixture;
  const validRaw = session.rawEvents.find((raw) => raw.uuid === 'provenance-valid-assistant');
  assert.equal(validRaw.attributionSkill, 'synthetic-skill');

  const projected = session.logicalEvents.filter((event) => (
    event.rawRefs.some((ref) => ref.rawId === validRaw.rawId)
  ));
  assert.deepEqual(
    projected.map((event) => event.kind).sort(),
    ['assistant_message', 'command', 'reasoning'].sort(),
  );
  for (const event of projected) {
    assert.deepEqual(event.provenance, { attributionSkill: 'synthetic-skill' });
    assert.ok(event.searchText.includes('synthetic-skill'));
  }

  const timeline = getTimeline(index, session.id, timelineFilters('synthetic-skill'));
  assert.equal(timeline.searchEventCount, 3);
  assert.equal(
    timeline.events.filter((event) => event.provenance?.attributionSkill === 'synthetic-skill').length,
    3,
  );
  const search = filterSessions(index, { layer: 'main', q: 'synthetic-skill', locale: 'en' });
  assert.equal(search.total, 1);
  assert.equal(search.sessions[0].searchMatch.eventCount, 3);

  const assistant = projected.find((event) => event.kind === 'assistant_message');
  const detail = buildClaudeEventDetail(session, assistant.id, 'main', { locale: 'en' });
  assert.deepEqual(detail.meta.provenance, { attributionSkill: 'synthetic-skill' });

  for (const [uuid, original] of [
    ['provenance-padded-assistant', ' padded-skill '],
    ['provenance-empty-assistant', ''],
    ['provenance-nonstring-assistant', { name: 'not-a-string' }],
  ]) {
    const { raw, event } = eventForRaw(session, uuid);
    assert.equal(raw.attributionSkill, '');
    assert.deepEqual(raw.parsed.attributionSkill, original);
    assert.equal(event.provenance, undefined);
    assert.doesNotMatch(event.searchText, /padded-skill|not-a-string/);
  }
  const other = eventForRaw(session, 'provenance-other-assistant').event;
  assert.deepEqual(other.provenance, { attributionSkill: 'other-provenance-skill' });
  assertEveryRawReachable(session);
});

test('Claude goal append invalidates stale lifecycle projection and reused indexing converges with cold indexing', async (t) => {
  const fixture = await buildFixture(t, 'goal-incomplete.jsonl');
  const terminal = {
    type: 'attachment',
    sessionId: fixture.sessionId,
    cwd: fixture.repoRoot,
    version: '2.1.220',
    uuid: 'goal-incomplete-terminal',
    parentUuid: 'goal-incomplete-initial',
    timestamp: '2026-08-10T10:10:02.000Z',
    attachment: {
      type: 'goal_status',
      condition: 'Keep synthetic goal pending',
      met: true,
      reason: 'Synthetic goal reached its terminal fact',
      iterations: 2,
      tokens: 17,
      durationMs: 64,
    },
  };
  const initialIndex = fixture.index;
  assert.equal(initialIndex.sessionsById.get(analyzerSessionId(fixture.sessionId)).logicalEvents
    .find((event) => event.kind === 'goal').status, 'in_progress');

  await fsp.appendFile(fixture.file, `${JSON.stringify(terminal)}\n`, 'utf8');
  const changedAt = new Date('2026-08-10T10:10:03.000Z');
  await fsp.utimes(fixture.file, changedAt, changedAt);
  const changed = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.claudeHome,
    previousIndex: initialIndex,
  });
  const changedSession = changed.sessionsById.get(analyzerSessionId(fixture.sessionId));
  assert.equal(changedSession.logicalEvents.find((event) => event.kind === 'goal').status, 'success');
  assert.equal(changed.totals.reusedFileCount, 0, 'appending a terminal fact must invalidate the stale session');

  const reused = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.claudeHome,
    previousIndex: changed,
  });
  const cold = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.claudeHome,
  });
  const reusedSession = reused.sessionsById.get(analyzerSessionId(fixture.sessionId));
  const coldSession = cold.sessionsById.get(analyzerSessionId(fixture.sessionId));
  assert.equal(reused.totals.reusedFileCount, 1);
  assert.deepEqual(reusedSession.logicalEvents, coldSession.logicalEvents);
  assert.deepEqual(reusedSession.rawEvents, coldSession.rawEvents);
  assert.deepEqual(reusedSession.counts, coldSession.counts);
  assertEveryRawReachable(reusedSession);
});
