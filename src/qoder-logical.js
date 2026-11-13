'use strict';

const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { createEmptyMaterializedPresentationIndexes, INDEXED_SESSION_COUNT_FIELDS } = require('./canonical-contract');
const { sanitizeLogicalDetailValue, redactEmbeddedDataUrls, EMBEDDED_BASE64_MARKER } = require('./shared/logical-detail-sanitizer');
const { projectSearchJson } = require('./search-json');
const { fsPathApi } = require('./shared/fs-path');

const string = (value) => typeof value === 'string' ? value : '';
const object = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identityPart = (value) => string(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const preview = (value) => redactEmbeddedDataUrls(string(value)).trim().slice(0, 240);
const MEDIA_TYPES = new Set(['image', 'input_image', 'output_image', 'audio', 'input_audio', 'base64']);
const OMIT_KEYS = new Set(['signature', 'thinkingSignature', 'encrypted_content']);
const FILE_ACTIVITIES = new Map([['Read', 'read'], ['Write', 'write'], ['Edit', 'edit'], ['DeleteFile', 'delete']]);
const searchPolicy = { opaqueTypes: MEDIA_TYPES, excludedKeys: OMIT_KEYS, redactString: redactEmbeddedDataUrls };
const search = (value) => projectSearchJson(value, searchPolicy);

function iso(value) {
  if (!['string', 'number'].includes(typeof value)) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
function textOf(value, types = ['text']) {
  if (typeof value === 'string') return value;
  const blocks = Array.isArray(value) ? value : object(value) ? [value] : [];
  return blocks.filter((block) => object(block) && types.includes(block.type) && typeof block.text === 'string')
    .map((block) => block.text).join('\n');
}
function sanitizeQoderValue(value) {
  const result = sanitizeLogicalDetailValue(value, { maxDepth: 24, maxNodes: 2_000, maxArrayItems: 128,
    maxObjectEntries: 128, maxStringChars: 100_000, maxTotalStringChars: 160_000, omitObjectKeys: OMIT_KEYS });
  // The generic sanitizer handles native {type: "base64", data}. Also omit
  // opaque image payloads when a future/invalid source discriminator appears.
  const pending = [result];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    if (MEDIA_TYPES.has(item.type)) {
      for (const key of ['data', 'base64', 'bytes']) if (Object.hasOwn(item, key)) item[key] = EMBEDDED_BASE64_MARKER;
      if (object(item.source)) for (const key of ['data', 'base64', 'bytes']) {
        if (Object.hasOwn(item.source, key)) item.source[key] = EMBEDDED_BASE64_MARKER;
      }
    }
    for (const child of Object.values(item)) if (child && typeof child === 'object') pending.push(child);
  }
  return result;
}
const safe = sanitizeQoderValue;

function qoderRawRef(raw) {
  return { file: raw.source.file, line: raw.source.line, rawId: raw.rawId, sourceLocator: raw.sourceLocator,
    sourceRecordType: raw.recordType, sourceEventType: raw.payloadType };
}
function eventFor(session, raw, suffix, fields) {
  const rawRefs = fields.rawRefs || [qoderRawRef(raw)];
  const qoder = { model: string(raw.parsed?.message?.model), ...fields.qoder };
  if (fields.kind === 'user_message' && session.parentSessionId) {
    fields = { ...fields, label: 'Subagent input' };
    qoder.inputScope = 'subagent';
  }
  return { id: `${session.id}:event:${raw.line}:${suffix}`, schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: 'qoder',
    timestamp: raw.timestamp, turnId: raw.turnId, kind: 'event', subtype: '', layer: 'main', role: '', label: '', preview: '', searchText: '',
    severity: 'normal', status: '', toolName: '', touchedFiles: [], outputStats: {}, tokenUsage: [], usageLimits: [], channels: [], tags: [],
    hasLongOutput: (fields.searchText || '').length > 1_600, hasReadableReasoning: false, ...fields, qoder,
    preview: preview(fields.preview), rawRefs, source: rawRefs[0], sourceLocator: rawRefs[0].sourceLocator };
}
function protocol(session, raw, subtype = raw.payloadType, label = raw.preview, facts = {}) {
  return eventFor(session, raw, subtype, { kind: 'protocol', layer: 'protocol', subtype, role: raw.role,
    preview: label, searchText: raw.searchText, qoder: { text: safe(label), ...facts } });
}
function messageBlocks(row) {
  if (!object(row.message)) return [];
  return typeof row.message.content === 'string' ? [{ type: 'text', text: row.message.content }]
    : Array.isArray(row.message.content) ? row.message.content : [];
}
function identified(row) {
  return object(row) && Boolean(string(row.uuid)) && (row.parentUuid === null || row.parentUuid === undefined || typeof row.parentUuid === 'string');
}
function classifyMessage(row) {
  const fallback = { kind: 'protocol', startsTurn: false, titleEligible: false };
  if (!identified(row) || !['user', 'assistant'].includes(row.type) || row.message?.role !== row.type) return fallback;
  if (['isMeta', 'isCompactSummary', 'isVisibleInTranscriptOnly', 'isApiErrorMessage', 'aborted'].some((key) => row[key] !== undefined && typeof row[key] !== 'boolean')) return fallback;
  if (row.isCompactSummary === true) return { ...fallback, kind: 'compaction' };
  if (row.isMeta === true || row.isVisibleInTranscriptOnly === true) return { ...fallback, subtype: 'qoder_meta_message' };
  if (row.type === 'user' && row.origin !== undefined && (!object(row.origin) || row.origin.kind !== 'human')) {
    return { ...fallback, subtype: 'qoder_runtime_input' };
  }
  if (row.type === 'assistant') return { ...fallback, kind: row.isApiErrorMessage === true ? 'error' : 'assistant_message' };
  const blocks = messageBlocks(row);
  if (blocks.some((block) => block?.type === 'tool_result')) return { ...fallback, kind: 'tool_results' };
  if (!blocks.some((block) => object(block) && ((block.type === 'text' && typeof block.text === 'string') || nativeImage(block)))) return fallback;
  return { kind: 'user_message', startsTurn: true, titleEligible: true };
}
function nativeImage(block) {
  return object(block) && block.type === 'image' && object(block.source)
    && ['base64', 'file', 'url'].includes(block.source.type)
    && (typeof block.source.data === 'string' || typeof block.source.path === 'string' || typeof block.source.url === 'string');
}
function nativeTool(block) {
  const args = object(block.input) && !Object.hasOwn(block.input, '__qoder_unparsed_tool_input') ? block.input : null;
  const result = { arguments: args, activity: '', command: '', paths: [] };
  if (!args) return result;
  const name = block.name;
  if (name === 'Bash' && typeof args.command === 'string') return { ...result, activity: 'command', command: args.command };
  const activity = FILE_ACTIVITIES.get(name);
  if (activity && typeof args.file_path === 'string' && args.file_path) return { ...result, activity, paths: [args.file_path] };
  if (['Grep', 'Glob', 'SearchCodebase', 'SearchKnowledge', 'SearchMemory'].includes(name)) return { ...result, activity: 'search' };
  if ((name === 'TodoWrite' && Array.isArray(args.todos)) || ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'EnterPlanMode', 'ExitPlanMode'].includes(name)) return { ...result, activity: 'plan' };
  if (name === 'UpdateGoal') return { ...result, activity: 'goal' };
  if (['Agent', 'TaskStop'].includes(name)) return { ...result, activity: 'coordination' };
  if (name === 'AskUserQuestion' && Array.isArray(args.questions)) return { ...result, activity: 'question' };
  if (['WebFetch', 'WebSearch'].includes(name)) return { ...result, activity: 'web' };
  if (name === 'GetTerminalOutput') return { ...result, activity: 'terminal' };
  return result;
}

