'use strict';

const MarkdownIt = require('markdown-it');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');
const { piRawRef } = require('./pi-logical');
const markdown = new MarkdownIt({ html: false, linkify: true });
const safe = (value) => sanitizeLogicalDetailValue(value);
// Budget each presentation section before the shared contract validates it.
// Leave identity/Raw references intact; the physical record is never clipped.
const DETAIL_STRUCTURE_LIMITS = Object.freeze({
  maxDepth: 24, maxNodes: 1_000, maxArrayItems: 128, maxObjectEntries: 128,
});
function boundedDetail(detail) {
  for (const key of ['timelineSections', 'inspectorSections']) {
    detail[key] = detail[key].map((section) => sanitizeLogicalDetailValue(section, DETAIL_STRUCTURE_LIMITS));
  }
  return detail;
}
const kv = (entries, purpose = 'context', title = '') => ({ type: 'kv', purpose, ...(title ? { title } : {}),
  entries: entries.filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => ({ key, value: String(value) })) });
const notice = (text, purpose = 'context') => ({ type: 'notice', purpose, level: 'info', text });
const content = (text, purpose = 'content') => ({ type: 'markdown', purpose, html: markdown.render(String(text || '').slice(0, 100_000)) });

function nestedCallsSection(value) {
  // Only the native bounded receipt is understood: no outputs, ancestry,
  // subagents, or source-independent dispatch graph can be inferred from it.
  if (!value || !Array.isArray(value.calls) || typeof value.complete !== 'boolean'
      || !value.calls.every((call) => call && typeof call.id === 'string' && typeof call.name === 'string'
        && ['ok', 'error', 'unfinished'].includes(call.status))) return null;
  return { type: 'json', purpose: 'context', title: 'Recorded nested calls (results are not recorded)', value: safe(value) };
}

function residualFields(raw, event) {
  const record = raw.parsed;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const { type, id, parentId, timestamp, ...rest } = record;
  const remove = (...keys) => { for (const key of keys) delete rest[key]; };
  if (type === 'session') remove('version', 'cwd', 'parentSession');
  if (type === 'message' && rest.message && typeof rest.message === 'object') {
    const { role, timestamp: messageTimestamp, model, provider, api, stopReason, errorMessage, usage,
      durationMs, ...message } = rest.message;
    // Main content and tool requests/results have their own sections. Unknown
    // blocks retain only that block; never repeat the whole message envelope.
    const unknownBlock = event.subtype.match(/^pi_content_.*_(\d+)$/);
    if (unknownBlock) message.content = Array.isArray(message.content) ? message.content[Number(unknownBlock[1])] : message.content;
    else if (event.subtype !== 'pi_unpaired_tool_result' && event.subtype !== 'pi_empty_message'
        && event.subtype !== 'pi_invalid_tree' && event.subtype !== 'pi_message') delete message.content;
    if (event.kind === 'command' || event.kind === 'other_tool_call') {
      for (const key of ['toolCallId', 'toolName', 'isError', 'details', 'nestedCalls', 'command', 'output', 'exitCode',
        'cancelled', 'truncated', 'fullOutputPath', 'excludeFromContext']) delete message[key];
    }
    if (!Object.keys(message).length) delete rest.message;
    else rest.message = message;
  }
  if (type === 'compaction') remove('summary', 'firstKeptEntryId', 'tokensBefore', 'fromHook');
  if (type === 'branch_summary') remove('summary', 'fromId');
  if (type === 'context_edit') remove('targetId', 'replacement');
  if (type === 'custom_message') remove('customType', 'content', 'display');
  return Object.keys(rest).length ? rest : null;
}

