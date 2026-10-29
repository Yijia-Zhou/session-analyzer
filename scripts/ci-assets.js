#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const generatedAssets = ['public/assets/app.js', 'public/vendor/highlightjs/highlight.min.js'];
const commitPattern = /^[a-f0-9]{40}$/u;

function assetPolicy({ eventName, ref, baseRef, headRef, repository, headRepository,
  baseSha, headSha, cwd = repoRoot }, git = (args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000,
  stdio: ['ignore', 'pipe', 'pipe'],
})) {
  if (eventName === 'pull_request') {
    if (!baseRef) throw new Error('Missing PR target for generated-asset policy.');
    if (baseRef === 'main') return { mode: 'committed' };
    // A main backmerge may update the saved release snapshot, but its merged
    // development source can already be newer and must be rebuilt for tests.
    if (headRef === 'main' && repository && headRepository === repository) return { mode: 'rebuild' };
    if (!commitPattern.test(baseSha || '') || !commitPattern.test(headSha || '')) {
      throw new Error('Missing exact PR commits for generated-asset policy.');
    }
    const mergeBase = git(['merge-base', baseSha, headSha]).trim();
    if (!commitPattern.test(mergeBase)) throw new Error('Missing PR merge base.');
    const changes = git(['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff',
      mergeBase, headSha, '--', ...generatedAssets]);
    if (changes) {
      throw new Error('Ordinary development PRs must not change generated assets: '
        + changes.split('\0').filter(Boolean).join(', ')
        + '. Sync the target branch and restore only these paths from it; keep building and testing locally.');
    }
    return { mode: 'rebuild', mergeBase };
  }
  if (!['push', 'workflow_dispatch'].includes(eventName)
    || !/^refs\/(?:heads|tags)\/.+/u.test(ref || '')) {
    throw new Error('Unknown CI context for generated-asset policy.');
  }
  return { mode: ref === 'refs/heads/main' || ref.startsWith('refs/tags/') ? 'committed' : 'rebuild' };
}

function prepareAssets(mode, { root = repoRoot } = {}) {
  if (!['committed', 'rebuild'].includes(mode)) throw new Error('Missing or invalid asset mode.');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-client.js'),
    ...(mode === 'committed' ? ['--check'] : [])], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Browser asset preparation failed (${mode}, exit ${result.status}).`);
}

function main(environment = process.env) {
  if (process.argv[2] === 'build') return prepareAssets(environment.ASSET_MODE);
  if (process.argv[2] !== 'policy') throw new Error('Usage: ci-assets.js <policy|build>');
  const result = assetPolicy({ eventName: environment.GITHUB_EVENT_NAME, ref: environment.GITHUB_REF,
    baseRef: environment.GITHUB_BASE_REF, headRef: environment.GITHUB_HEAD_REF,
    repository: environment.GITHUB_REPOSITORY, headRepository: environment.CI_HEAD_REPOSITORY,
    baseSha: environment.CI_BASE_SHA, headSha: environment.CI_HEAD_SHA });
  if (environment.GITHUB_OUTPUT) fs.appendFileSync(environment.GITHUB_OUTPUT, `asset_mode=${result.mode}\n`);
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assetPolicy, generatedAssets, prepareAssets };
