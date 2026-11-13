'use strict';

const MarkdownIt = require('markdown-it');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { sanitizeLogicalDetailValue, redactEmbeddedDataUrls } = require('./shared/logical-detail-sanitizer');
const { qoderRawRef, sanitizeQoderValue: safe } = require('./qoder-logical');
const { qoderImageSection } = require('./qoder-images');
const markdown = new MarkdownIt({ html: false, linkify: true });
const text = (value) => typeof value === 'string' ? value : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const display = (value) => sanitizeLogicalDetailValue(text(value), { maxStringChars: 32_000 });
const notice = (value, purpose = 'context') => ({ type: 'notice', purpose, level: 'info', text: value });
const code = (title, value, purpose = 'request', language = 'text') => ({ type: 'code', purpose, title, language, code: display(value) });
const json = (title, value, purpose = 'context') => ({ type: 'json', purpose, title, value: safe(value) });
const kv = (title, values, purpose = 'context') => ({ type: 'kv', purpose, title, entries: values
  .filter(([, value]) => value !== undefined && value !== '')
  .map(([key, value]) => ({ key, value: value === null || ['number', 'boolean', 'string'].includes(typeof value)
    ? String(value) : '[structured value; see Raw references]' })) });
function content(value, purpose = 'content') {
  const redacted = redactEmbeddedDataUrls(text(value));
  return [{ type: 'markdown', purpose, html: markdown.render(redacted.slice(0, 32_000)) },
    ...(redacted.length > 32_000 ? [notice('Display limited to 32,000 characters; see Raw references for the complete record.', purpose)] : [])];
}
function bounded(detail) {
  for (const key of ['timelineSections', 'inspectorSections']) detail[key] = detail[key].map((section) =>
    sanitizeLogicalDetailValue(section, { maxDepth: 24, maxNodes: 2000, maxArrayItems: 128, maxObjectEntries: 128,
      maxStringChars: 100_000, maxTotalStringChars: 160_000 }));
  return detail;
}
function additionalFields(row, event) {
  if (!object(row)) return row;
  if (event.layer === 'protocol') return row;
  const rest = { ...row };
  for (const key of ['type', 'uuid', 'parentUuid', 'timestamp', 'sessionId', 'cwd', 'version', 'userType', 'entrypoint',
    'gitBranch', 'isSidechain', 'permissionMode', 'agentId', 'parent_tool_use_id', 'sourceToolAssistantUUID',
    'toolUseResult', 'isCompactSummary', 'compactMetadata', 'compactUsage', 'logicalParentUuid', 'requiresActiveLeafCommit']) delete rest[key];
  if (object(rest.message)) {
    rest.message = { ...rest.message };
    for (const key of ['id', 'type', 'role', 'model', 'content', 'usage', 'stop_reason', 'stop_sequence']) delete rest.message[key];
    if (!Object.keys(rest.message).length) delete rest.message;
  }
  if (event.kind === 'compaction') { delete rest.content; delete rest.subtype; delete rest.level; }
  return Object.keys(rest).length ? rest : null;
}
function protocolSections(row, facts) {
  if (facts.usage) return [json('Recorded model usage', facts.usage, 'content')];
  if (row.type === 'runtime-config') return [kv('Recorded runtime configuration', [['Model', row.model],
    ['Reasoning effort', row.reasoningEffort], ['Context window', row.contextWindow]], 'content')];
  if (row.type === 'workspace-directories') return [json('Recorded workspace directories', row.directories, 'content')];
  if (row.type === 'active-leaf') return [kv('Recorded active leaf', [['Leaf uuid', row.leafUuid], ['Explicit', row.explicit]], 'content'),
    notice('This marker is preserved as evidence; the timeline shows physical saved history.', 'content')];
  if (row.type === 'attachment' && object(row.attachment)) {
    const item = row.attachment;
    if (item.type === 'task_reminder' && Array.isArray(item.content)
        && item.content.every((task) => typeof task?.subject === 'string' && typeof task?.status === 'string')) {
      return [{ type: 'plan_update', purpose: 'content', title: 'Recorded task reminder', steps: item.content.slice(0, 64)
        .map((task) => ({ step: display(task.subject), status: task.status })) }];
    }
    return [kv('Recorded attachment', [['Type', item.type]], 'content'),
      ...(typeof item.content === 'string' ? content(item.content) : [json('Recorded attachment fields', item, 'content')])];
  }
  if (row.type === 'system' && ['api_retry', 'model_queue_status'].includes(row.subtype)) {
    return [...content(row.content), kv('Recorded runtime status', [['Type', row.subtype], ['Attempt', row.attempt],
      ['Max retries', row.max_retries], ['Retry delay ms', row.retry_delay_ms], ['Error status', row.error_status],
      ['Status', row.status], ['Model key', row.model_key], ['Queue count', row.queue_count], ['Wait ms', row.wait_time_ms]], 'content')];
  }
  return null;
}
function toolSections(detail, event, facts) {
  const sections = detail.timelineSections;
  const args = object(facts.arguments) && facts.argumentsValid !== false ? facts.arguments : null;
  if (args && event.kind === 'command') sections.push(code('Command', facts.command || args.command, 'request', 'bash'));
  else if (args && ['read', 'write', 'edit', 'delete'].includes(facts.activity)) {
    sections.push(kv('Requested file operation', [['Operation', facts.activity], ['File', args.file_path], ['Offset', args.offset],
      ['Limit', args.limit], ['Start line', args.start_line], ['End line', args.end_line]], 'request'));
    if (facts.activity === 'write') sections.push(code('Requested file content', args.content ?? args.file_content));
    if (facts.activity === 'edit') {
      const edits = Array.isArray(args.replacements) ? args.replacements : [args];
      for (const edit of edits.slice(0, 8)) if (object(edit)) {
        sections.push(code('Requested original text', edit.old_string), code('Requested replacement', edit.new_string));
      }
      if (edits.length > 8) sections.push(notice('Only the first eight edits are shown; see Raw references.', 'request'));
    }
  } else if (args && event.toolName === 'TodoWrite' && Array.isArray(args.todos)
      && args.todos.every((item) => object(item) && typeof (item.description ?? item.content) === 'string' && typeof item.status === 'string')) {
    sections.push({ type: 'plan_update', purpose: 'request', title: 'Requested task list', steps: args.todos.slice(0, 64)
      .map((item) => ({ step: display(item.description ?? item.content), status: item.status })) });
    if (args.todos.length > 64) sections.push(notice('Only the first 64 tasks are shown; see Raw references.', 'request'));
  } else if (args && event.toolName === 'Agent') {
    sections.push(kv('Agent request', [['Description', args.description], ['Name', args.name], ['Type', args.subagent_type],
      ['Resume', args.resume], ['Background', args.run_in_background]], 'request'));
    if (text(args.prompt)) sections.push(...content(args.prompt, 'request'));
  } else if (args && event.toolName === 'AskUserQuestion' && Array.isArray(args.questions)) {
    for (const question of args.questions.slice(0, 16)) if (object(question)) {
      sections.push(...content(question.question, 'request'));
      sections.push(json('Recorded options', question.options || [], 'request'));
    }
  } else sections.push(json('Recorded arguments', facts.arguments ?? {}, 'request'));
  detail.inspectorSections.push(json('Recorded tool arguments', facts.arguments ?? {}, 'request'));
  const result = object(facts.toolResult) ? facts.toolResult : {};
  if (['Write', 'Edit'].includes(event.toolName) && typeof result.diff === 'string' && result.diff) {
    sections.push({ type: 'diff', purpose: 'result', title: 'Recorded file changes', text: display(result.diff) });
  }
  if (event.toolName === 'Read' && result.type === 'text' && typeof result.file?.content === 'string') {
    sections.push(code('Recorded file content', result.file.content, 'result'));
  }
  if (facts.output) sections.push({ type: 'terminal', purpose: 'result', title: 'Recorded tool result', text: display(facts.output) });
  else sections.push(notice(event.rawRefs.length < 2 ? 'No unique completed result is recorded for this call.' : 'No text result was recorded.', 'result'));
  if (event.status === 'failed') sections.push({ type: 'notice', purpose: 'result', level: 'error', text: 'The recorded tool result reports failure.' });
  if (result.persistedOutput || result.outputFile || result.outputPath) detail.inspectorSections.push(notice(
    'External output paths are recorded references only. The inline result and preview are available; external files are not loaded.'));
  if (event.toolName === 'AskUserQuestion' && object(result.answers)) sections.push(json('Recorded answers', result.answers, 'result'));
  if (facts.resultContent && typeof facts.resultContent !== 'string') detail.inspectorSections.push(json('Recorded result content', facts.resultContent, 'result'));
}

