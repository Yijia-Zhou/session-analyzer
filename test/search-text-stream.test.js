'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { searchTextParts } = require('../src/search-text-stream');

function oracle(text, query) {
  if (!query.trim()) return 0;
  const pattern = query.trim().split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return [...text.matchAll(new RegExp(pattern, 'gi'))].length;
}

function* segments(text, width) {
  for (let offset = 0; offset < text.length; offset += width) yield text.slice(offset, offset + width);
}

test('streaming search counts cross-part phrases without bounding whitespace-run length', async () => {
  const text = `start A${' \r\n\u2003'.repeat(1024 * 1024)}B middle a\tb end`;
  const result = await searchTextParts([], segments(text, 16381), 'a b');
  assert.equal(result.count, 2);
  assert.equal(result.hit, true);
  assert.match(result.snippet, /A B/);
  assert.ok(result.snippet.length <= 266);
});

test('streaming search preserves non-overlap, literal metacharacters, JS case folding and preview priority', async () => {
  for (const [text, query] of [
    ['aaaaaaa', 'aaa'], ['a a a a a', 'a a'], ['😀😀😀', '😀😀'],
    ['K k K İ i ı ſ S s', 'k'], ['K k K İ i ı ſ S s', 's'],
    ['[x].* [X].*', '[x].*'], ['a\u0085b a\uFEFFb', 'a b'],
    ['中文\n\t😀尾 中文 😀尾', '中文 😀尾'], ['\ud800x\ud800X', '\ud800x'],
  ]) {
    for (const width of [1, 2, 3, 7, 100]) {
      const result = await searchTextParts([], segments(text, width), query);
      assert.equal(result.count, oracle(text, query), JSON.stringify({ text, query, width }));
    }
  }
  const result = await searchTextParts(['preview needle'], ['body needle needle'], 'needle');
  assert.equal(result.count, 2);
  assert.equal(result.snippet, 'preview needle');
  assert.deepEqual(await searchTextParts(['text'], ['text'], ' \t'), { count: 0, hit: false, snippet: '' });
});

test('random segmented streaming results agree with original regex counts', async () => {
  let seed = 0x62d998;
  const random = limit => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const alphabet = ['a', 'A', 'b', 'B', ' ', '\t', '\r\n', '\u2003', '\u0085', '中', '😀', '[', '.', 'K', 'K'];
  for (let trial = 0; trial < 500; trial += 1) {
    const text = Array.from({ length: 100 + random(200) }, () => alphabet[random(alphabet.length)]).join('');
    const start = random(text.length);
    const query = text.slice(start, start + 1 + random(12));
    const result = await searchTextParts([], segments(text, 1 + random(35)), query);
    assert.equal(result.count, oracle(text, query), JSON.stringify({ trial, text, query }));
  }
});

test('long queries keep bounded snippets and cancellation yields during hot synchronous input', async () => {
  const query = 'a'.repeat(10000);
  const result = await searchTextParts([], segments(`before ${query} after`, 1111), query);
  assert.equal(result.count, 1);
  assert.ok(result.snippet.length <= 266);
  const controller = new AbortController();
  const reason = new Error('cancel synthetic streaming search');
  setImmediate(() => controller.abort(reason));
  let visited = 0;
  function* manyParts() {
    for (let i = 0; i < 100; i += 1) { visited += 1; yield 'z'.repeat(256 * 1024); }
  }
  await assert.rejects(searchTextParts([], manyParts(), 'needle', controller.signal), error => error === reason);
  assert.ok(visited <= 4, `cancellation consumed ${visited} parts`);
});
