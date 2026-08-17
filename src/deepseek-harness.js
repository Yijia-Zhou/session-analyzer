'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const MarkdownIt = require('markdown-it');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');
const { isPathInsideOrSame, resolveFsPath } = require('./shared/fs-path');
const i18n = require('./shared/i18n');
const {
  createProjectQueryStoreBuilder,
} = require('./project-query-store');
const { createSessionQuery } = require('./session-query');
const storage = require('./deepseek-harness-storage');
const { buildDeepSeekEventDetail } = require('./deepseek-harness-detail');

const SOURCE_KIND = storage.DEEPSEEK_SOURCE_KIND;
const PREVIEW_LIMIT = 240;
const SEARCH_TEXT_LIMIT = 16_000;
const PARTIAL_BLOCK_TEXT_LIMIT = SEARCH_TEXT_LIMIT;
const TITLE_LIMIT = 120;
const REASONING_LIMIT = SEARCH_TEXT_LIMIT;

// Generated upstream vocabulary at tmp/deepseek-harness HEAD 47f9438…:
// packages/core/session/src/known-event-types.ts. Known-but-unmodeled types
// stay explicit Protocol fallback; anything outside this set is an unknown
// plugin/third-party event and must never be silently dropped.
const KNOWN_DS_EVENT_TYPES = new Set([
  'agent-preset/selected',
  'agent/inbox/spliced',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'assistant/chunk',
  'assistant/message',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'llm/retry',
  'llm/retry-started',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/descriptor',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/call',
  'tool/code-dispatch',
  'tool/code-dispatch-start',
  'tool/result',
  'turn/end',
  'turn/start',
  'user/message',
  'web/deepseek-search-llm-request',
]);

function emptyCounts() {
  return {
    turns: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    reasoning: 0,
    toolCalls: 0,
    failedCommands: 0,
    issueEvents: 0,
    patches: 0,
    compactions: 0,
    aborts: 0,
    errors: 0,
    protocol: 0,
    planArtifacts: 0,
    planEvents: 0,
  };
}

