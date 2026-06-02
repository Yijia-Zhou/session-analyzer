'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const highlighter = require('../public/highlight');

test('searchTerms preserves one trimmed free-text phrase', () => {
  assert.deepEqual(highlighter.searchTerms('  alpha ALPHA alphabet beta  '), ['alpha ALPHA alphabet beta']);
});

test('displayedMatchTotal keeps backend coverage and never undercounts rendered targets', () => {
  assert.equal(highlighter.displayedMatchTotal(5, 3), 5);
  assert.equal(highlighter.displayedMatchTotal(3, 4), 4);
  assert.equal(highlighter.displayedMatchTotal(undefined, 'nope'), 0);
});

test('highlightedParts marks a phrase case-insensitively with flexible whitespace', () => {
  const parts = highlighter.highlightedParts('before Alpha \n\t beta after', ['alpha beta']);

  assert.deepEqual(parts, [
    { text: 'before ', match: false },
    { text: 'Alpha \n\t beta', match: true },
    { text: ' after', match: false },
  ]);
});

test('highlightedParts treats regex characters literally and counts non-overlapping phrases', () => {
  const parts = highlighter.highlightedParts('a+b a+b unrelated a b', ['a+b']);

  assert.deepEqual(parts, [
    { text: 'a+b', match: true },
    { text: ' ', match: false },
    { text: 'a+b', match: true },
    { text: ' unrelated a b', match: false },
  ]);
});

test('highlightedParts leaves text unchanged without query terms', () => {
  assert.deepEqual(highlighter.highlightedParts('plain text', []), [{ text: 'plain text', match: false }]);
});
