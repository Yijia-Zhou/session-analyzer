'use strict';

const MarkdownIt = require('markdown-it');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');
const { openCodeRawRef, sanitizeOpenCodeValue: safe } = require('./opencode-logical');

const markdown = new MarkdownIt({ html: false, linkify: true });
const limits = { maxDepth: 24, maxNodes: 1_000, maxArrayItems: 128, maxObjectEntries: 128 };
const notice = (text, purpose = 'context') => ({ type: 'notice', purpose, level: 'info', text });
const CONTENT_LIMIT = 100_000;
function contentSections(text) {
  const value = String(text || '');
  return [{ type: 'markdown', purpose: 'content', html: markdown.render(value.slice(0, CONTENT_LIMIT)) },
    ...(value.length > CONTENT_LIMIT ? [notice('Content after the first 100,000 characters is omitted from this detail. Use Raw for the complete captured record.', 'content')] : [])];
}
const json = (title, value, purpose = 'context') => ({ type: 'json', purpose, title, value: safe(value) });
const kv = (entries) => ({ type: 'kv', purpose: 'context', entries: entries
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => ({ key, value: String(value) })) });
function bounded(detail) {
  for (const key of ['timelineSections', 'inspectorSections']) {
    detail[key] = detail[key].map((section) => sanitizeLogicalDetailValue(section, limits));
  }
  return detail;
}

