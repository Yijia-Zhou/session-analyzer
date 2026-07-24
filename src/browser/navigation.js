(function initNavigation(root, factory) {
  const folding = typeof module === 'object' && module.exports
    ? require('../shared/folding')
    : root.sessionFolding;
  const api = factory(folding);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionNavigation = api;
}(typeof globalThis !== 'undefined' ? globalThis : window, function createNavigationApi(folding) {
  'use strict';

  const isUpdatePlanEvent = folding.isUpdatePlanEvent;
  const CODE_MODE_CONTEXT_RELATION = 'enclosed_by_code_mode_operation';

  function enclosingOperationParentId(event = {}) {
    const context = event.presentationContext;
    if (!context || context.relation !== CODE_MODE_CONTEXT_RELATION) return '';
    return String(context.codeModeParentId || '').trim();
  }

  function shouldShowEnclosingOperationAffordance(event, displayState, search = {}, selectedEventId = '') {
    if (!enclosingOperationParentId(event)) return false;
    return Boolean(
      event.hasSearchHit
      || search.kind
      || search.status
      || search.file
      || String(selectedEventId || '') === String(event.id || '')
      || displayState === 'expanded',
    );
  }

  function contextRevealSourceIndex(events = [], reveal = null) {
    const sourceEventId = String(reveal?.sourceEventId || '');
    if (!sourceEventId) return -1;
    return events.findIndex((event) => String(event?.id || '') === sourceEventId);
  }

  function reconcileContextReveal({
    reveal,
    sessionId = '',
    layerId = '',
    dataContext = '',
    foldingContext = '',
    detailGeneration = null,
    events = [],
  } = {}) {
    if (!reveal) return null;
    if (String(reveal.sessionId || '') !== String(sessionId || '')
        || String(reveal.layerId || '') !== String(layerId || '')
        || String(reveal.dataContext || '') !== String(dataContext || '')
        || (foldingContext !== '' && String(reveal.foldingContext || '') !== String(foldingContext))
        || (detailGeneration != null && Number(reveal.detailGeneration) !== Number(detailGeneration))) return null;
    const sourceIndex = contextRevealSourceIndex(events, reveal);
    if (sourceIndex < 0) return null;
    const source = events[sourceIndex];
    if (enclosingOperationParentId(source) !== String(reveal.parentEventId || '')) return null;
    return reveal;
  }

  const NAVIGATION_CATEGORIES = [
    { id: 'search_hits', label: 'Search hits', matches: (event) => Boolean(event.hasSearchHit) },
    { id: 'user_messages', label: 'User messages', matches: (event) => event.kind === 'user_message' },
    { id: 'assistant_messages', label: 'Assistant messages', matches: (event) => event.kind === 'assistant_message' },
    { id: 'update_plan', label: 'Plan updates', matches: isUpdatePlanEvent },
    { id: 'plans', label: 'Plans / updates', matches: (event) => event.kind === 'proposed_plan' || isUpdatePlanEvent(event) },
    { id: 'failed_commands', label: 'Failed commands', matches: (event) => event.kind === 'command' && event.status === 'failed' },
    { id: 'commands', label: 'Commands', matches: (event) => event.kind === 'command' },
    { id: 'patch_applied', label: 'Patch applied', matches: (event) => event.kind === 'patch' && event.status === 'success' },
    { id: 'patch_failed', label: 'Patch failed', matches: (event) => event.kind === 'patch' && event.status === 'failed' },
    { id: 'patches', label: 'All patches', matches: (event) => event.kind === 'patch' },
    { id: 'errors_warnings', label: 'Errors / warnings', matches: (event) => event.severity !== 'normal' || event.status === 'failed' || ['error', 'abort', 'rollback', 'compaction'].includes(event.kind) },
    { id: 'mcp_calls', label: 'MCP calls', matches: (event) => event.kind === 'mcp_call' || String(event.toolName || '').startsWith('mcp__') },
    { id: 'web_searches', label: 'Web searches', matches: (event) => event.kind === 'web_search' },
  ];

  function navigationCategoriesForEvent(event, events, categories = NAVIGATION_CATEGORIES) {
    return categories
      .map((category) => ({
        ...category,
        matchesInResult: events.filter((candidate) => category.matches(candidate)),
      }))
      .filter((category) => category.matches(event) && category.matchesInResult.length);
  }

  function withTemporaryEventReveal(events, reveal) {
    if (!reveal?.event || events.some((event) => event.id === reveal.event.id)) return events;
    const result = [...events];
    const sourceIndex = result.findIndex((event) => event.id === reveal.sourceEventId);
    result.splice(sourceIndex >= 0 ? sourceIndex + 1 : result.length, 0, reveal.event);
    return result;
  }

  function reconcileTemporaryEventReveal({ reveal, detailView, history = [] } = {}) {
    const selectedEventId = ['inspector', 'rawRefs'].includes(detailView?.type)
      ? String(detailView?.eventId || '')
      : '';
    const temporaryEventId = String(reveal?.event?.id || '');
    const cleared = Boolean(temporaryEventId && selectedEventId !== temporaryEventId);
    return {
      selectedEventId,
      reveal: cleared ? null : reveal || null,
      history: cleared
        ? history.filter((view) => String(view?.eventId || '') !== temporaryEventId)
        : [...history],
      cleared,
    };
  }

  return {
    CODE_MODE_CONTEXT_RELATION,
    NAVIGATION_CATEGORIES,
    contextRevealSourceIndex,
    enclosingOperationParentId,
    isUpdatePlanEvent,
    navigationCategoriesForEvent,
    reconcileContextReveal,
    reconcileTemporaryEventReveal,
    shouldShowEnclosingOperationAffordance,
    withTemporaryEventReveal,
  };
}));
