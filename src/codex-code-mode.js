'use strict';

const { stripAnsiSequences } = require('./shared/terminal-text');
const { isDynamicTransport } = require('./codex-tool-lifecycle-contract');
const { followsToolRequest, mergeToolTurn, scopedRequestToolName, toolRowMatchesTurn, turnBoundaryEpochs } = require('./codex-turn-items');

const OBSERVATION_STATES = Object.freeze({
  UNKNOWN: 'unknown',
  PENDING: 'pending',
  TERMINAL: 'terminal',
  UNOBSERVED_TERMINAL: 'unobserved_terminal',
});

const EVIDENCE_STATES = Object.freeze({
  CALL_ONLY: 'call_only',
  OUTPUT_OBSERVED: 'output_observed',
});

const PENDING_PREFIX = 'Script running with cell ID ';
const U64_MAX = 18446744073709551615n;
const TERMINAL_FIRST_LINES = new Set([
  'Script completed',
  'Script failed',
  'Script terminated',
  'Script timed out',
  'No script found',
]);
const ASSOCIATION_TEXT_TYPES = new Set(['input_text', 'output_text', 'text']);

function parsedPayload(raw) {
  const payload = raw?.parsed?.payload;
  return payload && typeof payload === 'object' ? payload : {};
}

function callIdFor(raw) {
  const payload = parsedPayload(raw);
  return String(raw?.callId || payload.call_id || payload.callId || '');
}

function toolNameFor(raw) {
  const payload = parsedPayload(raw);
  return String(raw?.toolName || payload.name || payload.tool_name || payload.tool || '');
}

function parseJsonContainer(value) {
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : value;
  } catch {
    return value;
  }
}

function textFromValue(value, seen = new Set()) {
  if (typeof value === 'string') return value;
  if (value == null || typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => textFromValue(item, seen)).filter(Boolean).join('\n');
  }

  if (typeof value.text === 'string') return value.text;

  const preferredKeys = ['content', 'output', 'value', 'result'];
  const preferredText = preferredKeys
    .filter((key) => Object.hasOwn(value, key))
    .map((key) => textFromValue(value[key], seen))
    .filter(Boolean)
    .join('\n');
  if (preferredText) return preferredText;

  return Object.entries(value)
    .filter(([key]) => key !== 'type')
    .map(([, item]) => textFromValue(item, seen))
    .filter(Boolean)
    .join('\n');
}

function codeModeOutputText(raw) {
  const payload = parsedPayload(raw);
  if (Object.hasOwn(payload, 'output')) return textFromValue(payload.output);
  return textFromValue(parseJsonContainer(raw?.output));
}

function publicCellId(value) {
  if (typeof value !== 'string') return '';
  // Preserve the historical reader's exact decimal spelling.
  if (/^[0-9]+$/.test(value)) return value;
  const qualified = /^g([1-9][0-9]{0,19}):([1-9][0-9]{0,19})$/.exec(value);
  if (!qualified) return '';
  // Binding 1 is unprefixed. The runtime returns the old cell counter only
  // after its checked u64 increment succeeds. Keep the full public identity.
  const generation = BigInt(qualified[1]);
  return generation >= 2n && generation <= U64_MAX && BigInt(qualified[2]) < U64_MAX ? value : '';
}

function pendingCellId(line) {
  return line.startsWith(PENDING_PREFIX) ? publicCellId(line.slice(PENDING_PREFIX.length)) : '';
}

function isOuterStatusEnvelope(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  if (!TERMINAL_FIRST_LINES.has(lines[0]) && !pendingCellId(lines[0])) return false;
  return lines.slice(1).every((line) => {
    const trimmed = line.trim();
    return !trimmed || /^Wall time\b/i.test(trimmed) || /^(?:Live )?Output:$/i.test(trimmed);
  });
}

function codeModeDisplayOutputText(raw) {
  const payload = parsedPayload(raw);
  const value = Object.hasOwn(payload, 'output') ? payload.output : parseJsonContainer(raw?.output);
  if (!Array.isArray(value)) return stripAnsiSequences(textFromValue(value));

  const fragments = value.map((item) => textFromValue(item)).filter(Boolean);
  if (fragments.length > 1 && isOuterStatusEnvelope(fragments[0])) fragments.shift();
  return stripAnsiSequences(fragments.join('\n'));
}

