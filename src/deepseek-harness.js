'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const MarkdownIt = require('markdown-it');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');
const { isPathInsideOrSame, resolveFsPath } = require('./shared/fs-path');
const planFacet = require('./shared/plan-facet');
const i18n = require('./shared/i18n');
const {
  createProjectQueryStoreBuilder,
} = require('./project-query-store');
const { createSessionQuery } = require('./session-query');
const { codeModePresentationContextMap } = require('./shared/code-mode-presentation-context');
const storage = require('./deepseek-harness-storage');
const { buildDeepSeekEventDetail } = require('./deepseek-harness-detail');

const SOURCE_KIND = storage.DEEPSEEK_SOURCE_KIND;
const PREVIEW_LIMIT = 240;
const SEARCH_TEXT_LIMIT = 16_000;
const PARTIAL_BLOCK_TEXT_LIMIT = SEARCH_TEXT_LIMIT;
const TITLE_LIMIT = 120;
const REASONING_LIMIT = SEARCH_TEXT_LIMIT;
const INHERITED_PREVIEW_LIMIT = 12;
const MAX_CODE_DISPATCH_DEPTH = 256;
const MAX_RETRY_DELAY_MS = 2_147_483_647;
const CODE_MODE_SCRIPT_OPERATION_KIND = 'code_mode_script_operation';
const LLM_RETRY_EVENT_TYPES = new Set(['llm/retry', 'llm/retry-started']);
const PERMISSION_EVENT_TYPES = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);
const SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const APPROVAL_POLICIES = new Set(['ask', 'never']);
const GOAL_SNAPSHOT_OPERATIONS = new Set(['create', 'edit', 'pause', 'resume', 'complete', 'block']);
const GOAL_PHASES = new Set(['active', 'paused', 'blocked', 'complete']);
const TOOL_WORKFLOW_EVENT_TYPES = new Set([
  'tool-workflow/run-start',
  'tool-workflow/run-end',
  'tool-workflow/agent-start',
  'tool-workflow/agent-end',
]);
const DSH_FORK_SEGMENTS = Object.freeze([
  'fork_metadata',
  'inherited_context',
  'continuation',
]);


// Current generated upstream vocabulary at tmp/deepseek-harness-current HEAD
// b150a551… (0.1.1-rc.2), refreshed from the original 47f9438… baseline:
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
  'team/member',
  'team/message/delivered',
  'team/message/queued',
  'team/task',
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
function isAppendSurfaceOp(value) {
  return value === 'append';
}

function isReplaceSurfaceOp(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.op === 'replace');
}

function replaceSurfaceRange(value) {
  if (!isReplaceSurfaceOp(value)) return null;
  if (!Number.isSafeInteger(value.start) || value.start < 0
      || !Number.isSafeInteger(value.end) || value.end < 0) {
    return null;
  }
  return { start: value.start, end: value.end };
}

function parseSubagentDescriptorData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== 2) return null;
  if (value.mode !== 'one-shot' && value.mode !== 'continuable') return null;
  if (typeof value.provider !== 'string' || !value.provider.trim()) return null;
  const base = {
    version: 2,
    mode: value.mode,
    provider: value.provider,
    ...(typeof value.label === 'string' && value.label.trim() ? { label: value.label } : {}),
  };
  if (value.mode === 'one-shot') return base;
  const continuable = {
    ...base,
    ...(typeof value.agentProvider === 'string' && value.agentProvider.trim()
      ? { agentProvider: value.agentProvider }
      : {}),
    ...(typeof value.agentModel === 'string' && value.agentModel.trim()
      ? { agentModel: value.agentModel }
      : {}),
    ...(typeof value.persona === 'string' && value.persona.trim() ? { persona: value.persona } : {}),
    ...(value.toolFilter && typeof value.toolFilter === 'object' && !Array.isArray(value.toolFilter)
      ? { toolFilter: value.toolFilter }
      : {}),
  };
  return continuable;
}

function descriptorPreview(descriptor) {
  if (!descriptor) return '';
  const parts = [
    `provider=${descriptor.provider}`,
    `mode=${descriptor.mode}`,
    descriptor.label ? `label=${truncatePreview(descriptor.label, 120)}` : '',
  ].filter(Boolean);
  return `Subagent descriptor: ${parts.join(' ')}`;
}

