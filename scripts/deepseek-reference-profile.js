'use strict';

// Standalone synthetic characterization. Each sample gets a fresh bounded
// process; results are observations, never timing gates or real-corpus claims.
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { zstdCompressSync } = require('node:zlib');

const readerArg = process.argv.find(arg => arg.startsWith('--reader-root='));
const readerRoot = readerArg ? path.resolve(readerArg.slice('--reader-root='.length)) : path.resolve(__dirname, '..');
const workerArg = process.argv.find(arg => arg.startsWith('--sample='));
const round = n => +n.toFixed(2);

async function measure(work) {
  global.gc?.();
  const before = process.memoryUsage();
  const start = performance.now();
  const value = await work();
  const elapsedMs = round(performance.now() - start);
  const after = process.memoryUsage();
  return { value, metrics: { elapsedMs, heapDeltaMiB: round((after.heapUsed - before.heapUsed) / 1048576),
    rssDeltaMiB: round((after.rss - before.rss) / 1048576), processMaxRssKiB: process.resourceUsage().maxRSS } };
}

async function sample(spec) {
  const storage = require(path.join(readerRoot, 'src/deepseek-harness-storage'));
  if (spec.kind === 'decode') {
    const refs = spec.shape === 'range' ? [[0, spec.n - 1]]
      : spec.shape === 'scalars' ? Array.from({ length: spec.n }, (_, i) => (spec.n - i - 1) * 2)
        : Array.from({ length: spec.n }, (_, i) => i % 2 ? [i * 3, i * 3 + 1] : i * 3);
    const record = { type: 'synthetic/event', seq: spec.n * 3, time: 1, data: {}, sourceEventSeqs: refs };
    const expectedSize = refs.reduce((sum, r) => sum + (Array.isArray(r) ? r[1] - r[0] + 1 : 1), 0);
    const { value, metrics } = await measure(() => storage.decodeSessionEventRecord(record, 4));
    const size = value.sourceEventSeqs.reduce((sum, r) => sum + (Array.isArray(r) ? r[1] - r[0] + 1 : 1), 0);
    assert.equal(size, expectedSize);
    return { ...spec, encodedEntries: refs.length, expandedCardinality: size,
      retainedEntries: value.sourceEventSeqs.length, ...metrics };
  }

  const { buildDeepSeekIndex, deepSeekAdapter, readDeepSeekRawRecord } = require(path.join(readerRoot, 'src/deepseek-harness'));
  const { materializeSessionForIndex, buildEventDetailForSession } = require(path.join(readerRoot, 'src/source-adapters'));
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-reference-profile-'));
  try {
    const repoRoot = path.join(root, 'workspace');
    const sourceHome = path.join(root, 'sessions');
    const directory = path.join(sourceHome, 'project', 'synthetic');
    await fsp.mkdir(directory, { recursive: true });
    await fsp.mkdir(repoRoot);
    const header = { type: 'session', version: 4, id: 'synthetic', createdAt: 1, cwd: repoRoot, isSeeded: false, delegationDepth: 0 };
    const rows = Array.from({ length: spec.n }, (_, seq) => ({ type: 'synthetic/event', seq, time: seq + 1,
      data: {}, ...(seq ? { sourceEventSeqs: [[0, seq - 1]] } : {}) }));
    const row = (type, data, extras = {}) => rows.push({ type, seq: rows.length, time: rows.length + 1, data, ...extras });
    row('compaction/start', { compactionId: 'synthetic-c' });
    row('compaction/summary', { compactionId: 'synthetic-c', summary: [{ type: 'text', text: 'capacity summary' }],
      shadowedRange: { start: 0, end: spec.n - 1 }, shadowedSeqs: Array.from({ length: spec.n }, (_, i) => i), shadowedTokenCount: spec.n });
    row('user/message', { role: 'user', source: { kind: 'compact-checkpoint', compactionId: 'synthetic-c' },
      content: [{ type: 'text', text: 'capacity checkpoint' }] },
    { sourceEventSeqs: [[0, spec.n + 1]], surfaceOp: { op: 'replace', startSeq: 0, endSeq: spec.n - 1 } });
    row('compaction/end', { compactionId: 'synthetic-c' });
    const lines = [header, ...rows].map(value => Buffer.from(JSON.stringify(value) + '\n'));
    const bytes = Buffer.concat(lines);
    const stored = spec.compressed ? Buffer.concat(lines.map(line => zstdCompressSync(line))) : bytes;
    await fsp.writeFile(path.join(directory, 'session.v4.jsonl' + (spec.compressed ? '.zstd' : '')), stored);
    const indexResult = await measure(() => buildDeepSeekIndex({ repoRoot, sourceHome }));
    const index = indexResult.value;
    assert.equal(index.sessions.length, 1, JSON.stringify(index.sourceDiagnostics));
    assert.equal(index.sourceDiagnostics.totalCount, 0);
    const materialized = await measure(() => materializeSessionForIndex(index, index.sessions[0]));
    const session = materialized.value;
    const event = session.logicalEvents.find(e => e.kind === 'compaction');
    assert.equal(event.status, 'success');
    assert.deepEqual(session.counts, index.sessions[0].counts);
    const first = await measure(() => buildEventDetailForSession(index, session, event.id, 'main'));
    const warm = await measure(() => buildEventDetailForSession(index, session, event.id, 'main'));
    assert.deepEqual(first.value, warm.value);
    assert.equal(deepSeekAdapter.query.getTimeline(index, session, { layer: 'main', q: 'capacity summary' }).searchEventCount, 1);
    const raw = session.rawEvents.find(r => r.seq0 === spec.n + 2);
    assert.deepEqual(JSON.parse((await readDeepSeekRawRecord(index, session, raw)).raw), rows[spec.n + 2]);
    return { ...spec, encodedBytes: bytes.length, storedBytes: stored.length,
      impliedExpandedReferences: spec.n * (spec.n - 1) / 2 + spec.n + 2,
      coldIndex: indexResult.metrics, materialization: materialized.metrics,
      firstDetail: first.metrics, warmDetail: warm.metrics, compaction: event.status, exactRaw: true };
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  if (workerArg) {
    console.log(JSON.stringify(await sample(JSON.parse(workerArg.slice('--sample='.length)))));
    return;
  }
  const cases = [10000, 100000, 1000000].map(n => ({ kind: 'decode', shape: 'range', n }));
  cases.push({ kind: 'decode', shape: 'scalars', n: 10000 }, { kind: 'decode', shape: 'mixed', n: 10000 });
  for (const n of [1000, 4000]) for (const compressed of [false, true]) cases.push({ kind: 'session', n, compressed });
  const samples = [];
  for (const spec of cases) for (let repeat = 1; repeat <= 3; repeat += 1) {
    const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=256', __filename,
      `--reader-root=${readerRoot}`, `--sample=${JSON.stringify(spec)}`], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (child.error || child.status !== 0) throw new Error(child.error?.message || child.stderr || `sample exited ${child.status}`);
    samples.push({ repeat, ...JSON.parse(child.stdout) });
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, readerRoot,
    evidence: 'synthetic, sequential isolated samples; post-call heap deltas and process RSS high-water marks, not phase allocation peaks', samples }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
