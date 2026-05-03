'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSection } = require('../public/renderers');

test('renderer outputs safe markdown, code, terminal, json, diff, notice, and kv fragments', () => {
  const markdown = renderSection({ type: 'markdown', title: 'Message', html: '<p><strong>safe</strong></p>' });
  const hiddenTitleMarkdown = renderSection({ type: 'markdown', title: 'Message', hideTitle: true, html: '<p>body</p>' });
  const code = renderSection({ type: 'code', title: 'Command', code: 'echo "<x>"', language: 'shell' });
  const terminal = renderSection({ type: 'terminal', title: 'stderr', text: 'boom', stream: 'stderr' });
  const json = renderSection({ type: 'json', title: 'Payload', value: { ok: true } });
  const diff = renderSection({ type: 'diff', title: 'Patch', text: '@@\n-old\n+new' });
  const notice = renderSection({ type: 'notice', title: 'Warning', text: '<script>', level: 'warning' });
  const kv = renderSection({ type: 'kv', title: 'Meta', entries: [{ key: 'cwd', value: 'G:\\repo' }] });
  const rawJson = renderSection({ type: 'raw_json', title: 'Raw JSON', value: { raw: true } });
  const expandedRawJson = renderSection({ type: 'raw_json', title: 'Raw JSON', value: { raw: true }, expanded: true });

  assert.match(markdown, /<strong>safe<\/strong>/);
  assert.match(markdown, /class="sectionTitle">Message/);
  assert.doesNotMatch(hiddenTitleMarkdown, /sectionTitle/);
  assert.match(hiddenTitleMarkdown, /<p>body<\/p>/);
  assert.match(code, /echo &quot;&lt;x&gt;&quot;/);
  assert.match(terminal, /terminalBlock stderr/);
  assert.match(json, /&quot;ok&quot;: true/);
  assert.match(diff, /diffLine removed/);
  assert.match(diff, /diffLine added/);
  assert.match(notice, /&lt;script&gt;/);
  assert.match(kv, /<table class="kvTable">/);
  assert.match(rawJson, /<details class="rawJsonDetails">/);
  assert.match(expandedRawJson, /<details class="rawJsonDetails" open>/);
});
