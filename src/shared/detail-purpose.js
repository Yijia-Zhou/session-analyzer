(function initDetailPurpose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionDetailPurpose = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DETAIL_PURPOSES = Object.freeze([
    'content',
    'request',
    'result',
    'context',
    'traceability',
    'fallback',
  ]);

  const DETAIL_PURPOSE_ORDER = Object.freeze(Object.fromEntries(
    DETAIL_PURPOSES.map((purpose, index) => [purpose, index]),
  ));

  function orderDetailSections(sections) {
    return (Array.isArray(sections) ? sections : [])
      .map((section, index) => ({ section, index }))
      .sort((left, right) => {
        const leftOrder = DETAIL_PURPOSE_ORDER[left.section?.purpose] ?? DETAIL_PURPOSES.length;
        const rightOrder = DETAIL_PURPOSE_ORDER[right.section?.purpose] ?? DETAIL_PURPOSES.length;
        return leftOrder - rightOrder || left.index - right.index;
      })
      .map((entry) => entry.section);
  }

  return {
    DETAIL_PURPOSE_ORDER,
    DETAIL_PURPOSES,
    orderDetailSections,
  };
}));
