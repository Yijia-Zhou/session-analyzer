'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  PROJECT_PATH_VERSION,
  interpretProjectPath,
  sameProjectPath,
  projectPathContains,
} = require('../src/shared/project-path');

const interpreted = (value, doubleSlash) => interpretProjectPath(value, { doubleSlash });
const unc = (value) => interpreted(value, 'unc');
const posix = (value) => interpreted(value, 'posix');

// These tests cover lexical project semantics. Actual filesystem behavior and
// reader authorization have separate integration tests; no stat/open is implied.
test('project paths retain raw text and mark the unknown double-slash compatibility assumption', () => {
  const raw = '//Server/Share/Project/../Other/';
  const result = interpretProjectPath(raw);
  assert.equal(result.status, 'valid');
  assert.equal(result.raw, raw);
  assert.equal(result.path, '/Server/Share/Other');
  assert.equal(result.semantics, 'posix');
  assert.equal(result.evidence, 'legacy');
  assert.equal(result.legacyAssumption, true);
  assert.equal(sameProjectPath(result, '/Server/Share/Other'), true);
  assert.equal(sameProjectPath(result, '\\\\Server\\Share\\Other'), false);
});

test('explicit UNC spellings have one versioned identity, including the share root', () => {
  for (const [left, right] of [
    ['//Server/Share/Project', '\\\\server\\share\\project\\'],
    ['//Server/Share', '\\\\server\\share\\'],
    ['//Server/Share/./a/../Project', '\\\\server\\share\\project'],
  ]) {
    const a = unc(left);
    const b = interpretProjectPath(right);
    assert.equal(a.status, 'valid');
    assert.equal(b.status, 'valid');
    assert.equal(a.version, PROJECT_PATH_VERSION);
    assert.equal(a.key, b.key);
    assert.equal(sameProjectPath(a, b), true);
    assert.equal(a.evidence, 'user');
    assert.equal(b.evidence, 'syntax');
    assert.equal(a.legacyAssumption, false);
    assert.equal(a.comparison, 'windows-lowercase-v1');
  }
});

test('identity is independent of the evidence label', () => {
  const producer = interpretProjectPath('//server/share/Project', { semantics: 'windows' });
  const user = unc('//SERVER/SHARE/project');
  const syntax = interpretProjectPath('\\\\server\\share\\project');
  assert.equal(producer.evidence, 'producer');
  assert.equal(sameProjectPath(producer, user), true);
  assert.equal(sameProjectPath(user, syntax), true);
  assert.equal(producer.key, syntax.key);
  assert.equal(posix('//work/Project').key, interpretProjectPath('/work/Project').key);
});

test('POSIX semantics preserve case, literal backslashes and ordinary components', () => {
  assert.equal(sameProjectPath(posix('//work/Project'), posix('//work/project')), false);
  assert.equal(sameProjectPath('/work/a\\b', '/work/a/b'), false);
  assert.equal(sameProjectPath('/work/a\\b/./c', '/work/a\\b/c'), true);
  assert.equal(projectPathContains('/work/Project/..notes', '/work/Project'), true);
  assert.equal(projectPathContains('/work/Project-2', '/work/Project'), false);
  assert.equal(posix('//work/Project').evidence, 'user');
  assert.equal(posix('//work/Project').comparison, 'posix-case-sensitive-v1');
});

test('the A/B/C counterexample remains symmetric and transitive in each fixed interpretation', () => {
  const raw = ['/tmp/share/Project', '//tmp/share/Project', '\\\\tmp\\share\\Project'];
  for (const doubleSlash of ['legacy', 'posix', 'unc']) {
    const values = raw.map((value) => interpreted(value, doubleSlash));
    for (const a of values) for (const b of values) {
      assert.equal(sameProjectPath(a, b), sameProjectPath(b, a));
      for (const c of values) {
        if (sameProjectPath(a, b) && sameProjectPath(b, c)) {
          assert.equal(sameProjectPath(a, c), true);
        }
      }
    }
    assert.equal(sameProjectPath(values[0], values[1]), doubleSlash !== 'unc');
    assert.equal(sameProjectPath(values[1], values[2]), doubleSlash === 'unc');
    assert.equal(sameProjectPath(values[0], values[2]), false);
  }
});