function emptySummary() {
  return {
    topTools: [],
    failedCommandCount: 0,
    patchedFiles: [],
    protocolCount: 0,
  };
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function textContentBlocks(content) {
  return Array.isArray(content) ? content : [];
}

function visibleText(content) {
  return textContentBlocks(content)
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function reasoningText(content) {
  return textContentBlocks(content)
    .filter((block) => block && block.type === 'reasoning' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function toolCallBlocks(content) {
  return textContentBlocks(content).filter((block) => block && block.type === 'tool-call');
}

function truncatePreview(value, limit = PREVIEW_LIMIT) {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function appendBounded(existing, delta, budget) {
  if (budget <= 0 || existing.length >= budget) return existing.slice(0, budget);
  return `${existing}${delta}`.slice(0, budget);
}

function safeIso(value) {
  return storage.safeIso(value);
}

function eventTime(event) {
  return Number.isSafeInteger(event?.time) ? event.time : 0;
}

function turnStepKey(event) {
  return `${event?.data?.turn ?? 0}:${event?.data?.step ?? 0}`;
}

function turnIdFor(event) {
  if (!Number.isSafeInteger(event?.data?.turn)) return '';
  return `turn:${event.data.turn}`;
}

function reasonText(reason) {
  if (!reason || typeof reason !== 'object') return String(reason || '');
  if (reason.kind === 'aborted') return `aborted by ${reason.reason?.kind || 'unknown'}`;
  return String(reason.kind || '');
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

function commandTextForTool(name, argumentsText) {
  if (String(name || '').toLowerCase() !== 'bash') return '';
  const args = parseToolArguments(argumentsText);
  return typeof args?.command === 'string' ? args.command : '';
}

function toolResultText(event) {
  const blocks = event?.data?.message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'tool-result' && Array.isArray(block.content))
    .flatMap((block) => block.content)
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function toolResultIsError(event) {
  if (event?.data?.error) return true;
  const blocks = event?.data?.message?.content;
  return Array.isArray(blocks) && blocks.some((block) => (
    block && block.type === 'tool-result' && block.isError === true
  ));
}

function protocolPreview(type, data) {
  const value = data && typeof data === 'object' ? data : {};
  switch (type) {
    case 'turn/start':
      return `Turn ${value.turn} started`;
    case 'turn/end':
      return `Turn ${value.turn} ended: ${reasonText(value.reason)}`;
    case 'step/start':
      return `Step ${value.turn}.${value.step} started`;
    case 'step/end':
      return `Step ${value.turn}.${value.step} ended`;
    case 'request/header': {
      const config = value.header?.config || {};
      const parts = [config.provider, config.model].filter(Boolean).join('/');
      const extra = [
        config.reasoningEffort ? `reasoning=${config.reasoningEffort}` : '',
        Number.isFinite(config.maxTokens) ? `maxTokens=${config.maxTokens}` : '',
      ].filter(Boolean).join(' ');
      return truncatePreview(`LLM request header: ${parts}${extra ? ` (${extra})` : ''} (${value.reason || ''})`);
    }
    case 'request/context':
      return truncatePreview(`Request context: ${value.provider || ''}/${value.model || ''}`
        + (Number.isFinite(value.contextWindow) ? ` contextWindow=${value.contextWindow}` : ''));
    case 'session/title':
      return truncatePreview(value.title || 'Session title');
    case 'session/title-llm-request':
      return truncatePreview(`Session title request via ${value.titleProvider || value.route?.provider || 'LLM'}`);
    case 'permission/preset':
      return `Permission preset: ${value.preset || ''}`;
    case 'sandbox/mode':
      return `Sandbox mode: ${value.mode || ''}`;
    case 'approval/policy':
      return `Approval policy: ${value.policy || ''}`;
    case 'agent/inbox/spliced':
      return truncatePreview(`Inbox splice ${value.target || ''}${value.outcome ? ` (${value.outcome})` : ''}`);
    case 'assistant/chunk': {
      const chunk = value.chunk || {};
      return truncatePreview(chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
        ? chunk.text || chunk.type
        : chunk.type || type);
    }
    default:
      return truncatePreview(storage.flattenBounded(value, 4000) || type);
  }
}

function protocolSearchText(type, data) {
  const value = data && typeof data === 'object' ? data : {};
  switch (type) {
    case 'request/header': {
      const config = value.header?.config || {};
      return [
        'request/header',
        value.reason || '',
        config.provider || '',
        config.model || '',
        config.reasoningEffort || '',
        Number.isFinite(config.maxTokens) ? `maxTokens=${config.maxTokens}` : '',
        `systemPromptBytes=${Buffer.byteLength(value.header?.system || '', 'utf8')}`,
        `toolCount=${Array.isArray(value.header?.tools) ? value.header.tools.length : 0}`,
      ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT);
    }
    case 'request/context':
      return [
        'request/context', value.provider || '', value.model || '',
        Number.isFinite(value.contextWindow) ? `contextWindow=${value.contextWindow}` : '',
      ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT);
    default:
      return storage.flattenBounded(value, SEARCH_TEXT_LIMIT).slice(0, SEARCH_TEXT_LIMIT);
  }
}

function packedRowSummary(record) {
  const count = Array.isArray(record?.data?.texts)
    ? record.data.texts.length
    : (Array.isArray(record?.data?.args) ? record.data.args.length : 0);
  const end = Number.isSafeInteger(record?.seq0) && Number.isSafeInteger(count)
    ? record.seq0 + count - 1
    : null;
  return {
    count,
    end,
    turn: Number.isSafeInteger(record?.data?.turn) ? record.data.turn : 0,
    step: Number.isSafeInteger(record?.data?.step) ? record.data.step : 0,
  };
}

function makeSourceLocator(sourceFile, recordOrdinal, seq = null, seqEnd = null) {
  return {
    type: storage.DEEPSEEK_STORAGE_LOCATOR_TYPE,
    sessionId: '',
    file: sourceFile,
    recordOrdinal,
    ...(Number.isSafeInteger(seq) ? { seq } : {}),
    ...(Number.isSafeInteger(seqEnd) ? { seqEnd } : {}),
  };
}

function makeRawEvent(record, recordOrdinal, sourceFile, sessionId) {
  const recordType = typeof record?.type === 'string' ? record.type : '';
  const packed = recordType === 'text-chunks'
    || recordType === 'reasoning-chunks'
    || recordType === 'tool-call-chunks';
  const packedSummary = packed ? packedRowSummary(record) : null;
  const data = record?.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data
    : {};
  const time = Number.isSafeInteger(record?.time)
    ? record.time
    : (recordType === 'session' && Number.isSafeInteger(record?.createdAt) ? record.createdAt : 0);
  const turn = Number.isSafeInteger(data.turn) ? data.turn : 0;
  const step = Number.isSafeInteger(data.step) ? data.step : 0;
  let preview;
  let searchText;
  if (recordType === 'session') {
    preview = truncatePreview(`Session header ${record.id || ''} (format v${record.version})`);
    searchText = `session header ${record.id || ''} format-v${record.version} cwd=${record.cwd || ''}`.slice(0, SEARCH_TEXT_LIMIT);
  } else if (packed) {
    preview = `${recordType} seqs ${record.seq0}..${packedSummary.end} (${packedSummary.count} members)`;
    searchText = `${recordType}\nturn=${packedSummary.turn}\nstep=${packedSummary.step}\n`
      + `seqs=${record.seq0}..${packedSummary.end}\nmemberCount=${packedSummary.count}`;
  } else {
    preview = protocolPreview(recordType, data);
    searchText = protocolSearchText(recordType, data);
  }
  const payloadType = recordType;
  const role = data?.source?.kind === 'user'
    ? 'user'
    : (recordType === 'assistant/message' || recordType === 'assistant/chunk' || packed ? 'assistant' : '');
  const raw = {
    rawId: `${sessionId}:raw:${recordOrdinal}`,
    sessionId,
    sourceKind: SOURCE_KIND,
    timestamp: safeIso(time),
    turnId: turn ? `turn:${turn}` : '',
    source: {
      file: sourceFile,
      recordOrdinal,
      line: recordOrdinal + 1,
    },
    sourceLocator: {
      type: storage.DEEPSEEK_STORAGE_LOCATOR_TYPE,
      sessionId,
      file: sourceFile,
      recordOrdinal,
      ...(Number.isSafeInteger(record?.seq) ? { seq: record.seq } : {}),
      ...(packedSummary ? { seq: record.seq0, seqEnd: packedSummary.end, memberCount: packedSummary.count } : {}),
    },
    recordType: 'dsh_storage_record',
    payloadType,
    role,
    status: '',
    toolName: recordType === 'tool/call' || recordType === 'tool/result'
      ? safeString(data.name || data.message?.source?.callId || data.callId)
      : '',
    messageText: '',
    preview,
    searchText,
    commandText: recordType === 'tool/call' ? commandTextForTool(data.name, data.arguments) : '',
    stdout: '',
    stderr: '',
    aggregatedOutput: recordType === 'tool/result' ? toolResultText(record) : '',
    exitCode: null,
    durationMs: 0,
    touchedFiles: [],
    rawIndex: recordOrdinal,
    memberCount: packedSummary ? packedSummary.count : 1,
    seq0: packedSummary ? record.seq0 : null,
    seqEnd: packedSummary ? packedSummary.end : null,
  };
  return raw;
}

function dshRawRef(raw) {
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

function makeLogicalEvent(fields) {
  const preview = sanitizeLogicalDetailValue(fields.preview || '', { marker: '[data URL omitted]' });
  const searchText = sanitizeLogicalDetailValue(fields.searchText || '', { marker: '[data URL omitted]' }).trim();
  return {
    id: fields.id,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    sourceKind: SOURCE_KIND,
    timestamp: sanitizeLogicalDetailValue(fields.timestamp || '', { marker: '[data URL omitted]' }),
    turnId: sanitizeLogicalDetailValue(fields.turnId || '', { marker: '[data URL omitted]' }),
    kind: sanitizeLogicalDetailValue(fields.kind || 'event', { marker: '[data URL omitted]' }),
    subtype: sanitizeLogicalDetailValue(fields.subtype || '', { marker: '[data URL omitted]' }),
    layer: sanitizeLogicalDetailValue(fields.layer || 'main', { marker: '[data URL omitted]' }),
    role: sanitizeLogicalDetailValue(fields.role || '', { marker: '[data URL omitted]' }),
    label: sanitizeLogicalDetailValue(fields.label || '', { marker: '[data URL omitted]' }),
    preview,
    searchText,
    severity: sanitizeLogicalDetailValue(fields.severity || 'normal', { marker: '[data URL omitted]' }),
    status: sanitizeLogicalDetailValue(fields.status || '', { marker: '[data URL omitted]' }),
    toolName: sanitizeLogicalDetailValue(fields.toolName || '', { marker: '[data URL omitted]' }),
    hasLongOutput: preview.length > 800 || searchText.length > 1600,
    hasReadableReasoning: Boolean(fields.hasReadableReasoning),
    touchedFiles: sanitizeLogicalDetailValue(fields.touchedFiles || [], { marker: '[data URL omitted]' }),
    outputStats: sanitizeLogicalDetailValue(fields.outputStats || {}, { marker: '[data URL omitted]' }),
    tokenUsage: sanitizeLogicalDetailValue(fields.tokenUsage || [], { marker: '[data URL omitted]' }),
    usageLimits: sanitizeLogicalDetailValue(fields.usageLimits || [], { marker: '[data URL omitted]' }),
    rawRefs: fields.rawRefs || [],
    channels: sanitizeLogicalDetailValue(fields.channels || [], { marker: '[data URL omitted]' }),
    tags: sanitizeLogicalDetailValue(fields.tags || [], { marker: '[data URL omitted]' }),
    source: fields.rawRefs?.[0] || null,
    sourceLocator: fields.rawRefs?.[0]?.sourceLocator || null,
  };
}

function makeProtocolEvent(sessionId, event, raw, subtype, options = {}) {
  const preview = options.preview || protocolPreview(event.type, event.data);
  return makeLogicalEvent({
    id: `${sessionId}:logical:protocol:${event.seq}`,
    timestamp: safeIso(event.time),
    turnId: turnIdFor(event),
    kind: 'protocol',
    subtype: subtype || event.type,
    layer: 'protocol',
    role: options.role || '',
    label: options.label || i18n.humanize(event.type),
    preview: truncatePreview(preview),
    searchText: (options.searchText || protocolSearchText(event.type, event.data)).slice(0, SEARCH_TEXT_LIMIT),
    severity: options.severity || 'normal',
    status: options.status || '',
    rawRefs: [dshRawRef(raw)],
    channels: [event.type],
  });
}

function makeUserEvent(sessionId, event, raw, kind, subtype, label = '') {
  const text = visibleText(event.data?.content);
  const preview = truncatePreview(text || protocolPreview(event.type, event.data));
  return makeLogicalEvent({
    id: `${sessionId}:logical:${kind}:${event.seq}`,
    timestamp: safeIso(event.time),
    turnId: turnIdFor(event),
    kind,
    subtype,
    layer: kind === 'user_message' ? 'main' : 'protocol',
    role: 'user',
    label,
    preview,
    searchText: text.slice(0, SEARCH_TEXT_LIMIT),
    rawRefs: [dshRawRef(raw)],
    channels: ['user/message'],
  });
}

function makeAssistantMessageEvent(sessionId, event, raw) {
  const content = event.data?.message?.content || [];
  const visible = visibleText(content);
  const reasoning = reasoningText(content);
  const calls = toolCallBlocks(content);
  let preview;
  if (visible.trim()) preview = truncatePreview(visible);
  else if (reasoning.trim()) preview = truncatePreview(reasoning);
  else preview = calls.length ? truncatePreview(`Tool request: ${calls.map((call) => call.name || 'tool').join(', ')}`) : '';
  return makeLogicalEvent({
    id: `${sessionId}:logical:assistant_message:${event.seq}`,
    timestamp: safeIso(event.time),
    turnId: turnIdFor(event),
    kind: 'assistant_message',
    subtype: 'assistant_message',
    layer: 'main',
    role: 'assistant',
    label: '',
    preview,
    searchText: [visible, reasoning]
      .filter(Boolean)
      .join('\n')
      .slice(0, SEARCH_TEXT_LIMIT),
    hasReadableReasoning: Boolean(reasoning.trim()),
    rawRefs: [dshRawRef(raw)],
    channels: ['assistant/message'],
  });
}

function makeReasoningEvent(sessionId, event, raw) {
  const reasoning = reasoningText(event.data?.message?.content || []).slice(0, REASONING_LIMIT);
  return makeLogicalEvent({
    id: `${sessionId}:logical:reasoning:${event.seq}`,
    timestamp: safeIso(event.time),
    turnId: turnIdFor(event),
    kind: 'reasoning',
    subtype: 'reasoning',
    layer: 'main',
    role: 'assistant',
    label: reasoning ? 'Reasoning' : 'Empty reasoning',
    preview: truncatePreview(reasoning || 'reasoning'),
    searchText: reasoning,
    hasReadableReasoning: Boolean(reasoning.trim()),
    rawRefs: [dshRawRef(raw)],
    channels: ['assistant/message'],
  });
}

function makePartialAssistantEvent(sessionId, stepState, status = 'incomplete') {
  const visible = stepState.blockText.get('text-delta') || '';
  const reasoning = stepState.blockText.get('reasoning-delta') || '';
  const text = visible || reasoning;
  const raws = stepState.chunkRows;
  const first = raws[0];
  const channels = [...new Set(raws.map((raw) => raw.payloadType))];
  const event = makeLogicalEvent({
    id: `${sessionId}:logical:partial_assistant:${stepState.turn}:${stepState.step}`,
    timestamp: first?.timestamp || '',
    turnId: first?.turnId || `turn:${stepState.turn}`,
    kind: 'assistant_message',
    subtype: 'partial_assistant_stream',
    layer: 'main',
    role: 'assistant',
    label: 'Partial assistant output',
    preview: truncatePreview(text || 'Partial assistant stream'),
    searchText: text.slice(0, SEARCH_TEXT_LIMIT),
    severity: status === 'failed' ? 'error' : 'warning',
    status,
    hasReadableReasoning: Boolean(reasoning.trim()),
    rawRefs: raws.map(dshRawRef),
    channels,
  });
  return event;
}

function createStepState(turn, step) {
  return {
    turn,
    step,
    chunkRows: [],
    blockText: new Map(),
    sawAssistantMessage: false,
    partialEvent: null,
  };
}

function appendChunkToStep(stepState, chunk) {
  if (!stepState || !chunk || typeof chunk !== 'object') return;
  if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return;
  const current = stepState.blockText.get(chunk.type) || '';
  stepState.blockText.set(chunk.type, appendBounded(
    current,
    typeof chunk.text === 'string' ? chunk.text : '',
    PARTIAL_BLOCK_TEXT_LIMIT,
  ));
}

function appendPackedRowToStep(stepState, record) {
  if (!stepState) return;
  const kind = record?.type === 'text-chunks'
    ? 'text-delta'
    : (record?.type === 'reasoning-chunks' ? 'reasoning-delta' : 'tool-call-delta');
  const members = record?.data?.texts || record?.data?.args;
  if (!Array.isArray(members)) return;
  const current = stepState.blockText.get(kind) || '';
  let text = current;
  for (const member of members) {
    text = appendBounded(text, typeof member === 'string' ? member : '', PARTIAL_BLOCK_TEXT_LIMIT);
  }
  stepState.blockText.set(kind, text);
}

function makeEmptySession(filePath, relFile, header, committedBytes) {
  const cwdSet = [];
  if (typeof header.cwd === 'string' && header.cwd) cwdSet.push(resolveFsPath(header.cwd));
  return {
    id: `${SOURCE_KIND}:${header.id}`,
    sourceKind: SOURCE_KIND,
    sourceSessionId: header.id,
    sourceDerivedId: '',
    sourceClientVersion: '',
    projectAssociation: header.cwd || '',
    title: '',
    sourceFile: relFile,
    agentNickname: header.agentPreset || '',
    primarySessionMetaKind: header.origin === 'subagent' ? 'subagent' : '',
    derivedRunId: '',
    startedAt: safeIso(header.createdAt),
    updatedAt: safeIso(header.createdAt),
    bytes: committedBytes,
    lineCount: 0,
    cwdSet,
    counts: emptyCounts(),
    rawEventCount: 0,
    logicalEventCount: 0,
    // Phase 1 only models subagent lineage. A fork seed (`parentSession`
    // without `origin:"subagent"`) is kept in the known-unmodeled inventory
    // instead of being presented as a subagent relationship.
    parentSessionId: header.origin === 'subagent' ? header.parentSession || '' : '',
    forkedFromSessionId: '',
    forkStorageMode: '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    parentSessionInferred: false,
    forkEvidence: null,
    inheritedContext: null,
    summary: emptySummary(),
    rawEvents: [],
    logicalEvents: [],
    analysis: null,
    presentationIndexes: { codeModeDeclaredRequests: new Map() },
    matchesRepo: false,
  };
}

function finalizeSession(session, repoRoot) {
  session.matchesRepo = session.cwdSet.some((cwd) => isPathInsideOrSame(cwd, repoRoot));
  if (!session.title) {
    const firstUser = session.logicalEvents.find((event) => (
      event.layer === 'main' && event.kind === 'user_message'
    ));
    if (firstUser) session.title = truncatePreview(firstUser.preview, TITLE_LIMIT);
  }
  session.title = String(session.title || '').slice(0, 240);
  session.counts = emptyCounts();
  const toolUsage = new Map();
  const failedCommands = [];
  const timelineKinds = new Map();
  const protocolSubtypes = new Map();
  const turnIds = new Set();
  for (const event of session.logicalEvents) {
    if (event.turnId) turnIds.add(event.turnId);
    if (event.layer === 'protocol') {
      session.counts.protocol += 1;
      protocolSubtypes.set(event.subtype, (protocolSubtypes.get(event.subtype) || 0) + 1);
      if (event.severity === 'error' || event.status === 'failed') session.counts.issueEvents += 1;
      continue;
    }
    timelineKinds.set(event.kind, (timelineKinds.get(event.kind) || 0) + 1);
    if (event.kind === 'user_message' || event.kind === 'assistant_message') {
      session.counts.messages += 1;
    }
    if (event.kind === 'user_message') session.counts.userMessages += 1;
    if (event.kind === 'assistant_message') session.counts.assistantMessages += 1;
    if (event.kind === 'reasoning') session.counts.reasoning += 1;
    if (event.kind === 'command' || event.kind === 'other_tool_call') {
      session.counts.toolCalls += 1;
    }
    if (event.toolName) toolUsage.set(event.toolName, (toolUsage.get(event.toolName) || 0) + 1);
    if (event.kind === 'command') {
      const commandInfo = {
        id: event.id,
        timestamp: event.timestamp,
        command: event.preview,
        status: event.status,
        exitCode: event.outputStats.exitCode,
        durationMs: event.outputStats.durationMs || 0,
        source: event.source,
      };
      if (event.status === 'failed') {
        session.counts.failedCommands += 1;
        failedCommands.push(commandInfo);
      }
    }
    if (event.status === 'failed' || event.severity !== 'normal') session.counts.issueEvents += 1;
    if (event.kind === 'abort') session.counts.aborts += 1;
    if (event.kind === 'error') session.counts.errors += 1;
  }
  session.counts.turns = turnIds.size;
  session.rawEventCount = session.rawEvents.length;
  session.logicalEventCount = session.logicalEvents.length;
  session.analysis = {
    sessionId: session.id,
    title: session.title,
    counts: session.counts,
    toolUsage: [...toolUsage.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    failedCommands: failedCommands.slice(0, 100),
    slowCommands: [],
    patchedFiles: [],
    tokenStats: { maxObserved: 0 },
    timelineStats: [...timelineKinds.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    protocolStats: [...protocolSubtypes.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
  session.summary = {
    topTools: session.analysis.toolUsage.slice(0, 5).map((item) => ({ ...item })),
    failedCommandCount: session.analysis.failedCommands.length,
    patchedFiles: session.analysis.patchedFiles.slice(0, 5).map((item) => ({ ...item })),
    protocolCount: session.analysis.protocolStats.reduce((sum, item) => sum + item.count, 0),
  };
  return session;
}

function addPendingToolResult(session, call, resultRaw, resultEvent) {
  const resultText = toolResultText(resultEvent);
  const failed = toolResultIsError(resultEvent);
  const status = failed ? 'failed' : 'success';
  const kind = String(call.name || '').toLowerCase() === 'bash' ? 'command' : 'other_tool_call';
  const command = call.name === 'bash' ? commandTextForTool(call.name, call.arguments) : '';
  const preview = kind === 'command'
    ? truncatePreview(command || resultText || call.name)
    : truncatePreview(resultText || call.name);
  session.logicalEvents.push(makeLogicalEvent({
    id: `${session.id}:logical:tool:${call.callId}`,
    timestamp: safeIso(call.time || resultEvent.time),
    turnId: call.turn ? `turn:${call.turn}` : turnIdFor(resultEvent),
    kind,
    subtype: call.name || kind,
    layer: 'main',
    role: 'assistant',
    label: call.name ? i18n.humanize(call.name) : kind,
    preview,
    searchText: [
      call.name || '',
      call.arguments || '',
      command,
      resultText,
      resultEvent.data?.error ? `error=${resultEvent.data.error.name || ''}:${resultEvent.data.error.code || ''}` : '',
    ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: failed ? 'error' : 'normal',
    status,
    toolName: call.name || '',
    outputStats: {},
    rawRefs: [dshRawRef(call.raw), dshRawRef(resultRaw)],
    channels: ['tool/call', 'tool/result'],
  }));
}

function makeIncompleteToolEvent(session, call) {
  const kind = String(call.name || '').toLowerCase() === 'bash' ? 'command' : 'other_tool_call';
  const command = call.name === 'bash' ? commandTextForTool(call.name, call.arguments) : '';
  session.logicalEvents.push(makeLogicalEvent({
    id: `${session.id}:logical:tool:${call.callId}`,
    timestamp: safeIso(call.time),
    turnId: call.turn ? `turn:${call.turn}` : '',
    kind,
    subtype: call.name || kind,
    layer: 'main',
    role: 'assistant',
    label: call.name ? i18n.humanize(call.name) : kind,
    preview: truncatePreview(command || call.arguments || call.name),
    searchText: [call.name || '', call.arguments || '', command].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: 'warning',
    status: 'incomplete',
    toolName: call.name || '',
    outputStats: {},
    rawRefs: [dshRawRef(call.raw)],
    channels: ['tool/call'],
  }));
}

async function parseSessionArtifact(filePath, relFile, repoRoot, signal, options = {}) {
  const compression = options.compression || storage.compressionForArtifact(filePath);
  const acceptedSnapshot = options.acceptedSnapshot || null;
  throwIfAborted(signal);
  let stable;
  try {
    stable = await storage.readStableFile(filePath, signal);
  } catch (error) {
    if (acceptedSnapshot && (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')) {
      throw indexedSourceStaleError();
    }
    throw error;
  }
  if (acceptedSnapshot) {
    if (!storage.sameFileIdentity(acceptedSnapshot.fileIdentity, stable.identity)
        || stable.buffer.length < acceptedSnapshot.acceptedBytes
        || storage.hashBuffer(stable.buffer.subarray(0, acceptedSnapshot.acceptedBytes)) !== acceptedSnapshot.digest) {
      throw indexedSourceStaleError();
    }
    stable.buffer = stable.buffer.subarray(0, acceptedSnapshot.acceptedBytes);
  }
  const prefix = storage.committedArtifactPrefix(stable.buffer, compression);
  if (prefix.recordTexts.length === 0) throw storage.storageError('empty or header-less session log');
  const header = storage.parseHeaderText(prefix.recordTexts[0]);
  if (header.cwd) {
    try {
      resolveFsPath(header.cwd);
    } catch {
      // Keep the header cwd as source evidence; project matching simply fails.
    }
  }
  const session = makeEmptySession(filePath, relFile, header, prefix.committedBytes);
  session.lineCount = prefix.recordTexts.length;
  session._sourceIdentity = stable.identity;
  session._committedPrefixDigest = storage.hashBuffer(
    stable.buffer.subarray(0, prefix.committedBytes),
  );
  session._compression = compression;
  session._torn = prefix.torn === true;
  const rawHeader = makeRawEvent(
    { type: 'session', version: header.version, id: header.id, createdAt: header.createdAt, cwd: header.cwd },
    0,
    relFile,
    session.id,
  );
  rawHeader.sourceLocator.sessionId = session.id;
  session.rawEvents.push(rawHeader);
  const seqToRaw = new Map();
  let expectedSeq = 0;
  let lastTime = header.createdAt;
  let currentStep = null;
  const pendingToolCalls = new Map();
  let pendingPartialEvent = null;
  let title = '';

  const flushCurrentStep = (status = 'incomplete') => {
    if (!currentStep) return null;
    if (!currentStep.sawAssistantMessage && currentStep.chunkRows.length > 0) {
      const event = makePartialAssistantEvent(session.id, currentStep, status);
      session.logicalEvents.push(event);
      currentStep.partialEvent = event;
      return event;
    }
    return currentStep.partialEvent || null;
  };

  const stepStateFor = (turn, step) => {
    if (currentStep && currentStep.turn === turn && currentStep.step === step) return currentStep;
    return null;
  };

  for (let index = 1; index < prefix.recordTexts.length; index += 1) {
    throwIfAborted(signal);
    const recordText = prefix.recordTexts[index];
    let record;
    try {
      record = JSON.parse(recordText);
    } catch (error) {
      throw storage.storageError(`corrupt session log: unparsable committed event at record ${index}`, 'DEEPSEEK_STORAGE_INVALID', error);
    }
    if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.type !== 'string') {
      throw storage.storageError(`corrupt session log: invalid committed record at record ${index}`);
    }
    const decoded = storage.decodeStorageRecord(record);
    const raw = makeRawEvent(record, index, relFile, session.id);
    raw.sourceLocator.sessionId = session.id;
    session.rawEvents.push(raw);
    for (const event of decoded) {
      if (!Number.isSafeInteger(event.seq) || event.seq !== expectedSeq) {
        throw storage.storageError(
          `corrupt session log: seq gap at record ${index} (expected ${expectedSeq}, got ${event.seq})`,
        );
      }
      expectedSeq += 1;
      lastTime = eventTime(event) || lastTime;
      seqToRaw.set(event.seq, raw);
    }

    if (record.type === 'text-chunks'
        || record.type === 'reasoning-chunks'
        || record.type === 'tool-call-chunks') {
      const step = stepStateFor(record.data?.turn, record.data?.step);
      if (step) {
        step.chunkRows.push(raw);
        appendPackedRowToStep(step, record);
      }
      continue;
    }

    const event = decoded[0];
    const data = event?.data && typeof event.data === 'object' ? event.data : {};
    if (event.type === 'turn/start') {
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Turn started',
      }));
    } else if (event.type === 'step/start') {
      currentStep = createStepState(data.turn, data.step);
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Step started',
      }));
    } else if (event.type === 'step/end') {
      const step = stepStateFor(data.turn, data.step);
      if (step) {
        pendingPartialEvent = flushCurrentStep('incomplete') || pendingPartialEvent;
        currentStep = null;
      }
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Step ended',
      }));
    } else if (event.type === 'turn/end') {
      const endStatus = data.reason?.kind === 'aborted'
        ? 'aborted'
        : (data.reason?.kind === 'interrupted' ? 'interrupted' : (data.reason?.kind === 'error' ? 'failed' : ''));
      if (pendingPartialEvent) {
        pendingPartialEvent.status = endStatus || 'incomplete';
        pendingPartialEvent.severity = endStatus === 'failed' ? 'error' : 'warning';
      }
      if (currentStep && currentStep.partialEvent) {
        currentStep.partialEvent.status = endStatus || 'incomplete';
        currentStep.partialEvent.severity = endStatus === 'failed' ? 'error' : 'warning';
      }
      currentStep = null;
      pendingPartialEvent = null;
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Turn ended',
      }));
    } else if (event.type === 'assistant/chunk') {
      const step = stepStateFor(data.turn, data.step);
      if (step) {
        step.chunkRows.push(raw);
        appendChunkToStep(step, data.chunk);
      }
    } else if (event.type === 'assistant/message') {
      const step = stepStateFor(data.turn, data.step);
      if (step && event.surfaceOp === 'append') {
        step.sawAssistantMessage = true;
        if (step.partialEvent) {
          step.partialEvent = null;
          step.chunkRows = [];
          step.blockText.clear();
        }
      }
      if (event.surfaceOp === 'append') {
        const reasoning = reasoningText(event.data?.message?.content || []).trim();
        if (reasoning) session.logicalEvents.push(makeReasoningEvent(session.id, event, raw));
        session.logicalEvents.push(makeAssistantMessageEvent(session.id, event, raw));
      }
    } else if (event.type === 'user/message') {
      if (data.source?.kind === 'user' && event.surfaceOp === 'append') {
        // Human transcript follows append-origin evidence. A compaction
        // replacement user/message is model-only surface material and must
        // not become a Main human message.
        session.logicalEvents.push(makeUserEvent(session.id, event, raw, 'user_message', 'user_message'));
      } else if (data.source?.kind === 'user') {
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, 'user/message', {
          label: 'Surface replacement user message',
          role: 'system',
          preview: truncatePreview(visibleText(data.content) || 'Surface replacement user message'),
        }));
      } else {
        const plugin = typeof data.source?.plugin === 'string' ? data.source.plugin : '';
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, 'user/message', {
          label: plugin || 'Runtime context',
          role: 'system',
          preview: truncatePreview(visibleText(data.content) || 'Runtime context'),
        }));
      }
    } else if (event.type === 'tool/call') {
      pendingToolCalls.set(data.callId, {
        callId: data.callId,
        name: data.name,
        arguments: data.arguments,
        turn: data.turn,
        step: data.step,
        time: event.time,
        raw,
      });
    } else if (event.type === 'tool/result') {
      if (event.surfaceOp !== 'append') {
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, 'tool/result', {
          label: 'Surface replacement tool result',
          role: 'system',
          preview: truncatePreview(toolResultText(event) || 'Surface replacement tool result'),
        }));
        continue;
      }
      const callId = data.message?.source?.callId
        || data.message?.content?.[0]?.toolCallId
        || '';
      const pending = pendingToolCalls.get(callId);
      if (pending) {
        pendingToolCalls.delete(callId);
        addPendingToolResult(session, pending, raw, event);
      } else {
        const failed = toolResultIsError(event);
        session.logicalEvents.push(makeLogicalEvent({
          id: `${session.id}:logical:tool_result:${event.seq}`,
          timestamp: safeIso(event.time),
          turnId: turnIdFor(event),
          kind: 'other_tool_call',
          subtype: data.message?.source?.callId || 'tool_result',
          layer: 'main',
          role: 'assistant',
          label: 'Tool result',
          preview: truncatePreview(toolResultText(event) || 'Tool result'),
          searchText: toolResultText(event).slice(0, SEARCH_TEXT_LIMIT),
          severity: failed ? 'error' : 'normal',
          status: failed ? 'failed' : 'success',
          toolName: callId || '',
          rawRefs: [dshRawRef(raw)],
          channels: ['tool/result'],
        }));
      }
    } else if (event.type === 'session/title') {
      if (typeof data.title === 'string' && data.title.trim()) title = data.title.trim();
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Session title',
      }));
    } else {
      const knownUnmodeled = KNOWN_DS_EVENT_TYPES.has(event.type);
      const subtype = knownUnmodeled ? event.type : 'unknown_event';
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, subtype, {
        label: knownUnmodeled ? i18n.humanize(event.type) : `Unknown event type: ${event.type}`,
        preview: knownUnmodeled ? undefined : truncatePreview(`Unknown DeepSeek event type ${event.type}`),
        severity: knownUnmodeled ? 'normal' : 'warning',
      }));
    }
  }

  if (currentStep && !currentStep.sawAssistantMessage && currentStep.chunkRows.length > 0) {
    currentStep.partialEvent = makePartialAssistantEvent(session.id, currentStep, 'incomplete');
    session.logicalEvents.push(currentStep.partialEvent);
  }
  for (const call of pendingToolCalls.values()) {
    makeIncompleteToolEvent(session, call);
  }
  session.title = title;
  session.updatedAt = safeIso(lastTime) || session.startedAt;
  session._lastEventTime = lastTime;
  session._seqToRaw = seqToRaw;
  return finalizeSession(session, repoRoot);
}

