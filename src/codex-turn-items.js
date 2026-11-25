'use strict';

const { createHash } = require('node:crypto');
const { toolLifecycleDescriptorFor, TOOL_LIFECYCLE_FAMILY, TOOL_LIFECYCLE_PHASE } = require('./codex-tool-lifecycle-contract');

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

function turnBoundaryEpochs(rawEvents) {
  const epochs = new Map();
  let epoch = 0;
  let turnId = '';
  for (const raw of rawEvents) {
    const boundary = ['task_started', 'task_complete', 'turn_aborted'].includes(raw.canonicalType);
    if (boundary || (turnId && raw.turnId && raw.turnId !== turnId)) epoch += 1;
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

// null means the registration cannot be checked; false means a different registration.
function matchesScopedMcpCall(raw, server, tool, environmentId) {
  const call = raw.parsed.payload;
  if (call.type !== 'function_call'
      || typeof call.namespace !== 'string' || call.namespace.length + 2 + call.name.length > 128) return null;
  const registration = scopedToolNamespace.exec(call.namespace);
  if (!registration) return null;
  const knownServer = typeof server === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(server);
  const knownTool = typeof tool === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(tool);
  if ((knownServer && registration[2] !== server) || (knownTool && call.name !== tool)) return false;
  if (typeof environmentId !== 'string' || !environmentId || environmentId.length > 4096) return null;
  const scope = createHash('sha1').update(environmentId).digest('hex').slice(0, 12);
  if (registration[1] !== scope) return false;
  return knownServer && knownTool ? true : null;
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

function matchesDynamicTool(call, row) {
  const { name, namespace } = call.parsed.payload;
  const { tool_name: tool, namespace: recordedNamespace } = row.parsed.payload;
  if (typeof name !== 'string' || (namespace != null && typeof namespace !== 'string')) return null;
  if (typeof recordedNamespace === 'string' && dynamicNamespace(recordedNamespace) !== dynamicNamespace(namespace)) return false;
  if ((recordedNamespace != null && typeof recordedNamespace !== 'string') || typeof tool !== 'string' || !tool) return null;
  return tool === (namespace && namespace !== 'functions' ? namespace + '.' + name : name);
}

function scopedLegacyMcpStatus(call, row) {
  const p = row.parsed?.payload;
  const invocation = p?.invocation;
  if (!invocation || !matchesScopedMcpCall(call, invocation.server, invocation.tool, invocation.environment_id)) return '';
  return legacyMcpStatus(p);
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

function followsToolRequest(call, row, epochs) {
  return row.line > call.line && row.sessionId === call.sessionId && epochs.get(row.rawId) === epochs.get(call.rawId)
    && (!row.turnId || !call.turnId || row.turnId === call.turnId);
}

// match is false for an identified foreign owner and null for an unresolved identity.
function scopedLifecycleCarrier(call, row, scopedFunction, singleRequest) {
  const p = row.parsed.payload;
  const item = p.item;
  if (row.payloadType === 'item_completed') {
    if (item?.id !== call.callId) return null;
    let family, match, status;
    if (scopedFunction && item.type === 'McpToolCall') {
      family = TOOL_LIFECYCLE_FAMILY.MCP_TOOL;
      match = matchesScopedMcpCall(call, item.server, item.tool, item.environmentId);
      if (['completed', 'failed'].includes(item.status)) status = row.status === 'failed' ? 'failed' : 'success';
    } else if (item.type === 'DynamicToolCall') {
      family = TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL;
      match = matchesDynamicIdentity(call, item.tool, item.namespace);
      if (['completed', 'failed', 'declined', 'interrupted'].includes(item.status)) status = dynamicOutcome(item);
      if (item.status === 'in_progress') status = '';
    } else return null;
    if (p.thread_id != null && p.thread_id !== call.sessionId) match = false;
    // A lone historical dynamic request already has the physical session and
    // turn checked by followsToolRequest. Cross-channel joins need explicit IDs.
    const explicitIds = p.thread_id === call.sessionId && typeof p.turn_id === 'string' && p.turn_id.length > 0;
    const canJoin = explicitIds || (singleRequest && item.type === 'DynamicToolCall');
    if (match !== false && status == null) match = null;
    return { row, family, match, status, typed: true, canJoin };
  }
  const descriptor = toolLifecycleDescriptorFor(row.payloadType);
  const terminal = descriptor?.phase === TOOL_LIFECYCLE_PHASE.TERMINAL;
  if (scopedFunction && descriptor?.family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL) {
    const i = p.invocation;
    const match = matchesScopedMcpCall(call, i?.server, i?.tool, i?.environment_id);
    const status = terminal ? legacyMcpStatus(p) : '';
    return { row, family: descriptor.family, match: match && terminal && !status ? null : match, status };
  }
  if (descriptor?.family !== TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL) return null;
  return { row, family: descriptor.family, match: matchesDynamicTool(call, row), status: terminal ? dynamicOutcome(p) : '' };
}

// Compare physical carriers before projecting either format into a logical event.
function resolveScopedTerminals(group, epochs, views, remainingToolPeer) {
  const requests = group.filter(row => row.recordType === 'response_item' && ['function_call', 'custom_tool_call'].includes(row.payloadType));
  const functions = requests.filter(row => row.payloadType === 'function_call');
  if (functions.length !== 1) return;
  const call = functions[0];
  const scopedFunction = Boolean(scopedRequestToolName(call));
  const peers = group.filter(row => followsToolRequest(call, row, epochs));
  const eligible = new Set(peers);
  const identified = new Set();
  const mcp = [];
  const dynamic = [];
  for (const row of group) {
    if (row.recordType !== 'event_msg') continue;
    const carrier = scopedLifecycleCarrier(call, row, scopedFunction, requests.length === 1);
    if (!carrier) continue;
    // Typed rows start in Protocol. Only a unique in-scope owner can claim one.
    if (carrier.typed) views.set(row, { ...row, callId: '' });
    if (!eligible.has(row) || carrier.match == null) continue;
    identified.add(row);
    if (carrier.match) {
      const family = carrier.family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL ? mcp : dynamic;
      family.push(carrier);
    }
  }
  const competingFamilies = mcp.length > 0 && dynamic.length > 0;
  const custom = requests.length === 2 && requests.find(row => row.payloadType === 'custom_tool_call');
  for (const carriers of [mcp, dynamic]) {
    const terminals = carriers.filter(carrier => carrier.status);
    const typedItems = carriers.filter(carrier => carrier.typed);
    const outcomes = new Set(terminals.map(carrier => carrier.status));
    outcomes.delete('completed'); // A neutral receipt does not contradict a specific terminal.
    const disputed = outcomes.size > 1 || typedItems.length > 1
      || terminals.filter(carrier => !carrier.typed).length > 1;
    if (competingFamilies || disputed) {
      for (const { row } of competingFamilies ? carriers : terminals) views.set(row, { ...row, callId: '' });
      continue;
    }
    const typed = typedItems[0];
    if (!typed?.canJoin) continue;
    // A request or receipt has its own wire channel. Any remaining unidentified
    // lifecycle needs an independent owner before a typed terminal can join.
    const unresolved = peers.some(row => {
      if (identified.has(row)) return false;
      if (row.recordType === 'response_item' && ['custom_tool_call', 'custom_tool_call_output', 'function_call_output'].includes(row.payloadType)) return false;
      if (row.recordType === 'event_msg' && ['dynamic_tool_call_request', 'dynamic_tool_call_response'].includes(row.payloadType)) {
        // A transport mirror stays in Protocol. It can corroborate the identity
        // of a typed dynamic item, but cannot supply an outcome or attest MCP.
        const p = row.parsed.payload;
        const turn = call.turnId || typed.row.turnId;
        if (row.payloadType === 'dynamic_tool_call_request' && typeof p.turnId === 'string' && p.turnId && turn && p.turnId !== turn) return false;
        const match = matchesDynamicIdentity(call, p.tool, p.namespace);
        return match !== false && !(match && carriers === dynamic);
      }
      return !(custom && followsToolRequest(custom, row, epochs) && remainingToolPeer?.(custom, row));
    });
    if (!unresolved) views.set(typed.row, semanticRaw(typed.row));
  }
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
  if (row.typedItemType !== 'DynamicToolCall' && !matchesDynamicTool(call, row)) return null;
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
function semanticRawEvents(rawEvents, remainingToolPeer) {
  const typedCounts = new Map();
  const byCall = new Map();
  const scopedCallIds = new Set();
  const ungroupedTyped = [];
  const epochs = turnBoundaryEpochs(rawEvents);
  for (const raw of rawEvents) {
    if (raw.callId) {
      if (!byCall.has(raw.callId)) byCall.set(raw.callId, []);
      byCall.get(raw.callId).push(raw);
      if (scopedRequestToolName(raw)) scopedCallIds.add(raw.callId);
    }
    const item = raw.parsed?.payload?.item;
    if (raw.payloadType !== 'item_completed' || typeof item?.id !== 'string') continue;
    const key = JSON.stringify([raw.sessionId, item.id]);
    typedCounts.set(key, (typedCounts.get(key) || 0) + 1);
    if (!raw.callId && raw.recordType === 'event_msg' && ['McpToolCall', 'DynamicToolCall'].includes(item.type)) ungroupedTyped.push(raw);
  }
  const scopedViews = new Map();
  // An incomplete item may have no semantic callId yet still compete for its
  // physical item.id. Keep it visible to scope and uniqueness checks.
  for (const raw of ungroupedTyped) {
    const id = raw.parsed.payload.item.id;
    if (scopedCallIds.has(id)) byCall.get(id).push(raw);
  }
  for (const id of scopedCallIds) resolveScopedTerminals(byCall.get(id), epochs, scopedViews, remainingToolPeer);
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
          || epochs.get(peer.rawId) !== epochs.get(raw.rawId)
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

module.exports = { typedItemRecord, semanticRaw, semanticRawEvents, turnBoundaryEpochs, resolvedSubAgentStartup, additionalToolsSummary, hasGeneratedImageFile, scopedRequestToolName, scopedRequestPeer, followsToolRequest, legacyMcpStatus, matchesToolOutput, dynamicToolPeer };
