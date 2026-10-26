'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recordedConfiguration } = require('../src/pi-recorded-state');
const { validateLogicalDetailSection } = require('../src/shared/logical-detail-contract');
const { readableRecordedStateSections, readableUsageSections, branchReadingSections, nativeToolReadingSections } = require('../src/pi-reading-presentation');

const rows = (entries) => entries.map((parsed, index) => ({ line: index + 1, parsed }));
function values(sections, title) {
  const section = sections.find((item) => item.title === title);
  assert.ok(section, `missing section: ${title}`);
  return Object.fromEntries(section.entries.map(({ key, value }) => [key, value]));
}
function validate(sections) {
  for (const section of sections) validateLogicalDetailSection(section);
}

test('selection history and actual assistant evidence stay distinct and branch local', () => {
  const prefix = rows([
    { type: 'model_change', provider: 'selected-provider', modelId: 'selected-model' },
    { type: 'thinking_level_change', thinkingLevel: 'high' },
    { type: 'message', message: { role: 'assistant', provider: 'actual-provider', model: 'actual-model', responseModel: 'concrete-model' } },
  ]);
  const beforeResponse = readableRecordedStateSections(null, { configuration: recordedConfiguration(prefix).get(2) });
  assert.equal(values(beforeResponse, 'Recorded model selections and assistant model')['Last assistant model'], 'Not recorded');
  const branch = branchReadingSections(prefix);
  const selection = values(branch, 'Recorded model selections and assistant model');
  assert.equal(selection['Selected provider'], 'selected-provider');
  assert.equal(selection['Selected model'], 'selected-model');
  assert.equal(selection['Selected thinking level'], 'high');
  assert.equal(selection['Last assistant provider'], 'actual-provider');
  assert.equal(selection['Last assistant model'], 'actual-model');
  assert.equal(selection['Last assistant response model'], 'concrete-model');
  const invalid = [...prefix, { line: 4, parsed: { type: 'model_change', provider: {}, modelId: 'bad' } }];
  const invalidSelection = values(branchReadingSections(invalid), 'Recorded model selections and assistant model');
  assert.equal(invalidSelection['Model selection evidence'], 'Invalid recorded selection');
  assert.equal(invalidSelection['Selected model'], 'Not recorded');
  assert.equal(invalidSelection['Last assistant model'], 'actual-model');
  assert.equal(values(branch, 'Recorded model selections and assistant model')['Selected model'], 'selected-model');
  validate(branch);
});

test('usage distinguishes zero, invalid and missing while leaving unattributed work unattributed', () => {
  const sections = readableUsageSections({ type: 'usage', kind: 'future-kind', usage: {
    input: 0, output: 8, cacheRead: '0', cacheWrite: 3, cacheWrite1h: 1, reasoning: 2, cost: { total: 0 },
  } });
  const usage = values(sections, 'Recorded usage and field coverage');
  assert.equal(usage['Input tokens'], '0');
  assert.equal(usage['Cache read tokens'], 'Invalid recorded value');
  assert.equal(usage['Total tokens'], 'Not recorded (unknown)');
  assert.equal(usage['Output tokens'], '8');
  assert.equal(usage['Reasoning tokens (output subset)'], '2');
  assert.equal(usage['Recorded usage kind'], 'future-kind');
  assert.equal(usage['Usage record provider'], 'Not recorded');
  assert.equal(usage['Usage record model'], 'Not recorded');
  assert.equal(values(sections, 'Recorded cost values').total, '0');
  assert.match(JSON.stringify(sections), /No billing, currency, cache behavior, or model attribution is inferred/);
  const missing = values(readableUsageSections({ type: 'compaction', usage: null }), 'Recorded usage and field coverage');
  assert.equal(missing['Input tokens'], 'Not recorded (unknown)');
  assert.deepEqual(readableUsageSections({ type: 'message', message: { role: 'user', usage: { input: 99 } } }), []);
  validate(sections);
});