function descriptorSearchText(descriptor) {
  if (!descriptor) return '';
  return [
    'subagent/descriptor',
    `version=${descriptor.version}`,
    `provider=${descriptor.provider}`,
    `mode=${descriptor.mode}`,
    descriptor.label ? `label=${descriptor.label}` : '',
    descriptor.agentProvider ? `agentProvider=${descriptor.agentProvider}` : '',
    descriptor.agentModel ? `agentModel=${descriptor.agentModel}` : '',
    descriptor.persona ? `persona=${descriptor.persona}` : '',
  ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT);
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

function boundedJsonText(value, limit = SEARCH_TEXT_LIMIT) {
  try {
    return JSON.stringify(value, null, 2).slice(0, limit);
  } catch {
    return '';
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

function toolResultCallId(event) {
  const callId = event?.data?.message?.source?.callId
    || event?.data?.message?.content?.[0]?.toolCallId
    || '';
  return typeof callId === 'string' && callId ? callId : '';
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
    case 'agent-preset/selected':
      return `Agent preset selected: ${value.agentPreset || ''}`;
    case 'session/end-seed':
      return 'Session constructor seed ended';
    case 'subagent/descriptor':
      return descriptorPreview(parseSubagentDescriptorData(value)) || 'Subagent descriptor';
    case 'compaction/start':
      return `Compaction started (${value.compactionId || 'unknown id'})`;
    case 'compaction/summary':
      return `Compaction summary: ${Array.isArray(value.shadowedSeqs) ? value.shadowedSeqs.length : 0} surface events shadowed`
        + (Number.isFinite(value.shadowedTokenCount) ? ` (${value.shadowedTokenCount} tokens)` : '');
    case 'compaction/end':
      return value.error ? `Compaction failed: ${truncatePreview(value.error)}` : 'Compaction completed';
    case 'compaction/prune':
      return `Tool-result prune: ${Array.isArray(value.shadowedSeqs) ? value.shadowedSeqs.length : 0} surface events shadowed`
        + (Number.isFinite(value.shadowedTokenCount) ? ` (${value.shadowedTokenCount} tokens)` : '');
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
    case 'agent-preset/selected':
      return `agent-preset/selected\nagentPreset=${value.agentPreset || ''}`.slice(0, SEARCH_TEXT_LIMIT);
    case 'session/end-seed':
      return 'session/end-seed\nSession constructor seed lifecycle boundary'.slice(0, SEARCH_TEXT_LIMIT);
    case 'subagent/descriptor':
      return descriptorSearchText(parseSubagentDescriptorData(value));
    case 'compaction/start':
      return `compaction/start\ncompactionId=${value.compactionId || ''}\nturn=${value.turn ?? ''}`.slice(0, SEARCH_TEXT_LIMIT);
    case 'compaction/summary':
      return [
        'compaction/summary',
        `compactionId=${value.compactionId || ''}`,
        `shadowedRange=${value.shadowedRange?.start ?? ''}..${value.shadowedRange?.end ?? ''}`,
        `shadowedSeqs=${Array.isArray(value.shadowedSeqs) ? value.shadowedSeqs.join(',') : ''}`,
        `shadowedTokenCount=${value.shadowedTokenCount ?? ''}`,
        `provider=${value.provider || ''}`,
        `model=${value.model || ''}`,
        visibleText(value.summary),
      ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT);
    case 'compaction/end':
      return [
        'compaction/end',
        `compactionId=${value.compactionId || ''}`,
        `error=${value.error || ''}`,
      ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT);
    case 'compaction/prune':
      return [
        'compaction/prune',
        `shadowedRange=${value.shadowedRange?.start ?? ''}..${value.shadowedRange?.end ?? ''}`,
        `shadowedSeqs=${Array.isArray(value.shadowedSeqs) ? value.shadowedSeqs.join(',') : ''}`,
        `shadowedTokenCount=${value.shadowedTokenCount ?? ''}`,
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
    const lineage = [
      record.parentSession ? `parent=${record.parentSession}` : '',
      Number.isSafeInteger(record.seedLength) ? `seedLength=${record.seedLength}` : '',
      record.origin ? `origin=${record.origin}` : '',
      Number.isSafeInteger(record.delegationDepth) ? `delegationDepth=${record.delegationDepth}` : '',
      record.agentPreset ? `agentPreset=${record.agentPreset}` : '',
    ].filter(Boolean).join(' ');
    preview = truncatePreview(`Session header ${record.id || ''} (format v${record.version})`);
    searchText = [
      `session header ${record.id || ''}`,
      `format-v${record.version}`,
      `cwd=${record.cwd || ''}`,
      lineage,
    ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT);
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
      || recordType === 'tool/code-dispatch-start' || recordType === 'tool/code-dispatch'
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
    seq0: packedSummary ? record.seq0 : (Number.isSafeInteger(record?.seq) ? record.seq : null),
    seqEnd: packedSummary ? packedSummary.end : (Number.isSafeInteger(record?.seq) ? record.seq : null),
    forkSegment: '',
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

function codeModePhysicalRef(raw) {
  return {
    rawId: String(raw?.rawId || ''),
    file: String(raw?.source?.file || ''),
    line: Number.isSafeInteger(raw?.source?.line) ? raw.source.line : null,
  };
}

function attachCodeModeOperation(event, sessionId, call, resultRaw = null) {
  const callRef = codeModePhysicalRef(call.raw);
  const outputRef = resultRaw ? codeModePhysicalRef(resultRaw) : null;
  const span = resultRaw && callRef.file === outputRef.file
    ? {
      file: callRef.file,
      startLine: callRef.line,
      endLine: outputRef.line,
      startRawId: callRef.rawId,
      endRawId: outputRef.rawId,
    }
    : null;
  const phase = {
    kind: 'exec',
    callId: call.callId,
    targetCellId: '',
    evidenceState: resultRaw ? 'output_observed' : 'call_only',
    observationState: resultRaw ? 'terminal' : 'unknown',
    observedCellId: '',
    callRef,
    outputRef,
    span,
  };
  event.codeModeOperation = {
    id: event.id,
    sessionId,
    outerCallId: call.callId,
    rootCallId: call.callId,
    turnId: event.turnId,
    cellId: '',
    evidenceState: phase.evidenceState,
    observationState: phase.observationState,
    pairingIssue: resultRaw ? '' : 'missing_output',
    phases: [phase],
    phaseSpans: span ? [{ phaseIndex: 0, kind: 'exec', callId: call.callId, ...span }] : [],
    eventRefs: [],
    dispatches: [],
  };
  return event;
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
  const sourceParentSessionId = header.parentSession || '';
  const parentSessionId = sourceParentSessionId ? `${SOURCE_KIND}:${sourceParentSessionId}` : '';
  const subagent = header.origin === 'subagent';
  // `parentSession` is durable lineage, not subagent classification. A normal
  // fork has the header field without `origin:"subagent"` and keeps its fork
  // relationship; only the explicit origin classifies a child as a subagent.
  const forkedFromSessionId = sourceParentSessionId && !subagent ? parentSessionId : '';
  const seedLength = Number.isSafeInteger(header.seedLength) ? header.seedLength : null;
  return {
    id: `${SOURCE_KIND}:${header.id}`,
    sourceKind: SOURCE_KIND,
    sourceSessionId: header.id,
    sourceDerivedId: '',
    sourceClientVersion: '',
    projectAssociation: header.cwd || '',
    title: '',
    sourceFile: relFile,
    // `agentNickname` is the existing user-visible carried name surface. The
    // useful DeepSeek fact is the effective running preset, resolved below
    // from the last durable `agent-preset/selected` with the creation-time
    // header preset as fallback. The header remains byte-exact in Raw.
    agentNickname: header.agentPreset || '',
    primarySessionMetaKind: subagent ? 'subagent' : '',
    derivedRunId: '',
    startedAt: safeIso(header.createdAt),
    updatedAt: safeIso(header.createdAt),
    bytes: committedBytes,
    lineCount: 0,
    cwdSet,
    counts: emptyCounts(),
    rawEventCount: 0,
    logicalEventCount: 0,
    parentSessionId,
    forkedFromSessionId,
    forkStorageMode: seedLength !== null ? 'materialized' : '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    parentSessionInferred: false,
    forkEvidence: null,
    inheritedContext: null,
    derivedRelationship: null,
    spawnDepth: header.delegationDepth,
    summary: emptySummary(),
    rawEvents: [],
    logicalEvents: [],
    analysis: null,
    presentationIndexes: { codeModeDeclaredRequests: new Map() },
    matchesRepo: false,
    _sourceParentSessionId: sourceParentSessionId,
    _origin: header.origin || '',
    _creationAgentPreset: header.agentPreset || '',
    _effectiveAgentPreset: header.agentPreset || '',
    _agentPresetSelections: [],
    _seedLength: seedLength,
    _seedMarkers: [],
    _titleCandidates: [],
    _subagentDescriptor: null,
    _forkSegmentsByRawId: new Map(),
  };
}

function decodePermissionChange(event) {
  const data = event.data;
  if (event.type === 'permission/preset') {
    if (!hasExactKeys(data, ['preset']) || typeof data.preset !== 'string' || data.preset.length === 0) return null;
    return { field: 'preset', value: data.preset };
  }
  const keys = Object.hasOwn(data || {}, 'source') ? ['mode', 'source'] : ['mode'];
  if (event.type === 'sandbox/mode') {
    if (!hasExactKeys(data, keys) || !SANDBOX_MODES.has(data.mode)
        || (data.source !== undefined && data.source !== 'delegation')) return null;
    return { field: 'sandboxMode', value: data.mode, ...(data.source ? { source: data.source } : {}) };
  }
  const policyKeys = Object.hasOwn(data || {}, 'source') ? ['policy', 'source'] : ['policy'];
  if (event.type === 'approval/policy') {
    if (!hasExactKeys(data, policyKeys) || !APPROVAL_POLICIES.has(data.policy)
        || (data.source !== undefined && data.source !== 'delegation')) return null;
    return { field: 'approvalPolicy', value: data.policy, ...(data.source ? { source: data.source } : {}) };
  }
  return null;
}

function observedPermissionSnapshot(state) {
  return {
    preset: state.preset,
    sandboxMode: state.sandboxMode,
    approvalPolicy: state.approvalPolicy,
    complete: state.preset !== null && state.sandboxMode !== null && state.approvalPolicy !== null,
  };
}

function makePermissionProtocolEvent(sessionId, event, raw, observedState) {
  const change = decodePermissionChange(event);
  if (!change) {
    return makeProtocolEvent(sessionId, event, raw, event.type, {
      role: 'system',
      severity: 'warning',
      status: 'incomplete',
      preview: `${protocolPreview(event.type, event.data)} (invalid durable payload)`,
    });
  }
  observedState[change.field] = change.value;
  const logical = makeProtocolEvent(sessionId, event, raw, event.type, { role: 'system' });
  logical.permissionChange = {
    eventType: event.type,
    field: change.field,
    value: change.value,
    sourceSeq: event.seq,
    ...(change.source ? { source: change.source } : {}),
  };
  logical.permissionState = observedPermissionSnapshot(observedState);
  return logical;
}

function createInboxReplay() {
  return {
    queues: { 'next-turn': [], 'next-step': [] },
    claimedByMessageId: new Map(),
    disabled: false,
  };
}

function disableInboxReplay(replay) {
  replay.disabled = true;
  replay.queues['next-turn'] = [];
  replay.queues['next-step'] = [];
  replay.claimedByMessageId.clear();
}

function decodeInboxSplice(data, replay) {
  if (!isPlainRecord(data)) return null;
  const expectedKeys = [
    'target', 'start', 'inserted',
    ...(Object.hasOwn(data, 'removedCount') ? ['removedCount'] : []),
    ...(Object.hasOwn(data, 'outcome') ? ['outcome'] : []),
  ];
  if (!hasExactKeys(data, expectedKeys)
      || (data.target !== 'next-turn' && data.target !== 'next-step')
      || !Number.isSafeInteger(data.start)
      || !Array.isArray(data.inserted)
      || (data.outcome !== undefined && data.outcome !== 'canceled')) return null;
  const removedCount = data.removedCount ?? 0;
  const queue = replay.queues[data.target];
  if (!Number.isSafeInteger(removedCount) || removedCount < 0
      || data.start < 0 || data.start > queue.length
      || data.start + removedCount > queue.length
      || (removedCount === 0 && data.inserted.length === 0)
      || (data.outcome === 'canceled' && removedCount === 0)) return null;
  for (const message of data.inserted) {
    if (!hasExactKeys(message, ['id', 'role', 'content', 'source'])
        || typeof message.id !== 'string' || !message.id
        || message.role !== 'user' || !Array.isArray(message.content)
        || !isPlainRecord(message.source) || typeof message.source.kind !== 'string' || !message.source.kind) return null;
  }
  const shape = removedCount === 0
    ? 'insertion'
    : (data.inserted.length === 0 ? 'deletion' : 'replacement');
  const exactClaim = shape === 'deletion' && data.outcome === undefined && data.start === 0
    && ((data.target === 'next-turn' && removedCount === 1)
      || (data.target === 'next-step' && removedCount === queue.length));
  const operation = shape === 'insertion' && data.outcome === undefined
    ? 'enqueue'
    : (exactClaim ? 'claim' : 'generic');
  const removed = queue.slice(data.start, data.start + removedCount);
  const inserted = data.inserted.map(message => ({ message, eligible: operation === 'enqueue' }));
  const candidate = queue.toSpliced(data.start, removedCount, ...inserted);
  const all = data.target === 'next-turn'
    ? [...candidate, ...replay.queues['next-step']]
    : [...replay.queues['next-turn'], ...candidate];
  const ids = new Set();
  for (const item of all) {
    if (ids.has(item.message.id)) return null;
    ids.add(item.message.id);
  }
  return { target: data.target, start: data.start, removedCount, operation, removed, inserted, candidate };
}

function makeInboxProtocolEvent(sessionId, event, raw, replay) {
  const logical = makeProtocolEvent(sessionId, event, raw, event.type, { role: 'system' });
  if (replay.disabled) return logical;
  const splice = decodeInboxSplice(event.data, replay);
  if (!splice) {
    disableInboxReplay(replay);
    return logical;
  }
  replay.queues[splice.target] = splice.candidate;
  if (splice.operation === 'enqueue') {
    for (const item of splice.inserted) {
      item.insertionEventId = logical.id;
      item.insertionSeq = event.seq;
      item.target = splice.target;
    }
    logical.inboxSplice = {
      operation: 'enqueue',
      target: splice.target,
      start: splice.start,
      removedCount: 0,
      insertedCount: splice.inserted.length,
      messageIds: splice.inserted.map(item => item.message.id),
      sourceSeq: event.seq,
    };
  } else if (splice.operation === 'claim') {
    const claimedIds = [];
    for (const item of splice.removed) {
      if (!item.eligible || !item.insertionEventId) continue;
      const candidates = replay.claimedByMessageId.get(item.message.id) || [];
      candidates.push({
        ...item,
        claimEventId: logical.id,
        claimSeq: event.seq,
        consumed: false,
      });
      replay.claimedByMessageId.set(item.message.id, candidates);
      claimedIds.push(item.message.id);
    }
    logical.inboxSplice = {
      operation: 'claim',
      target: splice.target,
      start: splice.start,
      removedCount: splice.removedCount,
      insertedCount: 0,
      messageIds: claimedIds,
      sourceSeq: event.seq,
    };
  }
  return logical;
}

function attachInboxProvenance(logical, event, replay) {
  if (replay.disabled || !isAppendSurfaceOp(event.surfaceOp)
      || typeof event.data?.id !== 'string' || !event.data.id) return;
  const candidates = (replay.claimedByMessageId.get(event.data.id) || [])
    .filter(candidate => !candidate.consumed && candidate.claimSeq < event.seq);
  if (candidates.length !== 1) return;
  const candidate = candidates[0];
  if (!isDeepStrictEqual(candidate.message, event.data)) return;
  candidate.consumed = true;
  logical.inboxProvenance = {
    messageId: event.data.id,
    target: candidate.target,
    enqueuedAtSeq: candidate.insertionSeq,
    claimedAtSeq: candidate.claimSeq,
    insertionEventId: candidate.insertionEventId,
    claimEventId: candidate.claimEventId,
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
    if (event.kind === 'command' || event.kind === 'other_tool_call' || event.kind === 'code_mode_operation') {
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
    if (event.kind === 'compaction') session.counts.compactions += 1;
    if (event.kind === 'abort') session.counts.aborts += 1;
    if (event.kind === 'error') session.counts.errors += 1;
    if (planFacet.isPlanArtifactEvent(event)) session.counts.planArtifacts += 1;
    if (planFacet.isPlanEvent(event)) session.counts.planEvents += 1;
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
  const normalizedName = String(call.name || '').toLowerCase();
  const kind = normalizedName === 'bash'
    ? 'command'
    : (normalizedName === 'run_code' ? 'code_mode_operation' : 'other_tool_call');
  const command = call.name === 'bash' ? commandTextForTool(call.name, call.arguments) : '';
  const args = parseToolArguments(call.arguments);
  const codeDescription = normalizedName === 'run_code' && typeof args?.description === 'string'
    ? args.description
    : '';
  const preview = kind === 'command'
    ? truncatePreview(command || resultText || call.name)
    : truncatePreview(codeDescription || resultText || call.name);
  const logical = makeLogicalEvent({
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
  });
  if (kind === 'code_mode_operation') {
    attachCodeModeOperation(logical, session.id, call, resultRaw);
  }
  session.logicalEvents.push(logical);
  return logical;
}

function makeIncompleteToolEvent(session, call) {
  const normalizedName = String(call.name || '').toLowerCase();
  const kind = normalizedName === 'bash'
    ? 'command'
    : (normalizedName === 'run_code' ? 'code_mode_operation' : 'other_tool_call');
  const command = call.name === 'bash' ? commandTextForTool(call.name, call.arguments) : '';
  const args = parseToolArguments(call.arguments);
  const codeDescription = normalizedName === 'run_code' && typeof args?.description === 'string'
    ? args.description
    : '';
  const logical = makeLogicalEvent({
    id: `${session.id}:logical:tool:${call.callId}`,
    timestamp: safeIso(call.time),
    turnId: call.turn ? `turn:${call.turn}` : '',
    kind,
    subtype: call.name || kind,
    layer: 'main',
    role: 'assistant',
    label: call.name ? i18n.humanize(call.name) : kind,
    preview: truncatePreview(command || codeDescription || call.arguments || call.name),
    searchText: [call.name || '', call.arguments || '', command].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: 'warning',
    status: 'incomplete',
    toolName: call.name || '',
    outputStats: {},
    rawRefs: [dshRawRef(call.raw)],
    channels: ['tool/call'],
  });
  if (kind === 'code_mode_operation') {
    attachCodeModeOperation(logical, session.id, call);
  }
  session.logicalEvents.push(logical);
  return logical;
}

function decodeToolResultPrune(event) {
  if (event?.type !== 'compaction/prune') return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Array.isArray(data.shadowedSeqs) || data.shadowedSeqs.length !== 1) return null;
  const originalResultSeq = data.shadowedSeqs[0];
  if (!Number.isSafeInteger(originalResultSeq) || originalResultSeq < 0) return null;
  const range = data.shadowedRange;
  if (!range || typeof range !== 'object' || Array.isArray(range)
      || range.start !== originalResultSeq || range.end !== originalResultSeq) return null;
  if (!Number.isSafeInteger(data.shadowedTokenCount) || data.shadowedTokenCount < 0) return null;
  return {
    originalResultSeq,
    shadowedTokenCount: data.shadowedTokenCount,
  };
}

function decodePrunedToolResultReplacement(event) {
  if (event?.type !== 'tool/result' || !isReplaceSurfaceOp(event.surfaceOp)) return null;
  const range = replaceSurfaceRange(event.surfaceOp);
  if (!range || range.start !== range.end) return null;
  if (!Array.isArray(event.sourceEventSeqs)
      || event.sourceEventSeqs.length !== 1
      || event.sourceEventSeqs[0] !== range.start) return null;
  const originalResultSeq = range.start;
  if (!Number.isSafeInteger(originalResultSeq) || originalResultSeq < 0) return null;
  return {
    originalResultSeq,
    callId: toolResultCallId(event),
  };
}

function normalizedPruneToolResultEnvelope(event) {
  const data = event?.data;
  if (!isPlainRecord(data) || !isPlainRecord(data.message)) return null;
  const message = data.message;
  if (!isPlainRecord(message.source)
      || typeof message.source.callId !== 'string'
      || !message.source.callId
      || !Array.isArray(message.content)
      || message.content.length !== 1) return null;
  const result = message.content[0];
  if (!isPlainRecord(result)
      || result.type !== 'tool-result'
      || !Array.isArray(result.content)) return null;
  return {
    ...data,
    message: {
      ...message,
      content: [{
        ...result,
        // Current writer replaces only this nested content payload. Every
        // surrounding durable envelope fact remains part of strict equality.
        content: null,
      }],
    },
  };
}

function pruneToolResultEnvelopesMatch(original, replacement) {
  const originalEnvelope = normalizedPruneToolResultEnvelope(original);
  const replacementEnvelope = normalizedPruneToolResultEnvelope(replacement);
  return originalEnvelope !== null
    && replacementEnvelope !== null
    && isDeepStrictEqual(originalEnvelope, replacementEnvelope);
}

function appendGroupedRow(map, key, row) {
  const rows = map.get(key) || [];
  rows.push(row);
  map.set(key, rows);
}

function projectToolResultPrunes(
  session,
  pruneRows,
  replacementRows,
  originalResultsBySeq,
  toolCallsById,
  seedBoundary,
) {
  const childStart = Number.isSafeInteger(seedBoundary) ? seedBoundary : 0;
  const ownedLogicalIds = new Set(session.logicalEvents.map(event => event.id));
  const prunesByOriginalSeq = new Map();
  const replacementsByOriginalSeq = new Map();

  for (const row of pruneRows) {
    if (row.event.seq < childStart || !ownedLogicalIds.has(row.logical.id)) continue;
    const facts = decodeToolResultPrune(row.event);
    if (!facts) continue;
    appendGroupedRow(prunesByOriginalSeq, facts.originalResultSeq, { ...row, facts });
  }
  for (const row of replacementRows) {
    if (row.event.seq < childStart || !ownedLogicalIds.has(row.logical.id)) continue;
    const facts = decodePrunedToolResultReplacement(row.event);
    if (!facts) continue;
    appendGroupedRow(replacementsByOriginalSeq, facts.originalResultSeq, { ...row, facts });
  }

  for (const [originalResultSeq, prunes] of prunesByOriginalSeq) {
    const replacements = replacementsByOriginalSeq.get(originalResultSeq) || [];
    if (prunes.length !== 1 || replacements.length !== 1) continue;
    const prune = prunes[0];
    const replacement = replacements[0];
    const original = originalResultsBySeq.get(originalResultSeq);
    if (!original
        || original.event.seq < childStart
        || !ownedLogicalIds.has(original.logical.id)
        || toolCallsById.get(original.call.callId) !== original.call
        || prune.event.seq <= original.event.seq
        || replacement.event.seq !== prune.event.seq + 1
        || !pruneToolResultEnvelopesMatch(original.event, replacement.event)) continue;
    const originalCallId = toolResultCallId(original.event);
    if (!originalCallId || originalCallId !== replacement.facts.callId) continue;

    original.logical.toolResultPrune = {
      pruneEventId: prune.logical.id,
      replacementEventId: replacement.logical.id,
      originalResultSeq,
      replacementResultSeq: replacement.event.seq,
    };
    prune.logical.toolResultPrune = {
      originalOperationEventId: original.logical.id,
      replacementEventId: replacement.logical.id,
      originalResultSeq,
      replacementResultSeq: replacement.event.seq,
      shadowedTokenCount: prune.facts.shadowedTokenCount,
    };
    replacement.logical.toolResultPrune = {
      originalOperationEventId: original.logical.id,
      pruneEventId: prune.logical.id,
      originalResultSeq,
    };
  }
}

function dispatchFacts(row) {
  const data = row?.event?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const rootCallId = safeString(data.rootCallId);
  const parentCallId = safeString(data.parentCallId);
  const subCallId = safeString(data.subCallId);
  const name = safeString(data.name);
  if (!rootCallId || !parentCallId || !subCallId || !name) return null;
  return {
    rootCallId,
    parentCallId,
    subCallId,
    name,
    arguments: data.arguments,
    argumentsKey: boundedJsonText(data.arguments, SEARCH_TEXT_LIMIT),
  };
}

function makeDispatchFallback(session, row, reason) {
  session.logicalEvents.push(makeProtocolEvent(
    session.id,
    row.event,
    row.raw,
    row.event.type,
    {
      label: 'Uncorrelated Code Mode dispatch',
      role: 'system',
      preview: `Uncorrelated ${row.event.type}: ${reason}`,
      searchText: `${row.event.type}\n${reason}\n${protocolSearchText(row.event.type, row.event.data)}`,
      severity: 'warning',
      status: 'incomplete',
    },
  ));
}

function dispatchResultText(data) {
  const text = visibleText(data?.content);
  if (text) return text;
  return storage.flattenBounded(data?.content || [], SEARCH_TEXT_LIMIT);
}

function makeCodeDispatchEvent(session, node, outerCall) {
  const start = node.start;
  const settled = node.settled;
  const facts = node.facts;
  const resultText = settled ? dispatchResultText(settled.event.data) : '';
  const failed = settled?.event?.data?.isError === true;
  const status = settled ? (failed ? 'failed' : 'success') : 'incomplete';
  const kind = facts.name.toLowerCase() === 'bash' ? 'command' : 'other_tool_call';
  const rawRows = [start, settled]
    .filter(Boolean)
    .sort((left, right) => left.event.seq - right.event.seq);
  const logical = makeLogicalEvent({
    id: `${session.id}:logical:code-dispatch:${facts.subCallId}`,
    timestamp: safeIso((start || settled).event.time),
    turnId: outerCall.turn ? `turn:${outerCall.turn}` : '',
    kind,
    subtype: facts.name,
    layer: 'main',
    role: 'assistant',
    label: i18n.humanize(facts.name),
    preview: truncatePreview(resultText || facts.argumentsKey || facts.name),
    searchText: [
      facts.name,
      facts.argumentsKey,
      resultText,
      `rootCallId=${facts.rootCallId}`,
      `parentCallId=${facts.parentCallId}`,
      `subCallId=${facts.subCallId}`,
    ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: failed ? 'error' : (settled ? 'normal' : 'warning'),
    status,
    toolName: facts.name,
    outputStats: {},
    rawRefs: rawRows.map((row) => dshRawRef(row.raw)),
    channels: rawRows.map((row) => row.event.type),
  });
  node.logical = logical;
  return logical;
}

function projectCodeDispatches(session, rows, toolCallsById) {
  if (!rows.length) return;
  const rowsBySubCall = new Map();
  const invalidRows = [];
  for (const row of rows) {
    const facts = dispatchFacts(row);
    if (!facts) {
      invalidRows.push({ row, reason: 'missing durable dispatch identity' });
      continue;
    }
    const group = rowsBySubCall.get(facts.subCallId) || [];
    group.push({ ...row, facts });
    rowsBySubCall.set(facts.subCallId, group);
  }

  const nodes = new Map();
  for (const [subCallId, group] of rowsBySubCall) {
    const starts = group.filter((row) => row.event.type === 'tool/code-dispatch-start');
    const settlements = group.filter((row) => row.event.type === 'tool/code-dispatch');
    const firstFacts = group[0].facts;
    const consistent = group.every((row) => (
      row.facts.rootCallId === firstFacts.rootCallId
      && row.facts.parentCallId === firstFacts.parentCallId
      && row.facts.name === firstFacts.name
      && isDeepStrictEqual(row.facts.arguments, firstFacts.arguments)
    ));
    if (!consistent || starts.length > 1 || settlements.length > 1) {
      for (const row of group) invalidRows.push({ row, reason: `ambiguous dispatch identity ${subCallId}` });
      continue;
    }
    const start = starts[0] || null;
    const settled = settlements[0] || null;
    if (start && settled && settled.event.seq < start.event.seq) {
      for (const row of group) invalidRows.push({ row, reason: `settlement precedes start for ${subCallId}` });
      continue;
    }
    nodes.set(subCallId, {
      facts: firstFacts,
      start,
      settled,
      rows: group,
      anchorSeq: (start || settled).event.seq,
      depth: 0,
      logical: null,
      invalidReason: '',
    });
  }

  const depthFor = (node, trail = new Set()) => {
    if (node.invalidReason) return null;
    const { rootCallId, parentCallId, subCallId } = node.facts;
    const outerCall = toolCallsById.get(rootCallId);
    if (!outerCall || String(outerCall.name || '').toLowerCase() !== 'run_code') {
      node.invalidReason = `root ${rootCallId} is not an outer run_code call`;
      return null;
    }
    if (parentCallId === rootCallId) return 1;
    if (parentCallId === subCallId || trail.has(subCallId)) {
      node.invalidReason = `cyclic dispatch ancestry at ${subCallId}`;
      return null;
    }
    if (trail.size >= MAX_CODE_DISPATCH_DEPTH) {
      node.invalidReason = `dispatch ancestry exceeds the supported depth for ${subCallId}`;
      return null;
    }
    const parent = nodes.get(parentCallId);
    if (!parent || parent.anchorSeq >= node.anchorSeq || parent.facts.rootCallId !== rootCallId) {
      node.invalidReason = `parent ${parentCallId} is not an earlier dispatch in root ${rootCallId}`;
      return null;
    }
    trail.add(subCallId);
    const parentDepth = depthFor(parent, trail);
    trail.delete(subCallId);
    if (parentDepth === null || parentDepth + 1 > MAX_CODE_DISPATCH_DEPTH) {
      node.invalidReason = `dispatch ancestry exceeds the supported depth for ${subCallId}`;
      return null;
    }
    return parentDepth + 1;
  };

  for (const node of nodes.values()) {
    const depth = depthFor(node);
    if (depth === null) {
      for (const row of node.rows) invalidRows.push({ row, reason: node.invalidReason });
    } else {
      node.depth = depth;
    }
  }
  for (const { row, reason } of invalidRows.sort((left, right) => left.row.event.seq - right.row.event.seq)) {
    makeDispatchFallback(session, row, reason);
  }

  const validNodes = [...nodes.values()]
    .filter((node) => node.depth > 0)
    .sort((left, right) => left.anchorSeq - right.anchorSeq);
  for (const node of validNodes) {
    const outerCall = toolCallsById.get(node.facts.rootCallId);
    session.logicalEvents.push(makeCodeDispatchEvent(session, node, outerCall));
  }

  const outerEvents = new Map(session.logicalEvents
    .filter((event) => event.kind === 'code_mode_operation' && event.codeModeOperation?.outerCallId)
    .map((event) => [event.codeModeOperation.outerCallId, event]));
  const nodesByRoot = new Map();
  for (const node of validNodes) {
    const grouped = nodesByRoot.get(node.facts.rootCallId) || [];
    grouped.push(node);
    nodesByRoot.set(node.facts.rootCallId, grouped);
  }
  for (const [rootCallId, groupedNodes] of nodesByRoot) {
    const outer = outerEvents.get(rootCallId);
    if (!outer) {
      for (const node of groupedNodes) {
        session.logicalEvents = session.logicalEvents.filter((event) => event !== node.logical);
        for (const row of node.rows) makeDispatchFallback(session, row, `missing outer operation ${rootCallId}`);
      }
      continue;
    }
    outer.codeModeOperation.eventRefs = groupedNodes.map((node) => node.logical.id);
    outer.codeModeOperation.dispatches = groupedNodes.map((node) => ({
      eventId: node.logical.id,
      rootCallId: node.facts.rootCallId,
      parentCallId: node.facts.parentCallId,
      subCallId: node.facts.subCallId,
      parentEventId: node.facts.parentCallId === rootCallId
        ? outer.id
        : nodes.get(node.facts.parentCallId)?.logical?.id || '',
      depth: node.depth,
      startSeq: node.start?.event.seq ?? null,
      settledSeq: node.settled?.event.seq ?? null,
    }));
  }
}

function workflowFallback(session, row, reason) {
  session.logicalEvents.push(makeProtocolEvent(session.id, row.event, row.raw, row.event.type, {
    label: 'Uncorrelated workflow lifecycle',
    role: 'system',
    preview: `Uncorrelated ${row.event.type}: ${reason}`,
    searchText: `${row.event.type}\n${reason}\n${protocolSearchText(row.event.type, row.event.data)}`,
    severity: 'warning',
    status: 'incomplete',
  }));
}

function validateWorkflowRows(rows) {
  const ordered = [...rows].sort((left, right) => left.event.seq - right.event.seq);
  const starts = ordered.filter((row) => row.event.type === 'tool-workflow/run-start');
  const ends = ordered.filter((row) => row.event.type === 'tool-workflow/run-end');
  if (starts.length !== 1 || starts[0] !== ordered[0]) return { reason: 'run must have one leading run-start' };
  if (ends.length > 1 || (ends.length === 1 && ends[0] !== ordered.at(-1))) {
    return { reason: 'run must have at most one trailing run-end' };
  }
  const startData = starts[0].event.data;
  if (typeof startData.name !== 'string' || !startData.name) return { reason: 'run-start name is invalid' };
  const members = new Map();
  for (const row of ordered.slice(1)) {
    const data = row.event.data;
    if (row.event.type === 'tool-workflow/agent-start') {
      if (!Number.isSafeInteger(data.seq) || data.seq < 1 || members.has(data.seq)
          || typeof data.label !== 'string'
          || (data.phase !== undefined && typeof data.phase !== 'string')
          || typeof data.childId !== 'string' || !data.childId) {
        return { reason: `invalid or repeated workflow member ${String(data.seq)}` };
      }
      members.set(data.seq, { start: row, end: null });
    } else if (row.event.type === 'tool-workflow/agent-end') {
      const member = members.get(data.seq);
      if (!member || member.end
          || !['completed', 'failed', 'cancelled'].includes(data.outcome)) {
        return { reason: `unmatched or invalid workflow member end ${String(data.seq)}` };
      }
      member.end = row;
    } else if (row.event.type === 'tool-workflow/run-end') {
      if (!['completed', 'cancelled', 'error'].includes(data.stopReason)) {
        return { reason: `invalid workflow stop reason ${String(data.stopReason)}` };
      }
      if ([...members.values()].some((member) => !member.end)) {
        return { reason: 'run-end leaves a workflow member open' };
      }
    } else {
      return { reason: `unexpected workflow event ${row.event.type}` };
    }
  }
  return { ordered, start: starts[0], end: ends[0] || null, members };
}

function makeWorkflowRunEvent(session, runId, projection) {
  const { ordered, start, end, members } = projection;
  const stopReason = end?.event?.data?.stopReason || '';
  const status = stopReason === 'completed'
    ? 'success'
    : (stopReason === 'error' ? 'failed' : (stopReason === 'cancelled' ? 'cancelled' : 'incomplete'));
  const memberFacts = [...members.values()].map((member) => ({
    seq: member.start.event.data.seq,
    label: member.start.event.data.label,
    phase: member.start.event.data.phase,
    childId: member.start.event.data.childId,
    outcome: member.end?.event?.data?.outcome || 'incomplete',
  }));
  return makeLogicalEvent({
    id: `${session.id}:logical:workflow:${start.event.seq}`,
    timestamp: safeIso(start.event.time),
    turnId: '',
    kind: 'protocol',
    subtype: 'tool-workflow/run',
    layer: 'protocol',
    role: 'system',
    label: 'Workflow run',
    preview: truncatePreview(`Workflow ${start.event.data.name}: ${status}`),
    searchText: [
      'tool-workflow/run',
      `runId=${runId}`,
      `name=${start.event.data.name}`,
      `status=${status}`,
      ...memberFacts.flatMap((member) => [
        `member=${member.seq}`,
        `label=${member.label}`,
        member.phase === undefined ? '' : `phase=${member.phase}`,
        `childId=${member.childId}`,
        `outcome=${member.outcome}`,
      ]),
    ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: status === 'failed' ? 'error' : (status === 'success' ? 'normal' : 'warning'),
    status,
    rawRefs: ordered.map((row) => dshRawRef(row.raw)),
    channels: [...new Set(ordered.map((row) => row.event.type))],
  });
}

function projectWorkflowRuns(session, rows) {
  if (!rows.length) return;
  const groups = new Map();
  for (const row of rows) {
    const runId = safeString(row.event.data?.runId);
    if (!runId) {
      workflowFallback(session, row, 'missing runId');
      continue;
    }
    const group = groups.get(runId) || [];
    group.push(row);
    groups.set(runId, group);
  }
  for (const [runId, group] of groups) {
    const projection = validateWorkflowRows(group);
    if (projection.reason) {
      for (const row of group) workflowFallback(session, row, projection.reason);
      continue;
    }
    session.logicalEvents.push(makeWorkflowRunEvent(session, runId, projection));
  }
}

function retryFallback(session, row, reason) {
  session.logicalEvents.push(makeProtocolEvent(session.id, row.event, row.raw, row.event.type, {
    label: 'Uncorrelated LLM retry lifecycle',
    role: 'system',
    preview: `Uncorrelated ${row.event.type}: ${reason}`,
    searchText: `${row.event.type}\n${reason}\n${protocolSearchText(row.event.type, row.event.data)}`,
    severity: 'warning',
    status: 'incomplete',
  }));
}

function retryFailureFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.message !== 'string' || !value.message
      || typeof value.code !== 'string' || !value.code) return null;
  if (value.status !== undefined
      && (!Number.isInteger(value.status) || value.status < 100 || value.status > 599)) return null;
  if (value.providerRetryAfterMs !== undefined
      && (!Number.isFinite(value.providerRetryAfterMs) || value.providerRetryAfterMs <= 0)) return null;
  if (value.requestId !== undefined
      && (typeof value.requestId !== 'string' || !value.requestId)) return null;
  return {
    message: sanitizeLogicalDetailValue(value.message, { marker: '[data URL omitted]' }).slice(0, SEARCH_TEXT_LIMIT),
    code: sanitizeLogicalDetailValue(value.code, { marker: '[data URL omitted]' }).slice(0, 1000),
    ...(value.status === undefined ? {} : { status: value.status }),
    ...(value.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: value.providerRetryAfterMs }),
    ...(value.requestId === undefined ? {} : {
      requestId: sanitizeLogicalDetailValue(value.requestId, { marker: '[data URL omitted]' }).slice(0, 4000),
    }),
  };
}

function scheduledRetryFacts(row) {
  const data = row.event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const retryId = safeString(data.retryId);
  const provider = safeString(data.provider);
  const policyKey = safeString(data.policyKey);
  if (!retryId || !provider || !policyKey
      || !Number.isSafeInteger(data.turn) || data.turn < 1
      || !Number.isSafeInteger(data.step) || data.step < 1
      || !Number.isSafeInteger(data.retry) || data.retry < 1
      || !Number.isFinite(data.delayMs) || data.delayMs < 0 || data.delayMs > MAX_RETRY_DELAY_MS) return null;
  if (row.openTurn !== data.turn || row.openStep !== data.step || row.providerAtEvent !== provider) return null;
  if (data.mode === 'normal') {
    if (!Number.isSafeInteger(data.maxRetries) || data.maxRetries < 1 || data.retry > data.maxRetries) return null;
  } else if (data.mode === 'always') {
    if (Object.hasOwn(data, 'maxRetries')) return null;
  } else {
    return null;
  }
  const failure = retryFailureFacts(data.failure);
  if (!failure) return null;
  return {
    retryId,
    turn: data.turn,
    step: data.step,
    provider,
    mode: data.mode,
    policyKey,
    retry: data.retry,
    ...(data.mode === 'normal' ? { maxRetries: data.maxRetries } : {}),
    delayMs: data.delayMs,
    failure,
  };
}

function startedRetryFacts(row) {
  const data = row.event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const retryId = safeString(data.retryId);
  if (!retryId
      || !Number.isSafeInteger(data.turn) || data.turn < 1
      || !Number.isSafeInteger(data.step) || data.step < 1
      || !Number.isSafeInteger(data.retry) || data.retry < 1
      || row.openTurn !== data.turn || row.openStep !== data.step) return null;
  return {
    retryId,
    turn: data.turn,
    step: data.step,
    retry: data.retry,
    providerAtEvent: row.providerAtEvent,
  };
}

function validateRetryChain(rows) {
  const ordered = [...rows].sort((left, right) => left.event.seq - right.event.seq);
  const schedules = [];
  const starts = [];
  for (const row of ordered) {
    if (row.event.type === 'llm/retry') {
      const facts = scheduledRetryFacts(row);
      if (!facts) return { reason: 'invalid scheduled retry payload or open-step context' };
      schedules.push({ row, facts });
    } else if (row.event.type === 'llm/retry-started') {
      const facts = startedRetryFacts(row);
      if (!facts) return { reason: 'invalid retry-started payload or open-step context' };
      starts.push({ row, facts });
    }
  }
  if (!schedules.length) return { reason: 'retryId has no scheduled retry' };
  const first = schedules[0].facts;
  if (schedules.some(({ facts }, index) => (
    facts.turn !== first.turn
    || facts.step !== first.step
    || facts.provider !== first.provider
    || facts.mode !== first.mode
    || facts.policyKey !== first.policyKey
    || facts.retry !== index + 1
    || (facts.mode === 'normal' && facts.maxRetries !== first.maxRetries)
  ))) return { reason: 'retryId spans inconsistent provider-policy identity or numbering' };
  const attempts = [];
  for (const schedule of schedules) {
    const matching = starts.filter(({ facts }) => (
      facts.retry === schedule.facts.retry
      && facts.turn === schedule.facts.turn
      && facts.step === schedule.facts.step
      && facts.providerAtEvent === schedule.facts.provider
    ));
    if (matching.length > 1) return { reason: `retry ${schedule.facts.retry} repeats retry-started` };
    const started = matching[0] || null;
    if (started && started.row.event.seq < schedule.row.event.seq) {
      return { reason: `retry ${schedule.facts.retry} starts before it is scheduled` };
    }
    if (!started && schedule !== schedules.at(-1)) {
      return { reason: `retry ${schedule.facts.retry} lacks started evidence before a later retry` };
    }
    attempts.push({ schedule, started });
  }
  if (starts.length !== attempts.filter((attempt) => attempt.started).length) {
    return { reason: 'retry-started does not match one numbered scheduled retry' };
  }
  return { ordered, first, attempts };
}

function makeRetryLifecycleEvent(session, projection) {
  const { ordered, first, attempts } = projection;
  const latest = attempts.at(-1);
  const status = latest.started ? 'started' : 'scheduled';
  const maxText = first.mode === 'always' ? '∞' : String(first.maxRetries);
  const event = makeLogicalEvent({
    id: `${session.id}:logical:llm-retry:${attempts[0].schedule.row.event.seq}`,
    timestamp: safeIso(attempts[0].schedule.row.event.time),
    turnId: `turn:${first.turn}`,
    kind: 'protocol',
    subtype: 'llm/retry-lifecycle',
    layer: 'protocol',
    role: 'system',
    label: 'Model request retry',
    preview: truncatePreview(`Retry ${latest.schedule.facts.retry}/${maxText} ${status} after ${latest.schedule.facts.delayMs} ms · ${latest.schedule.facts.failure.code}`),
    searchText: attempts.flatMap(({ schedule, started }) => {
      const facts = schedule.facts;
      return [
        'llm/retry',
        `retryId=${facts.retryId}`,
        `provider=${facts.provider}`,
        `mode=${facts.mode}`,
        `policyKey=${facts.policyKey}`,
        `retry=${facts.retry}`,
        facts.mode === 'normal' ? `maxRetries=${facts.maxRetries}` : 'maxRetries=∞',
        `delayMs=${facts.delayMs}`,
        `failure.code=${facts.failure.code}`,
        facts.failure.message,
        started ? 'llm/retry-started' : 'retry-started=not observed',
      ];
    }).join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: 'warning',
    status,
    rawRefs: ordered.map((row) => dshRawRef(row.raw)),
    channels: [...new Set(ordered.map((row) => row.event.type))],
  });
  event.retryLifecycle = {
    retryId: first.retryId,
    turn: first.turn,
    step: first.step,
    provider: first.provider,
    mode: first.mode,
    policyKey: first.policyKey,
    attempts: attempts.map(({ schedule, started }) => ({
      retry: schedule.facts.retry,
      ...(schedule.facts.mode === 'normal' ? { maxRetries: schedule.facts.maxRetries } : {}),
      delayMs: schedule.facts.delayMs,
      failure: schedule.facts.failure,
      state: started ? 'started' : 'scheduled',
      scheduledSeq: schedule.row.event.seq,
      startedSeq: started?.row.event.seq ?? null,
    })),
  };
  return event;
}

function projectRetryLifecycles(session, rows) {
  if (!rows.length) return;
  const groups = new Map();
  const invalid = [];
  for (const row of rows) {
    const retryId = safeString(row.event.data?.retryId);
    if (!retryId) {
      invalid.push({ row, reason: 'missing retryId' });
      continue;
    }
    const group = groups.get(retryId) || [];
    group.push(row);
    groups.set(retryId, group);
  }
  for (const group of groups.values()) {
    const projection = validateRetryChain(group);
    if (projection.reason) {
      for (const row of group) invalid.push({ row, reason: projection.reason });
    } else {
      session.logicalEvents.push(makeRetryLifecycleEvent(session, projection));
    }
  }
  for (const { row, reason } of invalid.sort((left, right) => left.row.event.seq - right.row.event.seq)) {
    retryFallback(session, row, reason);
  }
}

function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasExactKeys(value, keys) {
  return isPlainRecord(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function decodeGoalRef(value) {
  if (!hasExactKeys(value, ['id', 'revision'])
      || typeof value.id !== 'string' || !value.id
      || !positiveSafeInteger(value.revision)) return null;
  return { id: value.id, revision: value.revision };
}

function decodeGoalBlockedReason(value) {
  if (!hasExactKeys(value, ['code', 'message'])
      || typeof value.code !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.code)
      || typeof value.message !== 'string' || !value.message.trim() || value.message !== value.message.trim()) return null;
  return { code: value.code, message: value.message };
}

function decodeGoalSnapshot(value) {
  if (!isPlainRecord(value)
      || typeof value.id !== 'string' || !value.id
      || !positiveSafeInteger(value.revision)
      || typeof value.objective !== 'string' || !value.objective.trim() || value.objective !== value.objective.trim()
      || !GOAL_PHASES.has(value.phase)
      || !positiveSafeInteger(value.maxGoalRounds)) return null;
  const expected = value.phase === 'blocked'
    ? ['blockedReason', 'id', 'maxGoalRounds', 'objective', 'phase', 'revision']
    : ['id', 'maxGoalRounds', 'objective', 'phase', 'revision'];
  if (!hasExactKeys(value, expected)) return null;
  const blockedReason = value.phase === 'blocked' ? decodeGoalBlockedReason(value.blockedReason) : null;
  if (value.phase === 'blocked' && !blockedReason) return null;
  return {
    id: value.id,
    revision: value.revision,
    objective: value.objective,
    phase: value.phase,
    maxGoalRounds: value.maxGoalRounds,
    ...(blockedReason ? { blockedReason } : {}),
  };
}

function decodeGoalChange(value) {
  if (!isPlainRecord(value) || value.kind !== 'goal/change' || value.version !== 1) return null;
  if (value.operation === 'clear') {
    if (!hasExactKeys(value, ['kind', 'version', 'operation', 'cleared', 'clearedAt'])
        || !nonNegativeSafeInteger(value.clearedAt)) return null;
    const cleared = decodeGoalRef(value.cleared);
    return cleared ? {
      kind: 'goal/change', version: 1, operation: 'clear', cleared, clearedAt: value.clearedAt,
    } : null;
  }
  if (!GOAL_SNAPSHOT_OPERATIONS.has(value.operation)
      || !hasExactKeys(value, ['kind', 'version', 'operation', 'goal', 'roundsStarted', 'createdAt', 'updatedAt'])
      || !nonNegativeSafeInteger(value.roundsStarted)
      || !nonNegativeSafeInteger(value.createdAt)
      || !nonNegativeSafeInteger(value.updatedAt)
      || value.updatedAt < value.createdAt) return null;
  const goal = decodeGoalSnapshot(value.goal);
  return goal ? {
    kind: 'goal/change',
    version: 1,
    operation: value.operation,
    goal,
    roundsStarted: value.roundsStarted,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  } : null;
}

function emptyGoalState() {
  return {
    goal: null,
    roundsStarted: 0,
    createdAt: null,
    updatedAt: null,
    lastRef: null,
    seenGoalIds: new Set(),
  };
}

function sameGoalDefinition(left, right) {
  return left.objective === right.objective && left.maxGoalRounds === right.maxGoalRounds;
}

function applyGoalChange(state, change) {
  if (change.operation === 'clear') {
    const current = state.goal;
    if (!current
        || change.cleared.id !== current.id
        || change.cleared.revision !== current.revision + 1
        || state.updatedAt === null
        || change.clearedAt < state.updatedAt) return 'clear does not advance the current Goal exactly';
    state.goal = null;
    state.roundsStarted = 0;
    state.createdAt = null;
    state.updatedAt = null;
    state.lastRef = { ...change.cleared };
    return '';
  }
  const next = change.goal;
  if (change.operation === 'create') {
    if (next.revision !== 1 || next.phase !== 'active' || change.roundsStarted !== 0
        || (state.goal && state.goal.phase !== 'complete') || state.seenGoalIds.has(next.id)) {
      return 'create is not a fresh active revision-one Goal with zero rounds';
    }
  } else {
    const current = state.goal;
    if (!current || next.id !== current.id || next.revision !== current.revision + 1) {
      return `${change.operation} does not advance the current Goal revision exactly`;
    }
    if (change.createdAt !== state.createdAt || state.updatedAt === null
        || change.updatedAt < state.updatedAt || change.roundsStarted !== state.roundsStarted) {
      return `${change.operation} does not preserve Goal counters and timestamps`;
    }
    if (change.operation === 'edit') {
      if (next.phase !== current.phase || !isDeepStrictEqual(next.blockedReason, current.blockedReason)) {
        return 'edit changes Goal phase or blocked reason';
      }
    } else if (change.operation === 'pause') {
      if (!sameGoalDefinition(current, next) || current.phase !== 'active' || next.phase !== 'paused') {
        return 'pause has an invalid Goal transition';
      }
    } else if (change.operation === 'resume') {
      if (!sameGoalDefinition(current, next)
          || !['active', 'paused', 'blocked'].includes(current.phase)
          || next.phase !== 'active' || state.roundsStarted >= next.maxGoalRounds) {
        return 'resume has an invalid Goal transition or exhausted round budget';
      }
    } else if (change.operation === 'complete') {
      if (!sameGoalDefinition(current, next) || current.phase === 'complete' || next.phase !== 'complete') {
        return 'complete has an invalid Goal transition';
      }
    } else if (change.operation === 'block') {
      if (!sameGoalDefinition(current, next) || current.phase !== 'active' || next.phase !== 'blocked') {
        return 'block has an invalid Goal transition';
      }
    }
  }
  if (change.operation === 'create') state.seenGoalIds.add(next.id);
  state.goal = structuredClone(next);
  state.roundsStarted = change.roundsStarted;
  state.createdAt = change.createdAt;
  state.updatedAt = change.updatedAt;
  state.lastRef = { id: next.id, revision: next.revision };
  return '';
}

function goalChangeFallback(session, row, reason) {
  session.logicalEvents.push(makeProtocolEvent(session.id, row.event, row.raw, 'goal/change', {
    label: 'Unmodeled Goal state change',
    role: 'system',
    preview: `Unmodeled goal/change: ${reason}`,
    searchText: `goal/change\n${reason}\n${protocolSearchText(row.event.type, row.event.data)}`,
    severity: 'warning',
    status: 'incomplete',
  }));
}

function makeGoalStateEvent(session, row, change) {
  const clear = change.operation === 'clear';
  const snapshot = clear ? change.cleared : change.goal;
  const phase = clear ? 'cleared' : change.goal.phase;
  const label = clear ? 'Goal cleared' : `Goal ${change.operation}`;
  const event = makeLogicalEvent({
    id: `${session.id}:logical:goal:${row.event.seq}`,
    timestamp: safeIso(row.event.time),
    turnId: turnIdFor(row.event),
    kind: 'goal',
    subtype: `goal/change:${change.operation}`,
    layer: 'main',
    role: 'system',
    label,
    preview: truncatePreview(clear
      ? `Goal cleared · revision ${snapshot.revision}`
      : `${change.goal.objective} · ${phase} · revision ${snapshot.revision}`),
    searchText: [
      'goal/change',
      `operation=${change.operation}`,
      `goalId=${snapshot.id}`,
      `revision=${snapshot.revision}`,
      clear ? '' : `phase=${phase}`,
      clear ? '' : change.goal.objective,
      clear ? '' : change.goal.blockedReason?.code,
      clear ? '' : change.goal.blockedReason?.message,
      boundedJsonText(change, SEARCH_TEXT_LIMIT),
    ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: phase === 'blocked' ? 'warning' : 'normal',
    status: phase,
    rawRefs: [dshRawRef(row.raw)],
    channels: ['goal/change'],
  });
  event.goalChange = structuredClone(change);
  return event;
}

function decodeGoalMessageSource(value) {
  if (!isPlainRecord(value) || value.kind !== 'goal'
      || typeof value.goalId !== 'string' || !value.goalId
      || !positiveSafeInteger(value.revision)
      || !positiveSafeInteger(value.round)) return null;
  return {
    kind: 'goal', goalId: value.goalId, revision: value.revision, round: value.round,
  };
}

function applyGoalContinuation(state, source) {
  const current = state.goal;
  if (!current || current.phase !== 'active'
      || source.goalId !== current.id || source.revision !== current.revision
      || source.round !== state.roundsStarted + 1 || source.round > current.maxGoalRounds) {
    return 'Goal continuation is not the next admitted round of the active Goal';
  }
  state.roundsStarted = source.round;
  return '';
}

function goalContinuationFallback(session, row, reason) {
  session.logicalEvents.push(makeProtocolEvent(session.id, row.event, row.raw, 'goal/continuation-invalid', {
    label: 'Uncorrelated Goal continuation',
    role: 'system',
    preview: `Uncorrelated Goal continuation: ${reason}`,
    searchText: `goal/continuation\n${reason}\n${protocolSearchText(row.event.type, row.event.data)}`,
    severity: 'warning',
    status: 'incomplete',
  }));
}

function makeGoalContinuationEvent(session, row, source) {
  const text = sanitizeLogicalDetailValue(visibleText(row.event.data?.content), {
    marker: '[data URL omitted]',
  }).slice(0, SEARCH_TEXT_LIMIT);
  const event = makeProtocolEvent(session.id, row.event, row.raw, 'goal/continuation', {
    label: 'Goal continuation context',
    role: 'system',
    preview: truncatePreview(text || `Goal continuation round ${source.round}`),
    searchText: [
      'goal/continuation',
      `goalId=${source.goalId}`,
      `revision=${source.revision}`,
      `round=${source.round}`,
      text,
    ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT),
  });
  event.goalContinuation = { ...source, text: text.slice(0, SEARCH_TEXT_LIMIT) };
  return event;
}

function projectGoalState(session, rows) {
  if (!rows.length) return;
  const state = emptyGoalState();
  for (const row of [...rows].sort((left, right) => left.event.seq - right.event.seq)) {
    if (row.event.type === 'goal/change') {
      const change = decodeGoalChange(row.event.data);
      if (!change) {
        goalChangeFallback(session, row, 'invalid Goal change payload');
        continue;
      }
      const reason = applyGoalChange(state, change);
      if (reason) {
        goalChangeFallback(session, row, reason);
        continue;
      }
      session.logicalEvents.push(makeGoalStateEvent(session, row, change));
    } else {
      const source = decodeGoalMessageSource(row.event.data?.source);
      if (!source) {
        goalContinuationFallback(session, row, 'invalid Goal message source');
        continue;
      }
      const reason = applyGoalContinuation(state, source);
      if (reason) {
        goalContinuationFallback(session, row, reason);
        continue;
      }
      session.logicalEvents.push(makeGoalContinuationEvent(session, row, source));
    }
  }
}

function decodeTodoSnapshot(value) {
  if (!hasExactKeys(value, ['todos']) || !Array.isArray(value.todos)) return null;
  const seen = new Set();
  const todos = [];
  for (const item of value.todos) {
    if (!hasExactKeys(item, ['content', 'status'])
        || typeof item.content !== 'string' || !item.content || item.content.trim() !== item.content
        || !['pending', 'in_progress', 'completed'].includes(item.status)
        || seen.has(item.content)) return null;
    seen.add(item.content);
    todos.push({ content: item.content, status: item.status });
  }
  return todos;
}

function todoFallback(session, row, reason) {
  session.logicalEvents.push(makeProtocolEvent(session.id, row.event, row.raw, 'todo/write', {
    label: 'Unmodeled Todo snapshot',
    role: 'system',
    preview: `Unmodeled todo/write: ${reason}`,
    searchText: `todo/write\n${reason}\n${protocolSearchText(row.event.type, row.event.data)}`,
    severity: 'warning',
    status: 'incomplete',
  }));
}

function todoStatusCounts(todos) {
  const counts = new Map();
  for (const todo of todos) counts.set(todo.status, (counts.get(todo.status) || 0) + 1);
  return counts;
}

function makeTodoSnapshotEvent(session, row, todos) {
  const counts = todoStatusCounts(todos);
  const summary = [
    `${todos.length} task${todos.length === 1 ? '' : 's'}`,
    ...['pending', 'in_progress', 'completed']
      .filter((status) => counts.has(status))
      .map((status) => `${counts.get(status)} ${status}`),
  ].join(' · ');
  const event = makeLogicalEvent({
    id: `${session.id}:logical:todo:${row.event.seq}`,
    timestamp: safeIso(row.event.time),
    turnId: turnIdFor(row.event),
    kind: 'plan_update',
    subtype: 'plan_update',
    layer: 'main',
    role: 'system',
    label: 'Todo list updated',
    preview: truncatePreview(summary),
    searchText: [
      'todo/write',
      summary,
      ...todos.flatMap((todo, index) => [
        `item=${index + 1}`,
        `status=${todo.status}`,
        todo.content,
      ]),
    ].join('\n').slice(0, SEARCH_TEXT_LIMIT),
    severity: 'normal',
    status: '',
    rawRefs: [dshRawRef(row.raw)],
    channels: ['todo/write'],
  });
  event.planSnapshot = todos.map((todo) => ({ step: todo.content, status: todo.status }));
  return event;
}

function projectTodoSnapshots(session, rows) {
  for (const row of rows) {
    const todos = decodeTodoSnapshot(row.event.data);
    if (!todos) {
      todoFallback(session, row, 'invalid whole-list Todo payload');
      continue;
    }
    session.logicalEvents.push(makeTodoSnapshotEvent(session, row, todos));
  }
}

function sortProjectedLogicalEventsByRawOrder(session) {
  const isStagedProjection = (event) => {
    if (event.kind === 'code_mode_operation') return true;
    const channels = Array.isArray(event.channels) ? event.channels : [];
    return channels.some((channel) => (
      channel === 'tool/code-dispatch-start'
      || channel === 'tool/code-dispatch'
      || TOOL_WORKFLOW_EVENT_TYPES.has(channel)
      || LLM_RETRY_EVENT_TYPES.has(channel)
      || channel === 'goal/change'
      || channel === 'todo/write'
      || event.subtype === 'goal/continuation'
      || event.subtype === 'goal/continuation-invalid'
    ));
  };
  const existing = session.logicalEvents.filter((event) => !isStagedProjection(event));
  const projected = session.logicalEvents
    .filter(isStagedProjection)
    .map((event, index) => ({
      event,
      index,
      ordinal: event.rawRefs?.[0]?.sourceLocator?.recordOrdinal ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.ordinal - right.ordinal || left.index - right.index);
  const existingEntries = [];
  let monotonicOrdinal = -1;
  for (const event of existing) {
    let emissionOrdinal = -1;
    for (const ref of event.rawRefs || []) {
      const ordinal = ref.sourceLocator?.recordOrdinal;
      if (Number.isSafeInteger(ordinal) && ordinal > emissionOrdinal) emissionOrdinal = ordinal;
    }
    if (emissionOrdinal < 0) emissionOrdinal = Number.MAX_SAFE_INTEGER;
    monotonicOrdinal = Math.max(monotonicOrdinal, emissionOrdinal);
    existingEntries.push({ event, ordinal: monotonicOrdinal });
  }
  const merged = [];
  let projectedIndex = 0;
  for (const existingEntry of existingEntries) {
    while (projectedIndex < projected.length
        && projected[projectedIndex].ordinal < existingEntry.ordinal) {
      merged.push(projected[projectedIndex].event);
      projectedIndex += 1;
    }
    merged.push(existingEntry.event);
  }
  while (projectedIndex < projected.length) {
    merged.push(projected[projectedIndex].event);
    projectedIndex += 1;
  }
  session.logicalEvents = merged;
}

function makeCompactionEvent(sessionId, compaction) {
  const rawRefs = [
    compaction.startRaw,
    compaction.summaryRaw,
    compaction.replacementRaw,
    compaction.endRaw,
  ].filter(Boolean).map(dshRawRef);
  const start = compaction.startEvent;
  const summary = compaction.summaryEvent;
  const end = compaction.endEvent;
  const error = typeof end?.data?.error === 'string' ? end.data.error : '';
  const summaryText = summary ? visibleText(summary.data?.summary) : '';
  const shadowedSeqs = Array.isArray(summary?.data?.shadowedSeqs)
    ? summary.data.shadowedSeqs
    : [];
  const shadowedTokenCount = Number.isFinite(summary?.data?.shadowedTokenCount)
    ? summary.data.shadowedTokenCount
    : null;
  const succeeded = Boolean(end && !error && summary && compaction.replacementRaw);
  const failed = Boolean(end && error);
  const status = failed ? 'failed' : (succeeded ? 'success' : 'incomplete');
  let preview;
  if (failed) {
    preview = truncatePreview(`Compaction failed: ${error}`);
  } else if (succeeded) {
    preview = truncatePreview(`Context compacted: ${shadowedSeqs.length} surface events replaced`
      + (Number.isSafeInteger(shadowedTokenCount) ? ` (${shadowedTokenCount} estimated tokens)` : ''));
  } else {
    preview = truncatePreview(`Compaction incomplete: ${compaction.compactionId}`);
  }
  const searchText = [
    preview,
    `compactionId=${compaction.compactionId}`,
    summaryText,
    summary?.data?.provider ? `provider=${summary.data.provider}` : '',
    summary?.data?.model ? `model=${summary.data.model}` : '',
    error ? `error=${error}` : '',
  ].filter(Boolean).join('\n').slice(0, SEARCH_TEXT_LIMIT);
  return makeLogicalEvent({
    id: `${sessionId}:logical:compaction:${start.seq}`,
    timestamp: safeIso(start.time),
    turnId: '',
    kind: 'compaction',
    subtype: 'compaction',
    layer: 'main',
    role: 'system',
    label: failed ? 'Compaction failed' : (succeeded ? 'Context compacted' : 'Compaction incomplete'),
    preview,
    searchText,
    severity: failed ? 'error' : 'warning',
    status,
    rawRefs,
    channels: [...new Set([
      start.type,
      ...(summary ? [summary.type] : []),
      ...(compaction.replacementEvent ? [compaction.replacementEvent.type] : []),
      ...(end ? [end.type] : []),
    ])],
  });
}

function resolveSeedBoundary(session, expectedSeq) {
  const headerLength = session._seedLength;
  if (headerLength !== null) {
    if (headerLength > expectedSeq) {
      throw storage.storageError(
        `corrupt session log: header seedLength ${headerLength} exceeds the committed event count ${expectedSeq}`,
      );
    }
    return headerLength;
  }
  // SessionHeader.seedLength is the only durable inherited-history ownership
  // boundary. session/end-seed marks one constructor's replay/fork/resume seed
  // ending and may occur (or recur) in an ordinary top-level Session.
  return null;
}

function seedSegmentForRaw(raw, boundary) {
  if (!raw || !Number.isSafeInteger(boundary)) return '';
  if (raw.rawIndex === 0) return 'fork_metadata';
  if (!Number.isSafeInteger(raw.seq0) || !Number.isSafeInteger(raw.seqEnd)) {
    throw storage.storageError('corrupt session log: seed boundary crosses a storage record without a seq range');
  }
  if (raw.seqEnd < boundary) return 'inherited_context';
  if (raw.seq0 >= boundary) return 'continuation';
  throw storage.storageError('corrupt session log: seed boundary crosses a packed storage record');
}

function inheritedContextForSession(session, boundary, inheritedEvents, inheritedRaws) {
  if (!inheritedRaws.length) return null;
  const mainEvents = inheritedEvents.filter((event) => event.layer !== 'protocol');
  const previewEvents = mainEvents.slice(-INHERITED_PREVIEW_LIMIT).map((event) => ({
    kind: event.kind,
    timestamp: event.timestamp,
    preview: event.preview,
  }));
  return {
    sourceSessionId: session.parentSessionId || `${SOURCE_KIND}:${session._sourceParentSessionId}`,
    seedLength: boundary,
    seedBoundarySeq: boundary,
    rawRecordCount: inheritedRaws.length,
    logicalEventCount: inheritedEvents.length,
    mainEventCount: mainEvents.length,
    protocolEventCount: inheritedEvents.length - mainEvents.length,
    previewEventCount: previewEvents.length,
    omittedPreviewEventCount: Math.max(0, mainEvents.length - previewEvents.length),
    startedAt: inheritedRaws[0]?.timestamp || '',
    updatedAt: inheritedRaws[inheritedRaws.length - 1]?.timestamp || '',
    forkPointRawId: inheritedRaws[inheritedRaws.length - 1]?.rawId || '',
    forkPointTarget: null,
    previewEvents,
  };
}

function applyDeepSeekSeedOwnership(session, boundary, expectedSeq) {
  if (boundary === null) {
    session._forkSegmentsByRawId.clear();
    return;
  }
  if (boundary > expectedSeq) {
    throw storage.storageError(
      `corrupt session log: seed boundary ${boundary} exceeds the committed event count ${expectedSeq}`,
    );
  }
  const segments = session._forkSegmentsByRawId;
  segments.clear();
  for (const raw of session.rawEvents) {
    const segment = seedSegmentForRaw(raw, boundary);
    raw.forkSegment = segment;
    segments.set(raw.rawId, segment);
  }
  const segmentByRawId = new Map(session.rawEvents.map((raw) => [raw.rawId, raw.forkSegment]));
  const ownedEvents = [];
  const inheritedEvents = [];
  for (const event of session.logicalEvents) {
    const eventSegments = new Set(
      (event.rawRefs || []).map((ref) => segmentByRawId.get(ref.rawId)).filter(Boolean),
    );
    if (eventSegments.size === 0) {
      ownedEvents.push(event);
      continue;
    }
    if (eventSegments.size > 1) {
      throw storage.storageError('corrupt session log: logical event crosses the seed boundary');
    }
    if (eventSegments.has('inherited_context')) inheritedEvents.push(event);
    else ownedEvents.push(event);
  }
  const inheritedRaws = session.rawEvents.filter((raw) => raw.forkSegment === 'inherited_context');
  const marker = session._seedMarkers.find((candidate) => candidate.seq === boundary) || null;
  session.logicalEvents = ownedEvents;
  session.forkStorageMode = 'materialized';
  session.forkEvidence = {
    sourceSessionId: session._sourceParentSessionId,
    parentSessionId: session.parentSessionId,
    origin: session._origin,
    delegationDepth: session.spawnDepth,
    seedLength: boundary,
    seedBoundarySeq: boundary,
    seedBoundaryRawId: marker?.rawId || '',
    seedBoundaryRecordOrdinal: marker?.recordOrdinal ?? null,
    inheritedRawRecordCount: inheritedRaws.length,
    inheritedLogicalEventCount: inheritedEvents.length,
  };
  session.inheritedContext = inheritedContextForSession(
    session,
    boundary,
    inheritedEvents,
    inheritedRaws,
  );
  return { inheritedEvents, inheritedRaws };
}

function chooseDeepSeekTitle(session, boundary) {
  const startSeq = Number.isSafeInteger(boundary) ? boundary : -1;
  const candidates = session._titleCandidates.filter((candidate) => candidate.seq >= startSeq);
  const title = candidates.length ? candidates[candidates.length - 1].title : '';
  if (title) return truncatePreview(title, TITLE_LIMIT);
  if (session._subagentDescriptor?.label) {
    return truncatePreview(session._subagentDescriptor.label, TITLE_LIMIT);
  }
  return '';
}

function applyDeepSeekLineage(session) {
  const descriptor = session._subagentDescriptor;
  if (session.primarySessionMetaKind === 'subagent') {
    const forked = descriptor?.provider === 'fork' || session._seedLength !== null;
    if (forked && session.parentSessionId) session.forkedFromSessionId = session.parentSessionId;
    session.derivedRelationship = {
      kind: 'subagent',
      ownerSessionId: session.parentSessionId,
      sourceParentSessionId: session._sourceParentSessionId,
      delegationDepth: session.spawnDepth,
      ...(descriptor ? { descriptor } : {}),
    };
    return;
  }
  // A normal parented fork keeps `forkedFromSessionId` from the header and
  // `parentSessionId` as lineage; neither fact classifies it as a subagent.
  session.derivedRelationship = null;
}

function deepSeekDerivedSessionKind(session) {
  if (session?.primarySessionMetaKind) return session.primarySessionMetaKind;
  return '';
}

function deepSeekRawForkSegment(session, rawId) {
  return session?._forkSegmentsByRawId?.get(rawId) || '';
}


async function parseSessionArtifact(filePath, relFile, repoRoot, signal, options = {}) {
  const compression = options.compression || storage.compressionForArtifact(filePath);
  const acceptedSnapshot = options.acceptedSnapshot || null;
  const committedRead = await storage.readCommittedArtifactPrefix(
    filePath,
    compression,
    signal,
    acceptedSnapshot,
  );
  const prefix = committedRead.prefix;
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
  session._sourceIdentity = committedRead.fileIdentity;
  session._committedPrefixDigest = storage.hashBuffer(
    committedRead.buffer.subarray(0, prefix.committedBytes),
  );
  session._compression = compression;
  session._torn = prefix.torn === true;
  const rawHeader = makeRawEvent({ ...header, type: 'session' }, 0, relFile, session.id);
  rawHeader.sourceLocator.sessionId = session.id;
  session.rawEvents.push(rawHeader);
  let expectedSeq = 0;
  let lastTime = header.createdAt;
  let currentStep = null;
  const pendingToolCalls = new Map();
  const toolCallsById = new Map();
  const codeDispatchRows = [];
  const workflowRows = [];
  const retryRows = [];
  const goalRows = [];
  const todoRows = [];
  const pruneRows = [];
  const replacementToolResultRows = [];
  const originalToolResultsBySeq = new Map();
  const pendingCompactions = new Map();
  let pendingPartialEvent = null;
  let effectiveRequestProvider = '';
  const childOwnedStartSeq = session._seedLength ?? 0;
  const observedPermissionState = { preset: null, sandboxMode: null, approvalPolicy: null };
  const inboxReplay = createInboxReplay();

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

  const flushPendingCompaction = (compaction) => {
    if (!compaction) return null;
    const logical = makeCompactionEvent(session.id, compaction);
    session.logicalEvents.push(logical);
    return logical;
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
    // Indexing/materialization keeps packed rows packed: it reads seq/member
    // facts directly from the physical row and never calls the lossless
    // per-member decoder.
    const packed = storage.decodePackedStorageRecordFacts(record);
    const raw = makeRawEvent(record, index, relFile, session.id);
    raw.sourceLocator.sessionId = session.id;
    session.rawEvents.push(raw);
    if (packed) {
      if (packed.seq0 !== expectedSeq) {
        throw storage.storageError(
          `corrupt session log: seq gap at record ${index} (expected ${expectedSeq}, got ${packed.seq0})`,
        );
      }
      expectedSeq = packed.seqEnd + 1;
      lastTime = packed.finalTime || lastTime;
      const step = stepStateFor(packed.turn, packed.step);
      if (step) {
        step.chunkRows.push(raw);
        appendPackedRowToStep(step, record);
      }
      continue;
    }

    const event = record;
    if (!Number.isSafeInteger(event.seq) || event.seq !== expectedSeq) {
      throw storage.storageError(
        `corrupt session log: seq gap at record ${index} (expected ${expectedSeq}, got ${event.seq})`,
      );
    }
    expectedSeq += 1;
    lastTime = eventTime(event) || lastTime;
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
      if (step && isAppendSurfaceOp(event.surfaceOp)) {
        step.sawAssistantMessage = true;
        if (step.partialEvent) {
          step.partialEvent = null;
          step.chunkRows = [];
          step.blockText.clear();
        }
      }
      if (isAppendSurfaceOp(event.surfaceOp)) {
        const reasoning = reasoningText(event.data?.message?.content || []).trim();
        if (reasoning) session.logicalEvents.push(makeReasoningEvent(session.id, event, raw));
        session.logicalEvents.push(makeAssistantMessageEvent(session.id, event, raw));
      }
    } else if (event.type === 'user/message') {
      if (data.source?.kind === 'goal') {
        goalRows.push({ event, raw });
      } else if (isReplaceSurfaceOp(event.surfaceOp)) {
        const range = replaceSurfaceRange(event.surfaceOp);
        // Upstream replacement/user pairing is the immediately preceding
        // `compaction/summary` plus the shared surface-op range; the compact
        // plugin's replacement carries source.kind "plugin". Pair with the
        // newest pending lifecycle that has a summary and no replacement yet.
        const compaction = [...pendingCompactions.values()].reverse().find((candidate) => (
          candidate.summaryRaw && !candidate.replacementRaw
        )) || null;
        if (compaction && !compaction.replacementRaw && range) {
          compaction.replacementRaw = raw;
          compaction.replacementEvent = event;
        } else {
          session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, 'user/message', {
            label: 'Surface replacement user message',
            role: 'system',
            preview: truncatePreview(visibleText(data.content) || 'Surface replacement user message'),
          }));
        }
      } else if (data.source?.kind === 'user' && isAppendSurfaceOp(event.surfaceOp)) {
        // Human transcript follows append-origin evidence. A compaction
        // replacement user/message is model-only surface material and must
        // not become a Main human message.
        const logical = makeUserEvent(session.id, event, raw, 'user_message', 'user_message');
        attachInboxProvenance(logical, event, inboxReplay);
        session.logicalEvents.push(logical);
      } else if (data.source?.kind === 'user') {
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, 'user/message', {
          label: 'Surface replacement user message',
          role: 'system',
          preview: truncatePreview(visibleText(data.content) || 'Surface replacement user message'),
        }));
      } else {
        const plugin = typeof data.source?.plugin === 'string' ? data.source.plugin : '';
        const logical = makeProtocolEvent(session.id, event, raw, 'user/message', {
          label: plugin || 'Runtime context',
          role: 'system',
          preview: truncatePreview(visibleText(data.content) || 'Runtime context'),
        });
        attachInboxProvenance(logical, event, inboxReplay);
        session.logicalEvents.push(logical);
      }
    } else if (event.type === 'tool/call') {
      const call = {
        callId: data.callId,
        name: data.name,
        arguments: data.arguments,
        turn: data.turn,
        step: data.step,
        time: event.time,
        eventSeq: event.seq,
        raw,
      };
      pendingToolCalls.set(data.callId, call);
      if (typeof data.callId === 'string' && data.callId) {
        // A durable dispatch root must resolve to exactly one outer call. Keep
        // ordinary tool pairing behavior unchanged, but make duplicate root
        // identity permanently ambiguous for the Phase 2B topology projector.
        toolCallsById.set(data.callId, toolCallsById.has(data.callId) ? null : call);
      }
    } else if (event.type === 'tool/result') {
      if (!isAppendSurfaceOp(event.surfaceOp)) {
        const logical = makeProtocolEvent(session.id, event, raw, 'tool/result', {
          label: 'Surface replacement tool result',
          role: 'system',
          preview: truncatePreview(toolResultText(event) || 'Surface replacement tool result'),
        });
        session.logicalEvents.push(logical);
        replacementToolResultRows.push({ event, raw, logical });
        continue;
      }
      const callId = toolResultCallId(event);
      const pending = pendingToolCalls.get(callId);
      if (pending) {
        pendingToolCalls.delete(callId);
        const logical = addPendingToolResult(session, pending, raw, event);
        originalToolResultsBySeq.set(event.seq, {
          event,
          raw,
          logical,
          call: pending,
        });
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
    } else if (event.type === 'goal/change') {
      goalRows.push({ event, raw });
    } else if (event.type === 'todo/write') {
      todoRows.push({ event, raw });
    } else if (PERMISSION_EVENT_TYPES.has(event.type)) {
      session.logicalEvents.push(event.seq < childOwnedStartSeq
        ? makeProtocolEvent(session.id, event, raw, event.type, { role: 'system' })
        : makePermissionProtocolEvent(session.id, event, raw, observedPermissionState));
    } else if (event.type === 'agent/inbox/spliced') {
      session.logicalEvents.push(event.seq < childOwnedStartSeq
        ? makeProtocolEvent(session.id, event, raw, event.type, { role: 'system' })
        : makeInboxProtocolEvent(session.id, event, raw, inboxReplay));
    } else if (event.type === 'request/header') {
      const provider = data.header?.config?.provider;
      effectiveRequestProvider = typeof provider === 'string' && provider ? provider : '';
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type));
    } else if (event.type === 'llm/retry' || event.type === 'llm/retry-started') {
      retryRows.push({
        event,
        raw,
        openTurn: currentStep?.turn ?? null,
        openStep: currentStep?.step ?? null,
        providerAtEvent: effectiveRequestProvider,
      });
    } else if (event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch') {
      codeDispatchRows.push({ event, raw });
    } else if (TOOL_WORKFLOW_EVENT_TYPES.has(event.type)) {
      workflowRows.push({ event, raw });
    } else if (event.type === 'session/title') {
      if (typeof data.title === 'string' && data.title.trim()) {
        session._titleCandidates.push({ seq: event.seq, title: data.title.trim() });
      }
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Session title',
      }));
    } else if (event.type === 'agent-preset/selected') {
      const selected = typeof data.agentPreset === 'string' && data.agentPreset.trim()
        ? data.agentPreset.trim()
        : '';
      if (selected) {
        session._agentPresetSelections.push({ seq: event.seq, agentPreset: selected, rawId: raw.rawId });
        session._effectiveAgentPreset = selected;
        session.agentNickname = selected;
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
          label: 'Agent preset selected',
          role: 'system',
          preview: `Agent preset selected: ${selected}`,
          searchText: `agent-preset/selected\nagentPreset=${selected}\nseq=${event.seq}`,
        }));
      } else {
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
          label: 'Agent preset selected',
          role: 'system',
          preview: 'Agent preset selected (invalid payload)',
          severity: 'warning',
        }));
      }
    } else if (event.type === 'subagent/descriptor') {
      const descriptor = parseSubagentDescriptorData(data);
      if (descriptor) session._subagentDescriptor = descriptor;
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: descriptor ? 'Subagent descriptor' : 'Subagent descriptor (unsupported version)',
        role: 'system',
        preview: descriptor
          ? descriptorPreview(descriptor)
          : truncatePreview('Subagent descriptor: unsupported or invalid version'),
        searchText: descriptor ? descriptorSearchText(descriptor) : protocolSearchText(event.type, data),
        severity: descriptor ? 'normal' : 'warning',
      }));
    } else if (event.type === 'session/end-seed') {
      const marker = {
        seq: event.seq,
        rawId: raw.rawId,
        recordOrdinal: raw.sourceLocator?.recordOrdinal ?? raw.rawIndex,
      };
      session._seedMarkers.push(marker);
      session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Session constructor seed ended',
        role: 'system',
        preview: `Session constructor seed ended at seq ${event.seq}`,
        searchText: `session/end-seed\nseq=${event.seq}\nSession constructor seed lifecycle boundary`,
      }));
    } else if (event.type === 'compaction/start') {
      const compactionId = typeof data.compactionId === 'string' && data.compactionId.trim()
        ? data.compactionId.trim()
        : '';
      if (compactionId) {
        const previous = pendingCompactions.get(compactionId);
        if (previous) {
          flushPendingCompaction(previous);
          pendingCompactions.delete(compactionId);
        }
        pendingCompactions.set(compactionId, {
          compactionId,
          startRaw: raw,
          startEvent: event,
          summaryRaw: null,
          summaryEvent: null,
          replacementRaw: null,
          replacementEvent: null,
          endRaw: null,
          endEvent: null,
        });
      } else {
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
          label: 'Compaction started',
          role: 'system',
        }));
      }
    } else if (event.type === 'compaction/summary') {
      const compactionId = typeof data.compactionId === 'string' && data.compactionId.trim()
        ? data.compactionId.trim()
        : '';
      const pending = compactionId ? pendingCompactions.get(compactionId) : null;
      if (pending && !pending.summaryRaw) {
        pending.summaryRaw = raw;
        pending.summaryEvent = event;
      } else {
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
          label: 'Compaction summary',
          role: 'system',
        }));
      }
    } else if (event.type === 'compaction/end') {
      const compactionId = typeof data.compactionId === 'string' && data.compactionId.trim()
        ? data.compactionId.trim()
        : '';
      const pending = compactionId ? pendingCompactions.get(compactionId) : null;
      if (pending && !pending.endRaw) {
        pending.endRaw = raw;
        pending.endEvent = event;
        flushPendingCompaction(pending);
        pendingCompactions.delete(compactionId);
      } else {
        session.logicalEvents.push(makeProtocolEvent(session.id, event, raw, event.type, {
          label: 'Compaction ended',
          role: 'system',
        }));
      }
    } else if (event.type === 'compaction/prune') {
      const logical = makeProtocolEvent(session.id, event, raw, event.type, {
        label: 'Tool-result prune',
        role: 'system',
      });
      session.logicalEvents.push(logical);
      pruneRows.push({ event, raw, logical });
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
  for (const pending of pendingCompactions.values()) {
    flushPendingCompaction(pending);
  }
  applyDeepSeekLineage(session);
  const seedBoundary = resolveSeedBoundary(session, expectedSeq);
  // Only calls that belong to the child continuation may become child-owned
  // incomplete operations. An inherited open call would be parent history.
  for (const call of pendingToolCalls.values()) {
    if (seedBoundary === null || call.eventSeq >= seedBoundary) {
      makeIncompleteToolEvent(session, call);
    }
  }
  projectCodeDispatches(session, codeDispatchRows, toolCallsById);
  projectWorkflowRuns(session, workflowRows);
  projectRetryLifecycles(session, retryRows);
  projectGoalState(session, goalRows);
  projectTodoSnapshots(session, todoRows);
  sortProjectedLogicalEventsByRawOrder(session);
  applyDeepSeekSeedOwnership(session, seedBoundary, expectedSeq);
  projectToolResultPrunes(
    session,
    pruneRows,
    replacementToolResultRows,
    originalToolResultsBySeq,
    toolCallsById,
    seedBoundary,
  );
  session.title = chooseDeepSeekTitle(session, seedBoundary);
  session.updatedAt = safeIso(lastTime) || session.startedAt;
  session._lastEventTime = lastTime;
  return finalizeSession(session, repoRoot);
}