function indexedSourceStaleError() {
  const error = new Error('Indexed source changed; reindex required');
  error.code = 'INDEXED_SOURCE_STALE';
  error.statusCode = 409;
  return error;
}

function throwIfAborted(signal) {
  storage.throwIfAborted(signal);
}

async function discoverConfiguredProjects() {
  return [];
}

async function discoverDeepSeekProjects({ sourceHome, signal }) {
  const sessionsRoot = path.resolve(sourceHome);
  const files = await collectArtifactFiles(sessionsRoot, signal);
  const projects = new Map();
  for (const filePath of files) {
    throwIfAborted(signal);
    let header;
    let stat;
    try {
      stat = await fsp.stat(filePath);
      header = await storage.readSessionHeader(filePath, storage.compressionForArtifact(filePath), signal);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      if (error?.code === 'DEEPSEEK_FORMAT_VERSION_UNSUPPORTED') {
        console.warn(`DeepSeek Harness session ${filePath} uses ${error.message}; raw-preserving future-format inspection is deferred`);
        continue;
      }
      console.warn(`Unable to inspect DeepSeek Harness session ${filePath}: ${error.message}`);
      continue;
    }
    if (!header.cwd) continue;
    const cwd = resolveFsPath(header.cwd);
    const key = cwd;
    const project = projects.get(key) || {
      repoRoot: cwd,
      sessionCount: 0,
      updatedAt: '',
      bytes: 0,
      exists: false,
      source: 'deepseek-harness-sessions',
    };
    project.sessionCount += 1;
    project.bytes += stat.size;
    const updatedAt = safeIso(stat.mtime);
    if (updatedAt > project.updatedAt) project.updatedAt = updatedAt;
    projects.set(key, project);
  }
  for (const project of projects.values()) {
    try {
      project.exists = (await fsp.stat(project.repoRoot)).isDirectory();
    } catch {
      project.exists = false;
    }
  }
  return [...projects.values()].sort((a, b) => (
    String(b.updatedAt).localeCompare(String(a.updatedAt))
    || b.sessionCount - a.sessionCount
    || a.repoRoot.localeCompare(b.repoRoot)
  ));
}

