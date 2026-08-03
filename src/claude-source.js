'use strict';

const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');

const CANONICAL_SCHEMA_VERSION = 1;
const CLAUDE_SOURCE_KIND = 'claude-code';
const JSONL_LINE_LOCATOR_TYPE = 'jsonl_line';
const TEXT_LIMIT = 16000;
const PREVIEW_LIMIT = 240;

function safeIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function truncate(value, limit = PREVIEW_LIMIT) {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function stringifyValue(value, budget = TEXT_LIMIT) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, budget);
  try {
    return JSON.stringify(value, null, 2).slice(0, budget);
  } catch {
    return String(value).slice(0, budget);
  }
}

function collectText(value, budget = TEXT_LIMIT, key = '') {
  if (budget <= 0 || value == null || key === 'signature') return '';
  if (typeof value === 'string') return value.slice(0, budget);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    let remaining = budget;
    for (const item of value) {
      const text = collectText(item, remaining);
      if (!text) continue;
      parts.push(text);
      remaining -= text.length;
      if (remaining <= 0) break;
    }
    return parts.join('\n').slice(0, budget);
  }
  if (typeof value !== 'object') return '';
  const preferredKeys = ['text', 'thinking', 'content', 'message', 'stdout', 'stderr', 'error', 'reason', 'description', 'query', 'url'];
  const keys = [
    ...preferredKeys.filter((candidate) => Object.hasOwn(value, candidate)),
    ...Object.keys(value).filter((candidate) => !preferredKeys.includes(candidate)),
  ];
  const parts = [];
  let remaining = budget;
  for (const childKey of keys) {
    if (childKey === 'signature') continue;
    const text = collectText(value[childKey], remaining, childKey);
    if (!text) continue;
    parts.push(text);
    remaining -= text.length;
    if (remaining <= 0) break;
  }
  return parts.join('\n').slice(0, budget);
}

function normalizedContentBlocks(record) {
  const content = record?.message?.content;
  if (Array.isArray(content)) return content.filter((block) => block && typeof block === 'object');
  if (typeof content === 'string' && content) return [{ type: 'text', text: content }];
  return [];
}

function blockText(block, budget = TEXT_LIMIT) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'thinking') return String(block.thinking || '').slice(0, budget);
  if (block.type === 'text') return String(block.text || '').slice(0, budget);
  if (block.type === 'tool_result') return collectText(block.content, budget);
  return collectText(block, budget);
}

function primaryPayloadType(record, blocks) {
  if (record.type === 'system') return String(record.subtype || record.type);
  if (record.type === 'attachment') return String(record.attachment?.type || record.type);
  if (record.type === 'queue-operation') return String(record.operation || record.type);
  if (blocks.length === 1 && blocks[0].type) return String(blocks[0].type);
  if (blocks.length > 1) return 'content_blocks';
  return String(record.type || '');
}

function sourceFilePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function claudeSourceLocator(source) {
  if (!source || !source.file || source.line == null) return null;
  return {
    type: JSONL_LINE_LOCATOR_TYPE,
    file: sourceFilePath(source.file),
    line: source.line,
  };
}

function claudeRawRef(raw) {
  const sourceLocator = raw?.sourceLocator || claudeSourceLocator(raw?.source);
  return {
    file: raw?.source?.file || sourceLocator?.file || '',
    line: raw?.source?.line ?? sourceLocator?.line ?? null,
    rawId: raw?.rawId || '',
    sourceLocator,
    sourceRecordType: raw?.recordType || '',
    sourceEventType: raw?.payloadType || '',
  };
}

function toolInputFiles(name, input) {
  if (!input || typeof input !== 'object') return [];
  const normalized = String(name || '').toLowerCase();
  if (!['write', 'edit', 'multiedit', 'notebookedit'].includes(normalized)) return [];
  return [
    input.file_path,
    input.filePath,
    input.notebook_path,
    input.notebookPath,
    input.path,
  ].filter((value) => typeof value === 'string' && value.trim());
}

function commandTextFromToolUse(block) {
  if (String(block?.name || '').toLowerCase() !== 'bash') return '';
  const command = block?.input?.command;
  if (Array.isArray(command)) return command.map(String).join(' ');
  return typeof command === 'string' ? command : '';
}

