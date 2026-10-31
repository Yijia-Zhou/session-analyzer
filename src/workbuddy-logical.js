'use strict';

const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { createEmptyMaterializedPresentationIndexes, INDEXED_SESSION_COUNT_FIELDS } = require('./canonical-contract');
const { sanitizeLogicalDetailValue, redactEmbeddedDataUrls } = require('./shared/logical-detail-sanitizer');
const { projectSearchJson } = require('./search-json');
const string = (value) => typeof value === 'string' ? value : '';
const object = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const safe = (value) => sanitizeLogicalDetailValue(value, { maxDepth: 24, maxNodes: 2000, maxArrayItems: 128, maxObjectEntries: 128 });
const searchPolicy = { opaqueTypes: new Set(['image', 'input_image', 'output_image', 'input_file', 'audio']),
  excludedKeys: new Set(['signature', 'thinkingSignature', 'encrypted_content', 'base64', '_meta', '__codebuddyLocal']), redactString: redactEmbeddedDataUrls };
const search = (value) => projectSearchJson(value, searchPolicy);
const preview = (value) => redactEmbeddedDataUrls(string(value)).trim().slice(0, 240);
const identityPart = (value) => string(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
function iso(value) { if (!['string', 'number'].includes(typeof value)) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toISOString(); }
function textOf(value, types = ['input_text', 'output_text', 'text']) {
  if (typeof value === 'string') return value;
  const blocks = Array.isArray(value) ? value : object(value) ? [value] : [];
  return blocks.filter((block) => object(block) && types.includes(block.type) && typeof block.text === 'string').map((block) => block.text).join('\n');
}
function workbuddyRawRef(raw) { return { file: raw.source.file, line: raw.source.line, rawId: raw.rawId, sourceLocator: raw.sourceLocator,
  sourceRecordType: raw.recordType, sourceEventType: raw.payloadType }; }
function eventFor(session, raw, suffix, fields) {
  const rawRefs = fields.rawRefs || [workbuddyRawRef(raw)];
  const provider = raw.parsed?.providerData;
  fields = { ...fields, workbuddy: { model: string(provider?.model), requestId: string(provider?.conversationRequestId),
    ...(object(provider?.error) ? { error: safe(provider.error) } : {}), ...fields.workbuddy } };
  return { id: `${session.id}:event:${raw.line}:${suffix}`, schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: 'workbuddy',
    timestamp: raw.timestamp, turnId: raw.turnId, kind: 'event', subtype: '', layer: 'main', role: '', label: '', preview: '', searchText: '',
    severity: 'normal', status: '', toolName: '', touchedFiles: [], outputStats: {}, tokenUsage: [], usageLimits: [], channels: [], tags: [],
    hasLongOutput: (fields.searchText || '').length > 1600, hasReadableReasoning: false, ...fields,
    preview: preview(fields.preview), rawRefs, source: rawRefs[0], sourceLocator: rawRefs[0].sourceLocator };
}
function protocol(session, raw, subtype = raw.payloadType, label = raw.preview) {
  return eventFor(session, raw, subtype, { kind: 'protocol', layer: 'protocol', subtype, role: raw.role, preview: label,
    searchText: raw.searchText, workbuddy: { text: label } });
}
function argumentsFor(row) {
  // Native function_call arguments are a JSON string. Invalid strings stay
  // readable evidence, but must never acquire shell/edit/file semantics.
  if (typeof row.arguments !== 'string') return null;
  try { const value = JSON.parse(row.arguments); return object(value) ? value : null; } catch { return null; }
}
function nativeTool(row, args) {
  if (!args) return { activity: '', command: '', paths: [] };
  const name = row.name;
  if (['Bash', 'PowerShell'].includes(name) && typeof args.command === 'string') return { activity: 'command', command: args.command, paths: [] };
  const activities = new Map([['Read', 'read'], ['Write', 'write'], ['Edit', 'edit'], ['MultiEdit', 'edit']]);
  const activity = activities.get(name);
  if (activity && typeof args.file_path === 'string') return { activity, command: '', paths: [args.file_path] };
  if ((name === 'TodoWrite' && Array.isArray(args.newTodos)) || ['TaskCreate', 'TaskUpdate', 'TaskList', 'EnterPlanMode', 'ExitPlanMode'].includes(name)) return { activity: 'plan', command: '', paths: [] };
  if (['CreateGoal', 'GetGoal', 'UpdateGoal'].includes(name)) return { activity: 'goal', command: '', paths: [] };
  if (['Agent', 'SendMessage', 'TeamCreate', 'TeamDelete'].includes(name)) return { activity: 'coordination', command: '', paths: [] };
  return { activity: '', command: '', paths: [] };
}
function makeSession(document, sourceFile) {
  const session = { id: `workbuddy:${identityPart(sourceFile)}`, sourceKind: 'workbuddy', sourceSessionId: document.id,
    sourceDerivedId: '', sourceClientVersion: '', projectAssociation: document.cwd, sourceFile, title: '', agentNickname: '',
    primarySessionMetaKind: '', derivedRunId: '', startedAt: '', updatedAt: '', bytes: document.acceptedBytes, lineCount: document.lines.length,
    cwdSet: [...new Set(document.rows.map((row) => string(row.parsed?.cwd)).filter(Boolean))], counts: {}, rawEventCount: 0, logicalEventCount: 0,
    parentSessionId: '', forkedFromSessionId: '', forkStorageMode: '', forkedAt: '', forkPointUuid: '', forkContinuationState: '',
    supersededBySessionId: '', supersededAt: '', supersededReason: '', parentSessionInferred: false, forkEvidence: null, inheritedContext: null,
    summary: { topTools: [], failedCommandCount: 0, patchedFiles: [], protocolCount: 0 }, rawEvents: [], logicalEvents: [], analysis: null,
    presentationIndexes: createEmptyMaterializedPresentationIndexes() };
  const location = sourceFile.split('/');
  if (location.length === 4 && location[2] === 'subagents') {
    session.primarySessionMetaKind = 'subagent';
    session.parentSessionId = `workbuddy:${identityPart(`${location[0]}/${location[1]}.jsonl`)}`;
  }
  let turnId = '';
  session.rawEvents = document.rows.map((row) => {
    const record = object(row.parsed) ? row.parsed : {};
    if (record.type === 'message' && record.role === 'user' && record.providerData?.isMeta !== true && record.providerData?.isCompacted !== true && string(record.id)) turnId = record.id;
    if (record.type === 'resend-fork-notice') turnId = '';
    const source = { file: sourceFile, line: row.line }; const sourceLocator = { type: 'jsonl_line', ...source };
    const text = row.parseError ? 'Malformed JSON record (content available in Raw)' : search(record);
    const messageText = textOf(record.content);
    return { rawId: `${session.id}:raw:${row.line}`, sessionId: session.id, sourceKind: 'workbuddy', sourceSessionId: document.id,
      source, sourceLocator, line: row.line, rawIndex: row.line, timestamp: iso(record.timestamp), recordType: row.parseError ? 'malformed' : string(record.type) || 'unknown',
      payloadType: row.parseError ? 'malformed_json' : string(record.type) || 'unknown', role: string(record.role) || (['reasoning', 'function_call'].includes(record.type) ? 'assistant' : record.type === 'function_call_result' ? 'tool' : ''), turnId,
      callId: string(record.callId), toolName: string(record.name), preview: preview(messageText || text), messageText: safe(messageText), searchText: text,
      parsed: safe(row.parsed), parseError: row.parseError, touchedFiles: [] };
  });
  session.startedAt = session.rawEvents.find((raw) => raw.timestamp)?.timestamp || '';
  session.updatedAt = session.rawEvents.findLast((raw) => raw.timestamp)?.timestamp || '';
  if (session.rawEvents.length) {
    const archival = protocol(session, session.rawEvents[0], 'workbuddy_recorded_history', 'Recorded physical history; earlier resend/rewind branches remain visible.');
    archival.searchText = '';
    session.logicalEvents.push(archival);
  }
  const calls = new Map(); const results = new Map();
  for (let i = 0; i < document.rows.length; i++) {
    const row = document.rows[i].parsed;
    if (!object(row) || !string(row.callId)) continue;
    const map = row.type === 'function_call' ? calls : row.type === 'function_call_result' ? results : null;
    if (map) { const list = map.get(row.callId) || []; list.push(i); map.set(row.callId, list); }
  }
  const consumed = new Set();
  const ids = new Map(); const segments = []; let segment = 0;
  for (let n = 0; n < document.rows.length; n++) {
    const entry = document.rows[n].parsed;
    if (entry?.type === 'resend-fork-notice') segment++;
    segments.push(segment);
    if (string(entry?.id)) { const positions = ids.get(entry.id) || []; positions.push(n); ids.set(entry.id, positions); }
  }
  function ancestorOf(callIndex, resultIndex) {
    const call = document.rows[callIndex].parsed; let position = resultIndex; const visited = new Set();
    while (position > callIndex && !visited.has(position)) {
      visited.add(position); const parent = document.rows[position].parsed?.parentId;
      if (!string(parent)) return false;
      if (parent === call.id) return true;
      const earlier = (ids.get(parent) || []).filter((n) => n < position);
      // Native duplicate-id response groups are contiguous. A reused identity
      // in separate groups cannot prove a unique historical ancestor.
      if (!earlier.length || earlier.some((n, k) => k && n !== earlier[k - 1] + 1)) return false;
      position = earlier[0];
    }
    return false;
  }
  for (let i = 0; i < document.rows.length; i++) {
    const row = document.rows[i].parsed; const raw = session.rawEvents[i];
    if (!object(row) || raw.parseError || !string(row.type)) { session.logicalEvents.push(protocol(session, raw)); continue; }
    if (row.providerData?.usage || row.message?.usage) {
      const usage = protocol(session, raw, 'workbuddy_usage', 'Recorded model usage');
      usage.workbuddy = { text: 'Recorded model usage', usage: safe(row.message?.usage ?? row.providerData.usage), model: string(row.providerData?.model) };
      session.logicalEvents.push(usage);
    }
    if (row.type === 'message' && row.providerData?.isMeta === true && row.providerData?.isCompacted !== true) {
      session.logicalEvents.push(protocol(session, raw, 'workbuddy_meta_message', 'Recorded runtime message')); continue;
    }
    const identified = string(row.id) && (row.parentId === undefined || typeof row.parentId === 'string');
    if (row.type === 'message' && identified && ['user', 'assistant'].includes(row.role)) {
      const blocks = typeof row.content === 'string' ? [{ type: row.role === 'user' ? 'input_text' : 'output_text', text: row.content }] : row.content;
      if (!Array.isArray(blocks) || !blocks.length) {
        const errorText = string(row.providerData?.error?.message);
        if (row.role === 'assistant' && errorText) session.logicalEvents.push(eventFor(session, raw, 'error', {
          kind: 'error', subtype: 'workbuddy_assistant_error', role: 'assistant', status: 'failed', severity: 'error',
          preview: errorText, searchText: redactEmbeddedDataUrls(errorText), workbuddy: { text: safe(errorText) },
        }));
        else session.logicalEvents.push(protocol(session, raw));
        continue;
      }
      for (const [n, block] of blocks.entries()) {
        const allowed = row.role === 'user' ? ['input_text', 'text'] : ['output_text', 'text'];
        if (object(block) && allowed.includes(block.type) && typeof block.text === 'string') {
          const text = redactEmbeddedDataUrls(block.text);
          session.logicalEvents.push(eventFor(session, raw, `text:${n}`, { kind: row.providerData?.isSummary === true && row.providerData?.isCompacted === true ? 'compaction' : `${row.role}_message`, role: row.role, preview: text,
            searchText: row.role === 'assistant' && string(row.providerData?.error?.message) ? `${text}\n${redactEmbeddedDataUrls(row.providerData.error.message)}` : text,
            status: row.role === 'assistant' ? (row.providerData?.error ? 'failed' : row.status === 'completed' ? 'success' : 'incomplete') : '',
            severity: row.providerData?.error ? 'error' : 'normal', workbuddy: { text: safe(text), blockIndex: n } }));
          if (row.role === 'user' && !session.title && text.trim()) session.title = preview(text);
        } else session.logicalEvents.push(protocol(session, raw, `workbuddy_content_${n}`, 'Unmodeled saved message content'));
      }
    } else if (row.type === 'reasoning' && identified) {
      const text = textOf(row.content, ['reasoning_text', 'summary_text', 'text']) || textOf(row.rawContent, ['reasoning_text', 'summary_text', 'text']);
      if (text) session.logicalEvents.push(eventFor(session, raw, 'reasoning', { kind: 'reasoning', role: 'assistant', preview: text,
        searchText: redactEmbeddedDataUrls(text), hasReadableReasoning: true, workbuddy: { text: safe(text) } }));
      else session.logicalEvents.push(protocol(session, raw));
    } else if (row.type === 'function_call' && identified && string(row.callId) && string(row.name)) {
      const possible = calls.get(row.callId) || []; const matching = results.get(row.callId) || [];
      let resultIndex = possible.length === 1 && matching.length === 1 ? matching[0] : -1;
      const candidate = document.rows[resultIndex]?.parsed;
      // Native parentId follows append order, including parallel tool calls;
      // a result need not have its call as its direct parent. Exact request
      // identity or a proven earlier ancestry corroborates unique callId/name.
      const callRequest = string(row.providerData?.conversationRequestId);
      const resultRequest = string(candidate?.providerData?.conversationRequestId);
      const sameRequest = callRequest && resultRequest && callRequest === resultRequest;
      if (!(resultIndex > i && object(candidate) && string(candidate.id) && candidate.name === row.name
        && segments[resultIndex] === segments[i] && !(callRequest && resultRequest && callRequest !== resultRequest)
        && (sameRequest || ancestorOf(i, resultIndex)))) resultIndex = -1;
      const result = resultIndex >= 0 ? document.rows[resultIndex].parsed : null;
      if (result) consumed.add(resultIndex);
      const args = argumentsFor(row); const native = nativeTool(row, args);
      const receipt = result?.providerData?.toolResult;
      const exitCode = receipt?.rawResponse?.exitCode;
      const failed = Boolean(receipt?.error) || result?.status === 'failed' || (row.name === 'Bash' && Number.isInteger(exitCode) && exitCode !== 0);
      const status = result ? (failed ? 'failed' : receipt?.rawResponse?.interrupted === true ? 'incomplete' : result.status === 'completed' ? 'success' : 'incomplete') : 'incomplete';
      const output = textOf(result?.output); const refs = [workbuddyRawRef(raw)]; if (result) refs.push(workbuddyRawRef(session.rawEvents[resultIndex]));
      session.logicalEvents.push(eventFor(session, raw, 'call', { kind: native.activity === 'command' ? 'command' : 'other_tool_call', role: 'assistant',
        toolName: row.name, status, severity: status === 'failed' ? 'error' : 'normal', touchedFiles: native.paths,
        preview: native.command || `${row.name}${native.paths.length ? ` ${native.paths[0]}` : ''}`,
        outputStats: { ...(Number.isInteger(exitCode) ? { exitCode } : {}) },
        searchText: [row.name, search(row.arguments), search(result?.output), search(result?.providerData?.toolResult)].filter(Boolean).join('\n'), rawRefs: refs,
        workbuddy: { callId: row.callId, arguments: safe(args ?? row.arguments), argumentsValid: Boolean(args), command: safe(native.command),
          activity: native.activity, output: safe(output), pairing: result ? 'exact_call_name_request_or_ancestry' : 'missing_or_ambiguous_result',
          resultStatus: string(result?.status), toolResult: safe(result?.providerData?.toolResult ?? null) } }));
    } else if (row.type === 'summary' && typeof row.summary === 'string') {
      session.logicalEvents.push(protocol(session, raw, 'summary', row.summary));
    } else if (['goal-result', 'goal-progress'].includes(row.type) && typeof row.condition === 'string') {
      const text = [row.condition, string(row.reason)].filter(Boolean).join('\n');
      session.logicalEvents.push(eventFor(session, raw, row.type, { kind: 'goal', subtype: row.type, preview: text, searchText: redactEmbeddedDataUrls(text), status: row.type === 'goal-result' ? (row.ok === true ? 'success' : row.ok === false ? 'failed' : 'incomplete') : '', workbuddy: { text: safe(text) } }));
    } else if (row.type === 'resend-fork-notice') {
      session.logicalEvents.push(protocol(session, raw, row.type, 'Resend/edit branch marker. This archival view also includes earlier physical branches.'));
    } else if (row.type === 'function_call_result' && consumed.has(i)) {
      // The result is represented by its exact owning call and shared Raw refs.
    } else session.logicalEvents.push(protocol(session, raw, row.type === 'function_call_result' ? 'workbuddy_unpaired_tool_result' : raw.payloadType));
  }
  const titles = document.rows.flatMap(({ parsed: row }) => {
    if (!object(row)) return [];
    const facts = row.type === 'session-meta' ? row.meta?.['codebuddy.ai/sessionTitle'] : null;
    return [row, ...(Array.isArray(facts) ? facts.filter(object) : [])];
  });
  const customTitle = titles.findLast((row) => row.type === 'custom-title' && string(row.customTitle).trim());
  const generatedTitle = titles.findLast((row) => row.type === 'ai-title' && string(row.aiTitle).trim());
  const topic = titles.findLast((row) => row.type === 'topic' && string(row.topic).trim());
  session.title = preview(customTitle?.customTitle || generatedTitle?.aiTitle || topic?.topic || session.title) || `WorkBuddy session ${document.id}`;
  return summarize(session);
}
function summarize(session) {
  const counts = Object.fromEntries(INDEXED_SESSION_COUNT_FIELDS.map((name) => [name, 0]));
  const tools = new Map(); const kinds = new Map(); const protocols = new Map(); const turns = new Set(); const failedCommands = [];
  for (const event of session.logicalEvents) {
    if (event.turnId) turns.add(event.turnId);
    if (event.layer === 'protocol') { counts.protocol++; protocols.set(event.subtype, (protocols.get(event.subtype) || 0) + 1); continue; }
    kinds.set(event.kind, (kinds.get(event.kind) || 0) + 1);
    if (event.kind === 'user_message') { counts.messages++; counts.userMessages++; }
    if (event.kind === 'assistant_message') { counts.messages++; counts.assistantMessages++; }
    if (event.kind === 'reasoning') counts.reasoning++;
    if (event.kind === 'compaction') counts.compactions++;
    if (event.kind === 'error') counts.errors++;
    if (event.toolName) { counts.toolCalls++; tools.set(event.toolName, (tools.get(event.toolName) || 0) + 1); }
    if (event.workbuddy?.activity === 'plan') counts.planEvents++;
    if (event.status === 'failed') { counts.issueEvents++; if (event.kind === 'command') { counts.failedCommands++; failedCommands.push({ id: event.id, timestamp: event.timestamp, command: event.preview, status: event.status, exitCode: event.outputStats.exitCode ?? null, durationMs: 0, source: event.source }); } }
  }
  counts.turns = turns.size; session.counts = counts; session.rawEventCount = session.rawEvents.length; session.logicalEventCount = session.logicalEvents.length;
  const rows = (map) => [...map].map(([name, count]) => ({ name, count })).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
  session.analysis = { sessionId: session.id, title: session.title, counts, toolUsage: rows(tools), failedCommands, slowCommands: [], patchedFiles: [],
    tokenStats: { maxObserved: 0 }, timelineStats: rows(kinds), protocolStats: rows(protocols) };
  session.summary = { topTools: session.analysis.toolUsage.slice(0,5), failedCommandCount: counts.failedCommands, patchedFiles: [], protocolCount: counts.protocol };
  return session;
}
module.exports = { makeWorkbuddySession: makeSession, workbuddyRawRef, sanitizeWorkbuddyValue: safe, iso, textOf };
