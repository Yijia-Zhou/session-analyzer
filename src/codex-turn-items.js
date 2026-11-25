'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { fileURLToPath } = require('node:url');
const { fsPathApi, sameRecordedPath } = require('./shared/fs-path');
const { uniqueArguments } = require('./codex-terminal-continuations');
const { isDynamicTransport, toolLifecycleDescriptorFor, TOOL_LIFECYCLE_FAMILY, TOOL_LIFECYCLE_PHASE } = require('./codex-tool-lifecycle-contract');

function hasGeneratedImageFile(item) {
  return item?.type === 'Extension' && item.kind === 'image_gen.generation'
    && typeof item.fileId === 'string' && item.fileId.trim() !== '';
}

function imageFilePeer(raw) {
  if (raw.recordType === 'response_item') {
    if (raw.payloadType === 'function_call') {
      const { name, namespace } = raw.parsed.payload;
      return name === 'imagegen' && (namespace == null || namespace === 'image_gen');
    }
    return raw.payloadType === 'function_call_output' || raw.payloadType === 'image_generation_call';
  }
  return raw.recordType === 'event_msg' && ['image_generation_begin', 'image_generation_end'].includes(raw.payloadType);
}

// Pinned producer: rust-v0.160.0 protocol/src/items.rs and core/src/tools/events.rs.
// These are semantic views, never replacements for the persisted Raw record.
// Only tool types whose producer assigns id = call_id can join call groups.
function typedItemRecord(record, sessionId) {
  const p = record?.payload;
  if (record?.type !== 'event_msg' || p?.type !== 'item_completed') return null;
  if (p.thread_id != null && p.thread_id !== sessionId) return null;
  const i = p.item;
  if (!i || typeof i !== 'object' || Array.isArray(i) || typeof i.id !== 'string'
      || (!i.id && i.type !== 'Reasoning')) return null;
  let type = 'event_msg';
  let payload;
  const lifecycle = (family, name) => ({ ...i, type: `${family}_${['completed', 'failed', 'declined', 'interrupted'].includes(i.status) ? 'end' : 'update'}`, call_id: i.id, name });
  switch (i.type) {
    case 'CommandExecution':
      if (!Array.isArray(i.command) || !i.command.every((v) => typeof v === 'string')) return null;
      payload = lifecycle('exec_command', 'shell_command');
      break;
    case 'FileChange':
      if (!i.changes || typeof i.changes !== 'object' || Array.isArray(i.changes)) return null;
      payload = lifecycle('patch_apply', 'apply_patch');
      if (i.status === 'completed') payload.success = true;
      if (i.status === 'failed' || i.status === 'declined') payload.success = false;
      break;
    case 'McpToolCall':
      if (typeof i.server !== 'string' || typeof i.tool !== 'string') return null;
      payload = lifecycle('mcp_tool_call', `mcp__${i.server}__${i.tool}`);
      payload.invocation = { server: i.server, tool: i.tool, arguments: i.arguments };
      if (i.error || i.result?.isError === true) payload.status = 'failed';
      break;
    case 'DynamicToolCall':
      if (typeof i.tool !== 'string') return null;
      payload = lifecycle('dynamic_tool_call', i.namespace ? `${i.namespace}.${i.tool}` : i.tool);
      if (i.success === false || i.error) payload.status = 'failed';
      break;
    case 'CollabAgentToolCall': {
      const families = { spawn_agent: 'collab_agent_spawn', send_input: 'collab_agent_interaction', resume_agent: 'collab_agent_interaction', wait: 'collab_waiting', close_agent: 'collab_close' };
      if (!Object.hasOwn(families, i.tool)) return null;
      payload = lifecycle(families[i.tool], i.tool);
      break;
    }
    case 'SubAgentActivity':
      payload = { ...i, type: 'sub_agent_activity', event_id: i.id };
      break;
    case 'Extension':
      if (i.kind === 'image_gen.generation') {
        // 0.172's extension writer can keep an attachment-store ID on successful completion.
        const fileCompletion = i.status === 'completed' && hasGeneratedImageFile(i);
        if (typeof i.status !== 'string' || (typeof i.result !== 'string' && !fileCompletion)) return null;
        payload = { ...i, type: ['completed', 'failed'].includes(i.status) ? 'image_generation_end' : 'image_generation_call_update', call_id: i.id, name: 'image_generation', revised_prompt: i.revisedPrompt, saved_path: i.savedPath };
        if (i.failure) payload.status = 'failed';
      } else if (i.kind === 'clock.sleep' && Number.isSafeInteger(i.durationMs) && i.durationMs >= 0) {
        // Requested duration is not elapsed execution time. Completion may be
        // an early activity wake-up; neither success nor elapsed is inferred.
        payload = { ...i, type: 'dynamic_tool_call_end', call_id: i.id, name: 'clock.sleep', status: 'completed' };
      } else if (i.kind === 'web.search' && typeof i.query === 'string') {
        payload = { ...i, type: 'dynamic_tool_call_end', call_id: i.id, name: 'web.run', status: 'completed',
          action: i.action ? { ...i.action, type: { openPage: 'open_page', findInPage: 'find_in_page' }[i.action.type] || i.action.type } : null };
      } else return null;
      break;
    case 'UserMessage':
      if (!Array.isArray(i.content)) return null;
      type = 'response_item';
      payload = { ...i, type: 'message', role: 'user', content: i.content.map((part) => part?.type === 'text' ? { ...part, type: 'input_text' } : part?.type === 'image' ? { ...part, type: 'input_image' } : part) };
      break;
    case 'AgentMessage':
      // Existing canonical async correlation retains its distinct provenance.
      if (i.delivery === 'async' || !Array.isArray(i.content)) return null;
      type = 'response_item';
      payload = { ...i, type: 'message', role: 'assistant', content: i.content.filter((part) => part?.type === 'Text' && typeof part.text === 'string').map((part) => ({ type: 'output_text', text: part.text })) };
      break;
    case 'Reasoning':
      if (!Array.isArray(i.summary_text) || !i.summary_text.every((v) => typeof v === 'string')
          || (i.raw_content != null && !Array.isArray(i.raw_content))) return null;
      type = 'response_item';
      payload = { ...i, type: 'reasoning', summary: i.summary_text.map((text) => ({ type: 'summary_text', text })), content: (i.raw_content || []).filter((v) => typeof v === 'string').map((text) => ({ type: 'reasoning_text', text })) };
      break;
    case 'FunctionCallOutput':
      type = 'response_item';
      payload = { ...i, type: 'function_call_output', call_id: null };
      break;
    case 'ContextCompaction':
      payload = { type: 'context_compacted' };
      break;
    default:
      return null;
  }
  return { ...record, type, payload: { ...payload, ...(typeof p.turn_id === 'string' ? { turn_id: p.turn_id } : {}) } };
}

