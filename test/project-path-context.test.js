'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createProjectPathContext, normalizeProjectPathRules, projectPathFor,
  projectSelection, projectPathMatches } = require('../src/project-path-context');
const { interpretProjectPath } = require('../src/shared/project-path');

const home = path.resolve('/synthetic-source');
const rule = (scope, target, interpretation = 'unc') => ({ scope, path: target, interpretation });
const capture = (rules = []) => createProjectPathContext({ sourceKind: 'pi', sourceHome: home, projectPathRules: rules });

test('artifact rules are independent of selected project, comparison order and sibling locators', () => {
  const artifact = path.join(home, 'sessions', 'one.jsonl');
  const context = capture([rule('artifact', artifact)]);
  const raw = '//server/share/Project';
  const explicit = projectPathFor(raw, context, artifact);
  assert.equal(explicit.key, interpretProjectPath('\\\\server\\share\\project').key);
  assert.equal(explicit.legacyAssumption, false);
  assert.equal(projectPathFor(raw, context, `${artifact}-2`).legacyAssumption, true);
  assert.equal(projectPathFor(raw, context, path.join(home, 'sessions-2', 'one.jsonl')).legacyAssumption, true);
  assert.equal(projectPathMatches(raw, '\\\\server\\share\\Project', artifact, context.serialized), true);
  assert.equal(projectPathMatches(raw, '/server/share/Project', artifact, context.serialized), false);
  assert.equal(projectPathMatches(raw, '\\\\server\\share\\Project', artifact, context.serialized), true);
});

test('container rules cover future child locators and stop at physical directory boundaries', () => {
  const context = capture([rule('container', 'sessions/chosen')]);
  const raw = '//server/share/Project';
  for (const filename of ['old.jsonl', 'new/subagent.jsonl']) {
    assert.equal(projectPathFor(raw, context, path.join(home, 'sessions', 'chosen', filename)).semantics, 'windows');
  }
  for (const filename of ['sessions/chosen-2/session.jsonl', 'sessions/outside.jsonl']) {
    assert.equal(projectPathFor(raw, context, path.join(home, filename)).semantics, 'posix');
  }
});

test('context capture is immutable, order independent and bound to source kind and home', () => {
  const input = [rule('artifact', 'sessions/two.jsonl'), rule('artifact', 'sessions/one.jsonl', 'posix')];
  const first = capture(input);
  const second = capture([...input].reverse());
  assert.equal(first.digest, second.digest);
  input[0].interpretation = 'posix';
  assert.equal(first.rules.find((entry) => entry.path.endsWith('two.jsonl')).interpretation, 'unc');
  assert.throws(() => first.rules.push(rule('artifact', 'x')), TypeError);
  assert.throws(() => { first.rules[0].path = 'changed'; }, TypeError);
  assert.equal(createProjectPathContext({ sourceKind: 'pi', sourceHome: home, projectPathContext: first.serialized }).digest, first.digest);
  assert.throws(() => createProjectPathContext({ sourceKind: 'codex', sourceHome: home, projectPathContext: first.serialized }), { code: 'INVALID_PROJECT_PATH_POLICY' });
  assert.throws(() => createProjectPathContext({ sourceKind: 'pi', sourceHome: path.join(home, 'other'), projectPathContext: first.serialized }), { code: 'INVALID_PROJECT_PATH_POLICY' });
  assert.throws(() => createProjectPathContext({ sourceKind: 'pi', sourceHome: home, projectPathContext: ` ${first.serialized}` }), { code: 'INVALID_PROJECT_PATH_POLICY' });
});

