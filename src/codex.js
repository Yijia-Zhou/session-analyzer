'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const MarkdownIt = require('markdown-it');

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const SECTION_TYPES = new Set(['markdown', 'code', 'terminal', 'json', 'diff', 'patch', 'kv', 'notice', 'raw_json', 'token_usage', 'usage_limits']);
const SESSION_TITLE_LIMIT = 120;
const SUBAGENT_SESSION_TITLE_LIMIT = 160;

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

function truncate(value, limit = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
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
  mcp: 'MCP',
  js_repl: 'JS REPL',
  tool_operation: 'Tool op',
  plan_artifact: 'Plan',
  plan_update: 'Plan update',
  protocol: 'Protocol',
  error: 'Error',
  warning: 'Warning',
  abort: 'Abort',
  rollback: 'Rollback',
  compaction: 'Compaction',
  token: 'Token',
  subagent: 'Subagent',
  review: 'Review',
  reasoning: 'Reasoning',
  turn: 'Turn',
  web_search: 'Web search',
  event: 'Event',
});

const CANONICAL_EVENT_TYPES = Object.freeze({
  turn_started: 'task_started',
  turn_complete: 'task_complete',
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
  'collab_agent_spawn_begin',
  'collab_agent_spawn_end',
  'collab_agent_interaction_begin',
  'collab_agent_interaction_end',
  'collab_waiting_begin',
  'collab_waiting_end',
  'collab_close_begin',
  'collab_close_end',
]);

function canonicalEventType(type) {
  return CANONICAL_EVENT_TYPES[type] || type || '';
}

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

function humanizeEventKind(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^mcp\b/i.test(text)) return text.replace(/_/g, ' ').replace(/^mcp/i, 'MCP');
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bJs\b/g, 'JS');
}