function toolOutcome(name, result, row) {
  if (!result) return { status: 'incomplete', outputStats: {}, resultStatus: '' };
  const receipt = object(row.toolUseResult) ? row.toolUseResult : {};
  const resultStatus = string(receipt.status) || string(receipt.state) || string(receipt.kind);
  const exitCode = name === 'Bash' && Number.isInteger(receipt.exitCode) ? receipt.exitCode : null;
  const outputStats = { ...(exitCode !== null ? { exitCode } : {}) };
  const failed = result.is_error === true || receipt.isError === true || receipt.isHardFailure === true
    || receipt.success === false || Boolean(string(receipt.apiError)) || (name === 'Agent' && receipt.state === 'error')
    || (exitCode !== null && exitCode !== 0);
  // Background launch receipts establish a launch, not process/agent completion.
  // Cancellation is separately recorded and must not become a success simply
  // because an exit code was omitted.
  const cancelled = receipt.status === 'cancelled' || receipt.kind === 'cancelled';
  const unfinished = receipt.isAsync === true || receipt.status === 'async_launched'
    || (name === 'Bash' && string(receipt.taskId) && exitCode === null)
    || receipt.interrupted === true;
  return { status: cancelled ? 'incomplete' : failed ? 'failed' : unfinished ? 'incomplete' : 'success', outputStats, resultStatus };
}

