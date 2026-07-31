'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  goalResponseFromValue,
  goalSnapshotFromGoal,
  goalSnapshotFromRaw,
  goalSnapshotSignature,
  goalSnapshotTransition,
  normalizeGoalStatus,
} = require('../src/codex-goal');

function goalRaw(goal, payload = {}) {
  return {
    sessionId: 'session-1',
    recordType: 'event_msg',
    payloadType: 'thread_goal_updated',
    parsed: {
      payload: {
        type: 'thread_goal_updated',
        threadId: 'thread-1',
        goal,
        ...payload,
      },
    },
  };
}

test('goal snapshots normalize current and legacy field spellings', () => {
  const current = goalSnapshotFromRaw(goalRaw({
    objective: 'Ship the feature',
    status: 'active',
    tokenBudget: 2000,
    tokensUsed: 25,
    timeUsedSeconds: 8,
    createdAt: 100,
    updatedAt: 108,
  }));
  const legacy = goalSnapshotFromGoal({
    thread_id: 'thread-legacy',
    objective: 'Keep compatibility',
    status: 'blocked',
    token_budget: 3000,
    tokens_used: 50,
    time_used_seconds: 12,
    created_at: 200,
    updated_at: 212,
  });

  assert.deepEqual(
    {
      threadId: current.threadId,
      status: current.status,
      hasTokenBudget: current.hasTokenBudget,
      tokenBudget: current.tokenBudget,
      tokensUsed: current.tokensUsed,
      timeUsedSeconds: current.timeUsedSeconds,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    },
    {
      threadId: 'thread-1',
      status: 'active',
      hasTokenBudget: true,
      tokenBudget: 2000,
      tokensUsed: 25,
      timeUsedSeconds: 8,
      createdAt: 100,
      updatedAt: 108,
    },
  );
  assert.equal(legacy.threadId, 'thread-legacy');
  assert.equal(legacy.tokenBudget, 3000);
  assert.equal(legacy.updatedAt, 212);
});

test('goal status and response envelopes normalize semantic aliases', () => {
  const response = goalResponseFromValue({
    goal: {
      thread_id: 'thread-legacy',
      objective: 'Keep compatibility',
      status: 'budgetLimited',
      token_budget: null,
      tokens_used: 50,
      time_used_seconds: 12,
      created_at: 200,
      updated_at: 212,
    },
    remaining_tokens: null,
    completion_budget_report: { final_token_usage: 50 },
  });

  assert.equal(normalizeGoalStatus('usageLimited'), 'usage_limited');
  assert.equal(normalizeGoalStatus('budget-limited'), 'budget_limited');
  assert.equal(normalizeGoalStatus('completed'), 'complete');
  assert.equal(response.snapshot.status, 'budget_limited');
  assert.equal(response.snapshot.hasTokenBudget, true);
  assert.equal(response.snapshot.tokenBudget, null);
  assert.equal(response.hasRemainingTokens, true);
  assert.equal(response.remainingTokens, null);
  assert.deepEqual(response.completionBudgetReport, { final_token_usage: 50 });
});

test('goal snapshot transitions ignore accounting-only heartbeats', () => {
  const created = goalSnapshotFromRaw(goalRaw({
    threadId: 'thread-1',
    objective: 'Ship the feature',
    status: 'active',
    tokenBudget: 2000,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 100,
    updatedAt: 100,
  }));
  const heartbeat = goalSnapshotFromRaw(goalRaw({
    threadId: 'thread-1',
    objective: 'Ship the feature',
    status: 'active',
    tokenBudget: 2000,
    tokensUsed: 500,
    timeUsedSeconds: 30,
    createdAt: 100,
    updatedAt: 130,
  }));
  const blocked = goalSnapshotFromRaw(goalRaw({
    threadId: 'thread-1',
    objective: 'Ship the feature',
    status: 'blocked',
    tokenBudget: 2000,
    tokensUsed: 500,
    timeUsedSeconds: 30,
    createdAt: 100,
    updatedAt: 131,
  }));

  assert.equal(goalSnapshotTransition(null, created), 'created');
  assert.equal(goalSnapshotTransition(created, heartbeat), '');
  assert.equal(goalSnapshotTransition(heartbeat, blocked), 'updated');
});

test('goal snapshot signatures require explicit thread and update identities', () => {
  const snapshot = goalSnapshotFromGoal({
    threadId: 'thread-1',
    objective: 'Ship the feature',
    status: 'complete',
    updatedAt: 500,
  });
  const same = goalSnapshotFromGoal({
    threadId: 'thread-1',
    objective: 'Ship the feature',
    status: 'complete',
    updatedAt: 500,
    tokensUsed: 1000,
  });

  assert.equal(goalSnapshotSignature(snapshot), goalSnapshotSignature(same));
  assert.equal(goalSnapshotSignature(goalSnapshotFromGoal({ status: 'active', updatedAt: 500 })), '');
  assert.equal(goalSnapshotSignature(goalSnapshotFromGoal({ threadId: 'thread-1', status: 'active' })), '');
});
