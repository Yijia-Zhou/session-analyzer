'use strict';

const CANONICAL_EVENT_TYPES = Object.freeze({
  turn_started: 'task_started',
  turn_complete: 'task_complete',
});

const CANONICAL_SCHEMA_VERSION = 1;
const CODEX_SOURCE_KIND = 'codex';
const CODEX_JSONL_LINE_LOCATOR_TYPE = 'jsonl_line';

function canonicalEventType(type) {
  return CANONICAL_EVENT_TYPES[type] || type || '';
}

function codexLocatorFile(file) {
  return String(file || '').replace(/\\/g, '/');
}

function codexSourceLocator(source) {
  if (!source || !source.file || source.line == null) return null;
  return {
    type: CODEX_JSONL_LINE_LOCATOR_TYPE,
    file: codexLocatorFile(source.file),
    line: source.line,
  };
}

function rawRef(raw) {
  return {
    file: raw.source.file,
    line: raw.source.line,
    rawId: raw.rawId,
    sourceLocator: codexSourceLocator(raw.source),
    sourceRecordType: raw.recordType || '',
    sourceEventType: raw.payloadType || '',
  };
}

function rawMatchesEvent(raw, event) {
  if (!raw) return false;
  if (!event) return false;
  return event.rawRefs.some((ref) => ref.rawId === raw.rawId);
}

function rawEventsForLogicalEvent(session, event) {
  const byId = new Map(session.rawEvents.map((raw) => [raw.rawId, raw]));
  return event.rawRefs.map((ref) => byId.get(ref.rawId)).filter(Boolean);
}

