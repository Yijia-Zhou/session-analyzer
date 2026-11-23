'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { freeze } = require('../scripts/freeze-history-eval');
const { freezeScope, resolveServeScope, verifyCorpus, verifyPreflight, verifyIndex, verifyCoverage,
  verifyRawFiles, createAuditedHistoryService } = require('../scripts/history-eval-scope');

async function fixture(t) {
  await fs.mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const root = await fs.mkdtemp(path.join(ROOT, 'tmp/history-scope-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'project');
  await fs.mkdir(repo);
  const source = path.join(root, 'scope-synthetic.jsonl');
  const text = [
    { type: 'session_meta', timestamp: '2026-11-01T00:00:00Z', payload: { id: 'scope-synthetic', cwd: repo } },
    { type: 'event_msg', timestamp: '2026-11-01T00:00:01Z', payload: { type: 'user_message', message: 'SYNTHETIC_SCOPE_EVIDENCE 中文' } },
  ].map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(source, text);
  const target = path.join(root, 'frozen');
  const corpus = freeze({ target, inputs: [source], repo });
  const manifest = path.join(target, 'manifest.json');
  const args = ['serve', '--repo', repo, '--source', 'codex', '--codex-home', corpus.codexHome];
  const scope = await freezeScope({ corpusManifest: manifest, serveArgs: args, expectedSessionIds: ['scope-synthetic'] });
  const frozenFile = path.join(corpus.codexHome, corpus.files[0].relativePath);
  return { root, repo, source, corpus, manifest, args, scope, frozenFile, text };
}
function indexFor(scope, ids = scope.sessionIds) {
  return { sourceKind: 'codex', sourceRoot: scope.sourceRoot, sourceHome: scope.sourceHome,
    repoRoot: scope.project.path, projectPathContext: scope.projectPathContext,
    projectPathPolicyId: scope.projectPathPolicyId, sessions: ids.map((id) => ({ id })) };
}
function coverageFor(scope) {
  return { source: 'codex', sourceRoot: scope.sourceRoot, sourceRootAccessible: true, indexing: 'complete',
    repo: scope.project.path, projectPathIdentity: scope.project.identity,
    projectPathPolicyId: scope.projectPathPolicyId, sessionCount: scope.sessionIds.length };
}
function mismatch(stage) {
  return (error) => error.code === 'EVAL_SCOPE_MISMATCH' && error.stage === stage;
}

test('scope captures actual home, project interpretation and sourceRoot separately', async (t) => {
  const f = await fixture(t);
  const { options, audit } = await verifyPreflight(f.scope, f.args);
  assert.equal(options.codexHome, f.corpus.codexHome);
  assert.equal(f.scope.runtimeRoot, ROOT);
  assert.equal(f.scope.sourceRoot, path.join(f.corpus.codexHome, 'sessions'));
  assert.notEqual(f.scope.sourceRoot, f.corpus.sourceRoot);
  assert.equal(audit.indexingCostIncurred, false);
  assert.equal(audit.fileCount, 1);
  assert.equal(f.scope.sessionSetSha256, sha256(JSON.stringify(['scope-synthetic'])));
  assert.equal(verifyIndex(f.scope, indexFor(f.scope)).indexingCostIncurred, true);
  verifyCoverage(f.scope, coverageFor(f.scope));
});

test('wrong or omitted home is refused before build without argument repair', async (t) => {
  const f = await fixture(t);
  const wrong = [...f.args]; wrong[wrong.length - 1] = f.root;
  const before = [...wrong];
  await assert.rejects(createAuditedHistoryService(f.scope, wrong), (error) => {
    assert.equal(error.indexingCostIncurred, false);
    return mismatch('pre-index')(error);
  });
  assert.deepEqual(wrong, before);
  await assert.rejects(verifyPreflight(f.scope, f.args.slice(0, -2)), mismatch('pre-index'));
  const differentProject = [...f.args]; differentProject[2] = path.join(f.root, 'other-project');
  await assert.rejects(verifyPreflight(f.scope, differentProject), mismatch('pre-index'));
});

test('path config uses actual file-relative home resolution and frozen rule identity', async (t) => {
  const f = await fixture(t);
  const config = path.join(f.root, 'paths.json');
  const configValue = { codex: { home: './frozen/codex', projectPathRules: [
    { scope: 'container', path: 'sessions', interpretation: 'posix' },
  ] } };
  await fs.writeFile(config, JSON.stringify(configValue));
  const args = [...f.args.slice(0, -2), '--path-config', config];
  const scope = await freezeScope({ corpusManifest: f.manifest, serveArgs: args, expectedSessionIds: ['scope-synthetic'] });
  const resolved = await resolveServeScope(args);
  assert.equal(resolved.sourceHome, f.corpus.codexHome);
  assert.equal(scope.projectPathPolicyId, resolved.projectPathPolicyId);
  await verifyPreflight(scope, args);
  await assert.rejects(verifyPreflight(scope, [...args, '--codex-home', f.root]), mismatch('pre-index'));
  await assert.rejects(verifyPreflight(scope, f.args), mismatch('pre-index'));
  configValue.codex.projectPathRules[0].interpretation = 'unc';
  await fs.writeFile(config, JSON.stringify(configValue));
  await assert.rejects(verifyPreflight(scope, args), mismatch('pre-index'));
});

test('explicit project path semantics are frozen separately from inferred identity', async (t) => {
  const f = await fixture(t);
  const semantics = process.platform === 'win32' ? 'windows' : 'posix';
  const explicit = [...f.args, '--project-path-semantics', semantics];
  const scope = await freezeScope({ corpusManifest: f.manifest, serveArgs: explicit, expectedSessionIds: ['scope-synthetic'] });
  await verifyPreflight(scope, explicit);
  await assert.rejects(verifyPreflight(scope, f.args), mismatch('pre-index'));
});

test('equal count and sourceRoot cannot substitute for complete Session identity', async (t) => {
  const f = await fixture(t);
  assert.throws(() => verifyIndex(f.scope, indexFor(f.scope, ['different-session'])), mismatch('post-index'));
  assert.throws(() => verifyIndex(f.scope, indexFor(f.scope, [])), mismatch('post-index'));
  assert.throws(() => verifyIndex(f.scope, indexFor(f.scope, ['scope-synthetic', 'scope-synthetic'])), mismatch('post-index'));
  const badRoot = { ...indexFor(f.scope), sourceRoot: f.scope.sourceHome };
  assert.throws(() => verifyIndex(f.scope, badRoot), mismatch('post-index'));
  const badPolicy = { ...indexFor(f.scope), projectPathPolicyId: 'different' };
  assert.throws(() => verifyIndex(f.scope, badPolicy), mismatch('post-index'));
  assert.throws(() => verifyCoverage(f.scope, { ...coverageFor(f.scope), sourceRoot: f.root }), mismatch('post-index'));
});

test('corpus verification rejects changed bytes, missing or additional files and edited manifest', async (t) => {
  const f = await fixture(t);
  await fs.appendFile(f.frozenFile, '\n');
  await assert.rejects(verifyCorpus(f.scope), mismatch('pre-index'));
  await fs.writeFile(f.frozenFile, f.text);
  const extra = path.join(f.scope.sourceHome, 'unexpected.json');
  await fs.writeFile(extra, '{}');
  await assert.rejects(verifyCorpus(f.scope), mismatch('pre-index'));
  await fs.unlink(extra);
  await fs.unlink(f.frozenFile);
  await assert.rejects(verifyCorpus(f.scope), mismatch('pre-index'));
  await fs.writeFile(f.frozenFile, f.text);
  await fs.appendFile(f.manifest, ' ');
  await assert.rejects(verifyCorpus(f.scope), mismatch('pre-index'));
});

test('symlink or junction inside source home cannot expand the frozen corpus', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.jsonl'), 'DO_NOT_FORWARD');
  await fs.symlink(outside, path.join(f.scope.sourceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyCorpus(f.scope), mismatch('pre-index'));
  await assert.rejects(verifyRawFiles(f.scope, [f.frozenFile]), mismatch('raw-forward'));
});

test('raw forwarding returns only checked bytes from the frozen file set', async (t) => {
  const f = await fixture(t);
  const [file] = await verifyRawFiles(f.scope, [f.corpus.files[0].relativePath]);
  assert.equal(file.path, f.frozenFile);
  assert.equal(file.content.toString('utf8'), f.text);
  assert.equal(file.sha256, sha256(file.content));
  await assert.rejects(verifyRawFiles(f.scope, [f.source]), mismatch('raw-forward'));
  await assert.rejects(verifyRawFiles(f.scope, ['sessions/../../manifest.json']), mismatch('raw-forward'));
  await fs.appendFile(f.frozenFile, 'OUT_OF_SCOPE_APPEND');
  await assert.rejects(verifyRawFiles(f.scope, [f.frozenFile]), mismatch('raw-forward'));
});

test('unmodified service is gated using the actual index and still exposes normal retrieval', async (t) => {
  const f = await fixture(t);
  const first = await createAuditedHistoryService(f.scope, f.args);
  t.after(() => first.service.close());
  assert.deepEqual(first.audit.index.sessionIds, ['scope-synthetic']);
  assert.equal(first.audit.index.sessionSetSha256, f.scope.sessionSetSha256);
  assert.match(first.audit.serviceSourceSha256, /^[a-f0-9]{64}$/u);
  const result = await first.service.execute('search', { query: 'SYNTHETIC_SCOPE_EVIDENCE', retrievalArtifacts: 'include' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sessionId, 'scope-synthetic');
});

test('post-index mismatch incurs build cost but never returns a usable service', async (t) => {
  const f = await fixture(t);
  const scope = await freezeScope({ corpusManifest: f.manifest, serveArgs: f.args, expectedSessionIds: ['wrong-but-same-count'] });
  await assert.rejects(createAuditedHistoryService(scope, f.args), (error) => {
    assert.equal(error.indexingCostIncurred, true);
    return mismatch('post-index')(error);
  });
  // A failed observer does not patch the global adapter or poison later trials.
  const valid = await createAuditedHistoryService(f.scope, f.args);
  t.after(() => valid.service.close());
  assert.equal(valid.audit.index.sessionCount, 1);
});

test('scope manifest integrity and Session-set provenance are mandatory', async (t) => {
  const f = await fixture(t);
  await assert.rejects(freezeScope({ corpusManifest: f.manifest, serveArgs: f.args }), mismatch('pre-index'));
  await assert.rejects(freezeScope({ corpusManifest: f.manifest, serveArgs: f.args, expectedSessionIds: ['a', 'a'] }), mismatch('pre-index'));
  await assert.rejects(verifyPreflight({ ...f.scope, sessionIds: ['other'] }, f.args), mismatch('pre-index'));
  const scope = await freezeScope({ corpusManifest: f.manifest, serveArgs: f.args, expectedSessionIds: [] });
  assert.deepEqual(scope.sessionIds, []);
});
