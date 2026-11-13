'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { interpretProjectPath, sameProjectPath, projectPathContains } = require('../src/shared/project-path');
const { createProjectPathContext, projectPathFor, projectSelection, projectPathMatches } = require('../src/project-path-context');
const { requireSourceAdapter, materializeSessionForIndex, validateIndexOwnershipForCommit,
  readIndexedRawRecord, buildEventDetailForSession } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

test('Codex keeps its existing native-namespace project history readable through synthetic source files', async (t) => {
  // Only the physical source files below are opened on this host. The recorded
  // Windows namespace paths are lexical history evidence, not Windows FS proof.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-namespace-'));
  const cwd = '\\\\?\\C:\\Project';
  const file = path.join(home, 'sessions', 'rollout-namespace.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'synthetic-namespace', cwd } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'synthetic namespace compatibility' } },
  ];
  const bytes = rows.map(JSON.stringify).join('\n') + '\n';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  const indexes = [];
  t.after(() => { for (const index of indexes) disposeProjectQueryStore(index.projectQueryStore); });
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const adapter = requireSourceAdapter('codex');
  const index = await adapter.buildIndex({ sourceHome: home, repoRoot: cwd });
  indexes.push(index);
  assert.equal(index.sessions.length, 1);
  await validateIndexOwnershipForCommit(index);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  if (Object.hasOwn(session, 'matchesRepo')) assert.equal(session.matchesRepo, true);
  const event = session.logicalEvents.find((entry) => entry.layer === 'main');
  assert.ok(event);
  assert.ok(await buildEventDetailForSession(index, session, event.id, 'main'));
  for (const raw of session.rawEvents) {
    assert.ok(bytes.split('\n').includes((await readIndexedRawRecord(index, session, raw.rawId)).raw));
  }
  const legacy = await require('../src/codex').buildIndex({ codexHome: home, repoRoot: cwd });
  indexes.push(legacy);
  assert.equal(legacy.sessions.length, 1);
  assert.equal(legacy.sessions[0].matchesRepo, true);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
});

const legacy = (raw, options = {}) => interpretProjectPath(raw, { ...options, legacyNamespace: true });
const roots = ['\\\\?\\C:\\Project', '\\\\?\\UNC\\server\\share\\Project', '\\\\.\\pipe\\name',
  '\\\\.\\C:\\Project', '\\\\?\\Volume{SYNTHETIC}\\Project', '\\\\?\\GLOBALROOT\\Device\\SyntheticVolume\\Project',
  '\\\\.\\SyntheticDevice\\Project'];

test('native namespaces stay opt-in and preserve independent compatibility identities', () => {
  for (const raw of roots) {
    assert.equal(interpretProjectPath(raw).status, 'unsupported', raw);
    const descriptor = legacy(raw);
    assert.equal(descriptor.status, 'valid', raw);
    assert.equal(descriptor.raw, raw);
    assert.equal(descriptor.namespace, raw[2] === '?' ? 'windows-extended' : 'windows-device');
    assert.equal(descriptor.namespaceCompatibility, true);
    assert.equal(descriptor.evidence, 'legacy');
    assert.equal(descriptor.legacyAssumption, false);
    assert.equal(descriptor.path, raw);
    assert.equal(sameProjectPath(descriptor, legacy(raw.toLowerCase())), true);
    assert.equal(sameProjectPath(raw, raw), false, 'ordinary string comparison does not implicitly enable compatibility');
  }
});

test('namespace compatibility never strips prefixes or creates slash/ordinary aliases', () => {
  for (const [special, ordinary] of [
    ['\\\\?\\C:\\Project', 'C:\\Project'],
    ['\\\\.\\C:\\Project', 'C:\\Project'],
    ['\\\\?\\UNC\\server\\share\\Project', '\\\\server\\share\\Project'],
    ['\\\\.\\pipe\\name', '\\\\pipe\\name'],
  ]) {
    assert.equal(sameProjectPath(legacy(special), interpretProjectPath(ordinary)), false);
    assert.equal(projectPathContains(legacy(special), interpretProjectPath(ordinary)), false);
  }
  assert.equal(sameProjectPath(legacy('\\\\?\\C:\\Project'), legacy('\\\\.\\C:\\Project')), false);
  for (const raw of ['//?/C:/Project', '//?/UNC/server/share/Project', '//./pipe/name']) {
    assert.equal(legacy(raw, { semantics: 'windows' }).status, 'unsupported');
    assert.equal(legacy(raw, { doubleSlash: 'unc' }).status, 'unsupported');
    assert.equal(legacy(raw).namespace, 'posix');
  }
});

