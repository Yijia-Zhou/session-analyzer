'use strict';

// Presentation of persisted evidence only. These helpers never replay context,
// resolve a selected model into an actual model, or open a recorded output path.
const { recordedUsage, recordedConfiguration, branchUsageSummary } = require('./pi-recorded-state');
const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const LIMITS = Object.freeze({ textChars: 12_000, namedItems: 8, blocks: 8 });
const labels = Object.freeze({ input: 'Input tokens', output: 'Output tokens', cacheRead: 'Cache read tokens',
  cacheWrite: 'Cache write tokens', cacheWrite1h: 'Cache write tokens (1 hour subset)', reasoning: 'Reasoning tokens (output subset)', totalTokens: 'Total tokens' });
const categories = Object.freeze({ assistant: 'Assistant responses', tool_nested_model_work: 'Tool result nested model work',
  usage: 'Standalone usage records', compaction: 'Compactions', branch_summary: 'Branch summaries' });
const safe = (value) => sanitizeLogicalDetailValue(value, { maxDepth: 8, maxNodes: 120,
  maxArrayItems: 12, maxObjectEntries: 12, maxStringChars: 2000, maxTotalStringChars: 6000 });
const text = (value) => sanitizeLogicalDetailValue(value, { maxStringChars: 600 });
const scalar = (value) => value === undefined ? 'Not recorded' : value === null ? 'null'
  : ['string', 'number', 'boolean'].includes(typeof value) ? text(String(value)) : 'Invalid or unsupported value; see Raw references';
const kv = (title, entries, purpose = 'context') => ({ type: 'kv', purpose, title,
  entries: entries.map(([key, value]) => ({ key: text(key), value: scalar(value) })) });
const notice = (value, purpose = 'context') => ({ type: 'notice', purpose, level: 'info', text: value });
const fallback = (title, value) => ({ type: 'raw_json', purpose: 'fallback', title,
  value: value === undefined ? '[not recorded]' : safe(value), expanded: false });

function contentSections(title, value, purpose = 'context') {
  if (typeof value === 'string') {
    const code = sanitizeLogicalDetailValue(value, { maxStringChars: LIMITS.textChars });
    const sections = [{ type: 'code', purpose, title, language: 'text', code }];
    if (value.length > LIMITS.textChars) sections.push(notice(`${title}: display limited to ${LIMITS.textChars} characters. Full recorded content remains in Raw references.`, purpose));
    return sections;
  }
  if (Array.isArray(value)) {
    const sections = [];
    for (const [index, block] of value.slice(0, LIMITS.blocks).entries()) {
      const blockTitle = `${title}: block ${index + 1}`;
      if (object(block) && block.type === 'text' && typeof block.text === 'string') {
        // Bound the whole block list, rather than granting every block a full budget.
        sections.push({ type: 'code', purpose, title: blockTitle, language: 'text',
          code: sanitizeLogicalDetailValue(block.text, { maxStringChars: Math.floor(LIMITS.textChars / LIMITS.blocks) }) });
        if (block.text.length > LIMITS.textChars / LIMITS.blocks) sections.push(notice(`${blockTitle}: text display limited; see Raw references.`, purpose));
      } else if (object(block) && block.type === 'image') {
        sections.push(kv(blockTitle, [['Recorded block type', 'image'], ['MIME type', block.mimeType],
          ['Payload', 'Available in Raw references']], purpose));
      } else sections.push(fallback(`${blockTitle}: recorded structured content`, block));
    }
    if (!value.length) sections.push(notice(`${title}: an empty content list is recorded.`, purpose));
    if (value.length > LIMITS.blocks) sections.push(notice(`${title}: showing ${LIMITS.blocks} of ${value.length} recorded blocks; see Raw references.`, purpose));
    return sections;
  }
  return [notice(`${title}: content has an unsupported shape; see Raw references.`, purpose), fallback(title, value)];
}

function configurationSections(configuration) {
  if (!configuration) return [];
  const selectedStatus = configuration.selectedModelStatus === 'invalid_record' ? 'Invalid recorded selection'
    : configuration.selectedModelStatus === 'recorded' ? 'Recorded selection' : 'Not recorded';
  const thinkingStatus = configuration.thinkingLevelStatus === 'invalid_record' ? 'Invalid recorded selection'
    : configuration.thinkingLevelStatus === 'recorded' ? scalar(configuration.thinkingLevel) : 'Not recorded';
  const entries = [['Model selection evidence', selectedStatus],
    ['Selected provider', configuration.selectedModel?.provider], ['Selected model', configuration.selectedModel?.modelId],
    ['Selected thinking level', thinkingStatus],
    ['Last assistant provider', configuration.assistantModel?.provider], ['Last assistant model', configuration.assistantModel?.modelId]];
  if (configuration.assistantModel?.responseModel !== undefined) entries.push(['Last assistant response model', configuration.assistantModel.responseModel]);
  return [kv('Recorded model selections and assistant model', entries),
    notice('Selections and the last assistant record are separate evidence. A selection does not establish which model produced a response or performed separately recorded model work.')];
}

