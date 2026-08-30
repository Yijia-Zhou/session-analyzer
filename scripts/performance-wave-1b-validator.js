#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  timingStats,
  validateTimelineArtifact,
  writeJsonAtomic,
} = require('./performance-wave-0-runner');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCENARIO_NAMES = Object.freeze([
  'warmSearchPreload',
  'warmJumpToLateHit',
  'warmDeepStructuredFilter',
  'warmContextReveal',
  'coldSessionSwitchDuringQuery',
]);
const OVERLAY_CHECKS = Object.freeze([
  ['scenarios.warmSearchPreload.work.fullRenders', 2],
  ['scenarios.warmSearchPreload.work.cardGenerations', 750],
  ['scenarios.warmDeepStructuredFilter.work.fullRenders', 1],
  ['scenarios.warmDeepStructuredFilter.work.cardGenerations', 150],
  ['scenarios.warmContextReveal.work.fullRenders', 0],
  ['scenarios.warmContextReveal.work.cardGenerations', 0],
  ['scenarios.warmContextReveal.work.highlightPasses', 0],
  ['scenarios.warmContextReveal.work.highlightMarksCreated', 0],
  ['scenarios.warmContextReveal.work.highlightedOwnerCount', 0],
  ['scenarios.warmContextReveal.work.targetDiscoveryPasses', 0],
]);
const ENVIRONMENT_IDENTITY_FIELDS = Object.freeze([
  'node', 'v8', 'npm', 'playwright', 'chromium', 'execArgv', 'exposedGc', 'heapLimitBytes',
  'platform', 'osRelease', 'architecture', 'cpu', 'cpuCount', 'totalMemoryBytes', 'ci',
  'headless', 'locale', 'timezone', 'viewport', 'runtimeAssetSha256',
]);
const IDENTITY_FIELDS = Object.freeze([
  'repository', 'targetBranch', 'currentBranch', 'inspectedBaseSha', 'preWave0Head', 'head',
  'candidateCommitSha', 'targetSyncSha', 'targetToCandidateDiffAlgorithm',
  'targetToCandidateDiffSha256', 'dirty', 'profiledTrackedDiffSha256AtRun',
  'profiledImplementationTreeHash',
]);
const FIXTURE_FIELDS = Object.freeze([
  'parameters', 'roles', 'proofVersion', 'generatorSha256', 'semanticFixtureProof',
]);

