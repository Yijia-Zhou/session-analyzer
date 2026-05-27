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
  const tokenUsage = renderSection({ type: 'token_usage', title: 'Token usage', items: [{ label: 'Total', formatted: '1,234', primary: true }] });
  const usageLimits = renderSection({ type: 'usage_limits', title: 'Usage limits', items: [{ label: 'Weekly usage limit', remaining: '67%', reset: 'May 20, 2026, 10:16 AM' }] });
  const rawJson = renderSection({ type: 'raw_json', title: 'Raw JSON', value: { raw: true } });
  const expandedRawJson = renderSection({ type: 'raw_json', title: 'Raw JSON', value: { raw: true }, expanded: true });

  assert.match(markdown, /<strong>safe<\/strong>/);
  assert.match(markdown, /class="sectionTitle">Message/);
  assert.doesNotMatch(hiddenTitleMarkdown, /sectionTitle/);
  assert.match(hiddenTitleMarkdown, /<p>body<\/p>/);
  assert.match(code, /echo &quot;&lt;x&gt;&quot;/);
  assert.match(code, /class="codeFence"/);
  assert.match(code, /<code>shell<\/code>/);
  assert.match(terminal, /terminalBlock stderr/);
  assert.match(terminal, /<code>text<\/code>/);
  assert.match(json, /&quot;ok&quot;: true/);
  assert.match(diff, /diffLine removed/);
  assert.match(diff, /diffLine added/);
  assert.match(notice, /&lt;script&gt;/);
  assert.match(kv, /<table class="kvTable">/);
  assert.match(tokenUsage, /class="tokenUsageItem primary"/);
  assert.match(tokenUsage, /1,234/);
  assert.match(usageLimits, /Weekly usage limit/);
  assert.match(usageLimits, /67% remaining/);
  assert.match(rawJson, /<details class="rawJsonDetails">/);
  assert.match(expandedRawJson, /<details class="rawJsonDetails" open>/);
});

test('renderer outputs patch sections with file summaries, line numbers, and escaped code', () => {
  const patch = renderSection({
    type: 'patch',
    title: 'Patch',
    files: [{
      path: 'src/app.js',
      changeType: 'update',
      additions: 1,
      deletions: 1,
      hunks: [{
        header: '@@',
        lines: [
          { kind: 'context', oldLine: 1, newLine: 1, content: 'const ok = true;' },
          { kind: 'removed', oldLine: 2, newLine: null, content: '<old>' },
          { kind: 'added', oldLine: null, newLine: 2, content: '<new>' },
        ],
      }],
    }],
  });

  assert.match(patch, /src\/app\.js/);
  assert.match(patch, /\+1 \/ -1/);
  assert.match(patch, /patchLine context/);
  assert.match(patch, /patchLine removed/);
  assert.match(patch, /patchLine added/);
  assert.match(patch, /&lt;new&gt;/);
});
