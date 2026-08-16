'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const v8 = require('node:v8');
const {
  getSourceAdapter,
  normalizeSourceKind,
  queryForIndex,
  validateIndexOwnership,
} = require('../src/source-adapters');

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

async function profile(options) {
  const beforeBuild = memorySample();
  const buildStarted = performance.now();
  const index = await options.adapter.buildIndex({
    repoRoot: options.repo,
    sourceKind: options.source,
    sourceHome: options.sourceHome || options.adapter.defaultHome(),
  });
  const buildMs = performance.now() - buildStarted;
  validateIndexOwnership(index);
  if (global.gc) global.gc();
  const afterBuild = memorySample();
  const query = queryForIndex(index);
  const oracleIndex = { ...index, projectQueryStore: undefined };
  const scans = {};

  for (const layer of PROFILE_LAYERS) {
    const oracleTimings = [];
    const packedTimings = [];
    let decodedPeak = memorySample();
    let chunks = 0;
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      const filters = { q: PROFILE_QUERY, layer, locale: 'en' };
      const oracleStarted = performance.now();
      const expected = await query.filterSessions(oracleIndex, filters);
      oracleTimings.push(performance.now() - oracleStarted);
      const packedStarted = performance.now();
      const actual = await query.filterSessions(index, filters, {
        onChunk() {
          chunks += 1;
          decodedPeak = memoryMaximum(decodedPeak, memorySample());
        },
      });
      packedTimings.push(performance.now() - packedStarted);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        const error = new Error(`Packed ${layer} query result diverged from the complete-event oracle`);
        error.code = 'PROJECT_QUERY_PROFILE_PARITY_FAILURE';
        throw error;
      }
    }
    scans[layer] = {
      oracle: timingStats(oracleTimings),
      packed: timingStats(packedTimings),
      chunks,
      transientDecodePeak: decodedPeak,
      transientDecodePeakOverCommitted: memoryDelta(decodedPeak, afterBuild),
    };
  }

  return {
    schemaVersion: 1,
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
    },
    build: {
      buildMs,
      before: beforeBuild,
      committedAfterGc: afterBuild,
      committedDelta: memoryDelta(afterBuild, beforeBuild),
    },
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
