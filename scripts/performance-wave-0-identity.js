'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const IMPLEMENTATION_PATHS = Object.freeze([
  'server.js',
  'src',
  'scripts',
  'test',
  'package.json',
  'package-lock.json',
  'public',
]);
const POST_RUN_DOCUMENTATION_PATHS = Object.freeze([
  'AGENTS.md',
  'docs/design-docs/timeline-loading-and-rendering-performance.md',
  'docs/design-docs/indexed-materialized-session-lifecycle.md',
  'docs/exec-plans/active/2026-08-24-performance-wave-0-baseline.md',
  'docs/exec-plans/completed/2026-08-24-performance-wave-0-baseline.md',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function utf8OrdinalCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizedRelative(value) {
  return value.split(path.sep).join('/');
}

async function hashRepositoryPaths(repoRoot, selectedPaths) {
  const root = path.resolve(repoRoot);
  const entries = [];
  async function visit(relative) {
    const absolute = path.join(root, relative);
    let stat;
    try {
      stat = await fsp.lstat(absolute);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const target = await fsp.readlink(absolute);
      entries.push([normalizedRelative(relative), 'link', Buffer.byteLength(target, 'utf8'), sha256(target)]);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of await fsp.readdir(absolute)) await visit(path.join(relative, name));
      return;
    }
    if (!stat.isFile()) throw new Error('Wave 0 identity encountered an unsupported repository entry');
    const data = await fsp.readFile(absolute);
    entries.push([normalizedRelative(relative), 'file', data.length, sha256(data)]);
  }
  for (const relative of selectedPaths) await visit(relative);
  entries.sort(([left], [right]) => utf8OrdinalCompare(left, right));
  return sha256(`${JSON.stringify(entries)}\n`);
}

function profiledTrackedDiffSha256AtRun(repoRoot = REPO_ROOT) {
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: repoRoot });
  return sha256(diff);
}

function profiledImplementationTreeHash(
  repoRoot = REPO_ROOT,
  selectedPaths = IMPLEMENTATION_PATHS,
) {
  return hashRepositoryPaths(repoRoot, selectedPaths);
}

function postRunDocumentationHash(
  repoRoot = REPO_ROOT,
  selectedPaths = POST_RUN_DOCUMENTATION_PATHS,
) {
  return hashRepositoryPaths(repoRoot, selectedPaths);
}

function buildReviewIdentity(runIdentity, documentationHash) {
  if (!runIdentity?.profiledImplementationTreeHash
      || !runIdentity?.profiledTrackedDiffSha256AtRun
      || !documentationHash) {
    throw new Error('Wave 0 review identity is incomplete');
  }
  return {
    profiledImplementationTreeHash: runIdentity.profiledImplementationTreeHash,
    profiledTrackedDiffSha256AtRun: runIdentity.profiledTrackedDiffSha256AtRun,
    postRunDocumentationHash: documentationHash,
  };
}

module.exports = {
  IMPLEMENTATION_PATHS,
  POST_RUN_DOCUMENTATION_PATHS,
  buildReviewIdentity,
  hashRepositoryPaths,
  postRunDocumentationHash,
  profiledImplementationTreeHash,
  profiledTrackedDiffSha256AtRun,
  utf8OrdinalCompare,
};
