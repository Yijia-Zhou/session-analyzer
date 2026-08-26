'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const v8 = require('node:v8');
const {
  getSourceAdapter,
  materializeSessionForIndex,
  normalizeSourceKind,
  queryForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { SESSION_LIFECYCLE } = require('../src/source-adapter-contract');
const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
} = require('../src/materialized-session-owner');
const {
  profiledImplementationTreeHash,
  profiledTrackedDiffSha256AtRun,
  utf8OrdinalCompare,
} = require('./performance-wave-0-identity');

const PROFILE_QUERY = '__session_analyzer_absent_project_query_profile_phrase__';
const PROFILE_LAYERS = Object.freeze(['main', 'protocol', 'raw']);
const PROFILE_SCHEMA_VERSION = 3;
const PRIVATE_PROOF_VERSION = 2;
const PRIVATE_PROOF_TAG = 'performance-wave-0-private-copy-v2';
const INSPECTED_BASE_SHA = 'd370cc7bca56380457c147dc4c33637a0baedf68';
const PRE_WAVE_0_HEAD = '377a0356fe884a5a95f234bd5d6f22240ca8052b';
const SERVER_ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'identity',
  'environment',
  'options',
  'invocationTemplate',
  'snapshotProof',
  'corpus',
  'logicalAccountedBytes',
  'runtimeMemory',
  'build',
  'validation',
  'commit',
  'materialization',
  'scans',
  'acceptance',
]);
const FORBIDDEN_PRIVATE_KEYS = new Set([
  'argv',
  'command',
  'commands',
  'content',
  'cwd',
  'dependencySetId',
  'digest',
  'hmac',
  'message',
  'output',
  'path',
  'prompt',
  'rawUrl',
  'repoPath',
  'sessionId',
  'sourceHomePath',
  'sourcePath',
  'url',
]);
const PRIVATE_PROOF_ERROR_CODES = new Set([
  'PRIVATE_SNAPSHOT_ROOT_INVALID',
  'PRIVATE_SNAPSHOT_ENTRY_INVALID',
  'PRIVATE_SNAPSHOT_ESCAPE',
  'PRIVATE_SNAPSHOT_HARD_LINK',
  'PRIVATE_SNAPSHOT_IO_FAILURE',
]);

function usageError(message) {
  const error = new Error(`${message}\nUsage: node --expose-gc scripts/project-query-store-profile.js --source <codex|claude-code> --repo <path> [--source-home <path>] [--repeats <1..20>] [--snapshot-group <opaque-label>] [--repetition-index <n> --repetition-count <n>]`);
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = {
    source: '',
    repo: '',
    sourceHome: '',
    repeats: 3,
    snapshotGroup: 'unassigned',
    repetitionIndex: 1,
    repetitionCount: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (![
      '--source', '--repo', '--source-home', '--repeats', '--snapshot-group',
      '--repetition-index', '--repetition-count',
    ].includes(name)) {
      throw usageError(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--source') options.source = normalizeSourceKind(value);
    if (name === '--repo') options.repo = path.resolve(value);
    if (name === '--source-home') options.sourceHome = path.resolve(value);
    if (name === '--snapshot-group') {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(value)) {
        throw usageError('--snapshot-group must be an opaque alphanumeric/hyphen label of at most 64 characters');
      }
      options.snapshotGroup = value;
    }
    if (name === '--repeats') {
      options.repeats = Number(value);
      if (!Number.isSafeInteger(options.repeats) || options.repeats < 1 || options.repeats > 20) {
        throw usageError('--repeats must be an integer from 1 through 20');
      }
    }
    if (name === '--repetition-index' || name === '--repetition-count') {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw usageError(`${name} must be a positive integer`);
      }
      if (name === '--repetition-index') options.repetitionIndex = parsed;
      else options.repetitionCount = parsed;
    }
  }
  if (!options.source) throw usageError('--source is required');
  if (!options.repo) throw usageError('--repo is required');
  if (options.repetitionIndex > options.repetitionCount) {
    throw usageError('--repetition-index must not exceed --repetition-count');
  }
  const adapter = getSourceAdapter(options.source);
  if (!adapter) throw usageError(`Unsupported source: ${options.source}`);
  return { ...options, adapter };
}

