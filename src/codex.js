'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { Readable } = require('node:stream');
const { isDeepStrictEqual } = require('node:util');
const crypto = require('node:crypto');
const MarkdownIt = require('markdown-it');
const { SHELL_EXTERNAL_COMMAND_WORDS } = require('./shared/command-highlighting');
const {
  DATA_URL_MARKER: TOOL_DATA_URL_MARKER,
  redactEmbeddedBase64DataUrls,
  redactEmbeddedDataUrls,
  sanitizeLogicalDetailValue: sanitizeToolValue,
  uniqueSanitizedObjectKey,
} = require('./shared/logical-detail-sanitizer');
const agentCoordination = require('./shared/agent-coordination');
const codeModeTools = require('./shared/code-mode-tools');
const codeModePresentationContract = require('./shared/code-mode-presentation-contract');
const planFacet = require('./shared/plan-facet');
const toolLifecycleContract = require('./codex-tool-lifecycle-contract');
const i18n = require('./shared/i18n');
const fsPath = require('./shared/fs-path');
const {
  codeModeAssociableOutputFragments,
  codeModeDisplayOutputText,
  codeModeOutputText,
  projectCodeModeOperations,
} = require('./codex-code-mode');
const { projectDeclaredCodeModeCalls } = require('./codex-code-mode-declared');
const {
  buildCodeModePresentationIndexes,
  CODE_MODE_SCRIPT_OPERATION_KIND,
  codeModePresentationFactsForEvent,
  codeModeRequestMatches,
  codeModeExecSource,
  codeModeRequestCatalog,
  isCodeModeScriptOperation,
  normalizeCodeModeRequest,
} = require('./codex-code-mode-presentation');
const { stripAnsiSequences } = require('./shared/terminal-text');
const { deriveCodeModeFacts } = require('./codex-code-mode-facts');
const { codeModePresentationContextMap } = require('./codex-presentation-context');
const { createCodexDetailBuilder } = require('./codex-detail');
const {
  validateCanonicalLegacyRawOwnerIndex,
  validateCanonicalRawEventShape,
} = require('./canonical-contract');
const {
  goalResponseFromValue,
  goalSnapshotFromGoal,
  goalSnapshotFromRaw,
  goalSnapshotSignature,
  goalSnapshotTransition,
  normalizeGoalStatus,
} = require('./codex-goal');
const { createCodexLogicalBuilder } = require('./codex-logical');
const { createCodexSearch } = require('./codex-search');
const { createProjectQueryStoreBuilder } = require('./project-query-store');
const {
  canonicalRawRecordDigest,
  hasCanonicalRawDigests,
  inferCodexMaterializedForks,
  inferEarlierBranches,
  materializedForkInheritedContext,
  rawForkSegment,
} = require('./codex-forks');
const { appendReviewLifecycleMarker, reviewLifecycleFromRaw } = require('./review-lifecycle');
const {
  CANONICAL_SCHEMA_VERSION,
  CODEX_SOURCE_KIND,
  codexSourceLocator,
  createCodexRawParser,
  rawEventsForLogicalEvent,
  rawMatchesEvent,
  rawRef,
  subAgentActivityEventId,
} = require('./codex-source');

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const SECTION_TYPES = new Set(['markdown', 'code', 'terminal', 'json', 'diff', 'patch', 'kv', 'notice', 'raw_json', 'token_usage', 'usage_limits', 'user_input', 'plan_update', 'collaboration', 'image_preview', 'event_refs', 'code_mode_trace', 'code_mode_tool_projection', 'code_mode_source', 'web_request']);
const TIMELINE_DATA_URL_MARKER = '[data URL omitted]';
const EMBEDDED_IMAGE_EXTERNALIZED_MARKER = '[embedded image payload externalized; open raw refs for source]';
const IMAGE_PREVIEW_LIMIT = 8;
const IMAGE_PREVIEW_MAX_ENCODED_CHARS = 16 * 1024 * 1024;
const IMAGE_PREVIEW_MAX_DECODED_BYTES = 12 * 1024 * 1024;
const SESSION_TITLE_LIMIT = 120;
const SUBAGENT_SESSION_TITLE_LIMIT = 160;
const REASONING_TEXT_LIMIT = 16000;
const TRUNCATE_NATIVE_THRESHOLD = 1000;
const RESET_TIME_CACHE_LIMIT = 512;
const CODE_MODE_STRUCTURED_RESULT_MAX_CHARS = 32_000;
const CODE_MODE_STRUCTURED_RESULT_MAX_DEPTH = 32;
const CODE_MODE_STRUCTURED_RESULT_MAX_NODES = 1_000;
const CODEX_COMPACT_SESSION_REPRESENTATION = 'codex-compact-v1';
const CODEX_MATERIALIZATION_SCHEMA_VERSION = 1;
const CODEX_MATERIALIZED_SHELL_MAX_BYTES = 4 * 1024;
const CODEX_MATERIALIZATION_PRIVATE_FIELDS = Object.freeze(['_forkSegmentsByRawId', '_shell']);
const CODEX_RELATIONSHIP_FIELDS = Object.freeze([
  'parentSessionId',
  'parentSessionInferred',
  'forkedFromSessionId',
  'forkStorageMode',
  'forkedAt',
  'forkPointUuid',
  'forkContinuationState',
  'forkEvidence',
  'inheritedContext',
  'supersededBySessionId',
  'supersededAt',
  'supersededReason',
]);
const CODEX_FORK_SEGMENTS = Object.freeze([
  'fork_metadata',
  'inherited_context',
  'continuation',
]);
const CODEX_SOURCE_HYDRATION_CONCURRENCY = 2;
const CODEX_HYDRATION_SLOT_OWNED = Symbol('codexHydrationSlotOwned');
const CODEX_FORK_RAW_FACT = Object.freeze({
  RAW_ID: 0,
  TIMESTAMP: 1,
  RECORD_TYPE: 2,
  PAYLOAD_TYPE: 3,
  ROLE: 4,
  SESSION_META_ID: 5,
  REVIEW_PHASE: 6,
  REVIEW_THREAD_ID: 7,
});
const CODEX_FORK_LOGICAL_RANGE = Object.freeze({
  START_RAW_ORDINAL: 0,
  END_RAW_ORDINAL: 1,
  PROTOCOL: 2,
});

const SAME_DAY_RESET_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});
const FULL_RESET_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const resetTimeCache = new Map();
const codexHydrationCoordinators = new WeakMap();

let markdownRenderer = null;
let gb18030ReverseMap = null;

function fsPathFlavor(input) {
  return fsPath.fsPathFlavor(input);
}

function fsPathApi(input) {
  return fsPath.fsPathApi(input);
}

function resolveFsPath(input) {
  return fsPath.resolveFsPath(input);
}

function normalizeFsPath(input) {
  return fsPath.normalizeFsPath(input);
}

function createCodexLegacyRawOwnerIndexBuilder() {
  const sessionIds = [];
  const sessionIndexes = new Map();
  const files = {};
  let entryCount = 0;
  let finished = false;

  const addSession = (session) => {
    if (finished) throw new Error('Codex legacy Raw owner builder is already finished');
    const sessionId = String(session?.id || '');
    if (!sessionId) return;
    let sessionIndex = sessionIndexes.get(sessionId);
    if (sessionIndex === undefined) {
      sessionIndex = sessionIds.length;
      sessionIndexes.set(sessionId, sessionIndex);
      sessionIds.push(sessionId);
    }
    const seenSessionOwners = new Set();
    for (const raw of session.rawEvents || []) {
      const file = normalizeFsPath(raw?.source?.file || '');
      const line = raw?.source?.line;
      const rawId = String(raw?.rawId || '');
      if (!file || !Number.isSafeInteger(line) || line < 1 || !rawId) continue;
      const ownerKey = `${file}\u0000${line}`;
      if (seenSessionOwners.has(ownerKey)) continue;
      seenSessionOwners.add(ownerKey);
      if (!Object.hasOwn(files, file)) files[file] = {};
      const lineKey = String(line);
      if (Object.hasOwn(files[file], lineKey)) {
        if (files[file][lineKey] !== '') {
          files[file][lineKey] = '';
          entryCount -= 1;
        }
        continue;
      }
      files[file][lineKey] = `${sessionIndex}:${rawId}`;
      entryCount += 1;
    }
  };

  const finish = () => {
    if (finished) throw new Error('Codex legacy Raw owner builder is already finished');
    finished = true;
    const payload = { sessionIds, files };
    const legacyRawOwners = {
      schemaVersion: 1,
      sourceKind: CODEX_SOURCE_KIND,
      entryCount,
      accountedBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      payload,
    };
    validateCanonicalLegacyRawOwnerIndex(legacyRawOwners, CODEX_SOURCE_KIND);
    return legacyRawOwners;
  };

  return Object.freeze({ addSession, finish });
}

function buildCodexLegacyRawOwnerIndex(sessions) {
  const builder = createCodexLegacyRawOwnerIndexBuilder();
  for (const session of sessions || []) builder.addSession(session);
  return builder.finish();
}

function isPathInsideOrSame(child, parent) {
  return fsPath.isPathInsideOrSame(child, parent);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Indexing cancelled');
  error.name = 'AbortError';
  throw error;
}

function emitProgress(onProgress, progress) {
  if (typeof onProgress === 'function') onProgress(progress);
}

function normalizeSearchPath(input) {
  return String(input || '').replace(/\\/g, '/').toLowerCase();
}

function displayProjectFile(file, repoRoot) {
  const text = String(file || '').trim();
  if (!text) return '';
  const pathApi = fsPathApi(text);
  if (pathApi.isAbsolute(text)
      && repoRoot
      && fsPathFlavor(text) === fsPathFlavor(repoRoot)
      && isPathInsideOrSame(text, repoRoot)) {
    return pathApi.relative(resolveFsPath(repoRoot), resolveFsPath(text)).replace(/\\/g, '/');
  }
  return text.replace(/\\/g, '/').replace(/^\.\//, '');
}

function safeIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isEcmaScriptWhitespace(codeUnit) {
  return (codeUnit >= 0x0009 && codeUnit <= 0x000d)
    || codeUnit === 0x0020
    || codeUnit === 0x00a0
    || codeUnit === 0x1680
    || (codeUnit >= 0x2000 && codeUnit <= 0x200a)
    || codeUnit === 0x2028
    || codeUnit === 0x2029
    || codeUnit === 0x202f
    || codeUnit === 0x205f
    || codeUnit === 0x3000
    || codeUnit === 0xfeff;
}

function truncate(value, limit = 240) {
  const source = String(value || '');
  if (source.length <= TRUNCATE_NATIVE_THRESHOLD || !Number.isInteger(limit) || limit < 0) {
    const text = source.replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 3))}...`;
  }

  const normalized = [];
  let pendingWhitespace = false;
  for (let index = 0; index < source.length; index += 1) {
    const codeUnit = source.charCodeAt(index);
    if (isEcmaScriptWhitespace(codeUnit)) {
      if (normalized.length) pendingWhitespace = true;
      continue;
    }
    if (pendingWhitespace) {
      normalized.push(' ');
      pendingWhitespace = false;
      if (normalized.length > limit) break;
    }
    normalized.push(source[index]);
    if (normalized.length > limit) break;
  }

  const text = normalized.join('');
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function truncatePreservingWhitespace(value, limit = 4000) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

const PROTOCOL_LABELS = Object.freeze({
  agents_instructions: 'AGENTS.md instructions',
  developer_collaboration_mode: 'Collaboration mode',
  developer_instruction: 'Developer instruction',
  developer_permissions: 'Developer permissions',
  environment_context: 'Environment context',
  session_configured: 'Session configured',
  thread_goal_updated: 'Thread goal updated',
  goal_context: 'Goal context',
  image_wrapper: 'Image attachment wrapper',
  meta_block: 'Protocol metadata block',
  session_meta: 'Session metadata',
  skill_injection: 'Skill instructions',
  token_count: 'Token count',
  turn_aborted_marker: 'Turn aborted marker',
  turn_context: 'Turn context',
  user_shell_command: 'User shell command',
});

const EVENT_KIND_LABELS = Object.freeze({
  user_message: 'User message',
  assistant_message: 'Assistant message',
  command: 'Command',
  read: 'Read',
  patch: 'Patch',
  mcp_call: 'MCP call',
  js_repl: 'JS REPL',
  agent_coordination: 'Subagent coordination',
  other_tool_call: 'Other tool call',
  proposed_plan: 'Proposed plan',
  plan_update: 'Plan update',
  protocol: 'Protocol',
  error: 'Error',
  warning: 'Warning',
  abort: 'Turn aborted',
  rollback: 'Thread rollback',
  compaction: 'Context compaction',
  usage_limit_warning: 'Usage limit warning',
  subagent: 'Subagent activity',
  review: 'Review',
  reasoning: 'Reasoning',
  web_search: 'Web search',
  goal: 'Goal',
  hook: 'Hook',
  developer_message: 'Developer message',
  user_shell_command: 'User shell command',
  event: 'Event',
});

function flattenText(value, budget = 8000) {
  const parts = [];
  let used = 0;

  const push = (text) => {
    if (!text || used >= budget) return;
    const s = String(text);
    const remaining = budget - used;
    parts.push(s.length > remaining ? s.slice(0, remaining) : s);
    used += Math.min(s.length, remaining);
  };

  const visit = (node) => {
    if (used >= budget || node == null) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === 'object') {
      if (typeof node.text === 'string') push(node.text);
      if (typeof node.message === 'string') push(node.message);
      if (typeof node.content === 'string') push(node.content);
      if (Array.isArray(node.content)) visit(node.content);
      if (!node.text && !node.message && !node.content) {
        for (const key of Object.keys(node).slice(0, 24)) visit(node[key]);
      }
    }
  };

  visit(value);
  return parts.join('\n').trim();
}

const TOKEN_USAGE_ORDER = [
  'input_tokens',
  'cached_input_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'total_tokens',
];

const TOKEN_USAGE_LABELS = Object.freeze({
  input_tokens: 'Input',
  cached_input_tokens: 'Cached input',
  cache_creation_input_tokens: 'Cache creation',
  cache_read_input_tokens: 'Cache read',
  output_tokens: 'Output',
  reasoning_output_tokens: 'Reasoning output',
  total_tokens: 'Total',
});

const USAGE_LIMIT_ORDER = ['5h', 'weekly'];

function humanizeTokenKey(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeUsageLimitKey(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function eventKindLabel(value, locale = i18n.DEFAULT_LOCALE) {
  const key = String(value || '').trim();
  return i18n.eventKindLabel(key, locale) || EVENT_KIND_LABELS[key] || PROTOCOL_LABELS[key] || i18n.humanize(key) || key;
}

function rawRecordLabel(raw, locale = i18n.DEFAULT_LOCALE) {
  const key = raw?.payloadType || raw?.recordType || '';
  return i18n.rawRecordLabel(key, locale);
}

function rawRecordValueLabel(value, locale = i18n.DEFAULT_LOCALE) {
  return i18n.rawRecordLabel(value, locale);
}

function usageLimitKind(text) {
  const source = String(text || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bweekly\b|\bweek\b/.test(source)) return 'weekly';
  if (/\b5\s*h\b|\b5\s*hour\b|\bfive\s*hour\b/.test(source)) return '5h';
  return '';
}

function usageLimitKindFromWindowMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '';
  if (minutes === 300) return '5h';
  if (minutes === 10080) return 'weekly';
  return '';
}

function usageLimitLabel(kind, fallback) {
  if (kind === '5h') return '5 hour usage limit';
  if (kind === 'weekly') return 'Weekly usage limit';
  const base = humanizeUsageLimitKey(fallback || 'Usage');
  return /\busage limit\b/i.test(base) ? base : `${base || 'Usage'} usage limit`;
}

function tokenUsageLabel(pathParts) {
  const parts = pathParts.filter((part) => part !== 'info');
  const key = parts.at(-1) || '';
  if (TOKEN_USAGE_LABELS[key]) return TOKEN_USAGE_LABELS[key];
  return parts.map(humanizeTokenKey).join(' ');
}

function collectTokenUsageEntries(payload) {
  const root = payload?.info && typeof payload.info === 'object' ? payload.info : payload;
  if (!root || typeof root !== 'object') return [];
  const entries = [];

  const visit = (node, pathParts) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...pathParts, key];
      if (nextPath.some((part) => /limit|quota|rate/i.test(part))) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        entries.push({
          key: nextPath.join('.'),
          field: key,
          label: tokenUsageLabel(nextPath),
          value,
        });
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        visit(value, nextPath);
      }
    }
  };

  visit(root, root === payload ? [] : ['info']);
  return entries.sort((a, b) => {
    const aOrder = TOKEN_USAGE_ORDER.indexOf(a.field);
    const bOrder = TOKEN_USAGE_ORDER.indexOf(b.field);
    if (aOrder !== -1 || bOrder !== -1) return (aOrder === -1 ? 999 : aOrder) - (bOrder === -1 ? 999 : bOrder);
    return a.key.localeCompare(b.key);
  });
}

function tokenUsageItems(payload) {
  const entries = collectTokenUsageEntries(payload);
  const total = entries.find((entry) => entry.field === 'total_tokens');
  const ordered = total ? [total, ...entries.filter((entry) => entry !== total)] : entries;
  return ordered.map((entry) => ({
    key: entry.key,
    field: entry.field,
    label: entry.label,
    value: entry.value,
    formatted: formatTokenValue(entry.value),
    primary: entry.field === 'total_tokens',
  }));
}

function formatPercentValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const percent = number > 0 && number <= 1 ? number * 100 : number;
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatResetTime(value, now = new Date()) {
  if (value == null || value === '') return '';
  const source = typeof value === 'number' ? (value < 10000000000 ? value * 1000 : value) : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return String(value);
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const mode = sameDay ? 'same-day' : 'full';
  const cacheKey = `${date.getTime()}|${mode}`;
  const cached = resetTimeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const formatted = (sameDay ? SAME_DAY_RESET_TIME_FORMATTER : FULL_RESET_TIME_FORMATTER).format(date);
  if (resetTimeCache.size >= RESET_TIME_CACHE_LIMIT) {
    resetTimeCache.delete(resetTimeCache.keys().next().value);
  }
  resetTimeCache.set(cacheKey, formatted);
  return formatted;
}

function isRemainingKey(key) {
  const source = String(key || '').toLowerCase();
  return /remaining/.test(source) && (/percent|percentage|pct|ratio|fraction/.test(source) || source === 'remaining');
}

function isUsedPercentKey(key) {
  return /used.*percent|percent.*used|used_pct|usedPercent/.test(String(key || '').toLowerCase());
}

function isWindowMinutesKey(key) {
  return /window.*minutes|minutes.*window/.test(String(key || '').toLowerCase());
}

function isResetKey(key) {
  return /reset|resets|renew|renews/.test(String(key || '').toLowerCase());
}

function valueByKey(node, predicate) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  for (const [key, value] of Object.entries(node)) {
    if (predicate(key) && (typeof value === 'number' || typeof value === 'string')) return value;
  }
  return undefined;
}

function firstStringByKey(node, keys) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return '';
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function collectUsageLimitItems(payload) {
  const root = payload;
  if (!root || typeof root !== 'object') return [];
  const items = [];
  const seen = new Set();

  const pushCandidate = (pathParts, node, remainingValue, resetValue) => {
    const remaining = formatPercentValue(remainingValue);
    const reset = formatResetTime(resetValue);
    if (!remaining || !reset) return;
    const pathText = pathParts.join(' ');
    const explicitLabel = firstStringByKey(node, ['label', 'name', 'title']);
    const windowText = firstStringByKey(node, ['window', 'period', 'duration', 'interval']);
    const windowMinutes = valueByKey(node, isWindowMinutesKey);
    const kind = usageLimitKindFromWindowMinutes(windowMinutes) || usageLimitKind(`${pathText} ${explicitLabel} ${windowText}`);
    const key = kind || pathParts.join('.') || explicitLabel || windowText;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      key,
      kind,
      label: usageLimitLabel(kind, explicitLabel || windowText || pathParts.at(-1)),
      remaining,
      reset,
      resetRaw: resetValue,
    });
  };

  const visit = (node, pathParts) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    let remainingValue = valueByKey(node, isRemainingKey);
    const usedPercentValue = valueByKey(node, isUsedPercentKey);
    if (remainingValue === undefined && usedPercentValue !== undefined) remainingValue = 100 - Number(usedPercentValue);
    const resetValue = valueByKey(node, isResetKey);
    if (remainingValue !== undefined && resetValue !== undefined) pushCandidate(pathParts, node, remainingValue, resetValue);
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) visit(value, [...pathParts, key]);
    }
  };

  visit(root, []);
  return items.sort((a, b) => {
    const aOrder = USAGE_LIMIT_ORDER.indexOf(a.kind);
    const bOrder = USAGE_LIMIT_ORDER.indexOf(b.kind);
    if (aOrder !== -1 || bOrder !== -1) return (aOrder === -1 ? 999 : aOrder) - (bOrder === -1 ? 999 : bOrder);
    return a.label.localeCompare(b.label);
  });
}

function rateLimitReachedType(payload) {
  const value = payload?.rate_limits?.rate_limit_reached_type ?? payload?.rate_limit_reached_type;
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function formatTokenValue(value) {
  return Number(value).toLocaleString('en-US');
}

function formatTokenUsagePreview(payload) {
  const limits = collectUsageLimitItems(payload);
  if (limits.length) return limits.map((item) => `${item.label}: ${item.remaining} remaining; Resets ${item.reset}`).join('; ');
  const entries = collectTokenUsageEntries(payload);
  if (!entries.length) return '';
  const total = entries.find((entry) => entry.field === 'total_tokens');
  const ordered = total ? [total, ...entries.filter((entry) => entry !== total)] : entries;
  return ordered.map((entry) => `${entry.label}: ${formatTokenValue(entry.value)}`).join('; ');
}

function tokenUsageSearchText(payload) {
  const entries = collectTokenUsageEntries(payload);
  const limits = collectUsageLimitItems(payload).flatMap((item) => [
    `${item.label}: ${item.remaining} remaining`,
    `${item.label} resets: ${item.reset}`,
  ]);
  return [...limits, ...entries.map((entry) => `${entry.key}: ${entry.value}`)].join('\n');
}

function maxObservedTokenValue(payload) {
  const entries = collectTokenUsageEntries(payload);
  const total = entries.find((entry) => entry.field === 'total_tokens');
  if (total) return total.value;
  return entries.reduce((max, entry) => Math.max(max, entry.value), 0);
}

function extractContentText(content) {
  if (!Array.isArray(content)) return '';
  return content.map((item) => item && typeof item.text === 'string' ? item.text : '').join('\n').trim();
}

function extractTypedContentText(content, type, budget = REASONING_TEXT_LIMIT) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  let used = 0;
  for (const item of content) {
    if (used >= budget) break;
    if (!item || item.type !== type || typeof item.text !== 'string' || !item.text.trim()) continue;
    const separatorLength = parts.length ? 1 : 0;
    const remaining = budget - used - separatorLength;
    if (remaining <= 0) break;
    const text = item.text.slice(0, remaining);
    parts.push(text);
    used += separatorLength + text.length;
  }
  return parts.join('\n').trim();
}

function extractReasoningText(payload, budget = REASONING_TEXT_LIMIT) {
  const summaryText = extractTypedContentText(payload?.summary, 'summary_text', budget);
  if (summaryText) return summaryText;
  return extractTypedContentText(payload?.content, 'reasoning_text', budget);
}

function extractEventReasoningText(payload, budget = REASONING_TEXT_LIMIT) {
  for (const value of [payload?.message, payload?.text]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const text = value.slice(0, budget).trim();
    if (text) return text;
  }
  return '';
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hydrationCoordinatorForIndex(index) {
  let coordinator = codexHydrationCoordinators.get(index);
  if (!coordinator) {
    coordinator = { active: 0, queue: [] };
    codexHydrationCoordinators.set(index, coordinator);
  }
  return coordinator;
}

function acquireCodexHydrationSlot(index, signal) {
  throwIfAborted(signal);
  const coordinator = hydrationCoordinatorForIndex(index);

  return new Promise((resolve, reject) => {
    const waiter = {
      signal,
      settled: false,
      onAbort: null,
      resolve,
      reject,
    };

    const settleAbort = () => {
      if (waiter.settled) return;
      waiter.settled = true;
      const indexInQueue = coordinator.queue.indexOf(waiter);
      if (indexInQueue >= 0) coordinator.queue.splice(indexInQueue, 1);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    waiter.onAbort = settleAbort;

    const grant = () => {
      if (waiter.settled) return;
      if (signal?.aborted) {
        settleAbort();
        return;
      }
      waiter.settled = true;
      signal?.removeEventListener('abort', waiter.onAbort);
      coordinator.active += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        coordinator.active -= 1;
        while (coordinator.queue.length > 0) {
          const next = coordinator.queue.shift();
          if (next.settled) continue;
          next.grant();
          break;
        }
      });
    };
    waiter.grant = grant;

    signal?.addEventListener('abort', waiter.onAbort, { once: true });
    if (coordinator.active < CODEX_SOURCE_HYDRATION_CONCURRENCY) grant();
    else coordinator.queue.push(waiter);
  });
}

async function withCodexHydrationSlot(index, signal, task) {
  const release = await acquireCodexHydrationSlot(index, signal);
  try {
    throwIfAborted(signal);
    return await task();
  } finally {
    release();
  }
}

function sourceLineDigest(line) {
  return crypto.createHash('sha256').update(String(line), 'utf8').digest('base64url');
}

function sourceSnapshotChangedError() {
  const error = new Error('Transcript changed while indexing; retry required');
  error.code = 'SOURCE_CHANGED_DURING_INDEX';
  return error;
}

async function hashFilePrefix(filePath, byteLength, signal) {
  const expectedBytes = Number(byteLength);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) throw sourceSnapshotChangedError();
  const hash = crypto.createHash('sha256');
  let bytesRead = 0;
  if (expectedBytes === 0) {
    return { bytesRead, fingerprint: hash.digest('base64url') };
  }
  const stream = fs.createReadStream(filePath, { start: 0, end: expectedBytes - 1 });
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      bytesRead += chunk.length;
      hash.update(chunk);
    }
  } finally {
    stream.destroy();
  }
  return { bytesRead, fingerprint: hash.digest('base64url') };
}

function sameSourceStat(left, right) {
  return Boolean(left && right
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs);
}

function ensureMarkdownRenderer() {
  if (markdownRenderer) return markdownRenderer;
  markdownRenderer = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
  });
  markdownRenderer.validateLink = (link) => /^(https?:|mailto:)/i.test(String(link || ''));
  return markdownRenderer;
}

function renderMarkdownToHtml(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  return ensureMarkdownRenderer().render(source);
}

function uniqueNonEmpty(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function joinBoundedUniqueText(values, separator = '\n\n', budget = REASONING_TEXT_LIMIT) {
  const parts = [];
  let used = 0;
  for (const value of uniqueNonEmpty(values)) {
    const separatorLength = parts.length ? separator.length : 0;
    const remaining = budget - used - separatorLength;
    if (remaining <= 0) break;
    const text = value.slice(0, remaining);
    if (!text) continue;
    parts.push(text);
    used += separatorLength + text.length;
  }
  return parts.join(separator);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim()) return value;
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === 'object' && Object.keys(value).length) return value;
  }
  return '';
}

function stringifyValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function displayValue(value, budget = 8000) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return flattenText(value, budget) || stringifyValue(value);
}

function ensureGb18030ReverseMap() {
  if (gb18030ReverseMap) return gb18030ReverseMap;
  const decoder = new TextDecoder('gb18030');
  const map = new Map();
  const add = (bytes) => {
    const decoded = decoder.decode(Buffer.from(bytes));
    if (!decoded || decoded.includes('\uFFFD')) return;
    if (Array.from(decoded).length !== 1) return;
    if (!map.has(decoded)) map.set(decoded, bytes);
  };

  for (let b = 0x00; b <= 0xff; b += 1) add([b]);
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      if (trail === 0x7f) continue;
      add([lead, trail]);
    }
  }
  map.set('\u20ac', [0x80]);

  gb18030ReverseMap = map;
  return gb18030ReverseMap;
}

function encodeGb18030FromDecodedText(text, options = {}) {
  const map = ensureGb18030ReverseMap();
  const bytes = [];
  for (const char of String(text || '')) {
    if (options.skipReplacement && char === '\uFFFD') continue;
    if (options.skipSuspiciousQuestion && char === '?') continue;
    const encoded = map.get(char);
    if (!encoded) return null;
    bytes.push(...encoded);
  }
  return Buffer.from(bytes);
}

function countMatches(text, pattern) {
  return (String(text || '').match(pattern) || []).length;
}

function mojibakeScore(text) {
  const source = String(text || '');
  if (!source) return 0;
  const markers = [
    '\u947d', '\u741b', '\u93bb', '\u612c', '\u5f47', '\u7487', '\u67a1', '\u7ecb', '\u9366', '\u6d93',
    '\u9286', '\u4e63', '\u9428', '\u9354', '\u59dd', '\u6e36', '\u5bee', '\u5fda', '\u68f0', '\u5815',
    '\u93c3', '\u6d7c', '\u6c33', '\u763d', '\u9363', '\u8bf2', '\u5f5b', '\u71b7', '\u5bb3', '\u20ac?',
  ];
  let score = countMatches(source, /\uFFFD/g) * 10
    + countMatches(source, /[€™œ¢£¥]/g) * 4
    + countMatches(source, /[ÃÂÎÐÑÊµ]|[æçèé]/g) * 4;
  for (const marker of markers) {
    let index = source.indexOf(marker);
    while (index !== -1) {
      score += 2;
      index = source.indexOf(marker, index + marker.length);
    }
  }
  return score;
}

function countCjk(text) {
  return countMatches(text, /[\u3400-\u9FFF]/g);
}

function looksUsefulMojibakeRepair(source, repaired, sourceScore) {
  if (!repaired || repaired === source) return false;
  const repairedScore = mojibakeScore(repaired);
  const sourceReplacementCount = countMatches(source, /\uFFFD/g)
    + (sourceScore > 0 || /[\uE000-\uF8FF]/.test(source) ? countMatches(source, /\?/g) : 0);
  const repairedReplacementCount = countMatches(repaired, /\uFFFD/g);
  if (repairedReplacementCount > sourceReplacementCount) return false;
  if (repairedScore + 4 < sourceScore) return true;
  if (repairedReplacementCount === 0 && /[^\x00-\x7F]/.test(source) && countCjk(repaired) > 0) return true;
  return sourceReplacementCount > 0 && repairedReplacementCount <= sourceReplacementCount && countCjk(repaired) >= countCjk(source) / 2;
}

function repairLikelyMojibakeSegment(text, options = {}) {
  const source = String(text || '');
  if (!/[^\x00-\x7F]/.test(source)) return source;
  const sourceScore = mojibakeScore(source);

  const bytes = encodeGb18030FromDecodedText(source);
  if (bytes) {
    const repaired = bytes.toString('utf8');
    if (looksUsefulMojibakeRepair(source, repaired, sourceScore)) return repaired;
  }

  if (options.allowLossy && (source.includes('\uFFFD') || source.includes('?'))) {
    const lossyBytes = encodeGb18030FromDecodedText(source, {
      skipReplacement: true,
      skipSuspiciousQuestion: /[^\x00-\x7F]/.test(source),
    });
    if (lossyBytes) {
      const lossyRepaired = lossyBytes.toString('utf8');
      if (looksUsefulMojibakeRepair(source, lossyRepaired, sourceScore)) return lossyRepaired;
    }
  }
  return source;
}

function repairLikelyMojibake(text) {
  const source = String(text || '');
  const repaired = repairLikelyMojibakeSegment(source, { allowLossy: true });
  if (repaired !== source) return repaired;

  return source.replace(/[^\s`|<>{}\[\]()]+/g, (segment) => repairLikelyMojibakeSegment(segment, { allowLossy: true }));
}

