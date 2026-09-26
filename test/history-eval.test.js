'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, sha256, privateTarget } = require('../scripts/history-eval-common');
const { freeze } = require('../scripts/freeze-history-eval');
const { parse, record } = require('../scripts/record-history-eval');
const { summarize, normalizeUsage, loadTokenizer } = require('../scripts/aggregate-history-eval');

function temporary(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, 'tmp/history-eval-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function syntheticFile(directory, name = 'rollout-example.jsonl') {
  const file = path.join(directory, name);
  fs.writeFileSync(file, '{"type":"session_meta","payload":{"id":"synthetic","cwd":"/synthetic/project"}}\r\n{"type":"event_msg","payload":{"text":"中文 <|endoftext|>"}}\r\n');
  return file;
}
function recorder(trial, args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/record-history-eval.js'), trial, ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
}
function logFixture(directory, condition, trial, rows = [{}]) {
  const identity = { condition, trial, corpus: { corpusHash: 'a'.repeat(64) }, model: 'synthetic-model' };
  const file = path.join(directory, `${condition}-${trial}.jsonl`);
  fs.writeFileSync(file, rows.map((row) => JSON.stringify({ identity, phase: 'retrieval', args: ['read'], stdout: '中文', stderr: '', elapsedMs: 3, exitCode: 0, ...row })).join('\n') + '\n');
  return file;
}

test('recorder keeps exact failed calls and isolates conditions; identity mismatch never executes', (t) => {
  const directory = temporary(t);
  const trial = path.basename(directory);
  const conditionA = `${trial}-raw`;
  const conditionB = `${trial}-structured`;
  const logDirA = path.join(ROOT, 'tmp/history-eval-results', conditionA);
  const logDirB = path.join(ROOT, 'tmp/history-eval-results', conditionB);
  t.after(() => { fs.rmSync(logDirA, { recursive: true, force: true }); fs.rmSync(logDirB, { recursive: true, force: true }); });
  const manifest = path.join(directory, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ corpusHash: 'a'.repeat(64) }));
  const common = ['--corpus-manifest', manifest, '--task', 'T01', '--model', 'test-model', '--harness', 'node-test', '--exec', '--', process.execPath];
  const code = 'process.stdout.write(Buffer.from([0xff,0x00,0x0a])); process.stderr.write("failure 中文"); process.exitCode=7';
  const first = recorder(trial, ['--condition', conditionA, ...common, '-e', code]);
  assert.equal(first.status, 7);
  const file = path.join(logDirA, `${trial}.jsonl`);
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(row.identity.corpus.corpusHash, 'a'.repeat(64));
  assert.deepEqual(row.args, ['-e', code]);
  assert.equal(row.outputBytes, 3);
  assert.equal(row.stderrBytes, Buffer.byteLength('failure 中文'));
  assert.equal(row.stdoutBase64, Buffer.from([0xff, 0, 10]).toString('base64'));
  assert.equal(row.captureComplete, true);
  assert.ok(row.elapsedMs >= 0);
  const collision = recorder(trial, ['--condition', conditionA, '--task', 'T02', '--exec', '--', process.execPath, '-e', 'process.stdout.write("should not run")']);
  assert.equal(collision.status, 1); assert.match(collision.stderr, /identity changed/u); assert.equal(collision.stdout, '');
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
  assert.equal(recorder(trial, ['--condition', conditionB, ...common, '-e', 'process.stdout.write("ok")']).status, 0);
  const report = summarize([file, path.join(logDirB, `${trial}.jsonl`)]);
  assert.equal(report.trials.length, 2);
  assert.equal(report.trials[0].failedCalls, 1);
  assert.equal(report.trials[0].stdoutReferenceTokens, null);
  assert.equal(report.trials[0].providerOrHarnessUsage, null);
});

