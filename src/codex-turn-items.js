'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { fileURLToPath } = require('node:url');
const { fsPathApi, sameRecordedPath } = require('./shared/fs-path');
const { uniqueArguments } = require('./codex-terminal-continuations');
const { isDynamicTransport, toolLifecycleDescriptorFor, TOOL_LIFECYCLE_FAMILY, TOOL_LIFECYCLE_PHASE } = require('./codex-tool-lifecycle-contract');

function hasGeneratedImageFile(item) {
  return item?.type === 'Extension' && item.kind === 'image_gen.generation'
    && typeof item.fileId === 'string' && item.fileId.trim() !== '';
}

function imageFilePeer(raw) {
  if (raw.recordType === 'response_item') {
    if (raw.payloadType === 'function_call') {
      const { name, namespace } = raw.parsed.payload;
      return name === 'imagegen' && (namespace == null || namespace === 'image_gen');
    }
    return raw.payloadType === 'function_call_output' || raw.payloadType === 'image_generation_call';
  }
  return raw.recordType === 'event_msg' && ['image_generation_begin', 'image_generation_end'].includes(raw.payloadType);
}

// Pinned producer: rust-v0.160.0 protocol/src/items.rs and core/src/tools/events.rs.
// These are semantic views, never replacements for the persisted Raw record.
// Only tool types whose producer assigns id = call_id can join call groups.
function typedItemRecord(record, sessionId) {
  const p = record?.payload;
  if (record?.type !== 'event_msg' || p?.type !== 'item_completed') return null;
  if (p.thread_id != null && p.thread_id !== sessionId) return null;
  const i = p.item;
  if (!i || typeof i !== 'object' || Array.isArray(i) || typeof i.id !== 'string'
      || (!i.id && i.type !== 'Reasoning')) return null;
  let type = 'event_msg';
  let payload;
  const lifecycle = (family, name) => ({ ...i, type: `${family}_${['completed', 'failed', 'declined', 'interrupted'].includes(i.status) ? 'end' : 'update'}`, call_id: i.id, name });
  switch (i.type) {
    case 'CommandExecution':
      if (!Array.isArray(i.command) || !i.command.every((v) => typeof v === 'string')) return null;
      payload = lifecycle('exec_command', 'shell_command');
      break;
    case 'FileChange':
      if (!i.changes || typeof i.changes !== 'object' || Array.isArray(i.changes)) return null;
      payload = lifecycle('patch_apply', 'apply_patch');
      if (i.status === 'completed') payload.success = true;
      if (i.status === 'failed' || i.status === 'declined') payload.success = false;
      break;
    case 'McpToolCall':
      if (typeof i.server !== 'string' || typeof i.tool !== 'string') return null;
      payload = lifecycle('mcp_tool_call', `mcp__${i.server}__${i.tool}`);
      payload.invocation = { server: i.server, tool: i.tool, arguments: i.arguments };
      if (i.error || i.result?.isError === true) payload.status = 'failed';
      break;
    case 'DynamicToolCall':
      if (typeof i.tool !== 'string') return null;
      payload = lifecycle('dynamic_tool_call', i.namespace ? `${i.namespace}.${i.tool}` : i.tool);
      if (i.success === false || i.error) payload.status = 'failed';
      break;
    case 'CollabAgentToolCall': {
      const families = { spawn_agent: 'collab_agent_spawn', send_input: 'collab_agent_interaction', resume_agent: 'collab_agent_interaction', wait: 'collab_waiting', close_agent: 'collab_close' };
      if (!Object.hasOwn(families, i.tool)) return null;
      payload = lifecycle(families[i.tool], i.tool);
      break;
    }
    case 'SubAgentActivity':
      payload = { ...i, type: 'sub_agent_activity', event_id: i.id };
      break;
    case 'Extension':
      if (i.kind === 'image_gen.generation') {
        // 0.172's extension writer can keep an attachment-store ID on successful completion.
        const fileCompletion = i.status === 'completed' && hasGeneratedImageFile(i);
        if (typeof i.status !== 'string' || (typeof i.result !== 'string' && !fileCompletion)) return null;
        payload = { ...i, type: ['completed', 'failed'].includes(i.status) ? 'image_generation_end' : 'image_generation_call_update', call_id: i.id, name: 'image_generation', revised_prompt: i.revisedPrompt, saved_path: i.savedPath };
        if (i.failure) payload.status = 'failed';
      } else if (i.kind === 'clock.sleep' && Number.isSafeInteger(i.durationMs) && i.durationMs >= 0) {
        // Requested duration is not elapsed execution time. Completion may be
        // an early activity wake-up; neither success nor elapsed is inferred.
        payload = { ...i, type: 'dynamic_tool_call_end', call_id: i.id, name: 'clock.sleep', status: 'completed' };
      } else if (i.kind === 'web.search' && typeof i.query === 'string') {
        payload = { ...i, type: 'dynamic_tool_call_end', call_id: i.id, name: 'web.run', status: 'completed',
          action: i.action ? { ...i.action, type: { openPage: 'open_page', findInPage: 'find_in_page' }[i.action.type] || i.action.type } : null };
      } else return null;
      break;
    case 'UserMessage':
      if (!Array.isArray(i.content)) return null;
      type = 'response_item';
      payload = { ...i, type: 'message', role: 'user', content: i.content.map((part) => part?.type === 'text' ? { ...part, type: 'input_text' } : part?.type === 'image' ? { ...part, type: 'input_image' } : part) };
      break;
    case 'AgentMessage':
      // Existing canonical async correlation retains its distinct provenance.
      if (i.delivery === 'async' || !Array.isArray(i.content)) return null;
      type = 'response_item';
      payload = { ...i, type: 'message', role: 'assistant', content: i.content.filter((part) => part?.type === 'Text' && typeof part.text === 'string').map((part) => ({ type: 'output_text', text: part.text })) };
      break;
    case 'Reasoning':
      if (!Array.isArray(i.summary_text) || !i.summary_text.every((v) => typeof v === 'string')
          || (i.raw_content != null && !Array.isArray(i.raw_content))) return null;
      type = 'response_item';
      payload = { ...i, type: 'reasoning', summary: i.summary_text.map((text) => ({ type: 'summary_text', text })), content: (i.raw_content || []).filter((v) => typeof v === 'string').map((text) => ({ type: 'reasoning_text', text })) };
      break;
    case 'FunctionCallOutput':
      type = 'response_item';
      payload = { ...i, type: 'function_call_output', call_id: null };
      break;
    case 'ContextCompaction':
      payload = { type: 'context_compacted' };
      break;
    default:
      return null;
  }
  return { ...record, type, payload: { ...payload, ...(typeof p.turn_id === 'string' ? { turn_id: p.turn_id } : {}) } };
}

function semanticRaw(raw) {
  const record = typedItemRecord(raw?.parsed, raw?.sessionId);
  if (!record) return raw;
  return { ...raw, recordType: record.type, payloadType: record.payload.type,
    canonicalType: record.payload.type, parsed: record,
    typedItemType: raw.parsed.payload.item.type, originalRaw: raw };
}

function transportTurnMatches(row, turnId) {
  const recorded = row.payloadType === 'dynamic_tool_call_request' ? row.parsed.payload.turnId : row.turnId;
  return !turnId || typeof recorded !== 'string' || !recorded || recorded === turnId;
}

function turnBoundaryEpochs(rawEvents) {
  const epochs = new Map();
  let epoch = { number: 0, turnId: '' };
  let turnId = '';
  for (const raw of rawEvents) {
    // A transport message names the turn of its invocation, even if it arrives later.
    if (isDynamicTransport(raw)) {
      epochs.set(raw.rawId, epoch);
      continue;
    }
    const boundary = ['task_started', 'task_complete', 'turn_aborted'].includes(raw.canonicalType);
    const turnScope = raw.canonicalType === 'task_started' || raw.recordType === 'turn_context';
    if (boundary || (turnId && raw.turnId && raw.turnId !== turnId)) {
      epoch = { number: epoch.number + 1, turnId: turnScope ? raw.turnId : '' };
    } else if (turnScope && raw.turnId && epoch.turnId !== raw.turnId) {
      epoch = { number: epoch.number, turnId: raw.turnId };
    }
    if (raw.turnId) turnId = raw.turnId;
    epochs.set(raw.rawId, epoch);
  }
  return epochs;
}

// codex-mcp/src/tools.rs prefixes an environment-qualified callable namespace
// with the first twelve hex digits of SHA-1(environment). Connector aliases,
// sanitized names and collision suffixes need separate registration evidence.
const scopedToolNamespace = /^(?:mcp__)?([a-f0-9]{12})__([A-Za-z0-9_]+)$/;

function scopedRequestToolName(raw) {
  if (raw?.recordType !== 'response_item' || !['function_call', 'custom_tool_call'].includes(raw.payloadType)) return '';
  const call = raw.parsed?.payload;
  if (typeof call?.namespace !== 'string' || typeof call.name !== 'string'
      || call.namespace.length + 2 + call.name.length > 128
      || !scopedToolNamespace.test(call.namespace)
      || !/^[A-Za-z0-9_]+$/.test(call.name)) return '';
  return `${call.namespace}__${call.name}`;
}

