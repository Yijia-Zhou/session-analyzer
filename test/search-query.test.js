'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const searchQuery = require('../src/browser/search-query');

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

test('parseSearchInput accepts goal lifecycle status values', () => {
  const parsed = searchQuery.parseSearchInput('status:active status:blocked status:complete');

  assert.equal(parsed.q, '');
  assert.equal(parsed.status, 'complete');
});

test('parseSearchInput accepts open-ended kind values', () => {
  const parsed = searchQuery.parseSearchInput('kind:review kind:plan_update kind:exec_command_begin');

  assert.equal(parsed.q, '');
  assert.equal(parsed.kind, 'exec_command_begin');
});

test('parseSearchInput keeps unknown operators literal and reports known invalid values outside phrase text', () => {
  const parsed = searchQuery.parseSearchInput('layer:nope owner:me error file:');

  assert.equal(parsed.q, 'owner:me error');
  assert.equal(parsed.kind, '');
  assert.equal(parsed.file, '');
  assert.equal(parsed.retainedInput, 'layer:nope owner:me error file:');
  assert.deepEqual(parsed.errors, [
    { operator: 'layer', value: 'nope', raw: 'layer:nope', error: 'invalid-value' },
    { operator: 'file', value: '', raw: 'file:', error: 'missing-value' },
  ]);
});

test('search query helpers remove and upsert operators', () => {
  assert.equal(searchQuery.removeOperator('alpha file:public/app.js kind:patch', 'file'), 'alpha kind:patch');
  assert.equal(searchQuery.removeFreeText('alpha file:public/app.js kind:patch'), 'file:public/app.js kind:patch');
  assert.equal(searchQuery.upsertOperator('alpha file:old.js', 'file', 'public app.js'), 'alpha file:"public app.js"');
});

test('structuredSearchKey ignores free text and tracks structural filters', () => {
  const base = searchQuery.structuredSearchKey({ q: 'alpha' }, 'main', 'mtime-desc');

  assert.equal(searchQuery.structuredSearchKey({ q: 'beta' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchQuery.structuredSearchKey({ q: 'alpha', kind: 'command' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchQuery.structuredSearchKey({ q: 'alpha', status: 'failed' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchQuery.structuredSearchKey({ q: 'alpha', file: 'src/app.js' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchQuery.structuredSearchKey({ q: 'alpha', layer: 'raw' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchQuery.structuredSearchKey({ q: 'alpha' }, 'protocol', 'mtime-desc'), base);
  assert.notEqual(searchQuery.structuredSearchKey({ q: 'alpha' }, 'main', 'start-asc'), base);
});
