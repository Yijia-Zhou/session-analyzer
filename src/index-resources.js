'use strict';

// Disposable adapter resources live outside canonical Index/Session metadata.
// A consumer owns a published resource; a reader protects actual asynchronous
// work, even when a caller has already observed cancellation.
const { AsyncLocalStorage } = require('node:async_hooks');
const { disposeProjectQueryStore } = require('./project-query-store');

const scopes = new AsyncLocalStorage();
const resourcesByIndex = new WeakMap();
const states = new WeakMap();
const queryResources = new WeakMap();
const live = new Set();

function retiredError() {
  return Object.assign(new Error('Index resources retired; reload and retry'), {
    code: 'INDEX_REVISION_RETIRED', statusCode: 409,
  });
}

function finishCleanup(state) {
  if (state.disposed || state.cleaning || !state.requested || state.holders || state.readers) return;
  state.phase = 'retired';
  state.cleaning = true;
  state.cleanupAttempts += 1;
  Promise.resolve().then(() => state.dispose()).then(() => {
    state.disposed = true;
    state.phase = 'disposed';
    state.cleanupError = null;
    live.delete(state);
    state.complete?.(true);
  }, (error) => {
    state.cleanupError = error?.code || error?.name || 'Error';
    // Do not replace the build/read failure or claim the directory was removed.
    if (state.cleanupAttempts === 1) {
      process.emitWarning('Index resource cleanup failed (' + state.cleanupError + '); retrying', {
        code: 'INDEX_RESOURCE_CLEANUP_FAILED',
      });
    }
    state.complete?.(false);
    if (state.cleanupAttempts < 4) {
      setTimeout(() => finishCleanup(state), 100 * state.cleanupAttempts).unref();
    }
  }).finally(() => { state.cleaning = false; });
}

function requestDisposal(state) {
  state.requested = true;
  if (!state.completion) {
    state.completion = new Promise((resolve) => { state.complete = resolve; });
  }
  if (!state.holders) state.phase = 'retired';
  finishCleanup(state);
  return state.completion;
}

function acquireReader(state) {
  if (state.disposed || (state.requested && !state.holders)) throw retiredError();
  state.readers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.readers -= 1;
    finishCleanup(state);
  };
}

function registerIndexResource({ dispose, disposeSync, label = 'adapter resource' } = {}) {
  if (typeof dispose !== 'function' || (disposeSync !== undefined && typeof disposeSync !== 'function')) {
    throw new TypeError('Index resources require a disposer and optional synchronous exit disposer');
  }
  const state = {
    dispose, disposeSync, label, phase: 'sealed', readers: 0, holders: 0,
    requested: false, disposed: false, cleaning: false,
    cleanupAttempts: 0, cleanupError: null, completion: null,
  };
  const resource = Object.freeze({
    seal() {
      if (state.requested || state.disposed) throw retiredError();
      return resource;
    },
    async withReader(operation) {
      const release = acquireReader(state);
      try { return await operation(); } finally { release(); }
    },
    dispose() { return requestDisposal(state); },
    stats() {
      return { phase: state.phase, readers: state.readers, holders: state.holders,
        cleanupAttempts: state.cleanupAttempts, cleanupError: state.cleanupError };
    },
  });
  states.set(resource, state);
  live.add(state);
  // Register with enclosing scopes too: an inner successful build must still be
  // reclaimed if an outer validation/commit operation fails.
  for (let scope = scopes.getStore(); scope; scope = scope.parent) scope.resources.add(resource);
  return resource;
}

function attachIndexResource(index, resource) {
  if (!index || typeof index !== 'object' || !states.has(resource)) {
    throw new TypeError('Attach a registered resource to an Index object');
  }
  const state = states.get(resource);
  if (state.requested || state.disposed) throw retiredError();
  let owned = resourcesByIndex.get(index);
  if (!owned) { owned = new Set(); resourcesByIndex.set(index, owned); }
  owned.add(resource);
  ensureQueryResource(index);
  return index;
}

function hasIndexResources(index) { return Boolean(index && resourcesByIndex.get(index)?.size); }

function ensureQueryResource(index) {
  if (!hasIndexResources(index) || !index.projectQueryStore || queryResources.has(index)) return;
  const store = index.projectQueryStore;
  const resource = registerIndexResource({
    label: 'Index query store',
    dispose: () => disposeProjectQueryStore(store),
    disposeSync: () => disposeProjectQueryStore(store),
  });
  queryResources.set(index, resource);
  attachIndexResource(index, resource);
}

function retainIndexResources(index) {
  if (!hasIndexResources(index)) return () => {};
  ensureQueryResource(index);
  const retained = [...resourcesByIndex.get(index)];
  for (const resource of retained) {
    const state = states.get(resource);
    if (state.disposed || (state.requested && !state.holders)) throw retiredError();
  }
  for (const resource of retained) {
    const state = states.get(resource);
    state.holders += 1;
    state.phase = 'published';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const resource of retained) {
      const state = states.get(resource);
      state.holders -= 1;
      if (!state.holders) requestDisposal(state);
    }
  };
}

async function withIndexResources(index, operation) {
  const owned = index && resourcesByIndex.get(index);
  if (!owned?.size) return operation();
  const releases = [];
  try {
    for (const resource of owned) releases.push(acquireReader(states.get(resource)));
    return await operation();
  } finally {
    for (const release of releases.reverse()) release();
  }
}

async function disposeIndexResources(index) {
  if (!hasIndexResources(index)) return [];
  ensureQueryResource(index);
  return Promise.all([...resourcesByIndex.get(index)].map((resource) => resource.dispose()));
}

async function withIndexResourceBuildScope(operation) {
  const scope = { resources: new Set(), parent: scopes.getStore() || null };
  let result;
  try {
    result = await scopes.run(scope, operation);
    return result;
  } finally {
    const transferred = result && resourcesByIndex.get(result);
    const cleanup = [];
    for (const resource of scope.resources) {
      const state = states.get(resource);
      if (transferred?.has(resource) || state.holders) continue;
      cleanup.push(resource.dispose());
    }
    await Promise.all(cleanup);
  }
}

process.once('exit', () => {
  // Exit cannot await I/O. An in-flight reader's directory remains for the
  // adapter's conservative, marker-based crash-residue recovery.
  for (const state of live) {
    if (!state.readers && state.disposeSync) {
      try { state.disposeSync(); } catch { /* Never hide the process exit. */ }
    }
  }
});

module.exports = {
  attachIndexResource,
  disposeIndexResources,
  hasIndexResources,
  registerIndexResource,
  retainIndexResources,
  withIndexResourceBuildScope,
  withIndexResources,
};
