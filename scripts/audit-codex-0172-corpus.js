'use strict';

// Local research tool. Prints only aggregate numbers and controlled labels.
// node scripts/audit-codex-0172-corpus.js [--inventory|--plain-mcp|--mcp-cells] [--root CODEX_HOME ...]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { isUtf8 } = require('node:buffer');
const { pipeline } = require('node:stream/promises');
const { parseRolloutArtifactIdentity } = require('../src/codex-rollout-history');

const MiB = 1024 ** 2;
const recordLimit = 32 * MiB;
const decodedFileLimit = 4 * 1024 * MiB;
const headerLimit = MiB;
const wordSet = (s) => new Set(s.trim().split(/\s+/));
const recordTypes = wordSet(`session_meta turn_context response_item event_msg realtime_item compacted dynamic_tools_updated
  inter_agent_communication inter_agent_communication_metadata token_usage_record world_state retained_context security_risk_score`);
const payloadTypes = wordSet(`
  task_started turn_started task_complete turn_complete turn_aborted turn_diff turn_reverted thread_rolled_back
  token_count token_usage_record user_message agent_message agent_reasoning agent_reasoning_raw_content
  exec_command_begin exec_command_end exec_command_update patch_apply_begin patch_apply_end
  mcp_tool_call_begin mcp_tool_call_end dynamic_tool_call_begin dynamic_tool_call_end dynamic_tools_updated
  item_started item_completed item_updated response_item message reasoning function_call function_call_output
  custom_tool_call custom_tool_call_output tool_search_call tool_search_output web_search_call local_shell_call
  image_generation_call image_generation_end image_generation_begin view_image_tool_call web_search_begin web_search_end
  entered_review_mode exited_review_mode approval_request_resolved exec_approval_request apply_patch_approval_request
  collab_agent_spawn_begin collab_agent_spawn_end collab_agent_interaction_begin collab_agent_interaction_end
  collab_waiting_begin collab_waiting_end collab_close_begin collab_close_end collab_resume_begin collab_resume_end
  context_compacted compaction_checkpoint compaction memory_trace encrypted_content configuration_update additional_tools
  session_configured thread_name_updated thread_goal_updated thread_settings_applied model_reroute error warning
  guardian_assessment auto_approval_review_request auto_approval_review_decision agent_message_delta plan_update
  realtime_session_started realtime_session_closed transcript_segment bem_item_promoted frame
  turn_input_accepted session_end_input_saved session_input_saved delivered_assistant_message
  realtime_conversation_started realtime_conversation_closed background_event shutdown_complete
  code_mode_result code_mode_execution code_mode_output code_mode_exec code_mode_wait code_mode_call code_mode_call_output
`);
const itemTypes = wordSet(`
  UserMessage AgentMessage AssistantMessage DeliveredAssistantMessage Reasoning Plan WebSearch WebSearchCall
  CommandExecution FileChange McpToolCall DynamicToolCall CollabAgentToolCall CollaborationToolCall
  ImageView ImageGeneration ContextCompaction EnteredReviewMode ExitedReviewMode HookPrompt FunctionCallOutput SubAgentActivity Extension
`);
const contentTypes = wordSet('input_text output_text input_image input_audio text Text image audio local_audio local_image item_reference skill mention reasoning_text encrypted_content');
const sourceTypes = wordSet('cli vscode exec app_server appServer api sdk tui desktop codex_cli_rs codex_exec codex_vscode codex_desktop Codex Desktop subagent review guardian guardian_review thread_spawn memory_consolidation compact other user agent assistant developer system tool attached side_chat sidechat sideChat attached_thread');
const fields = wordSet(`
  type role id source status originator cli_version history_mode ordinal timestamp metadata payload
  name namespace tool call_id cell_id item_id turn_id thread_id parent_turn_id root_turn_id parent_thread_id
  realtime_session_id context_window_id model_context_window forked_from_id subagent_history_start_ordinal
  history_base rollout_id end_byte_offset end_ordinal_exclusive thread_source source_thread_id sender_thread_id
  receiver_thread_id target_thread_id parent_session_id turn_attribution context_window thread_spawn subagent
  content_item_metadata history_sequence sampled_through_sequence retained_source delivered_assistant_message
  audio_references audio_order local_audio input_audio audio data file_id format path url
  frame sequence frame_sequence observed_at_ms final_frame_sequence input_source session_input_id
  token_usage_record last_usage_includes_reasoning total_token_usage last_token_usage usage info
  environment_id environment environments dynamic_tools tools dynamic_tools_updated
  arguments_truncated tool_calls_complete executed_tool_calls tool_result_metadata
  internal_chat_message_metadata_passthrough tool_calls output_index start_index argument_truncation
  moderation annotations logprobs settings thread_settings reasoning model model_provider service_tier
  approval_policy permissions sandbox_policy permission_profile model_provider_id mode collaboration_mode
  message content content_items text input output item arguments instructions base_instructions developer_instructions
  turn_context token_count replacement_history replacement_history_metadata inherited_user_message
  client_authored harness_authored_configuration fallback_token_limit_override author phase recipient
  turn_id_allocator item_id_allocator id_allocation inherited_context has_more attached_thread side_chat
  lineage owner_thread_id command result exit_code aggregated_output duration completed_at_ms started_at_ms
  cached_input_tokens reasoning_output_tokens input_tokens output_tokens total_tokens cache_write_input_tokens
  provenance harness_injected source_tool_namespace hook from_additional_requirements session_id response_id
  turn_token_usage thread_token_usage latest_token_usage_record resume_metadata first_window_id previous_window_id window_id window_number
  forked_from_ordinal_exclusive runtime_workspace_roots account_scoped creator_user_id creator_account_id
  delivery questions client_id trigger_turn other_recipients user_input_order accepted_at_ms acceptance_order invocation
  guardian_sources guardian_review_ids guardian_source_order_guidance guardian_retained_omissions guardian_history
  realtime_handoff realtime_session_input realtime_session_end_input retain_across_windows additional_context_tool_output
  tool_audio_budget_applied image_replay_sources mcp_resource_origins normal_model_slug spend_control_reached
  tool_result_sources executed_tool_calls_complete retained_context original_bytes max_bytes omitted_calls
`);
// Descend only through protocol containers. Never inspect tool arguments, output objects, schemas,
// user text, dynamic tool names, opaque annotations, filenames, map keys or base64 contents.
const nested = wordSet(`
  metadata item content content_items source subagent thread_spawn turn_attribution info total_token_usage
  last_token_usage token_usage_record usage content_item_metadata retained_source input_source
  internal_chat_message_metadata_passthrough executed_tool_calls tool_result_metadata frame
  thread_settings reasoning history_base replacement_history_metadata audio_references input_audio
  collaboration_mode permission_profile context_window provenance latest_token_usage_record turn_token_usage thread_token_usage
  guardian_sources realtime_handoff realtime_session_input id_allocation invocation replacement_history
`);
const watched = wordSet(`
  content_item_metadata history_sequence sampled_through_sequence retained_source delivered_assistant_message
  audio_references audio_order local_audio input_audio observed_at_ms final_frame_sequence token_usage_record
  last_usage_includes_reasoning environment_id arguments_truncated tool_calls_complete executed_tool_calls cell_id
  annotations logprobs moderation history_base turn_attribution root_turn_id parent_turn_id forked_from_id
  parent_thread_id subagent_history_start_ordinal context_window_id attached_thread side_chat
  forked_from_ordinal_exclusive runtime_workspace_roots account_scoped creator_user_id creator_account_id
  delivery questions trigger_turn user_input_order latest_token_usage_record id_allocation
  guardian_sources guardian_review_ids guardian_source_order_guidance guardian_retained_omissions guardian_history
  realtime_handoff realtime_session_input realtime_session_end_input retain_across_windows additional_context_tool_output
  tool_audio_budget_applied image_replay_sources mcp_resource_origins normal_model_slug spend_control_reached
  tool_result_sources tool_result_metadata executed_tool_calls_complete
`);
const provenanceTypes = wordSet('unknown user_configured developer_instructions skills agents_md harness tool user');
const retainedTypes = wordSet('accepted_file_audio verified_answer delivered_assistant_message');
const extensionKinds = wordSet('image_gen.generation clock.sleep web.search');
function label(value, allowed) {
  return value == null ? 'missing' : allowed.has(value) ? value : 'other';
}
function kind(value) {
  if (Array.isArray(value)) return value.length ? 'array' : 'emptyArray';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  return typeof value;
}
function bump(table, key, n = 1) {
  table[key] = (table[key] || 0) + n;
}
function day(value) {
  const match = typeof value === 'string' && /^(20\d\d-[01]\d-[0-3]\d)T/.exec(value);
  return match ? match[1] : null;
}
function includeDay(range, value) {
  if (!value) return;
  if (!range.first || range.first > value) range.first = value;
  if (!range.last || range.last < value) range.last = value;
}
function version(value) {
  // Release family, numeric components only; do not emit arbitrary build/prerelease identifiers.
  const m = typeof value === 'string' && /^(0\.\d{1,3}\.\d{1,3})([-+].*)?$/.exec(value);
  return m ? m[1] + (m[2] ? '-qualified' : '') : value == null ? 'missing' : 'other';
}
function identity(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
}
function scopeShape(value) {
  if (!value || typeof value !== 'object') return 'noContainer';
  return ['environmentId', 'environment_id'].map((key) => {
    const v = value[key];
    return key + '=' + (v === undefined ? 'absent' : v === null ? 'null' : typeof v === 'string' && v ? 'nonemptyString' : 'other');
  }).join('/');
}
function client(p) {
  if (p.source && typeof p.source === 'object') {
    if (Object.hasOwn(p.source, 'subagent')) {
      return p.source.subagent?.thread_spawn ? 'subagent.thread_spawn' : 'subagent.' + label(p.source.subagent, sourceTypes);
    }
    return 'otherObject';
  }
  return label(p.source, sourceTypes);
}
function inventory(homes) {
  const stats = { homes: homes.length, roots: {}, formats: {}, mtimeUtc: {}, filenameUtc: {}, anomalies: {} };
  const files = [];
  for (const home of homes) {
    for (const sub of ['sessions', 'archived_sessions']) {
      function visit(dir, topLevel) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) {
          bump(stats.anomalies, topLevel && error.code === 'ENOENT' ? 'missingRoot' : 'directoryReadError');
          return;
        }
        if (topLevel) bump(stats.roots, sub);
        for (const entry of entries) {
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) { bump(stats.anomalies, 'symlinkSkipped'); continue; }
          if (entry.isDirectory()) { visit(file, false); continue; }
          if (!entry.isFile()) continue;
          const format = entry.name.endsWith('.jsonl.zst') ? 'zstd' : entry.name.endsWith('.jsonl') ? 'plain' : 'other';
          if (format === 'other') { bump(stats.anomalies, 'otherFilename'); continue; }
          let stat;
          try { stat = fs.statSync(file); } catch { bump(stats.anomalies, 'statError'); continue; }
          const physical = parseRolloutArtifactIdentity(file);
          includeDay(stats.mtimeUtc, day(stat.mtime.toISOString()));
          includeDay(stats.filenameUtc, day(physical?.timestamp));
          if (!physical) bump(stats.anomalies, 'noncanonicalFilename');
          const summary = stats.formats[sub + '.' + format] ||= { files: 0, bytes: 0, maxBytes: 0 };
          summary.files++; summary.bytes += stat.size; summary.maxBytes = Math.max(summary.maxBytes, stat.size);
          files.push({ file, format, sub, stat, physical });
        }
      }
      visit(path.join(home, sub), true);
    }
  }
  return { stats, files };
}