function indexedSourceStaleError() {
  return storage.indexedSourceStaleError();
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
  const matchFields = { main: new Map(), protocol: new Map(), raw: new Map() };
  for (const event of session.logicalEvents) {
    const layer = event.layer === 'protocol' ? 'protocol' : 'main';
    const value = layer === 'protocol' ? (event.subtype || event.kind) : event.kind;
    if (value) counts[layer].set(value, (counts[layer].get(value) || 0) + 1);
    if (layer === 'main' && event.kind === 'code_mode_operation') {
      counts.main.set(
        CODE_MODE_SCRIPT_OPERATION_KIND,
        (counts.main.get(CODE_MODE_SCRIPT_OPERATION_KIND) || 0) + 1,
      );
      matchFields.main.set(CODE_MODE_SCRIPT_OPERATION_KIND, 'presentation_fallback');
    }
  }
  for (const raw of session.rawEvents) {
    const value = raw.payloadType || raw.recordType;
    if (value) counts.raw.set(value, (counts.raw.get(value) || 0) + 1);
  }
  const optionsFor = (map, labelFn, fields = new Map()) => [...map.entries()]
    .sort((a, b) => labelFn(a[0]).localeCompare(labelFn(b[0])) || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({
      value,
      label: labelFn(value),
      count,
      ...(fields.has(value) ? { matchField: fields.get(value) } : {}),
    }));
  return {
    main: optionsFor(counts.main, (value) => i18n.eventKindLabel(value, i18n.DEFAULT_LOCALE), matchFields.main),
    protocol: optionsFor(counts.protocol, (value) => i18n.eventKindLabel(value, i18n.DEFAULT_LOCALE)),
    raw: optionsFor(counts.raw, (value) => i18n.rawRecordLabel(value, i18n.DEFAULT_LOCALE)),
  };
}

