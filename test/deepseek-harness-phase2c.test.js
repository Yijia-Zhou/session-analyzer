'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildDeepSeekIndex,
  deepSeekAdapter,
} = require('../src/deepseek-harness');
const {
  buildEventDetailForSession,
  materializeSessionForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-phase2c', 'sessions');
const RETRY_REPO = '/synthetic/deepseek-phase2c-retry';
const GOAL_REPO = '/synthetic/deepseek-phase2c-goal';

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

function rawSeqs(event) {
  return event.rawRefs.map((ref) => ref.sourceLocator.seq);
}

async function makeSyntheticFixture(t, id, records) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2c-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2c-home-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  t.after(() => fsp.rm(repoRoot, { recursive: true, force: true }));
  const sessionDir = path.join(sourceHome, '--synthetic-project--', id);
  await fsp.mkdir(sessionDir, { recursive: true });
  const header = {
    type: 'session', version: 0, id, createdAt: 1, cwd: repoRoot, delegationDepth: 0,
  };
  await fsp.writeFile(
    path.join(sessionDir, 'session.jsonl'),
    `${[header, ...records].map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );
  return { sourceHome, repoRoot };
}

test('M1 retry lifecycle groups exact durable identity without inventing request success', async () => {
  const { index, indexed, materialized } = await buildFor(RETRY_REPO);
  const retries = materialized.logicalEvents.filter((event) => event.subtype === 'llm/retry-lifecycle');
  assert.equal(retries.length, 4);
  assert.deepEqual(retries.map((event) => event.status), ['started', 'scheduled', 'started', 'started']);
  assert.ok(retries.every((event) => event.status !== 'success' && event.layer === 'protocol'));
  assert.deepEqual(retries.map(rawSeqs), [[3, 4], [7], [11, 12], [16, 17, 18, 19]]);

  const realStyle = retries[0];
  assert.equal(realStyle.retryLifecycle.retryId, 'retry-real-style');
  assert.equal(realStyle.retryLifecycle.provider, 'synthetic-normal');
  assert.equal(realStyle.retryLifecycle.mode, 'normal');
  assert.deepEqual(realStyle.retryLifecycle.attempts, [{
    retry: 1,
    maxRetries: 2,
    delayMs: 500,
    failure: { message: 'synthetic transport interruption', code: 'TRANSPORT' },
    state: 'started',
    scheduledSeq: 3,
    startedSeq: 4,
  }]);

  const scheduledOnly = retries[1];
  assert.equal(scheduledOnly.retryLifecycle.attempts[0].state, 'scheduled');
  assert.equal(scheduledOnly.severity, 'warning');
  const always = retries[2];
  assert.equal(always.retryLifecycle.mode, 'always');
  assert.equal(Object.hasOwn(always.retryLifecycle.attempts[0], 'maxRetries'), false);
  assert.deepEqual(always.retryLifecycle.attempts[0].failure, {
    message: 'synthetic provider throttle',
    code: 'RATE_LIMIT',
    status: 429,
    providerRetryAfterMs: 1000,
    requestId: 'synthetic-request',
  });
  const numbered = retries[3];
  assert.deepEqual(numbered.retryLifecycle.attempts.map((attempt) => attempt.retry), [1, 2]);
  assert.deepEqual(numbered.retryLifecycle.attempts.map((attempt) => attempt.delayMs), [500, 1000]);

  const owned = new Set();
  for (const event of retries) {
    for (const ref of event.rawRefs) {
      assert.equal(owned.has(ref.rawId), false, `retry Raw row is multiply owned: ${ref.rawId}`);
      owned.add(ref.rawId);
    }
  }
  assert.equal(owned.size, 9);
  assert.equal(indexed.counts.messages, 0);
  assert.equal(indexed.counts.toolCalls, 0);
  assert.equal(indexed.counts.protocol, 17);
  assert.deepEqual(
    materialized.analysis.protocolStats.find((item) => item.name === 'llm/retry-lifecycle'),
    { name: 'llm/retry-lifecycle', count: 4 },
  );
  assert.equal(materialized.analysis.protocolStats.some((item) => item.name === 'llm/retry'), false);
  assert.equal(materialized.analysis.protocolStats.some((item) => item.name === 'llm/retry-started'), false);

  const detail = await buildEventDetailForSession(index, materialized, always.id, 'protocol');
  validateStructuredLogicalDetailDto(detail);
  assert.ok(detail.timelineSections.some((section) => (
    section.purpose === 'result' && section.type === 'notice' && section.text.includes('RATE_LIMIT')
  )));
  assert.ok(detail.timelineSections.some((section) => (
    section.purpose === 'context' && section.type === 'kv'
  )));
  assert.ok(detail.inspectorSections.some((section) => (
    section.purpose === 'traceability'
    && section.entries?.some((entry) => entry.key === 'Retry ID' && entry.value === 'retry-always')
  )));
  const scheduledDetail = await buildEventDetailForSession(index, materialized, scheduledOnly.id, 'protocol');
  validateStructuredLogicalDetailDto(scheduledDetail);
  assert.ok(scheduledDetail.inspectorSections.some((section) => (
    section.type === 'notice' && section.title === 'Retry start not observed'
  )));

  await assertProjectionParity(index, indexed, materialized);
});

test('M1 malformed or cross-policy retry identity fails closed row by row', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'malformed-retry', [
    { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 3, data: { turn: 1, step: 1 } },
    {
      type: 'request/header', seq: 2, time: 4,
      data: { header: { config: { provider: 'provider-a', model: 'model' } }, reason: 'initial' },
    },
    {
      type: 'llm/retry', seq: 3, time: 5,
      data: {
        retryId: 'conflicted-retry', turn: 1, step: 1, provider: 'provider-a', mode: 'normal',
        policyKey: 'policy-a', retry: 1, maxRetries: 2, delayMs: 10,
        failure: { message: 'synthetic failure a', code: 'TRANSPORT' },
      },
    },
    {
      type: 'request/header', seq: 4, time: 6,
      data: { header: { config: { provider: 'provider-b', model: 'model' } }, reason: 'change' },
    },
    {
      type: 'llm/retry', seq: 5, time: 7,
      data: {
        retryId: 'conflicted-retry', turn: 1, step: 1, provider: 'provider-b', mode: 'normal',
        policyKey: 'policy-b', retry: 1, maxRetries: 2, delayMs: 20,
        failure: { message: 'synthetic failure b', code: 'SERVER' },
      },
    },
    {
      type: 'llm/retry-started', seq: 6, time: 8,
      data: { retryId: 'conflicted-retry', turn: 1, step: 1, retry: 1 },
    },
    { type: 'step/end', seq: 7, time: 9, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 8, time: 10, data: { turn: 1, reason: { kind: 'completed' } } },
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  assert.equal(materialized.logicalEvents.some((event) => event.subtype === 'llm/retry-lifecycle'), false);
  const fallbacks = materialized.logicalEvents.filter((event) => (
    event.label === 'Uncorrelated LLM retry lifecycle'
  ));
  assert.equal(fallbacks.length, 3);
  assert.deepEqual(fallbacks.map(rawSeqs), [[3], [5], [6]]);
  assert.ok(fallbacks.every((event) => event.layer === 'protocol' && event.status === 'incomplete'));
});

test('M1 accepted snapshot rejects stale retry Materialized, Detail, and Raw reads', async (t) => {
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2c-fresh-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  const source = path.join(
    FIXTURE_ROOT,
    '--synthetic-deepseek-phase2c-retry--',
    'retry',
    'session.jsonl',
  );
  const target = path.join(sourceHome, '--copy--', 'retry', 'session.jsonl');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot: RETRY_REPO });
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  const retry = materialized.logicalEvents.find((event) => event.subtype === 'llm/retry-lifecycle');
  const raw = materialized.rawEvents.find((candidate) => candidate.rawId === retry.rawRefs[0].rawId);
  await fsp.appendFile(target, `${JSON.stringify({
    type: 'session/end-seed', seq: 22, time: 24, data: {},
  })}\n`, 'utf8');
  await assert.rejects(
    materializeSessionForIndex(index, indexed),
    (error) => error?.code === 'INDEXED_SOURCE_STALE',
  );
  await assert.rejects(
    buildEventDetailForSession(index, materialized, retry.id, 'protocol'),
    (error) => error?.code === 'INDEXED_SOURCE_STALE',
  );
  await assert.rejects(
    deepSeekAdapter.readRawRecord(index, materialized, raw),
    (error) => error?.code === 'INDEXED_SOURCE_STALE',
  );
});

test('M2 durable Goal state uses independent Main events and never invents tool-call ownership or activation', async () => {
  const { index, indexed, materialized } = await buildFor(GOAL_REPO);
  const goals = materialized.logicalEvents.filter((event) => event.kind === 'goal');
  const continuation = materialized.logicalEvents.find((event) => event.subtype === 'goal/continuation');
  const tools = materialized.logicalEvents.filter((event) => (
    event.layer === 'main' && ['create_goal', 'update_goal'].includes(event.toolName)
  ));
  assert.equal(goals.length, 8);
  assert.equal(tools.length, 2);
  assert.deepEqual(
    goals.map((event) => event.goalChange.operation),
    ['create', 'edit', 'pause', 'resume', 'block', 'resume', 'complete', 'clear'],
  );
  assert.deepEqual(
    goals.map((event) => event.status),
    ['active', 'active', 'paused', 'active', 'blocked', 'active', 'complete', 'cleared'],
  );
  assert.deepEqual(
    goals.map((event) => (
      event.goalChange.operation === 'clear'
        ? event.goalChange.cleared.revision
        : event.goalChange.goal.revision
    )),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.ok(goals.every((event) => event.rawRefs.length === 1 && !event.toolName));
  assert.deepEqual(goals.map(rawSeqs), [[3], [6], [7], [8], [9], [10], [12], [14]]);
  assert.deepEqual(tools.map(rawSeqs), [[2, 4], [11, 13]]);
  const stateRawIds = new Set(goals.flatMap((event) => event.rawRefs.map((ref) => ref.rawId)));
  assert.ok(tools.every((event) => event.rawRefs.every((ref) => !stateRawIds.has(ref.rawId))));

  assert.ok(continuation);
  assert.equal(continuation.layer, 'protocol');
  assert.equal(continuation.role, 'system');
  assert.deepEqual(continuation.goalContinuation, {
    kind: 'goal',
    goalId: 'synthetic-goal',
    revision: 1,
    round: 1,
    text: 'Continue the synthetic objective for round one.',
  });
  assert.equal(materialized.logicalEvents.some((event) => (
    event.kind === 'user_message' && event.rawRefs.some((ref) => ref.sourceLocator.seq === 5)
  )), false);
  assert.equal(indexed.counts.userMessages, 0);
  assert.equal(indexed.counts.messages, 0);
  assert.equal(indexed.counts.toolCalls, 2);
  assert.equal(indexed.counts.issueEvents, 1);
  assert.equal(goals.at(-1).goalChange.operation, 'clear');
  assert.deepEqual(goals.at(-1).goalChange.cleared, { id: 'synthetic-goal', revision: 8 });
  assert.equal(goals.some((event) => Object.hasOwn(event.goalChange, 'activation')), false);

  const blocked = goals.find((event) => event.goalChange.operation === 'block');
  assert.deepEqual(blocked.goalChange.goal.blockedReason, {
    code: 'synthetic-block',
    message: 'Synthetic external dependency is unavailable.',
  });
  const blockedDetail = await buildEventDetailForSession(index, materialized, blocked.id, 'main');
  validateStructuredLogicalDetailDto(blockedDetail);
  assert.ok(blockedDetail.timelineSections.some((section) => (
    section.type === 'kv' && section.title === 'Blocked reason'
  )));
  assert.ok(blockedDetail.inspectorSections.some((section) => (
    section.type === 'notice' && section.title === 'Activation is not durable'
  )));
  const clear = goals.at(-1);
  const clearDetail = await buildEventDetailForSession(index, materialized, clear.id, 'main');
  validateStructuredLogicalDetailDto(clearDetail);
  assert.ok(clearDetail.timelineSections.some((section) => (
    section.type === 'notice' && section.title === 'Goal cleared'
  )));
  const continuationDetail = await buildEventDetailForSession(index, materialized, continuation.id, 'protocol');
  validateStructuredLogicalDetailDto(continuationDetail);
  assert.ok(continuationDetail.inspectorSections.some((section) => (
    section.type === 'notice' && section.title === 'Non-human message provenance'
  )));
  await assertProjectionParity(index, indexed, materialized);
});

test('M2 malformed Goal changes and continuation attribution fail closed without poisoning later valid state', async (t) => {
  const baseGoal = (revision, phase) => ({
    id: 'goal-safe-fold', revision, objective: 'Synthetic safe fold', phase, maxGoalRounds: 3,
  });
  const fixture = await makeSyntheticFixture(t, 'malformed-goal', [
    { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
    {
      type: 'goal/change', seq: 1, time: 3,
      data: {
        kind: 'goal/change', version: 2, operation: 'create', goal: baseGoal(1, 'active'),
        roundsStarted: 0, createdAt: 10, updatedAt: 10,
      },
    },
    {
      type: 'goal/change', seq: 2, time: 4,
      data: {
        kind: 'goal/change', version: 1, operation: 'create', goal: baseGoal(1, 'active'),
        roundsStarted: 0, createdAt: 10, updatedAt: 10,
      },
    },
    {
      type: 'user/message', seq: 3, time: 5, surfaceOp: 'append',
      data: {
        source: { kind: 'goal', goalId: 'goal-safe-fold', revision: 1, round: 2 },
        content: [{ type: 'text', text: 'Invalid synthetic skipped round.' }],
      },
    },
    {
      type: 'user/message', seq: 4, time: 6, surfaceOp: 'append',
      data: {
        source: { kind: 'goal', goalId: 'goal-safe-fold', revision: 1, round: 1 },
        content: [{ type: 'text', text: 'Valid synthetic first round.' }],
      },
    },
    {
      type: 'goal/change', seq: 5, time: 7,
      data: {
        kind: 'goal/change', version: 1, operation: 'edit', goal: baseGoal(3, 'active'),
        roundsStarted: 1, createdAt: 10, updatedAt: 11,
      },
    },
    {
      type: 'goal/change', seq: 6, time: 8,
      data: {
        kind: 'goal/change', version: 1, operation: 'pause', goal: baseGoal(2, 'paused'),
        roundsStarted: 1, createdAt: 10, updatedAt: 11,
      },
    },
    { type: 'turn/end', seq: 7, time: 9, data: { turn: 1, reason: { kind: 'completed' } } },
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const goals = materialized.logicalEvents.filter((event) => event.kind === 'goal');
  assert.deepEqual(goals.map((event) => event.goalChange.operation), ['create', 'pause']);
  assert.deepEqual(goals.map((event) => event.goalChange.goal.revision), [1, 2]);
  assert.equal(materialized.logicalEvents.filter((event) => (
    event.label === 'Unmodeled Goal state change'
  )).length, 2);
  assert.equal(materialized.logicalEvents.filter((event) => (
    event.subtype === 'goal/continuation-invalid'
  )).length, 1);
  assert.equal(materialized.logicalEvents.filter((event) => (
    event.subtype === 'goal/continuation'
  )).length, 1);
  const current = goals.at(-1).goalChange;
  assert.deepEqual(current, {
    kind: 'goal/change',
    version: 1,
    operation: 'pause',
    goal: baseGoal(2, 'paused'),
    roundsStarted: 1,
    createdAt: 10,
    updatedAt: 11,
  });
  assert.equal(Object.hasOwn(current.goal, 'activation'), false);
});
