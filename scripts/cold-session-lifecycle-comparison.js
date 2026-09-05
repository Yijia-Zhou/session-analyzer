'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createServer: createCurrentServer } = require('../server');
const {
  getSourceAdapter,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { createTimelineProfileFixture } = require('./timeline-profile-fixture');

const MAX_COMPARISON_EVENT_COUNT = 20_000;
const MAX_COMPARISON_TEXT_BYTES = 65_536;
const MAX_COMPARISON_EVENT_TEXT_BYTES = 64 * 1024 * 1024;

function usageError(message) {
  const error = new Error(`${message}\nUsage: node scripts/cold-session-lifecycle-comparison.js --pre-root <worktree> [--event-count <count>] [--text-bytes <bytes>] [--warm-repeats <1..10>]`);
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = {
    preRoot: '',
    eventCount: 1800,
    textBytes: 3700,
    warmRepeats: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--pre-root', '--event-count', '--text-bytes', '--warm-repeats'].includes(name)) {
      throw usageError(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--pre-root') options.preRoot = path.resolve(value);
    if (name === '--event-count') options.eventCount = Number(value);
    if (name === '--text-bytes') options.textBytes = Number(value);
    if (name === '--warm-repeats') options.warmRepeats = Number(value);
  }
  if (!options.preRoot) throw usageError('--pre-root is required');
  if (!Number.isSafeInteger(options.eventCount)
      || options.eventCount < 1
      || options.eventCount > MAX_COMPARISON_EVENT_COUNT) {
    throw usageError(`--event-count must be an integer from 1 through ${MAX_COMPARISON_EVENT_COUNT}`);
  }
  if (!Number.isSafeInteger(options.textBytes)
      || options.textBytes < 256
      || options.textBytes > MAX_COMPARISON_TEXT_BYTES) {
    throw usageError(`--text-bytes must be an integer from 256 through ${MAX_COMPARISON_TEXT_BYTES}`);
  }
  if (options.eventCount * options.textBytes > MAX_COMPARISON_EVENT_TEXT_BYTES) {
    throw usageError(`event-count × text-bytes must not exceed ${MAX_COMPARISON_EVENT_TEXT_BYTES}`);
  }
  if (!Number.isSafeInteger(options.warmRepeats)
      || options.warmRepeats < 1
      || options.warmRepeats > 10) {
    throw usageError('--warm-repeats must be an integer from 1 through 10');
  }
  return options;
}

function timingStats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    repeatCount: sorted.length,
    medianMs: sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function timelineRequest(baseUrl, sessionId) {
  const startedAt = performance.now();
  const response = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/timeline?layer=main&offset=0&limit=500&locale=en`,
  );
  const headersAt = performance.now();
  const text = await response.text();
  const bodyAt = performance.now();
  if (!response.ok) throw new Error(`Timeline request failed with HTTP ${response.status}`);
  JSON.parse(text);
  const parsedAt = performance.now();
  return {
    headerMs: headersAt - startedAt,
    bodyMs: bodyAt - headersAt,
    parseMs: parsedAt - bodyAt,
    totalMs: parsedAt - startedAt,
    responseBytes: Buffer.byteLength(text, 'utf8'),
    digest: crypto.createHash('sha256').update(text).digest('hex'),
  };
}

async function runVariant({ buildIndex, createServer, fixture, warmRepeats }) {
  const buildStartedAt = performance.now();
  const index = await buildIndex();
  const buildMs = performance.now() - buildStartedAt;
  const server = createServer(index, buildMs, { codexHome: fixture.codexHome });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cold = await timelineRequest(baseUrl, fixture.longSessionId);
    const warm = [];
    for (let repeat = 0; repeat < warmRepeats; repeat += 1) {
      warm.push(await timelineRequest(baseUrl, fixture.longSessionId));
    }
    return { buildMs, cold, warm };
  } finally {
    await closeServer(server);
  }
}

function publicVariant(value) {
  return {
    buildMs: value.buildMs,
    cold: {
      headerMs: value.cold.headerMs,
      bodyMs: value.cold.bodyMs,
      parseMs: value.cold.parseMs,
      totalMs: value.cold.totalMs,
      responseBytes: value.cold.responseBytes,
    },
    warmTotal: timingStats(value.warm.map((entry) => entry.totalMs)),
    warmParse: timingStats(value.warm.map((entry) => entry.parseMs)),
  };
}

async function profile(options) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-lifecycle-comparison-'));
  try {
    const fixture = await createTimelineProfileFixture(tempRoot, {
      eventCount: options.eventCount,
      searchableTextBytes: options.textBytes,
      secondaryEventCount: 40,
    });
    const sourceStat = await fsp.stat(path.join(
      fixture.codexHome,
      'sessions',
      '2026',
      '07',
      '20',
      `rollout-2026-07-20T09-00-00-${fixture.longSessionId}.jsonl`,
    ));
    const preCodex = require(path.join(options.preRoot, 'src', 'codex.js'));
    const { createServer: createPreServer } = require(path.join(options.preRoot, 'server.js'));
    const preLifecycle = await runVariant({
      fixture,
      warmRepeats: options.warmRepeats,
      createServer: createPreServer,
      buildIndex: () => preCodex.buildIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
      }),
    });
    if (global.gc) global.gc();
    const adapter = getSourceAdapter('codex');
    const indexedMaterialized = await runVariant({
      fixture,
      warmRepeats: options.warmRepeats,
      createServer: createCurrentServer,
      async buildIndex() {
        const index = await adapter.buildIndex({
          repoRoot: fixture.repoRoot,
          sourceKind: 'codex',
          sourceHome: fixture.codexHome,
        });
        await validateIndexOwnershipForCommit(index);
        return index;
      },
    });
    if (preLifecycle.cold.digest !== indexedMaterialized.cold.digest
        || preLifecycle.cold.responseBytes !== indexedMaterialized.cold.responseBytes) {
      throw new Error('Controlled lifecycle comparison produced divergent timeline payloads');
    }
    return {
      schemaVersion: 1,
      runtime: {
        node: process.version,
        exposedGc: typeof global.gc === 'function',
      },
      fixture: {
        eventCount: options.eventCount,
        textBytes: options.textBytes,
        sourceBytes: sourceStat.size,
        warmRepeats: options.warmRepeats,
      },
      parity: {
        exactTimelineBytes: true,
        responseBytes: indexedMaterialized.cold.responseBytes,
      },
      preLifecycle: publicVariant(preLifecycle),
      indexedMaterialized: publicVariant(indexedMaterialized),
      coldDeltaMs: indexedMaterialized.cold.totalMs - preLifecycle.cold.totalMs,
      warmDeltaMs: timingStats(indexedMaterialized.warm.map((entry, index) => (
        entry.totalMs - preLifecycle.warm[index].totalMs
      ))),
    };
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
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
  profile,
  timingStats,
};