function semanticRaw(raw) {
  const record = typedItemRecord(raw?.parsed, raw?.sessionId);
  if (!record) return raw;
  return { ...raw, recordType: record.type, payloadType: record.payload.type,
    canonicalType: record.payload.type, parsed: record,
    typedItemType: raw.parsed.payload.item.type, originalRaw: raw };
}

function transportTurnMatches(row, turnId) {
  const recorded = row.payloadType === 'dynamic_tool_call_request' ? row.parsed.payload.turnId : row.turnId;
  return !turnId || typeof recorded !== 'string' || !recorded || recorded === turnId;
}

function turnBoundaryEpochs(rawEvents) {
  const epochs = new Map();
  let epoch = { number: 0, turnId: '' };
  let turnId = '';
  for (const raw of rawEvents) {
    // A transport message names the turn of its invocation, even if it arrives later.
    if (isDynamicTransport(raw)) {
      epochs.set(raw.rawId, epoch);
      continue;
    }
    const boundary = ['task_started', 'task_complete', 'turn_aborted'].includes(raw.canonicalType);
    const turnScope = raw.canonicalType === 'task_started' || raw.recordType === 'turn_context';
    if (boundary || (turnId && raw.turnId && raw.turnId !== turnId)) {
      epoch = { number: epoch.number + 1, turnId: turnScope ? raw.turnId : '' };
    } else if (turnScope && raw.turnId && epoch.turnId !== raw.turnId) {
      epoch = { number: epoch.number, turnId: raw.turnId };
    }
    if (raw.turnId) turnId = raw.turnId;
    epochs.set(raw.rawId, epoch);
  }
  return epochs;
}

// codex-mcp/src/tools.rs prefixes an environment-qualified callable namespace
// with the first twelve hex digits of SHA-1(environment). Connector aliases,
// sanitized names and collision suffixes need separate registration evidence.
const scopedToolNamespace = /^(?:mcp__)?([a-f0-9]{12})__([A-Za-z0-9_]+)$/;

function scopedRequestToolName(raw) {
  if (raw?.recordType !== 'response_item' || !['function_call', 'custom_tool_call'].includes(raw.payloadType)) return '';
  const call = raw.parsed?.payload;
  if (typeof call?.namespace !== 'string' || typeof call.name !== 'string'
      || call.namespace.length + 2 + call.name.length > 128
      || !scopedToolNamespace.test(call.namespace)
      || !/^[A-Za-z0-9_]+$/.test(call.name)) return '';
  return `${call.namespace}__${call.name}`;
}

// null means the registration cannot be checked; false means a different registration.
function matchesScopedMcpCall(raw, server, tool, environmentId) {
  const call = raw.parsed.payload;
  if (call.type !== 'function_call'
      || typeof call.namespace !== 'string' || call.namespace.length + 2 + call.name.length > 128) return null;
  const registration = scopedToolNamespace.exec(call.namespace);
  if (!registration) return null;
  const knownServer = typeof server === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(server);
  const knownTool = typeof tool === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(tool);
  if ((knownServer && registration[2] !== server) || (knownTool && call.name !== tool)) return false;
  if (typeof environmentId !== 'string' || !environmentId || environmentId.length > 4096) return null;
  const scope = createHash('sha1').update(environmentId).digest('hex').slice(0, 12);
  if (registration[1] !== scope) return false;
  return knownServer && knownTool ? true : null;
}

function matchesToolOutput(call, row) {
  if (row.recordType !== 'response_item' || row.payloadType !== call.payloadType + '_output') return false;
  const { name, namespace } = row.parsed.payload;
  const request = call.parsed.payload;
  return (name == null || name === request.name)
    && (namespace == null || (namespace === '' ? 'functions' : namespace) === (request.namespace || 'functions'));
}

function dynamicNamespace(namespace) {
  return namespace == null || namespace === 'functions' ? '' : namespace;
}

function matchesDynamicIdentity(call, tool, namespace) {
  const request = call.parsed.payload;
  const requestedScope = dynamicNamespace(request.namespace);
  const registeredScope = dynamicNamespace(namespace);
  if (typeof requestedScope !== 'string' || typeof registeredScope !== 'string') return null;
  if (requestedScope && typeof namespace === 'string' && requestedScope !== registeredScope) return false;
  if (typeof request.name !== 'string' || typeof tool !== 'string' || !tool) return null;
  if (requestedScope === registeredScope) return request.name === tool;
  // Older calls carried the entire qualified name in the default namespace.
  if (requestedScope || !registeredScope || request.name !== registeredScope + '.' + tool) return false;
  return registeredScope.includes('.') || tool.includes('.') ? null : true;
}