function readableUsageSections(entry) {
  const receipt = recordedUsage(entry);
  if (!receipt) return [];
  const entries = [['Usage category', categories[receipt.category] || receipt.category]];
  if (receipt.kind !== undefined) entries.push(['Recorded usage kind', receipt.kind]);
  entries.push(['Usage record provider', receipt.provider], ['Usage record model', receipt.model]);
  for (const [field, label] of Object.entries(labels)) entries.push([label, own(receipt.values, field)
    ? String(receipt.values[field]) : receipt.invalid.includes(field) ? 'Invalid recorded value' : 'Not recorded (unknown)']);
  const sections = [kv('Recorded usage and field coverage', entries)];
  if (Object.keys(receipt.cost).length) sections.push(kv('Recorded cost values', Object.entries(receipt.cost)));
  sections.push(notice('Only recorded nonnegative numeric usage is shown. Missing and invalid values are unknown, not zero. Reasoning is included in output; cacheWrite1h is included in cacheWrite. No billing, currency, cache behavior, or model attribution is inferred.'));
  return sections;
}

function branchUsageSections(rows) {
  const groups = branchUsageSummary(rows);
  const sections = [notice('Usage includes only records on this selected branch. Category partial sums stay separate and are never added into a branch bill. Shared ancestors are not added across branches. Field coverage counts describe available usage receipts; records without usage are counted separately.')];
  if (!Object.keys(groups).length) sections.push(notice('No usage-eligible records are recorded on this selected branch. Usage totals are unknown.'));
  for (const [category, group] of Object.entries(groups)) {
    const entries = [['Eligible records', group.eligibleRecords], ['Usage receipts', group.receipts], ['Records without usage', group.missingUsageRecords]];
    for (const [field, label] of Object.entries(labels)) {
      const coverage = group.fields[field];
      let value = 'Unknown (no usage receipts)';
      if (coverage) {
        const sum = coverage.overflow ? 'Unknown (sum overflow)' : coverage.recordedSum === null ? 'Unknown' : `${coverage.recordedSum} recorded partial sum`;
        value = `${sum}; ${coverage.recordedCount} recorded, ${coverage.missingCount} missing, ${coverage.invalidCount} invalid`;
      }
      entries.push([label, value]);
    }
    sections.push(kv(`Selected branch usage: ${categories[category] || category}`, entries));
  }
  sections.push(notice('Missing or invalid usage is not zero. Reasoning is an output subset and 1 hour cache writes are a cache write subset; neither is added again. Recorded usage does not establish billed amounts or attribute unattributed work to the selected model.'));
  return sections;
}

