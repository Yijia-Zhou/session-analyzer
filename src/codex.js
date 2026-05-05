'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const MarkdownIt = require('markdown-it');

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const SECTION_TYPES = new Set(['markdown', 'code', 'terminal', 'json', 'diff', 'kv', 'notice', 'raw_json']);

let markdownRenderer = null;

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
  image_wrapper: 'Image attachment wrapper',
  meta_block: 'Protocol metadata block',
  session_meta: 'Session metadata',
  skill_injection: 'Skill instructions',
  turn_aborted_marker: 'Turn aborted marker',
  turn_context: 'Turn context',
  user_shell_command: 'User shell command',
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
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function lineStatsFromPatchChange(stats) {
  if (!stats || typeof stats !== 'object') return null;
  if (isFiniteNumberValue(stats.additions) || isFiniteNumberValue(stats.deletions)) {
    return {
      additions: isFiniteNumberValue(stats.additions) ? Number(stats.additions) : 0,
      deletions: isFiniteNumberValue(stats.deletions) ? Number(stats.deletions) : 0,
    };
  }
  if (typeof stats.unified_diff === 'string') return lineStatsFromUnifiedDiff(stats.unified_diff);
  if (stats.type === 'add' && typeof stats.content === 'string') {
    return { additions: textLineCount(stats.content), deletions: 0 };
  }
  if (stats.type === 'delete' && typeof stats.content === 'string') {
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

function diffStatsEntries(changes) {
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes).map(([file, stats]) => {
    const lineStats = lineStatsFromPatchChange(stats);
    return {
      key: file,
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
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  flush();
  return entries;
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

function maybePushCodeSection(sections, title, code, language = '') {
  const source = String(code || '').trim();
  if (!source) return;
  sections.push({ type: 'code', title, code: source, language });
}

function maybePushTerminalSection(sections, title, text, stream = 'stdout') {
  const source = String(text || '');
  if (!source.trim()) return;
  sections.push({ type: 'terminal', title, text: source, stream });
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

function parentSessionIdFromMeta(payload) {
  return payload?.forked_from_id || subagentSpawnSource(payload)?.parent_thread_id || '';
}

function agentNicknameFromMeta(payload) {
  return payload?.agent_nickname || subagentSpawnSource(payload)?.agent_nickname || '';
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
    agentNickname: '',
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
  if (Array.isArray(command)) return command.map(String).join(' ');
  return String(command || '');
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
    role: payload.role || '',
    typeKey: `${record.type}:${payload.type || ''}:${payload.role || ''}`,
    callId: payload.call_id || '',
    toolName: payload.name || '',
    status: payload.status || '',
    messageText: '',
    searchText: '',
    preview: '',
    commandText: '',
    stdout: '',
    stderr: '',
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
      raw.output = String(payload.arguments || '');
      raw.preview = truncate(`${payload.name || 'function_call'} ${raw.output}`);
      raw.searchText = `${payload.name || ''}\n${raw.output}`;
      return raw;
    }
    if (payload.type === 'function_call_output') {
      raw.output = String(payload.output || '');
      raw.preview = truncate(raw.output || payload.call_id || 'function_call_output');
      raw.searchText = raw.output;
      return raw;
    }
    if (payload.type === 'custom_tool_call') {
      raw.output = String(payload.input || '');
      raw.preview = truncate(`${payload.name || 'custom_tool_call'} ${raw.output}`);
      raw.searchText = `${payload.name || ''}\n${raw.output}`;
      return raw;
    }
    if (payload.type === 'custom_tool_call_output') {
      raw.output = String(payload.output || '');
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
        raw.messageText = String(payload.message || payload.text || '');
        raw.preview = truncate(raw.messageText || payload.type);
        raw.searchText = raw.messageText;
        return raw;
      case 'exec_command_end':
        raw.commandText = commandToText(payload.command);
        raw.stdout = String(payload.stdout || '');
        raw.stderr = String(payload.stderr || '');
        raw.exitCode = Number.isFinite(Number(payload.exit_code)) ? Number(payload.exit_code) : null;
        raw.durationMs = durationMs(payload.duration);
        raw.preview = truncate(raw.commandText || 'exec_command_end');
        raw.searchText = [raw.commandText, raw.stdout, raw.stderr, payload.formatted_output || ''].join('\n');
        return raw;
      case 'patch_apply_end':
        raw.touchedFiles = payload.changes && typeof payload.changes === 'object' ? Object.keys(payload.changes) : [];
        raw.preview = truncate(raw.touchedFiles.join(', ') || String(payload.stdout || payload.stderr || 'patch_apply_end'));
        raw.searchText = [raw.touchedFiles.join('\n'), payload.stdout || '', payload.stderr || ''].join('\n');
        return raw;
      case 'mcp_tool_call_end':
      case 'web_search_end':
      case 'token_count':
      case 'context_compacted':
      case 'turn_aborted':
      case 'thread_rolled_back':
      case 'error':
      case 'collab_agent_spawn_end':
      case 'collab_agent_interaction_end':
      case 'collab_waiting_end':
      case 'collab_close_end':
      case 'task_started':
      case 'task_complete':
      case 'item_completed':
      case 'thread_name_updated':
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
  return String(envelope && Object.hasOwn(envelope, 'output') ? envelope.output : rawOutput || '').trim();
}

function patchOutputHasFailure(text) {
  return /(?:apply_patch verification failed|failed to find expected lines|invalid patch|error:)/i.test(String(text || ''));
}

function patchOutputHasSuccess(text) {
  return /(?:success\. updated the following files|^done\b|patch applied)/i.test(String(text || '').trim());
}

function inferPatchSuccess(patchEnd, customOutputObj, rawOutput) {
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
    .map((entry) => `${entry.key}: ${String(entry.value).trim()}`)
    .join('; ');
}

function payloadPreview(payload, keys) {
  if (!payload || typeof payload !== 'object') return '';
  return formatPreviewEntries(keys.map((key) => ({ key, value: payload[key] == null ? '' : String(payload[key]) })));
}

function protocolPreviewFor(raw, subtype) {
  const source = String(raw.messageText || raw.searchText || raw.preview || '').trim();

  if (subtype === 'session_meta') {
    return payloadPreview(raw.parsed?.payload, ['id', 'cwd', 'originator']) || raw.preview;
  }
  if (subtype === 'turn_context') {
    return payloadPreview(raw.parsed?.payload, ['turn_id', 'cwd', 'model']) || raw.preview;
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
  ));
  maybePushMarkdownSection(sections, 'Plan', planText);
  hideSectionTitle(sections[0]);
  sections.push(makeRawJsonSection('Plan raw JSON', raws.map((raw) => raw.parsed)));
  return sections;
}

function extractCommandSections(raws, event) {
  const sections = [];
  const functionCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
  const functionOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
  const execEnd = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'exec_command_end');
  const args = commandArgsFromRaw(functionCall);
  const formatted = parseFormattedCommandOutput(functionOutput?.output);
  const commandText = execEnd?.commandText || commandToText(args?.command);
  maybePushCodeSection(sections, 'Command', commandText, 'shell');

  maybePushKvSection(sections, 'Command metadata', [
    { key: 'cwd', value: String(execEnd?.parsed?.payload?.cwd || args?.workdir || '') },
    { key: 'status', value: String(event.status || execEnd?.status || '') },
    { key: 'exitCode', value: event.outputStats.exitCode == null ? '' : String(event.outputStats.exitCode) },
    { key: 'durationMs', value: event.outputStats.durationMs == null ? '' : String(event.outputStats.durationMs) },
  ]);

  if (args) {
    sections.push({ type: 'json', title: 'Command arguments', value: args });
  }

  const stdout = firstNonEmpty(execEnd?.stdout, formatted?.output);
  const stderr = execEnd?.stderr || '';
  maybePushTerminalSection(sections, 'stdout', stdout, 'stdout');
  maybePushTerminalSection(sections, 'stderr', stderr, 'stderr');

  if (stdout) maybePushParsedOutputSection(sections, 'stdout (structured)', stdout);
  if (stderr) maybePushParsedOutputSection(sections, 'stderr (structured)', stderr);
  if (functionOutput?.output) maybePushParsedOutputSection(sections, 'Tool output', structuredOutputValue(functionOutput.output));

  if (!sections.length) sections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
  return sections;
}

function extractPatchSections(raws, event) {
  const sections = [];
  const customCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const patchEnd = raws.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'patch_apply_end');
  const envelope = toolOutputEnvelope(customOutput);
  const patchText = customCall?.output || '';
  if (patchText.trim()) sections.push({ type: 'diff', title: 'Patch', text: patchText.trim() });

  const patchFileEntries = diffStatsEntries(patchEnd?.parsed?.payload?.changes);
  const fallbackPatchFileEntries = patchFileEntries.length ? [] : diffStatsEntriesFromPatchInput(patchText);
  maybePushKvSection(sections, 'Patch files', patchFileEntries.length ? patchFileEntries : fallbackPatchFileEntries);
  if (!patchFileEntries.length && !fallbackPatchFileEntries.length) {
    maybePushKvSection(sections, 'Touched files', event.touchedFiles.map((file) => ({ key: file, value: 'updated' })));
  }

  const noticeText = firstNonEmpty(
    envelope?.output,
    patchEnd?.parsed?.payload?.stdout,
    patchEnd?.parsed?.payload?.stderr,
    event.status ? `Patch ${event.status}.` : '',
  );
  if (noticeText) {
    sections.push(makeNoticeSection('Patch status', noticeText, event.status === 'failed' ? 'error' : 'info'));
  }

  maybePushKvSection(sections, 'Patch metadata', [
    { key: 'status', value: String(event.status || '') },
    { key: 'durationMs', value: event.outputStats.durationMs == null ? '' : String(event.outputStats.durationMs) },
  ]);

  if (!sections.some((section) => section.type === 'diff')) {
    sections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
  }
  return sections;
}

function extractJsReplSections(raws, event) {
  const sections = [];
  const customCall = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
  const customOutput = raws.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
  const envelope = toolOutputEnvelope(customOutput);
  maybePushCodeSection(sections, 'JavaScript', customCall?.output, 'javascript');
  maybePushKvSection(sections, 'JS REPL metadata', [
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

  maybePushKvSection(sections, 'Tool metadata', [
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

  maybePushKvSection(sections, 'Search metadata', [
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
  if (event.subtype === 'environment_context' || event.subtype === 'session_meta' || event.subtype === 'turn_context') {
    const entries = event.subtype === 'environment_context'
      ? taggedBlockEntries(primary.messageText)
      : toKvEntries(primary.parsed?.payload, ['cwd', 'turn_id', 'model', 'id', 'originator']);
    maybePushKvSection(sections, 'Protocol fields', entries);
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
  sections.push(hideSectionTitle(makeNoticeSection(event.label, event.preview || event.label, event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info')));
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

function rawToolSections(raw, relatedEvent) {
  const sections = [];
  const omitPayloadKeys = [];
  const toolName = raw.toolName || relatedEvent?.toolName || relatedEvent?.subtype || '';

  if (raw.recordType === 'response_item' && raw.payloadType === 'function_call' && toolName === 'shell_command') {
    const args = commandArgsFromRaw(raw);
    const commandText = commandToText(args?.command);
    maybePushCodeSection(sections, 'Command', commandText, 'shell');
    maybePushKvSection(sections, 'Command metadata', [
      { key: 'cwd', value: String(args?.workdir || '') },
      { key: 'timeoutMs', value: args?.timeout_ms == null ? '' : String(args.timeout_ms) },
    ]);
    if (args) sections.push({ type: 'json', title: 'Command arguments', value: args });
    omitPayloadKeys.push('arguments');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'function_call_output' && relatedEvent?.kind === 'command') {
    const formatted = parseFormattedCommandOutput(raw.output);
    if (formatted) {
      maybePushKvSection(sections, 'Command output metadata', [
        { key: 'exitCode', value: String(formatted.exitCode) },
        { key: 'wallTime', value: formatted.wallTime },
      ]);
      maybePushTerminalSection(sections, 'stdout', formatted.output, formatted.exitCode === 0 ? 'stdout' : 'stderr');
    } else {
      maybePushStructuredSection(sections, 'Command output', structuredOutputValue(raw.output));
    }
    omitPayloadKeys.push('output');
  } else if (raw.recordType === 'event_msg' && raw.payloadType === 'exec_command_end') {
    maybePushCodeSection(sections, 'Command', raw.commandText, 'shell');
    maybePushKvSection(sections, 'Command metadata', [
      { key: 'cwd', value: String(raw.parsed?.payload?.cwd || '') },
      { key: 'status', value: String(raw.status || '') },
      { key: 'exitCode', value: raw.exitCode == null ? '' : String(raw.exitCode) },
      { key: 'durationMs', value: raw.durationMs == null ? '' : String(raw.durationMs) },
    ]);
    maybePushTerminalSection(sections, 'stdout', raw.stdout, 'stdout');
    maybePushTerminalSection(sections, 'stderr', raw.stderr, 'stderr');
    if (raw.stdout) maybePushParsedOutputSection(sections, 'stdout (structured)', raw.stdout);
    if (raw.stderr) maybePushParsedOutputSection(sections, 'stderr (structured)', raw.stderr);
    omitPayloadKeys.push('command', 'cwd', 'stdout', 'stderr', 'aggregated_output', 'formatted_output', 'exit_code', 'duration', 'status');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call' && toolName === 'apply_patch') {
    if (String(raw.output || '').trim()) sections.push({ type: 'diff', title: 'Patch', text: String(raw.output).trim() });
    omitPayloadKeys.push('input');
  } else if (raw.recordType === 'event_msg' && raw.payloadType === 'patch_apply_end') {
    maybePushKvSection(sections, 'Patch files', diffStatsEntries(raw.parsed?.payload?.changes));
    const noticeText = firstNonEmpty(raw.parsed?.payload?.stdout, raw.parsed?.payload?.stderr, raw.status ? `Patch ${raw.status}.` : '');
    if (noticeText) sections.push(makeNoticeSection('Patch status', noticeText, raw.parsed?.payload?.success === false ? 'error' : 'info'));
    maybePushKvSection(sections, 'Patch metadata', [
      { key: 'status', value: String(raw.status || '') },
      { key: 'durationMs', value: raw.durationMs == null ? '' : String(raw.durationMs) },
    ]);
    omitPayloadKeys.push('stdout', 'stderr', 'changes', 'duration', 'status', 'success');
  } else if (raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output' && relatedEvent?.kind === 'patch') {
    const envelope = toolOutputEnvelope(raw);
    const output = firstNonEmpty(envelope?.output, raw.output);
    if (output) sections.push(makeNoticeSection('Patch status', stringifyValue(output), inferPatchSuccess(null, envelope, raw.output) ? 'info' : 'error'));
    maybePushKvSection(sections, 'Patch metadata', [
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

function rawPrimarySections(raw, relatedEvent) {
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

  const tool = rawToolSections(raw, relatedEvent);
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

function extractRawSections(raw, relatedEvent) {
  const sections = [];
  const primary = rawPrimarySections(raw, relatedEvent);
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
    maybePushCodeSection(sections, 'Command', raw.commandText, 'shell');
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

function extractLogicalDetailSections(event, raws) {
  switch (event.kind) {
    case 'user_message':
    case 'assistant_message':
      return extractConversationSections(raws);
    case 'plan_artifact':
      return extractPlanSections(raws);
    case 'reasoning':
      return extractReasoningSections(raws);
    case 'command':
      return extractCommandSections(raws, event);
    case 'patch':
      return extractPatchSections(raws, event);
    case 'js_repl':
      return extractJsReplSections(raws, event);
    case 'mcp':
    case 'tool_operation':
      return extractToolSections(raws, event);
    case 'web_search':
      return extractWebSearchSections(raws, event);
    case 'protocol':
      return extractProtocolSections(event, raws);
    case 'token':
    case 'compaction':
    case 'abort':
    case 'rollback':
    case 'error':
    case 'subagent':
    case 'turn':
      return extractLifecycleSections(event, raws);
    default:
      return [makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed))];
  }
}

function buildEventDetail(session, eventId, layer = 'main') {
  if (layer === 'raw') {
    const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
    if (!raw) return null;
    const relatedLogical = session.logicalEvents.find((event) => rawMatchesEvent(raw, event));
    const sections = filterDetailSections(extractRawSections(raw, relatedLogical));
    for (const section of sections) {
      if (section.type === 'raw_json') section.expanded = true;
    }
    return {
      id: raw.rawId,
      kind: raw.payloadType || raw.recordType,
      subtype: raw.role || '',
      layer: 'raw',
      title: raw.payloadType || raw.recordType,
      meta: rawMeta(raw),
      rawRefs: [rawRef(raw)],
      sections,
    };
  }

  const logical = session.logicalEvents.find((candidate) => candidate.id === eventId && candidate.layer === layer);
  if (!logical) return null;
  const raws = rawEventsForLogicalEvent(session, logical);
  const sections = extractLogicalDetailSections(logical, raws);
  return {
    id: logical.id,
    kind: logical.kind,
    subtype: logical.subtype,
    layer: logical.layer,
    title: logical.label,
    meta: logicalMeta(logical),
    rawRefs: logical.rawRefs,
    sections: filterDetailSections(sections.length ? sections : [makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed))]),
  };
}

function rawEventDto(raw, q) {
  const hasSearchHit = q ? matchTerms(`${raw.preview}\n${raw.searchText}`, q) : false;
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
    snippet: hasSearchHit ? makeSnippet(`${raw.preview}\n${raw.searchText}`, q) : '',
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
  const execEnd = group.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'exec_command_end');
  const patchEnd = group.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'patch_apply_end');
  const mcpEnd = group.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'mcp_tool_call_end');

  const toolName = customCall?.toolName || functionCall?.toolName || '';
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

  if (execEnd) {
    parts.push(execEnd.commandText, execEnd.stdout, execEnd.stderr);
    outputStats.exitCode = execEnd.exitCode;
    outputStats.durationMs = execEnd.durationMs;
  }
  if (functionCall) parts.push(functionCall.output);
  if (functionOutput) parts.push(functionOutput.output);
  if (customCall) parts.push(customCall.output);
  if (customOutput) parts.push(customOutput.output);
  if (mcpEnd) parts.push(mcpEnd.searchText);

  if (toolName === 'shell_command' || execEnd) {
    kind = 'command';
    label = execEnd?.exitCode === 0 ? 'Command' : 'Failed command';
    preview = truncate(execEnd?.commandText || functionCall?.output || 'shell command');
    const exitCode = execEnd?.exitCode ?? functionOutputInfo?.exitCode ?? customOutputObj?.metadata?.exit_code ?? 0;
    status = exitCode === 0 ? 'success' : 'failed';
    severity = exitCode === 0 ? 'normal' : 'error';
    outputStats.exitCode = exitCode;
    if (!outputStats.durationMs && customOutputObj?.metadata?.duration_seconds) {
      outputStats.durationMs = Math.round(Number(customOutputObj.metadata.duration_seconds) * 1000);
    }
    touchedFiles = touchFilesFromOutputText(execEnd?.stdout || functionOutputInfo?.output || '');
  } else if (toolName === 'apply_patch' || patchEnd) {
    kind = 'patch';
    touchedFiles = patchEnd?.touchedFiles?.length ? patchEnd.touchedFiles : patchFilesFromPatchInput(customCall?.output || '');
    const patchSuccess = inferPatchSuccess(patchEnd, customOutputObj, customOutput?.output);
    status = patchSuccess ? 'success' : 'failed';
    severity = patchSuccess ? 'normal' : 'error';
    label = patchSuccess ? 'Patch applied' : 'Patch failed';
    preview = truncate(touchedFiles.join(', ') || customOutputObj?.output || customCall?.output || 'apply_patch');
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
  } else if (mcpEnd || toolName.startsWith('mcp__')) {
    kind = 'mcp';
    label = 'MCP tool';
    preview = truncate(mcpEnd?.preview || toolName);
    status = 'success';
    outputStats.durationMs = mcpEnd?.durationMs || 0;
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

function buildWebSearchEvent(raw, next) {
  const refs = [rawRef(raw)];
  const channels = [raw.recordType];
  let preview = raw.preview;
  let searchText = raw.searchText;
  if (next && next.recordType === 'event_msg' && next.payloadType === 'web_search_end') {
    refs.push(rawRef(next));
    channels.push(next.recordType);
    preview = next.preview || raw.preview;
    searchText = `${raw.searchText}\n${next.searchText}`.trim();
  }
  return createLogicalEvent({
    id: `${raw.sessionId}:logical:web_search:${raw.line}`,
    timestamp: raw.timestamp,
    turnId: raw.turnId,
    kind: 'web_search',
    subtype: 'web_search',
    layer: 'main',
    role: 'assistant',
    label: 'Web search',
    preview,
    searchText,
    severity: 'normal',
    status: raw.status || next?.status || 'completed',
    toolName: 'web_search',
    rawRefs: refs,
    channels,
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

function buildLifecycleEvent(raw, kind, label, severity) {
  return createLogicalEvent({
    id: `${raw.sessionId}:logical:${kind}:${raw.line}`,
    timestamp: raw.timestamp,
    turnId: raw.turnId,
    kind,
    subtype: raw.payloadType || kind,
    layer: 'main',
    role: raw.role,
    label,
    preview: raw.preview || label,
    searchText: raw.searchText,
    severity,
    status: raw.status,
    rawRefs: [rawRef(raw)],
    channels: [raw.recordType],
  });
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
      || group.some((raw) => raw.recordType === 'event_msg' && ['exec_command_end', 'patch_apply_end', 'mcp_tool_call_end'].includes(raw.payloadType));
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

    if (raw.recordType === 'response_item' && raw.payloadType === 'web_search_call') {
      const event = buildWebSearchEvent(raw, next && next.payloadType === 'web_search_end' ? next : null);
      logicalEvents.push(event);
      consumed.add(raw.rawId);
      if (next && next.payloadType === 'web_search_end') consumed.add(next.rawId);
      continue;
    }

    if (raw.recordType === 'event_msg' && raw.payloadType === 'web_search_end') {
      if (prev && prev.recordType === 'response_item' && prev.payloadType === 'web_search_call') {
        consumed.add(raw.rawId);
        continue;
      }
      logicalEvents.push(createLogicalEvent({
        id: `${raw.sessionId}:logical:web_search:${raw.line}`,
        timestamp: raw.timestamp,
        turnId: raw.turnId,
        kind: 'web_search',
        subtype: 'web_search',
        layer: 'main',
        role: 'assistant',
        label: 'Web search',
        preview: raw.preview,
        searchText: raw.searchText,
        severity: 'normal',
        status: raw.status || 'completed',
        toolName: 'web_search',
        rawRefs: [rawRef(raw)],
        channels: [raw.recordType],
      }));
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
      logicalEvents.push(buildLifecycleEvent(raw, 'token', 'Token count', 'normal'));
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
    if (raw.recordType === 'event_msg' && raw.payloadType === 'error') {
      logicalEvents.push(buildLifecycleEvent(raw, 'error', 'Error', 'error'));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && ['collab_agent_spawn_end', 'collab_agent_interaction_end', 'collab_waiting_end', 'collab_close_end'].includes(raw.payloadType)) {
      logicalEvents.push(buildLifecycleEvent(raw, 'subagent', 'Subagent', 'normal'));
      consumed.add(raw.rawId);
      continue;
    }
    if (raw.recordType === 'event_msg' && ['task_started', 'task_complete', 'thread_name_updated', 'item_completed'].includes(raw.payloadType)) {
      logicalEvents.push(buildLifecycleEvent(raw, 'turn', raw.payloadType, 'normal'));
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
    const numbers = event.searchText.match(/\b\d{3,}\b/g) || [];
    for (const value of numbers.map(Number)) {
      if (value > draft.tokenStats.maxObserved) draft.tokenStats.maxObserved = value;
    }
  }
}

function inferSessionTitle(session) {
  if (session.parentSessionId) {
    const userEvents = session.logicalEvents.filter((event) => event.kind === 'user_message' && event.preview);
    const taskPreview = userEvents.at(-1)?.preview || path.basename(session.sourceFile, '.jsonl');
    const label = session.agentNickname ? `Subagent ${session.agentNickname}` : 'Subagent session';
    return `${label}: ${taskPreview}`;
  }
  const firstUserEvent = session.logicalEvents.find((event) => event.kind === 'user_message' && event.preview);
  return firstUserEvent?.preview || path.basename(session.sourceFile, '.jsonl');
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

  delete session._turnIds;
  delete session._analysisDraft;
  return session;
}

async function parseSessionFile(filePath, relFile, repoRoot) {
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

  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) continue;
    session.lineCount += 1;
    const record = safeJsonParse(line);
    if (!record) continue;

    if (record.type === 'session_meta' && record.payload) {
      if (!primarySessionMetaSeen) {
        primarySessionMetaSeen = true;
        if (record.payload.id) session.id = record.payload.id;
        session.parentSessionId = parentSessionIdFromMeta(record.payload);
        session.agentNickname = agentNicknameFromMeta(record.payload);
      }
      if (record.payload.cwd) {
        session.cwdSet.add(record.payload.cwd);
        if (isPathInsideOrSame(record.payload.cwd, repoRoot)) session.matchesRepo = true;
      }
    }
    if (!session.parentSessionId && record.type === 'event_msg' && record.payload?.type === 'thread_name_updated' && record.payload.thread_name) {
      session.title = record.payload.thread_name;
    }
    updateTimeRange(session, record.timestamp);
    session.rawEvents.push(makeRawEvent(record, lineNumber, relFile, session.id));
  }

  session.logicalEvents = buildLogicalEvents(session.rawEvents);
  for (const event of session.logicalEvents) {
    addCounts(session, event);
    updateAnalysisDraft(session, event);
  }
  return session;
}

async function buildIndex({ repoRoot, codexHome }) {
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedCodex = path.resolve(codexHome);
  const sessionsRoot = path.join(resolvedCodex, 'sessions');
  const sessionIndex = await readSessionIndex(resolvedCodex);
  const files = await collectJsonlFiles(sessionsRoot);
  const sessions = [];
  const sessionsById = new Map();
  let logicalEventCount = 0;
  let rawEventCount = 0;

  for (const filePath of files) {
    const relFile = path.relative(sessionsRoot, filePath);
    const session = await parseSessionFile(filePath, relFile, resolvedRepo);
    const indexEntry = sessionIndex.get(session.id);
    finalizeSession(session, indexEntry);
    if (!session.matchesRepo) continue;
    sessions.push(session);
    sessionsById.set(session.id, session);
    logicalEventCount += session.logicalEvents.length;
    rawEventCount += session.rawEvents.length;
  }

  sessions.sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)));
  return {
    repoRoot: resolvedRepo,
    codexHome: resolvedCodex,
    sessionsRoot,
    generatedAt: new Date().toISOString(),
    sessions,
    sessionsById,
    totals: {
      fileCount: files.length,
      sessionCount: sessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      indexedBytes: sessions.reduce((sum, session) => sum + session.bytes, 0),
    },
  };
}

function matchTerms(text, q) {
  const terms = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = String(text || '').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function eventMatches(event, filters) {
  if (filters.layer && event.layer !== filters.layer) return false;
  if (filters.kind && event.kind !== filters.kind && event.subtype !== filters.kind) return false;
  if (filters.status && event.status !== filters.status) return false;
  if (filters.tool && !String(event.toolName || '').toLowerCase().includes(filters.tool.toLowerCase())) return false;
  if (filters.file) {
    const needle = filters.file.toLowerCase();
    const sourceMatch = (event.source?.file || '').toLowerCase().includes(needle);
    const touchedMatch = (event.touchedFiles || []).some((file) => file.toLowerCase().includes(needle));
    const rawMatch = (event.rawRefs || []).some((ref) => ref.file.toLowerCase().includes(needle));
    if (!sourceMatch && !touchedMatch && !rawMatch) return false;
  }
  if (filters.q && !matchTerms(`${event.preview}\n${event.searchText}`, filters.q)) return false;
  return true;
}

function sessionSummary(session) {
  return {
    id: session.id,
    title: session.title,
    sourceFile: session.sourceFile,
    bytes: session.bytes,
    lineCount: session.lineCount,
    cwdSet: [...session.cwdSet],
    parentSessionId: session.parentSessionId,
    agentNickname: session.agentNickname,
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
    sessions: sessions.map(sessionSummary),
  };
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
  const hasSearchHit = q ? matchTerms(`${event.preview}\n${event.searchText}`, q) : false;
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
    source: event.source,
    rawRefs: event.rawRefs,
    channels: event.channels,
    snippet: hasSearchHit ? makeSnippet(`${event.preview}\n${event.searchText}`, q) : '',
  };
}

function getTimeline(index, sessionId, filters) {
  const session = index.sessionsById.get(sessionId);
  if (!session) return null;
  const layer = filters.layer || 'main';
  const sourceEvents = layer === 'raw'
    ? session.rawEvents.map((raw) => rawEventDto(raw, filters.q))
    : session.logicalEvents.filter((event) => event.layer === layer);
  const matched = sourceEvents.filter((event) => eventMatches(event, { ...filters, layer }));
  const page = matched.slice(filters.offset, filters.offset + filters.limit);
  return {
    session: sessionSummary(session),
    total: matched.length,
    offset: filters.offset,
    limit: filters.limit,
    layer,
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
  buildEventDetail,
  filterSessions,
  getTimeline,
  readRawLine,
  normalizeFsPath,
  isPathInsideOrSame,
  matchTerms,
};
