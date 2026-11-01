'use strict';

const MarkdownIt = require('markdown-it');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { sanitizeLogicalDetailValue, redactEmbeddedDataUrls } = require('./shared/logical-detail-sanitizer');
const { workbuddyRawRef, sanitizeWorkbuddyValue: safe } = require('./workbuddy-logical');

const markdown = new MarkdownIt({ html: false, linkify: true });
const TEXT_LIMIT = 32_000;
const LIMITS = Object.freeze({ maxDepth: 24, maxNodes: 1_000, maxArrayItems: 128, maxObjectEntries: 128,
  maxStringChars: 100_000, maxTotalStringChars: 160_000 });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' ? value : '';
const displayText = (value) => sanitizeLogicalDetailValue(text(value), { maxStringChars: TEXT_LIMIT });
const notice = (value, purpose = 'context') => ({ type: 'notice', purpose, level: 'info', text: value });
const json = (title, value, purpose = 'context') => ({ type: 'json', purpose, title, value: safe(value) });
const fallback = (title, value) => ({ type: 'raw_json', purpose: 'fallback', title, value: safe(value), expanded: false });
const kv = (title, entries, purpose = 'context') => ({ type: 'kv', purpose, ...(title ? { title } : {}), entries: entries
  .filter(([, value]) => value !== undefined && value !== '')
  .map(([key, value]) => ({ key, value: value === null || ['string', 'number', 'boolean'].includes(typeof value)
    ? String(value) : '[structured value; see Raw references]' })) });
const code = (title, value, purpose = 'request', language = 'text') => ({ type: 'code', purpose, title, language, code: displayText(value) });
function content(value, purpose = 'content', title = '') {
  // Redact the complete source before clipping or parsing markdown: clipping an
  // embedded URL first would leave a payload tail visible in the rendered HTML.
  const redacted = redactEmbeddedDataUrls(text(value));
  return [{ type: 'markdown', purpose, ...(title ? { title } : {}), html: markdown.render(redacted.slice(0, TEXT_LIMIT)) },
    ...(redacted.length > TEXT_LIMIT ? [notice('Display limited to 32,000 characters; the complete captured record is available through Raw references.', purpose)] : [])];
}
function bounded(detail) {
  for (const key of ['timelineSections', 'inspectorSections']) {
    detail[key] = detail[key].map((section) => sanitizeLogicalDetailValue(section, LIMITS));
  }
  // Identity, sourceLocator and Raw refs are immutable evidence, never display budgets.
  return detail;
}
function planSteps(value) {
  if (!Array.isArray(value)) return null;
  if (!value.slice(0, 64).every((item) => object(item) && typeof item.content === 'string' && typeof item.status === 'string')) return null;
  return value.slice(0, 64).map((item) => ({ step: displayText(item.content), status: item.status }));
}
function planSection(title, value, purpose) {
  const steps = planSteps(value);
  return steps ? { type: 'plan_update', title, purpose, steps,
    ...(value.length > 64 ? { explanationHtml: '<p>Showing the first 64 recorded tasks; see Raw references for the complete list.</p>' } : {}) } : null;
}

