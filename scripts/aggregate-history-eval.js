#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, privateTarget, mainGuard } = require('./history-eval-common');
const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'totalTokens', 'costUsd'];

function loadTokenizer(modulePath, encoding = 'o200k_base') {
  if (!modulePath) return null;
  const resolved = require.resolve(path.resolve(modulePath));
  const module = require(resolved);
  if (typeof module.getEncoding !== 'function') throw new Error('Tokenizer must expose getEncoding(name), e.g. locally installed js-tiktoken');
  const encoder = module.getEncoding(encoding);
  let directory = path.dirname(resolved);
  let packageInfo = null;
  while (directory !== path.dirname(directory)) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) { packageInfo = JSON.parse(fs.readFileSync(file, 'utf8')); break; }
    directory = path.dirname(directory);
  }
  return { metadata: { modulePath: resolved, moduleSha256: sha256(fs.readFileSync(resolved)), package: packageInfo?.name || null,
    version: packageInfo?.version || null, encoding }, count: (text) => encoder.encode(text, [], []).length };
}

function normalizeUsage(entries) {
  if (!Array.isArray(entries)) throw new Error('Usage input must be an array of explicit provider/harness records');
  const seen = new Map();
  return entries.map((entry) => {
    if (!entry.condition || !entry.trial || !Object.hasOwn(entry, 'corpusHash') || !['provider', 'harness'].includes(entry.source)
      || !['trial-total', 'phase'].includes(entry.scope) || (entry.scope === 'phase' && !['setup', 'retrieval', 'memory-build'].includes(entry.phase))) {
      throw new Error('Usage requires condition, trial, corpusHash, source provider|harness, scope trial-total|phase, and phase when scoped');
    }
    const key = JSON.stringify([entry.condition, entry.trial, entry.corpusHash]);
    const scope = entry.scope === 'trial-total' ? '*' : entry.phase;
    const scopes = seen.get(key) || new Set();
    if (scopes.has(scope) || scopes.has('*') || (scope === '*' && scopes.size)) throw new Error('Overlapping usage records would double-count a trial');
    scopes.add(scope); seen.set(key, scopes);
    const result = { condition: entry.condition, trial: entry.trial, corpusHash: entry.corpusHash, source: entry.source,
      scope: entry.scope, phase: entry.scope === 'phase' ? entry.phase : null, model: entry.model ?? null, provenance: entry.provenance ?? null };
    for (const field of USAGE_FIELDS) {
      const value = entry[field] ?? null;
      if (value !== null && (!Number.isFinite(value) || value < 0 || (field !== 'costUsd' && !Number.isInteger(value)))) throw new Error(`Invalid usage ${field}`);
      result[field] = value;
    }
    return result;
  });
}