function usageError(message) {
  const error = new Error(message);
  error.code = 'INVALID_WAVE_1B_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = {
    smokeOnly: false,
    outputDir: '',
    candidateSha: '',
    targetSyncSha: '',
    smoke: '',
    smokeValidation: '',
    runs: [],
  };
  const seen = new Set();
  const valueOptions = new Set([
    '--output-dir', '--candidate-sha', '--target-sync-sha', '--smoke', '--smoke-validation',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--smoke-only') {
      if (seen.has(name)) throw usageError(`Duplicate option: ${name}`);
      seen.add(name);
      options.smokeOnly = true;
      continue;
    }
    if (name === '--run') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw usageError('Missing value for --run');
      options.runs.push(value);
      index += 1;
      continue;
    }
    if (!valueOptions.has(name)) throw usageError(`Unknown option: ${name}`);
    if (seen.has(name)) throw usageError(`Duplicate option: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    seen.add(name);
    index += 1;
    if (name === '--output-dir') options.outputDir = value;
    else if (name === '--candidate-sha') options.candidateSha = value;
    else if (name === '--target-sync-sha') options.targetSyncSha = value;
    else if (name === '--smoke') options.smoke = value;
    else if (name === '--smoke-validation') options.smokeValidation = value;
  }
  for (const [name, value] of [
    ['--output-dir', options.outputDir],
    ['--candidate-sha', options.candidateSha],
    ['--target-sync-sha', options.targetSyncSha],
    ['--smoke', options.smoke],
  ]) {
    if (!value) throw usageError(`Missing required option: ${name}`);
  }
  if (!/^[0-9a-f]{40}$/.test(options.candidateSha)) {
    throw usageError('--candidate-sha must be a full lowercase commit SHA');
  }
  if (!/^[0-9a-f]{40}$/.test(options.targetSyncSha)) {
    throw usageError('--target-sync-sha must be a full lowercase commit SHA');
  }
  if (options.smokeOnly) {
    if (options.runs.length !== 0 || seen.has('--smoke-validation')) {
      throw usageError('--smoke-only requires zero --run and zero --smoke-validation arguments');
    }
  } else if (options.runs.length !== 3 || !seen.has('--smoke-validation')) {
    throw usageError('formal mode requires one --smoke-validation and exactly three --run arguments');
  }
  return options;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function pathInsideOrSame(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const leftAbsolute = path.resolve(left);
  const rightAbsolute = path.resolve(right);
  return process.platform === 'win32'
    ? leftAbsolute.toLowerCase() === rightAbsolute.toLowerCase()
    : leftAbsolute === rightAbsolute;
}

async function assertNoSymbolicLinkComponents(candidate, label) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  const parts = path.relative(parsed.root, absolute).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw usageError(`${label} must not contain symbolic links`);
    }
  }
}

async function assertOutputTargetsDoNotReplaceInputs(outputs, inputs) {
  for (const output of outputs) {
    if (inputs.some((input) => samePath(output, input.absolute))) {
      throw usageError('Validator output must not replace an immutable input artifact');
    }
    await assertNoSymbolicLinkComponents(output, 'Validator output path');
  }
}

function canonicalRelative(file, root) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || relative.split('/').some((part) => (
    !part || part === '.' || part === '..'
  ))) {
    throw usageError('Evidence input is outside the candidate evidence root');
  }
  return relative;
}

async function prepareEvidenceRoot(options) {
  const outputDir = path.resolve(options.outputDir);
  const candidateRoot = options.smokeOnly ? path.dirname(outputDir) : outputDir;
  if (pathInsideOrSame(candidateRoot, REPO_ROOT)) {
    throw usageError('Wave 1B evidence root must be repository-external');
  }
  if (pathInsideOrSame(outputDir, REPO_ROOT)) {
    throw usageError('Wave 1B output directory must be repository-external');
  }
  await assertNoSymbolicLinkComponents(candidateRoot, 'Wave 1B evidence root');
  await assertNoSymbolicLinkComponents(outputDir, 'Wave 1B output directory');
  await fsp.mkdir(outputDir, { recursive: true });
  await assertNoSymbolicLinkComponents(candidateRoot, 'Wave 1B evidence root');
  await assertNoSymbolicLinkComponents(outputDir, 'Wave 1B output directory');
  const rootStat = await fsp.lstat(candidateRoot);
  const outputStat = await fsp.lstat(outputDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()
      || outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
    throw usageError('Wave 1B evidence directories must be real directories');
  }
  const realOutputDir = await fsp.realpath(outputDir);
  const realCandidateRoot = await fsp.realpath(candidateRoot);
  const realRepoRoot = await fsp.realpath(REPO_ROOT);
  if (pathInsideOrSame(realCandidateRoot, realRepoRoot)) {
    throw usageError('Wave 1B evidence root must be repository-external');
  }
  if (pathInsideOrSame(realOutputDir, realRepoRoot)) {
    throw usageError('Wave 1B output directory must be repository-external');
  }
  if (!pathInsideOrSame(realOutputDir, realCandidateRoot)) {
    throw usageError('Wave 1B output directory must be inside the candidate evidence root');
  }
  return { outputDir: realOutputDir, candidateRoot: realCandidateRoot };
}

async function readInput(file, role, candidateRoot) {
  const requested = path.resolve(file);
  await assertNoSymbolicLinkComponents(requested, role);
  const stat = await fsp.lstat(requested);
  if (stat.isSymbolicLink() || !stat.isFile()) throw usageError(`${role} must be a regular file`);
  const absolute = await fsp.realpath(requested);
  if (!pathInsideOrSame(absolute, candidateRoot)) {
    throw usageError(`${role} must be inside the common candidate evidence root`);
  }
  const bytes = await fsp.readFile(absolute);
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw usageError(`${role} must contain valid UTF-8 JSON`);
  }
  return {
    role,
    absolute,
    relativePath: canonicalRelative(absolute, candidateRoot),
    byteLength: bytes.length,
    sha256: sha256(bytes),
    artifact,
  };
}

function valueAtPath(value, fieldPath) {
  return fieldPath.split('.').reduce((current, key) => current?.[key], value);
}

function recordFailure(failures, label, message) {
  failures.push(`${label}: ${message}`);
}

function selectFields(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value?.[field]]));
}

function baseIdentityProjection(artifact) {
  return {
    schemaVersion: artifact?.schemaVersion,
    artifactKind: artifact?.artifactKind,
    identity: selectFields(artifact?.identity, IDENTITY_FIELDS),
    environment: selectFields(artifact?.environment, ENVIRONMENT_IDENTITY_FIELDS),
    invocationTemplate: artifact?.invocationTemplate,
    fixture: selectFields(artifact?.fixture, FIXTURE_FIELDS),
  };
}

function stableJson(value) {
  return JSON.stringify(value);
}

function validatePerRun(record, options, label, dependencies = {}) {
  const failures = [];
  let genericAcceptancePassed = false;
  try {
    (dependencies.validateGeneric || validateTimelineArtifact)(record.artifact);
    genericAcceptancePassed = record.artifact?.acceptance?.passed === true;
    if (!genericAcceptancePassed) recordFailure(failures, label, 'generic acceptance did not pass');
  } catch (error) {
    recordFailure(failures, label, `generic artifact validation failed: ${error.message}`);
  }
  if (record.artifact?.identity?.candidateCommitSha !== options.candidateSha) {
    recordFailure(failures, label, 'candidate SHA mismatch');
  }
  if (record.artifact?.identity?.targetSyncSha !== options.targetSyncSha) {
    recordFailure(failures, label, 'target sync SHA mismatch');
  }
  let overlayAcceptancePassed = true;
  for (const [fieldPath, expected] of OVERLAY_CHECKS) {
    const actual = valueAtPath(record.artifact, fieldPath);
    if (actual !== expected) {
      overlayAcceptancePassed = false;
      recordFailure(failures, label, `${fieldPath} expected ${expected}, got ${JSON.stringify(actual)}`);
    }
  }
  if (record.artifact?.acceptance?.numericalLatencyGate !== false) {
    recordFailure(failures, label, 'numerical latency gate must be false');
  }
  return {
    failures,
    genericAcceptancePassed,
    overlayAcceptancePassed,
    passed: failures.length === 0,
  };
}

function requireFiniteMetric(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function closedDescriptiveSummary(runs) {
  const scenarios = {};
  for (const scenarioName of SCENARIO_NAMES) {
    const scenarioRuns = runs.map((record) => record.artifact.scenarios[scenarioName]);
    const resourceSections = scenarioRuns.map((scenario) => requireRecord(
      scenario?.requests?.resourceTimingByFamily,
      `${scenarioName}.requests.resourceTimingByFamily`,
    ));
    const families = new Set();
    for (const resources of resourceSections) {
      Object.keys(resources).forEach((family) => families.add(family));
    }
    scenarios[scenarioName] = {
      durationMs: timingStats(scenarioRuns.map((scenario) => (
        requireFiniteMetric(scenario.work.durationMs, `${scenarioName}.work.durationMs`)
      ))),
      longTasks: {
        count: timingStats(scenarioRuns.map((scenario) => (
          requireFiniteMetric(scenario.work.longTasks.count, `${scenarioName}.work.longTasks.count`)
        ))),
        totalMs: timingStats(scenarioRuns.map((scenario) => (
          requireFiniteMetric(scenario.work.longTasks.totalMs, `${scenarioName}.work.longTasks.totalMs`)
        ))),
        maxMs: timingStats(scenarioRuns.map((scenario) => (
          requireFiniteMetric(scenario.work.longTasks.maxMs, `${scenarioName}.work.longTasks.maxMs`)
        ))),
      },
      resourceTimingDurationTotal: Object.fromEntries([...families].sort().map((family) => [
        family,
        timingStats(resourceSections.map((resources) => {
          const resource = resources[family];
          return resource === undefined
            ? 0
            : requireFiniteMetric(
              requireRecord(resource, `${scenarioName}.${family}`).durationTotal,
              `${scenarioName}.${family}.durationTotal`,
            );
        })),
      ])),
    };
  }
  return scenarios;
}

function expectedStructuralValues() {
  return Object.fromEntries(OVERLAY_CHECKS.map(([fieldPath, value]) => [fieldPath, value]));
}

async function writeSmokeValidation(options, paths, smoke, dependencies = {}) {
  const verdict = validatePerRun(smoke, options, 'smoke', dependencies);
  const validatedAt = (dependencies.now || (() => new Date()))().toISOString();
  const record = {
    schemaVersion: 1,
    artifactKind: 'performance-wave-1b-smoke-validation',
    validatedAt,
    smoke: {
      relativePath: smoke.relativePath,
      byteLength: smoke.byteLength,
      sha256: smoke.sha256,
    },
    candidateSha: options.candidateSha,
    targetSyncSha: options.targetSyncSha,
    runtimeFixtureIdentity: baseIdentityProjection(smoke.artifact),
    genericAcceptancePassed: verdict.genericAcceptancePassed,
    overlayAcceptancePassed: verdict.overlayAcceptancePassed,
    passed: verdict.passed,
    failures: verdict.failures,
  };
  const output = path.join(path.dirname(smoke.absolute), 'smoke-validation.json');
  await (dependencies.writeJson || writeJsonAtomic)(output, record);
  return { passed: record.passed, output, record };
}

function validateSmokeBinding(smoke, validation, runs, options, failures) {
  const record = validation.artifact;
  if (record?.schemaVersion !== 1
      || record?.artifactKind !== 'performance-wave-1b-smoke-validation') {
    recordFailure(failures, 'smoke-validation', 'schema or artifact kind is invalid');
    return;
  }
  if (record.passed !== true || record.genericAcceptancePassed !== true
      || record.overlayAcceptancePassed !== true
      || !Array.isArray(record.failures) || record.failures.length !== 0) {
    recordFailure(failures, 'smoke-validation', 'prior smoke preflight did not pass');
  }
  if (record.smoke?.relativePath !== smoke.relativePath
      || record.smoke?.byteLength !== smoke.byteLength
      || record.smoke?.sha256 !== smoke.sha256) {
    recordFailure(failures, 'smoke-validation', 'raw smoke byte binding mismatch');
  }
  if (record.candidateSha !== options.candidateSha || record.targetSyncSha !== options.targetSyncSha) {
    recordFailure(failures, 'smoke-validation', 'candidate or target binding mismatch');
  }
  if (stableJson(record.runtimeFixtureIdentity) !== stableJson(baseIdentityProjection(smoke.artifact))) {
    recordFailure(failures, 'smoke-validation', 'runtime/fixture identity binding mismatch');
  }
  const validatedAt = Date.parse(record.validatedAt);
  if (!Number.isFinite(validatedAt)) {
    recordFailure(failures, 'smoke-validation', 'validatedAt is invalid');
  } else {
    for (const [index, run] of runs.entries()) {
      const recordedAt = Date.parse(run.artifact?.identity?.recordedAt);
      if (!Number.isFinite(recordedAt) || validatedAt >= recordedAt) {
        recordFailure(failures, `run-${index + 1}`, 'must be recorded after smoke validation');
      }
    }
  }
}

function validateFormalIdentity(smoke, runs, failures) {
  const smokeProjection = baseIdentityProjection(smoke.artifact);
  const runProjection = baseIdentityProjection(runs[0].artifact);
  if (stableJson(smokeProjection) !== stableJson(runProjection)) {
    recordFailure(failures, 'formal-group', 'smoke and formal runtime/fixture identity differ');
  }
  for (let index = 1; index < runs.length; index += 1) {
    if (stableJson(baseIdentityProjection(runs[index].artifact)) !== stableJson(runProjection)) {
      recordFailure(failures, `run-${index + 1}`, 'formal group identity differs');
    }
  }
  const indices = runs.map((run) => run.artifact?.identity?.repetitionIndex);
  const counts = runs.map((run) => run.artifact?.identity?.repetitionCount);
  if (stableJson(indices) !== '[1,2,3]' || counts.some((count) => count !== 3)) {
    recordFailure(failures, 'formal-group', 'repetition identity must be count 3 with indices 1, 2, and 3');
  }
}

function manifestEntry(record) {
  return {
    role: record.role,
    filename: record.relativePath,
    byteLength: record.byteLength,
    sha256: record.sha256,
  };
}

async function writeFormalOutputs(options, paths, smoke, smokeValidation, runs, dependencies = {}) {
  const failures = [];
  const smokeVerdict = validatePerRun(smoke, options, 'smoke', dependencies);
  failures.push(...smokeVerdict.failures);
  const runVerdicts = runs.map((run, index) => validatePerRun(run, options, `run-${index + 1}`, dependencies));
  runVerdicts.forEach((verdict) => failures.push(...verdict.failures));
  validateSmokeBinding(smoke, smokeValidation, runs, options, failures);
  validateFormalIdentity(smoke, runs, failures);
  let descriptive = {};
  try {
    descriptive = closedDescriptiveSummary(runs);
  } catch (error) {
    recordFailure(failures, 'summary', error.message);
  }
  const summary = {
    schemaVersion: 1,
    artifactKind: 'performance-wave-1b-summary',
    passed: failures.length === 0,
    failures,
    identity: baseIdentityProjection(runs[0].artifact),
    genericAcceptancePassCount: runVerdicts.filter((verdict) => verdict.genericAcceptancePassed).length,
    overlayAcceptancePassCount: runVerdicts.filter((verdict) => verdict.overlayAcceptancePassed).length,
    validRunCount: runVerdicts.filter((verdict) => verdict.passed).length,
    invalidRunCount: runVerdicts.filter((verdict) => !verdict.passed).length,
    numericalLatencyGate: false,
    requiredStructuralValues: expectedStructuralValues(),
    descriptive,
  };
  const summaryPath = path.join(paths.outputDir, 'summary.json');
  await (dependencies.writeJson || writeJsonAtomic)(summaryPath, summary);
  const summaryBytes = await fsp.readFile(summaryPath);
  const summaryRecord = {
    role: 'summary',
    absolute: summaryPath,
    relativePath: canonicalRelative(summaryPath, paths.candidateRoot),
    byteLength: summaryBytes.length,
    sha256: sha256(summaryBytes),
  };
  const manifest = {
    schemaVersion: 1,
    artifactKind: 'performance-wave-1b-manifest',
    passed: summary.passed,
    failures: [...failures],
    candidateSha: options.candidateSha,
    targetSyncSha: options.targetSyncSha,
    identity: summary.identity,
    self: {
      filename: 'manifest.json',
      indexed: false,
      reason: 'excluded-self-reference',
    },
    entries: [
      manifestEntry(smoke),
      manifestEntry(smokeValidation),
      ...runs.map(manifestEntry),
      manifestEntry(summaryRecord),
    ],
  };
  const manifestPath = path.join(paths.outputDir, 'manifest.json');
  await (dependencies.writeJson || writeJsonAtomic)(manifestPath, manifest);
  return { passed: summary.passed, summaryPath, manifestPath, summary, manifest };
}

async function runValidator(options, dependencies = {}) {
  const paths = await prepareEvidenceRoot(options);
  const smoke = await readInput(options.smoke, 'smoke', paths.candidateRoot);
  if (options.smokeOnly) {
    if (!samePath(path.dirname(smoke.absolute), paths.outputDir)) {
      throw usageError('Smoke input must be directly inside the smoke-only output directory');
    }
    const output = path.join(path.dirname(smoke.absolute), 'smoke-validation.json');
    await assertOutputTargetsDoNotReplaceInputs([output], [smoke]);
    return writeSmokeValidation(options, paths, smoke, dependencies);
  }
  const smokeValidation = await readInput(
    options.smokeValidation,
    'smoke-validation',
    paths.candidateRoot,
  );
  const runs = [];
  for (let index = 0; index < options.runs.length; index += 1) {
    runs.push(await readInput(options.runs[index], `run-${index + 1}`, paths.candidateRoot));
  }
  const expectedSmokeValidation = path.join(path.dirname(smoke.absolute), 'smoke-validation.json');
  if (!samePath(smokeValidation.absolute, expectedSmokeValidation)) {
    throw usageError('Smoke validation must be beside the raw smoke artifact');
  }
  await assertOutputTargetsDoNotReplaceInputs(
    [path.join(paths.outputDir, 'summary.json'), path.join(paths.outputDir, 'manifest.json')],
    [smoke, smokeValidation, ...runs],
  );
  return writeFormalOutputs(options, paths, smoke, smokeValidation, runs, dependencies);
}

async function main(argv = process.argv.slice(2)) {
  const result = await runValidator(parseArgs(argv));
  if (!result.passed) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`PERFORMANCE_WAVE_1B_ERROR:${error.code || 'VALIDATION_FAILED'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  OVERLAY_CHECKS,
  SCENARIO_NAMES,
  baseIdentityProjection,
  closedDescriptiveSummary,
  main,
  parseArgs,
  runValidator,
  validatePerRun,
};