const invalidToolArguments = Symbol('invalid tool arguments');
const unverifiedToolArguments = Symbol('unverified tool arguments');
const physicalToolArguments = new WeakMap();
// externalizeEmbeddedImages replaces this header anywhere in a string, including an empty payload.
const externalizedImageHeader = /data:image\/(?:png|jpeg|gif|webp|avif);base64,/i;
// An optional identity check must not parse or encode a multi-megabyte tool result again.
const TOOL_ARGUMENT_EVIDENCE_MAX_CHARS = 64 * 1024;

function toolArgumentTraits(value) {
  const pending = [value];
  let wide = false, image = false;
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === 'number') {
      if (!Number.isFinite(next)) return { invalid: true };
      if (Number.isInteger(next) && !Number.isSafeInteger(next)) wide = true;
    }
    if (!image && typeof next === 'string' && externalizedImageHeader.test(next)) image = true;
    if (next && typeof next === 'object') {
      for (const key of Object.keys(next)) {
        if (!image && externalizedImageHeader.test(key)) image = true;
        pending.push(next[key]);
      }
    }
  }
  return { wide, image };
}

function preciseToolNumber(key, value, context) {
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) throw new RangeError('Tool argument outside the supported number range');
  if (!Number.isInteger(value) || Number.isSafeInteger(value) || !/^-?\d+$/.test(context.source)) return value;
  // serde_json stores integer tokens as i64 or u64. Limit conversion to those widths.
  if (context.source.length > 20) throw new RangeError('Tool integer outside the supported range');
  const integer = BigInt(context.source);
  if (integer < -9223372036854775808n || integer > 18446744073709551615n) throw new RangeError('Tool integer outside the supported range');
  return integer;
}

function toolArgumentCarrier(payload) {
  if (!payload) return;
  if (payload.type === 'item_completed' && ['McpToolCall', 'DynamicToolCall'].includes(payload.item?.type)) return payload.item;
  const family = toolLifecycleDescriptorFor(payload.type)?.family;
  if (family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL) return payload.invocation;
  if (family === TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL || payload.type === 'dynamic_tool_call_request' || payload.type === 'dynamic_tool_call_response') return payload;
}

function recordedToolArguments(carrier) {
  // Older imported dynamic begin events can put the native value in request.
  if (carrier?.type === 'dynamic_tool_call_begin' && carrier.arguments === undefined) return carrier.request;
  return carrier?.arguments;
}

function digestToolArguments(value) {
  // JSON objects are unordered. Keep null fields, array order and exact integers
  // when hashing bounded image-bearing arguments before display redaction.
  function encode(v) {
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (Object.is(v, -0)) return '-0';
    if (Array.isArray(v)) return '[' + v.map(encode).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  return createHash('sha256').update(encode(value)).digest('hex');
}

function toolArgumentEvidence(value, traits, inputLength, readExact) {
  if (traits.invalid) return invalidToolArguments;
  const evidence = traits.image ? { image: unverifiedToolArguments } : { value };
  if (traits.wide) evidence.exact = unverifiedToolArguments;
  if (inputLength > TOOL_ARGUMENT_EVIDENCE_MAX_CHARS) return evidence;
  try {
    if (traits.image) evidence.image = digestToolArguments(value);
    if (traits.wide) evidence.exact = traits.image ? digestToolArguments(readExact()) : readExact();
  } catch { /* A candidate with unverified identity stays in Protocol. */ }
  return evidence;
}

function captureToolArgumentEvidence(record, line) {
  const p = record.payload;
  if (record.type === 'response_item' && p?.type === 'function_call' && typeof p.arguments === 'string'
      && externalizedImageHeader.test(p.arguments)) {
    // An inline URL inside the serialized request can also be replaced for
    // display. Retain just its identity. A complete image is never cached.
    physicalToolArguments.set(p, p.arguments.length > TOOL_ARGUMENT_EVIDENCE_MAX_CHARS
      ? { image: unverifiedToolArguments, unverifiedRequest: true } : functionRequestArguments(p));
  }
  const carrier = record.type === 'event_msg' && toolArgumentCarrier(p);
  if (!carrier) return;
  const args = recordedToolArguments(carrier);
  const traits = toolArgumentTraits(args);
  if (traits.wide || traits.image || traits.invalid) physicalToolArguments.set(carrier, toolArgumentEvidence(args, traits, line.length,
    () => recordedToolArguments(toolArgumentCarrier(JSON.parse(line, preciseToolNumber).payload))));
}

function functionRequestArguments(payload) {
  if (physicalToolArguments.has(payload)) return physicalToolArguments.get(payload);
  const text = payload.arguments;
  if (text === undefined) return undefined;
  if (typeof text !== 'string') return invalidToolArguments;
  let value;
  try { value = JSON.parse(text); }
  catch { return invalidToolArguments; }
  return toolArgumentEvidence(value, toolArgumentTraits(value), text.length, () => JSON.parse(text, preciseToolNumber));
}

function mcpRequestArguments(payload) {
  if (typeof payload.arguments !== 'string') return undefined;
  // The MCP handler alone treats Rust str::trim-empty arguments as null.
  return /^\p{White_Space}*$/u.test(payload.arguments) ? { value: null } : functionRequestArguments(payload);
}

function toolArgumentsMatch(requested, carrier) {
  if (requested === invalidToolArguments) return false;
  const stored = physicalToolArguments.get(carrier);
  if (stored === invalidToolArguments) return false;
  const args = recordedToolArguments(carrier);
  if (requested?.unverifiedRequest && args === undefined) return unverifiedToolArguments;
  if (requested === undefined || args === undefined) return true;
  if (requested.image !== undefined || stored?.image !== undefined) {
    if (requested.image === undefined || stored?.image === undefined) return false;
    if (requested.image === unverifiedToolArguments || stored.image === unverifiedToolArguments) return unverifiedToolArguments;
    if (requested.image !== stored.image) return false;
  } else if (!isDeepStrictEqual(requested.value, args)) return false;
  if (requested.exact === undefined) return true;
  if (requested.exact === unverifiedToolArguments || stored?.exact === undefined || stored.exact === unverifiedToolArguments) return unverifiedToolArguments;
  return isDeepStrictEqual(requested.exact, stored.exact);
}

// null means identity cannot be checked; false means an explicit mismatch.
function matchesScopedMcpCall(raw, server, tool, environmentId, carrier) {
  const call = raw.parsed.payload;
  if (call.type !== 'function_call'
      || typeof call.namespace !== 'string' || call.namespace.length + 2 + call.name.length > 128) return null;
  const registration = scopedToolNamespace.exec(call.namespace);
  if (!registration) return null;
  const argsMatch = toolArgumentsMatch(raw.scopedMcpArguments, carrier);
  if (argsMatch === false) return false;
  const knownServer = typeof server === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(server);
  const knownTool = typeof tool === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(tool);
  if ((knownServer && registration[2] !== server) || (knownTool && call.name !== tool)) return false;
  if (typeof environmentId !== 'string' || !environmentId || environmentId.length > 4096) return null;
  const scope = createHash('sha1').update(environmentId).digest('hex').slice(0, 12);
  if (registration[1] !== scope) return false;
  return knownServer && knownTool ? argsMatch : null;
}

function matchesToolOutput(call, row) {
  if (row.recordType !== 'response_item' || row.payloadType !== call.payloadType + '_output') return false;
  const { name, namespace } = row.parsed.payload;
  const request = call.parsed.payload;
  return (name == null || name === request.name)
    && (namespace == null || (namespace === '' ? 'functions' : namespace) === (request.namespace || 'functions'));
}

function dynamicNamespace(namespace) {
  return namespace == null || namespace === 'functions' ? '' : namespace;
}

function matchesDynamicIdentity(call, tool, namespace) {
  const request = call.parsed.payload;
  const requestedScope = dynamicNamespace(request.namespace);
  const registeredScope = dynamicNamespace(namespace);
  if (typeof requestedScope !== 'string' || typeof registeredScope !== 'string') return null;
  if (requestedScope && typeof namespace === 'string' && requestedScope !== registeredScope) return false;
  if (typeof request.name !== 'string' || typeof tool !== 'string' || !tool) return null;
  if (requestedScope === registeredScope) return request.name === tool;
  // Older calls carried the entire qualified name in the default namespace.
  if (requestedScope || !registeredScope || request.name !== registeredScope + '.' + tool) return false;
  return registeredScope.includes('.') || tool.includes('.') ? null : true;
}

function matchesLegacyDynamicName(call, row) {
  const { name, namespace } = call.parsed.payload;
  const { tool_name: tool, namespace: recordedNamespace } = row.parsed.payload;
  if (typeof name !== 'string' || (namespace != null && typeof namespace !== 'string')) return null;
  if (typeof recordedNamespace === 'string' && dynamicNamespace(recordedNamespace) !== dynamicNamespace(namespace)) return false;
  if ((recordedNamespace != null && typeof recordedNamespace !== 'string') || typeof tool !== 'string' || !tool) return null;
  return tool === (namespace && namespace !== 'functions' ? namespace + '.' + name : name);
}

function matchesDynamicTool(call, row) {
  const payload = row.parsed.payload;
  const typed = row.payloadType === 'item_completed';
  const carrier = typed ? payload.item : payload;
  const registration = typed || isDynamicTransport(row)
    ? matchesDynamicIdentity(call, carrier.tool, carrier.namespace) : matchesLegacyDynamicName(call, row);
  if (registration === false) return false;
  const args = toolArgumentsMatch(functionRequestArguments(call.parsed.payload), carrier);
  if (args === false) return false;
  return registration === true ? args : null;
}

function scopedLegacyMcpStatus(call, row) {
  const p = row.parsed?.payload;
  const invocation = p?.invocation;
  if (!invocation || matchesScopedMcpCall(call, invocation.server, invocation.tool, invocation.environment_id, invocation) !== true) return '';
  return legacyMcpStatus(p);
}

function historicalMcpRegistration(call) {
  if (call.payloadType !== 'function_call') return null;
  const { namespace, name } = call.parsed.payload;
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(name)) return null;
  let server, tool = name, qualifiedName = name;
  if (namespace == null || namespace === '' || namespace === 'functions') {
    if (!name.startsWith('mcp__')) return null;
    const pair = name.slice(5);
    const split = pair.indexOf('__');
    // Keep the recorded spelling even when its separators allow several registrations.
    if (split > 0 && split === pair.lastIndexOf('__') && split + 2 < pair.length) {
      server = pair.slice(0, split);
      tool = pair.slice(split + 2);
    }
  } else {
    if (typeof namespace !== 'string' || !/^mcp__[A-Za-z0-9_-]+$/.test(namespace)
        || namespace.length + 2 + name.length > 128 || scopedToolNamespace.test(namespace)) return null;
    server = namespace.slice(5);
    qualifiedName = namespace + '__' + name;
  }
  const args = mcpRequestArguments(call.parsed.payload);
  return { qualifiedName, server, tool, args };
}

