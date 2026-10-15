'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSection, renderInspectorSections } = require('../src/browser/renderers');

const value = (text) => ({ state: 'value', value: text });
const ref = (line) => ({ rawId: `raw-${line}`, file: 'nested/rollout-synthetic.jsonl', line });
const observation = (kind, extra = {}) => ({
  kind, ...(kind === 'effort_update' ? {} : { model: value('model-context') }),
  effort: value('low'), rawRefs: [ref(4)], start: ref(4), endReason: 'snapshot_end', ...extra,
});
const section = (observations, extra = {}) => ({
  type: 'recorded_configuration', purpose: 'traceability', status: 'recorded', observations,
  truncated: false, ...extra,
});
const summary = (html) => html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] || '';

test('recorded configuration starts compact and separates context, instructions and defaults', () => {
  const html = renderSection(section([
    observation('thread_settings', { model: value('thread-model') }),
    observation('turn_context'),
    observation('effort_update', { effort: value('high') }),
  ]));
  assert.match(html, /<details class="recordedConfiguration">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(summary(html), /Recorded configuration/);
  assert.match(summary(html), /model-context/);
  assert.match(summary(html), /Context effort:.*low/);
  assert.match(summary(html), /Effort update instruction:.*high/);
  assert.doesNotMatch(summary(html), /thread-model|nested\/|raw-4|per-request|snapshot end/i);
  assert.match(html, /Thread defaults/);
  assert.match(html, /thread-model/);
  assert.match(html, /data-target-layer="raw" data-target-event-id="raw-4"/);
  assert.match(html, /Recorded evidence; actual per-request settings are not established\./);
});

test('mixed configuration never picks a representative model and reveals bounded evidence', () => {
  const html = renderSection(section([
    observation('turn_context', { model: value('first-model') }),
    observation('turn_context', { model: value('second-model'), end: ref(10), rawRefs: [ref(4), ref(10)], endReason: 'compaction' }),
  ], { status: 'mixed', truncated: true }));
  assert.match(summary(html), /Multiple observations/);
  assert.doesNotMatch(summary(html), /first-model|second-model/);
  assert.match(html, /first-model/);
  assert.match(html, /second-model/);
  assert.match(html, /Until compaction/);
  assert.match(html, /data-target-event-id="raw-10"/);
  assert.match(html, /Some observations are omitted/);
});

test('field states and collaboration settings stay distinct and untrusted strings are escaped', () => {
  const html = renderSection(section([
    observation('turn_context', { model: { state: 'missing' }, effort: { state: 'null' }, collaboration: {
      model: value('<img src=x onerror=alert(1)>'), effort: { state: 'invalid' },
    } }),
  ]));
  assert.match(html, /Not recorded/);
  assert.match(html, /Explicit null/);
  assert.match(html, /Invalid value/);
  assert.match(html, /Collaboration settings/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|medium/);
  assert.doesNotMatch(summary(html), /Collaboration settings|onerror/);
});

test('thread-only summaries are labeled and long identifiers are shortened only in summary', () => {
  const model = 'custom-model-'.repeat(35);
  const html = renderSection(section([observation('thread_settings', { model: value(model) })]));
  assert.match(summary(html), /Thread defaults/);
  assert.doesNotMatch(summary(html), /Context effort/);
  const summaryText = summary(html).replace(/<[^>]*>/g, '');
  assert.ok(summaryText.length < 180);
  assert.match(summaryText, /…/);
  assert.ok(html.includes(`>${model}</code>`));
});

test('configuration inspector uses Chinese labels and preserves machine values', (t) => {
  const original = globalThis.sessionAnalyzerLocale;
  globalThis.sessionAnalyzerLocale = 'zh-CN';
  t.after(() => { globalThis.sessionAnalyzerLocale = original; });
  const html = renderInspectorSections([section([
    observation('turn_context', { model: value('model-custom'), effort: value('ultra-custom'), end: ref(5), endReason: 'turn_boundary' }),
  ])]);
  assert.match(summary(html), /已记录配置/);
  assert.match(summary(html), /model-custom/);
  assert.match(summary(html), /上下文推理强度:.*ultra-custom/);
  assert.match(html, /至轮次边界/);
  assert.match(html, />快照依据<|>快照依据<\/button>/);
  assert.doesNotMatch(html, /Recorded configuration|Actual model/);
});
