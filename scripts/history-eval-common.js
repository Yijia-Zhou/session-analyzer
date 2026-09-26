'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identifier = (value) => /^[a-zA-Z0-9_-]{1,80}$/u.test(value || '');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

// Real path containment prevents an ignored tmp symlink from sending private data elsewhere.
function privateTarget(value) {
  const target = path.resolve(value);
  const tmp = path.join(ROOT, 'tmp');
  if (!inside(tmp, target)) throw new Error('Private evaluation output must be below this checkout tmp/');
  let existing = target;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const resolved = path.resolve(fs.realpathSync(existing), path.relative(existing, target));
  const realRoot = fs.realpathSync(ROOT);
  if (!inside(path.join(realRoot, 'tmp'), resolved)) throw new Error('Private output escapes tmp/ through a symlink');
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', target], { cwd: ROOT, windowsHide: true });
  if (ignored.status !== 0) throw new Error('Private output must be git-ignored');
  return target;
}

function readManifest(file) {
  if (!file) return null;
  const manifestPath = path.resolve(file);
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (!/^[a-f0-9]{64}$/u.test(manifest.corpusHash || '')) throw new Error('Manifest requires SHA-256 corpusHash');
  return { manifestPath, manifestSha256: sha256(bytes), corpusHash: manifest.corpusHash };
}

function mainGuard(main) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { ROOT, sha256, identifier, inside, privateTarget, readManifest, mainGuard };
