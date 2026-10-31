'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createProfile, formatSummary, parseArgs } = require('../scripts/browser-test-profile');

const script = path.resolve(__dirname, '../scripts/browser-test-profile.js');

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'e2e'));
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(root, 'e2e', name), content);
  return root;
}

function invoke(root, args = []) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [script, '--output=work/result.json', ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 15000,
  });
}

test('browser profile discovers only test files in the selected checkout and validates options', async (t) => {
  const root = await fixture(t, { 'b.test.js': '', 'a.test.js': '', 'helper.js': '' });
  const options = parseArgs(['--concurrency=4', '--output=work/run.json', '--timeout=500'], root);
  assert.deepEqual(options.files.map((file) => path.basename(file)), ['a.test.js', 'b.test.js']);
  assert.equal(options.concurrency, 4);
  assert.equal(options.timeout, 500);
  assert.equal(options.output, path.join(root, 'work/run.json'));
  const selected = parseArgs(['e2e/b.test.js', 'e2e/b.test.js'], root);
  assert.deepEqual(selected.files, [path.join(root, 'e2e/b.test.js')]);
  for (const value of ['0', '-1', '1.5', 'Infinity', '2junk', '9007199254740992']) {
    assert.throws(() => parseArgs([`--concurrency=${value}`], root), /positive integer/);
  }
  assert.throws(() => parseArgs(['--unknown'], root), /Unknown option/);
  assert.throws(() => parseArgs(['--output='], root), /needs a path/);
  assert.throws(() => parseArgs(['--output=e2e/a.test.js'], root), /overwrite a test file/);
  const shard = parseArgs(['--shard=2/2', 'e2e/b.test.js', 'e2e/a.test.js'], root);
  assert.deepEqual(shard.shard, { index: 2, total: 2 });
  assert.deepEqual(shard.files.map((file) => path.basename(file)), ['a.test.js', 'b.test.js']);
  for (const value of ['0/2', '1/0', '3/2', '1', '1/2/3', '1.5/2', '1/9007199254740992', '1/3']) {
    assert.throws(() => parseArgs([`--shard=${value}`], root), /--shard/);
  }
});

test('native shards cover every discovered file exactly once and retain failures', async (t) => {
  const root = await fixture(t, Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((name) => [
    `${name}.test.js`, `const test = require('node:test'); test('${name}', () => { ${name === 'b' ? "throw new Error('sharded failure');" : ''} });`,
  ])));
  const reports = [];
  for (const index of [1, 2]) {
    const child = invoke(root, [`--shard=${index}/2`]);
    assert.equal(child.error, undefined);
    assert.equal(child.status, index === 1 ? 0 : 1, child.stdout + child.stderr);
    const report = JSON.parse(await fs.readFile(path.join(root, 'work/result.json'), 'utf8'));
    assert.deepEqual(report.shard, { index, total: 2 });
    assert.equal(report.inputFileCount, 5);
    assert.deepEqual(report.incompleteFiles, []);
    assert.equal(report.success, index === 1);
    assert.match(child.stdout, new RegExp(`shard=${index}/2`));
    const expected = index === 1 ? ['a', 'c', 'e'] : ['b', 'd'];
    assert.deepEqual(report.files.map((file) => file.file).sort(), expected.map((name) => `e2e/${name}.test.js`));
    assert.deepEqual(report.tests.map((result) => result.name).sort(), expected);
    reports.push(report);
  }
  const names = reports.flatMap((report) => report.tests.map((result) => result.name));
  assert.equal(new Set(names).size, 5);
  assert.equal(names.length, 5);
});

test('browser profile separates native file elapsed time from nested test duration sums', () => {
  const cwd = path.resolve('synthetic-profile');
  const file = path.join(cwd, 'e2e/example.test.js');
  const profile = createProfile({ files: [file], concurrency: 2 }, cwd);
  const result = (name, nesting, duration, extra = {}) => ({
    type: 'test:pass', data: { file, name, line: 8, column: 1, nesting, details: { duration_ms: duration, type: 'test' }, ...extra },
  });
  profile.collect(result('nested', 1, 20));
  profile.collect(result('parent', 0, 50));
  profile.collect(result('skip', 0, 1, { skip: true }));
  profile.collect({ type: 'test:complete', data: { file, name: file, line: 1, column: 1, details: { duration_ms: 90, passed: true } } });
  profile.collect({ type: 'test:summary', data: { file, success: true, duration_ms: 70, counts: { tests: 3, passed: 2, failed: 0, skipped: 1 } } });
  profile.collect({ type: 'test:summary', data: { success: true, duration_ms: 100, counts: { tests: 3, passed: 2, failed: 0, skipped: 1 } } });
  const report = profile.finish({ wallTimeMs: 101, startedAt: 'synthetic' });
  assert.equal(report.success, true);
  assert.equal(report.files[0].topLevelTestDurationMs, 51);
  assert.equal(report.files[0].processDurationMs, 90);
  assert.equal(report.files[0].suiteDurationMs, 70);
  assert.equal(report.tests.length, 3);
  assert.deepEqual(report.slowestTests.map((row) => row.name), ['parent', 'nested']);
  assert.match(formatSummary(report), /concurrent files overlap/);
});