async function collectArtifactFiles(root, signal) {
  const out = [];
  async function walk(dir) {
    throwIfAborted(signal);
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && (entry.name === 'session.jsonl' || entry.name === 'session.jsonl.zstd')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  const byDirectory = new Map();
  for (const filePath of out) {
    const directory = path.dirname(filePath);
    const names = byDirectory.get(directory) || new Set();
    names.add(path.basename(filePath));
    byDirectory.set(directory, names);
  }
  for (const [directory, names] of byDirectory) {
    if (names.has('session.jsonl') && names.has('session.jsonl.zstd')) {
      throw storage.storageError(
        `DeepSeek session directory contains both session.jsonl and session.jsonl.zstd: ${directory}`,
      );
    }
  }
  return out;
}

function eventKindCatalogForSession(session) {
  const counts = { main: new Map(), protocol: new Map(), raw: new Map() };
  for (const event of session.logicalEvents) {
    const layer = event.layer === 'protocol' ? 'protocol' : 'main';
    const value = layer === 'protocol' ? (event.subtype || event.kind) : event.kind;
    if (value) counts[layer].set(value, (counts[layer].get(value) || 0) + 1);
  }
  for (const raw of session.rawEvents) {
    const value = raw.payloadType || raw.recordType;
    if (value) counts.raw.set(value, (counts.raw.get(value) || 0) + 1);
  }
  const optionsFor = (map, labelFn) => [...map.entries()]
    .sort((a, b) => labelFn(a[0]).localeCompare(labelFn(b[0])) || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({
      value,
      label: labelFn(value),
      count,
    }));
  return {
    main: optionsFor(counts.main, (value) => i18n.eventKindLabel(value, i18n.DEFAULT_LOCALE)),
    protocol: optionsFor(counts.protocol, (value) => i18n.eventKindLabel(value, i18n.DEFAULT_LOCALE)),
    raw: optionsFor(counts.raw, (value) => i18n.rawRecordLabel(value, i18n.DEFAULT_LOCALE)),
  };
}

function createCatalogAccumulator() {
  const counts = { main: new Map(), protocol: new Map(), raw: new Map() };
  return {
    addSession(session) {
      const catalog = eventKindCatalogForSession(session);
      for (const layer of ['main', 'protocol', 'raw']) {
        for (const item of catalog[layer]) {
          counts[layer].set(item.value, (counts[layer].get(item.value) || 0) + item.count);
        }
      }
    },
    finish() {
      return {
        main: [...counts.main.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, count]) => ({ value, label: i18n.eventKindLabel(value, i18n.DEFAULT_LOCALE), count })),
        protocol: [...counts.protocol.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, count]) => ({ value, label: i18n.eventKindLabel(value, i18n.DEFAULT_LOCALE), count })),
        raw: [...counts.raw.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, count]) => ({ value, label: i18n.rawRecordLabel(value, i18n.DEFAULT_LOCALE), count })),
      };
    },
  };
}

