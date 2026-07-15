'use strict';

const { stripAnsiSequences } = require('./shared/terminal-text');

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

const PENDING_FIRST_LINE = /^Script running with cell ID ([0-9]+)$/;
const PENDING_LIKE_FIRST_LINE = /^Script running with cell ID\b/;
const TERMINAL_FIRST_LINES = new Set([
  'Script completed',
  'Script failed',
  'Script terminated',
  'Script timed out',
  'No script found',
]);

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

function isOuterStatusEnvelope(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  if (!TERMINAL_FIRST_LINES.has(lines[0]) && !PENDING_FIRST_LINE.test(lines[0])) return false;
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

function firstOutputLine(raw) {
  const text = codeModeOutputText(raw);
  if (!text) return '';
  return text.split(/\r?\n/, 1)[0];
}

function classifyObservedOutput(raw) {
  const firstLine = firstOutputLine(raw);
  const pendingMatch = PENDING_FIRST_LINE.exec(firstLine);
  if (pendingMatch) {
    return {
      observationState: OBSERVATION_STATES.PENDING,
      cellId: pendingMatch[1],
    };
  }
  if (!TERMINAL_FIRST_LINES.has(firstLine) || PENDING_LIKE_FIRST_LINE.test(firstLine)) {
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
  return typeof args.cell_id === 'string' && /^[0-9]+$/.test(args.cell_id)
    ? args.cell_id
    : '';
}

function isResponseItem(raw, payloadType) {
  return raw?.recordType === 'response_item' && raw.payloadType === payloadType;
}

function isExecCall(raw) {
  return isResponseItem(raw, 'custom_tool_call') && toolNameFor(raw) === 'exec' && Boolean(callIdFor(raw));
}

function isExecOutput(raw) {
  return isResponseItem(raw, 'custom_tool_call_output') && Boolean(callIdFor(raw));
}

function isWaitCall(raw) {
  return isResponseItem(raw, 'function_call') && toolNameFor(raw) === 'wait' && Boolean(callIdFor(raw));
}

function isWaitOutput(raw) {
  return isResponseItem(raw, 'function_call_output') && Boolean(callIdFor(raw));
}

function eventType(raw) {
  return String(raw?.canonicalType || raw?.payloadType || '');
}

function isTurnBoundary(raw) {
  return ['task_started', 'turn_started', 'task_complete', 'turn_complete'].includes(eventType(raw));
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
    line: raw?.line != null && Number.isFinite(Number(raw.line)) ? Number(raw.line) : null,
  };
}

function physicalSpan(callEntry, outputEntry) {
  if (!outputEntry || outputEntry.position < callEntry.position) return null;
  const callRef = physicalRef(callEntry);
  const outputRef = physicalRef(outputEntry);
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

function addToBucket(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function pairingFor(callEntry, callsByKey, outputsByKey) {
  const key = callKey(callEntry.raw);
  const calls = callsByKey.get(key) || [];
  const outputs = outputsByKey.get(key) || [];
  if (calls.length !== 1 || outputs.length > 1) return { output: null, reason: 'ambiguous_call_id' };
  if (!outputs.length) return { output: null, reason: 'missing_output' };
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

function projectCodeModeOperations(rawEvents) {
  const entries = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((raw, inputIndex) => ({ raw, inputIndex }))
    .sort((left, right) => {
      const leftLine = left.raw?.line == null ? Number.NaN : Number(left.raw.line);
      const rightLine = right.raw?.line == null ? Number.NaN : Number(right.raw.line);
      if (Number.isFinite(leftLine) && Number.isFinite(rightLine) && leftLine !== rightLine) return leftLine - rightLine;
      return left.inputIndex - right.inputIndex;
    })
    .map((entry, position) => ({ ...entry, position }));

  const execCallsByKey = new Map();
  const execOutputsByKey = new Map();
  const waitCallsByKey = new Map();
  const waitOutputsByKey = new Map();

  for (const entry of entries) {
    if (isExecCall(entry.raw)) addToBucket(execCallsByKey, callKey(entry.raw), entry);
    if (isExecOutput(entry.raw)) addToBucket(execOutputsByKey, callKey(entry.raw), entry);
    if (isWaitCall(entry.raw)) addToBucket(waitCallsByKey, callKey(entry.raw), entry);
    if (isWaitOutput(entry.raw)) addToBucket(waitOutputsByKey, callKey(entry.raw), entry);
  }

  const operations = [];
  const operationByExecOutputPosition = new Map();
  const operationByWaitOutputPosition = new Map();
  const unassociatedWaits = [];

  for (const entry of entries.filter((candidate) => isExecCall(candidate.raw))) {
    const pairing = pairingFor(entry, execCallsByKey, execOutputsByKey);
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
    if (pairing.output) operationByExecOutputPosition.set(pairing.output.position, operation);
  }

  function pendingOperationsFor(sessionId, cellId) {
    return operations.filter((operation) => operation.sessionId === sessionId
      && operation.cellId === cellId
      && operation.observationState === OBSERVATION_STATES.PENDING);
  }

  function markPendingOperationsUnobserved(entry) {
    const raw = entry.raw;
    const currentSession = sessionKey(raw);
    for (const operation of operations) {
      if (operation.sessionId !== currentSession || operation.observationState !== OBSERVATION_STATES.PENDING) continue;
      const changedTurn = Boolean(raw?.turnId && operation.turnId && raw.turnId !== operation.turnId);
      if (isTurnBoundary(raw) || changedTurn) {
        operation.observationState = OBSERVATION_STATES.UNOBSERVED_TERMINAL;
        operation.activeWaitPhase = null;
      }
    }
  }

  for (const entry of entries) {
    const execOperation = operationByExecOutputPosition.get(entry.position);
    if (execOperation) {
      const execPhase = execOperation.phases[0];
      execOperation.observationState = execPhase.observationState;
      if (execPhase.observationState === OBSERVATION_STATES.PENDING) {
        execOperation.cellId = execPhase.observedCellId;
      }
    }

    if (isWaitCall(entry.raw)) {
      markPendingOperationsUnobserved(entry);
      const pairing = pairingFor(entry, waitCallsByKey, waitOutputsByKey);
      const targetCellId = waitCellId(entry.raw);
      const phase = makePhase('wait', entry, pairing.output, targetCellId);
      let reason = pairing.reason === 'ambiguous_call_id' ? pairing.reason : '';
      const candidates = targetCellId ? pendingOperationsFor(sessionKey(entry.raw), targetCellId) : [];
      if (!reason && !targetCellId) reason = 'invalid_cell_id';
      if (!reason && candidates.length === 0) reason = 'orphan_cell';
      if (!reason && candidates.length > 1) reason = 'ambiguous_cell';
      if (!reason && candidates[0].activeWaitPhase) reason = 'concurrent_wait';

      if (reason) {
        unassociatedWaits.push({ reason, phase });
      } else {
        const operation = candidates[0];
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
          operation.observationState = OBSERVATION_STATES.PENDING;
        } else if (phase.observationState === OBSERVATION_STATES.PENDING) {
          phase.observationState = OBSERVATION_STATES.UNKNOWN;
        }
      }
    }

    if (!isWaitCall(entry.raw)) markPendingOperationsUnobserved(entry);
  }

  return {
    operations: operations.map(finalizeOperation),
    unassociatedWaits,
  };
}

module.exports = {
  EVIDENCE_STATES,
  OBSERVATION_STATES,
  classifyObservedOutput,
  codeModeDisplayOutputText,
  codeModeOutputText,
  projectCodeModeOperations,
  waitCellId,
};