function readStages(desc) {
  const streams = [fs.createReadStream(desc.file, { end: desc.stat.size - 1 })];
  if (desc.format === 'zstd') streams.push(zlib.createZstdDecompress({ chunkSize: 256 * 1024,
    params: { [zlib.constants.ZSTD_d_windowLogMax]: 27 } }));
  return streams;
}

async function inventoryVersions(files) {
  const counts = Object.create(null);
  const done = new Error('header inspected');
  for (const desc of files) {
    let bytes = 0, outcome = 'emptyFile';
    const chunks = [];
    const identify = () => {
      const line = Buffer.concat(chunks);
      const row = isUtf8(line) && JSON.parse(line.toString('utf8'));
      return row?.type === 'session_meta' ? version(row.payload?.cli_version) : 'otherHeader';
    };
    try {
      if (desc.stat.size) await pipeline(...readStages(desc), async function consume(stream) {
        for await (const chunk of stream) {
          const end = chunk.indexOf(10);
          const prefix = end < 0 ? chunk : chunk.subarray(0, end);
          bytes += prefix.length;
          if (bytes > headerLimit) { outcome = 'headerCap'; throw done; }
          chunks.push(prefix);
          if (end >= 0) { outcome = identify(); throw done; }
        }
        if (bytes) outcome = identify();
      });
    } catch (error) {
      if (error !== done) outcome = 'headerReadOrDecodeError';
    }
    bump(counts, outcome);
  }
  return counts;
}

