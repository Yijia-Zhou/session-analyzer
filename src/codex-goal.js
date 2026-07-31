'use strict';

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function comparableValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function firstNonEmptyText(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null && String(candidate) !== '');
  return value === undefined ? '' : String(value);
}

function aliasedOwnValue(value, camelKey, snakeKey) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { present: false, value: undefined };
  if (Object.hasOwn(value, camelKey)) return { present: true, value: value[camelKey] };
  if (Object.hasOwn(value, snakeKey)) return { present: true, value: value[snakeKey] };
  return { present: false, value: undefined };
}

function normalizeGoalStatus(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  if (normalized === 'budgetlimited') return 'budget_limited';
  if (normalized === 'usagelimited') return 'usage_limited';
  if (normalized === 'completed') return 'complete';
  return normalized;
}

function goalSnapshotFromGoal(goal, context = {}) {
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) return null;
  const tokenBudget = aliasedOwnValue(goal, 'tokenBudget', 'token_budget');
  const tokensUsed = aliasedOwnValue(goal, 'tokensUsed', 'tokens_used');
  const timeUsedSeconds = aliasedOwnValue(goal, 'timeUsedSeconds', 'time_used_seconds');
  const createdAt = aliasedOwnValue(goal, 'createdAt', 'created_at');
  const updatedAt = aliasedOwnValue(goal, 'updatedAt', 'updated_at');
  const threadId = firstNonEmptyText(
    goal.threadId,
    goal.thread_id,
    context.threadId,
    context.thread_id,
  );
  return {
    goal,
    threadId,
    identityKey: threadId || comparableValue(context.sessionId),
    objective: firstDefined(goal.objective, ''),
    objectiveKey: comparableValue(goal.objective),
    status: normalizeGoalStatus(goal.status),
    hasTokenBudget: tokenBudget.present,
    tokenBudget: tokenBudget.value,
    tokenBudgetKey: comparableValue(tokenBudget.value),
    tokensUsed: tokensUsed.value,
    timeUsedSeconds: timeUsedSeconds.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  };
}

function goalResponseFromValue(responseValue, context = {}) {
  const source = responseValue && typeof responseValue === 'object' && !Array.isArray(responseValue)
    ? responseValue
    : {};
  const remainingTokens = aliasedOwnValue(source, 'remainingTokens', 'remaining_tokens');
  const completionBudgetReport = aliasedOwnValue(source, 'completionBudgetReport', 'completion_budget_report');
  return {
    snapshot: goalSnapshotFromGoal(source.goal, context),
    hasRemainingTokens: remainingTokens.present,
    remainingTokens: remainingTokens.value,
    hasCompletionBudgetReport: completionBudgetReport.present,
    completionBudgetReport: completionBudgetReport.value,
  };
}

function goalSnapshotFromRaw(raw) {
  if (raw?.recordType !== 'event_msg' || raw.payloadType !== 'thread_goal_updated') return null;
  const payload = raw.parsed?.payload || {};
  return goalSnapshotFromGoal(payload.goal, {
    threadId: firstNonEmptyText(payload.threadId, payload.thread_id),
    sessionId: raw.sessionId,
  });
}

function goalSnapshotTransition(previous, current) {
  if (!current) return '';
  if (!previous) return 'created';
  if (previous.createdAt != null && current.createdAt != null
      && comparableValue(previous.createdAt) !== comparableValue(current.createdAt)) {
    return 'created';
  }
  if (previous.objectiveKey !== current.objectiveKey
      || previous.status !== current.status
      || previous.tokenBudgetKey !== current.tokenBudgetKey) {
    return 'updated';
  }
  return '';
}

function goalSnapshotSignature(snapshot) {
  if (!snapshot?.threadId || snapshot.updatedAt === undefined || snapshot.updatedAt === null || snapshot.updatedAt === '') return '';
  return JSON.stringify([
    snapshot.threadId,
    comparableValue(snapshot.updatedAt),
    snapshot.status,
    snapshot.objectiveKey,
  ]);
}

module.exports = {
  goalResponseFromValue,
  goalSnapshotFromGoal,
  goalSnapshotFromRaw,
  goalSnapshotSignature,
  goalSnapshotTransition,
  normalizeGoalStatus,
};
