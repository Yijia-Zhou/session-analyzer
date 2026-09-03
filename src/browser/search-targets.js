(function initSearchTargets(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionSearchTargets = api;
}(typeof globalThis !== 'undefined' ? globalThis : window, function createSearchTargetsApi() {
  'use strict';

  function targetId(searchKey, ownerId) {
    return JSON.stringify([searchKey, ownerId]);
  }

  function targetOrder(left, right) {
    const leftIndex = Number.isFinite(left.timelineIndex) ? left.timelineIndex : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isFinite(right.timelineIndex) ? right.timelineIndex : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.ownerId.localeCompare(right.ownerId);
  }

  function discover(targets, searchKey, events, options = {}) {
    const next = [...targets];
    const targetsById = new Map(next.map((target) => [target.id, target]));
    const addedIds = [];
    const baseTimelineIndex = Number.isFinite(Number(options.baseTimelineIndex))
      ? Number(options.baseTimelineIndex)
      : 0;
    events.forEach((event, loadedIndex) => {
      if (!event?.hasSearchHit) return;
      const id = targetId(searchKey, event.id);
      if (targetsById.has(id)) return;
      const target = {
        id,
        searchKey,
        ownerId: event.id,
        timelineIndex: Number.isFinite(Number(event.timelineIndex))
          ? Number(event.timelineIndex)
          : baseTimelineIndex + loadedIndex,
        bindings: { timeline: [], inspector: [] },
      };
      next.push(target);
      targetsById.set(id, target);
      addedIds.push(id);
    });
    next.sort(targetOrder);
    return { targets: next, addedIds };
  }

  function resetBindings(targets) {
    targets.forEach((target) => { target.bindings = { timeline: [], inspector: [] }; });
  }

  function resetSurfaceBindings(target, surface) {
    if (!['timeline', 'inspector'].includes(surface)
        || !target?.bindings || !Object.hasOwn(target.bindings, surface)) return null;
    const previous = target.bindings[surface];
    if (!Array.isArray(previous)) return null;
    target.bindings[surface] = [];
    return previous;
  }

  function bind(target, surface, node) {
    if (!target || !Object.hasOwn(target.bindings, surface)) return false;
    target.bindings[surface].push(node);
    return true;
  }

  function liveBinding(target, surface, predicate = (node) => node?.isConnected) {
    return target?.bindings?.[surface]?.find((node) => predicate(node, target)) || null;
  }

  function activeIndex(targets, activeTargetId) {
    return targets.findIndex((target) => target.id === activeTargetId);
  }

  function discoveryOutcome(addedIds, hasMore) {
    const grew = addedIds.length > 0;
    return { grew, exhausted: !grew && !hasMore };
  }

  return {
    activeIndex,
    bind,
    discover,
    discoveryOutcome,
    liveBinding,
    resetBindings,
    resetSurfaceBindings,
    targetId,
    targetOrder,
  };
}));
