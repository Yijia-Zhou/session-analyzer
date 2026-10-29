'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { assetPolicy, generatedAssets, prepareAssets } = require('../scripts/ci-assets');

const repoRoot = path.resolve(__dirname, '..');
function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-analyzer-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('main and tags check committed assets; a main backmerge rebuilds newer development source', () => {
  const noGit = () => { throw new Error('must not read Git'); };
  for (const eventName of ['push', 'workflow_dispatch']) {
    for (const ref of ['refs/heads/main', 'refs/tags/v0.3.0']) {
      assert.equal(assetPolicy({ eventName, ref }, noGit).mode, 'committed');
    }
    assert.equal(assetPolicy({ eventName, ref: 'refs/heads/v0.3.0-development' }, noGit).mode, 'rebuild');
  }
  assert.equal(assetPolicy({ eventName: 'pull_request', baseRef: 'main' }, noGit).mode, 'committed');
  assert.equal(assetPolicy({ eventName: 'pull_request', baseRef: 'v0.3.0-development', headRef: 'main',
    repository: 'synthetic/repo', headRepository: 'synthetic/repo' }, noGit).mode, 'rebuild');
  assert.throws(() => assetPolicy({ eventName: 'pull_request', baseRef: 'v0.3.0-development', headRef: 'main',
    repository: 'synthetic/repo', headRepository: 'other/repo' }, noGit), /exact PR commits/);
  for (const input of [{}, { eventName: 'pull_request' }, { eventName: 'push' },
    { eventName: 'push', ref: 'refs/unknown/test' },
    { eventName: 'pull_request_target', ref: 'refs/heads/main' }]) {
    assert.throws(() => assetPolicy(input, noGit));
  }
  assert.throws(() => prepareAssets(undefined), /invalid asset mode/);
});

test('ordinary PR policy reads its merge-base diff and rejects edits, removal and moves of either asset', t => {
  const root = temporaryRoot(t);
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      GIT_AUTHOR_NAME: 'Synthetic Asset Test', GIT_AUTHOR_EMAIL: 'asset@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic Asset Test', GIT_COMMITTER_EMAIL: 'asset@example.invalid' } }).trim();
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), text); };
  const commit = () => { git('add', '--all'); git('commit', '--quiet', '-m', 'synthetic assets'); return git('rev-parse', 'HEAD'); };
  git('init', '--quiet');
  generatedAssets.forEach(p => write(p, 'old asset\n'));
  write('source.js', 'old source\n');
  const base = commit();
  write('source.js', 'new source\n');
  const sourceHead = commit();
  git('checkout', '--detach', base);
  write(generatedAssets[0], 'new base asset\n');
  const advancedBase = commit();
  const input = { eventName: 'pull_request', baseRef: 'v0.3.0-development',
    baseSha: advancedBase, headSha: sourceHead, cwd: root };
  assert.deepEqual(assetPolicy(input), { mode: 'rebuild', mergeBase: base });
  for (const filename of generatedAssets) {
    for (const change of ['edit', 'remove', 'move']) {
      git('checkout', '--detach', base);
      if (change === 'edit') write(filename, 'new asset\n');
      if (change === 'remove') fs.rmSync(path.join(root, filename));
      if (change === 'move') fs.renameSync(path.join(root, filename), path.join(root, 'moved.js'));
      assert.throws(() => assetPolicy({ ...input, baseSha: base, headSha: commit() }), /must not change generated assets/);
    }
  }
  assert.throws(() => assetPolicy({ ...input, headSha: '--invalid' }), /exact PR commits/);
  assert.throws(() => assetPolicy(input, () => { throw new Error('missing history'); }), /missing history/);
  assert.throws(() => assetPolicy(input, () => ''), /merge base/);

  const output = path.join(root, 'outputs');
  const cli = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/ci-assets.js'), 'policy'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/v0.3.0-development', GITHUB_OUTPUT: output },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(fs.readFileSync(output, 'utf8'), 'asset_mode=rebuild\n');
});

test('development rebuild uses current source while committed/release check rejects stale assets without overwriting them', t => {
  const root = temporaryRoot(t);
  for (const dir of ['scripts', 'src/browser', 'public/assets', 'public/vendor/highlightjs']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(repoRoot, 'scripts/build-client.js'), path.join(root, 'scripts/build-client.js'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(root, 'scripts/highlight-vendor-entry.js'), 'console.log("SYNTHETIC_VENDOR");');
  const source = path.join(root, 'src/browser/entry.js');
  fs.writeFileSync(source, 'console.log("SYNTHETIC_OLD_SOURCE");');
  prepareAssets('rebuild', { root });
  const before = generatedAssets.map(p => fs.readFileSync(path.join(root, p)));
  fs.writeFileSync(source, 'console.log("SYNTHETIC_NEW_SOURCE");');
  assert.throws(() => prepareAssets('committed', { root }), /preparation failed/);
  generatedAssets.forEach((p, i) => assert.deepEqual(fs.readFileSync(path.join(root, p)), before[i]));
  const backmerge = assetPolicy({ eventName: 'pull_request', baseRef: 'v0.3.0-development', headRef: 'main',
    repository: 'synthetic/repo', headRepository: 'synthetic/repo' });
  prepareAssets(backmerge.mode, { root });
  assert.match(fs.readFileSync(path.join(root, generatedAssets[0]), 'utf8'), /SYNTHETIC_NEW_SOURCE/);
  prepareAssets('committed', { root });
});

test('every dependency-installing CI job prepares its own assets and publication retains the non-mutating gate', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/gu, '\n');
  for (const job of ['node', 'package', 'browser']) {
    const block = workflow.split(`\n  ${job}:\n`)[1].split(/\n  [a-z]+:\n/u)[0];
    assert.ok(block.indexOf('npm ci --strict-allow-scripts') < block.indexOf('node scripts/ci-assets.js build'));
    assert.match(block, /ASSET_MODE: \$\{\{ needs\.scope\.outputs\.asset_mode \}\}/);
    assert.ok(block.indexOf('node scripts/ci-assets.js build') < block.indexOf(job === 'node'
      ? 'run: npm test' : job === 'package' ? 'run: npm run test:package' : 'run: npm run test:browser'));
  }
  const pkg = require('../package.json');
  assert.equal(pkg.scripts.dev, 'npm run build && node server.js');
  assert.equal(pkg.scripts.start, 'node server.js');
  assert.equal(pkg.scripts.prepublishOnly, 'npm run release:check');
  assert.ok(pkg.scripts['release:check'].startsWith('npm run build:check &&'));
  for (const name of ['prestart', 'prepare', 'prepack', 'pretest', 'pretest:package']) assert.equal(pkg.scripts[name], undefined);
  const publish = fs.readFileSync(path.join(repoRoot, '.github/workflows/publish.yml'), 'utf8');
  assert.doesNotMatch(publish, /run: npm run build\s*$/mu);
});
