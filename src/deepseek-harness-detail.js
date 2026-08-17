'use strict';

const i18n = require('./shared/i18n');
const storage = require('./deepseek-harness-storage');

const SOURCE_KIND = storage.DEEPSEEK_SOURCE_KIND;
const SEARCH_TEXT_LIMIT = 16_000;

function sectionMarkdown(text, purpose, title = '', options = {}) {
  if (!text) return null;
  return {
    purpose,
    type: 'markdown',
    ...(title ? { title } : {}),
    html: renderMarkdownToHtml(text),
    ...(options.role ? { role: options.role } : {}),
  };
}

function sectionNotice(text, purpose, title = '', level = 'info') {
  if (!text) return null;
  return {
    purpose,
    type: 'notice',
    ...(title ? { title } : {}),
    text: String(text).slice(0, 4000),
    level,
  };
}

function sectionCode(code, language, purpose, title = '', role = '') {
  if (code == null || code === '') return null;
  return {
    purpose,
    type: 'code',
    ...(title ? { title } : {}),
    code: String(code).slice(0, 100_000),
    ...(language ? { language } : {}),
    ...(role ? { role } : {}),
  };
}

function sectionTerminal(text, purpose, title = '', stream = '') {
  if (!text) return null;
  return {
    purpose,
    type: 'terminal',
    ...(title ? { title } : {}),
    text: String(text).slice(0, 100_000),
    ...(stream ? { stream } : {}),
    ...(stream ? { language: '' } : {}),
  };
}

function sectionKv(entries, purpose, title = '') {
  const filtered = (entries || []).filter((entry) => entry && typeof entry.key === 'string');
  if (!filtered.length) return null;
  return {
    purpose,
    type: 'kv',
    ...(title ? { title } : {}),
    entries: filtered.map((entry) => ({
      key: entry.key,
      value: String(entry.value ?? ''),
      ...(entry.fact ? { fact: entry.fact } : {}),
    })),
  };
}

function sectionRawJson(value, title = 'Residual source fields') {
  return {
    purpose: 'fallback',
    type: 'raw_json',
    title,
    value,
    expanded: false,
  };
}

let markdownRenderer = null;
function renderMarkdownToHtml(text) {
  if (!markdownRenderer) {
    const MarkdownIt = require('markdown-it');
    markdownRenderer = new MarkdownIt({ html: false, linkify: true, breaks: false });
  }
  return markdownRenderer.render(String(text || ''));
}

function logicalTitle(event, locale) {
  const label = i18n.lookupKnownLabel(event.label || '', locale);
  if (label) return label;
  if (event.layer === 'protocol') return i18n.eventKindLabel(event.subtype || event.kind, locale);
  return i18n.eventKindLabel(event.kind, locale);
}

function commonDetail(event, locale) {
  return {
    id: event.id,
    schemaVersion: event.schemaVersion,
    sourceKind: SOURCE_KIND,
    kind: event.kind,
    subtype: event.subtype,
    layer: event.layer,
    title: logicalTitle(event, locale),
    sourceLocator: event.sourceLocator,
    meta: { source: event.source },
    rawRefs: event.rawRefs,
    timelineSections: [],
    inspectorSections: [],
  };
}

function visibleTextFromContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function reasoningTextFromContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'reasoning' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function toolCallBlocks(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'tool-call');
}

