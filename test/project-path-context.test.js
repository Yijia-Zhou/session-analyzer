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

async function windowsContextModule() {
  const filename = require.resolve('../src/project-path-context');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), { module, exports: module.exports, Buffer, process,
    require: (id) => id === 'node:path' ? path.win32 : localRequire(id) }, { filename });
  return module.exports;
}

test('Windows scope serialization ignores equivalent native spelling (lexical simulation, no filesystem claim)', async () => {
  const { createProjectPathContext: create } = await windowsContextModule();
  for (const root of ['C:\\SyntheticSource', '\\\\localhost\\share\\Source',
    '\\\\?\\C:\\SyntheticSource', '\\\\?\\UNC\\localhost\\share\\Source']) {
    const first = create({ sourceKind: 'pi', sourceHome: root,
      projectPathRules: [rule('artifact', 'sessions\\One.jsonl')] });
    const alias = create({ sourceKind: 'pi', sourceHome: root.toUpperCase().replaceAll('\\', '/') + '/',
      projectPathRules: [rule('artifact', 'sessions/ONE.jsonl'), rule('artifact', 'sessions/One.jsonl')] });
    assert.equal(first.sourceHome, path.win32.resolve(root), 'reader root retains its configured physical spelling');
    assert.equal(alias.sourceHome, path.win32.resolve(root.toUpperCase()), 'identity does not replace the physical root');
    assert.equal(alias.sourceHomeIdentity, first.sourceHomeIdentity);
    assert.equal(alias.serialized, first.serialized, root);
    assert.equal(alias.digest, first.digest);
    assert.equal(create({ sourceKind: 'pi', sourceHome: root.toUpperCase(),
      projectPathContext: first.serialized }).serialized, first.serialized);
    assert.notEqual(create({ sourceKind: 'pi', sourceHome: root + '-2',
      projectPathRules: [rule('artifact', 'sessions\\One.jsonl')] }).digest, first.digest);
    assert.notEqual(create({ sourceKind: 'codex', sourceHome: root,
      projectPathRules: [rule('artifact', 'sessions\\One.jsonl')] }).digest, first.digest);
    assert.notEqual(create({ sourceKind: 'pi', sourceHome: root,
      projectPathRules: [rule('artifact', 'sessions\\One.jsonl', 'posix')] }).digest, first.digest);
  }
  const roots = ['C:\\Source', '\\\\?\\C:\\Source', '\\\\localhost\\share\\Source',
    '\\\\?\\UNC\\localhost\\share\\Source', '\\\\other\\share\\Source', '\\\\localhost\\other\\Source'];
  assert.equal(new Set(roots.map(sourceHome => create({ sourceKind: 'pi', sourceHome }).digest)).size, roots.length);
});

test('POSIX scope serialization preserves case and literal backslash boundaries', { skip: process.platform === 'win32' }, () => {
  const create = (sourceHome, target) => createProjectPathContext({ sourceKind: 'pi', sourceHome,
    projectPathRules: [rule('artifact', target)] });
  const first = create('/synthetic/Source', 'sessions/One.jsonl');
  assert.equal(create('/synthetic/Source/', './sessions/One.jsonl').serialized, first.serialized);
  assert.notEqual(create('/synthetic/source', 'sessions/One.jsonl').digest, first.digest);
  assert.notEqual(create('/synthetic/Source', 'sessions/one.jsonl').digest, first.digest);
  assert.notEqual(create('/synthetic/Source', 'sessions\\One.jsonl').digest, first.digest);
});

test('Windows source mutations retain captured rules, index and running job for equal homes (lexical simulation, no filesystem claim)', async () => {
  const context = await windowsContextModule();
  const filename = require.resolve('../server');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), { module, exports: module.exports, Buffer, process,
    require: (id) => id === 'node:path' ? path.win32
      : id === './src/project-path-context' ? context : localRequire(id) }, { filename });
  const { resolveSourceMutation } = module.exports;
  const kinds = ['codex', 'claude-code', 'deepseek-harness', 'pi', 'workbuddy', 'opencode'];
  const { requireSourceAdapter } = require('../src/source-adapters');
  for (const sourceKind of kinds) {
    const sourceHome = `C:\\SyntheticSource\\${sourceKind}`;
    const rules = [rule('container', 'sessions')];
    const sourceConfigs = Object.fromEntries(kinds.map(kind => [kind, {
      home: `C:\\SyntheticSource\\${kind}`, projectPathRules: rules,
    }]));
    const index = { repoRoot: 'C:\\SyntheticProject' };
    const controller = new AbortController();
    const state = { sourceKind, sourceConfigs, sourceRevision: 0, activeSourceRevision: 0,
      index, activeProjectJob: { status: 'running', controller }, localInputBase: 'C:\\Synthetic',
      adapter: requireSourceAdapter(sourceKind) };
    const before = context.createProjectPathContext({ sourceKind, sourceHome, sourceConfigs });
    for (const body of [
      { source: sourceKind, sourceConfigs: { [sourceKind]: { home: sourceHome.toUpperCase() + '\\' } } },
      { source: sourceKind, [requireSourceAdapter(sourceKind).homeOption]: sourceHome.toUpperCase().replaceAll('\\', '/') },
      { source: sourceKind, sourceConfigs: { [sourceKind]: { home: sourceHome.toUpperCase(),
        projectPathRules: [rule('container', 'SESSIONS')] } } },
    ]) {
      const result = resolveSourceMutation(state, body);
      assert.equal(result.errors.length, 0);
      assert.equal(result.payload.projectPathPolicyId, before.digest, sourceKind);
      assert.equal(state.index, index);
      assert.equal(controller.signal.aborted, false);
      assert.equal(state.activeSourceRevision, 0);
      assert.equal(state.sourceConfigs[sourceKind].home, sourceHome, 'preserve the configured spelling');
      assert.equal(state.sourceConfigs[sourceKind].projectPathRules.length, 1);
    }
    resolveSourceMutation(state, { source: sourceKind,
      sourceConfigs: { [sourceKind]: { home: sourceHome.toUpperCase(), projectPathRules: [] } } });
    assert.equal(state.index, null, 'an explicit rule change still retires the index');
    assert.equal(controller.signal.aborted, true);
    assert.equal(state.activeSourceRevision, 1);
  }
});

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