function matchesDynamicTool(call, row) {
  const { name, namespace } = call.parsed.payload;
  const { tool_name: tool, namespace: recordedNamespace } = row.parsed.payload;
  if (typeof name !== 'string' || (namespace != null && typeof namespace !== 'string')) return null;
  if (typeof recordedNamespace === 'string' && dynamicNamespace(recordedNamespace) !== dynamicNamespace(namespace)) return false;
  if ((recordedNamespace != null && typeof recordedNamespace !== 'string') || typeof tool !== 'string' || !tool) return null;
  return tool === (namespace && namespace !== 'functions' ? namespace + '.' + name : name);
}

function scopedLegacyMcpStatus(call, row) {
  const p = row.parsed?.payload;
  const invocation = p?.invocation;
  if (!invocation || !matchesScopedMcpCall(call, invocation.server, invocation.tool, invocation.environment_id)) return '';
  return legacyMcpStatus(p);
}

function legacyMcpStatus(p) {
  if (p.type === 'mcp_tool_call_declined') return 'declined';
  if (['mcp_tool_call_begin', 'mcp_tool_call_update', 'mcp_tool_call_delta'].includes(p.type)) return 'incomplete';
  if (p.type !== 'mcp_tool_call_end') return '';
  // McpToolCallEndEvent::is_success (0.172.0) reads the tagged Result.
  const result = p.result;
  if (!result || typeof result !== 'object' || Object.keys(result).length !== 1) return '';
  if (typeof result.Err === 'string') return 'failed';
  if (!Array.isArray(result.Ok?.content) || (result.Ok.isError != null && typeof result.Ok.isError !== 'boolean')) return '';
  return result.Ok.isError === true ? 'failed' : 'success';
}

function toolTurnStamp(row) {
  if (row.recordType === 'response_item' && ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(row.payloadType)) {
    return row.parsed.payload.internal_chat_message_metadata_passthrough?.turn_id;
  }
}

function followsToolRequest(call, row, epochs) {
  const epoch = epochs.get(call.rawId);
  const rowEpoch = epochs.get(row.rawId);
  if (row.line <= call.line || row.sessionId !== call.sessionId || rowEpoch?.number !== epoch?.number
      || (row.turnId && call.turnId && row.turnId !== call.turnId)) return false;
  const callStamp = toolTurnStamp(call);
  const rowStamp = toolTurnStamp(row);
  if (callStamp == null && rowStamp == null) return true;
  // Codex preserves a nonempty turn stamp during replay. A copied receipt
  // cannot change the surrounding epoch or compete with a local receipt.
  const turn = epoch?.turnId || rowEpoch?.turnId || call.turnId || row.turnId || callStamp || rowStamp;
  return [call.turnId, row.turnId, callStamp, rowStamp].every(id => id == null || id === '' || (typeof id === 'string' && id === turn));
}

function toolPeersInTurn(call, group, epochs, identify) {
  const peers = group.filter(row => followsToolRequest(call, row, epochs))
    .map(row => matchesToolOutput(call, row) ? row : identify(call, row)).filter(Boolean);
  // A fragment may start without a turn boundary. Only an independently
  // admitted terminal can supply the missing turn for a stamped receipt.
  const terminalTurns = new Set(peers.filter(row => row.turnId && row.recordType === 'event_msg'
    && toolLifecycleDescriptorFor(row.payloadType)?.phase === TOOL_LIFECYCLE_PHASE.TERMINAL).map(row => row.turnId));
  if (!terminalTurns.size) return peers;
  return peers.filter(row => {
    const stamp = toolTurnStamp(row);
    return !stamp || (terminalTurns.size === 1 && terminalTurns.has(stamp));
  });
}

// match is false for an identified foreign owner and null for an unresolved identity.
function scopedLifecycleCarrier(call, row, scopedFunction, singleRequest) {
  const p = row.parsed.payload;
  const item = p.item;
  if (row.payloadType === 'item_completed') {
    if (item?.id !== call.callId) return null;
    let family, match, status;
    if (scopedFunction && item.type === 'McpToolCall') {
      family = TOOL_LIFECYCLE_FAMILY.MCP_TOOL;
      match = matchesScopedMcpCall(call, item.server, item.tool, item.environmentId);
      if (['completed', 'failed'].includes(item.status)) status = row.status === 'failed' ? 'failed' : 'success';
    } else if (item.type === 'DynamicToolCall') {
      family = TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL;
      match = matchesDynamicIdentity(call, item.tool, item.namespace);
      if (['completed', 'failed', 'declined', 'interrupted'].includes(item.status)) status = dynamicOutcome(item);
      if (item.status === 'in_progress') status = '';
    } else return null;
    if (p.thread_id != null && p.thread_id !== call.sessionId) match = false;
    // A lone historical dynamic request already has the physical session and
    // turn checked by followsToolRequest. Cross-channel joins need explicit IDs.
    const explicitIds = p.thread_id === call.sessionId && typeof p.turn_id === 'string' && p.turn_id.length > 0;
    const canJoin = explicitIds || (singleRequest && item.type === 'DynamicToolCall');
    if (match !== false && status == null) match = null;
    return { row, family, match, status, typed: true, canJoin };
  }
  const descriptor = toolLifecycleDescriptorFor(row.payloadType);
  const terminal = descriptor?.phase === TOOL_LIFECYCLE_PHASE.TERMINAL;
  if (scopedFunction && descriptor?.family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL) {
    const i = p.invocation;
    const match = matchesScopedMcpCall(call, i?.server, i?.tool, i?.environment_id);
    const status = terminal ? legacyMcpStatus(p) : '';
    return { row, family: descriptor.family, match: match && terminal && !status ? null : match, status };
  }
  if (descriptor?.family !== TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL) return null;
  return { row, family: descriptor.family, match: matchesDynamicTool(call, row), status: terminal ? dynamicOutcome(p) : '' };
}

