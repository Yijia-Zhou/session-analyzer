'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { discoverClaudeProjects, buildClaudeIndex, buildClaudeSourceBackedIndex } = require('../src/claude');
const { materializeSessionForIndex, validateIndexOwnershipForCommit,
  buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

const sourceKind = 'claude-code';
const UNC = '\\\\server\\share\\Project';
const forwardUNC = '//server/share/Project';
const timestamp = '2026-11-12T00:00:00.000Z';
const builders = [
  { name: 'source-backed', build: buildClaudeSourceBackedIndex, strict: true },
  { name: 'resident', build: buildClaudeIndex, strict: false },
];

async function fixture(t) {
  const claudeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-claude-'));
  const originals = new Map();
  const indexes = [];
  t.after(async () => {
    for (const index of indexes) if (index.projectQueryStore) disposeProjectQueryStore(index.projectQueryStore);
    await fs.rm(claudeHome, { recursive: true, force: true });
  });
  async function add(id, cwds, container = 'chosen') {
    const file = path.join(claudeHome, 'projects', container, `${id}.jsonl`);
    const records = cwds.map((cwd, i) => ({ type: 'user', uuid: `${id}-${i}`, sessionId: id,
      timestamp, ...(cwd === undefined ? {} : { cwd }),
      message: { role: 'user', content: `SYNTHETIC_${id}_${i}` } }));
    await fs.mkdir(path.dirname(file), { recursive: true });
    const text = records.map(JSON.stringify).join('\n') + '\n';
    await fs.writeFile(file, text);
    originals.set(await fs.realpath(file), { text, records });
    return file;
  }
  const options = (rules = []) => ({ claudeHome, sourceKind, sourceHome: claudeHome,
    sourceConfigs: { [sourceKind]: { home: claudeHome, projectPathRules: rules } } });
  async function build(builder, repoRoot, rules = [], extra = {}) {
    const index = await builder.build({ ...options(rules), repoRoot, ...extra });
    indexes.push(index);
    if (builder.strict) await validateIndexOwnershipForCommit(index);
    return index;
  }
  return { claudeHome, originals, add, options, build };
}

for (const builder of builders) {
  test(`Claude ${builder.name}: scoped UNC three-session cluster preserves inferred identity and exact evidence`, async (t) => {
    const f = await fixture(t);
    await f.add('forward', [forwardUNC]);
    await f.add('backward', [UNC]);
    await f.add('metadata-only', [undefined]);
    const rules = [{ scope: 'container', path: 'projects/chosen', interpretation: 'unc' }];
    const projects = await discoverClaudeProjects(f.options(rules));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].sessionCount, 2, 'discovery counts recorded cwd sessions, not inferred sessions');
    const index = await f.build(builder, UNC, rules);
    assert.equal(index.sessions.length, 3);
    assert.deepEqual(index.sessions.map((session) => session.projectAssociation).sort(),
      ['container-inferred', 'embedded-cwd', 'embedded-cwd']);
    const inferred = index.sessions.find((session) => session.projectAssociation === 'container-inferred');
    assert.equal([...inferred.cwdSet].length, 0, 'inference does not manufacture recorded cwd');
    assert.equal((await f.build(builder, '/server/share/Project', rules)).sessions.length, 0);
    const forwardSelection = await f.build(builder, forwardUNC, rules, { projectPathSemantics: 'windows' });
    assert.deepEqual(new Set(forwardSelection.sessions.map((session) => session.id)), new Set(index.sessions.map((session) => session.id)));
    if (builder.strict) for (const stored of index.sessions) {
      const session = await materializeSessionForIndex(index, stored);
      const event = session.logicalEvents.find((item) => item.kind === 'user_message');
      assert.ok(event);
      assert.match(JSON.stringify(await buildEventDetailForSession(index, session, event.id, event.layer)), /SYNTHETIC_/);
      const raw = await readIndexedRawRecord(index, session, event.rawRefs[0].rawId);
      const original = f.originals.get(path.resolve(index.sourceRoot, stored.sourceFile));
      assert.equal(raw.raw, JSON.stringify(original.records[0]));
    }
    for (const [file, { text }] of f.originals) assert.equal(await fs.readFile(file, 'utf8'), text);
  });

  test(`Claude ${builder.name}: distinct POSIX projects block container inference`, async (t) => {
    const f = await fixture(t);
    await f.add('upper', ['//server/share/Project']);
    await f.add('lower', ['//server/share/project']);
    await f.add('metadata-only', [undefined]);
    const projects = await discoverClaudeProjects(f.options());
    assert.equal(projects.length, 2);
    assert.equal(new Set(projects.map((project) => project.projectPath.key)).size, 2);
    for (const root of ['/server/share/Project', '/server/share/project']) {
      const index = await f.build(builder, root);
      assert.equal(index.sessions.length, 1);
      assert.equal(index.sessions[0].projectAssociation, 'embedded-cwd');
    }
  });

  for (const [label, cwd] of [
    ['relative', 'relative/unknown'], ['root-relative', '\\project'],
    ['device namespace', '\\\\.\\pipe\\name'], ['empty', ''], ['wrong type', { path: '/projects/one' }],
  ]) {
    test(`Claude ${builder.name}: ${label} cwd evidence blocks unique-container inference`, async (t) => {
      const f = await fixture(t);
      await f.add('known', ['/projects/one']);
      await f.add('unsupported', [cwd]);
      await f.add('metadata-only', [undefined]);
      const index = await f.build(builder, '/projects/one');
      assert.equal(index.sessions.length, 1);
      assert.equal(index.sessions[0].sourceSessionId, 'known');
      const diagnostic = label === 'device namespace'
        ? 'PROJECT_PATH_NAMESPACE_COMPATIBILITY' : 'PROJECT_PATH_UNSUPPORTED';
      assert.equal(index.sourceDiagnostics.counts[diagnostic], 1);
    });
  }

  test(`Claude ${builder.name}: changed interpretation invalidates reuse and inferred admission`, async (t) => {
    const f = await fixture(t);
    await f.add('forward', [forwardUNC]);
    await f.add('backward', [UNC]);
    await f.add('metadata-only', [undefined]);
    const uncRules = [{ scope: 'container', path: 'projects/chosen', interpretation: 'unc' }];
    const posixRules = [{ scope: 'container', path: 'projects/chosen', interpretation: 'posix' }];
    const first = await f.build(builder, UNC, uncRules);
    assert.equal(first.sessions.length, 3);
    const changed = await f.build(builder, UNC, posixRules, { previousIndex: first });
    assert.equal(changed.sessions.length, 1);
    assert.equal(changed.sessions[0].projectAssociation, 'embedded-cwd');
    assert.equal(changed.totals.reusedFileCount, 0);
    assert.notEqual(changed.projectPathPolicyId, first.projectPathPolicyId);
  });
}