function parseToolArguments(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toolResultTextFromEvent(event) {
  const blocks = event?.data?.message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'tool-result' && Array.isArray(block.content))
    .flatMap((block) => block.content)
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function rawEventFor(session, rawId) {
  return session.rawEvents.find((raw) => raw.rawId === rawId);
}

function parsedEventsForRawIds(session, parsedByOrdinal, rawIds) {
  const out = [];
  const seen = new Set();
  for (const rawId of rawIds) {
    const raw = rawEventFor(session, rawId);
    if (!raw) continue;
    const ordinal = raw.sourceLocator?.recordOrdinal ?? raw.rawIndex;
    if (!Number.isSafeInteger(ordinal) || seen.has(ordinal)) continue;
    seen.add(ordinal);
    const record = parsedByOrdinal.get(ordinal);
    if (!record) continue;
    const decoded = storage.decodeStorageRecord(record);
    for (const event of decoded) out.push(event);
  }
  return out;
}

function detailForUserMessage(event) {
  const raws = event.rawRefs;
  const detail = commonDetail(event, i18n.DEFAULT_LOCALE);
  const content = sectionMarkdown(event.searchText || event.preview || '', 'content', '');
  if (content) detail.timelineSections.push(content);
  return detail;
}

function detailForAssistantMessage(event, session, parsedByOrdinal) {
  const detail = commonDetail(event, i18n.DEFAULT_LOCALE);
  const sourceEvent = parsedEventsForRawIds(session, parsedByOrdinal, [event.rawRefs?.[0]?.rawId])[0];
  const content = event.subtype === 'partial_assistant_stream'
    ? event.searchText || event.preview
    : visibleTextFromContent(sourceEvent?.data?.message?.content || []);
  const section = sectionMarkdown(content || event.preview || event.searchText || '', 'content', '');
  if (section) detail.timelineSections.push(section);

  const entries = [];
  if (sourceEvent?.data?.message?.id) {
    entries.push({ key: 'Message ID', value: sourceEvent.data.message.id });
  }
  if (sourceEvent?.data?.message?.source?.provider) {
    entries.push({ key: 'Provider', value: sourceEvent.data.message.source.provider, fact: 'provider' });
  }
  if (sourceEvent?.data?.message?.source?.model) {
    entries.push({ key: 'Model', value: sourceEvent.data.message.source.model, fact: 'model' });
  }
  const usage = sourceEvent?.data?.usage;
  if (usage) {
    detail.inspectorSections.push({
      purpose: 'context',
      type: 'token_usage',
      title: 'Token usage',
      items: [
        ['Input', 'inputTokens', usage.inputTokens],
        ['Output', 'outputTokens', usage.outputTokens],
        ['Cache read', 'cacheReadTokens', usage.cacheReadTokens],
        ['Cache write', 'cacheWriteTokens', usage.cacheWriteTokens],
        ['Reasoning', 'reasoningTokens', usage.reasoningTokens],
      ].filter(([, , value]) => Number.isFinite(value)).map(([label, field, value]) => ({
        key: field,
        field,
        label,
        value: Number(value) || 0,
        formatted: String(value ?? ''),
        primary: field === 'outputTokens',
      })),
    });
  }
  if (event.subtype === 'partial_assistant_stream') {
    detail.inspectorSections.push(sectionNotice(
      'Reconstructed from packed assistant stream rows because no finalized assistant/message exists. '
      + 'No finalized source message is manufactured; open the Raw records for exact physical evidence.',
      'traceability',
      'Reconstruction evidence',
    ));
  } else {
    const calls = toolCallBlocks(sourceEvent?.data?.message?.content || []);
    if (calls.length) {
      entries.push({
        key: 'Embedded tool request',
        value: calls.map((call) => call.name || 'tool').join(', '),
        fact: 'tool',
      });
    }
  }
  const kv = sectionKv(entries, 'context', 'Message evidence');
  if (kv) detail.inspectorSections.push(kv);
  return detail;
}

function detailForReasoning(event, session, parsedByOrdinal) {
  const detail = commonDetail(event, i18n.DEFAULT_LOCALE);
  const section = sectionMarkdown(event.searchText || event.preview || '', 'content', '');
  if (section) detail.timelineSections.push(section);
  detail.inspectorSections.push(sectionNotice(
    'Reasoning is assembled by the finalized DeepSeek assistant/message event; no separate finalized reasoning record exists.',
    'traceability',
    'Source traceability',
  ));
  return detail;
}

function detailForToolOperation(event, session, parsedByOrdinal) {
  const detail = commonDetail(event, i18n.DEFAULT_LOCALE);
  const records = parsedEventsForRawIds(
    session,
    parsedByOrdinal,
    (event.rawRefs || []).map((ref) => ref.rawId),
  );
  const call = records.find((candidate) => candidate.type === 'tool/call');
  const result = records.find((candidate) => candidate.type === 'tool/result');
  if (call) {
    if (String(call.data?.name || '').toLowerCase() === 'bash') {
      const parsed = parseToolArguments(call.data.arguments);
      const command = typeof parsed?.command === 'string' ? parsed.command : call.data.arguments;
      const request = sectionCode(command, 'shell', 'request', 'Command', '');
      if (request) detail.timelineSections.push(request);
    } else {
      const parsed = parseToolArguments(call.data.arguments);
      const request = sectionCode(
        parsed ? JSON.stringify(parsed, null, 2) : call.data.arguments,
        'json',
        'request',
        'Tool arguments',
      );
      if (request) detail.timelineSections.push(request);
    }
  }
  if (result) {
    const resultText = toolResultTextFromEvent(result);
    const resultSection = sectionTerminal(resultText, 'result', 'Tool result', '');
    if (resultSection) detail.timelineSections.push(resultSection);
  }
  const entries = [];
  if (call?.data?.callId) entries.push({ key: 'Call ID', value: call.data.callId });
  if (call) {
    const parsed = parseToolArguments(call.data.arguments);
    const fullRequest = sectionCode(
      parsed ? JSON.stringify(parsed, null, 2) : call.data.arguments,
      'json',
      'request',
      'Full request evidence',
    );
    if (fullRequest) detail.inspectorSections.push(fullRequest);
  }
  if (call?.data?.turn != null && call.data.step != null) {
    entries.push({ key: 'Turn / Step', value: `${call.data.turn} / ${call.data.step}` });
  }
  if (result?.data?.error) {
    entries.push({ key: 'Tool error', value: `${result.data.error.name || ''} ${result.data.error.code || ''}`.trim(), fact: 'recordType' });
  }
  const kv = sectionKv(entries, 'context', 'Call evidence');
  if (kv) detail.inspectorSections.push(kv);
  if (!result) {
    detail.inspectorSections.push(sectionNotice(
      'The durable log contains a tool/call without a matching tool/result. The operation is kept incomplete rather than inventing a completion.',
      'traceability',
      'Incomplete operation',
    ));
  }
  return detail;
}

function detailForProtocolEvent(event, session, parsedByOrdinal) {
  const detail = commonDetail(event, i18n.DEFAULT_LOCALE);
  const sourceEvent = parsedEventsForRawIds(session, parsedByOrdinal, [event.rawRefs?.[0]?.rawId])[0];
  const data = sourceEvent?.data || {};
  if (event.subtype === 'request/header') {
    const config = data.header?.config || {};
    detail.timelineSections.push(sectionKv([
      { key: 'Provider', value: config.provider, fact: 'provider' },
      { key: 'Model', value: config.model, fact: 'model' },
      { key: 'Reasoning effort', value: config.reasoningEffort, fact: 'effort' },
      { key: 'Max tokens', value: config.maxTokens },
      { key: 'Reason', value: data.reason },
    ], 'context', 'Request header') || sectionNotice('Request header', 'content'));
    detail.inspectorSections.push(sectionKv([
      { key: 'System prompt bytes', value: Buffer.byteLength(data.header?.system || '', 'utf8') },
      { key: 'Tool schemas', value: Array.isArray(data.header?.tools) ? data.header.tools.length : 0 },
    ], 'context', 'Request envelope'));
  } else if (event.subtype === 'request/context') {
    detail.timelineSections.push(sectionKv([
      { key: 'Provider', value: data.provider, fact: 'provider' },
      { key: 'Model', value: data.model, fact: 'model' },
      { key: 'Context window', value: data.contextWindow },
    ], 'context', 'Request context') || sectionNotice('Request context', 'content'));
  } else if (event.subtype === 'turn/end') {
    detail.timelineSections.push(sectionNotice(
      `Turn ${data.turn || ''} ended: ${String(data.reason?.kind || data.reason?.reason?.kind || 'unknown')}`,
      'result',
      'Turn ended',
    ));
  } else {
    const notice = sectionNotice(event.preview || i18n.humanize(event.subtype || event.kind), 'content', '');
    if (notice) detail.timelineSections.push(notice);
    if (event.subtype === 'unknown_event') {
      const value = sourceEvent?.data;
      if (value && Object.keys(value || {}).length) {
        detail.inspectorSections.push(sectionRawJson(value));
      }
    }
  }
  return detail;
}

function buildLogicalDetail(event, session, parsedByOrdinal) {
  if (event.kind === 'user_message') return detailForUserMessage(event);
  if (event.kind === 'assistant_message') return detailForAssistantMessage(event, session, parsedByOrdinal);
  if (event.kind === 'reasoning') return detailForReasoning(event, session, parsedByOrdinal);
  if (event.kind === 'command' || event.kind === 'other_tool_call') {
    return detailForToolOperation(event, session, parsedByOrdinal);
  }
  return detailForProtocolEvent(event, session, parsedByOrdinal);
}

function rawDetailFor(raw, parsed, session, locale) {
  const ref = rawRefFor(raw);
  return {
    id: raw.rawId,
    schemaVersion: raw.schemaVersion || 1,
    sourceKind: SOURCE_KIND,
    kind: raw.payloadType || raw.recordType,
    subtype: raw.role || '',
    layer: 'raw',
    title: i18n.rawRecordLabel(raw.payloadType || raw.recordType || '', locale),
    sourceLocator: raw.sourceLocator,
    sourceRecordType: raw.recordType || '',
    sourceEventType: raw.payloadType || '',
    meta: { source: raw.source },
    rawRefs: [ref],
    timelineSections: parsed
      ? [{
        purpose: 'fallback',
        type: 'raw_json',
        title: 'Physical storage record',
        value: parsed,
        expanded: true,
      }]
      : [{
        purpose: 'fallback',
        type: 'notice',
        title: 'Physical storage record',
        text: 'The exact physical record is available through Raw references.',
      }],
    inspectorSections: [],
  };
}

function rawRefFor(raw) {
  const locator = raw?.sourceLocator || null;
  return {
    file: typeof raw?.source?.file === 'string' ? raw.source.file : locator?.file || '',
    line: Number.isSafeInteger(raw?.source?.line) ? raw.source.line : (locator?.line ?? null),
    rawId: typeof raw?.rawId === 'string' ? raw.rawId : '',
    sourceLocator: locator ? { ...locator } : null,
    sourceRecordType: typeof raw?.recordType === 'string' ? raw.recordType : '',
    sourceEventType: typeof raw?.payloadType === 'string' ? raw.payloadType : '',
  };
}

async function parsedRecordsForSession(index, session, signal) {
  const evidence = storage.materializationEvidenceForSession(index, session);
  if (!evidence) throw storage.indexedSourceStaleError();
  const committedRead = await storage.readCommittedArtifactPrefix(
    evidence.target,
    evidence.compression,
    signal,
    evidence.acceptedSnapshot,
  );
  const parsed = new Map();
  for (let ordinal = 0; ordinal < committedRead.prefix.recordTexts.length; ordinal += 1) {
    storage.throwIfAborted(signal);
    try {
      parsed.set(ordinal, JSON.parse(committedRead.prefix.recordTexts[ordinal]));
    } catch {
      // Keep committed-prefix evidence; a later malformed record should not
      // make already indexed Raw records uninspectable.
    }
  }
  return parsed;
}

async function buildDeepSeekEventDetail(index, session, eventId, layer, options = {}) {
  const locale = i18n.resolveLocale(options.locale);
  if (layer === 'raw') {
    const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
    if (!raw) return null;
    const parsedByOrdinal = await parsedRecordsForSession(index, session, options.signal);
    const ordinal = raw.sourceLocator?.recordOrdinal ?? raw.rawIndex;
    const parsed = Number.isSafeInteger(ordinal) ? parsedByOrdinal.get(ordinal) : undefined;
    return rawDetailFor(raw, parsed, session, locale);
  }
  const event = session.logicalEvents.find((candidate) => (
    candidate.id === eventId && candidate.layer === layer
  ));
  if (!event) return null;
  const parsedByOrdinal = await parsedRecordsForSession(index, session, options.signal);
  return buildLogicalDetail(event, session, parsedByOrdinal);
}

module.exports = {
  buildDeepSeekEventDetail,
  sectionCode,
  sectionKv,
  sectionMarkdown,
  sectionNotice,
  sectionTerminal,
};
