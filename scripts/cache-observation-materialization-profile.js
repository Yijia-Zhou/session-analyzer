'use strict';

const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const codex = require('../src/codex');
const {
  getSourceAdapter,
  materializeSessionWithAdapter,
} = require('../src/source-adapters');
const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
  estimateMaterializedSessionBytes,
} = require('../src/materialized-session-owner');

const PROFILE_SCHEMA_VERSION = 1;
const SYNTHETIC_SESSION_ID = '78787878-7878-4878-8878-787878787878';
const DEFAULT_PAIR_COUNT = 24;
const DEFAULT_TURN_COUNT = 16;
const MODE_BASE = 'base';
const MODE_CANDIDATE = 'candidate';
const ORDER_BASE_FIRST = 'base-first';
const ORDER_CANDIDATE_FIRST = 'candidate-first';

function usageError(message) {
  const error = new Error(
    `${message}\nUsage: node scripts/cache-observation-materialization-profile.js `
      + '[--pairs <4..40>] [--turns <16..512>] '
      + '[--observations <0..1024>]',
  );
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function boundedInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw usageError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    child: false,
    order: '',
    pairs: DEFAULT_PAIR_COUNT,
    turns: DEFAULT_TURN_COUNT,
    observations: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--child') {
      options.child = true;
      continue;
    }
    if (!['--order', '--pairs', '--turns', '--observations'].includes(name)) {
      throw usageError(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--order') options.order = value;
    if (name === '--pairs') options.pairs = boundedInteger(value, '--pairs', 4, 40);
    if (name === '--turns') options.turns = boundedInteger(value, '--turns', 16, 512);
    if (name === '--observations') {
      options.observations = boundedInteger(value, '--observations', 0, 1024);
    }
  }
  if (options.child && ![ORDER_BASE_FIRST, ORDER_CANDIDATE_FIRST].includes(options.order)) {
    throw usageError('--child requires --order base-first or --order candidate-first');
  }
  if (!options.child && options.order) throw usageError('--order is child-only');
  if (options.observations === null) options.observations = options.turns * 2;
  if (options.observations > options.turns * 2) {
    throw usageError('--observations cannot exceed two observations per synthetic turn');
  }
  return options;
}

function syntheticTokenInfo(observationOrdinal, observationCount, turnIndex, firstInTurn) {
  const cumulative = firstInTurn ? {
    total_token_usage: {
      input_tokens: 1_000_000 + turnIndex,
      cached_input_tokens: 1_000_000 + turnIndex,
    },
  } : {};
  if (observationOrdinal >= observationCount) return cumulative;
  const isFirstDiscontinuity = observationOrdinal === 1;
  const lastTokenUsage = isFirstDiscontinuity ? {
    input_tokens: 12_288,
    cached_input_tokens: 8_192,
    output_tokens: 512,
    total_tokens: 12_800,
  } : {
    input_tokens: 16_384,
    cached_input_tokens: 16_384,
    output_tokens: firstInTurn ? 1_024 : 512,
    total_tokens: firstInTurn ? 17_408 : 16_896,
  };
  return { last_token_usage: lastTokenUsage, ...cumulative };
}

function syntheticRecords(repoRoot, turnCount, observationCount) {
  const startedAt = Date.parse('2026-09-03T00:00:00.000Z');
  let offsetMs = 0;
  const at = () => {
    const value = new Date(startedAt + offsetMs).toISOString();
    offsetMs += 1_000;
    return value;
  };
  const records = [{
    timestamp: at(),
    type: 'session_meta',
    payload: {
      id: SYNTHETIC_SESSION_ID,
      cwd: repoRoot,
      model: 'synthetic-model',
    },
  }];
  let observationOrdinal = 0;
  for (let index = 0; index < turnCount; index += 1) {
    const turnId = `synthetic-turn-${String(index).padStart(4, '0')}`;
    records.push(
      {
        timestamp: at(),
        type: 'event_msg',
        payload: { type: 'turn_started', turn_id: turnId },
      },
      {
        timestamp: at(),
        type: 'event_msg',
        payload: { type: 'user_message', message: `synthetic input ${index}` },
      },
      {
        timestamp: at(),
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: `synthetic output ${index}` }],
        },
      },
      {
        timestamp: at(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: syntheticTokenInfo(observationOrdinal, observationCount, index, true),
        },
      },
      {
        timestamp: at(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: syntheticTokenInfo(observationOrdinal + 1, observationCount, index, false),
        },
      },
      {
        timestamp: at(),
        type: 'event_msg',
        payload: { type: 'turn_complete', turn_id: turnId },
      },
    );
    observationOrdinal += 2;
  }
  return records;
}

