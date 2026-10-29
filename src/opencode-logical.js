'use strict';

const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { createEmptyMaterializedPresentationIndexes } = require('./canonical-contract');
const { sanitizeLogicalDetailValue, redactEmbeddedDataUrls } = require('./shared/logical-detail-sanitizer');
const { projectSearchJson } = require('./search-json');

const SOURCE_KIND = 'opencode';
const MAPPER_VERSION = '1';
const string = (value) => typeof value === 'string' ? value : '';
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = (value) => finite(value) !== null && value >= 0 ? value : 0;
const safe = (value) => sanitizeLogicalDetailValue(value, { maxDepth: 32 });
const preview = (value) => redactEmbeddedDataUrls(string(value)).trim().slice(0, 240);
const searchPolicy = {
  opaqueTypes: new Set(['image', 'audio', 'image_url', 'input_image', 'output_image']),
  excludedKeys: new Set(['native', 'signature', 'thoughtSignature', 'thinkingSignature',
    'textSignature', 'encrypted_content', 'base64']),
  omitEntry: (key, parent) => key === 'data' && isNativeAttachment(parent),
  redactString: redactEmbeddedDataUrls,
};
const search = (value) => projectSearchJson(value, searchPolicy);
const identityPart = (value) => string(value).replace(/[^a-zA-Z0-9_-]/g,
  (character) => '%' + character.charCodeAt(0).toString(16).padStart(4, '0'));
const sessionIdFor = (id, databaseId = '') => 'opencode:'
  + (databaseId ? identityPart(databaseId) + ':' : '') + identityPart(id);
