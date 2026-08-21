'use strict';

const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
} = require('./materialized-session-owner');
const { cancelBoundedSessionPrewarm } = require('./session-prewarm');

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function retiredError() {
  const error = new Error('Index revision retired; reload and retry');
  error.code = 'INDEX_REVISION_RETIRED';
  error.statusCode = 409;
  return error;
}

function createIndexRevisionLease(index, indexRevision, scheduler = createMaterializationScheduler()) {
  if (!index || !Number.isSafeInteger(indexRevision) || indexRevision < 1) {
    throw new TypeError('A revision lease requires an Index and positive revision');
  }
  const lease = {
    index,
    indexRevision,
    retirementController: new AbortController(),
  };
  lease.materializedSessionOwner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController: lease.retirementController,
    scheduler,
  });
  return lease;
}

function initializeIndexRevisionState(state, initialIndex = state.index || null) {
  state.materializationScheduler ||= createMaterializationScheduler({ warn: state.warn });
  state.indexRevision = initialIndex ? 1 : 0;
  state.revisionLease = initialIndex
    ? createIndexRevisionLease(initialIndex, 1, state.materializationScheduler)
    : null;
  return state;
}

function retireLease(lease) {
  if (lease && !lease.retirementController.signal.aborted) {
    const error = retiredError();
    cancelBoundedSessionPrewarm(lease);
    lease.materializedSessionOwner?.retire(error);
    lease.retirementController.abort(error);
  }
}

function installIndexRevision(state, index) {
  if (!index) throw new TypeError('installIndexRevision requires an Index');
  const previous = state.revisionLease;
  const nextRevision = (state.indexRevision || 0) + 1;
  retireLease(previous);
  const lease = createIndexRevisionLease(index, nextRevision, state.materializationScheduler);
  state.index = index;
  state.indexRevision = nextRevision;
  state.revisionLease = lease;
  return lease;
}

function clearIndexRevision(state) {
  if (!state.index && !state.revisionLease) return state.indexRevision || 0;
  const previous = state.revisionLease;
  const nextRevision = (state.indexRevision || 0) + 1;
  retireLease(previous);
  state.index = null;
  state.indexRevision = nextRevision;
  state.revisionLease = null;
  return nextRevision;
}

function captureIndexRevisionLease(state) {
  const lease = state.revisionLease;
  if (!lease
      || lease.index !== state.index
      || lease.indexRevision !== state.indexRevision
      || lease.materializedSessionOwner?.retired
      || lease.retirementController.signal.aborted) {
    throw retiredError();
  }
  return lease;
}

function materializeSessionWithLease(lease, indexedSession, waiterSignal, materialize) {
  if (!lease?.materializedSessionOwner
      || lease.materializedSessionOwner.index !== lease.index
      || lease.materializedSessionOwner.indexRevision !== lease.indexRevision) {
    return Promise.reject(retiredError());
  }
  return lease.materializedSessionOwner.get(
    indexedSession,
    waiterSignal,
    ({ signal }) => materialize({
      index: lease.index,
      indexRevision: lease.indexRevision,
      signal,
    }),
  );
}

function joinedAbortSignal(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);
  const controller = new AbortController();
  const abortFrom = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of active) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener('abort', () => abortFrom(signal), { once: true });
  }
  return controller.signal;
}

function assertIndexRevisionCurrent(state, lease, callerSignal) {
  if (callerSignal?.aborted) throw abortError(callerSignal);
  if (state.revisionLease !== lease
      || state.index !== lease.index
      || state.indexRevision !== lease.indexRevision
      || lease.retirementController.signal.aborted) {
    throw retiredError();
  }
}

async function withIndexRevisionLease(state, callerSignal, operation) {
  const lease = captureIndexRevisionLease(state);
  const signal = joinedAbortSignal(callerSignal, lease.retirementController.signal);
  try {
    const value = await operation({
      index: lease.index,
      indexRevision: lease.indexRevision,
      lease,
      signal,
    });
    assertIndexRevisionCurrent(state, lease, callerSignal);
    return { value, lease };
  } catch (error) {
    if (callerSignal?.aborted) throw abortError(callerSignal);
    if (state.revisionLease !== lease
        || state.index !== lease.index
        || state.indexRevision !== lease.indexRevision
        || lease.retirementController.signal.aborted) {
      throw retiredError();
    }
    throw error;
  }
}

module.exports = {
  assertIndexRevisionCurrent,
  captureIndexRevisionLease,
  clearIndexRevision,
  createIndexRevisionLease,
  initializeIndexRevisionState,
  installIndexRevision,
  joinedAbortSignal,
  materializeSessionWithLease,
  retiredError,
  withIndexRevisionLease,
};
