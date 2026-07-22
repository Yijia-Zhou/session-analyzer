'use strict';

const USER_PAGINATION_INTENTS = new Set(['wheel', 'touch', 'pointer', 'keyboard']);

function isIntentionalAbort(error) {
  if (!error || error.name !== 'AbortError') return false;
  if (typeof DOMException === 'function') return error instanceof DOMException;
  return Object.prototype.toString.call(error) === '[object DOMException]';
}

function createRequestOwner(options = {}) {
  const AbortControllerImpl = options.AbortControllerImpl || globalThis.AbortController;
  let sequence = 0;
  let current = null;

  function start(context = '') {
    current?.controller.abort();
    const request = {
      id: ++sequence,
      context,
      controller: new AbortControllerImpl(),
    };
    current = request;
    return request;
  }

  function isCurrent(request) {
    return Boolean(request) && current === request;
  }

  function finish(request) {
    if (!isCurrent(request)) return false;
    current = null;
    return true;
  }

  function abort() {
    if (!current) return false;
    current.controller.abort();
    return true;
  }

  function clear() {
    if (current) current.controller.abort();
    current = null;
  }

  return {
    start,
    isCurrent,
    finish,
    abort,
    clear,
    current: () => current,
  };
}

function createPaginationIntentState() {
  let epoch = 0;
  let sequence = 0;
  let context = '';
  let committed = false;
  let userAuthorization = null;
  const claimed = new Set();

  function token(kind, user) {
    return Object.freeze({ id: ++sequence, epoch, kind, user });
  }

  function beginReplacement(nextContext = '') {
    epoch += 1;
    context = nextContext;
    committed = false;
    userAuthorization = null;
    claimed.clear();
    return epoch;
  }

  function authorizeUser(kind) {
    if (!committed || !USER_PAGINATION_INTENTS.has(kind)) return null;
    userAuthorization = token(kind, true);
    return userAuthorization;
  }

  function createIntent(kind) {
    return token(kind, false);
  }

  function revokeUser(intent) {
    if (!intent || userAuthorization !== intent) return false;
    userAuthorization = null;
    return true;
  }

  function commitReplacement(expectedEpoch = epoch) {
    if (expectedEpoch !== epoch) return false;
    committed = true;
    return true;
  }

  function claim(intent) {
    if (!intent || intent.epoch !== epoch || claimed.has(intent.id)) return false;
    if (intent.user && userAuthorization !== intent) return false;
    claimed.add(intent.id);
    if (intent.user) userAuthorization = null;
    return true;
  }

  function snapshot() {
    return {
      epoch,
      context,
      committed,
      authorizedUserIntentId: userAuthorization?.id || 0,
    };
  }

  return {
    beginReplacement,
    commitReplacement,
    authorizeUser,
    revokeUser,
    createIntent,
    claim,
    snapshot,
  };
}

module.exports = {
  USER_PAGINATION_INTENTS,
  isIntentionalAbort,
  createRequestOwner,
  createPaginationIntentState,
};