function summarize(files, { tokenizer = null, usage = [] } = {}) {
  const supplied = normalizeUsage(usage);
  const matchedUsage = new Set();
  const identities = new Set();
  const trials = files.map((file) => {
    const bytes = fs.readFileSync(file);
    const rows = bytes.toString('utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    if (!rows.length) throw new Error(`Empty trial log: ${file}`);
    const identity = rows[0].identity || { trial: path.basename(file, '.jsonl'), condition: 'legacy', corpus: null, task: null, model: null, harness: null };
    const identityText = JSON.stringify(identity);
    if (rows.some((row) => row.identity && JSON.stringify(row.identity) !== identityText)) throw new Error('Mixed identities in one trial log');
    const key = JSON.stringify([identity.condition, identity.trial, identity.corpus?.corpusHash ?? null]);
    if (identities.has(key)) throw new Error('Duplicate trial logs would double-count measurements');
    identities.add(key);
    const count = (text) => tokenizer ? tokenizer.count(text) : null;
    const perCall = rows.map((row, index) => {
      for (const stream of ['stdout', 'stderr']) {
        if (row[`${stream}Base64`] !== undefined) {
          const captured = Buffer.from(row[`${stream}Base64`], 'base64');
          if (sha256(captured) !== row[`${stream}Sha256`] || captured.length !== row[stream === 'stdout' ? 'outputBytes' : 'stderrBytes']
            || captured.toString('utf8') !== row[stream]) throw new Error(`Corrupt ${stream} capture in ${file}`);
        }
        if (row[`delivered${stream[0].toUpperCase()}${stream.slice(1)}Base64`] !== undefined) {
          const name = `delivered${stream[0].toUpperCase()}${stream.slice(1)}`;
          const delivered = Buffer.from(row[`${name}Base64`], 'base64');
          if (sha256(delivered) !== row[`${name}Sha256`] || delivered.length !== row[`${name}Bytes`]
            || delivered.toString('utf8') !== row[name]) throw new Error(`Corrupt ${name} capture in ${file}`);
        }
      }
      return { step: index + 1, phase: row.phase || 'retrieval', executed: row.executed !== false,
        refused: row.executed === false, outputTruncated: row.outputTruncated === true,
        exitCode: row.exitCode, error: row.error || null,
        elapsedMs: row.elapsedMs ?? null, stdoutBytes: row.outputBytes ?? Buffer.byteLength(row.stdout || ''),
        stderrBytes: row.stderrBytes ?? Buffer.byteLength(row.stderr || ''), captureComplete: row.captureComplete ?? null,
        deliveredStdoutBytes: row.deliveredStdoutBytes ?? row.outputBytes ?? Buffer.byteLength(row.stdout || ''),
        deliveredStderrBytes: row.deliveredStderrBytes ?? row.stderrBytes ?? Buffer.byteLength(row.stderr || ''),
        stdoutReferenceTokens: count(row.stdout || ''), stderrReferenceTokens: count(row.stderr || ''),
        deliveredStdoutReferenceTokens: count(row.deliveredStdout ?? row.stdout ?? ''),
        deliveredStderrReferenceTokens: count(row.deliveredStderr ?? row.stderr ?? ''),
        argsJsonReferenceTokens: count(JSON.stringify(row.args || [])) };
    });
    const sum = (calls, field) => calls.every((call) => call[field] !== null) ? calls.reduce((n, call) => n + call[field], 0) : null;
    const totals = (calls) => ({ calls: calls.length, failedCalls: calls.filter((call) => call.exitCode !== 0 || call.error).length,
      executedCalls: calls.filter((call) => call.executed).length, refusedCalls: calls.filter((call) => call.refused).length,
      truncatedCalls: calls.filter((call) => call.outputTruncated).length,
      incompleteCaptures: calls.filter((call) => call.captureComplete === false).length,
      elapsedMs: sum(calls, 'elapsedMs'), stdoutBytes: sum(calls, 'stdoutBytes'), stderrBytes: sum(calls, 'stderrBytes'),
      deliveredStdoutBytes: sum(calls, 'deliveredStdoutBytes'), deliveredStderrBytes: sum(calls, 'deliveredStderrBytes'),
      stdoutReferenceTokens: sum(calls, 'stdoutReferenceTokens'), stderrReferenceTokens: sum(calls, 'stderrReferenceTokens'),
      deliveredStdoutReferenceTokens: sum(calls, 'deliveredStdoutReferenceTokens'),
      deliveredStderrReferenceTokens: sum(calls, 'deliveredStderrReferenceTokens'),
      argsJsonReferenceTokens: sum(calls, 'argsJsonReferenceTokens') });
    const trialUsage = supplied.filter((entry, index) => {
      const matches = entry.condition === identity.condition && entry.trial === identity.trial && entry.corpusHash === (identity.corpus?.corpusHash ?? null);
      if (matches) matchedUsage.add(index);
      return matches;
    });
    return { identity, logPath: path.resolve(file), logSha256: sha256(bytes), ...totals(perCall),
      phases: Object.fromEntries([...new Set(perCall.map((call) => call.phase))].map((phase) => [phase, totals(perCall.filter((call) => call.phase === phase))])),
      providerOrHarnessUsage: trialUsage.length ? trialUsage : null, perCall };
  });
  if (matchedUsage.size !== supplied.length) throw new Error('Usage input contains unmatched trial/corpus identity');
  return { schemaVersion: 1, measuredAt: new Date().toISOString(), tokenizer: tokenizer?.metadata ?? null,
    method: 'Reference token counts encode captured UTF-8 stdout/stderr, recorder-delivered UTF-8 stdout/stderr, and JSON args separately, retaining repeats and failed or refused calls. Delivered counts describe recorder forwarding, not verified model context. They are payload sizes, not actual model messages, total agent usage, caching, reasoning or billable usage. Elapsed time sums child calls, not task wall time. Missing usage remains null; supplied phase and trial totals cannot overlap. Setup and memory-build costs remain separate from retrieval.', trials };
}

function main() {
  const args = process.argv.slice(2); const options = {}; const files = [];
  while (args.length) {
    const arg = args.shift();
    if (!arg.startsWith('--')) { files.push(arg); continue; }
    if (!['--report', '--usage', '--tokenizer-module', '--encoding'].includes(arg) || !args.length) throw new Error(`Invalid option ${arg}`);
    options[arg] = args.shift();
  }
  if (!files.length) throw new Error('Usage: aggregate-history-eval.js [--report tmp/report.json] [--usage usage.json] [--tokenizer-module local/path] [--encoding o200k_base] <log.jsonl>...');
  const report = summarize(files, { tokenizer: loadTokenizer(options['--tokenizer-module'], options['--encoding']),
    usage: options['--usage'] ? JSON.parse(fs.readFileSync(options['--usage'], 'utf8')) : [] });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options['--report']) { const target = privateTarget(options['--report']); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text, { flag: 'wx' }); }
  process.stdout.write(text);
}
if (require.main === module) mainGuard(main);
module.exports = { loadTokenizer, normalizeUsage, summarize };