function eventKindLabel(value) {
  const key = String(value || '').trim();
  return EVENT_KIND_LABELS[key] || PROTOCOL_LABELS[key] || humanizeEventKind(key) || key;
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

function formatResetTime(value) {
  if (value == null || value === '') return '';
  const source = typeof value === 'number' ? (value < 10000000000 ? value * 1000 : value) : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return String(value);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return date.toLocaleString('en-US', {
    month: sameDay ? undefined : 'short',
    day: sameDay ? undefined : 'numeric',
    year: sameDay ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

function inferCommandLanguage(commandText, args = {}) {
  const commandArray = Array.isArray(args?.command) ? args.command : [];
  const joined = commandArray.length ? commandArray.join(' ') : String(commandText || '');
  const lower = joined.toLowerCase();
  const executable = String(commandArray[0] || '').toLowerCase().replace(/\\/g, '/').split('/').pop();
  if (/\b(powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/.test(lower) || lower.includes(' -command ')) return 'powershell';
  if (/\b(get-content|set-content|select-object|where-object|start-process|invoke-webrequest|remove-item|copy-item|move-item)\b/.test(lower)) return 'powershell';
  if (executable === 'cmd.exe' || executable === 'cmd' || /\bcmd(?:\.exe)?\s+\/c\b/.test(lower)) return 'batch';
  if (executable === 'bash') return 'bash';
  if (executable === 'sh') return 'sh';
  if (executable === 'zsh') return 'zsh';
  if (executable === 'fish') return 'fish';
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
  const source = normalizeTerminalReplacementPlaceholders(repairLikelyMojibake(text));
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
  if (Array.isArray(session._reviewMarkers) && session._reviewMarkers.length) return session._reviewMarkers;
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
    primarySessionMetaKind: '',
    _reviewMarkers: [],
    rawEvents: [],
    logicalEvents: [],
    searchText: '',
    counts: {
      turns: 0,
      messages: 0,
      userMessages: 0,
      assistantMessages: 0,
      reasoning: 0,
      toolCalls: 0,
      failedCommands: 0,
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

function updateTimeRange(session, timestamp) {
  const iso = safeIso(timestamp);
  if (!iso) return;
  if (!session.startedAt || iso < session.startedAt) session.startedAt = iso;
  if (!session.updatedAt || iso > session.updatedAt) session.updatedAt = iso;
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

function makeRawEvent(record, lineNumber, relFile, sessionId) {
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
      raw.messageText = flattenText(payload.summary || payload.content, 16000);
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
  }

  if (record.type === 'event_msg') {
    switch (payload.type) {
      case 'user_message':
      case 'agent_message':
      case 'agent_reasoning':
        raw.messageText = displayValue(firstNonEmpty(payload.message, payload.text), 16000);
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
  if (patchEnd) return Boolean(patchEnd.parsed.payload.success);
  const exitCode = customOutputObj?.metadata?.exit_code;
  if (isFiniteNumberValue(exitCode)) return Number(exitCode) === 0;
  const outputText = patchOutputText(customOutputObj, rawOutput);
  if (patchOutputHasFailure(outputText)) return false;
  if (patchOutputHasSuccess(outputText)) return true;
  return true;
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
    return 'developer_instruction';
  }
  if (source.startsWith('# AGENTS.md instructions')) return 'agents_instructions';
  if (source.startsWith('<environment_context>')) return 'environment_context';
  if (source.startsWith('<turn_aborted>')) return 'turn_aborted_marker';
  if (source.startsWith('<user_shell_command>')) return 'user_shell_command';
  if (source.startsWith('<skill>')) return 'skill_injection';
  if (source.startsWith('<image ')) return 'image_wrapper';
  if (source.startsWith('<')) return 'meta_block';
  return '';
}

function createLogicalEvent(fields) {
  const searchText = String(fields.searchText || '').trim();
  return {
    id: fields.id,
    timestamp: fields.timestamp || '',
    turnId: fields.turnId || '',
    kind: fields.kind || 'event',
    subtype: fields.subtype || '',
    layer: fields.layer || 'main',
    role: fields.role || '',
    label: fields.label || fields.kind || 'event',
    preview: fields.preview || '',
    searchText,
    severity: fields.severity || 'normal',
    status: fields.status || '',
    toolName: fields.toolName || '',
    hasLongOutput: (fields.preview || '').length > 800 || searchText.length > 1600,
    touchedFiles: fields.touchedFiles || [],
    outputStats: fields.outputStats || {},
    tokenUsage: fields.tokenUsage || [],
    usageLimits: fields.usageLimits || [],
    rawRefs: fields.rawRefs || [],
    channels: fields.channels || [],
    source: fields.rawRefs && fields.rawRefs[0] ? fields.rawRefs[0] : fields.source,
  };
}

function rawRef(raw) {
  return { file: raw.source.file, line: raw.source.line, rawId: raw.rawId };
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
    timestamp: event.timestamp || '',
    turnId: event.turnId || '',
    status: event.status || '',
    severity: event.severity || 'normal',
    toolName: event.toolName || '',
    touchedFiles: event.touchedFiles || [],
    outputStats: event.outputStats || {},
    channels: event.channels || [],
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
  const text = uniqueNonEmpty(raws.map((raw) => raw.messageText)).join('\n\n');
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

function extractCommandSections(raws, event) {
  const timelineSections = [];
  const inspectorSections = [];
  const functionCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
  const functionOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
  const execEnd = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'exec_command_end');
  const execAny = execEnd || raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('exec_command_'));
  const args = commandArgsFromRaw(functionCall);
  const formatted = parseFormattedCommandOutput(functionOutput?.output);
  const commandText = execAny?.commandText || commandToText(args?.command);
  maybePushCodeSection(timelineSections, 'Command', commandText, inferCommandLanguage(commandText, args));

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
    inspectorSections.push(makeNoticeSection('Result', noticeText, event.status === 'failed' ? 'error' : 'info'));
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

function extractToolSections(raws, event) {
  const sections = [];
  const functionCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
  const functionOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
  const customCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const requestValue = firstNonEmpty(commandArgsFromRaw(functionCall), coerceJsonValue(customCall?.output), functionCall?.output, customCall?.output);
  const responseEnvelope = toolOutputEnvelope(customOutput);
  const responseValue = firstNonEmpty(
    raws.find((raw) => raw.recordType === 'event_msg' && /_end$/.test(raw.payloadType || ''))?.parsed?.payload,
    responseEnvelope?.output,
    parseOutputEnvelope(functionOutput?.output),
    functionOutput?.output,
    customOutput?.output,
  );

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

function updatePlanMarkdown(requestValue) {
  if (!requestValue || typeof requestValue !== 'object') return '';
  const explanation = displayValue(requestValue.explanation, 4000).trim();
  const steps = Array.isArray(requestValue.plan) ? requestValue.plan : [];
  const stepLines = steps.map((item) => {
    if (!item || typeof item !== 'object') return '';
    const step = displayValue(item.step, 2000).trim();
    const status = displayValue(item.status, 200).trim();
    if (!step && !status) return '';
    return `- ${status ? `\`${status}\` ` : ''}${step || '(unnamed step)'}`;
  }).filter(Boolean);
  return [
    explanation ? `### Explanation\n\n${explanation}` : '',
    stepLines.length ? `### Steps\n\n${stepLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

function extractUpdatePlanSections(raws, event) {
  const functionCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
  const requestValue = commandArgsFromRaw(functionCall);
  const timelineSections = [];
  maybePushMarkdownSection(timelineSections, 'Plan update', updatePlanMarkdown(requestValue));
  return {
    timelineSections,
    inspectorSections: splitSectionsForDetail(extractToolSections(raws, event)).inspectorSections,
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
  if (event.kind === 'token') {
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
    maybePushCodeSection(sections, 'Command', commandText, inferCommandLanguage(commandText, args));
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
    maybePushCodeSection(sections, 'Command', raw.commandText, inferCommandLanguage(raw.commandText));
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
    const noticeText = firstNonEmpty(raw.parsed?.payload?.stdout, raw.parsed?.payload?.stderr, raw.status ? `Patch ${raw.status}.` : '');
    if (noticeText) sections.push(makeNoticeSection('Result', noticeText, raw.parsed?.payload?.success === false ? 'error' : 'info'));
    maybePushKvSection(sections, 'Apply result', [
      { key: 'status', value: String(raw.status || '') },
      { key: 'durationMs', value: raw.durationMs == null ? '' : String(raw.durationMs) },
    ]);
    omitPayloadKeys.push('stdout', 'stderr', 'changes', 'duration', 'status', 'success');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output' && relatedEvent?.kind === 'patch') {
    const envelope = toolOutputEnvelope(raw);
    const output = firstNonEmpty(envelope?.output, raw.output);
    if (output) sections.push(makeNoticeSection('Result', stringifyValue(output), inferPatchSuccess(null, envelope, raw.output) ? 'info' : 'error'));
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

function rawPrimarySections(raw, relatedEvent, session = {}) {
  if (relatedEvent?.kind === 'protocol') {
    return {
      sections: withoutSectionTypes(extractProtocolSections(relatedEvent, [raw]), ['raw_json']),
      omitPayloadKeys: relatedEvent.subtype === 'session_meta'
        ? ['id', 'cwd', 'originator']
        : relatedEvent.subtype === 'turn_context'
          ? ['turn_id', 'cwd', 'model']
          : [],
    };
  }
  if (['token', 'compaction', 'abort', 'rollback', 'error', 'subagent', 'turn'].includes(relatedEvent?.kind)) {
    return {
      sections: withoutSectionTypes(extractLifecycleSections(relatedEvent, [raw]), ['raw_json']),
      omitPayloadKeys: ['type', 'turn_id', 'thread_id', 'thread_name', 'last_agent_message'],
    };
  }

  const tool = rawToolSections(raw, relatedEvent, session);
  if (tool.sections.length) return tool;

  if (rawConversationRole(raw)) {
    return {
      sections: extractConversationSections([raw]),
      omitPayloadKeys: ['message'],
    };
  }
  if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_reasoning') {
    return {
      sections: extractReasoningSections([raw]),
      omitPayloadKeys: ['text'],
    };
  }
  if (raw.recordType === 'response_item' && raw.payloadType === 'reasoning') {
    return {
      sections: extractReasoningSections([raw]),
      omitPayloadKeys: [],
    };
  }
  if (raw.recordType === 'event_msg' && raw.payloadType === 'item_completed' && raw.parsed?.payload?.item?.type === 'Plan') {
    return {
      sections: withoutSectionTypes(extractPlanSections([raw]), ['raw_json']),
      omitPayloadKeys: [],
    };
  }
  if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.messageText.startsWith('<proposed_plan>')) {
    return {
      sections: withoutSectionTypes(extractPlanSections([raw]), ['raw_json']),
      omitPayloadKeys: [],
    };
  }
  return { sections: [], omitPayloadKeys: [] };
}

function sectionIsInspectorSupplement(section) {
  if (!section) return false;
  if (section.type === 'raw_json' || section.type === 'kv' || section.type === 'json') return true;
  if (section.type === 'notice' && /(metadata|status|fields|raw json)$/i.test(section.title || '')) return true;
  return false;
}

function splitSectionsForDetail(sections) {
  const timelineSections = [];
  const inspectorSections = [];
  for (const section of sections || []) {
    if (sectionIsInspectorSupplement(section)) inspectorSections.push(section);
    else timelineSections.push(section);
  }
  return { timelineSections, inspectorSections };
}

function extractRawSections(raw, relatedEvent, session = {}) {
  const sections = [];
  const primary = rawPrimarySections(raw, relatedEvent, session);
  sections.push(...primary.sections);
  if (!primary.sections.length && raw.messageText) {
    const subtype = classifyProtocolText(raw.messageText, raw.role);
    if (subtype === 'user_shell_command') {
      maybePushCodeSection(sections, 'Message', raw.messageText, 'shell');
    } else {
      maybePushMarkdownSection(sections, 'Message', raw.messageText);
    }
  }
  if (!primary.sections.length && raw.commandText) {
    maybePushCodeSection(sections, 'Command', raw.commandText, inferCommandLanguage(raw.commandText));
    maybePushTerminalSection(sections, 'stdout', raw.stdout, 'stdout');
    maybePushTerminalSection(sections, 'stderr', raw.stderr, 'stderr');
    if (raw.stdout) maybePushStructuredSection(sections, 'stdout (structured)', raw.stdout);
    if (raw.stderr) maybePushStructuredSection(sections, 'stderr (structured)', raw.stderr);
  }
  if (!primary.sections.length && raw.output) {
    maybePushStructuredSection(sections, 'Payload', structuredOutputValue(raw.output));
  }
  const recordFields = withoutKeys(raw.parsed?.payload, primary.omitPayloadKeys);
  maybePushKvSection(sections, 'Record fields', toKvEntries(recordFields, ['type', 'role', 'name', 'call_id', 'status', 'cwd']));
  sections.push(makeRawJsonSection('Raw JSON', raw.parsed));
  return sections;
}

function extractLogicalDetailSections(event, raws, session = {}) {
  switch (event.kind) {
    case 'user_message':
    case 'assistant_message':
      return splitSectionsForDetail(extractConversationSections(raws));
    case 'plan_artifact':
    case 'plan_update':
      return splitSectionsForDetail(extractPlanSections(raws));
    case 'reasoning':
      return splitSectionsForDetail(extractReasoningSections(raws));
    case 'command':
      return extractCommandSections(raws, event);
    case 'patch':
      return extractPatchSections(raws, event, session);
    case 'js_repl':
      return splitSectionsForDetail(extractJsReplSections(raws, event));
    case 'mcp':
    case 'tool_operation':
      if (event.toolName === 'update_plan') return extractUpdatePlanSections(raws, event);
      return splitSectionsForDetail(extractToolSections(raws, event));
    case 'web_search':
      return splitSectionsForDetail(extractWebSearchSections(raws, event));
    case 'protocol':
      return splitSectionsForDetail(extractProtocolSections(event, raws));
    case 'token':
    case 'compaction':
    case 'abort':
    case 'rollback':
    case 'error':
    case 'warning':
    case 'subagent':
    case 'review':
    case 'turn':
      return splitSectionsForDetail(extractLifecycleSections(event, raws));
    default:
      return { timelineSections: [], inspectorSections: [makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed))] };
  }
}

function buildEventDetail(session, eventId, layer = 'main') {
  if (layer === 'raw') {
    const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
    if (!raw) return null;
    const relatedLogical = session.logicalEvents.find((event) => rawMatchesEvent(raw, event));
    const sections = filterDetailSections(extractRawSections(raw, relatedLogical, session));
    for (const section of sections) {
      if (section.type === 'raw_json') section.expanded = true;
    }
    const split = splitSectionsForDetail(sections);
    return {
      id: raw.rawId,
      kind: raw.payloadType || raw.recordType,
      subtype: raw.role || '',
      layer: 'raw',
      title: raw.payloadType || raw.recordType,
      meta: rawMeta(raw),
      rawRefs: [rawRef(raw)],
      timelineSections: filterDetailSections(split.timelineSections),
      inspectorSections: filterDetailSections(split.inspectorSections),
    };
  }

  const logical = session.logicalEvents.find((candidate) => candidate.id === eventId && candidate.layer === layer);
  if (!logical) return null;
  const raws = rawEventsForLogicalEvent(session, logical);
  const detailSections = extractLogicalDetailSections(logical, raws, session);
  if (!detailSections.timelineSections.length && !detailSections.inspectorSections.length) {
    detailSections.inspectorSections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
  }
  return {
    id: logical.id,
    kind: logical.kind,
    subtype: logical.subtype,
    layer: logical.layer,
    title: logical.label,
    meta: logicalMeta(logical),
    rawRefs: logical.rawRefs,
    timelineSections: filterDetailSections(detailSections.timelineSections),
    inspectorSections: filterDetailSections(detailSections.inspectorSections),
  };
}

function rawEventDto(raw, q) {
  const searchableText = `${raw.preview}\n${raw.searchText}`;
  const hasSearchHit = q ? matchTerms(searchableText, q) : false;
  return {
    id: raw.rawId,
    timestamp: raw.timestamp,
    turnId: raw.turnId,
    recordType: raw.recordType,
    payloadType: raw.payloadType,
    kind: raw.payloadType || raw.recordType,
    subtype: raw.role || '',
    layer: 'raw',
    role: raw.role,
    label: raw.payloadType || raw.recordType,
    preview: raw.preview,
    severity: raw.payloadType === 'error' ? 'error' : 'normal',
    status: raw.status,
    toolName: raw.toolName,
    hasLongOutput: raw.searchText.length > 1600,
    hasSearchHit,
    touchedFiles: raw.touchedFiles,
    outputStats: {
      exitCode: raw.exitCode,
      durationMs: raw.durationMs,
    },
    source: raw.source,
    rawRefs: [rawRef(raw)],
    channels: [raw.recordType],
    searchText: raw.searchText,
    snippet: hasSearchHit ? makeSnippet(searchableText, q) : '',
  };
}

function buildToolLogicalEvent(callId, group) {
  const rawRefs = group.map(rawRef);
  const channels = [...new Set(group.map((raw) => raw.recordType))];
  const first = group[0];
  const functionCall = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
  const functionOutput = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
  const customCall = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const execRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('exec_command_'));
  const patchRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('patch_apply_'));
  const mcpRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('mcp_tool_call_'));
  const imageRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('image_generation_call_'));
  const dynamicRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('dynamic_tool_call_'));
  const approvalRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('approval_request_'));
  const hookRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('hook_'));
  const collabRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('collab_'));
  const execEnd = execRows.find((raw) => raw.payloadType === 'exec_command_end');
  const patchEnd = patchRows.find((raw) => raw.payloadType === 'patch_apply_end');
  const mcpEnd = mcpRows.find((raw) => raw.payloadType === 'mcp_tool_call_end');

  const protocolToolName = group.find((raw) => raw.toolName)?.toolName || '';
  const toolName = customCall?.toolName || functionCall?.toolName || protocolToolName || '';
  const functionOutputInfo = parseFormattedCommandOutput(functionOutput?.output);
  const customOutputObj = parseOutputEnvelope(customOutput?.output);

  let kind = 'tool_operation';
  let label = toolName || 'Tool operation';
  let preview = truncate(toolName || 'Tool operation');
  let status = 'completed';
  let severity = 'normal';
  let touchedFiles = [];
  const outputStats = {};
  const parts = [];

  const protocolStatus = String(group.find((raw) => raw.status)?.status || '').toLowerCase();
  const declined = group.some((raw) => /_declined$/.test(raw.payloadType) || String(raw.status || '').toLowerCase() === 'declined');
  const failed = group.some((raw) => String(raw.status || '').toLowerCase() === 'failed');
  const completed = group.some((raw) => /_end$/.test(raw.payloadType)) || Boolean(functionOutput || customOutput);
  const explicitIncomplete = !completed && !failed && !declined;

  if (execRows.length) {
    const execText = execRows.map((raw) => [raw.commandText, raw.stdout, raw.stderr, raw.aggregatedOutput, raw.searchText].filter(Boolean).join('\n')).join('\n');
    parts.push(execText);
    if (execEnd?.exitCode != null) outputStats.exitCode = execEnd.exitCode;
    if (execEnd?.durationMs) outputStats.durationMs = execEnd.durationMs;
  }
  if (functionCall) parts.push(functionCall.output);
  if (functionOutput) parts.push(functionOutput.output);
  if (customCall) parts.push(customCall.output);
  if (customOutput) parts.push(customOutput.output);
  if (mcpRows.length) parts.push(mcpRows.map((raw) => raw.searchText).join('\n'));
  if (imageRows.length) parts.push(imageRows.map((raw) => raw.searchText).join('\n'));
  if (dynamicRows.length) parts.push(dynamicRows.map((raw) => raw.searchText).join('\n'));
  if (approvalRows.length) parts.push(approvalRows.map((raw) => raw.searchText).join('\n'));
  if (hookRows.length) parts.push(hookRows.map((raw) => raw.searchText).join('\n'));
  if (collabRows.length) parts.push(collabRows.map((raw) => raw.searchText).join('\n'));

  if (toolName === 'shell_command' || execRows.length) {
    kind = 'command';
    const args = commandArgsFromRaw(functionCall);
    const exitCode = numericExitCode(execEnd?.exitCode, functionOutputInfo?.exitCode, customOutputObj?.metadata?.exit_code);
    const commandText = execRows.find((raw) => raw.commandText)?.commandText || commandToText(args?.command);
    status = declined ? 'declined' : failed || (exitCode != null && exitCode !== 0) ? 'failed' : exitCode === 0 ? 'success' : explicitIncomplete ? 'incomplete' : protocolStatus || 'completed';
    severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
    label = status === 'failed' ? 'Failed command' : status === 'declined' ? 'Declined command' : status === 'incomplete' ? 'Incomplete command' : 'Command';
    preview = truncate(commandText || functionCall?.output || group.find((raw) => raw.preview)?.preview || 'shell command');
    if (exitCode != null) outputStats.exitCode = exitCode;
    if (!outputStats.durationMs && customOutputObj?.metadata?.duration_seconds) {
      outputStats.durationMs = Math.round(Number(customOutputObj.metadata.duration_seconds) * 1000);
    }
    touchedFiles = touchFilesFromOutputText(firstNonEmpty(execEnd?.stdout, execEnd?.aggregatedOutput, functionOutputInfo?.output));
  } else if (toolName === 'apply_patch' || patchRows.length) {
    kind = 'patch';
    const patchInput = firstNonEmpty(customCall?.output, patchRows.find((raw) => raw.output)?.output);
    touchedFiles = patchEnd?.touchedFiles?.length ? patchEnd.touchedFiles : patchFilesFromPatchInput(patchInput || '');
    const patchSuccess = inferPatchSuccess(patchEnd, customOutputObj, customOutput?.output);
    status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : patchSuccess ? 'success' : 'failed';
    severity = patchSuccess ? 'normal' : 'error';
    if (status === 'declined' || status === 'incomplete') severity = 'warning';
    label = status === 'success' ? 'Patch applied' : status === 'declined' ? 'Patch declined' : status === 'incomplete' ? 'Incomplete patch' : 'Patch failed';
    preview = truncate(touchedFiles.join(', ') || customOutputObj?.output || patchInput || group.find((raw) => raw.preview)?.preview || 'apply_patch');
    if (customOutputObj?.metadata && isFiniteNumberValue(customOutputObj.metadata.exit_code)) {
      outputStats.exitCode = Number(customOutputObj.metadata.exit_code);
    } else if (!patchSuccess) {
      outputStats.exitCode = 1;
    }
    if (customOutputObj?.metadata?.duration_seconds) {
      outputStats.durationMs = Math.round(Number(customOutputObj.metadata.duration_seconds) * 1000);
    }
  } else if (toolName === 'js_repl') {
    kind = 'js_repl';
    const exitCode = execEnd?.exitCode ?? customOutputObj?.metadata?.exit_code ?? 0;
    status = exitCode === 0 ? 'success' : 'failed';
    severity = exitCode === 0 ? 'normal' : 'error';
    label = exitCode === 0 ? 'JS REPL' : 'JS REPL error';
    preview = truncate(customCall?.output || customOutputObj?.output || 'js_repl');
    outputStats.exitCode = exitCode;
    outputStats.durationMs = execEnd?.durationMs || Math.round(Number(customOutputObj?.metadata?.duration_seconds || 0) * 1000);
  } else if (mcpRows.length || toolName.startsWith('mcp__')) {
    kind = 'mcp';
    label = 'MCP tool';
    preview = truncate(mcpEnd?.preview || group.find((raw) => raw.preview)?.preview || toolName);
    status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : 'success';
    severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
    outputStats.durationMs = mcpEnd?.durationMs || 0;
  } else if (imageRows.length || dynamicRows.length || approvalRows.length || hookRows.length || collabRows.length) {
    kind = 'tool_operation';
    label = humanizeProtocolSubtype(group.find((raw) => raw.payloadType)?.payloadType || toolName || 'Tool operation');
    preview = truncate(group.find((raw) => raw.preview)?.preview || toolName || label);
    status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : 'success';
    severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
  } else if (toolName === 'request_user_input' || toolName === 'update_plan' || toolName === 'view_image' || toolName === 'spawn_agent' || toolName === 'wait_agent' || toolName === 'send_input' || toolName === 'close_agent' || toolName === 'js_repl_reset') {
    kind = 'tool_operation';
    label = toolName;
    preview = truncate(functionCall?.output || functionOutput?.output || toolName);
    status = 'success';
  } else {
    preview = truncate(first.preview || toolName || 'tool operation');
  }

  return createLogicalEvent({
    id: `${first.sessionId}:logical:call:${callId}`,
    timestamp: first.timestamp,
    turnId: first.turnId || '',
    kind,
    subtype: toolName || kind,
    layer: 'main',
    role: 'assistant',
    label,
    preview,
    searchText: parts.filter(Boolean).join('\n'),
    severity,
    status,
    toolName: toolName || kind,
    touchedFiles,
    outputStats,
    rawRefs,
    channels,
  });
}

function isWebSearchCall(raw) {
  return raw?.recordType === 'response_item' && raw.payloadType === 'web_search_call';
}

function isWebSearchEnd(raw) {
  return raw?.recordType === 'event_msg' && raw.payloadType === 'web_search_end';
}

function webSearchActionKey(raw) {
  const payload = raw?.parsed?.payload || {};
  const action = payload.action && typeof payload.action === 'object' ? payload.action : {};
  const type = action.type || '';
  const query = action.query || (type === 'search' ? payload.query : '');
  const url = action.url || payload.url || (type === 'open_page' ? payload.query : '');
  const pattern = action.pattern || payload.pattern || '';
  return [
    type,
    query,
    url,
    pattern,
  ].filter(Boolean).join('\n');
}

function webSearchRowsMatch(searchEnd, searchCall) {
  if (!isWebSearchEnd(searchEnd) || !isWebSearchCall(searchCall)) return false;
  const endKey = webSearchActionKey(searchEnd);
  const callKey = webSearchActionKey(searchCall);
  if (endKey && callKey) return endKey === callKey;
  if (!searchEnd.timestamp || !searchCall.timestamp) return true;
  const deltaMs = Math.abs(Date.parse(searchEnd.timestamp) - Date.parse(searchCall.timestamp));
  return Number.isFinite(deltaMs) && deltaMs <= 1000;
}

function buildWebSearchEvent(searchCall, searchEnd) {
  const raws = [searchEnd, searchCall].filter(Boolean).sort((a, b) => a.line - b.line);
  const first = raws[0];
  const preview = searchEnd?.preview || searchCall?.preview || 'web_search';
  const searchText = uniqueNonEmpty(raws.map((raw) => raw.searchText)).join('\n');
  return createLogicalEvent({
    id: `${first.sessionId}:logical:web_search:${first.line}`,
    timestamp: first.timestamp,
    turnId: searchEnd?.turnId || searchCall?.turnId || '',
    kind: 'web_search',
    subtype: 'web_search',
    layer: 'main',
    role: 'assistant',
    label: 'Web search',
    preview,
    searchText,
    severity: 'normal',
    status: searchEnd?.status || searchCall?.status || 'completed',
    toolName: 'web_search',
    rawRefs: raws.map(rawRef),
    channels: raws.map((raw) => raw.recordType),
  });
}

function buildProtocolEvent(raw, subtype, label) {
  const resolvedSubtype = subtype || raw.payloadType || raw.recordType || 'protocol_event';
  const displayLabel = protocolLabelFor(resolvedSubtype, label);
  const preview = protocolPreviewFor(raw, resolvedSubtype);
  return createLogicalEvent({
    id: `${raw.sessionId}:logical:protocol:${raw.line}`,
    timestamp: raw.timestamp,
    turnId: raw.turnId,
    kind: 'protocol',
    subtype: resolvedSubtype,
    layer: 'protocol',
    role: raw.role,
    label: displayLabel,
    preview,
    searchText: uniqueNonEmpty([displayLabel, preview, raw.searchText]).join('\n'),
    severity: 'normal',
    status: raw.status,
    rawRefs: [rawRef(raw)],
    channels: [raw.recordType],
  });
}

function buildLifecycleEvent(raw, kind, label, severity, previewOverride = '') {
  const tokenUsage = kind === 'token' ? tokenUsageItems(raw.parsed?.payload) : [];
  const usageLimits = kind === 'token' ? collectUsageLimitItems(raw.parsed?.payload) : [];
  const reachedType = kind === 'token' ? rateLimitReachedType(raw.parsed?.payload) : '';
  return createLogicalEvent({
    id: `${raw.sessionId}:logical:${kind}:${raw.line}`,
    timestamp: raw.timestamp,
    turnId: raw.turnId,
    kind,
    subtype: raw.payloadType || kind,
    layer: 'main',
    role: raw.role,
    label,
    preview: previewOverride || raw.preview || label,
    searchText: raw.searchText,
    severity,
    status: raw.status || reachedType,
    tokenUsage,
    usageLimits,
    rawRefs: [rawRef(raw)],
    channels: [raw.recordType],
  });
}

function reviewLifecyclePreview(raw) {
  const payload = raw.parsed?.payload || {};
  if (raw.payloadType === 'entered_review_mode') {
    const hint = displayValue(firstNonEmpty(payload.user_facing_hint, payload.target), 180).trim();
    return hint ? `Review started: ${hint}` : 'Review started';
  }

  const output = payload.review_output || {};
  const findings = Array.isArray(output.findings) ? `${output.findings.length} findings` : '';
  const correctness = displayValue(output.overall_correctness, 200).trim();
  const explanation = displayValue(output.overall_explanation, 400).trim();
  const summary = uniqueNonEmpty([correctness, findings, explanation]).join(' - ');
  return truncate(summary ? `Review completed: ${summary}` : 'Review completed');
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

function buildConversationEvent(id, kind, role, text, raws) {
  return createLogicalEvent({
    id,
    timestamp: raws[0].timestamp,
    turnId: raws.find((raw) => raw.turnId)?.turnId || '',
    kind,
    subtype: kind,
    layer: 'main',
    role,
    label: role === 'user' ? 'User message' : 'Assistant message',
    preview: truncate(text),
    searchText: text,
    severity: 'normal',
    status: '',
    rawRefs: raws.map(rawRef),
    channels: [...new Set(raws.map((raw) => raw.recordType))],
  });
}

function buildReasoningEvent(raws, text) {
  return createLogicalEvent({
    id: `${raws[0].sessionId}:logical:reasoning:${raws[0].line}`,
    timestamp: raws[0].timestamp,
    turnId: raws.find((raw) => raw.turnId)?.turnId || '',
    kind: 'reasoning',
    subtype: 'reasoning',
    layer: text ? 'main' : 'protocol',
    role: 'assistant',
    label: text ? 'Reasoning' : 'Empty reasoning',
    preview: truncate(text || raws[0].preview || 'reasoning'),
    searchText: text,
    severity: 'normal',
    status: '',
    rawRefs: raws.map(rawRef),
    channels: [...new Set(raws.map((raw) => raw.recordType))],
  });
}

function buildPlanArtifact(itemRaw, messageRaw, text) {
  const raws = messageRaw ? [itemRaw, messageRaw] : [itemRaw];
  return createLogicalEvent({
    id: `${itemRaw.sessionId}:logical:plan:${itemRaw.line}`,
    timestamp: itemRaw.timestamp,
    turnId: itemRaw.turnId || messageRaw?.turnId || '',
    kind: 'plan_artifact',
    subtype: 'proposed_plan',
    layer: 'main',
    role: 'assistant',
    label: 'Proposed plan',
    preview: truncate(text),
    searchText: text,
    severity: 'normal',
    status: '',
    rawRefs: raws.map(rawRef),
    channels: [...new Set(raws.map((raw) => raw.recordType))],
  });
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

function buildPlanUpdateEvent(raw) {
  const text = planUpdateText(raw);
  return createLogicalEvent({
    id: `${raw.sessionId}:logical:plan-update:${raw.line}`,
    timestamp: raw.timestamp,
    turnId: raw.turnId || '',
    kind: 'plan_update',
    subtype: raw.payloadType,
    layer: 'main',
    role: 'assistant',
    label: raw.payloadType === 'plan_delta' ? 'Plan delta' : 'Plan update',
    preview: truncate(text || raw.preview || raw.payloadType),
    searchText: text || raw.searchText,
    severity: 'normal',
    status: raw.status || '',
    rawRefs: [rawRef(raw)],
    channels: [raw.recordType],
  });
}

function protocolWarningLabel(type) {
  if (type === 'stream_error') return 'Stream error';
  if (type === 'guardian_warning') return 'Guardian warning';
  return 'Warning';
}

function buildProtocolWarningEvent(raw) {
  const isError = raw.payloadType === 'stream_error';
  return createLogicalEvent({
    id: `${raw.sessionId}:logical:${raw.payloadType}:${raw.line}`,
    timestamp: raw.timestamp,
    turnId: raw.turnId || '',
    kind: isError ? 'error' : 'warning',
    subtype: raw.payloadType,
    layer: 'main',
    role: 'system',
    label: protocolWarningLabel(raw.payloadType),
    preview: truncate(firstNonEmpty(raw.parsed?.payload?.message, raw.parsed?.payload?.reason, raw.preview, raw.payloadType)),
    searchText: raw.searchText,
    severity: isError ? 'error' : 'warning',
    status: raw.status || '',
    rawRefs: [rawRef(raw)],
    channels: [raw.recordType],
  });
}

function buildLogicalEvents(rawEvents) {
  const logicalEvents = [];
  const consumed = new Set();
  const byCallId = new Map();

  for (const raw of rawEvents) {
    if (raw.callId) {
      if (!byCallId.has(raw.callId)) byCallId.set(raw.callId, []);
      byCallId.get(raw.callId).push(raw);
    }
  }

  for (const [callId, group] of byCallId.entries()) {
    group.sort((a, b) => a.line - b.line);
    const hasToolShape = group.some((raw) => raw.recordType === 'response_item' && ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(raw.payloadType))
      || group.some((raw) => raw.recordType === 'event_msg' && TOOL_EVENT_TYPES.has(raw.payloadType));
    if (!hasToolShape) continue;
    logicalEvents.push(buildToolLogicalEvent(callId, group));
    for (const raw of group) consumed.add(raw.rawId);
  }

  for (let i = 0; i < rawEvents.length; i += 1) {
    const raw = rawEvents[i];
    if (consumed.has(raw.rawId)) continue;
    const next = rawEvents[i + 1];
    const prev = rawEvents[i - 1];

    if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'user') {
      const protocolSubtype = classifyProtocolText(raw.messageText, raw.role);
      if (protocolSubtype) {
        logicalEvents.push(buildProtocolEvent(raw, protocolSubtype));
        consumed.add(raw.rawId);
        continue;
      }
      if (next && next.recordType === 'event_msg' && next.payloadType === 'user_message' && raw.messageText === next.messageText) {
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', next.messageText, [raw, next]));
        consumed.add(raw.rawId);
        consumed.add(next.rawId);
        continue;
      }
      logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', raw.messageText, [raw]));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'event_msg' && raw.payloadType === 'user_message') {
      if (prev && prev.recordType === 'response_item' && prev.payloadType === 'message' && prev.role === 'user' && prev.messageText === raw.messageText) {
        consumed.add(raw.rawId);
        continue;
      }
      const protocolSubtype = classifyProtocolText(raw.messageText, 'user');
      if (protocolSubtype) {
        logicalEvents.push(buildProtocolEvent(raw, protocolSubtype));
        consumed.add(raw.rawId);
        continue;
      }
      logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', raw.messageText, [raw]));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'developer') {
      logicalEvents.push(buildProtocolEvent(raw, classifyProtocolText(raw.messageText, 'developer') || 'developer_instruction'));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_message') {
      if (next && next.recordType === 'response_item' && next.payloadType === 'message' && next.role === 'assistant' && next.messageText === raw.messageText) {
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw, next]));
        consumed.add(raw.rawId);
        consumed.add(next.rawId);
        continue;
      }
      logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw]));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'assistant') {
      if (prev && prev.recordType === 'event_msg' && prev.payloadType === 'agent_message' && prev.messageText === raw.messageText) {
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.messageText.startsWith('<proposed_plan>')) {
        logicalEvents.push(buildPlanArtifact(raw, null, raw.messageText));
        consumed.add(raw.rawId);
        continue;
      }
      logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw]));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_reasoning') {
      if (next && next.recordType === 'response_item' && next.payloadType === 'reasoning' && relatedReasoning(raw.messageText, next.messageText)) {
        logicalEvents.push(buildReasoningEvent([raw, next], next.messageText || raw.messageText));
        consumed.add(raw.rawId);
        consumed.add(next.rawId);
        continue;
      }
      logicalEvents.push(buildReasoningEvent([raw], raw.messageText));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'response_item' && raw.payloadType === 'reasoning') {
      if (prev && prev.recordType === 'event_msg' && prev.payloadType === 'agent_reasoning' && relatedReasoning(prev.messageText, raw.messageText)) {
        consumed.add(raw.rawId);
        continue;
      }
      logicalEvents.push(buildReasoningEvent([raw], raw.messageText));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'event_msg' && raw.payloadType === 'item_completed' && raw.parsed.payload?.item?.type === 'Plan') {
      if (next && next.recordType === 'response_item' && next.payloadType === 'message' && next.role === 'assistant' && next.messageText.startsWith('<proposed_plan>')) {
        logicalEvents.push(buildPlanArtifact(raw, next, next.messageText));
        consumed.add(raw.rawId);
        consumed.add(next.rawId);
        continue;
      }
      logicalEvents.push(buildPlanArtifact(raw, null, raw.parsed.payload.item.text || raw.searchText));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'event_msg' && ['plan_update', 'plan_delta'].includes(raw.payloadType)) {
      logicalEvents.push(buildPlanUpdateEvent(raw));
      consumed.add(raw.rawId);
      continue;
    }

    if (isWebSearchCall(raw)) {
      const pairedEnd = webSearchRowsMatch(next, raw) ? next : null;
      const event = buildWebSearchEvent(raw, pairedEnd);
      logicalEvents.push(event);
      consumed.add(raw.rawId);
      if (pairedEnd) consumed.add(pairedEnd.rawId);
      continue;
    }

    if (isWebSearchEnd(raw)) {
      if (webSearchRowsMatch(raw, prev)) {
        consumed.add(raw.rawId);
        continue;
      }
      if (webSearchRowsMatch(raw, next)) {
        logicalEvents.push(buildWebSearchEvent(next, raw));
        consumed.add(raw.rawId);
        consumed.add(next.rawId);
        continue;
      }
      logicalEvents.push(buildWebSearchEvent(null, raw));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'session_meta') {
      logicalEvents.push(buildProtocolEvent(raw, 'session_meta'));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'turn_context') {
      logicalEvents.push(buildProtocolEvent(raw, 'turn_context'));
      consumed.add(raw.rawId);
      continue;
    }

    if (raw.recordType === 'event_msg' && raw.payloadType === 'token_count') {
      logicalEvents.push(buildProtocolEvent(raw, 'token_count'));
      if (rateLimitReachedType(raw.parsed?.payload)) {
        logicalEvents.push(buildLifecycleEvent(raw, 'token', 'Usage limit reached', 'warning'));
      }
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'context_compacted') {
      logicalEvents.push(buildLifecycleEvent(raw, 'compaction', 'Context compacted', 'warning'));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'turn_aborted') {
      logicalEvents.push(buildLifecycleEvent(raw, 'abort', 'Turn aborted', 'error'));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'thread_rolled_back') {
      logicalEvents.push(buildLifecycleEvent(raw, 'rollback', 'Thread rolled back', 'warning'));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && ['warning', 'guardian_warning', 'stream_error'].includes(raw.payloadType)) {
      logicalEvents.push(buildProtocolWarningEvent(raw));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'error') {
      logicalEvents.push(buildLifecycleEvent(raw, 'error', 'Error', 'error'));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'entered_review_mode') {
      logicalEvents.push(buildLifecycleEvent(raw, 'review', 'Review started', 'normal', reviewLifecyclePreview(raw)));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'exited_review_mode') {
      logicalEvents.push(buildLifecycleEvent(raw, 'review', 'Review completed', 'normal', reviewLifecyclePreview(raw)));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && ['collab_agent_spawn_end', 'collab_agent_interaction_end', 'collab_waiting_end', 'collab_close_end'].includes(raw.payloadType)) {
      logicalEvents.push(buildLifecycleEvent(raw, 'subagent', 'Subagent', 'normal'));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && ['task_started', 'task_complete'].includes(raw.canonicalType)) {
      logicalEvents.push(buildProtocolEvent(raw, raw.canonicalType));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && ['thread_name_updated', 'item_completed'].includes(raw.canonicalType)) {
      logicalEvents.push(buildLifecycleEvent(raw, 'turn', raw.canonicalType, 'normal'));
      consumed.add(raw.rawId);
      continue;
    }

    logicalEvents.push(buildProtocolEvent(raw, raw.payloadType || raw.recordType, raw.payloadType || raw.recordType));
    consumed.add(raw.rawId);
  }

  logicalEvents.sort((a, b) => {
    const at = a.timestamp || '';
    const bt = b.timestamp || '';
    if (at !== bt) return at.localeCompare(bt);
    const al = a.rawRefs[0]?.line || 0;
    const bl = b.rawRefs[0]?.line || 0;
    return al - bl;
  });

  return logicalEvents;
}

function countBy(items, fn) {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function eventKindOptionsFromCounts(counts) {
  return [...counts.entries()]
    .sort((a, b) => eventKindLabel(a[0]).localeCompare(eventKindLabel(b[0])) || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: eventKindLabel(value), count }));
}

function eventKindCatalog(sessions) {
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
    main: eventKindOptionsFromCounts(counts.main),
    protocol: eventKindOptionsFromCounts(counts.protocol),
    raw: eventKindOptionsFromCounts(counts.raw),
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
  if (['command', 'patch', 'mcp', 'web_search', 'tool_operation', 'js_repl'].includes(logicalEvent.kind)) {
    session.counts.toolCalls += 1;
  }
  if (logicalEvent.kind === 'command' && logicalEvent.status === 'failed') session.counts.failedCommands += 1;
  if (logicalEvent.kind === 'patch') session.counts.patches += 1;
  if (logicalEvent.kind === 'compaction') session.counts.compactions += 1;
  if (logicalEvent.kind === 'abort') session.counts.aborts += 1;
  if (logicalEvent.kind === 'error') session.counts.errors += 1;
  if (logicalEvent.kind === 'plan_artifact') session.counts.planArtifacts += 1;
  if (logicalEvent.kind === 'plan_artifact' || logicalEvent.kind === 'plan_update' || logicalEvent.toolName === 'update_plan' || logicalEvent.subtype === 'update_plan') {
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
  if (event.kind === 'token') {
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

  session.searchText = [
    session.title,
    [...session.cwdSet].join('\n'),
    session.logicalEvents.map((event) => event.searchText).join('\n'),
  ].join('\n').toLowerCase();

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
      if (record.type === 'event_msg' && record.payload?.type === 'entered_review_mode') {
        session._reviewMarkers.push({
          enteredAt: safeIso(record.timestamp),
          exitedAt: '',
        });
      } else if (record.type === 'event_msg' && record.payload?.type === 'exited_review_mode') {
        let marker = session._reviewMarkers[session._reviewMarkers.length - 1];
        if (!marker || marker.exitedAt) {
          marker = { enteredAt: '', exitedAt: '' };
          session._reviewMarkers.push(marker);
        }
        marker.exitedAt = safeIso(record.timestamp);
      }
      updateTimeRange(session, record.timestamp);
      session.rawEvents.push(makeRawEvent(record, lineNumber, relFile, session.id));
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  throwIfAborted(signal);
  session.logicalEvents = buildLogicalEvents(session.rawEvents);
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
    if (matchesRepo || !hasCwd) {
      candidates.push(filePath);
      candidateBytes += inspected.bytes;
      if (!hasCwd) unknownFileCount += 1;
    } else {
      skippedFileCount += 1;
    }
    emitProgress(onProgress, {
      phase: 'selecting',
      repoRoot: resolvedRepo,
      filesTotal: files.length,
      filesScanned: skippedFileCount + candidates.length,
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

function matchTerms(text, q) {
  const terms = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = String(text || '').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function countSearchMatches(text, q) {
  const terms = [...new Set(String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean))];
  if (!terms.length) return 0;
  const haystack = String(text || '').toLowerCase();
  let total = 0;
  for (const term of terms) {
    let index = haystack.indexOf(term);
    while (index >= 0) {
      total += 1;
      index = haystack.indexOf(term, index + term.length);
    }
  }
  return total;
}

function eventSearchText(event) {
  return `${event.preview || ''}\n${event.searchText || ''}`;
}

function eventSearchCountText(event) {
  return event.searchText || event.preview || '';
}

function eventMatches(event, filters) {
  if (filters.layer && event.layer !== filters.layer) return false;
  if (filters.kind && event.kind !== filters.kind && event.subtype !== filters.kind) return false;
  if (filters.status && event.status !== filters.status) return false;
  if (filters.tool && !String(event.toolName || '').toLowerCase().includes(filters.tool.toLowerCase())) return false;
  if (filters.file) {
    const needle = normalizeSearchPath(filters.file);
    const sourceMatch = normalizeSearchPath(event.source?.file).includes(needle);
    const touchedMatch = (event.touchedFiles || []).some((file) => normalizeSearchPath(file).includes(needle));
    const rawMatch = (event.rawRefs || []).some((ref) => normalizeSearchPath(ref.file).includes(needle));
    if (!sourceMatch && !touchedMatch && !rawMatch) return false;
  }
  if (filters.q && !matchTerms(eventSearchText(event), filters.q)) return false;
  return true;
}

function sessionSummary(session, index) {
  const derivedKind = derivedSessionKind(session);
  const parentSession = session.parentSessionId ? index?.sessionsById?.get(session.parentSessionId) : null;
  const forkedFromSession = session.forkedFromSessionId ? index?.sessionsById?.get(session.forkedFromSessionId) : null;
  return {
    id: session.id,
    title: session.title,
    sourceFile: session.sourceFile,
    bytes: session.bytes,
    lineCount: session.lineCount,
    cwdSet: [...session.cwdSet],
    parentSessionId: session.parentSessionId,
    parentSessionInferred: Boolean(session.parentSessionInferred),
    parentSessionTitle: parentSession?.title || '',
    forkedFromSessionId: session.forkedFromSessionId,
    forkedFromSessionTitle: forkedFromSession?.title || '',
    agentNickname: session.agentNickname,
    isDerivedSession: Boolean(derivedKind),
    derivedKind,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    counts: session.counts,
    topTools: session.analysis.toolUsage.slice(0, 5),
    failedCommands: session.analysis.failedCommands.length,
    patchedFiles: session.analysis.patchedFiles.slice(0, 5),
    protocolCount: session.analysis.protocolStats.reduce((sum, item) => sum + item.count, 0),
    rawEventCount: session.rawEvents.length,
  };
}

function filterSessions(index, filters) {
  let sessions = index.sessions.filter((session) => {
    if (filters.from && String(session.updatedAt || session.startedAt) < `${filters.from}T00:00:00.000Z`) return false;
    if (filters.to && String(session.startedAt || session.updatedAt) > `${filters.to}T23:59:59.999Z`) return false;
    if (filters.q && !matchTerms(session.searchText, filters.q)) return false;
    if (filters.kind || filters.status || filters.tool || filters.file || filters.layer) {
      const haystack = filters.layer === 'raw' ? session.rawEvents.map((raw) => rawEventDto(raw, '')).filter((event) => eventMatches(event, filters)) : session.logicalEvents.filter((event) => eventMatches(event, filters));
      return haystack.length > 0;
    }
    return true;
  });

  if (filters.sort === 'started-asc') {
    sessions = sessions.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  } else if (filters.sort === 'events-desc') {
    sessions = sessions.sort((a, b) => b.logicalEvents.length - a.logicalEvents.length);
  } else if (filters.sort === 'failures-desc') {
    sessions = sessions.sort((a, b) => b.counts.failedCommands - a.counts.failedCommands);
  } else {
    sessions = sessions.sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)));
  }

  return {
    total: sessions.length,
    sessions: sessions.map((session) => sessionSummary(session, index)),
  };
}

function fileSuggestions(index, limit = 80) {
  const counts = new Map();
  const add = (file, count = 1) => {
    const display = displayProjectFile(file, index.repoRoot);
    if (!display) return;
    counts.set(display, (counts.get(display) || 0) + count);
  };
  for (const session of index.sessions || []) {
    for (const item of session.analysis?.patchedFiles || []) {
      add(item.file, item.count || 1);
    }
    for (const event of session.logicalEvents || []) {
      for (const file of event.touchedFiles || []) {
        add(file);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([file, count]) => ({ file, count }));
}

function makeSnippet(text, q) {
  const terms = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return '';
  const source = String(text || '');
  const lower = source.toLowerCase();
  const first = terms.map((term) => lower.indexOf(term)).filter((pos) => pos >= 0).sort((a, b) => a - b)[0];
  if (first == null) return '';
  const start = Math.max(0, first - 80);
  const end = Math.min(source.length, first + 180);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < source.length ? '...' : '';
  return `${prefix}${source.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function logicalEventDto(event, q) {
  const hasSearchHit = q ? matchTerms(eventSearchText(event), q) : false;
  return {
    id: event.id,
    timestamp: event.timestamp,
    turnId: event.turnId,
    recordType: '',
    payloadType: event.subtype,
    kind: event.kind,
    subtype: event.subtype,
    layer: event.layer,
    role: event.role,
    label: event.label,
    preview: event.preview,
    severity: event.severity,
    status: event.status,
    toolName: event.toolName,
    hasLongOutput: event.hasLongOutput,
    hasSearchHit,
    touchedFiles: event.touchedFiles,
    outputStats: event.outputStats,
    tokenUsage: event.tokenUsage,
    usageLimits: event.usageLimits,
    source: event.source,
    rawRefs: event.rawRefs,
    channels: event.channels,
    snippet: hasSearchHit ? makeSnippet(eventSearchText(event), q) : '',
  };
}

function getTimeline(index, sessionId, filters) {
  const session = index.sessionsById.get(sessionId);
  if (!session) return null;
  const layer = filters.layer || 'main';
  const sourceEvents = layer === 'raw'
    ? session.rawEvents.map((raw) => rawEventDto(raw, filters.q))
    : session.logicalEvents.filter((event) => event.layer === layer);
  const structuralFilters = { ...filters, q: '', layer };
  const matched = sourceEvents.filter((event) => eventMatches(event, structuralFilters));
  const searchMatchCount = filters.q
    ? matched.reduce((sum, event) => sum + countSearchMatches(eventSearchCountText(event), filters.q), 0)
    : 0;
  const page = matched.slice(filters.offset, filters.offset + filters.limit);
  return {
    session: sessionSummary(session),
    total: matched.length,
    searchMatchCount,
    offset: filters.offset,
    limit: filters.limit,
    layer,
    eventKinds: session.eventKinds || eventKindCatalog([session]),
    events: layer === 'raw' ? page : page.map((event) => logicalEventDto(event, filters.q)),
  };
}

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

module.exports = {
  buildIndex,
  discoverProjects,
  discoverConfiguredProjects,
  buildEventDetail,
  fileSuggestions,
  filterSessions,
  getTimeline,
  eventKindCatalog,
  readRawLine,
  normalizeFsPath,
  isPathInsideOrSame,
  matchTerms,
};