test('compatibility containment validates namespace roots and complete directory components', () => {
  assert.equal(projectPathContains(legacy('\\\\?\\C:\\Project\\child'), legacy('\\\\?\\C:\\Project')), true);
  assert.equal(projectPathContains(legacy('\\\\?\\C:\\Project-2'), legacy('\\\\?\\C:\\Project')), false);
  assert.equal(projectPathContains(legacy('\\\\?\\D:\\Project'), legacy('\\\\?\\C:\\')), false);
  assert.equal(projectPathContains(legacy('\\\\?\\UNC\\server\\share\\Project'), legacy('\\\\?\\UNC\\server\\share')), true);
  assert.equal(projectPathContains(legacy('\\\\?\\UNC\\server\\share-2\\Project'), legacy('\\\\?\\UNC\\server\\share')), false);
  assert.equal(projectPathContains(legacy('\\\\?\\UNC\\server-2\\share\\Project'), legacy('\\\\?\\UNC\\server\\share')), false);
  assert.equal(sameProjectPath(legacy('\\\\?\\UNC\\server\\share\\..\\..\\Project'), legacy('\\\\?\\UNC\\server\\share\\Project')), true);
  assert.equal(projectPathContains(legacy('\\\\?\\Volume{SYNTHETIC-2}\\Project'), legacy('\\\\?\\Volume{SYNTHETIC}\\')), false);
  assert.equal(projectPathContains(legacy('\\\\.\\pipe\\name\\child'), legacy('\\\\.\\pipe\\name')), true);
  assert.equal(projectPathContains(legacy('\\\\.\\pipe\\name-2'), legacy('\\\\.\\pipe\\name')), false);
  assert.equal(projectPathContains(legacy('\\\\.\\UNC\\server\\share\\Project'), legacy('\\\\.\\UNC\\server\\share')), true);
  assert.equal(projectPathContains(legacy('\\\\.\\UNC\\server\\share-2\\Project'), legacy('\\\\.\\UNC\\server\\share')), false);
});

test('namespace descriptors round-trip through JSON and reject forged roots/components/keys', () => {
  const descriptor = legacy('\\\\?\\UNC\\server\\share\\Project');
  const copy = JSON.parse(JSON.stringify(descriptor));
  assert.equal(sameProjectPath(descriptor, copy), true);
  for (const altered of [
    { ...copy, namespaceCompatibility: false },
    { ...copy, root: '\\\\?\\UNC\\server\\other\\' },
    { ...copy, components: ['Different'] },
    { ...copy, namespace: 'windows-unc' },
    { ...copy, root: '', components: [] },
    { ...copy, key: descriptor.key + 'forged' },
  ]) {
    assert.equal(sameProjectPath(descriptor, altered), false);
    assert.equal(projectPathContains(descriptor, altered), false);
  }
});

test('incomplete, relative, dot, NUL and repeated namespace root separators get no identity', () => {
  for (const raw of ['\\\\?\\', '\\\\.\\', '\\\\?\\C:', '\\\\?\\C:relative', '\\\\.\\C:relative',
    '\\\\?\\UNC', '\\\\?\\UNC\\server', '\\\\?\\UNC\\server\\', '\\\\?\\UNC\\server\\\\share',
    '\\\\.\\UNC', '\\\\.\\UNC\\server', '\\\\.\\UNC\\server\\', '\\\\.\\UNC\\server\\\\share',
    '\\\\?\\UNC\\..\\share\\Project', '\\\\?\\UNC\\server\\.\\Project', '\\\\?\\.\\Project',
    '\\\\.\\..\\Project', '\\\\?\\\\Volume\\Project', '\\\\?\\C:\\bad\u0000name']) {
    const descriptor = legacy(raw);
    assert.notEqual(descriptor.status, 'valid', raw);
    assert.equal(descriptor.key, '', raw);
    assert.equal(sameProjectPath(descriptor, descriptor), false);
  }
  assert.equal(interpretProjectPath('C:\\Project', { legacyNamespace: 'yes' }).status, 'invalid');
});

