'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildEventDetail } = require('../src/codex');
const { buildClaudeEventDetail } = require('../src/claude-detail');
const { renderMarkdownToHtml } = require('../src/deepseek-harness');
const { sectionMarkdown } = require('../src/deepseek-harness-detail');

function messageHtml(builder, text) {
  const raw = {
    rawId: 'markdown-raw',
    recordType: 'response_item',
    payloadType: 'message',
    messageText: text,
    parsed: { payload: { type: 'message', role: 'assistant' } },
  };
  const event = {
    id: 'markdown-event',
    kind: 'assistant_message',
    layer: 'main',
    rawRefs: [{ rawId: raw.rawId }],
  };
  const detail = builder({ rawEvents: [raw], logicalEvents: [event] }, event.id, event.layer);
  return detail.timelineSections.find((section) => section.type === 'markdown').html;
}

const renderers = {
  codex: (text) => messageHtml(buildEventDetail, text),
  claude: (text) => messageHtml(buildClaudeEventDetail, text),
  deepseek: renderMarkdownToHtml,
  'deepseek detail': (text) => sectionMarkdown(text, 'content').html,
};

for (const [source, render] of Object.entries(renderers)) {
  test(`${source} Markdown preserves links and code while escaping HTML`, () => {
    const html = render([
      'https://example.com/path and reader@example.com',
      '',
      '`https://code.example.com`',
      '',
      '```text',
      'https://fenced.example.com <script>code</script>',
      '```',
      '',
      '<script>alert(1)</script>',
      '',
      '[unsafe](javascript:alert(1))',
    ].join('\n'));
    assert.match(html, /href="https:\/\/example\.com\/path"/u);
    assert.match(html, /href="mailto:reader@example\.com"/u);
    assert.match(html, /<code>https:\/\/code\.example\.com<\/code>/u);
    assert.match(html, /<pre><code class="language-text">https:\/\/fenced\.example\.com &lt;script&gt;code&lt;\/script&gt;/u);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
    assert.doesNotMatch(html, /<script|href="javascript:|href="https:\/\/(?:code|fenced)\.example/u);
  });
}

test('Codex Markdown keeps its HTTP and mailto-only link policy', () => {
  const html = renderers.codex('[web](https://example.com) [mail](mailto:reader@example.com) [ftp](ftp://example.com) [relative](./local)');
  assert.match(html, /href="https:\/\/example\.com"/u);
  assert.match(html, /href="mailto:reader@example\.com"/u);
  assert.doesNotMatch(html, /href="(?:ftp:|\.\/)/u);
});

// GHSA-253c-mchw-3w2r: exercise both payload shapes in a disposable process.
// The generous timeout is a hang safeguard, not a millisecond performance gate.
for (const shape of ['soft-broken emails', 'unregistered schemes']) {
  test(`Markdown linkification handles repeated ${shape}`, () => {
    const script = `
      const assert = require('node:assert/strict');
      const { renderMarkdownToHtml } = require('./src/deepseek-harness');
      const count = 20000;
      if (process.argv[1] === 'soft-broken emails') {
        const html = renderMarkdownToHtml('a@b.co\\n'.repeat(count));
        assert.equal((html.match(/href="mailto:a@b.co"/g) || []).length, count);
      } else {
        const text = 'a://'.repeat(count);
        const html = renderMarkdownToHtml(text);
        assert.equal(html, '<p>' + text + '</p>\\n');
      }
    `;
    const result = spawnSync(process.execPath, ['-e', script, shape], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}