test('UNC containment checks server, share and directory components before descendants', () => {
  const root = unc('//server/share');
  const project = unc('//server/share/Project');
  assert.equal(projectPathContains(project, root), true);
  assert.equal(projectPathContains(root, root), true);
  assert.equal(projectPathContains(unc('//SERVER/SHARE/project/child'), project), true);
  assert.equal(projectPathContains(unc('//server/share/Project-2'), project), false);
  assert.equal(projectPathContains(unc('//server/share-2/Project'), root), false);
  assert.equal(projectPathContains(unc('//server-2/share/Project'), root), false);
  assert.equal(projectPathContains('/server/share/Project', root), false);
  assert.equal(projectPathContains(unc('//server/share/..notes'), root), true);
});

test('UNC dot segments cannot cross the volume root', () => {
  assert.equal(sameProjectPath(unc('//server/share/../../Other'), unc('//server/share/Other')), true);
  assert.equal(projectPathContains(unc('//server/share/../Other'), unc('//server/other')), false);
  assert.equal(sameProjectPath(unc('//server/share/child/..'), unc('//server/share')), true);
  assert.equal(projectPathContains(unc('//server/share/../sibling'), unc('//server/share/project')), false);
});

test('drive paths keep the legacy lowercase logical policy without aliasing other roots', () => {
  assert.equal(sameProjectPath('C:\\Work\\Project', 'c:/work/project/'), true);
  assert.equal(sameProjectPath('C:\\', 'c:/'), true);
  assert.equal(sameProjectPath('C:\\Work', 'D:\\Work'), false);
  assert.equal(sameProjectPath('C:\\Work', '/C:/Work'), false);
  assert.equal(sameProjectPath('C:\\Work', '\\\\server\\share\\Work'), false);
  assert.equal(projectPathContains('C:/work/project/child', 'c:\\WORK\\project'), true);
  assert.equal(projectPathContains('D:/work/project/child', 'c:/work'), false);
  assert.equal(projectPathContains('C:/work/project-2', 'c:/work/project'), false);
  assert.equal(sameProjectPath('C:/../../Work', 'C:/Work'), true);
});

test('single-slash POSIX roots do not become Windows current-drive paths', () => {
  assert.equal(interpretProjectPath('/work/Project').status, 'valid');
  assert.equal(interpretProjectPath('/work/Project').semantics, 'posix');
  assert.equal(interpretProjectPath('/work/Project', { semantics: 'windows' }).status, 'invalid');
  assert.equal(interpretProjectPath('\\work\\Project').status, 'invalid');
  assert.equal(interpretProjectPath('C:Project').status, 'invalid');
});

test('three or more forward leading slashes use POSIX semantics even under a local UNC rule', () => {
  for (const value of ['///server/share/Project', '////server/share/Project', '////']) {
    const result = unc(value);
    assert.equal(result.status, 'valid');
    assert.equal(result.semantics, 'posix');
    assert.equal(result.evidence, 'syntax');
    assert.equal(result.legacyAssumption, false);
    assert.equal(sameProjectPath(result, value.replace(/^\/+/, '/')), true);
  }
  assert.equal(interpretProjectPath('///server/share/Project', { semantics: 'windows' }).status, 'invalid');
});

test('trusted source semantics take priority and incompatible source evidence reports conflict', () => {
  const windows = interpretProjectPath('//server/share/Project', { semantics: 'windows', doubleSlash: 'posix' });
  const unix = interpretProjectPath('//server/share/Project', { semantics: 'posix', doubleSlash: 'unc' });
  assert.equal(windows.evidence, 'producer');
  assert.equal(windows.semantics, 'windows');
  assert.equal(unix.evidence, 'producer');
  assert.equal(unix.semantics, 'posix');
  assert.equal(sameProjectPath(windows, unix), false);
  for (const semantics of [['posix', 'windows'], ['windows', 'posix'], ['posix', 'windows', 'posix']]) {
    const conflict = interpretProjectPath('//server/share/Project', { semantics, doubleSlash: 'unc' });
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.evidence, 'producer');
    assert.equal(conflict.key, '');
    assert.equal(sameProjectPath(conflict, windows), false);
    assert.equal(projectPathContains(conflict, unix), false);
  }
  assert.equal(interpretProjectPath('//server/share/Project', { semantics: ['windows', 'windows'] }).key, windows.key);
});

