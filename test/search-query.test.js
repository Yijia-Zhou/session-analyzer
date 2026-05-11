'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const searchQuery = require('../public/search-query');

test('parseSearchInput separates free text from supported operators', () => {
  const parsed = searchQuery.parseSearchInput('detail extraction kind:patch status:failed file:public/app.js layer:raw');

  assert.equal(parsed.q, 'detail extraction');
  assert.equal(parsed.kind, 'patch');
  assert.equal(parsed.status, 'failed');
  assert.equal(parsed.file, 'public/app.js');
  assert.equal(parsed.layer, 'raw');
});

test('parseSearchInput supports quoted operator values and last operator wins', () => {
  const parsed = searchQuery.parseSearchInput('file:src/old.js file:"public app.js" status:success status:failed');

  assert.equal(parsed.q, '');
  assert.equal(parsed.file, 'public app.js');
  assert.equal(parsed.status, 'failed');
});

test('parseSearchInput keeps unknown or invalid operators as text', () => {
  const parsed = searchQuery.parseSearchInput('kind:nope owner:me error file:');

  assert.equal(parsed.q, 'kind:nope owner:me error');
  assert.equal(parsed.kind, '');
  assert.equal(parsed.file, '');
});

test('search query helpers remove and upsert operators', () => {
  assert.equal(searchQuery.removeOperator('alpha file:public/app.js kind:patch', 'file'), 'alpha kind:patch');
  assert.equal(searchQuery.removeFreeText('alpha file:public/app.js kind:patch'), 'file:public/app.js kind:patch');
  assert.equal(searchQuery.upsertOperator('alpha file:old.js', 'file', 'public app.js'), 'alpha file:"public app.js"');
});
