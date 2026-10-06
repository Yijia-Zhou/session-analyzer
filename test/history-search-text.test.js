'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchText, containsText, excerptText } = require('../src/history-search-text');

function chunked(text, width) {
  return { toString() { throw new Error('Lazy text must not be coerced'); },
    *parts() { for (let i = 0; i < text.length; i += width) yield text.slice(i, i + width); } };
}

test('chunked matching preserves whole-string Unicode, whitespace, OR and NOT semantics', () => {
  const text = ' \t\n😀 İSTANBUL\t\n ΟΣ ΑΣ\u0301Α ΟΣ\u0301!  end  ';
  const queries = ['i', 'i\u0307stanbul ος', '😀', 'ος', 'ασ\u0301α', 'ος\u0301!', 'absent', 'end'];
  const normalized = text.toLowerCase().replace(/\s+/gu, ' ').trim();
  for (let width = 1; width <= text.length; width += 1) {
    const source = chunked(text, width);
    const actual = matchText(source, queries);
    assert.equal(actual.matched, true);
    assert.deepEqual(actual.terms, queries.filter((query) => normalized.includes(query)));
    assert.equal(actual.hitOffset, text.indexOf('😀'));
    assert.equal(matchText(source, ['i\u0307stanbul ος']).hitOffset, text.indexOf('İ'));
    assert.equal(matchText(source, queries, ['i\u0307stanbul ος']).matched, false);
    assert.equal(matchText(source, queries, ['missing']).matched, true);
    assert.equal(matchText(source, ['[object Object]']).matched, false);
  }
});

test('final sigma and whitespace normalization cross unbounded ignored runs without concatenation', () => {
  const marks = '\u0301'.repeat(40000);
  for (const tail of ['Α', '!']) {
    const text = `ΟΣ${marks}${tail}`;
    const query = tail === 'Α' ? 'οσ' : 'ος';
    assert.equal(matchText(chunked(text, 17), [query]).matched, true);
    assert.equal(matchText(chunked(text, 17), [tail === 'Α' ? 'ος' : 'οσ']).matched, false);
  }
  const text = 'alpha' + ' \t\r\n'.repeat(40000) + 'BETA';
  assert.deepEqual(matchText(chunked(text, 511), ['alpha beta']), { matched: true, terms: ['alpha beta'], hitOffset: 0 });
  assert.equal(matchText(chunked(text, 511), [], ['alpha beta']).matched, false);
});

test('Raw hints are case-sensitive and survive every part boundary', () => {
  for (let width = 1; width < 30; width += 1) {
    assert.equal(containsText(chunked('before session-analyzer after', width), 'session-analyzer'), true);
    assert.equal(containsText(chunked('before SESSION-ANALYZER after', width), 'session-analyzer'), false);
  }
});

test('bounded excerpts preserve line coordinates, CRLF, UTF-16 hit offset and truncation', () => {
  const lines = ['zero', 'one', 'two', 'three', 'four', '😀' + 'x'.repeat(300000) + 'NEEDLE' + 'y'.repeat(900), 'six', 'seven', 'eight', 'nine'];
  const text = lines.join('\r\n');
  const at = text.indexOf('NEEDLE');
  for (const width of [1, 31, 16384, 262144]) {
    const result = excerptText(chunked(text, width), at);
    assert.equal(result.startLine, 3);
    assert.equal(result.endLine, 9);
    assert.equal(result.hitOffset, at);
    assert.equal(result.text, ['two', 'three', 'four', '…' + text.slice(at - 80, at + 280) + '…', 'six', 'seven', 'eight'].join('\n'));
    assert.equal(result.truncated, true);
    assert.ok(result.text.length < 500);
  }
  assert.deepEqual(excerptText(chunked('a\r\nb\n', 1), 3), {
    representation: 'search_projection', startLine: 1, endLine: 3, hitOffset: 3, text: 'a\nb\n', truncated: false,
  });
  assert.equal(excerptText(chunked('', 1)).text, '');
  assert.equal(excerptText(chunked('x'.repeat(360) + '\r\nend', 1)).truncated, false);
  const nearEnd = 'x'.repeat(400) + 'HIT\r\nnext';
  assert.equal(excerptText(chunked(nearEnd, 31), 400).text, '…' + 'x'.repeat(80) + 'HIT…\nnext');
});
