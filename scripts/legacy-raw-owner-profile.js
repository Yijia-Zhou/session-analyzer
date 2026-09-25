'use strict';

// Synthetic, content-free component profile. Run one scenario per process with
// --expose-gc so retained heap and process maxRSS are interpretable.
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createCodexLegacyRawOwnerBuilder, validateCodexV2ForCommit } = require('../src/codex-legacy-raw-owners');
const { validateCanonicalLegacyRawOwnerIndexForCommit } = require('../src/canonical-contract');
const { trustedPolicy } = require('../src/legacy-raw-owner-budget');

const scenario = process.argv[2] || 'dense';
if (!['dense', 'sparse', 'many-files', 'conflict', 'unicode', 'capacity'].includes(scenario)) {
  throw new Error('Scenario must be dense, sparse, many-files, conflict, unicode, or capacity');
}

function row(id, file, line) {
  return { rawId: `${id}:raw:${line}`, source: { file, line } };
}

function* sessions() {
  if (scenario === 'dense' || scenario === 'sparse') {
    const count = scenario === 'dense' ? 1_000_001 : 500_001;
    const file = `${scenario}.jsonl`;
    yield {
      id: scenario, sourceKind: 'codex', sourceFile: file,
      lineCount: scenario === 'dense' ? count : count * 2,
      rawEventCount: count,
      rawEvents: {
        *[Symbol.iterator]() {
          for (let index = 0; index < count; index += 1) {
            yield row(scenario, file, scenario === 'dense' ? index + 1 : index * 2 + 1);
          }
        },
      },
    };
  } else if (scenario === 'many-files') {
    for (let index = 0; index < 50_000; index += 1) {
      const id = `session-${index}`;
      const file = `file-${index}.jsonl`;
      yield {
        id, sourceKind: 'codex', sourceFile: file, lineCount: 20, rawEventCount: 20,
        rawEvents: { *[Symbol.iterator]() {
          for (let line = 1; line <= 20; line += 1) yield row(id, file, line);
        } },
      };
    }
  } else if (scenario === 'conflict') {
    for (const id of ['first', 'second', 'third']) {
      const file = 'conflict.jsonl';
      yield {
        id, sourceKind: 'codex', sourceFile: file, lineCount: 100_000, rawEventCount: 50_000,
        rawEvents: { *[Symbol.iterator]() {
          for (let index = 0; index < 50_000; index += 1) yield row(id, file, index * 2 + 1);
        } },
      };
    }
  } else if (scenario === 'unicode') {
    const id = `${'会话😀'.repeat(1000)}-id`;
    const file = `${'路径😀'.repeat(1000)}.jsonl`;
    yield {
      id, sourceKind: 'codex', sourceFile: file, lineCount: 100_000, rawEventCount: 50_000,
      rawEvents: { *[Symbol.iterator]() {
        for (let index = 0; index < 50_000; index += 1) yield row(id, file, index * 2 + 1);
      } },
    };
  } else {
    const id = 'capacity';
    const file = 'capacity.jsonl';
    yield {
      id, sourceKind: 'codex', sourceFile: file, lineCount: 100_000, rawEventCount: 50_000,
      rawEvents: { *[Symbol.iterator]() {
        for (let index = 0; index < 50_000; index += 1) yield row(id, file, index * 2 + 1);
      } },
    };
  }
}

async function main() {
  const policy = scenario === 'capacity' ? trustedPolicy({ buildWorkUnits: 1000 }) : undefined;
  global.gc?.();
  const beforeHeap = process.memoryUsage().heapUsed;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let sampledPeakRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss);
  }, 10);
  const builder = createCodexLegacyRawOwnerBuilder({ policy });
  const facts = new Map();
  const started = performance.now();
  let owners;
  let builderPeak;
  try {
    for (const item of sessions()) {
      facts.set(item.id, { sourceFile: item.sourceFile, lineCount: item.lineCount,
        rawEventCount: item.rawEventCount });
      await builder.observeSession(item);
    }
    owners = await builder.finish();
    builderPeak = builder.budgetSnapshot();
  } finally {
    builder.dispose();
  }
  const buildMs = performance.now() - started;
  const validationStarted = performance.now();
  await validateCanonicalLegacyRawOwnerIndexForCommit(owners, 'codex', { policy });
  await validateCodexV2ForCommit(owners, new Set(facts.keys()), facts, { policy });
  const validationMs = performance.now() - validationStarted;
  facts.clear();
  clearInterval(sample);
  delay.disable();
  global.gc?.();
  const afterHeap = process.memoryUsage().heapUsed;
  const result = {
    scenario, node: process.version, platform: process.platform,
    validationScope: 'canonical_v2_bytes_plus_codex_range_semantics',
    status: owners.status,
    entryCount: owners.status === 'available' ? owners.entryCount : undefined,
    rangeCount: owners.status === 'available' ? owners.rangeCount : undefined,
    accountedBytes: owners.status === 'available' ? owners.accountedBytes : undefined,
    capacity: owners.status === 'unavailable' ? owners.capacity : undefined,
    buildMs: Math.round(buildMs), validationMs: Math.round(validationMs),
    builderPeakUnits: builderPeak.peakUnits,
    builderPeakAccountedBytes: builderPeak.peakBytes,
    sampledPeakRss,
    processMaxRss: process.resourceUsage().maxRSS,
    retainedHeapDelta: afterHeap - beforeHeap,
    eventLoopDelayMaxMs: Math.round(delay.max / 1e6),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