function codeModeAssociableOutputFragments(raw) {
  const payload = parsedPayload(raw);
  const value = Object.hasOwn(payload, 'output') ? payload.output : parseJsonContainer(raw?.output);
  if (!Array.isArray(value) || value.length < 2) return [];

  const fragments = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || !ASSOCIATION_TEXT_TYPES.has(String(item.type || '')) || typeof item.text !== 'string') {
      return [];
    }
    fragments.push(item.text);
  }

  if (fragments[0].split(/\r?\n/, 1)[0] !== 'Script completed' || !isOuterStatusEnvelope(fragments[0])) return [];
  const results = fragments.slice(1).map(stripAnsiSequences);
  return results.every((fragment) => fragment.length > 0) ? results : [];
}

function firstOutputLine(raw) {
  const text = codeModeOutputText(raw);
  if (!text) return '';
  return text.split(/\r?\n/, 1)[0];
}

function classifyObservedOutput(raw) {
  const firstLine = firstOutputLine(raw);
  const cellId = pendingCellId(firstLine);
  if (cellId) {
    return {
      observationState: OBSERVATION_STATES.PENDING,
      cellId,
    };
  }
  if (!TERMINAL_FIRST_LINES.has(firstLine)) {
    return {
      observationState: OBSERVATION_STATES.UNKNOWN,
      cellId: '',
    };
  }
  return {
    observationState: OBSERVATION_STATES.TERMINAL,
    cellId: '',
  };
}

function waitCellId(raw) {
  const payload = parsedPayload(raw);
  const value = Object.hasOwn(payload, 'arguments') ? payload.arguments : raw?.output;
  const args = parseJsonContainer(value);
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  return publicCellId(args.cell_id);
}

function isResponseItem(raw, payloadType) {
  return raw?.recordType === 'response_item' && raw.payloadType === payloadType;
}

function isDefaultNamespace(namespace) {
  return namespace == null || namespace === '' || namespace === 'functions';
}

function isExecCall(raw) {
  return isResponseItem(raw, 'custom_tool_call') && toolNameFor(raw) === 'exec'
    && isDefaultNamespace(parsedPayload(raw).namespace) && Boolean(callIdFor(raw));
}

function isExecOutput(raw) {
  return isResponseItem(raw, 'custom_tool_call_output') && Boolean(callIdFor(raw));
}

function isWaitCall(raw) {
  return isResponseItem(raw, 'function_call') && toolNameFor(raw) === 'wait'
    && isDefaultNamespace(parsedPayload(raw).namespace) && Boolean(callIdFor(raw));
}

function matchesNativeOutputIdentity(raw, name) {
  const payload = parsedPayload(raw);
  return (payload.name == null || payload.name === name) && isDefaultNamespace(payload.namespace);
}

function isWaitOutput(raw) {
  return isResponseItem(raw, 'function_call_output') && Boolean(callIdFor(raw));
}

function eventType(raw) {
  return String(raw?.canonicalType || raw?.payloadType || '');
}

function isTurnBoundary(raw) {
  return ['task_started', 'turn_started', 'task_complete', 'turn_complete', 'turn_aborted'].includes(eventType(raw));
}

function sessionKey(raw) {
  return String(raw?.sessionId || '');
}

function callKey(raw) {
  return `${sessionKey(raw)}\u0000${callIdFor(raw)}`;
}

function physicalRef(entry) {
  const raw = entry.raw;
  return {
    rawId: String(raw?.rawId || ''),
    file: String(raw?.source?.file || ''),
    line: raw?._historyChainId
      ? raw.source?.line != null && Number.isFinite(Number(raw.source.line)) ? Number(raw.source.line) : null
      : raw?.line != null && Number.isFinite(Number(raw.line)) ? Number(raw.line) : null,
  };
}

function physicalSpan(callEntry, outputEntry) {
  if (!outputEntry || outputEntry.position < callEntry.position) return null;
  // A uniquely paired late output is still observed output, but a physical
  // interval across a turn boundary cannot establish nested-tool ownership.
  if (callEntry.turnBoundaryEpoch !== outputEntry.turnBoundaryEpoch) return null;
  const callRef = physicalRef(callEntry);
  const outputRef = physicalRef(outputEntry);
  // Only the source reader can admit this marker after verifying every physical
  // segment and cutoff. File/line locators stay physical; span order is logical.
  const historySessionId = callEntry.raw?._historyChainId;
  if (historySessionId && outputEntry.raw?._historyChainId === historySessionId
      && callEntry.raw.sessionId === outputEntry.raw.sessionId) {
    const startLine = Number(callEntry.raw.line);
    const endLine = Number(outputEntry.raw.line);
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine <= startLine) return null;
    return { file: '', historySessionId, startLine, endLine,
      startRawId: callRef.rawId, endRawId: outputRef.rawId };
  }
  if (!callRef.file || callRef.file !== outputRef.file) return null;
  if (!Number.isFinite(callRef.line) || !Number.isFinite(outputRef.line)) return null;
  if (outputRef.line <= callRef.line) return null;
  return {
    file: callRef.file,
    startLine: callRef.line,
    endLine: outputRef.line,
    startRawId: callRef.rawId,
    endRawId: outputRef.rawId,
  };
}