function toolRequest(detail, event, facts) {
  const args = object(facts.arguments) && facts.argumentsValid ? facts.arguments : null;
  const primary = detail.timelineSections;
  if (typeof facts.command === 'string' && facts.command) primary.push(code('Command', facts.command, 'request', event.toolName === 'PowerShell' ? 'powershell' : 'bash'));
  else if (args && ['read', 'write', 'edit'].includes(facts.activity)) {
    primary.push(kv('Requested file operation', [['Operation', facts.activity], ['File', args.file_path],
      ['Offset', args.offset], ['Limit', args.limit], ['Replace all', args.replace_all]], 'request'));
    if (facts.activity === 'write' && typeof args.content === 'string') primary.push(code('Requested file content', args.content));
    if (facts.activity === 'edit') {
      const edits = event.toolName === 'MultiEdit' && Array.isArray(args.edits) ? args.edits : [args];
      for (const [index, edit] of edits.slice(0, 8).entries()) {
        if (!object(edit)) continue;
        const suffix = edits.length > 1 ? ` (${index + 1})` : '';
        if (typeof edit.old_string === 'string') primary.push(code(`Requested original text${suffix}`, edit.old_string));
        if (typeof edit.new_string === 'string') primary.push(code(`Requested replacement${suffix}`, edit.new_string));
      }
      if (edits.length > 8) primary.push(notice('Only the first eight requested edits are shown. Recorded arguments and Raw references retain the remaining evidence.', 'request'));
      detail.inspectorSections.push(notice('Replacement text describes the request. A recorded result is required to establish its outcome.'));
    }
  } else if (args && facts.activity === 'plan') {
    const plan = planSection('Requested plan', args.newTodos, 'request');
    if (plan) primary.push(plan);
    else {
      primary.push(kv('Recorded plan request', [['Action', event.toolName], ['Task id', args.taskId], ['Subject', args.subject],
        ['Status', args.status], ['Owner', args.owner], ['Active form', args.activeForm]], 'request'));
      if (typeof args.description === 'string') primary.push(...content(args.description, 'request'));
    }
  } else if (args && facts.activity === 'coordination') {
    const fields = ['name', 'description', 'subagent_type', 'team_name', 'recipient', 'type', 'summary', 'agent_id', 'task_id'];
    primary.push(kv('Coordination request', fields.map((key) => [key, args[key]]), 'request'));
    const message = text(args.prompt) || text(args.content) || text(args.message);
    if (message) primary.push(...content(message, 'request'));
  } else primary.push(typeof facts.arguments === 'string'
    ? code('Recorded arguments', facts.arguments, 'request', 'json') : json('Recorded arguments', facts.arguments ?? {}, 'request'));
  if (facts.arguments !== undefined) detail.inspectorSections.push(json('Recorded tool arguments', facts.arguments, 'request'));
  if (facts.argumentsValid === false) detail.inspectorSections.push(notice('Arguments are not a valid JSON object; no native command or file operation is inferred.'));
}

function toolResult(detail, event, facts) {
  const result = object(facts.toolResult) ? facts.toolResult : {};
  const renderer = object(result.renderer) ? result.renderer : {};
  const primary = detail.timelineSections;
  let shown = false;
  const output = text(facts.output) || text(result.content);
  // The renderer hint alone does not prove a patch exists (native Edit commonly
  // records renderer.type=diff with only a success sentence).
  const patch = result.acpV2FileChange?.patch;
  if (object(patch) && patch.format === 'git_patch' && typeof patch.text === 'string' && patch.text) {
    primary.push({ type: 'diff', purpose: 'result', title: 'Recorded file changes', text: displayText(patch.text) });
    shown = true;
  }
  const value = text(renderer.value);
  if (value && renderer.type === 'code') {
    primary.push(code(text(result.title) || 'Recorded file result', value, 'result', text(renderer.context?.language) || 'text'));
    shown = true;
  } else if (value && renderer.type === 'markdown') {
    primary.push(...content(value, 'result', text(result.title) || 'Tool result'));
    shown = true;
  }
  if (output) {
    if (facts.activity === 'read' && renderer.type === 'code' && !value) primary.push(code(text(result.title) || 'Recorded file content', output, 'result', text(renderer.context?.language) || 'text'));
    else if (renderer.type === 'markdown' && !value) primary.push(...content(output, 'result'));
    else primary.push({ type: 'terminal', purpose: 'result', title: text(result.title) || 'Tool result', text: displayText(output) });
    shown = true;
  } else if (value && !shown) {
    primary.push({ type: 'terminal', purpose: 'result', text: displayText(value) });
    shown = true;
  }
  const todos = result.rawResponse?.todos ?? result.replTaskPlanTodos;
  // The durable ACP snapshot retains completed tasks omitted from the native
  // active-todo UI view. Label both views by their recorded evidence.
  const snapshot = planSection('Recorded ACP task snapshot', result.acpV2PlanSnapshot?.entries, 'result');
  const plan = snapshot || planSection('Recorded task list', todos, 'result');
  if (plan) { primary.push(plan); shown = true; }
  if (snapshot) {
    const active = planSection('Recorded active task list', todos, 'context');
    if (active) detail.inspectorSections.push(active);
  }
  if (typeof result.error === 'string' && result.error) { primary.push(notice(result.error, 'result')); shown = true; }
  if (typeof result.autoReviewWarning === 'string' && result.autoReviewWarning) primary.push(notice(result.autoReviewWarning, 'result'));
  if (!shown) primary.push(notice(!text(facts.pairing).startsWith('exact_')
    ? 'No unique completed result is recorded for this call.' : 'No textual result was recorded.', 'result'));
  if (object(result.rawResponse)) {
    const response = result.rawResponse;
    detail.inspectorSections.push(kv('Recorded process outcome', [['Exit code', response.exitCode], ['Signal', response.signal],
      ['Interrupted', response.interrupted], ['Sandbox denied', response.sandboxDenied], ['Tool error code', response.tool_error_code],
      ['Truncated stdout bytes', response.stdoutBytesTruncated], ['Truncated stderr bytes', response.stderrBytesTruncated]]));
  }
  if (object(result.subAgent)) detail.inspectorSections.push(kv('Recorded child session (reference only)', [
    ['Session id', result.subAgent.sessionId], ['After message id', result.subAgent.afterId], ['Last message id', result.subAgent.lastId]]));
  for (const [key, title] of [['rawResponse', 'Recorded tool response'], ['replToolCalls', 'Recorded nested tool calls'],
    ['acpV2FileChange', 'Recorded file change receipt'], ['producedArtifacts', 'Recorded artifacts (references only)']]) {
    if (result[key] !== undefined) detail.inspectorSections.push(json(title, result[key], 'result'));
  }
  if (facts.toolResult !== undefined && facts.toolResult !== null) detail.inspectorSections.push(fallback('Recorded tool result fields', facts.toolResult));
}

