'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

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
const TARGET_TO_REF_DIFF_ALGORITHM = 'git-diff-binary-no-ext-diff-full-index-v1';
const PACKET_INDEX_ALGORITHM = 'performance-wave-0-packet-index-v1';
const PACKET_PAYLOAD_ALGORITHM = 'sha256-raw-bytes-v1';
const REVIEW_PACKET_HASH_ALGORITHM = 'performance-wave-0-review-packet-v1';
const PACKET_INDEX_FILENAME = 'packet-index.json';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function utf8OrdinalCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizedRelative(value) {
  return value.split(path.sep).join('/');
}

function lengthDelimitedSha256(values) {
  const hash = crypto.createHash('sha256');
  for (const value of values) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(data.length));
    hash.update(length);
    hash.update(data);
  }
  return hash.digest('hex');
}

function canonicalPacketRelativePath(value) {
  const normalized = String(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || path.win32.isAbsolute(normalized)) {
    throw new Error('Wave 0 packet filename is not relative');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Wave 0 packet filename is not canonical');
  }
  return normalized;
}

function pathInsideOrSame(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function enumeratePacketFiles(packetRoot) {
  const root = path.resolve(packetRoot);
  const rootStat = await fsp.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Wave 0 packet root is invalid');
  }
  const canonicalRoot = await fsp.realpath(root);
  const files = [];
  async function visit(absoluteDirectory, relativeDirectory) {
    for (const name of await fsp.readdir(absoluteDirectory)) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const canonicalRelative = canonicalPacketRelativePath(relative);
      const absolute = path.join(absoluteDirectory, name);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('Wave 0 packet contains a link');
      const canonical = await fsp.realpath(absolute);
      if (!pathInsideOrSame(canonical, canonicalRoot)) {
        throw new Error('Wave 0 packet entry escapes its root');
      }
      if (stat.isDirectory()) {
        await visit(absolute, canonicalRelative);
      } else if (stat.isFile()) {
        files.push({ filename: canonicalRelative, absolute: canonical });
      } else {
        throw new Error('Wave 0 packet contains an unsupported entry');
      }
    }
  }
  await visit(canonicalRoot, '');
  files.sort((left, right) => utf8OrdinalCompare(left.filename, right.filename));
  return { canonicalRoot, files };
}

async function packetPayloadRecord(entry) {
  const bytes = await fsp.readFile(entry.absolute);
  return {
    filename: entry.filename,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    algorithm: PACKET_PAYLOAD_ALGORITHM,
  };
}

async function createPacketIndex(packetRoot) {
  const root = path.resolve(packetRoot);
  const indexPath = path.join(root, PACKET_INDEX_FILENAME);
  try {
    await fsp.unlink(indexPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { files } = await enumeratePacketFiles(root);
  const payloads = [];
  for (const entry of files) payloads.push(await packetPayloadRecord(entry));
  const index = {
    schemaVersion: 1,
    artifactKind: 'performance-wave-0-packet-index',
    algorithm: PACKET_INDEX_ALGORITHM,
    payloadAlgorithm: PACKET_PAYLOAD_ALGORITHM,
    reviewPacketHashAlgorithm: REVIEW_PACKET_HASH_ALGORITHM,
    self: {
      filename: PACKET_INDEX_FILENAME,
      indexed: false,
      reason: 'excluded-self-reference',
    },
    payloads,
  };
  await fsp.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return verifyPacketIndex(root);
}

function assertExactObjectKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`Wave 0 ${label} schema is invalid`);
  }
}