function createCatalogAccumulator() {
  const counts = { main: new Map(), protocol: new Map(), raw: new Map() };
  const matchFields = { main: new Map(), protocol: new Map(), raw: new Map() };
  return {
    addSession(session) {
      const catalog = eventKindCatalogForSession(session);
      for (const layer of ['main', 'protocol', 'raw']) {
        for (const item of catalog[layer]) {
          counts[layer].set(item.value, (counts[layer].get(item.value) || 0) + item.count);
          if (item.matchField) matchFields[layer].set(item.value, item.matchField);
        }
      }
    },
    finish() {
      return {
        main: [...counts.main.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, count]) => ({
            value,
            label: i18n.eventKindLabel(value, i18n.DEFAULT_LOCALE),
            count,
            ...(matchFields.main.has(value) ? { matchField: matchFields.main.get(value) } : {}),
          })),
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
    forkEvidence: session.forkEvidence === null ? null : structuredClone(session.forkEvidence),
    inheritedContext: session.inheritedContext === null ? null : structuredClone(session.inheritedContext),
    summary: structuredClone(summary),
  };
  if (Object.hasOwn(session, 'derivedRelationship')) {
    projected.derivedRelationship = session.derivedRelationship === null
      ? null
      : structuredClone(session.derivedRelationship);
  }
  if (Object.hasOwn(session, 'subagentToolUseId')) projected.subagentToolUseId = session.subagentToolUseId;
  if (Object.hasOwn(session, 'spawnDepth')) projected.spawnDepth = session.spawnDepth;
  return projected;
}