function structure(value, container, context, s, present, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) {
    if (value.length > 128) bump(s.anomalies, 'nestedArraysCapped');
    for (let i = 0; i < Math.min(value.length, 128); i++) {
      structure(value[i], container + '[]', context, s, present, depth + 1);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) { bump(s.otherFieldOccurrences, container); continue; }
    const child = value[key];
    const childPath = container + '.' + key;
    bump(s.fieldOccurrences, childPath);
    if (watched.has(key)) present.add(context + ' ' + childPath + ' ' + kind(child));
    if (container.endsWith('executed_tool_calls[]') && key === 'arguments' && child
        && Object.hasOwn(child, '_codex_executed_tool_call_truncated')) {
      present.add('manifest.arguments.truncationMarker');
    }
    if (key === 'type' && (container.endsWith('.content[]') || container.endsWith('.content_items[]'))) {
      bump(s.contentElements, label(child, contentTypes));
    }
    if (nested.has(key)) structure(child, childPath, context, s, present, depth + 1);
  }
}
function readRecord(row, s, file) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) { bump(s.anomalies, 'invalidEnvelope'); return; }
  const record = label(row.type, recordTypes);
  const p = row.payload ?? {};
  const subtype = label(p.type, payloadTypes);
  const context = ['response_item', 'event_msg', 'realtime_item'].includes(record) ? record + '.' + subtype : record;
  bump(s.records, record); bump(s.contexts, context);
  includeDay(s.recordUtc, day(row.timestamp));
  for (const k of Object.keys(row)) bump(s.envelopeFields, fields.has(k) ? k : 'other');
  const present = new Set();
  structure(row.metadata, 'metadata', context, s, present);
  structure(p, 'payload', context, s, present);
  if (record === 'event_msg' && subtype === 'mcp_tool_call_end') bump(s.mcpScopeShapes, 'legacy.' + scopeShape(p.invocation));
  // Inspect only the type and representation of top-level tool-output audio parts.
  if (record === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(subtype) && Array.isArray(p.output)) {
    if (p.output.length > 128) bump(s.anomalies, 'outputPartArraysCapped');
    for (const part of p.output.slice(0, 128)) {
      if (part?.type === 'input_audio') {
        present.add(context + ' payload.output[].type input_audio');
        for (const field of ['file_id', 'input_audio', 'audio_url', 'data', 'path']) {
          if (Object.hasOwn(part, field)) present.add(context + ' payload.output[].' + field + ' ' + kind(part[field]));
        }
      }
    }
  }
  if (record === 'event_msg' && ['item_started', 'item_completed'].includes(subtype)) {
    const type = label(p.item?.type, itemTypes);
    if (type === 'McpToolCall') bump(s.mcpScopeShapes, subtype + '.McpToolCall.' + scopeShape(p.item));
    bump(s.canonicalItems, subtype + '.' + type);
    if (type === 'Extension') {
      const extension = label(p.item?.kind, extensionKinds);
      bump(s.extensionKinds, extension);
      if (extension === 'image_gen.generation') {
        const hasString = (k) => typeof p.item[k] === 'string' && p.item[k].length > 0;
        const shape = (hasString('fileId') ? 'fileId' : 'noFileId') + '.' + (hasString('result') ? 'result' : 'noResult');
        present.add('canonical.Extension.image_gen.generation.' + shape);
      }
    }
    if (type === 'AgentMessage' && p.item.delivery === 'async') present.add('canonical.AgentMessage.async');
    if (type === 'DeliveredAssistantMessage') present.add('canonical.DeliveredAssistantMessage');
    const id = identity(p.item?.id);
    if (id && subtype === 'item_completed') {
      const key = JSON.stringify([identity(p.thread_id), identity(p.turn_id), id]);
      if (file.completed.has(key)) {
        bump(s.anomalies, 'sameFileRepeatedCompletedTuple');
        bump(s.repeatedCompletedByType, type);
      }
      file.completed.add(key);
    }
  }
  if (record === 'retained_context') bump(s.retainedTypes, label(p.type, retainedTypes));
  if (record === 'response_item' && ['message', 'agent_message'].includes(subtype)) {
    const role = label(p.role, sourceTypes);
    const parts = p.internal_chat_message_metadata_passthrough?.content_item_metadata;
    if (Array.isArray(parts)) {
      const categories = new Set();
      for (const part of parts.slice(0, 128)) {
        const fact = part?.provenance?.type !== undefined ? label(part.provenance.type, provenanceTypes)
          : part?.source_tool_namespace != null ? 'legacyToolNamespace'
          : typeof part?.harness_injected === 'boolean' ? 'legacyHarness' + part.harness_injected : 'unclassified';
        categories.add(fact);
        bump(s.provenanceElements, subtype + '.' + role + '.' + fact);
      }
      const aligned = Array.isArray(p.content) && parts.length === p.content.length;
      const combination = [subtype, role, aligned ? 'aligned' : 'unaligned', [...categories].sort().join('+') || 'empty'].join('.');
      bump(s.provenanceRecords, combination);
      file.provenance.add(combination);
    }
    if (subtype === 'agent_message') {
      bump(s.agentEnvelope, row.metadata?.history_sequence != null ? 'sequencedResponse' : 'unsequencedResponse');
      if (file.previous === 'inter_agent_communication_metadata') bump(s.agentEnvelope, 'agentResponseImmediatelyAfterSidecar');
    }
  }
  if (record === 'response_item' && row.metadata) {
    const seq = row.metadata.history_sequence, through = row.metadata.sampled_through_sequence;
    if (Number.isSafeInteger(seq)) {
      if (file.sequences.has(seq)) bump(s.anomalies, 'repeatedResponseHistorySequenceWithinFile');
      file.sequences.add(seq);
      if (Number.isSafeInteger(through)) file.watermarks.push(through);
    }
  }
  if (record === 'inter_agent_communication_metadata') {
    bump(s.agentEnvelope, file.previous === 'response_item.agent_message' ? 'sidecarImmediatelyAfterAgentResponse' : 'sidecarAfterOther');
  }
  file.previous = context;
  if (record === 'token_usage_record') {
    if (identity(p.response_id)) {
      if (file.responseIds.has(p.response_id)) bump(s.anomalies, 'repeatedTokenResponseIdWithinFile');
      file.responseIds.add(p.response_id);
    }
    const ownThread = identity(file.owner) && p.thread_id === file.owner;
    bump(s.tokenRecordOwnership, ownThread ? 'matchesFirstMetadataId' : 'differentOrMissingThreadId');
    if (identity(p.turn_id)) file.tokenTurnRefs.push(p.turn_id);
  }
  if (record === 'session_meta') {
    const v = version(p.cli_version);
    bump(s.allMetadataVersions, v);
    if (file.version === null) {
      file.version = v;
      file.client = client(p);
      file.mode = label(p.history_mode, modes);
      file.owner = identity(p.id);
      if (file.owner) bump(file.owners, file.owner);
      file.refs = [ ['forked_from_id', p.forked_from_id], ['parent_thread_id', p.parent_thread_id],
        ['thread_spawn.parent_thread_id', p.source?.subagent?.thread_spawn?.parent_thread_id] ]
        .filter(([, id]) => identity(id));
      bump(s.firstMetadataOriginators, label(p.originator, sourceTypes));
      bump(s.firstMetadataThreadSources, label(p.thread_source, sourceTypes));
      if (p.attached_thread === true) bump(s.attachedHeaders, [file.client, label(p.thread_source, sourceTypes),
        identity(p.forked_from_id) ? 'fork' : 'noFork', p.history_base ? 'base' : 'noBase',
        Number.isSafeInteger(p.forked_from_ordinal_exclusive) ? 'boundary' : 'noBoundary'].join('/'));
      for (const [k] of file.refs) bump(s.firstMetadataRelations, k);
    } else {
      bump(s.anomalies, 'additionalSessionMeta');
      if (v !== file.version) file.differentVersion = true;
    }
  }
  if (record === 'turn_context' || (record === 'event_msg' && ['turn_started', 'task_started'].includes(subtype))) {
    if (identity(p.turn_id)) file.turns.add(p.turn_id);
    for (const [k, value] of [['root_turn_id', p.root_turn_id], ['turn_attribution.root_turn_id', p.turn_attribution?.root_turn_id],
      ['turn_attribution.parent_turn_id', p.turn_attribution?.parent_turn_id]]) {
      if (identity(value)) file.turnRefs.push([k, value, p.turn_id]);
    }
  }
  if (Number.isSafeInteger(row.ordinal)) file.ordinals++;
  else file.noOrdinal++;
  if (record === 'response_item' && identity(p.call_id)) {
    if (['function_call', 'custom_tool_call'].includes(subtype)) file.calls.add(p.call_id);
    if (['function_call_output', 'custom_tool_call_output'].includes(subtype)) file.outputs.push(p.call_id);
  }
  if (!['session_meta', 'turn_context', 'event_msg', 'response_item', 'compacted'].includes(record)) present.add(context);
  for (const marker of present) {
    bump(s.markerRecords, marker); file.markers.add(marker);
  }
}
const modes = wordSet('legacy paginated');
function supplementalRecord(row, file) {
  const p = row?.payload;
  if (!p || typeof p !== 'object') return;
  if (row.type === 'event_msg' && p.type === 'mcp_tool_call_end') bump(file.observations, 'legacyMcpEnd.' + scopeShape(p.invocation));
  if (row.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'McpToolCall') {
    const shape = scopeShape(p.item);
    bump(file.observations, 'canonicalMcp.' + shape);
    if (identity(p.item.id)) file.mcpItems.push({ id: p.item.id, tool: identity(p.item.tool), shape });
    return;
  }
  if (row.type !== 'response_item') return;
  if (p.type === 'function_call') {
    const callId = identity(p.call_id);
    if (callId) {
      const ns = typeof p.namespace === 'string' ? p.namespace : '';
      const hashPrefix = /^(?:mcp__)?[0-9a-f]{12}__/.test(ns);
      file.functionCalls.set(callId, file.functionCalls.has(callId) ? null : { name: identity(p.name), hashPrefix });
      if (hashPrefix) bump(file.observations, 'functionCall.namespaceHashPrefix');
    }
    if (p.name === 'wait' || p.name === 'functions.wait') {
      let args = p.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = null; }
      }
      if (identity(args?.cell_id) && /^g[0-9]+:[0-9]+$/.test(args.cell_id)) {
        bump(file.observations, 'waitArgument.generationCellId');
        file.cellWaits.push(args.cell_id);
      } else if ((typeof args?.cell_id === 'string' && /^\d+$/.test(args.cell_id)) || Number.isSafeInteger(args?.cell_id)) {
        bump(file.observations, 'waitArgument.decimalCellId');
      }
    }
  } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
    const output = typeof p.output === 'string' ? p.output
      : Array.isArray(p.output) ? p.output.find((part) => ['input_text', 'text'].includes(part?.type))?.text : null;
    const receipt = typeof output === 'string' && /^Script running with cell ID (g[0-9]+:[0-9]+|[0-9]+)(?:\r?\n|$)/.exec(output);
    if (receipt && receipt[1].startsWith('g')) {
      bump(file.observations, 'output.generationCellRunningLine');
      file.cellReceipts.add(receipt[1]);
    } else if (receipt) {
      bump(file.observations, 'output.decimalCellRunningLine');
    }
  }
}