function emptyLegacyRawOwners() {
  const payload = {};
  return {
    schemaVersion: 1,
    sourceKind: SOURCE_KIND,
    entryCount: 0,
    accountedBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    payload,
  };
}

function projectCarriedSession(session, summary) {
  const projected = {
    id: String(session.id || ''),
    sourceKind: SOURCE_KIND,
    sourceSessionId: String(session.sourceSessionId || ''),
    sourceDerivedId: String(session.sourceDerivedId || ''),
    sourceClientVersion: String(session.sourceClientVersion || ''),
    projectAssociation: String(session.projectAssociation || ''),
    title: String(session.title || ''),
    sourceFile: String(session.sourceFile || ''),
    agentNickname: String(session.agentNickname || ''),
    primarySessionMetaKind: String(session.primarySessionMetaKind || ''),
    derivedRunId: String(session.derivedRunId || ''),
    startedAt: String(session.startedAt || ''),
    updatedAt: String(session.updatedAt || ''),
    bytes: Number(session.bytes || 0),
    lineCount: Number(session.lineCount || 0),
    cwdSet: [...(session.cwdSet || [])].map(String),
    counts: { ...emptyCounts(), ...(session.counts || {}) },
    rawEventCount: session.rawEvents.length,
    logicalEventCount: session.logicalEvents.length,
    parentSessionId: String(session.parentSessionId || ''),
    forkedFromSessionId: String(session.forkedFromSessionId || ''),
    forkStorageMode: String(session.forkStorageMode || ''),
    forkedAt: String(session.forkedAt || ''),
    forkPointUuid: String(session.forkPointUuid || ''),
    forkContinuationState: String(session.forkContinuationState || ''),
    supersededBySessionId: String(session.supersededBySessionId || ''),
    supersededAt: String(session.supersededAt || ''),
    supersededReason: String(session.supersededReason || ''),
    parentSessionInferred: Boolean(session.parentSessionInferred),
    forkEvidence: null,
    inheritedContext: null,
    summary: structuredClone(summary),
  };
  if (Object.hasOwn(session, 'derivedRelationship')) projected.derivedRelationship = session.derivedRelationship;
  if (Object.hasOwn(session, 'subagentToolUseId')) projected.subagentToolUseId = session.subagentToolUseId;
  if (Object.hasOwn(session, 'spawnDepth')) projected.spawnDepth = session.spawnDepth;
  return projected;
}

