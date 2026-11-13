'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { requireSourceAdapter, materializeSessionForIndex, validateIndexOwnershipForCommit,
  readIndexedRawRecord, buildEventDetailForSession } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createProjectPathContext } = require('../src/project-path-context');

const time = '2026-11-11T10:00:00.000Z';
async function fixture(t, kind, cwds) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-source-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const contents = new Map();
  for (const [i, cwd] of cwds.entries()) {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    let file; let rows;
    if (kind === 'codex') {
      file = path.join(home, 'sessions', `rollout-${id}.jsonl`);
      rows = [{ type: 'session_meta', timestamp: time, payload: { id, cwd } },
        { type: 'event_msg', timestamp: time, payload: { type: 'user_message', message: `synthetic ${i}` } }];
    } else if (kind === 'claude-code') {
      file = path.join(home, 'projects', 'container', `${id}.jsonl`);
      rows = [{ type: 'user', uuid: id, sessionId: id, timestamp: time,
        ...(cwd === undefined ? {} : { cwd }), message: { role: 'user', content: `synthetic ${i}` } }];
    } else {
      file = path.join(home, 'container', id, 'session.jsonl');
      rows = [{ type: 'session', version: 0, id, createdAt: 1, cwd, delegationDepth: 0 },
        { type: 'turn/start', seq: 0, time: 2, data: { turn: 1, userInput: `synthetic ${i}` } }];
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const text = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    await fs.writeFile(file, text); contents.set(file, text);
  }
  return { home, contents };
}
async function build(t, adapter, context, repoRoot) {
  const index = await adapter.buildIndex({ ...context, repoRoot });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  await validateIndexOwnershipForCommit(index);
  return index;
}

for (const kind of ['codex', 'claude-code', 'deepseek-harness']) {
  test(`${kind}: scoped ordinary UNC unifies discovery, membership, materialization, Detail and Raw`, async t => {
    const { home, contents } = await fixture(t, kind, ['//server/share/Project', '\\\\server\\share\\Project']);
    const adapter = requireSourceAdapter(kind);
    const context = { sourceKind: kind, sourceHome: home,
      sourceConfigs: { [kind]: { home, projectPathRules: [{ scope: 'container', path: '.', interpretation: 'unc' }] } } };
    const projects = await adapter.discoverProjects(context);
    assert.equal(projects.length, 1); assert.equal(projects[0].sessionCount, 2);
    const index = await build(t, adapter, context, '\\\\server\\share\\Project');
    assert.equal(index.sessions.length, 2);
    assert.equal(index.projectPath.key, projects[0].projectPath.key);
    const explicitForward = await build(t, adapter, { ...context, projectPathSemantics: 'windows' }, '//server/share/Project');
    assert.deepEqual(explicitForward.sessions.map(s => s.id), index.sessions.map(s => s.id));
    const reused = await build(t, adapter, { ...context, previousIndex: index }, '\\\\server\\share\\Project');
    assert.equal(reused.projectPathContext, index.projectPathContext);
    assert.equal(reused.sessions.length, 2);
    assert.equal((await build(t, adapter, context, '/server/share/Project')).sessions.length, 0);
    assert.equal((await build(t, adapter, context, '\\\\server\\share\\Proj')).sessions.length, 0);
    assert.equal((await build(t, adapter, context, '\\\\server\\other')).sessions.length, 0);
    for (const selected of index.sessions) {
      const session = await materializeSessionForIndex(index, selected);
      // matchesRepo is parser state, not a required carried Session field.
      if (Object.hasOwn(session, 'matchesRepo')) assert.equal(session.matchesRepo, true);
      assert.ok(session.rawEvents.length);
      const raw = await readIndexedRawRecord(index, session, session.rawEvents[0].rawId);
      assert.ok([...contents.values()].some(text => text.split('\n').includes(raw.raw)));
      const event = session.logicalEvents[0];
      assert.ok(event);
      assert.ok(await buildEventDetailForSession(index, session, event.id, event.layer));
    }
    for (const [file, text] of contents) assert.equal(await fs.readFile(file, 'utf8'), text);
    if (kind === 'codex') {
      const resident = await require('../src/codex').buildIndex({ ...context, codexHome: home, repoRoot: '\\\\server\\share\\Project' });
      assert.equal(resident.sessions.length, 2);
      assert.ok(resident.sessions.every(s => s.matchesRepo));
    } else if (kind === 'deepseek-harness') {
      const file = contents.keys().next().value;
      const parsed = await require('../src/deepseek-harness').parseSessionArtifact(file, path.relative(home, file),
        '\\\\server\\share\\Project', undefined, { projectPathContext: createProjectPathContext(context).serialized });
      assert.equal(parsed.matchesRepo, true);
      assert.deepEqual(parsed.cwdSet, ['//server/share/Project']);
    }
  });
  test(`${kind}: unknown double slash retains marked compatibility and independent POSIX projects`, async t => {
    const { home } = await fixture(t, kind, ['//server/share/Project', '//server/share/project']);
    const adapter = requireSourceAdapter(kind); const context = { sourceKind: kind, sourceHome: home };
    const projects = await adapter.discoverProjects(context);
    assert.equal(projects.length, 2);
    assert.ok(projects.every(project => project.legacyAssumption));
    assert.equal((await build(t, adapter, context, '/server/share/Project')).sessions.length, 1);
    assert.equal((await build(t, adapter, context, '/server/share/project')).sessions.length, 1);
    assert.equal((await build(t, adapter, context, '\\\\server\\share\\Project')).sessions.length, 0);
  });
  test(`${kind}: native Linux case-distinct project directories remain separately discoverable and readable`,
    { skip: process.platform !== 'linux' }, async t => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-native-source-'));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const roots = [path.join(root, 'Project'), path.join(root, 'project')];
      for (const [i, directory] of roots.entries()) {
        await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'marker'), String(i));
      }
      assert.notEqual((await fs.stat(roots[0])).ino, (await fs.stat(roots[1])).ino);
      const { home, contents } = await fixture(t, kind, roots.map(value => '/' + value));
      const adapter = requireSourceAdapter(kind); const context = { sourceKind: kind, sourceHome: home };
      const projects = await adapter.discoverProjects(context);
      assert.equal(projects.length, 2); assert.ok(projects.every(project => project.exists));
      for (const selected of roots) {
        const index = await build(t, adapter, context, selected);
        assert.equal(index.sessions.length, 1);
        const session = await materializeSessionForIndex(index, index.sessions[0]);
        assert.deepEqual([...session.cwdSet], ['/' + selected]);
        const raw = await readIndexedRawRecord(index, session, session.rawEvents[0].rawId);
        assert.ok([...contents.values()].some(text => text.split('\n').includes(raw.raw)));
      }
    });
}

