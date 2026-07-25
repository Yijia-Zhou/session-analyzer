(function initSearchControls(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionSearchControls = api;
}(typeof globalThis !== 'undefined' ? globalThis : window, function createSearchControlsApi() {
  'use strict';

  const FILTER_ORDER = ['file', 'kind', 'status'];

  function normalizedCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function structuredSearchKey(filters, layerId = '', sortValue = '') {
    const search = filters || {};
    return [
      search.kind || '',
      search.status || '',
      search.file || '',
      search.codeModeRequest || '',
      layerId || '',
      sortValue || '',
    ].join('\u001f');
  }

  function activeFilterEntries(filters, labels = {}) {
    const search = filters || {};
    return FILTER_ORDER.flatMap((key) => {
      const value = String(
        key === 'kind' && !search.kind && search.codeModeRequest
          ? 'code_mode_operation'
          : (search[key] || ''),
      ).trim();
      if (!value) return [];
      const label = typeof labels[key] === 'function' ? labels[key](value) : (labels[key] || key);
      return [{ key, value, label: String(label || key) }];
    });
  }

  function filterSummary(filters, labels = {}, separator = ' · ') {
    return activeFilterEntries(filters, labels)
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join(separator);
  }

  function searchMetricsModel(input = {}) {
    const scope = input.scope === 'project' ? 'project' : 'session';
    const active = Boolean(input.active);
    const loading = Boolean(input.loading);
    if (!active) return { scope, mode: 'idle' };
    if (loading) return { scope, mode: 'loading' };
    if (scope === 'project') {
      return {
        scope,
        mode: 'ready',
        sessions: normalizedCount(input.projectSessionCount),
        events: normalizedCount(input.projectEventCount),
      };
    }
    const jumpTotal = normalizedCount(input.jumpTargetCount);
    const currentIndex = Number.isInteger(input.currentIndex) ? input.currentIndex : -1;
    return {
      scope,
      mode: 'ready',
      current: currentIndex >= 0 && jumpTotal > 0 ? Math.min(currentIndex + 1, jumpTotal) : 0,
      jumpTotal,
      fullTextTotal: normalizedCount(input.fullTextCount),
    };
  }

  return {
    FILTER_ORDER,
    activeFilterEntries,
    filterSummary,
    searchMetricsModel,
    structuredSearchKey,
  };
}));