async function buildOpenCodeEventDetail(index, session, eventId, layer = 'main', options = {}) {
  // A warm materialization still validates the immutable physical snapshot.
  const { snapshotForSession } = require('./opencode');
  const snapshot = await snapshotForSession(index, session, options.signal);
  if (layer === 'raw') {
    const raw = session.rawEvents.find((item) => item.rawId === eventId);
    if (!raw) return null;
    const locator = raw.sourceLocator;
    const row = locator.table === 'session_v2' ? snapshot.session
      : snapshot.messages.find((item) => item.id === locator.messageID);
    if (!row || locator.snapshotId !== session.materializationSnapshotId || locator.sessionID !== snapshot.session.id) {
      const error = new Error('OpenCode Raw reference does not belong to the captured snapshot.');
      error.code = 'INDEXED_SOURCE_STALE';
      error.statusCode = 409;
      throw error;
    }
    return bounded({ id: raw.rawId, schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: 'opencode',
      kind: raw.payloadType, subtype: raw.role || '', layer: 'raw', title: raw.payloadType,
      sourceLocator: locator, sourceRecordType: raw.recordType, sourceEventType: raw.payloadType,
      meta: { source: raw.source }, rawRefs: [openCodeRawRef(raw)],
      timelineSections: [{ type: 'raw_json', purpose: 'fallback', title: 'Captured SQLite row', value: safe(row), expanded: true }],
      inspectorSections: [] });
  }
  const event = session.logicalEvents.find((item) => item.id === eventId && item.layer === layer);
  if (!event) return null;
  const facts = event.opencode || {};
  const raw = session.rawEvents.find((item) => item.rawId === event.rawRefs[0]?.rawId);
  const detail = { id: event.id, schemaVersion: event.schemaVersion, sourceKind: 'opencode', kind: event.kind,
    subtype: event.subtype, layer: event.layer, title: event.label || event.toolName || event.kind,
    sourceLocator: event.sourceLocator, meta: { source: event.source }, rawRefs: event.rawRefs,
    timelineSections: [], inspectorSections: [] };
  const context = [['Message id', raw?.messageId], ['Sequence', raw?.sequence], ['Content pointer', facts.pointer],
    ['Status', event.status], ['Agent', facts.agent], ['Provider', facts.model?.providerID], ['Model', facts.model?.id],
    ['Finish reason', facts.finish]];

  if (['command', 'patch', 'other_tool_call'].includes(event.kind)) {
    if (facts.command) detail.timelineSections.push({ type: 'code', purpose: 'request', language: 'bash', code: facts.command });
    else if (facts.patchText) detail.timelineSections.push({ type: 'code', purpose: 'request', language: 'diff', code: facts.patchText });
    else if (typeof facts.input === 'string') detail.timelineSections.push({ type: 'code', purpose: 'request', language: 'json', code: facts.input });
    else detail.timelineSections.push(json('Recorded input', facts.input ?? {}, 'request'));
    if (facts.output) detail.timelineSections.push({ type: 'terminal', purpose: 'result', text: facts.output });
    if (facts.error) detail.timelineSections.push(json('Recorded tool error', facts.error, 'result'));
    if (!facts.output && !facts.error) detail.timelineSections.push(notice(event.status === 'incomplete'
      ? 'This captured tool or process has no completed textual result.' : 'No textual result was recorded.', 'result'));
    if (facts.input !== undefined && (facts.command || facts.patchText)) detail.inspectorSections.push(json('Recorded input', facts.input, 'request'));
    const files = Array.isArray(facts.content) ? facts.content.filter((item) => item?.type !== 'text') : [];
    if (files.length) detail.inspectorSections.push(json('Recorded file results (references only)', files, 'result'));
    if (facts.metadata && Object.keys(facts.metadata).length) detail.inspectorSections.push(json('Recorded tool metadata', facts.metadata));
    if (facts.outputMetadata) detail.inspectorSections.push(json('Recorded process output metadata', facts.outputMetadata));
    context.push(['Tool call id', facts.callId], ['Tool state', facts.toolStatus], ['Process state', facts.processStatus],
      ['Executed by provider', facts.executed], ['Exit code', event.outputStats.exitCode], ['Termination signal', facts.metadata?.signal],
      ['Duration (ms)', event.outputStats.durationMs], ['Child session id', facts.childSessionID]);
    if (facts.userInitiated) detail.inspectorSections.push(notice('This shell command was initiated by the user and is excluded from model tool-call totals.'));
    if (facts.childSessionID) detail.inspectorSections.push(notice('The recorded subagent session is separate evidence; its messages are not duplicated into this tool result.'));
  } else if (['user_message', 'assistant_message', 'reasoning', 'compaction', 'abort', 'error'].includes(event.kind)) {
    detail.timelineSections.push(...contentSections(facts.text?.trim() ? facts.text : event.preview));
    if (event.kind === 'user_message') {
      for (const key of ['files', 'agents', 'skills']) if (facts[key]?.length) {
        detail.inspectorSections.push(json('Recorded ' + key + ' (references only)', facts[key]));
      }
    }
    if (event.kind === 'compaction') {
      context.push(['Compaction state', facts.compactionStatus], ['Reason', facts.reason]);
      if (facts.compactionStatus === 'completed' && !facts.text?.trim()) {
        detail.inspectorSections.push(notice(facts.hasNativeReplacement
          ? 'Compaction completed with provider-owned replacement data and no readable summary. The captured payload remains available in Raw.'
          : 'Compaction completed without a recorded readable summary.'));
      }
      detail.inspectorSections.push(notice('Earlier transcript messages remain visible as historical evidence.'));
    }
    if (facts.error) detail.inspectorSections.push(json('Recorded error', facts.error, 'result'));
  } else {
    detail.timelineSections.push(...contentSections(facts.text || event.preview));
    if (event.subtype === 'opencode_session') {
      context.push(['Session id', facts.sessionID], ['Recorded directory', facts.directory], ['Relative project path', facts.path],
        ['Parent session id', facts.parentID], ['Fork source session id', facts.forkSessionID], ['Outcome', facts.outcome],
        ['Recorded session cost', facts.recordedCost]);
      detail.inspectorSections.push(json('Recorded session token totals', facts.recordedTokens));
      detail.inspectorSections.push(notice('Session token and cost totals come from session_v2. Usage carried by copied fork messages is not added again.'));
      if (facts.forkSessionID) detail.inspectorSections.push(notice('Activity counts describe the captured transcript, including copied fork history. They do not isolate work newly executed after the fork.'));
      if (facts.forkBoundary) detail.inspectorSections.push(json('Recorded fork boundary', facts.forkBoundary));
      if (facts.relations && Object.keys(facts.relations).length) detail.inspectorSections.push(json('Captured relationships', facts.relations));
      if (facts.metadata) detail.inspectorSections.push(json('Recorded session metadata', facts.metadata));
    }
    if (facts.retry) detail.inspectorSections.push(json('Recorded provider retry', facts.retry));
    if (facts.fields || facts.block) detail.inspectorSections.push({ type: 'raw_json', purpose: 'fallback',
      title: 'Recorded source fields', value: facts.fields || facts.block, expanded: false });
    if (event.subtype === 'opencode_step_usage') detail.inspectorSections.push(notice(facts.usageBasis));
  }
  if (event.tokenUsage?.length) detail.inspectorSections.push({ type: 'token_usage', purpose: 'context', items: event.tokenUsage });
  if (facts.cost !== undefined && facts.cost !== null) context.push(['Recorded step cost', facts.cost]);
  detail.inspectorSections.push(kv(context));
  return bounded(detail);
}

module.exports = { buildOpenCodeEventDetail };