function summarizeSupplement(file, desc, s) {
  for (const cellId of file.cellWaits) bump(file.observations,
    file.cellReceipts.has(cellId) ? 'generationWait.receiptInFile' : 'generationWait.noReceiptInFile');
  for (const item of file.mcpItems) {
    const call = file.functionCalls.get(item.id);
    const join = call === undefined ? 'noCall' : call === null ? 'ambiguousCall' : call.name !== item.tool ? 'differentName'
      : call.hashPrefix ? 'nameAndHashNamespaceMatch' : 'nameMatches';
    bump(file.observations, 'mcpJoin.' + item.shape + '.' + join);
  }
  for (const [label, n] of Object.entries(file.observations)) {
    const key = desc.format + '.' + label;
    bump(s.supplementRecords, key, n);
    bump(s.supplementFiles, key);
  }
}
function counters() {
  return Object.fromEntries(('anomalies outcomes records contexts canonicalItems contentElements envelopeFields fieldOccurrences '
    + 'otherFieldOccurrences markerRecords markerFiles markerFileCohorts firstMetadataVersions allMetadataVersions '
    + 'firstMetadataClients firstMetadataOriginators firstMetadataModes firstMetadataRelations references fileCohorts recordUtc sizes '
    + 'provenanceElements provenanceRecords provenanceFiles repeatedCompletedByType agentEnvelope tokenRecordOwnership firstMetadataThreadSources attachedHeaders '
    + 'markerFileVersionBands extensionKinds retainedTypes mcpScopeShapes supplementRecords supplementFiles')
    .split(' ').map((key) => [key, Object.create(null)]));
}
async function scan(files, supplement = false) {
  const s = counters();
  const owners = Object.create(null);
  const threadRefs = [];
  for (const desc of files) {
    const f = { version: null, client: 'missing', mode: 'missing', owner: null, owners, refs: [], differentVersion: false,
      markers: new Set(), completed: new Set(), calls: new Set(), outputs: [], turns: new Set(), turnRefs: [], tokenTurnRefs: [],
      responseIds: new Set(), sequences: new Set(), watermarks: [], provenance: new Set(), ordinals: 0, noOrdinal: 0, previous: '', lines: 0,
      mcpItems: [], functionCalls: new Map(), cellReceipts: new Set(), cellWaits: [], observations: Object.create(null) };
    let chunks = [], bytes = 0, decoded = 0;
    const finishLine = () => {
      s.sizes.maxRecordBytes = Math.max(s.sizes.maxRecordBytes || 0, bytes);
      if (++f.lines > 250000) throw new Error('recordCountLimit');
      bump(s.sizes, bytes > 64 * MiB ? 'above64MiB' : bytes > recordLimit ? 'above32Through64MiB' : bytes > MiB ? 'above1Through32MiB' : 'through1MiB');
      if (bytes > recordLimit) bump(s.anomalies, 'oversizeRecord');
      else if (!bytes) bump(s.anomalies, 'blankLine');
      else {
        const line = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, bytes);
        if (!isUtf8(line)) bump(s.anomalies, 'invalidUtf8');
        else {
          let row;
          try { row = JSON.parse(line.toString('utf8')); } catch { bump(s.anomalies, 'invalidJson'); }
          if (row !== undefined) {
            if (supplement) supplementalRecord(row, f);
            else readRecord(row, s, f);
          }
        }
      }
      bytes = 0; chunks = [];
    };
    try {
      if (desc.stat.size) {
        await pipeline(...readStages(desc), async function consume(stream) {
          for await (const chunk of stream) {
            decoded += chunk.length;
            if (decoded > decodedFileLimit) throw new Error('decodedLimit');
            let start = 0;
            while (start < chunk.length) {
              const lf = chunk.indexOf(10, start);
              const end = lf < 0 ? chunk.length : lf;
              bytes += end - start;
              if (bytes <= recordLimit) chunks.push(chunk.subarray(start, end));
              else chunks = [];
              if (lf < 0) break;
              finishLine();
              start = lf + 1;
            }
          }
        });
        if (bytes) { bump(s.anomalies, 'tailWithoutLF'); finishLine(); }
      }
      bump(s.outcomes, 'readToInventoryEnd');
    } catch (error) {
      bump(s.outcomes, error.message === 'decodedLimit' ? 'decodedFileCap' : error.message === 'recordCountLimit' ? 'recordCountCap' : 'readDecodeOrProcessingError');
    }
    try {
      const after = fs.statSync(desc.file);
      if (after.size !== desc.stat.size || after.mtimeMs !== desc.stat.mtimeMs || after.ino !== desc.stat.ino) bump(s.anomalies, 'changedSinceInventory');
    } catch { bump(s.anomalies, 'postReadStatError'); }
    bump(s.sizes, 'decodedBytesDelivered', decoded);
    if (supplement) {
      summarizeSupplement(f, desc, s);
      continue;
    }
    bump(s.firstMetadataVersions, f.version || 'missing'); bump(s.firstMetadataClients, f.client); bump(s.firstMetadataModes, f.mode);
    const ord = f.ordinals ? (f.noOrdinal ? 'mixedOrdinals' : 'allOrdinals') : 'noOrdinals';
    const cohort = [f.client, f.mode, ord].join('/');
    bump(s.fileCohorts, cohort);
    for (const combination of f.provenance) bump(s.provenanceFiles, combination);
    for (const marker of f.markers) {
      bump(s.markerFiles, marker);
      bump(s.markerFileCohorts, marker + ' @' + cohort);
      const minor = Number((f.version || '').split('.')[1]);
      const band = minor <= 162 ? 'through162' : minor < 172 ? '163through171' : minor === 172 ? '172' : 'other';
      bump(s.markerFileVersionBands, marker + ' @' + band);
    }
    threadRefs.push(...f.refs);
    for (const [k, target, source] of f.turnRefs) {
      bump(s.references, k + (source === target ? '.self' : f.turns.has(target) ? '.otherTurnSeenInFile' : '.targetNotSeenInFile'));
    }
    for (const id of f.outputs) bump(s.references, f.calls.has(id) ? 'output.callIdSeenInFile' : 'output.callIdNotSeenInFile');
    for (const id of f.tokenTurnRefs) bump(s.references, f.turns.has(id) ? 'token.turnSeenInFile' : 'token.turnNotSeenInFile');
    for (const through of f.watermarks) bump(s.references,
      f.sequences.has(through) ? 'sampledThrough.sequenceSeenInFile' : 'sampledThrough.sequenceNotSeenInFile');
    if (f.differentVersion) bump(s.anomalies, 'filesWithSeveralMetaVersions');
  }
  for (const [k, target] of threadRefs) bump(s.references, k + (owners[target] ? '.ownerSeen' : '.ownerNotSeen'));
  s.identity = { distinctFirstMetadataIds: Object.keys(owners).length, firstMetadataIdsInMultipleFiles: Object.values(owners).filter((n) => n > 1).length };
  return s;
}
async function main(args) {
  const homes = [];
  let mode = 'scan';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--inventory' && mode === 'scan') mode = 'inventory';
    else if (args[i] === '--plain-mcp' && mode === 'scan') mode = 'plain-mcp';
    else if (args[i] === '--mcp-cells' && mode === 'scan') mode = 'mcp-cells';
    else if (args[i] === '--root' && args[i+1]) homes.push(args[++i]);
    else throw new Error('Usage');
  }
  if (!homes.length) homes.push(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const { stats, files } = inventory([...new Set(homes.filter(Boolean).map((p) => path.resolve(p)))]);
  const output = { runtime: process.version, inventory: stats, limits: { recordBytes: recordLimit, decodedFileBytes: decodedFileLimit, recordsPerFile: 250000, nestedArrayElements: 128 } };
  if (mode === 'inventory') output.firstLineVersions = await inventoryVersions(files);
  else if (mode === 'mcp-cells') {
    const result = await scan(files, true);
    output.mcpAndCellSample = { files: files.length, outcomes: result.outcomes, anomalies: result.anomalies,
      records: result.supplementRecords, fileCounts: result.supplementFiles, sizes: result.sizes };
  }
  else if (mode === 'plain-mcp') {
    const subset = files.filter((desc) => desc.format === 'plain');
    const result = await scan(subset);
    output.plainMcpSample = { files: subset.length, outcomes: result.outcomes, anomalies: result.anomalies,
      firstMetadataVersions: result.firstMetadataVersions, firstMetadataModes: result.firstMetadataModes,
      shapes: result.mcpScopeShapes, decodedBytes: result.sizes.decodedBytesDelivered };
  }
  else output.scan = await scan(files);
  console.log(JSON.stringify(output, null, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(() => { console.error('Audit failed. Check runtime, arguments and root accessibility.'); process.exitCode = 1; });
module.exports = { inventory, scan };
