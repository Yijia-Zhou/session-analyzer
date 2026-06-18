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

  return {
    NAVIGATION_CATEGORIES,
    isUpdatePlanEvent,
    navigationCategoriesForEvent,
  };
}));