function normalizeTerminalReplacementPlaceholders(text) {
  return String(text || '')
    .replace(/\uFFFD\??/g, '\u25A1')
    .replace(/[鍜銆鈥锛]\?/g, '\u25A1');
}

function coerceJsonValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return safeJsonParse(trimmed);
}

function looksLikeDiff(text) {
  const source = String(text || '').trim();
  if (!source) return false;
  return source.startsWith('*** Begin Patch')
    || source.startsWith('diff --git')
    || /^@@/m.test(source)
    || /^--- /m.test(source)
    || /^\+\+\+ /m.test(source);
}

function stripProposedPlanWrapper(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  return source
    .replace(/^<proposed_plan>\s*/i, '')
    .replace(/\s*<\/proposed_plan>$/i, '')
    .trim();
}

function taggedBlockEntries(text) {
  const entries = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.trim().match(/^<([a-zA-Z0-9_]+)>(.*?)<\/\1>$/);
    if (!match) continue;
    if (match[1] === 'environment_context' || match[1] === 'proposed_plan') continue;
    const value = String(match[2] || '').trim();
    if (value) entries.push({ key: match[1], value });
  }
  return entries;
}

function sourceFileIdentity(stat) {
  return {
    device: String(stat?.dev ?? ''),
    inode: String(stat?.ino ?? ''),
  };
}

function sameSourceIdentity(left, right) {
  return Boolean(left && right
    && left.device === right.device
    && left.inode === right.inode);
}

function isKvRepresentableValue(value) {
  if (value == null || value === '') return false;
  if (typeof value !== 'object') return true;
  return Array.isArray(value) && value.every((item) => typeof item !== 'object');
}

function toKvEntries(input, preferredKeys = []) {
  if (!input || typeof input !== 'object') return [];
  const used = new Set();
  const keys = [];
  for (const key of preferredKeys) {
    if (Object.hasOwn(input, key)) {
      keys.push(key);
      used.add(key);
    }
  }
  for (const key of Object.keys(input)) {
    if (!used.has(key)) keys.push(key);
  }
  const entries = [];
  for (const key of keys) {
    const value = input[key];
    if (!isKvRepresentableValue(value)) continue;
    entries.push({ key, value: Array.isArray(value) ? value.join(', ') : String(value) });
  }
  return entries;
}

function kvRepresentedKeys(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.keys(input).filter((key) => {
    const value = input[key];
    // Null and empty scalar fields are intentionally omitted rather than residual evidence.
    if (value == null || value === '') return true;
    return isKvRepresentableValue(value);
  });
}

function residualObjectFields(input, consumedKeys = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const consumed = new Set(consumedKeys);
  const residualEntries = Object.entries(input).filter(([key]) => !consumed.has(key));
  return residualEntries.length ? Object.fromEntries(residualEntries) : null;
}

function isFiniteNumberValue(value) {
  return value !== '' && Number.isFinite(Number(value));
}

function textLineCount(text) {
  const source = String(text || '');
  if (!source) return 0;
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.endsWith('\n') ? normalized.split('\n').length - 1 : normalized.split('\n').length;
}

function lineStatsFromUnifiedDiff(text) {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (isDiffMetadataLine(line)) continue;
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith('+++') || line.startsWith('---'))) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function lineStatsFromPatchChange(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const changeType = String(stats.type || '').toLowerCase();
  if (isFiniteNumberValue(stats.additions) || isFiniteNumberValue(stats.deletions)) {
    return {
      additions: isFiniteNumberValue(stats.additions) ? Number(stats.additions) : 0,
      deletions: isFiniteNumberValue(stats.deletions) ? Number(stats.deletions) : 0,
    };
  }
  if (typeof stats.unified_diff === 'string') return lineStatsFromUnifiedDiff(stats.unified_diff);
  if (changeType === 'add' && typeof stats.content === 'string') {
    return { additions: textLineCount(stats.content), deletions: 0 };
  }
  if (changeType === 'delete' && typeof stats.content === 'string') {
    return { additions: 0, deletions: textLineCount(stats.content) };
  }
  return null;
}

function lineStatsLabel(stats) {
  return `+${Number(stats.additions || 0)} / -${Number(stats.deletions || 0)}`;
}

function patchInputStatsLabel(stats) {
  if (stats.additions || stats.deletions) return lineStatsLabel(stats);
  if (stats.action === 'Add') return 'added';
  if (stats.action === 'Delete') return 'deleted';
  return 'updated';
}

function diffStatsEntries(changes, repoRoot = '') {
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes).map(([file, stats]) => {
    const lineStats = lineStatsFromPatchChange(stats);
    return {
      key: displayProjectFile(file, repoRoot),
      value: lineStats ? lineStatsLabel(lineStats) : String(stats?.type || 'updated'),
    };
  });
}

function diffStatsEntriesFromPatchInput(input) {
  const entries = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    entries.push({ key: current.file, value: patchInputStatsLabel(current) });
    current = null;
  };

  for (const line of String(input || '').split(/\r?\n/)) {
    const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (fileMatch) {
      flush();
      current = { file: fileMatch[2], action: fileMatch[1], additions: 0, deletions: 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('*** ')) continue;
    if (line.startsWith('+')) current.additions += 1;
    else if (line.startsWith('-')) current.deletions += 1;
  }
  flush();
  return entries;
}

const COMMON_POWERSHELL_EXTERNAL_COMMANDS = new Set(SHELL_EXTERNAL_COMMAND_WORDS);

function commandHead(commandText) {
  const match = String(commandText || '').trim().match(/^(?:&\s*)?(?:"([^"]+)"|'([^']+)'|([^\s|;&(){}]+))/);
  const token = match ? (match[1] || match[2] || match[3] || '') : '';
  return executableName(token);
}

function executableName(value) {
  return String(value || '').toLowerCase().replace(/\\/g, '/').split('/').pop().replace(/\.exe$/, '');
}

function normalizedSessionShell(value) {
  return executableName(value);
}

function boundedSessionShellContext(value) {
  const shell = normalizedSessionShell(value);
  return Buffer.byteLength(shell, 'utf8') <= CODEX_MATERIALIZED_SHELL_MAX_BYTES ? shell : '';
}

function sessionUsesPowerShell(value) {
  const shell = normalizedSessionShell(value);
  return shell === 'powershell' || shell === 'pwsh';
}

function commandLanguageContext(session = {}) {
  return { sessionShell: session.shell || session._shell || '' };
}

function inferCommandLanguage(commandText, args = {}, context = {}) {
  const commandArray = Array.isArray(args?.command) ? args.command : [];
  const joined = commandArray.length ? commandArray.join(' ') : String(commandText || '');
  const lower = joined.toLowerCase();
  const executable = executableName(commandArray[0] || '');
  const head = executable || commandHead(joined);
  if (head === 'powershell' || head === 'pwsh') return 'powershell';
  if (head === 'cmd' || /\bcmd(?:\.exe)?\s+\/c\b/.test(lower)) return 'batch';
  if (head === 'bash') return 'bash';
  if (head === 'sh') return 'sh';
  if (head === 'zsh') return 'zsh';
  if (head === 'fish') return 'fish';
  if (/\b(powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/.test(lower) || lower.includes(' -command ')) return 'powershell';
  if (/\b(get-content|set-content|select-object|where-object|start-process|invoke-webrequest|remove-item|copy-item|move-item)\b/.test(lower)) return 'powershell';
  if (sessionUsesPowerShell(context.sessionShell) && COMMON_POWERSHELL_EXTERNAL_COMMANDS.has(head)) return 'powershell';
  if (/\b(bash|zsh|fish|sh)\b/.test(lower)) return 'shell';
  return 'shell';
}

function makePatchFile(pathname, changeType) {
  return {
    path: String(pathname || ''),
    changeType: String(changeType || 'update').toLowerCase(),
    additions: 0,
    deletions: 0,
    hunks: [],
  };
}

function patchContentLines(content) {
  const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return [];
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed ? trimmed.split('\n') : [''];
}

function isDiffMetadataLine(line) {
  return line === '\\ No newline at end of file';
}

function parseUnifiedDiffPatchSection(changes, repoRoot = '') {
  if (!changes || typeof changes !== 'object') return null;
  const files = [];
  for (const [pathname, stats] of Object.entries(changes)) {
    const file = makePatchFile(displayProjectFile(pathname, repoRoot), stats?.type || 'update');
    const diff = typeof stats?.unified_diff === 'string' ? stats.unified_diff.trim() : '';
    let hunk = null;
    let oldLine = 1;
    let newLine = 1;
    let hasLineNumbers = false;
    const flushHunk = () => {
      if (hunk) file.hunks.push(hunk);
      hunk = null;
    };
    for (const line of diff ? diff.split(/\r?\n/) : []) {
      if (isDiffMetadataLine(line)) continue;
      if (!hunk && (line.startsWith('---') || line.startsWith('+++'))) continue;
      if (line.startsWith('@@')) {
        flushHunk();
        const range = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
        if (range) {
          oldLine = Number(range[1]);
          newLine = Number(range[2]);
          hasLineNumbers = true;
        }
        hunk = { header: line, lineNumbers: Boolean(range), lines: [] };
        continue;
      }
      if (!hunk) hunk = { header: '', lineNumbers: false, lines: [] };
      if (line.startsWith('+')) {
        file.additions += 1;
        hunk.lines.push({ kind: 'added', content: line.slice(1), oldLine: null, newLine, lineNumberReliable: hunk.lineNumbers });
        newLine += 1;
      } else if (line.startsWith('-')) {
        file.deletions += 1;
        hunk.lines.push({ kind: 'removed', content: line.slice(1), oldLine, newLine: null, lineNumberReliable: hunk.lineNumbers });
        oldLine += 1;
      } else {
        const content = line.startsWith(' ') ? line.slice(1) : line;
        hunk.lines.push({ kind: 'context', content, oldLine, newLine, lineNumberReliable: hunk.lineNumbers });
        oldLine += 1;
        newLine += 1;
      }
    }
    const contentLines = patchContentLines(stats?.content);
    if (!file.hunks.length && contentLines.length && ['add', 'delete'].includes(String(stats?.type || '').toLowerCase())) {
      const deleted = String(stats.type).toLowerCase() === 'delete';
      hunk = { header: '', lineNumbers: false, lines: [] };
      for (const [index, content] of contentLines.entries()) {
        if (deleted) {
          file.deletions += 1;
          hunk.lines.push({ kind: 'removed', content, oldLine: index + 1, newLine: null, lineNumberReliable: false });
        } else {
          file.additions += 1;
          hunk.lines.push({ kind: 'added', content, oldLine: null, newLine: index + 1, lineNumberReliable: false });
        }
      }
    }
    flushHunk();
    if (file.hunks.length) {
      file.lineNumbers = hasLineNumbers;
      files.push(file);
    }
  }
  return files.length ? { type: 'patch', title: 'Patch', files, lineNumbers: files.some((file) => file.lineNumbers) } : null;
}

function parsePatchSection(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const files = [];
  let file = null;
  let hunk = null;
  let oldLine = 1;
  let newLine = 1;

  const flushHunk = () => {
    if (file && hunk) file.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (file) files.push(file);
    file = null;
  };

  for (const line of source.split(/\r?\n/)) {
    if (isDiffMetadataLine(line)) continue;
    const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (fileMatch) {
      flushFile();
      file = makePatchFile(fileMatch[2], fileMatch[1]);
      oldLine = 1;
      newLine = 1;
      continue;
    }
    if (!file) continue;
    if (line.startsWith('*** ')) continue;
    if (line.startsWith('@@')) {
      flushHunk();
      const range = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      const hasLineNumbers = Boolean(range);
      if (range) {
        oldLine = Number(range[1]);
        newLine = Number(range[2]);
      }
      hunk = { header: line, lineNumbers: hasLineNumbers, lines: [] };
      continue;
    }
    if (!hunk) hunk = { header: '', lineNumbers: false, lines: [] };
    if (line.startsWith('+')) {
      file.additions += 1;
      hunk.lines.push({ kind: 'added', content: line.slice(1), oldLine: null, newLine, lineNumberReliable: hunk.lineNumbers });
      newLine += 1;
    } else if (line.startsWith('-')) {
      file.deletions += 1;
      hunk.lines.push({ kind: 'removed', content: line.slice(1), oldLine, newLine: null, lineNumberReliable: hunk.lineNumbers });
      oldLine += 1;
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      hunk.lines.push({ kind: 'context', content, oldLine, newLine, lineNumberReliable: hunk.lineNumbers });
      oldLine += 1;
      newLine += 1;
    }
  }
  flushFile();
  if (!files.length) return null;
  for (const item of files) item.lineNumbers = item.hunks.some((hunk) => hunk.lineNumbers);
  return { type: 'patch', title: 'Patch', files, lineNumbers: files.some((item) => item.lineNumbers) };
}

function withDetailPurpose(section, purpose) {
  if (!section || !purpose) return section;
  return { ...section, purpose };
}

function maybePushPatchSection(sections, title, text, purpose) {
  const section = parsePatchSection(text);
  if (!section) return false;
  section.title = title;
  sections.push(withDetailPurpose(section, purpose));
  return true;
}

function maybePushKvSection(sections, title, entries, purpose) {
  const filtered = (entries || []).filter((entry) => entry && entry.key && entry.value !== '');
  if (!filtered.length) return;
  sections.push(withDetailPurpose({ type: 'kv', title, entries: filtered }, purpose));
}

function withoutKeys(input, keys) {
  if (!input || typeof input !== 'object') return input;
  const omitted = new Set(keys || []);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !omitted.has(key)));
}

function withoutSectionTypes(sections, types) {
  const omitted = new Set(types || []);
  return (sections || []).filter((section) => !omitted.has(section.type));
}

function maybePushMarkdownSection(sections, title, text, purpose) {
  const source = String(text || '').trim();
  if (!source) return;
  sections.push(withDetailPurpose({
    type: 'markdown',
    title,
    html: renderMarkdownToHtml(source),
  }, purpose));
}

function normalizeLanguage(language, fallback = 'text') {
  const source = String(language || '').trim().toLowerCase();
  return source || fallback;
}

function maybePushCodeSection(sections, title, code, language = 'text', purpose) {
  const source = String(code || '').trim();
  if (!source) return;
  sections.push(withDetailPurpose({ type: 'code', title, code: source, language: normalizeLanguage(language, 'text') }, purpose));
}

function inferTerminalLanguage(text) {
  const source = String(text || '').trim();
  if (!source) return 'text';
  if (looksLikeDiff(source)) return 'diff';
  if (coerceJsonValue(source)) return 'json';
  return 'text';
}

function maybePushTerminalSection(sections, title, text, stream = 'stdout', language = '', purpose) {
  const source = normalizeTerminalReplacementPlaceholders(repairLikelyMojibake(stripAnsiSequences(text)));
  if (!source.trim()) return;
  sections.push(withDetailPurpose({ type: 'terminal', title, text: source, stream, language: normalizeLanguage(language || inferTerminalLanguage(source), 'text') }, purpose));
}

function maybePushStructuredSection(sections, title, value, options = {}) {
  const jsonValue = coerceJsonValue(value);
  if (jsonValue) {
    sections.push(withDetailPurpose({ type: 'json', title, value: jsonValue }, options.purpose));
    return 'json';
  }
  const text = stringifyValue(value).trim();
  if (!text) return '';
  if (looksLikeDiff(text)) {
    sections.push(withDetailPurpose({ type: 'diff', title, text }, options.purpose));
    return 'diff';
  }
  sections.push(withDetailPurpose({ type: options.rawType === 'raw_json'
    ? 'raw_json'
    : 'code', title, code: text, language: options.language || '' }, options.purpose));
  return options.rawType === 'raw_json' ? 'raw_json' : 'code';
}

function maybePushParsedOutputSection(sections, title, value, purpose) {
  const jsonValue = coerceJsonValue(value);
  if (jsonValue) {
    sections.push(withDetailPurpose({ type: 'json', title, value: jsonValue }, purpose));
    return true;
  }
  const text = stringifyValue(value).trim();
  if (looksLikeDiff(text)) {
    sections.push(withDetailPurpose({ type: 'diff', title, text }, purpose));
    return true;
  }
  return false;
}

function makeNoticeSection(title, text, level = 'info', purpose) {
  return withDetailPurpose({
    type: 'notice',
    title,
    level,
    text: String(text || '').trim(),
  }, purpose);
}

function hideSectionTitle(section) {
  if (section) section.hideTitle = true;
  return section;
}

function makeRawJsonSection(title, value, expanded = false, purpose) {
  return withDetailPurpose({
    type: 'raw_json',
    title,
    value,
    expanded,
  }, purpose);
}

function logicalFallbackPayload(raws) {
  const values = (raws || []).map((raw) => {
    if (raw?.parsed && Object.hasOwn(raw.parsed, 'payload')) return raw.parsed.payload;
    if (raw && Object.hasOwn(raw, 'payload')) return raw.payload;
    return raw?.parsed;
  }).filter((value) => value !== undefined);
  return values.length === 1 ? values[0] : values;
}

function maybePushResidualJsonSection(sections, title, input, consumedKeys = []) {
  const residual = residualObjectFields(input, consumedKeys);
  if (residual) sections.push(makeRawJsonSection(title, residual, false, 'fallback'));
  return residual;
}

function filterDetailSections(sections) {
  return sections.filter((section) => section && SECTION_TYPES.has(section.type));
}

function localizeDetailSections(sections, locale) {
  return filterDetailSections(sections).map((section) => i18n.localizeSection(section, locale));
}

function localizedLogicalLabel(logical, locale) {
  if (!logical) return '';
  const label = sanitizeLogicalEnvelopeValue(logical.label);
  const translated = i18n.lookupKnownLabel(label, locale);
  if (translated) return translated;
  if (label) return label;
  if (logical.layer === 'protocol') return eventKindLabel(logical.subtype || logical.kind, locale);
  return '';
}

function readSessionIndexEntry(line) {
  try {
    const item = JSON.parse(line);
    if (typeof item.id !== 'string' || !item.id) return null;
    return {
      id: item.id,
      title: typeof item.thread_name === 'string' ? item.thread_name : '',
      updatedAt: safeIso(item.updated_at),
    };
  } catch {
    return null;
  }
}

function subagentSpawnSource(payload) {
  const value = payload?.source?.subagent?.thread_spawn;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function forkedFromSessionIdFromMeta(payload) {
  return typeof payload?.forked_from_id === 'string' ? payload.forked_from_id : '';
}

function parentSessionIdFromMeta(payload) {
  const nestedValue = subagentSpawnSource(payload)?.parent_thread_id;
  const nestedParent = typeof nestedValue === 'string' ? nestedValue : '';
  if (nestedParent) return nestedParent;
  // Top-level parent_thread_id is accepted only for sessions whose metadata
  // already classifies them as review-derived children. A generic
  // parent_thread_id alone must not visually demote an unknown session.
  if (derivedSessionKindFromMeta(payload) === 'review') {
    return typeof payload?.parent_thread_id === 'string' ? payload.parent_thread_id : '';
  }
  return '';
}

function agentNicknameFromMeta(payload) {
  if (typeof payload?.agent_nickname === 'string') return payload.agent_nickname;
  const nestedNickname = subagentSpawnSource(payload)?.agent_nickname;
  return typeof nestedNickname === 'string' ? nestedNickname : '';
}

function derivedSessionKindFromMeta(payload) {
  const nickname = agentNicknameFromMeta(payload);
  const subagentSource = payload?.source?.subagent;
  const subagentLabel = typeof subagentSource === 'string' ? subagentSource : '';
  const isSubagent = Boolean(subagentSource || payload?.thread_source === 'subagent');
  if (/\breview\b/i.test(`${nickname}\n${subagentLabel}`)) return 'review';
  return isSubagent ? 'subagent' : '';
}

function derivedSessionKind(session) {
  if (session.primarySessionMetaKind) return session.primarySessionMetaKind;
  if (/\breview\b/i.test(session.agentNickname || '')) return 'review';
  if (session.parentSessionId) return 'subagent';
  return '';
}

function parseTimestampMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function reviewMarkerMatchesSession(marker, session) {
  const entered = parseTimestampMs(marker.enteredAt);
  const exited = parseTimestampMs(marker.exitedAt);
  const started = parseTimestampMs(session.startedAt);
  const updated = parseTimestampMs(session.updatedAt || session.startedAt);
  if (entered === null || started === null) return false;

  const nearEntered = Math.abs(entered - started) <= 5_000;
  const enclosesStart = entered <= started + 5_000 && (exited === null || exited >= started - 30_000);
  const nearExited = exited !== null && updated !== null && Math.abs(exited - updated) <= 120_000;
  return nearEntered || (enclosesStart && nearExited);
}

function sessionReviewMarkers(session) {
  if (Array.isArray(session._reviewMarkers)) return session._reviewMarkers;
  const markers = [];
  for (const raw of session.rawEvents || []) {
    appendReviewLifecycleMarker(markers, raw, { ownerId: session.id });
  }
  return markers;
}

function inferReviewParentSessions(sessions) {
  const primarySessions = sessions.filter((session) => !derivedSessionKind(session));
  for (const session of sessions) {
    if (session.parentSessionId || derivedSessionKind(session) !== 'review') continue;
    const candidates = new Map();
    for (const candidate of primarySessions) {
      if (sessionReviewMarkers(candidate).some((marker) => reviewMarkerMatchesSession(marker, session))) {
        candidates.set(candidate.id, candidate);
      }
    }
    if (candidates.size !== 1) continue;
    session.parentSessionId = [...candidates.values()][0].id;
    session.parentSessionInferred = true;
  }
}

async function collectJsonlFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

function stripExtendedPathPrefix(value) {
  const text = String(value || '');
  return text.startsWith('\\\\?\\') ? text.slice(4) : text;
}

function expandEnvironmentVariables(value) {
  return String(value || '')
    .replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => process.env[name] ?? match)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => process.env[name] ?? match);
}

function readTomlQuotedKey(text, start) {
  const quote = text[start];
  if (quote !== '\'' && quote !== '"') return null;
  let value = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) return { value, next: i + 1, quoted: true };
    if (quote === '"' && ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      const escapes = {
        b: '\b',
        t: '\t',
        n: '\n',
        f: '\f',
        r: '\r',
        '"': '"',
        '\\': '\\',
      };
      value += Object.hasOwn(escapes, next) ? escapes[next] : `\\${next}`;
      i += 2;
      continue;
    }
    value += ch;
    i += 1;
  }
  return null;
}

function readTomlBareKey(text, start) {
  let i = start;
  while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i += 1;
  if (i === start) return null;
  return { value: text.slice(start, i), next: i, quoted: false };
}

function parseTomlDottedKey(text) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    const part = text[i] === '\'' || text[i] === '"'
      ? readTomlQuotedKey(text, i)
      : readTomlBareKey(text, i);
    if (!part) return null;
    parts.push(part);
    i = part.next;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    if (text[i] !== '.') return null;
    i += 1;
  }
  return parts;
}

function parseProjectConfigHeader(line) {
  const text = String(line || '').trim();
  if (!text.startsWith('[')) return '';
  let quote = '';
  let escaped = false;
  let close = -1;
  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (ch === quote && !escaped) quote = '';
      escaped = false;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
    } else if (ch === ']') {
      close = i;
      break;
    }
  }
  if (close < 0) return '';
  const suffix = text.slice(close + 1).trim();
  if (suffix && !suffix.startsWith('#')) return '';
  const parts = parseTomlDottedKey(text.slice(1, close));
  if (!parts || parts.length !== 2) return '';
  if (parts[0].value !== 'projects' || !parts[1].quoted) return '';
  return parts[1].value;
}