test('branch partial sums separate categories, absent receipts, invalid values and overflow', () => {
  const sections = branchReadingSections(rows([
    { type: 'message', message: { role: 'assistant' } },
    { type: 'message', message: { role: 'assistant', usage: { input: 0 } } },
    { type: 'message', message: { role: 'assistant', usage: { input: 'bad' } } },
    { type: 'message', message: { role: 'toolResult' } },
    { type: 'compaction', usage: { input: 7 } },
    { type: 'branch_summary', usage: { input: 11 } },
    { type: 'usage', usage: { input: Number.MAX_VALUE } },
    { type: 'usage', usage: { input: Number.MAX_VALUE } },
  ]));
  const assistant = values(sections, 'Selected branch usage: Assistant responses');
  assert.equal(assistant['Eligible records'], '3');
  assert.equal(assistant['Usage receipts'], '2');
  assert.equal(assistant['Records without usage'], '1');
  assert.equal(assistant['Input tokens'], '0 recorded partial sum; 1 recorded, 0 missing, 1 invalid');
  assert.equal(assistant['Output tokens'], 'Unknown; 0 recorded, 2 missing, 0 invalid');
  assert.equal(values(sections, 'Selected branch usage: Tool result nested model work')['Input tokens'], 'Unknown (no usage receipts)');
  assert.match(values(sections, 'Selected branch usage: Compactions')['Input tokens'], /^7 recorded partial sum/);
  assert.match(values(sections, 'Selected branch usage: Branch summaries')['Input tokens'], /^11 recorded partial sum/);
  assert.equal(values(sections, 'Selected branch usage: Standalone usage records')['Input tokens'], 'Unknown (sum overflow); 2 recorded, 0 missing, 0 invalid');
  assert.match(JSON.stringify(branchReadingSections([])), /Usage totals are unknown/);
  validate(sections);
});

test('context edits disclose ancestor resolution and preserve recorded replacement content', () => {
  const original = { type: 'message', id: 'original', message: { role: 'user', content: 'historical text' } };
  const omission = { type: 'context_edit', id: 'omit', targetId: 'original', replacement: null };
  const replacement = { type: 'context_edit', id: 'replace', targetId: 'original', replacement: { content: [{ type: 'text', text: 'replacement text' }] } };
  const branch = rows([original, omission, replacement]);
  const omitted = readableRecordedStateSections(omission, { selectedRows: branch });
  assert.equal(values(omitted, 'Recorded context edit')['Recorded action'], 'Omit target from model context');
  assert.equal(values(omitted, 'Recorded context edit')['Target evidence'], 'Earlier ancestor on selected branch');
  const replaced = readableRecordedStateSections(replacement, { selectedRows: branch });
  assert.ok(replaced.some((section) => section.type === 'code' && section.code === 'replacement text'));
  assert.equal(JSON.stringify(replaced).includes('historical text'), false, 'replacement evidence does not invent or duplicate old content');
  const sibling = { type: 'context_edit', id: 'sibling', targetId: 'replace', replacement: null };
  const unresolved = readableRecordedStateSections(sibling, { selectedRows: rows([original, sibling]) });
  assert.equal(values(unresolved, 'Recorded context edit')['Target evidence'], 'Unresolved on selected branch');
  const malformed = readableRecordedStateSections({ type: 'context_edit', id: 'bad', replacement: {} });
  assert.equal(values(malformed, 'Recorded context edit')['Recorded action'], 'Unsupported replacement; effect unknown');
  assert.equal(original.message.content, 'historical text');
  validate([...omitted, ...replaced, ...unresolved, ...malformed]);
});

test('system changes and compaction checkpoints explain removal, replacement and retained boundary without replay', () => {
  const entry = { type: 'message', id: 'system', message: { role: 'system', content: '',
    sections: { removed: null, replaced: 'new prompt', unsupported: { text: 'preserved evidence' } },
    toolsAdded: [{ name: 'read', parameters: { path: 'schema evidence' } }], toolsRemoved: ['write'] } };
  const sections = readableRecordedStateSections(entry);
  assert.equal(values(sections, 'System change: section removed')['Recorded action'], 'Remove named section');
  assert.equal(values(sections, 'System change: section replaced')['Recorded action'], 'Replace named section');
  assert.ok(sections.some((section) => section.type === 'code' && section.code === 'new prompt'));
  assert.match(JSON.stringify(sections), /preserved evidence/);
  assert.equal(values(sections, 'System change: toolsAdded')['Add or replace tool declaration 1'], 'read');
  assert.equal(values(sections, 'System change: toolsRemoved')['Remove tool declaration 1'], 'write');
  const compact = { type: 'compaction', id: 'compact', firstKeptEntryId: 'compact', tokensBefore: 0, systemMessage: entry.message };
  const compactSections = readableRecordedStateSections(compact, { selectedRows: rows([entry, compact]) });
  assert.equal(values(compactSections, 'Recorded compaction boundary')['Tokens before compaction'], '0');
  assert.match(values(compactSections, 'Recorded compaction boundary')['Boundary evidence'], /no earlier conversation entries retained/);
  assert.match(JSON.stringify(compactSections), /complete system checkpoint/);
  assert.match(JSON.stringify(compactSections), /does not replay effective context/);
  assert.match(JSON.stringify(readableRecordedStateSections({ type: 'compaction' })), /No complete system checkpoint is recorded/);
  validate([...sections, ...compactSections]);
});