function buildMaterializationState(session, dependencySet, descriptorPayload) {
  const dependencyId = `dsh-dependency:${storage.hashPlainValue(dependencySet.entries)}`;
  dependencySet.id = dependencyId;
  const sourceSnapshotId = `dsh-snapshot:${storage.hashPlainValue({
    dependencySet,
    payload: descriptorPayload,
  })}`;
  const descriptor = {
    schemaVersion: 1,
    dependencySetId: dependencyId,
    sourceSnapshotId,
    payload: descriptorPayload,
  };
  return { descriptor, dependencySet, sourceSnapshotId };
}

async function buildDeepSeekIndex({ sourceHome, repoRoot, signal, onProgress }) {
  const resolvedRepo = resolveFsPath(repoRoot);
  const sessionsRoot = path.resolve(sourceHome);
  const startedAt = Date.now();
  throwIfAborted(signal);
  const files = await collectArtifactFiles(sessionsRoot, signal);
  const candidates = [];
  let skippedFileCount = 0;
  let unknownFileCount = 0;
  let candidateBytes = 0;
  for (const filePath of files) {
    throwIfAborted(signal);
    const relFile = path.relative(sessionsRoot, filePath).replace(/\\/g, '/');
    if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
      skippedFileCount += 1;
      continue;
    }
    let header;
    try {
      header = await storage.readSessionHeader(filePath, storage.compressionForArtifact(filePath), signal);
    } catch (error) {
      if (error?.code === 'DEEPSEEK_FORMAT_VERSION_UNSUPPORTED') {
        throw error;
      }
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      console.warn(`Unable to inspect DeepSeek Harness session ${filePath}: ${error.message}`);
      skippedFileCount += 1;
      continue;
    }
    if (!header.cwd || !isPathInsideOrSame(resolveFsPath(header.cwd), resolvedRepo)) {
      if (!header.cwd) unknownFileCount += 1;
      else skippedFileCount += 1;
      continue;
    }
    const stat = await fsp.stat(filePath);
    candidateBytes += stat.size;
    candidates.push({ filePath, relFile, header, bytes: stat.size });
  }

  const queryStoreBuilder = createProjectQueryStoreBuilder({
    presentationForEvent: () => null,
  });
  const catalog = createCatalogAccumulator();
  const materializationDependencies = new Map();
  const sessions = [];
  const sessionsById = new Map();
  let indexedFileCount = 0;
  let indexedBytes = 0;
  let logicalEventCount = 0;
  let rawEventCount = 0;

  for (const candidate of candidates) {
    throwIfAborted(signal);
    onProgress?.({ phase: 'parsing', sessionId: candidate.header.id });
    const session = await parseSessionArtifact(
      candidate.filePath,
      candidate.relFile,
      resolvedRepo,
      signal,
      { compression: storage.compressionForArtifact(candidate.filePath) },
    );
    const summary = {
      topTools: session.analysis.toolUsage.slice(0, 5).map((item) => ({ ...item })),
      failedCommandCount: session.analysis.failedCommands.length,
      patchedFiles: session.analysis.patchedFiles.slice(0, 5).map((item) => ({ ...item })),
      protocolCount: session.analysis.protocolStats.reduce((sum, item) => sum + item.count, 0),
    };
    const queryProjectionDigest = queryStoreBuilder.addSession(session);
    catalog.addSession(session);
    const sourceFile = candidate.relFile;
    const compression = session._compression || storage.compressionForArtifact(candidate.filePath);
    const descriptorPayload = {
      sourceFile,
      compression,
      storageRecordCount: session.lineCount,
      acceptedBytes: session.bytes,
    };
    const dependencySet = {
      schemaVersion: 1,
      id: '',
      sourceKind: SOURCE_KIND,
      entries: [{
        role: 'primary_transcript',
        pathIdentity: sourceFile,
        existence: 'present',
        kind: 'file',
        policy: 'accepted_prefix',
        acceptedBytes: session.bytes,
        lineCount: session.lineCount,
        digest: session._committedPrefixDigest,
        directoryEntries: [],
        evidence: {
          compression,
          torn: session._torn === true,
          fileIdentity: session._sourceIdentity,
        },
      }],
    };
    const materializationState = buildMaterializationState(
      session,
      dependencySet,
      descriptorPayload,
    );
    const carried = projectCarriedSession(session, summary);
    const indexedSession = {
      ...carried,
      materializationDescriptor: materializationState.descriptor,
      queryShardId: carried.id,
      queryProjectionDigest,
    };
    materializationDependencies.set(dependencySet.id, dependencySet);
    sessions.push(indexedSession);
    sessionsById.set(indexedSession.id, indexedSession);
    indexedFileCount += 1;
    indexedBytes += indexedSession.bytes;
    logicalEventCount += indexedSession.logicalEventCount;
    rawEventCount += indexedSession.rawEventCount;
  }

  sessions.sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)));
  const projectQueryStore = queryStoreBuilder.finish();
  const totals = {
    fileCount: files.length,
    candidateFileCount: candidates.length,
    indexedFileCount,
    skippedFileCount,
    unknownFileCount,
    sessionCount: sessions.length,
    eventCount: logicalEventCount,
    rawEventCount,
    indexedBytes,
    candidateBytes,
    elapsedMs: Date.now() - startedAt,
  };
  return {
    sourceKind: SOURCE_KIND,
    sourceHome: sessionsRoot,
    sourceRoot: sessionsRoot,
    repoRoot: resolvedRepo,
    sessionsRoot,
    generatedAt: new Date().toISOString(),
    sessions,
    sessionsById,
    projectQueryStore,
    materializationDependencies,
    legacyRawOwners: emptyLegacyRawOwners(),
    eventKinds: catalog.finish(),
    totals,
  };
}