test('overlapping contradictory rules and escaping or malformed scope inputs are rejected', () => {
  const invalidSets = [null, {}, [rule('container', '../outside')], [rule('glob', 'sessions')],
    [rule('artifact', 'sessions', 'unknown')], [rule('artifact', 'bad\0path')],
    [rule('container', 'sessions'), rule('artifact', 'sessions/a.jsonl', 'posix')]];
  for (const input of invalidSets) {
    assert.throws(() => normalizeProjectPathRules(input, home), { code: 'INVALID_PROJECT_PATH_POLICY' });
  }
  assert.throws(() => createProjectPathContext({ sourceKind: 'pi', sourceHome: home, projectPathRules: null }), { code: 'INVALID_PROJECT_PATH_POLICY' });
  assert.throws(() => createProjectPathContext({ sourceKind: 'pi', sourceHome: home,
    sourceConfigs: { pi: { home, projectPathRules: null } } }), { code: 'INVALID_PROJECT_PATH_POLICY' });
  assert.equal(capture([rule('container', 'sessions'), rule('artifact', 'sessions/a.jsonl')]).rules.length, 2);
});

test('native scope equality rejects Windows case aliases while POSIX case-distinct artifacts stay separate', () => {
  const rules = [rule('artifact', 'sessions/One.jsonl'), rule('artifact', 'sessions/one.jsonl', 'posix')];
  if (process.platform === 'win32') {
    assert.throws(() => normalizeProjectPathRules(rules, home), { code: 'INVALID_PROJECT_PATH_POLICY' });
  } else {
    assert.equal(normalizeProjectPathRules(rules, home).length, 2);
  }
});

test('Windows path API scope equality is consistent for case aliases (lexical simulation, no filesystem claim)', async () => {
  const filename = require.resolve('../src/project-path-context');
  const source = await fs.readFile(filename, 'utf8');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Buffer, process,
    require: (id) => id === 'node:path' ? path.win32 : localRequire(id) }, { filename });
  const root = 'C:\\SyntheticSource';
  assert.throws(() => module.exports.normalizeProjectPathRules([
    rule('artifact', 'sessions\\One.jsonl'), rule('artifact', 'sessions\\one.jsonl', 'posix'),
  ], root), { code: 'INVALID_PROJECT_PATH_POLICY' });
  assert.throws(() => module.exports.normalizeProjectPathRules([
    rule('artifact', 'sessions\\one.jsonl', 'posix'), rule('artifact', 'sessions\\One.jsonl'),
  ], root), { code: 'INVALID_PROJECT_PATH_POLICY' });
});

test('legacy assumptions and unresolved semantic conflict are observable without project-dependent fallback', () => {
  const entries = [];
  const context = capture();
  const file = path.join(home, 'sessions', 'one.jsonl');
  const descriptor = projectPathFor('//server/share/Project', context, file, (entry) => entries.push(entry));
  assert.equal(descriptor.legacyAssumption, true);
  assert.equal(entries[0].code, 'PROJECT_PATH_LEGACY_ASSUMPTION');
  const conflict = projectPathFor('//server/share/Project', context, file, (entry) => entries.push(entry), ['windows', 'posix']);
  assert.equal(conflict.status, 'conflict');
  assert.equal(entries[1].code, 'PROJECT_PATH_CONFLICT');
});

test('only explicit local project input borrows a captured base; history does not', () => {
  const base = path.resolve('/captured-input-base');
  assert.equal(projectSelection('child', base).path, path.join(base, 'child'));
  assert.equal(projectPathFor('child', capture(), path.join(home, 'session.jsonl')).status, 'invalid');
  for (const relative of ['C:child', '\\child']) assert.throws(() => projectSelection(relative, base), { code: 'INVALID_PROJECT_PATH_POLICY' });
  assert.equal(projectSelection('//server/share/Project', base, 'windows').key, interpretProjectPath('\\\\server\\share\\Project').key);
  assert.equal(projectSelection('//server/share/Project', base, 'posix').key, interpretProjectPath('/server/share/Project').key);
  if (process.platform !== 'win32') {
    assert.throws(() => projectSelection('child', base, 'windows'), { code: 'INVALID_PROJECT_PATH_POLICY' },
      'a POSIX base cannot complete an explicitly Windows relative project input');
    assert.throws(() => projectSelection('child', 'C:\\captured', 'windows'), { code: 'INVALID_PROJECT_PATH_POLICY' },
      'a foreign Windows base cannot borrow this POSIX process current drive');
  }
});