function collaborationThreadId(value) {
  // ThreadId::from_string uses uuid 1.20's simple, hyphenated, braced and URN formats.
  if (typeof value !== 'string') return null;
  if (/^[0-9a-f]{32}$/i.test(value)) return value.toLowerCase();
  let hyphenated = value;
  if (value.startsWith('urn:uuid:')) hyphenated = value.slice(9);
  else if (value.startsWith('{') && value.endsWith('}')) hyphenated = value.slice(1, -1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hyphenated)) return null;
  return hyphenated.replaceAll('-', '').toLowerCase();
}

function recordedCommandDirectory(value) {
  if (typeof value !== 'string' || !value.startsWith('file:')) return value;
  try {
    const url = new URL(value);
    if (url.search || url.hash) return '';
    return fileURLToPath(url, { windows: Boolean(url.hostname) || /^\/[A-Za-z]:\//.test(url.pathname) });
  } catch { return ''; }
}

function sameCommandDirectory(left, right) {
  if (typeof left !== 'string' || !left || typeof right !== 'string' || !right) return null;
  if (left === right) return true;
  const a = recordedCommandDirectory(left), b = recordedCommandDirectory(right);
  return sameRecordedPath(a, a) && sameRecordedPath(b, b) ? sameRecordedPath(a, b) : null;
}

function commandMatches(args, name, item) {
  const argv = item.command;
  if (!args || !Array.isArray(argv) || !argv.length || !argv.every(arg => typeof arg === 'string')) return false;
  if ([args.workdir, args.cwd].some(cwd => cwd != null && sameCommandDirectory(cwd, item.cwd) !== true)) return false;
  if (item.exit_code != null && (!Number.isInteger(item.exit_code) || item.exit_code < -2147483648 || item.exit_code > 2147483647
      || (item.status === 'completed' && item.exit_code !== 0) || (item.status === 'failed' && item.exit_code === 0))) return false;
  if (name === 'shell') return item.source === 'agent' && Array.isArray(args.command)
    && args.command.length === argv.length && args.command.every((arg, i) => arg === argv[i]);
  const exec = name === 'exec_command';
  if ((!exec && name !== 'shell_command') || item.source !== (exec ? 'unified_exec_startup' : 'agent')) return false;
  const command = exec ? args.cmd : args.command;
  if (typeof command !== 'string' || !command) return false;
  if (args.shell != null && args.shell !== argv[0]) return false;
  if (argv.every(arg => /^[A-Za-z0-9_./:-]+$/.test(arg)) && argv.join(' ') === command) return true;
  // core/src/shell.rs::derive_exec_args preserves the command as one argument.
  if (argv.at(-1) !== command) return false;
  const shell = argv[0].split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/, '');
  if (['sh', 'bash', 'zsh'].includes(shell)) return argv.length === 3 && ['-c', '-lc'].includes(argv[1]);
  if (shell === 'cmd') return argv.length === 3 && argv[1] === '/c';
  return ['powershell', 'pwsh'].includes(shell)
    && ((argv.length === 3 && argv[1] === '-Command') || (argv.length === 4 && argv[1] === '-NoProfile' && argv[2] === '-Command'));
}

function waitMatches(args, item, sessionId) {
  if (item.tool !== 'wait' || item.sender_thread_id !== sessionId || !collaborationThreadId(sessionId)
      || !Array.isArray(args?.targets) || !args.targets.length) return false;
  const targets = new Set(args.targets.map(collaborationThreadId));
  // multi_agents/wait.rs can finish for a subset of the requested targets.
  if (targets.has(null) || !Array.isArray(item.receiver_thread_ids)
      || !item.receiver_thread_ids.every(id => targets.has(collaborationThreadId(id)))) return false;
  const returned = new Set(item.receiver_thread_ids.map(collaborationThreadId));
  // A V1 timeout completes with an explicitly empty state map and no returned threads.
  if (!returned.size && item.agents_states == null) return false;
  if (item.agents_states != null) {
    const states = item.agents_states;
    if (!states || typeof states !== 'object' || Array.isArray(states) || Object.keys(states).length !== returned.size
        || !Object.keys(states).every(id => returned.has(collaborationThreadId(id)))) return false;
    // multi_agents/wait.rs::wait_tool_call_status derives the terminal from these states.
    const failed = Object.values(states).some(state => state === 'not_found' || (state && typeof state.errored === 'string'));
    if (item.status !== (failed ? 'failed' : 'completed')) return false;
  }
  return (item.receiver_agents === undefined || (Array.isArray(item.receiver_agents)
      && item.receiver_agents.every(agent => returned.has(collaborationThreadId(agent?.thread_id)))));
}

function patchPath(value, cwd) {
  if (!cwd || !sameRecordedPath(cwd, cwd) || typeof value !== 'string' || !value) return value;
  const api = fsPathApi(cwd);
  if (value.split(api.sep === '\\' ? /[\\/]/ : '/').includes('..')) return value;
  if (api.isAbsolute(value)) return api.normalize(value);
  if (/^(?:[A-Za-z]:|[\\/])/.test(value)) return value;
  return api.join(cwd, value);
}

function patchMatches(input, changes, cwd) {
  if (typeof input !== 'string' || !changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
  const lines = input.replaceAll('\r\n', '\n').trimEnd().split('\n');
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') return false;
  const byPath = new Map(Object.entries(changes).map(([path, change]) => [patchPath(path, cwd), change]));
  if (byPath.size !== Object.keys(changes).length) return false;
  const seen = new Set();
  for (let i = 0; i < lines.length;) {
    const header = /^\*\*\* (Add|Delete|Update) File: (.+)$/.exec(lines[i++]);
    if (!header) return false;
    const path = patchPath(header[2], cwd);
    if (seen.has(path) || !byPath.has(path)) return false;
    seen.add(path);
    const change = byPath.get(path);
    if (change?.type !== header[1].toLowerCase()) return false;
    const move = change.type === 'update' && lines[i]?.startsWith('*** Move to: ') ? lines[i++].slice('*** Move to: '.length) : null;
    if (patchPath(change.move_path ?? null, cwd) !== patchPath(move, cwd)) return false;
    const start = i;
    while (i < lines.length && !lines[i].startsWith('*** ')) i++;
    const body = lines.slice(start, i);
    if (change.type === 'add' && (!body.every(line => line.startsWith('+'))
        || body.map(line => line.slice(1) + '\n').join('') !== change.content)) return false;
    if (change.type === 'delete' && (body.length || typeof change.content !== 'string')) return false;
    if (change.type === 'update') {
      if (typeof change.unified_diff !== 'string') return false;
      const diff = change.unified_diff.split(/\r?\n/);
      const hunk = diff.findIndex(line => line.startsWith('@@'));
      // Compare unanchored hunks including their context. Extra context, rewritten
      // hunks or unrelated edits do not establish byte-comparable patch identity.
      if (body.some(line => !/^(?:[ +\-]|@@$)/.test(line))) return false;
      const expected = body.filter(line => line !== '@@');
      const actual = (hunk < 0 ? diff : diff.slice(hunk)).filter(line => /^[ +\-]/.test(line));
      if ((!move && !expected.some(line => /^[+-]/.test(line))) || expected.length !== actual.length
          || !expected.every((line, j) => line === actual[j])) return false;
      if (lines[i] === '*** End of File') i++;
    }
  }
  return seen.size > 0 && seen.size === Object.keys(changes).length;
}

const nativeItemTypes = new Set(['CommandExecution', 'FileChange', 'CollabAgentToolCall']);

// Only the opposite wire channel of a scoped request uses these stronger checks.
function nativeTypedRequestMatches(call, item, patchCwd) {
  const p = call.parsed.payload;
  const native = p.namespace == null || p.namespace === '' || p.namespace === 'functions';
  if (typeof p.name !== 'string' || !['completed', 'failed', 'declined'].includes(item.status)) return false;
  const name = p.name.replace(/^functions\./, '');
  if (item.type === 'FileChange') return native && p.type === 'custom_tool_call' && name === 'apply_patch' && patchMatches(p.input, item.changes, patchCwd);
  if (p.type !== 'function_call') return false;
  const args = uniqueArguments(p.arguments);
  if (item.type === 'CommandExecution') return native && commandMatches(args, name, item);
  return item.type === 'CollabAgentToolCall' && ['completed', 'failed'].includes(item.status) && p.name === 'wait_agent'
    && p.namespace === 'multi_agent_v1' && waitMatches(args, item, call.sessionId);
}

// Only exclude a second candidate when a recorded identity field rules it out.
// Malformed fields and incomplete identities can still dispute a verified item.
function foreignNativeCarrier(call, item, other, patchCwd) {
  if (item.type === 'CommandExecution') {
    const args = uniqueArguments(call.parsed.payload.arguments);
    return (['agent', 'user_shell', 'unified_exec_startup', 'unified_exec_interaction'].includes(other.source) && other.source !== item.source)
      || [args.workdir, args.cwd].some(cwd => sameCommandDirectory(other.cwd, cwd) === false)
      || (Array.isArray(other.command) && other.command.length && other.command.every(arg => typeof arg === 'string')
        && !nativeTypedRequestMatches(call, { ...item, command: other.command }));
  }
  if (item.type === 'CollabAgentToolCall') {
    if (['spawn_agent', 'send_input', 'resume_agent', 'close_agent', 'send_message', 'followup_task', 'interrupt_agent', 'list_agents'].includes(other.tool)) return true;
    if (collaborationThreadId(other.sender_thread_id) && other.sender_thread_id !== item.sender_thread_id) return true;
    const targets = new Set(uniqueArguments(call.parsed.payload.arguments).targets.map(collaborationThreadId));
    const outside = id => collaborationThreadId(id) !== null && !targets.has(collaborationThreadId(id));
    return (Array.isArray(other.receiver_thread_ids) && other.receiver_thread_ids.some(outside))
      || (Array.isArray(other.receiver_agents) && other.receiver_agents.some(agent => outside(agent?.thread_id)))
      || (other.agents_states && Object.keys(other.agents_states).some(outside));
  }
  if (!other.changes || typeof other.changes !== 'object' || Array.isArray(other.changes)) return false;
  const known = new Map(Object.entries(item.changes).map(([key, change]) => [patchPath(key, patchCwd), change]));
  return Object.entries(other.changes).some(([key, change]) => {
    if (!key || !['add', 'update', 'delete'].includes(change?.type)) return false;
    const path = patchPath(key, patchCwd);
    const expected = known.get(path);
    if (expected) return expected.type !== change.type || (change.type === 'add' && typeof change.content === 'string' && change.content !== expected.content);
    // An absolute and a relative key might still refer to the same file if cwd is missing.
    return [...known.keys()].every(value => fsPathApi(value).isAbsolute(value) === fsPathApi(path).isAbsolute(path));
  });
}

function resolveNativeTypedTerminal(requests, group, epochs, views, remainingToolPeer, patchCwds) {
  if (requests.length !== 2 || requests[0].payloadType === requests[1].payloadType) return;
  const independent = requests.filter(call => !scopedRequestToolName(call));
  if (independent.length !== 1) return;
  const call = independent[0];
  const patchCwd = patchCwds.get(call);
  const peers = group.filter(row => followsToolRequest(call, row, epochs));
  const typed = peers.filter(row => row.recordType === 'event_msg' && row.payloadType === 'item_completed'
    && nativeItemTypes.has(row.parsed.payload.item?.type) && row.parsed.payload.item.id === call.callId
    && (row.parsed.payload.thread_id == null || row.parsed.payload.thread_id === call.sessionId));
  const candidates = typed.filter(row => {
    const p = row.parsed.payload;
    return p.thread_id === call.sessionId && typeof p.turn_id === 'string' && p.turn_id.length > 0 && nativeTypedRequestMatches(call, p.item, patchCwd);
  });
  if (!candidates.length) return;
  const raw = candidates[0];
  const item = raw.parsed.payload.item;
  const view = semanticRaw(raw);
  if (view === raw) return;
  const family = toolLifecycleDescriptorFor(view.payloadType).family;
  const terminals = [];
  for (const row of peers) {
    const descriptor = toolLifecycleDescriptorFor(row.payloadType);
    if (descriptor?.phase !== TOOL_LIFECYCLE_PHASE.TERMINAL || !remainingToolPeer?.(call, row)) continue;
    const p = row.parsed.payload;
    if (descriptor.family === family && foreignNativeCarrier(call, item, p, patchCwd)) views.set(row, { ...row, detachedNativeTerminal: true });
    else terminals.push(row);
  }
  // A registered dynamic tool may use the same callable name as a native tool.
  const dynamicPeers = call.payloadType === 'function_call' ? peers.filter(row => {
    if (row.recordType !== 'event_msg') return false;
    const p = row.parsed.payload;
    if (row.payloadType === 'item_completed' && p.item?.type === 'DynamicToolCall') {
      return (p.thread_id == null || p.thread_id === call.sessionId) && matchesDynamicIdentity(call, p.item.tool, p.item.namespace) !== false;
    }
    if (isDynamicTransport(row)) {
      return transportTurnMatches(row, call.turnId || raw.turnId) && matchesDynamicIdentity(call, p.tool, p.namespace) !== false;
    }
    return toolLifecycleDescriptorFor(row.payloadType)?.family === TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL && matchesDynamicTool(call, row) !== false;
  }) : [];
  const disputed = candidates.length > 1 || typed.some(row => row !== raw && row.parsed.payload.item.type === item.type
    && !foreignNativeCarrier(call, item, row.parsed.payload.item, patchCwd)) || terminals.length > 1
    || dynamicPeers.length > 0
    || terminals.some(row => {
      const p = row.parsed.payload;
      const status = row.payloadType.endsWith('_declined') ? 'declined' : p.status
        || (typeof p.success === 'boolean' ? (p.success ? 'completed' : 'failed') : null);
      return toolLifecycleDescriptorFor(row.payloadType).family !== family || (status != null && status !== item.status)
        || (item.type === 'CommandExecution' && sameCommandDirectory(p.cwd, item.cwd) === false)
        || (item.type === 'FileChange' && p.changes && !isDeepStrictEqual(p.changes, item.changes))
        || (item.type === 'CollabAgentToolCall' && p.statuses && !isDeepStrictEqual(p.statuses, item.agents_states))
        || (typeof item.exit_code === 'number' && typeof p.exit_code === 'number' && item.exit_code !== p.exit_code);
    });
  if (disputed) {
    for (const row of [...terminals, ...dynamicPeers]) views.set(row, { ...row, detachedNativeTerminal: true });
    return;
  }
  views.set(raw, view);
}

// Compare physical carriers before projecting either format into a logical event.
function resolveScopedTerminals(group, epochs, views, remainingToolPeer, patchCwds) {
  const requests = group.filter(row => row.recordType === 'response_item' && ['function_call', 'custom_tool_call'].includes(row.payloadType));
  resolveNativeTypedTerminal(requests, group, epochs, views, remainingToolPeer, patchCwds);
  const functions = requests.filter(row => row.payloadType === 'function_call');
  if (functions.length !== 1) return;
  const call = functions[0];
  const scopedFunction = Boolean(scopedRequestToolName(call));
  const peers = group.filter(row => followsToolRequest(call, row, epochs));
  const eligible = new Set(peers);
  const identified = new Set();
  const mcp = [];
  const dynamic = [];
  for (const row of group) {
    if (row.recordType !== 'event_msg') continue;
    const carrier = scopedLifecycleCarrier(call, row, scopedFunction, requests.length === 1);
    if (!carrier) continue;
    // Typed rows start in Protocol. Only a unique in-scope owner can claim one.
    if (carrier.typed) views.set(row, { ...row, callId: '' });
    if (!eligible.has(row) || carrier.match == null) continue;
    identified.add(row);
    if (carrier.match) {
      const family = carrier.family === TOOL_LIFECYCLE_FAMILY.MCP_TOOL ? mcp : dynamic;
      family.push(carrier);
    }
  }
  const competingFamilies = mcp.length > 0 && dynamic.length > 0;
  const custom = requests.length === 2 && requests.find(row => row.payloadType === 'custom_tool_call');
  for (const carriers of [mcp, dynamic]) {
    const terminals = carriers.filter(carrier => carrier.status);
    const typedItems = carriers.filter(carrier => carrier.typed);
    const outcomes = new Set(terminals.map(carrier => carrier.status));
    outcomes.delete('completed'); // A neutral receipt does not contradict a specific terminal.
    const disputed = outcomes.size > 1 || typedItems.length > 1
      || terminals.filter(carrier => !carrier.typed).length > 1;
    if (competingFamilies || disputed) {
      for (const { row } of competingFamilies ? carriers : terminals) views.set(row, { ...row, callId: '' });
      continue;
    }
    const typed = typedItems[0];
    if (!typed?.canJoin) continue;
    // A request or receipt has its own wire channel. Any remaining unidentified
    // lifecycle needs an independent owner before a typed terminal can join.
    const unresolved = peers.some(row => {
      if (identified.has(row)) return false;
      if (row.recordType === 'response_item' && ['custom_tool_call', 'custom_tool_call_output', 'function_call_output'].includes(row.payloadType)) return false;
      if (isDynamicTransport(row)) {
        // A transport mirror stays in Protocol. It can corroborate the identity
        // of a typed dynamic item, but cannot supply an outcome or attest MCP.
        const p = row.parsed.payload;
        if (!transportTurnMatches(row, call.turnId || typed.row.turnId)) return false;
        const match = matchesDynamicIdentity(call, p.tool, p.namespace);
        return match !== false && !(match && carriers === dynamic);
      }
      return !(custom && followsToolRequest(custom, row, epochs) && remainingToolPeer?.(custom, views.get(row) || row));
    });
    if (!unresolved) views.set(typed.row, semanticRaw(typed.row));
  }
}

function dynamicOutcome(p) {
  if (p.type === 'dynamic_tool_call_declined') return 'declined';
  if (p.status === 'declined' || p.status === 'interrupted') return p.status;
  if (p.success === false || p.error || p.status === 'failed') return 'failed';
  return p.success === true || p.status === 'success' ? 'success' : 'completed';
}

function dynamicToolPeer(call, row) {
  if (call.payloadType !== 'function_call' || row.recordType !== 'event_msg') return null;
  const phase = toolLifecycleDescriptorFor(row.payloadType);
  if (phase?.family !== TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL) return null;
  if (row.typedItemType !== 'DynamicToolCall' && !matchesDynamicTool(call, row)) return null;
  return phase.phase === TOOL_LIFECYCLE_PHASE.TERMINAL
    ? { ...row, dynamicTerminalStatus: dynamicOutcome(row.originalRaw?.parsed.payload.item || row.parsed.payload) } : row;
}

function scopedRequestPeer(call, row) {
  if (row.typedItemType === 'McpToolCall') return call.payloadType === 'function_call' ? row : null;
  if (matchesToolOutput(call, row)) return row;
  if (row.recordType !== 'event_msg') return null;
  const family = toolLifecycleDescriptorFor(row.payloadType)?.family;
  if (family === TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL) return dynamicToolPeer(call, row);
  if (family !== TOOL_LIFECYCLE_FAMILY.MCP_TOOL) return null;
  const status = scopedLegacyMcpStatus(call, row);
  return status ? { ...row, status } : null;
}

// Ambiguous repeated identities are inspectable Protocol records. Never choose
// one call owner from duplicate items, conflicting turns or copied histories.
function semanticRawEvents(rawEvents, remainingToolPeer) {
  const typedCounts = new Map();
  const byCall = new Map();
  const scopedCallIds = new Set();
  const ungroupedTyped = [];
  const epochs = turnBoundaryEpochs(rawEvents);
  const patchCwds = new Map();
  let sessionCwd = '', contextSession = '', turnCwd = '', contextEpoch;
  for (const raw of rawEvents) {
    const p = raw.parsed?.payload;
    if (raw.recordType === 'session_meta') {
      contextSession = p?.id;
      sessionCwd = p?.cwd;
      contextEpoch = null;
    } else if (raw.recordType === 'turn_context' && raw.sessionId === contextSession) {
      turnCwd = p?.cwd;
      contextEpoch = epochs.get(raw.rawId);
      if (turnCwd !== sessionCwd) sessionCwd = ''; // An older default no longer proves a later turn's cwd.
    } else if (raw.payloadType === 'custom_tool_call' && ['apply_patch', 'functions.apply_patch'].includes(p?.name)
        && raw.sessionId === contextSession) {
      patchCwds.set(raw, contextEpoch === epochs.get(raw.rawId) ? turnCwd : sessionCwd);
    }
    if (raw.callId) {
      if (!byCall.has(raw.callId)) byCall.set(raw.callId, []);
      byCall.get(raw.callId).push(raw);
      if (scopedRequestToolName(raw)) scopedCallIds.add(raw.callId);
    }
    const item = raw.parsed?.payload?.item;
    if (raw.payloadType !== 'item_completed' || typeof item?.id !== 'string') continue;
    const key = JSON.stringify([raw.sessionId, item.id]);
    typedCounts.set(key, (typedCounts.get(key) || 0) + 1);
    if (!raw.callId && raw.recordType === 'event_msg'
        && (['McpToolCall', 'DynamicToolCall'].includes(item.type) || nativeItemTypes.has(item.type))) ungroupedTyped.push(raw);
  }
  const scopedViews = new Map();
  // An incomplete item may have no semantic callId yet still compete for its
  // physical item.id. Keep it visible to scope and uniqueness checks.
  for (const raw of ungroupedTyped) {
    const id = raw.parsed.payload.item.id;
    if (scopedCallIds.has(id)) byCall.get(id).push(raw);
  }
  for (const id of scopedCallIds) resolveScopedTerminals(byCall.get(id), epochs, scopedViews, remainingToolPeer, patchCwds);
  return rawEvents.map((raw) => {
    if (scopedViews.has(raw)) return scopedViews.get(raw);
    // The recorded namespace distinguishes the request from a native namesake
    // even without a terminal. Only the separate join below can verify MCP status.
    const scopedName = scopedRequestToolName(raw);
    if (scopedName) return { ...raw, toolName: scopedName, scopedRequest: true };
    const view = semanticRaw(raw);
    if (view === raw) return raw;
    const key = JSON.stringify([raw.sessionId, raw.parsed.payload.item.id]);
    if (raw.parsed.payload.item.id && typedCounts.get(key) !== 1) return { ...raw, callId: '' };
    if (view.callId) {
      const peers = (byCall.get(view.callId) || []).filter((peer) => peer !== raw);
      const calls = peers.filter((peer) => peer.recordType === 'response_item' && ['function_call', 'custom_tool_call'].includes(peer.payloadType));
      if (calls.length > 1 || peers.some((peer) => peer.sessionId !== raw.sessionId
          || epochs.get(peer.rawId)?.number !== epochs.get(raw.rawId)?.number
          || (peer.turnId && view.turnId && peer.turnId !== view.turnId))) return { ...raw, callId: '' };
      const callName = calls[0]?.toolName;
      const item = raw.parsed.payload.item;
      if (hasGeneratedImageFile(item) && peers.some((peer) => !imageFilePeer(peer))) return { ...raw, callId: '' };
      if (item.type === 'McpToolCall' && item.environmentId != null && calls[0]?.parsed?.payload?.namespace != null) return { ...raw, callId: '' };
      if (scopedRequestToolName(calls[0]) && !(item.type === 'DynamicToolCall'
          && calls[0].parsed.payload.namespace === item.namespace && callName === item.tool)) {
        return { ...raw, callId: '' };
      }
      const compatible = !callName || callName === view.toolName
        || (item.type === 'CommandExecution' && ['shell', 'exec_command', 'write_stdin', 'functions.exec_command', 'functions.shell_command', 'functions.write_stdin'].includes(callName))
        || (item.type === 'FileChange' && callName === 'functions.apply_patch')
        || (item.type === 'CollabAgentToolCall' && item.tool === 'wait' && callName === 'wait_agent'
          && calls[0].parsed?.payload?.namespace === 'collaboration')
        || (item.type === 'Extension' && ((item.kind === 'clock.sleep' && callName === 'sleep') || (item.kind === 'web.search' && callName === 'run') || (item.kind === 'image_gen.generation' && ['imagegen', 'image_gen'].includes(callName))))
        || (item.type === 'DynamicToolCall' && callName === item.tool && (!calls[0].parsed?.payload?.namespace || calls[0].parsed.payload.namespace === item.namespace));
      if (!compatible) return { ...raw, callId: '' };
    }
    return view;
  });
}

// Startup evidence is deliberately separate from requested tool arguments.
// Only a unique attached, source-shaped started activity supplies settings.
// Pinned producer: rust-v0.162.0 protocol/src/protocol.rs and protocol/src/items.rs.
function resolvedSubAgentStartup(raws) {
  const calls = raws.filter((raw) => raw.recordType === 'response_item'
    && raw.payloadType === 'function_call' && raw.toolName === 'spawn_agent');
  if (calls.length !== 1) return null;
  const activities = raws.filter((raw) => raw.recordType === 'event_msg'
    && raw.payloadType === 'sub_agent_activity');
  if (activities.length !== 1) return null;
  const p = activities[0].parsed?.payload;
  if (p?.kind !== 'started' || p.event_id !== calls[0].callId
      || typeof p.agent_thread_id !== 'string' || !p.agent_thread_id) return null;
  const fields = ['agent_thread_id', 'agent_path', 'model', 'reasoning_effort'];
  if (!p.model && !p.reasoning_effort) return null;
  if (fields.some((key) => p[key] != null && (typeof p[key] !== 'string' || p[key].length > 512))) return null;
  for (const raw of raws) {
    if (raw.recordType !== 'response_item' || raw.payloadType !== 'function_call_output') continue;
    let output;
    try { output = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output; } catch { continue; }
    for (const child of [output?.agent_id, output?.new_thread_id]) {
      if (child != null && child !== p.agent_thread_id) return null;
    }
  }
  return Object.fromEntries(fields.filter((key) => typeof p[key] === 'string' && p[key])
    .map((key) => [key, p[key]]));
}

function additionalToolsSummary(payload) {
  // rust-v0.162.0 ResponseItem::AdditionalTools preserves arbitrary JSON.
  // Recognize only function/namespace shapes, leaving other entries in Raw.
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  const names = [];
  let count = 0;
  let visited = 0;
  let unsupported = 0;
  let incomplete = false;
  const visit = (items, prefix = '', depth = 0) => {
    for (const item of items) {
      if (++visited > 256) { incomplete = true; return; }
      if (!item || typeof item !== 'object' || Array.isArray(item)) { unsupported += 1; continue; }
      const name = typeof item.name === 'string' ? item.name.length > 160 ? `${item.name.slice(0, 159)}…` : item.name : '';
      const qualified = prefix && name ? `${prefix}.${name}` : name || prefix;
      if (item.type === 'namespace' && name && Array.isArray(item.tools)) {
        if (names.length < 24 && qualified) names.push(`${qualified} (namespace)`);
        if (depth < 4) visit(item.tools, qualified, depth + 1);
        else if (item.tools.length) incomplete = true;
      } else if (item.type === 'function' && name) {
        count += 1;
        if (names.length < 24 && qualified) names.push(qualified);
      } else unsupported += 1;
    }
  };
  visit(tools);
  return { valid: payload?.type === 'additional_tools' && payload.role === 'developer' && Array.isArray(payload.tools), entries: tools.length, count, names, unsupported, incomplete, shortened: incomplete || names.length >= 24 };
}

module.exports = { collaborationThreadId, typedItemRecord, semanticRaw, semanticRawEvents, turnBoundaryEpochs, resolvedSubAgentStartup, additionalToolsSummary, hasGeneratedImageFile, scopedRequestToolName, scopedRequestPeer, followsToolRequest, toolPeersInTurn, legacyMcpStatus, matchesToolOutput, dynamicToolPeer };
