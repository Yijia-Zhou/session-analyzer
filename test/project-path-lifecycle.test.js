'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createServer, discoverProjectsForSource, resolveSourceMutation } = require('../server');
const { parseArgs, loadPathConfig } = require('../src/cli');
const { parseHistoryArgs } = require('../src/history-cli');
const { createHistoryService } = require('../src/history-service');
const { buildPiIndex } = require('../src/pi');
const { createPiEntryReference, resolvePiEntryReference } = require('../src/pi-navigation');
const { requireSourceAdapter, materializeSessionForIndex, materializeSessionWithAdapter, validateIndexOwnership } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createProjectPathContext, projectContextIndexFields } = require('../src/project-path-context');
const { interpretProjectPath } = require('../src/shared/project-path');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-lifecycle-'));
  const repo = path.join(home, 'Project');
  const file = path.join(home, 'sessions', 'one.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const bytes = [
    { type: 'session', version: 3, id: 'synthetic-path-lifecycle', cwd: repo },
    { type: 'message', id: 'question', parentId: null, message: { role: 'user', content: 'policy-lifecycle-needle' } },
  ].map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(file, bytes);
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const indexes = [];
  t.after(() => { for (const index of indexes) disposeProjectQueryStore(index.projectQueryStore); });
  const build = async (options = {}) => {
    const index = await buildPiIndex({ sourceHome: home, repoRoot: repo, ...options });
    indexes.push(index);
    return index;
  };
  return { home, repo, file, bytes, build };
}
const jsonRequest = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function start(t, options) {
  const server = createServer(null, 0, { sessionPrewarm: false, ...options });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function jobResult(base, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/api/project/status?jobId=${id}`);
    const result = await response.json();
    if (['succeeded', 'failed', 'cancelled'].includes(result.job?.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Project job did not settle within the bounded test loop.');
}
const pathRule = (interpretation = 'unc') => ({ scope: 'container', path: 'sessions', interpretation });

test('both CLI entry points expose a read-only config and explicit selected-project semantics', async (t) => {
  const f = await fixture(t);
  const configFile = path.join(f.home, 'paths.json');
  const bytes = JSON.stringify({ pi: { home: '.', projectPathRules: [pathRule()] } });
  await fs.writeFile(configFile, bytes);
  const config = await loadPathConfig(configFile);
  assert.equal(config.pi.home, f.home);
  assert.equal(config.pi.projectPathRules[0].path, path.join(f.home, 'sessions'));
  assert.equal(await fs.readFile(configFile, 'utf8'), bytes);
  const normal = parseArgs(['node', 'server.js', '--path-config', configFile, '--project-path-semantics', 'windows']);
  assert.equal(normal.pathConfig, configFile);
  assert.equal(normal.projectPathSemantics, 'windows');
  assert.deepEqual(normal.errors, []);
  const history = parseHistoryArgs(['serve', '--repo', '//server/share/Project', '--source', 'pi',
    '--path-config', configFile, '--project-path-semantics', 'windows']);
  assert.equal(history.pathConfig, configFile);
  assert.equal(history.projectPathSemantics, 'windows');
  assert.ok(parseArgs(['node', 'server.js', '--project-path-semantics', 'guess']).errors.length);
  assert.throws(() => parseHistoryArgs(['serve', '--repo', f.repo, '--source', 'pi', '--project-path-semantics', 'guess']), { code: 'INVALID_OPTION' });
  await fs.writeFile(configFile, JSON.stringify({ pi: { home: '.', projectPathRules: [pathRule(), { scope: 'artifact', path: 'sessions/one.jsonl', interpretation: 'posix' }] } }));
  await assert.rejects(loadPathConfig(configFile), { code: 'INVALID_PROJECT_PATH_POLICY' });
});

test('discovery merges effective project keys independently of evidence labels', async () => {
  const home = path.resolve('/synthetic-discovery');
  const windows = interpretProjectPath('\\\\server\\share\\Project');
  const explicit = interpretProjectPath('//server/share/Project', { doubleSlash: 'unc' });
  const state = { sourceKind: 'pi', sourceConfigs: { pi: { home } }, sourceRevision: 0, projectCache: null,
    adapter: { discoverConfiguredProjects: async () => [{ repoRoot: windows.path, projectPath: windows, statsPending: true }],
      discoverProjects: async () => [{ repoRoot: explicit.path, projectPath: explicit, sessionCount: 1 }] } };
  const result = await discoverProjectsForSource(state, 'full');
  assert.equal(result.payload.projects.length, 1);
  assert.equal(result.payload.projects[0].sessionCount, 1);
  assert.equal(result.payload.projects[0].projectPath.key, windows.key);
});

test('policy mutation round-trips rules and invalidates discovery without changing the source home', async () => {
  const home = path.resolve('/synthetic-policy');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const state = { sourceKind: 'pi', sourceConfigs: { pi: { home } }, sourceRevision: 0, activeSourceRevision: 0, projectCache: null,
    adapter: { discoverConfiguredProjects: async () => [], discoverProjects: async () => { await gate; return [{ repoRoot: '/old/Project' }]; } } };
  const pending = discoverProjectsForSource(state, 'full');
  await new Promise((resolve) => setImmediate(resolve));
  const changed = resolveSourceMutation(state, { source: 'pi', sourceConfigs: { pi: { home, projectPathRules: [pathRule()] } } });
  assert.deepEqual(changed.errors, []);
  assert.equal(state.sourceRevision, 1);
  assert.equal(state.activeSourceRevision, 1);
  assert.equal(changed.payload.sourceConfigs.pi.projectPathRules[0].path, path.join(home, 'sessions'));
  assert.equal(changed.payload.projectPathPolicyId.length, 64);
  release();
  assert.equal((await pending).stale, true);
  assert.equal(state.projectCache, null);
  const same = resolveSourceMutation(state, { source: 'pi', sourceConfigs: { pi: { home } } });
  assert.equal(same.payload.projectPathPolicyId, changed.payload.projectPathPolicyId);
  const clear = resolveSourceMutation(state, { source: 'pi', sourceConfigs: { pi: { home, projectPathRules: [] } } });
  assert.deepEqual(clear.payload.sourceConfigs.pi.projectPathRules, []);
  assert.notEqual(clear.payload.projectPathPolicyId, changed.payload.projectPathPolicyId);
});

test('an explicit empty rule set is retained without retiring an unchanged project identity', async () => {
  const home = path.resolve('/synthetic-explicit-empty');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const index = { repoRoot: '/synthetic-project' };
  const controller = new AbortController();
  const state = { sourceKind: 'pi', sourceConfigs: { pi: { home } }, sourceRevision: 0,
    activeSourceRevision: 0, projectCache: null, index, activeProjectJob: { status: 'running', controller },
    adapter: { discoverConfiguredProjects: async () => [], discoverProjects: async () => { await gate; return []; } } };
  const pending = discoverProjectsForSource(state, 'full');
  await new Promise(resolve => setImmediate(resolve));
  const result = resolveSourceMutation(state, { source: 'pi', sourceConfigs: { pi: { home, projectPathRules: [] } } });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.payload.sourceConfigs.pi.projectPathRules, []);
  assert.equal(Object.hasOwn(state.sourceConfigs.pi, 'projectPathRules'), true);
  assert.strictEqual(state.index, index);
  assert.equal(controller.signal.aborted, false);
  assert.equal(state.activeSourceRevision, 0);
  release();
  assert.equal((await pending).stale, true, 'a response without the explicit authority field must not overwrite it');
  const revision = state.sourceRevision;
  resolveSourceMutation(state, { source: 'pi', sourceConfigs: { pi: { home } } });
  assert.deepEqual(state.sourceConfigs.pi.projectPathRules, []);
  assert.equal(state.sourceRevision, revision);
});

test('captured absolute project context materializes after the process cwd is deleted',
  { skip: process.platform !== 'linux' }, () => {
    const script = String.raw`
      const fs = require('node:fs/promises');
      const os = require('node:os');
      const path = require('node:path');
      const assert = require('node:assert/strict');
      const reader = process.argv[1];
      const { buildSourceBackedIndex } = require(path.join(reader, 'src/codex'));
      const { validateIndexOwnershipForCommit, materializeSessionForIndex, readIndexedRawRecord } = require(path.join(reader, 'src/source-adapters'));
      const { disposeIndexResources } = require(path.join(reader, 'src/index-resources'));
      (async () => {
        const home = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-deleted-cwd-'));
        let index;
        try {
          const project = path.join(home, 'Project');
          const file = path.join(home, 'sessions', 'rollout-deleted-cwd.jsonl');
          await fs.mkdir(project); await fs.mkdir(path.dirname(file));
          const rows = [
            { type: 'session_meta', payload: { id: 'synthetic-deleted-cwd', cwd: '/' + project } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'SYNTHETIC_DELETED_CWD' } },
          ];
          const text = rows.map(JSON.stringify).join('\n') + '\n';
          await fs.writeFile(file, text);
          index = await buildSourceBackedIndex({ codexHome: home, repoRoot: project,
            projectPathRules: [{ scope: 'container', path: 'sessions', interpretation: 'posix' }] });
          await validateIndexOwnershipForCommit(index);
          assert.equal(index.sessions.length, 1);
          const vanished = path.join(home, 'vanished'); await fs.mkdir(vanished);
          process.chdir(vanished); await fs.rmdir(vanished);
          assert.throws(() => process.cwd(), { code: 'ENOENT' });
          const session = await materializeSessionForIndex(index, index.sessions[0]);
          const event = session.logicalEvents.find(event => event.kind === 'user_message');
          assert.ok(event);
          assert.equal(await fs.readFile(file, 'utf8'), text);
          // The regression concerns captured project interpretation. Restore
          // the host cwd before the separate legacy Raw-owner path checks.
          process.chdir(reader);
          const raw = await readIndexedRawRecord(index, session, event.rawRefs[0].rawId);
          assert.equal(raw.raw, JSON.stringify(rows[1]));
          process.stdout.write('captured-context-readback-ok');
        } finally {
          process.chdir(reader);
          if (index) await disposeIndexResources(index);
          await fs.rm(home, { recursive: true, force: true });
        }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const output = execFileSync(process.execPath, ['-e', script, path.join(__dirname, '..')],
      { encoding: 'utf8', timeout: 15000 });
    assert.equal(output, 'captured-context-readback-ok');
  });

test('HTTP rejects stale policy/key selections and keeps explicit selection separate from historical rules', async (t) => {
  const f = await fixture(t);
  const calls = [];
  const base = await start(t, { source: 'pi', piHome: f.home, buildIndex: async (context) => {
    calls.push(context);
    return f.build(context);
  } });
  const discovered = await (await fetch(`${base}/api/projects`)).json();
  assert.equal((await fetch(`${base}/api/project`, jsonRequest({ repoRoot: f.repo, projectPathPolicyId: 'old' }))).status, 409);
  assert.equal((await fetch(`${base}/api/project`, jsonRequest({ repoRoot: f.repo, projectPathKey: 'different' }))).status, 409);
  assert.equal((await fetch(`${base}/api/project`, jsonRequest({ repoRoot: 'C:relative' }))).status, 400);
  const response = await fetch(`${base}/api/project`, jsonRequest({ repoRoot: '//server/share/Project', projectPathSemantics: 'windows', projectPathPolicyId: discovered.projectPathPolicyId }));
  assert.equal(response.status, 202);
  const selected = await response.json();
  assert.equal(selected.job.projectPath.key, interpretProjectPath('\\\\server\\share\\Project').key);
  const result = await jobResult(base, selected.job.id);
  assert.equal(result.job.status, 'succeeded');
  assert.equal(result.state.totals.sessionCount, 0);
  assert.equal(calls[0].repoRoot, '\\\\server\\share\\Project');
  assert.equal(JSON.parse(calls[0].projectPathContext).rules.length, 0);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.bytes);
});

