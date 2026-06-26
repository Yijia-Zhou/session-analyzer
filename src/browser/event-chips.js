(function initEventChips(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionEventChips = api;
}(typeof globalThis !== 'undefined' ? globalThis : window, function createEventChipsApi() {
  'use strict';

  function meaningfulEventKind(event) {
    return event.kind === 'protocol' ? '' : String(event.kind || '').trim();
  }

  function inspectorChipValues(event) {
    return [
      meaningfulEventKind(event),
      ...(Array.isArray(event.tags) ? event.tags : []),
      event.status,
      event.severity && event.severity !== 'normal' ? event.severity : '',
    ];
  }

  function rawRefsSubtitle(event) {
    return String(event.label || meaningfulEventKind(event)).trim();
  }

  return {
    inspectorChipValues,
    rawRefsSubtitle,
  };
}));