test('Claude: stable scoped UNC cluster admits metadata-only session with container-inferred provenance', async t => {
  const { home } = await fixture(t, 'claude-code', ['//server/share/Project', '\\\\server\\share\\Project', undefined]);
  const adapter = requireSourceAdapter('claude-code');
  const context = { sourceKind: 'claude-code', sourceHome: home,
    projectPathRules: [{ scope: 'container', path: 'projects/container', interpretation: 'unc' }] };
  const index = await build(t, adapter, context, '\\\\server\\share\\Project');
  assert.equal(index.sessions.length, 3);
  assert.deepEqual(index.sessions.map(s => s.projectAssociation).sort(), ['container-inferred', 'embedded-cwd', 'embedded-cwd']);
  assert.equal(index.sessions.find(s => s.projectAssociation === 'container-inferred').cwdSet.length, 0);
});

test('Codex: config/transcript keys agree and both cwd entrances count one artifact only once', async t => {
  const { home, contents } = await fixture(t, 'codex', ['//server/share/Project']);
  const file = contents.keys().next().value;
  await fs.appendFile(file, JSON.stringify({ type: 'event_msg', timestamp: time,
    payload: { type: 'session_configured', cwd: '\\\\server\\share\\Project' } }) + '\n');
  await fs.writeFile(path.join(home, 'config.toml'), "[projects.'\\\\server\\share\\Project']\ntrust_level = 'trusted'\n");
  const adapter = requireSourceAdapter('codex');
  const context = { sourceKind: 'codex', sourceHome: home,
    projectPathRules: [{ scope: 'container', path: '.', interpretation: 'unc' }] };
  const scanned = await adapter.discoverProjects(context);
  const configured = await adapter.discoverConfiguredProjects(context);
  assert.equal(scanned.length, 1); assert.equal(configured.length, 1);
  assert.equal(scanned[0].sessionCount, 1);
  assert.equal(scanned[0].projectPath.key, configured[0].projectPath.key);
  const first = await build(t, adapter, context, '\\\\server\\share\\Project');
  assert.equal(first.sessions.length, 1);
  const next = await build(t, adapter, { sourceHome: home, projectPathRules: [], previousIndex: first }, '/server/share/Project');
  assert.equal(next.sessions.length, 1);
  assert.notEqual(next.projectPathContext, first.projectPathContext);
  assert.notEqual(next.sessions, first.sessions);
  assert.deepEqual(next.sessions[0].cwdSet.sort(), ['//server/share/Project', '\\\\server\\share\\Project'].sort());
});

test('Claude: unsupported cwd evidence blocks unique-container inference', async t => {
  const { home } = await fixture(t, 'claude-code', ['/projects/one', 'relative/unknown', undefined]);
  const index = await build(t, requireSourceAdapter('claude-code'), { sourceKind: 'claude-code', sourceHome: home }, '/projects/one');
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessions[0].projectAssociation, 'embedded-cwd');
});