async function buildQoderEventDetail(index, session, eventId, layer = 'main', options = {}) {
  const snapshot = await require('./qoder').snapshotForSession(index, session, options.signal);
  if (layer === 'raw') {
    const raw = session.rawEvents.find((item) => item.rawId === eventId);
    if (!raw) return null;
    const line = snapshot.lines[raw.line - 1];
    let parsed; try { parsed = JSON.parse(line); } catch { /* Exact malformed evidence remains readable. */ }
    return bounded({ id: raw.rawId, schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: 'qoder', kind: raw.payloadType,
      subtype: raw.role || '', layer, title: raw.payloadType, sourceLocator: raw.sourceLocator, meta: { source: raw.source },
      rawRefs: [qoderRawRef(raw)], timelineSections: parsed === undefined ? [code('Physical Qoder JSONL record', line, 'content')]
        : [{ type: 'raw_json', purpose: 'fallback', title: 'Physical Qoder JSONL record', value: safe(parsed), expanded: true }], inspectorSections: [] });
  }
  const event = session.logicalEvents.find((item) => item.id === eventId && item.layer === layer);
  if (!event) return null;
  const facts = event.qoder || {};
  const raws = event.rawRefs.map((ref) => session.rawEvents.find((raw) => raw.rawId === ref.rawId)).filter(Boolean);
  const first = raws[0]?.parsed || {};
  const detail = { id: event.id, schemaVersion: event.schemaVersion, sourceKind: 'qoder', kind: event.kind,
    subtype: event.subtype, layer, title: event.label || event.toolName || event.kind,
    sourceLocator: event.sourceLocator, meta: { source: event.source }, rawRefs: event.rawRefs, timelineSections: [], inspectorSections: [] };
  if (event.toolName) toolSections(detail, event, facts);
  else if (layer === 'protocol' && protocolSections(first, facts)) detail.timelineSections.push(...protocolSections(first, facts));
  else if (layer === 'main' || facts.text) detail.timelineSections.push(...content(facts.text || event.preview));
  else detail.timelineSections.push(json('Recorded Qoder event', first, 'content'));
  const images = qoderImageSection(session, event, snapshot);
  if (images) detail.timelineSections.push(images);
  if (facts.imageMessage && !images) detail.timelineSections.push(notice('No supported inline saved image is available; recorded paths are not opened.', 'content'));
  if (facts.inputScope === 'subagent') detail.inspectorSections.push(notice('This is recorded subagent input; its user role does not establish human authorship.'));
  if (event.toolName === 'Agent' && facts.callId) {
    const children = index.sessions.filter((child) => child.parentSessionId === session.id
      && child.materializationDescriptor?.payload.parentToolUseId === facts.callId);
    // The mapper checks all native candidates, including calls retained only
    // in Protocol. Counting visible Main events would miss those competitors.
    const uniqueCall = facts.uniqueCallIdentity === true;
    if (children.length) detail.inspectorSections.push({ type: 'collaboration', purpose: 'traceability',
      targets: children.map((child) => child.id), fields: [], statuses: [],
      targetLinks: children.map((child) => ({ label: child.id, status: uniqueCall && children.length === 1 ? 'resolved' : 'ambiguous',
        ...(uniqueCall && children.length === 1 ? { target: { sourceKind: 'qoder', repoRoot: index.repoRoot,
          indexRevision: options.indexRevision || 0, sessionId: child.id, layer: 'main' } } : {}) })) });
  }
  if (event.kind === 'compaction') detail.inspectorSections.push(json('Recorded compaction metadata', first.compactMetadata || {}, 'context'));
  detail.inspectorSections.push(kv('Recorded context', [['Status', event.status], ['Tool call id', facts.callId], ['Pairing', facts.pairing],
    ['Exit code', event.outputStats?.exitCode], ['Client version', first.version], ['Model', first.message?.model || first.model],
    ['Permission mode', first.permissionMode], ['Entrypoint', first.entrypoint], ['Agent id', first.agentId],
    ['Parent session', session.parentSessionId], ['Record uuid', first.uuid], ['Parent uuid', first.parentUuid]]));
  for (const raw of raws) {
    if (raw.parsed?.toolUseResult !== undefined) detail.inspectorSections.push(json('Recorded tool result metadata', raw.parsed.toolUseResult, 'result'));
    if (raw.parsed?.message?.usage !== undefined) detail.inspectorSections.push(json('Recorded usage', raw.parsed.message.usage));
    const extra = additionalFields(raw.parsed, event);
    if (extra) detail.inspectorSections.push({ type: 'raw_json', purpose: 'fallback', title: 'Additional recorded fields', value: safe(extra), expanded: false });
  }
  return bounded(detail);
}
module.exports = { buildQoderEventDetail };