function observePhase(tracker, event) {
  const key = `${event?.phase || ''}:${event?.state || ''}`;
  tracker.counts.set(key, (tracker.counts.get(key) || 0) + 1);
  const phase = String(event?.phase || '');
  if (!phase) return;
  if (event.state === 'start') {
    const starts = tracker.starts.get(phase) || [];
    starts.push(performance.now());
    tracker.starts.set(phase, starts);
    return;
  }
  if (event.state === 'end') {
    const starts = tracker.starts.get(phase) || [];
    const startedAt = starts.pop();
    if (Number.isFinite(startedAt)) {
      tracker.elapsed.set(
        phase,
        (tracker.elapsed.get(phase) || 0) + performance.now() - startedAt,
      );
    }
    return;
  }
  if (event.state === 'duration' && Number.isFinite(event.durationMs)) {
    tracker.elapsed.set(phase, (tracker.elapsed.get(phase) || 0) + event.durationMs);
  }
}

function phaseCount(tracker, phase, state) {
  return tracker.counts.get(`${phase}:${state}`) || 0;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function requireConsistentModeValue(runs, field) {
  const values = [...new Set(runs.map((run) => run[field]))];
  if (values.length !== 1) {
    throw new Error(`Synthetic paired profile produced inconsistent ${field}`);
  }
  return values[0];
}

function averageModeRuns(mode, runs) {
  const durationPhases = new Set(runs.flatMap((run) => Object.keys(run.phaseDurationsMs)));
  const phaseDurationsMs = Object.fromEntries([...durationPhases].map((phase) => [
    phase,
    average(runs.map((run) => run.phaseDurationsMs[phase] || 0)),
  ]));
  const averaged = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    mode,
    coldMs: average(runs.map((run) => run.coldMs)),
    warmMs: average(runs.map((run) => run.warmMs)),
    phaseDurationsMs,
  };
  for (const field of [
    'sourceReads',
    'verificationReads',
    'seedCaptureInvocations',
    'ownerReducerInvocations',
    'finalizerInvocations',
    'adapterCalls',
    'warmAdditionalAdapterCalls',
    'warmAdditionalObserverEvents',
    'retainedEstimatedBytes',
    'cacheSessionCount',
    'rawEventCount',
    'logicalEventCount',
    'cacheObservationCount',
    'linkCount',
  ]) {
    averaged[field] = requireConsistentModeValue(runs, field);
  }
  return averaged;
}