async function buildPiEventDetail(index, session, eventId, layer = 'main', options = {}) {
  // Validation also runs on warm materialized cache hits. Never show a detail
  // from a snapshot whose physical evidence has changed underneath it.
  const { snapshotForSession } = require('./pi');
  const snapshot = await snapshotForSession(index, session, options.signal);
  if (layer === 'raw') {
    const raw = session.rawEvents.find((item) => item.rawId === eventId);
    if (!raw) return null;
    const text = snapshot.lines[raw.line - 1];
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
    return boundedDetail({ id: raw.rawId, schemaVersion: CANONICAL_SCHEMA_VERSION, sourceKind: 'pi', kind: raw.payloadType,
      subtype: raw.role || '', layer: 'raw', title: raw.payloadType, sourceLocator: raw.sourceLocator,
      sourceRecordType: raw.recordType, sourceEventType: raw.payloadType, meta: { source: raw.source }, rawRefs: [piRawRef(raw)],
      timelineSections: parsed === null ? [{ type: 'code', purpose: 'content', code: safe(text), language: 'text' }]
        : [{ type: 'raw_json', purpose: 'fallback', title: 'Physical pi JSONL record', value: safe(parsed), expanded: true }],
      inspectorSections: [] });
  }
  const event = session.logicalEvents.find((item) => item.id === eventId && item.layer === layer);
  if (!event) return null;
  const raws = event.rawRefs.map((ref) => session.rawEvents.find((raw) => raw.rawId === ref.rawId)).filter(Boolean);
  const facts = event.pi || {};
  const detail = { id: event.id, schemaVersion: event.schemaVersion, sourceKind: 'pi', kind: event.kind,
    subtype: event.subtype, layer: event.layer, title: event.label || event.toolName || event.kind,
    sourceLocator: event.sourceLocator, meta: { source: event.source }, rawRefs: event.rawRefs,
    timelineSections: [], inspectorSections: [] };
  const context = [['Entry id', raws[0]?.entryId], ['Parent entry id', raws[0]?.parentId ?? '(root)'],
    ['Branch tip', session.sourceDerivedId], ['Provider', facts.provider || raws[0]?.parsed?.message?.provider],
    ['Model', facts.model || raws[0]?.parsed?.message?.model],
    ['API', raws[0]?.parsed?.message?.api],
    ['Status', event.status], ['Stop reason', raws[0]?.parsed?.message?.stopReason],
    ['Tool call id', facts.callId], ['Pairing evidence', facts.pairing]];
  if (event.kind === 'command' || event.kind === 'other_tool_call') {
    if (facts.command) detail.timelineSections.push({ type: 'code', purpose: 'request', language: 'bash', code: facts.command });
    else detail.timelineSections.push({ type: 'json', purpose: 'request', value: facts.arguments ?? {} });
    if (facts.output) detail.timelineSections.push({ type: 'terminal', purpose: 'result', text: facts.output.slice(0, 100_000) });
    else detail.timelineSections.push(notice(event.status === 'incomplete' ? 'No unique completed result is recorded for this call.' : 'No textual output was recorded.', 'result'));
    if (facts.arguments !== undefined) detail.inspectorSections.push({ type: 'json', purpose: 'request', title: 'Recorded arguments', value: facts.arguments });
    if (facts.argumentsError) detail.inspectorSections.push(notice(facts.argumentsError));
    const nested = nestedCallsSection(facts.nestedCalls);
    if (nested) {
      detail.inspectorSections.push(nested);
      detail.inspectorSections.push(notice(facts.nestedCalls.complete
        ? 'This receipt lists completed nested calls; nested result payloads are not persisted.'
        : 'This receipt is incomplete: calls or arguments may be omitted, or calls may be unfinished.'));
    } else if (facts.nestedCalls) detail.inspectorSections.push({ type: 'raw_json', purpose: 'fallback', title: 'Unrecognized nested-call receipt', value: facts.nestedCalls, expanded: false });
    for (const raw of raws) {
      const message = raw.parsed?.message;
      if (message?.role === 'toolResult' && message.details !== undefined) detail.inspectorSections.push({ type: 'json', purpose: 'context', title: 'Recorded tool result details', value: safe(message.details) });
    }
    if (event.subtype === 'pi_bash_execution') {
      context.push(['Cancelled', facts.cancelled], ['Truncated', facts.truncated], ['Excluded from model context', facts.excludeFromContext],
        ['Full output path (reference only)', facts.fullOutputPath]);
    }
    if (event.outputStats.exitCode != null) context.push(['Exit code', event.outputStats.exitCode]);
    if (event.outputStats.durationMs) context.push(['Duration (ms)', event.outputStats.durationMs]);
  } else if (['user_message', 'assistant_message', 'reasoning', 'compaction', 'abort', 'error'].includes(event.kind)) {
    detail.timelineSections.push(content(facts.text || event.preview));
    if (event.kind === 'compaction') {
      context.push(['First kept entry id', facts.firstKeptEntryId], ['Tokens before compaction', facts.tokensBefore], ['Extension generated', facts.fromHook]);
      detail.inspectorSections.push(notice('This is the recorded compaction summary. Earlier transcript entries remain visible as historical evidence.'));
    }
  } else {
    detail.timelineSections.push(content(facts.text || event.preview));
    if (event.subtype === 'pi_branch') context.push(['Last persisted entry', facts.resumedLeafId], ['Branch count', facts.branchCount],
      ['Session format version', raws[0]?.parsed?.version], ['Recorded working directory', raws[0]?.parsed?.cwd],
      ['Parent session path (provenance only)', facts.parentSession]);
    if (event.subtype === 'pi_branch_summary') context.push(['Summarized branch entry id', facts.fromId]);
    if (event.subtype === 'pi_context_edit') {
      context.push(['Target entry id', facts.targetId], ['Target is an earlier branch ancestor', facts.targetOnBranch]);
      detail.inspectorSections.push({ type: 'json', purpose: 'context', title: 'Recorded context replacement (null omits the target)', value: facts.replacement });
    }
    if (facts.usage) detail.inspectorSections.push({ type: 'json', purpose: 'context', title: 'Recorded usage (no inferred totals)', value: facts.usage });
    if (event.subtype === 'pi_custom_message') context.push(['Custom message type', facts.customType], ['Display requested by source', facts.display]);
  }
  // Fallback is only residual evidence after modeled fields are subtracted.
  // Complete original records are available through their validated Raw refs.
  for (const raw of raws) {
    const residual = residualFields(raw, event);
    if (residual) detail.inspectorSections.push({ type: 'raw_json', purpose: 'fallback',
      title: 'Residual source fields', value: residual, expanded: false });
  }
  detail.inspectorSections.push(kv(context));
  return boundedDetail(detail);
}

module.exports = { buildPiEventDetail };