function matchesHistoricalMcpCall(registration, server, tool, environmentId, carrier) {
  if (!registration?.server || environmentId != null) return false;
  const argsMatch = toolArgumentsMatch(registration.args, carrier);
  if (argsMatch === false) return false;
  const knownServer = typeof server === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(server);
  const knownTool = typeof tool === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(tool);
  if ((knownServer && registration.server !== server) || (knownTool && registration.tool !== tool)) return false;
  return knownServer && knownTool ? argsMatch : null;
}

function historicalMcpPeer(call, row) {
  const invocation = row.parsed.payload.invocation;
  const registration = call.historicalMcpRequest || historicalMcpRegistration(call);
  const carrier = row.typedItemType === 'McpToolCall' ? row.originalRaw.parsed.payload.item : invocation;
  if (matchesHistoricalMcpCall(registration, invocation?.server, invocation?.tool, invocation?.environment_id, carrier) !== true) return null;
  // Only an admitted typed item reaches this dispatch as an MCP lifecycle.
  if (row.typedItemType === 'McpToolCall') return row;
  const status = legacyMcpStatus(row.parsed.payload);
  return status ? { ...row, status } : row;
}

function legacyMcpStatus(p) {
  if (p.type === 'mcp_tool_call_declined') return 'declined';
  if (['mcp_tool_call_begin', 'mcp_tool_call_update', 'mcp_tool_call_delta'].includes(p.type)) return 'incomplete';
  if (p.type !== 'mcp_tool_call_end') return '';
  // McpToolCallEndEvent::is_success (0.172.0) reads the tagged Result.
  const result = p.result;
  if (!result || typeof result !== 'object' || Object.keys(result).length !== 1) return '';
  if (typeof result.Err === 'string') return 'failed';
  if (!Array.isArray(result.Ok?.content) || (result.Ok.isError != null && typeof result.Ok.isError !== 'boolean')) return '';
  return result.Ok.isError === true ? 'failed' : 'success';
}

function toolTurnStamp(row) {
  if (row.recordType === 'response_item' && ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(row.payloadType)) {
    return row.parsed?.payload?.internal_chat_message_metadata_passthrough?.turn_id;
  }
}

function toolRowMatchesTurn(row, turnId) {
  return [row.turnId, toolTurnStamp(row)].every(id => id == null || id === '' || (typeof id === 'string' && id === turnId));
}

// Empty means no turn was recorded. Null means the observed rows disagree.
function mergeToolTurn(turnId, row) {
  if (turnId === null) return null;
  const turn = turnId || row.turnId || toolTurnStamp(row) || '';
  return toolRowMatchesTurn(row, turn) ? turn : null;
}

function followsToolRequest(call, row, epochs) {
  const epoch = epochs.get(call.rawId);
  const rowEpoch = epochs.get(row.rawId);
  if (row.line <= call.line || row.sessionId !== call.sessionId || rowEpoch?.number !== epoch?.number
      || (row.turnId && call.turnId && row.turnId !== call.turnId)) return false;
  const callStamp = toolTurnStamp(call);
  const rowStamp = toolTurnStamp(row);
  if (callStamp == null && rowStamp == null) return true;
  // Codex preserves a nonempty turn stamp during replay. A copied receipt
  // cannot change the surrounding epoch or compete with a local receipt.
  const turn = epoch?.turnId || rowEpoch?.turnId || call.turnId || row.turnId || callStamp || rowStamp;
  return toolRowMatchesTurn(call, turn) && toolRowMatchesTurn(row, turn);
}

function toolPeersInTurn(call, group, epochs, identify) {
  const peers = group.filter(row => followsToolRequest(call, row, epochs))
    .map(row => matchesToolOutput(call, row) ? row : identify(call, row)).filter(Boolean);
  // A fragment may start without a turn boundary. Only an independently
  // admitted terminal can supply the missing turn for a stamped receipt.
  const terminalTurns = new Set(peers.filter(row => row.turnId && row.recordType === 'event_msg'
    && toolLifecycleDescriptorFor(row.payloadType)?.phase === TOOL_LIFECYCLE_PHASE.TERMINAL).map(row => row.turnId));
  if (!terminalTurns.size) return peers;
  return peers.filter(row => {
    const stamp = toolTurnStamp(row);
    return !stamp || (terminalTurns.size === 1 && terminalTurns.has(stamp));
  });
}

// match is false for an identified foreign owner and null for an unresolved identity.
function scopedLifecycleCarrier(call, row, matchMcp, historical, singleRequest) {
  const p = row.parsed.payload;
  const item = p.item;
  if (row.payloadType === 'item_completed') {
    if (item?.id !== call.callId) return null;
    let family, match, status;
    if (matchMcp && item.type === 'McpToolCall') {
      family = TOOL_LIFECYCLE_FAMILY.MCP_TOOL;
      match = matchMcp(item.server, item.tool, item.environmentId, item);
      if (['completed', 'failed'].includes(item.status)) status = row.status === 'failed' ? 'failed' : 'success';
    } else if (item.type === 'DynamicToolCall') {
      family = TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL;
      match = matchesDynamicTool(call, row);
      if (['completed', 'failed', 'declined', 'interrupted'].includes(item.status)) status = dynamicOutcome(item);
      if (item.status === 'in_progress') status = '';
    } else return null;
    if (p.thread_id != null && p.thread_id !== call.sessionId) match = false;
    // A lone historical dynamic request already has the physical session and
    // turn checked by followsToolRequest. Cross-channel joins need explicit IDs.
    const explicitIds = p.thread_id === call.sessionId && typeof p.turn_id === 'string' && p.turn_id.length > 0;
    const canJoin = explicitIds || (singleRequest && item.type === 'DynamicToolCall');
    if (match === true && status == null) match = null;
    return { row, family, match, status, typed: true, canJoin };
  }
  const descriptor = toolLifecycleDescriptorFor(row.payloadType);
  const terminal = descriptor?.phase === TOOL_LIFECYCLE_PHASE.TERMINAL;
  if (matchMcp && descriptor?.family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL) {
    const i = p.invocation;
    const match = matchMcp(i?.server, i?.tool, i?.environment_id, i);
    let status = terminal ? legacyMcpStatus(p) : '';
    if (historical && terminal && !status) {
      if (p.status === 'completed' || p.status === 'success') status = 'success';
      else if (p.status === 'failed' || p.status === 'declined') status = p.status;
    }
    return { row, family: descriptor.family, match: match === true && terminal && !status ? null : match, status };
  }
  if (descriptor?.family !== TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL) return null;
  return { row, family: descriptor.family, match: matchesDynamicTool(call, row), status: terminal ? dynamicOutcome(p) : '' };
}

function collaborationThreadId(value) {
  // ThreadId::from_string uses uuid 1.20's simple, hyphenated, braced and URN formats.
  if (typeof value !== 'string') return null;
  if (/^[0-9a-f]{32}$/i.test(value)) return value.toLowerCase();
  let hyphenated = value;
  if (value.startsWith('urn:uuid:')) hyphenated = value.slice(9);
  else if (value.startsWith('{') && value.endsWith('}')) hyphenated = value.slice(1, -1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hyphenated)) return null;
  return hyphenated.replaceAll('-', '').toLowerCase();
}