test('optional budgets preserve capture, bound delivery, and refuse retrieval before execution', (t) => {
  const directory = temporary(t);
  const trial = path.basename(directory);
  const condition = `${trial}-budget`;
  const logDir = path.join(ROOT, 'tmp/history-eval-results', condition);
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const marker = path.join(directory, 'unexpected-execution');
  const flags = ['--condition', condition, '--max-retrieval-calls', '1', '--max-output-bytes', '256', '--exec', '--', process.execPath, '-e'];
  const run = (phase, code) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record-history-eval.js'), trial,
    '--phase', phase, ...flags, code], { cwd: ROOT, windowsHide: true });
  assert.equal(run('setup', 'process.stdout.write("setup")').status, 0);
  const captured = Buffer.from('中'.repeat(100));
  const first = run('retrieval', 'process.stdout.write("中".repeat(100)); process.stderr.write("tail")');
  assert.equal(first.status, 0);
  assert.ok(first.stdout.length + first.stderr.length <= 256);
  assert.deepEqual(first.stdout, captured.subarray(0, first.stdout.length));
  assert.equal(first.stdout.length % 3, 0);
  assert.doesNotMatch(first.stdout.toString('utf8'), /\ufffd/u);
  assert.match(first.stderr.toString('utf8'), /OUTPUT_TRUNCATED/u);
  const refused = run('retrieval', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`);
  assert.equal(refused.status, 1);
  assert.equal(fs.existsSync(marker), false);
  const file = path.join(logDir, `${trial}.jsonl`);
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].outputBytes, captured.length);
  assert.equal(rows[1].stdoutBase64, captured.toString('base64'));
  assert.equal(rows[1].deliveredStdoutBase64, first.stdout.toString('base64'));
  assert.equal(rows[1].deliveredStdoutBytes, first.stdout.length);
  assert.equal(rows[1].deliveredStderrBytes, first.stderr.length);
  assert.equal(rows[1].outputTruncated, true);
  assert.equal(rows[2].executed, false);
  assert.equal(rows[2].error.code, 'RETRIEVAL_BUDGET_EXCEEDED');
  assert.deepEqual(refused.stderr, Buffer.from(rows[2].deliveredStderrBase64, 'base64'));
  const tokenizer = { metadata: { encoding: 'synthetic-codepoints' }, count: (text) => [...text].length };
  const report = summarize([file], { tokenizer }).trials[0];
  assert.equal(report.refusedCalls, 1);
  assert.equal(report.executedCalls, 2);
  assert.equal(report.truncatedCalls, 1);
  assert.equal(report.phases.retrieval.executedCalls, 1);
  assert.equal(report.perCall[1].stdoutReferenceTokens, 100);
  assert.equal(report.perCall[1].deliveredStdoutReferenceTokens, first.stdout.length / 3);
  assert.equal(report.perCall[1].deliveredStdoutBytes, first.stdout.length);
  assert.equal(report.perCall[1].stderrBytes, 4);
  assert.equal(report.perCall[1].deliveredStderrBytes, first.stderr.length);
  assert.equal(run('setup', 'process.stdout.write("later setup")').status, 0);
  const changed = recorder(trial, ['--condition', condition, '--max-retrieval-calls', '2', '--max-output-bytes', '256',
    '--exec', '--', process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`]);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /identity changed/u);
  assert.equal(fs.existsSync(marker), false);
});

test('capped recorder diagnostics are included in delivered stderr', (t) => {
  const directory = temporary(t);
  const trial = path.basename(directory);
  const condition = `${trial}-error`;
  const logDir = path.join(ROOT, 'tmp/history-eval-results', condition);
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/record-history-eval.js'), trial,
    '--condition', condition, '--max-output-bytes', '256', '--exec', '--', path.join(directory, 'missing-executable')],
  { cwd: ROOT, windowsHide: true });
  assert.equal(result.status, 1);
  const row = JSON.parse(fs.readFileSync(path.join(logDir, `${trial}.jsonl`), 'utf8'));
  assert.equal(row.executed, true);
  assert.ok(row.error);
  assert.deepEqual(result.stderr, Buffer.from(row.deliveredStderrBase64, 'base64'));
  assert.ok(result.stderr.length <= 256);
});

