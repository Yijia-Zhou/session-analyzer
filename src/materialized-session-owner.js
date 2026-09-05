'use strict';

const { notifyMaterializationObserver } = require('./materialization-observer');

const MAX_ACTIVE_MATERIALIZATIONS = 1;
const MAX_QUEUED_MATERIALIZATIONS = 32;
const MIB = 1024 * 1024;
const DEFAULT_MATERIALIZED_SESSION_CACHE_POLICY = Object.freeze({
  maxEstimatedMaterializedBytes: 256 * MIB,
  maxCachedSessions: 12,
});
const CACHE_ORIGIN_FOREGROUND = 'foreground';
const CACHE_ORIGIN_SPECULATIVE = 'speculative';
const PROMOTED_PREWARM = Symbol('promoted-prewarm');
const SPECULATIVE_NOT_ADMITTED = Symbol('speculative-not-admitted');

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function materializationBusyError() {
  const error = new Error('Materialization capacity is busy; retry shortly');
  error.code = 'MATERIALIZATION_BUSY';
  error.statusCode = 503;
  error.retryAfterSeconds = 1;
  return error;
}

function prewarmAbortError(code) {
  const error = new Error('Speculative materialization no longer needed');
  error.name = 'AbortError';
  error.code = code;
  return error;
}

function observePrewarm(kind) {
  notifyMaterializationObserver({
    phase: `session_prewarm_${kind}`,
    state: 'event',
  });
}

function observeCache(kind) {
  notifyMaterializationObserver({
    phase: `cache_${kind}`,
    state: 'event',
  });
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function boundedSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function saturatingAdd(total, value) {
  return Math.min(Number.MAX_SAFE_INTEGER, total + Math.min(Number.MAX_SAFE_INTEGER, value));
}

function estimateMaterializedSessionBytes(indexedSession) {
  let total = 4096;
  total = saturatingAdd(total, boundedSafeInteger(indexedSession?.bytes));
  total = saturatingAdd(total, boundedSafeInteger(indexedSession?.rawEventCount) * 512);
  total = saturatingAdd(total, boundedSafeInteger(indexedSession?.logicalEventCount) * 1024);
  return total;
}

function removeIdentity(array, value) {
  const index = array.indexOf(value);
  if (index >= 0) array.splice(index, 1);
}

function createMaterializationScheduler(options = {}) {
  const maxActive = options.maxActive ?? MAX_ACTIVE_MATERIALIZATIONS;
  if (!Number.isSafeInteger(maxActive) || maxActive < 1) {
    throw new TypeError('Materialization scheduler maxActive must be a positive integer');
  }
  const scheduler = {
    maxActive,
    pending: [],
    active: new Set(),
    idleWaiters: new Set(),
    warn(message) {
      if (typeof options.warn !== 'function') return;
      try {
        options.warn(message);
      } catch {
        // Diagnostics must never change scheduling or cache ownership.
      }
    },
    enqueue(job) {
      this.pending.push(job);
      job.owner.queue.push(job);
      this.pump();
    },
    isIdle() {
      return this.active.size === 0 && this.pending.length === 0;
    },
    canAdmitSpeculative() {
      return this.isIdle();
    },
    whenIdle(signal) {
      if (signal?.aborted) return Promise.reject(abortError(signal));
      if (this.isIdle()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          signal,
          onAbort: null,
        };
        waiter.onAbort = () => {
          this.idleWaiters.delete(waiter);
          reject(abortError(signal));
        };
        this.idleWaiters.add(waiter);
        if (signal) signal.addEventListener('abort', waiter.onAbort, { once: true });
      });
    },
    notifyIdle() {
      if (!this.isIdle()) return;
      for (const waiter of [...this.idleWaiters]) {
        this.idleWaiters.delete(waiter);
        if (waiter.signal && waiter.onAbort) {
          waiter.signal.removeEventListener('abort', waiter.onAbort);
        }
        waiter.resolve();
      }
    },
    enqueueSpeculative(job) {
      if (!this.canAdmitSpeculative()) return false;
      this.pending.push(job);
      job.owner.queue.push(job);
      queueMicrotask(() => this.pump());
      return true;
    },
    preemptSpeculative(exceptJob = null) {
      for (const job of [...this.pending, ...this.active]) {
        if (job !== exceptJob && job.speculativeOnly) {
          job.owner._preemptSpeculativeJob(job);
        }
      }
    },
    remove(job) {
      removeIdentity(this.pending, job);
      removeIdentity(job.owner.queue, job);
    },
    pump() {
      while (this.active.size < this.maxActive && this.pending.length > 0) {
        const job = this.pending.shift();
        removeIdentity(job.owner.queue, job);
        if (job.status !== 'queued' || job.owner.retired || job.waiters.size === 0) {
          job.owner._discardQueuedJob(job);
          continue;
        }
        job.status = 'active';
        job.owner.activeJobs.add(job);
        job.owner.metrics.started += 1;
        if (job.speculativeOnly) {
          job.owner.metrics.prewarmStarted += 1;
          observePrewarm('started');
        }
        this.active.add(job);
        Promise.resolve()
          .then(() => job.materialize({ signal: job.controller.signal }))
          .then(
            (value) => job.owner._completeJob(job, null, value),
            (error) => job.owner._completeJob(job, error),
          )
          .finally(() => {
            job.owner.activeJobs.delete(job);
            this.active.delete(job);
            job.status = 'settled';
            this.pump();
          });
      }
      this.notifyIdle();
    },
  };
  return scheduler;
}