function toolResultStatus(record, block) {
  if (record?.toolDenialKind) return 'declined';
  if (block?.is_error === true) return 'failed';
  if (record?.toolUseResult?.interrupted === true) return 'failed';
  return block ? 'success' : '';
}

function rawPreview(record, blocks, payloadType) {
  if (record.type === 'assistant' || record.type === 'user') {
    const text = blocks.map((block) => blockText(block, 4000)).filter(Boolean).join('\n');
    if (text) return truncate(text);
  }
  if (record.type === 'system') return truncate(record.content || record.subtype || 'system');
  if (record.type === 'attachment') return truncate(collectText(record.attachment, 4000) || payloadType);
  if (record.type === 'queue-operation') return truncate(record.content || record.operation || payloadType);
  if (record.type === 'last-prompt') return truncate(record.lastPrompt || payloadType);
  if (record.type === 'custom-title') return truncate(record.customTitle || payloadType);
  if (record.type === 'ai-title') return truncate(record.aiTitle || payloadType);
  if (record.type === 'agent-name') return truncate(record.agentName || payloadType);
  return truncate(collectText(record, 4000) || payloadType || record.type);
}

function makeClaudeRawEvent(record, lineNumber, relFile, analyzerSessionId, sourceSessionId, options = {}) {
  const parseError = String(options.parseError || '');
  const rawText = parseError ? String(options.rawText || '').slice(0, TEXT_LIMIT) : '';
  const parsed = parseError ? null : sanitizeLogicalDetailValue(record);
  record = parsed;
  const hasPlainRecord = isPlainObject(record);
  record = hasPlainRecord ? record : {};
  const blocks = normalizedContentBlocks(record);
  const payloadType = parseError
    ? 'malformed_json'
    : hasPlainRecord
      ? primaryPayloadType(record, blocks)
      : 'unknown';
  const toolCalls = blocks
    .map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => block.type === 'tool_use')
    .map(({ block, blockIndex }) => ({
      blockIndex,
      id: String(block.id || ''),
      name: String(block.name || ''),
      input: block.input && typeof block.input === 'object' ? block.input : {},
      caller: block.caller && typeof block.caller === 'object' ? block.caller : null,
    }));
  const toolResults = blocks
    .map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => block.type === 'tool_result')
    .map(({ block, blockIndex }) => ({
      blockIndex,
      id: String(block.tool_use_id || ''),
      content: block.content,
      isError: block.is_error === true,
      status: toolResultStatus(record, block),
    }));
  const firstToolCall = toolCalls[0] || null;
  const firstToolResult = toolResults[0] || null;
  const messageText = blocks
    .filter((block) => ['text', 'thinking', 'tool_result'].includes(block.type))
    .map((block) => blockText(block))
    .filter(Boolean)
    .join('\n');
  const toolResultText = firstToolResult ? blockText(blocks[firstToolResult.blockIndex]) : '';
  const source = { file: relFile, line: lineNumber };
  const touchedFiles = [...new Set(toolCalls.flatMap((call) => toolInputFiles(call.name, call.input)))];
  const commandText = firstToolCall ? commandTextFromToolUse(blocks[firstToolCall.blockIndex]) : '';
  const structuredResult = record.toolUseResult && typeof record.toolUseResult === 'object'
    ? record.toolUseResult
    : null;
  const stdout = structuredResult ? stringifyValue(structuredResult.stdout) : '';
  const stderr = structuredResult ? stringifyValue(structuredResult.stderr) : '';
  const searchText = [
    parseError,
    rawText,
    messageText,
    commandText,
    ...toolCalls.map((call) => `${call.name}\n${stringifyValue(call.input)}`),
    toolResultText,
    stringifyValue(structuredResult),
    record.type === 'system' ? stringifyValue({
      subtype: record.subtype,
      content: record.content,
      level: record.level,
      compactMetadata: record.compactMetadata,
    }) : '',
    record.type === 'attachment' ? stringifyValue(record.attachment) : '',
    record.type === 'queue-operation' ? String(record.content || '') : '',
    record.type === 'last-prompt' ? String(record.lastPrompt || '') : '',
    record.type === 'custom-title' ? String(record.customTitle || '') : '',
    record.type === 'ai-title' ? String(record.aiTitle || '') : '',
    record.type === 'agent-name' ? String(record.agentName || '') : '',
  ].filter(Boolean).join('\n').slice(0, TEXT_LIMIT);

  return {
    rawId: `${analyzerSessionId}:raw:${lineNumber}`,
    sessionId: analyzerSessionId,
    sourceSessionId,
    sourceKind: CLAUDE_SOURCE_KIND,
    sourceClientVersion: String(record.version || ''),
    line: lineNumber,
    rawIndex: lineNumber,
    source,
    sourceLocator: claudeSourceLocator(source),
    timestamp: safeIso(record.timestamp),
    turnId: String(record.promptId || ''),
    promptId: String(record.promptId || ''),
    uuid: String(record.uuid || ''),
    parentUuid: String(record.parentUuid || ''),
    logicalParentUuid: String(record.logicalParentUuid || ''),
    recordType: parseError ? 'malformed' : hasPlainRecord ? String(record.type || '') : 'unknown',
    payloadType,
    canonicalType: payloadType,
    role: String(record.message?.role || (record.type === 'assistant' ? 'assistant' : record.type === 'user' ? 'user' : 'system')),
    typeKey: `${record.type || ''}:${payloadType}`,
    messageId: String(record.message?.id || ''),
    model: String(record.message?.model || record.model || ''),
    provider: String(record.message?.provider || record.provider || ''),
    effort: String(record.effort || record.message?.effort || ''),
    callId: String(firstToolCall?.id || firstToolResult?.id || ''),
    toolName: String(firstToolCall?.name || ''),
    status: String(firstToolResult?.status || ''),
    messageText,
    searchText,
    preview: parseError
      ? truncate(rawText || parseError)
      : hasPlainRecord
        ? rawPreview(record, blocks, payloadType)
        : truncate(parsed === null ? 'null' : stringifyValue(parsed)),
    commandText,
    stdout,
    stderr,
    aggregatedOutput: toolResultText,
    output: toolResultText,
    exitCode: Number.isFinite(Number(structuredResult?.exitCode))
      ? Number(structuredResult.exitCode)
      : Number.isFinite(Number(structuredResult?.exit_code))
        ? Number(structuredResult.exit_code)
        : null,
    durationMs: Number.isFinite(Number(structuredResult?.durationMs))
      ? Number(structuredResult.durationMs)
      : Number.isFinite(Number(structuredResult?.duration_ms))
        ? Number(structuredResult.duration_ms)
        : 0,
    touchedFiles,
    contentBlocks: blocks,
    toolCalls,
    toolResults,
    toolUseResult: record.toolUseResult,
    toolDenialKind: String(record.toolDenialKind || ''),
    sourceToolAssistantUUID: String(record.sourceToolAssistantUUID || ''),
    isMeta: record.isMeta === true,
    isCompactSummary: record.isCompactSummary === true,
    isApiErrorMessage: record.isApiErrorMessage === true,
    isSynthetic: record.message?.model === '<synthetic>',
    isSidechain: record.isSidechain === true,
    interruptedByShutdown: record.interruptedByShutdown === true,
    originKind: String(record.origin?.kind || ''),
    promptSource: String(record.promptSource || ''),
    agentId: String(record.agentId || record.toolUseResult?.agentId || ''),
    usage: record.message?.usage && typeof record.message.usage === 'object' ? record.message.usage : null,
    parseError,
    rawText,
    parsed: parseError ? null : parsed,
  };
}

function rawEventsForLogicalEvent(session, event) {
  const byId = new Map((session?.rawEvents || []).map((raw) => [raw.rawId, raw]));
  return (event?.rawRefs || []).map((ref) => byId.get(ref.rawId)).filter(Boolean);
}

module.exports = {
  CANONICAL_SCHEMA_VERSION,
  CLAUDE_SOURCE_KIND,
  JSONL_LINE_LOCATOR_TYPE,
  blockText,
  claudeRawRef,
  claudeSourceLocator,
  collectText,
  isPlainObject,
  makeClaudeRawEvent,
  normalizedContentBlocks,
  rawEventsForLogicalEvent,
  safeIso,
  stringifyValue,
  truncate,
};