test('existing trial log symlinks are rejected before execution', (t) => {
  const directory = temporary(t);
  const trial = path.basename(directory);
  const condition = `${trial}-link`;
  const logDir = path.join(ROOT, 'tmp/history-eval-results', condition);
  fs.mkdirSync(logDir, { recursive: true });
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const file = path.join(logDir, `${trial}.jsonl`);
  fs.writeFileSync(file, 'untouched');
  const original = fs.lstatSync;
  // Windows file symlinks require privileges; simulate only the symlink fact.
  t.mock.method(fs, 'lstatSync', (target, ...args) => path.resolve(target) === file
    ? { isSymbolicLink: () => true } : original(target, ...args));
  const marker = path.join(directory, 'unexpected-execution');
  assert.throws(() => record({ trial, condition, exec: true, phase: 'retrieval' },
    [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`]), /must not be a symlink/u);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'untouched');
  fs.unlinkSync(file);
  // lstat still identifies a dangling symlink even though existsSync is false.
  assert.throws(() => record({ trial, condition, exec: true, phase: 'retrieval' },
    [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`]), /must not be a symlink/u);
  assert.equal(fs.existsSync(marker), false);
});

test('budget options reject invalid values and legacy identity stays unchanged', (t) => {
  for (const [key, value] of [['--max-retrieval-calls', '0'], ['--max-retrieval-calls', '1.5'],
    ['--max-output-bytes', '255'], ['--max-output-bytes', '33554433'], ['--max-output-bytes', '-1']]) {
    assert.throws(() => parse(['trial', key, value, '--', 'status']), /Invalid --max/u);
  }
  const directory = temporary(t);
  const trial = path.basename(directory);
  const condition = `${trial}-legacy`;
  const logDir = path.join(ROOT, 'tmp/history-eval-results', condition);
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const result = recorder(trial, ['--condition', condition, '--exec', '--', process.execPath, '-e', 'process.stdout.write("ok")']);
  assert.equal(result.status, 0);
  const row = JSON.parse(fs.readFileSync(path.join(logDir, `${trial}.jsonl`), 'utf8'));
  assert.equal(Object.hasOwn(row.identity, 'budgets'), false);
  assert.equal(result.stdout, 'ok');
  assert.equal(summarize([path.join(logDir, `${trial}.jsonl`)]).trials[0].deliveredStdoutBytes, 2);
});

test('aggregation preserves repeated payload, separate phases and incomplete captures', (t) => {
  const directory = temporary(t);
  const file = logFixture(directory, 'hybrid', 'trial', [
    { phase: 'memory-build', stdout: '中文' }, { stdout: '中文' }, { stdout: '中文', exitCode: null, error: { code: 'ETIMEDOUT' }, captureComplete: false },
  ]);
  const tokenizer = { metadata: { encoding: 'synthetic-codepoints' }, count: (text) => [...text].length };
  const report = summarize([file], { tokenizer });
  const trial = report.trials[0];
  assert.equal(trial.stdoutReferenceTokens, 6);
  assert.equal(trial.stdoutBytes, 18);
  assert.equal(trial.phases['memory-build'].stdoutReferenceTokens, 2);
  assert.equal(trial.phases.retrieval.stdoutReferenceTokens, 4);
  assert.equal(trial.failedCalls, 1); assert.equal(trial.incompleteCaptures, 1);
  assert.throws(() => summarize([file, file]), /Duplicate trial/u);
});

test('provider usage stays supplied, incomplete and nonoverlapping', (t) => {
  const directory = temporary(t);
  const file = logFixture(directory, 'summary', 'one');
  const entry = { condition: 'summary', trial: 'one', corpusHash: 'a'.repeat(64), source: 'harness', scope: 'trial-total', inputTokens: 50, provenance: 'synthetic usage export' };
  const [usage] = summarize([file], { usage: [entry] }).trials[0].providerOrHarnessUsage;
  assert.equal(usage.inputTokens, 50); assert.equal(usage.outputTokens, null); assert.equal(usage.totalTokens, null); assert.equal(usage.costUsd, null);
  assert.throws(() => normalizeUsage([entry, entry]), /Overlapping/u);
  assert.throws(() => normalizeUsage([entry, { ...entry, scope: 'phase', phase: 'retrieval' }]), /Overlapping/u);
  assert.throws(() => normalizeUsage([{ ...entry, inputTokens: -1 }]), /Invalid usage/u);
  assert.throws(() => summarize([file], { usage: [{ ...entry, corpusHash: 'b'.repeat(64) }] }), /unmatched/u);
  const phases = normalizeUsage([{ ...entry, scope: 'phase', phase: 'memory-build' }, { ...entry, scope: 'phase', phase: 'retrieval' }]);
  assert.equal(phases.length, 2);
});