async function materializeDeepSeekSession({
  materializationContext,
  indexedSession,
  dependencySet,
  signal,
}) {
  throwIfAborted(signal);
  const sessionsRoot = materializationContext.sessionsRoot;
  const descriptor = indexedSession.materializationDescriptor;
  const payload = descriptor.payload;
  const sourceFile = payload.sourceFile;
  const target = path.resolve(sessionsRoot, sourceFile);
  if (!isPathInsideOrSame(target, sessionsRoot)) throw indexedSourceStaleError();
  const entry = dependencySet.entries[0];
  if (!entry || entry.role !== 'primary_transcript') throw indexedSourceStaleError();
  const session = await parseSessionArtifact(target, sourceFile, materializationContext.repoRoot, signal, {
    compression: payload.compression,
    acceptedSnapshot: {
      acceptedBytes: entry.acceptedBytes,
      digest: entry.digest,
      fileIdentity: entry.evidence.fileIdentity,
    },
  });
  if (session.id !== indexedSession.id
      || session.sourceSessionId !== indexedSession.sourceSessionId
      || session.lineCount !== indexedSession.lineCount
      || session.rawEventCount !== indexedSession.rawEventCount) {
    throw indexedSourceStaleError();
  }
  const summary = {
    topTools: session.analysis.toolUsage.slice(0, 5).map((item) => ({ ...item })),
    failedCommandCount: session.analysis.failedCommands.length,
    patchedFiles: session.analysis.patchedFiles.slice(0, 5).map((item) => ({ ...item })),
    protocolCount: session.analysis.protocolStats.reduce((sum, item) => sum + item.count, 0),
  };
  return {
    ...projectCarriedSession(session, summary),
    materializationSnapshotId: descriptor.sourceSnapshotId,
    rawEvents: session.rawEvents,
    logicalEvents: session.logicalEvents,
    analysis: session.analysis,
    presentationIndexes: session.presentationIndexes,
  };
}

