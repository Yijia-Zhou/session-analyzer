'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, discoverPiProjects } = require('../src/pi');
const { buildWorkbuddyIndex, discoverWorkbuddyProjects } = require('../src/workbuddy');
const { materializeSessionForIndex, validateIndexOwnershipForCommit,
  buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

const timestamp = '2026-11-12T00:00:00.000Z';
const UNC = '\\\\server\\share\\Project';
const forwardUNC = '//server/share/Project';
const adapters = [
  { kind: 'pi', root: 'sessions', discover: discoverPiProjects, build: buildPiIndex },
  { kind: 'workbuddy', root: 'projects', discover: discoverWorkbuddyProjects, build: buildWorkbuddyIndex },
];

async function fixture(t, adapter) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), `project-path-${adapter.kind}-`));
  const originals = new Map();
  const indexes = [];
  t.after(async () => {
    for (const index of indexes) disposeProjectQueryStore(index.projectQueryStore);
    await fs.rm(sourceHome, { recursive: true, force: true });
  });
  async function add(container, id, cwd, branches = false) {
    const file = path.join(sourceHome, adapter.root, container, `${id}.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const content = `SYNTHETIC_${id}`;
    const question = adapter.kind === 'pi'
      ? { type: 'message', id: 'question', parentId: null, timestamp,
        message: { role: 'user', content, timestamp: Date.parse(timestamp) } }
      : { type: 'message', id: 'question', timestamp: Date.parse(timestamp), cwd,
        role: 'user', sessionId: id, content: [{ type: 'input_text', text: content }] };
    const rows = adapter.kind === 'pi'
      ? [{ type: 'session', version: 3, id, cwd, timestamp }, question]
      : [question];
    if (branches) for (const leaf of ['alpha', 'beta']) rows.push({ type: 'message', id: leaf,
      parentId: 'question', timestamp, message: { role: 'assistant',
        content: [{ type: 'text', text: `SYNTHETIC_BRANCH_${leaf}` }], timestamp: Date.parse(timestamp) } });
    const text = rows.map(JSON.stringify).join('\n') + '\n';
    await fs.writeFile(file, text);
    originals.set(file, { text, question: JSON.stringify(question) });
    return file;
  }
  const options = (rules = []) => ({ sourceHome, sourceConfigs: {
    [adapter.kind]: { home: sourceHome, projectPathRules: rules },
  } });
  async function build(repoRoot, rules = [], selection = {}) {
    const index = await adapter.build({ ...options(rules), repoRoot, ...selection });
    indexes.push(index);
    await validateIndexOwnershipForCommit(index);
    return index;
  }
  async function verifyReading(index) {
    for (const stored of index.sessions) {
      const session = await materializeSessionForIndex(index, stored);
      assert.equal(session.projectAssociation, stored.projectAssociation, 'recorded cwd remains unchanged');
      const event = session.logicalEvents.find((item) => item.kind === 'user_message');
      assert.ok(event, 'admitted synthetic user message can be read');
      const detail = await buildEventDetailForSession(index, session, event.id, 'main');
      assert.match(JSON.stringify(detail), /SYNTHETIC_/);
      const raw = await readIndexedRawRecord(index, session, event.rawRefs[0].rawId);
      const original = originals.get(path.resolve(index.sessionsRoot, stored.sourceFile));
      assert.equal(raw.raw, original.question);
    }
    for (const [file, original] of originals) assert.equal(await fs.readFile(file, 'utf8'), original.text);
  }
  return { sourceHome, originals, add, options, build, verifyReading };
}

for (const adapter of adapters) {
  test(`${adapter.kind}: explicit physical container UNC rule unifies discovery, selection and reading`, async (t) => {
    const f = await fixture(t, adapter);
    await f.add('chosen', 'forward', forwardUNC);
    await f.add('chosen', 'backward', UNC);
    const rules = [{ scope: 'container', path: `${adapter.root}/chosen`, interpretation: 'unc' }];
    const projects = await adapter.discover(f.options(rules));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].sessionCount, 2);
    assert.equal(projects[0].projectPath.status, 'valid');
    assert.equal(projects[0].legacyAssumption, false);
    assert.deepEqual(new Set(projects[0].projectPathEvidence), new Set(['syntax', 'user']));
    const selected = await f.build(UNC, rules);
    const fromDiscovery = await f.build(projects[0].repoRoot, rules);
    const forwardSelected = await f.build(forwardUNC, rules, { projectPathSemantics: 'windows' });
    assert.equal(selected.sessions.length, 2);
    assert.deepEqual(selected.sessions.map((session) => session.id), fromDiscovery.sessions.map((session) => session.id));
    assert.deepEqual(selected.sessions.map((session) => session.id), forwardSelected.sessions.map((session) => session.id));
    assert.equal(selected.projectPath.key, projects[0].projectPath.key);
    assert.equal(forwardSelected.projectPath.key, selected.projectPath.key);
    assert.equal(selected.projectPathPolicyId, projects[0].projectPathPolicyId);
    assert.equal((await f.build(forwardUNC, rules)).sessions.length, 0, 'an unknown selection remains POSIX until explicitly interpreted');
    assert.equal((await f.build('/server/share/Project', rules)).sessions.length, 0);
    assert.equal((await f.build('\\\\server\\share\\Proj', rules)).sessions.length, 0);
    assert.equal((await f.build('\\\\server\\other\\Project', rules)).sessions.length, 0);
    assert.equal((await f.build('\\\\other\\share\\Project', rules)).sessions.length, 0);
    await f.verifyReading(selected);
  });

  test(`${adapter.kind}: unknown double slash preserves marked legacy POSIX association`, async (t) => {
    const f = await fixture(t, adapter);
    await f.add('chosen', 'forward', forwardUNC);
    await f.add('chosen', 'backward', UNC);
    const diagnostics = [];
    const projects = await adapter.discover({ ...f.options(), onDiagnostic: (value) => diagnostics.push(value) });
    assert.equal(projects.length, 2);
    const legacy = projects.find((project) => project.repoRoot === '/server/share/Project');
    assert.ok(legacy);
    assert.equal(legacy.legacyAssumption, true);
    assert.deepEqual(legacy.projectPathEvidence, ['legacy']);
    assert.equal(legacy.projectPath.raw, forwardUNC);
    assert.equal(diagnostics.filter((item) => item.code === 'PROJECT_PATH_LEGACY_ASSUMPTION').length, 1);
    const windows = await f.build(UNC);
    const posix = await f.build('/server/share/Project');
    assert.equal(windows.sessions.length, 1);
    assert.equal(posix.sessions.length, 1);
    assert.notEqual(windows.sessions[0].sourceFile, posix.sessions[0].sourceFile);
    assert.equal(posix.sourceDiagnostics.counts.PROJECT_PATH_LEGACY_ASSUMPTION, 1);
    await f.verifyReading(posix);
  });

  test(`${adapter.kind}: container rule applies to new artifacts and cannot capture adjacent containers`, async (t) => {
    const f = await fixture(t, adapter);
    const file = await f.add('chosen', 'forward', forwardUNC);
    await f.add('chosen-2', 'outside', forwardUNC);
    const rules = [{ scope: 'container', path: `${adapter.root}/chosen`, interpretation: 'unc' }];
    assert.equal((await f.build(UNC, rules)).sessions.length, 1);
    assert.equal((await f.build('/server/share/Project', rules)).sessions.length, 1);
    await f.add('chosen', 'new', forwardUNC);
    assert.equal((await f.build(UNC, rules)).sessions.length, 2);
    await fs.rename(file, path.join(f.sourceHome, adapter.root, 'chosen-2', 'forward.jsonl'));
    assert.equal((await f.build(UNC, rules)).sessions.length, 1);
    assert.equal((await f.build('/server/share/Project', rules)).sessions.length, 2);
  });

  test(`${adapter.kind}: artifact POSIX rule leaves another forward-UNC artifact unchanged`, async (t) => {
    const f = await fixture(t, adapter);
    const selected = await f.add('chosen', 'posix', forwardUNC);
    await f.add('chosen', 'legacy', forwardUNC);
    const rules = [{ scope: 'artifact', path: selected, interpretation: 'posix' }];
    const projects = await adapter.discover(f.options(rules));
    assert.equal(projects.length, 1, 'different evidence for the same effective path does not create duplicate projects');
    assert.equal(projects[0].sessionCount, 2);
    assert.equal(projects[0].legacyAssumption, true);
    assert.deepEqual(new Set(projects[0].projectPathEvidence), new Set(['legacy', 'user']));
    assert.equal((await f.build('/server/share/Project', rules)).sessions.length, 2);
    assert.equal((await f.build(UNC, rules)).sessions.length, 0);
  });

  test(`${adapter.kind}: real POSIX case and literal backslash projects remain separate`, {
    skip: process.platform === 'win32' ? 'Requires native POSIX case and filename semantics' : false,
  }, async (t) => {
    const f = await fixture(t, adapter);
    const names = ['Project', 'project', 'literal\\name', 'literal/name'];
    for (const [number, name] of names.entries()) {
      const directory = path.join(f.sourceHome, name);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'marker'), name);
      await f.add('history', `posix-${number}`, `/${directory}`);
    }
    const projects = await adapter.discover(f.options());
    assert.equal(projects.length, 4);
    assert.equal(new Set(projects.map((project) => project.projectPath.key)).size, 4);
    for (const project of projects) {
      assert.equal(project.exists, true);
      const index = await f.build(project.repoRoot);
      assert.equal(index.sessions.length, 1);
      assert.equal(await fs.readFile(path.join(project.repoRoot, 'marker'), 'utf8'), names[Number(index.sessions[0].sourceSessionId.at(-1))]);
      await f.verifyReading(index);
    }
    const upper = await fs.stat(path.join(f.sourceHome, 'Project'));
    const lower = await fs.stat(path.join(f.sourceHome, 'project'));
    assert.notEqual(`${upper.dev}:${upper.ino}`, `${lower.dev}:${lower.ino}`);
  });
}

test('pi: explicit UNC interpretation preserves per-branch counts', async (t) => {
  const adapter = adapters[0];
  const f = await fixture(t, adapter);
  await f.add('chosen', 'branches', forwardUNC, true);
  const rules = [{ scope: 'container', path: 'sessions/chosen', interpretation: 'unc' }];
  assert.equal((await adapter.discover(f.options(rules)))[0].sessionCount, 2);
  const index = await f.build(UNC, rules);
  assert.equal(index.totals.indexedFileCount, 1);
  assert.equal(index.totals.sessionCount, 2);
  assert.deepEqual(new Set(index.sessions.map((session) => session.sourceDerivedId)), new Set(['alpha', 'beta']));
  await f.verifyReading(index);
});

test('pi: historical relative cwd is not resolved against the Analyzer cwd', async (t) => {
  const adapter = adapters[0];
  const f = await fixture(t, adapter);
  await f.add('chosen', 'relative', 'relative-project');
  assert.deepEqual(await adapter.discover(f.options()), []);
  const index = await f.build(path.resolve('relative-project'));
  assert.equal(index.sessions.length, 0);
  assert.equal(index.sourceDiagnostics.counts.PROJECT_PATH_UNSUPPORTED, 1);
});
