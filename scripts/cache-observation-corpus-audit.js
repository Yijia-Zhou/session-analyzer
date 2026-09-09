'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  getSourceAdapter,
  materializeSessionForIndex,
} = require('../src/source-adapters');

const DEFAULT_LIMIT = 115;

function usageError(message) {
  const error = new Error(
    `${message}\nUsage: node scripts/cache-observation-corpus-audit.js `
      + '--repo <path> [--source-home <path>] [--limit <1..1000>]',
  );
  error.code = 'INVALID_AUDIT_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = { repo: '', sourceHome: '', limit: DEFAULT_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--repo', '--source-home', '--limit'].includes(name)) {
      throw usageError(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--repo') options.repo = path.resolve(value);
    if (name === '--source-home') options.sourceHome = path.resolve(value);
    if (name === '--limit') {
      options.limit = Number(value);
      if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1_000) {
        throw usageError('--limit must be an integer from 1 through 1000');
      }
    }
  }
  if (!options.repo) throw usageError('--repo is required');
  return options;
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

function quantile(sorted, probability) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * fraction);
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0] ?? null,
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
  };
}

function pearsonCorrelation(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((total, value) => total + value, 0) / left.length;
  const rightMean = right.reduce((total, value) => total + value, 0) / right.length;
  let numerator = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquared += leftDelta * leftDelta;
    rightSquared += rightDelta * rightDelta;
  }
  if (leftSquared === 0 || rightSquared === 0) return null;
  return numerator / Math.sqrt(leftSquared * rightSquared);
}

async function audit(options) {
  const adapter = getSourceAdapter('codex');
  const buildStartedAt = performance.now();
  const index = await adapter.buildIndex({
    repoRoot: options.repo,
    sourceKind: 'codex',
    sourceHome: options.sourceHome || adapter.defaultHome(),
  });
  const buildMs = performance.now() - buildStartedAt;
  const selected = recentSessions(index).slice(0, options.limit);
  const tokenCounts = [];
  const observationCounts = [];
  const rawCounts = [];
  const observationRatioBasisPoints = [];
  const failureCodes = new Map();
  const materializeStartedAt = performance.now();
  for (const indexedSession of selected) {
    try {
      const materialized = await materializeSessionForIndex(index, indexedSession);
      const tokenCount = materialized.logicalEvents.filter((event) => (
        event.layer === 'protocol' && event.subtype === 'token_count'
      )).length;
      const observationCount = materialized.logicalEvents.filter((event) => (
        Object.hasOwn(event, 'cacheObservation')
      )).length;
      tokenCounts.push(tokenCount);
      observationCounts.push(observationCount);
      rawCounts.push(materialized.rawEvents.length);
      observationRatioBasisPoints.push(materialized.rawEvents.length > 0
        ? Math.trunc((observationCount * 10_000) / materialized.rawEvents.length)
        : 0);
    } catch (error) {
      const code = String(error?.code || error?.name || 'ERROR');
      failureCodes.set(code, (failureCodes.get(code) || 0) + 1);
    }
  }
  const materializeMs = performance.now() - materializeStartedAt;
  return {
    schemaVersion: 1,
    audit: 'cache-observation-density-v1',
    aggregateOnly: true,
    contentReported: false,
    identitiesAndPathsReported: false,
    selection: {
      order: 'updated-descending-stable-index-order',
      requestedLimit: options.limit,
      indexedSessionCount: index.sessions.length,
      selectedSessionCount: selected.length,
      successfulSessionCount: observationCounts.length,
      failedSessionCount: selected.length - observationCounts.length,
      quantileMethod: 'linear-interpolation-type-7',
    },
    distribution: {
      tokenCountLogicalEvents: distribution(tokenCounts),
      validCacheObservations: distribution(observationCounts),
      rawRecords: distribution(rawCounts),
      cacheObservationPerRawBasisPoints: distribution(observationRatioBasisPoints),
    },
    relationship: {
      rawRecordsToValidCacheObservationsPearson: pearsonCorrelation(
        rawCounts,
        observationCounts,
      ),
    },
    failuresByCode: Object.fromEntries([...failureCodes].sort()),
    timingMs: { indexBuild: buildMs, materializationTotal: materializeMs },
  };
}

async function main(argv = process.argv.slice(2)) {
  const result = await audit(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.code || error?.name || 'AUDIT_FAILED')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  audit,
  distribution,
  parseArgs,
  pearsonCorrelation,
  recentSessions,
};
