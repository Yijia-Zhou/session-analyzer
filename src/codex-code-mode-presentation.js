'use strict';

const {
  knownCodeModeToolNames,
  projectDeclaredCodeModeCalls,
} = require('./codex-code-mode-declared');

const CODE_MODE_OPERATION_KIND = 'code_mode_operation';
const CODE_MODE_SCRIPT_OPERATION_KIND = 'code_mode_script_operation';
const CODE_MODE_REQUEST_EVIDENCE = 'declared_source';
const CODE_MODE_REQUEST_PATTERN = /^[a-z][a-z0-9_]*$/;
const KNOWN_CODE_MODE_REQUESTS = new Set(knownCodeModeToolNames());

function normalizeCodeModeRequest(value) {
  const request = String(value || '').trim();
  return CODE_MODE_REQUEST_PATTERN.test(request) && KNOWN_CODE_MODE_REQUESTS.has(request) ? request : '';
}

function codeModeExecPhase(event = {}) {
  const eventId = String(event.id || '');
  if (event.layer !== 'main'
      || event.kind !== CODE_MODE_OPERATION_KIND
      || !eventId
      || String(event.codeModeOperation?.id || '') !== eventId) return null;
  const phases = event.codeModeOperation?.phases;
  if (!Array.isArray(phases)) return null;
  const execPhases = phases.filter((phase) => phase?.kind === 'exec');
  return execPhases.length === 1 ? execPhases[0] : null;
}

function codeModeOperationExecSource(operation, rawById) {
  if (!(rawById instanceof Map)) return '';
  const execPhases = Array.isArray(operation?.phases)
    ? operation.phases.filter((phase) => phase?.kind === 'exec')
    : [];
  if (execPhases.length !== 1) return '';
  const execPhase = execPhases[0];
  const rawId = String(execPhase?.callRef?.rawId || '');
  if (!rawId) return '';
  const raw = rawById.get(rawId);
  const payload = raw?.parsed?.payload;
  const callId = String(execPhase?.callId || '');
  if (raw?.recordType !== 'response_item'
      || raw?.payloadType !== 'custom_tool_call'
      || raw?.toolName !== 'exec'
      || payload?.name !== 'exec'
      || !callId
      || String(raw?.callId || '') !== callId
      || String(operation?.outerCallId || '') !== callId) return '';
  const source = Object.hasOwn(payload, 'input') ? payload.input : raw.output;
  return typeof source === 'string' ? source : '';
}

function codeModeExecSource(event, rawById) {
  if (!codeModeExecPhase(event)) return '';
  return codeModeOperationExecSource(event.codeModeOperation, rawById);
}

function uniqueToolNames(calls) {
  const names = [];
  const seen = new Set();
  for (const call of calls || []) {
    const name = String(call?.toolName || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function codeModeDeclaredRequestFact(event, rawById, options = {}) {
  const source = codeModeExecSource(event, rawById);
  if (!source) return null;
  const projector = options.projector || projectDeclaredCodeModeCalls;
  const projection = projector(source);
  if (!projection?.supported) return null;
  const toolNames = uniqueToolNames(projection.calls);
  if (!toolNames.length) return null;
  return {
    toolNames,
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE,
  };
}

function buildCodeModePresentationIndexes(session = {}, options = {}) {
  const rawById = new Map((session.rawEvents || [])
    .map((raw) => [String(raw?.rawId || ''), raw])
    .filter(([rawId]) => rawId));
  const codeModeDeclaredRequests = new Map();
  for (const event of session.logicalEvents || []) {
    if (event?.layer !== 'main'
        || event?.kind !== CODE_MODE_OPERATION_KIND
        || !String(event?.id || '')
        || String(event?.codeModeOperation?.id || '') !== String(event?.id || '')) continue;
    const fact = codeModeDeclaredRequestFact(event, rawById, options);
    if (fact) codeModeDeclaredRequests.set(String(event.id || ''), fact);
  }
  return { codeModeDeclaredRequests };
}

function codeModeDeclaredRequestFactForEvent(session = {}, eventId = '') {
  const index = session.presentationIndexes?.codeModeDeclaredRequests;
  return index instanceof Map ? index.get(String(eventId || '')) || null : null;
}

function isCodeModeScriptOperation(event = {}, presentationIndexes) {
  if (event.layer !== 'main' || event.kind !== CODE_MODE_OPERATION_KIND) return false;
  const index = presentationIndexes?.codeModeDeclaredRequests;
  return !(index instanceof Map) || !index.has(String(event.id || ''));
}

function codeModePresentationFactsForEvent(session = {}, eventId = '') {
  const fact = codeModeDeclaredRequestFactForEvent(session, eventId);
  if (!fact) return null;
  return {
    codeModeDeclaredRequests: {
      toolNames: [...fact.toolNames],
      requestEvidence: fact.requestEvidence,
    },
  };
}

function codeModeRequestCatalog(sessions, options = {}) {
  const counts = new Map();
  for (const session of sessions || []) {
    const index = session?.presentationIndexes?.codeModeDeclaredRequests;
    if (!(index instanceof Map)) continue;
    for (const fact of index.values()) {
      for (const toolName of new Set(fact?.toolNames || [])) {
        const value = String(toolName || '').trim();
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
  }
  const label = typeof options.label === 'function' ? options.label : (value) => value;
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: String(label(value) || value),
      count,
      evidence: CODE_MODE_REQUEST_EVIDENCE,
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
}

module.exports = {
  CODE_MODE_OPERATION_KIND,
  CODE_MODE_SCRIPT_OPERATION_KIND,
  CODE_MODE_REQUEST_EVIDENCE,
  buildCodeModePresentationIndexes,
  codeModeDeclaredRequestFact,
  codeModeDeclaredRequestFactForEvent,
  codeModeExecPhase,
  codeModeExecSource,
  codeModeOperationExecSource,
  codeModePresentationFactsForEvent,
  codeModeRequestCatalog,
  isCodeModeScriptOperation,
  normalizeCodeModeRequest,
};
