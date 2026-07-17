'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const MarkdownIt = require('markdown-it');
const { SHELL_EXTERNAL_COMMAND_WORDS } = require('./shared/command-highlighting');
const i18n = require('./shared/i18n');
const {
  codeModeAssociableOutputFragments,
  codeModeDisplayOutputText,
  codeModeOutputText,
  projectCodeModeOperations,
} = require('./codex-code-mode');
const { projectDeclaredCodeModeCalls } = require('./codex-code-mode-declared');
const { stripAnsiSequences } = require('./shared/terminal-text');
const { deriveCodeModeFacts } = require('./codex-code-mode-facts');
const { createCodexDetailBuilder } = require('./codex-detail');
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
const {
  CANONICAL_SCHEMA_VERSION,
  CODEX_SOURCE_KIND,
  codexSourceLocator,
  createCodexRawParser,
  rawEventsForLogicalEvent,
  rawMatchesEvent,
  rawRef,
} = require('./codex-source');

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const SECTION_TYPES = new Set(['markdown', 'code', 'terminal', 'json', 'diff', 'patch', 'kv', 'notice', 'raw_json', 'token_usage', 'usage_limits', 'user_input', 'plan_update', 'collaboration', 'image_preview', 'event_refs', 'code_mode_trace', 'code_mode_tool_projection', 'code_mode_source', 'web_request']);
const TOOL_DATA_URL_MARKER = '[embedded data URL omitted; see raw refs]';
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

let markdownRenderer = null;
let gb18030ReverseMap = null;