function settleWaiter(job, waiter, error, value) {
  if (!waiter.live) return;
  waiter.live = false;
  job.waiters.delete(waiter);
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener('abort', waiter.onAbort);
  }
  if (error) waiter.reject(error);
  else waiter.resolve(value);
}

function createMaterializedSessionOwner(options = {}) {
  const {
    index,
    indexRevision,
    retirementController,
    scheduler,
  } = options;
  if (!index
      || !Number.isSafeInteger(indexRevision)
      || indexRevision < 1
      || !(retirementController instanceof AbortController)
      || !scheduler?.enqueue) {
    throw new TypeError('Materialized Session owner requires an Index, revision, controller, and scheduler');
  }
  const maxEstimatedMaterializedBytes = positiveSafeInteger(
    options.maxEstimatedMaterializedBytes
      ?? DEFAULT_MATERIALIZED_SESSION_CACHE_POLICY.maxEstimatedMaterializedBytes,
    'Materialized Session cache maxEstimatedMaterializedBytes',
  );
  const maxCachedSessions = positiveSafeInteger(
    options.maxCachedSessions ?? DEFAULT_MATERIALIZED_SESSION_CACHE_POLICY.maxCachedSessions,
    'Materialized Session cache maxCachedSessions',
  );

  const owner = {
    index,
    indexRevision,
    retirementController,
    scheduler,
    cache: new Map(),
    maxEstimatedMaterializedBytes,
    maxCachedSessions,
    accessSequence: 0,
    jobs: new Map(),
    queue: [],
    activeJobs: new Set(),
    retired: false,
    estimatedMaterializedBytes: 0,
    metrics: {
      hits: 0,
      misses: 0,
      coalesced: 0,
      admitted: 0,
      busy: 0,
      started: 0,
      completed: 0,
      failed: 0,
      waiterAborts: 0,
      jobAborts: 0,
      retiredJobs: 0,
      peakCacheSessionCount: 0,
      peakEstimatedMaterializedBytes: 0,
      cacheAdmissions: 0,
      cacheTouches: 0,
      cachePromotions: 0,
      evictions: 0,
      evictedEstimatedBytes: 0,
      speculativeEvictions: 0,
      foregroundEvictions: 0,
      oversizeForegroundAdmissions: 0,
      speculativeAdmissionRejections: 0,
      prewarmScheduled: 0,
      prewarmStarted: 0,
      prewarmCompleted: 0,
      prewarmPromoted: 0,
      prewarmPreempted: 0,
      prewarmFailed: 0,
      prewarmSkippedBusy: 0,
      prewarmSkippedSize: 0,
      prewarmSkippedBudget: 0,
      prewarmSkippedCached: 0,
      prewarmSkippedCacheCapacity: 0,
      prewarmRetired: 0,
      prewarmCacheHits: 0,
    },
    _nextAccessSequence() {
      if (this.accessSequence < Number.MAX_SAFE_INTEGER) {
        this.accessSequence += 1;
        return this.accessSequence;
      }
      const entries = [...this.cache.values()]
        .sort((left, right) => left.lastAccessSequence - right.lastAccessSequence);
      let sequence = 0;
      for (const entry of entries) {
        sequence += 1;
        entry.lastAccessSequence = sequence;
      }
      this.accessSequence = sequence + 1;
      return this.accessSequence;
    },
    _cacheFits(estimatedBytes, cacheSessionCount, estimatedMaterializedBytes) {
      return cacheSessionCount + 1 <= this.maxCachedSessions
        && estimatedBytes <= this.maxEstimatedMaterializedBytes - estimatedMaterializedBytes;
    },
    _touchCacheEntry(entry) {
      const promoted = entry.origin === CACHE_ORIGIN_SPECULATIVE;
      if (promoted) {
        entry.origin = CACHE_ORIGIN_FOREGROUND;
        this.metrics.cachePromotions += 1;
        this.metrics.prewarmCacheHits += 1;
      }
      entry.lastAccessSequence = this._nextAccessSequence();
      this.metrics.cacheTouches += 1;
      if (promoted) {
        observePrewarm('cache_hit');
        observeCache('promoted');
      }
      observeCache('touched');
      return entry.value;
    },
    _selectEvictionVictim() {
      let victim = null;
      for (const [sessionId, entry] of this.cache) {
        if (!victim
            || (entry.origin === CACHE_ORIGIN_SPECULATIVE
              && victim.entry.origin !== CACHE_ORIGIN_SPECULATIVE)
            || (entry.origin === victim.entry.origin
              && entry.lastAccessSequence < victim.entry.lastAccessSequence)) {
          victim = { sessionId, entry };
        }
      }
      return victim;
    },
    _evictCacheEntry(sessionId) {
      const entry = this.cache.get(sessionId);
      if (!entry) return null;
      this.cache.delete(sessionId);
      this.estimatedMaterializedBytes -= entry.estimatedBytes;
      this.metrics.evictions += 1;
      this.metrics.evictedEstimatedBytes = saturatingAdd(
        this.metrics.evictedEstimatedBytes,
        entry.estimatedBytes,
      );
      if (entry.origin === CACHE_ORIGIN_SPECULATIVE) {
        this.metrics.speculativeEvictions += 1;
      } else {
        this.metrics.foregroundEvictions += 1;
      }
      observeCache('evicted');
      return entry;
    },
    _recordCacheAdmission(sessionId, value, estimatedBytes, origin, oversize = false) {
      this.cache.set(sessionId, {
        sessionId,
        value,
        estimatedBytes,
        lastAccessSequence: this._nextAccessSequence(),
        origin,
      });
      this.estimatedMaterializedBytes = saturatingAdd(
        this.estimatedMaterializedBytes,
        estimatedBytes,
      );
      this.metrics.cacheAdmissions += 1;
      if (oversize) {
        this.metrics.oversizeForegroundAdmissions += 1;
      }
      this.metrics.peakCacheSessionCount = Math.max(
        this.metrics.peakCacheSessionCount,
        this.cache.size,
      );
      this.metrics.peakEstimatedMaterializedBytes = Math.max(
        this.metrics.peakEstimatedMaterializedBytes,
        this.estimatedMaterializedBytes,
      );
      if (oversize) observeCache('oversize_admitted');
      observeCache('admitted');
    },
    _rejectSpeculativeAdmission() {
      this.metrics.speculativeAdmissionRejections += 1;
      this.metrics.prewarmSkippedCacheCapacity += 1;
      observeCache('speculative_rejected');
      observePrewarm('skipped_cache_capacity');
      return false;
    },
    _admitCacheEntry(sessionId, value, estimatedBytes, origin) {
      if (origin === CACHE_ORIGIN_SPECULATIVE) {
        if (estimatedBytes > this.maxEstimatedMaterializedBytes) {
          return this._rejectSpeculativeAdmission();
        }
        let simulatedCount = this.cache.size;
        let simulatedBytes = this.estimatedMaterializedBytes;
        const victims = [];
        const speculativeEntries = [...this.cache.entries()]
          .filter(([, entry]) => entry.origin === CACHE_ORIGIN_SPECULATIVE)
          .sort((left, right) => left[1].lastAccessSequence - right[1].lastAccessSequence);
        for (const [victimSessionId, entry] of speculativeEntries) {
          if (this._cacheFits(estimatedBytes, simulatedCount, simulatedBytes)) break;
          victims.push(victimSessionId);
          simulatedCount -= 1;
          simulatedBytes -= entry.estimatedBytes;
        }
        if (!this._cacheFits(estimatedBytes, simulatedCount, simulatedBytes)) {
          return this._rejectSpeculativeAdmission();
        }
        for (const victimSessionId of victims) this._evictCacheEntry(victimSessionId);
        this._recordCacheAdmission(
          sessionId,
          value,
          estimatedBytes,
          CACHE_ORIGIN_SPECULATIVE,
        );
        return true;
      }

      const oversize = estimatedBytes > this.maxEstimatedMaterializedBytes;
      if (oversize) {
        while (this.cache.size > 0) {
          this._evictCacheEntry(this._selectEvictionVictim().sessionId);
        }
        this._recordCacheAdmission(
          sessionId,
          value,
          estimatedBytes,
          CACHE_ORIGIN_FOREGROUND,
          true,
        );
        return true;
      }
      while (!this._cacheFits(
        estimatedBytes,
        this.cache.size,
        this.estimatedMaterializedBytes,
      )) {
        const victim = this._selectEvictionVictim();
        if (!victim) break;
        this._evictCacheEntry(victim.sessionId);
      }
      this._recordCacheAdmission(
        sessionId,
        value,
        estimatedBytes,
        CACHE_ORIGIN_FOREGROUND,
      );
      return true;
    },
    get(indexedSession, waiterSignal, materialize) {
      if (waiterSignal?.aborted) return Promise.reject(abortError(waiterSignal));
      if (this.retired || this.retirementController.signal.aborted) {
        return Promise.reject(this.retirementController.signal.reason || abortError(this.retirementController.signal));
      }
      const sessionId = String(indexedSession?.id || '');
      if (!sessionId || this.index.sessionsById?.get(sessionId) !== indexedSession) {
        return Promise.reject(new TypeError('Materialization owner requires its exact Indexed Session'));
      }
      if (typeof materialize !== 'function') {
        return Promise.reject(new TypeError('Materialization owner requires a materializer'));
      }
      const cachedEntry = this.cache.get(sessionId);
      if (cachedEntry) {
        this.metrics.hits += 1;
        return Promise.resolve(this._touchCacheEntry(cachedEntry));
      }

      const existing = this.jobs.get(sessionId);
      if (existing) {
        this.metrics.coalesced += 1;
        const promise = this._addWaiter(existing, waiterSignal, 'foreground');
        if (existing.speculativeOnly) this._promoteSpeculativeJob(existing);
        return promise;
      }

      this.scheduler.preemptSpeculative();
      this.metrics.misses += 1;
      const mustQueue = this.scheduler.active.size >= this.scheduler.maxActive
        || this.scheduler.pending.length > 0;
      if (mustQueue && this.queue.length >= MAX_QUEUED_MATERIALIZATIONS) {
        this.metrics.busy += 1;
        return Promise.reject(materializationBusyError());
      }

      const job = {
        owner: this,
        sessionId,
        estimatedBytes: estimateMaterializedSessionBytes(indexedSession),
        materialize,
        controller: new AbortController(),
        waiters: new Set(),
        status: 'queued',
        cancelledByWaiters: false,
        speculativeOnly: false,
      };
      this.jobs.set(sessionId, job);
      this.metrics.admitted += 1;
      const promise = this._addWaiter(job, waiterSignal, 'foreground');
      this.scheduler.enqueue(job);
      return promise;
    },
    prewarm(indexedSession, materialize) {
      if (this.retired || this.retirementController.signal.aborted) {
        return Promise.resolve({ status: 'retired' });
      }
      const sessionId = String(indexedSession?.id || '');
      if (!sessionId || this.index.sessionsById?.get(sessionId) !== indexedSession) {
        return Promise.reject(new TypeError('Materialization owner requires its exact Indexed Session'));
      }
      if (typeof materialize !== 'function') {
        return Promise.reject(new TypeError('Materialization owner requires a materializer'));
      }
      if (this.cache.has(sessionId)) return Promise.resolve({ status: 'cache-hit' });
      if (this.jobs.has(sessionId) || !this.scheduler.canAdmitSpeculative()) {
        this.metrics.prewarmSkippedBusy += 1;
        observePrewarm('skipped_busy');
        return Promise.resolve({ status: 'skipped-busy' });
      }

      const job = {
        owner: this,
        sessionId,
        estimatedBytes: estimateMaterializedSessionBytes(indexedSession),
        materialize,
        controller: new AbortController(),
        waiters: new Set(),
        status: 'queued',
        cancelledByWaiters: false,
        speculativeOnly: true,
      };
      this.jobs.set(sessionId, job);
      this.metrics.admitted += 1;
      this.metrics.prewarmScheduled += 1;
      observePrewarm('scheduled');
      const pending = this._addWaiter(job, null, 'speculative');
      if (!this.scheduler.enqueueSpeculative(job)) {
        this.jobs.delete(sessionId);
        this.metrics.prewarmSkippedBusy += 1;
        for (const waiter of [...job.waiters]) {
          settleWaiter(job, waiter, prewarmAbortError('PREWARM_BUSY'));
        }
      }
      return pending.then(
        (value) => {
          if (value === PROMOTED_PREWARM) return { status: 'promoted' };
          if (value === SPECULATIVE_NOT_ADMITTED) return { status: 'completed-not-admitted' };
          return { status: 'completed' };
        },
        (error) => {
          if (error?.code === 'PREWARM_PREEMPTED') return { status: 'preempted' };
          if (error?.code === 'PREWARM_BUSY') return { status: 'skipped-busy' };
          if (error?.code === 'INDEX_REVISION_RETIRED') return { status: 'retired' };
          return { status: 'failed', code: String(error?.code || error?.name || 'ERROR') };
        },
      );
    },
    _addWaiter(job, signal, kind = 'foreground') {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        const waiter = {
          live: true,
          signal,
          kind,
          resolve,
          reject,
          onAbort: null,
        };
        waiter.onAbort = () => {
          if (!waiter.live) return;
          this.metrics.waiterAborts += 1;
          settleWaiter(job, waiter, abortError(signal));
          if (job.waiters.size === 0) this._cancelUnobservedJob(job);
        };
        job.waiters.add(waiter);
        if (signal) signal.addEventListener('abort', waiter.onAbort, { once: true });
      });
    },
    _promoteSpeculativeJob(job) {
      if (!job.speculativeOnly) return;
      job.speculativeOnly = false;
      this.metrics.prewarmPromoted += 1;
      observePrewarm('promoted');
      for (const waiter of [...job.waiters]) {
        if (waiter.kind === 'speculative') {
          settleWaiter(job, waiter, null, PROMOTED_PREWARM);
        }
      }
    },
    _preemptSpeculativeJob(job) {
      if (!job.speculativeOnly) return false;
      this.metrics.prewarmPreempted += 1;
      observePrewarm('preempted');
      const reason = prewarmAbortError('PREWARM_PREEMPTED');
      for (const waiter of [...job.waiters]) {
        if (waiter.kind === 'speculative') settleWaiter(job, waiter, reason);
      }
      if (job.waiters.size === 0) this._cancelUnobservedJob(job);
      return true;
    },
    recordPrewarmSkip(reason) {
      const metric = {
        size: 'prewarmSkippedSize',
        budget: 'prewarmSkippedBudget',
        cached: 'prewarmSkippedCached',
      }[reason];
      if (!metric) throw new TypeError('Unknown prewarm skip reason');
      this.metrics[metric] += 1;
      observePrewarm(`skipped_${reason}`);
    },
    _cancelUnobservedJob(job) {
      job.cancelledByWaiters = true;
      if (job.status === 'queued') {
        this.scheduler.remove(job);
        job.status = 'cancelled';
        if (this.jobs.get(job.sessionId) === job) this.jobs.delete(job.sessionId);
        this.metrics.jobAborts += 1;
        this.scheduler.pump();
      } else if (job.status === 'active' && !job.controller.signal.aborted) {
        if (this.jobs.get(job.sessionId) === job) this.jobs.delete(job.sessionId);
        this.metrics.jobAborts += 1;
        job.controller.abort(abortError());
      }
    },
    _discardQueuedJob(job) {
      if (job.status === 'queued') job.status = 'cancelled';
      if (this.jobs.get(job.sessionId) === job) this.jobs.delete(job.sessionId);
    },
    _completeJob(job, error, value) {
      if (this.jobs.get(job.sessionId) === job) this.jobs.delete(job.sessionId);
      const discarded = this.retired
        || this.retirementController.signal.aborted
        || job.controller.signal.aborted
        || job.waiters.size === 0;
      if (!error && !discarded) {
        const origin = job.speculativeOnly
          ? CACHE_ORIGIN_SPECULATIVE
          : CACHE_ORIGIN_FOREGROUND;
        const cacheAdmitted = this._admitCacheEntry(
          job.sessionId,
          value,
          job.estimatedBytes,
          origin,
        );
        this.metrics.completed += 1;
        if (job.speculativeOnly) {
          if (cacheAdmitted) {
            this.metrics.prewarmCompleted += 1;
            observePrewarm('completed');
          }
        }
        const waiterValue = job.speculativeOnly && !cacheAdmitted
          ? SPECULATIVE_NOT_ADMITTED
          : value;
        for (const waiter of [...job.waiters]) settleWaiter(job, waiter, null, waiterValue);
        return;
      }
      if (error && !discarded) {
        this.metrics.failed += 1;
        if (job.speculativeOnly) {
          this.metrics.prewarmFailed += 1;
          observePrewarm('failed');
        }
        for (const waiter of [...job.waiters]) settleWaiter(job, waiter, error);
        return;
      }
      if (!error && job.controller.signal.aborted) {
        this.scheduler.warn('Materialization completed after cancellation; result discarded.');
      }
      const rejection = this.retired || this.retirementController.signal.aborted
        ? (this.retirementController.signal.reason || abortError(this.retirementController.signal))
        : (error || abortError(job.controller.signal));
      for (const waiter of [...job.waiters]) settleWaiter(job, waiter, rejection);
    },
    retire(reason) {
      if (this.retired) return;
      this.retired = true;
      this.cache.clear();
      this.estimatedMaterializedBytes = 0;
      this.accessSequence = 0;
      for (const job of [...this.queue]) {
        this.scheduler.remove(job);
        job.status = 'retired';
        this.jobs.delete(job.sessionId);
        this.metrics.retiredJobs += 1;
        if (job.speculativeOnly) {
          this.metrics.prewarmRetired += 1;
          observePrewarm('retired');
        }
        for (const waiter of [...job.waiters]) settleWaiter(job, waiter, reason);
      }
      for (const job of this.activeJobs) {
        this.metrics.retiredJobs += 1;
        if (job.speculativeOnly) {
          this.metrics.prewarmRetired += 1;
          observePrewarm('retired');
        }
        for (const waiter of [...job.waiters]) settleWaiter(job, waiter, reason);
        if (!job.controller.signal.aborted) job.controller.abort(reason);
      }
      this.scheduler.pump();
    },
    stats() {
      let waiterCount = 0;
      for (const job of this.jobs.values()) waiterCount += job.waiters.size;
      return {
        indexRevision: this.indexRevision,
        retired: this.retired,
        maxEstimatedMaterializedBytes: this.maxEstimatedMaterializedBytes,
        maxCachedSessions: this.maxCachedSessions,
        cacheSessionCount: this.cache.size,
        estimatedMaterializedBytes: this.estimatedMaterializedBytes,
        queuedJobCount: this.queue.length,
        activeJobCount: this.activeJobs.size,
        waiterCount,
        ...this.metrics,
      };
    },
  };
  return owner;
}

module.exports = {
  CACHE_ORIGIN_FOREGROUND,
  CACHE_ORIGIN_SPECULATIVE,
  DEFAULT_MATERIALIZED_SESSION_CACHE_POLICY,
  MAX_ACTIVE_MATERIALIZATIONS,
  MAX_QUEUED_MATERIALIZATIONS,
  abortError,
  createMaterializationScheduler,
  createMaterializedSessionOwner,
  estimateMaterializedSessionBytes,
  materializationBusyError,
};
