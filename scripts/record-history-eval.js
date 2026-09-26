#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, sha256, identifier, privateTarget, readManifest, mainGuard } = require('./history-eval-common');

function parse(argv) {
  const trial = argv.shift();
  if (!identifier(trial)) throw new Error('Usage: record-history-eval.js <trial> [--condition <name> --corpus-manifest <file> --task <id> --model <name> --harness <name> --phase <name> --max-retrieval-calls N --max-output-bytes N --exec] -- <command args>');
  const options = { trial, condition: 'legacy', task: null, model: null, harness: null, phase: 'retrieval', exec: false };
  while (argv[0]?.startsWith('--') && argv[0] !== '--') {
    const key = argv.shift().slice(2);
    if (key === 'exec') { options.exec = true; continue; }
    if (!['condition', 'corpus-manifest', 'task', 'model', 'harness', 'phase', 'max-retrieval-calls', 'max-output-bytes'].includes(key) || !argv.length) throw new Error(`Invalid recorder option --${key}`);
    const value = argv.shift();
    if (key === 'max-retrieval-calls' || key === 'max-output-bytes') {
      const number = Number(value);
      const minimum = key === 'max-output-bytes' ? 256 : 1;
      const maximum = key === 'max-output-bytes' ? 32 * 1024 * 1024 : 1000000;
      if (!/^\d+$/u.test(value) || !Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`Invalid --${key}: expected integer ${minimum}..${maximum}`);
      options[key] = number;
    } else options[key] = value;
  }
  if (argv[0] === '--') argv.shift();
  if (!argv.length || !identifier(options.condition) || !['retrieval', 'memory-build', 'setup'].includes(options.phase)) throw new Error('Invalid condition, phase, or missing command');
  return { options, args: argv };
}

function record(options, args) {
  const identity = { trial: options.trial, condition: options.condition, task: options.task, model: options.model,
    harness: options.harness, corpus: readManifest(options['corpus-manifest']) };
  if (options['max-retrieval-calls'] !== undefined || options['max-output-bytes'] !== undefined) {
    identity.budgets = { maxRetrievalCalls: options['max-retrieval-calls'] ?? null, maxOutputBytes: options['max-output-bytes'] ?? null };
  }
  const directory = privateTarget(path.join(ROOT, 'tmp/history-eval-results', options.condition));
  fs.mkdirSync(directory, { recursive: true });
  const file = privateTarget(path.join(directory, `${options.trial}.jsonl`));
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Trial log must not be a symlink');
  const lock = `${file}.lock`;
  const fd = fs.openSync(lock, 'wx');
  try {
    let previous = [];
    if (fs.existsSync(file)) {
      previous = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
      if (previous.some((row) => JSON.stringify(row.identity) !== JSON.stringify(identity))) throw new Error('Trial identity changed; choose a fresh trial ID');
    }
    const command = options.exec ? args[0] : process.execPath;
    const commandArgs = options.exec ? args.slice(1) : [path.join(ROOT, 'server.js'), 'history', ...args];
    const startedAt = new Date().toISOString();
    if (options.phase === 'retrieval' && options['max-retrieval-calls'] !== undefined
      && previous.filter((row) => (row.phase || 'retrieval') === 'retrieval' && row.executed !== false).length >= options['max-retrieval-calls']) {
      const message = `Retrieval call budget exceeded (${options['max-retrieval-calls']})`;
      const empty = Buffer.alloc(0);
      const diagnostic = Buffer.from(`Recorder: ${message}\n`);
      const row = { schemaVersion: 2, identity, phase: options.phase, at: startedAt, elapsedMs: 0,
        command, args: commandArgs, cwd: process.cwd(), executed: false, exitCode: null, signal: null,
        outputBytes: 0, stderrBytes: 0, stdoutSha256: sha256(empty), stderrSha256: sha256(empty),
        stdout: '', stderr: '', stdoutBase64: '', stderrBase64: '', captureComplete: true,
        deliveredStdout: '', deliveredStderr: diagnostic.toString('utf8'), deliveredStdoutBase64: '', deliveredStderrBase64: diagnostic.toString('base64'),
        deliveredStdoutBytes: 0, deliveredStderrBytes: diagnostic.length, deliveredStdoutSha256: sha256(empty), deliveredStderrSha256: sha256(diagnostic),
        outputTruncated: false, error: { code: 'RETRIEVAL_BUDGET_EXCEEDED', message } };
      fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
      process.stderr.write(diagnostic);
      process.exitCode = 1;
      return row;
    }
    const start = performance.now();
    const result = spawnSync(command, commandArgs, { maxBuffer: 32 * 1024 * 1024, timeout: 125000, windowsHide: true, shell: false });
    const elapsedMs = performance.now() - start;
    const stdout = result.stdout || Buffer.alloc(0);
    const stderr = result.stderr || Buffer.alloc(0);
    const limit = options['max-output-bytes'] ?? Infinity;
    const diagnostic = result.error ? Buffer.from(`Recorder: ${result.error.message}\n`) : Buffer.alloc(0);
    const truncated = stdout.length + stderr.length + diagnostic.length > limit;
    const notice = truncated ? Buffer.from('\nRecorder: OUTPUT_TRUNCATED; captured output exceeds delivery budget.\n') : Buffer.alloc(0);
    const available = limit - notice.length;
    const deliveredStdout = utf8Prefix(stdout, available);
    const childStderr = utf8Prefix(stderr, available - deliveredStdout.length);
    const deliveredStderr = Buffer.concat([childStderr, utf8Prefix(diagnostic, available - deliveredStdout.length - childStderr.length), notice]);
    const row = { schemaVersion: 2, identity, phase: options.phase, at: startedAt, elapsedMs,
      command, args: commandArgs, cwd: process.cwd(), executed: true, exitCode: result.status, signal: result.signal,
      outputBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr),
      stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'),
      stdoutBase64: stdout.toString('base64'), stderrBase64: stderr.toString('base64'),
      deliveredStdout: deliveredStdout.toString('utf8'), deliveredStderr: deliveredStderr.toString('utf8'),
      deliveredStdoutBase64: deliveredStdout.toString('base64'), deliveredStderrBase64: deliveredStderr.toString('base64'),
      deliveredStdoutBytes: deliveredStdout.length, deliveredStderrBytes: deliveredStderr.length,
      deliveredStdoutSha256: sha256(deliveredStdout), deliveredStderrSha256: sha256(deliveredStderr),
      outputTruncated: truncated,
      captureComplete: !result.error, error: result.error ? { code: result.error.code || null, message: result.error.message } : null };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    process.stdout.write(deliveredStdout);
    process.stderr.write(deliveredStderr);
    process.exitCode = result.status ?? 1;
    return row;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

// Keep valid UTF-8 code points whole while preserving captured bytes verbatim.
function utf8Prefix(bytes, maximum) {
  let end = Math.min(bytes.length, Math.max(0, maximum));
  if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end);
}

if (require.main === module) mainGuard(() => { const { options, args } = parse(process.argv.slice(2)); record(options, args); });
module.exports = { parse, record };
