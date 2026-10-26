'use strict';

const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { createEmptyMaterializedPresentationIndexes } = require('./canonical-contract');
const { sanitizeLogicalDetailValue, redactEmbeddedDataUrls } = require('./shared/logical-detail-sanitizer');
const { projectSearchJson } = require('./search-json');

const { nativeTool } = require('./pi-native-tools');
const { sanitizePiImageRecord } = require('./pi-images');
const SOURCE_KIND = 'pi';
const searchPolicy = {
  opaqueTypes: new Set(['image', 'audio', 'image_url', 'input_image', 'output_image']),
  excludedKeys: new Set(['signature', 'thoughtSignature', 'thinkingSignature', 'textSignature', 'encrypted_content', 'base64']),
  redactString: redactEmbeddedDataUrls,
};
const string = (value) => typeof value === 'string' ? value : '';
// Search projects the original JSON iteratively. Cached display evidence has a
// depth limit so extension data cannot exhaust the recursive sanitizer's stack.
const safe = (value) => sanitizeLogicalDetailValue(value, { maxDepth: 32 });
const search = (value) => projectSearchJson(value, searchPolicy);
const preview = (value) => redactEmbeddedDataUrls(string(value)).trim().slice(0, 240);
// Encode UTF-16 code units so separators and even malformed surrogate strings
// cannot alias another source identity. Ordinary UUID/entry ids stay readable.
const identityPart = (value) => string(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `%${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
function iso(value) {
  // Date coercion can recurse through untrusted arrays or invoke malformed
  // conversion properties. Only native scalar timestamp forms are supported.
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) ? date.toISOString() : '';
}
function lastRecordedTimestamp(rows, fallback) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const timestamp = iso(rows[i].parsed?.timestamp);
    if (timestamp) return timestamp;
  }
  return iso(fallback);
}
function blocks(content) { return Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : []; }
function contentText(content) { return blocks(content).filter((b) => b?.type === 'text').map((b) => string(b.text)).join('\n'); }
function piRawRef(raw) { return { file: raw.source.file, line: raw.source.line, rawId: raw.rawId,
  sourceLocator: raw.sourceLocator, sourceRecordType: raw.recordType, sourceEventType: raw.payloadType }; }
function makeRaw(row, session) {
  const record = row.parsed || {};
  const message = record.message || {};
  const source = { file: session.sourceFile, line: row.line };
  // Broken JSON cannot reliably separate readable text from signatures/media.
  // Keep its bytes exclusively in explicit Raw readback, never in search/snippets.
  const text = row.parseError ? 'Malformed JSON record (content available in Raw)' : search(record);
  return {
    rawId: `${session.id}:raw:${row.line}`, sessionId: session.id, sourceKind: SOURCE_KIND,
    sourceSessionId: session.sourceSessionId, source, sourceLocator: { type: 'jsonl_line', ...source },
    line: row.line, rawIndex: row.line, timestamp: iso(record.timestamp ?? message.timestamp),
    recordType: row.parseError ? 'malformed' : string(record.type) || 'unknown',
    payloadType: row.parseError ? 'malformed_json' : string(message.role) || string(record.type) || 'unknown',
    role: string(message.role), turnId: '', callId: string(message.toolCallId), toolName: string(message.toolName),
    preview: preview(contentText(message.content) || string(record.summary) || text),
    messageText: safe(contentText(message.content)), searchText: text, parsed: safe(sanitizePiImageRecord(row.parsed)),
    parseError: row.parseError, entryId: string(record.id),
    // Invalid parent values remain in parsed/physical Raw, never in a scalar
    // context field that Detail will coerce to a string.
    parentId: typeof record.parentId === 'string' ? record.parentId
      : record.parentId == null ? null : '[invalid parent id; see raw refs]',
    touchedFiles: [],
  };
}
function eventFor(session, raw, suffix, fields) {
  const refs = fields.rawRefs || [piRawRef(raw)];
  const event = {
    id: `${session.id}:event:${raw.line}:${suffix}`, schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: SOURCE_KIND,
    timestamp: raw.timestamp, turnId: raw.turnId, kind: 'event', subtype: '', layer: 'main', role: '', label: '',
    preview: '', searchText: '', severity: 'normal', status: '', toolName: '', touchedFiles: [], outputStats: {},
    tokenUsage: [], usageLimits: [], channels: [], tags: [], hasLongOutput: false, hasReadableReasoning: false,
    ...fields, rawRefs: refs, source: refs[0], sourceLocator: refs[0].sourceLocator,
  };
  event.preview = preview(event.preview);
  event.hasLongOutput = event.searchText.length > 1600;
  return event;
}
function protocol(session, raw, subtype, text = raw.preview, fields = {}) {
  return eventFor(session, raw, subtype, { kind: 'protocol', layer: 'protocol', subtype,
    preview: text, searchText: raw.searchText, ...fields });
}
function emptyCounts() {
  return Object.fromEntries(['turns', 'messages', 'userMessages', 'assistantMessages', 'reasoning', 'toolCalls',
    'failedCommands', 'issueEvents', 'patches', 'compactions', 'aborts', 'errors', 'protocol', 'planArtifacts', 'planEvents'].map((k) => [k, 0]));
}
function summarize(session) {
  const counts = emptyCounts();
  const tools = new Map(); const kinds = new Map(); const protocols = new Map(); const turns = new Set();
  const failedCommands = []; const patchCounts = new Map();
  for (const event of session.logicalEvents) {
    if (event.turnId) turns.add(event.turnId);
    if (event.layer === 'protocol') { counts.protocol++; protocols.set(event.subtype, (protocols.get(event.subtype) || 0) + 1); }
    else {
      kinds.set(event.kind, (kinds.get(event.kind) || 0) + 1);
      if (event.kind === 'user_message') { counts.messages++; counts.userMessages++; }
      if (event.kind === 'assistant_message') { counts.messages++; counts.assistantMessages++; }
      if (event.kind === 'reasoning') counts.reasoning++;
      if (event.kind === 'compaction') counts.compactions++;
      if (event.kind === 'abort') counts.aborts++;
      if (event.kind === 'error') counts.errors++;
      if (event.kind === 'patch') {
        counts.patches++;
        for (const file of event.touchedFiles) patchCounts.set(file, (patchCounts.get(file) || 0) + 1);
      }
      if (['command', 'other_tool_call', 'patch'].includes(event.kind)) {
        counts.toolCalls++;
        if (event.toolName) tools.set(event.toolName, (tools.get(event.toolName) || 0) + 1);
        if (event.kind === 'command' && event.status === 'failed') {
          counts.failedCommands++;
          failedCommands.push({ id: event.id, timestamp: event.timestamp, command: event.preview,
            status: event.status, exitCode: event.outputStats.exitCode ?? null, durationMs: event.outputStats.durationMs || 0, source: event.source });
        }
      }
    }
    if (event.status === 'failed' || event.severity !== 'normal') counts.issueEvents++;
  }
  counts.turns = turns.size;
  session.counts = counts;
  session.rawEventCount = session.rawEvents.length; session.logicalEventCount = session.logicalEvents.length;
  const rows = (map) => [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  session.analysis = { sessionId: session.id, title: session.title, counts, toolUsage: rows(tools),
    failedCommands, slowCommands: [], patchedFiles: [...patchCounts].map(([file, count]) => ({ file, count })), tokenStats: { maxObserved: 0 }, timelineStats: rows(kinds), protocolStats: rows(protocols) };
  session.summary = { topTools: session.analysis.toolUsage.slice(0, 5), failedCommandCount: failedCommands.length,
    patchedFiles: session.analysis.patchedFiles.slice(0, 10), protocolCount: counts.protocol };
  return session;
}

function makeSession(document, sourceFile, leafId, selectedRows, invalidTree) {
  const header = document.header;
  const branchName = leafId || 'empty';
  const session = {
    id: `pi:${identityPart(header.id)}:${identityPart(branchName)}`, sourceKind: SOURCE_KIND, sourceSessionId: header.id,
    sourceDerivedId: branchName, sourceClientVersion: '', projectAssociation: header.cwd, sourceFile,
    title: '', agentNickname: '', primarySessionMetaKind: '', derivedRunId: '',
    startedAt: iso(header.timestamp), updatedAt: lastRecordedTimestamp(selectedRows, header.timestamp),
    bytes: document.acceptedBytes, lineCount: document.lines.length, cwdSet: header.cwd ? [header.cwd] : [],
    counts: emptyCounts(), rawEventCount: 0, logicalEventCount: 0,
    parentSessionId: '', forkedFromSessionId: '', forkStorageMode: '', forkedAt: '', forkPointUuid: '',
    forkContinuationState: '', supersededBySessionId: '', supersededAt: '', supersededReason: '',
    parentSessionInferred: false, forkEvidence: null, inheritedContext: null,
    summary: { topTools: [], failedCommandCount: 0, patchedFiles: [], protocolCount: 0 },
    rawEvents: [], logicalEvents: [], analysis: null, presentationIndexes: createEmptyMaterializedPresentationIndexes(),
  };
  const rows = [document.rows[0], ...selectedRows].sort((a, b) => a.line - b.line);
  session.rawEvents = rows.map((row) => makeRaw(row, session));
  const byLine = new Map(session.rawEvents.map((raw) => [raw.line, raw]));
  const headerRaw = session.rawEvents[0];
  const branchNotice = invalidTree ? 'Invalid pi entry tree: records are shown as Protocol evidence without inferred conversation order.'
    : `Branch ${branchName}${branchName === document.resumedLeafId ? ' (last persisted branch)' : ''}. Root-to-leaf history; shared ancestry also appears in other branch sessions.`;
  session.logicalEvents.push(protocol(session, headerRaw, 'pi_branch', branchNotice,
    { label: 'pi branch', pi: { text: branchNotice, leafId: branchName, resumedLeafId: document.resumedLeafId,
      parentSession: string(header.parentSession), branchCount: document.leaves.length, invalidTree } }));

  const calls = new Map(); const results = new Map();
  if (!invalidTree) for (const row of selectedRows) {
    const message = row.parsed?.type === 'message' ? row.parsed.message : null;
    if (message?.role === 'assistant') for (const [blockIndex, block] of blocks(message.content).entries()) {
      if (block?.type !== 'toolCall' || !string(block.id)) continue;
      const list = calls.get(block.id) || []; list.push({ row, block, blockIndex }); calls.set(block.id, list);
    }
    if (message?.role === 'toolResult' && string(message.toolCallId)) {
      const list = results.get(message.toolCallId) || []; list.push(row); results.set(message.toolCallId, list);
    }
  }
  const consumedResults = new Set();
  let turnId = '';
  for (const row of selectedRows) {
    const raw = byLine.get(row.line); const entry = row.parsed; const message = entry?.message;
    if (entry?.type === 'message' && message?.role === 'user') turnId = string(entry.id);
    raw.turnId = turnId;
    if (invalidTree || !entry || typeof entry !== 'object' || !string(entry.id)) {
      session.logicalEvents.push(protocol(session, raw, invalidTree ? 'pi_invalid_tree' : raw.payloadType)); continue;
    }
    if (entry.type === 'message' && ['assistant', 'user'].includes(message?.role)) {
      let projected = false;
      for (const [blockIndex, block] of blocks(message.content).entries()) {
        const suffix = `block:${blockIndex}`;
        if (block?.type === 'text' || (block?.type === 'thinking' && message.role === 'assistant')) {
          const text = safe(string(block.type === 'thinking' ? block.thinking : block.text));
          if (!text) continue;
          projected = true;
          session.logicalEvents.push(eventFor(session, raw, suffix, { kind: block.type === 'thinking' ? 'reasoning' : `${message.role}_message`,
            role: message.role, preview: text, searchText: text, hasReadableReasoning: block.type === 'thinking',
            pi: { text, blockIndex, model: string(message.model), provider: string(message.provider) } }));
        } else if (block?.type === 'image') {
          projected = true;
          // Keep the previous image-event identity while making saved message
          // media discoverable in Main at its original content-block position.
          const subtype = `pi_content_image_${blockIndex}`;
          session.logicalEvents.push(eventFor(session, raw, subtype, { kind: `${message.role}_message`, subtype,
            role: message.role, preview: 'Saved image', searchText: '',
            pi: { blockIndex, model: string(message.model), provider: string(message.provider) } }));
        } else if (block?.type === 'toolCall' && message.role === 'assistant') {
          projected = true;
          const matchingCalls = calls.get(block.id) || []; const matchingResults = results.get(block.id) || [];
          const resultRow = matchingCalls.length === 1 && matchingResults.length === 1
            && matchingResults[0].line > row.line
            && matchingResults[0].parsed.message.toolName === block.name ? matchingResults[0] : null;
          const result = resultRow?.parsed.message;
          if (resultRow) consumedResults.add(resultRow.line);
          const name = string(block.name); const args = block.arguments;

          const output = safe(contentText(result?.content));
          const status = result ? (result.isError === true ? 'failed' : result.isError === false ? 'success' : 'incomplete')
            : block.argumentsError ? 'failed' : 'incomplete';
          const native = block.argumentsError ? null : nativeTool(name, args, result, status);
          const command = native?.command || '';
          const touchedFiles = native?.path ? [native.path] : [];
          const pairedRaw = resultRow ? byLine.get(resultRow.line) : null;
          const refs = pairedRaw ? [piRawRef(raw), piRawRef(pairedRaw)] : [piRawRef(raw)];
          session.logicalEvents.push(eventFor(session, raw, suffix, { kind: native?.patch ? 'patch' : native?.command !== undefined ? 'command' : 'other_tool_call',
            toolName: name, label: native?.patch ? 'Patch applied' : '', preview: native?.preview || command || `${name} ${search(args)}`, status,
            severity: status === 'failed' ? 'error' : 'normal', touchedFiles: safe(touchedFiles),
            searchText: [name, search(args), string(block.argumentsError), output,
              native?.patch ? search(result.details.patch) : '', result?.nestedCalls ? search(result.nestedCalls) : ''].join('\n'),
            rawRefs: refs, outputStats: { durationMs: Number.isFinite(result?.durationMs) && result.durationMs >= 0 ? result.durationMs : 0 },
            pi: { callId: string(block.id), blockIndex, arguments: safe(args ?? null), command: safe(command), output,
              nativeActivity: native?.activity || '', commandLanguage: native?.language || '', patch: safe(native?.patch ?? null),
              argumentsError: safe(string(block.argumentsError)), pairing: result ? 'exact_id_ancestor' : 'missing_or_ambiguous_result',
              nestedCalls: safe(result?.nestedCalls ?? null) } }));
        } else {
          projected = true;
          session.logicalEvents.push(protocol(session, raw, `pi_content_${string(block?.type) || 'unknown'}_${blockIndex}`,
            block?.type === 'image' ? 'Image content (payload available in Raw)' : 'Unmodeled content block'));
        }
      }
      if (!projected) session.logicalEvents.push(protocol(session, raw, 'pi_empty_message'));
      if (message.role === 'assistant' && (message.stopReason === 'error' || message.stopReason === 'aborted')) session.logicalEvents.push(eventFor(session, raw, 'termination', {
        kind: message.stopReason === 'aborted' ? 'abort' : 'error', status: 'failed', severity: 'error',
        preview: string(message.errorMessage) || message.stopReason, searchText: safe(string(message.errorMessage)),
        pi: { text: safe(string(message.errorMessage) || message.stopReason) },
      }));
      if (message.role === 'assistant' && message.usage) session.logicalEvents.push(protocol(session, raw, 'pi_usage', 'Recorded assistant usage', { pi: { usage: safe(message.usage) } }));
      if (message.role === 'user' && ['stopReason', 'errorMessage', 'usage'].some((key) => Object.hasOwn(message, key))) {
        session.logicalEvents.push(protocol(session, raw, 'pi_unmodeled_user_fields', 'Unmodeled user message fields'));
      }
    } else if (entry.type === 'message' && message?.role === 'toolResult') {
      if (!consumedResults.has(row.line)) session.logicalEvents.push(protocol(session, raw, 'pi_unpaired_tool_result', 'Tool result without a unique ancestor call'));
    } else if (entry.type === 'message' && message?.role === 'bashExecution') {
      const status = message.cancelled === true ? 'cancelled' : Number.isInteger(message.exitCode) ? (message.exitCode === 0 ? 'success' : 'failed') : 'incomplete';
      session.logicalEvents.push(eventFor(session, raw, 'bash', { kind: 'command', subtype: 'pi_bash_execution', toolName: 'bash',
        status, severity: status === 'failed' ? 'error' : 'normal', preview: string(message.command), searchText: search(message),
        outputStats: { exitCode: Number.isInteger(message.exitCode) ? message.exitCode : null },
        pi: { command: safe(string(message.command)), output: safe(string(message.output)), cancelled: message.cancelled === true,
          truncated: message.truncated === true, excludeFromContext: message.excludeFromContext === true,
          fullOutputPath: safe(string(message.fullOutputPath)) } }));
    } else if (entry.type === 'message' && message?.role === 'system') {
      session.logicalEvents.push(protocol(session, raw, 'pi_system', 'Recorded system prompt and tool changes'));
    } else if (entry.type === 'model_change') {
      session.logicalEvents.push(protocol(session, raw, 'pi_model_change', `Recorded model selection: ${string(entry.provider)} / ${string(entry.modelId)}`));
    } else if (entry.type === 'thinking_level_change') {
      session.logicalEvents.push(protocol(session, raw, 'pi_thinking_level_change', `Recorded thinking selection: ${string(entry.thinkingLevel)}`));
    } else if (entry.type === 'usage') {
      session.logicalEvents.push(protocol(session, raw, 'pi_usage', `Recorded usage: ${string(entry.kind) || 'unspecified category'}`));
    } else if (entry.type === 'compaction') {
      session.logicalEvents.push(eventFor(session, raw, 'compaction', { kind: 'compaction', preview: string(entry.summary),
        searchText: raw.searchText, pi: { text: safe(string(entry.summary)), firstKeptEntryId: string(entry.firstKeptEntryId),
          tokensBefore: entry.tokensBefore ?? null, fromHook: entry.fromHook === true } }));
    } else if (entry.type === 'branch_summary') {
      session.logicalEvents.push(protocol(session, raw, 'pi_branch_summary', string(entry.summary), {
        pi: { text: safe(string(entry.summary)), fromId: string(entry.fromId) } }));
    } else if (entry.type === 'context_edit') {
      const target = document.byId.get(entry.targetId);
      const onBranch = selectedRows.includes(target) && target?.line < row.line;
      session.logicalEvents.push(protocol(session, raw, 'pi_context_edit',
        `Context edit: ${entry.replacement === null ? 'omit' : 'replace content'} of ${string(entry.targetId)}${onBranch ? '' : ' (unresolved target)'}`, {
          // Reuse the cached display record's image/depth sanitization.
          pi: { targetId: string(entry.targetId), targetOnBranch: onBranch, replacement: raw.parsed.replacement ?? null,
            text: 'This append-only record changes model context. The original transcript remains visible.' } }));
    } else if (entry.type === 'custom_message' || (entry.type === 'message' && message?.role === 'custom')) {
      const custom = entry.type === 'custom_message' ? entry : message;
      session.logicalEvents.push(protocol(session, raw, 'pi_custom_message', contentText(custom.content), {
        pi: { text: safe(contentText(custom.content)), customType: string(custom.customType), display: custom.display === true } }));
    } else session.logicalEvents.push(protocol(session, raw, `pi_${string(entry.type) || 'unknown'}`));
  }
  const name = [...selectedRows].reverse().find((row) => row.parsed?.type === 'session_info' && typeof row.parsed.name === 'string')?.parsed.name;
  const firstUser = session.logicalEvents.find((event) => event.kind === 'user_message');
  session.title = safe(`[branch ${branchName}${branchName === document.resumedLeafId ? ' · latest' : ''}] ${name || firstUser?.preview || 'pi session'}`).slice(0, 240);
  return summarize(session);
}

function* iteratePiSessions(document, sourceFile, requestedLeafId) {
  if (document.invalidTree) {
    if (!requestedLeafId || requestedLeafId === 'invalid-tree') yield makeSession(document, sourceFile, 'invalid-tree', document.entries, true);
    return;
  }
  const loose = document.entries.filter((row) => !row.parsed || !string(row.parsed.id));
  const leaves = document.leaves.length ? document.leaves : [{ parsed: { id: 'empty' } }];
  for (const leaf of leaves) {
    if (requestedLeafId && leaf.parsed.id !== requestedLeafId) continue;
    const selected = [];
    for (let row = document.byId.get(leaf.parsed.id); row; row = document.byId.get(row.parsed.parentId)) selected.push(row);
    selected.push(...loose); selected.sort((a, b) => a.line - b.line);
    yield makeSession(document, sourceFile, leaf.parsed.id, selected, false);
  }
}

function sessionsFromPiDocument(document, sourceFile, requestedLeafId) {
  return [...iteratePiSessions(document, sourceFile, requestedLeafId)];
}

module.exports = { SOURCE_KIND, contentText, emptyCounts, iso, lastRecordedTimestamp, piRawRef, search, iteratePiSessions, sessionsFromPiDocument, sanitizePiValue: safe };
