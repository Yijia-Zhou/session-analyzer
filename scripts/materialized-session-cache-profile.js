'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const v8 = require('node:v8');
const {
  getSourceAdapter,
  materializeSessionForIndex,
  normalizeSourceKind,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { SESSION_LIFECYCLE } = require('../src/source-adapter-contract');
const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
  estimateMaterializedSessionBytes,
} = require('../src/materialized-session-owner');

const MIB = 1024 * 1024;
const CANDIDATE_MAX_ESTIMATED_BYTES = 256 * MIB;
const CANDIDATE_MAX_SESSIONS = 12;

function usageError(message) {
  const error = new Error(`${message}\nUsage: node --expose-gc scripts/materialized-session-cache-profile.js --source <codex|claude-code> --repo <path> [--source-home <path>] [--max-opens <1..40>]`);
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = {
    source: '',
    repo: '',
    sourceHome: '',
    maxOpens: 24,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--source', '--repo', '--source-home', '--max-opens'].includes(name)) {
      throw usageError(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--source') options.source = normalizeSourceKind(value);
    if (name === '--repo') options.repo = path.resolve(value);
    if (name === '--source-home') options.sourceHome = path.resolve(value);
    if (name === '--max-opens') {
      options.maxOpens = Number(value);
      if (!Number.isSafeInteger(options.maxOpens) || options.maxOpens < 1 || options.maxOpens > 40) {
        throw usageError('--max-opens must be an integer from 1 through 40');
      }
    }
  }
  if (!options.source) throw usageError('--source is required');
  if (!options.repo) throw usageError('--repo is required');
  const adapter = getSourceAdapter(options.source);
  if (!adapter) throw usageError(`Unsupported source: ${options.source}`);
  if (adapter.sessionLifecycle !== SESSION_LIFECYCLE.INDEXED_MATERIALIZED) {
    throw usageError(`Source ${options.source} does not use indexed-materialized-v1`);
  }
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

function redactedSessionFacts(session, ordinal) {
  return {
    ordinal,
    sourceBytes: session.bytes,
    rawRows: session.rawEventCount,
    logicalRows: session.logicalEventCount,
    estimatedBytes: estimateMaterializedSessionBytes(session),
  };
}

function recentSessions(index) {
  return index.sessions
    .map((session, indexOrder) => ({ session, indexOrder }))
    .sort((left, right) => (
      String(right.session.updatedAt || right.session.startedAt).localeCompare(
        String(left.session.updatedAt || left.session.startedAt),
      ) || left.indexOrder - right.indexOrder
    ))
    .map(({ session }) => session);
}

function simulateCandidateTriggers(sessions) {
  let estimatedBytes = 0;
  let byteTriggerOrdinal = null;
  let countTriggerOrdinal = null;
  const firstTwenty = [];
  for (let index = 0; index < sessions.length; index += 1) {
    const estimated = estimateMaterializedSessionBytes(sessions[index]);
    estimatedBytes += estimated;
    const ordinal = index + 1;
    if (byteTriggerOrdinal === null && estimatedBytes > CANDIDATE_MAX_ESTIMATED_BYTES) {
      byteTriggerOrdinal = ordinal;
    }
    if (countTriggerOrdinal === null && ordinal > CANDIDATE_MAX_SESSIONS) {
      countTriggerOrdinal = ordinal;
    }
    if (ordinal <= 20) {
      firstTwenty.push({
        ordinal,
        estimatedBytes: estimated,
        cumulativeEstimatedBytes: estimatedBytes,
      });
    }
  }
  return {
    maxEstimatedMaterializedBytes: CANDIDATE_MAX_ESTIMATED_BYTES,
    maxCachedSessions: CANDIDATE_MAX_SESSIONS,
    byteTriggerOrdinal,
    countTriggerOrdinal,
    dominantTrigger: countTriggerOrdinal !== null
      && countTriggerOrdinal < (byteTriggerOrdinal ?? Number.POSITIVE_INFINITY)
      ? 'count'
      : (byteTriggerOrdinal !== null
        && byteTriggerOrdinal < (countTriggerOrdinal ?? Number.POSITIVE_INFINITY)
        ? 'bytes'
        : 'tie-or-neither'),
    firstTwenty,
  };
}

async function profile(options) {
  const buildStarted = performance.now();
  const index = await options.adapter.buildIndex({
    repoRoot: options.repo,
    sourceKind: options.source,
    sourceHome: options.sourceHome || options.adapter.defaultHome(),
  });
  const buildMs = performance.now() - buildStarted;
  const validationStarted = performance.now();
  await validateIndexOwnershipForCommit(index);
  const validationMs = performance.now() - validationStarted;
  if (global.gc) global.gc();
  const committed = memorySample();

  const ordered = recentSessions(index);
  const selected = ordered.slice(0, options.maxOpens);
  const retirementController = new AbortController();
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision: 1,
    retirementController,
    scheduler: createMaterializationScheduler({ warn() {} }),
  });
  const opens = [];
  let adapterCalls = 0;
  for (let indexPosition = 0; indexPosition < selected.length; indexPosition += 1) {
    const session = selected[indexPosition];
    const estimatedBytes = estimateMaterializedSessionBytes(session);
    const countPressure = owner.cache.size + 1 > owner.maxCachedSessions;
    const bytePressure = estimatedBytes
      > owner.maxEstimatedMaterializedBytes - owner.estimatedMaterializedBytes;
    const started = performance.now();
    await owner.get(session, null, ({ signal }) => {
      adapterCalls += 1;
      return materializeSessionForIndex(index, session, { signal });
    });
    const coldMs = performance.now() - started;
    opens.push({
      ...redactedSessionFacts(session, indexPosition + 1),
      coldMs,
      countPressure,
      bytePressure,
      cacheSessionCount: owner.cache.size,
      retainedEstimatedBytes: owner.estimatedMaterializedBytes,
    });
  }
  if (global.gc) global.gc();
  const afterSequence = memorySample();
  const beforeWarm = performance.now();
  const warmValue = selected.length > 0
    ? await owner.get(selected.at(-1), null, async () => {
      adapterCalls += 1;
      throw new Error('Warm cache profile unexpectedly rematerialized the final Session');
    })
    : null;
  const warmMs = performance.now() - beforeWarm;
  const statsAfterSequence = owner.stats();
  const adapterCallsBeforeReturn = adapterCalls;
  const returnStarted = performance.now();
  const returnValue = selected.length > 0
    ? await owner.get(selected[0], null, ({ signal }) => {
      adapterCalls += 1;
      return materializeSessionForIndex(index, selected[0], { signal });
    })
    : null;
  const returnMs = performance.now() - returnStarted;
  const returnWasCacheHit = adapterCalls === adapterCallsBeforeReturn;
  await new Promise((resolve) => setImmediate(resolve));
  if (global.gc) global.gc();
  const afterReturn = memorySample();
  const statsBeforeRetirement = owner.stats();
  const retirement = new Error('Materialized Session cache profile retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
  await new Promise((resolve) => setImmediate(resolve));
  if (global.gc) global.gc();
  const afterRetirement = memorySample();

  return {
    schemaVersion: 1,
    command: 'node --expose-gc scripts/materialized-session-cache-profile.js',
    options: {
      source: options.source,
      repo: '<redacted>',
      sourceHome: options.sourceHome ? '<redacted>' : '<adapter-default>',
      maxOpens: options.maxOpens,
    },
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      exposedGc: typeof global.gc === 'function',
      heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
    },
    corpus: {
      sessionCount: index.sessions.length,
      buildMs,
      validationMs,
    },
    candidateSimulation: simulateCandidateTriggers(ordered),
    sequence: {
      requestedCount: selected.length,
      adapterCalls,
      opens,
      policyPressureCounts: {
        count: opens.filter((entry) => entry.countPressure).length,
        bytes: opens.filter((entry) => entry.bytePressure).length,
        both: opens.filter((entry) => entry.countPressure && entry.bytePressure).length,
      },
      warmFinalSessionMs: warmMs,
      warmFinalSessionAvailable: Boolean(warmValue),
      statsAfterSequence,
      returnToFirst: selected.length > 0 ? {
        ...redactedSessionFacts(selected[0], 1),
        elapsedMs: returnMs,
        cacheHit: returnWasCacheHit,
        valueAvailable: Boolean(returnValue),
      } : null,
      statsBeforeRetirement,
    },
    memory: {
      committedAfterGc: committed,
      afterSequenceGc: afterSequence,
      afterSequenceDelta: memoryDelta(afterSequence, committed),
      afterReturnGc: afterReturn,
      afterReturnDelta: memoryDelta(afterReturn, committed),
      afterRetirementGc: afterRetirement,
      afterRetirementDelta: memoryDelta(afterRetirement, committed),
      processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const result = await profile(parseArgs(argv));
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
  recentSessions,
  simulateCandidateTriggers,
};
