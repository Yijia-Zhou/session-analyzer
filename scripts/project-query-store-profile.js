'use strict';

const path = require('node:path');
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

const PROFILE_QUERY = '__session_analyzer_absent_project_query_profile_phrase__';
const PROFILE_LAYERS = Object.freeze(['main', 'protocol', 'raw']);

function usageError(message) {
  const error = new Error(`${message}\nUsage: node --expose-gc scripts/project-query-store-profile.js --source <codex|claude-code> --repo <path> [--source-home <path>] [--repeats <1..20>]`);
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = {
    source: '',
    repo: '',
    sourceHome: '',
    repeats: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--source', '--repo', '--source-home', '--repeats'].includes(name)) {
      throw usageError(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--source') options.source = normalizeSourceKind(value);
    if (name === '--repo') options.repo = path.resolve(value);
    if (name === '--source-home') options.sourceHome = path.resolve(value);
    if (name === '--repeats') {
      options.repeats = Number(value);
      if (!Number.isSafeInteger(options.repeats) || options.repeats < 1 || options.repeats > 20) {
        throw usageError('--repeats must be an integer from 1 through 20');
      }
    }
  }
  if (!options.source) throw usageError('--source is required');
  if (!options.repo) throw usageError('--repo is required');
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
  };
}

function runtimeCommand(execArgv = process.execArgv) {
  const exposeGc = execArgv.includes('--expose-gc');
  const heapOption = execArgv.find((value) => /^--max-old-space-size=\d+$/.test(value)) || '';
  return [
    'node',
    exposeGc ? '--expose-gc' : '',
    heapOption,
    'scripts/project-query-store-profile.js',
  ].filter(Boolean).join(' ');
}

function phaseTimingRecorder(recordSample) {
  const active = new Map();
  const durations = new Map();
  return {
    observe({ phase, state }) {
      recordSample();
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
        onProjectionPhase: phaseTimings.observe,
      });
    });
  } finally {
    clearInterval(sampler);
  }
  const coldMs = performance.now() - coldStarted;
  recordSample();
  if (global.gc) global.gc();
  const afterCache = memorySample();
  const warmStarted = performance.now();
  let warm = await owner.get(session, null, async () => {
    adapterCalls += 1;
    return null;
  });
  const warmMs = performance.now() - warmStarted;
  const exactWarmIdentity = warm === cold;
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
  return {
    selection: {
      sessionId: '<redacted>',
      sourceBytes: session.bytes,
      rawRows: session.rawEventCount,
      logicalRows: session.logicalEventCount,
    },
    coldMs,
    warmMs,
    adapterCalls,
    exactWarmIdentity,
    estimatedOwnerBytes: ownerStats.peakEstimatedMaterializedBytes,
    processMaxRssBefore,
    processMaxRssAfter: process.resourceUsage().maxRSS * 1024,
    projectionPhaseMs: phaseTimings.result(),
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
    selection: {
      sessionId: '<redacted>',
      sourceBytes: session.bytes,
      rawRows: session.rawEventCount,
      logicalRows: session.logicalEventCount,
    },
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

async function profileMaterialization(index, adapter) {
  if (adapter.sessionLifecycle !== SESSION_LIFECYCLE.INDEXED_MATERIALIZED) return null;
  const candidates = [...index.sessions]
    .filter((session) => session.bytes > 0)
    .sort((left, right) => left.bytes - right.bytes || left.id.localeCompare(right.id));
  if (candidates.length === 0) return null;
  const lowerDecileIndex = Math.max(0, Math.ceil(candidates.length * 0.1) - 1);
  const small = candidates[lowerDecileIndex];
  const large = candidates.at(-1);
  return {
    lowerDecileOrdinal: lowerDecileIndex + 1,
    candidateCount: candidates.length,
    small: await profileMaterializedSession(index, small, 1),
    large: await profileMaterializedSession(index, large, 2),
    largeCancellation: await profileLargeMaterializationCancellation(index, large, 3),
  };
}

async function profile(options) {
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

  return {
    schemaVersion: 2,
    command: runtimeCommand(),
    options: publicOptions(options),
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      exposedGc: typeof global.gc === 'function',
      heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
    },
    corpus: {
      sourceKind: index.sourceKind,
      sessionCount: index.sessions.length,
      rowCounts: aggregateRows(index.projectQueryStore),
      queryStoreAccountedBytes: index.projectQueryStore.accountedBytes,
      indexAccountedBytes: accountedIndexBytes(index),
    },
    build: {
      buildMs,
      before: beforeBuild,
      observedTransientPeak: buildPeak,
      observedTransientPeakOverBefore: memoryDelta(buildPeak, beforeBuild),
      processMaxRssBytesAtBuildEnd,
      sampling: buildSampling,
    },
    validation: {
      validationMs,
      before: beforeValidation,
      observedTransientPeak: validationPeak,
      observedTransientPeakOverBefore: memoryDelta(validationPeak, beforeValidation),
      processMaxRssBytesAfterValidation,
      chunkSamples: validationChunkSamples,
    },
    commit: {
      totalBuildAndValidationMs: buildMs + validationMs,
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
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await profile(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  publicOptions,
  runtimeCommand,
  timingStats,
};