function recordedMetadata(detail, raws, facts, context) {
  const usageSection = (usage) => {
    if (!object(usage)) return;
    const fields = [['inputTokens', 'Input tokens'], ['outputTokens', 'Output tokens'], ['totalTokens', 'Total tokens'],
      ['cachedInputTokens', 'Cached input tokens'], ['reasoningTokens', 'Reasoning tokens']];
    const entries = fields.filter(([key]) => Object.hasOwn(usage, key)).map(([key, label]) => [label,
      typeof usage[key] === 'number' && Number.isFinite(usage[key]) && usage[key] >= 0 ? usage[key] : 'Invalid recorded value']);
    if (entries.length) detail.inspectorSections.push(kv('Recorded token usage', entries));
  };
  for (const raw of raws) {
    const row = raw.parsed;
    if (!object(row)) continue;
    const data = object(row.providerData) ? row.providerData : {};
    context.push(['Record id', row.id], ['Parent record id', row.parentId], ['Recorded working directory', row.cwd],
      ['Recorded execution model', data.model], ['Recorded selected model', data.requestModelId],
      ['Request id', data.conversationRequestId], ['Response status', row.status]);
    for (const [key, title] of [['usage', 'Recorded usage'], ['usageMetadata', 'Recorded usage metadata']]) {
      if (data[key] !== undefined) { usageSection(data[key]); detail.inspectorSections.push(json(title, data[key])); }
    }
    if (row.usage !== undefined) { usageSection(row.usage); detail.inspectorSections.push(json('Recorded usage', row.usage)); }
    if (data.compactType !== undefined || data.compactionId !== undefined || data.isCompacted !== undefined) {
      detail.inspectorSections.push(kv('Recorded compaction metadata', [['Type', data.compactType], ['Compaction id', data.compactionId],
        ['Compacted', data.isCompacted], ['Internal compaction record', data.isCompactInternal], ['Summary', data.isSummary]]));
    }
  }
  if (facts.model !== undefined) context.push(['Model', facts.model]);
  if (facts.requestId !== undefined) context.push(['Request id', facts.requestId]);
  if (facts.usage !== undefined) detail.inspectorSections.push(json('Recorded usage receipt', facts.usage));
}

