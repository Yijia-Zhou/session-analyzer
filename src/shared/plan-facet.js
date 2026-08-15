(function initPlanFacet(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionPlanFacet = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPlanFacetApi() {
  'use strict';

  const PLAN_EVENT_CATEGORY = Object.freeze({
    ARTIFACT: 'artifact',
    UPDATE: 'update',
  });

  const PLAN_ARTIFACT_FACET = Object.freeze({
    category: PLAN_EVENT_CATEGORY.ARTIFACT,
  });
  const PLAN_UPDATE_FACET = Object.freeze({
    category: PLAN_EVENT_CATEGORY.UPDATE,
  });

  function planFacetForEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
    const kind = typeof event.kind === 'string' ? event.kind : '';
    const subtype = typeof event.subtype === 'string' ? event.subtype : '';
    const toolName = typeof event.toolName === 'string' ? event.toolName : '';

    if (kind === 'proposed_plan' && subtype === 'proposed_plan' && !toolName) {
      return PLAN_ARTIFACT_FACET;
    }
    if (kind === 'other_tool_call' && subtype === 'update_plan' && toolName === 'update_plan') {
      return PLAN_UPDATE_FACET;
    }
    if (kind === 'other_tool_call' && subtype === toolName && ['TaskCreate', 'TaskUpdate'].includes(toolName)) {
      return PLAN_UPDATE_FACET;
    }
    if (kind === 'plan_update' && ['plan_update', 'plan_delta'].includes(subtype) && !toolName) {
      return PLAN_UPDATE_FACET;
    }
    return null;
  }

  function planCategoryForEvent(event) {
    return planFacetForEvent(event)?.category || '';
  }

  function isPlanEvent(event) {
    return Boolean(planFacetForEvent(event));
  }

  function isPlanArtifactEvent(event) {
    return planCategoryForEvent(event) === PLAN_EVENT_CATEGORY.ARTIFACT;
  }

  function isPlanUpdateEvent(event) {
    return planCategoryForEvent(event) === PLAN_EVENT_CATEGORY.UPDATE;
  }

  return {
    PLAN_EVENT_CATEGORY,
    isPlanArtifactEvent,
    isPlanEvent,
    isPlanUpdateEvent,
    planCategoryForEvent,
    planFacetForEvent,
  };
}));
