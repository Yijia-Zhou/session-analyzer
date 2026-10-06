'use strict';

// One synthetic, content-free full Index commit profile. This includes the
// shared Index contract, Session ID/fact preparation, legacy Raw semantics,
// read-only fingerprints, and ProjectQueryStore validation. It does not
// measure the earlier source parser/build phase as commit time.
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { buildSourceBackedIndex } = require('../src/codex');
const { validateIndexOwnershipForCommit } = require('../src/source-adapters');

const rows = process.argv[2] === undefined ? 50_000 : Number(process.argv[2]);
if (!Number.isSafeInteger(rows) || rows < 1 || rows > 50_000) {
  throw new Error('Row count must be an integer from 1 through 50,000');
}

async function makeFixture(root) {
  const codexHome = path.join(root, 'codex-home');
  const repoRoot = path.join(root, 'repo');
  const directory = path.join(codexHome, 'sessions', '2026', '09', '25');
  const id = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
  const file = path.join(directory, `rollout-${id}.jsonl`);
  await fsp.mkdir(directory, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const metadata = {
    type: 'session_meta', timestamp: '2026-09-25T00:00:00.000Z',
    payload: { id, cwd: repoRoot },
  };
  const lines = [JSON.stringify(metadata)];
  for (let index = 0; index < rows; index += 1) {
    lines.push('');
    lines.push(JSON.stringify({
      type: 'event_msg', timestamp: '2026-09-25T00:00:01.000Z',
      payload: { type: 'user_message', message: `synthetic message ${index}` },
    }));
  }
  await fsp.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
  return { codexHome, repoRoot };
}

async function measureCommit(index) {
  global.gc?.();
  const beforeHeap = process.memoryUsage().heapUsed;
  let sampledPeakRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss);
  }, 10);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let checkpoints = 0;
  const started = performance.now();
  try {
    await validateIndexOwnershipForCommit(index, {
      onChunk() { checkpoints += 1; },
    });
  } finally {
    clearInterval(sample);
    delay.disable();
  }
  const commitMs = performance.now() - started;
  global.gc?.();
  return {
    commitMs: Math.round(commitMs),
    checkpoints,
    sampledPeakRss,
    retainedHeapDelta: process.memoryUsage().heapUsed - beforeHeap,
    eventLoopDelayMaxMs: Math.round(delay.max / 1e6),
  };
}

async function measureCancellation(index) {
  const controller = new AbortController();
  const started = performance.now();
  let signalledAt = null;
  const timer = setTimeout(() => {
    signalledAt = performance.now();
    controller.abort();
  }, 0);
  let outcome = 'completed';
  try {
    await validateIndexOwnershipForCommit(index, { signal: controller.signal });
  } catch (error) {
    if (error?.name !== 'AbortError') throw error;
    outcome = 'cancelled';
  } finally {
    clearTimeout(timer);
  }
  const settledAt = performance.now();
  if (outcome !== 'cancelled' || signalledAt === null) {
    throw new Error('Full commit cancellation probe did not observe AbortError');
  }
  return {
    outcome,
    startToSignalMs: Math.round(signalledAt - started),
    signalToSettleMs: Math.round(settledAt - signalledAt),
    totalMs: Math.round(settledAt - started),
  };
}

async function main() {
  const prefix = 'legacy-raw-full-commit-';
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    const fixture = await makeFixture(root);
    const buildStarted = performance.now();
    const index = await buildSourceBackedIndex(fixture);
    const buildMs = Math.round(performance.now() - buildStarted);
    if (index.legacyRawOwners.status !== 'available' || index.legacyRawOwners.rangeCount !== rows + 1) {
      throw new Error('Synthetic sparse fixture did not produce the expected available ranges');
    }
    const commit = await measureCommit(index);
    const cancellation = await measureCancellation(index);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      scenario: 'one_sparse_codex_session_with_blank_physical_lines',
      node: process.version, platform: process.platform,
      syntheticRawRows: rows + 1,
      rangeCount: index.legacyRawOwners.rangeCount,
      buildMs,
      commit,
      cancellation,
    })}\n`);
  } finally {
    const resolvedRoot = path.resolve(root);
    if (path.dirname(resolvedRoot) !== path.resolve(os.tmpdir())
        || !path.basename(resolvedRoot).startsWith(prefix)) {
      throw new Error('Refusing to remove an unexpected profile path');
    }
    await fsp.rm(resolvedRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