function protocolSections(detail, raw) {
  const row = raw?.parsed;
  if (!object(row)) return false;
  const primary = detail.timelineSections;
  if (['goal-progress', 'goal-result'].includes(row.type)) {
    if (typeof row.condition === 'string') primary.push(...content(row.condition, 'content', 'Recorded goal'));
    primary.push(kv('Recorded goal state', [['Outcome', row.ok], ['Reason', row.reason], ['Turns', row.turnCount],
      ['Duration (ms)', row.durationMs], ['Token delta', row.tokenDelta], ['Created at', row.createdAt]]));
  } else if (['summary', 'custom-title', 'ai-title', 'topic'].includes(row.type)) {
    const field = { summary: 'summary', 'custom-title': 'customTitle', 'ai-title': 'aiTitle', topic: 'topic' }[row.type];
    if (typeof row[field] !== 'string') return false;
    primary.push(...content(row[field]));
  } else if (row.type === 'session-meta') {
    primary.push(kv('Recorded session state', [['Context window', row.contextWindow]]));
    if (row.meta !== undefined) detail.inspectorSections.push(json('Recorded session metadata snapshot', row.meta));
  } else if (row.type === 'turn-metrics') {
    primary.push(kv('Recorded turn metrics', [['Duration (ms)', row.durationMs], ['Token delta', row.tokenDelta], ['Source', row.source], ['Task status', row.taskStatus]]));
  } else if (row.type === 'acp-terminal-state') {
    primary.push(kv('Recorded terminal state', [['Stop reason', row.stopReason], ['Request id', row.requestId], ['Attempt', row.attempt],
      ['Error code', row.error?.code], ['Error', row.error?.message ?? row.error]]));
    if (row.cost !== undefined) detail.inspectorSections.push(json('Recorded cumulative cost', row.cost));
  } else if (row.type === 'context-usage') {
    primary.push(kv('Recorded context usage', [['Context tokens', row.contextTokens]]));
    if (row.usageByCategory !== undefined) detail.inspectorSections.push(json('Recorded context categories', row.usageByCategory));
  } else if (row.type === 'credit-usage') {
    primary.push(kv('Recorded credit usage', [['Credit', row.providerData?.credit], ['Source', row.providerData?.source], ['Stage id', row.providerData?.stageId]]));
  } else if (row.type === 'model-usage') {
    primary.push(notice('This record carries model usage without a committed output message.'));
  } else if (row.type === 'request-recovery') {
    primary.push(kv('Recorded request recovery', [['Request id', row.requestId], ['User message id', row.userMessageId], ['Attempt', row.attempt]]));
  } else return false;
  return true;
}

function residualFields(raw, event) {
  if (!object(raw.parsed)) return raw.parsed;
  const { id, parentId, logicalParentId, sessionId, timestamp, cwd, type, ...rest } = raw.parsed;
  if (['user_message', 'assistant_message', 'reasoning', 'compaction'].includes(event.kind)) {
    // The selected content block is presented above. Preserve other block types
    // as residual evidence without repeating all message text in every detail.
    delete rest.role;
    delete rest.status;
    if (Array.isArray(rest.content)) {
      rest.content = rest.content.filter((block) => !object(block) || typeof block.text !== 'string'
        || !['input_text', 'output_text', 'text', 'reasoning_text', 'summary_text'].includes(block.type));
      if (!rest.content.length) delete rest.content;
    } else if (typeof rest.content === 'string') delete rest.content;
    if (event.kind === 'reasoning' && Array.isArray(rest.rawContent)) {
      rest.rawContent = rest.rawContent.filter((block) => !object(block) || typeof block.text !== 'string'
        || !['reasoning_text', 'summary_text', 'text'].includes(block.type));
      if (!rest.rawContent.length) delete rest.rawContent;
    }
  }
  if (['command', 'other_tool_call'].includes(event.kind)) {
    for (const key of ['name', 'callId', 'arguments', 'status']) delete rest[key];
    if (typeof rest.output === 'string' || (object(rest.output) && rest.output.type === 'text' && typeof rest.output.text === 'string')) delete rest.output;
    else if (Array.isArray(rest.output)) {
      rest.output = rest.output.filter((block) => !object(block) || block.type !== 'text' || typeof block.text !== 'string');
      if (!rest.output.length) delete rest.output;
    }
  }
  if (object(rest.providerData)) {
    const { model, conversationRequestId, usage, usageMetadata, compactType, compactionId, isCompacted, isCompactInternal, isSummary, ...data } = rest.providerData;
    if (['command', 'other_tool_call'].includes(event.kind)) delete data.toolResult;
    if (Object.keys(data).length) rest.providerData = data;
    else delete rest.providerData;
  }
  delete rest.usage;
  return Object.keys(rest).length ? rest : null;
}

