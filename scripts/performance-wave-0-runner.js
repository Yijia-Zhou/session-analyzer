'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getSourceAdapter } = require('../src/source-adapters');
const {
  PRIVATE_PROOF_VERSION,
  assertNoPrivateLeak,
  computePrivateSnapshotDigest,
  snapshotProofVerdict,
  validatePrivateArtifact,
  validatePrivateSummary,
} = require('./project-query-store-profile');
const {
  buildReviewIdentity,
  postRunDocumentationHash,
} = require('./performance-wave-0-identity');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROFILE_KINDS = new Set(['synthetic-browser', 'private-corpus']);
const MODES = new Set(['smoke', 'calibration', 'baseline']);
const PRIVATE_COPY_METHOD = 'independent-byte-copy';
const SEALED_COPY_PROBE_PHASE = 'after-seal-before-private-group';
const DIRECT_FAILURE_CODES = new Set(['CHILD_SPAWN_FAILED', 'WORKER_SIGNALLED']);
const FAILURE_CODES = new Set([
  'INVALID_PROFILE_ARGUMENT',
  'CHILD_SPAWN_FAILED',
  'WORKER_SIGNALLED',
  'WORKER_EXIT',
  'INVALID_JSON',
  'SCHEMA_OR_PRIVACY',
  'STRUCTURAL_ACCEPTANCE',
  'SNAPSHOT_MISMATCH',
  'SNAPSHOT_GROUP_MISMATCH',
  'CALIBRATION_MISMATCH',
  'PRIVATE_BOUNDARY_REJECTED',
  'PRIVATE_SNAPSHOT_INVALID',
  'PRIVATE_SOURCE_HOME_INVALID',
  'PRIVATE_LIVE_HOME_REJECTED',
  'PRIVATE_OUTPUT_INVALID',
  'RUNNER_FAILURE',
]);
const ELIGIBLE_CALIBRATION_COUNTERS = Object.freeze([
  'fullRenders',
  'cardGenerations',
  'highlightPasses',
  'highlightMarksCreated',
  'highlightedOwnerCount',
  'targetDiscoveryPasses',
]);
const DEMONSTRATED_OBSERVATIONAL_COUNTERS = Object.freeze({
  warmJumpToLateHit: Object.freeze([
    'fullRenders',
    'cardGenerations',
    'highlightMarksCreated',
    'targetDiscoveryPasses',
  ]),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isPathInsideOrSame(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function boundaryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function usageError(message) {
  const error = new Error(`${message}\nUsage: node scripts/performance-wave-0-runner.js --profile <synthetic-browser|private-corpus> --mode <smoke|calibration|baseline> --output-dir <external-path> [profile options]`);
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = {
    profileKind: '',
    mode: 'baseline',
    outputDir: '',
    repetitions: 0,
    source: 'codex',
    repo: '',
    sourceHome: '',
    snapshotRoot: '',
    snapshotGroup: '',
    readOnlyAttested: false,
    copyMethod: '',
    probeReadExisting: '',
    probeCreateNew: '',
    probeAppendExisting: '',
    sealedCopyProbe: null,
    calibrationFile: '',
    candidateSha: '',
    targetSyncSha: '',
    eventCount: 0,
    textBytes: 0,
  };
  const valueOptions = new Set([
    '--profile', '--mode', '--output-dir', '--repetitions', '--source', '--repo', '--source-home',
    '--snapshot-root', '--snapshot-group', '--calibration-file', '--event-count', '--text-bytes',
    '--copy-method', '--candidate-sha', '--target-sync-sha',
    '--probe-read-existing', '--probe-create-new', '--probe-append-existing',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--read-only-attested') {
      options.readOnlyAttested = true;
      continue;
    }
    if (!valueOptions.has(name)) throw usageError(`Unknown option: ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--profile') options.profileKind = value;
    if (name === '--mode') options.mode = value;
    if (name === '--output-dir') options.outputDir = path.resolve(value);
    if (name === '--repetitions') options.repetitions = Number(value);
    if (name === '--source') options.source = value;
    if (name === '--repo') options.repo = path.resolve(value);
    if (name === '--source-home') options.sourceHome = path.resolve(value);
    if (name === '--snapshot-root') options.snapshotRoot = path.resolve(value);
    if (name === '--snapshot-group') options.snapshotGroup = value;
    if (name === '--copy-method') options.copyMethod = value;
    if (name === '--probe-read-existing') options.probeReadExisting = value;
    if (name === '--probe-create-new') options.probeCreateNew = value;
    if (name === '--probe-append-existing') options.probeAppendExisting = value;
    if (name === '--calibration-file') options.calibrationFile = path.resolve(value);
    if (name === '--candidate-sha') options.candidateSha = value;
    if (name === '--target-sync-sha') options.targetSyncSha = value;
    if (name === '--event-count') options.eventCount = Number(value);
    if (name === '--text-bytes') options.textBytes = Number(value);
  }
  if (!PROFILE_KINDS.has(options.profileKind)) throw usageError('--profile is required');
  if (!MODES.has(options.mode)) throw usageError('--mode is invalid');
  if (!options.outputDir) throw usageError('--output-dir is required');
  for (const [name, value] of [
    ['--candidate-sha', options.candidateSha],
    ['--target-sync-sha', options.targetSyncSha],
  ]) {
    if (value && !/^[0-9a-f]{40}$/.test(value)) throw usageError(`${name} must be a full commit SHA`);
  }
  if (!options.repetitions) {
    options.repetitions = options.mode === 'smoke'
      ? 1
      : (options.mode === 'calibration' ? 3 : (options.profileKind === 'synthetic-browser' ? 5 : 3));
  }
  if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1) {
    throw usageError('--repetitions must be a positive integer');
  }
  if (options.mode === 'baseline' && options.profileKind === 'synthetic-browser' && options.repetitions !== 5) {
    throw usageError('synthetic browser baseline requires exactly five repetitions');
  }
  if (options.mode === 'baseline' && options.profileKind === 'private-corpus' && options.repetitions < 3) {
    throw usageError('private baseline requires at least three repetitions');
  }
  if (options.mode === 'calibration' && options.profileKind !== 'synthetic-browser') {
    throw usageError('calibration is synthetic-browser only');
  }
  if (options.profileKind === 'private-corpus') {
    if (!options.repo || !options.sourceHome || !options.snapshotRoot || !options.snapshotGroup
        || options.copyMethod !== PRIVATE_COPY_METHOD) {
      throw usageError('private profile requires repo/source/snapshot/group and independent byte-copy metadata');
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(options.snapshotGroup)) {
      throw usageError('private snapshot group must be an opaque lowercase label');
    }
    if (!options.readOnlyAttested) throw usageError('private profile requires --read-only-attested');
    if (!getSourceAdapter(options.source)) throw usageError('--source is unsupported');
    options.sealedCopyProbe = {
      schemaVersion: 1,
      phase: SEALED_COPY_PROBE_PHASE,
      readExisting: options.probeReadExisting,
      createNew: options.probeCreateNew,
      appendExisting: options.probeAppendExisting,
    };
    try {
      validateSealedCopyProbe(options.sealedCopyProbe);
    } catch {
      throw usageError('private profile requires the closed sealed-copy probe outcomes');
    }
  } else if (options.probeReadExisting || options.probeCreateNew || options.probeAppendExisting) {
    throw usageError('sealed-copy probe outcomes are private-profile only');
  }
  delete options.probeReadExisting;
  delete options.probeCreateNew;
  delete options.probeAppendExisting;
  if (options.mode === 'baseline'
      && options.profileKind === 'synthetic-browser'
      && !options.calibrationFile) {
    throw usageError('synthetic baseline requires --calibration-file');
  }
  return options;
}

async function nearestExistingCanonical(candidate, fsApi = fsp) {
  let current = path.resolve(candidate);
  const missing = [];
  for (;;) {
    try {
      await fsApi.lstat(current);
      const canonical = await fsApi.realpath(current);
      return path.join(canonical, ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function canonicalExistingDirectory(candidate, code, fsApi = fsp, rejectLink = true) {
  try {
    const resolved = path.resolve(candidate);
    const stat = await fsApi.lstat(resolved);
    if ((rejectLink && stat.isSymbolicLink()) || !stat.isDirectory()) throw boundaryError(code);
    return await fsApi.realpath(resolved);
  } catch (error) {
    if (error?.code === code) throw error;
    throw boundaryError(code);
  }
}

async function prepareOutputBoundary(outputDir, dependencies = {}) {
  const fsApi = dependencies.fsp || fsp;
  const repoRoot = dependencies.repoRoot || REPO_ROOT;
  let canonicalRepo;
  let predictedOutput;
  try {
    canonicalRepo = await fsApi.realpath(path.resolve(repoRoot));
    predictedOutput = await nearestExistingCanonical(outputDir, fsApi);
  } catch {
    throw boundaryError('PRIVATE_OUTPUT_INVALID');
  }
  if (isPathInsideOrSame(predictedOutput, canonicalRepo)) {
    throw boundaryError('PRIVATE_OUTPUT_INVALID');
  }
  try {
    await fsApi.mkdir(path.resolve(outputDir), { recursive: true });
    const outputStat = await fsApi.lstat(path.resolve(outputDir));
    if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
      throw boundaryError('PRIVATE_OUTPUT_INVALID');
    }
    const canonicalOutput = await fsApi.realpath(path.resolve(outputDir));
    if (isPathInsideOrSame(canonicalOutput, canonicalRepo)) {
      throw boundaryError('PRIVATE_OUTPUT_INVALID');
    }
    return { outputRoot: canonicalOutput, repoRoot: canonicalRepo };
  } catch (error) {
    if (error?.code === 'PRIVATE_OUTPUT_INVALID') throw error;
    throw boundaryError('PRIVATE_OUTPUT_INVALID');
  }
}

async function canonicalizePrivateBoundaries(options, dependencies = {}) {
  const fsApi = dependencies.fsp || fsp;
  const adapter = dependencies.adapter || getSourceAdapter(options.source);
  if (!adapter) throw boundaryError('PRIVATE_BOUNDARY_REJECTED');
  const repoRoot = dependencies.repoRoot || REPO_ROOT;
  let canonicalRepo;
  let canonicalProjectRepo;
  let canonicalSnapshot;
  let canonicalSourceHome;
  let canonicalLiveHome;
  try {
    canonicalRepo = await fsApi.realpath(path.resolve(repoRoot));
    canonicalProjectRepo = await canonicalExistingDirectory(
      options.repo,
      'PRIVATE_BOUNDARY_REJECTED',
      fsApi,
      false,
    );
    canonicalSnapshot = await canonicalExistingDirectory(
      options.snapshotRoot,
      'PRIVATE_SNAPSHOT_INVALID',
      fsApi,
      true,
    );
    canonicalSourceHome = await canonicalExistingDirectory(
      options.sourceHome,
      'PRIVATE_SOURCE_HOME_INVALID',
      fsApi,
      true,
    );
    canonicalLiveHome = await nearestExistingCanonical(
      dependencies.defaultLiveHome || adapter.defaultHome(),
      fsApi,
    );
  } catch (error) {
    if (FAILURE_CODES.has(error?.code)) throw error;
    throw boundaryError('PRIVATE_BOUNDARY_REJECTED');
  }
  if (isPathInsideOrSame(canonicalSnapshot, canonicalRepo)
      || !isPathInsideOrSame(canonicalSourceHome, canonicalSnapshot)) {
    throw boundaryError('PRIVATE_BOUNDARY_REJECTED');
  }
  if (isPathInsideOrSame(canonicalSourceHome, canonicalLiveHome)
      || isPathInsideOrSame(canonicalSnapshot, canonicalLiveHome)
      || isPathInsideOrSame(canonicalLiveHome, canonicalSnapshot)) {
    throw boundaryError('PRIVATE_LIVE_HOME_REJECTED');
  }
  const output = await prepareOutputBoundary(options.outputDir, { fsp: fsApi, repoRoot: canonicalRepo });
  return {
    ...options,
    repo: canonicalProjectRepo,
    sourceHome: canonicalSourceHome,
    snapshotRoot: canonicalSnapshot,
    outputDir: output.outputRoot,
    boundary: output,
  };
}

async function prepareRunBoundaries(options, dependencies = {}) {
  if (options.profileKind === 'private-corpus') {
    return canonicalizePrivateBoundaries(options, dependencies);
  }
  const output = await prepareOutputBoundary(options.outputDir, dependencies);
  return { ...options, outputDir: output.outputRoot, boundary: output };
}

async function ensureOutputDirectory(directory, boundary, fsApi = fsp) {
  try {
    await fsApi.mkdir(directory, { recursive: true });
    const stat = await fsApi.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw boundaryError('PRIVATE_OUTPUT_INVALID');
    const canonical = await fsApi.realpath(directory);
    if (!isPathInsideOrSame(canonical, boundary.outputRoot)
        || isPathInsideOrSame(canonical, boundary.repoRoot)) {
      throw boundaryError('PRIVATE_OUTPUT_INVALID');
    }
    return canonical;
  } catch (error) {
    if (error?.code === 'PRIVATE_OUTPUT_INVALID') throw error;
    throw boundaryError('PRIVATE_OUTPUT_INVALID');
  }
}

async function assertArtifactBoundary(file, boundary, fsApi = fsp) {
  const parent = await canonicalExistingDirectory(
    path.dirname(file),
    'PRIVATE_OUTPUT_INVALID',
    fsApi,
    true,
  );
  if (!isPathInsideOrSame(parent, boundary.outputRoot)
      || isPathInsideOrSame(parent, boundary.repoRoot)) {
    throw boundaryError('PRIVATE_OUTPUT_INVALID');
  }
  try {
    const stat = await fsApi.lstat(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw boundaryError('PRIVATE_OUTPUT_INVALID');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error?.code === 'PRIVATE_OUTPUT_INVALID') throw error;
      throw boundaryError('PRIVATE_OUTPUT_INVALID');
    }
  }
}

async function writeJsonAtomic(file, value, options = {}) {
  const fsApi = options.fsp || fsp;
  await fsApi.mkdir(path.dirname(file), { recursive: true });
  if (options.boundary) await assertArtifactBoundary(file, options.boundary, fsApi);
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsApi.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (options.boundary) {
    await assertArtifactBoundary(temporary, options.boundary, fsApi);
    await assertArtifactBoundary(file, options.boundary, fsApi);
  }
  await fsApi.rename(temporary, file);
}

function runChild(command, args, options = {}) {
  return new Promise((resolve) => {
    const spawnImpl = options.spawnImpl || spawn;
    const child = spawnImpl(command, args, {
      cwd: options.cwd || REPO_ROOT,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderrObserved = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', () => { stderrObserved = true; });
    child.on('error', () => resolve({
      pid: child.pid || null,
      exitCode: -1,
      stdout,
      stderrObserved,
      failureCode: 'CHILD_SPAWN_FAILED',
    }));
    child.on('close', (exitCode, signal) => {
      const signalled = signal !== null && signal !== undefined;
      resolve({
        pid: child.pid,
        exitCode: signalled ? -2 : exitCode,
        stdout,
        stderrObserved,
        failureCode: signalled ? 'WORKER_SIGNALLED' : (exitCode === 0 ? '' : 'WORKER_EXIT'),
      });
    });
  });
}

function preserveDirectFailure(currentFailureReason, replacementFailureReason) {
  return DIRECT_FAILURE_CODES.has(currentFailureReason)
    ? currentFailureReason
    : replacementFailureReason;
}

function defaultWorkerFactory(options, repetition) {
  if (options.profileKind === 'synthetic-browser') {
    const args = [
      path.join('scripts', 'timeline-profile.js'),
      '--label', `${options.mode}-${repetition}`,
      '--repetition-index', String(repetition),
      '--repetition-count', String(options.repetitions),
    ];
    if (options.candidateSha) args.push('--candidate-sha', options.candidateSha);
    if (options.targetSyncSha) args.push('--target-sync-sha', options.targetSyncSha);
    if (options.eventCount) args.push('--event-count', String(options.eventCount));
    if (options.textBytes) args.push('--text-bytes', String(options.textBytes));
    return { command: process.execPath, args };
  }
  return {
    command: process.execPath,
    args: [
      '--expose-gc',
      path.join('scripts', 'project-query-store-profile.js'),
      '--source', options.source,
      '--repo', options.repo,
      '--source-home', options.sourceHome,
      '--repeats', '3',
      '--snapshot-group', options.snapshotGroup,
      '--repetition-index', String(repetition),
      '--repetition-count', String(options.repetitions),
      ...(options.candidateSha ? ['--candidate-sha', options.candidateSha] : []),
      ...(options.targetSyncSha ? ['--target-sync-sha', options.targetSyncSha] : []),
    ],
  };
}

function validateClosedKeys(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new Error(`${label} violates its closed schema`);
  }
}

function validateSealedCopyProbe(value) {
  validateClosedKeys(value, [
    'schemaVersion', 'phase', 'readExisting', 'createNew', 'appendExisting',
  ], 'Sealed copy probe');
  if (value.schemaVersion !== 1
      || value.phase !== SEALED_COPY_PROBE_PHASE
      || value.readExisting !== 'passed'
      || value.createNew !== 'rejected'
      || value.appendExisting !== 'rejected') {
    throw new Error('Sealed copy probe is invalid');
  }
  return true;
}

function validateManifest(manifest) {
  validateClosedKeys(manifest, ['schemaVersion', 'artifactKind', 'groups'], 'Manifest');
  if (manifest.schemaVersion !== 3
      || manifest.artifactKind !== 'performance-wave-0-manifest'
      || !manifest.groups
      || typeof manifest.groups !== 'object'
      || Array.isArray(manifest.groups)) {
    throw new Error('Manifest identity is invalid');
  }
  for (const [groupName, group] of Object.entries(manifest.groups)) {
    validateClosedKeys(group, [
      'profileKind', 'mode', 'readOnlyAttested', 'copyMethod', 'snapshotGroup',
      'sealedCopyProbe', 'attempts',
    ], `Manifest ${groupName}`);
    if (group.profileKind === 'private-corpus') validateSealedCopyProbe(group.sealedCopyProbe);
    if (!PROFILE_KINDS.has(group.profileKind)
        || !MODES.has(group.mode)
        || groupName !== `${group.profileKind}:${group.mode}`
        || !Array.isArray(group.attempts)
        || (group.profileKind === 'private-corpus'
          ? (group.readOnlyAttested !== true
            || group.copyMethod !== PRIVATE_COPY_METHOD
            || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(group.snapshotGroup))
          : (group.readOnlyAttested !== null
            || group.copyMethod !== null
            || group.snapshotGroup !== null
            || group.sealedCopyProbe !== null))) {
      throw new Error('Manifest group is invalid');
    }
    for (const attempt of group.attempts) {
      validateClosedKeys(attempt, [
        'run', 'pid', 'exitStatus', 'valid', 'failureReason', 'artifactSha256',
      ], `Manifest ${groupName} attempt`);
      const childSpawnFailed = attempt.failureReason === 'CHILD_SPAWN_FAILED';
      const workerSignalled = attempt.failureReason === 'WORKER_SIGNALLED';
      const missingPid = attempt.pid === null;
      if (!/^run-[0-9]{3}\.json$/.test(attempt.run)
          || (missingPid !== childSpawnFailed)
          || (!missingPid && (!Number.isSafeInteger(attempt.pid) || attempt.pid < 1))
          || (childSpawnFailed && (attempt.valid !== false || attempt.exitStatus !== -1))
          || (workerSignalled && (attempt.valid !== false || attempt.exitStatus !== -2))
          || (attempt.exitStatus === -1 && !childSpawnFailed)
          || (attempt.exitStatus === -2 && !workerSignalled)
          || !Number.isSafeInteger(attempt.exitStatus)
          || typeof attempt.valid !== 'boolean'
          || typeof attempt.failureReason !== 'string'
          || (attempt.failureReason && !FAILURE_CODES.has(attempt.failureReason))
          || !/^[0-9a-f]{64}$/.test(attempt.artifactSha256)) {
        throw new Error('Manifest attempt is invalid');
      }
    }
  }
  assertNoPrivateLeak(manifest);
  return true;
}

function validateCalibrationArtifact(calibration) {
  validateClosedKeys(calibration, [
    'schemaVersion', 'artifactKind', 'profileKind', 'exactCounterSet',
    'candidateCommitSha', 'targetSyncSha', 'targetToCandidateDiffAlgorithm',
    'targetToCandidateDiffSha256', 'profiledImplementationTreeHash',
    'semanticFixtureProof', 'accepted',
  ], 'Calibration artifact');
  if (calibration.schemaVersion !== 3
      || calibration.artifactKind !== 'performance-wave-0-calibration'
      || calibration.profileKind !== 'synthetic-browser'
      || !calibration.exactCounterSet
      || typeof calibration.exactCounterSet !== 'object'
      || Array.isArray(calibration.exactCounterSet)
      || !/^[0-9a-f]{40}$/.test(calibration.candidateCommitSha)
      || !/^[0-9a-f]{40}$/.test(calibration.targetSyncSha)
      || calibration.targetToCandidateDiffAlgorithm
        !== 'git-diff-binary-no-ext-diff-full-index-v1'
      || !/^[0-9a-f]{64}$/.test(calibration.targetToCandidateDiffSha256)
      || !/^[0-9a-f]{64}$/.test(calibration.profiledImplementationTreeHash)
      || !/^[0-9a-f]{64}$/.test(calibration.semanticFixtureProof)
      || typeof calibration.accepted !== 'boolean') {
    throw new Error('Calibration artifact identity is invalid');
  }
  return true;
}

function validateTimelineArtifact(artifact) {
  const expectedFields = [
    'schemaVersion', 'artifactKind', 'identity', 'environment', 'invocationTemplate', 'fixture',
    'serverSetup', 'scenarios', 'acceptance',
  ].sort();
  if (JSON.stringify(Object.keys(artifact).sort()) !== JSON.stringify(expectedFields)
      || artifact.schemaVersion !== 3
      || artifact.artifactKind !== 'timeline-browser-run') {
    throw new Error('Timeline artifact violates schema v3');
  }
  validateClosedKeys(artifact.invocationTemplate, [
    'worker', 'runtime', 'inputRole', 'outputRole',
  ], 'Timeline invocationTemplate');
  if (artifact.invocationTemplate?.worker !== 'timeline'
      || artifact.invocationTemplate?.runtime !== 'node'
      || artifact.invocationTemplate?.inputRole !== 'external-synthetic-fixture'
      || artifact.invocationTemplate?.outputRole !== 'external-artifact-directory') {
    throw new Error('Timeline artifact invocationTemplate is invalid');
  }
  validateClosedKeys(artifact.identity, [
    'repository', 'targetBranch', 'currentBranch', 'inspectedBaseSha', 'preWave0Head', 'head',
    'candidateCommitSha', 'targetSyncSha', 'targetToCandidateDiffAlgorithm',
    'targetToCandidateDiffSha256', 'dirty', 'profiledTrackedDiffSha256AtRun',
    'profiledImplementationTreeHash',
    'runLabel', 'repetitionIndex',
    'repetitionCount', 'recordedAt',
  ], 'Timeline identity');
  validateClosedKeys(artifact.environment, [
    'node', 'v8', 'npm', 'playwright', 'chromium', 'execArgv', 'exposedGc', 'heapLimitBytes',
    'platform', 'osRelease', 'architecture', 'cpu', 'cpuCount', 'totalMemoryBytes', 'ci',
    'headless', 'locale', 'timezone', 'viewport', 'runtimeAssetSha256',
  ], 'Timeline environment');
  validateClosedKeys(artifact.fixture, [
    'parameters', 'roles', 'proofVersion', 'generatorSha256', 'semanticFixtureProof',
  ], 'Timeline fixture');
  validateClosedKeys(artifact.serverSetup, [
    'sourceKind', 'sessionLifecycle', 'buildInvocationCount', 'commitValidationInvocationCount',
    'commitValidationChunkCount', 'createServerCount', 'projectJobCount', 'prewarmDisabled',
    'optionsRepoPresent', 'buildMs', 'validationMs', 'ownerMaterializerTotals',
  ], 'Timeline serverSetup');
  validateClosedKeys(artifact.scenarios, [
    'warmSearchPreload', 'warmJumpToLateHit', 'warmDeepStructuredFilter',
    'warmContextReveal', 'coldSessionSwitchDuringQuery',
  ], 'Timeline scenarios');
  validateClosedKeys(artifact.acceptance, [
    'structural', 'correctness', 'privacyAuditPassed', 'cleanupPassed', 'passed', 'failures',
    'numericalLatencyGate',
  ], 'Timeline acceptance');
  if (!Number.isSafeInteger(artifact.identity.repetitionIndex)
      || !Number.isSafeInteger(artifact.identity.repetitionCount)
      || artifact.identity.repetitionIndex < 1
      || artifact.identity.repetitionIndex > artifact.identity.repetitionCount
      || artifact.identity.dirty !== false
      || !/^[0-9a-f]{40}$/.test(artifact.identity.candidateCommitSha)
      || !/^[0-9a-f]{40}$/.test(artifact.identity.targetSyncSha)
      || artifact.identity.targetToCandidateDiffAlgorithm
        !== 'git-diff-binary-no-ext-diff-full-index-v1'
      || !/^[0-9a-f]{64}$/.test(artifact.identity.targetToCandidateDiffSha256)
      || artifact.acceptance.privacyAuditPassed !== true
      || artifact.acceptance.cleanupPassed !== true) {
    throw new Error('Timeline repetition or acceptance metadata is invalid');
  }
  for (const [scenarioName, scenario] of Object.entries(artifact.scenarios)) {
    validateClosedKeys(scenario, ['classification', 'functional', 'requests', 'work'], `Timeline ${scenarioName}`);
    validateClosedKeys(scenario.classification, ['path', 'ownerInstance', 'scenarioVersion'], `Timeline ${scenarioName}.classification`);
    validateClosedKeys(scenario.requests, [
      'records', 'familyCounts', 'timelineOffsets', 'timelineLimits', 'timelinePageCount',
      'detailCount', 'eventEnvelopeCount', 'failedCount', 'intentionalAbortCount',
      'resourceTimingByFamily', 'domCommitLedger', 'constraints',
    ], `Timeline ${scenarioName}.requests`);
    let priorCommitSequence = 0;
    for (const commit of scenario.requests.domCommitLedger) {
      validateClosedKeys(commit, [
        'sequence', 'phase', 'afterSelectSecondary', 'activeSessionRole', 'cardCounts',
      ], `Timeline ${scenarioName}.domCommitLedger`);
      validateClosedKeys(commit.cardCounts, [
        'primary', 'secondary', 'unknown', 'canonical',
      ], `Timeline ${scenarioName}.domCommitLedger.cardCounts`);
      const counts = commit.cardCounts;
      if (!Number.isSafeInteger(commit.sequence)
          || commit.sequence <= priorCommitSequence
          || !['beforeSelectSecondary', 'afterSelectSecondary'].includes(commit.phase)
          || commit.afterSelectSecondary !== (commit.phase === 'afterSelectSecondary')
          || !['primary', 'secondary', 'unknown'].includes(commit.activeSessionRole)
          || [counts.primary, counts.secondary, counts.unknown, counts.canonical]
            .some((value) => !Number.isSafeInteger(value) || value < 0)
          || counts.canonical !== counts.primary + counts.secondary + counts.unknown) {
        throw new Error(`Timeline ${scenarioName} DOM commit ledger is invalid`);
      }
      priorCommitSequence = commit.sequence;
    }
  }
  const serialized = JSON.stringify(artifact);
  if (/[A-Za-z]:[\\/]|\\\\[^\\]|"(?:url|sessionId|rawUrl)"\s*:/i.test(serialized)
      || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(serialized)) {
    throw new Error('Timeline artifact contains a path, raw URL, or Session ID');
  }
  return true;
}

function artifactValidator(profileKind) {
  return profileKind === 'private-corpus' ? validatePrivateArtifact : validateTimelineArtifact;
}

function getPath(value, fieldPath) {
  return fieldPath.split('.').reduce((current, key) => current?.[key], value);
}

function flattenNumbers(value, prefix = '', result = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    result[prefix] = value;
    return result;
  }
  if (Array.isArray(value)) return result;
  if (!value || typeof value !== 'object') return result;
  for (const [key, entry] of Object.entries(value)) {
    flattenNumbers(entry, prefix ? `${prefix}.${key}` : key, result);
  }
  return result;
}

function timingStats(values) {
  if (!values.length) return { repeatCount: 0, median: 0, min: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    repeatCount: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function incrementCategory(counts, value) {
  const key = String(value || 'none');
  counts[key] = (counts[key] || 0) + 1;
}

function categoricalObservations(profileKind, artifacts) {
  if (profileKind !== 'synthetic-browser') return {};
  const result = {};
  const siblingFamilies = new Set(['analysis', 'timeline', 'fileSuggestions']);
  for (const scenarioName of Object.keys(artifacts[0]?.scenarios || {})) {
    const siblingRequestOrderCounts = {};
    const requestOutcomeCounts = {};
    for (const artifact of artifacts) {
      const records = artifact.scenarios[scenarioName]?.requests?.records || [];
      const siblingOrder = records
        .filter((record) => siblingFamilies.has(record.family))
        .sort((left, right) => left.sequence - right.sequence)
        .map((record) => record.family)
        .join('>');
      incrementCategory(siblingRequestOrderCounts, siblingOrder);
      for (const record of records) incrementCategory(requestOutcomeCounts, record.outcome);
    }
    result[scenarioName] = { siblingRequestOrderCounts, requestOutcomeCounts };
  }
  return result;
}

function exactPaths(profileKind, artifacts, exactCounterSet) {
  const identityPaths = [
    'identity.repository', 'identity.targetBranch', 'identity.currentBranch',
    'identity.inspectedBaseSha', 'identity.preWave0Head', 'identity.head', 'identity.dirty',
    'identity.candidateCommitSha', 'identity.targetSyncSha',
    'identity.targetToCandidateDiffAlgorithm', 'identity.targetToCandidateDiffSha256',
    'identity.profiledTrackedDiffSha256AtRun', 'identity.profiledImplementationTreeHash',
    'identity.repetitionCount',
  ];
  const environmentPaths = [
    'environment.node', 'environment.v8', 'environment.npm', 'environment.playwright',
    'environment.chromium', 'environment.execArgv', 'environment.exposedGc',
    'environment.heapLimitBytes', 'environment.platform', 'environment.osRelease',
    'environment.architecture', 'environment.cpu', 'environment.cpuCount',
    'environment.totalMemoryBytes', 'environment.ci', 'environment.headless',
    'environment.locale', 'environment.timezone', 'environment.viewport',
  ];
  if (profileKind === 'private-corpus') {
    const paths = [
      'schemaVersion', 'artifactKind', ...identityPaths, ...environmentPaths,
      'options.source', 'options.repo', 'options.sourceHome', 'options.repeats',
      'options.snapshotGroup', 'options.repetitionCount', 'invocationTemplate',
      'build.invocationCount', 'validation.invocationCount', 'snapshotProof.group',
      'snapshotProof.allMatched', 'acceptance.structural', 'acceptance.privacyAuditPassed',
      'acceptance.snapshotProofVerifiedByRunner', 'acceptance.numericalLatencyGate',
      'materialization.candidateCount', 'materialization.ordinals',
      'materialization.coldQueueing.queueDepthAtSecondAdmission',
      'materialization.coldQueueing.activeCountAtSecondAdmission',
      'materialization.coldQueueing.adapterCalls', 'materialization.coldQueueing.finalStats',
      'materialization.quickSessionSwitch.queueDepthAtSecondAdmission',
      'materialization.quickSessionSwitch.activeCountAtSecondAdmission',
      'materialization.quickSessionSwitch.adapterCalls',
      'materialization.quickSessionSwitch.finalStats',
      'materialization.largestCancellation.cacheSessionCount',
      'materialization.largestCancellation.completedCount',
      'build.sampling', 'validation.chunkSamples',
    ];
    for (const name of ['small', 'medium', 'large', 'largest']) {
      paths.push(
        `materialization.${name}.selection`,
        `materialization.${name}.adapterCalls`,
        `materialization.${name}.exactWarmIdentity`,
        `materialization.${name}.warmRepeatCount`,
        `materialization.${name}.estimatedOwnerBytes`,
        `materialization.${name}.projectionChunkSamples`,
      );
    }
    for (const name of ['coldQueueing', 'quickSessionSwitch']) {
      paths.push(`materialization.${name}.first`, `materialization.${name}.second`);
    }
    paths.push('materialization.largestCancellation.selection');
    const flattened = flattenNumbers(artifacts[0]?.corpus || {}, 'corpus');
    return [...paths, ...Object.keys(flattened)];
  }
  const paths = [
    'schemaVersion', 'artifactKind', ...identityPaths, ...environmentPaths,
    'environment.runtimeAssetSha256', 'invocationTemplate', 'fixture.parameters',
    'fixture.roles', 'fixture.proofVersion', 'fixture.generatorSha256',
    'fixture.semanticFixtureProof', 'serverSetup.buildInvocationCount',
    'serverSetup.commitValidationInvocationCount', 'serverSetup.projectJobCount',
    'serverSetup.prewarmDisabled', 'serverSetup.optionsRepoPresent',
    'serverSetup.createServerCount', 'serverSetup.ownerMaterializerTotals',
    'acceptance.structural', 'acceptance.correctness',
    'acceptance.privacyAuditPassed', 'acceptance.cleanupPassed', 'acceptance.passed',
    'acceptance.numericalLatencyGate',
  ];
  for (const scenarioName of Object.keys(artifacts[0]?.scenarios || {})) {
    const base = `scenarios.${scenarioName}`;
    paths.push(
      `${base}.functional.finalStateDigest`,
      `${base}.functional.selectedSessionRole`,
      `${base}.functional.loadedCount`,
      `${base}.functional.canonicalCardCount`,
      `${base}.functional.markCount`,
      `${base}.functional.contextRowCount`,
      `${base}.functional.visibleErrorCount`,
      `${base}.requests.timelineOffsets`,
      `${base}.requests.timelineLimits`,
      `${base}.requests.timelinePageCount`,
      `${base}.requests.detailCount`,
      `${base}.requests.eventEnvelopeCount`,
      `${base}.work.materializerCalls`,
      `${base}.work.materializerCallsByRole`,
      `${base}.work.finalDomNodeCount`,
      `${base}.work.finalTimelineNodeCount`,
    );
    for (const counter of exactCounterSet[scenarioName] || []) paths.push(`${base}.work.${counter}`);
  }
  return paths;
}

function distinctSummary(values) {
  const serialized = values.map((value) => JSON.stringify(value));
  return {
    expected: values[0],
    distinctValueCount: new Set(serialized).size,
  };
}

function calibrateExactCounters(artifacts) {
  const result = {};
  for (const scenarioName of Object.keys(artifacts[0]?.scenarios || {})) {
    const observationalFloor = new Set(DEMONSTRATED_OBSERVATIONAL_COUNTERS[scenarioName] || []);
    result[scenarioName] = ELIGIBLE_CALIBRATION_COUNTERS.filter((counter) => {
      const values = artifacts.map((artifact) => artifact.scenarios[scenarioName]?.work?.[counter]);
      return !observationalFloor.has(counter)
        && values.every((value) => Number.isFinite(value))
        && new Set(values).size === 1;
    });
    if (scenarioName === 'warmContextReveal') {
      result[scenarioName] = [...new Set([...result[scenarioName], ...ELIGIBLE_CALIBRATION_COUNTERS])];
    }
  }
  return result;
}

function aggregateArtifacts(profileKind, mode, artifacts, attempts, exactCounterSet = {}) {
  const paths = exactPaths(profileKind, artifacts, exactCounterSet);
  const hardExact = Object.fromEntries(paths.map((fieldPath) => [
    fieldPath,
    distinctSummary(artifacts.map((artifact) => getPath(artifact, fieldPath))),
  ]));
  const exactPathSet = new Set(paths);
  const numericByPath = new Map();
  for (const artifact of artifacts) {
    for (const [fieldPath, value] of Object.entries(flattenNumbers(artifact))) {
      if (exactPathSet.has(fieldPath)
          || fieldPath.includes('.functional.')
          || fieldPath.endsWith('.sequence')
          || fieldPath.includes('.timelineOffsets.')
          || fieldPath.includes('.timelineLimits.')) continue;
      const values = numericByPath.get(fieldPath) || [];
      values.push(value);
      numericByPath.set(fieldPath, values);
    }
  }
  const causal = profileKind === 'synthetic-browser'
    ? Object.fromEntries(Object.keys(artifacts[0]?.scenarios || {}).map((scenarioName) => [
      scenarioName,
      {
        passCount: artifacts.filter((artifact) => artifact.scenarios[scenarioName].requests.constraints.passed).length,
        repeatCount: artifacts.length,
      },
    ]))
    : {};
  const observational = Object.fromEntries([...numericByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fieldPath, values]) => [fieldPath, timingStats(values)]));
  const treeValues = artifacts.map((artifact) => artifact.identity?.profiledImplementationTreeHash);
  const proofValues = artifacts.map((artifact) => (
    profileKind === 'synthetic-browser'
      ? artifact.fixture?.semanticFixtureProof
      : artifact.snapshotProof?.allMatched
  ));
  const hardExactPassed = Object.values(hardExact).every((entry) => entry.distinctValueCount === 1);
  const causalPassed = Object.values(causal).every((entry) => entry.passCount === entry.repeatCount);
  const validAttempts = attempts.filter((attempt) => attempt.valid === true);
  const validPids = validAttempts.map((attempt) => attempt.pid);
  const distinctPidCount = new Set(validPids).size;
  const repetitionIndexes = artifacts.map((artifact) => (
    profileKind === 'private-corpus'
      ? artifact.options?.repetitionIndex
      : artifact.identity?.repetitionIndex
  ));
  const processIsolationPassed = validAttempts.length === artifacts.length
    && validPids.every((pid) => Number.isSafeInteger(pid) && pid >= 1)
    && distinctPidCount === validAttempts.length
    && repetitionIndexes.length === artifacts.length
    && repetitionIndexes.every((index) => (
      Number.isSafeInteger(index) && index >= 1 && index <= attempts.length
    ))
    && new Set(repetitionIndexes).size === repetitionIndexes.length;
  return {
    schemaVersion: 3,
    artifactKind: 'performance-wave-0-summary',
    profileKind,
    mode,
    expectedRepeatCount: attempts.length,
    validAttemptCount: artifacts.length,
    invalidAttemptCount: attempts.length - artifacts.length,
    processIsolation: {
      expectedProcessCount: validAttempts.length,
      distinctPidCount,
      repetitionIndexes,
      passed: processIsolationPassed,
    },
    identityEquality: distinctSummary(treeValues),
    proofEquality: distinctSummary(proofValues),
    hardExact,
    causal,
    exactCounterSet,
    observational,
    categoricalObservations: categoricalObservations(profileKind, artifacts),
    outliersRetained: true,
    acceptance: {
      passed: artifacts.length === attempts.length
        && processIsolationPassed
        && hardExactPassed
        && causalPassed
        && new Set(treeValues).size === 1
        && new Set(proofValues.map(JSON.stringify)).size === 1
        && proofValues.every(Boolean),
      numericalLatencyGate: false,
    },
  };
}

async function readJsonIfPresent(file, fallback, fsApi = fsp) {
  try {
    return JSON.parse(await fsApi.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function runRepetitionGroup(options, dependencies = {}) {
  if (options.profileKind === 'private-corpus') validateSealedCopyProbe(options.sealedCopyProbe);
  const fsApi = dependencies.fsp || fsp;
  const runOptions = await prepareRunBoundaries(options, dependencies);
  const outputDir = runOptions.outputDir;
  const profileDir = await ensureOutputDirectory(
    path.join(outputDir, runOptions.profileKind),
    runOptions.boundary,
    fsApi,
  );
  const writeOptions = { boundary: runOptions.boundary, fsp: fsApi };
  const workerFactory = dependencies.workerFactory
    || ((repetition) => defaultWorkerFactory(runOptions, repetition));
  const validateArtifact = dependencies.validateArtifact || artifactValidator(runOptions.profileKind);
  const computeSnapshotDigest = dependencies.computeSnapshotDigest
    || ((root) => computePrivateSnapshotDigest(root, { fsp: fsApi }));
  let referenceDigest = '';
  const groupCheckpoints = [];
  if (runOptions.profileKind === 'private-corpus') {
    referenceDigest = await computeSnapshotDigest(runOptions.snapshotRoot);
    groupCheckpoints.push(referenceDigest);
    await writeJsonAtomic(path.join(outputDir, '.private-proof-state.json'), {
      proofVersion: PRIVATE_PROOF_VERSION,
      algorithm: 'SHA-256',
      group: runOptions.snapshotGroup,
      copyMethod: runOptions.copyMethod,
      referenceDigest,
    }, writeOptions);
  }
  const attempts = [];
  const validArtifacts = [];
  for (let repetition = 1; repetition <= runOptions.repetitions; repetition += 1) {
    const runName = `run-${String(repetition).padStart(3, '0')}.json`;
    const runFile = path.join(profileDir, runName);
    let beforeDigest = '';
    if (runOptions.profileKind === 'private-corpus') {
      beforeDigest = await computeSnapshotDigest(runOptions.snapshotRoot);
      groupCheckpoints.push(beforeDigest);
    }
    const worker = workerFactory(repetition);
    const child = await (dependencies.runChild || runChild)(worker.command, worker.args, worker.options);
    let artifact = null;
    let valid = child.exitCode === 0;
    let failureReason = valid ? '' : (FAILURE_CODES.has(child.failureCode)
      ? child.failureCode
      : 'WORKER_EXIT');
    try {
      artifact = JSON.parse(child.stdout);
    } catch {
      valid = false;
      if (!failureReason) failureReason = 'INVALID_JSON';
    }
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      artifact = null;
      valid = false;
      if (!failureReason) failureReason = 'SCHEMA_OR_PRIVACY';
    }
    let afterDigest = '';
    if (runOptions.profileKind === 'private-corpus') {
      afterDigest = await computeSnapshotDigest(runOptions.snapshotRoot);
      groupCheckpoints.push(afterDigest);
      if (artifact) {
        artifact.snapshotProof = snapshotProofVerdict(
          referenceDigest,
          [beforeDigest, afterDigest],
          runOptions.snapshotGroup,
        );
        artifact.acceptance = {
          ...artifact.acceptance,
          snapshotProofVerifiedByRunner: artifact.snapshotProof.allMatched,
        };
      }
      if (beforeDigest !== referenceDigest || afterDigest !== referenceDigest) {
        valid = false;
        failureReason = preserveDirectFailure(failureReason, 'SNAPSHOT_MISMATCH');
      }
    }
    let artifactSafeToPersist = false;
    if (artifact) {
      try {
        validateArtifact(artifact);
        artifactSafeToPersist = true;
      } catch {
        valid = false;
        failureReason = preserveDirectFailure(failureReason, 'SCHEMA_OR_PRIVACY');
      }
      if (artifactSafeToPersist
          && runOptions.profileKind === 'synthetic-browser'
          && !artifact.acceptance?.passed) {
        valid = false;
        failureReason = preserveDirectFailure(failureReason, 'STRUCTURAL_ACCEPTANCE');
      }
      if (artifactSafeToPersist
          && runOptions.profileKind === 'private-corpus'
          && (!artifact.acceptance?.structural
            || !artifact.acceptance?.privacyAuditPassed
            || !artifact.acceptance?.snapshotProofVerifiedByRunner)) {
        valid = false;
        failureReason = preserveDirectFailure(failureReason, 'STRUCTURAL_ACCEPTANCE');
      }
    }
    if (artifact && artifactSafeToPersist) {
      await writeJsonAtomic(runFile, artifact, writeOptions);
    } else {
      await writeJsonAtomic(runFile, {
        schemaVersion: 3,
        artifactKind: 'invalid-worker-attempt',
        failureReason,
      }, writeOptions);
    }
    await assertArtifactBoundary(runFile, runOptions.boundary, fsApi);
    const artifactBytes = await fsApi.readFile(runFile);
    attempts.push({
      run: runName,
      pid: child.pid,
      exitStatus: child.exitCode,
      valid,
      failureReason,
      artifactSha256: sha256(artifactBytes),
    });
    if (valid) validArtifacts.push(artifact);
  }
  let groupProof = null;
  if (runOptions.profileKind === 'private-corpus') {
    const finalDigest = await computeSnapshotDigest(runOptions.snapshotRoot);
    groupCheckpoints.push(finalDigest);
    groupProof = snapshotProofVerdict(referenceDigest, groupCheckpoints, runOptions.snapshotGroup);
    if (!groupProof.allMatched) {
      for (const attempt of attempts) {
        attempt.valid = false;
        attempt.failureReason = preserveDirectFailure(
          attempt.failureReason,
          'SNAPSHOT_GROUP_MISMATCH',
        );
      }
      validArtifacts.length = 0;
    }
  }
  let exactCounterSet = {};
  if (runOptions.mode === 'calibration') exactCounterSet = calibrateExactCounters(validArtifacts);
  if (runOptions.calibrationFile) {
    const calibration = JSON.parse(await fsApi.readFile(runOptions.calibrationFile, 'utf8'));
    validateCalibrationArtifact(calibration);
    const calibrationMatches = calibration.schemaVersion === 3
      && calibration.artifactKind === 'performance-wave-0-calibration'
      && calibration.profileKind === 'synthetic-browser'
      && calibration.accepted === true
      && calibration.candidateCommitSha === validArtifacts[0]?.identity?.candidateCommitSha
      && calibration.targetSyncSha === validArtifacts[0]?.identity?.targetSyncSha
      && calibration.targetToCandidateDiffAlgorithm
        === validArtifacts[0]?.identity?.targetToCandidateDiffAlgorithm
      && calibration.targetToCandidateDiffSha256
        === validArtifacts[0]?.identity?.targetToCandidateDiffSha256
      && calibration.profiledImplementationTreeHash
        === validArtifacts[0]?.identity?.profiledImplementationTreeHash
      && calibration.semanticFixtureProof === validArtifacts[0]?.fixture?.semanticFixtureProof;
    if (!calibrationMatches) {
      for (const attempt of attempts) {
        attempt.valid = false;
        attempt.failureReason = preserveDirectFailure(
          attempt.failureReason,
          'CALIBRATION_MISMATCH',
        );
      }
      validArtifacts.length = 0;
    }
    exactCounterSet = calibration.exactCounterSet || {};
  }
  const summary = aggregateArtifacts(
    runOptions.profileKind,
    runOptions.mode,
    validArtifacts,
    attempts,
    exactCounterSet,
  );
  if (groupProof) {
    summary.snapshotEquality = {
      proofVersion: groupProof.proofVersion,
      algorithm: groupProof.algorithm,
      group: groupProof.group,
      checkpointCount: groupProof.checkpointCount,
      allMatched: groupProof.allMatched,
      copyMethod: runOptions.copyMethod,
    };
    summary.acceptance.passed = summary.acceptance.passed && groupProof.allMatched;
  }
  if (runOptions.profileKind === 'private-corpus') validatePrivateSummary(summary);
  await writeJsonAtomic(path.join(profileDir, 'summary.json'), summary, writeOptions);
  if (runOptions.mode === 'calibration') {
    await writeJsonAtomic(path.join(profileDir, 'calibration.json'), {
      schemaVersion: 3,
      artifactKind: 'performance-wave-0-calibration',
      profileKind: runOptions.profileKind,
      exactCounterSet,
      candidateCommitSha: validArtifacts[0]?.identity?.candidateCommitSha || '',
      targetSyncSha: validArtifacts[0]?.identity?.targetSyncSha || '',
      targetToCandidateDiffAlgorithm:
        validArtifacts[0]?.identity?.targetToCandidateDiffAlgorithm || '',
      targetToCandidateDiffSha256:
        validArtifacts[0]?.identity?.targetToCandidateDiffSha256 || '',
      profiledImplementationTreeHash:
        validArtifacts[0]?.identity?.profiledImplementationTreeHash || '',
      semanticFixtureProof: validArtifacts[0]?.fixture?.semanticFixtureProof || '',
      accepted: summary.acceptance.passed,
    }, writeOptions);
  }
  const manifestFile = path.join(outputDir, 'manifest.json');
  await assertArtifactBoundary(manifestFile, runOptions.boundary, fsApi);
  const manifest = await readJsonIfPresent(manifestFile, {
    schemaVersion: 3,
    artifactKind: 'performance-wave-0-manifest',
    groups: {},
  }, fsApi);
  validateManifest(manifest);
  manifest.groups[`${runOptions.profileKind}:${runOptions.mode}`] = {
    profileKind: runOptions.profileKind,
    mode: runOptions.mode,
    readOnlyAttested: runOptions.profileKind === 'private-corpus'
      ? runOptions.readOnlyAttested
      : null,
    copyMethod: runOptions.profileKind === 'private-corpus' ? runOptions.copyMethod : null,
    snapshotGroup: runOptions.profileKind === 'private-corpus' ? runOptions.snapshotGroup : null,
    sealedCopyProbe: runOptions.profileKind === 'private-corpus'
      ? runOptions.sealedCopyProbe
      : null,
    attempts,
  };
  validateManifest(manifest);
  await writeJsonAtomic(manifestFile, manifest, writeOptions);
  return { summary, attempts, validArtifacts, groupProof };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runRepetitionGroup(options);
  const progress = options.profileKind === 'private-corpus'
    ? {
      profiledImplementationTreeHash:
        result.validArtifacts[0]?.identity?.profiledImplementationTreeHash || '',
      groupLabel: options.snapshotGroup,
      repeatCount: options.repetitions,
      proofMatchVerdict: Boolean(result.groupProof?.allMatched),
    }
    : {
      profiledImplementationTreeHash:
        result.validArtifacts[0]?.identity?.profiledImplementationTreeHash || '',
      groupLabel: `${options.profileKind}-${options.mode}`,
      repeatCount: options.repetitions,
      proofMatchVerdict: result.summary.acceptance.passed,
    };
  process.stdout.write(`${JSON.stringify(progress)}\n`);
  if (!result.summary.acceptance.passed) process.exitCode = 1;
}

function runnerCliErrorLine(error) {
  const code = FAILURE_CODES.has(error?.code) ? error.code : 'RUNNER_FAILURE';
  return `PERFORMANCE_WAVE_0_ERROR:${code}\n`;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(runnerCliErrorLine(error));
    process.exitCode = 1;
  });
}

module.exports = {
  aggregateArtifacts,
  assertArtifactBoundary,
  buildReviewIdentity,
  calibrateExactCounters,
  canonicalizePrivateBoundaries,
  ensureOutputDirectory,
  isPathInsideOrSame,
  parseArgs,
  postRunDocumentationHash,
  prepareOutputBoundary,
  prepareRunBoundaries,
  runChild,
  runRepetitionGroup,
  runnerCliErrorLine,
  timingStats,
  validateManifest,
  validateSealedCopyProbe,
  validateCalibrationArtifact,
  validateTimelineArtifact,
  writeJsonAtomic,
};