async function discoverConfiguredProjects({ codexHome }) {
  const configPath = path.join(path.resolve(codexHome), 'config.toml');
  let text = '';
  try {
    text = await fsp.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Unable to read Codex config for project summary: ${error.message}`);
    }
    return [];
  }

  const projects = new Map();
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseProjectConfigHeader(line);
    if (!parsed) continue;
    const repoRoot = resolveFsPath(stripExtendedPathPrefix(expandEnvironmentVariables(parsed)));
    const key = normalizeFsPath(repoRoot);
    if (!key || projects.has(key)) continue;
    projects.set(key, {
      repoRoot,
      sessionCount: null,
      updatedAt: '',
      exists: false,
      statsPending: true,
      source: 'config',
    });
  }

  for (const project of projects.values()) {
    try {
      project.exists = (await fsp.stat(project.repoRoot)).isDirectory();
    } catch {
      project.exists = false;
    }
  }
  return [...projects.values()];
}

async function inspectSessionFile(filePath, options = {}) {
  const signal = options.signal;
  const repoRoot = options.repoRoot ? resolveFsPath(options.repoRoot) : '';
  throwIfAborted(signal);
  const stat = await fsp.stat(filePath);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const cwdSet = new Set();
  let firstRecordSeen = false;
  let leadingSessionId = '';
  let leadingForkedFromSessionId = '';

  try {
    for await (const line of rl) {
      throwIfAborted(signal);
      if (!line.trim()) continue;
      let record = null;
      if (!firstRecordSeen) {
        record = safeJsonParse(line);
        if (record && typeof record === 'object') {
          firstRecordSeen = true;
        }
        if (firstRecordSeen && record?.type === 'session_meta') {
          leadingSessionId = typeof record.payload?.id === 'string' ? record.payload.id : '';
          leadingForkedFromSessionId = typeof record.payload?.forked_from_id === 'string'
            ? record.payload.forked_from_id.trim()
            : '';
        }
      }
      if (!line.includes('"cwd"')) continue;
      record ||= safeJsonParse(line);
      if (!record) continue;
      const payloadType = record.type === 'event_msg' ? record.payload?.type : '';
      const cwd = record.type === 'session_meta' || payloadType === 'session_configured' ? record.payload?.cwd : '';
      if (typeof cwd === 'string' && cwd) {
        const resolvedCwd = resolveFsPath(cwd);
        cwdSet.add(resolvedCwd);
        if (repoRoot && isPathInsideOrSame(resolvedCwd, repoRoot)) {
          rl.close();
          stream.destroy();
          break;
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return {
    bytes: stat.size,
    updatedAt: safeIso(stat.mtime),
    cwdSet,
    leadingSessionId,
    leadingForkedFromSessionId,
  };
}

function materializedForkDigestFilePaths(candidateFiles, inspectionsByFile) {
  const candidatesBySessionId = new Map();
  for (const filePath of candidateFiles) {
    const sessionId = inspectionsByFile.get(filePath)?.leadingSessionId || '';
    if (!sessionId) continue;
    const matches = candidatesBySessionId.get(sessionId) || [];
    matches.push(filePath);
    candidatesBySessionId.set(sessionId, matches);
  }

  const digestFilePaths = new Set();
  for (const childFilePath of candidateFiles) {
    const inspection = inspectionsByFile.get(childFilePath);
    const childSessionId = inspection?.leadingSessionId || '';
    const parentSessionId = inspection?.leadingForkedFromSessionId || '';
    if (!childSessionId || !parentSessionId || childSessionId === parentSessionId) continue;
    const parentMatches = candidatesBySessionId.get(parentSessionId) || [];
    if (parentMatches.length !== 1) continue;
    digestFilePaths.add(childFilePath);
    digestFilePaths.add(parentMatches[0]);
  }
  return digestFilePaths;
}

async function discoverProjects({ codexHome }) {
  const resolvedCodex = path.resolve(codexHome);
  const sessionsRoot = path.join(resolvedCodex, 'sessions');
  const files = await collectJsonlFiles(sessionsRoot);
  const projects = new Map();

  for (const filePath of files) {
    const { bytes, cwdSet, updatedAt } = await inspectSessionFile(filePath);

    for (const repoRoot of cwdSet) {
      const key = normalizeFsPath(repoRoot);
      const project = projects.get(key) || {
        repoRoot,
        sessionCount: 0,
        updatedAt: '',
        exists: false,
      };
      project.sessionCount += 1;
      project.bytes = (project.bytes || 0) + bytes;
      if (updatedAt && updatedAt > project.updatedAt) project.updatedAt = updatedAt;
      projects.set(key, project);
    }
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

async function readSessionIndex(codexHome) {
  const indexPath = path.join(codexHome, 'session_index.jsonl');
  const map = new Map();
  let text = '';
  try {
    text = await fsp.readFile(indexPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return map;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = readSessionIndexEntry(line);
    if (item) map.set(item.id, item);
  }
  return map;
}

function makeEmptySession(filePath, relFile, stat) {
  const idFromName = path.basename(filePath).match(UUID_RE)?.[1] || path.basename(filePath, '.jsonl');
  return {
    id: idFromName,
    sourceKind: CODEX_SOURCE_KIND,
    sourceSessionId: idFromName,
    sourceClientVersion: '',
    projectAssociation: 'embedded-cwd',
    title: '',
    sourceFile: relFile,
    sourceAbsFile: filePath,
    sourceUpdatedAt: safeIso(stat.mtime),
    sourceFingerprint: '',
    bytes: stat.size,
    lineCount: 0,
    cwdSet: new Set(),
    startedAt: '',
    updatedAt: '',
    matchesRepo: false,
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    forkStorageMode: '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    forkEvidence: null,
    inheritedContext: null,
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    _parsedAncestry: null,
    agentNickname: '',
    shell: '',
    primarySessionMetaKind: '',
    _reviewMarkers: [],
    rawEvents: [],
    logicalEvents: [],
    counts: emptySessionCounts(),
    analysis: null,
  };
}

function emptySessionCounts() {
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

function emptyAnalysisDraft() {
  return {
    toolUsage: new Map(),
    commands: [],
    failedCommands: [],
    patchedFiles: new Map(),
    tokenStats: { maxObserved: 0 },
  };
}

// Invariant: callers pass an already normalized ISO timestamp; do not repeat safeIso here.
function updateTimeRangeFromNormalizedTimestamp(session, timestamp) {
  if (!timestamp) return;
  if (!session.startedAt || timestamp < session.startedAt) session.startedAt = timestamp;
  if (!session.updatedAt || timestamp > session.updatedAt) session.updatedAt = timestamp;
}

function commandToText(command) {
  if (Array.isArray(command)) return command.map((part) => displayValue(part, 1000)).join(' ');
  return displayValue(command, 2000);
}

function durationMs(duration) {
  if (!duration || typeof duration !== 'object') return 0;
  const secs = Number(duration.secs || 0);
  const nanos = Number(duration.nanos || 0);
  return Math.round(secs * 1000 + nanos / 1e6);
}

const { makeRawEvent } = createCodexRawParser({
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
});

function relatedReasoning(eventText, responseText) {
  const a = String(eventText || '').trim();
  const b = String(responseText || '').trim();
  if (!a || !b) return false;
  return a === b || b.includes(a) || a.includes(b);
}

function parseFormattedCommandOutput(text) {
  const source = String(text || '');
  const match = source.match(/^Exit code:\s*(-?\d+)\r?\nWall time:\s*([^\n]+)\r?\nOutput:\r?\n([\s\S]*)$/);
  if (!match) return null;
  return {
    exitCode: Number(match[1]),
    wallTime: match[2],
    output: match[3],
  };
}

function parseOutputEnvelope(text) {
  const obj = safeJsonParse(text);
  if (obj && typeof obj === 'object') return obj;
  return null;
}

function numericExitCode(...values) {
  for (const value of values) {
    if (isFiniteNumberValue(value)) return Number(value);
  }
  return null;
}

function patchFilesFromPatchInput(input) {
  const matches = [];
  const regex = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match;
  while ((match = regex.exec(String(input || '')))) {
    matches.push(match[1]);
  }
  return [...new Set(matches)];
}

function touchFilesFromOutputText(text) {
  const files = [];
  const regex = /^[AMDR?]+\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(String(text || '')))) {
    files.push(match[1].trim());
  }
  return [...new Set(files)];
}

function patchOutputText(envelope, rawOutput) {
  return stringifyValue(envelope && Object.hasOwn(envelope, 'output') ? envelope.output : rawOutput).trim();
}

function patchOutputHasFailure(text) {
  return /(?:apply_patch verification failed|failed to find expected lines|invalid patch|error:)/i.test(String(text || ''));
}

function patchOutputHasSuccess(text) {
  return /(?:success\. updated the following files|^done\b|patch applied)/i.test(String(text || '').trim());
}

function inferPatchSuccess(patchEnd, customOutputObj, rawOutput) {
  const explicitStatus = String(patchEnd?.status || customOutputObj?.metadata?.status || '').toLowerCase();
  if (explicitStatus === 'failed' || explicitStatus === 'declined') return false;
  if (explicitStatus === 'success') return true;
  if (explicitStatus === 'incomplete') return null;
  if (patchEnd && Object.hasOwn(patchEnd.parsed?.payload || {}, 'success')) {
    return patchEnd.parsed.payload.success === true;
  }
  const exitCode = customOutputObj?.metadata?.exit_code;
  if (isFiniteNumberValue(exitCode)) return Number(exitCode) === 0;
  const outputSignals = [
    patchEnd?.parsed?.payload?.stderr,
    patchEnd?.parsed?.payload?.stdout,
    patchOutputText(customOutputObj, rawOutput),
  ];
  if (outputSignals.some((text) => patchOutputHasFailure(text))) return false;
  if (outputSignals.some((text) => patchOutputHasSuccess(text))) return true;
  return null;
}

function humanizeProtocolSubtype(subtype) {
  const text = String(subtype || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Protocol event';
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function protocolLabelFor(subtype, fallback = '') {
  return PROTOCOL_LABELS[subtype] || humanizeProtocolSubtype(fallback || subtype);
}

function readXmlTag(source, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(source || '').match(pattern);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function readRawXmlTag(source, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(source || '').match(pattern);
  return match ? match[1].trim() : '';
}

function protocolTagName(source) {
  const match = String(source || '').trim().match(/^<([A-Za-z][\w:-]*)(?:\s|>)/);
  return match ? match[1] : '';
}

function firstProtocolBodyLine(source) {
  for (const line of String(source || '').split(/\r?\n/)) {
    const cleaned = line.replace(/^#+\s*/, '').replace(/<\/?[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned;
  }
  return '';
}

function formatPreviewEntries(entries) {
  return entries
    .filter((entry) => entry && entry.key && entry.value !== '')
    .map((entry) => `${entry.key}: ${displayValue(entry.value, 1000).trim()}`)
    .join('; ');
}

function payloadPreview(payload, keys) {
  if (!payload || typeof payload !== 'object') return '';
  return formatPreviewEntries(keys.map((key) => ({ key, value: payload[key] == null ? '' : payload[key] })));
}

function protocolPreviewFor(raw, subtype) {
  const source = String(raw.messageText || raw.searchText || raw.preview || '').trim();

  if (subtype === 'session_meta') {
    return payloadPreview(raw.parsed?.payload, ['id', 'cwd', 'originator']) || raw.preview;
  }
  if (subtype === 'session_configured') {
    return payloadPreview(raw.parsed?.payload, ['thread_name', 'cwd', 'model']) || raw.preview;
  }
  if (subtype === 'thread_goal_updated') {
    return truncate(displayValue(firstNonEmpty(raw.parsed?.payload?.thread_goal, raw.parsed?.payload?.goal, raw.preview, 'Thread goal updated'), 1000));
  }
  if (subtype === 'goal_context') {
    return truncate(readXmlTag(source, 'objective') || firstProtocolBodyLine(source) || 'Goal context');
  }
  if (subtype === 'turn_context') {
    return payloadPreview(raw.parsed?.payload, ['turn_id', 'cwd', 'model']) || raw.preview;
  }
  if (subtype === 'token_count') {
    return formatTokenUsagePreview(raw.parsed?.payload) || raw.preview;
  }
  if (subtype === 'agents_instructions') {
    const target = source.match(/^#\s*AGENTS\.md instructions(?:\s+for\s+(.+))?/i)?.[1];
    return target ? `Repository instructions for ${target.trim()}` : 'Repository AGENTS.md instructions';
  }
  if (subtype === 'environment_context') {
    return formatPreviewEntries([
      { key: 'cwd', value: readXmlTag(source, 'cwd') },
      { key: 'shell', value: readXmlTag(source, 'shell') },
      { key: 'current_date', value: readXmlTag(source, 'current_date') },
      { key: 'timezone', value: readXmlTag(source, 'timezone') },
    ]) || 'Environment context';
  }
  if (subtype === 'developer_collaboration_mode') {
    const mode = source.match(/#\s*Collaboration Mode:\s*([^\n]+)/i)?.[1];
    return mode ? `mode: ${mode.trim()}` : 'Collaboration-mode instructions';
  }
  if (subtype === 'developer_permissions') {
    return firstProtocolBodyLine(source) || 'Filesystem and command permission policy';
  }
  if (subtype === 'developer_instruction') {
    return firstProtocolBodyLine(source) || 'Developer instruction';
  }
  if (subtype === 'user_shell_command') {
    return truncate(readXmlTag(source, 'user_shell_command') || firstProtocolBodyLine(source) || 'User shell command');
  }
  if (subtype === 'skill_injection') {
    return firstProtocolBodyLine(source) || 'Skill instructions';
  }
  if (subtype === 'image_wrapper') {
    return 'Image attachment metadata';
  }
  if (subtype === 'turn_aborted_marker') {
    return 'Turn aborted marker';
  }
  if (subtype === 'meta_block') {
    const tagName = protocolTagName(source);
    return tagName ? `Protocol metadata block: <${tagName}>` : 'Protocol metadata block';
  }

  return truncate(firstProtocolBodyLine(source) || raw.preview || protocolLabelFor(subtype));
}

function classifyProtocolText(text, role) {
  const source = String(text || '');
  if (role === 'developer') {
    if (source.startsWith('<permissions instructions>')) return 'developer_permissions';
    if (source.startsWith('<collaboration_mode>')) return 'developer_collaboration_mode';
    if (source.startsWith('<environment_context>')) return 'environment_context';
    if (source.startsWith('<codex_internal_context source="goal">')) return 'goal_context';
    if (source.startsWith('<skill>')) return 'skill_injection';
    if (source.startsWith('<')) return 'meta_block';
    return '';
  }
  if (source.startsWith('# AGENTS.md instructions')) return 'agents_instructions';
  if (source.startsWith('<environment_context>')) return 'environment_context';
  if (source.startsWith('<turn_aborted>')) return 'turn_aborted_marker';
  if (source.startsWith('<codex_internal_context source="goal">')) return 'goal_context';
  if (source.startsWith('<user_shell_command>')) return 'user_shell_command';
  if (source.startsWith('<skill>')) return 'skill_injection';
  if (source.startsWith('<image ')) return 'image_wrapper';
  if (source.startsWith('<')) return 'meta_block';
  return '';
}

function commandArgsFromRaw(raw) {
  const args = coerceJsonValue(raw?.output);
  return args && typeof args === 'object' ? args : null;
}

function toolOutputEnvelope(raw) {
  return parseOutputEnvelope(raw?.output);
}

function structuredOutputValue(value) {
  const envelope = parseOutputEnvelope(value);
  if (envelope && Object.hasOwn(envelope, 'output')) return envelope.output;
  return value;
}

function rawMeta(raw) {
  return {
    timestamp: raw.timestamp || '',
    turnId: raw.turnId || '',
    status: raw.status || '',
    severity: raw.payloadType === 'error' ? 'error' : 'normal',
    toolName: raw.toolName || '',
    touchedFiles: raw.touchedFiles || [],
    outputStats: {
      exitCode: raw.exitCode,
      durationMs: raw.durationMs,
    },
    channels: [raw.recordType],
    source: raw.source || null,
  };
}

function logicalMeta(event) {
  return {
    timestamp: sanitizeLogicalEnvelopeValue(event.timestamp || ''),
    turnId: sanitizeLogicalEnvelopeValue(event.turnId || ''),
    status: sanitizeLogicalEnvelopeValue(event.status || ''),
    severity: sanitizeLogicalEnvelopeValue(event.severity || 'normal'),
    toolName: sanitizeLogicalEnvelopeValue(event.toolName || ''),
    touchedFiles: sanitizeLogicalEnvelopeValue(event.touchedFiles || []),
    outputStats: sanitizeLogicalEnvelopeValue(event.outputStats || {}),
    channels: sanitizeLogicalEnvelopeValue(event.channels || []),
    source: event.source || null,
  };
}

function extractConversationSections(raws) {
  const sections = [];
  maybePushMarkdownSection(sections, 'Message', uniqueNonEmpty(raws.map((raw) => raw.messageText)).join('\n\n'), 'content');
  hideSectionTitle(sections[0]);
  if (!sections.length) sections.push(makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback'));
  return sections;
}

function extractReasoningSections(raws) {
  const sections = [];
  const text = joinBoundedUniqueText(raws.map((raw) => raw.messageText), '\n\n', REASONING_TEXT_LIMIT);
  if (text) {
    maybePushMarkdownSection(sections, 'Reasoning', text, 'content');
    hideSectionTitle(sections[0]);
  } else {
    sections.push(hideSectionTitle(makeNoticeSection('Reasoning', 'This reasoning record did not contain any text.', 'warning', 'content')));
  }
  return sections;
}

function extractPlanSections(raws) {
  const sections = [];
  const planText = stripProposedPlanWrapper(firstNonEmpty(
    raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'message')?.messageText,
    raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'item_completed')?.parsed?.payload?.item?.text,
    raws.find((raw) => raw.recordType === 'event_msg' && ['plan_update', 'plan_delta'].includes(raw.payloadType)) ? planUpdateText(raws.find((raw) => raw.recordType === 'event_msg' && ['plan_update', 'plan_delta'].includes(raw.payloadType))) : '',
  ));
  maybePushMarkdownSection(sections, 'Plan', planText, 'content');
  hideSectionTitle(sections[0]);
  if (!sections.length) sections.push(makeRawJsonSection('Unmodeled plan fields', logicalFallbackPayload(raws), false, 'fallback'));
  return sections;
}

function extractCommandSections(raws, event, session = {}) {
  const timelineSections = [];
  const inspectorSections = [];
  const functionCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
  const functionOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
  const execEnd = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'exec_command_end');
  const execAny = execEnd || raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('exec_command_'));
  const args = commandArgsFromRaw(functionCall);
  const formatted = parseFormattedCommandOutput(functionOutput?.output);
  const commandText = execAny?.commandText || commandToText(args?.command);
  maybePushCodeSection(timelineSections, 'Command', commandText, inferCommandLanguage(commandText, args, commandLanguageContext(session)), 'request');
  if (timelineSections.at(-1)?.type === 'code') timelineSections.at(-1).role = 'command';

  maybePushKvSection(inspectorSections, 'Run context', [
    { key: 'cwd', value: String(execAny?.parsed?.payload?.cwd || args?.workdir || '') },
  ], 'context');

  if (args) {
    inspectorSections.push({ purpose: 'request', type: 'json', title: 'Arguments', value: args });
  }

  const stdout = firstNonEmpty(execEnd?.stdout, execEnd?.aggregatedOutput, execEnd?.parsed?.payload?.formatted_output, formatted?.output);
  const stderr = execEnd?.stderr || execAny?.stderr || '';
  maybePushTerminalSection(timelineSections, 'stdout', stdout, 'stdout', '', 'result');
  maybePushTerminalSection(timelineSections, 'stderr', stderr, 'stderr', '', 'result');

  if (stdout) maybePushParsedOutputSection(inspectorSections, 'stdout structure', stdout, 'result');
  if (stderr) maybePushParsedOutputSection(inspectorSections, 'stderr structure', stderr, 'result');
  if (functionOutput?.output) maybePushParsedOutputSection(inspectorSections, 'Tool output', structuredOutputValue(functionOutput.output), 'result');

  if (!timelineSections.length && !inspectorSections.length) inspectorSections.push(makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback'));
  return { timelineSections, inspectorSections };
}

function extractPatchSections(raws, event, session = {}) {
  const timelineSections = [];
  const inspectorSections = [];
  const customCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const patchEnd = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'patch_apply_end');
  const patchAny = patchEnd || raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('patch_apply_'));
  const envelope = toolOutputEnvelope(customOutput);
  const resultPatchSection = parseUnifiedDiffPatchSection(patchEnd?.parsed?.payload?.changes, session.repoRoot);
  if (resultPatchSection) {
    timelineSections.push(withDetailPurpose(resultPatchSection, 'result'));
  }
  const patchText = customCall?.output || patchAny?.output || '';
  if (!timelineSections.length && patchText.trim() && !maybePushPatchSection(timelineSections, 'Patch', patchText, 'request')) {
    timelineSections.push({ purpose: 'request', type: 'diff', title: 'Patch', text: patchText.trim() });
  }

  const patchFileEntries = diffStatsEntries(patchEnd?.parsed?.payload?.changes, session.repoRoot);
  const fallbackPatchFileEntries = patchFileEntries.length ? [] : diffStatsEntriesFromPatchInput(patchText);
  maybePushKvSection(
    inspectorSections,
    'Files',
    (patchFileEntries.length ? patchFileEntries : fallbackPatchFileEntries)
      .map((entry) => ({ ...entry, fact: 'touchedFile' })),
    'context',
  );
  if (!patchFileEntries.length && !fallbackPatchFileEntries.length) {
    maybePushKvSection(inspectorSections, 'Touched files', event.touchedFiles.map((file) => ({ key: file, value: 'updated', fact: 'touchedFile' })), 'context');
  }

  const noticeText = firstNonEmpty(
    envelope?.output,
    patchAny?.parsed?.payload?.stdout,
    patchAny?.parsed?.payload?.stderr,
    event.status ? `Patch ${event.status}.` : '',
  );
  if (noticeText) {
    inspectorSections.push(makeNoticeSection('Result', noticeText, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info', 'result'));
  }

  if (!timelineSections.length && !inspectorSections.length) {
    inspectorSections.push(makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback'));
  }
  return { timelineSections, inspectorSections };
}

function extractJsReplSections(raws, event) {
  const timelineSections = [];
  const inspectorSections = [];
  const customCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const envelope = toolOutputEnvelope(customOutput);
  maybePushCodeSection(timelineSections, 'JavaScript', customCall?.output, 'javascript', 'request');
  maybePushKvSection(inspectorSections, 'Run context', [
    { key: 'status', value: String(event.status || '') },
    { key: 'exitCode', value: event.outputStats.exitCode == null ? '' : String(event.outputStats.exitCode), fact: 'exitCode' },
    { key: 'durationMs', value: event.outputStats.durationMs == null ? '' : String(event.outputStats.durationMs), fact: 'duration' },
  ], 'context');
  const outputValue = envelope && Object.hasOwn(envelope, 'output') ? envelope.output : customOutput?.output;
  if (coerceJsonValue(outputValue)) {
    timelineSections.push({ purpose: 'result', type: 'json', title: 'Output', value: coerceJsonValue(outputValue) });
  } else {
    maybePushTerminalSection(timelineSections, 'Output', stringifyValue(outputValue), event.status === 'failed' ? 'stderr' : 'stdout', '', 'result');
  }
  if (!timelineSections.length && !inspectorSections.length) {
    inspectorSections.push(makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback'));
  }
  return { timelineSections, inspectorSections };
}

function toolDetailValues(raws) {
  const functionCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
  const functionOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
  const customCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const imageCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'image_generation_call');
  const requestValue = firstNonEmpty(
    commandArgsFromRaw(functionCall),
    coerceJsonValue(customCall?.output),
    functionCall?.output,
    customCall?.output,
    raws.find((raw) => raw.recordType === 'event_msg' && /_begin$/.test(raw.payloadType || ''))?.parsed?.payload,
  );
  const responseEnvelope = toolOutputEnvelope(customOutput);
  const responseValue = firstNonEmpty(
    raws.find((raw) => raw.recordType === 'event_msg' && /_end$/.test(raw.payloadType || ''))?.parsed?.payload,
    imageCall?.parsed?.payload,
    responseEnvelope?.output,
    parseOutputEnvelope(functionOutput?.output),
    functionOutput?.output,
    customOutput?.output,
  );
  return { requestValue, responseValue };
}

function extractToolSections(raws, event) {
  const sections = [];
  const { requestValue, responseValue } = toolDetailValues(raws);

  maybePushKvSection(sections, 'Tool context', [
    { key: 'tool', value: String(event.toolName || ''), fact: 'tool' },
    { key: 'status', value: String(event.status || '') },
    { key: 'durationMs', value: event.outputStats.durationMs == null ? '' : String(event.outputStats.durationMs), fact: 'duration' },
  ], 'context');

  if (requestValue) {
    if (typeof requestValue === 'object') {
      sections.push({ purpose: 'request', type: 'json', title: 'Request', value: requestValue });
    } else {
      maybePushStructuredSection(sections, 'Request', requestValue, { purpose: 'request' });
    }
  }

  if (responseValue) {
    if (typeof responseValue === 'object') {
      sections.push({ purpose: 'result', type: 'json', title: 'Response', value: responseValue });
    } else {
      maybePushStructuredSection(sections, 'Response', responseValue, { purpose: 'result' });
    }
  }

  if (!sections.length) sections.push(makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback'));
  return sections;
}

function conciseToolValue(value, budget = 4000) {
  return truncate(redactEmbeddedDataUrls(displayValue(value, budget).trim()), budget);
}

function markdownField(label, value, budget = 4000) {
  const text = conciseToolValue(value, budget);
  if (!text) return '';
  return text.includes('\n') ? `**${label}:**\n\n${text}` : `**${label}:** ${text}`;
}

function requestUserInputSection(requestValue, responseValue) {
  const questions = Array.isArray(requestValue?.questions) ? requestValue.questions : [];
  const answers = responseValue?.answers && typeof responseValue.answers === 'object' ? responseValue.answers : {};
  const items = questions.map((question, index) => {
    if (!question || typeof question !== 'object') return '';
    const sourceId = String(question.id || '');
    const id = conciseToolValue(sourceId, 500);
    const title = conciseToolValue(firstNonEmpty(question.header, id, `Question ${index + 1}`), 200);
    const prompt = conciseToolValue(question.question, 2000);
    const answerValue = answers[sourceId]?.answers || answers[sourceId];
    const answerValues = (Array.isArray(answerValue) ? answerValue : [answerValue]).map((answer) => conciseToolValue(answer, 1000)).filter(Boolean);
    const options = Array.isArray(question.options) ? question.options.map((option) => {
      if (!option || typeof option !== 'object') return null;
      const label = conciseToolValue(option.label, 500);
      if (!label) return null;
      return {
        label,
        description: conciseToolValue(option.description, 1200),
        selected: answerValues.includes(label),
      };
    }).filter(Boolean) : [];
    return { id, title, prompt, options, answers: answerValues };
  }).filter(Boolean);
  return items.length ? { purpose: 'content', type: 'user_input', title: 'User input', questions: items } : null;
}

function goalStatusLabel(status) {
  const normalized = normalizeGoalStatus(status);
  if (normalized === 'complete') return 'Complete';
  if (normalized === 'blocked') return 'Blocked';
  if (normalized === 'active') return 'Active';
  if (normalized === 'budget_limited') return 'Budget limited';
  if (normalized === 'usage_limited') return 'Usage limited';
  if (normalized === 'incomplete') return 'Incomplete';
  return normalized ? humanizeProtocolSubtype(normalized) : '';
}

function goalLimitValue(value) {
  if (value === undefined || value === null || value === '') return 'Unbounded';
  return conciseToolValue(value, 1000);
}

function goalSection(raws, event, requestValue, responseValue, snapshotOverride = null) {
  const response = goalResponseFromValue(responseValue);
  const snapshot = snapshotOverride || response.snapshot;
  const requestSnapshot = goalSnapshotFromGoal(requestValue);
  const objective = conciseToolValue(firstNonEmpty(snapshot?.objective, requestSnapshot?.objective), 4000);
  const status = normalizeGoalStatus(firstNonEmpty(snapshot?.status, responseValue?.status, event.status, requestSnapshot?.status));
  const hasTokenBudget = Boolean(snapshot) || Boolean(requestSnapshot?.hasTokenBudget);
  const tokenBudget = snapshot ? snapshot.tokenBudget : requestSnapshot?.tokenBudget;
  const entries = [
    { key: 'Status', value: goalStatusLabel(status) || status },
    { key: 'Token budget', value: hasTokenBudget ? goalLimitValue(tokenBudget) : '' },
    { key: 'Tokens used', value: snapshot?.tokensUsed == null ? '' : String(snapshot.tokensUsed) },
    { key: 'Time used', value: snapshot?.timeUsedSeconds == null ? '' : `${snapshot.timeUsedSeconds}s` },
    { key: 'Created', value: snapshot?.createdAt == null ? '' : String(snapshot.createdAt) },
    { key: 'Updated', value: snapshot?.updatedAt == null ? '' : String(snapshot.updatedAt) },
    { key: 'Remaining tokens', value: response.hasRemainingTokens ? goalLimitValue(response.remainingTokens) : '' },
  ].filter((entry) => entry.value !== '');
  const lines = [
    `### ${event.label || 'Goal'}`,
    status ? `**Status:** ${goalStatusLabel(status) || status}` : '',
    hasTokenBudget ? `**Token budget:** ${goalLimitValue(tokenBudget)}` : '',
    objective ? `**Objective:**\n\n${objective}` : '',
  ].filter(Boolean);
  const sections = [];
  maybePushMarkdownSection(sections, 'Goal', lines.join('\n\n'), 'content');
  maybePushKvSection(sections, 'Goal usage', entries, 'context');
  if (response.hasCompletionBudgetReport && response.completionBudgetReport != null && response.completionBudgetReport !== '') {
    maybePushStructuredSection(sections, 'Completion budget', response.completionBudgetReport, { purpose: 'context' });
  }
  if (!sections.length) {
    sections.push(hideSectionTitle(makeNoticeSection(event.label || 'Goal', event.preview || event.label || 'Goal', event.severity === 'warning' ? 'warning' : 'info', 'content')));
  }
  return sections;
}

function extractGoalSections(raws, event) {
  const toolInspectorSections = sanitizeToolInspectorSections(extractToolSections(raws, event));
  const { requestValue, responseValue } = toolDetailValues(raws);
  const snapshotRaw = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'thread_goal_updated');
  const normalizedSnapshot = goalSnapshotFromRaw(snapshotRaw);
  const snapshotGoal = normalizedSnapshot?.goal;
  const resolvedResponseValue = responseValue || (snapshotGoal && typeof snapshotGoal === 'object' ? { goal: snapshotGoal } : null);
  const goalSections = goalSection(raws, event, requestValue, resolvedResponseValue, normalizedSnapshot);
  const timelineSections = goalSections.filter((section) => section.purpose === 'content');
  const goalInspectorSections = goalSections.filter((section) => section.purpose !== 'content');
  const hasToolRows = raws.some((raw) => raw.recordType === 'response_item'
    && ['function_call', 'function_call_output'].includes(raw.payloadType));
  return {
    timelineSections,
    inspectorSections: hasToolRows
      ? [...goalInspectorSections, ...toolInspectorSections]
      : snapshotGoal && typeof snapshotGoal === 'object'
        ? [...goalInspectorSections, { purpose: 'result', type: 'json', title: 'Goal status', value: snapshotGoal }]
        : [...goalInspectorSections, ...toolInspectorSections],
  };
}

function viewImageMarkdown(requestValue, responseValue) {
  const dimensions = responseValue && !Array.isArray(responseValue) && typeof responseValue === 'object'
    ? [responseValue.width, responseValue.height].filter((value) => value != null).join(' x ')
    : '';
  return [
    '### Image inspection',
    markdownField('Path', requestValue?.path, 2000),
    markdownField('Detail', requestValue?.detail, 200),
    markdownField('Dimensions', dimensions, 200),
    markdownField('MIME type', responseValue?.mimeType, 200),
  ].filter(Boolean).join('\n\n');
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function imageGenerationMarkdown(raws, responseValue) {
  if (!responseValue || typeof responseValue !== 'object') return '';
  const imageByKey = new Map();
  for (const image of raws.flatMap((raw) => raw.embeddedImages || [])) {
    if (!image?.dedupeKey || imageByKey.has(image.dedupeKey)) continue;
    imageByKey.set(image.dedupeKey, image);
  }
  const images = [...imageByKey.values()];
  const totalBytes = images.reduce((sum, image) => sum + Number(image.estimatedBytes || 0), 0);
  return [
    '### Image generation',
    markdownField('Status', responseValue.status, 200),
    markdownField('Saved image', responseValue.saved_path, 2000),
    markdownField('Generated payload', images.length ? `${images.length} image${images.length === 1 ? '' : 's'}${totalBytes ? `, ${formatBytes(totalBytes)}` : ''}` : '', 200),
    markdownField('Revised prompt', responseValue.revised_prompt, 1200),
  ].filter(Boolean).join('\n\n');
}

function inspectSupportedImageDataUrl(value) {
  const source = String(value || '');
  const match = source.match(/^data:image\/(png|jpeg|gif|webp|avif);base64,([\s\S]*)$/i);
  if (!match) return null;
  const payload = match[2];
  let encodedLength = 0;
  let padding = 0;
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (/\s/.test(char)) continue;
    encodedLength += 1;
    padding = char === '=' ? padding + 1 : 0;
  }
  return {
    mimeType: `image/${match[1].toLowerCase()}`,
    payload,
    encodedLength,
    estimatedBytes: Math.max(0, Math.floor(encodedLength * 3 / 4) - Math.min(padding, 2)),
  };
}

function imageMimeTypeFromBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) return '';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return '';
}

function inspectSupportedBareImageBase64(value) {
  const payload = String(value || '').replace(/\s+/g, '');
  if (payload.length < 64 || payload.length % 4 !== 0) return null;
  if (!/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(payload)) return null;
  const header = Buffer.from(payload.slice(0, Math.min(payload.length, 128)), 'base64');
  const mimeType = imageMimeTypeFromBytes(header);
  if (!mimeType || mimeType === 'image/gif') return null;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return {
    mimeType,
    payload,
    encodedLength: payload.length,
    estimatedBytes: Math.max(0, Math.floor(payload.length * 3 / 4) - padding),
  };
}

function inspectSupportedImagePayload(value, encoding = '') {
  if (encoding === 'bare_base64') return inspectSupportedBareImageBase64(value);
  if (encoding === 'data_url') return inspectSupportedImageDataUrl(value);
  return inspectSupportedImageDataUrl(value) || inspectSupportedBareImageBase64(value);
}

