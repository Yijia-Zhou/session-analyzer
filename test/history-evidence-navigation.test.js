'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { referenceFromHash, createEvidenceNavigation } = require('../src/browser/history-evidence');
const { excerptCoveredByText, renderSupplement } = require('../src/browser/search-excerpt');
const { escapeHtml } = require('../src/browser/renderers');
const i18n = require('../src/shared/i18n');

test('reference hash accepts canonical and alias keys without decoding twice', () => {
  assert.equal(referenceFromHash('#evidenceRef=hr1.test%2Bvalue'), 'hr1.test+value');
  assert.equal(referenceFromHash('#ref=hr1.other'), 'hr1.other');
  assert.equal(referenceFromHash('#event=unrelated'), '');
});

test('new references and user cancellation permanently retire pending navigation', () => {
  const navigation = createEvidenceNavigation();
  const first = navigation.start();
  const second = navigation.start();
  assert.equal(first.current(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.current(), true);
  navigation.cancel();
  assert.equal(second.current(), false);
  assert.equal(second.signal.aborted, true);
  const retry = navigation.start();
  assert.equal(retry.current(), true);
  assert.equal(second.current(), false);
});

test('excerpt coverage preserves evidence text while accepting readable Markdown formatting', () => {
  const excerpt = (text) => ({ text, startLine: 3, hitLine: 3 });
  assert.equal(excerptCoveredByText(excerpt('**1253/1253 tests passed**, `17891` ready.'), '1253/1253 tests passed, 17891 ready.', { markdown: true }), true);
  assert.equal(excerptCoveredByText(excerpt('- **Result**: all tests passed.'), 'Result: all tests passed.', { markdown: true }), true);
  assert.equal(excerptCoveredByText(excerpt('a * b'), 'ab', { markdown: true }), false);
  assert.equal(excerptCoveredByText(excerpt('a\tb  c'), 'a b c'), true);
  assert.equal(excerptCoveredByText(excerpt('DEEP_OUTPUT_HIT'), 'other output'), false);
  assert.equal(excerptCoveredByText(excerpt('[report](https://example.test/needle)'), 'report', { markdown: true }), false);
  assert.equal(excerptCoveredByText(excerpt('![needle](image.png)'), '', { markdown: true }), false);
  assert.equal(excerptCoveredByText(excerpt('&amp;'), '&', { markdown: true }), false);
  const longLine = 'readable '.repeat(40);
  assert.equal(excerptCoveredByText(excerpt(`…${longLine}…`), `before ${longLine} after`), true);
  assert.equal(excerptCoveredByText({ text: 'before\nhit\nafter', startLine: 3, hitLine: 4 }, 'before after'), false);
});

test('excerpt position labels require consistent search-projection coordinates and retain unlocated text', () => {
  const excerpt = { representation: 'search_projection', startLine: 128, endLine: 130, hitLine: 129, text: 'before\nhit\nafter' };
  const render = (value, locale = 'en') => renderSupplement({ key: 'position-test', mode: 'history', eventId: 'event', excerpt: value }, {
    escapeHtml, t: (key, vars) => i18n.t(locale, 'ui', key, vars),
  });
  assert.match(render(excerpt), /Search text · Lines 128–130 · Match on line 129/);
  assert.match(render(excerpt, 'zh-CN'), /搜索文本 · 第 128–130 行 · 命中第 129 行/);
  assert.match(render({ ...excerpt, startLine: 129, endLine: 129, text: 'hit' }), /Search text · Match on line 129/);
  for (const patch of [
    { representation: 'raw' }, { hitLine: undefined }, { startLine: 0 },
    { hitLine: 131 }, { endLine: 131 }, { hitLine: 129.5 },
  ]) {
    const html = render({ ...excerpt, ...patch });
    assert.doesNotMatch(html, /searchSupplementLocation/);
    assert.match(html, /before/);
  }
});