test('empty, wrong-type, NUL and historical relative paths have explicit invalid outcomes', () => {
  for (const value of [undefined, null, false, 0, 7, {}, [], '', '.', '..', 'project', 'project/child', 'C:project', '\\project', '/work/\u0000project']) {
    const result = interpretProjectPath(value);
    assert.equal(result.status, 'invalid', JSON.stringify(value));
    assert.equal(result.raw, value);
    assert.equal(result.key, '');
    assert.equal(Boolean(result.reason), true);
    assert.equal(sameProjectPath(result, result), false);
    assert.equal(projectPathContains(result, result), false);
  }
});

test('ordinary UNC validation rejects incomplete, dot-root and repeated-root separator shapes', () => {
  for (const value of ['//', '//server', '//server/', '//server//share', '//server/./project', '//server/../project', '//../share/project', '///server/share']) {
    assert.equal(interpretProjectPath(value, { semantics: 'windows' }).status, 'invalid', value);
  }
  for (const value of ['\\\\', '\\\\server', '\\\\server\\', '\\\\server\\\\share', '\\\\server\\.\\project', '\\\\server\\..\\project', '\\\\..\\share\\project', '\\\\\\server\\share']) {
    assert.equal(interpretProjectPath(value).status, 'invalid', value);
  }
  // Unknown double-forward-slash paths remain POSIX-compatible until a rule
  // supplies Windows semantics; rejecting malformed UNC must not reject POSIX.
  assert.equal(interpretProjectPath('//server//share').status, 'valid');
  assert.equal(interpretProjectPath('//server/../project').status, 'valid');
});

test('extended and device namespaces remain unsupported and never alias ordinary UNC', () => {
  for (const value of ['\\\\?\\UNC\\server\\share\\Project', '\\\\?\\C:\\Project', '\\\\.\\pipe\\name', '\\\\.\\C:\\Project']) {
    const result = interpretProjectPath(value);
    assert.equal(result.status, 'unsupported', value);
    assert.equal(result.key, '');
    assert.equal(sameProjectPath(result, unc('//server/share/Project')), false);
  }
  assert.equal(unc('//?/UNC/server/share/Project').status, 'unsupported');
  assert.equal(unc('//./pipe/name').status, 'unsupported');
  assert.equal(interpretProjectPath('//?/UNC/server/share/Project').status, 'valid');
  assert.equal(interpretProjectPath('//?/UNC/server/share/Project').semantics, 'posix');
});

test('invalid interpretation options cannot silently fall back to legacy semantics', () => {
  for (const options of [null, false, 'unc', [], { doubleSlash: 'windows' }, { semantics: 'unknown' }, { semantics: ['windows', null] }]) {
    assert.equal(interpretProjectPath('//server/share/Project', options).status, 'invalid');
  }
});

test('captured descriptors can cross JSON boundaries without changing identity or containment', () => {
  const original = unc('//SERVER/Share/Project');
  const copy = JSON.parse(JSON.stringify(original));
  assert.equal(sameProjectPath(original, copy), true);
  assert.equal(projectPathContains(unc('//server/share/project/child'), copy), true);
  assert.equal(Object.isFrozen(original), true);
  assert.equal(Object.isFrozen(original.components), true);
  const altered = { ...copy, components: ['Other'] };
  assert.equal(sameProjectPath(original, altered), false);
  assert.equal(projectPathContains(original, altered), false);
  assert.equal(sameProjectPath(original, { ...copy, version: PROJECT_PATH_VERSION + 1 }), false);
});

test('comparison order does not mutate the captured interpretation or its raw evidence', () => {
  const path = interpretProjectPath('//server/share/Project');
  const before = JSON.stringify(path);
  for (const other of [unc('//server/share/Project'), '/server/share/Project', '\\\\server\\share\\Project']) {
    sameProjectPath(path, other);
    sameProjectPath(other, path);
    projectPathContains(path, other);
    projectPathContains(other, path);
  }
  assert.equal(JSON.stringify(path), before);
  assert.equal(path.evidence, 'legacy');
});

test('the shared semantic implementation runs without Node, process, cwd or filesystem globals', () => {
  const source = fs.readFileSync(require.resolve('../src/shared/project-path'), 'utf8');
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const api = sandbox.module.exports;
  assert.equal(api.interpretProjectPath('//server/share/Project').key, interpretProjectPath('//server/share/Project').key);
  assert.equal(api.interpretProjectPath('//server/share/Project', { doubleSlash: 'unc' }).key, unc('//server/share/Project').key);
  assert.equal(api.interpretProjectPath('C:project').status, 'invalid');
});