test('Node project context exposes a separate compatibility diagnostic and honors POSIX/conflicting evidence', () => {
  const context = createProjectPathContext({ sourceKind: 'codex', sourceHome: path.resolve('/synthetic-namespace-source') });
  const artifact = path.join(context.sourceHome, 'sessions', 'one.jsonl');
  const diagnostics = [];
  for (const raw of roots) {
    const descriptor = projectPathFor(raw, context, artifact, (entry) => diagnostics.push(entry));
    assert.equal(descriptor.namespaceCompatibility, true);
    assert.equal(descriptor.legacyAssumption, false);
    assert.equal(projectSelection(raw).key, descriptor.key);
    assert.equal(projectPathMatches(raw, raw, artifact, context.serialized), true);
    assert.equal(projectPathMatches(raw, raw, artifact), true);
    assert.equal(projectSelection(raw, undefined, 'windows').evidence, 'legacy');
    assert.equal(projectPathFor(raw, context, artifact, undefined, 'posix').status, 'invalid');
    assert.equal(projectPathFor(raw, context, artifact, undefined, ['windows', 'posix']).status, 'conflict');
    assert.throws(() => projectSelection(raw, undefined, 'posix'), { code: 'INVALID_PROJECT_PATH_POLICY' });
  }
  assert.ok(diagnostics.every((entry) => entry.code === 'PROJECT_PATH_NAMESPACE_COMPATIBILITY'));
});

test('Codex discovery and strict readback retain generic namespace roots without ordinary project aliases', { skip: process.platform === 'win32' }, async (t) => {
  // These real source files contain synthetic namespace text. No Windows device
  // or extended path is opened, and this is not native namespace FS validation.
  // Discovery's exists probe would stat these names on Windows, so that host
  // runs the lexical/reader cases above and leaves device probing unrequested.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'namespace-source-readback-'));
  const contents = new Map();
  const indexes = [];
  await fs.mkdir(path.join(home, 'sessions'));
  t.after(() => { for (const index of indexes) disposeProjectQueryStore(index.projectQueryStore); });
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  for (const [i, cwd] of roots.entries()) {
    const file = path.join(home, 'sessions', 'rollout-namespace-' + i + '.jsonl');
    const rows = [
      { type: 'session_meta', payload: { id: 'synthetic-namespace-' + i, cwd } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'synthetic namespace ' + i } },
    ];
    const bytes = rows.map(JSON.stringify).join('\n') + '\n';
    await fs.writeFile(file, bytes);
    contents.set(file, bytes);
  }
  const adapter = requireSourceAdapter('codex');
  const projects = await adapter.discoverProjects({ sourceHome: home });
  assert.equal(projects.length, roots.length);
  assert.equal(new Set(projects.map((project) => project.projectPath.key)).size, roots.length);
  assert.ok(projects.every((project) => project.sessionCount === 1
    && project.projectPath.namespaceCompatibility && !project.legacyAssumption));
  for (const [i, cwd] of roots.entries()) {
    const index = await adapter.buildIndex({ sourceHome: home, repoRoot: cwd });
    indexes.push(index);
    assert.equal(index.sessions.length, 1, cwd);
    assert.equal(index.sessions[0].sourceSessionId, 'synthetic-namespace-' + i);
    await validateIndexOwnershipForCommit(index);
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    assert.deepEqual([...session.cwdSet], [cwd]);
    const event = session.logicalEvents.find((entry) => entry.layer === 'main');
    assert.ok(await buildEventDetailForSession(index, session, event.id, 'main'));
    for (const raw of session.rawEvents) {
      const record = await readIndexedRawRecord(index, session, raw.rawId);
      assert.ok([...contents.values()].some((bytes) => bytes.split('\n').includes(record.raw)));
    }
  }
  for (const ordinary of ['C:\\Project', '\\\\server\\share\\Project']) {
    const index = await adapter.buildIndex({ sourceHome: home, repoRoot: ordinary });
    indexes.push(index);
    assert.equal(index.sessions.length, 0, 'a legacy namespace must not acquire an ordinary project alias');
  }
  for (const [file, bytes] of contents) assert.equal(await fs.readFile(file, 'utf8'), bytes);
});
