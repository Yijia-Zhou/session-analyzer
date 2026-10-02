'use strict';

// Run alone. Synthetic storage/reader scale evidence, not a source-parser or UI benchmark.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createSessionQuery } = require('../src/session-query');
const { createProjectQueryStoreBuilder, disposeProjectQueryStore, scanProjectQueryShard,
  validateProjectQueryStoreForCommit } = require('../src/project-query-store');
const { searchTextParts } = require('../src/search-text-stream');
const { capacitySession } = require('./query-capacity-fixture');

const argumentsMap = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
const number = (key, fallback) => {
  const value = Number(argumentsMap[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid --${key}`);
  return value;
};

async function main() {
  const mode = argumentsMap.mode || 'query';
  const requestedRows = number('rows', mode === 'pagination' ? 1000502 : 3000);
  const textBytes = number('text-bytes', 64);
  const batchRows = number('batch-rows', 3000);
  const sampled = { rss: 0, heapUsed: 0, external: 0 };
  const sample = () => { const value = process.memoryUsage(); for (const key of Object.keys(sampled)) sampled[key] = Math.max(sampled[key], value[key]); };
  const timer = setInterval(sample, 10);
  const started = performance.now();
  let directory;
  let store;
  try {
    if (mode === 'pagination') {
      const session = capacitySession('pagination', requestedRows, 'synthetic', ['main']);
      const query = createSessionQuery();
      const index = { sourceKind: session.sourceKind, repoRoot: '/synthetic/repo', sessions: [session], sessionsById: new Map([[session.id, session]]) };
      const offset = requestedRows > 1000500 ? 1000500 : Math.max(0, requestedRows - 2);
      const filters = query.filtersFromSearchParams(new URLSearchParams({ offset, limit: 2 }));
      const coldStart = performance.now();
      const timeline = query.getTimeline(index, session, filters);
      const coldMs = performance.now() - coldStart;
      const warmStart = performance.now();
      const warm = query.getTimeline(index, session, filters);
      const warmMs = performance.now() - warmStart;
      const file = query.getFileActivity(index, session, 'src/capacity.js', { offset, limit: 2 });
      assert.equal(timeline.events[0].id, `pagination:main:${offset}`);
      assert.equal(warm.events[0].id, timeline.events[0].id);
      assert.equal(file.events[0].id, timeline.events[0].id);
      sample();
      console.log(JSON.stringify({ mode, node: process.version, requestedRows, offset, returnedIds: timeline.events.map(event => event.id), coldMs, warmMs,
        totalMs: performance.now() - started, sampledBytes: sampled, processMaxRssKiB: process.resourceUsage().maxRSS }));
      return;
    }
    directory = fs.mkdtempSync(path.join(argumentsMap['temp-root'] || os.tmpdir(), 'session-query-capacity-profile-'));
    const builder = createProjectQueryStoreBuilder({ memoryRows: 100000, tempRoot: directory });
    const ids = [];
    const text = 'x'.repeat(Math.max(0, textBytes - 6)) + 'needle';
    let actualRows = 0;
    while (actualRows < requestedRows) {
      const count = Math.min(batchRows, requestedRows - actualRows);
      const session = capacitySession(`capacity-${ids.length}`, Math.ceil(count / 3), text);
      let excess = session.logicalEvents.length + session.rawEvents.length - count;
      const rawExcess = Math.min(excess, session.rawEvents.length);
      if (rawExcess) session.rawEvents.splice(-rawExcess, rawExcess);
      excess -= rawExcess;
      if (excess) session.logicalEvents.splice(-excess, excess);
      await builder.addSessionAsync(session);
      ids.push(session.id);
      actualRows += count;
      sample();
    }
    store = builder.finish();
    const buildMs = performance.now() - started;
    console.error(JSON.stringify({ phase: 'built', actualRows, buildMs, accountedBytes: store.accountedBytes }));
    const verifyStarted = performance.now();
    await validateProjectQueryStoreForCommit(store, ids);
    const verifyMs = performance.now() - verifyStarted;
    console.error(JSON.stringify({ phase: 'verified', verifyMs }));
    const scan = async signal => {
      let visited = 0;
      let hits = 0;
      for (const id of ids) for (const layer of ['main', 'protocol', 'raw']) {
        await scanProjectQueryShard(store, id, layer, { includeText: true, signal,
          searchTextParts: (preview, parts, activeSignal) => searchTextParts(preview, parts, 'needle', activeSignal),
        }, row => { visited += 1; if (row.searchMatch?.hit || row.searchText?.includes('needle')) hits += 1; });
      }
      return { visited, hits };
    };
    const coldStarted = performance.now();
    const cold = await scan();
    const coldMs = performance.now() - coldStarted;
    console.error(JSON.stringify({ phase: 'cold-query', coldMs, ...cold }));
    const warmStarted = performance.now();
    const warm = await scan();
    const warmMs = performance.now() - warmStarted;
    assert.equal(cold.visited, requestedRows);
    assert.equal(cold.hits, requestedRows);
    assert.deepEqual(warm, cold);
    const controller = new AbortController();
    const reason = new Error('profile cancellation');
    const cancelledStarted = performance.now();
    setImmediate(() => controller.abort(reason));
    await assert.rejects(scan(controller.signal), error => error === reason);
    const cancellationMs = performance.now() - cancelledStarted;
    sample();
    const diskBytes = fs.readdirSync(directory).reduce((sum, child) => sum + fs.statSync(path.join(directory, child, 'rows.bin')).size, 0);
    const result = { mode, node: process.version, requestedRows, actualRows, sourceSearchTextBytes: requestedRows * Buffer.byteLength(text),
      schemaVersion: store.schemaVersion, accountedBytes: store.accountedBytes, diskBytes, buildMs, verifyMs, coldMs, warmMs, cancellationMs,
      sampledBytes: sampled, processMaxRssKiB: process.resourceUsage().maxRSS };
    disposeProjectQueryStore(store);
    result.remainingTemporaryEntries = fs.readdirSync(directory).length;
    assert.equal(result.remainingTemporaryEntries, 0);
    console.log(JSON.stringify(result));
  } finally {
    clearInterval(timer);
    if (store) disposeProjectQueryStore(store);
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
