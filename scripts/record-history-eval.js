#!/usr/bin/env node
'use strict';

// The worker uses the shipped CLI unchanged; metrics stay outside the corpus.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [trial, ...args] = process.argv.slice(2);
if (!/^[a-z0-9_-]{1,80}$/u.test(trial || '') || !args.length) {
  throw new Error('Usage: node scripts/record-history-eval.js <trial-id> <history operation and flags>');
}
const start = performance.now();
const result = spawnSync(process.execPath, [path.join(__dirname, '../server.js'), 'history', ...args], {
  encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 125000, windowsHide: true,
});
const directory = path.join(__dirname, '../tmp/history-eval-results');
fs.mkdirSync(directory, { recursive: true });
fs.appendFileSync(path.join(directory, `${trial}.jsonl`), JSON.stringify({
  at: new Date().toISOString(), args, elapsedMs: performance.now() - start,
  exitCode: result.status, outputBytes: Buffer.byteLength(result.stdout || ''),
  stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null,
}) + '\n');
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exitCode = result.status ?? 1;