test('changing policy cancels a captured job and prevents its late Index from being published', async (t) => {
  const f = await fixture(t);
  let release;
  let captured;
  const gate = new Promise((resolve) => { release = resolve; });
  const base = await start(t, { source: 'pi', piHome: f.home, buildIndex: async (context) => {
    captured = context;
    await gate;
    return f.build(context);
  } });
  const selected = await (await fetch(`${base}/api/project`, jsonRequest({ repoRoot: f.repo }))).json();
  await new Promise((resolve) => setImmediate(resolve));
  const oldContext = captured.projectPathContext;
  const changed = await (await fetch(`${base}/api/source`, jsonRequest({ source: 'pi', sourceConfigs: { pi: { home: f.home, projectPathRules: [pathRule()] } } }))).json();
  assert.notEqual(changed.projectPathPolicyId, selected.job.projectPathPolicyId);
  assert.equal(captured.signal.aborted, true);
  assert.equal(captured.projectPathContext, oldContext);
  release();
  const cancelled = await jobResult(base, selected.job.id);
  assert.equal(cancelled.job.status, 'cancelled');
  assert.equal(cancelled.state, undefined);
  assert.equal((await fetch(`${base}/api/state`)).status, 409);
});

test('committed membership and index reuse retire on policy change while equal contexts can reuse', async (t) => {
  const f = await fixture(t);
  const calls = [];
  const base = await start(t, { source: 'pi', piHome: f.home, buildIndex: async (context) => {
    calls.push(context);
    return f.build(context);
  } });
  const select = async () => {
    const started = await (await fetch(`${base}/api/project`, jsonRequest({ repoRoot: f.repo }))).json();
    const result = await jobResult(base, started.job.id);
    assert.equal(result.job.status, 'succeeded');
    return result;
  };
  const first = await select();
  assert.equal(first.state.totals.sessionCount, 1);
  await select();
  assert.ok(calls[1].previousIndex);
  const changed = await (await fetch(`${base}/api/source`, jsonRequest({ source: 'pi', sourceConfigs: { pi: { home: f.home, projectPathRules: [pathRule()] } } }))).json();
  assert.equal(changed.projectSelected, false);
  const retiredStatus = await (await fetch(`${base}/api/project/status`)).json();
  assert.equal(retiredStatus.state, undefined, 'a succeeded old job must not publish a state after policy retirement');
  assert.equal((await fetch(`${base}/api/state`)).status, 409);
  const next = await select();
  assert.equal(calls[2].previousIndex, null);
  assert.notEqual(calls[2].projectPathContext, calls[1].projectPathContext);
  assert.equal(next.state.totals.sessionCount, 1);
  assert.ok(next.state.indexRevision > first.state.indexRevision);
});

