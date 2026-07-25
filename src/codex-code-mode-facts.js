'use strict';

const { codeModeOutputText } = require('./codex-code-mode');
const { codeModeOperationExecSource } = require('./codex-code-mode-presentation');
const { rawRef } = require('./codex-source');

const PRESENTATION_CLAIMED_RAW_POLICY = 'operation_phase_refs_plus_matching_outer_exec_outputs';

function parsedPayload(raw) {
  const payload = raw?.parsed?.payload;
  return payload && typeof payload === 'object' ? payload : {};
}

function rawCallId(raw) {
  const payload = parsedPayload(raw);
  return String(raw?.callId || payload.call_id || payload.callId || '');
}

function rawSessionId(raw) {
  return String(raw?.sessionId || '');
}

function operationKey(sessionId, outerCallId) {
  return `${String(sessionId || '')}\u0000${String(outerCallId || '')}`;
}

function rawKey(raw) {
  return operationKey(rawSessionId(raw), rawCallId(raw));
}

function isOuterExecOutput(raw) {
  return raw?.recordType === 'response_item'
    && raw.payloadType === 'custom_tool_call_output'
    && Boolean(rawCallId(raw));
}

function uniqueSearchableText(values) {
  const parts = [];
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text || parts.some((existing) => existing.includes(text))) continue;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (text.includes(parts[index])) parts.splice(index, 1);
    }
    parts.push(text);
  }
  return parts.join('\n');
}

function phaseRefs(operation) {
  const refs = [];
  const seen = new Set();
  for (const phase of operation?.phases || []) {
    for (const ref of [phase?.callRef, phase?.outputRef]) {
      const rawId = String(ref?.rawId || '');
      if (!rawId || seen.has(rawId)) continue;
      seen.add(rawId);
      refs.push(ref);
    }
  }
  return refs;
}

function canonicalPhaseRefs(operation, rawById) {
  return phaseRefs(operation).map((ref) => {
    const raw = rawById.get(String(ref.rawId || ''));
    return raw ? rawRef(raw) : { ...ref };
  });
}

function sourceEventTypeForRef(ref, rawById) {
  const explicit = String(ref?.sourceEventType || '');
  if (explicit) return explicit;
  return String(rawById.get(String(ref?.rawId || ''))?.payloadType || '');
}

function eventIsLifecycleBacked(event, lifecycleTypes, rawById) {
  const refs = Array.isArray(event?.rawRefs) ? event.rawRefs : [];
  return refs.some((ref) => lifecycleTypes.has(sourceEventTypeForRef(ref, rawById)));
}

function spanContainsAllRefs(span, refs) {
  if (!span || !refs.length) return false;
  return refs.every((ref) => (
    String(ref?.file || '') === String(span.file || '')
    && Number.isFinite(Number(ref?.line))
    && Number(ref.line) >= Number(span.startLine)
    && Number(ref.line) <= Number(span.endLine)
  ));
}

function nestedEventRefsByOperation(operations, logicalEvents, lifecycleTypes, rawById, phaseEventIds) {
  const eventRefs = new Map(operations.map((operation) => [operation.id, []]));
  const spans = operations.flatMap((operation) => (operation.phaseSpans || []).map((span) => ({
    operationId: operation.id,
    span,
  })));

  for (const event of logicalEvents) {
    const refs = Array.isArray(event?.rawRefs) ? event.rawRefs : [];
    if (!event?.id || phaseEventIds.has(String(event.id)) || !refs.length
      || !eventIsLifecycleBacked(event, lifecycleTypes, rawById)) continue;
    const containing = spans.filter(({ span }) => spanContainsAllRefs(span, refs));
    if (containing.length !== 1) continue;
    const ownedRefs = eventRefs.get(containing[0].operationId);
    if (ownedRefs && !ownedRefs.includes(event.id)) ownedRefs.push(event.id);
  }
  return eventRefs;
}

function phaseEventRefs(operation, logicalEvents) {
  return (operation?.phases || []).map((phase, phaseIndex) => {
    const callRawId = String(phase?.callRef?.rawId || '');
    const matching = callRawId
      ? logicalEvents.filter((event) => (event?.rawRefs || []).some((ref) => String(ref?.rawId || '') === callRawId))
      : [];
    return {
      phaseIndex,
      callRawId,
      eventId: matching.length === 1 ? String(matching[0].id || '') : '',
    };
  });
}

function operationSearchableText(operation, rawById) {
  const outerJavaScript = codeModeOperationExecSource(operation, rawById);
  const observedOutputs = (operation?.phases || [])
    .map((phase) => rawById.get(String(phase?.outputRef?.rawId || '')))
    .filter(Boolean)
    .map(codeModeOutputText);
  return uniqueSearchableText([outerJavaScript, ...observedOutputs]);
}

function presentationClaimedRawIds(operations, rawEvents) {
  const operationKeys = new Set(operations.map((operation) => operationKey(
    operation.sessionId,
    operation.outerCallId,
  )));
  const claimed = new Set(operations.flatMap((operation) => phaseRefs(operation).map((ref) => String(ref.rawId || ''))));

  for (const raw of rawEvents) {
    if (isOuterExecOutput(raw) && operationKeys.has(rawKey(raw))) claimed.add(String(raw.rawId || ''));
  }

  const ordered = [];
  for (const raw of rawEvents) {
    const rawId = String(raw?.rawId || '');
    if (rawId && claimed.delete(rawId)) ordered.push(rawId);
  }
  return [...ordered, ...claimed].filter(Boolean);
}

function deriveCodeModeFacts({ projection, rawEvents, logicalEvents, lifecycleTypes } = {}) {
  if (!(lifecycleTypes instanceof Set)) {
    throw new TypeError('lifecycleTypes must be an exact Set supplied by the caller');
  }

  const operations = Array.isArray(projection?.operations) ? projection.operations : [];
  const raws = Array.isArray(rawEvents) ? rawEvents : [];
  const events = Array.isArray(logicalEvents) ? logicalEvents : [];
  const rawById = new Map(raws.map((raw) => [String(raw?.rawId || ''), raw]));
  const phaseRefsByOperation = new Map(operations.map((operation) => [
    operation.id,
    phaseEventRefs(operation, events),
  ]));
  const phaseCallRawIds = new Set(operations.flatMap((operation) => (operation.phases || [])
    .map((phase) => String(phase?.callRef?.rawId || ''))
    .filter(Boolean)));
  const phaseEventIds = new Set(events
    .filter((event) => (event?.rawRefs || []).some((ref) => phaseCallRawIds.has(String(ref?.rawId || ''))))
    .map((event) => String(event.id || ''))
    .filter(Boolean));
  const nestedRefs = nestedEventRefsByOperation(
    operations,
    events,
    lifecycleTypes,
    rawById,
    phaseEventIds,
  );

  return {
    claimedRawPolicy: PRESENTATION_CLAIMED_RAW_POLICY,
    claimedRawIds: presentationClaimedRawIds(operations, raws),
    operationFacts: operations.map((operation) => ({
      operationId: operation.id,
      rawRefs: canonicalPhaseRefs(operation, rawById),
      searchableText: operationSearchableText(operation, rawById),
      eventRefs: [...(nestedRefs.get(operation.id) || [])],
      phaseEventRefs: phaseRefsByOperation.get(operation.id) || [],
    })),
  };
}

module.exports = {
  PRESENTATION_CLAIMED_RAW_POLICY,
  deriveCodeModeFacts,
  uniqueSearchableText,
};
