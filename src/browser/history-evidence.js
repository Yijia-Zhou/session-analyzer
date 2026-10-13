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

module.exports = { referenceFromHash, createEvidenceNavigation };
