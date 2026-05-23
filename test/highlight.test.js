'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const highlighter = require('../public/highlight');

test('searchTerms deduplicates and sorts longer terms first', () => {
  assert.deepEqual(highlighter.searchTerms('alpha ALPHA alphabet beta'), ['alphabet', 'alpha', 'beta']);
});

test('highlightedParts marks terms case-insensitively without treating text as html', () => {
  const parts = highlighter.highlightedParts('Alpha <script>alert(1)</script> beta', ['alpha', '<script>']);

  assert.deepEqual(parts, [
    { text: 'Alpha', match: true },
    { text: ' ', match: false },
    { text: '<script>', match: true },
    { text: 'alert(1)</script> beta', match: false },
  ]);
});

test('highlightedParts prefers longer overlapping terms', () => {
  const parts = highlighter.highlightedParts('alphabet alpha', ['alpha', 'alphabet']);

  assert.deepEqual(parts, [
    { text: 'alphabet', match: true },
    { text: ' ', match: false },
    { text: 'alpha', match: true },
  ]);
});

test('highlightedParts leaves text unchanged without query terms', () => {
  assert.deepEqual(highlighter.highlightedParts('plain text', []), [{ text: 'plain text', match: false }]);
});