test('optional local tokenizer has identified encoding; no tokenizer leaves null', (t) => {
  const directory = temporary(t);
  const modulePath = path.join(directory, 'synthetic-tokenizer.cjs');
  fs.writeFileSync(modulePath, 'exports.getEncoding = name => ({encode: (text, allowed, disallowed) => {if(allowed.length || disallowed.length) throw Error("special tokens not literal"); return [...text]}});');
  const tokenizer = loadTokenizer(modulePath, 'synthetic');
  assert.equal(tokenizer.count('中文'), 2);
  assert.equal(tokenizer.metadata.encoding, 'synthetic');
  assert.equal(tokenizer.metadata.moduleSha256, sha256(fs.readFileSync(modulePath)));
  assert.equal(loadTokenizer(null), null);
});

test('freeze preserves raw bytes/cwd, hashes explicit files only, and refuses existing destinations', (t) => {
  const directory = temporary(t);
  const source = syntheticFile(directory);
  fs.writeFileSync(path.join(directory, 'trial-results.jsonl'), '{"stdout":"do not index"}\n');
  const target = path.join(directory, 'frozen');
  const manifest = freeze({ target, inputs: [source], repo: '/synthetic/project' });
  assert.equal(manifest.fileCount, 1);
  assert.equal(manifest.files[0].originalCwd, '/synthetic/project');
  assert.deepEqual(manifest.transformations, []);
  assert.equal(manifest.temporalCutoff, null);
  assert.deepEqual(fs.readFileSync(path.join(manifest.codexHome, manifest.files[0].relativePath)), fs.readFileSync(source));
  assert.equal(manifest.files[0].sha256, sha256(fs.readFileSync(source)));
  const second = freeze({ target: path.join(directory, 'second'), inputs: [source] });
  assert.equal(manifest.corpusHash, second.corpusHash);
  assert.throws(() => freeze({ target, inputs: [source] }), /already exists/u);
  assert.throws(() => freeze({ target: path.join(directory, 'bad'), inputs: [path.join(directory, 'trial-results.jsonl')] }), /not a Codex session/u);
  assert.equal(fs.existsSync(path.join(directory, 'bad')), false);
});

test('freeze rejects unsafe destinations, directories, duplicate basenames, and known trial output roots', (t) => {
  const directory = temporary(t);
  const source = syntheticFile(directory);
  assert.throws(() => privateTarget(path.join(ROOT, 'test/private-data')), /below this checkout tmp/u);
  assert.throws(() => privateTarget(path.join(ROOT, 'tmp/../private-data')), /below this checkout tmp/u);
  assert.throws(() => freeze({ target: path.join(directory, 'folder'), inputs: [directory] }), /explicit file/u);
  assert.throws(() => freeze({ target: path.join(directory, 'duplicates'), inputs: [source, source] }), /Duplicate input/u);
  const results = path.join(ROOT, 'tmp/history-eval-results', path.basename(directory));
  fs.mkdirSync(results, { recursive: true });
  t.after(() => fs.rmSync(results, { recursive: true, force: true }));
  const disguisedTrial = syntheticFile(results);
  assert.throws(() => freeze({ target: path.join(directory, 'trial'), inputs: [disguisedTrial] }), /Trial results/u);
});

test('legacy recorder command syntax remains accepted without invented metadata', () => {
  const parsed = parse(['pilot-a', 'search', '--query', 'test']);
  assert.equal(parsed.options.condition, 'legacy');
  assert.equal(parsed.options.model, null);
  assert.deepEqual(parsed.args, ['search', '--query', 'test']);
});

test('aggregation CLI writes new private reports and refuses corrupt captures', (t) => {
  const directory = temporary(t);
  const file = logFixture(directory, 'raw', 'report');
  const target = path.join(directory, 'report.json');
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts/aggregate-history-eval.js'), '--report', target, file], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).trials[0].stdoutReferenceTokens, null);
  assert.equal(run().status, 1);
  const corrupt = logFixture(directory, 'raw', 'corrupt', [{ stdout: 'a', stdoutBase64: Buffer.from('b').toString('base64'), stdoutSha256: sha256('b'), outputBytes: 1 }]);
  assert.throws(() => summarize([corrupt]), /Corrupt stdout/u);
});