function recordedCommandDirectory(value) {
  if (typeof value !== 'string') return value;
  // Keep the UNC authority when a stored native directory uses forward slashes.
  // The recorded-path comparison accepts either spelling of a UNC root.
  if (/^[\\/]{2}/.test(value)) return value.replaceAll('/', '\\');
  if (!value.startsWith('file:')) return value;
  try {
    const url = new URL(value);
    if (url.search || url.hash) return '';
    return fileURLToPath(url, { windows: Boolean(url.hostname) || /^\/[A-Za-z]:\//.test(url.pathname) });
  } catch { return ''; }
}

function sameCommandDirectory(left, right) {
  if (typeof left !== 'string' || !left || typeof right !== 'string' || !right) return null;
  if (left === right) return true;
  const a = recordedCommandDirectory(left), b = recordedCommandDirectory(right);
  return sameRecordedPath(a, a) && sameRecordedPath(b, b) ? sameRecordedPath(a, b) : null;
}

function selectedExecShellMatches(selector, executable, shell, cwd) {
  // detect_shell_type repeatedly takes the file stem until it finds a known type.
  const parts = selector.split(executable.startsWith('/') ? '/' : /[\\/]/).filter(part => part && part !== '.');
  const selected = (parts.at(-1) || '').split('.')[0];
  const powershell = ['pwsh', 'powershell'];
  if (powershell.includes(selected)) return powershell.includes(shell);
  if (['sh', 'bash', 'zsh', 'cmd'].includes(selected)) return selected === shell;

  // An unknown type takes ultimate_fallback_shell. Its executable is literal,
  // and an absolute recorded directory can rule out the opposite platform.
  const directory = recordedCommandDirectory(cwd);
  const known = sameRecordedPath(directory, directory);
  const windows = known && /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(directory);
  return (executable === '/bin/sh' && !windows) || (executable === 'cmd.exe' && (!known || windows));
}

function commandArgvMatches(args, name, argv, cwd) {
  if (!args || !Array.isArray(argv) || !argv.length || !argv.every(arg => typeof arg === 'string')) return false;
  if (name === 'shell') return Array.isArray(args.command)
    && args.command.length === argv.length && args.command.every((arg, i) => arg === argv[i]);
  const command = name === 'exec_command' ? args.cmd : args.command;
  if (typeof command !== 'string' || !command) return false;
  if (args.login != null && typeof args.login !== 'boolean') return false;
  if (args.login == null && args.shell == null && argv.every(arg => /^[A-Za-z0-9_./:-]+$/.test(arg)) && argv.join(' ') === command) return true;
  // core/src/shell.rs::derive_exec_args preserves the command as one argument.
  if (argv.at(-1) !== command) return false;
  const shell = argv[0].split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/, '');
  if (args.shell != null) {
    // get_shell_by_model_provided_path selects a type, then discovers the executable.
    if (typeof args.shell !== 'string') return false;
    if (name === 'exec_command' ? !selectedExecShellMatches(args.shell, argv[0], shell, cwd) : args.shell !== argv[0]) return false;
  }
  if (['sh', 'bash', 'zsh'].includes(shell)) return argv.length === 3
    && ((argv[1] === '-c' && args.login !== true) || (argv[1] === '-lc' && args.login !== false));
  if (shell === 'cmd') return argv.length === 3 && argv[1] === '/c';
  return ['powershell', 'pwsh'].includes(shell)
    && ((argv.length === 3 && argv[1] === '-Command' && args.login !== false)
      || (argv.length === 4 && argv[1] === '-NoProfile' && argv[2] === '-Command' && args.login !== true));
}

function execWorkdirMatches(value, base, recorded) {
  // unified_exec uses the selected executor's cwd for omitted, null and empty
  // workdir. Relative native paths use that same base.
  if (typeof value !== 'string' || value.includes('\0')) return null;
  if (!sameRecordedPath(base, base)) return sameRecordedPath(value, value) ? sameCommandDirectory(value, recorded) : null;
  const api = fsPathApi(base);
  if (api.sep === '\\' && /^[A-Za-z]:(?![\\/])/.test(value) && value[0].toLowerCase() !== base[0].toLowerCase()) return null;
  return sameCommandDirectory(api.resolve(base, value), recorded);
}

function commandDirectoryComparisons(args, name, recorded, callCwd) {
  const matches = [];
  if (name === 'exec_command') {
    // A turn/session directory cannot establish a named executor's default.
    const base = args?.environment_id == null ? recordedCommandDirectory(callCwd) : null;
    matches.push(execWorkdirMatches(args?.workdir ?? '', base, recorded));
  } else if (args?.workdir != null) matches.push(sameCommandDirectory(args.workdir, recorded));
  if (args?.cwd != null) matches.push(sameCommandDirectory(args.cwd, recorded));
  return matches;
}

function commandMatches(args, name, item, legacy = false, callCwd) {
  if (!['shell', 'shell_command', 'exec_command'].includes(name)) return false;
  if ((!legacy || item.source !== undefined) && item.source !== (name === 'exec_command' ? 'unified_exec_startup' : 'agent')) return false;
  if ((!legacy || item.cwd !== undefined) && commandDirectoryComparisons(args, name, item.cwd, callCwd).some(match => match !== true)) return false;
  if (!legacy && item.exit_code != null && (!Number.isInteger(item.exit_code) || item.exit_code < -2147483648 || item.exit_code > 2147483647
      || (item.status === 'completed' && item.exit_code !== 0) || (item.status === 'failed' && item.exit_code === 0))) return false;
  return (legacy && item.command === undefined) || commandArgvMatches(args, name, item.command, item.cwd);
}

function waitMatches(args, item, sessionId) {
  if (item.tool !== 'wait' || item.sender_thread_id !== sessionId || !collaborationThreadId(sessionId)
      || !Array.isArray(args?.targets) || !args.targets.length) return false;
  const targets = new Set(args.targets.map(collaborationThreadId));
  // multi_agents/wait.rs can finish for a subset of the requested targets.
  if (targets.has(null) || !Array.isArray(item.receiver_thread_ids)
      || !item.receiver_thread_ids.every(id => targets.has(collaborationThreadId(id)))) return false;
  const returned = new Set(item.receiver_thread_ids.map(collaborationThreadId));
  // A V1 timeout completes with an explicitly empty state map and no returned threads.
  if (!returned.size && item.agents_states == null) return false;
  if (item.agents_states != null) {
    const states = item.agents_states;
    if (!states || typeof states !== 'object' || Array.isArray(states) || Object.keys(states).length !== returned.size
        || !Object.keys(states).every(id => returned.has(collaborationThreadId(id)))) return false;
    // multi_agents/wait.rs::wait_tool_call_status derives the terminal from these states.
    const failed = Object.values(states).some(state => state === 'not_found' || (state && typeof state.errored === 'string'));
    if (item.status !== (failed ? 'failed' : 'completed')) return false;
  }
  return (item.receiver_agents === undefined || (Array.isArray(item.receiver_agents)
      && item.receiver_agents.every(agent => returned.has(collaborationThreadId(agent?.thread_id)))));
}

function patchPath(value, cwd) {
  if (!cwd || !sameRecordedPath(cwd, cwd) || typeof value !== 'string' || !value) return value;
  const api = fsPathApi(cwd);
  if (value.split(api.sep === '\\' ? /[\\/]/ : '/').includes('..')) return value;
  if (api.isAbsolute(value)) return api.normalize(value);
  if (/^(?:[A-Za-z]:|[\\/])/.test(value)) return value;
  return api.join(cwd, value);
}

function foreignPatchMove(verified, change, cwd) {
  if (!Object.hasOwn(change, 'move_path')) return false;
  const target = change.move_path;
  if (target === null) return verified != null;
  if (typeof target !== 'string' || !target || target.includes('\0')) return false;
  if (verified == null) return true;
  const a = patchPath(verified, cwd), b = patchPath(target, cwd);
  if (a === b || [a, b].some(value => value.split(/[\\/]/).includes('..'))) return false;
  // Relative and absolute spellings may denote the same target without a cwd.
  if (!sameRecordedPath(a, a) || !sameRecordedPath(b, b)) return false;
  return !sameRecordedPath(a, b);
}

const unifiedHunkRange = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*|$)/;
const missingFinalNewline = '\\ No newline at end of file';

function patchDiffLines(diff) {
  const lines = diff.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const hunk = lines.findIndex(line => line.startsWith('@@'));
  return hunk < 0 ? lines : lines.slice(hunk);
}

// Historical coordinate-free diffs have no range to attest. A numbered diff
// must account for both sides, including the unchanged gap between hunks.
function numberedPatchBounds(lines, collectOldLines = false) {
  if (!lines.some(line => line.startsWith('@@ -'))) return null;
  let oldRemaining = 0, newRemaining = 0, seenHunk = false;
  let oldEnd = 0, newEnd = 0, oldEnded = false, newEnded = false, previousPrefix = '';
  const oldText = collectOldLines ? new Map() : null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const range = unifiedHunkRange.exec(line);
      if (!range || oldRemaining || newRemaining) return false;
      seenHunk = true;
      oldRemaining = Number(range[2] ?? 1);
      newRemaining = Number(range[4] ?? 1);
      const oldStart = Number(range[1]) - (oldRemaining ? 1 : 0);
      const newStart = Number(range[3]) - (newRemaining ? 1 : 0);
      if (![oldStart, newStart, oldStart + oldRemaining, newStart + newRemaining].every(Number.isSafeInteger)
          || oldStart < oldEnd || oldStart - oldEnd !== newStart - newEnd
          || (oldEnded && (oldRemaining || oldStart !== oldEnd)) || (newEnded && (newRemaining || newStart !== newEnd))) return false;
      oldEnd = oldStart + oldRemaining;
      newEnd = newStart + newRemaining;
      previousPrefix = '';
    } else if (line === missingFinalNewline) {
      if (!previousPrefix) return false;
      if (previousPrefix !== '+') oldEnded = true;
      if (previousPrefix !== '-') newEnded = true;
      previousPrefix = '';
    } else {
      if (!seenHunk || !/^[ +\-]/.test(line)) return false;
      previousPrefix = line[0];
      if ((oldEnded && previousPrefix !== '+') || (newEnded && previousPrefix !== '-')) return false;
      if (!line.startsWith('+')) {
        oldText?.set(oldEnd - oldRemaining, line);
        oldRemaining--;
      }
      if (!line.startsWith('-')) newRemaining--;
      if (oldRemaining < 0 || newRemaining < 0) return false;
    }
  }
  return seenHunk && oldRemaining === 0 && newRemaining === 0 && { oldEnd, oldEnded, oldText };
}