async function runChild(order, turnCount, observationCount) {
  const fixtureRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-cache-profile-'));
  const repoRoot = path.join(fixtureRoot, 'repo');
  const codexHome = path.join(fixtureRoot, 'codex-home');
  const sessionRoot = path.join(codexHome, 'sessions', '2026', '09', '03');
  try {
    await fsp.mkdir(repoRoot, { recursive: true });
    await fsp.mkdir(sessionRoot, { recursive: true });
    const records = syntheticRecords(repoRoot, turnCount, observationCount);
    const sourceFile = path.join(sessionRoot, 'synthetic-rollout.jsonl');
    await fsp.writeFile(
      sourceFile,
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
      'utf8',
    );
    const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
    const indexedSession = index.sessionsById.get(SYNTHETIC_SESSION_ID);
    if (!indexedSession) throw new Error('Synthetic profile Session was not indexed');
    const productionAdapter = getSourceAdapter('codex');
    const runMode = async (mode) => {
      const adapter = mode === MODE_CANDIDATE
        ? productionAdapter
        : {
          ...productionAdapter,
          materializeSession: codex.__testOnly.materializeCodexSessionWithoutCacheForTests,
        };
      const retirementController = new AbortController();
      const owner = createMaterializedSessionOwner({
        index,
        indexRevision: 1,
        retirementController,
        scheduler: createMaterializationScheduler({ warn() {} }),
      });
      try {
        const phaseTracker = { counts: new Map(), starts: new Map(), elapsed: new Map() };
        let adapterCalls = 0;
        const materialize = ({ signal }) => {
          adapterCalls += 1;
          return materializeSessionWithAdapter(index, indexedSession, adapter, {
            signal,
            indexRevision: 1,
            onMaterializationPhase: (event) => observePhase(phaseTracker, event),
          });
        };

        const coldStartedAt = performance.now();
        const materialized = await owner.get(indexedSession, null, materialize);
        const coldMs = performance.now() - coldStartedAt;
        const phaseTotalBeforeWarm = [...phaseTracker.counts.values()]
          .reduce((total, value) => total + value, 0);
        const callsBeforeWarm = adapterCalls;
        const warmStartedAt = performance.now();
        const warm = await owner.get(indexedSession, null, async () => {
          adapterCalls += 1;
          throw new Error('Same-revision profile hit unexpectedly rematerialized');
        });
        const warmMs = performance.now() - warmStartedAt;
        const phaseTotalAfterWarm = [...phaseTracker.counts.values()]
          .reduce((total, value) => total + value, 0);
        if (warm !== materialized) throw new Error('Same-revision profile hit changed Session identity');
        const cacheObservationCount = materialized.logicalEvents.filter(
          (event) => Object.hasOwn(event, 'cacheObservation'),
        ).length;
        const linkCount = materialized.presentationIndexes
          .cacheDiscontinuityLinks.mainEventIdByProtocolEventId.size;
        const stats = owner.stats();
        return {
          schemaVersion: PROFILE_SCHEMA_VERSION,
          mode,
          coldMs,
          warmMs,
          sourceReads: phaseCount(phaseTracker, 'adapter_source_stream', 'start'),
          verificationReads: phaseCount(phaseTracker, 'adapter_source_verification_read', 'start'),
          seedCaptureInvocations: phaseCount(phaseTracker, 'codex_cache_seed_capture', 'event'),
          ownerReducerInvocations: phaseCount(phaseTracker, 'codex_cache_owner_reduction', 'start'),
          finalizerInvocations: phaseCount(phaseTracker, 'codex_cache_finalization', 'start'),
          phaseDurationsMs: Object.fromEntries(phaseTracker.elapsed),
          adapterCalls,
          warmAdditionalAdapterCalls: adapterCalls - callsBeforeWarm,
          warmAdditionalObserverEvents: phaseTotalAfterWarm - phaseTotalBeforeWarm,
          retainedEstimatedBytes: stats.estimatedMaterializedBytes,
          cacheSessionCount: stats.cacheSessionCount,
          rawEventCount: materialized.rawEvents.length,
          logicalEventCount: materialized.logicalEvents.length,
          cacheObservationCount,
          linkCount,
        };
      } finally {
        const retirement = new Error('Synthetic cache profile mode retirement');
        owner.retire(retirement);
        retirementController.abort(retirement);
      }
    };

    const modes = order === ORDER_BASE_FIRST
      ? [MODE_BASE, MODE_CANDIDATE, MODE_CANDIDATE, MODE_BASE]
      : [MODE_CANDIDATE, MODE_BASE, MODE_BASE, MODE_CANDIDATE];
    const modeRuns = { [MODE_BASE]: [], [MODE_CANDIDATE]: [] };
    for (const mode of modes) modeRuns[mode].push(await runMode(mode));
    const pair = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      order,
      base: averageModeRuns(MODE_BASE, modeRuns.base),
      candidate: averageModeRuns(MODE_CANDIDATE, modeRuns.candidate),
    };
    return pair;
  } finally {
    await fsp.rm(fixtureRoot, { recursive: true, force: true });
  }
}