function memorySample() {
  const memory = process.memoryUsage();
  return {
    heapUsed: memory.heapUsed,
    rss: memory.rss,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function memoryDelta(after, before) {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
}

function memoryMaximum(left, right) {
  return Object.fromEntries(Object.keys(left).map((key) => [key, Math.max(left[key], right[key])]));
}

function redactedSessionSelection(session) {
  return {
    sourceBytes: session.bytes,
    rawRows: session.rawEventCount,
    logicalRows: session.logicalEventCount,
  };
}

function timingStats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    repeatCount: sorted.length,
    medianMs,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function aggregateRows(store) {
  const rowCounts = { main: 0, protocol: 0, raw: 0 };
  for (const shards of store.shardsBySessionId.values()) {
    for (const layer of PROFILE_LAYERS) rowCounts[layer] += shards[layer].rowCount;
  }
  return rowCounts;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function accountedIndexBytes(index) {
  const sessionMetadataBytes = index.sessions.reduce((sum, session) => sum + jsonBytes(session), 0);
  const dependencyBytes = index.materializationDependencies instanceof Map
    ? [...index.materializationDependencies.values()]
      .reduce((sum, dependencySet) => sum + jsonBytes(dependencySet), 0)
    : 0;
  const catalogBytes = jsonBytes({
    eventKinds: index.eventKinds,
    codeModeRequests: index.codeModeRequests,
  });
  const legacyRawOwnerBytes = Number(index.legacyRawOwners?.accountedBytes || 0);
  const queryStoreBytes = Number(index.projectQueryStore?.accountedBytes || 0);
  return {
    sessionMetadataBytes,
    dependencyBytes,
    catalogBytes,
    legacyRawOwnerBytes,
    queryStoreBytes,
    totalBytes: sessionMetadataBytes
      + dependencyBytes
      + catalogBytes
      + legacyRawOwnerBytes
      + queryStoreBytes,
  };
}

function publicOptions(options) {
  return {
    source: options.source,
    repo: '<redacted>',
    sourceHome: options.sourceHome ? '<redacted>' : '<adapter-default>',
    repeats: options.repeats,
    snapshotGroup: options.snapshotGroup,
    repetitionIndex: options.repetitionIndex,
    repetitionCount: options.repetitionCount,
  };
}

function invocationTemplate() {
  return {
    worker: 'project-query',
    runtime: 'node-expose-gc',
    inputRole: 'external-private-copy',
    outputRole: 'external-artifact-directory',
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readNpmVersion() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm --version']
    : ['--version'];
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

async function bundledChromiumVersion() {
  const packageRoot = path.dirname(require.resolve('playwright-core/package.json'));
  const registry = JSON.parse(await fsp.readFile(path.join(packageRoot, 'browsers.json'), 'utf8'));
  const chromium = registry.browsers?.find((entry) => entry.name === 'chromium');
  if (!chromium?.browserVersion) throw new Error('Bundled Chromium version metadata is unavailable');
  return chromium.browserVersion;
}

function lengthDelimitedHashRecords(records) {
  const hash = crypto.createHash('sha256');
  for (const value of records) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(data.length));
    hash.update(length);
    hash.update(data);
  }
  return hash.digest('hex');
}

function privateProofError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalPathInsideOrSame(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizedProofPath(relative) {
  return relative.split(path.sep).join('/');
}

async function enumeratePrivateSnapshotFiles(root, dependencies = {}) {
  const fsApi = dependencies.fsp || fsp;
  const resolvedRoot = path.resolve(root);
  try {
    const rootStat = await fsApi.lstat(resolvedRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw privateProofError('PRIVATE_SNAPSHOT_ROOT_INVALID');
    }
    const canonicalRoot = await fsApi.realpath(resolvedRoot);
    const files = [];
    async function visit(absoluteDirectory, relativeDirectory) {
      const names = await fsApi.readdir(absoluteDirectory);
      for (const name of names) {
        const relative = relativeDirectory ? path.join(relativeDirectory, name) : name;
        const absolute = path.join(absoluteDirectory, name);
        const stat = await fsApi.lstat(absolute);
        if (stat.isSymbolicLink()) throw privateProofError('PRIVATE_SNAPSHOT_ENTRY_INVALID');
        const canonical = await fsApi.realpath(absolute);
        if (!canonicalPathInsideOrSame(canonical, canonicalRoot)
            || path.relative(path.resolve(absolute), canonical) !== '') {
          throw privateProofError('PRIVATE_SNAPSHOT_ESCAPE');
        }
        if (stat.isDirectory()) {
          await visit(absolute, relative);
          continue;
        }
        if (!stat.isFile()) throw privateProofError('PRIVATE_SNAPSHOT_ENTRY_INVALID');
        if (Number.isSafeInteger(stat.nlink) && stat.nlink > 1) {
          throw privateProofError('PRIVATE_SNAPSHOT_HARD_LINK');
        }
        files.push({
          absolute: canonical,
          relative: normalizedProofPath(relative),
          byteLength: stat.size,
        });
      }
    }
    await visit(canonicalRoot, '');
    files.sort((left, right) => utf8OrdinalCompare(left.relative, right.relative));
    return { canonicalRoot, files };
  } catch (error) {
    if (PRIVATE_PROOF_ERROR_CODES.has(error?.code)) throw error;
    throw privateProofError('PRIVATE_SNAPSHOT_IO_FAILURE');
  }
}

async function computePrivateSnapshotDigest(root, dependencies = {}) {
  const fsApi = dependencies.fsp || fsp;
  const { files } = await enumeratePrivateSnapshotFiles(root, dependencies);
  const records = [PRIVATE_PROOF_TAG];
  try {
    for (const entry of files) {
      const data = await fsApi.readFile(entry.absolute);
      if (data.length !== entry.byteLength) throw privateProofError('PRIVATE_SNAPSHOT_IO_FAILURE');
      records.push('regular-file', entry.relative, String(data.length), data);
    }
  } catch (error) {
    if (PRIVATE_PROOF_ERROR_CODES.has(error?.code)) throw error;
    throw privateProofError('PRIVATE_SNAPSHOT_IO_FAILURE');
  }
  return lengthDelimitedHashRecords(records);
}

function snapshotProofVerdict(referenceDigest, checkpointDigests, group = 'unassigned') {
  const matches = checkpointDigests.map((digest) => digest === referenceDigest);
  return {
    proofVersion: PRIVATE_PROOF_VERSION,
    algorithm: 'SHA-256',
    group,
    checkpointCount: matches.length,
    allMatched: matches.every(Boolean),
    matches,
  };
}

function validateInvocationTemplate(value) {
  const expected = invocationTemplate();
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error('Private artifact invocationTemplate violates its closed schema');
  }
}

function assertNoPrivateLeak(value, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateLeak(entry, [...keyPath, String(index)]));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_PRIVATE_KEYS.has(key)) {
        throw new Error(`Private artifact contains forbidden field ${[...keyPath, key].join('.')}`);
      }
      if (/session.*(?:id|digest)|(?:id|digest).*session/i.test(key)) {
        throw new Error(`Private artifact contains forbidden Session identity field ${[...keyPath, key].join('.')}`);
      }
      if (/private.*(?:digest|checksum)|(?:digest|checksum).*private/i.test(key)) {
        throw new Error(`Private artifact contains forbidden private proof field ${[...keyPath, key].join('.')}`);
      }
      assertNoPrivateLeak(entry, [...keyPath, key]);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (path.posix.isAbsolute(value)
      || path.win32.isAbsolute(value)
      || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value)
      || /\.jsonl\b/i.test(value)
      || /https?:\/\//i.test(value)) {
    throw new Error(`Private artifact contains forbidden string value at ${keyPath.join('.')}`);
  }
}