function patchEditBlocks(lines, { recorded = false, atEof = false } = {}) {
  const blocks = [];
  let chunk = { oldLines: 0, minOrigin: 0 }, origin = null;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      // Each consumed pattern advances the writer's search. A named section
      // advances it once more past the matched selector line.
      const consumed = chunk.oldLines - (chunk.trailingEmpty ? 1 : 0);
      const selector = !recorded && line.startsWith('@@ ') ? normalizedPatchOldText(line.slice(2)) : '';
      chunk = { oldLines: 0, selector, minOrigin: chunk.minOrigin + consumed + (selector ? 1 : 0) };
      const range = recorded && unifiedHunkRange.exec(line);
      origin = range ? Number(range[1]) - (Number(range[2] ?? 1) > 0 ? 1 : 0) : null;
    } else if (line.startsWith(' ')) {
      chunk.oldLines++;
      chunk.trailingEmpty = line === ' ';
    }
    if (!/^[+-]/.test(line)) { i++; continue; }
    const start = i, oldOffset = chunk.oldLines;
    while (i < lines.length && /^[+-]/.test(lines[i])) {
      if (lines[i].startsWith('-')) {
        chunk.oldLines++;
        chunk.trailingEmpty = lines[i] === '-';
      }
      i++;
    }
    const before = lines[start - 1], after = lines[i];
    blocks.push({ edits: lines.slice(start, i), before: before?.startsWith(' ') ? before : null, after: after?.startsWith(' ') ? after : null,
      chunk, offset: oldOffset, position: origin === null ? null : origin + oldOffset });
  }
  chunk.atEof = atEof;
  return blocks;
}

// seek_sequence can locate old lines by their trimmed text and these specific
// Unicode equivalents. New lines are written with the request's exact text.
function normalizedPatchOldText(line) {
  return line.slice(1).replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018-\u201B]/g, "'").replace(/[\u201C-\u201F]/g, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}

function patchLineMatches(left, right) {
  return left === right || (left[0] === right[0] && left[0] !== '+' && normalizedPatchOldText(left) === normalizedPatchOldText(right));
}

// TextDiff can coalesce adjacent replacements from separate request chunks.
// Keep the old/new order within each side and preserve the old-file offsets.
function alignPatchEdits(requested, recorded) {
  const aligned = [];
  for (const block of recorded) {
    const removed = block.edits.filter(line => line[0] === '-'), added = block.edits.filter(line => line[0] === '+');
    let old = 0, next = 0;
    while (old < removed.length || next < added.length) {
      const request = requested[aligned.length];
      if (!request) return null;
      const offset = old, first = !old && !next;
      for (const edit of request.edits) {
        const actual = edit[0] === '-' ? removed[old++] : added[next++];
        if (actual === undefined || !patchLineMatches(edit, actual)) return null;
      }
      aligned.push({ ...block, before: first ? block.before : null, after: old === removed.length && next === added.length ? block.after : null,
        offset: block.offset + offset, position: block.position === null ? null : block.position + offset });
    }
  }
  return aligned.length === requested.length ? aligned : null;
}

// Re-diffing can present the same change with different runs or move identical
// text from one side to the other. Changed line counts still have to balance.
function patchTextContradicts(requested, recorded) {
  const balance = new Map(), extraNewText = new Map();
  for (const [blocks, sign] of [[requested, -1], [recorded, 1]]) {
    for (const { edits } of blocks) for (const line of edits) {
      const oldText = normalizedPatchOldText(line), text = line.slice(1);
      const delta = line[0] === '+' ? sign : -sign;
      if (oldText) balance.set(oldText, (balance.get(oldText) || 0) + delta);
      // Requested additions are exact. Requested deletions can use seek_sequence.
      if (text && (sign === 1 || line[0] === '+')) extraNewText.set(text, (extraNewText.get(text) || 0) + delta);
    }
  }
  return [...balance.values()].some(n => n !== 0) || [...extraNewText.values()].some(n => n > 0);
}

function patchUpdateMatches(body, diff, move, atEof) {
  const requested = patchEditBlocks(body, { atEof });
  const bounds = numberedPatchBounds(diff, requested.some(block => block.chunk.selector));
  if (bounds === false || (!move && !requested.length)) return null;
  let lines = diff;
  if (diff.includes(missingFinalNewline)) {
    lines = [];
    for (let i = 0; i < diff.length; i++) {
      const line = diff[i];
      // Appending can supply the previously missing newline on the last old
      // line. Its bytes have to reappear unchanged before the appended text.
      if (bounds && line[0] === '-' && diff[i + 1] === missingFinalNewline && diff[i + 2] === '+' + line.slice(1)
          && requested.some(block => !block.chunk.oldLines)) {
        lines.push(' ' + line.slice(1));
        i += 2;
      } else if (line !== missingFinalNewline) lines.push(line);
    }
  }
  const observed = patchEditBlocks(lines, { recorded: true });
  const recorded = alignPatchEdits(requested, observed);
  if (!recorded) return patchTextContradicts(requested, observed) ? false : null;
  // The writer regenerates radius-one context. Compare the immediate neighbours
  // of each edit when both sides retain them. A hunk header always breaks a run.
  let requestOrigin = null, skippedOldLines = 0;
  return requested.every((block, i) => {
    const other = recorded[i];
    const previous = requested[i - 1];
    if (block.chunk !== previous?.chunk) {
      if (requestOrigin !== null && previous.chunk.oldLines) skippedOldLines = requestOrigin - previous.chunk.minOrigin;
      requestOrigin = null;
    }
    // compute_replacements appends chunks without old lines. An explicit EOF
    // anchors the end of the complete request chunk, including its context.
    const reachesEof = !block.chunk.oldLines || block.chunk.atEof;
    const oldLength = block.chunk.oldLines;
    if (reachesEof && other.offset - block.offset + oldLength < other.chunk.oldLines) return false;
    if (other.position !== null) {
      // All edits in one request chunk start from the same old-file position.
      const origin = other.position - block.offset;
      if (origin < block.chunk.minOrigin + skippedOldLines || (requestOrigin !== null && origin !== requestOrigin)) return false;
      if (requestOrigin === null && block.chunk.selector) {
        let pos = block.chunk.minOrigin + skippedOldLines - 1;
        while (pos < origin && bounds.oldText.has(pos) && normalizedPatchOldText(bounds.oldText.get(pos)) !== block.chunk.selector) pos++;
        if (pos === origin) return false;
      }
      const end = origin + oldLength;
      // The writer may omit one empty trailing line used as a newline sentinel.
      if ((reachesEof && end < bounds.oldEnd) || (bounds.oldEnded && end - (block.chunk.trailingEmpty ? 1 : 0) > bounds.oldEnd)) return false;
      requestOrigin = origin;
    }
    if (previous && block.chunk === previous.chunk && other.chunk === recorded[i - 1].chunk
        && block.offset - previous.offset !== other.offset - recorded[i - 1].offset) return false;
    return (block.before === null || other.before === null || patchLineMatches(block.before, other.before))
      && (block.after === null || other.after === null || patchLineMatches(block.after, other.after));
  });
}

