'use strict';

function referenceFromHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return params.get('evidenceRef') || params.get('ref') || '';
}

// One owner spans resolution, selection and optional prefix loading. A later
// user action retires it before any pending response can change the selection.
function createEvidenceNavigation() {
  let active = null;
  return {
    start() {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      return { signal: controller.signal, current: () => active === controller && !controller.signal.aborted };
    },
    cancel() { active?.abort(); active = null; },
  };
}

// A fragment-changing history traversal can arrive on both event channels.
// Remember the popstate owner, not its async lifetime: even a cancelled restore
// must not be restarted by the companion hashchange.
function createHistoryTraversalGuard() {
  let claimed = null;
  return {
    claim(url, saved) {
      claimed = saved ? { url, owner: saved.owner, id: saved.id } : null;
    },
    consume(url, saved) {
      const previous = claimed;
      claimed = null;
      return Boolean(previous && saved && previous.url === url
        && previous.owner === saved.owner && previous.id === saved.id);
    },
  };
}

module.exports = { referenceFromHash, createEvidenceNavigation, createHistoryTraversalGuard };