function iso(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
function parseColumn(value) {
  if (typeof value !== 'string') return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
}
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function isNativeAttachment(value) {
  return plain(value) && typeof value.data === 'string' && typeof value.mime === 'string'
    && ['inline', 'uri'].includes(value.source?.type);
}
function attachmentReferences(value) {
  if (!Array.isArray(value)) return safe(value ?? []);
  return safe(value.map(item => isNativeAttachment(item)
    ? { ...item, data: '[attachment bytes omitted; see raw refs]' } : item));
}
function textContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text).join('\n');
}
function errorText(value) {
  if (typeof value === 'string') return value;
  if (!plain(value)) return '';
  return string(value.message) || string(value.data?.message) || string(value.name) || string(value.type);
}
function emptyCounts() {
  return Object.fromEntries(['turns', 'messages', 'userMessages', 'assistantMessages', 'reasoning', 'toolCalls',
    'failedCommands', 'issueEvents', 'patches', 'compactions', 'aborts', 'errors', 'protocol',
    'planArtifacts', 'planEvents'].map((name) => [name, 0]));
}
function snapshotError(message) {
  const error = new Error(message);
  error.code = 'OPENCODE_INVALID_SNAPSHOT';
  return error;
}
function openCodeRawRef(raw) {
  return { file: raw.source.file, line: null, rawId: raw.rawId, sourceKind: SOURCE_KIND,
    sourceLocator: raw.sourceLocator, sourceRecordType: raw.recordType, sourceEventType: raw.payloadType };
}
function makeRaw(row, session, source, snapshotId, ordinal, metadata = false) {
  const data = metadata ? row : parseColumn(row.data);
  const valid = metadata || plain(data);
  const parsed = metadata ? row : valid ? { ...data, id: row.id, type: row.type } : null;
  const nativeType = metadata ? 'session_v2' : string(row.type) || 'unknown';
  const locator = { type: 'sqlite_row', databaseId: source.identity,
    table: metadata ? 'session_v2' : 'session_message', sessionID: session.sourceSessionId,
    ...(metadata ? {} : { messageID: row.id }), pointer: '', snapshotId };
  const readable = valid ? search(parsed) : 'Malformed message JSON (content available in Raw)';
  return {
    rawId: session.id + ':raw:' + (metadata ? 'session' : 'message:' + identityPart(row.id)),
    sessionId: session.id, sourceKind: SOURCE_KIND, sourceSessionId: session.sourceSessionId,
    source: { file: session.sourceFile, line: null }, sourceLocator: locator,
    line: null, rawIndex: ordinal, timestamp: metadata ? iso(row.time_created)
      : iso(parsed?.time?.created ?? row.time_created),
    recordType: locator.table, payloadType: valid ? nativeType : 'malformed_json',
    role: ['user', 'assistant', 'system'].includes(nativeType) ? nativeType : '',
    turnId: '', callId: '', toolName: '', preview: preview(parsed?.text || parsed?.summary || readable),
    messageText: safe(string(parsed?.text)), searchText: readable, parsed: safe(parsed),
    parseError: valid ? '' : 'Message data is not a JSON object', messageId: metadata ? '' : row.id,
    sequence: metadata ? null : row.seq, touchedFiles: [],
  };
}
function eventFor(session, raw, suffix, fields = {}) {
  const refs = [openCodeRawRef(raw)];
  const event = {
    id: session.id + ':event:' + (raw.messageId ? identityPart(raw.messageId) : 'session') + ':' + suffix,
    schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: SOURCE_KIND,
    timestamp: raw.timestamp, turnId: raw.turnId, kind: 'event', subtype: '', layer: 'main', role: '',
    label: '', preview: '', searchText: '', severity: 'normal', status: '', toolName: '',
    touchedFiles: [], outputStats: {}, tokenUsage: [], usageLimits: [], channels: [], tags: [],
    hasLongOutput: false, hasReadableReasoning: false, ...fields,
    rawRefs: refs, source: refs[0], sourceLocator: raw.sourceLocator,
  };
  event.preview = preview(event.preview);
  event.hasLongOutput = event.searchText.length > 1600;
  return event;
}
function protocol(session, raw, subtype, fields = {}) {
  return eventFor(session, raw, subtype, { kind: 'protocol', layer: 'protocol', subtype,
    preview: raw.preview, searchText: raw.searchText, ...fields });
}
function tokenItems(tokens) {
  if (!plain(tokens)) return [];
  return [['Input', tokens.input], ['Output', tokens.output], ['Reasoning', tokens.reasoning],
    ['Cache read', tokens.cache?.read], ['Cache write', tokens.cache?.write]]
    .filter(([, value]) => finite(value) !== null && value >= 0).map(([label, value]) => ({
      key: label.toLowerCase().replace(' ', '_'), field: label.toLowerCase().replace(' ', '_'),
      label, value, formatted: String(value), primary: false,
    }));
}
function columnUsage(row) {
  return { input: nonnegative(row.tokens_input), output: nonnegative(row.tokens_output),
    reasoning: nonnegative(row.tokens_reasoning),
    cache: { read: nonnegative(row.tokens_cache_read), write: nonnegative(row.tokens_cache_write) } };
}
function toolStatus(state, name) {
  if (state.status === 'error') return 'failed';
  if (state.status !== 'completed') return 'incomplete';
  if (name === 'shell') {
    if (string(state.metadata?.signal)) return 'failed';
    if (state.metadata?.status === 'running') return 'incomplete';
    if (finite(state.metadata?.exit) !== null && state.metadata.exit !== 0) return 'failed';
    if (state.metadata?.timeout === true || ['timeout', 'killed'].includes(state.metadata?.status)) return 'failed';
  }
  return 'success';
}
function touchedFiles(name, input, metadata) {
  const paths = [];
  if (['read', 'edit', 'write', 'glob', 'grep'].includes(name) && string(input?.path)) paths.push(input.path);
  if (['edit', 'write', 'patch', 'apply_patch'].includes(name) && Array.isArray(metadata?.files)) {
    for (const file of metadata.files) if (string(file?.file)) paths.push(file.file);
  }
  return [...new Set(paths)];
}
function toolEvent(session, raw, block, blockIndex) {
  const state = plain(block.state) ? block.state : {};
  const name = string(block.name);
  if (!['streaming', 'running', 'completed', 'error'].includes(state.status)) {
    return protocol(session, raw, 'opencode_unknown_tool_state_' + blockIndex,
      { label: 'Unknown tool state', searchText: search(block),
        opencode: { pointer: '/content/' + blockIndex, block: safe(block) } });
  }
  const input = state.input;
  const status = toolStatus(state, name);
  const paths = touchedFiles(name, input, state.metadata);
  const isPatch = ['edit', 'write', 'patch', 'apply_patch'].includes(name);
  const command = name === 'shell' ? string(input?.command) : '';
  const output = textContent(state.content);
  const start = Date.parse(iso(block.time?.ran ?? block.time?.created));
  const end = Date.parse(iso(block.time?.completed));
  const durationMs = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
  const exit = name === 'shell' ? finite(state.metadata?.exit) : null;
  return eventFor(session, raw, 'content:' + blockIndex, {
    kind: name === 'shell' ? 'command' : isPatch ? 'patch' : 'other_tool_call',
    subtype: 'opencode_tool', role: 'assistant', toolName: name, status,
    severity: status === 'failed' ? 'error' : 'normal',
    label: name || 'Tool', preview: command || (name + (paths.length ? ': ' + paths.join(', ') : '')),
    searchText: search({ input, content: state.content, error: state.error, metadata: state.metadata }),
    touchedFiles: paths, outputStats: { exitCode: exit, durationMs,
      lineCount: output ? output.split('\n').length : 0, charCount: output.length },
    opencode: { pointer: '/content/' + blockIndex, callId: string(block.id), blockIndex,
      toolStatus: state.status, processStatus: name === 'shell' ? string(state.metadata?.status) : '',
      executed: typeof block.executed === 'boolean' ? block.executed : null,
      input: safe(input), content: safe(state.content ?? []), output: safe(output),
      metadata: safe(state.metadata ?? {}), error: safe(state.error ?? null), command,
      patchText: name === 'patch' ? safe(string(input?.patchText)) : '',
      childSessionID: name === 'subagent' ? string(state.metadata?.sessionID) : '',
      childSessionId: name === 'subagent' && string(state.metadata?.sessionID)
        ? sessionIdFor(state.metadata.sessionID, raw.sourceLocator.databaseId) : '',
      time: safe(block.time ?? {}) },
  });
}
function shellEvent(session, raw, message) {
  const exit = finite(message.exit);
  const status = message.status === 'running' ? 'incomplete'
    : message.status === 'exited' && exit === 0 ? 'success'
      : ['timeout', 'killed'].includes(message.status) || (message.status === 'exited' && exit !== null)
        ? 'failed' : 'incomplete';
  const output = string(message.output?.output);
  const start = Date.parse(iso(message.time?.created)); const end = Date.parse(iso(message.time?.completed));
  return eventFor(session, raw, 'shell', {
    kind: 'command', subtype: 'opencode_user_shell', role: 'user', toolName: 'shell', status,
    label: 'User shell', severity: status === 'failed' ? 'error' : 'normal', preview: string(message.command),
    searchText: search({ command: message.command, output: message.output }),
    outputStats: { exitCode: exit, durationMs: Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0,
      lineCount: output ? output.split('\n').length : 0, charCount: output.length },
    opencode: { pointer: '', command: string(message.command), output: safe(output),
      processStatus: string(message.status), shellID: string(message.shellID),
      outputMetadata: safe(message.output ?? {}), userInitiated: true },
  });
}
function eventKindCatalog(sessions) {
  const maps = { main: new Map(), protocol: new Map(), raw: new Map() };
  for (const session of sessions) {
    for (const event of session.logicalEvents) {
      const map = maps[event.layer], key = event.layer === 'protocol' ? event.subtype : event.kind;
      map.set(key, (map.get(key) || 0) + 1);
    }
    for (const raw of session.rawEvents) maps.raw.set(raw.payloadType, (maps.raw.get(raw.payloadType) || 0) + 1);
  }
  return Object.fromEntries(Object.entries(maps).map(([layer, map]) => [layer,
    [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }))]));
}
function summarize(session, native) {
  const counts = emptyCounts(), tools = new Map(), kinds = new Map(), protocols = new Map(), turns = new Set();
  const failedCommands = [], patches = new Map();
  for (const event of session.logicalEvents) {
    if (event.turnId) turns.add(event.turnId);
    if (event.layer === 'protocol') {
      counts.protocol++; protocols.set(event.subtype, (protocols.get(event.subtype) || 0) + 1);
    } else {
      kinds.set(event.kind, (kinds.get(event.kind) || 0) + 1);
      if (event.kind === 'user_message') { counts.messages++; counts.userMessages++; }
      if (event.kind === 'assistant_message') { counts.messages++; counts.assistantMessages++; }
      if (event.kind === 'reasoning') counts.reasoning++;
      if (event.kind === 'compaction') counts.compactions++;
      if (event.kind === 'abort') counts.aborts++;
      if (event.kind === 'error') counts.errors++;
      if (['command', 'other_tool_call', 'patch'].includes(event.kind)) {
        // Top-level shell is a user command, not a model tool invocation.
        // `executed` is upstream providerExecuted, not success or eligibility
        // for accounting: false identifies a locally executed model tool.
        if (event.subtype !== 'opencode_user_shell') {
          counts.toolCalls++; tools.set(event.toolName, (tools.get(event.toolName) || 0) + 1);
        }
        if (event.kind === 'patch') {
          counts.patches++;
          if (event.status === 'success') for (const file of event.touchedFiles) patches.set(file, (patches.get(file) || 0) + 1);
        }
        if (event.kind === 'command' && event.status === 'failed') {
          counts.failedCommands++;
          failedCommands.push({ id: event.id, timestamp: event.timestamp, command: event.preview,
            status: event.status, exitCode: event.outputStats.exitCode, durationMs: event.outputStats.durationMs, source: event.source });
        }
      }
    }
    if (event.status === 'failed' || event.severity !== 'normal') counts.issueEvents++;
  }
  counts.turns = turns.size;
  const rows = (map) => [...map].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  session.counts = counts; session.rawEventCount = session.rawEvents.length; session.logicalEventCount = session.logicalEvents.length;
  // Session totals are maintained by the upstream projector and reset on fork.
  // Per-message usage on copied fork prefixes is retained as evidence, never summed.
  const usage = columnUsage(native);
  session.analysis = { sessionId: session.id, title: session.title, counts, toolUsage: rows(tools),
    failedCommands, slowCommands: [], patchedFiles: [...patches].map(([file, count]) => ({ file, count })),
    tokenStats: { maxObserved: 0, recordedSessionTotals: usage, recordedSessionCost: nonnegative(native.cost),
      basis: 'session_v2', includesCopiedMessageUsage: false },
    timelineStats: rows(kinds), protocolStats: rows(protocols) };
  session.summary = { topTools: session.analysis.toolUsage.slice(0, 5), failedCommandCount: failedCommands.length,
    patchedFiles: session.analysis.patchedFiles.slice(0, 5), protocolCount: counts.protocol };
  return session;
}