function makePhase(kind, callEntry, outputEntry, targetCellId = '') {
  const span = physicalSpan(callEntry, outputEntry);
  const pairedOutput = outputEntry || null;
  const observed = pairedOutput ? classifyObservedOutput(pairedOutput.raw) : null;
  return {
    kind,
    callId: callIdFor(callEntry.raw),
    targetCellId,
    evidenceState: pairedOutput ? EVIDENCE_STATES.OUTPUT_OBSERVED : EVIDENCE_STATES.CALL_ONLY,
    observationState: observed?.observationState || OBSERVATION_STATES.UNKNOWN,
    observedCellId: observed?.cellId || '',
    callRef: physicalRef(callEntry),
    outputRef: pairedOutput ? physicalRef(pairedOutput) : null,
    span,
  };
}

function addWireEntry(groups, entry, side) {
  const group = groups.get(callKey(entry.raw));
  if (group) group[side].push(entry);
}

function isolateWireGroup(group, isolatedRawIds) {
  for (const entry of group.calls) isolatedRawIds.add(entry.raw.rawId);
  for (const entry of group.outputs) isolatedRawIds.add(entry.raw.rawId);
}

function filterScopedOutputs(group, name, isolatedRawIds, epochs, turnId = '') {
  const call = group.calls[0].raw;
  group.outputs = group.outputs.filter(({ raw }) => {
    if (matchesNativeOutputIdentity(raw, name) && followsToolRequest(call, raw, epochs)
        && (!turnId || toolRowMatchesTurn(raw, turnId))) return true;
    isolatedRawIds.add(raw.rawId);
    return false;
  });
  if (group.outputs.length > 1) isolateWireGroup(group, isolatedRawIds);
}

function isolateConflictingIdentities(groups, nativeCall, name, isolatedRawIds, scopedKeys, epochs) {
  for (const [key, group] of groups) {
    const { calls } = group;
    if (scopedKeys.has(key)) {
      if (calls.length === 1) {
        // A wait can also use its pending cell's turn when it is observed.
        if (name !== 'wait') filterScopedOutputs(group, name, isolatedRawIds, epochs);
        continue;
      }
    } else if (calls.every(entry => nativeCall(entry.raw))
        && group.outputs.every(entry => matchesNativeOutputIdentity(entry.raw, name))) continue;
    // An unqualified output has no safe owner in a mixed request group. Keep
    // these physical rows separate through the generic call-id fallback too.
    isolateWireGroup(group, isolatedRawIds);
  }
}

function pairingFor(callEntry, groups, isolatedRawIds) {
  const { calls, outputs } = groups.get(callKey(callEntry.raw));
  if (calls.length !== 1 || outputs.length > 1) return { output: null, reason: 'ambiguous_call_id' };
  if (!outputs.length) return { output: null, reason: 'missing_output' };
  if (isolatedRawIds.has(callEntry.raw.rawId)) return { output: null, reason: 'conflicting_output_identity' };
  if (outputs[0].position < callEntry.position) return { output: null, reason: 'output_before_call' };
  return { output: outputs[0], reason: '' };
}

function phaseSpanSummary(phase, phaseIndex) {
  if (!phase.span) return null;
  return {
    phaseIndex,
    kind: phase.kind,
    callId: phase.callId,
    ...phase.span,
  };
}

function finalizeOperation(operation) {
  operation.phaseSpans = operation.phases
    .map(phaseSpanSummary)
    .filter(Boolean);
  delete operation.activeWaitPhase;
  return operation;
}

