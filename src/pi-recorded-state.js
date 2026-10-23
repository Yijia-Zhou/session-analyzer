'use strict';

// Pi 1.4.0 session-format/message-types: recorded evidence, never a wire request.
const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');
const bounded = (value) => sanitizeLogicalDetailValue(value, { maxDepth: 16, maxNodes: 1000, maxArrayItems: 128, maxObjectEntries: 128 });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'totalTokens'];
const valid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const notice = (text) => ({ type: 'notice', purpose: 'context', level: 'info', text });
const json = (title, value) => ({ type: 'json', purpose: 'context', title, value: bounded(value) });

function usageSource(entry) {
  let category; let source;
  if (entry?.type === 'message' && entry.message?.role === 'assistant') { category = 'assistant'; source = entry.message; }
  else if (entry?.type === 'message' && entry.message?.role === 'toolResult') { category = 'tool_nested_model_work'; source = entry.message; }
  else if (['usage', 'compaction', 'branch_summary'].includes(entry?.type)) { category = entry.type; source = entry; }
  else return null;
  return { category, source };
}

function recordedUsage(entry) {
  const attribution = usageSource(entry);
  if (!attribution) return null;
  const { category, source } = attribution;
  if (!Object.hasOwn(source, 'usage')) return null;
  const usage = source.usage;
  const values = {}; const missing = []; const invalid = [];
  for (const field of fields) {
    if (!record(usage) || !Object.hasOwn(usage, field)) missing.push(field);
    else if (valid(usage[field])) values[field] = usage[field];
    else invalid.push(field);
  }
  const cost = {};
  if (record(usage?.cost)) for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
    if (valid(usage.cost[field])) cost[field] = usage.cost[field];
  }
  return { category, ...(typeof source.kind === 'string' ? { kind: source.kind } : {}), values, missing, invalid, cost,
    ...(typeof source.provider === 'string' ? { provider: source.provider } : {}),
    ...(typeof source.model === 'string' ? { model: source.model } : {}) };
}

function usageSections(entry) {
  const receipt = recordedUsage(entry);
  if (!receipt) return [];
  const sections = [json('Recorded usage attribution and coverage', receipt)];
  const items = Object.entries(receipt.values).map(([field, value]) => ({ key: field, field, label: field,
    value, formatted: String(value), primary: false }));
  if (items.length) sections.unshift({ type: 'token_usage', purpose: 'context', title: `Recorded usage: ${receipt.category}`, items });
  sections.push(notice('Only recorded nonnegative numeric fields are shown. Missing fields are unknown, not zero. Reasoning is included in output; cacheWrite1h is included in cacheWrite. No billing or cache behavior is inferred.'));
  return sections;
}

// Call with one selected root-to-leaf path. Compact snapshots do not duplicate prompts.
function recordedConfiguration(rows) {
  const snapshots = new Map(); let selectedModel = null; let thinkingLevel = null; let assistantModel = null;
  let selectedModelStatus = 'not_recorded'; let thinkingLevelStatus = 'not_recorded';
  for (const row of rows) {
    const entry = row.parsed || row;
    if (entry.type === 'model_change') {
      const known = typeof entry.provider === 'string' && entry.provider.length > 0 && typeof entry.modelId === 'string' && entry.modelId.length > 0;
      selectedModel = known ? { provider: entry.provider, modelId: entry.modelId } : null;
      selectedModelStatus = known ? 'recorded' : 'invalid_record';
    }
    if (entry.type === 'thinking_level_change') {
      const known = typeof entry.thinkingLevel === 'string' && entry.thinkingLevel.length > 0;
      thinkingLevel = known ? entry.thinkingLevel : null;
      thinkingLevelStatus = known ? 'recorded' : 'invalid_record';
    }
    if (entry.type === 'message' && entry.message?.role === 'assistant') {
      assistantModel = typeof entry.message.provider === 'string' && typeof entry.message.model === 'string'
        ? { provider: entry.message.provider, modelId: entry.message.model,
          ...(typeof entry.message.responseModel === 'string' ? { responseModel: entry.message.responseModel } : {}) } : null;
    }
    snapshots.set(row.line ?? entry.id, { selectedModel, selectedModelStatus, thinkingLevel, thinkingLevelStatus, assistantModel });
  }
  return snapshots;
}

function branchUsageSummary(rows) {
  const categories = {};
  for (const row of rows) {
    const entry = row.parsed || row;
    const attribution = usageSource(entry);
    if (!attribution) continue;
    const receipt = recordedUsage(entry);
    // Arbitrary standalone kinds are retained as data, never interpreted as accounting rules.
    const key = attribution.category;
    const group = categories[key] ||= { eligibleRecords: 0, missingUsageRecords: 0, receipts: 0, fields: {} };
    group.eligibleRecords++;
    if (!receipt) { group.missingUsageRecords++; continue; }
    group.receipts++;
    for (const field of fields) {
      const coverage = group.fields[field] ||= { recordedSum: null, recordedCount: 0, missingCount: 0, invalidCount: 0 };
      if (Object.hasOwn(receipt.values, field)) {
        const sum = (coverage.recordedSum ?? 0) + receipt.values[field];
        if (!coverage.overflow && Number.isFinite(sum)) coverage.recordedSum = sum;
        else { coverage.overflow = true; coverage.recordedSum = null; }
        coverage.recordedCount++;
      } else if (receipt.invalid.includes(field)) coverage.invalidCount++;
      else coverage.missingCount++;
    }
  }
  return categories;
}

function recordedStateSections(entry, context = {}) {
  const sections = usageSections(entry);
  if (entry?.type === 'model_change') sections.push(json('Recorded model selection', { provider: entry.provider, modelId: entry.modelId }), notice('This records a model selection. Each assistant record separately identifies the model that produced that response.'));
  if (entry?.type === 'thinking_level_change') sections.push(json('Recorded thinking selection', { thinkingLevel: entry.thinkingLevel }));
  if (entry?.type === 'message' && entry.message?.role === 'system') {
    const { content, sections: promptSections, toolsAdded, toolsRemoved } = entry.message;
    sections.push(json('Recorded system prompt and tool changes', { content, sections: promptSections, toolsAdded, toolsRemoved }),
      notice('Named prompt sections are patched: text replaces a section and null removes it. Tool declarations are added or removed by name. These records explain recorded context changes; they do not establish the final provider wire request.'));
  }
  if (entry?.type === 'compaction') {
    sections.push(notice('The compaction summary replaces earlier context before the first kept entry. Retained non-system entries and later entries remain eligible for context. Historical transcript records remain visible.'));
    if (Object.hasOwn(entry, 'systemMessage')) sections.push(json('Recorded complete system checkpoint', entry.systemMessage), notice('This checkpoint supplies prompt and tool state at the compaction boundary; earlier retained system changes are folded into it.'));
  }
  if (entry?.type === 'context_edit') sections.push(notice(entry.replacement === null
    ? 'This append-only edit omits the target from model context; the original transcript remains visible.'
    : 'This append-only edit replaces only the target content in model context; the original transcript and message metadata remain visible.'));
  if (context.configuration) sections.push(json('Branch recorded selections and last assistant model', context.configuration));
  if (context.branchRows) sections.push(json('Selected branch recorded usage by category (partial sums)', branchUsageSummary(context.branchRows)),
    notice('Usage includes only records on this selected branch. Category sums stay separate; eligible and missing receipt counts disclose absent usage; field coverage describes the available receipts and partial sums. Shared ancestors are not added across branches.'));
  return sections;
}

module.exports = { recordedUsage, usageSections, recordedConfiguration, branchUsageSummary, recordedStateSections };