function normalizeFsPath(input) {
  if (!input) return '';
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideOrSame(child, parent) {
  const c = normalizeFsPath(child);
  const p = normalizeFsPath(parent);
  return c === p || c.startsWith(`${p}${path.sep}`);
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
  if (path.isAbsolute(text) && repoRoot && isPathInsideOrSame(text, repoRoot)) {
    return path.relative(repoRoot, text).replace(/\\/g, '/');
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
  patch: 'Patch',
  mcp_call: 'MCP call',
  js_repl: 'JS REPL',
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

const TOOL_EVENT_TYPES = new Set([
  'exec_command_begin',
  'exec_command_update',
  'exec_command_delta',
  'exec_command_end',
  'exec_command_declined',
  'patch_apply_begin',
  'patch_apply_update',
  'patch_apply_delta',
  'patch_apply_end',
  'patch_apply_declined',
  'mcp_tool_call_begin',
  'mcp_tool_call_update',
  'mcp_tool_call_delta',
  'mcp_tool_call_end',
  'mcp_tool_call_declined',
  'image_generation_call_begin',
  'image_generation_call_update',
  'image_generation_call_delta',
  'image_generation_call_end',
  'image_generation_call_declined',
  'image_generation_end',
  'dynamic_tool_call_begin',
  'dynamic_tool_call_update',
  'dynamic_tool_call_delta',
  'dynamic_tool_call_end',
  'dynamic_tool_call_declined',
  'approval_request_begin',
  'approval_request_end',
  'approval_request_declined',
  'hook_begin',
  'hook_end',
  'hook_declined',
  'hook_started',
  'hook_completed',
  'collab_agent_spawn_begin',
  'collab_agent_spawn_end',
  'collab_agent_interaction_begin',
  'collab_agent_interaction_end',
  'collab_waiting_begin',
  'collab_waiting_end',
  'collab_close_begin',
  'collab_close_end',
]);

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
    if (value == null || value === '') continue;
    if (typeof value === 'object') {
      if (Array.isArray(value) && value.every((item) => typeof item !== 'object')) {
        entries.push({ key, value: value.join(', ') });
      }
      continue;
    }
    entries.push({ key, value: String(value) });
  }
  return entries;
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

function sessionUsesPowerShell(value) {
  const shell = normalizedSessionShell(value);
  return shell === 'powershell' || shell === 'pwsh';
}

function commandLanguageContext(session = {}) {
  return { sessionShell: session.shell || '' };
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

function maybePushPatchSection(sections, title, text) {
  const section = parsePatchSection(text);
  if (!section) return false;
  section.title = title;
  sections.push(section);
  return true;
}

function maybePushKvSection(sections, title, entries) {
  const filtered = (entries || []).filter((entry) => entry && entry.key && entry.value !== '');
  if (!filtered.length) return;
  sections.push({ type: 'kv', title, entries: filtered });
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

function maybePushMarkdownSection(sections, title, text) {
  const source = String(text || '').trim();
  if (!source) return;
  sections.push({
    type: 'markdown',
    title,
    html: renderMarkdownToHtml(source),
  });
}

function normalizeLanguage(language, fallback = 'text') {
  const source = String(language || '').trim().toLowerCase();
  return source || fallback;
}

function maybePushCodeSection(sections, title, code, language = 'text') {
  const source = String(code || '').trim();
  if (!source) return;
  sections.push({ type: 'code', title, code: source, language: normalizeLanguage(language, 'text') });
}

function inferTerminalLanguage(text) {
  const source = String(text || '').trim();
  if (!source) return 'text';
  if (looksLikeDiff(source)) return 'diff';
  if (coerceJsonValue(source)) return 'json';
  return 'text';
}

function maybePushTerminalSection(sections, title, text, stream = 'stdout', language = '') {
  const source = normalizeTerminalReplacementPlaceholders(repairLikelyMojibake(stripAnsiSequences(text)));
  if (!source.trim()) return;
  sections.push({ type: 'terminal', title, text: source, stream, language: normalizeLanguage(language || inferTerminalLanguage(source), 'text') });
}

function maybePushStructuredSection(sections, title, value, options = {}) {
  const jsonValue = coerceJsonValue(value);
  if (jsonValue) {
    sections.push({ type: 'json', title, value: jsonValue });
    return 'json';
  }
  const text = stringifyValue(value).trim();
  if (!text) return '';
  if (looksLikeDiff(text)) {
    sections.push({ type: 'diff', title, text });
    return 'diff';
  }
  sections.push({ type: options.rawType === 'raw_json'
    ? 'raw_json'
    : 'code', title, code: text, language: options.language || '' });
  return options.rawType === 'raw_json' ? 'raw_json' : 'code';
}

function maybePushParsedOutputSection(sections, title, value) {
  const jsonValue = coerceJsonValue(value);
  if (jsonValue) {
    sections.push({ type: 'json', title, value: jsonValue });
    return true;
  }
  const text = stringifyValue(value).trim();
  if (looksLikeDiff(text)) {
    sections.push({ type: 'diff', title, text });
    return true;
  }
  return false;
}

function makeNoticeSection(title, text, level = 'info') {
  return {
    type: 'notice',
    title,
    level,
    text: String(text || '').trim(),
  };
}

function hideSectionTitle(section) {
  if (section) section.hideTitle = true;
  return section;
}

function makeRawJsonSection(title, value, expanded = false) {
  return {
    type: 'raw_json',
    title,
    value,
    expanded,
  };
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
    if (!item.id) return null;
    return {
      id: item.id,
      title: item.thread_name || '',
      updatedAt: safeIso(item.updated_at),
    };
  } catch {
    return null;
  }
}

function subagentSpawnSource(payload) {
  return payload?.source?.subagent?.thread_spawn || null;
}

function forkedFromSessionIdFromMeta(payload) {
  return payload?.forked_from_id || '';
}

function parentSessionIdFromMeta(payload) {
  return subagentSpawnSource(payload)?.parent_thread_id || '';
}

function agentNicknameFromMeta(payload) {
  return payload?.agent_nickname || subagentSpawnSource(payload)?.agent_nickname || '';
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
    if (raw.recordType !== 'event_msg') continue;
    if (raw.payloadType === 'entered_review_mode') {
      markers.push({ enteredAt: raw.timestamp, exitedAt: '' });
    } else if (raw.payloadType === 'exited_review_mode') {
      let marker = markers[markers.length - 1];
      if (!marker || marker.exitedAt) {
        marker = { enteredAt: '', exitedAt: '' };
        markers.push(marker);
      }
      marker.exitedAt = raw.timestamp;
    }
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
    const repoRoot = path.resolve(stripExtendedPathPrefix(expandEnvironmentVariables(parsed)));
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
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : '';
  throwIfAborted(signal);
  const stat = await fsp.stat(filePath);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const cwdSet = new Set();

  try {
    for await (const line of rl) {
      throwIfAborted(signal);
      if (!line.trim()) continue;
      if (!line.includes('"cwd"')) continue;
      const record = safeJsonParse(line);
      if (!record) continue;
      const payloadType = record.type === 'event_msg' ? record.payload?.type : '';
      const cwd = record.type === 'session_meta' || payloadType === 'session_configured' ? record.payload?.cwd : '';
      if (cwd) {
        const resolvedCwd = path.resolve(cwd);
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
  };
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
    title: '',
    sourceFile: relFile,
    sourceAbsFile: filePath,
    bytes: stat.size,
    lineCount: 0,
    cwdSet: new Set(),
    startedAt: '',
    updatedAt: '',
    matchesRepo: false,
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    shell: '',
    primarySessionMetaKind: '',
    _reviewMarkers: [],
    rawEvents: [],
    logicalEvents: [],
    counts: {
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
    },
    analysis: null,
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
  maybePushMarkdownSection(sections, 'Message', uniqueNonEmpty(raws.map((raw) => raw.messageText)).join('\n\n'));
  hideSectionTitle(sections[0]);
  if (!sections.length) sections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
  return sections;
}

function extractReasoningSections(raws) {
  const sections = [];
  const text = joinBoundedUniqueText(raws.map((raw) => raw.messageText), '\n\n', REASONING_TEXT_LIMIT);
  if (text) {
    maybePushMarkdownSection(sections, 'Reasoning', text);
    hideSectionTitle(sections[0]);
  } else {
    sections.push(hideSectionTitle(makeNoticeSection('Reasoning', 'This reasoning record did not contain any text.', 'warning')));
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
  maybePushMarkdownSection(sections, 'Plan', planText);
  hideSectionTitle(sections[0]);
  sections.push(makeRawJsonSection('Plan raw JSON', raws.map((raw) => raw.parsed)));
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
  maybePushCodeSection(timelineSections, 'Command', commandText, inferCommandLanguage(commandText, args, commandLanguageContext(session)));

  maybePushKvSection(inspectorSections, 'Run context', [
    { key: 'cwd', value: String(execAny?.parsed?.payload?.cwd || args?.workdir || '') },
  ]);

  if (args) {
    inspectorSections.push({ type: 'json', title: 'Arguments', value: args });
  }

  const stdout = firstNonEmpty(execEnd?.stdout, execEnd?.aggregatedOutput, execEnd?.parsed?.payload?.formatted_output, formatted?.output);
  const stderr = execEnd?.stderr || execAny?.stderr || '';
  maybePushTerminalSection(timelineSections, 'stdout', stdout, 'stdout');
  maybePushTerminalSection(timelineSections, 'stderr', stderr, 'stderr');

  if (stdout) maybePushParsedOutputSection(inspectorSections, 'stdout structure', stdout);
  if (stderr) maybePushParsedOutputSection(inspectorSections, 'stderr structure', stderr);
  if (functionOutput?.output) maybePushParsedOutputSection(inspectorSections, 'Tool output', structuredOutputValue(functionOutput.output));

  if (!timelineSections.length && !inspectorSections.length) inspectorSections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
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
    timelineSections.push(resultPatchSection);
  }
  const patchText = customCall?.output || patchAny?.output || '';
  if (!timelineSections.length && patchText.trim() && !maybePushPatchSection(timelineSections, 'Patch', patchText)) {
    timelineSections.push({ type: 'diff', title: 'Patch', text: patchText.trim() });
  }

  const patchFileEntries = diffStatsEntries(patchEnd?.parsed?.payload?.changes, session.repoRoot);
  const fallbackPatchFileEntries = patchFileEntries.length ? [] : diffStatsEntriesFromPatchInput(patchText);
  maybePushKvSection(inspectorSections, 'Files', patchFileEntries.length ? patchFileEntries : fallbackPatchFileEntries);
  if (!patchFileEntries.length && !fallbackPatchFileEntries.length) {
    maybePushKvSection(inspectorSections, 'Touched files', event.touchedFiles.map((file) => ({ key: file, value: 'updated' })));
  }

  const noticeText = firstNonEmpty(
    envelope?.output,
    patchAny?.parsed?.payload?.stdout,
    patchAny?.parsed?.payload?.stderr,
    event.status ? `Patch ${event.status}.` : '',
  );
  if (noticeText) {
    inspectorSections.push(makeNoticeSection('Result', noticeText, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info'));
  }

  if (!timelineSections.some((section) => section.type === 'diff' || section.type === 'patch')) {
    inspectorSections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
  }
  return { timelineSections, inspectorSections };
}

function extractJsReplSections(raws, event) {
  const sections = [];
  const customCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const envelope = toolOutputEnvelope(customOutput);
  maybePushCodeSection(sections, 'JavaScript', customCall?.output, 'javascript');
  maybePushKvSection(sections, 'Run context', [
    { key: 'status', value: String(event.status || '') },
    { key: 'exitCode', value: event.outputStats.exitCode == null ? '' : String(event.outputStats.exitCode) },
    { key: 'durationMs', value: event.outputStats.durationMs == null ? '' : String(event.outputStats.durationMs) },
  ]);
  const outputValue = envelope && Object.hasOwn(envelope, 'output') ? envelope.output : customOutput?.output;
  if (coerceJsonValue(outputValue)) {
    sections.push({ type: 'json', title: 'Output', value: coerceJsonValue(outputValue) });
  } else {
    maybePushTerminalSection(sections, 'Output', stringifyValue(outputValue), event.status === 'failed' ? 'stderr' : 'stdout');
  }
  if (!sections.length) sections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
  return sections;
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
    { key: 'tool', value: String(event.toolName || '') },
    { key: 'status', value: String(event.status || '') },
    { key: 'durationMs', value: event.outputStats.durationMs == null ? '' : String(event.outputStats.durationMs) },
  ]);

  if (requestValue) {
    if (typeof requestValue === 'object') {
      sections.push({ type: 'json', title: 'Request', value: requestValue });
    } else {
      maybePushStructuredSection(sections, 'Request', requestValue);
    }
  }

  if (responseValue) {
    if (typeof responseValue === 'object') {
      sections.push({ type: 'json', title: 'Response', value: responseValue });
    } else {
      maybePushStructuredSection(sections, 'Response', responseValue);
    }
  }

  if (!sections.length) sections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
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
  return items.length ? { type: 'user_input', title: 'User input', questions: items } : null;
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
  maybePushMarkdownSection(sections, 'Goal', lines.join('\n\n'));
  maybePushKvSection(sections, 'Goal usage', entries);
  if (response.hasCompletionBudgetReport && response.completionBudgetReport != null && response.completionBudgetReport !== '') {
    maybePushStructuredSection(sections, 'Completion budget', response.completionBudgetReport);
  }
  if (!sections.length) {
    sections.push(hideSectionTitle(makeNoticeSection(event.label || 'Goal', event.preview || event.label || 'Goal', event.severity === 'warning' ? 'warning' : 'info')));
  }
  return sections;
}

function extractGoalSections(raws, event, splitSections) {
  const split = splitSections(extractToolSections(raws, event));
  const { requestValue, responseValue } = toolDetailValues(raws);
  const snapshotRaw = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'thread_goal_updated');
  const normalizedSnapshot = goalSnapshotFromRaw(snapshotRaw);
  const snapshotGoal = normalizedSnapshot?.goal;
  const resolvedResponseValue = responseValue || (snapshotGoal && typeof snapshotGoal === 'object' ? { goal: snapshotGoal } : null);
  const timelineSections = goalSection(raws, event, requestValue, resolvedResponseValue, normalizedSnapshot);
  const hasToolRows = raws.some((raw) => raw.recordType === 'response_item'
    && ['function_call', 'function_call_output'].includes(raw.payloadType));
  return {
    timelineSections,
    inspectorSections: hasToolRows
      ? sanitizeToolInspectorSections(split.inspectorSections)
      : snapshotGoal && typeof snapshotGoal === 'object'
        ? [{ type: 'json', title: 'Goal status', value: snapshotGoal }]
        : sanitizeToolInspectorSections(split.inspectorSections),
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

function embeddedBase64PayloadEnd(source, start) {
  let index = start;
  let malformed = false;
  while (index < source.length) {
    if (/["'<>`()\[\]{}]/.test(source[index])) break;
    if (/\s/.test(source[index])) {
      if (malformed) break;
      let next = index;
      while (next < source.length && /\s/.test(source[next])) next += 1;
      let tokenEnd = next;
      while (tokenEnd < source.length && !/[\s"'<>`()\[\]{}]/.test(source[tokenEnd])) tokenEnd += 1;
      if (tokenEnd === next) break;
      const token = source.slice(next, tokenEnd);
      index = tokenEnd;
      if (!/^[a-z0-9+/=_-]+$/i.test(token)) malformed = true;
      continue;
    }
    if (!/[a-z0-9+/=_-]/i.test(source[index])) malformed = true;
    index += 1;
  }
  return index;
}

function redactEmbeddedBase64DataUrls(value, headerPattern, marker, prefixGroup = 0) {
  const source = String(value || '');
  let cursor = 0;
  let redacted = '';
  headerPattern.lastIndex = 0;
  for (let match = headerPattern.exec(source); match; match = headerPattern.exec(source)) {
    redacted += source.slice(cursor, match.index);
    if (prefixGroup) redacted += match[prefixGroup];
    redacted += marker;
    cursor = embeddedBase64PayloadEnd(source, headerPattern.lastIndex);
    headerPattern.lastIndex = cursor;
  }
  return cursor ? redacted + source.slice(cursor) : source;
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

function redactEmbeddedDataUrls(value, marker = TOOL_DATA_URL_MARKER) {
  const source = String(value || '');
  if (!/data:/i.test(source)) return source;
  if (/^\s*data:[^,\s"'<>`]*,[\s\S]*$/i.test(source)) return marker;
  return redactEmbeddedBase64DataUrls(source, /(^|[^a-z0-9_])data:[^,\s"'<>`]*;base64,/gi, marker, 1)
    .replace(/(^|[^a-z0-9_])data:[^,\s"'<>`]*,[^\s"'<>`]*/gi, (match, prefix) => `${prefix}${marker}`);
}

function uniqueSanitizedObjectKey(key, usedKeys, marker) {
  const sanitized = redactEmbeddedDataUrls(key, marker);
  if (!usedKeys.has(sanitized)) {
    usedKeys.add(sanitized);
    return sanitized;
  }
  let suffix = 2;
  while (usedKeys.has(`${sanitized} #${suffix}`)) suffix += 1;
  const unique = `${sanitized} #${suffix}`;
  usedKeys.add(unique);
  return unique;
}

function sanitizeToolValue(value, options = {}, seen = new WeakMap()) {
  const marker = options.marker || TOOL_DATA_URL_MARKER;
  if (typeof value === 'string') {
    if (options.previewSources?.has(value)) return '[embedded image available in preview]';
    return redactEmbeddedDataUrls(value, marker);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular value omitted]';
  if (Array.isArray(value)) {
    const sanitized = [];
    seen.set(value, sanitized);
    sanitized.push(...value.map((item) => sanitizeToolValue(item, options, seen)));
    return sanitized;
  }
  const sanitized = {};
  const usedKeys = new Set();
  seen.set(value, sanitized);
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(sanitized, uniqueSanitizedObjectKey(key, usedKeys, marker), {
      value: sanitizeToolValue(item, options, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return sanitized;
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
      const agentLabel = firstNonEmpty(item?.agent_nickname, item?.thread_id);
      return collaborationStatusEntries(
        item?.status,
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
  const source = firstNonEmpty(responseValue.agent_statuses, responseValue.statuses, responseValue.previous_status, responseValue.status);
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
  const source = firstNonEmpty(responseValue.agent_statuses, responseValue.statuses, responseValue.previous_status, responseValue.status);
  const entries = collaborationResultEntries(source);
  return [...new Map(entries.map((item) => [`${item.label}\n${item.value}`, item])).values()].map(({ label, value }) => [
    label ? `### ${label}` : '',
    stringifyValue(value),
  ].filter(Boolean).join('\n\n')).join('\n\n');
}

function collaborationToolSection(toolName, requestValue, responseValue) {
  const title = {
    spawn_agent: 'Spawn subagent',
    wait_agent: 'Wait for subagent',
    send_input: 'Send input to subagent',
    close_agent: 'Close subagent',
  }[toolName];
  if (!title) return null;
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
    { key: 'Fork context', value: requestValue?.fork_context },
    { key: 'Nickname', value: firstNonEmpty(responseValue?.nickname, responseValue?.new_agent_nickname) },
    { key: 'Receiver', value: firstNonEmpty(responseValue?.receiver_agent_nickname, responseValue?.receiver_thread_id) },
  ].filter((entry) => entry.value != null && entry.value !== '').map((entry) => ({
    key: entry.key,
    value: conciseToolValue(entry.value, 1000),
  }));
  const message = redactEmbeddedDataUrls(stringifyValue(firstNonEmpty(requestValue?.message, responseValue?.prompt)));
  const result = redactEmbeddedDataUrls(collaborationResultMarkdown(responseValue));
  return {
    type: 'collaboration',
    title,
    action: toolName,
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

function maybePushToolSummaryCodeSection(sections, title, value) {
  if (value == null || value === '') return;
  const summarized = sanitizeToolTimelineValue(value);
  maybePushCodeSection(sections, title, stringifyValue(summarized), typeof summarized === 'object' ? 'json' : 'text');
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
    maybePushToolSummaryCodeSection(sections, 'Request summary', requestValue);
    return;
  }
  const payload = firstNonEmpty(requestValue.arguments, requestValue.input, requestValue.request, mcpPayloadValue(requestValue));
  const code = firstNonEmpty(payload?.code, requestValue.code, payload?.script, requestValue.script);
  const language = String(firstNonEmpty(payload?.language, requestValue.language, event.toolName === 'js' ? 'javascript' : '') || '').toLowerCase();
  if (code) {
    maybePushCodeSection(sections, language === 'javascript' ? 'JavaScript' : 'Code', String(code), language || 'text');
  }
  const entries = Object.entries(payload && typeof payload === 'object' ? payload : requestValue)
    .filter(([key, value]) => !['code', 'script'].includes(key) && value != null && value !== '' && typeof value !== 'object')
    .slice(0, 8)
    .map(([key, value]) => ({ key, value: conciseToolValue(value, 1000) }));
  if (entries.length) sections.push({ type: 'kv', title: 'Request', entries });
  if (!code && !entries.length) maybePushToolSummaryCodeSection(sections, 'Request summary', requestValue);
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
    maybePushTerminalSection(sections, 'Result', truncatePreservingWhitespace(redactEmbeddedDataUrls(text, TIMELINE_DATA_URL_MARKER), 4000), 'stdout');
    return;
  }
  const summarized = sanitizeMcpTimelineValue(payload);
  maybePushCodeSection(sections, 'Response summary', stringifyValue(summarized), typeof summarized === 'object' ? 'json' : 'text');
}

function extractMcpSections(raws, event, splitSections) {
  const split = splitSections(extractToolSections(raws, event));
  const { requestValue, responseValue } = toolDetailValues(raws);
  const timelineSections = [];
  pushMcpRequestSummary(timelineSections, event, requestValue);
  pushMcpResponseSummary(timelineSections, responseValue);
  if (!timelineSections.length) timelineSections.push(...sanitizeUnmodeledToolTimelineSections(split.timelineSections));
  if (!timelineSections.length) {
    timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info')));
  }
  return {
    timelineSections: sanitizeUnmodeledToolTimelineSections(timelineSections),
    inspectorSections: sanitizeToolInspectorSections(split.inspectorSections),
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
    previewSources: section.title === 'Response' ? previewSources : new Set(),
  }));
}

function extractToolOperationSections(raws, event, splitSections) {
  const split = splitSections(extractToolSections(raws, event));
  const { requestValue, responseValue } = toolDetailValues(raws);
  const timelineSections = [];
  const userInput = event.toolName === 'request_user_input' ? requestUserInputSection(requestValue, responseValue) : null;
  if (userInput) timelineSections.push(userInput);
  const collaboration = collaborationToolSection(event.toolName, requestValue, responseValue);
  if (collaboration) timelineSections.push(collaboration);
  const markdown = event.toolName === 'view_image' ? viewImageMarkdown(requestValue, responseValue) : '';
  maybePushMarkdownSection(timelineSections, 'Other tool call', markdown);
  const imageGeneration = event.toolName === 'image_generation' ? imageGenerationMarkdown(raws, responseValue) : '';
  maybePushMarkdownSection(timelineSections, 'Image generation', imageGeneration);
  const hasSpecializedTimeline = timelineSections.length > 0;
  if (!timelineSections.length) {
    maybePushToolSummaryCodeSection(timelineSections, 'Request summary', requestValue);
    maybePushToolSummaryCodeSection(timelineSections, 'Response summary', responseValue);
  }
  if (hasSpecializedTimeline) timelineSections.push(...sanitizeUnmodeledToolTimelineSections(split.timelineSections));
  if (!timelineSections.length) timelineSections.push(...sanitizeUnmodeledToolTimelineSections(split.timelineSections));
  if (!timelineSections.length) {
    timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info')));
  }
  const imagePreview = ['view_image', 'image_generation'].includes(event.toolName) ? imagePreviewSection(raws, event, requestValue) : null;
  const inspectorSections = sanitizeToolInspectorSections(split.inspectorSections, imagePreview);
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
    type: 'plan_update',
    title: 'Plan update',
    explanationHtml: explanation ? renderMarkdownToHtml(explanation) : '',
    steps: items,
  };
}

function extractUpdatePlanSections(raws, event, splitSections) {
  const split = splitSections(extractToolSections(raws, event));
  const { requestValue, responseValue } = toolDetailValues(raws);
  const timelineSections = [];
  const planUpdate = updatePlanSection(requestValue);
  if (planUpdate) timelineSections.push(planUpdate);
  if (planUpdate) timelineSections.push(...sanitizeUnmodeledToolTimelineSections(split.timelineSections));
  if (!timelineSections.length) {
    maybePushToolSummaryCodeSection(timelineSections, 'Request summary', requestValue);
    maybePushToolSummaryCodeSection(timelineSections, 'Response summary', responseValue);
  }
  if (!timelineSections.length) timelineSections.push(...sanitizeUnmodeledToolTimelineSections(split.timelineSections));
  if (!timelineSections.length) {
    timelineSections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info')));
  }
  return {
    timelineSections,
    inspectorSections: sanitizeToolInspectorSections(split.inspectorSections),
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
    type: 'markdown',
    role: 'web_result',
    title: 'Web results',
    html: renderMarkdownToHtml(source),
  };
}

function codeModeToolProjectionTitle(toolName, requestValue) {
  if (toolName === 'web__run') return codeModeWebProjectionTitle(requestValue);
  return {
    apply_patch: 'Apply patch',
    close_agent: 'Close subagent',
    create_goal: 'Create goal',
    exec_command: 'Shell command',
    get_goal: 'Get goal',
    image_gen__imagegen: 'Image generation',
    list_available_plugins_to_install: 'List available plugins',
    list_mcp_resource_templates: 'List MCP resource templates',
    list_mcp_resources: 'List MCP resources',
    read_mcp_resource: 'Read MCP resource',
    request_plugin_install: 'Request plugin install',
    request_user_input: 'User input',
    send_input: 'Send input to subagent',
    shell_command: 'Shell command',
    spawn_agent: 'Spawn subagent',
    update_goal: 'Update goal',
    update_plan: 'Plan update',
    view_image: 'Image inspection',
    wait_agent: 'Wait for subagent',
  }[toolName] || humanizeProtocolSubtype(toolName);
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
  );
  maybePushKvSection(sections, 'Run context', [
    { key: 'cwd', value: conciseToolValue(firstNonEmpty(args.workdir, args.cwd), 2000) },
    { key: 'Timeout ms', value: conciseToolValue(args.timeout_ms ?? args.timeoutMs, 200) },
    { key: 'Sandbox permissions', value: conciseToolValue(args.sandbox_permissions, 200) },
  ]);
  return sections;
}

function codeModeShellResultSections(resultText) {
  const sections = [];
  const formatted = parseFormattedCommandOutput(resultText);
  if (formatted) {
    maybePushKvSection(sections, 'Run result', [
      { key: 'Exit code', value: String(formatted.exitCode) },
      { key: 'Wall time', value: formatted.wallTime },
    ]);
    maybePushTerminalSection(sections, 'Output', formatted.output, 'stdout');
  } else {
    maybePushTerminalSection(sections, 'Result', resultText, 'stdout');
  }
  return sections;
}

function codeModeToolProjectionSection(call, session = {}) {
  const toolName = String(call?.toolName || '');
  const requestValue = call?.requestValue;
  const associated = call?.resultAssociation === 'bounded';
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
    if (patchText && !maybePushPatchSection(requestSections, 'Patch', patchText)) {
      maybePushCodeSection(requestSections, 'Patch', patchText, 'diff');
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
    ]);
  } else if (toolName === 'web__run') {
    const webRequest = codeModeWebRequestSection(requestValue);
    if (webRequest) requestSections.push(webRequest);
  } else {
    const collaboration = collaborationToolSection(toolName, requestValue, responseValue);
    if (collaboration) requestSections.push(collaboration);
  }

  if (!requestSections.length) maybePushToolSummaryCodeSection(requestSections, 'Request summary', requestValue);
  if (!requestSections.length) requestSections.push(makeNoticeSection('Declared request', toolName, 'info'));

  if (associated && ['shell_command', 'exec_command'].includes(toolName)) {
    resultSections.push(...codeModeShellResultSections(call.resultText));
  } else if (associated && toolName === 'web__run') {
    const webResult = codeModeWebResultSection(call.resultText);
    if (webResult) resultSections.push(webResult);
  } else if (associated && toolName !== 'update_plan' && toolName !== 'request_user_input'
      && !collaborationToolSection(toolName, requestValue, responseValue)) {
    maybePushToolSummaryCodeSection(resultSections, 'Response summary', responseValue == null ? call.resultText : responseValue);
  }
  if (associated) {
    resultSections.push({
      type: 'code_mode_source',
      title: 'Associated result',
      code: String(call.resultText || ''),
      language: 'text',
    });
  }

  return {
    type: 'code_mode_tool_projection',
    title: codeModeToolProjectionTitle(toolName, requestValue),
    toolName,
    requestEvidence: 'declared_source',
    resultAssociation: associated ? 'bounded' : 'none',
    requestSections: sanitizeUnmodeledToolTimelineSections(requestSections),
    resultSections: sanitizeUnmodeledToolTimelineSections(resultSections),
    resultObserved: associated,
    sourceOrder: Number(call?.sourceOrder || 0),
  };
}

function extractWebSearchSections(raws, event) {
  const sections = [];
  const searchCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'web_search_call');
  const searchEnd = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'web_search_end');
  const action = searchCall?.parsed?.payload?.action;

  if (typeof action === 'string') {
    maybePushMarkdownSection(sections, 'Search action', action);
  } else if (action && typeof action === 'object') {
    sections.push({ type: 'json', title: 'Search action', value: action });
  }

  maybePushKvSection(sections, 'Search status', [
    { key: 'status', value: String(event.status || searchCall?.status || searchEnd?.status || '') },
  ]);

  if (searchEnd?.parsed?.payload) {
    sections.push({ type: 'json', title: 'Search payload', value: searchEnd.parsed.payload });
  } else if (searchCall?.parsed?.payload) {
    sections.push({ type: 'json', title: 'Search payload', value: searchCall.parsed.payload });
  }

  if (!sections.length) sections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
  return sections;
}

function extractProtocolSections(event, raws) {
  const sections = [];
  const primary = raws[0];
  if (['agents_instructions', 'developer_instruction', 'developer_permissions', 'developer_collaboration_mode', 'skill_injection'].includes(event.subtype)) {
    maybePushMarkdownSection(sections, 'Protocol text', primary.messageText);
    hideSectionTitle(sections[0]);
    return sections;
  }
  if (event.subtype === 'goal_context') {
    const objective = readRawXmlTag(primary.messageText, 'objective');
    if (objective) {
      maybePushMarkdownSection(sections, 'Goal objective', objective);
      hideSectionTitle(sections[0]);
    }
    const budgetMatch = String(primary.messageText || '').match(/Budget:\s*([\s\S]*?)(?:\n\s*\n[A-Z][^\n]*:|<\/codex_internal_context>)/);
    if (budgetMatch) maybePushMarkdownSection(sections, 'Budget', budgetMatch[1].trim());
    sections.push(makeRawJsonSection('Protocol raw JSON', primary.parsed));
    return sections;
  }
  if (event.subtype === 'environment_context' || event.subtype === 'session_meta' || event.subtype === 'session_configured' || event.subtype === 'thread_goal_updated' || event.subtype === 'turn_context') {
    const entries = event.subtype === 'environment_context'
      ? taggedBlockEntries(primary.messageText)
      : toKvEntries(primary.parsed?.payload, ['cwd', 'turn_id', 'model', 'id', 'originator', 'thread_id', 'thread_name', 'thread_goal', 'goal']);
    maybePushKvSection(sections, 'Protocol fields', entries);
    sections.push(makeRawJsonSection('Protocol raw JSON', primary.parsed));
    return sections;
  }
  if (event.subtype === 'token_count') {
    const usageLimits = collectUsageLimitItems(primary.parsed?.payload);
    if (usageLimits.length) sections.push({ type: 'usage_limits', title: 'Usage limits', items: usageLimits });
    const tokenItems = tokenUsageItems(primary.parsed?.payload);
    if (tokenItems.length && !usageLimits.length) sections.push({ type: 'token_usage', title: 'Token usage', items: tokenItems });
    maybePushKvSection(sections, 'Event fields', toKvEntries(primary.parsed?.payload, ['type', 'turn_id', 'thread_id', 'thread_name']));
    sections.push(makeRawJsonSection('Protocol raw JSON', primary.parsed));
    return sections;
  }
  if (event.subtype === 'user_shell_command') {
    maybePushCodeSection(sections, 'Shell command wrapper', primary.messageText, 'shell');
    return sections;
  }
  if (event.subtype === 'image_wrapper' || event.subtype === 'meta_block' || event.subtype === 'turn_aborted_marker') {
    sections.push(makeNoticeSection('Protocol wrapper', primary.messageText || event.preview, 'warning'));
    return sections;
  }
  if (primary.messageText) {
    maybePushMarkdownSection(sections, 'Protocol text', primary.messageText);
    hideSectionTitle(sections[0]);
  }
  if (!sections.length) sections.push(makeRawJsonSection('Protocol raw JSON', primary.parsed));
  return sections;
}

function extractLifecycleSections(event, raws) {
  const sections = [];
  const primary = raws[0];
  if (event.kind === 'review') {
    return extractReviewLifecycleSections(event, raws);
  }
  if (event.kind === 'usage_limit_warning') {
    const usageLimits = collectUsageLimitItems(primary.parsed?.payload);
    if (usageLimits.length) {
      sections.push({ type: 'usage_limits', title: 'Usage limits', items: usageLimits });
    } else {
      sections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, 'info')));
    }
    const items = tokenUsageItems(primary.parsed?.payload);
    if (items.length && !usageLimits.length) sections.push({ type: 'token_usage', title: 'Token usage', items });
  } else {
    sections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info')));
  }
  maybePushKvSection(sections, 'Event fields', toKvEntries(primary.parsed?.payload, ['type', 'turn_id', 'thread_id', 'thread_name']));
  if (primary.parsed?.payload && Object.keys(primary.parsed.payload).length) {
    sections.push(makeRawJsonSection('Event raw JSON', primary.parsed));
  }
  return sections;
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
    extractLifecycleSections,
    extractMcpSections,
    extractPatchSections,
    extractPlanSections,
    extractGoalSections,
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
    codeModeOutputText,
    projectDeclaredCodeModeCalls,
  },
});
const { buildEventDetail } = codexDetailBuilder;

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

function extractReviewLifecycleSections(event, raws) {
  const sections = [];
  const primary = raws[0];
  const payload = primary.parsed?.payload || {};
  const output = payload.review_output || {};

  if (event.subtype === 'entered_review_mode') {
    maybePushKvSection(sections, 'Review request', [
      { key: 'Status', value: 'Started' },
      { key: 'Target', value: reviewTargetLabel(payload.target) },
      { key: 'Hint', value: displayValue(payload.user_facing_hint, 400) },
    ]);
  } else {
    const findings = Array.isArray(output.findings) ? output.findings : [];
    maybePushKvSection(sections, 'Review result', [
      { key: 'Status', value: 'Completed' },
      { key: 'Correctness', value: displayValue(output.overall_correctness, 400) },
      { key: 'Confidence', value: output.overall_confidence_score == null ? displayValue(output.confidence, 400) : displayValue(output.overall_confidence_score, 400) },
      { key: 'Findings', value: String(findings.length) },
    ]);
    maybePushMarkdownSection(sections, 'Overall explanation', displayValue(firstNonEmpty(output.overall_explanation, output.explanation), 4000));
    if (findings.length) {
      maybePushMarkdownSection(sections, 'Findings', findings.map(reviewFindingMarkdown).filter(Boolean).join('\n\n'));
    } else {
      sections.push(makeNoticeSection('Findings', 'No findings were reported.', 'info'));
    }
    if (Object.keys(output).length) sections.push(makeRawJsonSection('Review output JSON', output));
  }

  maybePushKvSection(sections, 'Event fields', toKvEntries(payload, ['type', 'turn_id', 'thread_id']));
  if (payload && Object.keys(payload).length) sections.push(makeRawJsonSection('Event raw JSON', primary.parsed));
  return sections;
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
  codeMode: {
    deriveCodeModeFacts,
    projectCodeModeOperations,
  },
  envelope: {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    sanitizeLogicalEnvelopeValue,
    rawRef,
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
    TOOL_EVENT_TYPES,
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

function eventKindOptionsFromCounts(counts, locale = i18n.DEFAULT_LOCALE, labelFn = eventKindLabel) {
  return [...counts.entries()]
    .sort((a, b) => labelFn(a[0], locale).localeCompare(labelFn(b[0], locale)) || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: labelFn(value, locale), count }));
}

function eventKindCatalog(sessions, options = {}) {
  const locale = i18n.resolveLocale(options.locale);
  const counts = {
    main: new Map(),
    protocol: new Map(),
    raw: new Map(),
  };
  const add = (layer, value) => {
    const key = String(value || '').trim();
    if (!key) return;
    counts[layer].set(key, (counts[layer].get(key) || 0) + 1);
  };
  for (const session of sessions || []) {
    for (const event of session.logicalEvents || []) {
      if (event.layer === 'protocol') add('protocol', event.subtype || event.kind);
      else add('main', event.kind);
    }
    for (const raw of session.rawEvents || []) {
      add('raw', raw.payloadType || raw.recordType);
    }
  }
  return {
    main: eventKindOptionsFromCounts(counts.main, locale),
    protocol: eventKindOptionsFromCounts(counts.protocol, locale),
    raw: eventKindOptionsFromCounts(counts.raw, locale, rawRecordValueLabel),
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
  if (['command', 'patch', 'mcp_call', 'web_search', 'other_tool_call', 'js_repl', 'hook'].includes(logicalEvent.kind)
      || (logicalEvent.kind === 'goal' && logicalEvent.toolName)) {
    session.counts.toolCalls += 1;
  }
  if (logicalEvent.kind === 'command' && logicalEvent.status === 'failed') session.counts.failedCommands += 1;
  if (logicalEvent.status === 'failed' || logicalEvent.severity !== 'normal') session.counts.issueEvents += 1;
  if (logicalEvent.kind === 'patch') session.counts.patches += 1;
  if (logicalEvent.kind === 'compaction') session.counts.compactions += 1;
  if (logicalEvent.kind === 'abort') session.counts.aborts += 1;
  if (logicalEvent.kind === 'error') session.counts.errors += 1;
  if (logicalEvent.kind === 'proposed_plan') session.counts.planArtifacts += 1;
  if (logicalEvent.kind === 'proposed_plan' || logicalEvent.kind === 'plan_update' || logicalEvent.toolName === 'update_plan' || logicalEvent.subtype === 'update_plan') {
    session.counts.planEvents += 1;
  }
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
    const observed = maxObservedTokenValue(primaryRaw?.parsed?.payload);
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
  return titleFromUserEvents(userEvents, Boolean(session.forkedFromSessionId)) || path.basename(session.sourceFile, '.jsonl');
}

function finalizeSession(session, sessionIndexEntry) {
  session.counts.turns = session._turnIds.size;
  if (sessionIndexEntry?.title) session.title = sessionIndexEntry.title;
  if (sessionIndexEntry?.updatedAt && (!session.updatedAt || sessionIndexEntry.updatedAt > session.updatedAt)) {
    session.updatedAt = sessionIndexEntry.updatedAt;
  }
  if (!session.title) {
    session.title = inferSessionTitle(session);
  }

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
  session.eventKinds = eventKindCatalog([session]);

  delete session._turnIds;
  delete session._analysisDraft;
  return session;
}

async function parseSessionFile(filePath, relFile, repoRoot, signal) {
  throwIfAborted(signal);
  const stat = await fsp.stat(filePath);
  const session = makeEmptySession(filePath, relFile, stat);
  let primarySessionMetaSeen = false;
  session._turnIds = new Set();
  session._analysisDraft = {
    toolUsage: new Map(),
    commands: [],
    failedCommands: [],
    patchedFiles: new Map(),
    tokenStats: { maxObserved: 0 },
  };

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
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

      if (record.type === 'session_meta' && record.payload) {
        if (!primarySessionMetaSeen) {
          primarySessionMetaSeen = true;
          if (record.payload.id) session.id = record.payload.id;
          session.forkedFromSessionId = forkedFromSessionIdFromMeta(record.payload);
          session.parentSessionId = parentSessionIdFromMeta(record.payload);
          session.agentNickname = agentNicknameFromMeta(record.payload);
          session.primarySessionMetaKind = derivedSessionKindFromMeta(record.payload);
        }
        if (record.payload.cwd) {
          session.cwdSet.add(record.payload.cwd);
          if (isPathInsideOrSame(record.payload.cwd, repoRoot)) session.matchesRepo = true;
        }
      }
      if (record.type === 'event_msg' && record.payload?.type === 'session_configured') {
        if (record.payload.cwd) {
          session.cwdSet.add(record.payload.cwd);
          if (isPathInsideOrSame(record.payload.cwd, repoRoot)) session.matchesRepo = true;
        }
        if (!session.title && record.payload.thread_name) {
          session.title = record.payload.thread_name;
        }
        if (!primarySessionMetaSeen) {
          if (!session.forkedFromSessionId) session.forkedFromSessionId = forkedFromSessionIdFromMeta(record.payload);
          if (!session.parentSessionId) session.parentSessionId = parentSessionIdFromMeta(record.payload);
          if (!session.agentNickname) session.agentNickname = agentNicknameFromMeta(record.payload);
          if (!session.primarySessionMetaKind) session.primarySessionMetaKind = derivedSessionKindFromMeta(record.payload);
        }
      }
      if (!session.parentSessionId && record.type === 'event_msg' && record.payload?.type === 'thread_name_updated' && record.payload.thread_name) {
        session.title = record.payload.thread_name;
      }
      const embeddedImages = [];
      externalizeKnownImageGenerationResult(record, { file: relFile, line: lineNumber }, embeddedImages);
      externalizeEmbeddedImages(record, { file: relFile, line: lineNumber }, embeddedImages);
      const raw = makeRawEvent(record, lineNumber, relFile, session.id, embeddedImages);
      updateTimeRangeFromNormalizedTimestamp(session, raw.timestamp);
      if (raw.recordType === 'event_msg' && raw.payloadType === 'entered_review_mode') {
        session._reviewMarkers.push({
          enteredAt: raw.timestamp,
          exitedAt: '',
        });
      } else if (raw.recordType === 'event_msg' && raw.payloadType === 'exited_review_mode') {
        let marker = session._reviewMarkers[session._reviewMarkers.length - 1];
        if (!marker || marker.exitedAt) {
          marker = { enteredAt: '', exitedAt: '' };
          session._reviewMarkers.push(marker);
        }
        marker.exitedAt = raw.timestamp;
      }
      if (!session.shell && classifyProtocolText(raw.messageText, raw.role) === 'environment_context') {
        session.shell = readXmlTag(raw.messageText, 'shell');
      }
      session.rawEvents.push(raw);
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  throwIfAborted(signal);
  session.logicalEvents = codexLogicalBuilder.buildLogicalEvents(session.rawEvents);
  for (const event of session.logicalEvents) {
    addCounts(session, event);
    updateAnalysisDraft(session, event);
  }
  return session;
}

async function buildIndex({ repoRoot, codexHome, onProgress, signal }) {
  const resolvedRepo = path.resolve(repoRoot);
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
  let parsedBytes = 0;

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
    const session = await parseSessionFile(filePath, relFile, resolvedRepo, signal);
    indexedFileCount += 1;
    parsedBytes += session.bytes;
    const indexEntry = sessionIndex.get(session.id);
    finalizeSession(session, indexEntry);
    if (session.matchesRepo) {
      sessions.push(session);
      sessionsById.set(session.id, session);
      logicalEventCount += session.logicalEvents.length;
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
      indexedBytes: parsedBytes,
      candidateBytes,
      sessionCount: sessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      elapsedMs: Date.now() - startedAt,
    });
  }

  throwIfAborted(signal);
  inferReviewParentSessions(sessions);
  for (const session of sessions) delete session._reviewMarkers;
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
    indexedBytes: parsedBytes,
    candidateBytes,
    sessionCount: sessions.length,
    eventCount: logicalEventCount,
    rawEventCount,
    elapsedMs: Date.now() - startedAt,
  });
  return {
    repoRoot: resolvedRepo,
    codexHome: resolvedCodex,
    sessionsRoot,
    generatedAt: new Date().toISOString(),
    sessions,
    sessionsById,
    eventKinds: eventKindCatalog(sessions),
    totals: {
      fileCount: files.length,
      candidateFileCount: candidates.length,
      indexedFileCount,
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

const codexSearch = createCodexSearch({
  canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION,
  codexSourceKind: CODEX_SOURCE_KIND,
  codexSourceLocator,
  defaultLocale: i18n.DEFAULT_LOCALE,
  derivedSessionKind,
  displayProjectFile,
  eventKindCatalog,
  localizedLogicalLabel,
  normalizeSearchPath,
  rawRecordLabel,
  rawRef,
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

function jsonPathValue(value, jsonPath) {
  let current = value;
  for (const key of jsonPath || []) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function imagePreviewError(statusCode, error) {
  return { statusCode, error };
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

async function readImagePreview(index, sessionId, eventId, previewId) {
  const session = index.sessionsById.get(sessionId);
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
  if (descriptor.source.file !== selectedRaw.source.file || descriptor.source.line !== selectedRaw.source.line) {
    return imagePreviewError(409, 'Image preview source is stale');
  }
  let sourceRow;
  try {
    sourceRow = await readRawLine(index, descriptor.source.file, descriptor.source.line);
  } catch (error) {
    if (error.code === 'ENOENT') return imagePreviewError(404, 'Image preview source is missing');
    throw error;
  }
  if (!sourceRow?.parsed) return imagePreviewError(409, 'Image preview source is stale');
  const value = jsonPathValue(sourceRow.parsed, descriptor.source.jsonPath);
  const inspected = inspectSupportedImagePayload(value, descriptor.encoding);
  if (!inspected || inspected.mimeType !== descriptor.mimeType) {
    return imagePreviewError(409, 'Image preview source is stale');
  }
  if (inspected.encodedLength > IMAGE_PREVIEW_MAX_ENCODED_CHARS
      || inspected.estimatedBytes > IMAGE_PREVIEW_MAX_DECODED_BYTES) {
    return imagePreviewError(413, 'Image preview payload is too large');
  }
  if (imagePresentationKey(value, inspected.mimeType) !== descriptor.dedupeKey) {
    return imagePreviewError(409, 'Image preview source is stale');
  }
  if (descriptor.encoding === 'bare_base64') {
    const decoded = decodeImagePreviewDataUrl(`data:${descriptor.mimeType};base64,${inspected.payload}`);
    if (decoded.error === 'Image preview payload is malformed') return imagePreviewError(422, decoded.error);
    return decoded;
  }
  return decodeImagePreviewDataUrl(value);
}

// Test-only introspection for focused equivalence coverage; this is not a supported runtime API.
const __testOnly = Object.freeze({
  formatResetTime,
  isEcmaScriptWhitespace,
  resetTimeCacheLimit: RESET_TIME_CACHE_LIMIT,
  resetTimeCacheSize: () => resetTimeCache.size,
  sessionReviewMarkers,
  truncate,
});

module.exports = {
  __testOnly,
  buildIndex,
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
  readRawLine,
  normalizeFsPath,
  isPathInsideOrSame,
  matchTerms,
};