function requireExactKeys(value, keys, owner) {
  const actual = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${owner} must contain exactly ${expected.join(', ')}`);
  }
}

function validateDeepSeekMaterializationDescriptor({
  materializationContext,
  indexedSession,
  descriptor,
  dependencySet,
}) {
  const sessionsRoot = materializationContext.sessionsRoot;
  requireExactKeys(descriptor.payload, ['sourceFile', 'compression', 'storageRecordCount', 'acceptedBytes'], 'DeepSeek materialization payload');
  const { sourceFile, compression, storageRecordCount, acceptedBytes } = descriptor.payload;
  if (typeof sourceFile !== 'string'
      || !sourceFile
      || path.isAbsolute(sourceFile)
      || sourceFile !== indexedSession.sourceFile
      || !isPathInsideOrSame(path.resolve(sessionsRoot, sourceFile), sessionsRoot)
      || !['zstd', 'none'].includes(compression)
      || !Number.isSafeInteger(storageRecordCount)
      || storageRecordCount !== indexedSession.lineCount
      || !Number.isSafeInteger(acceptedBytes)
      || acceptedBytes !== indexedSession.bytes) {
    throw new Error('DeepSeek materialization payload is invalid');
  }
  if (!Array.isArray(dependencySet.entries) || dependencySet.entries.length !== 1) {
    throw new Error('DeepSeek materialization requires exactly one transcript dependency');
  }
  const entry = dependencySet.entries[0];
  requireExactKeys(entry, [
    'role', 'pathIdentity', 'existence', 'kind', 'policy', 'acceptedBytes', 'lineCount', 'digest', 'directoryEntries', 'evidence',
  ], 'DeepSeek transcript dependency');
  if (entry.role !== 'primary_transcript'
      || entry.pathIdentity !== sourceFile
      || entry.existence !== 'present'
      || entry.kind !== 'file'
      || entry.policy !== 'accepted_prefix'
      || entry.acceptedBytes !== acceptedBytes
      || entry.lineCount !== storageRecordCount
      || !/^[A-Za-z0-9_-]{43}$/.test(entry.digest)
      || entry.directoryEntries.length !== 0) {
    throw new Error('DeepSeek transcript dependency is invalid');
  }
  requireExactKeys(entry.evidence, ['compression', 'torn', 'fileIdentity'], 'DeepSeek transcript dependency evidence');
  requireExactKeys(entry.evidence.fileIdentity, ['device', 'inode', 'size', 'mtimeNs', 'ctimeNs'], 'DeepSeek file identity');
  for (const field of ['device', 'inode', 'size', 'mtimeNs', 'ctimeNs']) {
    if (typeof entry.evidence.fileIdentity[field] !== 'string') {
      throw new Error(`DeepSeek file identity ${field} is invalid`);
    }
  }
  if (entry.evidence.compression !== compression || typeof entry.evidence.torn !== 'boolean') {
    throw new Error('DeepSeek transcript evidence is invalid');
  }
  const expectedDependencySetId = `dsh-dependency:${storage.hashPlainValue(dependencySet.entries)}`;
  if (dependencySet.id !== expectedDependencySetId
      || descriptor.dependencySetId !== expectedDependencySetId) {
    throw new Error('DeepSeek dependency identity is invalid');
  }
  const expectedSnapshotId = `dsh-snapshot:${storage.hashPlainValue({
    dependencySet,
    payload: descriptor.payload,
  })}`;
  if (descriptor.sourceSnapshotId !== expectedSnapshotId) {
    throw new Error('DeepSeek materialization snapshot identity is invalid');
  }
}

function validateDeepSeekLegacyRawOwnerIndex({ sessionIds: ownedSessionIds, legacyRawOwners }) {
  if (!legacyRawOwners
      || legacyRawOwners.schemaVersion !== 1
      || legacyRawOwners.sourceKind !== SOURCE_KIND
      || legacyRawOwners.entryCount !== 0
      || !ownedSessionIds
      || !(ownedSessionIds instanceof Set)) {
    throw new Error('DeepSeek legacy Raw owner index is invalid');
  }
  requireExactKeys(legacyRawOwners.payload, [], 'DeepSeek legacy Raw owner payload');
  if (Buffer.byteLength(JSON.stringify(legacyRawOwners.payload), 'utf8') !== legacyRawOwners.accountedBytes) {
    throw new Error('DeepSeek legacy Raw owner accountedBytes is invalid');
  }
}

function validateDeepSeekMaterializedPrivateState() {
  // DeepSeek Phase 1 has no registered private Materialized Session fields.
}

async function buildDeepSeekEventDetailForSession(index, session, eventId, layer, options = {}) {
  return buildDeepSeekEventDetail(index, session, eventId, layer, options);
}

function materializationTargetForSession(index, session) {
  const indexedSession = index.sessionsById?.get(session?.id);
  const payload = indexedSession?.materializationDescriptor?.payload;
  let sourceFile = payload?.sourceFile || session?.sourceFile || '';
  let compression = payload?.compression || (
    String(sourceFile).endsWith('.jsonl.zstd') ? 'zstd' : 'none'
  );
  if (!sourceFile || !['zstd', 'none'].includes(compression)) return null;
  const target = path.resolve(index.sessionsRoot, sourceFile);
  if (!isPathInsideOrSame(target, index.sessionsRoot)) throw indexedSourceStaleError();
  return { target, sourceFile, compression };
}

async function readDeepSeekRawRecord(index, session, raw, options = {}) {
  const targetState = materializationTargetForSession(index, session);
  if (!targetState) return null;
  const target = targetState.target;
  const payload = targetState;
  if (!isPathInsideOrSame(target, index.sessionsRoot)) throw indexedSourceStaleError();
  const ordinal = Number.isSafeInteger(raw?.sourceLocator?.recordOrdinal)
    ? raw.sourceLocator.recordOrdinal
    : Number.isSafeInteger(raw?.rawIndex) ? raw.rawIndex : -1;
  if (ordinal < 0) return null;
  const result = await storage.readPhysicalRecordText(target, payload.compression, ordinal, options.signal);
  throwIfAborted(options.signal);
  return {
    raw: result.recordText,
    parsed: null,
    committedBytes: result.committedBytes,
    torn: result.torn,
    rawId: raw.rawId,
    sourceKind: SOURCE_KIND,
    sourceLocator: raw.sourceLocator,
  };
}

const deepSeekQuery = createSessionQuery({
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  rawRef: dshRawRef,
  rawRecordLabel(raw) {
    return i18n.rawRecordLabel(raw?.payloadType || raw?.recordType || '', i18n.DEFAULT_LOCALE);
  },
});

const deepSeekAdapter = {
  kind: SOURCE_KIND,
  label: 'DeepSeek Harness',
  homeOption: 'dshHome',
  homeLabel: 'DeepSeek sessions root',
  sessionLifecycle: 'indexed-materialized-v1',
  defaultHome: () => path.join(require('node:os').homedir(), '.dsh', 'sessions'),
  query: deepSeekQuery,
  discoverConfiguredProjects,
  discoverProjects: discoverDeepSeekProjects,
  buildIndex: buildDeepSeekIndex,
  materializeSession: materializeDeepSeekSession,
  buildEventDetail: buildDeepSeekEventDetailForSession,
  async readRawRecord(index, session, raw, options) {
    const value = await readDeepSeekRawRecord(index, session, raw, options);
    if (!value) return null;
    return {
      ...value,
      rawId: raw.rawId,
      sourceKind: SOURCE_KIND,
      sourceLocator: raw.sourceLocator,
    };
  },
  validateMaterializationDescriptor: validateDeepSeekMaterializationDescriptor,
  validateLegacyRawOwnerIndex: validateDeepSeekLegacyRawOwnerIndex,
  validateMaterializedPrivateState: validateDeepSeekMaterializedPrivateState,
  materializationContextFields: ['sessionsRoot'],
  materializedPrivateFields: [],
};

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

function renderMarkdownToHtml(text) {
  return markdownRenderer.render(String(text || ''));
}

module.exports = {
  DEEPSEEK_SOURCE_KIND: SOURCE_KIND,
  buildDeepSeekIndex,
  deepSeekAdapter,
  discoverDeepSeekProjects,
  dshRawRef,
  emptyCounts,
  finalizeSession,
  materializeDeepSeekSession,
  materializationTargetForSession,
  parseSessionArtifact,
  projectCarriedSession,
  readDeepSeekRawRecord,
  renderMarkdownToHtml,
  validateDeepSeekLegacyRawOwnerIndex,
  validateDeepSeekMaterializationDescriptor,
  validateDeepSeekMaterializedPrivateState,
  __testOnly: {
    makeLogicalEvent,
    makePartialAssistantEvent,
    protocolPreview,
  },
};
