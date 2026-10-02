'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { forEachJsonChunk, hashPlainValue, plainValueByteLength } = require('../src/plain-value-stream');

test('incremental plain JSON preserves UTF-8 bytes and historical snapshot identities', () => {
  const values = [null, [], {}, { omitted: undefined, array: [undefined, null, true, -0, 1e30] },
    { '键': `escape\n\t\\"${'x'.repeat(8190)}😀${'界'.repeat(80_000)}\ud800\udc00\ud800` },
    Array.from({ length: 65_537 }, (_, index) => ({ index, name: `file-${index}` }))];
  for (const value of values) {
    const expected = JSON.stringify(value);
    const chunks = [];
    forEachJsonChunk(value, (chunk) => {
      assert.ok(chunk.length <= 64 * 1024);
      chunks.push(chunk);
    });
    assert.equal(chunks.join(''), expected);
    assert.equal(plainValueByteLength(value), Buffer.byteLength(expected));
    assert.equal(hashPlainValue(value), createHash('sha256').update(expected).digest('base64url'));
  }
});

test('incremental plain JSON rejects cyclic data', () => {
  const value = {}; value.cycle = value;
  assert.throws(() => hashPlainValue(value), /cyclic/);
});

test('incremental JSON encoding has no recursive call-stack depth limit', () => {
  const source = '{"nested":'.repeat(6000) + '"deep-tail"' + '}'.repeat(6000);
  const value = JSON.parse(source);
  const chunks = [];
  forEachJsonChunk(value, (chunk) => chunks.push(chunk));
  assert.equal(chunks.join(''), source);
  assert.equal(plainValueByteLength(value), Buffer.byteLength(source));
});