function imagePresentationKey(value, mimeType) {
  const source = String(value || '');
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${mimeType}:${source.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

function externalizeEmbeddedImages(value, source, images = [], jsonPath = [], seen = new WeakSet()) {
  if (typeof value === 'string') {
    const inspected = inspectSupportedImageDataUrl(value);
    if (inspected) {
      images.push({
        previewId: `image-${source.line}-${images.length}`,
        source: {
          file: source.file,
          line: source.line,
          jsonPath,
        },
        mimeType: inspected.mimeType,
        estimatedBytes: inspected.estimatedBytes,
        dedupeKey: imagePresentationKey(value, inspected.mimeType),
      });
      return EMBEDDED_IMAGE_EXTERNALIZED_MARKER;
    }
    if (!/data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(value)) return value;
    return redactEmbeddedBase64DataUrls(
      value,
      /data:image\/(?:png|jpeg|gif|webp|avif);base64,/gi,
      EMBEDDED_IMAGE_EXTERNALIZED_MARKER,
    );
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = externalizeEmbeddedImages(value[index], source, images, [...jsonPath, index], seen);
    }
    return value;
  }
  for (const [key, item] of Object.entries(value)) {
    value[key] = externalizeEmbeddedImages(item, source, images, [...jsonPath, key], seen);
  }
  return value;
}

function externalizeKnownImageGenerationResult(record, source, images = []) {
  const payload = record?.payload || {};
  if (!['image_generation_end', 'image_generation_call'].includes(payload.type)) return;
  if (typeof payload.result !== 'string') return;
  const inspected = inspectSupportedBareImageBase64(payload.result);
  if (!inspected) return;
  images.push({
    previewId: `image-${source.line}-${images.length}`,
    source: {
      file: source.file,
      line: source.line,
      jsonPath: ['payload', 'result'],
    },
    mimeType: inspected.mimeType,
    estimatedBytes: inspected.estimatedBytes,
    dedupeKey: imagePresentationKey(payload.result, inspected.mimeType),
    encoding: 'bare_base64',
    detail: 'generated image',
  });
  payload.result = EMBEDDED_IMAGE_EXTERNALIZED_MARKER;
}

function imagePreviewUrl(sessionId, eventId, previewId) {
  return `/api/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(eventId)}/image-previews/${encodeURIComponent(previewId)}`;
}

function safeImagePreviewUrl(value) {
  const source = String(value || '');
  return /^\/api\/sessions\/[^/?#]+\/events\/[^/?#]+\/image-previews\/[^/?#]+$/.test(source) ? source : '';
}

function imagePreviewSection(raws, event, requestValue) {
  const items = raws.flatMap((raw) => raw.embeddedImages || []);
  const seen = new Set();
  const images = items.map((item, index) => {
    if (!item || seen.has(item.dedupeKey) || seen.size >= IMAGE_PREVIEW_LIMIT) return null;
    seen.add(item.dedupeKey);
    return {
      previewId: item.previewId,
      src: imagePreviewUrl(raws[0]?.sessionId, event.id, item.previewId),
      mimeType: item.mimeType,
      estimatedBytes: item.estimatedBytes,
      detail: conciseToolValue(firstNonEmpty(item.detail, requestValue?.detail), 200),
      alt: `Image preview ${index + 1}`,
    };
  }).filter(Boolean);
  const supportedCount = new Set(items.map((item) => item.dedupeKey).filter(Boolean)).size;
  return {
    purpose: 'content',
    type: 'image_preview',
    title: 'Image preview',
    images,
    notice: supportedCount > images.length
      ? `Showing ${images.length} image previews. ${supportedCount - images.length} additional embedded images remain available through raw refs.`
      : images.length ? '' : 'Image preview is unavailable. The transcript did not retain a supported embedded image.',
  };
}

function sanitizeToolInspectorValue(value, options = {}) {
  return sanitizeToolValue(value, { ...options, marker: TOOL_DATA_URL_MARKER });
}

function sanitizeLogicalEnvelopeValue(value) {
  return sanitizeToolValue(value, { marker: TOOL_DATA_URL_MARKER });
}

function sanitizeLogicalEventDto(dto) {
  const {
    id,
    source,
    rawRefs,
    ...rest
  } = dto;
  return {
    id,
    ...sanitizeLogicalEnvelopeValue(rest),
    source,
    rawRefs,
  };
}

function sanitizeLogicalDetailSection(section) {
  if (section?.type !== 'image_preview') return sanitizeToolInspectorValue(section);
  const sanitized = sanitizeToolInspectorValue(section);
  sanitized.images = (section.images || []).map((image) => {
    const src = safeImagePreviewUrl(image?.src);
    return src ? { ...sanitizeToolInspectorValue(image), src } : null;
  }).filter(Boolean);
  return sanitized;
}

function sanitizeLogicalDetailSections(detailSections) {
  return {
    timelineSections: (detailSections.timelineSections || []).map(sanitizeLogicalDetailSection),
    inspectorSections: (detailSections.inspectorSections || []).map(sanitizeLogicalDetailSection),
  };
}

function statusName(value) {
  const source = String(value || '').trim().toLowerCase();
  return ['completed', 'success', 'running', 'in_progress', 'pending', 'pending_init', 'failed', 'blocked', 'declined'].includes(source) ? source : '';
}

function collaborationStatusEntries(value, fallbackLabel = 'Status', fallbackLabelKind = 'generic') {
  if (!value) return [];
  if (typeof value === 'string') return [{ label: fallbackLabel, labelKind: fallbackLabelKind, status: value }];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const agentLabel = firstNonEmpty(
        item?.agent_name,
        item?.agent_nickname,
        item?.nickname,
        item?.agent_id,
        item?.thread_id,
      );
      return collaborationStatusEntries(
        firstNonEmpty(item?.agent_status, item?.status),
        agentLabel || fallbackLabel,
        agentLabel ? 'agent' : fallbackLabelKind,
      );
    });
  }
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (statusName(key)) return [{ label: fallbackLabel, labelKind: fallbackLabelKind, status: key }];
    if (key === 'status') return collaborationStatusEntries(item, fallbackLabel, fallbackLabelKind);
    if (key === 'previous_status') return collaborationStatusEntries(item, 'Previous status', 'generic');
    return collaborationStatusEntries(item, key, 'agent');
  });
}

function collaborationStatusItems(responseValue) {
  if (!responseValue || typeof responseValue !== 'object') return [];
  const source = firstNonEmpty(
    responseValue.agent_statuses,
    responseValue.statuses,
    responseValue.previous_status,
    responseValue.status,
    responseValue.agents,
  );
  const fallbackLabel = source === responseValue.previous_status ? 'Previous status' : 'Status';
  const items = collaborationStatusEntries(source, fallbackLabel).map((item) => ({
    label: conciseToolValue(item.label, 500),
    labelKind: item.labelKind,
    status: conciseToolValue(item.status, 1000),
  })).filter((item) => item.label && item.status);
  return [...new Map(items.map((item) => [`${item.labelKind}\n${item.label}\n${item.status}`, item])).values()];
}

function collaborationResultEntries(value, label = '') {
  if (!value) return [];
  if (typeof value === 'string') return statusName(label) ? [{ label, value }] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collaborationResultEntries(item?.status, firstNonEmpty(item?.agent_nickname, item?.thread_id, label)));
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (typeof item === 'string' && statusName(key)) return [{ label: label ? `${label} · ${key}` : key, value: item }];
    return collaborationResultEntries(item, key);
  });
}

function collaborationResultMarkdown(responseValue) {
  if (!responseValue || typeof responseValue !== 'object') return '';
  const direct = firstNonEmpty(responseValue.result, responseValue.output, responseValue.message);
  if (direct) return stringifyValue(direct);
  const agentMessages = (Array.isArray(responseValue.agents) ? responseValue.agents : [])
    .map((agent) => ({
      label: firstNonEmpty(agent?.agent_name, agent?.agent_nickname, agent?.nickname, agent?.agent_id, agent?.thread_id),
      message: firstNonEmpty(agent?.last_task_message, agent?.task_message),
    }))
    .filter((agent) => agent.message);
  if (agentMessages.length) {
    return agentMessages.map(({ label, message }) => [
      label ? `### ${label}` : '',
      stringifyValue(message),
    ].filter(Boolean).join('\n\n')).join('\n\n');
  }
  const source = firstNonEmpty(responseValue.agent_statuses, responseValue.statuses, responseValue.previous_status, responseValue.status);
  const entries = collaborationResultEntries(source);
  return [...new Map(entries.map((item) => [`${item.label}\n${item.value}`, item])).values()].map(({ label, value }) => [
    label ? `### ${label}` : '',
    stringifyValue(value),
  ].filter(Boolean).join('\n\n')).join('\n\n');
}

function collaborationResponseCaptured(responseValue) {
  if (!responseValue || typeof responseValue !== 'object') return false;
  return Array.isArray(responseValue.agents)
    || collaborationStatusItems(responseValue).length > 0
    || Boolean(collaborationResultMarkdown(responseValue))
    || Boolean(firstNonEmpty(
      responseValue.agent_id,
      responseValue.new_thread_id,
      responseValue.nickname,
      responseValue.new_agent_nickname,
      responseValue.receiver_agent_nickname,
      responseValue.receiver_thread_id,
      responseValue.prompt,
    ))
    || responseValue.timed_out === true;
}

function hasMeaningfulToolValue(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function collaborationToolSection(toolName, requestValue, responseValue) {
  const definition = agentCoordination.agentCoordinationDefinition(toolName);
  if (!definition) return null;
  const spawnedAgentId = firstNonEmpty(responseValue?.agent_id, responseValue?.new_thread_id);
  const targets = uniqueNonEmpty([
    ...(Array.isArray(requestValue?.targets) ? requestValue.targets : [requestValue?.target]),
    spawnedAgentId,
  ]).map((target) => conciseToolValue(target, 1000));
  const fields = [
    { key: 'Timeout ms', value: requestValue?.timeout_ms },
    { key: 'Agent type', value: requestValue?.agent_type },
    { key: 'Model', value: requestValue?.model },
    { key: 'Reasoning effort', value: requestValue?.reasoning_effort },
    { key: 'Fork context', value: firstNonEmpty(requestValue?.fork_context, requestValue?.fork_turns) },
    { key: 'Task', value: requestValue?.task_name },
    { key: 'Path prefix', value: requestValue?.path_prefix },
    { key: 'Agent count', value: Array.isArray(responseValue?.agents) ? responseValue.agents.length : null },
    { key: 'Nickname', value: firstNonEmpty(responseValue?.nickname, responseValue?.new_agent_nickname) },
    { key: 'Receiver', value: firstNonEmpty(responseValue?.receiver_agent_nickname, responseValue?.receiver_thread_id) },
  ].filter((entry) => entry.value != null && entry.value !== '').map((entry) => ({
    key: entry.key,
    value: conciseToolValue(entry.value, 1000),
  }));
  const message = redactEmbeddedDataUrls(stringifyValue(firstNonEmpty(requestValue?.message, responseValue?.prompt)));
  const result = redactEmbeddedDataUrls(collaborationResultMarkdown(responseValue));
  return {
    purpose: 'content',
    type: 'collaboration',
    title: definition.title,
    action: definition.action,
    targets,
    fields,
    statuses: collaborationStatusItems(responseValue),
    timedOut: responseValue?.timed_out === true,
    messageHtml: message ? renderMarkdownToHtml(message) : '',
    resultHtml: result ? renderMarkdownToHtml(result) : '',
  };
}

function sanitizeToolTimelineValue(value, depth = 0) {
  if (depth > 5) return '[nested value omitted]';
  if (typeof value === 'string') {
    return truncate(redactEmbeddedDataUrls(value, TIMELINE_DATA_URL_MARKER), 4000);
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 12).map((item) => sanitizeToolTimelineValue(item, depth + 1));
    if (value.length > items.length) items.push(`[${value.length - items.length} more items omitted]`);
    return items;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const usedKeys = new Set();
    const summarized = Object.fromEntries(entries.slice(0, 24).map(([key, item]) => [
      uniqueSanitizedObjectKey(key, usedKeys, TIMELINE_DATA_URL_MARKER),
      sanitizeToolTimelineValue(item, depth + 1),
    ]));
    if (entries.length > 24) summarized['[additional fields omitted]'] = entries.length - 24;
    return summarized;
  }
  return String(value);
}

function maybePushToolSummaryCodeSection(sections, title, value, purpose) {
  if (value == null || value === '') return;
  const summarized = sanitizeToolTimelineValue(value);
  maybePushCodeSection(sections, title, stringifyValue(summarized), typeof summarized === 'object' ? 'json' : 'text', purpose);
}

function mcpPayloadValue(value) {
  if (!value || typeof value !== 'object') return value;
  return firstNonEmpty(value.result, value.output, value.response, value.message, value.content, value.data, value);
}

function isTextualMcpMime(mime) {
  const value = String(mime || '').toLowerCase();
  return value.startsWith('text/') || value === 'application/json' || /\+json$/.test(value);
}

function isMcpMediaPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = String(value.type || '').toLowerCase();
  const mime = String(firstNonEmpty(value.mimeType, value.mime_type) || '').toLowerCase();
  const mediaType = ['image', 'audio', 'video', 'blob', 'binary'].includes(type);
  const mediaMime = mime && !isTextualMcpMime(mime);
  const hasBarePayload = ['blob', 'base64'].some((key) => Object.hasOwn(value, key));
  return Boolean(mediaType || mediaMime || hasBarePayload);
}

function mcpTextFragments(value, depth = 0, key = '') {
  if (value == null || depth > 6) return [];
  const normalizedKey = String(key || '').toLowerCase();
  if (['blob', 'base64'].includes(normalizedKey)) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => mcpTextFragments(item, depth + 1, key));
  if (typeof value !== 'object') return [];
  if (isMcpMediaPayload(value)) return [];
  if (typeof value.text === 'string') return [value.text];
  if (typeof value.content === 'string') return [value.content];
  return Object.entries(value).flatMap(([key, item]) => {
    if (['type', 'mimeType', 'mime_type', 'annotations', 'blob', 'base64'].includes(key)) return [];
    return mcpTextFragments(item, depth + 1, key);
  });
}

function pushMcpRequestSummary(sections, event, requestValue) {
  if (!requestValue || typeof requestValue !== 'object') {
    maybePushToolSummaryCodeSection(sections, 'Request summary', requestValue, 'request');
    return;
  }
  const payload = firstNonEmpty(requestValue.arguments, requestValue.input, requestValue.request, mcpPayloadValue(requestValue));
  const code = firstNonEmpty(payload?.code, requestValue.code, payload?.script, requestValue.script);
  const language = String(firstNonEmpty(payload?.language, requestValue.language, event.toolName === 'js' ? 'javascript' : '') || '').toLowerCase();
  if (code) {
    maybePushCodeSection(sections, language === 'javascript' ? 'JavaScript' : 'Code', String(code), language || 'text', 'request');
  }
  const entries = Object.entries(payload && typeof payload === 'object' ? payload : requestValue)
    .filter(([key, value]) => !['code', 'script'].includes(key) && value != null && value !== '' && typeof value !== 'object')
    .slice(0, 8)
    .map(([key, value]) => ({ key, value: conciseToolValue(value, 1000) }));
  if (entries.length) sections.push({ purpose: 'request', type: 'kv', title: 'Request', entries });
  if (!code && !entries.length) maybePushToolSummaryCodeSection(sections, 'Request summary', requestValue, 'request');
}

function sanitizeMcpTimelineValue(value, depth = 0, key = '') {
  if (depth > 5) return '[nested value omitted]';
  const normalizedKey = String(key || '').toLowerCase();
  if (['blob', 'base64'].includes(normalizedKey)) return '[non-text MCP payload omitted]';
  if (typeof value === 'string') return truncate(redactEmbeddedDataUrls(value, TIMELINE_DATA_URL_MARKER), 4000);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 12).map((item) => sanitizeMcpTimelineValue(item, depth + 1, key));
    if (value.length > items.length) items.push(`[${value.length - items.length} more items omitted]`);
    return items;
  }
  if (typeof value !== 'object') return String(value);
  if (isMcpMediaPayload(value)) return '[non-text MCP payload omitted]';
  const entries = Object.entries(value);
  const usedKeys = new Set();
  const summarized = Object.fromEntries(entries.slice(0, 24).map(([entryKey, item]) => [
    uniqueSanitizedObjectKey(entryKey, usedKeys, TIMELINE_DATA_URL_MARKER),
    sanitizeMcpTimelineValue(item, depth + 1, entryKey),
  ]));
  if (entries.length > 24) summarized['[additional fields omitted]'] = entries.length - 24;
  return summarized;
}
function pushMcpResponseSummary(sections, responseValue) {
  const payload = mcpPayloadValue(responseValue);
  const fragments = mcpTextFragments(payload).map((item) => item.trim()).filter(Boolean);
  const text = uniqueNonEmpty(fragments).join('\n\n');
  if (text) {
    maybePushTerminalSection(sections, 'Result', truncatePreservingWhitespace(redactEmbeddedDataUrls(text, TIMELINE_DATA_URL_MARKER), 4000), 'stdout', '', 'result');
    return;
  }
  const summarized = sanitizeMcpTimelineValue(payload);
  maybePushCodeSection(sections, 'Response summary', stringifyValue(summarized), typeof summarized === 'object' ? 'json' : 'text', 'result');
}

function extractMcpSections(raws, event) {
  const toolInspectorSections = extractToolSections(raws, event);
  const { requestValue, responseValue } = toolDetailValues(raws);
  const timelineSections = [];
  pushMcpRequestSummary(timelineSections, event, requestValue);
  pushMcpResponseSummary(timelineSections, responseValue);
  if (!timelineSections.length) {
    timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info', 'result')));
  }
  return {
    timelineSections: sanitizeUnmodeledToolTimelineSections(timelineSections),
    inspectorSections: sanitizeToolInspectorSections(toolInspectorSections),
  };
}
function sanitizeUnmodeledToolTimelineSection(section) {
  const sanitized = sanitizeToolValue(section, { marker: TIMELINE_DATA_URL_MARKER });
  if (sanitized.type === 'code') sanitized.code = truncatePreservingWhitespace(sanitized.code, 4000);
  if (sanitized.type === 'diff' || sanitized.type === 'terminal') sanitized.text = truncatePreservingWhitespace(sanitized.text, 4000);
  if (sanitized.type === 'notice') sanitized.text = truncatePreservingWhitespace(sanitized.text, 4000);
  return sanitized;
}

function sanitizeUnmodeledToolTimelineSections(sections) {
  return (sections || []).map(sanitizeUnmodeledToolTimelineSection);
}

function sanitizeToolInspectorSections(sections, imagePreview = null) {
  const previewSources = new Set((imagePreview?.images || []).map((image) => image.src));
  return (sections || []).map((section) => sanitizeToolInspectorValue(section, {
    previewSources: section.purpose === 'result' ? previewSources : new Set(),
  }));
}

function extractToolOperationSections(raws, event) {
  const toolInspectorSections = extractToolSections(raws, event);
  const { requestValue, responseValue } = toolDetailValues(raws);
  const timelineSections = [];
  const userInput = event.toolName === 'request_user_input' ? requestUserInputSection(requestValue, responseValue) : null;
  if (userInput) timelineSections.push(userInput);
  const collaboration = collaborationToolSection(event.toolName, requestValue, responseValue);
  if (collaboration) timelineSections.push(collaboration);
  if (collaboration && hasMeaningfulToolValue(responseValue) && !collaborationResponseCaptured(responseValue)) {
    maybePushToolSummaryCodeSection(timelineSections, 'Response summary', responseValue, 'result');
  }
  const markdown = event.toolName === 'view_image' ? viewImageMarkdown(requestValue, responseValue) : '';
  maybePushMarkdownSection(timelineSections, 'Other tool call', markdown, 'content');
  const imageGeneration = event.toolName === 'image_generation' ? imageGenerationMarkdown(raws, responseValue) : '';
  maybePushMarkdownSection(timelineSections, 'Image generation', imageGeneration, 'content');
  if (timelineSections.length
      && !collaboration
      && event.toolName !== 'update_plan'
      && typeof responseValue !== 'object'
      && hasMeaningfulToolValue(responseValue)) {
    maybePushToolSummaryCodeSection(timelineSections, 'Response summary', responseValue, 'result');
  }
  if (!timelineSections.length) {
    maybePushToolSummaryCodeSection(timelineSections, 'Request summary', requestValue, 'request');
    maybePushToolSummaryCodeSection(timelineSections, 'Response summary', responseValue, 'result');
  }
  if (!timelineSections.length) {
    timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info', 'result')));
  }
  const imagePreview = ['view_image', 'image_generation'].includes(event.toolName) ? imagePreviewSection(raws, event, requestValue) : null;
  const inspectorSections = sanitizeToolInspectorSections(toolInspectorSections, imagePreview);
  return {
    timelineSections,
    inspectorSections: imagePreview ? [imagePreview, ...inspectorSections] : inspectorSections,
  };
}

function updatePlanSection(requestValue) {
  if (!requestValue || typeof requestValue !== 'object') return null;
  const explanation = truncatePreservingWhitespace(redactEmbeddedDataUrls(displayValue(requestValue.explanation, 4000).trim()), 4000);
  const steps = Array.isArray(requestValue.plan) ? requestValue.plan : [];
  const items = steps.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const step = conciseToolValue(item.step, 2000);
    const status = conciseToolValue(item.status, 200);
    if (!step && !status) return null;
    return { step: step || '(unnamed step)', status };
  }).filter(Boolean);
  if (!explanation && !items.length) return null;
  return {
    purpose: 'content',
    type: 'plan_update',
    title: 'Plan update',
    explanationHtml: explanation ? renderMarkdownToHtml(explanation) : '',
    steps: items,
  };
}

function extractUpdatePlanSections(raws, event) {
  const toolInspectorSections = extractToolSections(raws, event);
  const { requestValue, responseValue } = toolDetailValues(raws);
  const timelineSections = [];
  const planUpdate = updatePlanSection(requestValue);
  if (planUpdate) timelineSections.push(planUpdate);
  if (!timelineSections.length) {
    maybePushToolSummaryCodeSection(timelineSections, 'Request summary', requestValue, 'request');
    maybePushToolSummaryCodeSection(timelineSections, 'Response summary', responseValue, 'result');
  }
  if (!timelineSections.length) {
    timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info', 'result')));
  }
  return {
    timelineSections,
    inspectorSections: sanitizeToolInspectorSections(toolInspectorSections),
  };
}

const CODE_MODE_WEB_OPERATION_TITLES = Object.freeze({
  search_query: 'Web search',
  image_query: 'Image search',
  open: 'Open webpage',
  click: 'Follow web link',
  find: 'Find on page',
  screenshot: 'Web screenshot',
  finance: 'Finance lookup',
  weather: 'Weather lookup',
  sports: 'Sports lookup',
  time: 'Time lookup',
});

const CODE_MODE_WEB_GROUP_TITLES = Object.freeze({
  search_query: 'Queries',
  image_query: 'Image queries',
  open: 'Pages',
  click: 'Links',
  find: 'Page matches',
  screenshot: 'Screenshots',
  finance: 'Finance requests',
  weather: 'Weather requests',
  sports: 'Sports requests',
  time: 'Time requests',
});

const CODE_MODE_WEB_PRIMARY_KEYS = Object.freeze([
  'q',
  'ref_id',
  'ticker',
  'location',
  'team',
  'utc_offset',
  'id',
]);

const CODE_MODE_WEB_FIELD_LABELS = Object.freeze({
  lineno: 'Line number',
  id: 'Link ID',
  pageno: 'Page number',
  response_length: 'Response length',
  utc_offset: 'UTC offset',
  date_from: 'From',
  date_to: 'To',
  num_games: 'Count',
});

function codeModeWebFieldLabel(key) {
  return CODE_MODE_WEB_FIELD_LABELS[key] || humanizeProtocolSubtype(key);
}

function codeModeWebOperationKeys(requestValue) {
  if (!requestValue || typeof requestValue !== 'object' || Array.isArray(requestValue)) return [];
  return Object.keys(CODE_MODE_WEB_OPERATION_TITLES)
    .filter((key) => Array.isArray(requestValue[key]) && requestValue[key].length > 0);
}

function codeModeWebProjectionTitle(requestValue) {
  const operationKeys = codeModeWebOperationKeys(requestValue);
  if (operationKeys.length === 1) return CODE_MODE_WEB_OPERATION_TITLES[operationKeys[0]];
  if (operationKeys.length > 1) return 'Web browsing operation';
  return 'Web request';
}

function codeModeWebItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { primary: conciseToolValue(item, 4000), entries: [] };
  }
  const primaryKey = CODE_MODE_WEB_PRIMARY_KEYS.find((key) => item[key] != null && item[key] !== '');
  const entries = Object.entries(item)
    .filter(([key, value]) => key !== primaryKey && value != null && value !== '')
    .map(([key, value]) => ({
      key: codeModeWebFieldLabel(key),
      value: conciseToolValue(value, 2000),
    }));
  return {
    primary: conciseToolValue(primaryKey ? item[primaryKey] : item, 4000),
    entries,
  };
}

function codeModeWebRequestSection(requestValue) {
  const args = requestValue && typeof requestValue === 'object' && !Array.isArray(requestValue)
    ? requestValue
    : {};
  const groups = codeModeWebOperationKeys(args).map((key) => ({
    kind: key,
    title: CODE_MODE_WEB_GROUP_TITLES[key],
    items: args[key].map(codeModeWebItem).filter((item) => item.primary || item.entries.length),
  })).filter((group) => group.items.length);
  const options = Object.entries(args)
    .filter(([key, value]) => !Object.hasOwn(CODE_MODE_WEB_OPERATION_TITLES, key) && value != null && value !== '')
    .map(([key, value]) => ({
      key: codeModeWebFieldLabel(key),
      value: conciseToolValue(value, 2000),
    }));
  if (!groups.length && !options.length) return null;
  return {
    purpose: 'request',
    type: 'web_request',
    title: 'Web request',
    groups,
    options,
  };
}

function codeModeWebResultSection(resultText) {
  const source = truncatePreservingWhitespace(
    redactEmbeddedDataUrls(String(resultText || '').trim()),
    100000,
  );
  if (!source) return null;
  return {
    purpose: 'result',
    type: 'markdown',
    role: 'web_result',
    title: 'Web results',
    html: renderMarkdownToHtml(source),
  };
}

function codeModeToolProjectionTitle(toolName, requestValue) {
  if (toolName === 'web__run') return codeModeWebProjectionTitle(requestValue);
  return codeModeTools.codeModeToolDefinition(toolName)?.title || humanizeProtocolSubtype(toolName);
}

function isBoundedCodeModeStructuredResult(value) {
  if (!value || typeof value !== 'object') return true;
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current.value || typeof current.value !== 'object' || seen.has(current.value)) continue;
    seen.add(current.value);
    nodes += 1;
    if (nodes > CODE_MODE_STRUCTURED_RESULT_MAX_NODES
        || current.depth > CODE_MODE_STRUCTURED_RESULT_MAX_DEPTH) return false;
    for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
      if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function codeModeStructuredResponseValue(resultText) {
  const source = String(resultText || '');
  if (!source || source.length > CODE_MODE_STRUCTURED_RESULT_MAX_CHARS) return null;
  const value = coerceJsonValue(source);
  return value != null && isBoundedCodeModeStructuredResult(value) ? value : null;
}

function codeModeShellRequestSections(requestValue, session) {
  const sections = [];
  const args = requestValue && typeof requestValue === 'object' && !Array.isArray(requestValue)
    ? requestValue
    : {};
  const command = commandToText(firstNonEmpty(args.command, args.cmd));
  maybePushCodeSection(
    sections,
    'Command',
    command,
    inferCommandLanguage(command, args, commandLanguageContext(session)),
    'request',
  );
  if (sections.at(-1)?.type === 'code') sections.at(-1).role = 'command';
  maybePushKvSection(sections, 'Run context', [
    { key: 'cwd', value: conciseToolValue(firstNonEmpty(args.workdir, args.cwd), 2000) },
    { key: 'Timeout ms', value: conciseToolValue(args.timeout_ms ?? args.timeoutMs, 200) },
    { key: 'Sandbox permissions', value: conciseToolValue(args.sandbox_permissions, 200) },
  ], 'context');
  return sections;
}

function codeModeShellResultSections(resultText) {
  const sections = [];
  const formatted = parseFormattedCommandOutput(resultText);
  if (formatted) {
    maybePushKvSection(sections, 'Run result', [
      { key: 'Exit code', value: String(formatted.exitCode) },
      { key: 'Wall time', value: formatted.wallTime },
    ], 'result');
    maybePushTerminalSection(sections, 'Output', formatted.output, 'stdout', '', 'result');
  } else {
    maybePushTerminalSection(sections, 'Result', resultText, 'stdout', '', 'result');
  }
  return sections;
}

function codeModeToolProjectionSection(call, session = {}) {
  const toolName = String(call?.toolName || '');
  const requestValue = call?.requestValue;
  const associated = call?.resultAssociation
    === codeModePresentationContract.CODE_MODE_RESULT_ASSOCIATION.BOUNDED;
  const responseValue = associated ? codeModeStructuredResponseValue(call.resultText) : null;
  const requestSections = [];
  const resultSections = [];

  if (toolName === 'update_plan') {
    const planUpdate = updatePlanSection(requestValue);
    if (planUpdate) requestSections.push(planUpdate);
  } else if (toolName === 'request_user_input') {
    const userInput = requestUserInputSection(requestValue, responseValue);
    if (userInput) requestSections.push(userInput);
  } else if (['shell_command', 'exec_command'].includes(toolName)) {
    requestSections.push(...codeModeShellRequestSections(requestValue, session));
  } else if (toolName === 'apply_patch') {
    const patchText = typeof requestValue === 'string' ? requestValue : String(requestValue?.patch || '');
    if (patchText && !maybePushPatchSection(requestSections, 'Patch', patchText, 'request')) {
      maybePushCodeSection(requestSections, 'Patch', patchText, 'diff', 'request');
    }
  } else if (toolName === 'view_image') {
    const dimensions = responseValue && !Array.isArray(responseValue) && typeof responseValue === 'object'
      ? [responseValue.width, responseValue.height].filter((value) => value != null).join(' x ')
      : '';
    maybePushKvSection(requestSections, 'Image inspection', [
      { key: 'Path', value: conciseToolValue(requestValue?.path, 2000) },
      { key: 'Detail', value: conciseToolValue(requestValue?.detail, 200) },
      { key: 'Dimensions', value: conciseToolValue(dimensions, 200) },
      { key: 'MIME type', value: conciseToolValue(firstNonEmpty(responseValue?.mimeType, responseValue?.mime_type), 200) },
    ], 'request');
  } else if (toolName === 'web__run') {
    const webRequest = codeModeWebRequestSection(requestValue);
    if (webRequest) requestSections.push(webRequest);
  } else {
    const collaboration = collaborationToolSection(toolName, requestValue, responseValue);
    if (collaboration) requestSections.push(collaboration);
  }

  if (!requestSections.length) maybePushToolSummaryCodeSection(requestSections, 'Request summary', requestValue, 'request');
  if (!requestSections.length) requestSections.push(makeNoticeSection('Declared request', toolName, 'info', 'request'));

  if (associated && ['shell_command', 'exec_command'].includes(toolName)) {
    resultSections.push(...codeModeShellResultSections(call.resultText));
  } else if (associated && toolName === 'web__run') {
    const webResult = codeModeWebResultSection(call.resultText);
    if (webResult) resultSections.push(webResult);
  } else if (associated && toolName !== 'update_plan' && toolName !== 'request_user_input') {
    const collaboration = collaborationToolSection(toolName, requestValue, responseValue);
    if (!collaboration || !collaborationResponseCaptured(responseValue)) {
      maybePushToolSummaryCodeSection(resultSections, 'Response summary', responseValue == null ? call.resultText : responseValue, 'result');
    }
  }
  if (associated) {
    resultSections.push({
      purpose: 'result',
      type: 'code_mode_source',
      title: 'Associated result',
      code: String(call.resultText || ''),
      language: 'text',
    });
  }

  return {
    purpose: 'content',
    type: 'code_mode_tool_projection',
    title: codeModeToolProjectionTitle(toolName, requestValue),
    toolName,
    requestEvidence: codeModePresentationContract.CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE,
    resultAssociation: associated
      ? codeModePresentationContract.CODE_MODE_RESULT_ASSOCIATION.BOUNDED
      : codeModePresentationContract.CODE_MODE_RESULT_ASSOCIATION.NONE,
    requestSections: sanitizeUnmodeledToolTimelineSections(requestSections).map((section) => withDetailPurpose(section, 'request')),
    resultSections: sanitizeUnmodeledToolTimelineSections(resultSections).map((section) => withDetailPurpose(section, 'result')),
    resultObserved: associated,
    sourceOrder: Number(call?.sourceOrder || 0),
  };
}

function extractWebSearchSections(raws, event) {
  const timelineSections = [];
  const inspectorSections = [];
  const searchCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'web_search_call');
  const searchEnd = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'web_search_end');
  const action = searchCall?.parsed?.payload?.action;

  if (typeof action === 'string') {
    maybePushMarkdownSection(timelineSections, 'Search action', action, 'request');
  } else if (action && typeof action === 'object') {
    timelineSections.push({ purpose: 'request', type: 'json', title: 'Search action', value: action });
  }

  maybePushKvSection(inspectorSections, 'Search status', [
    { key: 'status', value: String(event.status || searchCall?.status || searchEnd?.status || '') },
  ], 'result');

  if (searchEnd?.parsed?.payload) {
    inspectorSections.push({ purpose: 'result', type: 'json', title: 'Search payload', value: searchEnd.parsed.payload });
  } else if (searchCall?.parsed?.payload) {
    inspectorSections.push({ purpose: 'request', type: 'json', title: 'Search payload', value: searchCall.parsed.payload });
  }

  if (!timelineSections.length && !inspectorSections.length) {
    inspectorSections.push(makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback'));
  }
  return { timelineSections, inspectorSections };
}