function createCodexRawParser(deps) {
  const {
    commandToText,
    displayValue,
    durationMs,
    extractContentText,
    extractEventReasoningText,
    extractReasoningText,
    firstNonEmpty,
    flattenText,
    formatTokenUsagePreview,
    safeIso,
    stringifyValue,
    tokenUsageSearchText,
    truncate,
  } = deps;

  function makeRawEvent(record, lineNumber, relFile, sessionId, embeddedImages = []) {
    const payload = record.payload || {};
    const raw = {
      rawId: `${sessionId}:raw:${lineNumber}`,
      sessionId,
      line: lineNumber,
      source: { file: relFile, line: lineNumber },
      timestamp: safeIso(record.timestamp),
      turnId: payload.turn_id || '',
      recordType: record.type || '',
      payloadType: payload.type || '',
      canonicalType: canonicalEventType(payload.type || ''),
      role: payload.role || '',
      typeKey: `${record.type}:${payload.type || ''}:${payload.role || ''}`,
      callId: payload.call_id || payload.callId || '',
      toolName: payload.name || payload.tool_name || payload.tool || '',
      status: payload.status || '',
      messageText: '',
      searchText: '',
      preview: '',
      commandText: '',
      stdout: '',
      stderr: '',
      aggregatedOutput: '',
      exitCode: null,
      durationMs: 0,
      touchedFiles: [],
      embeddedImages,
      parsed: record,
      output: '',
      rawIndex: lineNumber,
    };

    if (record.type === 'response_item') {
      if (payload.type === 'message') {
        raw.messageText = extractContentText(payload.content);
        raw.preview = truncate(raw.messageText || payload.role || 'message');
        raw.searchText = raw.messageText;
        return raw;
      }
      if (payload.type === 'reasoning') {
        raw.messageText = extractReasoningText(payload);
        raw.preview = truncate(raw.messageText || 'reasoning');
        raw.searchText = raw.messageText;
        return raw;
      }
      if (payload.type === 'function_call') {
        raw.output = stringifyValue(payload.arguments);
        raw.preview = truncate(`${payload.name || 'function_call'} ${raw.output}`);
        raw.searchText = `${payload.name || ''}\n${raw.output}`;
        return raw;
      }
      if (payload.type === 'function_call_output') {
        raw.output = stringifyValue(payload.output);
        raw.preview = truncate(raw.output || payload.call_id || 'function_call_output');
        raw.searchText = raw.output;
        return raw;
      }
      if (payload.type === 'custom_tool_call') {
        raw.output = stringifyValue(payload.input);
        raw.preview = truncate(`${payload.name || 'custom_tool_call'} ${raw.output}`);
        raw.searchText = `${payload.name || ''}\n${raw.output}`;
        return raw;
      }
      if (payload.type === 'custom_tool_call_output') {
        raw.output = stringifyValue(payload.output);
        raw.preview = truncate(raw.output || payload.call_id || 'custom_tool_call_output');
        raw.searchText = raw.output;
        return raw;
      }
      if (payload.type === 'web_search_call') {
        raw.preview = truncate(flattenText(payload.action || payload, 8000) || payload.status || 'web_search_call');
        raw.searchText = flattenText(payload, 12000);
        return raw;
      }
      if (payload.type === 'image_generation_call') {
        raw.callId = payload.id || payload.call_id || payload.callId || '';
        raw.toolName = 'image_generation';
        raw.output = stringifyValue(payload);
        raw.preview = truncate(firstNonEmpty(payload.saved_path, payload.status, payload.type));
        raw.searchText = flattenText(payload, 16000);
        return raw;
      }
    }

    if (record.type === 'event_msg') {
      switch (payload.type) {
        case 'user_message':
        case 'agent_message':
          raw.messageText = displayValue(firstNonEmpty(payload.message, payload.text), 16000);
          raw.preview = truncate(raw.messageText || payload.type);
          raw.searchText = raw.messageText;
          return raw;
        case 'agent_reasoning':
          raw.messageText = extractEventReasoningText(payload);
          raw.preview = truncate(raw.messageText || payload.type);
          raw.searchText = raw.messageText;
          return raw;
        case 'exec_command_end':
        case 'exec_command_begin':
        case 'exec_command_update':
        case 'exec_command_delta':
        case 'exec_command_declined':
          raw.commandText = commandToText(payload.command);
          raw.stdout = stringifyValue(payload.stdout);
          raw.stderr = stringifyValue(payload.stderr);
          raw.aggregatedOutput = stringifyValue(payload.aggregated_output);
          raw.exitCode = Number.isFinite(Number(payload.exit_code)) ? Number(payload.exit_code) : null;
          raw.durationMs = durationMs(payload.duration);
          raw.preview = truncate(raw.commandText || displayValue(payload.reason, 1000) || payload.type);
          raw.searchText = [raw.commandText, raw.stdout, raw.stderr, raw.aggregatedOutput, stringifyValue(payload.formatted_output)].join('\n');
          return raw;
        case 'patch_apply_end':
        case 'patch_apply_begin':
        case 'patch_apply_update':
        case 'patch_apply_delta':
        case 'patch_apply_declined':
          raw.touchedFiles = payload.changes && typeof payload.changes === 'object' ? Object.keys(payload.changes) : [];
          raw.output = stringifyValue(firstNonEmpty(payload.patch, payload.input, payload.diff));
          raw.preview = truncate(raw.touchedFiles.join(', ') || raw.output || displayValue(firstNonEmpty(payload.stdout, payload.stderr, payload.reason, payload.type), 1000));
          raw.searchText = [raw.touchedFiles.join('\n'), raw.output, stringifyValue(payload.stdout), stringifyValue(payload.stderr), displayValue(payload.reason, 4000)].join('\n');
          return raw;
        case 'token_count':
          raw.preview = truncate(formatTokenUsagePreview(payload) || flattenText(payload, 12000) || payload.type);
          raw.searchText = [tokenUsageSearchText(payload), flattenText(payload, 16000)].filter(Boolean).join('\n');
          return raw;
        case 'mcp_tool_call_end':
        case 'mcp_tool_call_begin':
        case 'mcp_tool_call_update':
        case 'mcp_tool_call_delta':
        case 'mcp_tool_call_declined':
        case 'image_generation_call_begin':
        case 'image_generation_call_update':
        case 'image_generation_call_delta':
        case 'image_generation_call_end':
        case 'image_generation_call_declined':
        case 'image_generation_end':
        case 'dynamic_tool_call_begin':
        case 'dynamic_tool_call_update':
        case 'dynamic_tool_call_delta':
        case 'dynamic_tool_call_end':
        case 'dynamic_tool_call_declined':
        case 'approval_request_begin':
        case 'approval_request_end':
        case 'approval_request_declined':
        case 'hook_begin':
        case 'hook_end':
        case 'hook_declined':
        case 'hook_started':
        case 'hook_completed':
        case 'web_search_end':
        case 'context_compacted':
        case 'turn_aborted':
        case 'thread_rolled_back':
        case 'error':
        case 'collab_agent_spawn_end':
        case 'collab_agent_spawn_begin':
        case 'collab_agent_interaction_end':
        case 'collab_agent_interaction_begin':
        case 'collab_waiting_end':
        case 'collab_waiting_begin':
        case 'collab_close_end':
        case 'collab_close_begin':
        case 'task_started':
        case 'task_complete':
        case 'turn_started':
        case 'turn_complete':
        case 'item_completed':
        case 'thread_name_updated':
        case 'thread_goal_updated':
        case 'session_configured':
        case 'warning':
        case 'guardian_warning':
        case 'stream_error':
        case 'plan_update':
        case 'plan_delta':
          if (payload.type === 'image_generation_end') raw.toolName = 'image_generation';
          raw.preview = truncate(flattenText(payload, 12000) || payload.type);
          raw.searchText = flattenText(payload, 16000);
          return raw;
        default:
          raw.preview = truncate(flattenText(payload, 12000) || payload.type || 'event');
          raw.searchText = flattenText(payload, 16000);
          return raw;
      }
    }

    if (record.type === 'turn_context' || record.type === 'session_meta') {
      raw.preview = truncate(flattenText(payload, 12000) || record.type);
      raw.searchText = flattenText(payload, 16000);
      return raw;
    }

    raw.preview = truncate(flattenText(record, 12000) || raw.typeKey);
    raw.searchText = flattenText(record, 16000);
    return raw;
  }

  return { makeRawEvent };
}

module.exports = {
  CANONICAL_SCHEMA_VERSION,
  CODEX_SOURCE_KIND,
  CODEX_JSONL_LINE_LOCATOR_TYPE,
  canonicalEventType,
  codexSourceLocator,
  createCodexRawParser,
  rawEventsForLogicalEvent,
  rawMatchesEvent,
  rawRef,
};
