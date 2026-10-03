'use strict';

const { typedItemRecord } = require('./codex-turn-items');

const {
  TOOL_LIFECYCLE_FAMILY,
  toolLifecycleDescriptorFor,
} = require('./codex-tool-lifecycle-contract');
const {
  asyncAgentMessageFromRecord,
  asyncMessageMetadata,
} = require('./codex-async-message');
const { summarizeCodexAttachments } = require('./codex-attachments');
const { externalToolInputFromRaw } = require('./codex-external-input');
const { factsFromRecord, targetFromRecord, isTransientRealtimeRecord } = require('./codex-persisted-history');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { projectSearchJson } = require('./search-json');
const { redactEmbeddedDataUrls } = require('./shared/logical-detail-sanitizer');

const OPAQUE_SEARCH_KEYS = new Set([
  'signature', 'thought_signature', 'thoughtSignature', 'encrypted_content', 'encryptedContent',
  'blob', 'base64', 'bytes', 'image_url', 'audio_url', 'images',
]);
const OPAQUE_CONTENT_TYPES = new Set([
  'image', 'input_image', 'output_image', 'audio', 'input_audio', 'output_audio',
  'encrypted_content', 'base64', 'redacted_thinking', 'encrypted_reasoning', 'document', 'video',
]);

function hasOpaqueImageResult(value) {
  return String(value?.type || '').startsWith('image_generation')
    || value?.type === 'ImageGeneration'
    || (value?.type === 'Extension' && value.kind === 'image_gen.generation');
}

// Search walks the supported textual payload independently of display budgets.
// Media bytes, encrypted content and signatures are never search text. This
// does not read references or files outside the accepted transcript.
function codexFullSearchText(value) {
  const parts = [];
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (current == null) continue;
    if (typeof current === 'string') {
      const text = redactEmbeddedDataUrls(current);
      if (text) parts.push(text);
    } else if (typeof current === 'number' || typeof current === 'boolean') {
      parts.push(String(current));
    } else if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i -= 1) stack.push(current[i]);
    } else if (typeof current === 'object' && !OPAQUE_CONTENT_TYPES.has(current.type)) {
      const entries = Object.entries(current);
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const [key, nested] = entries[i];
        if (OPAQUE_SEARCH_KEYS.has(key)) continue;
        if (key === 'result' && hasOpaqueImageResult(current)) continue;
        stack.push(nested);
      }
    }
  }
  return parts.join('\n').trim();
}

// Tool arguments/results often carry a serialized JSON object. Preserve its
// spelling (and occurrence counts) when safe; redact structured opaque fields
// before indexing instead of treating their encoded bytes as ordinary text.
function codexSearchValue(value) {
  return projectSearchJson(value, {
    excludedKeys: OPAQUE_SEARCH_KEYS,
    opaqueTypes: OPAQUE_CONTENT_TYPES,
    redactString: redactEmbeddedDataUrls,
    omitEntry: (key, parent) => key === 'result' && hasOpaqueImageResult(parent),
  });
}

function fullTypedText(content, type) {
  return Array.isArray(content)
    ? content.filter((part) => part?.type === type && typeof part.text === 'string')
      .map((part) => redactEmbeddedDataUrls(part.text)).join('\n').trim()
    : '';
}

function fullReasoningText(payload) {
  return [...new Set([
    fullTypedText(payload.summary, 'summary_text'),
    fullTypedText(payload.content, 'reasoning_text'),
  ].filter(Boolean))].join('\n');
}

function codexAsyncMessageText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.type !== 'item_completed') {
    return typeof payload.message === 'string' ? redactEmbeddedDataUrls(payload.message) : '';
  }
  return Array.isArray(payload.item?.content) ? payload.item.content
    .filter((part) => part?.type === 'Text' && typeof part.text === 'string')
    .map((part) => redactEmbeddedDataUrls(part.text)).join('') : '';
}

function codexAsyncSearchText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const item = payload.type === 'item_completed' ? payload.item : payload;
  if (!item || typeof item !== 'object') return '';
  const text = codexAsyncMessageText(payload);
  const questions = Array.isArray(item.questions) ? item.questions.flatMap((question) => (
    typeof question?.title === 'string' && question.title.trim()
      ? [question.title, ...(Array.isArray(question.options)
        ? question.options.filter((option) => typeof option === 'string') : [])] : []
  )) : [];
  return codexFullSearchText([text, ...questions]);
}

const CANONICAL_EVENT_TYPES = Object.freeze({
  turn_started: 'task_started',
  turn_complete: 'task_complete',
});