function summarize(session) {
  const counts = Object.fromEntries(INDEXED_SESSION_COUNT_FIELDS.map((name) => [name, 0]));
  const tools = new Map(); const kinds = new Map(); const protocols = new Map(); const turns = new Set(); const messages = new Set();
  const failedCommands = []; const changedFiles = new Map();
  for (const event of session.logicalEvents) {
    if (event.turnId) turns.add(event.turnId);
    if (event.layer === 'protocol') { counts.protocol++; protocols.set(event.subtype, (protocols.get(event.subtype) || 0) + 1); continue; }
    kinds.set(event.kind, (kinds.get(event.kind) || 0) + 1);
    if (['user_message', 'assistant_message'].includes(event.kind) && !messages.has(event.source.rawId)) {
      messages.add(event.source.rawId); counts.messages++;
      if (event.kind === 'user_message') counts.userMessages++; else counts.assistantMessages++;
    }
    if (event.kind === 'reasoning') counts.reasoning++;
    if (event.kind === 'compaction') counts.compactions++;
    if (event.kind === 'error') counts.errors++;
    if (event.kind === 'abort') counts.aborts++;
    if (event.toolName) { counts.toolCalls++; tools.set(event.toolName, (tools.get(event.toolName) || 0) + 1); }
    if (event.qoder?.activity === 'plan') counts.planEvents++;
    if (event.status === 'failed') {
      counts.issueEvents++;
      if (event.kind === 'command') { counts.failedCommands++; failedCommands.push({ id: event.id, timestamp: event.timestamp,
        command: event.preview, status: event.status, exitCode: event.outputStats.exitCode ?? null, durationMs: 0, source: event.source }); }
    }
    if (event.status === 'success' && ['write', 'edit', 'delete'].includes(event.qoder?.activity)) {
      counts.patches++;
      for (const file of event.touchedFiles) changedFiles.set(file, (changedFiles.get(file) || 0) + 1);
    }
  }
  counts.turns = turns.size;
  session.counts = counts; session.rawEventCount = session.rawEvents.length; session.logicalEventCount = session.logicalEvents.length;
  const rows = (map) => [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const patchedFiles = [...changedFiles].map(([file, count]) => ({ file, count })).sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  session.analysis = { sessionId: session.id, title: session.title, counts, toolUsage: rows(tools), failedCommands, slowCommands: [], patchedFiles,
    tokenStats: { maxObserved: 0 }, timelineStats: rows(kinds), protocolStats: rows(protocols) };
  session.summary = { topTools: session.analysis.toolUsage.slice(0, 5), failedCommandCount: counts.failedCommands,
    patchedFiles: patchedFiles.slice(0, 5), protocolCount: counts.protocol };
  return session;
}

function makeQoderSession(document, sourceFile, desktopTitle) {
  const session = { id: `qoder:${identityPart(sourceFile)}`, sourceKind: 'qoder', sourceSessionId: document.id,
    sourceDerivedId: '', sourceClientVersion: '', projectAssociation: document.cwd, sourceFile, title: '', agentNickname: '',
    primarySessionMetaKind: '', derivedRunId: '', startedAt: '', updatedAt: '', bytes: document.acceptedBytes, lineCount: document.lines.length,
    cwdSet: [...new Set(document.rows.map((row) => string(row.parsed?.cwd)).filter((cwd) => cwd && fsPathApi(cwd).isAbsolute(cwd)))],
    counts: {}, rawEventCount: 0, logicalEventCount: 0, parentSessionId: '', forkedFromSessionId: '', forkStorageMode: '', forkedAt: '',
    forkPointUuid: '', forkContinuationState: '', supersededBySessionId: '', supersededAt: '', supersededReason: '', parentSessionInferred: false,
    forkEvidence: null, inheritedContext: null, summary: { topTools: [], failedCommandCount: 0, patchedFiles: [], protocolCount: 0 },
    rawEvents: [], logicalEvents: [], analysis: null, presentationIndexes: createEmptyMaterializedPresentationIndexes() };
  const location = sourceFile.split('/');
  if (location.length === 4 && location[2] === 'subagents' && /^agent-.+\.jsonl$/.test(location[3])) {
    session.primarySessionMetaKind = 'subagent';
    session.sourceDerivedId = document.id;
    session.parentSessionId = `qoder:${identityPart(`${location[0]}/${location[1]}.jsonl`)}`;
  }
  const rows = document.rows.map((row) => object(row.parsed) ? row.parsed : {});
  const classes = rows.map(classifyMessage);
  const ids = new Map(); const calls = new Map(); const results = new Map();
  function add(map, key, value) { const values = map.get(key) || []; values.push(value); map.set(key, values); }
  rows.forEach((row, index) => { if (string(row.uuid)) add(ids, row.uuid, index); });
  const turnIds = [];
  session.rawEvents = document.rows.map((entry, index) => {
    const row = rows[index];
    const parent = ids.get(string(row.parentUuid));
    const parentIndex = parent?.length === 1 && parent[0] < index ? parent[0] : -1;
    // Physical order is the archival display order; turn ownership follows the
    // uniquely recorded earlier parent and never crosses to a sibling branch.
    const turnId = classes[index].startsTurn ? `${row.uuid}:${entry.line}` : parentIndex >= 0 ? turnIds[parentIndex] : '';
    turnIds.push(turnId);
    const source = { file: sourceFile, line: entry.line }; const sourceLocator = { type: 'jsonl_line', ...source };
    const text = entry.parseError ? 'Malformed JSON record (content available in Raw)' : search(row);
    const messageText = textOf(row.message?.content) || string(row.content);
    return { rawId: `${session.id}:raw:${entry.line}`, sessionId: session.id, sourceKind: 'qoder', sourceSessionId: document.id,
      source, sourceLocator, line: entry.line, rawIndex: entry.line, timestamp: iso(row.timestamp),
      recordType: entry.parseError ? 'malformed' : string(row.type) || 'unknown',
      payloadType: entry.parseError ? 'malformed_json' : (row.type === 'system' && string(row.subtype)) || string(row.type) || 'unknown',
      role: string(row.message?.role), turnId, callId: '', toolName: '', preview: preview(messageText || text), messageText: safe(messageText),
      searchText: text, parsed: safe(entry.parsed), parseError: entry.parseError, touchedFiles: [] };
  });
  session.startedAt = session.rawEvents.find((raw) => raw.timestamp)?.timestamp || '';
  session.updatedAt = session.rawEvents.findLast((raw) => raw.timestamp)?.timestamp || '';
  session.sourceClientVersion = rows.findLast((row) => string(row.version))?.version || '';
  if (session.parentSessionId) {
    const agents = [...new Set(rows.map((row) => string(row.agentId)).filter(Boolean))];
    session.sourceDerivedId = agents.length === 1 ? agents[0] : '';
  }
  if (session.rawEvents.length) {
    const archive = protocol(session, session.rawEvents[0], 'qoder_recorded_history',
      'Recorded physical history; earlier branches and active-leaf markers remain visible.');
    archive.searchText = ''; archive.qoder.historyView = 'physical';
    session.logicalEvents.push(archive);
  }

  // Native message UUIDs establish ancestry, while tool_use_id establishes the
  // block identity. Neither visible names nor physical proximity prove pairing.
  rows.forEach((row, rowIndex) => {
    if (!identified(row) || row.message?.role !== row.type || !['user', 'assistant'].includes(row.type)) return;
    for (const [blockIndex, block] of messageBlocks(row).entries()) {
      if (!object(block)) continue;
      if (row.type === 'assistant' && block.type === 'tool_use' && string(block.id) && string(block.name)) add(calls, block.id, { rowIndex, blockIndex, block });
      if (row.type === 'user' && block.type === 'tool_result' && string(block.tool_use_id)) add(results, block.tool_use_id, { rowIndex, blockIndex, block });
    }
  });
  const compactSummaries = new Map();
  rows.forEach((row, index) => {
    if (classes[index].kind !== 'compaction' || row.type !== 'user' || (ids.get(row.uuid) || []).length !== 1) return;
    const parents = ids.get(string(row.parentUuid)) || [];
    if (parents.length !== 1 || parents[0] >= index) return;
    const boundary = rows[parents[0]];
    if (boundary.type === 'system' && boundary.subtype === 'compact_boundary' && boundary.isCompactSummary === true) {
      add(compactSummaries, parents[0], index);
    }
  });
  function ancestorOf(call, result) {
    const uuid = rows[call.rowIndex].uuid;
    if ((ids.get(uuid) || []).length !== 1) return false;
    let position = result.rowIndex; const seen = new Set();
    while (position > call.rowIndex && !seen.has(position)) {
      seen.add(position);
      const parent = string(rows[position].parentUuid);
      if (!parent) return false;
      const candidates = ids.get(parent) || [];
      if (candidates.length !== 1 || candidates[0] >= position) return false;
      position = candidates[0];
      if (parent === uuid) return true;
    }
    return false;
  }
  const consumed = new Set(); const consumedSummaries = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]; const raw = session.rawEvents[index]; const classification = classes[index];
    if (raw.parseError || !string(row.type)) { session.logicalEvents.push(protocol(session, raw)); continue; }
    if (object(row.message?.usage)) session.logicalEvents.push(protocol(session, raw, 'qoder_usage', 'Recorded model usage', { usage: safe(row.message.usage) }));
    if (row.type === 'system' && row.subtype === 'compact_boundary' && row.isCompactSummary === true) {
      const candidates = compactSummaries.get(index) || [];
      const summaryIndex = candidates.length === 1 ? candidates[0] : -1;
      const summary = summaryIndex >= 0 ? textOf(rows[summaryIndex].message?.content) : '';
      const rawRefs = [qoderRawRef(raw)];
      if (summaryIndex >= 0) { rawRefs.push(qoderRawRef(session.rawEvents[summaryIndex])); consumedSummaries.add(summaryIndex); }
      session.logicalEvents.push(eventFor(session, raw, 'compact-boundary', { kind: 'compaction', subtype: 'qoder_compact_boundary',
        preview: summary || string(row.content) || 'Recorded compaction boundary', searchText: [search(row), search(summary)].filter(Boolean).join('\n'), rawRefs,
        qoder: { text: safe(summary || string(row.content)), boundaryText: safe(string(row.content)), summaryPaired: summaryIndex >= 0,
          compactMetadata: safe(row.compactMetadata), compactUsage: safe(row.compactUsage) } }));
      continue;
    }
    if (row.type === 'attachment' && object(row.attachment)) {
      session.logicalEvents.push(protocol(session, raw, `qoder_attachment_${string(row.attachment.type) || 'unknown'}`,
        textOf(row.attachment.content) || string(row.attachment.output) || `Recorded ${string(row.attachment.type) || 'unknown'} attachment`,
        { attachment: safe(row.attachment) }));
      continue;
    }
    if (!['user', 'assistant'].includes(row.type)) { session.logicalEvents.push(protocol(session, raw)); continue; }
    if (classification.kind === 'protocol') {
      session.logicalEvents.push(protocol(session, raw, classification.subtype || 'qoder_unclassified_message',
        textOf(row.message?.content) || 'Unclassified saved message')); continue;
    }
    if (classification.kind === 'compaction') {
      if (consumedSummaries.has(index)) continue;
      session.logicalEvents.push(eventFor(session, raw, 'compact-summary', { kind: 'compaction', subtype: 'qoder_compact_summary',
        preview: textOf(row.message.content) || 'Recorded compaction summary', searchText: search(row.message.content),
        qoder: { text: safe(textOf(row.message.content)), transcriptOnly: row.isVisibleInTranscriptOnly === true } }));
      continue;
    }
    const blocks = messageBlocks(row);
    if (row.type === 'assistant' && row.aborted === true) session.logicalEvents.push(eventFor(session, raw, 'aborted', {
      kind: 'abort', subtype: 'qoder_aborted_message', role: 'assistant', status: 'incomplete', preview: 'Recorded assistant response was aborted',
      searchText: '', qoder: { text: 'Recorded assistant response was aborted' } }));
    if (!blocks.length) { session.logicalEvents.push(protocol(session, raw, 'qoder_empty_message')); continue; }
    for (const [blockIndex, block] of blocks.entries()) {
      if (!object(block)) { session.logicalEvents.push(protocol(session, raw, `qoder_content_${blockIndex}`, 'Unmodeled saved message content', { blockIndex })); continue; }
      if (block.type === 'tool_result') {
        if (!consumed.has(`${index}:${blockIndex}`)) session.logicalEvents.push(protocol(session, raw, `qoder_unpaired_tool_result_${blockIndex}`,
          'Unpaired recorded tool result', { blockIndex, text: safe(textOf(block.content)) }));
        continue;
      }
      if (row.type === 'assistant' && block.type === 'tool_use' && string(block.id) && string(block.name)) {
        const matchingCalls = calls.get(block.id) || []; const matchingResults = results.get(block.id) || [];
        const call = { rowIndex: index, blockIndex, block };
        let result = matchingCalls.length === 1 && matchingResults.length === 1 ? matchingResults[0] : null;
        let pairing = 'missing_or_ambiguous_result';
        if (result) {
          const resultRow = rows[result.rowIndex]; const sourceUuid = string(resultRow.sourceToolAssistantUUID);
          if (!(result.rowIndex > index && (ids.get(resultRow.uuid) || []).length === 1
            && (ids.get(row.uuid) || []).length === 1
            && (!sourceUuid || sourceUuid === row.uuid)
            && !(string(row.sessionId) && string(resultRow.sessionId) && row.sessionId !== resultRow.sessionId)
            && !(string(row.agentId) && string(resultRow.agentId) && row.agentId !== resultRow.agentId)
            && (sourceUuid === row.uuid || ancestorOf(call, result)))) result = null;
          else pairing = sourceUuid ? 'exact_call_source_uuid' : 'exact_call_ancestry';
        }
        const resultRow = result ? rows[result.rowIndex] : null;
        // A row-level receipt cannot be assigned to one of several result
        // blocks without additional source ownership evidence.
        const receiptRow = resultRow && messageBlocks(resultRow).filter((item) => item?.type === 'tool_result').length === 1 ? resultRow : null;
        if (result) consumed.add(`${result.rowIndex}:${result.blockIndex}`);
        const native = nativeTool(block); const output = textOf(result?.block.content);
        const outcome = toolOutcome(block.name, result?.block, receiptRow || {});
        const { status, outputStats } = outcome;
        const rawRefs = [qoderRawRef(raw)]; if (result) rawRefs.push(qoderRawRef(session.rawEvents[result.rowIndex]));
        session.logicalEvents.push(eventFor(session, raw, `call:${blockIndex}`, { kind: native.activity === 'command' ? 'command' : 'other_tool_call', subtype: block.name,
          role: 'assistant', toolName: block.name, status, severity: status === 'failed' ? 'error' : 'normal', touchedFiles: native.paths, outputStats,
          preview: native.command || `${block.name}${native.paths.length ? ` ${native.paths[0]}` : ''}`,
          searchText: [block.name, search(block.input), search(result?.block.content), search(receiptRow?.toolUseResult)].filter(Boolean).join('\n'), rawRefs,
          qoder: { blockIndex, callId: block.id, uniqueCallIdentity: matchingCalls.length === 1,
            arguments: safe(native.arguments ?? block.input), argumentsValid: Boolean(native.arguments),
            command: safe(native.command), activity: native.activity, output: safe(output),
            pairing, resultBlockIndex: result?.blockIndex ?? null,
            resultContent: safe(result?.block.content ?? null), toolResult: safe(receiptRow?.toolUseResult ?? null),
            resultStatus: outcome.resultStatus, mcpMeta: safe(receiptRow?.mcpMeta ?? null),
            toolDenialKind: string(receiptRow?.toolDenialKind), requestedToolName: ['mcp_call', 'mcp__qw-builtin__qw_mcp_call'].includes(block.name)
              ? string(native.arguments?.toolName) : '' } }));
      } else if (row.type === 'assistant' && block.type === 'thinking' && typeof block.thinking === 'string') {
        session.logicalEvents.push(eventFor(session, raw, `thinking:${blockIndex}`, { kind: 'reasoning', role: 'assistant', preview: block.thinking,
          searchText: redactEmbeddedDataUrls(block.thinking), hasReadableReasoning: Boolean(block.thinking), qoder: { text: safe(block.thinking), blockIndex } }));
      } else if (block.type === 'text' && typeof block.text === 'string' && classification.kind !== 'tool_results') {
        const text = redactEmbeddedDataUrls(block.text);
        const kind = classification.kind;
        session.logicalEvents.push(eventFor(session, raw, `text:${blockIndex}`, { kind, role: row.type, preview: text, searchText: text,
          ...(kind === 'error' ? { status: 'failed', severity: 'error', subtype: 'qoder_assistant_error' } : {}),
          qoder: { text: safe(text), blockIndex, stopReason: string(row.message.stop_reason), aborted: row.aborted === true } }));
        if (classification.titleEligible && !session.title && text.trim()) session.title = preview(text);
      } else if (classification.kind === 'user_message' && nativeImage(block)) {
        const metadata = { sourceType: block.source.type, mediaType: string(block.source.media_type), path: string(block.source.path) };
        session.logicalEvents.push(eventFor(session, raw, `image:${blockIndex}`, { kind: 'user_message', role: 'user', preview: 'Image attachment', searchText: '',
          qoder: { text: '', blockIndex, imageMessage: true, imageCount: 1, images: [safe(metadata)] } }));
        if (classification.titleEligible && !session.title) session.title = 'Image attachment';
      } else session.logicalEvents.push(protocol(session, raw, `qoder_content_${blockIndex}`, 'Unmodeled saved message content', { blockIndex }));
    }
  }
  const title = rows.findLast((row) => row.type === 'custom-title' && string(row.customTitle).trim());
  session.title = preview(title?.customTitle || desktopTitle?.title || session.title) || `Qoder session ${document.id}`;
  return summarize(session);
}

module.exports = { makeQoderSession, qoderRawRef, sanitizeQoderValue, iso, textOf };