function extractProtocolDetailSections(event, raws) {
  const timelineSections = [];
  const inspectorSections = [];
  const primary = raws[0];
  if (['agents_instructions', 'developer_instruction', 'developer_permissions', 'developer_collaboration_mode', 'skill_injection'].includes(event.subtype)) {
    maybePushMarkdownSection(timelineSections, 'Protocol text', primary.messageText, 'content');
    hideSectionTitle(timelineSections[0]);
    return { timelineSections, inspectorSections };
  }
  if (event.subtype === 'goal_context') {
    const objective = readRawXmlTag(primary.messageText, 'objective');
    if (objective) {
      maybePushMarkdownSection(timelineSections, 'Goal objective', objective, 'content');
      hideSectionTitle(timelineSections[0]);
    }
    const budgetMatch = String(primary.messageText || '').match(/Budget:\s*([\s\S]*?)(?:\n\s*\n[A-Z][^\n]*:|<\/codex_internal_context>)/);
    if (budgetMatch) maybePushMarkdownSection(inspectorSections, 'Budget', budgetMatch[1].trim(), 'context');
    maybePushResidualJsonSection(
      inspectorSections,
      'Unmodeled protocol fields',
      primary.parsed?.payload,
      ['type', 'role', 'content'],
    );
    return { timelineSections, inspectorSections };
  }
  if (event.subtype === 'environment_context' || event.subtype === 'session_meta' || event.subtype === 'session_configured' || event.subtype === 'thread_goal_updated' || event.subtype === 'turn_context') {
    const entries = event.subtype === 'environment_context'
      ? taggedBlockEntries(primary.messageText)
      : toKvEntries(primary.parsed?.payload, ['cwd', 'turn_id', 'model', 'id', 'originator', 'thread_id', 'thread_name', 'thread_goal', 'goal']);
    maybePushKvSection(inspectorSections, 'Protocol fields', entries, 'context');
    const consumedKeys = event.subtype === 'environment_context'
      ? ['type', 'role', 'content']
      : kvRepresentedKeys(primary.parsed?.payload);
    maybePushResidualJsonSection(inspectorSections, 'Unmodeled protocol fields', primary.parsed?.payload, consumedKeys);
    return { timelineSections, inspectorSections };
  }
  if (event.subtype === 'token_count') {
    const usageLimits = collectUsageLimitItems(primary.parsed?.payload);
    if (usageLimits.length) inspectorSections.push({ purpose: 'context', type: 'usage_limits', title: 'Usage limits', items: usageLimits });
    const tokenItems = tokenUsageItems(primary.parsed?.payload);
    if (tokenItems.length && !usageLimits.length) inspectorSections.push({ purpose: 'context', type: 'token_usage', title: 'Token usage', items: tokenItems });
    maybePushKvSection(inspectorSections, 'Event fields', toKvEntries(primary.parsed?.payload, ['type', 'turn_id', 'thread_id', 'thread_name']), 'context');
    const consumedKeys = new Set(kvRepresentedKeys(primary.parsed?.payload));
    if (usageLimits.length || tokenItems.length) {
      consumedKeys.add('info');
      consumedKeys.add('rate_limits');
    }
    maybePushResidualJsonSection(inspectorSections, 'Unmodeled protocol fields', primary.parsed?.payload, consumedKeys);
    return { timelineSections, inspectorSections };
  }
  if (event.subtype === 'user_shell_command') {
    maybePushCodeSection(timelineSections, 'Shell command wrapper', primary.messageText, 'shell', 'request');
    return { timelineSections, inspectorSections };
  }
  if (event.subtype === 'image_wrapper' || event.subtype === 'meta_block' || event.subtype === 'turn_aborted_marker') {
    inspectorSections.push(makeNoticeSection('Protocol wrapper', primary.messageText || event.preview, 'warning', 'context'));
    return { timelineSections, inspectorSections };
  }
  if (primary.messageText) {
    maybePushMarkdownSection(timelineSections, 'Protocol text', primary.messageText, 'content');
    hideSectionTitle(timelineSections[0]);
  }
  if (!timelineSections.length) inspectorSections.push(makeRawJsonSection('Unmodeled protocol fields', logicalFallbackPayload(raws), false, 'fallback'));
  return { timelineSections, inspectorSections };
}

function extractProtocolSections(event, raws) {
  const detail = extractProtocolDetailSections(event, raws);
  return [...detail.timelineSections, ...detail.inspectorSections];
}

function extractLifecycleDetailSections(event, raws) {
  const timelineSections = [];
  const inspectorSections = [];
  const primary = raws[0];
  if (event.kind === 'review') {
    return extractReviewLifecycleDetailSections(event, raws);
  }
  let usageLimits = [];
  let tokenItems = [];
  if (event.kind === 'usage_limit_warning') {
    usageLimits = collectUsageLimitItems(primary.parsed?.payload);
    if (usageLimits.length) {
      timelineSections.push({ purpose: 'context', type: 'usage_limits', title: 'Usage limits', items: usageLimits });
    } else {
      timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, 'info', 'context')));
    }
    tokenItems = tokenUsageItems(primary.parsed?.payload);
    if (tokenItems.length && !usageLimits.length) timelineSections.push({ purpose: 'context', type: 'token_usage', title: 'Token usage', items: tokenItems });
  } else {
    timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info', 'result')));
  }
  const eventFields = toKvEntries(primary.parsed?.payload, ['type', 'turn_id', 'thread_id', 'thread_name']);
  maybePushKvSection(inspectorSections, 'Event fields', eventFields, 'context');
  const consumedKeys = new Set(kvRepresentedKeys(primary.parsed?.payload));
  if (usageLimits.length || tokenItems.length) {
    consumedKeys.add('info');
    consumedKeys.add('rate_limits');
  }
  maybePushResidualJsonSection(inspectorSections, 'Unmodeled event fields', primary.parsed?.payload, consumedKeys);
  return { timelineSections, inspectorSections };
}

function extractLifecycleSections(event, raws) {
  const detail = extractLifecycleDetailSections(event, raws);
  return [...detail.timelineSections, ...detail.inspectorSections];
}

function rawConversationRole(raw) {
  if (raw.recordType === 'event_msg' && raw.payloadType === 'user_message') return 'user';
  if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_message') return 'assistant';
  if (raw.recordType === 'response_item' && raw.payloadType === 'message' && ['user', 'assistant'].includes(raw.role)) {
    const subtype = classifyProtocolText(raw.messageText, raw.role);
    if (!subtype && !raw.messageText.startsWith('<proposed_plan>')) return raw.role;
  }
  return '';
}

function rawToolSections(raw, relatedEvent, session = {}) {
  const sections = [];
  const omitPayloadKeys = [];
  const toolName = raw.toolName || relatedEvent?.toolName || relatedEvent?.subtype || '';

  if (raw.recordType === 'response_item' && raw.payloadType === 'function_call' && toolName === 'shell_command') {
    const args = commandArgsFromRaw(raw);
    const commandText = commandToText(args?.command);
    maybePushCodeSection(sections, 'Command', commandText, inferCommandLanguage(commandText, args, commandLanguageContext(session)));
    maybePushKvSection(sections, 'Run context', [
      { key: 'cwd', value: String(args?.workdir || '') },
      { key: 'timeoutMs', value: args?.timeout_ms == null ? '' : String(args.timeout_ms) },
    ]);
    if (args) sections.push({ type: 'json', title: 'Command arguments', value: args });
    omitPayloadKeys.push('arguments');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'function_call_output' && relatedEvent?.kind === 'command') {
    const formatted = parseFormattedCommandOutput(raw.output);
  if (formatted) {
      maybePushKvSection(sections, 'Output status', [
        { key: 'exitCode', value: String(formatted.exitCode) },
        { key: 'wallTime', value: formatted.wallTime },
      ]);
      maybePushTerminalSection(sections, 'stdout', formatted.output, formatted.exitCode === 0 ? 'stdout' : 'stderr');
    } else {
      maybePushStructuredSection(sections, 'Command output', structuredOutputValue(raw.output));
    }
    omitPayloadKeys.push('output');
  } else if (raw.recordType === 'event_msg' && raw.payloadType === 'exec_command_end') {
    maybePushCodeSection(sections, 'Command', raw.commandText, inferCommandLanguage(raw.commandText, {}, commandLanguageContext(session)));
    maybePushKvSection(sections, 'Run context', [
      { key: 'cwd', value: String(raw.parsed?.payload?.cwd || '') },
      { key: 'status', value: String(raw.status || '') },
      { key: 'exitCode', value: raw.exitCode == null ? '' : String(raw.exitCode) },
      { key: 'durationMs', value: raw.durationMs == null ? '' : String(raw.durationMs) },
    ]);
    const stdout = firstNonEmpty(raw.stdout, raw.aggregatedOutput, raw.parsed?.payload?.formatted_output);
    maybePushTerminalSection(sections, 'stdout', stdout, 'stdout');
    maybePushTerminalSection(sections, 'stderr', raw.stderr, 'stderr');
    if (stdout) maybePushParsedOutputSection(sections, 'stdout (structured)', stdout);
    if (raw.stderr) maybePushParsedOutputSection(sections, 'stderr (structured)', raw.stderr);
    omitPayloadKeys.push('command', 'cwd', 'stdout', 'stderr', 'aggregated_output', 'formatted_output', 'exit_code', 'duration', 'status');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call' && toolName === 'apply_patch') {
    if (String(raw.output || '').trim() && !maybePushPatchSection(sections, 'Patch', raw.output)) sections.push({ type: 'diff', title: 'Patch', text: String(raw.output).trim() });
    omitPayloadKeys.push('input');
  } else if (raw.recordType === 'event_msg' && raw.payloadType === 'patch_apply_end') {
    const patchSection = parseUnifiedDiffPatchSection(raw.parsed?.payload?.changes, session.repoRoot);
    if (patchSection) sections.push(patchSection);
    maybePushKvSection(sections, 'Files', diffStatsEntries(raw.parsed?.payload?.changes, session.repoRoot));
    const patchStdout = raw.parsed?.payload?.stdout;
    const patchStderr = raw.parsed?.payload?.stderr;
    const noticeText = [patchStdout, patchStderr].filter((text) => String(text || '').trim()).join('\n')
      || (raw.status ? `Patch ${raw.status}.` : '');
    const patchFailed = raw.parsed?.payload?.success === false
      || patchOutputHasFailure(patchStderr)
      || patchOutputHasFailure(patchStdout);
    if (noticeText) sections.push(makeNoticeSection('Result', noticeText, patchFailed ? 'error' : 'info'));
    maybePushKvSection(sections, 'Apply result', [
      { key: 'status', value: String(raw.status || '') },
      { key: 'durationMs', value: raw.durationMs == null ? '' : String(raw.durationMs) },
    ]);
    omitPayloadKeys.push('stdout', 'stderr', 'changes', 'duration', 'status', 'success');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output' && relatedEvent?.kind === 'patch') {
    const envelope = toolOutputEnvelope(raw);
    const output = firstNonEmpty(envelope?.output, raw.output);
    const patchSuccess = inferPatchSuccess(null, envelope, raw.output);
    if (output) sections.push(makeNoticeSection('Result', stringifyValue(output), patchSuccess === true ? 'info' : patchSuccess === false ? 'error' : 'warning'));
    maybePushKvSection(sections, 'Apply result', [
      { key: 'exitCode', value: envelope?.metadata?.exit_code == null ? '' : String(envelope.metadata.exit_code) },
      { key: 'durationMs', value: envelope?.metadata?.duration_seconds == null ? '' : String(Math.round(Number(envelope.metadata.duration_seconds) * 1000)) },
    ]);
    omitPayloadKeys.push('output');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call' && toolName === 'js_repl') {
    maybePushCodeSection(sections, 'JavaScript', raw.output, 'javascript');
    omitPayloadKeys.push('input');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output' && relatedEvent?.kind === 'js_repl') {
    const envelope = toolOutputEnvelope(raw);
    const outputValue = envelope && Object.hasOwn(envelope, 'output') ? envelope.output : raw.output;
    if (coerceJsonValue(outputValue)) {
      sections.push({ type: 'json', title: 'Output', value: coerceJsonValue(outputValue) });
    } else {
      maybePushTerminalSection(sections, 'Output', stringifyValue(outputValue), relatedEvent.status === 'failed' ? 'stderr' : 'stdout');
    }
    omitPayloadKeys.push('output');
  }

  return { sections, omitPayloadKeys };
}

const codexDetailBuilder = createCodexDetailBuilder({
  envelope: {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    sanitizeLogicalDetailSections,
    sanitizeLogicalEnvelopeValue,
  },
  sourceTrace: {
    classifyProtocolText,
    codexSourceLocator,
    commandLanguageContext,
    logicalMeta,
    rawConversationRole,
    rawEventsForLogicalEvent,
    rawMatchesEvent,
    rawMeta,
    rawRef,
    rawToolSections,
  },
  localization: {
    i18n,
    localizeDetailSections,
    localizedLogicalLabel,
    rawRecordLabel,
  },
  sectionBuilders: {
    filterDetailSections,
    logicalFallbackPayload,
    makeNoticeSection,
    makeRawJsonSection,
    maybePushCodeSection,
    maybePushKvSection,
    maybePushMarkdownSection,
    maybePushStructuredSection,
    maybePushTerminalSection,
    structuredOutputValue,
    toKvEntries,
    withoutKeys,
    withoutSectionTypes,
  },
  sectionExtractors: {
    codeModeToolProjectionSection,
    extractCommandSections,
    extractConversationSections,
    extractJsReplSections,
    extractLifecycleDetailSections,
    extractLifecycleSections,
    extractMcpSections,
    extractPatchSections,
    extractPlanSections,
    extractGoalSections,
    extractProtocolDetailSections,
    extractProtocolSections,
    extractReasoningSections,
    extractToolOperationSections,
    extractToolSections,
    extractUpdatePlanSections,
    extractWebSearchSections,
    inferCommandLanguage,
  },
  codeMode: {
    codeModeAssociableOutputFragments,
    codeModeDisplayOutputText,
    codeModeExecSource,
    codeModeOutputText,
    projectDeclaredCodeModeCalls,
  },
  codeModeTools,
  codeModePresentationContract,
  agentCoordination,
});
const { buildEventDetail: buildParsedEventDetail } = codexDetailBuilder;

function buildEventDetail(session, eventId, layer = 'main', options = {}) {
  const requiresHydration = (session?.rawEvents || []).some((raw) => (
    raw?.sourceKind === CODEX_SOURCE_KIND && !Object.hasOwn(raw, 'parsed')
  ));
  if (requiresHydration) {
    const error = new Error('Compact Codex detail requires source hydration');
    error.code = 'DETAIL_SOURCE_HYDRATION_REQUIRED';
    throw error;
  }
  return buildParsedEventDetail(session, eventId, layer, options);
}

function reviewFindingMarkdown(finding, index) {
  if (!finding || typeof finding !== 'object') return '';
  const title = displayValue(firstNonEmpty(finding.title, finding.summary, `Finding ${index + 1}`), 400).trim();
  const body = displayValue(firstNonEmpty(finding.body, finding.description, finding.message), 4000).trim();
  const priority = finding.priority == null ? displayValue(finding.severity, 100).trim() : `P${displayValue(finding.priority, 100)}`;
  const confidence = finding.confidence_score == null ? displayValue(finding.confidence, 100).trim() : `confidence ${displayValue(finding.confidence_score, 100)}`;
  const location = finding.location || finding.code_location || {};
  const locationText = typeof location === 'object' && location
    ? uniqueNonEmpty([
      displayValue(firstNonEmpty(location.absolute_file_path, location.file_path, location.path), 1000),
      location.line_range?.start ? `lines ${location.line_range.start}-${location.line_range.end || location.line_range.start}` : '',
    ]).join(':')
    : displayValue(location, 400).trim();
  const meta = uniqueNonEmpty([priority, confidence, locationText]).join(' | ');
  return [
    `### ${title}`,
    meta,
    body,
  ].filter(Boolean).join('\n\n');
}

function reviewTargetLabel(target) {
  if (!target || typeof target !== 'object') return '';
  switch (target.type) {
    case 'uncommittedChanges':
    case 'uncommitted_changes':
      return 'Uncommitted changes';
    case 'baseBranch':
    case 'base_branch':
      return target.branch ? `Base branch: ${displayValue(target.branch, 400)}` : 'Base branch';
    case 'commit':
      return uniqueNonEmpty([
        target.sha ? `Commit ${displayValue(target.sha, 200)}` : 'Commit',
        displayValue(target.title, 400),
      ]).join(' - ');
    case 'custom':
      return target.instructions ? `Custom: ${displayValue(target.instructions, 1000)}` : 'Custom';
    default:
      return flattenText(target, 1000);
  }
}

function extractReviewLifecycleDetailSections(event, raws) {
  const timelineSections = [];
  const inspectorSections = [];
  const primary = raws[0];
  const lifecycle = reviewLifecycleFromRaw(primary, { ownerId: primary.sessionId });
  const payload = lifecycle?.payload || primary.parsed?.payload || {};
  const output = payload.review_output || {};

  if (event.subtype === 'entered_review_mode') {
    maybePushKvSection(timelineSections, 'Review request', [
      { key: 'Status', value: 'Started' },
      { key: 'Target', value: reviewTargetLabel(payload.target) },
      { key: 'Hint', value: displayValue(payload.user_facing_hint, 400) },
    ], 'request');
  } else {
    const findings = Array.isArray(output.findings) ? output.findings : [];
    maybePushKvSection(timelineSections, 'Review result', [
      { key: 'Status', value: 'Completed' },
      { key: 'Correctness', value: displayValue(output.overall_correctness, 400) },
      { key: 'Confidence', value: output.overall_confidence_score == null ? displayValue(output.confidence, 400) : displayValue(output.overall_confidence_score, 400) },
      { key: 'Findings', value: String(findings.length) },
    ], 'result');
    maybePushMarkdownSection(timelineSections, 'Overall explanation', displayValue(firstNonEmpty(output.overall_explanation, output.explanation), 4000), 'result');
    if (findings.length) {
      maybePushMarkdownSection(timelineSections, 'Findings', findings.map(reviewFindingMarkdown).filter(Boolean).join('\n\n'), 'result');
    } else {
      timelineSections.push(makeNoticeSection('Findings', 'No findings were reported.', 'info', 'result'));
    }
    if (Object.keys(output).length) inspectorSections.push({ purpose: 'result', type: 'json', title: 'Review output', value: output });
  }

  maybePushKvSection(inspectorSections, 'Event fields', toKvEntries(payload, ['type', 'turn_id', 'thread_id']), 'context');
  const consumedKeys = new Set(kvRepresentedKeys(payload));
  consumedKeys.add(event.subtype === 'entered_review_mode' ? 'target' : 'review_output');
  maybePushResidualJsonSection(inspectorSections, 'Unmodeled event fields', payload, consumedKeys);
  return { timelineSections, inspectorSections };
}

function planUpdateText(raw) {
  const payload = raw.parsed?.payload || {};
  if (payload.explanation) return displayValue(payload.explanation, 8000);
  if (payload.delta) return flattenText(payload.delta, 8000);
  if (Array.isArray(payload.plan)) {
    return payload.plan.map((item) => {
      if (!item || typeof item !== 'object') return displayValue(item, 1000);
      return `${displayValue(item.status || 'pending', 100)}: ${displayValue(firstNonEmpty(item.step, item.text), 1000)}`.trim();
    }).filter(Boolean).join('\n');
  }
  return flattenText(payload, 8000);
}

const codexLogicalBuilder = createCodexLogicalBuilder({
  agentCoordination,
  codeMode: {
    deriveCodeModeFacts,
    projectCodeModeOperations,
  },
  reviewLifecycle: { reviewLifecycleFromRaw },
  envelope: {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    sanitizeLogicalEnvelopeValue,
    rawRef,
    subAgentActivityEventId,
  },
  goal: {
    goalResponseFromValue,
    goalSnapshotFromGoal,
    goalSnapshotFromRaw,
    goalSnapshotSignature,
    goalSnapshotTransition,
    normalizeGoalStatus,
  },
  protocol: {
    classifyProtocolText,
    humanizeProtocolSubtype,
    protocolLabelFor,
    protocolPreviewFor,
  },
  tool: {
    ...toolLifecycleContract,
    commandArgsFromRaw,
    commandToText,
    inferPatchSuccess,
    isFiniteNumberValue,
    numericExitCode,
    parseFormattedCommandOutput,
    parseOutputEnvelope,
    patchFilesFromPatchInput,
    touchFilesFromOutputText,
  },
  text: {
    displayValue,
    firstNonEmpty,
    planUpdateText,
    relatedReasoning,
    truncate,
    uniqueNonEmpty,
  },
  usage: {
    tokenUsageItems,
    collectUsageLimitItems,
    rateLimitReachedType,
  },
});

function countBy(items, fn) {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function eventKindOptionsFromCounts(counts, locale = i18n.DEFAULT_LOCALE, labelFn = eventKindLabel, matchFields = new Map()) {
  return [...counts.entries()]
    .sort((a, b) => labelFn(a[0], locale).localeCompare(labelFn(b[0], locale)) || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({
      value,
      label: labelFn(value, locale),
      count,
      ...(matchFields.has(value) ? { matchField: matchFields.get(value) } : {}),
    }));
}

function eventKindCatalog(sessions, options = {}) {
  const locale = i18n.resolveLocale(options.locale);
  const counts = {
    main: new Map(),
    protocol: new Map(),
    raw: new Map(),
  };
  const matchFields = {
    main: new Map(),
    protocol: new Map(),
    raw: new Map(),
  };
  const add = (layer, value, matchField = '') => {
    const key = String(value || '').trim();
    if (!key) return;
    counts[layer].set(key, (counts[layer].get(key) || 0) + 1);
    if (matchField) matchFields[layer].set(key, matchField);
  };
  for (const session of sessions || []) {
    for (const event of session.logicalEvents || []) {
      if (event.layer === 'protocol') add('protocol', event.subtype || event.kind);
      else {
        add('main', event.kind);
        if (event.kind === 'code_mode_operation'
            && isCodeModeScriptOperation(event, session.presentationIndexes)) {
          add('main', CODE_MODE_SCRIPT_OPERATION_KIND, 'presentation_fallback');
        }
      }
    }
    for (const raw of session.rawEvents || []) {
      add('raw', raw.payloadType || raw.recordType);
    }
  }
  return {
    main: eventKindOptionsFromCounts(counts.main, locale, eventKindLabel, matchFields.main),
    protocol: eventKindOptionsFromCounts(counts.protocol, locale, eventKindLabel, matchFields.protocol),
    raw: eventKindOptionsFromCounts(counts.raw, locale, rawRecordValueLabel, matchFields.raw),
  };
}

function addCounts(session, logicalEvent) {
  if (logicalEvent.turnId) session._turnIds.add(logicalEvent.turnId);
  if (logicalEvent.layer === 'protocol') {
    session.counts.protocol += 1;
    return;
  }
  if (logicalEvent.kind === 'user_message' || logicalEvent.kind === 'assistant_message') {
    session.counts.messages += 1;
  }
  if (logicalEvent.kind === 'user_message') session.counts.userMessages += 1;
  if (logicalEvent.kind === 'assistant_message') session.counts.assistantMessages += 1;
  if (logicalEvent.kind === 'reasoning') session.counts.reasoning += 1;
  if (['command', 'read', 'patch', 'mcp_call', 'web_search', 'agent_coordination', 'other_tool_call', 'code_mode_operation', 'js_repl', 'hook'].includes(logicalEvent.kind)
      || (logicalEvent.kind === 'goal' && logicalEvent.toolName)) {
    session.counts.toolCalls += 1;
  }
  if (logicalEvent.kind === 'command' && logicalEvent.status === 'failed') session.counts.failedCommands += 1;
  if (logicalEvent.status === 'failed' || logicalEvent.severity !== 'normal') session.counts.issueEvents += 1;
  if (logicalEvent.kind === 'patch') session.counts.patches += 1;
  if (logicalEvent.kind === 'compaction') session.counts.compactions += 1;
  if (logicalEvent.kind === 'abort') session.counts.aborts += 1;
  if (logicalEvent.kind === 'error') session.counts.errors += 1;
  if (planFacet.isPlanArtifactEvent(logicalEvent)) session.counts.planArtifacts += 1;
  if (planFacet.isPlanEvent(logicalEvent)) session.counts.planEvents += 1;
}

function updateAnalysisDraft(session, event) {
  if (event.layer === 'protocol') return;
  const draft = session._analysisDraft;
  if (event.toolName) {
    draft.toolUsage.set(event.toolName, (draft.toolUsage.get(event.toolName) || 0) + 1);
  }
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
    draft.commands.push(commandInfo);
    if (event.status === 'failed') draft.failedCommands.push(commandInfo);
  }
  if (event.kind === 'patch') {
    for (const file of event.touchedFiles) {
      draft.patchedFiles.set(file, (draft.patchedFiles.get(file) || 0) + 1);
    }
  }
  if (event.kind === 'usage_limit_warning') {
    const primaryRaw = event.rawRefs?.[0]?.rawId ? session.rawEvents.find((raw) => raw.rawId === event.rawRefs[0].rawId) : null;
    const observed = Number(primaryRaw?.maxObservedTokens || 0);
    if (observed > draft.tokenStats.maxObserved) draft.tokenStats.maxObserved = observed;
  }
}

function hasMalformedTitleText(text) {
  const source = String(text || '');
  if (!source) return true;
  if (source.includes('\uFFFD')) return true;
  const controlMatches = source.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || [];
  return controlMatches.length > Math.max(2, Math.floor(source.length * 0.05));
}