function systemSections(message, checkpoint = false) {
  const prefix = checkpoint ? 'System checkpoint' : 'System change';
  if (!object(message)) return [notice(`${prefix}: the recorded value has an unsupported shape; see Raw references.`), fallback(`Recorded ${prefix.toLowerCase()}`, message)];
  const sections = [notice(checkpoint
    ? 'This complete system checkpoint records prompt and tool state at the compaction boundary. Earlier retained system changes are folded into it; this reader does not reconstruct the provider request.'
    : 'Named prompt sections are patched: text replaces a section and null removes it. Tool declarations are added or removed by name. This describes recorded changes without reconstructing the final provider wire request.')];
  if (own(message, 'content')) sections.push(...contentSections(`${prefix}: recorded content`, message.content));
  if (own(message, 'sections')) {
    if (object(message.sections)) {
      const names = Object.keys(message.sections);
      for (const name of names.slice(0, LIMITS.namedItems)) {
        const value = message.sections[name];
        const title = `${prefix}: section ${text(name)}`;
        if (value === null) sections.push(kv(title, [['Recorded action', 'Remove named section']]));
        else if (typeof value === 'string') {
          sections.push(kv(title, [['Recorded action', 'Replace named section']]));
          sections.push({ type: 'code', purpose: 'context', title, language: 'text',
            code: sanitizeLogicalDetailValue(value, { maxStringChars: 1500 }) });
          if (value.length > 1500) sections.push(notice(`${title}: text display limited; see Raw references.`));
        } else sections.push(notice(`${title}: unsupported patch value; no section effect is inferred.`), fallback(title, value));
      }
      if (names.length > LIMITS.namedItems) sections.push(notice(`${prefix}: showing ${LIMITS.namedItems} of ${names.length} named section changes; see Raw references.`));
    } else sections.push(notice(`${prefix}: named sections have an unsupported shape.`), fallback('Recorded prompt sections', message.sections));
  }
  for (const [key, action] of [['toolsAdded', 'Add or replace tool declaration'], ['toolsRemoved', 'Remove tool declaration']]) {
    if (!own(message, key)) continue;
    const tools = message[key];
    if (!Array.isArray(tools)) { sections.push(notice(`${prefix}: ${key} has an unsupported shape.`), fallback(key, tools)); continue; }
    const entries = tools.slice(0, LIMITS.namedItems).map((tool, index) => [`${action} ${index + 1}`,
      typeof tool === 'string' ? tool : object(tool) && typeof tool.name === 'string' ? tool.name : 'Unsupported declaration; see Raw references']);
    sections.push(kv(`${prefix}: ${key}`, entries.length ? entries : [['Recorded declarations', '0']]));
    if (key === 'toolsAdded' && tools.length) sections.push(fallback('Recorded tool declarations', tools.slice(0, LIMITS.namedItems)));
    if (tools.length > LIMITS.namedItems) sections.push(notice(`${prefix}: showing ${LIMITS.namedItems} of ${tools.length} ${key} entries; see Raw references.`));
  }
  return sections;
}

function targetEvidence(entry, rows) {
  if (!Array.isArray(rows)) return 'Not checked';
  const index = rows.findIndex((row) => (row.parsed || row) === entry || (typeof entry.id === 'string' && (row.parsed || row).id === entry.id));
  const targetId = entry.type === 'compaction' ? entry.firstKeptEntryId : entry.type === 'branch_summary' ? entry.fromId : entry.targetId;
  if (index < 0 || typeof targetId !== 'string') return 'Unresolved on selected branch';
  if (entry.type === 'compaction' && targetId === entry.id) return 'This compaction (no earlier conversation entries retained)';
  const targetIndex = rows.findIndex((row) => (row.parsed || row).type !== 'session' && (row.parsed || row).id === targetId);
  return targetIndex >= 0 && targetIndex < index ? 'Earlier ancestor on selected branch' : 'Unresolved on selected branch';
}

function readableRecordedStateSections(entry, context = {}) {
  const sections = readableUsageSections(entry);
  if (entry?.type === 'model_change') sections.push(kv('Recorded model selection', [['Selected provider', entry.provider], ['Selected model', entry.modelId]]),
    notice('This records a model selection. Each assistant record separately identifies the model that produced that response.'));
  if (entry?.type === 'thinking_level_change') sections.push(kv('Recorded thinking selection', [['Thinking level', entry.thinkingLevel]]));
  if (entry?.type === 'message' && entry.message?.role === 'system') sections.push(...systemSections(entry.message));
  if (entry?.type === 'context_edit') {
    const effect = entry.replacement === null ? 'Omit target from model context' : own(entry.replacement, 'content') ? 'Replace target content in model context' : 'Unsupported replacement; effect unknown';
    sections.push(kv('Recorded context edit', [['Recorded action', effect], ['Target entry id', entry.targetId], ['Target evidence', targetEvidence(entry, context.selectedRows)]]),
      notice('This append-only record leaves the original transcript visible. A replacement changes content only; it does not replace the target message metadata. Unresolved targets do not establish an applied context change.'));
    if (own(entry.replacement, 'content')) sections.push(...contentSections('Recorded replacement content', entry.replacement.content));
    else if (entry.replacement !== null) sections.push(fallback('Recorded context replacement', entry.replacement));
  }
  if (entry?.type === 'compaction') {
    sections.push(kv('Recorded compaction boundary', [['First kept entry id', entry.firstKeptEntryId], ['Boundary evidence', targetEvidence(entry, context.selectedRows)],
      ['Tokens before compaction', entry.tokensBefore], ['Extension generated', entry.fromHook]]),
    notice('The recorded compaction summary replaces earlier context before the first kept entry. Retained non-system entries and later entries remain eligible for context. Historical transcript records remain visible; this reader does not replay effective context.'));
    if (own(entry, 'systemMessage')) sections.push(...systemSections(entry.systemMessage, true));
    else sections.push(notice('No complete system checkpoint is recorded on this compaction.'));
  }
  if (entry?.type === 'branch_summary') sections.push(kv('Recorded branch summary target', [['Summarized branch entry id', entry.fromId], ['Target evidence', targetEvidence(entry, context.selectedRows)]]),
    notice('This is a recorded branch summary. The summary does not remove historical transcript entries.'));
  if (context.configuration) sections.push(...configurationSections(context.configuration));
  if (context.branchRows) sections.push(...branchReadingSections(context.branchRows));
  return sections;
}