function buildMaterializationState(session, dependencySet, descriptorPayload) {
  const dependencyId = storage.dependencySetId(dependencySet.entries);
  dependencySet.id = dependencyId;
  const sourceSnapshotId = storage.materializationSnapshotId(
    dependencySet,
    descriptorPayload,
  );
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
    presentationForEvent: deepSeekProjectQueryPresentation,
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
    ...(session.forkStorageMode === 'materialized' && session._forkSegmentsByRawId instanceof Map
      ? { _forkSegmentsByRawId: session._forkSegmentsByRawId }
      : {}),
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
  const expectedDependencySetId = storage.dependencySetId(dependencySet.entries);
  if (dependencySet.id !== expectedDependencySetId
      || descriptor.dependencySetId !== expectedDependencySetId) {
    throw new Error('DeepSeek dependency identity is invalid');
  }
  const expectedSnapshotId = storage.materializationSnapshotId(
    dependencySet,
    descriptor.payload,
  );
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

function validateDeepSeekMaterializedPrivateState({ indexedSession, session }) {
  const segments = session._forkSegmentsByRawId;
  if (indexedSession.forkStorageMode !== 'materialized') {
    if (segments !== undefined) {
      throw new Error('Ordinary DeepSeek Session must not retain fork segments');
    }
    return;
  }
  if (!(segments instanceof Map) || segments.size !== session.rawEvents.length) {
    throw new Error('Materialized DeepSeek fork segments must cover every Raw Record');
  }
  for (const raw of session.rawEvents) {
    const segment = segments.get(raw.rawId);
    if (!DSH_FORK_SEGMENTS.includes(segment) || raw.forkSegment !== segment) {
      throw new Error('Materialized DeepSeek fork segment ownership is invalid');
    }
  }
}

async function buildDeepSeekEventDetailForSession(index, session, eventId, layer, options = {}) {
  return buildDeepSeekEventDetail(index, session, eventId, layer, options);
}

function materializationTargetForSession(index, session) {
  return storage.materializationEvidenceForSession(index, session);
}

async function readDeepSeekRawRecord(index, session, raw, options = {}) {
  const targetState = materializationTargetForSession(index, session);
  if (!targetState) return null;
  const ordinal = Number.isSafeInteger(raw?.sourceLocator?.recordOrdinal)
    ? raw.sourceLocator.recordOrdinal
    : Number.isSafeInteger(raw?.rawIndex) ? raw.rawIndex : -1;
  if (ordinal < 0) return null;
  const result = await storage.readPhysicalRecordText(
    targetState.target,
    targetState.compression,
    ordinal,
    options.signal,
    targetState.acceptedSnapshot,
  );
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

function deepSeekCodeModeScriptOperation(event) {
  return event?.layer === 'main' && event.kind === 'code_mode_operation';
}

function deepSeekProjectQueryPresentation(_session, event) {
  return {
    scriptOperation: deepSeekCodeModeScriptOperation(event),
    declaredRequestNames: [],
    requestEvidence: '',
  };
}

const deepSeekQuery = createSessionQuery({
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  rawRef: dshRawRef,
  derivedSessionKind: deepSeekDerivedSessionKind,
  eventKindCatalog(sessions) {
    const catalog = createCatalogAccumulator();
    for (const session of sessions || []) catalog.addSession(session);
    return catalog.finish();
  },
  presentation: {
    normalizeFilters(filters) {
      const normalized = { ...filters };
      const sourcePresentation = { ...(normalized.sourcePresentation || {}) };
      if (normalized.kind === CODE_MODE_SCRIPT_OPERATION_KIND) {
        normalized.kind = '';
        sourcePresentation.scriptOperation = true;
      }
      normalized.sourcePresentation = sourcePresentation;
      return normalized;
    },
    matchesEvent(event, filters) {
      return !filters.sourcePresentation?.scriptOperation || deepSeekCodeModeScriptOperation(event);
    },
    hasActiveFilter(filters) {
      return filters.sourcePresentation?.scriptOperation === true;
    },
    contextMap: codeModePresentationContextMap,
    projectRowFacts: deepSeekProjectQueryPresentation,
    matchesProjectRow(presentationFact, filters) {
      return !filters.sourcePresentation?.scriptOperation || presentationFact?.scriptOperation === true;
    },
    rawForkSegment: deepSeekRawForkSegment,
  },
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
  materializedPrivateFields: ['_forkSegmentsByRawId'],
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
