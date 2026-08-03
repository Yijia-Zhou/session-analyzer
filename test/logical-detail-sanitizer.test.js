'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DATA_URL_MARKER,
  redactEmbeddedDataUrls,
  sanitizeLogicalDetailValue,
} = require('../src/shared/logical-detail-sanitizer');

test('embedded base64 data URLs preserve ordinary prose after a whitespace boundary', () => {
  assert.equal(
    redactEmbeddedDataUrls('data:text/plain;base64,AAAA after searchable words'),
    `${DATA_URL_MARKER} after searchable words`,
  );
  assert.equal(
    redactEmbeddedDataUrls('before data:text/plain;base64,AAAA after searchable words'),
    `before ${DATA_URL_MARKER} after searchable words`,
  );
  assert.equal(
    redactEmbeddedDataUrls('before data:text/plain;base64,AAAA 100% complete'),
    `before ${DATA_URL_MARKER} 100% complete`,
  );
});

test('embedded base64 data URLs keep high-confidence wrapped payloads redacted', () => {
  assert.equal(
    redactEmbeddedDataUrls('before data:image/png;base64,AAAA\nBBBB\tCCCC after searchable words'),
    `before ${DATA_URL_MARKER} after searchable words`,
  );
  assert.equal(
    redactEmbeddedDataUrls('before data:image/png;base64,AAAA\nYWJjZGVmZ2hpamtsbW5vcA== after searchable words'),
    `before ${DATA_URL_MARKER} after searchable words`,
  );
  assert.equal(
    redactEmbeddedDataUrls('data:text/plain;base64,AAAA\naaaaaaaaaaaaaaaa\nBBBB'),
    DATA_URL_MARKER,
  );
  assert.equal(
    redactEmbeddedDataUrls('before data:text/plain;base64,AAAA\naaaaaaaaaaaaaaaa\nBBBB after searchable words'),
    `before ${DATA_URL_MARKER} after searchable words`,
  );
  assert.equal(
    redactEmbeddedDataUrls('before data:text/plain;base64,AAAA encoded%20tail after searchable words'),
    `before ${DATA_URL_MARKER} after searchable words`,
  );
  assert.equal(
    redactEmbeddedDataUrls('before `data:text/plain;base64,QUJD\nREVGR0g=` after'),
    `before \`${DATA_URL_MARKER}\` after`,
  );
  assert.equal(
    redactEmbeddedDataUrls('before data:text/plain;base64,AAAA%%%%private-secret after searchable words'),
    `before ${DATA_URL_MARKER} after searchable words`,
  );
  assert.equal(
    redactEmbeddedDataUrls('data:text/plain;base64,YWJjZGVmZ2hpamtsbW5vcA=='),
    DATA_URL_MARKER,
  );
});

test('omitted object keys do not consume logical detail string budgets', () => {
  assert.deepEqual(
    sanitizeLogicalDetailValue({
      signature: 'x'.repeat(10_000),
      thinking: 'visible reasoning survives',
    }, {
      omitObjectKeys: new Set(['signature']),
      maxStringChars: 64,
      maxTotalStringChars: 64,
    }),
    { thinking: 'visible reasoning survives' },
  );
});