function runFreshChild(order, turnCount, observationCount) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      __filename,
      '--child',
      '--order', order,
      '--turns', String(turnCount),
      '--observations', String(observationCount),
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Profile child failed (${order}, ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Profile child returned malformed JSON: ${error.message}`));
      }
    });
  });
}

function sortedNumbers(values) {
  return [...values].sort((left, right) => left - right);
}

function median(values) {
  const sorted = sortedNumbers(values);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile95(values) {
  const sorted = sortedNumbers(values);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function maximum(values) {
  return values.length > 0 ? Math.max(...values) : null;
}

function metricSummary(runs, field) {
  const values = runs.map((run) => run[field]);
  return {
    median: median(values),
    p95: percentile95(values),
    max: maximum(values),
  };
}

function exactCountSummary(runs, field) {
  return [...new Set(runs.map((run) => run[field]))].sort((left, right) => left - right);
}

function phaseMetricSummary(runs) {
  const phases = [...new Set(runs.flatMap(
    (run) => Object.keys(run.phaseDurationsMs),
  ))].sort();
  return Object.fromEntries(phases.map((phase) => [
    phase,
    metricSummary(
      runs.map((run) => ({ value: run.phaseDurationsMs[phase] || 0 })),
      'value',
    ),
  ]));
}

function pairedPhaseDeltaSummary(pairs) {
  const phases = [...new Set(pairs.flatMap((pair) => [
    ...Object.keys(pair.base.phaseDurationsMs),
    ...Object.keys(pair.candidate.phaseDurationsMs),
  ]))].sort();
  return Object.fromEntries(phases.map((phase) => [
    phase,
    metricSummary(pairs.map((pair) => ({
      value: (pair.candidate.phaseDurationsMs[phase] || 0)
        - (pair.base.phaseDurationsMs[phase] || 0),
    })), 'value'),
  ]));
}

function percent(delta, baseline) {
  if (baseline === 0) return delta === 0 ? 0 : null;
  return (delta / baseline) * 100;
}

async function runParent(options) {
  const pairs = [];
  for (let index = 0; index < options.pairs; index += 1) {
    const order = index % 2 === 0 ? ORDER_BASE_FIRST : ORDER_CANDIDATE_FIRST;
    pairs.push(await runFreshChild(
      order,
      options.turns,
      options.observations,
    ));
  }
  const baseRuns = pairs.map((pair) => pair.base);
  const candidateRuns = pairs.map((pair) => pair.candidate);
  const pairedColdDeltas = pairs.map((pair) => pair.candidate.coldMs - pair.base.coldMs);
  const baseCold = metricSummary(baseRuns, 'coldMs');
  const candidateCold = metricSummary(candidateRuns, 'coldMs');
  const pairedMedianRegressionMs = median(pairedColdDeltas);
  const pairedP95RegressionMs = percentile95(pairedColdDeltas);
  const pairedMedianRegressionPercent = percent(pairedMedianRegressionMs, baseCold.median);
  const pairedP95RegressionPercent = percent(pairedP95RegressionMs, baseCold.p95);
  const medianBlocked = pairedMedianRegressionMs > 10
    && pairedMedianRegressionPercent !== null
    && pairedMedianRegressionPercent > 10;
  const p95Blocked = pairedP95RegressionMs > 50
    && pairedP95RegressionPercent !== null
    && pairedP95RegressionPercent > 15;
  const weightSampleCount = 100_000;
  let weightChecksum = 0;
  const weightStartedAt = performance.now();
  for (let index = 0; index < weightSampleCount; index += 1) {
    weightChecksum ^= estimateMaterializedSessionBytes({
      bytes: 1 + options.turns * 6 * 256,
      rawEventCount: 1 + options.turns * 6,
      logicalEventCount: 1 + options.turns * 6,
    });
  }
  const weightEstimateMeanMs = (performance.now() - weightStartedAt) / weightSampleCount;

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profile: 'cache-observation-materialization-preliminary',
    preliminary: true,
    contentFree: true,
    runtime: { node: process.version },
    selection: {
      kind: 'sealed-generated-codex-v1',
      pairCount: options.pairs,
      turnCount: options.turns,
      observationCount: options.observations,
      sourceRecordCount: 1 + options.turns * 6,
      materializationsPerModePerPair: 2,
      identitiesAndPathsReported: false,
      fingerprintImplementation: 'repository-default-original',
      weightEstimateDiagnostic: {
        sampleCount: weightSampleCount,
        meanMs: weightEstimateMeanMs,
        checksum: weightChecksum,
      },
    },
    base: {
      coldMs: baseCold,
      warmSameRevisionMs: metricSummary(baseRuns, 'warmMs'),
      sourceReadsPerRun: exactCountSummary(baseRuns, 'sourceReads'),
      verificationReadsPerRun: exactCountSummary(baseRuns, 'verificationReads'),
      seedCaptureInvocationsPerRun: exactCountSummary(baseRuns, 'seedCaptureInvocations'),
      ownerReducerInvocationsPerRun: exactCountSummary(baseRuns, 'ownerReducerInvocations'),
      finalizerInvocationsPerRun: exactCountSummary(baseRuns, 'finalizerInvocations'),
      retainedEstimatedBytesPerRun: exactCountSummary(baseRuns, 'retainedEstimatedBytes'),
      warmAdditionalAdapterCallsPerRun: exactCountSummary(baseRuns, 'warmAdditionalAdapterCalls'),
      warmAdditionalObserverEventsPerRun: exactCountSummary(baseRuns, 'warmAdditionalObserverEvents'),
      phaseDurationsMs: phaseMetricSummary(baseRuns),
    },
    candidate: {
      coldMs: candidateCold,
      warmSameRevisionMs: metricSummary(candidateRuns, 'warmMs'),
      sourceReadsPerRun: exactCountSummary(candidateRuns, 'sourceReads'),
      verificationReadsPerRun: exactCountSummary(candidateRuns, 'verificationReads'),
      seedCaptureInvocationsPerRun: exactCountSummary(candidateRuns, 'seedCaptureInvocations'),
      ownerReducerInvocationsPerRun: exactCountSummary(candidateRuns, 'ownerReducerInvocations'),
      finalizerInvocationsPerRun: exactCountSummary(candidateRuns, 'finalizerInvocations'),
      retainedEstimatedBytesPerRun: exactCountSummary(candidateRuns, 'retainedEstimatedBytes'),
      warmAdditionalAdapterCallsPerRun: exactCountSummary(candidateRuns, 'warmAdditionalAdapterCalls'),
      warmAdditionalObserverEventsPerRun: exactCountSummary(candidateRuns, 'warmAdditionalObserverEvents'),
      cacheObservationCountPerRun: exactCountSummary(candidateRuns, 'cacheObservationCount'),
      linkCountPerRun: exactCountSummary(candidateRuns, 'linkCount'),
      phaseDurationsMs: phaseMetricSummary(candidateRuns),
    },
    pairedRegression: {
      coldDeltaMs: metricSummary(
        pairedColdDeltas.map((coldMs) => ({ coldMs })),
        'coldMs',
      ),
      medianPercentOfBaseMedian: pairedMedianRegressionPercent,
      p95PercentOfBaseP95: pairedP95RegressionPercent,
      medianDeltaPerObservationMs: options.observations > 0
        ? pairedMedianRegressionMs / options.observations
        : null,
      phaseDeltaMs: pairedPhaseDeltaSummary(pairs),
    },
    guardrail: {
      median: { blocked: medianBlocked, thresholdMs: 10, thresholdPercent: 10 },
      p95: { blocked: p95Blocked, thresholdMs: 50, thresholdPercent: 15 },
      blocked: medianBlocked || p95Blocked,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = options.child
    ? await runChild(options.order, options.turns, options.observations)
    : await runParent(options);
  process.stdout.write(`${JSON.stringify(result, null, options.child ? 0 : 2)}\n`);
  if (!options.child && result.guardrail.blocked) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  median,
  parseArgs,
  percentile95,
  syntheticRecords,
};