function branchReadingSections(rows) {
  const configuration = [...recordedConfiguration(rows).values()].at(-1);
  const counts = { system: 0, context_edit: 0, compaction: 0, branch_summary: 0 };
  let checkpoint = null;
  for (const row of rows) {
    const entry = row.parsed || row;
    if (entry.type === 'message' && entry.message?.role === 'system') counts.system++;
    else if (own(counts, entry.type)) counts[entry.type]++;
    if (entry.type === 'compaction') checkpoint = entry;
  }
  const sections = [...configurationSections(configuration), kv('Selected branch recorded context transitions', [
    ['System changes', counts.system], ['Context edits', counts.context_edit], ['Compactions', counts.compaction], ['Branch summaries', counts.branch_summary],
    ['Latest compaction entry id', checkpoint?.id], ['Latest first kept entry id', checkpoint?.firstKeptEntryId],
    ['Latest compaction has system checkpoint', checkpoint ? own(checkpoint, 'systemMessage') : 'No compaction recorded']]),
  notice('These counts describe recorded transitions on the selected branch. Original history remains readable. They do not reconstruct effective prompt content, tool state, or the provider request.'), ...branchUsageSections(rows)];
  return sections;
}

function nativeToolReadingSections(facts, resultMessages = []) {
  const timelineSections = []; const inspectorSections = [];
  const args = facts?.arguments;
  if (facts?.nativeActivity === 'read' && object(args)) {
    timelineSections.push(kv('Recorded read request', [['Path', args.path], ['Offset (recorded)', args.offset], ['Limit (recorded)', args.limit]], 'request'));
    inspectorSections.push(notice('Offset and limit describe the recorded request only. An omitted range value is not a recorded number. The result is recorded output, not proof of complete file contents.'));
  }
  if (facts?.nativeActivity === 'write' && object(args) && typeof args.content === 'string') {
    timelineSections.push(kv('Recorded write request', [['Path', args.path], ['Recorded content characters', args.content.length]], 'request'),
      ...contentSections('Requested file content', args.content, 'request'));
    inspectorSections.push(notice('The recorded write requests this content. Previous content and whether the file was created or overwritten are not recorded.'));
  }
  for (const message of resultMessages.slice(0, 1)) {
    const details = message?.details;
    if (!object(details)) continue;
    if (own(details, 'truncation')) {
      const truncation = details.truncation;
      if (object(truncation)) {
        const entries = [['Truncated', 'truncated', 'boolean'], ['Truncated by', 'truncatedBy', 'string'],
          ['Total lines', 'totalLines', 'number'], ['Output lines', 'outputLines', 'number'], ['Total bytes', 'totalBytes', 'number'],
          ['Output bytes', 'outputBytes', 'number'], ['First line exceeds limit', 'firstLineExceedsLimit', 'boolean'], ['Last line partial', 'lastLinePartial', 'boolean']]
          .filter(([, field]) => field === 'truncated' || own(truncation, field))
          .map(([label, field, type]) => [label, !own(truncation, field) ? 'Not recorded' : typeof truncation[field] === type
            && (type !== 'number' || (Number.isFinite(truncation[field]) && truncation[field] >= 0)) ? truncation[field] : 'Invalid recorded value']);
        inspectorSections.push(kv('Recorded output truncation', entries),
          notice('Truncation fields describe this recorded tool result. Missing metadata does not establish complete output. Display limits are separate from source truncation.'));
      } else inspectorSections.push(notice('Recorded truncation metadata has an unsupported shape; see Raw references.'), fallback('Recorded truncation metadata', truncation));
    }
    if (own(details, 'fullOutputPath')) inspectorSections.push(kv('Recorded output reference', [['Full output path (reference only)', details.fullOutputPath]]),
      notice('This path is a recorded reference. Its contents are not read by the history viewer.'));
  }
  return { timelineSections, inspectorSections };
}

module.exports = { readableRecordedStateSections, readableUsageSections, branchReadingSections, nativeToolReadingSections };