function sessionFromOpenCodeSnapshot(snapshot, options = {}) {
  const native = snapshot?.session, source = snapshot?.source, snapshotId = string(options.snapshotId || snapshot?.snapshotId);
  if (!plain(native) || !string(native.id) || !plain(source) || !string(source.identity)
      || !Array.isArray(snapshot.messages) || !snapshotId) throw snapshotError('Incomplete OpenCode snapshot identity');
  const sourceFile = string(options.sourceFile || source.databasePath);
  const id = sessionIdFor(native.id, source.identity);
  const parent = string(native.parent_id), fork = string(native.fork_session_id);
  const boundary = parseColumn(native.fork_boundary);
  const session = {
    id, sourceKind: SOURCE_KIND, sourceSessionId: native.id, sourceDerivedId: '',
    sourceClientVersion: string(native.version), projectAssociation: string(native.directory),
    sourceFile, title: preview(native.title), agentNickname: string(native.agent),
    primarySessionMetaKind: parent ? 'subagent' : '', derivedRunId: '',
    startedAt: iso(native.time_created), updatedAt: iso(native.time_updated),
    bytes: Number.isSafeInteger(options.bytes) && options.bytes >= 0 ? options.bytes : Buffer.byteLength(JSON.stringify(snapshot)),
    lineCount: 0, cwdSet: string(native.directory) ? [native.directory] : [],
    counts: emptyCounts(), rawEventCount: 0, logicalEventCount: 0,
    parentSessionId: parent ? sessionIdFor(parent, source.identity) : '',
    forkedFromSessionId: fork ? sessionIdFor(fork, source.identity) : '',
    forkStorageMode: fork ? 'copied_prefix' : '', forkedAt: fork ? iso(native.time_created) : '',
    forkPointUuid: fork ? string(boundary?.messageID) : '', forkContinuationState: '',
    supersededBySessionId: '', supersededAt: '', supersededReason: '', parentSessionInferred: false,
    forkEvidence: fork ? { source: 'session_v2', boundary: safe(boundary), sourceSessionId: fork,
      activityBasis: 'captured_transcript_including_copied_history' } : null,
    inheritedContext: null, summary: { topTools: [], failedCommandCount: 0, patchedFiles: [], protocolCount: 0 },
    rawEvents: [], logicalEvents: [], analysis: null, presentationIndexes: createEmptyMaterializedPresentationIndexes(),
  };
  const header = makeRaw(native, session, source, snapshotId, 0, true);
  session.rawEvents.push(header);
  session.logicalEvents.push(protocol(session, header, 'opencode_session', {
    label: 'OpenCode session', preview: session.title || 'OpenCode session', searchText: search({
      title: native.title, directory: native.directory, agent: native.agent, model: parseColumn(native.model),
      metadata: parseColumn(native.metadata), parentID: parent, forkSessionID: fork }),
    opencode: { pointer: '', sessionID: native.id, directory: string(native.directory), path: string(native.path),
      model: safe(parseColumn(native.model)), agent: string(native.agent), metadata: safe(parseColumn(native.metadata)),
      parentID: parent, forkSessionID: fork, forkBoundary: safe(boundary),
      relations: safe(snapshot.relations ?? {}), recordedTokens: columnUsage(native),
      recordedCost: nonnegative(native.cost), outcome: string(native.idle_outcome), archivedAt: iso(native.time_archived),
      usageBasis: 'session_v2; copied message usage is not added',
      activityBasis: fork ? 'captured_transcript_including_copied_history' : 'captured_transcript' },
  }));
  const rows = [...snapshot.messages].sort((a, b) => a.seq - b.seq || string(a.id).localeCompare(string(b.id)));
  const ids = new Set(), sequences = new Set();
  let turnId = '';
  for (const [index, row] of rows.entries()) {
    if (!plain(row) || !string(row.id) || row.session_id !== native.id
        || !Number.isSafeInteger(row.seq) || row.seq < 0 || ids.has(row.id) || sequences.has(row.seq)) {
      throw snapshotError('Invalid or duplicate OpenCode message identity');
    }
    ids.add(row.id); sequences.add(row.seq);
    const raw = makeRaw(row, session, source, snapshotId, index + 1);
    session.rawEvents.push(raw);
    const data = parseColumn(row.data), message = plain(data) ? { ...data, id: row.id, type: row.type } : null;
    if (['user', 'assistant', 'shell', 'synthetic', 'compaction'].includes(row.type) && !turnId) {
      turnId = id + ':turn:' + identityPart(row.id);
    }
    raw.turnId = turnId;
    if (!message) {
      session.logicalEvents.push(protocol(session, raw, 'opencode_malformed_message', { label: 'Malformed message' }));
      continue;
    }
    if (message.type === 'user') {
      session.logicalEvents.push(eventFor(session, raw, 'user', {
        kind: 'user_message', role: 'user', label: 'User', preview: string(message.text) || 'User context',
        searchText: search({ text: message.text, files: message.files, agents: message.agents, skills: message.skills }),
        opencode: { pointer: '', text: safe(string(message.text)), files: attachmentReferences(message.files),
          agents: safe(message.agents ?? []), skills: safe(message.skills ?? []) },
      }));
    } else if (message.type === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      for (const [blockIndex, block] of content.entries()) {
        if (block?.type === 'text' || block?.type === 'reasoning') {
          const reasoning = block.type === 'reasoning';
          session.logicalEvents.push(eventFor(session, raw, 'content:' + blockIndex, {
            kind: reasoning ? 'reasoning' : 'assistant_message', role: 'assistant',
            label: reasoning ? 'Reasoning' : 'Assistant', preview: string(block.text), searchText: search(block.text),
            status: message.error ? 'failed' : message.time?.completed != null ? 'success' : 'incomplete',
            hasReadableReasoning: reasoning && Boolean(block.text),
            opencode: { pointer: '/content/' + blockIndex, text: safe(string(block.text)),
              model: safe(message.model ?? {}), agent: string(message.agent), finish: string(message.finish),
              completedAt: iso(message.time?.completed) },
          }));
        } else if (block?.type === 'tool') session.logicalEvents.push(toolEvent(session, raw, block, blockIndex));
        else session.logicalEvents.push(protocol(session, raw, 'opencode_unknown_content_' + blockIndex, {
          label: 'Unknown assistant content', preview: 'Unknown assistant content: ' + (string(block?.type) || 'untyped'),
          searchText: search(block), opencode: { pointer: '/content/' + blockIndex, block: safe(block) },
        }));
      }
      if (!content.length) session.logicalEvents.push(protocol(session, raw, 'opencode_empty_assistant', {
        label: 'Assistant step', status: message.time?.completed != null ? 'success' : 'incomplete',
        preview: message.time?.completed != null ? 'Assistant step completed without content' : 'Assistant step has no completed content',
        opencode: { pointer: '', model: safe(message.model ?? {}), agent: string(message.agent) },
      }));
      if (message.retry) session.logicalEvents.push(protocol(session, raw, 'opencode_retry', {
        label: 'Provider retry', preview: errorText(message.retry.error) || 'Provider retry',
        status: 'incomplete', severity: 'warning', searchText: search(message.retry),
        opencode: { pointer: '/retry', retry: safe(message.retry) },
      }));
      if (message.error) session.logicalEvents.push(eventFor(session, raw, 'error', {
        kind: 'error', label: 'Assistant error', status: 'failed', severity: 'error',
        preview: errorText(message.error), searchText: search(message.error),
        opencode: { pointer: '/error', text: safe(errorText(message.error)), error: safe(message.error) },
      }));
      if (message.tokens || message.cost !== undefined) session.logicalEvents.push(protocol(session, raw, 'opencode_step_usage', {
        label: 'Recorded step usage', preview: 'Recorded step usage (not a session total)',
        searchText: search({ tokens: message.tokens, cost: message.cost }), tokenUsage: tokenItems(message.tokens),
        opencode: { pointer: '', tokens: safe(message.tokens ?? {}), cost: finite(message.cost),
          usageBasis: 'message evidence only; may be copied fork history' },
      }));
    } else if (message.type === 'shell') session.logicalEvents.push(shellEvent(session, raw, message));
    else if (message.type === 'compaction') {
      const status = message.status === 'completed' ? 'success' : message.status === 'failed' ? 'failed' : 'incomplete';
      const summary = string(message.summary);
      const emptySummary = status === 'success' ? 'Compaction completed without a readable summary'
        : status === 'failed' ? 'Compaction failed' : 'Compaction in progress';
      session.logicalEvents.push(eventFor(session, raw, 'compaction', {
        kind: 'compaction', label: 'Compaction', status, severity: status === 'failed' ? 'error' : 'normal',
        preview: summary.trim() ? summary : errorText(message.error) || emptySummary, searchText: search(message),
        tokenUsage: tokenItems(message.tokens), opencode: { pointer: '', text: safe(summary),
          reason: string(message.reason), compactionStatus: string(message.status),
          error: safe(message.error ?? null), model: safe(message.model ?? {}), tokens: safe(message.tokens ?? {}),
          cost: finite(message.cost), preservesTranscript: true,
          hasNativeReplacement: Array.isArray(message.native?.messages) },
      }));
    } else if (message.type === 'idle') {
      const interrupted = message.outcome === 'interrupted', failed = message.outcome === 'failed';
      session.logicalEvents.push(eventFor(session, raw, 'idle', {
        kind: interrupted ? 'abort' : failed ? 'error' : 'protocol',
        layer: interrupted || failed ? 'main' : 'protocol', subtype: 'opencode_idle',
        label: interrupted ? 'Execution interrupted' : failed ? 'Execution failed' : 'Execution completed',
        status: failed ? 'failed' : interrupted ? 'interrupted' : message.outcome === 'succeeded' ? 'success' : 'incomplete',
        severity: failed ? 'error' : interrupted ? 'warning' : 'normal',
        preview: errorText(message.error) || 'Execution ' + string(message.outcome), searchText: search(message),
        opencode: { pointer: '', outcome: string(message.outcome), error: safe(message.error ?? null),
          text: errorText(message.error) || 'Execution ' + string(message.outcome) },
      }));
      turnId = '';
    } else if (['system', 'synthetic', 'skill', 'agent-switched', 'model-switched', 'location-switched'].includes(message.type)) {
      session.logicalEvents.push(protocol(session, raw, 'opencode_' + message.type, {
        label: message.type, role: message.type === 'system' ? 'system' : '',
        preview: string(message.description) || string(message.text) || message.type,
        opencode: { pointer: '', text: safe(string(message.text)), fields: safe(message) },
      }));
    } else session.logicalEvents.push(protocol(session, raw, 'opencode_unknown_message', {
      label: 'Unknown message: ' + string(message.type),
      opencode: { pointer: '', nativeType: string(message.type), fields: safe(message) },
    }));
  }
  if (!session.title) session.title = session.logicalEvents.find((event) => event.kind === 'user_message')?.preview || 'OpenCode session';
  return summarize(session, native);
}

module.exports = { SOURCE_KIND, MAPPER_VERSION, identityPart, sessionIdFor, iso, emptyCounts, search,
  openCodeRawRef, eventKindCatalog, sessionFromOpenCodeSnapshot, sanitizeOpenCodeValue: safe, parseColumn };
