'use strict';

// Audited against Codex 624ccf794703e2d84e748fc3ef547d6191a8c0a4.
// This is a native FORMAT profile, not a guessed semver compatibility range.
const PROFILE = 'native-local-direct-v1';
const TERMINAL_TOOLS = new Set(['exec_command', 'write_stdin']);
const PASSIVE_EVENTS = new Set([
  'task_started', 'task_complete', 'turn_started', 'turn_complete', 'token_count',
  'user_message', 'agent_message', 'agent_reasoning', 'agent_reasoning_raw_content',
  'thread_settings_applied',
]);

function i32(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

// JSON.parse alone accepts duplicate keys that the native typed request rejects.
function uniqueArguments(text) {
  if (typeof text !== 'string') return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]]/g;
  const keys = new Set();
  let depth = 0;
  let match;
  while ((match = tokens.exec(text))) {
    const token = match[0];
    if (token === '{' || token === '[') depth += 1;
    else if (token === '}' || token === ']') depth -= 1;
    else if (depth === 1 && /^\s*:/.test(text.slice(tokens.lastIndex))) {
      const key = JSON.parse(token);
      if (keys.has(key)) return null;
      keys.add(key);
    }
  }
  return value;
}

function terminalSourceEvidence(record) {
  const payload = record?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'barrier';
  // The audited initial scope is non-paginated, non-inherited local history.
  if (Object.hasOwn(record, 'ordinal')) return 'barrier';
  if (record.type === 'session_meta') {
    return typeof payload.id === 'string' && payload.id.length > 0
      && payload.session_id === payload.id
      && payload.originator === 'codex_cli_rs'
      && typeof payload.cli_version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(payload.cli_version)
      && ['cli', 'exec'].includes(payload.source)
      && (payload.history_mode == null || payload.history_mode === 'legacy')
      && !payload.forked_from_id && !payload.parent_thread_id && !payload.history_base
      && payload.forked_from_ordinal_exclusive == null && payload.subagent_history_start_ordinal == null
      && (payload.dynamic_tools == null || (Array.isArray(payload.dynamic_tools) && !payload.dynamic_tools.length))
      ? PROFILE : 'barrier';
  }
  if (record.type === 'response_item') {
    if (payload.type === 'function_call') {
      const args = uniqueArguments(payload.arguments);
      if (!TERMINAL_TOOLS.has(payload.name) || payload.namespace != null
          || typeof payload.call_id !== 'string' || !payload.call_id || !args) return 'barrier';
      if (payload.name === 'exec_command') return typeof args.cmd === 'string' ? undefined : 'barrier';
      return i32(args.session_id) && (!Object.hasOwn(args, 'chars') || typeof args.chars === 'string')
        ? undefined : 'barrier';
    }
    if (payload.type === 'function_call_output') {
      return typeof payload.call_id === 'string' && payload.call_id
        && typeof payload.output === 'string' && payload.namespace == null ? undefined : 'barrier';
    }
    if (payload.type === 'message' && ['user', 'assistant', 'developer', 'system'].includes(payload.role)) return undefined;
    if (payload.type === 'reasoning') return undefined;
    return 'barrier';
  }
  if (record.type === 'event_msg') return PASSIVE_EVENTS.has(payload.type) ? undefined : 'barrier';
  if (['turn_context', 'token_usage_record', 'world_state'].includes(record.type)) return undefined;
  return 'barrier';
}

function parseTerminalReceipt(text) {
  if (typeof text !== 'string') return null;
  // Only the native formatter prefix is evidence. Never scan the output body.
  const match = text.match(/^(?:Chunk ID: [A-Za-z0-9_-]{1,128}\n)?Wall time: (?:0|[1-9]\d*)\.\d{4} seconds\nProcess (running with session ID|exited with code) (-?(?:0|[1-9]\d*))\n(?:Original token count: (?:0|[1-9]\d*)\n)?Output:\n/);
  if (!match || !i32(Number(match[2])) || String(Number(match[2])) !== match[2]) return null;
  return match[1] === 'running with session ID' ? { processId: Number(match[2]) } : { exitCode: Number(match[2]) };
}

function commandPreview(text) {
  return Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 160).join('');
}

