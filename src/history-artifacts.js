'use strict';

// This is deliberately a recognizer for a small invocation grammar, not a shell
// parser. Unknown wrappers and mixed operations remain searchable.
const COMMAND_TOOLS = new Set(['exec_command', 'shell_command', 'Bash']);
const OPERATIONS = new Set(['status', 'search', 'context', 'read']);
const UNKNOWN = Object.freeze({ recognized: false, reason: null });
// Materialized sessions are immutable snapshots. Weak ownership lets their
// parsed evidence indexes disappear with the materialized session itself.
const SESSION_FACTS = new WeakMap();

function commandWords(command) {
  if (typeof command !== 'string' || /[\r\n\0`$]/.test(command)) return null;
  const words = [];
  let word = '';
  let quote = '';
  let started = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        // PowerShell's doubled single quote is a literal quote.
        if (quote === "'" && command[index + 1] === "'") {
          word += "'";
          index += 1;
        } else quote = '';
      } else {
        // Shell escaping differs by platform. Decline ambiguous forms.
        if (char === '\\' && command[index + 1] === quote) return null;
        word += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      if (/[;&|<>()[\]{}#]/.test(char) || char === '\\') return null;
      word += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words;
}

function recognizedOperation(command) {
  const words = commandWords(command);
  if (!words) return null;
  let offset = 0;
  if (words[0] === 'npx' || words[0] === 'npx.cmd') {
    offset += 1;
    if (words[offset] === '--yes' || words[offset] === '-y') offset += 1;
    // No package injection flags, shell wrappers, or guessed executable paths.
    if (!/^session-analyzer(?:@\d+\.\d+\.\d+(?:-[\w.-]+)?)?$/.test(words[offset] || '')) return null;
  } else if (!['session-analyzer', 'session-analyzer.cmd', 'session-analyzer.exe'].includes(words[0])) {
    return null;
  }
  return words[offset + 1] === 'history' && OPERATIONS.has(words[offset + 2])
    ? words[offset + 2] : null;
}

function parseArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function entriesForRaw(raw) {
  const record = raw?.parsed;
  // Codex materialization intentionally retains compact canonical rows instead
  // of parsed JSON. Its adapter preserves function-call arguments verbatim in
  // output, with separate structural record type, tool name and call identity.
  if (!record && raw?.sourceKind === 'codex' && raw.recordType === 'response_item') {
    if (raw.payloadType === 'function_call') {
      const args = parseArguments(raw.output);
      return [{ type: 'call', id: raw.callId, name: raw.toolName, command: args?.cmd ?? args?.command }];
    }
    if (raw.payloadType === 'function_call_output') return [{ type: 'result', id: raw.callId }];
  }
  if (!record || typeof record !== 'object') return [];
  if (raw.sourceKind === 'codex' && record.type === 'response_item') {
    const payload = record.payload;
    if (payload?.type === 'function_call') {
      const args = parseArguments(payload.arguments);
      return [{ type: 'call', id: payload.call_id, name: payload.name, command: args?.cmd ?? args?.command }];
    }
    if (payload?.type === 'function_call_output') return [{ type: 'result', id: payload.call_id }];
  }
  if (raw.sourceKind === 'claude-code'
      && ['assistant', 'user'].includes(record.type)
      && Array.isArray(record.message?.content)) {
    return record.message.content.map((block) => {
      if (record.type === 'assistant' && block?.type === 'tool_use') {
        return { type: 'call', id: block.id, name: block.name, command: block.input?.command };
      }
      if (record.type === 'user' && block?.type === 'tool_result') return { type: 'result', id: block.tool_use_id };
      return { type: 'other' };
    });
  }
  return [];
}

function sessionFacts(session) {
  const cached = SESSION_FACTS.get(session);
  if (cached) return cached;
  const raws = session.rawEvents || [];
  const rawById = new Map(raws.map((raw) => [raw.rawId, raw]));
  const entriesByRawId = new Map();
  const calls = new Map();
  for (const raw of raws) {
    const entries = entriesForRaw(raw);
    entriesByRawId.set(raw.rawId, entries);
    for (const entry of entries) {
      if (entry.type !== 'call' || typeof entry.id !== 'string' || !entry.id) continue;
      const matches = calls.get(entry.id) || [];
      matches.push({ ...entry, rawId: raw.rawId });
      calls.set(entry.id, matches);
    }
  }
  const facts = { rawById, entriesByRawId, calls };
  SESSION_FACTS.set(session, facts);
  return facts;
}

function classifyRetrievalArtifact(session, event, layer = 'main') {
  if (!session || !event || event.kind === 'code_mode_operation') return UNKNOWN;
  const { rawById, entriesByRawId, calls } = sessionFacts(session);
  const isRaw = layer === 'raw';
  const owned = isRaw ? [rawById.get(event.rawId || event.id) || event]
    : (event.rawRefs || []).map((ref) => rawById.get(ref.rawId)).filter(Boolean);
  if (!owned.length) return UNKNOWN;
  if (!isRaw && !COMMAND_TOOLS.has(event.toolName)) return UNKNOWN;

  // A result is only attributed through one explicit, unambiguous source call.
  let entries = owned.flatMap((raw) => entriesByRawId.get(raw.rawId) || []);
  if (!isRaw && event.callId) {
    // Claude logical operations can own one block in a shared raw envelope.
    entries = entries.filter((entry) => entry.id === event.callId);
  }
  if (!entries.length || entries.some((entry) => !['call', 'result'].includes(entry.type))) return UNKNOWN;
  const operationNames = new Set();
  for (const entry of entries) {
    const matches = calls.get(entry.id);
    if (!matches || matches.length !== 1) return UNKNOWN;
    const call = matches[0];
    if (!COMMAND_TOOLS.has(call.name)) return UNKNOWN;
    const operation = recognizedOperation(call.command);
    if (!operation) return UNKNOWN;
    if (!isRaw && !owned.some((raw) => raw.rawId === call.rawId)) return UNKNOWN;
    operationNames.add(operation);
  }
  return { recognized: true, reason: `direct_history_invocation:${[...operationNames].sort().join(',')}` };
}

// A cheap broad hint only. It never authorizes exclusion without the structured
// classifier above; paired raw outputs often have no command text whatsoever.
function mayContainRetrievalArtifact(row) {
  return COMMAND_TOOLS.has(row?.toolName)
    || ['function_call', 'function_call_output', 'tool_use', 'tool_result'].includes(row?.payloadType)
    || (row?.recordType === 'user' || row?.recordType === 'assistant');
}

module.exports = { classifyRetrievalArtifact, mayContainRetrievalArtifact };
