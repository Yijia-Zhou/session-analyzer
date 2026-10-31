'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { run } = require('node:test');
const { inspect } = require('node:util');
const browserTestGroups = require('./browser-test-groups.json');

const usage = `Usage: node scripts/browser-test-profile.js [options] [test files...]
  --concurrency=N  Native Node file concurrency (default: 2)
  --shard=N/M      Native file shard, 1-based (default: all files)
  --group=NAME     Thematic CI group; cannot combine with --shard or test files
  --output=PATH    JSON report (default: work/browser-profile.json)
  --timeout=MS     Native runner timeout (default: no added timeout)
  --help          Show this help
With no files, discover all e2e/*.test.js files relative to the current directory.
Run all of them unless --group or --shard selects a subset.
Build browser assets and install Chromium before running browser tests.
Set BROWSER_TEST_PHASES=1 to collect optional common-helper phase diagnostics.
`;

function parseArgs(argv, cwd = process.cwd()) {
  const options = { concurrency: 2, output: path.resolve(cwd, 'work/browser-profile.json'), files: [], timeout: undefined };
  for (const arg of argv) {
    if (arg === '--help') return { help: true };
    if (arg.startsWith('--concurrency=')) {
      options.concurrency = positiveInteger(arg.slice('--concurrency='.length), '--concurrency');
    } else if (arg.startsWith('--shard=')) {
      const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(arg.slice('--shard='.length));
      if (!match) throw new Error('--shard needs N/M with positive integers and 1 <= N <= M');
      const index = positiveInteger(match[1], '--shard index');
      const total = positiveInteger(match[2], '--shard total');
      if (index > total) throw new Error('--shard index must not exceed total');
      options.shard = { index, total };
    } else if (arg.startsWith('--timeout=')) {
      options.timeout = positiveInteger(arg.slice('--timeout='.length), '--timeout');
    } else if (arg.startsWith('--group=')) {
      options.group = arg.slice('--group='.length);
      if (!options.group) throw new Error('--group needs a name');
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length);
      if (!value) throw new Error('--output needs a path');
      options.output = path.resolve(cwd, value);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.files.push(path.resolve(cwd, arg));
    }
  }
  if (options.group && (options.shard || options.files.length > 0)) {
    throw new Error('--group cannot be combined with --shard or explicit test files');
  }
  if (options.files.length === 0) {
    options.files = fs.readdirSync(path.join(cwd, 'e2e'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
      .map((entry) => path.join(cwd, 'e2e', entry.name)).sort();
  }
  options.files = [...new Set(options.files)];
  if (options.files.length === 0) throw new Error('No test files found');
  options.inputFileCount = options.files.length;
  if (options.shard) {
    options.files.sort();
    if (options.shard.total > options.files.length) throw new Error('--shard total must not exceed the test file count');
  }
  for (const file of options.files) {
    if (!fs.statSync(file).isFile()) throw new Error(`Not a test file: ${file}`);
    if (file === options.output) throw new Error('The report cannot overwrite a test file');
  }
  if (options.group) options.files = selectGroup(options.group, options.files);
  return options;
}

function selectGroup(group, files, groups = browserTestGroups) {
  if (!Object.hasOwn(groups, group)) throw new Error(`Unknown browser test group: ${group}`);
  const discovered = new Set(files.map((file) => path.basename(file)));
  const owners = new Map();
  // Validate the entire partition on every group run. Adding, deleting or
  // moving a test file must never silently reduce CI coverage.
  for (const [name, members] of Object.entries(groups)) {
    if (!Array.isArray(members) || members.length === 0) throw new Error(`Empty or invalid browser test group: ${name}`);
    for (const member of members) {
      if (!discovered.has(member)) throw new Error(`Unknown browser test file in group ${name}: ${member}`);
      if (owners.has(member)) throw new Error(`Duplicate browser test file: ${member}`);
      owners.set(member, name);
    }
  }
  const unassigned = [...discovered].filter((file) => !owners.has(file));
  if (unassigned.length) throw new Error(`Unassigned browser test files: ${unassigned.join(', ')}`);
  return files.filter((file) => owners.get(path.basename(file)) === group).sort();
}

function positiveInteger(value, option) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${option} needs a positive integer`);
  }
  return Number(value);
}

function relativeFile(file, cwd) {
  return path.relative(cwd, file).split(path.sep).join('/');
}

function errorDetails(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    failureType: error.failureType,
    stack: error.stack,
    display: inspect(error, { depth: 5, colors: false, maxStringLength: 8000 }),
  };
}

function createProfile(options, cwd = process.cwd()) {
  // Match node:test's native round-robin selection so unassigned files are not
  // reported as missing. Keep the complete sorted list when invoking run().
  const expectedFiles = options.files.filter((_, index) => !options.shard
    || index % options.shard.total === options.shard.index - 1);
  const fileMap = new Map(expectedFiles.map((file) => [path.resolve(file), {
    file: relativeFile(file, cwd), processDurationMs: null, suiteDurationMs: null,
    topLevelTestDurationMs: 0, counts: null, success: null,
  }]));
  const tests = [];
  const phaseMeasurements = [];
  let summary = null;

  function isFileWrapper(data) {
    return data.file && data.name === data.file && data.line === 1 && data.column === 1
      && fileMap.has(path.resolve(data.file));
  }

  function collect({ type, data }) {
    const file = data.file && fileMap.get(path.resolve(data.file));
    if (type === 'test:complete' && isFileWrapper(data)) {
      file.processDurationMs = data.details.duration_ms;
      file.success = data.details.passed;
      file.error = errorDetails(data.details.error);
    } else if (type === 'test:summary') {
      if (file) {
        file.suiteDurationMs = data.duration_ms;
        file.counts = data.counts;
        file.success = data.success;
      } else if (!data.file) {
        summary = { success: data.success, counts: data.counts, durationMs: data.duration_ms };
      }
    } else if ((type === 'test:pass' || type === 'test:fail') && !isFileWrapper(data)) {
      const result = {
        name: data.name, file: data.file ? relativeFile(data.file, cwd) : null,
        line: data.line, column: data.column, nesting: data.nesting,
        type: data.details.type, durationMs: data.details.duration_ms,
        status: data.skip ? 'skipped' : data.todo ? 'todo' : type === 'test:pass' ? 'passed' : 'failed',
        error: errorDetails(data.details.error),
      };
      tests.push(result);
      if (file && data.nesting === 0) file.topLevelTestDurationMs += result.durationMs;
    } else if (type === 'test:diagnostic') {
      const phase = parsePhaseDiagnostic(data.message);
      if (phase) phaseMeasurements.push({ file: data.file ? relativeFile(data.file, cwd) : null, ...phase });
    }
  }

  function finish({ wallTimeMs, startedAt, interrupted = null, runnerError = null }) {
    const files = [...fileMap.values()];
    // An empty process or a broken child event channel must not become a useful
    // browser baseline merely because Node reports the file itself as passing.
    const incompleteFiles = files.filter((file) => !file.counts || file.counts.tests === 0).map((file) => file.file);
    return {
      schemaVersion: 1, startedAt, nodeVersion: process.version, platform: process.platform,
      architecture: process.arch, availableParallelism: os.availableParallelism(),
      concurrency: options.concurrency, timeoutMs: options.timeout ?? null,
      shard: options.shard ?? null, group: options.group ?? null,
      inputFileCount: options.inputFileCount ?? options.files.length,
      wallTimeMs, success: Boolean(summary?.success) && !interrupted && !runnerError && incompleteFiles.length === 0,
      interrupted, runnerError: errorDetails(runnerError), incompleteFiles, summary,
      measurement: {
        processDurationMs: 'Native file-wrapper elapsed time, including worker startup and teardown; concurrent files overlap.',
        suiteDurationMs: 'Native child test-suite elapsed time; excludes worker startup.',
        topLevelTestDurationMs: 'Sum of top-level test/suite durations; nested tests are not counted twice. Not file wall time.',
        wallTimeMs: 'Elapsed time in this profiling process from starting the native runner through consuming all events.',
        memory: 'Not measured. Use a separate process-tree sampler; parent RSS excludes Chromium workers.',
      },
      files: files.sort((a, b) => (b.processDurationMs ?? 0) - (a.processDurationMs ?? 0)),
      tests,
      phases: summarizePhases(phaseMeasurements),
      slowestTests: tests.filter((test) => test.type !== 'suite' && test.status !== 'skipped')
        .sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
    };
  }

  return { collect, finish, isFileWrapper };
}

function parsePhaseDiagnostic(message) {
  try {
    const value = JSON.parse(message);
    if (value?.browserProfilePhase === 1 && typeof value.testName === 'string' && value.testName
      && typeof value.phase === 'string' && value.phase
      && typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0) {
      return { testName: value.testName, phase: value.phase, durationMs: value.durationMs };
    }
  } catch { /* Ordinary native test diagnostics are not JSON phase records. */ }
  return null;
}

function summarizePhases(measurements) {
  const totals = new Map();
  const byTest = new Map();
  for (const row of measurements) {
    const total = totals.get(row.phase) || { phase: row.phase, observations: 0, durationMs: 0 };
    total.observations += 1;
    total.durationMs += row.durationMs;
    totals.set(row.phase, total);
    const key = JSON.stringify([row.file, row.testName]);
    const test = byTest.get(key) || { file: row.file, testName: row.testName, phases: {} };
    test.phases[row.phase] = (test.phases[row.phase] || 0) + row.durationMs;
    byTest.set(key, test);
  }
  return {
    requested: process.env.BROWSER_TEST_PHASES === '1',
    coverage: 'Opt-in common-helper operations only; other fixtures and helpers are uninstrumented. Nested phases may overlap. page-ready excludes subsequent test interactions. Phase totals are not elapsed time or a complete accounting.',
    totals: [...totals.values()].sort((a, b) => b.durationMs - a.durationMs),
    byTest: [...byTest.values()], measurements,
  };
}

function formatSummary(report) {
  const counts = report.summary?.counts;
  const lines = [
    '', `Browser profile: ${report.success ? 'PASS' : 'FAIL'}; concurrency=${report.concurrency}${report.group ? `; group=${report.group}` : ''}${report.shard ? `; shard=${report.shard.index}/${report.shard.total}` : ''}; wall=${(report.wallTimeMs / 1000).toFixed(2)}s`,
    counts ? `Tests: ${counts.tests}; passed=${counts.passed}; failed=${counts.failed}; skipped=${counts.skipped}; cancelled=${counts.cancelled}; todo=${counts.todo}` : 'No complete native summary received.',
    'Files (process elapsed / top-level test sum; concurrent files overlap):',
  ];
  for (const file of report.files) {
    lines.push(`  ${file.processDurationMs === null ? 'unknown' : (file.processDurationMs / 1000).toFixed(2) + 's'} / ${(file.topLevelTestDurationMs / 1000).toFixed(2)}s  ${file.file}`);
  }
  lines.push('Slowest 20 tests (nested tests may overlap their parents):');
  for (const test of report.slowestTests) {
    lines.push(`  ${(test.durationMs / 1000).toFixed(2)}s  ${test.file}:${test.line}  ${test.name} [${test.status}]`);
  }
  if (report.phases.totals.length) {
    lines.push('Common-helper phases (partial, possibly overlapping operation sums):');
    for (const phase of report.phases.totals) {
      lines.push(`  ${(phase.durationMs / 1000).toFixed(2)}s  ${phase.phase} (${phase.observations} observations)`);
    }
  }
  if (report.incompleteFiles.length) lines.push(`Missing or empty test summaries: ${report.incompleteFiles.join(', ')}`);
  if (report.interrupted) lines.push(`Interrupted by ${report.interrupted}`);
  return lines.join('\n') + '\n';
}

async function profileTests(options, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const cwd = process.cwd();
  const profile = createProfile(options, cwd);
  const controller = new AbortController();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let interrupted = null;
  let runnerError = null;
  const signals = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => {
    interrupted = signal;
    controller.abort(new Error(`Interrupted by ${signal}`));
  }]));
  for (const [signal, listener] of signals) process.once(signal, listener);
  try {
    const stream = run({ files: options.files, shard: options.shard, concurrency: options.concurrency, timeout: options.timeout, signal: controller.signal });
    for await (const event of stream) {
      profile.collect(event);
      const { type, data } = event;
      if (type === 'test:stdout') stdout.write(data.message);
      if (type === 'test:stderr') stderr.write(data.message);
      if (type === 'test:diagnostic' && !parsePhaseDiagnostic(data.message)) stdout.write(`# ${data.message}\n`);
      if ((type === 'test:pass' || type === 'test:fail') && !profile.isFileWrapper(data)) {
        const status = data.skip ? 'SKIP' : data.todo ? 'TODO' : type === 'test:pass' ? 'PASS' : 'FAIL';
        stdout.write(`${status} ${relativeFile(data.file || cwd, cwd)}:${data.line ?? '?'} ${data.name} (${data.details.duration_ms.toFixed(1)}ms)\n`);
      }
      if (type === 'test:fail') stderr.write(`${errorDetails(data.details.error)?.display || data.name}\n`);
    }
  } catch (error) {
    runnerError = error;
    stderr.write(`${error.stack || error}\n`);
  } finally {
    for (const [signal, listener] of signals) process.removeListener(signal, listener);
  }
  const report = profile.finish({ wallTimeMs: performance.now() - started, startedAt, interrupted, runnerError });
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  stdout.write(formatSummary(report));
  stdout.write(`JSON report: ${options.output}\n`);
  return report;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(usage);
      return 0;
    }
    const report = await profileTests(options);
    return report.interrupted === 'SIGINT' ? 130 : report.interrupted === 'SIGTERM' ? 143 : report.success ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { createProfile, formatSummary, parseArgs, profileTests, selectGroup };