function patchMatches(input, changes, cwd) {
  if (typeof input !== 'string' || !changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
  const lines = input.replaceAll('\r\n', '\n').trimEnd().split('\n');
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') return false;
  const byPath = new Map(Object.entries(changes).map(([path, change]) => [patchPath(path, cwd), change]));
  if (byPath.size !== Object.keys(changes).length) return false;
  const seen = new Set();
  let matched = true;
  for (let i = 0; i < lines.length;) {
    const header = /^\*\*\* (Add|Delete|Update) File: (.+)$/.exec(lines[i++]);
    if (!header) return false;
    const path = patchPath(header[2], cwd);
    if (seen.has(path) || !byPath.has(path)) return false;
    seen.add(path);
    const change = byPath.get(path);
    if (change?.type !== header[1].toLowerCase()) return false;
    const move = change.type === 'update' && lines[i]?.startsWith('*** Move to: ') ? lines[i++].slice('*** Move to: '.length) : null;
    if (patchPath(change.move_path ?? null, cwd) !== patchPath(move, cwd)) return false;
    const start = i;
    while (i < lines.length && !lines[i].startsWith('*** ')) i++;
    const body = lines.slice(start, i);
    if (change.type === 'add' && (!body.every(line => line.startsWith('+'))
        || body.map(line => line.slice(1) + '\n').join('') !== change.content)) return false;
    if (change.type === 'delete' && (body.length || typeof change.content !== 'string')) return false;
    if (change.type === 'update') {
      if (typeof change.unified_diff !== 'string') return false;
      if (body.some(line => !/^(?:[ +\-]|@@(?: |$))/.test(line))) return false;
      const result = patchUpdateMatches(body, patchDiffLines(change.unified_diff), move, lines[i] === '*** End of File');
      if (result === false) return false;
      if (result === null) matched = null;
      if (lines[i] === '*** End of File') i++;
    }
  }
  return seen.size > 0 && seen.size === Object.keys(changes).length && matched;
}

function legacyCommandOrPatchMatches(call, row, requestCwd) {
  const request = call.parsed.payload;
  if (typeof request.name !== 'string' || (request.namespace != null && request.namespace !== '' && request.namespace !== 'functions')) return false;
  const name = request.name.replace(/^functions\./, '');
  const p = row.parsed.payload;
  if (toolLifecycleDescriptorFor(row.payloadType)?.family === TOOL_LIFECYCLE_FAMILY.PATCH) {
    if (name !== 'apply_patch') return false;
    // Older patch ends can omit changes, which serde defaults to an empty map.
    if (p.changes === undefined || (p.changes && typeof p.changes === 'object' && !Array.isArray(p.changes) && !Object.keys(p.changes).length)) return true;
    const input = request.type === 'function_call' ? uniqueArguments(request.arguments)?.input : request.input;
    return patchMatches(input, p.changes, requestCwd);
  }
  if (request.type !== 'function_call') return false;
  // A write_stdin interaction reports the running program's argv.
  if (name === 'write_stdin') {
    if (p.source !== undefined && p.source !== 'unified_exec_interaction') return false;
    const args = uniqueArguments(request.arguments);
    if (p.process_id != null && (!Number.isInteger(args?.session_id) || args.session_id < -2147483648 || args.session_id > 2147483647
        || p.process_id !== String(args.session_id))) return false;
    return p.interaction_input == null || (args && typeof p.interaction_input === 'string'
      && p.interaction_input === (args.chars === undefined ? '' : args.chars));
  }
  return commandMatches(uniqueArguments(request.arguments), name, p, true, requestCwd);
}

const nativeItemTypes = new Set(['CommandExecution', 'FileChange', 'CollabAgentToolCall']);

// Only the opposite wire channel of a scoped request uses these stronger checks.
function nativeTypedRequestMatches(call, item, requestCwd) {
  const p = call.parsed.payload;
  const native = p.namespace == null || p.namespace === '' || p.namespace === 'functions';
  if (typeof p.name !== 'string' || !['completed', 'failed', 'declined'].includes(item.status)) return false;
  const name = p.name.replace(/^functions\./, '');
  if (item.type === 'FileChange') return native && p.type === 'custom_tool_call' && name === 'apply_patch' && patchMatches(p.input, item.changes, requestCwd);
  if (p.type !== 'function_call') return false;
  const args = uniqueArguments(p.arguments);
  if (item.type === 'CommandExecution') return native && commandMatches(args, name, item, false, requestCwd);
  return item.type === 'CollabAgentToolCall' && ['completed', 'failed'].includes(item.status) && p.name === 'wait_agent'
    && p.namespace === 'multi_agent_v1' && waitMatches(args, item, call.sessionId);
}

// Only exclude a second candidate when a recorded identity field rules it out.
// Malformed fields and incomplete identities can still dispute a verified item.
function foreignNativeCarrier(call, item, other, requestCwd) {
  if (item.type === 'CommandExecution') {
    const args = uniqueArguments(call.parsed.payload.arguments);
    return (['agent', 'user_shell', 'unified_exec_startup', 'unified_exec_interaction'].includes(other.source) && other.source !== item.source)
      || commandDirectoryComparisons(args, call.parsed.payload.name.replace(/^functions\./, ''), other.cwd, requestCwd).includes(false)
      || (Array.isArray(other.command) && other.command.length && other.command.every(arg => typeof arg === 'string')
        && !nativeTypedRequestMatches(call, { ...item, command: other.command }, requestCwd));
  }
  if (item.type === 'CollabAgentToolCall') {
    if (['spawn_agent', 'send_input', 'resume_agent', 'close_agent', 'send_message', 'followup_task', 'interrupt_agent', 'list_agents'].includes(other.tool)) return true;
    if (collaborationThreadId(other.sender_thread_id) && other.sender_thread_id !== item.sender_thread_id) return true;
    const targets = new Set(uniqueArguments(call.parsed.payload.arguments).targets.map(collaborationThreadId));
    const outside = id => collaborationThreadId(id) !== null && !targets.has(collaborationThreadId(id));
    return (Array.isArray(other.receiver_thread_ids) && other.receiver_thread_ids.some(outside))
      || (Array.isArray(other.receiver_agents) && other.receiver_agents.some(agent => outside(agent?.thread_id)))
      || (other.agents_states && Object.keys(other.agents_states).some(outside));
  }
  if (!other.changes || typeof other.changes !== 'object' || Array.isArray(other.changes)) return false;
  const known = new Map(Object.keys(item.changes).map(key => [patchPath(key, requestCwd), key]));
  const candidateChanges = { ...item.changes };
  let compareUpdates = false;
  const foreign = Object.entries(other.changes).some(([key, change]) => {
    if (!key || !['add', 'update', 'delete'].includes(change?.type)) return false;
    const path = patchPath(key, requestCwd);
    const originalKey = known.get(path);
    if (originalKey !== undefined) {
      const expected = item.changes[originalKey];
      if (expected.type !== change.type) return true;
      if (change.type === 'add') return typeof change.content === 'string' && change.content !== expected.content;
      if (change.type === 'update' && foreignPatchMove(expected.move_path, change, requestCwd)) return true;
      if (change.type === 'update' && typeof change.unified_diff === 'string' && numberedPatchBounds(patchDiffLines(change.unified_diff))) {
        candidateChanges[originalKey] = { ...expected, unified_diff: change.unified_diff };
        compareUpdates = true;
      }
      return false;
    }
    // An absolute and a relative key might still refer to the same file if cwd is missing.
    return [...known.keys()].every(value => fsPathApi(value).isAbsolute(value) === fsPathApi(path).isAbsolute(path));
  });
  return foreign || (compareUpdates && patchMatches(call.parsed.payload.input, candidateChanges, requestCwd) === false);
}

function resolveNativeTypedTerminal(requests, group, epochs, views, remainingToolPeer, requestCwds) {
  // A scoped request disputes its own wire channel. Even mixed registrations
  // on that channel cannot own the unique request on the opposite channel.
  const scoped = requests.find(scopedRequestToolName);
  const independent = requests.filter(call => call.payloadType !== scoped.payloadType);
  if (independent.length !== 1 || scopedRequestToolName(independent[0])) return;
  const call = independent[0];
  const requestCwd = requestCwds.get(call);
  const peers = group.filter(row => followsToolRequest(call, row, epochs));
  // Historical function and custom apply_patch can write the same unlabelled
  // patch lifecycle. Their shared legacy row cannot corroborate a typed item.
  const otherCalls = requests.filter(other => other !== call && !scopedRequestToolName(other));
  if (otherCalls.length) {
    for (const row of peers) {
      if (toolLifecycleDescriptorFor(row.payloadType)?.family === TOOL_LIFECYCLE_FAMILY.PATCH
          && legacyCommandOrPatchMatches(call, row, requestCwd) !== false
          && otherCalls.some(other => followsToolRequest(other, row, epochs) && legacyCommandOrPatchMatches(other, row, requestCwds.get(other)) !== false)) {
        views.set(row, { ...row, detachedNativeTerminal: true });
      }
    }
  }
  const typed = peers.filter(row => row.recordType === 'event_msg' && row.payloadType === 'item_completed'
    && nativeItemTypes.has(row.parsed.payload.item?.type) && row.parsed.payload.item.id === call.callId
    && (row.parsed.payload.thread_id == null || row.parsed.payload.thread_id === call.sessionId));
  const candidates = typed.filter(row => {
    const p = row.parsed.payload;
    return p.thread_id === call.sessionId && typeof p.turn_id === 'string' && p.turn_id.length > 0 && nativeTypedRequestMatches(call, p.item, requestCwd);
  });
  if (!candidates.length) return;
  const raw = candidates[0];
  const item = raw.parsed.payload.item;
  const view = semanticRaw(raw);
  if (view === raw) return;
  const family = toolLifecycleDescriptorFor(view.payloadType).family;
  const terminals = [];
  for (const row of peers) {
    const descriptor = toolLifecycleDescriptorFor(row.payloadType);
    if (descriptor?.phase !== TOOL_LIFECYCLE_PHASE.TERMINAL || views.get(row)?.detachedNativeTerminal) continue;
    // Ambiguous same-family terminals can still dispute a verified typed item,
    // even when their malformed identity is insufficient for a legacy-only join.
    const commandOrPatch = item.type === 'CommandExecution' || item.type === 'FileChange';
    if (!(descriptor.family === family && commandOrPatch) && !remainingToolPeer?.(call, row)) continue;
    const p = row.parsed.payload;
    if (descriptor.family === family && foreignNativeCarrier(call, item, p, requestCwd)) views.set(row, { ...row, detachedNativeTerminal: true });
    else terminals.push(row);
  }
  // A registered dynamic tool may use the same callable name as a native tool.
  const dynamicPeers = call.payloadType === 'function_call' ? peers.filter(row => {
    if (row.recordType !== 'event_msg') return false;
    const p = row.parsed.payload;
    if (row.payloadType === 'item_completed' && p.item?.type === 'DynamicToolCall') {
      return (p.thread_id == null || p.thread_id === call.sessionId) && matchesDynamicTool(call, row) !== false;
    }
    if (isDynamicTransport(row)) {
      return transportTurnMatches(row, call.turnId || raw.turnId) && matchesDynamicTool(call, row) !== false;
    }
    return toolLifecycleDescriptorFor(row.payloadType)?.family === TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL && matchesDynamicTool(call, row) !== false;
  }) : [];
  const disputed = candidates.length > 1 || typed.some(row => row !== raw && row.parsed.payload.item.type === item.type
    && !foreignNativeCarrier(call, item, row.parsed.payload.item, requestCwd)) || terminals.length > 1
    || dynamicPeers.length > 0
    || terminals.some(row => {
      const p = row.parsed.payload;
      const status = row.payloadType.endsWith('_declined') ? 'declined' : p.status
        || (typeof p.success === 'boolean' ? (p.success ? 'completed' : 'failed') : null);
      return toolLifecycleDescriptorFor(row.payloadType).family !== family || (status != null && status !== item.status)
        // CommandExecutionItem::as_legacy_end_event copies these fields.
        || (item.type === 'CommandExecution' && (sameCommandDirectory(p.cwd, item.cwd) === false
          || ['command', 'source', 'process_id', 'interaction_input', 'plugin_id', 'script_path', 'parsed_cmd',
            'aggregated_output', 'stdout', 'stderr', 'formatted_output', 'duration']
            .some(key => item[key] != null && p[key] != null && !isDeepStrictEqual(item[key], p[key]))))
        || (item.type === 'FileChange' && ((p.changes && !isDeepStrictEqual(p.changes, item.changes))
          || ['stdout', 'stderr'].some(key => typeof item[key] === 'string' && typeof p[key] === 'string' && item[key] !== p[key])))
        || (item.type === 'CollabAgentToolCall' && p.statuses && !isDeepStrictEqual(p.statuses, item.agents_states))
        || (typeof item.exit_code === 'number' && typeof p.exit_code === 'number' && item.exit_code !== p.exit_code);
    });
  if (disputed) {
    for (const row of [...terminals, ...dynamicPeers]) views.set(row, { ...row, detachedNativeTerminal: true });
    return;
  }
  views.set(raw, view);
}

// Compare physical carriers before projecting either format into a logical event.
function resolveScopedTerminals(group, epochs, views, remainingToolPeer, requestCwds) {
  const requests = group.filter(row => row.recordType === 'response_item' && ['function_call', 'custom_tool_call'].includes(row.payloadType));
  resolveNativeTypedTerminal(requests, group, epochs, views, remainingToolPeer, requestCwds);
  const functions = requests.filter(row => row.payloadType === 'function_call');
  if (functions.length !== 1) return;
  const call = functions[0];
  const customCalls = requests.filter(row => row.payloadType === 'custom_tool_call');
  const scopedName = scopedRequestToolName(call);
  // Each group contains a scoped request. If this unique function is historical,
  // the scoped requests all belong to the independent custom channel.
  const historical = !scopedName && historicalMcpRegistration(call);
  if (scopedName) views.set(call, { ...call, toolName: scopedName, scopedRequest: true,
    scopedMcpArguments: mcpRequestArguments(call.parsed.payload) });
  const matchMcp = scopedName ? matchesScopedMcpCall.bind(null, views.get(call))
    : historical && matchesHistoricalMcpCall.bind(null, historical);
  const peers = group.filter(row => followsToolRequest(call, row, epochs));
  const eligible = new Set(peers);
  const identified = new Set();
  const mcp = [];
  const unresolvedHistoricalMcp = [];
  const uncertainArguments = new Map();
  const dynamic = [];
  for (const row of group) {
    if (row.recordType !== 'event_msg') continue;
    const carrier = scopedLifecycleCarrier(call, row, matchMcp, historical, requests.length === 1);
    if (!carrier) continue;
    // Typed rows start in Protocol. Only a unique in-scope owner can claim one.
    if (carrier.typed) views.set(row, { ...row, callId: '' });
    if (!eligible.has(row)) continue;
    if (carrier.match === unverifiedToolArguments) {
      views.set(row, { ...row, callId: '' });
      uncertainArguments.set(row, carrier);
      continue;
    }
    if (carrier.match == null) {
      if (historical && carrier.family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL) unresolvedHistoricalMcp.push(row);
      continue;
    }
    identified.add(row);
    if (carrier.match) {
      const family = carrier.family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL ? mcp : dynamic;
      family.push(carrier);
    }
  }
  const uncertainFamilies = new Set([...uncertainArguments.values()].map(carrier => carrier.family));
  // A matching dynamic end can remain in Protocol. Preserve its candidacy
  // until ordered native lifecycle checks (including path waits) finish.
  if (!scopedName && dynamic.some(carrier => carrier.status)) {
    for (const row of peers) {
      const descriptor = toolLifecycleDescriptorFor(row.payloadType);
      if (row.recordType === 'event_msg' && descriptor?.phase === TOOL_LIFECYCLE_PHASE.TERMINAL
          && descriptor.family !== TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL && descriptor.family !== TOOL_LIFECYCLE_FAMILY.MCP_TOOL) {
        views.set(row, { ...(views.get(row) || row), hasCompetingDynamicEnd: true });
      }
    }
  }
  const competingFamilies = (mcp.length > 0 || uncertainFamilies.has(TOOL_LIFECYCLE_FAMILY.MCP_TOOL))
    && (dynamic.length > 0 || uncertainFamilies.has(TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL));
  for (const carriers of [mcp, dynamic]) {
    const terminals = carriers.filter(carrier => carrier.status);
    const typedItems = carriers.filter(carrier => carrier.typed);
    const outcomes = new Set(terminals.map(carrier => carrier.status));
    outcomes.delete('completed'); // A neutral receipt does not contradict a specific terminal.
    // Unverified argument evidence stays in Protocol. A different-format row
    // with the same outcome cannot reverse an independently verified terminal.
    const legacyTerminals = terminals.filter(carrier => !carrier.typed).length;
    const argumentDispute = [...uncertainArguments.values()].some(candidate => {
      if (candidate.family !== carriers[0]?.family) return false;
      if (!candidate.typed && toolLifecycleDescriptorFor(candidate.row.payloadType).phase !== TOOL_LIFECYCLE_PHASE.TERMINAL) return false;
      return (candidate.typed ? typedItems.length : legacyTerminals) > 0
        || (candidate.status !== 'completed' && outcomes.size > 0 && !outcomes.has(candidate.status));
    });
    const disputed = outcomes.size > 1 || typedItems.length > 1
      || argumentDispute || (carriers === mcp && unresolvedHistoricalMcp.length > 0)
      || legacyTerminals > 1;
    if (competingFamilies || disputed) {
      for (const { row } of competingFamilies ? carriers : terminals) views.set(row, { ...row, callId: '' });
      if (carriers === mcp) for (const row of unresolvedHistoricalMcp) views.set(row, { ...row, callId: '' });
      continue;
    }
    const typed = typedItems[0];
    if (!typed?.canJoin) continue;
    // A request or receipt has its own wire channel. Any remaining unidentified
    // lifecycle needs an independent owner before a typed terminal can join.
    const unresolved = peers.some(row => {
      if (identified.has(row) || uncertainArguments.has(row)) return false;
      if (row.recordType === 'response_item' && ['custom_tool_call', 'custom_tool_call_output', 'function_call_output'].includes(row.payloadType)) return false;
      if (isDynamicTransport(row)) {
        // A transport mirror stays in Protocol. It can corroborate the identity
        // of a typed dynamic item, but cannot supply an outcome or attest MCP.
        if (!transportTurnMatches(row, call.turnId || typed.row.turnId)) return false;
        const match = matchesDynamicTool(call, row);
        return match !== false && !(match === true && carriers === dynamic);
      }
      return !customCalls.some(custom => followsToolRequest(custom, row, epochs) && remainingToolPeer?.(custom, views.get(row) || row));
    });
    if (!unresolved) views.set(typed.row, semanticRaw(typed.row));
    else if (historical && carriers === mcp) {
      for (const { row } of terminals) views.set(row, { ...row, callId: '' });
    }
  }
  if (historical) views.set(call, { ...call, toolName: historical.qualifiedName, historicalMcpRequest: historical });
}

function dynamicOutcome(p) {
  if (p.type === 'dynamic_tool_call_declined') return 'declined';
  if (p.status === 'declined' || p.status === 'interrupted') return p.status;
  if (p.success === false || p.error || p.status === 'failed') return 'failed';
  return p.success === true || p.status === 'success' ? 'success' : 'completed';
}

function dynamicToolPeer(call, row) {
  if (call.payloadType !== 'function_call' || row.recordType !== 'event_msg') return null;
  const phase = toolLifecycleDescriptorFor(row.payloadType);
  if (phase?.family !== TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL) return null;
  if (row.typedItemType !== 'DynamicToolCall' && matchesDynamicTool(call, row) !== true) return null;
  return phase.phase === TOOL_LIFECYCLE_PHASE.TERMINAL
    ? { ...row, dynamicTerminalStatus: dynamicOutcome(row.originalRaw?.parsed.payload.item || row.parsed.payload) } : row;
}

function scopedRequestPeer(call, row) {
  if (row.typedItemType === 'McpToolCall') return call.payloadType === 'function_call' ? row : null;
  if (matchesToolOutput(call, row)) return row;
  if (row.recordType !== 'event_msg') return null;
  const family = toolLifecycleDescriptorFor(row.payloadType)?.family;
  if (family === TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL) return dynamicToolPeer(call, row);
  if (family !== TOOL_LIFECYCLE_FAMILY.MCP_TOOL) return null;
  const status = scopedLegacyMcpStatus(call, row);
  return status ? { ...row, status } : null;
}

// Ambiguous repeated identities are inspectable Protocol records. Never choose
// one call owner from duplicate items, conflicting turns or copied histories.
function semanticRawEvents(rawEvents, remainingToolPeer, requestCwds = new Map()) {
  const typedCounts = new Map();
  const byCall = new Map();
  const scopedCallIds = new Set();
  const ungroupedTyped = [];
  const epochs = turnBoundaryEpochs(rawEvents);
  let sessionCwd = '', contextSession = '', turnCwd = '', contextEpoch;
  for (const raw of rawEvents) {
    const p = raw.parsed?.payload;
    if (raw.recordType === 'session_meta') {
      contextSession = p?.id;
      sessionCwd = p?.cwd;
      contextEpoch = null;
    } else if (raw.recordType === 'turn_context' && raw.sessionId === contextSession) {
      turnCwd = p?.cwd;
      contextEpoch = epochs.get(raw.rawId);
      if (turnCwd !== sessionCwd) sessionCwd = ''; // An older default no longer proves a later turn's cwd.
    } else if (['custom_tool_call', 'function_call'].includes(raw.payloadType) && ['apply_patch', 'functions.apply_patch', 'exec_command', 'functions.exec_command'].includes(p?.name)
        && raw.sessionId === contextSession) {
      requestCwds.set(raw, contextEpoch === epochs.get(raw.rawId) ? turnCwd : sessionCwd);
    }
    if (raw.callId) {
      if (!byCall.has(raw.callId)) byCall.set(raw.callId, []);
      byCall.get(raw.callId).push(raw);
      if (scopedRequestToolName(raw)) scopedCallIds.add(raw.callId);
    }
    const item = raw.parsed?.payload?.item;
    if (raw.payloadType !== 'item_completed' || typeof item?.id !== 'string') continue;
    const key = JSON.stringify([raw.sessionId, item.id]);
    typedCounts.set(key, (typedCounts.get(key) || 0) + 1);
    if (!raw.callId && raw.recordType === 'event_msg'
        && (['McpToolCall', 'DynamicToolCall'].includes(item.type) || nativeItemTypes.has(item.type))) ungroupedTyped.push(raw);
  }
  const scopedViews = new Map();
  // An incomplete item may have no semantic callId yet still compete for its
  // physical item.id. Keep it visible to scope and uniqueness checks.
  for (const raw of ungroupedTyped) {
    const id = raw.parsed.payload.item.id;
    if (scopedCallIds.has(id)) byCall.get(id).push(raw);
  }
  for (const id of scopedCallIds) resolveScopedTerminals(byCall.get(id), epochs, scopedViews, remainingToolPeer, requestCwds);
  return rawEvents.map((raw) => {
    if (scopedViews.has(raw)) return scopedViews.get(raw);
    // The recorded namespace distinguishes the request from a native namesake
    // even without a terminal. Only the separate join below can verify MCP status.
    const scopedName = scopedRequestToolName(raw);
    if (scopedName) return { ...raw, toolName: scopedName, scopedRequest: true };
    const view = semanticRaw(raw);
    if (view === raw) return raw;
    const key = JSON.stringify([raw.sessionId, raw.parsed.payload.item.id]);
    if (raw.parsed.payload.item.id && typedCounts.get(key) !== 1) return { ...raw, callId: '' };
    if (view.callId) {
      const peers = (byCall.get(view.callId) || []).filter((peer) => peer !== raw);
      const calls = peers.filter((peer) => peer.recordType === 'response_item' && ['function_call', 'custom_tool_call'].includes(peer.payloadType));
      if (calls.length > 1 || peers.some((peer) => peer.sessionId !== raw.sessionId
          || epochs.get(peer.rawId)?.number !== epochs.get(raw.rawId)?.number
          || (peer.turnId && view.turnId && peer.turnId !== view.turnId))) return { ...raw, callId: '' };
      const callName = calls[0]?.toolName;
      const item = raw.parsed.payload.item;
      if (hasGeneratedImageFile(item) && peers.some((peer) => !imageFilePeer(peer))) return { ...raw, callId: '' };
      if (item.type === 'McpToolCall' && item.environmentId != null && calls[0]?.parsed?.payload?.namespace != null) return { ...raw, callId: '' };
      if (scopedRequestToolName(calls[0]) && !(item.type === 'DynamicToolCall'
          && calls[0].parsed.payload.namespace === item.namespace && callName === item.tool)) {
        return { ...raw, callId: '' };
      }
      const compatible = !callName || callName === view.toolName
        || (item.type === 'CommandExecution' && ['shell', 'exec_command', 'write_stdin', 'functions.exec_command', 'functions.shell_command', 'functions.write_stdin'].includes(callName))
        || (item.type === 'FileChange' && callName === 'functions.apply_patch')
        || (item.type === 'CollabAgentToolCall' && item.tool === 'wait' && callName === 'wait_agent'
          && calls[0].parsed?.payload?.namespace === 'collaboration')
        || (item.type === 'Extension' && ((item.kind === 'clock.sleep' && callName === 'sleep') || (item.kind === 'web.search' && callName === 'run') || (item.kind === 'image_gen.generation' && ['imagegen', 'image_gen'].includes(callName))))
        || (item.type === 'DynamicToolCall' && callName === item.tool && (!calls[0].parsed?.payload?.namespace || calls[0].parsed.payload.namespace === item.namespace));
      if (!compatible) return { ...raw, callId: '' };
    }
    return view;
  });
}

// Startup evidence is deliberately separate from requested tool arguments.
// Only a unique attached, source-shaped started activity supplies settings.
// Pinned producer: rust-v0.162.0 protocol/src/protocol.rs and protocol/src/items.rs.
function resolvedSubAgentStartup(raws) {
  const calls = raws.filter((raw) => raw.recordType === 'response_item'
    && raw.payloadType === 'function_call' && raw.toolName === 'spawn_agent');
  if (calls.length !== 1) return null;
  const activities = raws.filter((raw) => raw.recordType === 'event_msg'
    && raw.payloadType === 'sub_agent_activity');
  if (activities.length !== 1) return null;
  const p = activities[0].parsed?.payload;
  if (p?.kind !== 'started' || p.event_id !== calls[0].callId
      || typeof p.agent_thread_id !== 'string' || !p.agent_thread_id) return null;
  const fields = ['agent_thread_id', 'agent_path', 'model', 'reasoning_effort'];
  if (!p.model && !p.reasoning_effort) return null;
  if (fields.some((key) => p[key] != null && (typeof p[key] !== 'string' || p[key].length > 512))) return null;
  for (const raw of raws) {
    if (raw.recordType !== 'response_item' || raw.payloadType !== 'function_call_output') continue;
    let output;
    try { output = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output; } catch { continue; }
    for (const child of [output?.agent_id, output?.new_thread_id]) {
      if (child != null && child !== p.agent_thread_id) return null;
    }
  }
  return Object.fromEntries(fields.filter((key) => typeof p[key] === 'string' && p[key])
    .map((key) => [key, p[key]]));
}

function additionalToolsSummary(payload) {
  // rust-v0.162.0 ResponseItem::AdditionalTools preserves arbitrary JSON.
  // Recognize only function/namespace shapes, leaving other entries in Raw.
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  const names = [];
  let count = 0;
  let visited = 0;
  let unsupported = 0;
  let incomplete = false;
  const visit = (items, prefix = '', depth = 0) => {
    for (const item of items) {
      if (++visited > 256) { incomplete = true; return; }
      if (!item || typeof item !== 'object' || Array.isArray(item)) { unsupported += 1; continue; }
      const name = typeof item.name === 'string' ? item.name.length > 160 ? `${item.name.slice(0, 159)}…` : item.name : '';
      const qualified = prefix && name ? `${prefix}.${name}` : name || prefix;
      if (item.type === 'namespace' && name && Array.isArray(item.tools)) {
        if (names.length < 24 && qualified) names.push(`${qualified} (namespace)`);
        if (depth < 4) visit(item.tools, qualified, depth + 1);
        else if (item.tools.length) incomplete = true;
      } else if (item.type === 'function' && name) {
        count += 1;
        if (names.length < 24 && qualified) names.push(qualified);
      } else unsupported += 1;
    }
  };
  visit(tools);
  return { valid: payload?.type === 'additional_tools' && payload.role === 'developer' && Array.isArray(payload.tools), entries: tools.length, count, names, unsupported, incomplete, shortened: incomplete || names.length >= 24 };
}

module.exports = { captureToolArgumentEvidence, collaborationThreadId, typedItemRecord, semanticRaw, semanticRawEvents, turnBoundaryEpochs, resolvedSubAgentStartup, additionalToolsSummary, hasGeneratedImageFile, scopedRequestToolName, scopedRequestPeer, followsToolRequest, toolRowMatchesTurn, mergeToolTurn, toolPeersInTurn, legacyMcpStatus, historicalMcpPeer, matchesToolOutput, dynamicToolPeer, legacyCommandOrPatchMatches };