test('Claude: aliases within one artifact count one discovered session and aggregate evidence', async (t) => {
  const f = await fixture(t);
  const file = await f.add('same-artifact', [forwardUNC, UNC]);
  const rules = [{ scope: 'artifact', path: file, interpretation: 'unc' }];
  const projects = await discoverClaudeProjects(f.options(rules));
  assert.equal(projects.length, 1);
  assert.equal(projects[0].sessionCount, 1);
  assert.equal(projects[0].bytes, Buffer.byteLength(f.originals.get(await fs.realpath(file)).text));
  assert.deepEqual(new Set(projects[0].projectPathEvidence), new Set(['syntax', 'user']));
});

for (const layout of ['claude-home', 'project-container']) {
  test(`Claude: ${layout} source-home symlink keeps policy scope independent of reader realpath`, {
    skip: process.platform === 'win32' ? 'Native Windows symlink creation requires separate validation' : false,
  }, async (t) => {
    const f = await fixture(t);
    await f.add('forward', [forwardUNC]);
    await f.add('backward', [UNC]);
    await f.add('metadata-only', [undefined]);
    const target = layout === 'claude-home' ? f.claudeHome : path.join(f.claudeHome, 'projects/chosen');
    const alias = `${f.claudeHome}-configured-alias`;
    await fs.symlink(target, alias, 'dir');
    t.after(() => fs.unlink(alias));
    const rules = [{ scope: 'container', path: layout === 'claude-home' ? 'projects/chosen' : '.', interpretation: 'unc' }];
    const options = { claudeHome: alias, sourceHome: alias, sourceKind,
      sourceConfigs: { [sourceKind]: { home: alias, projectPathRules: rules } } };
    const projects = await discoverClaudeProjects(options);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].sessionCount, 2);
    const index = await buildClaudeSourceBackedIndex({ ...options, repoRoot: UNC });
    t.after(() => disposeProjectQueryStore(index.projectQueryStore));
    await validateIndexOwnershipForCommit(index);
    assert.equal(index.projectPathScopeRoot, layout === 'claude-home' ? path.join(alias, 'projects') : alias);
    assert.equal(index.sessions.length, 3);
    for (const stored of index.sessions) assert.equal((await materializeSessionForIndex(index, stored)).id, stored.id);
    for (const [file, { text }] of f.originals) assert.equal(await fs.readFile(file, 'utf8'), text);
  });
}