test('read ranges are request evidence and write content does not invent a patch or old file', () => {
  const read = nativeToolReadingSections({ nativeActivity: 'read', arguments: { path: 'file.txt', offset: 0, limit: 2 } }, [{ details: {
    truncation: { truncated: true, totalLines: 40, outputLines: 2, totalBytes: 400, outputBytes: 20, truncatedBy: 'lines', lastLinePartial: false },
    fullOutputPath: '/does-not-exist/output',
  } }]);
  const range = values(read.timelineSections, 'Recorded read request');
  assert.equal(range['Offset (recorded)'], '0');
  assert.equal(range['Limit (recorded)'], '2');
  const truncation = values(read.inspectorSections, 'Recorded output truncation');
  assert.equal(truncation.Truncated, 'true');
  assert.equal(truncation['Last line partial'], 'false');
  assert.equal(truncation['Total lines'], '40');
  assert.equal(values(read.inspectorSections, 'Recorded output reference')['Full output path (reference only)'], '/does-not-exist/output');
  assert.match(JSON.stringify(read), /Missing metadata does not establish complete output/);
  const defaultRange = nativeToolReadingSections({ nativeActivity: 'read', arguments: { path: 'file.txt' } });
  assert.equal(values(defaultRange.timelineSections, 'Recorded read request')['Offset (recorded)'], 'Not recorded');
  const write = nativeToolReadingSections({ nativeActivity: 'write', arguments: { path: 'file.txt', content: '' } });
  assert.equal(values(write.timelineSections, 'Recorded write request')['Recorded content characters'], '0');
  assert.ok(write.timelineSections.some((section) => section.type === 'code' && section.code === ''));
  assert.ok(write.timelineSections.every((section) => !['patch', 'diff'].includes(section.type)));
  assert.match(JSON.stringify(write), /Previous content and whether the file was created or overwritten are not recorded/);
  const malformed = nativeToolReadingSections({}, [{ details: { truncation: { truncated: 'false', totalLines: -2 } } }]);
  assert.equal(values(malformed.inspectorSections, 'Recorded output truncation').Truncated, 'Invalid recorded value');
  assert.equal(values(malformed.inspectorSections, 'Recorded output truncation')['Total lines'], 'Invalid recorded value');
  validate([...read.timelineSections, ...read.inspectorSections, ...write.timelineSections, ...write.inspectorSections]);
});

test('large and malformed evidence stays bounded, valid and unchanged with redacted media', () => {
  const many = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`section${index}`, 'x'.repeat(50_000)]));
  let deep = {}; const root = deep;
  for (let index = 0; index < 1000; index++) { deep.next = {}; deep = deep.next; }
  const entry = { type: 'message', message: { role: 'system', content: 'a'.repeat(60_000), sections: many, toolsAdded: [root] } };
  const sections = readableRecordedStateSections(entry);
  assert.ok(sections.length < 40, 'display sections are bounded independently of source section count');
  assert.ok(JSON.stringify(sections).length < 40_000, 'large prompt bodies have a bounded display budget');
  assert.match(JSON.stringify(sections), /showing 8 of 2000/);
  assert.equal(Object.keys(entry.message.sections).length, 2000);
  assert.equal(entry.message.content.length, 60_000);
  const write = nativeToolReadingSections({ nativeActivity: 'write', arguments: { path: 'out.txt', content: 'z'.repeat(80_000) } });
  assert.ok(write.timelineSections.find((section) => section.type === 'code').code.length < 13_000);
  assert.match(JSON.stringify(write), /display limited to 12000/);
  assert.equal(values(write.timelineSections, 'Recorded write request')['Recorded content characters'], '80000');
  const media = readableRecordedStateSections({ type: 'context_edit', replacement: { content: [
    { type: 'image', data: 'private-media-payload', mimeType: 'image/png' },
    { type: 'text', text: 'data:image/png;base64,c2VjcmV0' },
  ] } });
  // Readable context evidence exposes image metadata without a payload dump.
  assert.equal(JSON.stringify(media).includes('private-media-payload'), false);
  assert.equal(JSON.stringify(media).includes('c2VjcmV0'), false);
  const missingReplacement = readableRecordedStateSections({ type: 'context_edit' });
  validate([...sections, ...write.timelineSections, ...write.inspectorSections, ...media, ...missingReplacement]);
});