async function verifyPacketIndex(packetRoot) {
  const root = path.resolve(packetRoot);
  const indexPath = path.join(root, PACKET_INDEX_FILENAME);
  const indexBytes = await fsp.readFile(indexPath);
  const index = JSON.parse(indexBytes.toString('utf8'));
  assertExactObjectKeys(index, [
    'schemaVersion', 'artifactKind', 'algorithm', 'payloadAlgorithm',
    'reviewPacketHashAlgorithm', 'self', 'payloads',
  ], 'packet index');
  assertExactObjectKeys(index.self, ['filename', 'indexed', 'reason'], 'packet index self');
  if (index.schemaVersion !== 1
      || index.artifactKind !== 'performance-wave-0-packet-index'
      || index.algorithm !== PACKET_INDEX_ALGORITHM
      || index.payloadAlgorithm !== PACKET_PAYLOAD_ALGORITHM
      || index.reviewPacketHashAlgorithm !== REVIEW_PACKET_HASH_ALGORITHM
      || index.self.filename !== PACKET_INDEX_FILENAME
      || index.self.indexed !== false
      || index.self.reason !== 'excluded-self-reference'
      || !Array.isArray(index.payloads)) {
    throw new Error('Wave 0 packet index identity is invalid');
  }
  const { files } = await enumeratePacketFiles(root);
  const actualPayloads = files.filter((entry) => entry.filename !== PACKET_INDEX_FILENAME);
  const expectedNames = index.payloads.map((entry) => entry.filename);
  const actualNames = actualPayloads.map((entry) => entry.filename);
  if (new Set(expectedNames).size !== expectedNames.length
      || JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
    throw new Error('Wave 0 packet file set does not match its index');
  }
  const hashRecords = [REVIEW_PACKET_HASH_ALGORITHM, PACKET_INDEX_FILENAME, indexBytes];
  for (let position = 0; position < index.payloads.length; position += 1) {
    const expected = index.payloads[position];
    assertExactObjectKeys(expected, [
      'filename', 'byteLength', 'sha256', 'algorithm',
    ], 'packet payload');
    const actual = await packetPayloadRecord(actualPayloads[position]);
    if (canonicalPacketRelativePath(expected.filename) !== expected.filename
        || expected.algorithm !== PACKET_PAYLOAD_ALGORITHM
        || expected.byteLength !== actual.byteLength
        || expected.sha256 !== actual.sha256) {
      throw new Error('Wave 0 packet payload verification failed');
    }
    hashRecords.push(expected.filename, await fsp.readFile(actualPayloads[position].absolute));
  }
  return {
    passed: true,
    packetFileCount: files.length,
    indexedPayloadCount: index.payloads.length,
    reviewPacketHashAlgorithm: REVIEW_PACKET_HASH_ALGORITHM,
    reviewPacketHash: lengthDelimitedSha256(hashRecords),
    index,
  };
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

function resolveCommitSha(repoRoot, ref) {
  const value = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error('Wave 0 identity did not resolve a full commit SHA');
  return value;
}

function exactTargetToRefDiff(repoRoot, targetRef, candidateRef) {
  return execFileSync('git', [
    'diff', '--binary', '--no-ext-diff', '--full-index', `${targetRef}..${candidateRef}`, '--',
  ], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
}

function targetToRefDiffSha256(repoRoot, targetRef, candidateRef) {
  return sha256(exactTargetToRefDiff(repoRoot, targetRef, candidateRef));
}

function requireAncestor(repoRoot, ancestor, descendant, label) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: repoRoot,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Wave 0 ${label} ancestry is invalid`);
}

function requireImplementationMatch(repoRoot, candidateCommitSha) {
  const result = spawnSync('git', [
    'diff', '--quiet', candidateCommitSha, 'HEAD', '--', ...IMPLEMENTATION_PATHS,
  ], { cwd: repoRoot, windowsHide: true });
  if (result.status !== 0) {
    throw new Error('Wave 0 capture implementation differs from the immutable candidate');
  }
}

async function captureGitIdentity(repoRoot = REPO_ROOT, options = {}) {
  const root = path.resolve(repoRoot);
  const head = resolveCommitSha(root, 'HEAD');
  const candidateCommitSha = resolveCommitSha(root, options.candidateCommitSha || head);
  const targetSyncSha = resolveCommitSha(
    root,
    options.targetSyncSha || 'origin/towards-0.2.0',
  );
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (status) throw new Error('Wave 0 evidence capture requires a clean worktree');
  requireAncestor(root, targetSyncSha, candidateCommitSha, 'target-to-candidate');
  requireAncestor(root, candidateCommitSha, head, 'candidate-to-capture-head');
  requireImplementationMatch(root, candidateCommitSha);
  return {
    currentBranch: execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    head,
    candidateCommitSha,
    targetSyncSha,
    targetToCandidateDiffAlgorithm: TARGET_TO_REF_DIFF_ALGORITHM,
    targetToCandidateDiffSha256: targetToRefDiffSha256(
      root,
      targetSyncSha,
      candidateCommitSha,
    ),
    dirty: false,
    profiledTrackedDiffSha256AtRun: profiledTrackedDiffSha256AtRun(root),
    profiledImplementationTreeHash: await profiledImplementationTreeHash(root),
  };
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
      || !runIdentity?.candidateCommitSha
      || !runIdentity?.targetSyncSha
      || runIdentity?.targetToCandidateDiffAlgorithm !== TARGET_TO_REF_DIFF_ALGORITHM
      || !runIdentity?.targetToCandidateDiffSha256
      || !documentationHash) {
    throw new Error('Wave 0 review identity is incomplete');
  }
  return {
    profiledImplementationTreeHash: runIdentity.profiledImplementationTreeHash,
    profiledTrackedDiffSha256AtRun: runIdentity.profiledTrackedDiffSha256AtRun,
    candidateCommitSha: runIdentity.candidateCommitSha,
    targetSyncSha: runIdentity.targetSyncSha,
    targetToCandidateDiffAlgorithm: runIdentity.targetToCandidateDiffAlgorithm,
    targetToCandidateDiffSha256: runIdentity.targetToCandidateDiffSha256,
    postRunDocumentationHash: documentationHash,
  };
}

module.exports = {
  IMPLEMENTATION_PATHS,
  PACKET_INDEX_ALGORITHM,
  PACKET_INDEX_FILENAME,
  PACKET_PAYLOAD_ALGORITHM,
  POST_RUN_DOCUMENTATION_PATHS,
  REVIEW_PACKET_HASH_ALGORITHM,
  TARGET_TO_REF_DIFF_ALGORITHM,
  buildReviewIdentity,
  canonicalPacketRelativePath,
  captureGitIdentity,
  createPacketIndex,
  exactTargetToRefDiff,
  hashRepositoryPaths,
  postRunDocumentationHash,
  profiledImplementationTreeHash,
  profiledTrackedDiffSha256AtRun,
  resolveCommitSha,
  targetToRefDiffSha256,
  utf8OrdinalCompare,
  verifyPacketIndex,
};
