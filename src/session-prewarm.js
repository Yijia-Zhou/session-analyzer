'use strict';

const { estimateMaterializedSessionBytes } = require('./materialized-session-owner');
const { notifyMaterializationObserver } = require('./materialization-observer');

const MIB = 1024 * 1024;
const DEFAULT_SESSION_PREWARM_POLICY = Object.freeze({
  delayMs: 150,
  candidateCap: 2,
  scanLimit: 8,
  budgetBytes: 96 * MIB,
  individualBytes: 48 * MIB,
});

function observePrewarmPolicy(kind) {
  notifyMaterializationObserver({
    phase: `session_prewarm_${kind}`,
    state: 'event',
  });
}

function integerOption(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function normalizeSessionPrewarmPolicy(options = {}) {
  const policy = {
    delayMs: options.delayMs ?? DEFAULT_SESSION_PREWARM_POLICY.delayMs,
    candidateCap: options.candidateCap ?? DEFAULT_SESSION_PREWARM_POLICY.candidateCap,
    scanLimit: options.scanLimit ?? DEFAULT_SESSION_PREWARM_POLICY.scanLimit,
    budgetBytes: options.budgetBytes ?? DEFAULT_SESSION_PREWARM_POLICY.budgetBytes,
    individualBytes: options.individualBytes ?? DEFAULT_SESSION_PREWARM_POLICY.individualBytes,
  };
  integerOption(policy.delayMs, 'Session prewarm delayMs', 0, 5_000);
  integerOption(policy.candidateCap, 'Session prewarm candidateCap', 1, 3);
  integerOption(policy.scanLimit, 'Session prewarm scanLimit', policy.candidateCap, 64);
  integerOption(policy.budgetBytes, 'Session prewarm budgetBytes', 1, Number.MAX_SAFE_INTEGER);
  integerOption(policy.individualBytes, 'Session prewarm individualBytes', 1, policy.budgetBytes);
  return Object.freeze(policy);
}

function orderedPrewarmCandidates(index, policyOptions = {}) {
  const policy = normalizeSessionPrewarmPolicy(policyOptions);
  return [...(index?.sessions || [])]
    .sort((left, right) => (
      String(right.updatedAt || right.startedAt).localeCompare(
        String(left.updatedAt || left.startedAt),
      )
    ))
    .slice(0, policy.scanLimit);
}

function emptyResult(status = 'completed') {
  return {
    status,
    consideredCount: 0,
    attemptedCount: 0,
    completedCount: 0,
    promotedCount: 0,
    preemptedCount: 0,
    failedCount: 0,
  };
}

function isRetired(lease) {
  return !lease
    || lease.retirementController?.signal.aborted
    || lease.materializedSessionOwner?.retired;
}

function yieldToForeground() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function runBoundedSessionPrewarm(lease, materialize, options = {}) {
  if (!lease?.index || !lease.materializedSessionOwner || typeof materialize !== 'function') {
    throw new TypeError('Bounded Session prewarm requires a revision lease and materializer');
  }
  const policy = normalizeSessionPrewarmPolicy(options);
  const owner = lease.materializedSessionOwner;
  const scheduler = owner.scheduler;
  const signal = lease.retirementController.signal;
  const result = emptyResult();
  const yieldOperation = typeof options.yieldToForeground === 'function'
    ? options.yieldToForeground
    : yieldToForeground;

  if (isRetired(lease)) return emptyResult('retired');
  observePrewarmPolicy('policy_started');
  try {
    for (const indexedSession of orderedPrewarmCandidates(lease.index, policy)) {
      if (result.attemptedCount >= policy.candidateCap || isRetired(lease)) break;
      result.consideredCount += 1;
      if (owner.estimatedMaterializedBytes >= policy.budgetBytes) {
        owner.recordPrewarmSkip('budget');
        break;
      }
      const sessionId = String(indexedSession?.id || '');
      if (owner.cache.has(sessionId)) {
        owner.recordPrewarmSkip('cached');
        continue;
      }
      const estimatedBytes = estimateMaterializedSessionBytes(indexedSession);
      if (estimatedBytes > policy.individualBytes) {
        owner.recordPrewarmSkip('size');
        continue;
      }
      if (owner.estimatedMaterializedBytes + estimatedBytes > policy.budgetBytes) {
        owner.recordPrewarmSkip('budget');
        continue;
      }

      let outcome;
      while (!isRetired(lease)) {
        await scheduler.whenIdle(signal);
        if (isRetired(lease)) break;
        if (owner.estimatedMaterializedBytes >= policy.budgetBytes) {
          owner.recordPrewarmSkip('budget');
          outcome = { status: 'skipped-budget' };
          break;
        }
        if (owner.cache.has(sessionId)) {
          owner.recordPrewarmSkip('cached');
          outcome = { status: 'cache-hit' };
          break;
        }
        if (owner.estimatedMaterializedBytes + estimatedBytes > policy.budgetBytes) {
          owner.recordPrewarmSkip('budget');
          outcome = { status: 'skipped-budget' };
          break;
        }
        outcome = await owner.prewarm(indexedSession, ({ signal: jobSignal }) => materialize(
          indexedSession,
          {
            index: lease.index,
            indexRevision: lease.indexRevision,
            signal: jobSignal,
          },
        ));
        if (outcome.status !== 'skipped-busy') break;
      }
      if (isRetired(lease)) break;
      if (!outcome || ['cache-hit', 'skipped-budget'].includes(outcome.status)) continue;

      result.attemptedCount += 1;
      if (outcome.status === 'completed') result.completedCount += 1;
      else if (outcome.status === 'promoted') result.promotedCount += 1;
      else if (outcome.status === 'preempted') result.preemptedCount += 1;
      else if (outcome.status === 'failed') result.failedCount += 1;
      else if (outcome.status === 'retired') break;
      await yieldOperation();
    }
  } catch (error) {
    if (!isRetired(lease) && error?.code !== 'INDEX_REVISION_RETIRED') throw error;
  }

  if (isRetired(lease)) {
    result.status = 'retired';
    observePrewarmPolicy('policy_retired');
  } else {
    observePrewarmPolicy('policy_completed');
  }
  return result;
}

function cancelBoundedSessionPrewarm(lease) {
  const scheduled = lease?.prewarmSchedule;
  if (!scheduled || scheduled.cancelled || scheduled.settled) return;
  scheduled.cancelled = true;
  if (scheduled.timer !== null) {
    scheduled.clearTimer(scheduled.timer);
    scheduled.timer = null;
  }
  observePrewarmPolicy('wakeup_cancelled');
}

function scheduleBoundedSessionPrewarm(lease, materialize, options = {}) {
  if (!lease?.index || !lease.materializedSessionOwner || typeof materialize !== 'function') {
    throw new TypeError('Scheduled Session prewarm requires a revision lease and materializer');
  }
  const policy = normalizeSessionPrewarmPolicy(options);
  cancelBoundedSessionPrewarm(lease);
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;
  const scheduled = {
    cancelled: false,
    timer: null,
    promise: null,
    settled: false,
    clearTimer,
  };
  const wake = async () => {
    scheduled.timer = null;
    if (scheduled.cancelled || isRetired(lease)) return emptyResult('retired');
    scheduled.promise = runBoundedSessionPrewarm(lease, materialize, {
      ...options,
      ...policy,
    }).catch((error) => {
      observePrewarmPolicy('policy_failed');
      return {
        ...emptyResult('failed'),
        errorCode: String(error?.code || error?.name || 'ERROR'),
      };
    }).finally(() => {
      scheduled.settled = true;
    });
    return scheduled.promise;
  };
  scheduled.timer = setTimer(wake, policy.delayMs);
  scheduled.timer?.unref?.();
  lease.prewarmSchedule = scheduled;
  observePrewarmPolicy('wakeup_scheduled');
  return scheduled;
}

module.exports = {
  DEFAULT_SESSION_PREWARM_POLICY,
  cancelBoundedSessionPrewarm,
  normalizeSessionPrewarmPolicy,
  orderedPrewarmCandidates,
  runBoundedSessionPrewarm,
  scheduleBoundedSessionPrewarm,
};