function projectCodeModeOperations(rawEvents, epochs) {
  const entries = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((raw, inputIndex) => ({ raw, inputIndex }))
    .sort((left, right) => {
      const leftLine = left.raw?.line == null ? Number.NaN : Number(left.raw.line);
      const rightLine = right.raw?.line == null ? Number.NaN : Number(right.raw.line);
      if (Number.isFinite(leftLine) && Number.isFinite(rightLine) && leftLine !== rightLine) return leftLine - rightLine;
      return left.inputIndex - right.inputIndex;
    })
    .map((entry, position) => ({ ...entry, position }));

  const customGroups = new Map();
  const functionGroups = new Map();
  const scopedKeys = new Set();
  const turnScopes = new Map();

  // Collect peers only for IDs a native Code Mode request could own.
  for (const { raw } of entries) {
    if (isExecCall(raw)) customGroups.set(callKey(raw), { calls: [], outputs: [] });
    else if (isWaitCall(raw)) functionGroups.set(callKey(raw), { calls: [], outputs: [] });
    else if (scopedRequestToolName(raw)) scopedKeys.add(callKey(raw));
  }

  for (const entry of entries) {
    const key = sessionKey(entry.raw);
    const scope = turnScopes.get(key) || { epoch: 0, turnId: '' };
    const turnId = isDynamicTransport(entry.raw) ? '' : String(entry.raw?.turnId || '');
    if (isTurnBoundary(entry.raw) || (turnId && scope.turnId && turnId !== scope.turnId)) scope.epoch += 1;
    if (turnId) scope.turnId = turnId;
    entry.turnBoundaryEpoch = scope.epoch;
    turnScopes.set(key, scope);
    const { raw } = entry;
    if (isResponseItem(raw, 'custom_tool_call')) addWireEntry(customGroups, entry, 'calls');
    else if (isExecOutput(raw)) addWireEntry(customGroups, entry, 'outputs');
    else if (isResponseItem(raw, 'function_call')) addWireEntry(functionGroups, entry, 'calls');
    else if (isWaitOutput(raw)) addWireEntry(functionGroups, entry, 'outputs');
  }

  const isolatedRawIds = new Set();
  if (scopedKeys.size && !epochs) epochs = turnBoundaryEpochs(entries.map(entry => entry.raw));
  isolateConflictingIdentities(customGroups, isExecCall, 'exec', isolatedRawIds, scopedKeys, epochs);
  isolateConflictingIdentities(functionGroups, isWaitCall, 'wait', isolatedRawIds, scopedKeys, epochs);
  const operations = [];
  const operationByExecOutputPosition = new Map();
  const operationByWaitOutputPosition = new Map();
  const operationTurnScopes = new Map();
  const unassociatedWaits = [];

  for (const entry of entries.filter((candidate) => isExecCall(candidate.raw))) {
    const pairing = pairingFor(entry, customGroups, isolatedRawIds);
    const execPhase = makePhase('exec', entry, pairing.output);
    const raw = entry.raw;
    const operation = {
      id: `${sessionKey(raw)}:code-mode:${callIdFor(raw)}:${physicalRef(entry).line ?? entry.inputIndex}`,
      sessionId: sessionKey(raw),
      outerCallId: callIdFor(raw),
      turnId: String(raw?.turnId || ''),
      cellId: '',
      evidenceState: execPhase.evidenceState,
      observationState: OBSERVATION_STATES.UNKNOWN,
      pairingIssue: pairing.reason,
      phases: [execPhase],
      phaseSpans: [],
      activeWaitPhase: null,
    };
    operations.push(operation);
    operationTurnScopes.set(operation.id, { epoch: entry.turnBoundaryEpoch, turnId: mergeToolTurn('', raw) });
    if (pairing.output) operationByExecOutputPosition.set(pairing.output.position, {
      operation,
      turnBoundaryEpoch: entry.turnBoundaryEpoch,
    });
  }

  function pendingOperationsFor(sessionId, cellId) {
    return operations.filter((operation) => operation.sessionId === sessionId
      && operation.cellId === cellId
      && operation.observationState === OBSERVATION_STATES.PENDING);
  }

  function markPendingOperationsUnobserved(entry) {
    const raw = entry.raw;
    if (isDynamicTransport(raw)) return;
    const currentSession = sessionKey(raw);
    for (const operation of operations) {
      if (operation.sessionId !== currentSession || operation.observationState !== OBSERVATION_STATES.PENDING) continue;
      const changedTurn = Boolean(raw?.turnId && operation.turnId && raw.turnId !== operation.turnId);
      if (isTurnBoundary(raw) || changedTurn
          || operationTurnScopes.get(operation.id).epoch !== entry.turnBoundaryEpoch) {
        operation.observationState = OBSERVATION_STATES.UNOBSERVED_TERMINAL;
        operation.activeWaitPhase = null;
      }
    }
  }

  for (const entry of entries) {
    // Scope transitions precede output observation, including a result whose
    // own explicit turn ID is the first available evidence of the transition.
    markPendingOperationsUnobserved(entry);
    const execResult = operationByExecOutputPosition.get(entry.position);
    if (execResult) {
      const { operation: execOperation, turnBoundaryEpoch } = execResult;
      const execPhase = execOperation.phases[0];
      execOperation.observationState = execPhase.observationState;
      if (execPhase.observationState === OBSERVATION_STATES.PENDING) {
        const scope = operationTurnScopes.get(execOperation.id);
        scope.turnId = mergeToolTurn(scope.turnId, entry.raw);
        execOperation.cellId = execPhase.observedCellId;
        if (turnBoundaryEpoch !== entry.turnBoundaryEpoch) {
          execOperation.observationState = OBSERVATION_STATES.UNOBSERVED_TERMINAL;
        }
      }
    }

    if (isWaitCall(entry.raw)) {
      const targetCellId = waitCellId(entry.raw);
      const candidates = targetCellId ? pendingOperationsFor(sessionKey(entry.raw), targetCellId) : [];
      const key = callKey(entry.raw);
      const group = functionGroups.get(key);
      let reason = '';
      if (scopedKeys.has(key) && group.calls.length === 1) {
        const waitTurn = mergeToolTurn(epochs.get(entry.raw.rawId)?.turnId || '', entry.raw);
        const cellTurn = candidates.length === 1 ? operationTurnScopes.get(candidates[0].id).turnId : '';
        if (waitTurn === null || cellTurn === null || (waitTurn && cellTurn && waitTurn !== cellTurn)) {
          // Even a call-only wait would reserve the matching cell for this turn.
          reason = 'conflicting_request_turn';
          isolateWireGroup(group, isolatedRawIds);
        } else {
          filterScopedOutputs(group, 'wait', isolatedRawIds, epochs, waitTurn || cellTurn);
        }
      }
      const pairing = pairingFor(entry, functionGroups, isolatedRawIds);
      const phase = makePhase('wait', entry, pairing.output, targetCellId);
      if (!reason && ['ambiguous_call_id', 'conflicting_output_identity'].includes(pairing.reason)) reason = pairing.reason;
      if (!reason && !targetCellId) reason = 'invalid_cell_id';
      if (!reason && candidates.length === 0) reason = 'orphan_cell';
      if (!reason && candidates.length > 1) reason = 'ambiguous_cell';
      if (!reason && candidates[0].activeWaitPhase) reason = 'concurrent_wait';

      if (reason) {
        unassociatedWaits.push({ reason, phase });
      } else {
        const operation = candidates[0];
        const scope = operationTurnScopes.get(operation.id);
        scope.turnId = mergeToolTurn(scope.turnId, entry.raw);
        operation.phases.push(phase);
        operation.activeWaitPhase = phase;
        if (pairing.output) operationByWaitOutputPosition.set(pairing.output.position, { operation, phase });
      }
    }

    const waitResult = operationByWaitOutputPosition.get(entry.position);
    if (waitResult) {
      const { operation, phase } = waitResult;
      operation.activeWaitPhase = null;
      if (operation.observationState === OBSERVATION_STATES.PENDING) {
        if (phase.observationState === OBSERVATION_STATES.TERMINAL) {
          operation.observationState = OBSERVATION_STATES.TERMINAL;
        } else if (phase.observationState === OBSERVATION_STATES.PENDING
          && phase.observedCellId === operation.cellId) {
          const scope = operationTurnScopes.get(operation.id);
          scope.turnId = mergeToolTurn(scope.turnId, entry.raw);
          operation.observationState = OBSERVATION_STATES.PENDING;
        } else if (phase.observationState === OBSERVATION_STATES.PENDING) {
          phase.observationState = OBSERVATION_STATES.UNKNOWN;
        }
      }
    }

  }

  return {
    operations: operations.map(finalizeOperation),
    unassociatedWaits,
    isolatedRawIds,
  };
}

module.exports = {
  EVIDENCE_STATES,
  OBSERVATION_STATES,
  classifyObservedOutput,
  codeModeAssociableOutputFragments,
  codeModeDisplayOutputText,
  codeModeOutputText,
  isExecCall,
  projectCodeModeOperations,
  waitCellId,
};