function assertClosedKeys(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Private artifact ${label} must be an object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))) {
    throw new Error(`Private artifact ${label} contains an accessor`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Private artifact ${label} violates its closed nested schema`);
  }
}

const MEMORY_SAMPLE_FIELDS = Object.freeze(['heapUsed', 'rss', 'external', 'arrayBuffers']);
const TIMING_STATS_FIELDS = Object.freeze(['repeatCount', 'medianMs', 'minMs', 'maxMs']);
const SELECTION_FIELDS = Object.freeze(['sourceBytes', 'rawRows', 'logicalRows']);
const OWNER_STATS_FIELDS = Object.freeze([
  'indexRevision', 'retired', 'maxEstimatedMaterializedBytes', 'maxCachedSessions',
  'cacheSessionCount', 'estimatedMaterializedBytes', 'queuedJobCount', 'activeJobCount',
  'waiterCount', 'hits', 'misses', 'coalesced', 'admitted', 'busy', 'started', 'completed',
  'failed', 'waiterAborts', 'jobAborts', 'retiredJobs', 'peakCacheSessionCount',
  'peakEstimatedMaterializedBytes', 'cacheAdmissions', 'cacheTouches', 'cachePromotions',
  'evictions', 'evictedEstimatedBytes', 'speculativeEvictions', 'foregroundEvictions',
  'oversizeForegroundAdmissions', 'speculativeAdmissionRejections', 'prewarmScheduled',
  'prewarmStarted', 'prewarmCompleted', 'prewarmPromoted', 'prewarmPreempted',
  'prewarmFailed', 'prewarmSkippedBusy', 'prewarmSkippedSize', 'prewarmSkippedBudget',
  'prewarmSkippedCached', 'prewarmSkippedCacheCapacity', 'prewarmRetired', 'prewarmCacheHits',
]);
const MATERIALIZATION_PHASE_FIELDS = new Set([
  'materialized_pre_adapter_validation', 'adapter_materialization',
  'adapter_source_stream', 'adapter_source_read_wait', 'adapter_source_record_parse',
  'adapter_source_verification_read', 'adapter_source_canonical_construction',
  'adapter_source_finalization', 'materialized_post_adapter_ownership',
  'materialized_canonical_validation', 'materialized_private_validation',
  'materialized_private_fingerprint_capture', 'materialized_private_callback',
  'materialized_private_fingerprint_recheck', 'materialized_fingerprint_reuse',
  'materialized_projection', 'materialized_fingerprint_recheck',
  'materialized_final_admission_check',
]);

function validateMemorySample(value, label) {
  assertClosedKeys(value, MEMORY_SAMPLE_FIELDS, label);
}

function validateTimingStats(value, label) {
  assertClosedKeys(value, TIMING_STATS_FIELDS, label);
}

function validateSelection(value, label) {
  assertClosedKeys(value, SELECTION_FIELDS, label);
}

function validateOwnerStats(value, label) {
  assertClosedKeys(value, OWNER_STATS_FIELDS, label);
}

function validateMaterializedClass(value, label) {
  assertClosedKeys(value, [
    'selection', 'coldMs', 'warm', 'warmRepeatCount', 'adapterCalls', 'exactWarmIdentity',
    'estimatedOwnerBytes', 'processMaxRssBefore', 'processMaxRssAfter',
    'materializationPhaseMs', 'attributedColdMs', 'unattributedColdMs',
    'projectionChunkSamples', 'transientPeak', 'transientPeakOverBefore', 'afterCache',
    'afterCacheDelta', 'afterRetirement', 'afterRetirementDelta',
  ], label);
  validateSelection(value.selection, `${label}.selection`);
  validateTimingStats(value.warm, `${label}.warm`);
  validateMemorySample(value.transientPeak, `${label}.transientPeak`);
  validateMemorySample(value.transientPeakOverBefore, `${label}.transientPeakOverBefore`);
  validateMemorySample(value.afterCache, `${label}.afterCache`);
  validateMemorySample(value.afterCacheDelta, `${label}.afterCacheDelta`);
  validateMemorySample(value.afterRetirement, `${label}.afterRetirement`);
  validateMemorySample(value.afterRetirementDelta, `${label}.afterRetirementDelta`);
  if (!value.materializationPhaseMs || typeof value.materializationPhaseMs !== 'object'
      || Object.keys(value.materializationPhaseMs).some((field) => !MATERIALIZATION_PHASE_FIELDS.has(field))) {
    throw new Error(`Private artifact ${label}.materializationPhaseMs violates its closed nested schema`);
  }
}

function validatePrivateNestedSchema(artifact) {
  assertClosedKeys(artifact.identity, [
    'repository', 'targetBranch', 'currentBranch', 'inspectedBaseSha', 'preWave0Head', 'head',
    'dirty', 'profiledTrackedDiffSha256AtRun', 'profiledImplementationTreeHash',
    'repetitionIndex', 'repetitionCount',
    'recordedAt',
  ], 'identity');
  assertClosedKeys(artifact.environment, [
    'node', 'v8', 'npm', 'playwright', 'chromium', 'execArgv', 'exposedGc', 'heapLimitBytes',
    'platform', 'osRelease', 'architecture', 'cpu', 'cpuCount', 'totalMemoryBytes', 'ci',
    'headless', 'viewport', 'locale', 'timezone',
  ], 'environment');
  assertClosedKeys(artifact.options, [
    'source', 'repo', 'sourceHome', 'repeats', 'snapshotGroup', 'repetitionIndex',
    'repetitionCount',
  ], 'options');
  assertClosedKeys(artifact.snapshotProof, [
    'proofVersion', 'algorithm', 'group', 'checkpointCount', 'allMatched', 'matches',
  ], 'snapshotProof');
  assertClosedKeys(artifact.corpus, [
    'sourceKind', 'sessionCount', 'rowCounts', 'sourceBytes', 'dependencyCount',
  ], 'corpus');
  assertClosedKeys(artifact.corpus.rowCounts, PROFILE_LAYERS, 'corpus.rowCounts');
  assertClosedKeys(artifact.logicalAccountedBytes, [
    'sessionMetadataBytes', 'dependencyBytes', 'catalogBytes', 'legacyRawOwnerBytes',
    'queryStoreBytes', 'totalBytes',
  ], 'logicalAccountedBytes');
  assertClosedKeys(artifact.runtimeMemory, [
    'beforeBuild', 'committedAfterGc', 'committedDelta', 'processMaxRssBytes',
    'heapLimitBytes', 'exposedGc',
  ], 'runtimeMemory');
  validateMemorySample(artifact.runtimeMemory.beforeBuild, 'runtimeMemory.beforeBuild');
  validateMemorySample(artifact.runtimeMemory.committedAfterGc, 'runtimeMemory.committedAfterGc');
  validateMemorySample(artifact.runtimeMemory.committedDelta, 'runtimeMemory.committedDelta');
  assertClosedKeys(artifact.build, [
    'invocationCount', 'elapsedMs', 'before', 'observedTransientPeak',
    'observedTransientPeakOverBefore', 'processMaxRssBytesAtBuildEnd', 'sampling',
  ], 'build');
  validateMemorySample(artifact.build.before, 'build.before');
  validateMemorySample(artifact.build.observedTransientPeak, 'build.observedTransientPeak');
  validateMemorySample(artifact.build.observedTransientPeakOverBefore, 'build.observedTransientPeakOverBefore');
  assertClosedKeys(artifact.build.sampling, [
    'progressBoundarySamples', 'preRawCompactionSamples', 'postFinalizeSamples',
  ], 'build.sampling');
  assertClosedKeys(artifact.validation, [
    'invocationCount', 'elapsedMs', 'before', 'observedTransientPeak',
    'observedTransientPeakOverBefore', 'processMaxRssBytesAfterValidation', 'chunkSamples',
  ], 'validation');
  validateMemorySample(artifact.validation.before, 'validation.before');
  validateMemorySample(artifact.validation.observedTransientPeak, 'validation.observedTransientPeak');
  validateMemorySample(artifact.validation.observedTransientPeakOverBefore, 'validation.observedTransientPeakOverBefore');
  assertClosedKeys(artifact.commit, [
    'arithmeticBuildPlusValidationMs', 'observedTransientPeak',
    'observedTransientPeakOverBefore', 'processMaxRssBytes', 'committedAfterGc', 'committedDelta',
  ], 'commit');
  for (const field of [
    'observedTransientPeak', 'observedTransientPeakOverBefore', 'committedAfterGc', 'committedDelta',
  ]) validateMemorySample(artifact.commit[field], `commit.${field}`);
  assertClosedKeys(artifact.materialization, [
    'candidateCount', 'ordinals', 'small', 'medium', 'large', 'largest', 'coldQueueing',
    'quickSessionSwitch', 'largestCancellation',
  ], 'materialization');
  assertClosedKeys(artifact.materialization.ordinals, ['small', 'medium', 'large', 'largest'], 'materialization.ordinals');
  for (const name of ['small', 'medium', 'large', 'largest']) {
    validateMaterializedClass(artifact.materialization[name], `materialization.${name}`);
  }
  if (artifact.materialization.coldQueueing !== null) {
    assertClosedKeys(artifact.materialization.coldQueueing, [
      'first', 'second', 'firstWaitToStartMs', 'firstMaterializationMs', 'secondQueueWaitMs',
      'secondMaterializationMs', 'secondTotalMs', 'queueDepthAtSecondAdmission',
      'activeCountAtSecondAdmission', 'adapterCalls', 'finalStats',
    ], 'materialization.coldQueueing');
    validateSelection(artifact.materialization.coldQueueing.first, 'materialization.coldQueueing.first');
    validateSelection(artifact.materialization.coldQueueing.second, 'materialization.coldQueueing.second');
    validateOwnerStats(artifact.materialization.coldQueueing.finalStats, 'materialization.coldQueueing.finalStats');
  }
  if (artifact.materialization.quickSessionSwitch !== null) {
    assertClosedKeys(artifact.materialization.quickSessionSwitch, [
      'first', 'second', 'sourceStreamToSwitchMs', 'switchToAbortObservationMs',
      'switchToWaiterRejectionMs', 'secondQueueWaitMs', 'switchToSecondCompletionMs',
      'queueDepthAtSecondAdmission', 'activeCountAtSecondAdmission', 'adapterCalls', 'finalStats',
    ], 'materialization.quickSessionSwitch');
    validateSelection(artifact.materialization.quickSessionSwitch.first, 'materialization.quickSessionSwitch.first');
    validateSelection(artifact.materialization.quickSessionSwitch.second, 'materialization.quickSessionSwitch.second');
    validateOwnerStats(artifact.materialization.quickSessionSwitch.finalStats, 'materialization.quickSessionSwitch.finalStats');
  }
  assertClosedKeys(artifact.materialization.largestCancellation, [
    'selection', 'queuedToAbortMs', 'queuedToWaiterRejectionMs', 'queuedToJobSettlementMs',
    'cacheSessionCount', 'completedCount',
  ], 'materialization.largestCancellation');
  validateSelection(artifact.materialization.largestCancellation.selection, 'materialization.largestCancellation.selection');
  assertClosedKeys(artifact.scans, PROFILE_LAYERS, 'scans');
  for (const layer of PROFILE_LAYERS) {
    const scan = artifact.scans[layer];
    assertClosedKeys(scan, [
      'oracle', 'packed', 'chunks', 'transientDecodePeak', 'transientDecodePeakOverCommitted',
    ], `scans.${layer}`);
    if (scan.oracle !== null) validateTimingStats(scan.oracle, `scans.${layer}.oracle`);
    validateTimingStats(scan.packed, `scans.${layer}.packed`);
    validateMemorySample(scan.transientDecodePeak, `scans.${layer}.transientDecodePeak`);
    validateMemorySample(scan.transientDecodePeakOverCommitted, `scans.${layer}.transientDecodePeakOverCommitted`);
  }
  assertClosedKeys(artifact.acceptance, [
    'structural', 'privacyAuditPassed', 'snapshotProofVerifiedByRunner', 'numericalLatencyGate',
  ], 'acceptance');
}

function validatePrivateArtifact(artifact) {
  const fields = Object.keys(artifact).sort();
  const expected = [...SERVER_ARTIFACT_FIELDS].sort();
  if (JSON.stringify(fields) !== JSON.stringify(expected)) {
    throw new Error('Private artifact top-level schema is not closed');
  }
  if (artifact.schemaVersion !== PROFILE_SCHEMA_VERSION
      || artifact.artifactKind !== 'project-query-server-run'
      || artifact.snapshotProof?.proofVersion !== PRIVATE_PROOF_VERSION) {
    throw new Error('Private artifact schema identity is invalid');
  }
  validateInvocationTemplate(artifact.invocationTemplate);
  validatePrivateNestedSchema(artifact);
  assertNoPrivateLeak(artifact);
  return true;
}

function validatePrivateSummary(summary) {
  assertClosedKeys(summary, [
    'schemaVersion', 'artifactKind', 'profileKind', 'mode', 'expectedRepeatCount',
    'validAttemptCount', 'invalidAttemptCount', 'processIsolation', 'identityEquality',
    'proofEquality', 'hardExact', 'causal', 'exactCounterSet', 'observational',
    'categoricalObservations', 'outliersRetained', 'acceptance', 'snapshotEquality',
  ], 'summary');
  if (summary.schemaVersion !== PROFILE_SCHEMA_VERSION
      || summary.artifactKind !== 'performance-wave-0-summary'
      || summary.profileKind !== 'private-corpus') {
    throw new Error('Private summary schema identity is invalid');
  }
  assertClosedKeys(summary.snapshotEquality, [
    'proofVersion', 'algorithm', 'group', 'checkpointCount', 'allMatched', 'copyMethod',
  ], 'summary.snapshotEquality');
  if (summary.snapshotEquality.proofVersion !== PRIVATE_PROOF_VERSION
      || summary.snapshotEquality.algorithm !== 'SHA-256'
      || summary.snapshotEquality.copyMethod !== 'independent-byte-copy'
      || typeof summary.snapshotEquality.group !== 'string'
      || !summary.snapshotEquality.group
      || !Number.isSafeInteger(summary.snapshotEquality.checkpointCount)
      || summary.snapshotEquality.checkpointCount < 1
      || typeof summary.snapshotEquality.allMatched !== 'boolean') {
    throw new Error('Private summary snapshot equality metadata is invalid');
  }
  assertNoPrivateLeak(summary);
  return true;
}

function gitText(args) {
  return execFileSync('git', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
}

async function collectIdentity(options) {
  const repoRoot = path.join(__dirname, '..');
  const status = gitText(['status', '--porcelain', '--untracked-files=all']);
  return {
    repository: 'Yijia-Zhou/session-analyzer',
    targetBranch: 'towards-0.2.0',
    currentBranch: gitText(['branch', '--show-current']),
    inspectedBaseSha: INSPECTED_BASE_SHA,
    preWave0Head: PRE_WAVE_0_HEAD,
    head: gitText(['rev-parse', 'HEAD']),
    dirty: Boolean(status),
    profiledTrackedDiffSha256AtRun: profiledTrackedDiffSha256AtRun(repoRoot),
    profiledImplementationTreeHash: await profiledImplementationTreeHash(repoRoot),
    repetitionIndex: options.repetitionIndex,
    repetitionCount: options.repetitionCount,
    recordedAt: new Date().toISOString(),
  };
}

const MATERIALIZATION_TOP_LEVEL_PHASES = Object.freeze([
  'materialized_pre_adapter_validation',
  'adapter_materialization',
  'materialized_post_adapter_ownership',
  'materialized_canonical_validation',
  'materialized_private_validation',
  'materialized_fingerprint_reuse',
  'materialized_projection',
  'materialized_fingerprint_recheck',
  'materialized_final_admission_check',
]);

function phaseTimingRecorder(recordSample) {
  const active = new Map();
  const durations = new Map();
  return {
    observe({ phase, state, durationMs }) {
      recordSample();
      if (state === 'duration' && Number.isFinite(durationMs) && durationMs >= 0) {
        durations.set(phase, (durations.get(phase) || 0) + durationMs);
      }
      if (state === 'start') active.set(phase, performance.now());
      if (state === 'end' && active.has(phase)) {
        durations.set(phase, (durations.get(phase) || 0) + performance.now() - active.get(phase));
        active.delete(phase);
      }
    },
    result() {
      return Object.fromEntries(durations);
    },
  };
}

async function profileMaterializedSession(index, session, indexRevision) {
  if (global.gc) global.gc();
  const before = memorySample();
  let transientPeak = before;
  let projectionChunkSamples = 0;
  const recordSample = () => {
    transientPeak = memoryMaximum(transientPeak, memorySample());
  };
  const phaseTimings = phaseTimingRecorder(recordSample);
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  let adapterCalls = 0;
  const processMaxRssBefore = process.resourceUsage().maxRSS * 1024;
  const sampler = setInterval(recordSample, 10);
  sampler.unref();
  const coldStarted = performance.now();
  let cold;
  try {
    cold = await owner.get(session, null, ({ signal }) => {
      adapterCalls += 1;
      return materializeSessionForIndex(index, session, {
        signal,
        onProjectionChunk() {
          projectionChunkSamples += 1;
          recordSample();
        },
        onMaterializationPhase: phaseTimings.observe,
      });
    });
  } finally {
    clearInterval(sampler);
  }
  const coldMs = performance.now() - coldStarted;
  recordSample();
  if (global.gc) global.gc();
  const afterCache = memorySample();
  const warmTimings = [];
  let warm = null;
  let exactWarmIdentity = true;
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const warmStarted = performance.now();
    warm = await owner.get(session, null, async () => {
      adapterCalls += 1;
      return null;
    });
    warmTimings.push(performance.now() - warmStarted);
    exactWarmIdentity = exactWarmIdentity && warm === cold;
  }
  if (!exactWarmIdentity) throw new Error(`Materialization profile lost warm identity for ${session.id}`);
  const ownerStats = owner.stats();
  const retirement = new Error('Materialization profile retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
  cold = null;
  warm = null;
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  if (global.gc) global.gc();
  const afterRetirement = memorySample();
  const materializationPhaseMs = phaseTimings.result();
  const attributedColdMs = MATERIALIZATION_TOP_LEVEL_PHASES.reduce(
    (total, phase) => total + Number(materializationPhaseMs[phase] || 0),
    0,
  );
  return {
    selection: redactedSessionSelection(session),
    coldMs,
    warm: timingStats(warmTimings),
    warmRepeatCount: warmTimings.length,
    adapterCalls,
    exactWarmIdentity,
    estimatedOwnerBytes: ownerStats.peakEstimatedMaterializedBytes,
    processMaxRssBefore,
    processMaxRssAfter: process.resourceUsage().maxRSS * 1024,
    materializationPhaseMs,
    attributedColdMs,
    unattributedColdMs: Math.max(0, coldMs - attributedColdMs),
    projectionChunkSamples,
    transientPeak,
    transientPeakOverBefore: memoryDelta(transientPeak, before),
    afterCache,
    afterCacheDelta: memoryDelta(afterCache, before),
    afterRetirement,
    afterRetirementDelta: memoryDelta(afterRetirement, before),
  };
}

async function profileLargeMaterializationCancellation(index, session, indexRevision) {
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  const waiterController = new AbortController();
  let cancellationQueuedAt = 0;
  let abortObservedAt = 0;
  const pending = owner.get(session, waiterController.signal, ({ signal }) => (
    materializeSessionForIndex(index, session, {
      signal,
      onProjectionChunk({ phase }) {
        if (phase !== 'materialized_projection' || cancellationQueuedAt !== 0) return;
        cancellationQueuedAt = performance.now();
        setImmediate(() => {
          abortObservedAt = performance.now();
          waiterController.abort();
        });
      },
    })
  ));
  let rejection;
  try {
    await pending;
  } catch (error) {
    rejection = error;
  }
  const waiterRejectedAt = performance.now();
  while (scheduler.active.size > 0) await new Promise((resolve) => setImmediate(resolve));
  const jobSettledAt = performance.now();
  if (rejection?.name !== 'AbortError' || cancellationQueuedAt === 0 || abortObservedAt === 0) {
    throw new Error(`Large materialization cancellation profile did not observe AbortError for ${session.id}`);
  }
  const result = {
    selection: redactedSessionSelection(session),
    queuedToAbortMs: abortObservedAt - cancellationQueuedAt,
    queuedToWaiterRejectionMs: waiterRejectedAt - cancellationQueuedAt,
    queuedToJobSettlementMs: jobSettledAt - cancellationQueuedAt,
    cacheSessionCount: owner.cache.size,
    completedCount: owner.stats().completed,
  };
  const retirement = new Error('Materialization cancellation profile retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
  return result;
}

function selectMaterializationCandidates(sessions) {
  const candidates = [...sessions]
    .filter((session) => session.bytes > 0)
    .sort((left, right) => left.bytes - right.bytes || left.id.localeCompare(right.id));
  if (candidates.length === 0) return null;
  const ordinalAt = (fraction) => Math.min(
    candidates.length,
    Math.max(1, Math.ceil(candidates.length * fraction)),
  );
  const select = (ordinal) => ({ ordinal, session: candidates[ordinal - 1] });
  return {
    candidateCount: candidates.length,
    small: select(ordinalAt(0.1)),
    medium: select(ordinalAt(0.5)),
    large: select(ordinalAt(0.9)),
    largest: select(candidates.length),
  };
}

async function profileColdQueueing(index, first, second, indexRevision) {
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  let resolveFirstStarted;
  const firstStarted = new Promise((resolve) => { resolveFirstStarted = resolve; });
  let firstStartedAt = 0;
  let firstCompletedAt = 0;
  let secondStartedAt = 0;
  let secondCompletedAt = 0;
  let adapterCalls = 0;
  try {
    const firstRequestedAt = performance.now();
    const firstPending = owner.get(first, null, ({ signal }) => {
      adapterCalls += 1;
      firstStartedAt = performance.now();
      resolveFirstStarted();
      return materializeSessionForIndex(index, first, { signal });
    }).then((value) => {
      firstCompletedAt = performance.now();
      return value;
    });
    await firstStarted;
    const secondRequestedAt = performance.now();
    const secondPending = owner.get(second, null, ({ signal }) => {
      adapterCalls += 1;
      secondStartedAt = performance.now();
      return materializeSessionForIndex(index, second, { signal });
    }).then((value) => {
      secondCompletedAt = performance.now();
      return value;
    });
    const admissionStats = owner.stats();
    await Promise.all([firstPending, secondPending]);
    while (scheduler.active.size > 0) await new Promise((resolve) => setImmediate(resolve));
    return {
      first: redactedSessionSelection(first),
      second: redactedSessionSelection(second),
      firstWaitToStartMs: firstStartedAt - firstRequestedAt,
      firstMaterializationMs: firstCompletedAt - firstStartedAt,
      secondQueueWaitMs: secondStartedAt - secondRequestedAt,
      secondMaterializationMs: secondCompletedAt - secondStartedAt,
      secondTotalMs: secondCompletedAt - secondRequestedAt,
      queueDepthAtSecondAdmission: admissionStats.queuedJobCount,
      activeCountAtSecondAdmission: admissionStats.activeJobCount,
      adapterCalls,
      finalStats: owner.stats(),
    };
  } finally {
    const retirement = new Error('Materialization queue profile retirement');
    owner.retire(retirement);
    retirementController.abort(retirement);
  }
}

async function profileQuickSessionSwitch(index, first, second, indexRevision) {
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  const firstWaiterController = new AbortController();
  let resolveSourceStreamStarted;
  const sourceStreamStarted = new Promise((resolve) => { resolveSourceStreamStarted = resolve; });
  let firstSourceStreamStartedAt = 0;
  let firstAbortObservedAt = 0;
  let firstWaiterRejectedAt = 0;
  let secondStartedAt = 0;
  let secondCompletedAt = 0;
  let adapterCalls = 0;
  try {
    const firstPending = owner.get(first, firstWaiterController.signal, ({ signal }) => {
      adapterCalls += 1;
      signal.addEventListener('abort', () => { firstAbortObservedAt = performance.now(); }, { once: true });
      return materializeSessionForIndex(index, first, {
        signal,
        onMaterializationPhase({ phase, state }) {
          if (phase !== 'adapter_source_stream' || state !== 'start' || firstSourceStreamStartedAt) return;
          firstSourceStreamStartedAt = performance.now();
          resolveSourceStreamStarted();
        },
      });
    });
    const firstOutcome = firstPending.then(
      () => ({ error: null }),
      (error) => {
        firstWaiterRejectedAt = performance.now();
        return { error };
      },
    );
    await sourceStreamStarted;
    const switchStartedAt = performance.now();
    firstWaiterController.abort();
    const secondRequestedAt = performance.now();
    const secondPending = owner.get(second, null, ({ signal }) => {
      adapterCalls += 1;
      secondStartedAt = performance.now();
      return materializeSessionForIndex(index, second, { signal });
    }).then((value) => {
      secondCompletedAt = performance.now();
      return value;
    });
    const admissionStats = owner.stats();
    const [outcome] = await Promise.all([firstOutcome, secondPending]);
    while (scheduler.active.size > 0) await new Promise((resolve) => setImmediate(resolve));
    if (outcome.error?.name !== 'AbortError' || firstAbortObservedAt === 0) {
      throw new Error(`Quick switch did not cancel the first materialization for ${first.id}`);
    }
    return {
      first: redactedSessionSelection(first),
      second: redactedSessionSelection(second),
      sourceStreamToSwitchMs: switchStartedAt - firstSourceStreamStartedAt,
      switchToAbortObservationMs: firstAbortObservedAt - switchStartedAt,
      switchToWaiterRejectionMs: firstWaiterRejectedAt - switchStartedAt,
      secondQueueWaitMs: secondStartedAt - secondRequestedAt,
      switchToSecondCompletionMs: secondCompletedAt - switchStartedAt,
      queueDepthAtSecondAdmission: admissionStats.queuedJobCount,
      activeCountAtSecondAdmission: admissionStats.activeJobCount,
      adapterCalls,
      finalStats: owner.stats(),
    };
  } finally {
    const retirement = new Error('Quick Session-switch profile retirement');
    owner.retire(retirement);
    retirementController.abort(retirement);
  }
}

async function profileMaterialization(index, adapter) {
  if (adapter.sessionLifecycle !== SESSION_LIFECYCLE.INDEXED_MATERIALIZED) return null;
  const selected = selectMaterializationCandidates(index.sessions);
  if (!selected) return null;
  const canProfileTransition = selected.large.session.id !== selected.medium.session.id;
  return {
    candidateCount: selected.candidateCount,
    ordinals: Object.fromEntries(
      ['small', 'medium', 'large', 'largest'].map((name) => [name, selected[name].ordinal]),
    ),
    small: await profileMaterializedSession(index, selected.small.session, 1),
    medium: await profileMaterializedSession(index, selected.medium.session, 2),
    large: await profileMaterializedSession(index, selected.large.session, 3),
    largest: await profileMaterializedSession(index, selected.largest.session, 4),
    coldQueueing: canProfileTransition
      ? await profileColdQueueing(index, selected.large.session, selected.medium.session, 5)
      : null,
    quickSessionSwitch: canProfileTransition
      ? await profileQuickSessionSwitch(index, selected.large.session, selected.medium.session, 6)
      : null,
    largestCancellation: await profileLargeMaterializationCancellation(
      index,
      selected.largest.session,
      7,
    ),
  };
}

function materializationContractsPass(materialization) {
  if (!materialization) return false;
  const sizeClassesPass = ['small', 'medium', 'large', 'largest'].every((name) => (
    materialization[name]?.adapterCalls === 1
    && materialization[name]?.exactWarmIdentity === true
    && materialization[name]?.warmRepeatCount === 3
    && materialization[name]?.warm?.repeatCount === 3
  ));
  const queueingPass = materialization.coldQueueing === null || (
    materialization.coldQueueing.adapterCalls === 2
    && materialization.coldQueueing.queueDepthAtSecondAdmission === 1
    && materialization.coldQueueing.activeCountAtSecondAdmission === 1
  );
  const switchPass = materialization.quickSessionSwitch === null || (
    materialization.quickSessionSwitch.adapterCalls === 2
    && materialization.quickSessionSwitch.queueDepthAtSecondAdmission === 1
    && materialization.quickSessionSwitch.activeCountAtSecondAdmission === 1
  );
  return sizeClassesPass
    && queueingPass
    && switchPass
    && materialization.largestCancellation?.cacheSessionCount === 0
    && materialization.largestCancellation?.completedCount === 0;
}

async function profile(options) {
  let buildInvocationCount = 0;
  let validationInvocationCount = 0;
  const beforeBuild = memorySample();
  let buildPeak = beforeBuild;
  const buildSampling = {
    progressBoundarySamples: 0,
    preRawCompactionSamples: 0,
    postFinalizeSamples: 0,
  };
  const recordBuildSample = (kind = '') => {
    buildPeak = memoryMaximum(buildPeak, memorySample());
    if (Object.hasOwn(buildSampling, kind)) buildSampling[kind] += 1;
  };
  const buildStarted = performance.now();
  buildInvocationCount += 1;
  const index = await options.adapter.buildIndex({
    repoRoot: options.repo,
    sourceKind: options.source,
    sourceHome: options.sourceHome || options.adapter.defaultHome(),
    onProgress() {
      recordBuildSample('progressBoundarySamples');
    },
    onTransientMemorySample(sample) {
      if (sample?.phase === 'pre_raw_compaction') recordBuildSample('preRawCompactionSamples');
      else if (sample?.phase === 'post_finalize') recordBuildSample('postFinalizeSamples');
      else recordBuildSample();
    },
  });
  recordBuildSample();
  const buildMs = performance.now() - buildStarted;
  const processMaxRssBytesAtBuildEnd = process.resourceUsage().maxRSS * 1024;
  const beforeValidation = memorySample();
  let validationPeak = beforeValidation;
  let validationChunkSamples = 0;
  const validationStarted = performance.now();
  validationInvocationCount += 1;
  await validateIndexOwnershipForCommit(index, {
    onChunk() {
      validationChunkSamples += 1;
      validationPeak = memoryMaximum(validationPeak, memorySample());
    },
  });
  validationPeak = memoryMaximum(validationPeak, memorySample());
  const validationMs = performance.now() - validationStarted;
  const processMaxRssBytesAfterValidation = process.resourceUsage().maxRSS * 1024;
  if (global.gc) global.gc();
  const afterCommit = memorySample();
  const query = queryForIndex(index);
  const hasResidentOracle = options.adapter.sessionLifecycle === SESSION_LIFECYCLE.RESIDENT_COMPLETE;
  const oracleIndex = hasResidentOracle ? { ...index, projectQueryStore: undefined } : null;
  const scans = {};

  for (const layer of PROFILE_LAYERS) {
    const oracleTimings = [];
    const packedTimings = [];
    let decodedPeak = memorySample();
    let chunks = 0;
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      const filters = { q: PROFILE_QUERY, layer, locale: 'en' };
      let expected = null;
      if (oracleIndex) {
        const oracleStarted = performance.now();
        expected = await query.filterSessions(oracleIndex, filters);
        oracleTimings.push(performance.now() - oracleStarted);
      }
      const packedStarted = performance.now();
      const actual = await query.filterSessions(index, filters, {
        onChunk() {
          chunks += 1;
          decodedPeak = memoryMaximum(decodedPeak, memorySample());
        },
      });
      packedTimings.push(performance.now() - packedStarted);
      if (oracleIndex && JSON.stringify(actual) !== JSON.stringify(expected)) {
        const error = new Error(`Packed ${layer} query result diverged from the complete-event oracle`);
        error.code = 'PROJECT_QUERY_PROFILE_PARITY_FAILURE';
        throw error;
      }
    }
    scans[layer] = {
      oracle: oracleTimings.length > 0 ? timingStats(oracleTimings) : null,
      packed: timingStats(packedTimings),
      chunks,
      transientDecodePeak: decodedPeak,
      transientDecodePeakOverCommitted: memoryDelta(decodedPeak, afterCommit),
    };
  }
  const materialization = await profileMaterialization(index, options.adapter);
  const identity = await collectIdentity(options);
  const logicalAccountedBytes = accountedIndexBytes(index);
  const artifact = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    artifactKind: 'project-query-server-run',
    identity,
    environment: {
      node: process.version,
      v8: process.versions.v8,
      npm: readNpmVersion(),
      playwright: require('playwright/package.json').version,
      chromium: await bundledChromiumVersion(),
      execArgv: process.execArgv.filter((value) => (
        value === '--expose-gc' || /^--max-old-space-size=\d+$/.test(value)
      )),
      exposedGc: typeof global.gc === 'function',
      heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
      platform: process.platform,
      osRelease: os.release(),
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model || '',
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      ci: Boolean(process.env.CI),
      headless: null,
      viewport: null,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    options: publicOptions(options),
    invocationTemplate: invocationTemplate(),
    snapshotProof: {
      proofVersion: PRIVATE_PROOF_VERSION,
      algorithm: 'SHA-256',
      group: options.snapshotGroup,
      checkpointCount: 0,
      allMatched: false,
      matches: [],
    },
    corpus: {
      sourceKind: index.sourceKind,
      sessionCount: index.sessions.length,
      rowCounts: aggregateRows(index.projectQueryStore),
      sourceBytes: index.sessions.reduce((sum, session) => sum + Number(session.bytes || 0), 0),
      dependencyCount: index.materializationDependencies instanceof Map
        ? index.materializationDependencies.size
        : 0,
    },
    logicalAccountedBytes,
    runtimeMemory: {
      beforeBuild,
      committedAfterGc: afterCommit,
      committedDelta: memoryDelta(afterCommit, beforeBuild),
      processMaxRssBytes: processMaxRssBytesAfterValidation,
      heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
      exposedGc: typeof global.gc === 'function',
    },
    build: {
      invocationCount: buildInvocationCount,
      elapsedMs: buildMs,
      before: beforeBuild,
      observedTransientPeak: buildPeak,
      observedTransientPeakOverBefore: memoryDelta(buildPeak, beforeBuild),
      processMaxRssBytesAtBuildEnd,
      sampling: buildSampling,
    },
    validation: {
      invocationCount: validationInvocationCount,
      elapsedMs: validationMs,
      before: beforeValidation,
      observedTransientPeak: validationPeak,
      observedTransientPeakOverBefore: memoryDelta(validationPeak, beforeValidation),
      processMaxRssBytesAfterValidation,
      chunkSamples: validationChunkSamples,
    },
    commit: {
      arithmeticBuildPlusValidationMs: buildMs + validationMs,
      observedTransientPeak: memoryMaximum(buildPeak, validationPeak),
      observedTransientPeakOverBefore: memoryDelta(
        memoryMaximum(buildPeak, validationPeak),
        beforeBuild,
      ),
      processMaxRssBytes: processMaxRssBytesAfterValidation,
      committedAfterGc: afterCommit,
      committedDelta: memoryDelta(afterCommit, beforeBuild),
    },
    materialization,
    scans,
    acceptance: {
      structural: buildInvocationCount === 1
        && validationInvocationCount === 1
        && materializationContractsPass(materialization),
      privacyAuditPassed: true,
      snapshotProofVerifiedByRunner: false,
      numericalLatencyGate: false,
    },
  };
  validatePrivateArtifact(artifact);
  return artifact;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await profile(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function privateCliErrorLine(error) {
  const code = error?.code === 'INVALID_PROFILE_ARGUMENT'
    ? 'INVALID_PROFILE_ARGUMENT'
    : 'PRIVATE_PROFILE_FAILURE';
  return `PERFORMANCE_WAVE_0_ERROR:${code}\n`;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(privateCliErrorLine(error));
    process.exitCode = 1;
  });
}

module.exports = {
  PROFILE_SCHEMA_VERSION,
  PRIVATE_PROOF_VERSION,
  computePrivateSnapshotDigest,
  enumeratePrivateSnapshotFiles,
  invocationTemplate,
  parseArgs,
  profile,
  privateCliErrorLine,
  publicOptions,
  selectMaterializationCandidates,
  snapshotProofVerdict,
  timingStats,
  validatePrivateArtifact,
  validatePrivateSummary,
};
