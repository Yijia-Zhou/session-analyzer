'use strict';

const CODE_MODE_OPERATION_KIND = 'code_mode_operation';
const ENCLOSED_BY_CODE_MODE_OPERATION = 'enclosed_by_code_mode_operation';

function codeModePresentationContextMap(logicalEvents) {
  const contexts = new Map();
  const ambiguousEventIds = new Set();
  if (!Array.isArray(logicalEvents)) return contexts;

  for (const candidate of logicalEvents) {
    if (candidate?.kind !== CODE_MODE_OPERATION_KIND) continue;
    const parentId = typeof candidate.id === 'string' ? candidate.id : '';
    const eventRefs = candidate.codeModeOperation?.eventRefs;
    if (!parentId || !Array.isArray(eventRefs)) continue;
    for (const eventId of eventRefs) {
      if (typeof eventId !== 'string' || !eventId || eventId === parentId || ambiguousEventIds.has(eventId)) continue;
      const existing = contexts.get(eventId);
      if (!existing) {
        contexts.set(eventId, {
          relation: ENCLOSED_BY_CODE_MODE_OPERATION,
          codeModeParentId: parentId,
        });
      } else if (existing.codeModeParentId !== parentId) {
        contexts.delete(eventId);
        ambiguousEventIds.add(eventId);
      }
    }
  }

  return contexts;
}

module.exports = {
  CODE_MODE_OPERATION_KIND,
  ENCLOSED_BY_CODE_MODE_OPERATION,
  codeModePresentationContextMap,
};
