'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectSearchJson } = require('../src/search-json');
const { redactEmbeddedDataUrls } = require('../src/shared/logical-detail-sanitizer');

const policy = {
  excludedKeys: new Set(['signature']), opaqueTypes: new Set(['image']),
  redactString: redactEmbeddedDataUrls,
};

test('search JSON preserves safe original syntax and deeply nested text', () => {
  const value = '{ "nested" : '.repeat(6000) + '"complete-tail"' + ' }'.repeat(6000);
  assert.equal(projectSearchJson(value, policy), value);
});

test('search JSON removes opaque values and redacts media keys without dropping colliding values', () => {
  const value = JSON.parse('{"__proto__":{"polluted":"own-field"},"constructor":{"value":"constructor-field"}}');
  value['data:image/png;base64,QUJDREVGRw=='] = 'first-value';
  value['data:image/png;base64,SElKS0xNTg=='] = 'second-value';
  value.signature = 'forbidden-signature';
  value.media = { type: 'image', data: 'forbidden-media' };
  const result = projectSearchJson(JSON.stringify(value), policy);
  assert.doesNotMatch(result, /QUJDREVGRw|SElKS0xNTg|forbidden/);
  const decoded = JSON.parse(result);
  assert.equal(Object.hasOwn(decoded, '__proto__'), true);
  assert.equal(decoded.__proto__.polluted, 'own-field');
  assert.equal(decoded.constructor.value, 'constructor-field');
  assert.ok(Object.values(decoded).includes('first-value'));
  assert.ok(Object.values(decoded).includes('second-value'));
  assert.equal({}.polluted, undefined);
});