function buildTerminalContinuations(session) {
  const backgroundTerminalOrigins = new Map();
  const backgroundTerminalContinuations = new Map();
  const result = { backgroundTerminalOrigins, backgroundTerminalContinuations };
  if (session.forkedFromSessionId || session.parentSessionId || session.forkStorageMode === 'materialized') return result;
  if (!(session.rawEvents || []).some((raw) => raw.line === 1 && raw.terminalSourceEvidence === PROFILE)) return result;
  const raws = (session.rawEvents || []).slice().sort((a, b) => a.line - b.line);
  if (raws[0]?.line !== 1 || raws[0]?.terminalSourceEvidence !== PROFILE) return result;
  const sourceFile = raws[0].source?.file;
  let cutoff = Infinity;
  let previousLine = 0;
  let sawRequest = false;
  for (const raw of raws) {
    if (!Number.isSafeInteger(raw.line) || raw.line <= previousLine || raw.sourceKind !== 'codex'
        || raw.source?.file !== sourceFile || raw.sessionId !== raws[0].sessionId) return result;
    if (raw.line !== previousLine + 1) cutoff = Math.min(cutoff, raw.line);
    previousLine = raw.line;
    if (raw.terminalSourceEvidence === 'barrier' || (raw !== raws[0] && raw.recordType === 'session_meta')) {
      cutoff = Math.min(cutoff, raw.line);
    }
    // Initial settings are safe before any producer. Later settings may mark a
    // resumed runtime; do not treat them as proof of manager continuity.
    if (raw.recordType === 'event_msg' && raw.payloadType === 'thread_settings_applied' && sawRequest) cutoff = Math.min(cutoff, raw.line);
    if (raw.recordType === 'response_item' && raw.payloadType === 'function_call') sawRequest = true;
  }
  const ownerByRaw = new Map();
  for (const event of session.logicalEvents || []) {
    for (const ref of event.rawRefs || []) {
      ownerByRaw.set(ref.rawId, ownerByRaw.has(ref.rawId) ? null : event);
    }
  }
  const groups = new Map();
  for (const raw of raws) {
    if (!raw.callId || raw.recordType !== 'response_item') continue;
    if (!groups.has(raw.callId)) groups.set(raw.callId, []);
    groups.get(raw.callId).push(raw);
  }
  const calls = [];
  for (const group of groups.values()) {
    const requests = group.filter((raw) => raw.payloadType === 'function_call');
    const outputs = group.filter((raw) => raw.payloadType === 'function_call_output');
    if (requests.length !== 1 || outputs.length > 1 || group.length !== requests.length + outputs.length) {
      cutoff = Math.min(cutoff, group[0].line);
      continue;
    }
    const request = requests[0];
    const output = outputs[0];
    if (output && output.line <= request.line) { cutoff = Math.min(cutoff, output.line); continue; }
    if (output?.toolName && output.toolName !== request.toolName) { cutoff = Math.min(cutoff, output.line); continue; }
    const args = uniqueArguments(request.output);
    const event = ownerByRaw.get(request.rawId);
    const owned = event?.sourceKind === 'codex' && event.layer === 'main' && event.toolName === request.toolName
      && output && ownerByRaw.get(output.rawId) === event && event.rawRefs.length === 2;
    calls.push({ request, output, start: request.line, end: output?.line ?? Infinity,
      event: owned ? event : null, processId: args?.session_id,
      preview: request.toolName === 'exec_command' && typeof args?.cmd === 'string' ? commandPreview(args.cmd) : '',
      receipt: parseTerminalReceipt(output?.output), validArgs: Boolean(args), overlap: false });
  }
  calls.sort((a, b) => a.start - b.start);
  let creatorEnd = 0;
  let generation = 0;
  const lastWrite = new Map();
  for (const call of calls) {
    if (call.request.toolName === 'exec_command') {
      call.generation = ++generation;
      call.overlap = creatorEnd >= call.start;
      creatorEnd = Math.max(creatorEnd, call.end);
    } else if (call.request.toolName === 'write_stdin') {
      const previous = lastWrite.get(call.processId);
      if (previous && previous.end >= call.start) { previous.overlap = true; call.overlap = true; }
      if (!previous || previous.end < call.end) lastWrite.set(call.processId, call);
    }
  }
  const byRequest = new Map(calls.map((call) => [call.request.rawId, call]));
  const byOutput = new Map(calls.filter((call) => call.output).map((call) => [call.output.rawId, call]));
  let active = null;
  generation = 0;
  for (const raw of raws) {
    if (raw.line >= cutoff) break;
    const request = byRequest.get(raw.rawId);
    if (request?.request.toolName === 'exec_command') {
      generation = request.generation;
      active = null; // Any creation invalidates all older candidates, even another ID.
    } else if (request) {
      request.origin = active?.receipt.processId === request.processId ? active : null;
    }
    const call = byOutput.get(raw.rawId);
    if (!call) continue;
    if (call.request.toolName === 'exec_command') {
      if (call.event && call.validArgs && !call.overlap && call.generation === generation && call.receipt?.processId != null) active = call;
      continue;
    }
    if (call.request.toolName !== 'write_stdin') continue;
    const accessed = call.receipt && (call.receipt.processId === call.processId || call.receipt.exitCode != null);
    if (call.event && !call.overlap && call.origin && call.origin === active && accessed) {
      backgroundTerminalContinuations.set(call.event.id, { originEventId: active.event.id });
      backgroundTerminalOrigins.set(active.event.id, { processId: active.receipt.processId, commandPreview: active.preview });
    }
    if (active?.receipt.processId === call.processId && (!accessed || call.receipt.exitCode != null)) active = null;
  }
  return result;
}

function backgroundTerminalFactsForEvent(session, eventId) {
  const indexes = session?.presentationIndexes;
  const fact = indexes?.backgroundTerminalRequests?.get(eventId);
  if (!fact) return null;
  const relation = indexes.backgroundTerminalContinuations?.get(eventId);
  const origin = relation && indexes.backgroundTerminalOrigins?.get(relation.originEventId);
  return origin ? { ...fact, originEventId: relation.originEventId, commandPreview: origin.commandPreview } : { ...fact };
}

module.exports = { terminalSourceEvidence, parseTerminalReceipt, buildTerminalContinuations, backgroundTerminalFactsForEvent };
