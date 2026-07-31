'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sameProjectRoot } = require('../src/shared/project-root');

test('project root comparison preserves POSIX case and literal separators', () => {
  assert.equal(sameProjectRoot('/work/Foo', '/work/foo'), false);
  assert.equal(sameProjectRoot('/work/Foo/', '/work/Foo'), true);
  assert.equal(sameProjectRoot('/work/Foo\\Bar', '/work/Foo/Bar'), false);
});

test('project root comparison follows Windows case and separator equivalence', () => {
  assert.equal(sameProjectRoot('C:\\work\\Foo', 'c:/WORK/foo/'), true);
  assert.equal(sameProjectRoot('C:\\', 'c:/'), true);
  assert.equal(sameProjectRoot('\\\\Server\\Share\\Foo', '//server/share/foo/'), true);
  assert.equal(sameProjectRoot('C:\\work\\Foo', '/work/Foo'), false);
});