const CODEX_SOURCE_KIND = 'codex';
const CODEX_JSONL_LINE_LOCATOR_TYPE = 'jsonl_line';
const SUB_AGENT_ACTIVITY_EVENT_TYPE = 'sub_agent_activity';

function canonicalEventType(type) {
  const value = typeof type === 'string' ? type : '';
  return CANONICAL_EVENT_TYPES[value] || value;
}

function codexLocatorFile(file) {
  return (typeof file === 'string' ? file : '').replace(/\\/g, '/');
}

function codexSourceLocator(source) {
  if (!source || typeof source.file !== 'string' || !source.file || !Number.isSafeInteger(source.line) || source.line < 1) return null;
  return {
    type: CODEX_JSONL_LINE_LOCATOR_TYPE,
    file: codexLocatorFile(source.file),
    line: source.line,
  };
}

function sourceLocatorForRaw(raw) {
  if (raw?.sourceLocator?.type) return raw.sourceLocator;
  return codexSourceLocator(raw?.source);
}

function rawRef(raw) {
  raw = raw.originalRaw || raw;
  const sourceLocator = sourceLocatorForRaw(raw);
  return {
    file: typeof raw.source?.file === 'string' ? raw.source.file : sourceLocator?.file || '',
    line: Number.isSafeInteger(raw.source?.line) ? raw.source.line : sourceLocator?.line ?? null,
    rawId: typeof raw.rawId === 'string' ? raw.rawId : '',
    sourceLocator: sourceLocator ? {
      type: CODEX_JSONL_LINE_LOCATOR_TYPE,
      file: sourceLocator.file,
      line: sourceLocator.line,
    } : null,
    sourceRecordType: typeof raw.recordType === 'string' ? raw.recordType : '',
    sourceEventType: typeof raw.payloadType === 'string' ? raw.payloadType : '',
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

function subAgentActivityEventId(raw) {
  if (raw?.recordType !== 'event_msg' || raw?.payloadType !== SUB_AGENT_ACTIVITY_EVENT_TYPE) return '';
  const eventId = raw?.parsed?.payload?.event_id;
  return typeof eventId === 'string' ? eventId : '';
}

function codexSourceEnvelope(record) {
  const payload = record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload
    : {};
  const recordType = typeof record?.type === 'string' ? record.type : '';
  const payloadType = typeof payload.type === 'string' ? payload.type : '';
  const role = typeof payload.role === 'string' ? payload.role : '';
  return { payload, recordType, payloadType, role };
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

  function makeRawEvent(record, lineNumber, relFile, sessionId, embeddedImages = [], sourceAttachmentSummary = null) {
    const {
      payload,
      recordType,
      payloadType,
      role,
    } = codexSourceEnvelope(record);
    const stringField = (...values) => values.find((value) => typeof value === 'string') || '';
    const raw = {
      rawId: `${sessionId}:raw:${lineNumber}`,
      sessionId: typeof sessionId === 'string' ? sessionId : '',
      sourceKind: CODEX_SOURCE_KIND,
      line: lineNumber,
      source: { file: relFile, line: lineNumber },
      sourceLocator: codexSourceLocator({ file: relFile, line: lineNumber }),
      timestamp: safeIso(record.timestamp),
      turnId: stringField(payload.turn_id),
      recordType,
      payloadType,
      canonicalType: canonicalEventType(payloadType),
      role,
      typeKey: `${recordType}:${payloadType}:${role}`,
      callId: stringField(payload.call_id, payload.callId),
      toolName: stringField(payload.name, payload.tool_name, payload.tool),
      status: stringField(payload.status),
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

    const attachmentSummary = sourceAttachmentSummary || summarizeCodexAttachments(payload);
    const foreignCompletedItem = recordType === 'event_msg' && payloadType === 'item_completed'
      && payload.thread_id != null && payload.thread_id !== sessionId;
    if (foreignCompletedItem || recordType === 'realtime_item' || (recordType === 'response_item' && payloadType === 'configuration_update')) {
      raw.turnId = '';
      raw.callId = '';
      raw.toolName = '';
      raw.status = '';
    }
    const finishRaw = () => {
      if (attachmentSummary.totalCount > 0) {
        raw.attachmentSummary = attachmentSummary;
        const attachmentPreview = attachmentSummary.previewText;
        raw.preview = truncate([raw.preview, attachmentPreview].filter(Boolean).join(' · '));
        raw.searchText = [raw.searchText, attachmentPreview].filter(Boolean).join('\n');
      }
      return raw;
    };

    const history = factsFromRecord(record);
    if (isTransientRealtimeRecord(record)) {
      raw.turnId = '';
      raw.callId = '';
      raw.toolName = '';
      raw.preview = payloadType;
      raw.searchText = '';
      return raw;
    }
    const target = targetFromRecord(record);
    if (target) raw.historyTarget = target;
    if (history) {
      raw.historyFacts = history;
      // A promotion references a turn; it does not own that turn. Neither
      // realtime history nor a positional backend control is a tool call.
      raw.turnId = '';
      raw.callId = '';
      raw.toolName = '';
      raw.status = '';
      if (history.type === 'transcript_segment') {
        raw.messageText = payload.text.slice(0, 16000);
        raw.preview = truncate(raw.messageText);
        raw.searchText = codexFullSearchText(payload.text);
      } else {
        raw.preview = truncate(Object.entries(history.values || history)
          .filter(([key]) => !['type', 'itemId', 'realtimeSessionId'].includes(key))
          .map(([key, value]) => `${key}: ${value}`).join(' · ') || history.type);
        raw.searchText = raw.preview;
      }
      return raw;
    }

    const asyncMessage = asyncAgentMessageFromRecord(record);
    if (asyncMessage) {
      raw.asyncMessage = asyncMessageMetadata(asyncMessage);
      raw.messageText = asyncMessage.text;
      raw.preview = truncate(raw.messageText || 'Async assistant message');
      raw.searchText = codexAsyncSearchText(payload);
      return raw;
    }

    const typedRecord = typedItemRecord(record, sessionId);
    if (typedRecord) {
      const semantic = makeRawEvent(typedRecord, lineNumber, relFile, sessionId, embeddedImages, sourceAttachmentSummary);
      for (const key of ['role', 'callId', 'toolName', 'status', 'messageText', 'searchText', 'preview', 'commandText', 'stdout', 'stderr', 'aggregatedOutput', 'exitCode', 'durationMs', 'touchedFiles', 'output', 'attachmentSummary']) {
        if (Object.hasOwn(semantic, key)) raw[key] = semantic[key];
      }
      raw.durationMs = durationMs(record.payload.item.duration);
      return raw;
    }

    if (recordType === 'response_item') {
      if (payloadType === 'message') {
        raw.messageText = extractContentText(payload.content);
        raw.preview = truncate(raw.messageText || payload.role || 'message');
        raw.searchText = raw.messageText;
        return finishRaw();
      }
      if (payloadType === 'reasoning') {
        raw.messageText = extractReasoningText(payload);
        raw.preview = truncate(raw.messageText || 'reasoning');
        raw.searchText = fullReasoningText(payload);
        return raw;
      }
      if (payloadType === 'function_call') {
        raw.output = stringifyValue(payload.arguments);
        raw.preview = truncate(`${payload.name || 'function_call'} ${codexSearchValue(payload.arguments)}`);
        raw.searchText = `${payload.name || ''}\n${codexSearchValue(payload.arguments)}`;
        return raw;
      }
      if (payloadType === 'function_call_output') {
        const externalInput = externalToolInputFromRaw(raw);
        if (externalInput) {
          raw.output = externalInput.text;
          raw.preview = truncate(externalInput.text || externalInput.name || 'function_call_output');
          raw.searchText = [externalInput.name, externalInput.namespace, codexFullSearchText(payload.output)]
            .filter(Boolean).join('\n');
        } else {
          raw.output = stringifyValue(payload.output);
          raw.preview = truncate(codexSearchValue(payload.output) || payload.call_id || 'function_call_output');
          raw.searchText = codexSearchValue(payload.output);
        }
        return finishRaw();
      }
      if (payloadType === 'custom_tool_call') {
        raw.output = stringifyValue(payload.input);
        raw.preview = truncate(`${payload.name || 'custom_tool_call'} ${codexSearchValue(payload.input)}`);
        raw.searchText = `${payload.name || ''}\n${codexSearchValue(payload.input)}`;
        return raw;
      }
      if (payloadType === 'custom_tool_call_output') {
        raw.output = stringifyValue(payload.output);
        raw.preview = truncate(codexSearchValue(payload.output) || payload.call_id || 'custom_tool_call_output');
        raw.searchText = codexSearchValue(payload.output);
        return finishRaw();
      }
      if (payloadType === 'web_search_call') {
        raw.searchText = codexFullSearchText(payload);
        raw.preview = truncate(codexFullSearchText(payload.action || payload) || payload.status || 'web_search_call');
        return raw;
      }
      if (payloadType === 'image_generation_call') {
        raw.callId = stringField(payload.id, payload.call_id, payload.callId);
        raw.toolName = 'image_generation';
        raw.output = stringifyValue(payload);
        raw.preview = truncate(firstNonEmpty(payload.saved_path, payload.status, payload.type));
        raw.searchText = codexFullSearchText(payload);
        return raw;
      }
    }

    if (recordType === 'event_msg') {
      const lifecycleDescriptor = toolLifecycleDescriptorFor(payloadType);
      if (lifecycleDescriptor
          && lifecycleDescriptor.family !== TOOL_LIFECYCLE_FAMILY.COMMAND
          && lifecycleDescriptor.family !== TOOL_LIFECYCLE_FAMILY.PATCH) {
        if (payloadType === 'image_generation_end') raw.toolName = 'image_generation';
        raw.searchText = codexFullSearchText(payload);
        raw.preview = truncate(raw.searchText || payload.type);
        return raw;
      }

      switch (payloadType) {
        case 'user_message':
        case 'agent_message':
          raw.messageText = displayValue(firstNonEmpty(payload.message, payload.text), 16000);
          raw.preview = truncate(raw.messageText || payload.type);
          raw.searchText = codexFullSearchText(firstNonEmpty(payload.message, payload.text));
          return finishRaw();
        case 'agent_reasoning':
          raw.messageText = extractEventReasoningText(payload);
          raw.preview = truncate(raw.messageText || payload.type);
          raw.searchText = codexFullSearchText([payload.message, payload.text].find((value) => typeof value === 'string' && value.trim()) || '');
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
          raw.exitCode = payload.exit_code != null && payload.exit_code !== '' && Number.isFinite(Number(payload.exit_code)) ? Number(payload.exit_code) : null;
          raw.durationMs = durationMs(payload.duration);
          raw.preview = truncate(raw.commandText || displayValue(payload.reason, 1000) || payload.type);
          raw.searchText = [codexFullSearchText(payload.command), codexSearchValue(payload.stdout), codexSearchValue(payload.stderr), codexSearchValue(payload.aggregated_output), codexSearchValue(payload.formatted_output), codexFullSearchText(payload.reason)].join('\n');
          return raw;
        case 'patch_apply_end':
        case 'patch_apply_begin':
        case 'patch_apply_update':
        case 'patch_apply_delta':
        case 'patch_apply_declined':
          raw.touchedFiles = payload.changes && typeof payload.changes === 'object' ? Object.keys(payload.changes) : [];
          raw.output = stringifyValue(firstNonEmpty(payload.patch, payload.input, payload.diff));
          raw.preview = truncate(raw.touchedFiles.join(', ') || raw.output || displayValue(firstNonEmpty(payload.stdout, payload.stderr, payload.reason, payload.type), 1000));
          raw.searchText = [raw.touchedFiles.join('\n'), codexSearchValue(payload.changes), codexSearchValue(raw.output), codexSearchValue(payload.stdout), codexSearchValue(payload.stderr), codexFullSearchText(payload.reason)].join('\n');
          return raw;
        case 'token_count':
          raw.preview = truncate(formatTokenUsagePreview(payload) || codexFullSearchText(payload) || payload.type);
          raw.searchText = [tokenUsageSearchText(payload), codexFullSearchText(payload)].filter(Boolean).join('\n');
          return raw;
        case 'web_search_end':
        case 'context_compacted':
        case 'turn_aborted':
        case 'thread_rolled_back':
        case 'error':
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
          raw.searchText = codexFullSearchText(payload);
          raw.preview = truncate(raw.searchText || payload.type);
          return raw;
        default:
          raw.searchText = codexFullSearchText(payload);
          raw.preview = truncate(raw.searchText || payload.type || 'event');
          return raw;
      }
    }

    if (recordType === 'turn_context' || recordType === 'session_meta') {
      raw.searchText = codexFullSearchText(payload);
      raw.preview = truncate(raw.searchText || recordType);
      return raw;
    }

    raw.searchText = codexFullSearchText(record);
    raw.preview = truncate(raw.searchText || raw.typeKey);
    return raw;
  }

  return { makeRawEvent };
}

module.exports = {
  CANONICAL_SCHEMA_VERSION,
  CODEX_SOURCE_KIND,
  CODEX_JSONL_LINE_LOCATOR_TYPE,
  SUB_AGENT_ACTIVITY_EVENT_TYPE,
  codexFullSearchText,
  codexSearchValue,
  codexAsyncMessageText,
  codexAsyncSearchText,
  canonicalEventType,
  codexSourceLocator,
  codexSourceEnvelope,
  createCodexRawParser,
  rawEventsForLogicalEvent,
  rawMatchesEvent,
  rawRef,
  sourceLocatorForRaw,
  subAgentActivityEventId,
};
