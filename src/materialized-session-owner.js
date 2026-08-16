'use strict';

const MAX_ACTIVE_MATERIALIZATIONS = 1;
const MAX_QUEUED_MATERIALIZATIONS = 32;

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

  const owner = {
    index,
    indexRevision,
    retirementController,
    scheduler,
    cache: new Map(),
    cacheBytes: new Map(),
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
      if (this.cache.has(sessionId)) {
        this.metrics.hits += 1;
        return Promise.resolve(this.cache.get(sessionId));
      }

      const existing = this.jobs.get(sessionId);
      if (existing) {
        this.metrics.coalesced += 1;
        return this._addWaiter(existing, waiterSignal);
      }

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
      };
      this.jobs.set(sessionId, job);
      this.metrics.admitted += 1;
      const promise = this._addWaiter(job, waiterSignal);
      this.scheduler.enqueue(job);
      return promise;
    },
    _addWaiter(job, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        const waiter = {
          live: true,
          signal,
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
        this.cache.set(job.sessionId, value);
        this.cacheBytes.set(job.sessionId, job.estimatedBytes);
        this.estimatedMaterializedBytes = saturatingAdd(
          this.estimatedMaterializedBytes,
          job.estimatedBytes,
        );
        this.metrics.completed += 1;
        this.metrics.peakCacheSessionCount = Math.max(
          this.metrics.peakCacheSessionCount,
          this.cache.size,
        );
        this.metrics.peakEstimatedMaterializedBytes = Math.max(
          this.metrics.peakEstimatedMaterializedBytes,
          this.estimatedMaterializedBytes,
        );
        for (const waiter of [...job.waiters]) settleWaiter(job, waiter, null, value);
        return;
      }
      if (error && !discarded) {
        this.metrics.failed += 1;
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
      this.cacheBytes.clear();
      this.estimatedMaterializedBytes = 0;
      for (const job of [...this.queue]) {
        this.scheduler.remove(job);
        job.status = 'retired';
        this.jobs.delete(job.sessionId);
        this.metrics.retiredJobs += 1;
        for (const waiter of [...job.waiters]) settleWaiter(job, waiter, reason);
      }
      for (const job of this.activeJobs) {
        this.metrics.retiredJobs += 1;
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
  MAX_ACTIVE_MATERIALIZATIONS,
  MAX_QUEUED_MATERIALIZATIONS,
  abortError,
  createMaterializationScheduler,
  createMaterializedSessionOwner,
  estimateMaterializedSessionBytes,
  materializationBusyError,
};