test('materialization rejects invalid, removed, added or changed captured path context', async (t) => {
  const f = await fixture(t);
  const adapter = requireSourceAdapter('pi');
  const changedContext = createProjectPathContext({ sourceKind: 'pi', sourceHome: f.home, projectPathRules: [pathRule()] }).serialized;
  for (const mutate of [
    (index) => { index.projectPathContext = changedContext; },
    (index) => { delete index.projectPathContext; },
  ]) {
    const index = await f.build();
    const selected = index.sessions[0];
    await assert.rejects(materializeSessionWithAdapter(index, selected, { ...adapter, materializeSession: async (args) => {
      const value = await adapter.materializeSession(args);
      mutate(index);
      return value;
    } }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  }
  const legacy = await f.build();
  delete legacy.projectPathContext;
  await assert.rejects(materializeSessionWithAdapter(legacy, legacy.sessions[0], { ...adapter, materializeSession: async (args) => {
    const value = await adapter.materializeSession(args);
    legacy.projectPathContext = changedContext;
    return value;
  } }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  const invalid = await f.build();
  invalid.projectPathContext = 'invalid';
  assert.throws(() => validateIndexOwnership(invalid), { code: 'CANONICAL_CONTRACT_VIOLATION' });
  let getterCalls = 0;
  Object.defineProperty(invalid, 'projectPathContext', { get() { getterCalls++; return changedContext; } });
  assert.throws(() => validateIndexOwnership(invalid), { code: 'CANONICAL_CONTRACT_VIOLATION' });
  assert.equal(getterCalls, 0);
  for (const scopeRoot of ['.', 'relative/..', `${f.home}${path.sep}sessions${path.sep}..`]) {
    const index = await f.build();
    index.projectPathScopeRoot = scopeRoot;
    assert.throws(() => validateIndexOwnership(index), { code: 'CANONICAL_CONTRACT_VIOLATION' },
      'a captured physical scope must not resolve through the later process cwd');
  }
  for (const change of ['add', 'remove', 'replace']) {
    const index = await f.build();
    if (change !== 'add') index.projectPathScopeRoot = path.dirname(f.file);
    await assert.rejects(materializeSessionWithAdapter(index, index.sessions[0], { ...adapter, materializeSession: async (args) => {
      const value = await adapter.materializeSession(args);
      if (change === 'remove') delete index.projectPathScopeRoot;
      else index.projectPathScopeRoot = f.home;
      return value;
    } }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  }
});

test('history references and pi bookmarks do not cross policy contexts even when bytes and membership agree', async (t) => {
  const f = await fixture(t);
  const first = await f.build();
  const materialized = await materializeSessionForIndex(first, first.sessions[0]);
  const raw = materialized.rawEvents.find((event) => event.entryId === 'question');
  const reference = (await createPiEntryReference(first, first.sessions[0], raw.rawId, 'raw')).reference;
  const same = await f.build();
  assert.equal((await resolvePiEntryReference(same, reference)).status, 'resolved');
  const different = await f.build({ projectPathRules: [pathRule()] });
  assert.equal((await resolvePiEntryReference(different, reference)).status, 'unavailable');
  const options = { repo: f.repo, source: 'pi', piHome: f.home };
  const before = await createHistoryService(options);
  const after = await createHistoryService({ ...options, sourceConfigs: { pi: { home: f.home, projectPathRules: [pathRule()] } } });
  t.after(() => { before.close(); after.close(); });
  const hits = await before.execute('search', { query: 'policy-lifecycle-needle' });
  assert.ok(hits.items.length);
  await assert.rejects(after.execute('read', { refs: [hits.items[0].ref] }), { code: 'REFERENCE_SCOPE_MISMATCH' });
  assert.equal(await fs.readFile(f.file, 'utf8'), f.bytes);
  assert.deepEqual(Object.keys(projectContextIndexFields(createProjectPathContext({ sourceKind: 'pi', sourceHome: f.home }), f.repo)).sort(),
    ['projectPath', 'projectPathContext', 'projectPathPolicyId']);
});

test('pre-policy evidence and SourceRefs migrate only in an unambiguous default context', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.home, 'sessions', 'rollout-policy-reference.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'synthetic-policy-reference', cwd: f.repo } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'legacy-policy-reference-needle' } },
  ];
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const options = { repo: f.repo, source: 'codex', codexHome: f.home };
  const before = await createHistoryService(options);
  const changed = await createHistoryService({ ...options, sourceConfigs: { codex: { home: f.home,
    projectPathRules: [{ scope: 'artifact', path: file, interpretation: 'posix' }] } } });
  const services = [before, changed];
  t.after(() => { for (const service of services) service.close(); });
  const hit = (await before.execute('search', { query: 'legacy-policy-reference-needle' })).items[0];
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
  const legacyScope = digest([f.repo, 'codex', f.home]);
  const compact = hit.ref.split('.'); compact[1] = legacyScope.slice(0, 22);
  const legacyCompact = compact.join('.');
  const index = await requireSourceAdapter('codex').buildIndex({ repoRoot: f.repo, sourceHome: f.home });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  const session = index.sessionsById.get(hit.sessionId);
  const legacyEnvelope = { p: legacyScope, s: session.id, l: 'main', e: hit.eventId,
    v: digest([session.materializationDescriptor.sourceSnapshotId, session.queryProjectionDigest]) };
  const legacy = 'er1.' + Buffer.from(JSON.stringify(legacyEnvelope)).toString('base64url');
  for (const reference of [legacy, legacyCompact]) {
    assert.ok((await before.execute('read', { refs: [reference] })).items.length);
    await assert.rejects(changed.execute('read', { refs: [reference] }), { code: 'REFERENCE_SCOPE_MISMATCH' });
  }
  const source = await before.execute('read', { source: { sourcePath: file, locator: { type: 'jsonl-line', line: 2 } } });
  const sourceEnvelope = JSON.parse(Buffer.from(source.source.sourceRef.slice(4), 'base64url'));
  const legacySource = 'sr1.' + Buffer.from(JSON.stringify({ ...sourceEnvelope, p: digest(legacyScope) })).toString('base64url');
  assert.ok((await before.execute('read', { source: { sourceRef: legacySource, locator: { type: 'jsonl-line', line: 2 } } })).items.length);
  await assert.rejects(changed.execute('read', { source: { sourceRef: legacySource, locator: { type: 'jsonl-line', line: 2 } } }), { code: 'REFERENCE_SCOPE_MISMATCH' });
  const missingScope = 'er1.' + Buffer.from(JSON.stringify({ ...legacyEnvelope, p: null })).toString('base64url');
  await assert.rejects(changed.execute('read', { refs: [missingScope] }), { code: 'REFERENCE_SCOPE_MISMATCH' });
  rows[0].payload.cwd = '/' + f.repo;
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const ambiguous = await createHistoryService(options); services.push(ambiguous);
  const current = (await ambiguous.execute('search', { query: 'legacy-policy-reference-needle' })).items[0].ref.split('.');
  current[1] = legacyScope.slice(0, 22);
  await assert.rejects(ambiguous.execute('read', { refs: [current.join('.')] }), { code: 'REFERENCE_SCOPE_MISMATCH' });
});