function cleanTitleLine(line) {
  return String(line || '')
    .trim()
    .replace(/^>\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLowInformationTitleLine(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (/^[-=*_`|:.\s]+$/.test(text)) return true;
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(text);
}

function normalizeTitleCandidate(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!source || hasMalformedTitleText(source)) return '';
  if (classifyProtocolText(source, 'user')) return '';

  const body = stripProposedPlanWrapper(source);
  for (const line of body.split('\n')) {
    const cleaned = cleanTitleLine(line);
    if (isLowInformationTitleLine(cleaned)) continue;
    return truncate(cleaned, SESSION_TITLE_LIMIT);
  }
  return '';
}

function titleFromUserEvents(events, preferLast = false) {
  const ordered = preferLast ? [...events].reverse() : events;
  for (const event of ordered) {
    const title = normalizeTitleCandidate(event.searchText || event.preview);
    if (title) return title;
  }
  return '';
}

function inferSessionTitle(session) {
  const userEvents = session.logicalEvents.filter((event) => event.layer === 'main' && event.kind === 'user_message');
  const kind = derivedSessionKind(session);
  if (kind) {
    const taskPreview = titleFromUserEvents(userEvents, true) || path.basename(session.sourceFile, '.jsonl');
    const baseLabel = kind === 'review' ? 'Review' : 'Subagent';
    const nickname = session.agentNickname && session.agentNickname.toLowerCase() !== baseLabel.toLowerCase() ? ` ${session.agentNickname}` : '';
    const label = nickname ? `${baseLabel}${nickname}` : `${baseLabel} session`;
    return truncate(`${label}: ${taskPreview}`, SUBAGENT_SESSION_TITLE_LIMIT);
  }
  const preferLast = Boolean(session.forkedFromSessionId && session.forkStorageMode !== 'materialized');
  return titleFromUserEvents(userEvents, preferLast) || path.basename(session.sourceFile, '.jsonl');
}

function transcriptMetadataTitle(session) {
  let title = '';
  for (const raw of session.rawEvents || []) {
    if (rawForkSegment(session, raw.rawId) === 'inherited_context') continue;
    if (raw.recordType !== 'event_msg' || !raw.threadName) continue;
    if (raw.payloadType === 'session_configured' && !title) title = raw.threadName;
    if (raw.payloadType === 'thread_name_updated' && !session.parentSessionId) title = raw.threadName;
  }
  return title;
}

function resetOwnedRawFacts(session) {
  session.startedAt = '';
  session.updatedAt = '';
  const reviewMarkers = [];
  for (const raw of session.rawEvents || []) {
    if (rawForkSegment(session, raw.rawId) === 'inherited_context') continue;
    updateTimeRangeFromNormalizedTimestamp(session, raw.timestamp);
    appendReviewLifecycleMarker(reviewMarkers, raw, { ownerId: session.id });
  }
  session._reviewMarkers = reviewMarkers;
}

function applySessionIndexMetadata(session, sessionIndexEntry) {
  session.title = typeof sessionIndexEntry?.title === 'string' && sessionIndexEntry.title
    ? sessionIndexEntry.title
    : session.transcriptTitle;
  session.updatedAt = session.transcriptUpdatedAt;
  if (sessionIndexEntry?.updatedAt && (!session.updatedAt || sessionIndexEntry.updatedAt > session.updatedAt)) {
    session.updatedAt = sessionIndexEntry.updatedAt;
  }
}

function finalizeSession(session, sessionIndexEntry) {
  session.counts = emptySessionCounts();
  session._turnIds = new Set();
  session._analysisDraft = emptyAnalysisDraft();
  resetOwnedRawFacts(session);
  for (const event of session.logicalEvents || []) {
    addCounts(session, event);
    updateAnalysisDraft(session, event);
  }
  session.counts.turns = session._turnIds.size;
  session.transcriptTitle = transcriptMetadataTitle(session) || inferSessionTitle(session);
  session.transcriptUpdatedAt = session.updatedAt;
  applySessionIndexMetadata(session, sessionIndexEntry);

  const draft = session._analysisDraft;
  session.analysis = {
    sessionId: session.id,
    title: session.title,
    counts: session.counts,
    toolUsage: [...draft.toolUsage.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    failedCommands: draft.failedCommands.slice(0, 100),
    slowCommands: [...draft.commands].sort((a, b) => b.durationMs - a.durationMs).slice(0, 25),
    patchedFiles: [...draft.patchedFiles.entries()].sort((a, b) => b[1] - a[1]).map(([file, count]) => ({ file, count })),
    tokenStats: draft.tokenStats,
    timelineStats: countBy(session.logicalEvents.filter((event) => event.layer !== 'protocol'), (event) => event.kind),
    protocolStats: countBy(session.logicalEvents.filter((event) => event.layer === 'protocol'), (event) => event.subtype),
  };
  session.presentationIndexes = buildCodeModePresentationIndexes(session);
  session.eventKinds = eventKindCatalog([session]);

  delete session._turnIds;
  delete session._analysisDraft;
  return session;
}

function extractResidentRawFacts(raw, record) {
  const payload = record?.payload;
  if (!payload || typeof payload !== 'object') return;
  if (record.type === 'session_meta' && typeof payload.id === 'string' && payload.id) {
    raw.sessionMetaId = payload.id;
  }
  if (record.type === 'event_msg' && typeof payload.thread_name === 'string' && payload.thread_name) {
    raw.threadName = payload.thread_name;
  }
  const reviewLifecycle = reviewLifecycleFromRaw(raw);
  if (reviewLifecycle) {
    raw.reviewLifecyclePhase = reviewLifecycle.phase;
    if (typeof payload.thread_id === 'string' && payload.thread_id) raw.reviewThreadId = payload.thread_id;
  }
  if (record.type === 'event_msg' && payload.type === 'token_count') {
    const observed = maxObservedTokenValue(payload);
    if (observed > 0) raw.maxObservedTokens = observed;
  }
}

function compactString(value) {
  return typeof value === 'string' ? value : '';
}

function compactInteger(value, fallback = null) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function compactEmbeddedImageDescriptor(image) {
  const descriptor = {
    previewId: compactString(image.previewId),
    source: {
      file: compactString(image.source?.file),
      line: compactInteger(image.source?.line),
      jsonPath: (Array.isArray(image.source?.jsonPath) ? image.source.jsonPath : [])
        .filter((part) => typeof part === 'string' || Number.isSafeInteger(part)),
    },
    mimeType: compactString(image.mimeType),
    estimatedBytes: compactInteger(image.estimatedBytes, 0),
    dedupeKey: compactString(image.dedupeKey),
  };
  if (typeof image.encoding === 'string' && image.encoding) descriptor.encoding = image.encoding;
  if (typeof image.detail === 'string' && image.detail) descriptor.detail = image.detail;
  return descriptor;
}

function compactCodexRawEvent(raw) {
  const compact = {
    rawId: compactString(raw.rawId),
    sessionId: compactString(raw.sessionId),
    sourceKind: CODEX_SOURCE_KIND,
    line: compactInteger(raw.line),
    source: { file: compactString(raw.source?.file), line: compactInteger(raw.source?.line) },
    sourceLocator: raw.sourceLocator ? {
      type: raw.sourceLocator.type === 'jsonl_line' ? 'jsonl_line' : '',
      file: compactString(raw.sourceLocator.file),
      line: compactInteger(raw.sourceLocator.line),
    } : null,
    sourceLineDigest: compactString(raw.sourceLineDigest),
    timestamp: compactString(raw.timestamp),
    turnId: compactString(raw.turnId),
    recordType: compactString(raw.recordType),
    payloadType: compactString(raw.payloadType),
    canonicalType: compactString(raw.canonicalType),
    role: compactString(raw.role),
    typeKey: compactString(raw.typeKey),
    callId: compactString(raw.callId),
    toolName: compactString(raw.toolName),
    status: compactString(raw.status),
    messageText: compactString(raw.messageText),
    searchText: compactString(raw.searchText),
    preview: compactString(raw.preview),
    commandText: compactString(raw.commandText),
    stdout: compactString(raw.stdout),
    stderr: compactString(raw.stderr),
    aggregatedOutput: compactString(raw.aggregatedOutput),
    exitCode: typeof raw.exitCode === 'number' || typeof raw.exitCode === 'string' ? raw.exitCode : null,
    durationMs: Number.isFinite(raw.durationMs) ? raw.durationMs : 0,
    touchedFiles: (Array.isArray(raw.touchedFiles) ? raw.touchedFiles : []).filter((file) => typeof file === 'string'),
    embeddedImages: (Array.isArray(raw.embeddedImages) ? raw.embeddedImages : []).map(compactEmbeddedImageDescriptor),
    output: compactString(raw.output),
    rawIndex: compactInteger(raw.rawIndex),
    sourceClientVersion: compactString(raw.sourceClientVersion),
  };
  if (typeof raw.sessionMetaId === 'string' && raw.sessionMetaId) compact.sessionMetaId = raw.sessionMetaId;
  if (typeof raw.threadName === 'string' && raw.threadName) compact.threadName = raw.threadName;
  if (typeof raw.reviewLifecyclePhase === 'string' && raw.reviewLifecyclePhase) compact.reviewLifecyclePhase = raw.reviewLifecyclePhase;
  if (typeof raw.reviewThreadId === 'string' && raw.reviewThreadId) compact.reviewThreadId = raw.reviewThreadId;
  if (Number.isFinite(raw.maxObservedTokens) && raw.maxObservedTokens > 0) compact.maxObservedTokens = raw.maxObservedTokens;
  return compact;
}

const COMPACT_RAW_KEYS = new Set([
  'aggregatedOutput', 'callId', 'canonicalType', 'commandText', 'durationMs', 'embeddedImages',
  'exitCode', 'line', 'maxObservedTokens', 'messageText', 'output', 'payloadType', 'preview',
  'rawId', 'rawIndex', 'recordType', 'reviewLifecyclePhase', 'reviewThreadId', 'role',
  'searchText', 'sessionId', 'sessionMetaId', 'source', 'sourceClientVersion', 'sourceKind',
  'sourceLineDigest', 'sourceLocator', 'status', 'stderr', 'stdout', 'threadName', 'timestamp',
  'toolName', 'touchedFiles', 'turnId', 'typeKey',
]);
const COMPACT_RAW_STRING_FIELDS = [
  'aggregatedOutput', 'callId', 'canonicalType', 'commandText', 'messageText', 'output',
  'payloadType', 'preview', 'rawId', 'recordType', 'role', 'searchText', 'sessionId',
  'sourceClientVersion', 'sourceKind', 'sourceLineDigest', 'status', 'stderr', 'stdout',
  'timestamp', 'toolName', 'turnId', 'typeKey',
];
const COMPACT_SESSION_STRING_FIELDS = [
  'agentNickname', 'forkContinuationState', 'forkPointUuid', 'forkStorageMode', 'forkedAt',
  'forkedFromSessionId', 'id', 'parentSessionId', 'primarySessionMetaKind', 'projectAssociation',
  'residentRepresentation', 'shell', 'sourceAbsFile', 'sourceClientVersion', 'sourceFile',
  'sourceFingerprint', 'sourceKind', 'sourceSessionId', 'sourceUpdatedAt', 'startedAt',
  'supersededAt', 'supersededBySessionId', 'supersededReason', 'title', 'transcriptTitle',
  'transcriptUpdatedAt', 'updatedAt',
];
const COMPACT_LOGICAL_KEYS = new Set([
  'channels', 'codeModeOperation', 'hasLongOutput', 'hasReadableReasoning', 'id', 'kind', 'label', 'layer',
  'outputStats', 'preview', 'rawRefs', 'role', 'schemaVersion', 'searchText', 'severity',
  'source', 'sourceKind', 'sourceLocator', 'status', 'subtype', 'tags', 'timestamp',
  'tokenUsage', 'toolName', 'touchedFiles', 'turnId', 'usageLimits',
]);
const COMPACT_LOGICAL_STRING_FIELDS = [
  'id', 'kind', 'label', 'layer', 'preview', 'role', 'searchText', 'severity', 'sourceKind',
  'status', 'subtype', 'timestamp', 'toolName', 'turnId',
];
const COMPACT_RAW_REF_KEYS = new Set([
  'file', 'line', 'rawId', 'sourceLocator', 'sourceRecordType', 'sourceEventType',
]);
const COMPACT_IMAGE_DESCRIPTOR_KEYS = new Set([
  'dedupeKey', 'detail', 'encoding', 'estimatedBytes', 'mimeType', 'previewId', 'source',
]);
const COMPACT_IMAGE_SOURCE_KEYS = new Set(['file', 'jsonPath', 'line']);

function isCompactSourceLocator(locator) {
  return locator === null || (
    locator
    && typeof locator === 'object'
    && !Array.isArray(locator)
    && Object.keys(locator).length === 3
    && locator.type === 'jsonl_line'
    && typeof locator.file === 'string'
    && Number.isSafeInteger(locator.line)
    && locator.line > 0
  );
}

function isCompactEmbeddedImageDescriptor(image) {
  if (!image || typeof image !== 'object' || Array.isArray(image)) return false;
  if (!Object.keys(image).every((key) => COMPACT_IMAGE_DESCRIPTOR_KEYS.has(key))) return false;
  if (!['dedupeKey', 'mimeType', 'previewId'].every((key) => typeof image[key] === 'string')) return false;
  if (image.detail !== undefined && typeof image.detail !== 'string') return false;
  if (image.encoding !== undefined && typeof image.encoding !== 'string') return false;
  if (!Number.isSafeInteger(image.estimatedBytes)) return false;
  const source = image.source;
  return source
    && typeof source === 'object'
    && !Array.isArray(source)
    && Object.keys(source).every((key) => COMPACT_IMAGE_SOURCE_KEYS.has(key))
    && typeof source.file === 'string'
    && Number.isSafeInteger(source.line)
    && Array.isArray(source.jsonPath)
    && source.jsonPath.every((part) => typeof part === 'string' || Number.isSafeInteger(part));
}

function isReusableCompactRaw(raw) {
  return raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && Object.keys(raw).every((key) => COMPACT_RAW_KEYS.has(key))
    && COMPACT_RAW_STRING_FIELDS.every((key) => typeof raw[key] === 'string')
    && raw.sourceKind === CODEX_SOURCE_KIND
    && Number.isSafeInteger(raw.line)
    && Number.isSafeInteger(raw.rawIndex)
    && (raw.exitCode === null || typeof raw.exitCode === 'string' || typeof raw.exitCode === 'number')
    && Number.isFinite(raw.durationMs)
    && raw.source
    && typeof raw.source === 'object'
    && !Array.isArray(raw.source)
    && Object.keys(raw.source).length === 2
    && typeof raw.source.file === 'string'
    && Number.isSafeInteger(raw.source.line)
    && isCompactSourceLocator(raw.sourceLocator)
    && Array.isArray(raw.touchedFiles)
    && raw.touchedFiles.every((file) => typeof file === 'string')
    && Array.isArray(raw.embeddedImages)
    && raw.embeddedImages.every(isCompactEmbeddedImageDescriptor)
    && (raw.maxObservedTokens === undefined || (Number.isFinite(raw.maxObservedTokens) && raw.maxObservedTokens > 0))
    && (raw.sessionMetaId === undefined || typeof raw.sessionMetaId === 'string')
    && (raw.threadName === undefined || typeof raw.threadName === 'string')
    && (raw.reviewLifecyclePhase === undefined || typeof raw.reviewLifecyclePhase === 'string')
    && (raw.reviewThreadId === undefined || typeof raw.reviewThreadId === 'string')
    && !Object.hasOwn(raw, 'parsed')
    && !Object.hasOwn(raw, 'payload');
}

function isReusableCompactRawRef(ref) {
  return ref
    && typeof ref === 'object'
    && !Array.isArray(ref)
    && Object.keys(ref).every((key) => COMPACT_RAW_REF_KEYS.has(key))
    && typeof ref.file === 'string'
    && Number.isSafeInteger(ref.line)
    && typeof ref.rawId === 'string'
    && typeof ref.sourceRecordType === 'string'
    && typeof ref.sourceEventType === 'string'
    && isCompactSourceLocator(ref.sourceLocator);
}

function isReusableCompactLogicalEvent(event) {
  return event
    && typeof event === 'object'
    && !Array.isArray(event)
    && Object.keys(event).every((key) => COMPACT_LOGICAL_KEYS.has(key))
    && COMPACT_LOGICAL_STRING_FIELDS.every((key) => typeof event[key] === 'string')
    && Array.isArray(event.rawRefs)
    && event.rawRefs.every(isReusableCompactRawRef)
    && (event.source == null || event.rawRefs.includes(event.source))
    && isCompactSourceLocator(event.sourceLocator)
    && (event.codeModeOperation === undefined
      || (event.codeModeOperation
        && typeof event.codeModeOperation === 'object'
        && !Array.isArray(event.codeModeOperation)
        && !retainsForbiddenSourceContainer(event.codeModeOperation)))
    && !Object.hasOwn(event, 'parsed')
    && !Object.hasOwn(event, 'payload');
}

function retainsForbiddenSourceContainer(root) {
  const pending = [root];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'parsed') || Object.hasOwn(value, 'payload')) return true;
    if (value instanceof Map) {
      for (const [key, entry] of value) pending.push(key, entry);
    } else if (value instanceof Set) {
      for (const entry of value) pending.push(entry);
    } else {
      for (const entry of Object.values(value)) pending.push(entry);
    }
  }
  return false;
}

function isReusableCompactSession(session) {
  return session?.residentRepresentation === CODEX_COMPACT_SESSION_REPRESENTATION
    && COMPACT_SESSION_STRING_FIELDS.every((key) => typeof session[key] === 'string')
    && session.cwdSet instanceof Set
    && [...session.cwdSet].every((cwd) => typeof cwd === 'string')
    && (!session._parsedAncestry
      || (typeof session._parsedAncestry === 'object'
        && !Array.isArray(session._parsedAncestry)
        && typeof session._parsedAncestry.forkedFromSessionId === 'string'
        && Object.keys(session._parsedAncestry).every((key) => key === 'forkedFromSessionId')))
    && Array.isArray(session.rawEvents)
    && session.rawEvents.every(isReusableCompactRaw)
    && Array.isArray(session._logicalEvents || session.logicalEvents)
    && (session._logicalEvents || session.logicalEvents).every(isReusableCompactLogicalEvent);
}

async function parseSessionFile(filePath, relFile, repoRoot, signal, options = {}) {
  throwIfAborted(signal);
  const acceptedSnapshot = options.acceptedSourceSnapshot || null;
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (acceptedSnapshot && (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')) {
      throw indexedSourceStaleError();
    }
    throw error;
  }
  const acceptedBytes = acceptedSnapshot ? acceptedSnapshot.acceptedBytes : stat.size;
  const snapshotFailure = acceptedSnapshot ? indexedSourceStaleError : sourceSnapshotChangedError;
  if (!Number.isSafeInteger(acceptedBytes)
      || acceptedBytes < 0
      || stat.size < acceptedBytes
      || (acceptedSnapshot
        && !sameSourceIdentity(sourceFileIdentity(stat), acceptedSnapshot.fileIdentity))) {
    throw snapshotFailure();
  }
  const session = makeEmptySession(filePath, relFile, stat);
  session.bytes = acceptedBytes;
  session._sourceIdentity = sourceFileIdentity(stat);
  let primarySessionMetaSeen = false;
  let sessionShellCaptured = false;
  const includeCanonicalRawDigests = options.canonicalRawDigests === true;
  const sourceHash = crypto.createHash('sha256');
  let sourceBytesRead = 0;

  const stream = acceptedBytes > 0
    ? fs.createReadStream(filePath, { start: 0, end: acceptedBytes - 1 })
    : Readable.from([]);
  stream.on('data', (chunk) => {
    sourceBytesRead += chunk.length;
    sourceHash.update(chunk);
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  try {
    for await (const line of rl) {
      throwIfAborted(signal);
      lineNumber += 1;
      if (!line.trim()) continue;
      session.lineCount += 1;
      const record = safeJsonParse(line);
      if (!record) continue;
      const recordType = typeof record.type === 'string' ? record.type : '';
      const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : {};

      if (recordType === 'session_meta') {
        if (!primarySessionMetaSeen) {
          primarySessionMetaSeen = true;
          if (typeof payload.id === 'string' && payload.id) {
            session.id = payload.id;
            session.sourceSessionId = payload.id;
          }
          const forkedFromSessionId = forkedFromSessionIdFromMeta(payload);
          if (forkedFromSessionId || !session.forkedFromSessionId) {
            session.forkedFromSessionId = forkedFromSessionId;
          }
          session.parentSessionId = parentSessionIdFromMeta(payload);
          session.agentNickname = agentNicknameFromMeta(payload);
          session.primarySessionMetaKind = derivedSessionKindFromMeta(payload);
        }
        if (typeof payload.cwd === 'string' && payload.cwd) {
          session.cwdSet.add(payload.cwd);
          if (isPathInsideOrSame(payload.cwd, repoRoot)) session.matchesRepo = true;
        }
      }
      if (recordType === 'event_msg' && payload.type === 'session_configured') {
        if (typeof payload.cwd === 'string' && payload.cwd) {
          session.cwdSet.add(payload.cwd);
          if (isPathInsideOrSame(payload.cwd, repoRoot)) session.matchesRepo = true;
        }
        if (!session.title && typeof payload.thread_name === 'string' && payload.thread_name) {
          session.title = payload.thread_name;
        }
        if (!primarySessionMetaSeen) {
          if (!session.forkedFromSessionId) session.forkedFromSessionId = forkedFromSessionIdFromMeta(payload);
          if (!session.parentSessionId) session.parentSessionId = parentSessionIdFromMeta(payload);
          if (!session.agentNickname) session.agentNickname = agentNicknameFromMeta(payload);
          if (!session.primarySessionMetaKind) session.primarySessionMetaKind = derivedSessionKindFromMeta(payload);
        }
      }
      if (!session.parentSessionId
          && recordType === 'event_msg'
          && payload.type === 'thread_name_updated'
          && typeof payload.thread_name === 'string'
          && payload.thread_name) {
        session.title = payload.thread_name;
      }
      const embeddedImages = [];
      const canonicalDigest = includeCanonicalRawDigests ? canonicalRawRecordDigest(record) : '';
      externalizeKnownImageGenerationResult(record, { file: relFile, line: lineNumber }, embeddedImages);
      externalizeEmbeddedImages(record, { file: relFile, line: lineNumber }, embeddedImages);
      const raw = makeRawEvent(record, lineNumber, relFile, session.id, embeddedImages);
      raw.sourceLineDigest = sourceLineDigest(line);
      if (canonicalDigest) raw._canonicalRawDigest = canonicalDigest;
      raw.sourceClientVersion = typeof record.version === 'string' ? record.version : '';
      extractResidentRawFacts(raw, record);
      if (!session.sourceClientVersion && typeof record.version === 'string' && record.version) {
        session.sourceClientVersion = record.version;
      }
      updateTimeRangeFromNormalizedTimestamp(session, raw.timestamp);
      if (!sessionShellCaptured
          && classifyProtocolText(raw.messageText, raw.role) === 'environment_context') {
        const shellContext = readXmlTag(raw.messageText, 'shell');
        if (shellContext) {
          sessionShellCaptured = true;
          session.shell = boundedSessionShellContext(shellContext);
        }
      }
      session.rawEvents.push(raw);
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  throwIfAborted(signal);
  const sourceFingerprint = sourceHash.digest('base64url');
  if (typeof options.beforeSourceSnapshotVerificationForTests === 'function') {
    await options.beforeSourceSnapshotVerificationForTests({ filePath, snapshotBytes: acceptedBytes });
  }
  const verified = await hashFilePrefix(filePath, acceptedBytes, signal);
  const verifiedStat = await fsp.stat(filePath);
  if (sourceBytesRead !== acceptedBytes
      || verified.bytesRead !== acceptedBytes
      || verified.fingerprint !== sourceFingerprint
      || verifiedStat.size < acceptedBytes
      || !sameSourceIdentity(sourceFileIdentity(verifiedStat), session._sourceIdentity)
      || (acceptedSnapshot && sourceFingerprint !== acceptedSnapshot.digest)) {
    throw snapshotFailure();
  }
  session.sourceFingerprint = sourceFingerprint;
  session._parsedAncestry = {
    forkedFromSessionId: String(session.forkedFromSessionId || '').trim(),
  };
  session._logicalEvents = codexLogicalBuilder.buildLogicalEvents(session.rawEvents);
  session.logicalEvents = session._logicalEvents;
  if (includeCanonicalRawDigests) {
    session._canonicalRawDigests = session.rawEvents.map((raw) => raw._canonicalRawDigest);
  }
  if (typeof options.onTransientMemorySample === 'function') {
    options.onTransientMemorySample({
      phase: 'pre_raw_compaction',
      sessionId: session.id,
      rawEventCount: session.rawEvents.length,
      logicalEventCount: session.logicalEvents.length,
    });
  }
  if (options.retainFullSourceRecordsForTests !== true) {
    session.rawEvents = session.rawEvents.map(compactCodexRawEvent);
    session.residentRepresentation = CODEX_COMPACT_SESSION_REPRESENTATION;
  }
  return session;
}

function compactCodexForkRawFact(raw) {
  return [
    String(raw?.rawId || ''),
    String(raw?.timestamp || ''),
    String(raw?.recordType || ''),
    String(raw?.payloadType || ''),
    String(raw?.role || ''),
    String(raw?.sessionMetaId || ''),
    String(raw?.reviewLifecyclePhase || ''),
    String(raw?.reviewThreadId || ''),
  ];
}

function compactCodexForkLogicalRanges(session) {
  const rawOrdinals = new Map(session.rawEvents.map((raw, index) => [String(raw.rawId || ''), index]));
  return (session._logicalEvents || session.logicalEvents).map((event) => {
    const ordinals = (event.rawRefs || []).map((reference) => rawOrdinals.get(String(reference?.rawId || '')));
    const valid = ordinals.length > 0 && ordinals.every(Number.isSafeInteger);
    let start = -1;
    let end = -1;
    if (valid) {
      start = ordinals[0];
      end = ordinals[0];
      for (const ordinal of ordinals.slice(1)) {
        if (ordinal < start) start = ordinal;
        if (ordinal > end) end = ordinal;
      }
    }
    return [
      start,
      end,
      event.layer === 'protocol' ? 1 : 0,
    ];
  });
}

function buildCodexRelationshipEvidence(session, retainForkEvidence) {
  const rawFacts = retainForkEvidence
    ? session.rawEvents.map(compactCodexForkRawFact)
    : session.rawEvents.slice(0, 2).map(compactCodexForkRawFact);
  const rawTimestampMs = session.rawEvents.map((raw) => Date.parse(raw.timestamp));
  const allRawTimestampsValid = rawTimestampMs.every(Number.isFinite);
  let latestRawTimestampMs = null;
  if (rawTimestampMs.length && allRawTimestampsValid) {
    latestRawTimestampMs = rawTimestampMs[0];
    for (const timestampMs of rawTimestampMs.slice(1)) {
      if (timestampMs > latestRawTimestampMs) latestRawTimestampMs = timestampMs;
    }
  }
  return {
    id: session.id,
    sourceKind: session.sourceKind,
    sourceFile: session.sourceFile,
    sourceClientVersion: session.sourceClientVersion,
    sourceFingerprint: session.sourceFingerprint,
    sourceUpdatedAt: session.sourceUpdatedAt,
    sourceIdentity: structuredClone(session._sourceIdentity),
    bytes: session.bytes,
    lineCount: session.lineCount,
    rawEventCount: session.rawEvents.length,
    cwdSet: [...session.cwdSet],
    matchesRepo: session.matchesRepo,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    parentSessionId: session.parentSessionId,
    parentSessionInferred: false,
    forkedFromSessionId: session.forkedFromSessionId,
    forkStorageMode: '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    forkEvidence: null,
    inheritedContext: null,
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    agentNickname: session.agentNickname,
    primarySessionMetaKind: session.primarySessionMetaKind,
    _parsedAncestry: structuredClone(session._parsedAncestry),
    _reviewMarkers: structuredClone(sessionReviewMarkers(session)),
    _canonicalRawDigests: retainForkEvidence
      ? [...(session._canonicalRawDigests || [])]
      : [],
    _forkRawFacts: rawFacts,
    _forkLogicalRanges: retainForkEvidence ? compactCodexForkLogicalRanges(session) : [],
    _allRawTimestampsValid: allRawTimestampsValid,
    _latestRawTimestampMs: latestRawTimestampMs,
    _continuationMainPresent: false,
  };
}

function codexForkRawFactShape(fact) {
  return [
    fact?.[CODEX_FORK_RAW_FACT.RECORD_TYPE] || '',
    fact?.[CODEX_FORK_RAW_FACT.PAYLOAD_TYPE] || '',
    fact?.[CODEX_FORK_RAW_FACT.ROLE] || '',
  ].join('\u0000');
}

function codexForkRawFactIsSessionMeta(fact, sessionId) {
  return fact?.[CODEX_FORK_RAW_FACT.RECORD_TYPE] === 'session_meta'
    && fact?.[CODEX_FORK_RAW_FACT.SESSION_META_ID] === sessionId;
}

function codexForkSegmentForOrdinal(ordinal, matchedParentRawCount) {
  if (ordinal === 0) return 'fork_metadata';
  if (ordinal <= matchedParentRawCount) return 'inherited_context';
  return 'continuation';
}

function codexForkPrefixCanEndAt(parent, child, matchedParentRawCount, forkedAt) {
  const forkedAtMs = Date.parse(forkedAt);
  const parentTail = parent._forkRawFacts.slice(matchedParentRawCount);
  const tailTimes = parentTail.map((fact) => Date.parse(fact[CODEX_FORK_RAW_FACT.TIMESTAMP]));
  if (!Number.isFinite(forkedAtMs) || tailTimes.some((value) => !Number.isFinite(value))) return false;
  if (tailTimes.every((value) => value > forkedAtMs)) return true;
  const parentBoundary = parentTail[0];
  const childBoundary = child._forkRawFacts[matchedParentRawCount + 1];
  return Boolean(parentBoundary && childBoundary
    && codexForkRawFactShape(parentBoundary) !== codexForkRawFactShape(childBoundary));
}

function resetCodexIndexedForkInference(evidence) {
  evidence.forkedFromSessionId = String(evidence._parsedAncestry?.forkedFromSessionId || '').trim();
  evidence.forkStorageMode = '';
  evidence.forkedAt = '';
  evidence.forkPointUuid = '';
  evidence.forkContinuationState = '';
  evidence.forkEvidence = null;
  evidence.inheritedContext = null;
  evidence.supersededBySessionId = '';
  evidence.supersededAt = '';
  evidence.supersededReason = '';
  evidence._continuationMainPresent = false;
}

function recomputeCodexIndexedOwnedRawFacts(evidence) {
  if (evidence.forkStorageMode !== 'materialized') return;
  const inheritedCount = evidence.forkEvidence.matchedParentRawCount;
  const ownedFacts = evidence._forkRawFacts.filter((fact, index) => index === 0 || index > inheritedCount);
  evidence.startedAt = '';
  evidence.updatedAt = '';
  const reviewMarkers = [];
  for (const fact of ownedFacts) {
    updateTimeRangeFromNormalizedTimestamp(evidence, fact[CODEX_FORK_RAW_FACT.TIMESTAMP]);
    appendReviewLifecycleMarker(reviewMarkers, {
      timestamp: fact[CODEX_FORK_RAW_FACT.TIMESTAMP],
      reviewLifecyclePhase: fact[CODEX_FORK_RAW_FACT.REVIEW_PHASE],
      reviewThreadId: fact[CODEX_FORK_RAW_FACT.REVIEW_THREAD_ID],
    }, { ownerId: evidence.id });
  }
  evidence._reviewMarkers = reviewMarkers;
}

function inferCodexIndexedMaterializedForks(evidenceList) {
  const byId = new Map();
  for (const evidence of evidenceList) {
    resetCodexIndexedForkInference(evidence);
    const matches = byId.get(evidence.id) || [];
    matches.push(evidence);
    byId.set(evidence.id, matches);
  }

  let inferred = 0;
  for (const child of evidenceList) {
    const parentId = child.forkedFromSessionId;
    const parentMatches = byId.get(parentId) || [];
    if (!parentId || parentMatches.length !== 1) continue;
    const [parent] = parentMatches;
    if (parent === child
        || !codexForkRawFactIsSessionMeta(parent._forkRawFacts[0], parent.id)
        || !codexForkRawFactIsSessionMeta(child._forkRawFacts[0], child.id)
        || !codexForkRawFactIsSessionMeta(child._forkRawFacts[1], parent.id)
        || parent._canonicalRawDigests.length !== parent.rawEventCount
        || child._canonicalRawDigests.length !== child.rawEventCount) continue;
    let matchedParentRawCount = 0;
    const comparableCount = Math.min(
      parent._canonicalRawDigests.length,
      Math.max(0, child._canonicalRawDigests.length - 1),
    );
    while (matchedParentRawCount < comparableCount
        && child._canonicalRawDigests[matchedParentRawCount + 1]
          === parent._canonicalRawDigests[matchedParentRawCount]) {
      matchedParentRawCount += 1;
    }
    if (!matchedParentRawCount) continue;
    const forkedAt = child._forkRawFacts[0]?.[CODEX_FORK_RAW_FACT.TIMESTAMP] || '';
    if (matchedParentRawCount < parent._canonicalRawDigests.length
        && !codexForkPrefixCanEndAt(parent, child, matchedParentRawCount, forkedAt)) continue;

    let validLogicalOwnership = true;
    let continuationMainPresent = false;
    for (const range of child._forkLogicalRanges) {
      const start = range?.[CODEX_FORK_LOGICAL_RANGE.START_RAW_ORDINAL];
      const end = range?.[CODEX_FORK_LOGICAL_RANGE.END_RAW_ORDINAL];
      if (!Number.isSafeInteger(start)
          || !Number.isSafeInteger(end)
          || start < 0
          || end < start
          || end >= child.rawEventCount
          || codexForkSegmentForOrdinal(start, matchedParentRawCount)
            !== codexForkSegmentForOrdinal(end, matchedParentRawCount)) {
        validLogicalOwnership = false;
        break;
      }
      if (range[CODEX_FORK_LOGICAL_RANGE.PROTOCOL] === 0
          && codexForkSegmentForOrdinal(start, matchedParentRawCount) === 'continuation') {
        continuationMainPresent = true;
      }
    }
    if (!validLogicalOwnership) continue;

    child.forkStorageMode = 'materialized';
    child.forkedAt = forkedAt;
    child.forkEvidence = {
      sourceSessionId: parent.id,
      childMetadataRawId: child._forkRawFacts[0][CODEX_FORK_RAW_FACT.RAW_ID],
      embeddedParentMetadataRawId: child._forkRawFacts[1][CODEX_FORK_RAW_FACT.RAW_ID],
      parentMetadataRawId: parent._forkRawFacts[0][CODEX_FORK_RAW_FACT.RAW_ID],
      matchedParentRawCount,
    };
    child._continuationMainPresent = continuationMainPresent;
    recomputeCodexIndexedOwnedRawFacts(child);
    inferred += 1;
  }
  return inferred;
}

function codexIndexedForkRelationIsCycleSafe(child, byId) {
  const visited = new Set([child.id]);
  let current = child;
  while (current?.forkedFromSessionId) {
    if (visited.has(current.forkedFromSessionId)) return false;
    visited.add(current.forkedFromSessionId);
    current = byId.get(current.forkedFromSessionId);
    if (!current) break;
  }
  return true;
}

function inferCodexIndexedEarlierBranches(evidenceList) {
  const byId = new Map(evidenceList.map((evidence) => [evidence.id, evidence]));
  const childrenByParent = new Map();
  for (const evidence of evidenceList) {
    evidence.supersededBySessionId = '';
    evidence.supersededAt = '';
    evidence.supersededReason = '';
    if (!evidence.forkedFromSessionId || evidence.primarySessionMetaKind || evidence.parentSessionId) continue;
    const children = childrenByParent.get(evidence.forkedFromSessionId) || [];
    children.push(evidence);
    childrenByParent.set(evidence.forkedFromSessionId, children);
  }
  for (const child of evidenceList) {
    if (child.forkStorageMode !== 'materialized'
        || child.primarySessionMetaKind
        || child.parentSessionId
        || !child._continuationMainPresent) continue;
    const parent = byId.get(child.forkedFromSessionId);
    const siblings = childrenByParent.get(child.forkedFromSessionId) || [];
    const forkedAtMs = Date.parse(child.forkedAt);
    if (!parent
        || siblings.length !== 1
        || siblings[0] !== child
        || !codexIndexedForkRelationIsCycleSafe(child, byId)
        || !Number.isFinite(forkedAtMs)
        || !parent._allRawTimestampsValid
        || parent._latestRawTimestampMs > forkedAtMs) continue;
    parent.supersededBySessionId = child.id;
    parent.supersededAt = child.forkedAt;
    parent.supersededReason = 'inactive_after_fork';
  }
}

function orderCodexEvidenceParentsFirst(evidenceList) {
  const uniqueById = new Map();
  for (const evidence of evidenceList) {
    if (uniqueById.has(evidence.id)) uniqueById.set(evidence.id, null);
    else uniqueById.set(evidence.id, evidence);
  }
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (evidence) => {
    if (visited.has(evidence) || visiting.has(evidence)) return;
    visiting.add(evidence);
    if (evidence.forkStorageMode === 'materialized') {
      const parent = uniqueById.get(evidence.forkedFromSessionId);
      if (parent) visit(parent);
    }
    visiting.delete(evidence);
    visited.add(evidence);
    ordered.push(evidence);
  };
  for (const evidence of evidenceList) visit(evidence);
  return ordered;
}

function codexMaterializedCycleEvidence(evidenceList) {
  const uniqueById = new Map();
  for (const evidence of evidenceList) {
    if (uniqueById.has(evidence.id)) uniqueById.set(evidence.id, null);
    else uniqueById.set(evidence.id, evidence);
  }
  const cycleEvidence = new Set();
  const state = new Map();
  const stack = [];
  const stackIndexes = new Map();
  const visit = (evidence) => {
    state.set(evidence, 1);
    stackIndexes.set(evidence, stack.length);
    stack.push(evidence);
    if (evidence.forkStorageMode === 'materialized') {
      const parent = uniqueById.get(evidence.forkedFromSessionId);
      if (parent && !state.has(parent)) visit(parent);
      else if (parent && state.get(parent) === 1) {
        const cycleStart = stackIndexes.get(parent);
        for (const member of stack.slice(cycleStart)) cycleEvidence.add(member);
      }
    }
    stack.pop();
    stackIndexes.delete(evidence);
    state.set(evidence, 2);
  };
  for (const evidence of evidenceList) {
    if (!state.has(evidence)) visit(evidence);
  }
  return cycleEvidence;
}

function logicalForkSegment(event, rawSegments) {
  if (!Array.isArray(event?.rawRefs) || event.rawRefs.length === 0) return '';
  const segments = new Set();
  for (const reference of event.rawRefs) {
    const segment = rawSegments.get(reference.rawId);
    if (!segment) return '';
    segments.add(segment);
  }
  return segments.size === 1 ? [...segments][0] : '';
}

function applyCodexRelationshipEvidence(session, evidence, errorFactory = sourceSnapshotChangedError) {
  for (const field of CODEX_RELATIONSHIP_FIELDS) {
    session[field] = evidence[field] === null || typeof evidence[field] !== 'object'
      ? evidence[field]
      : structuredClone(evidence[field]);
  }
  session._forkSegmentsByRawId = new Map();
  session.logicalEvents = session._logicalEvents || session.logicalEvents;
  if (evidence.forkStorageMode !== 'materialized') return session;

  const matchedParentRawCount = evidence.forkEvidence?.matchedParentRawCount;
  const expectedRawEventCount = Number.isSafeInteger(evidence.rawEventCount)
    ? evidence.rawEventCount
    : evidence.rawEvents.length;
  if (!Number.isSafeInteger(matchedParentRawCount)
      || matchedParentRawCount < 1
      || session.rawEvents.length !== expectedRawEventCount) {
    throw errorFactory();
  }
  for (let index = 0; index < session.rawEvents.length; index += 1) {
    const raw = session.rawEvents[index];
    const segment = index === 0
      ? 'fork_metadata'
      : (index <= matchedParentRawCount ? 'inherited_context' : 'continuation');
    session._forkSegmentsByRawId.set(raw.rawId, segment);
  }
  const kept = [];
  for (const event of session._logicalEvents || []) {
    const segment = logicalForkSegment(event, session._forkSegmentsByRawId);
    if (!segment) throw errorFactory();
    if (segment !== 'inherited_context') kept.push(event);
  }
  session.logicalEvents = kept;
  return session;
}

function codexRelationshipSnapshot(session) {
  const snapshot = {};
  for (const field of CODEX_RELATIONSHIP_FIELDS) {
    snapshot[field] = session[field] === null || typeof session[field] !== 'object'
      ? session[field]
      : structuredClone(session[field]);
  }
  return snapshot;
}

function codexForkSegmentRanges(session) {
  if (session.forkStorageMode !== 'materialized') return [];
  const inheritedCount = session.forkEvidence?.matchedParentRawCount;
  if (!Number.isSafeInteger(inheritedCount) || inheritedCount < 1) throw sourceSnapshotChangedError();
  return [
    { segment: 'fork_metadata', start: 0, end: 1 },
    { segment: 'inherited_context', start: 1, end: inheritedCount + 1 },
    { segment: 'continuation', start: inheritedCount + 1, end: session.rawEvents.length },
  ];
}

function hashCodexMaterializationValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('base64url');
}

function buildCodexMaterializationState(session, relationshipEvidence, sessionIndexEntry) {
  const rawSegments = codexForkSegmentRanges(session);
  const copiedPrefixCount = session.forkStorageMode === 'materialized'
    ? session.forkEvidence.matchedParentRawCount
    : 0;
  const copiedPrefixDigest = copiedPrefixCount > 0
    ? crypto.createHash('sha256').update(
      relationshipEvidence._canonicalRawDigests.slice(1, copiedPrefixCount + 1).join('\n'),
      'utf8',
    ).digest('base64url')
    : '';
  const payload = {
    sourceFile: session.sourceFile,
    rawSegments,
    copiedPrefixCount,
    copiedPrefixDigest,
    relationship: codexRelationshipSnapshot(session),
  };
  const dependencyEntry = {
    role: 'primary_transcript',
    pathIdentity: session.sourceFile,
    existence: 'present',
    kind: 'file',
    policy: 'accepted_prefix',
    acceptedBytes: session.bytes,
    lineCount: session.lineCount,
    digest: session.sourceFingerprint,
    directoryEntries: [],
    evidence: {
      fileIdentity: structuredClone(session._sourceIdentity),
    },
  };
  const copiedMetadataEntry = {
    role: 'copied_session_metadata',
    pathIdentity: `session_index.jsonl#${encodeURIComponent(session.id)}`,
    existence: 'present',
    kind: 'file',
    policy: 'copied_value',
    acceptedBytes: 0,
    lineCount: 0,
    digest: hashCodexMaterializationValue({
      title: session.title,
      updatedAt: session.updatedAt,
    }),
    directoryEntries: [],
    evidence: {
      title: session.title,
      updatedAt: session.updatedAt,
      sourceEntry: sessionIndexEntry
        ? {
          title: String(sessionIndexEntry.title || ''),
          updatedAt: String(sessionIndexEntry.updatedAt || ''),
        }
        : null,
    },
  };
  const dependencyEntries = [dependencyEntry, copiedMetadataEntry];
  const dependencySetId = `codex-dependency:${hashCodexMaterializationValue(dependencyEntries)}`;
  const dependencySet = {
    schemaVersion: CODEX_MATERIALIZATION_SCHEMA_VERSION,
    id: dependencySetId,
    sourceKind: CODEX_SOURCE_KIND,
    entries: dependencyEntries,
  };
  const sourceSnapshotId = `codex-snapshot:${hashCodexMaterializationValue({
    dependencySet,
    payload,
  })}`;
  return {
    dependencySet,
    descriptor: {
      schemaVersion: CODEX_MATERIALIZATION_SCHEMA_VERSION,
      dependencySetId,
      sourceSnapshotId,
      payload,
    },
  };
}

function projectCodexCarriedSession(session, summary) {
  const projected = {
    id: String(session.id || ''),
    sourceKind: CODEX_SOURCE_KIND,
    sourceSessionId: String(session.sourceSessionId || session.id || ''),
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
    counts: { ...emptySessionCounts(), ...(session.counts || {}) },
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
  for (const field of ['derivedRelationship', 'subagentToolUseId', 'spawnDepth']) {
    if (Object.hasOwn(session, field)) {
      projected[field] = session[field] === null || typeof session[field] !== 'object'
        ? session[field]
        : structuredClone(session[field]);
    }
  }
  return projected;
}

function createCodexCatalogAccumulator() {
  const eventCounts = { main: new Map(), protocol: new Map(), raw: new Map() };
  const eventMatchFields = { main: new Map(), protocol: new Map(), raw: new Map() };
  const requestCounts = new Map();
  const addSession = (session) => {
    const eventCatalog = eventKindCatalog([session]);
    for (const layer of ['main', 'protocol', 'raw']) {
      for (const item of eventCatalog[layer]) {
        eventCounts[layer].set(item.value, (eventCounts[layer].get(item.value) || 0) + item.count);
        if (item.matchField) eventMatchFields[layer].set(item.value, item.matchField);
      }
    }
    for (const item of codeModeRequestCatalog([session])) {
      requestCounts.set(item.value, (requestCounts.get(item.value) || 0) + item.count);
    }
  };
  const finish = () => ({
    eventKinds: {
      main: eventKindOptionsFromCounts(eventCounts.main, i18n.DEFAULT_LOCALE, eventKindLabel, eventMatchFields.main),
      protocol: eventKindOptionsFromCounts(eventCounts.protocol, i18n.DEFAULT_LOCALE, eventKindLabel, eventMatchFields.protocol),
      raw: eventKindOptionsFromCounts(eventCounts.raw, i18n.DEFAULT_LOCALE, rawRecordValueLabel, eventMatchFields.raw),
    },
    codeModeRequests: [...requestCounts.entries()]
      .map(([value, count]) => ({
        value,
        label: value,
        count,
        evidence: 'declared_source',
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value)),
  });
  return Object.freeze({ addSession, finish });
}

function copiedSessionIndexEntry(entry) {
  return entry
    ? {
      title: String(entry.title || ''),
      updatedAt: String(entry.updatedAt || ''),
    }
    : null;
}

async function canReuseWholeSourceBackedIndex({
  previousIndex,
  candidates,
  candidateInspections,
  sessionsRoot,
  resolvedRepo,
  resolvedCodex,
  sessionIndex,
  signal,
}) {
  if (previousIndex?.sourceKind !== CODEX_SOURCE_KIND
      || normalizeFsPath(previousIndex.repoRoot || '') !== normalizeFsPath(resolvedRepo)
      || path.resolve(previousIndex.codexHome || '') !== resolvedCodex
      || !Array.isArray(previousIndex.sessions)
      || previousIndex.sessions.length !== candidates.length
      || !(previousIndex.sessionsById instanceof Map)
      || !(previousIndex.materializationDependencies instanceof Map)
      || !previousIndex.projectQueryStore
      || !previousIndex.legacyRawOwners) {
    return false;
  }
  const previousBySourceFile = new Map(
    previousIndex.sessions.map((session) => [session.sourceFile, session]),
  );
  if (previousBySourceFile.size !== candidates.length) return false;

  for (const filePath of candidates) {
    throwIfAborted(signal);
    const sourceFile = path.relative(sessionsRoot, filePath);
    const indexedSession = previousBySourceFile.get(sourceFile);
    if (!indexedSession || candidateInspections.get(filePath)?.bytes !== indexedSession.bytes) {
      return false;
    }
    const dependencySet = previousIndex.materializationDependencies.get(
      indexedSession.materializationDescriptor?.dependencySetId,
    );
    const transcriptEntry = dependencySet?.entries?.[0];
    const copiedMetadataEntry = dependencySet?.entries?.[1];
    if (transcriptEntry?.role !== 'primary_transcript'
        || transcriptEntry.pathIdentity !== sourceFile
        || transcriptEntry.acceptedBytes !== indexedSession.bytes
        || copiedMetadataEntry?.role !== 'copied_session_metadata'
        || !isDeepStrictEqual(
          copiedMetadataEntry.evidence?.sourceEntry,
          copiedSessionIndexEntry(sessionIndex.get(indexedSession.id)),
        )) {
      return false;
    }
    let before;
    try {
      before = await fsp.stat(filePath);
    } catch {
      return false;
    }
    if (before.size !== transcriptEntry.acceptedBytes
        || !sameSourceIdentity(sourceFileIdentity(before), transcriptEntry.evidence?.fileIdentity)) {
      return false;
    }
    const fingerprint = await hashFilePrefix(filePath, before.size, signal);
    const after = await fsp.stat(filePath);
    if (fingerprint.bytesRead !== before.size
        || fingerprint.fingerprint !== transcriptEntry.digest
        || after.size !== before.size
        || !sameSourceIdentity(sourceFileIdentity(after), sourceFileIdentity(before))) {
      return false;
    }
  }
  return true;
}

async function buildIndex({
  repoRoot,
  codexHome,
  onProgress,
  signal,
  previousIndex = null,
  retainFullSourceRecordsForTests = false,
  beforeSourceSnapshotVerificationForTests = null,
}) {
  const resolvedRepo = resolveFsPath(repoRoot);
  const resolvedCodex = path.resolve(codexHome);
  const sessionsRoot = path.join(resolvedCodex, 'sessions');
  const startedAt = Date.now();
  throwIfAborted(signal);
  emitProgress(onProgress, {
    phase: 'scanning',
    repoRoot: resolvedRepo,
    filesTotal: 0,
    filesScanned: 0,
    candidateFileCount: 0,
    skippedFileCount: 0,
    unknownFileCount: 0,
    indexedFileCount: 0,
    indexedBytes: 0,
    elapsedMs: 0,
  });
  const sessionIndex = await readSessionIndex(resolvedCodex);
  const files = await collectJsonlFiles(sessionsRoot);
  const candidates = [];
  const candidateInspections = new Map();
  let skippedFileCount = 0;
  let unknownFileCount = 0;
  let candidateBytes = 0;
  let filesScanned = 0;

  emitProgress(onProgress, {
    phase: 'selecting',
    repoRoot: resolvedRepo,
    filesTotal: files.length,
    filesScanned: 0,
    candidateFileCount: 0,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount: 0,
    indexedBytes: 0,
    elapsedMs: Date.now() - startedAt,
  });

  for (const filePath of files) {
    throwIfAborted(signal);
    const inspected = await inspectSessionFile(filePath, { repoRoot: resolvedRepo, signal });
    const hasCwd = inspected.cwdSet.size > 0;
    const matchesRepo = [...inspected.cwdSet].some((cwd) => isPathInsideOrSame(cwd, resolvedRepo));
    if (matchesRepo) {
      candidates.push(filePath);
      candidateInspections.set(filePath, inspected);
      candidateBytes += inspected.bytes;
    } else if (!hasCwd) {
      unknownFileCount += 1;
    } else {
      skippedFileCount += 1;
    }
    filesScanned += 1;
    emitProgress(onProgress, {
      phase: 'selecting',
      repoRoot: resolvedRepo,
      filesTotal: files.length,
      filesScanned,
      candidateFileCount: candidates.length,
      skippedFileCount,
      unknownFileCount,
      indexedFileCount: 0,
      indexedBytes: 0,
      candidateBytes,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const sessions = [];
  const sessionsById = new Map();
  let logicalEventCount = 0;
  let rawEventCount = 0;
  let indexedFileCount = 0;
  let reusedFileCount = 0;
  let parsedBytes = 0;
  const canReusePrevious = previousIndex
    && Array.isArray(previousIndex.sessions)
    && normalizeFsPath(previousIndex.repoRoot || '') === normalizeFsPath(resolvedRepo)
    && path.resolve(previousIndex.codexHome || '') === resolvedCodex;
  const previousSessionsBySource = canReusePrevious
    ? new Map(previousIndex.sessions.map((session) => [session.sourceFile, session]))
    : new Map();
  const canonicalDigestFilePaths = materializedForkDigestFilePaths(candidates, candidateInspections);

  emitProgress(onProgress, {
    phase: 'parsing',
    repoRoot: resolvedRepo,
    filesTotal: files.length,
    filesScanned: files.length,
    candidateFileCount: candidates.length,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount,
    indexedBytes: 0,
    candidateBytes,
    elapsedMs: Date.now() - startedAt,
  });

  for (const filePath of candidates) {
    throwIfAborted(signal);
    const relFile = path.relative(sessionsRoot, filePath);
    const previousSession = previousSessionsBySource.get(relFile);
    const currentStat = previousSession ? await fsp.stat(filePath) : null;
    const requiresCanonicalRawDigests = canonicalDigestFilePaths.has(filePath);
    const statReusable = previousSession
      && previousSession.bytes === currentStat.size
      && previousSession.sourceUpdatedAt === safeIso(currentStat.mtime)
      && typeof previousSession.sourceFingerprint === 'string'
      && previousSession.sourceFingerprint.length > 0
      && isReusableCompactSession(previousSession)
      && (!requiresCanonicalRawDigests || hasCanonicalRawDigests(previousSession));
    let reusable = false;
    if (statReusable) {
      const currentSource = await hashFilePrefix(filePath, currentStat.size, signal);
      const verifiedStat = await fsp.stat(filePath);
      reusable = currentSource.bytesRead === currentStat.size
        && currentSource.fingerprint === previousSession.sourceFingerprint
        && sameSourceStat(currentStat, verifiedStat);
    }
    let session;
    if (reusable) {
      session = {
        ...previousSession,
        parentSessionId: previousSession.parentSessionInferred ? '' : previousSession.parentSessionId,
        parentSessionInferred: false,
        _logicalEvents: previousSession._logicalEvents || previousSession.logicalEvents,
      };
      reusedFileCount += 1;
    } else {
      session = await parseSessionFile(filePath, relFile, resolvedRepo, signal, {
        canonicalRawDigests: requiresCanonicalRawDigests,
        retainFullSourceRecordsForTests,
        beforeSourceSnapshotVerificationForTests,
      });
    }
    indexedFileCount += 1;
    parsedBytes += session.bytes;
    if (session.matchesRepo) {
      sessions.push(session);
      sessionsById.set(session.id, session);
      logicalEventCount += (session._logicalEvents || session.logicalEvents).length;
      rawEventCount += session.rawEvents.length;
    }
    emitProgress(onProgress, {
      phase: 'parsing',
      repoRoot: resolvedRepo,
      filesTotal: files.length,
      filesScanned: files.length,
      candidateFileCount: candidates.length,
      skippedFileCount,
      unknownFileCount,
      indexedFileCount,
      reusedFileCount,
      indexedBytes: parsedBytes,
      candidateBytes,
      sessionCount: sessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      elapsedMs: Date.now() - startedAt,
    });
  }

  throwIfAborted(signal);
  inferCodexMaterializedForks(sessions);
  for (const session of sessions) {
    throwIfAborted(signal);
    finalizeSession(session, sessionIndex.get(session.id));
  }
  throwIfAborted(signal);
  inferReviewParentSessions(sessions);
  throwIfAborted(signal);
  inferEarlierBranches(sessions);
  logicalEventCount = sessions.reduce((sum, session) => sum + session.logicalEvents.length, 0);
  rawEventCount = sessions.reduce((sum, session) => sum + session.rawEvents.length, 0);
  sessions.sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)));
  emitProgress(onProgress, {
    phase: 'complete',
    repoRoot: resolvedRepo,
    filesTotal: files.length,
    filesScanned: files.length,
    candidateFileCount: candidates.length,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount,
    reusedFileCount,
    indexedBytes: parsedBytes,
    candidateBytes,
    sessionCount: sessions.length,
    eventCount: logicalEventCount,
    rawEventCount,
    elapsedMs: Date.now() - startedAt,
  });
  return {
    sourceKind: CODEX_SOURCE_KIND,
    sourceHome: resolvedCodex,
    sourceRoot: sessionsRoot,
    repoRoot: resolvedRepo,
    codexHome: resolvedCodex,
    sessionsRoot,
    generatedAt: new Date().toISOString(),
    sessions,
    sessionsById,
    legacyRawOwners: buildCodexLegacyRawOwnerIndex(sessions),
    eventKinds: eventKindCatalog(sessions),
    codeModeRequests: codeModeRequestCatalog(sessions),
    totals: {
      fileCount: files.length,
      candidateFileCount: candidates.length,
      indexedFileCount,
      reusedFileCount,
      skippedFileCount,
      unknownFileCount,
      sessionCount: sessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      indexedBytes: sessions.reduce((sum, session) => sum + session.bytes, 0),
      candidateBytes,
    },
  };
}

async function buildSourceBackedIndex({
  repoRoot,
  codexHome,
  onProgress,
  signal,
  previousIndex = null,
  beforeSourceSnapshotVerificationForTests = null,
  beforeRelationshipInferenceForTests = null,
  onTransientMemorySample = null,
}) {
  const resolvedRepo = resolveFsPath(repoRoot);
  const resolvedCodex = path.resolve(codexHome);
  const sessionsRoot = path.join(resolvedCodex, 'sessions');
  const startedAt = Date.now();
  throwIfAborted(signal);
  emitProgress(onProgress, {
    phase: 'scanning',
    repoRoot: resolvedRepo,
    filesTotal: 0,
    filesScanned: 0,
    candidateFileCount: 0,
    skippedFileCount: 0,
    unknownFileCount: 0,
    indexedFileCount: 0,
    indexedBytes: 0,
    elapsedMs: 0,
  });
  const sessionIndex = await readSessionIndex(resolvedCodex);
  const files = await collectJsonlFiles(sessionsRoot);
  const candidates = [];
  const candidateInspections = new Map();
  let skippedFileCount = 0;
  let unknownFileCount = 0;
  let candidateBytes = 0;
  let filesScanned = 0;

  emitProgress(onProgress, {
    phase: 'selecting',
    repoRoot: resolvedRepo,
    filesTotal: files.length,
    filesScanned: 0,
    candidateFileCount: 0,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount: 0,
    indexedBytes: 0,
    elapsedMs: Date.now() - startedAt,
  });
  for (const filePath of files) {
    throwIfAborted(signal);
    const inspected = await inspectSessionFile(filePath, { repoRoot: resolvedRepo, signal });
    const hasCwd = inspected.cwdSet.size > 0;
    const matchesRepo = [...inspected.cwdSet].some((cwd) => isPathInsideOrSame(cwd, resolvedRepo));
    if (matchesRepo) {
      candidates.push(filePath);
      candidateInspections.set(filePath, inspected);
      candidateBytes += inspected.bytes;
    } else if (!hasCwd) {
      unknownFileCount += 1;
    } else {
      skippedFileCount += 1;
    }
    filesScanned += 1;
    emitProgress(onProgress, {
      phase: 'selecting',
      repoRoot: resolvedRepo,
      filesTotal: files.length,
      filesScanned,
      candidateFileCount: candidates.length,
      skippedFileCount,
      unknownFileCount,
      indexedFileCount: 0,
      indexedBytes: 0,
      candidateBytes,
      elapsedMs: Date.now() - startedAt,
    });
  }

  if (await canReuseWholeSourceBackedIndex({
    previousIndex,
    candidates,
    candidateInspections,
    sessionsRoot,
    resolvedRepo,
    resolvedCodex,
    sessionIndex,
    signal,
  })) {
    const logicalEventCount = previousIndex.sessions.reduce(
      (sum, session) => sum + session.logicalEventCount,
      0,
    );
    const rawEventCount = previousIndex.sessions.reduce(
      (sum, session) => sum + session.rawEventCount,
      0,
    );
    const indexedBytes = previousIndex.sessions.reduce((sum, session) => sum + session.bytes, 0);
    emitProgress(onProgress, {
      phase: 'complete',
      repoRoot: resolvedRepo,
      filesTotal: files.length,
      filesScanned: files.length,
      candidateFileCount: candidates.length,
      skippedFileCount,
      unknownFileCount,
      indexedFileCount: previousIndex.sessions.length,
      analyzedFileCount: 0,
      reusedFileCount: previousIndex.sessions.length,
      indexedBytes,
      candidateBytes,
      sessionCount: previousIndex.sessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      elapsedMs: Date.now() - startedAt,
    });
    return {
      sourceKind: CODEX_SOURCE_KIND,
      sourceHome: resolvedCodex,
      sourceRoot: sessionsRoot,
      repoRoot: resolvedRepo,
      codexHome: resolvedCodex,
      sessionsRoot,
      generatedAt: new Date().toISOString(),
      sessions: previousIndex.sessions,
      sessionsById: previousIndex.sessionsById,
      projectQueryStore: previousIndex.projectQueryStore,
      materializationDependencies: previousIndex.materializationDependencies,
      legacyRawOwners: previousIndex.legacyRawOwners,
      eventKinds: previousIndex.eventKinds,
      codeModeRequests: previousIndex.codeModeRequests,
      totals: {
        fileCount: files.length,
        candidateFileCount: candidates.length,
        indexedFileCount: previousIndex.sessions.length,
        reusedFileCount: previousIndex.sessions.length,
        skippedFileCount,
        unknownFileCount,
        sessionCount: previousIndex.sessions.length,
        eventCount: logicalEventCount,
        rawEventCount,
        indexedBytes,
        candidateBytes,
      },
    };
  }

  const canonicalDigestFilePaths = materializedForkDigestFilePaths(candidates, candidateInspections);
  const relationshipEvidence = [];
  let analyzedFileCount = 0;
  let analyzedBytes = 0;
  emitProgress(onProgress, {
    phase: 'parsing',
    repoRoot: resolvedRepo,
    filesTotal: files.length,
    filesScanned: files.length,
    candidateFileCount: candidates.length,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount: 0,
    reusedFileCount: 0,
    indexedBytes: 0,
    candidateBytes,
    elapsedMs: Date.now() - startedAt,
  });
  for (const filePath of candidates) {
    throwIfAborted(signal);
    const relFile = path.relative(sessionsRoot, filePath);
    const session = await parseSessionFile(filePath, relFile, resolvedRepo, signal, {
      canonicalRawDigests: canonicalDigestFilePaths.has(filePath),
      beforeSourceSnapshotVerificationForTests,
      onTransientMemorySample,
    });
    analyzedFileCount += 1;
    analyzedBytes += session.bytes;
    if (session.matchesRepo) {
      relationshipEvidence.push(buildCodexRelationshipEvidence(
        session,
        canonicalDigestFilePaths.has(filePath),
      ));
    }
    emitProgress(onProgress, {
      phase: 'parsing',
      repoRoot: resolvedRepo,
      filesTotal: files.length,
      filesScanned: files.length,
      candidateFileCount: candidates.length,
      skippedFileCount,
      unknownFileCount,
      indexedFileCount: 0,
      analyzedFileCount,
      reusedFileCount: 0,
      indexedBytes: analyzedBytes,
      candidateBytes,
      sessionCount: relationshipEvidence.length,
      elapsedMs: Date.now() - startedAt,
    });
  }

  throwIfAborted(signal);
  if (typeof beforeRelationshipInferenceForTests === 'function') {
    await beforeRelationshipInferenceForTests({ relationshipEvidence });
  }
  inferCodexIndexedMaterializedForks(relationshipEvidence);
  inferReviewParentSessions(relationshipEvidence);
  inferCodexIndexedEarlierBranches(relationshipEvidence);

  const canReusePrevious = previousIndex?.sourceKind === CODEX_SOURCE_KIND
    && normalizeFsPath(previousIndex.repoRoot || '') === normalizeFsPath(resolvedRepo)
    && path.resolve(previousIndex.codexHome || '') === resolvedCodex
    && Array.isArray(previousIndex.sessions)
    && previousIndex.sessionsById instanceof Map
    && previousIndex.materializationDependencies instanceof Map;

  let queryStoreBuilder = createProjectQueryStoreBuilder({
    presentationForEvent: codexSearch.projectQueryPresentation,
  });
  const legacyRawOwnerBuilder = createCodexLegacyRawOwnerIndexBuilder();
  const catalogAccumulator = createCodexCatalogAccumulator();
  const materializationDependencies = new Map();
  const indexedSessions = [];
  const sessionsById = new Map();
  let logicalEventCount = 0;
  let rawEventCount = 0;
  let indexedFileCount = 0;
  let indexedBytes = 0;
  let reusedFileCount = 0;

  const orderedRelationshipEvidence = orderCodexEvidenceParentsFirst(relationshipEvidence);
  const materializedChildrenByParentId = new Map();
  for (const evidence of relationshipEvidence) {
    if (evidence.forkStorageMode !== 'materialized') continue;
    const children = materializedChildrenByParentId.get(evidence.forkedFromSessionId) || [];
    children.push(evidence);
    materializedChildrenByParentId.set(evidence.forkedFromSessionId, children);
  }

  const parseAcceptedRelationshipEvidence = async (evidence) => {
    const filePath = path.resolve(sessionsRoot, evidence.sourceFile);
    if (!isPathInsideOrSame(filePath, sessionsRoot)) throw sourceSnapshotChangedError();
    let session;
    try {
      session = await parseSessionFile(filePath, evidence.sourceFile, resolvedRepo, signal, {
        acceptedSourceSnapshot: {
          acceptedBytes: evidence.bytes,
          digest: evidence.sourceFingerprint,
          fileIdentity: evidence.sourceIdentity,
        },
        beforeSourceSnapshotVerificationForTests,
        onTransientMemorySample,
      });
    } catch (error) {
      if (error?.code === 'INDEXED_SOURCE_STALE') throw sourceSnapshotChangedError();
      throw error;
    }
    if (session.id !== evidence.id
        || session.sourceFingerprint !== evidence.sourceFingerprint
        || session.lineCount !== evidence.lineCount) {
      throw sourceSnapshotChangedError();
    }
    return session;
  };

  for (const evidence of codexMaterializedCycleEvidence(relationshipEvidence)) {
    throwIfAborted(signal);
    const session = await parseAcceptedRelationshipEvidence(evidence);
    applyCodexRelationshipEvidence(session, evidence, sourceSnapshotChangedError);
    for (const childEvidence of materializedChildrenByParentId.get(session.id) || []) {
      childEvidence.inheritedContext = materializedForkInheritedContext(
        session,
        childEvidence.forkEvidence.matchedParentRawCount,
      );
    }
  }

  for (const evidence of orderedRelationshipEvidence) {
    throwIfAborted(signal);
    const session = await parseAcceptedRelationshipEvidence(evidence);
    applyCodexRelationshipEvidence(session, evidence, sourceSnapshotChangedError);
    for (const childEvidence of materializedChildrenByParentId.get(session.id) || []) {
      childEvidence.inheritedContext = materializedForkInheritedContext(
        session,
        childEvidence.forkEvidence.matchedParentRawCount,
      );
    }
    if (evidence.forkStorageMode === 'materialized' && !evidence.inheritedContext) {
      throw sourceSnapshotChangedError();
    }
    finalizeSession(session, sessionIndex.get(session.id));
    if (typeof onTransientMemorySample === 'function') {
      onTransientMemorySample({
        phase: 'post_finalize',
        sessionId: session.id,
        rawEventCount: session.rawEvents.length,
        logicalEventCount: session.logicalEvents.length,
      });
    }
    const queryProjectionDigest = queryStoreBuilder.addSession(session);
    legacyRawOwnerBuilder.addSession(session);
    catalogAccumulator.addSession(session);
    const summary = codexSearch.projectSessionMetadata(session).summary;
    const materializationState = buildCodexMaterializationState(
      session,
      evidence,
      sessionIndex.get(session.id),
    );
    if (materializationDependencies.has(materializationState.dependencySet.id)) {
      throw sourceSnapshotChangedError();
    }
    const projectedIndexedSession = {
      ...projectCodexCarriedSession(session, summary),
      materializationDescriptor: materializationState.descriptor,
      queryShardId: session.id,
      queryProjectionDigest,
    };
    const previousSession = canReusePrevious
      ? previousIndex.sessionsById.get(projectedIndexedSession.id)
      : null;
    const previousDependencySet = previousSession
      ? previousIndex.materializationDependencies.get(
        previousSession.materializationDescriptor?.dependencySetId,
      )
      : null;
    const reuseDependencySet = previousDependencySet
      && isDeepStrictEqual(previousDependencySet, materializationState.dependencySet);
    const reuseIndexedProjection = previousSession
      && reuseDependencySet
      && isDeepStrictEqual(previousSession, projectedIndexedSession);
    const indexedSession = reuseIndexedProjection
      ? previousSession
      : projectedIndexedSession;
    const dependencySet = reuseDependencySet
      ? previousDependencySet
      : materializationState.dependencySet;
    materializationDependencies.set(dependencySet.id, dependencySet);
    if (reuseIndexedProjection) reusedFileCount += 1;
    indexedSessions.push(indexedSession);
    sessionsById.set(indexedSession.id, indexedSession);
    logicalEventCount += indexedSession.logicalEventCount;
    rawEventCount += indexedSession.rawEventCount;
    indexedFileCount += 1;
    indexedBytes += indexedSession.bytes;
    evidence._forkRawFacts = [];
    evidence._forkLogicalRanges = [];
    evidence._canonicalRawDigests = [];
    emitProgress(onProgress, {
      phase: 'parsing',
      repoRoot: resolvedRepo,
      filesTotal: files.length,
      filesScanned: files.length,
      candidateFileCount: candidates.length,
      skippedFileCount,
      unknownFileCount,
      indexedFileCount,
      analyzedFileCount,
      reusedFileCount,
      indexedBytes,
      candidateBytes,
      sessionCount: indexedSessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      elapsedMs: Date.now() - startedAt,
    });
  }

  let projectQueryStore = queryStoreBuilder.finish();
  queryStoreBuilder = null;
  let legacyRawOwners = legacyRawOwnerBuilder.finish();
  let catalogs = catalogAccumulator.finish();
  if (canReusePrevious
      && reusedFileCount === indexedSessions.length
      && previousIndex.sessions.length === indexedSessions.length) {
    if (previousIndex.projectQueryStore
        && isDeepStrictEqual(previousIndex.projectQueryStore, projectQueryStore)) {
      projectQueryStore = previousIndex.projectQueryStore;
    }
    if (previousIndex.legacyRawOwners
        && isDeepStrictEqual(previousIndex.legacyRawOwners, legacyRawOwners)) {
      legacyRawOwners = previousIndex.legacyRawOwners;
    }
    if (isDeepStrictEqual(previousIndex.eventKinds, catalogs.eventKinds)
        && isDeepStrictEqual(previousIndex.codeModeRequests, catalogs.codeModeRequests)) {
      catalogs = {
        eventKinds: previousIndex.eventKinds,
        codeModeRequests: previousIndex.codeModeRequests,
      };
    }
  }
  indexedSessions.sort((left, right) => (
    String(right.updatedAt || right.startedAt).localeCompare(String(left.updatedAt || left.startedAt))
  ));
  emitProgress(onProgress, {
    phase: 'complete',
    repoRoot: resolvedRepo,
    filesTotal: files.length,
    filesScanned: files.length,
    candidateFileCount: candidates.length,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount,
    analyzedFileCount,
    reusedFileCount,
    indexedBytes,
    candidateBytes,
    sessionCount: indexedSessions.length,
    eventCount: logicalEventCount,
    rawEventCount,
    elapsedMs: Date.now() - startedAt,
  });
  return {
    sourceKind: CODEX_SOURCE_KIND,
    sourceHome: resolvedCodex,
    sourceRoot: sessionsRoot,
    repoRoot: resolvedRepo,
    codexHome: resolvedCodex,
    sessionsRoot,
    generatedAt: new Date().toISOString(),
    sessions: indexedSessions,
    sessionsById,
    projectQueryStore,
    materializationDependencies,
    legacyRawOwners,
    eventKinds: catalogs.eventKinds,
    codeModeRequests: catalogs.codeModeRequests,
    totals: {
      fileCount: files.length,
      candidateFileCount: candidates.length,
      indexedFileCount,
      reusedFileCount,
      skippedFileCount,
      unknownFileCount,
      sessionCount: indexedSessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      indexedBytes,
      candidateBytes,
    },
  };
}

async function materializeCodexSession({ materializationContext, indexedSession, dependencySet, signal }) {
  throwIfAborted(signal);
  const index = materializationContext;
  const descriptor = indexedSession.materializationDescriptor;
  const entry = dependencySet.entries[0];
  const target = path.resolve(index.sessionsRoot, descriptor.payload.sourceFile);
  if (!isPathInsideOrSame(target, index.sessionsRoot)) throw indexedSourceStaleError();
  const session = await parseSessionFile(
    target,
    descriptor.payload.sourceFile,
    index.repoRoot,
    signal,
    {
      acceptedSourceSnapshot: {
        acceptedBytes: entry.acceptedBytes,
        digest: entry.digest,
        fileIdentity: entry.evidence.fileIdentity,
      },
      canonicalRawDigests: indexedSession.forkStorageMode === 'materialized',
    },
  );
  if (session.id !== indexedSession.id || session.lineCount !== indexedSession.lineCount) {
    throw indexedSourceStaleError();
  }
  if (indexedSession.forkStorageMode === 'materialized') {
    const copiedPrefixDigest = crypto.createHash('sha256').update(
      session._canonicalRawDigests
        .slice(1, descriptor.payload.copiedPrefixCount + 1)
        .join('\n'),
      'utf8',
    ).digest('base64url');
    if (copiedPrefixDigest !== descriptor.payload.copiedPrefixDigest) {
      throw indexedSourceStaleError();
    }
  }
  applyCodexRelationshipEvidence(session, {
    ...descriptor.payload.relationship,
    rawEventCount: indexedSession.rawEventCount,
  }, indexedSourceStaleError);
  finalizeSession(session, {
    title: indexedSession.title,
    updatedAt: indexedSession.updatedAt,
  });
  const summary = codexSearch.projectSessionMetadata(session).summary;
  const carried = projectCodexCarriedSession(session, summary);
  const materialized = {
    ...carried,
    materializationSnapshotId: descriptor.sourceSnapshotId,
    rawEvents: session.rawEvents,
    logicalEvents: session.logicalEvents,
    analysis: session.analysis,
    presentationIndexes: session.presentationIndexes,
    _shell: String(session.shell || ''),
  };
  if (indexedSession.forkStorageMode === 'materialized') {
    materialized._forkSegmentsByRawId = session._forkSegmentsByRawId;
  }
  return materialized;
}

function requireExactCodexKeys(value, keys, owner) {
  const actual = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${owner} must contain exactly ${expected.join(', ')}`);
  }
}

function validateCodexMaterializationDescriptor({
  materializationContext,
  indexedSession,
  descriptor,
  dependencySet,
}) {
  const index = materializationContext;
  requireExactCodexKeys(
    descriptor.payload,
    ['sourceFile', 'rawSegments', 'copiedPrefixCount', 'copiedPrefixDigest', 'relationship'],
    'Codex materialization payload',
  );
  const sourceFile = descriptor.payload.sourceFile;
  if (typeof sourceFile !== 'string'
      || !sourceFile
      || path.isAbsolute(sourceFile)
      || !isPathInsideOrSame(path.resolve(index.sessionsRoot, sourceFile), index.sessionsRoot)
      || sourceFile !== indexedSession.sourceFile) {
    throw new Error('Codex materialization sourceFile is invalid');
  }
  if (!isDeepStrictEqual(
    descriptor.payload.relationship,
    codexRelationshipSnapshot(indexedSession),
  )) {
    throw new Error('Codex materialization relationship snapshot is invalid');
  }
  if (!Array.isArray(dependencySet.entries) || dependencySet.entries.length !== 2) {
    throw new Error('Codex materialization requires transcript and copied metadata dependencies');
  }
  const [entry, copiedMetadataEntry] = dependencySet.entries;
  if (entry.role !== 'primary_transcript'
      || entry.pathIdentity !== sourceFile
      || entry.existence !== 'present'
      || entry.kind !== 'file'
      || entry.policy !== 'accepted_prefix'
      || entry.acceptedBytes !== indexedSession.bytes
      || entry.lineCount !== indexedSession.lineCount
      || !/^[A-Za-z0-9_-]{43}$/.test(entry.digest)
      || entry.directoryEntries.length !== 0) {
    throw new Error('Codex transcript dependency is invalid');
  }
  requireExactCodexKeys(entry.evidence, ['fileIdentity'], 'Codex transcript dependency evidence');
  requireExactCodexKeys(entry.evidence.fileIdentity, ['device', 'inode'], 'Codex file identity');
  if (typeof entry.evidence.fileIdentity.device !== 'string'
      || typeof entry.evidence.fileIdentity.inode !== 'string') {
    throw new Error('Codex file identity is invalid');
  }
  requireExactCodexKeys(
    copiedMetadataEntry.evidence,
    ['title', 'updatedAt', 'sourceEntry'],
    'Codex copied Session metadata evidence',
  );
  if (copiedMetadataEntry.evidence.sourceEntry !== null) {
    requireExactCodexKeys(
      copiedMetadataEntry.evidence.sourceEntry,
      ['title', 'updatedAt'],
      'Codex copied source metadata entry',
    );
    if (typeof copiedMetadataEntry.evidence.sourceEntry.title !== 'string'
        || typeof copiedMetadataEntry.evidence.sourceEntry.updatedAt !== 'string') {
      throw new Error('Codex copied source metadata entry is invalid');
    }
  }
  if (copiedMetadataEntry.role !== 'copied_session_metadata'
      || copiedMetadataEntry.pathIdentity !== `session_index.jsonl#${encodeURIComponent(indexedSession.id)}`
      || copiedMetadataEntry.existence !== 'present'
      || copiedMetadataEntry.kind !== 'file'
      || copiedMetadataEntry.policy !== 'copied_value'
      || copiedMetadataEntry.acceptedBytes !== 0
      || copiedMetadataEntry.lineCount !== 0
      || copiedMetadataEntry.directoryEntries.length !== 0
      || copiedMetadataEntry.evidence.title !== indexedSession.title
      || copiedMetadataEntry.evidence.updatedAt !== indexedSession.updatedAt
      || copiedMetadataEntry.digest !== hashCodexMaterializationValue({
        title: indexedSession.title,
        updatedAt: indexedSession.updatedAt,
      })) {
    throw new Error('Codex copied Session metadata dependency is invalid');
  }
  const expectedDependencySetId = `codex-dependency:${hashCodexMaterializationValue(
    dependencySet.entries,
  )}`;
  if (dependencySet.id !== expectedDependencySetId
      || descriptor.dependencySetId !== expectedDependencySetId) {
    throw new Error('Codex dependency identity is invalid');
  }

  const expectedCopiedCount = indexedSession.forkStorageMode === 'materialized'
    ? indexedSession.forkEvidence?.matchedParentRawCount
    : 0;
  if (descriptor.payload.copiedPrefixCount !== expectedCopiedCount) {
    throw new Error('Codex copied-prefix count is invalid');
  }
  const expectedRanges = indexedSession.forkStorageMode === 'materialized'
    ? [
      { segment: 'fork_metadata', start: 0, end: 1 },
      { segment: 'inherited_context', start: 1, end: expectedCopiedCount + 1 },
      { segment: 'continuation', start: expectedCopiedCount + 1, end: indexedSession.rawEventCount },
    ]
    : [];
  if (!isDeepStrictEqual(descriptor.payload.rawSegments, expectedRanges)
      || (expectedCopiedCount > 0
        ? !/^[A-Za-z0-9_-]{43}$/.test(descriptor.payload.copiedPrefixDigest)
        : descriptor.payload.copiedPrefixDigest !== '')) {
    throw new Error('Codex fork segment projection is invalid');
  }
  const expectedSnapshotId = `codex-snapshot:${hashCodexMaterializationValue({
    dependencySet,
    payload: descriptor.payload,
  })}`;
  if (descriptor.sourceSnapshotId !== expectedSnapshotId) {
    throw new Error('Codex materialization snapshot identity is invalid');
  }
}

function validateCodexLegacyRawOwnerIndex({ sessionIds: ownedSessionIds, legacyRawOwners }) {
  requireExactCodexKeys(legacyRawOwners.payload, ['sessionIds', 'files'], 'Codex legacy Raw owner payload');
  const { sessionIds, files } = legacyRawOwners.payload;
  if (!Array.isArray(sessionIds) || !files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('Codex legacy Raw owner payload is invalid');
  }
  const uniqueSessionIds = new Set(sessionIds);
  if (uniqueSessionIds.size !== sessionIds.length
      || !(ownedSessionIds instanceof Set)
      || sessionIds.some((sessionId) => typeof sessionId !== 'string' || !ownedSessionIds.has(sessionId))) {
    throw new Error('Codex legacy Raw owner Session dictionary is invalid');
  }
  let entryCount = 0;
  for (const [file, lines] of Object.entries(files)) {
    if (!file || normalizeFsPath(file) !== file || !lines || typeof lines !== 'object' || Array.isArray(lines)) {
      throw new Error('Codex legacy Raw owner file dictionary is invalid');
    }
    for (const [lineKey, encoded] of Object.entries(lines)) {
      const line = Number(lineKey);
      if (!Number.isSafeInteger(line) || line < 1 || String(line) !== lineKey || typeof encoded !== 'string') {
        throw new Error('Codex legacy Raw owner line entry is invalid');
      }
      if (!encoded) continue;
      const separator = encoded.indexOf(':');
      const sessionIndex = Number(encoded.slice(0, separator));
      const sessionId = sessionIds[sessionIndex];
      const rawId = encoded.slice(separator + 1);
      if (separator < 1
          || !Number.isSafeInteger(sessionIndex)
          || sessionIndex < 0
          || !sessionId
          || rawId !== `${sessionId}:raw:${line}`) {
        throw new Error('Codex legacy Raw owner encoding is invalid');
      }
      entryCount += 1;
    }
  }
  if (entryCount !== legacyRawOwners.entryCount) {
    throw new Error('Codex legacy Raw owner entry count is invalid');
  }
}

function validateCodexMaterializedPrivateState({ indexedSession, session }) {
  if (typeof session._shell !== 'string'
      || Buffer.byteLength(session._shell, 'utf8') > CODEX_MATERIALIZED_SHELL_MAX_BYTES) {
    throw new Error(`Codex Materialized Session shell must be a string of at most ${CODEX_MATERIALIZED_SHELL_MAX_BYTES} UTF-8 bytes`);
  }
  const rawSegments = session._forkSegmentsByRawId;
  if (indexedSession.forkStorageMode !== 'materialized') {
    if (rawSegments !== undefined) throw new Error('Ordinary Codex Session must not retain fork segments');
    return;
  }
  if (!(rawSegments instanceof Map) || rawSegments.size !== session.rawEvents.length) {
    throw new Error('Materialized Codex fork segments must cover every Raw Record');
  }
  const expectedRanges = indexedSession.materializationDescriptor.payload.rawSegments;
  for (let index = 0; index < session.rawEvents.length; index += 1) {
    const expected = expectedRanges.find((range) => index >= range.start && index < range.end)?.segment || '';
    if (!CODEX_FORK_SEGMENTS.includes(expected)
        || rawSegments.get(session.rawEvents[index].rawId) !== expected) {
      throw new Error('Materialized Codex fork segment ownership is invalid');
    }
  }
}

const codexSearch = createCodexSearch({
  canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION,
  codeModePresentationFactsForEvent,
  codeModePresentationContextMap,
  codeModeRequestCatalog,
  codeModeRequestLabel: i18n.codeModeRequestLabel,
  codeModeRequestMatches,
  normalizeCodeModeRequest,
  codeModeScriptOperationKind: CODE_MODE_SCRIPT_OPERATION_KIND,
  codexSourceLocator,
  defaultLocale: i18n.DEFAULT_LOCALE,
  derivedSessionKind,
  displayProjectFile,
  eventKindCatalog,
  isCodeModeScriptOperation,
  localizedLogicalLabel,
  normalizeSearchPath,
  rawRecordLabel,
  rawRef,
  rawForkSegment,
  resolveLocale: i18n.resolveLocale,
  sanitizeLogicalEnvelopeValue,
  sanitizeLogicalEventDto,
});
const {
  fileSuggestions,
  filterSessions,
  getEvent,
  getTimeline,
  matchTerms,
} = codexSearch;

async function readRawLine(index, relFile, lineNumber) {
  const target = path.resolve(index.sessionsRoot, relFile);
  if (!isPathInsideOrSame(target, index.sessionsRoot)) return null;
  const stream = fs.createReadStream(target, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let current = 0;
  for await (const line of rl) {
    current += 1;
    if (current === lineNumber) {
      const parsed = safeJsonParse(line);
      rl.close();
      stream.destroy();
      return { file: relFile, line: lineNumber, raw: line, parsed };
    }
  }
  return null;
}

function indexedSourceStaleError() {
  const error = new Error('Indexed source changed; reindex required');
  error.name = 'IndexedSourceStaleError';
  error.code = 'INDEXED_SOURCE_STALE';
  error.statusCode = 409;
  return error;
}

function validateIndexedCodexRaw(session, raw, sessionRawIds) {
  const expectedLocator = codexSourceLocator(raw?.source);
  const locator = raw?.sourceLocator;
  if (!raw
      || !sessionRawIds.has(raw.rawId)
      || !expectedLocator
      || locator?.type !== expectedLocator.type
      || locator.file !== expectedLocator.file
      || locator.line !== expectedLocator.line
      || !Number.isInteger(raw.source?.line)
      || raw.source.line < 1
      || !raw.sourceLineDigest
      || (session.sourceFile && normalizeFsPath(raw.source.file) !== normalizeFsPath(session.sourceFile))) {
    throw indexedSourceStaleError();
  }
}

async function readIndexedCodexSourceRowsUncoordinated(index, session, raws, options = {}) {
  const { signal } = options;
  throwIfAborted(signal);
  const groups = new Map();
  const sessionRawIds = new Set((session.rawEvents || []).map((raw) => raw.rawId));
  for (const raw of raws || []) {
    throwIfAborted(signal);
    validateIndexedCodexRaw(session, raw, sessionRawIds);
    const relFile = raw.source.file;
    if (!groups.has(relFile)) groups.set(relFile, new Map());
    const lines = groups.get(relFile);
    if (!lines.has(raw.source.line)) lines.set(raw.source.line, []);
    lines.get(raw.source.line).push(raw);
  }

  const rowsByRawId = new Map();
  for (const [relFile, expectedLines] of groups) {
    throwIfAborted(signal);
    const target = path.resolve(index.sessionsRoot, relFile);
    if (!isPathInsideOrSame(target, index.sessionsRoot)) throw indexedSourceStaleError();
    await options.onFileOpen?.(relFile);
    throwIfAborted(signal);
    let maxLine = 0;
    for (const line of expectedLines.keys()) maxLine = Math.max(maxLine, line);
    const stream = fs.createReadStream(target, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const abortScan = () => {
      rl.close();
      stream.destroy();
    };
    signal?.addEventListener('abort', abortScan, { once: true });
    let current = 0;
    try {
      for await (const line of rl) {
        throwIfAborted(signal);
        current += 1;
        options.onSourceLine?.(relFile, current);
        throwIfAborted(signal);
        const expectedRaws = expectedLines.get(current);
        if (expectedRaws) {
          const digest = sourceLineDigest(line);
          for (const raw of expectedRaws) {
            if (digest !== raw.sourceLineDigest) throw indexedSourceStaleError();
            rowsByRawId.set(raw.rawId, {
              file: relFile,
              line: current,
              raw: line,
              parsed: safeJsonParse(line),
            });
          }
        }
        if (current >= maxLine) break;
      }
      throwIfAborted(signal);
    } catch (error) {
      throwIfAborted(signal);
      if (error.code === 'ENOENT') throw indexedSourceStaleError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abortScan);
      rl.close();
      stream.destroy();
    }
  }

  if (rowsByRawId.size !== (raws || []).length) throw indexedSourceStaleError();
  return rowsByRawId;
}

async function readIndexedCodexSourceRows(index, session, raws, options = {}) {
  if (options[CODEX_HYDRATION_SLOT_OWNED]) {
    return readIndexedCodexSourceRowsUncoordinated(index, session, raws, options);
  }
  return withCodexHydrationSlot(index, options.signal, () => (
    readIndexedCodexSourceRowsUncoordinated(index, session, raws, options)
  ));
}

async function hydrateCodexRawEvents(index, session, raws, options = {}) {
  const rowsByRawId = await readIndexedCodexSourceRows(index, session, raws, options);
  return raws.map((residentRaw) => {
    throwIfAborted(options.signal);
    const sourceRow = rowsByRawId.get(residentRaw.rawId);
    const record = sourceRow?.parsed;
    if (!record) throw indexedSourceStaleError();
    const embeddedImages = [];
    externalizeKnownImageGenerationResult(record, residentRaw.source, embeddedImages);
    externalizeEmbeddedImages(record, residentRaw.source, embeddedImages);
    const hydratedRaw = makeRawEvent(
      record,
      residentRaw.source.line,
      residentRaw.source.file,
      residentRaw.sessionId,
      embeddedImages,
    );
    return {
      ...residentRaw,
      ...hydratedRaw,
      sourceLineDigest: residentRaw.sourceLineDigest,
    };
  });
}

async function buildHydratedEventDetail(index, session, eventId, layer = 'main', options = {}) {
  return withCodexHydrationSlot(index, options.signal, async () => {
    let raws;
    if (layer === 'raw') {
      const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
      if (!raw) return null;
      raws = [raw];
    } else {
      const logical = session.logicalEvents.find((candidate) => candidate.id === eventId && candidate.layer === layer);
      if (!logical) return null;
      raws = rawEventsForLogicalEvent(session, logical);
    }
    const hydratedRaws = await hydrateCodexRawEvents(index, session, raws, {
      ...options,
      [CODEX_HYDRATION_SLOT_OWNED]: true,
    });
    throwIfAborted(options.signal);
    return buildEventDetail({ ...session, rawEvents: hydratedRaws }, eventId, layer, options);
  });
}

async function readIndexedCodexRawRecord(index, session, raw, options = {}) {
  if (!options[CODEX_HYDRATION_SLOT_OWNED]) {
    return withCodexHydrationSlot(index, options.signal, () => readIndexedCodexRawRecord(index, session, raw, {
      ...options,
      [CODEX_HYDRATION_SLOT_OWNED]: true,
    }));
  }
  const rowsByRawId = await readIndexedCodexSourceRows(index, session, [raw], options);
  throwIfAborted(options.signal);
  return rowsByRawId.get(raw.rawId) || null;
}

function resolveIndexedCodexLegacyRaw(index, file, line) {
  if (typeof file !== 'string' || !file || !Number.isSafeInteger(line) || line < 1) return null;
  const normalizedFile = normalizeFsPath(file);
  const payload = index?.legacyRawOwners?.payload;
  const encodedOwner = payload?.files?.[normalizedFile]?.[String(line)];
  if (typeof encodedOwner !== 'string' || !encodedOwner) return null;
  const separator = encodedOwner.indexOf(':');
  if (separator < 1) return null;
  const sessionIndex = Number(encodedOwner.slice(0, separator));
  const rawIdHint = encodedOwner.slice(separator + 1);
  const sessionId = payload?.sessionIds?.[sessionIndex];
  if (!Number.isSafeInteger(sessionIndex)
      || sessionIndex < 0
      || typeof sessionId !== 'string'
      || !sessionId
      || !rawIdHint) return null;
  return { sessionId, rawIdHint, line };
}

function jsonPathValue(value, jsonPath) {
  let current = value;
  for (const key of jsonPath || []) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function imagePreviewError(statusCode, error, code = '') {
  return { statusCode, error, ...(code ? { code } : {}) };
}

function decodeImagePreviewDataUrl(value, options = {}) {
  const maxEncodedChars = options.maxEncodedChars ?? IMAGE_PREVIEW_MAX_ENCODED_CHARS;
  const maxDecodedBytes = options.maxDecodedBytes ?? IMAGE_PREVIEW_MAX_DECODED_BYTES;
  const inspected = inspectSupportedImageDataUrl(value);
  if (!inspected) return imagePreviewError(422, 'Image preview payload is malformed');
  if (inspected.encodedLength > maxEncodedChars || inspected.estimatedBytes > maxDecodedBytes) {
    return imagePreviewError(413, 'Image preview is too large');
  }
  const compact = inspected.payload.replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0 || !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(compact)) {
    return imagePreviewError(422, 'Image preview payload is malformed');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > maxDecodedBytes) return imagePreviewError(413, 'Image preview is too large');
  return {
    bytes,
    mimeType: inspected.mimeType,
  };
}

async function readImagePreview(index, sessionOrId, eventId, previewId, options = {}) {
  if (!options[CODEX_HYDRATION_SLOT_OWNED]) {
    return withCodexHydrationSlot(index, options.signal, () => readImagePreview(
      index,
      sessionOrId,
      eventId,
      previewId,
      { ...options, [CODEX_HYDRATION_SLOT_OWNED]: true },
    ));
  }
  const session = sessionOrId && typeof sessionOrId === 'object'
    ? sessionOrId
    : index.sessionsById.get(sessionOrId);
  if (!session) return imagePreviewError(404, 'Unknown session');
  const event = session.logicalEvents.find((candidate) => candidate.id === eventId);
  if (!event) return imagePreviewError(404, 'Unknown event');
  const raws = rawEventsForLogicalEvent(session, event);
  let selectedRaw = null;
  let descriptor = null;
  for (const raw of raws) {
    const match = (raw.embeddedImages || []).find((image) => image.previewId === previewId);
    if (!match) continue;
    selectedRaw = raw;
    descriptor = match;
    break;
  }
  if (!descriptor || !selectedRaw) return imagePreviewError(404, 'Unknown image preview');
  if (options.expectedSourceKind) {
    validateCanonicalRawEventShape(selectedRaw, options.expectedSourceKind);
  }
  if (descriptor.source.file !== selectedRaw.source.file || descriptor.source.line !== selectedRaw.source.line) {
    return imagePreviewError(409, 'Image preview source is stale', 'INDEXED_SOURCE_STALE');
  }
  let sourceRow;
  try {
    const rowsByRawId = await readIndexedCodexSourceRows(index, session, [selectedRaw], options);
    sourceRow = rowsByRawId.get(selectedRaw.rawId);
  } catch (error) {
    if (error.code === 'INDEXED_SOURCE_STALE') {
      return imagePreviewError(409, 'Image preview source is stale', error.code);
    }
    throw error;
  }
  throwIfAborted(options.signal);
  if (!sourceRow?.parsed) return imagePreviewError(409, 'Image preview source is stale', 'INDEXED_SOURCE_STALE');
  const value = jsonPathValue(sourceRow.parsed, descriptor.source.jsonPath);
  const inspected = inspectSupportedImagePayload(value, descriptor.encoding);
  if (!inspected || inspected.mimeType !== descriptor.mimeType) {
    return imagePreviewError(409, 'Image preview source is stale', 'INDEXED_SOURCE_STALE');
  }
  if (inspected.encodedLength > IMAGE_PREVIEW_MAX_ENCODED_CHARS
      || inspected.estimatedBytes > IMAGE_PREVIEW_MAX_DECODED_BYTES) {
    return imagePreviewError(413, 'Image preview payload is too large');
  }
  if (imagePresentationKey(value, inspected.mimeType) !== descriptor.dedupeKey) {
    return imagePreviewError(409, 'Image preview source is stale', 'INDEXED_SOURCE_STALE');
  }
  throwIfAborted(options.signal);
  if (descriptor.encoding === 'bare_base64') {
    const decoded = decodeImagePreviewDataUrl(`data:${descriptor.mimeType};base64,${inspected.payload}`);
    if (decoded.error === 'Image preview payload is malformed') return imagePreviewError(422, decoded.error);
    throwIfAborted(options.signal);
    return decoded;
  }
  const decoded = decodeImagePreviewDataUrl(value);
  throwIfAborted(options.signal);
  return decoded;
}

// Test-only introspection for focused equivalence coverage; this is not a supported runtime API.
const __testOnly = Object.freeze({
  buildUncompactedIndexForDetailTests: (options) => buildIndex({
    ...options,
    retainFullSourceRecordsForTests: true,
  }),
  compactCodexRawEvent,
  formatResetTime,
  isReusableCompactSession,
  isEcmaScriptWhitespace,
  resetTimeCacheLimit: RESET_TIME_CACHE_LIMIT,
  resetTimeCacheSize: () => resetTimeCache.size,
  sessionReviewMarkers,
  truncate,
});

module.exports = {
  __testOnly,
  buildCodexLegacyRawOwnerIndex,
  buildHydratedEventDetail,
  buildIndex,
  buildSourceBackedIndex,
  discoverProjects,
  decodeImagePreviewDataUrl,
  discoverConfiguredProjects,
  buildEventDetail,
  fileSuggestions,
  filterSessions,
  getEvent,
  getTimeline,
  eventKindCatalog,
  readImagePreview,
  resolveIndexedCodexLegacyRaw,
  readIndexedCodexRawRecord,
  readIndexedCodexSourceRows,
  readRawLine,
  sourceLineDigest,
  normalizeFsPath,
  isPathInsideOrSame,
  matchTerms,
  normalizeCodeModeRequest,
  materializeCodexSession,
  materializedPrivateFields: CODEX_MATERIALIZATION_PRIVATE_FIELDS,
  query: codexSearch,
  validateCodexLegacyRawOwnerIndex,
  validateCodexMaterializationDescriptor,
  validateCodexMaterializedPrivateState,
};
