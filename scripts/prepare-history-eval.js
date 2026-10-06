#!/usr/bin/env node
'use strict';

// Make an isolated, reproducible synthetic source; never touch live transcripts.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function main() {
  const destination = path.resolve(process.argv[2] || path.join(__dirname, '../tmp/history-eval'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination); // Refuse an existing destination rather than overwrite a trial.
  const repo = path.join(destination, 'workspace');
  const other = path.join(destination, 'other');
  const codexHome = path.join(destination, 'codex');
  const source = path.join(__dirname, '../test/fixtures/history-retrieval-eval/codex');
  await fs.mkdir(repo);
  await fs.mkdir(other);
  await fs.cp(source, codexHome, { recursive: true, errorOnExist: true });
  const entries = await fs.readdir(codexHome, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(entry.parentPath, entry.name)).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const original = await fs.readFile(file, 'utf8');
    const updated = original.split('\n').map((line) => {
      if (!line.trim()) return line;
      const record = JSON.parse(line);
      if (record.type !== 'session_meta') return line;
      if (record.payload.cwd === '/synthetic/history-eval/workspace') record.payload.cwd = repo;
      else if (record.payload.cwd === '/synthetic/history-eval/other') record.payload.cwd = other;
      else throw new Error('Unexpected synthetic project');
      return JSON.stringify(record);
    }).join('\n');
    await fs.writeFile(file, updated, 'utf8');
    hash.update(path.relative(codexHome, file).replace(/\\/gu, '/'));
    hash.update('\0');
    hash.update(updated);
  }
  const result = { repo, source: 'codex', codexHome, fileCount: files.length,
    corpusHash: hash.digest('hex'), preparedAt: new Date().toISOString() };
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
