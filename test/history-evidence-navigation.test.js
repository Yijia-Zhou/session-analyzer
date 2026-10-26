'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { referenceFromHash, createEvidenceNavigation, createHistoryTraversalGuard } = require('../src/browser/history-evidence');
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

test('an owned traversal consumes its matching hashchange once, including after cancellation', () => {
  const guard = createHistoryTraversalGuard();
  const saved = { owner: 'document-a', id: 4 };
  const navigation = createEvidenceNavigation();
  const restore = navigation.start();
  guard.claim('http://viewer.test/#ref=saved', saved);
  navigation.cancel();
  assert.equal(restore.current(), false);
  assert.equal(guard.consume('http://viewer.test/#ref=saved', { ...saved }), true,
    'the companion event must not restart a restore cancelled by newer input');
  assert.equal(guard.consume('http://viewer.test/#ref=saved', saved), false);
});

test('genuine hash changes, unrelated owners and newer traversals retain their own navigation', () => {
  const guard = createHistoryTraversalGuard();
  const saved = { owner: 'document-a', id: 4 };
  const url = 'http://viewer.test/#ref=saved';
  for (const [nextUrl, nextSaved] of [
    ['http://viewer.test/#ref=another', saved], ['http://viewer.test/', saved],
    [url, null], [url, { ...saved, owner: 'document-b' }], [url, { ...saved, id: 5 }],
  ]) {
    guard.claim(url, saved);
    assert.equal(guard.consume(nextUrl, nextSaved), false);
    assert.equal(guard.consume(url, saved), false, 'a mismatched event retires the old claim');
  }
  guard.claim(url, saved);
  guard.claim(url, null);
  assert.equal(guard.consume(url, saved), false, 'unowned popstate clears a previous claim');
  guard.claim(url, saved);
  const next = { ...saved, id: 5 };
  guard.claim('http://viewer.test/?piEntry=next', next);
  assert.equal(guard.consume('http://viewer.test/?piEntry=next', next), true);
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