test('browser profile does not accept a successful empty file as a measured suite', async (t) => {
  const root = await fixture(t, { 'empty.test.js': '"use strict";\n' });
  const child = invoke(root);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  const report = JSON.parse(await fs.readFile(path.join(root, 'work/result.json'), 'utf8'));
  assert.equal(report.success, false);
  assert.deepEqual(report.incompleteFiles, ['e2e/empty.test.js']);
});

test('browser profile preserves actual nested results and complete per-file timing', async (t) => {
  const root = await fixture(t, {
    'a.test.js': `const test = require('node:test');
test('parent', async t => { await t.test('nested', () => {}); });
test('skip', { skip: true }, () => {});
test('todo', { todo: true }, () => {});
`,
    'b.test.js': `const test = require('node:test');
test('other file', () => {});
`,
  });
  const child = invoke(root, ['--concurrency=2']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const report = JSON.parse(await fs.readFile(path.join(root, 'work/result.json'), 'utf8'));
  assert.equal(report.success, true);
  assert.equal(report.concurrency, 2);
  assert.equal(report.summary.counts.tests, 5);
  assert.equal(report.summary.counts.skipped, 1);
  assert.equal(report.summary.counts.todo, 1);
  assert.equal(report.tests.length, 5);
  assert.equal(report.files.length, 2);
  for (const file of report.files) {
    assert.ok(file.processDurationMs > 0);
    assert.ok(file.suiteDurationMs > 0);
    assert.ok(file.topLevelTestDurationMs >= 0);
    assert.equal(file.success, true);
  }
  assert.ok(report.wallTimeMs > 0);
  assert.match(child.stdout, /Slowest 20 tests/);
});

test('browser profile writes reports and fails for assertions, timeouts and child crashes', async (t) => {
  const root = await fixture(t, {
    'failure.test.js': `const test = require('node:test');
test('assertion failure', () => { throw new Error('synthetic assertion evidence'); });
test('timeout failure', { timeout: 20 }, async () => { await new Promise(r => setTimeout(r, 100)); });
`,
    'crash.test.js': `throw new Error('synthetic module crash');\n`,
  });
  const child = invoke(root, ['--concurrency=1']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  const report = JSON.parse(await fs.readFile(path.join(root, 'work/result.json'), 'utf8'));
  assert.equal(report.success, false);
  assert.ok(report.summary.counts.failed >= 1);
  assert.ok(report.summary.counts.cancelled >= 1);
  const assertion = report.tests.find((row) => row.name === 'assertion failure');
  assert.equal(assertion.status, 'failed');
  assert.match(assertion.error.display, /synthetic assertion evidence/);
  const timeout = report.tests.find((row) => row.name === 'timeout failure');
  assert.equal(timeout.status, 'failed');
  assert.equal(timeout.error.failureType, 'testTimeoutFailure');
  assert.match(child.stderr, /synthetic module crash/);
  assert.deepEqual(report.incompleteFiles, ['e2e/crash.test.js']);
  const crash = report.files.find((file) => file.file === 'e2e/crash.test.js');
  assert.ok(crash.error);
});

test('browser profile aggregates optional phase diagnostics and retains ordinary diagnostics', async (t) => {
  const root = await fixture(t, {
    'phases.test.js': `const test = require('node:test');
test('profile phases', t => {
  t.diagnostic('synthetic ordinary diagnostic');
  for (const durationMs of [3, 7]) t.diagnostic(JSON.stringify({browserProfilePhase: 1, testName: t.name, phase: 'browser-launch', durationMs}));
  t.diagnostic(JSON.stringify({browserProfilePhase: 1, testName: t.name, phase: 'browser-launch', durationMs: 'invalid'}));
});
`,
  });
  const child = invoke(root);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const report = JSON.parse(await fs.readFile(path.join(root, 'work/result.json'), 'utf8'));
  assert.equal(report.phases.measurements.length, 2);
  assert.deepEqual(report.phases.totals, [{ phase: 'browser-launch', observations: 2, durationMs: 10 }]);
  assert.equal(report.phases.byTest[0].testName, 'profile phases');
  assert.deepEqual(report.phases.byTest[0].phases, { 'browser-launch': 10 });
  assert.match(report.phases.coverage, /not elapsed time or a complete accounting/);
  assert.match(child.stdout, /synthetic ordinary diagnostic/);
  assert.match(child.stdout, /invalid/);
});

test('browser profile preserves an interrupted report and returns a failing signal exit code', { skip: process.platform === 'win32', timeout: 10000 }, async (t) => {
  const root = await fixture(t, {
    'interrupted.test.js': `const test = require('node:test');
test('interrupted browser', async () => {
  console.log('synthetic signal ready');
  await new Promise(resolve => setTimeout(resolve, 60000));
});
`,
  });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script, '--output=work/interrupted.json'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '';
  let sentSignal = false;
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (!sentSignal && output.includes('synthetic signal ready')) {
      sentSignal = true;
      child.kill('SIGTERM');
    }
  });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(sentSignal, true, output);
  assert.deepEqual(status, { code: 143, signal: null }, output);
  const report = JSON.parse(await fs.readFile(path.join(root, 'work/interrupted.json'), 'utf8'));
  assert.equal(report.success, false);
  assert.equal(report.interrupted, 'SIGTERM');
});
