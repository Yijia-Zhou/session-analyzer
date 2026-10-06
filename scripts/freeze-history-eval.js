#!/usr/bin/env node
'use strict';

// Explicit local Codex inputs only. No recursive discovery, normalization, or metadata rewriting.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, sha256, inside, privateTarget, mainGuard } = require('./history-eval-common');

function freeze({ target, inputs, repo = null }) {
  if (!target || !inputs?.length) throw new Error('Specify --target and at least one --input file');
  const destination = privateTarget(target);
  if (fs.existsSync(destination)) throw new Error('Frozen corpus target already exists');
  const seen = new Set();
  const files = inputs.map((input) => {
    const source = fs.realpathSync(path.resolve(input));
    if (!fs.statSync(source).isFile()) throw new Error('Each input must be an explicit file');
    if (inside(destination, source) || source === destination) throw new Error('Input cannot be inside destination');
    if (inside(path.join(ROOT, 'tmp/history-eval-results'), source)) throw new Error('Trial results cannot be corpus inputs');
    const name = path.basename(source);
    if (!name.endsWith('.jsonl')) throw new Error('Frozen Codex helper currently supports uncompressed .jsonl inputs only');
    if (seen.has(name.toLowerCase())) throw new Error('Duplicate input basename; choose unambiguous files');
    seen.add(name.toLowerCase());
    const bytes = fs.readFileSync(source);
    const firstLine = bytes.toString('utf8').split(/\r?\n/u).find((line) => line.trim());
    const first = JSON.parse(firstLine || 'null');
    if (first?.type !== 'session_meta' || typeof first.payload?.cwd !== 'string') throw new Error('Input is not a Codex session starting with session_meta/cwd');
    return { source, relativePath: `sessions/${name}`, bytes, sha256: sha256(bytes), originalCwd: first.payload.cwd };
  }).sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  // All validation precedes creation. New target prevents accidentally overwriting previous evidence.
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination);
  const codexHome = path.join(destination, 'codex');
  fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(codexHome, file.relativePath), file.bytes, { flag: 'wx' });
  const manifestFiles = files.map(({ bytes, ...entry }) => ({ ...entry, bytes: bytes.length }));
  const corpusHash = sha256(JSON.stringify(manifestFiles.map(({ relativePath, sha256, bytes }) => ({ relativePath, sha256, bytes }))));
  const manifest = { schemaVersion: 1, kind: 'frozen-codex-corpus', preparedAt: new Date().toISOString(),
    source: 'codex', sourceRoot: codexHome, codexHome, repo: repo ? path.resolve(repo) : null, fileCount: files.length,
    corpusHash, hashMethod: 'sha256(JSON.stringify(sorted [{relativePath,sha256,bytes}]))',
    transformations: [], temporalCutoff: null, files: manifestFiles };
  fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}
function main() {
  const args = process.argv.slice(2); const options = { inputs: [] };
  while (args.length) {
    const key = args.shift();
    if (!['--target', '--input', '--repo'].includes(key) || !args.length) throw new Error('Usage: freeze-history-eval.js --target tmp/new-corpus --repo <project> --input <session.jsonl> [--input <session.jsonl> ...]');
    const value = args.shift();
    if (key === '--input') options.inputs.push(value); else options[key.slice(2)] = value;
  }
  process.stdout.write(`${JSON.stringify(freeze(options), null, 2)}\n`);
}
if (require.main === module) mainGuard(main);
module.exports = { freeze };
