'use strict';

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
        if (typeof i.status !== 'string' || typeof i.result !== 'string') return null;
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

// Ambiguous repeated identities are inspectable Protocol records. Never choose
// one call owner from duplicate items, conflicting turns or copied histories.
function semanticRawEvents(rawEvents) {
  const typedCounts = new Map();
  const byCall = new Map();
  const epochs = turnBoundaryEpochs(rawEvents);
  for (const raw of rawEvents) {
    if (raw.callId) {
      if (!byCall.has(raw.callId)) byCall.set(raw.callId, []);
      byCall.get(raw.callId).push(raw);
    }
    const item = raw.parsed?.payload?.item;
    if (raw.payloadType !== 'item_completed' || typeof item?.id !== 'string') continue;
    const key = JSON.stringify([raw.sessionId, item.id]);
    typedCounts.set(key, (typedCounts.get(key) || 0) + 1);
  }
  return rawEvents.map((raw) => {
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

module.exports = { typedItemRecord, semanticRaw, semanticRawEvents, turnBoundaryEpochs };
