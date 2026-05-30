'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSection, renderSections, renderTimelineSections } = require('../public/renderers');

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
  assert.match(code, /echo/);
  assert.match(code, /&quot;&lt;x&gt;&quot;/);
  assert.match(code, /class="codeFence"/);
  assert.match(code, /class="language-shell hljs"/);
  assert.match(terminal, /terminalBlock stderr/);
  assert.match(terminal, /class="language-text"/);
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
        lineNumbers: false,
        lines: [
          { kind: 'context', oldLine: 1, newLine: 1, lineNumberReliable: false, content: 'const ok = true;' },
          { kind: 'removed', oldLine: 2, newLine: null, lineNumberReliable: false, content: '<old>' },
          { kind: 'added', oldLine: null, newLine: 2, lineNumberReliable: false, content: '<new>' },
        ],
      }],
      lineNumbers: false,
    }],
  });

  assert.match(patch, /src\/app\.js/);
  assert.match(patch, /class="eventSection patchBlock"/);
  assert.doesNotMatch(patch, /<div class="patchBlock"/);
  assert.doesNotMatch(patch, /class="sectionTitle">Patch/);
  assert.match(patch, /\+1 \/ -1/);
  assert.match(patch, /patchLine context/);
  assert.match(patch, /patchLine removed/);
  assert.match(patch, /patchLine added/);
  assert.match(patch, /patchLineNo muted/);
  assert.match(patch, /&lt;new&gt;/);
});

test('renderer shows reliable patch line numbers when available', () => {
  const patch = renderSection({
    type: 'patch',
    files: [{
      path: 'src/app.js',
      changeType: 'update',
      additions: 1,
      deletions: 1,
      lineNumbers: true,
      hunks: [{
        header: '@@ -9,1 +9,1 @@',
        lineNumbers: true,
        lines: [
          { kind: 'removed', oldLine: 9, newLine: null, lineNumberReliable: true, content: 'old();' },
          { kind: 'added', oldLine: null, newLine: 9, lineNumberReliable: true, content: 'newCall();' },
        ],
      }],
    }],
  });

  assert.match(patch, /patchLineNo">9/);
  assert.doesNotMatch(patch, /patchLineNo muted/);
});

test('renderer groups command and terminal sections as one command run', () => {
  const html = renderSections([
    { type: 'code', title: 'Command', code: 'echo "<x>"', language: 'shell' },
    { type: 'terminal', title: 'stdout', text: 'ok', stream: 'stdout', language: 'text' },
    { type: 'terminal', title: 'stderr', text: '<boom>', stream: 'stderr', language: 'text' },
  ]);

  assert.match(html, /class="eventSection commandRun"/);
  assert.match(html, /commandRunSegment commandRunCommand/);
  assert.match(html, /commandRunOutput stdout/);
  assert.match(html, /commandRunOutput stderr/);
  assert.match(html, /echo/);
  assert.match(html, /&quot;&lt;x&gt;&quot;/);
  assert.match(html, /&lt;boom&gt;/);
  assert.doesNotMatch(html, /class="codeFence"/);
});

test('renderer keeps an escaped preview when expanded timeline detail is inspector-only', () => {
  const fallback = renderTimelineSections([], 'cwd: G:\\repo <unsafe>');
  const body = renderTimelineSections([{ type: 'notice', title: 'Status', text: 'Done.' }], 'duplicate preview');

  assert.match(fallback, /eventExpandedFallback/);
  assert.match(fallback, /cwd: G:\\repo &lt;unsafe&gt;/);
  assert.doesNotMatch(fallback, /<unsafe>/);
  assert.match(body, /Done\./);
  assert.doesNotMatch(body, /duplicate preview/);
});

test('renderer applies highlight.js syntax highlighting when available', () => {
  const previous = globalThis.hljs;
  globalThis.hljs = {
    getLanguage: (language) => language === 'powershell' || language === 'javascript',
    highlight: (source, options) => ({
      value: `<span class="hljs-title">${source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span><span class="hljs-language">${options.language}</span>`,
    }),
  };
  try {
    const command = renderSections([
      {
        type: 'code',
        title: 'Command',
        code: 'powershell.exe -Command "Get-ChildItem <x>" $env:Path',
        language: 'powershell',
      },
    ]);
    const patch = renderSection({
      type: 'patch',
      files: [{
        path: 'src/app.js',
        changeType: 'update',
        additions: 1,
        deletions: 0,
        hunks: [{ lines: [{ kind: 'added', oldLine: null, newLine: 1, content: 'const ok = true;' }] }],
      }],
    });

    assert.match(command, /hljs-title/);
    assert.match(command, /hljs-language">powershell/);
    assert.match(command, /&lt;x&gt;/);
    assert.doesNotMatch(command, /<x>/);
    assert.match(patch, /language-javascript hljs/);
    assert.match(patch, /const ok = true/);
  } finally {
    globalThis.hljs = previous;
  }
});