async function buildWorkbuddyEventDetail(index, session, eventId, layer = 'main', options = {}) {
  // Also validate warm materializations before returning any projected content.
  const { snapshotForSession } = require('./workbuddy');
  const snapshot = await snapshotForSession(index, session, options.signal);
  if (layer === 'raw') {
    const raw = session.rawEvents.find((item) => item.rawId === eventId);
    if (!raw) return null;
    // Physical lines include blanks; rawEvents is not a line-addressed array.
    const line = snapshot.lines[raw.line - 1];
    if (line === undefined) {
      const error = new Error('WorkBuddy Raw line is outside the accepted snapshot.');
      error.code = 'INDEXED_SOURCE_STALE'; error.statusCode = 409; throw error;
    }
    let parsed; try { parsed = JSON.parse(line); } catch { parsed = undefined; }
    return bounded({ id: raw.rawId, schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: 'workbuddy', kind: raw.payloadType,
      subtype: raw.role || '', layer: 'raw', title: raw.payloadType, sourceLocator: raw.sourceLocator,
      meta: { source: raw.source }, rawRefs: [workbuddyRawRef(raw)],
      timelineSections: parsed === undefined ? [code('Physical WorkBuddy JSONL record', line, 'content')]
        : [{ type: 'raw_json', purpose: 'fallback', title: 'Physical WorkBuddy JSONL record', value: safe(parsed), expanded: true }],
      inspectorSections: [] });
  }
  const event = session.logicalEvents.find((item) => item.id === eventId && item.layer === layer);
  if (!event) return null;
  const facts = event.workbuddy || {};
  const raws = event.rawRefs.map((ref) => session.rawEvents.find((raw) => raw.rawId === ref.rawId)).filter(Boolean);
  const detail = { id: event.id, schemaVersion: event.schemaVersion, sourceKind: 'workbuddy', kind: event.kind,
    subtype: event.subtype, layer: event.layer, title: event.label || event.toolName || event.kind,
    sourceLocator: event.sourceLocator, meta: { source: event.source }, rawRefs: event.rawRefs,
    timelineSections: [], inspectorSections: [] };
  const context = [['Status', event.status], ['Tool', event.toolName], ['Tool call id', facts.callId],
    ['Pairing evidence', facts.pairing], ['Recorded result status', facts.resultStatus]];
  if (['command', 'other_tool_call'].includes(event.kind)) {
    toolRequest(detail, event, facts);
    toolResult(detail, event, facts);
  } else if (['user_message', 'assistant_message', 'reasoning', 'compaction'].includes(event.kind)) {
    detail.timelineSections.push(...content(text(facts.text) || event.preview));
    if (event.kind === 'compaction') detail.inspectorSections.push(notice('This is the recorded summary. Earlier physical history remains visible as archival evidence.'));
  } else if (!protocolSections(detail, raws[0])) {
    detail.timelineSections.push(...content(text(facts.text) || event.preview));
  }
  recordedMetadata(detail, raws, facts, context);
  if (event.tokenUsage?.length) detail.inspectorSections.push({ type: 'token_usage', purpose: 'context', items: event.tokenUsage });
  for (const raw of raws) {
    const residual = residualFields(raw, event);
    if (residual !== null && residual !== undefined) detail.inspectorSections.push(fallback('Residual source fields', residual));
  }
  detail.inspectorSections.push(kv('Recorded event context', context));
  return bounded(detail);
}

module.exports = { buildWorkbuddyEventDetail };
