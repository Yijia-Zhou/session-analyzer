'use strict';

// Standalone, synthetic storage profile; no real transcripts or timing gates.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createZstdCompress, zstdCompressSync } = require('node:zlib');
const { performance } = require('node:perf_hooks');
const codex = require('../src/codex');
const storage = require('../src/codex-rollout-storage');
const snapshots = require('../src/codex-rollout-snapshots');
const { materializeSessionForIndex } = require('../src/source-adapters');

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-profile-'));
  const observations = { node: process.version, source: 'synthetic', reader: {}, sessions: [] };
  try {
    const large = path.join(root, 'large.jsonl.zst');
    const line = Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(4000) } }) + '\n');
    const count = Math.ceil(64 * 1024 * 1024 / line.length);
    await pipeline(Readable.from((async function* () {
      for (let i = 0; i < count; i += 1) yield line;
    })()), createZstdCompress(), fs.createWriteStream(large));
    const baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss;
    const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 5);
    const decodeBefore = snapshots.snapshotStatsForTests().decodeCount;
    try {
      for (const phase of ['cold', 'warm']) {
        const started = performance.now();
        let bytes = 0;
        for await (const chunk of storage.createLogicalReadStream(large)) bytes += chunk.length;
        observations.reader[phase] = { milliseconds: +(performance.now() - started).toFixed(2), logicalBytes: bytes };
      }
    } finally { clearInterval(sampler); }
    observations.reader.decodeCount = snapshots.snapshotStatsForTests().decodeCount - decodeBefore;
    observations.reader.baselineRssMiB = +(baselineRss / 1048576).toFixed(2);
    observations.reader.sampledPeakRssMiB = +(peakRss / 1048576).toFixed(2);
    await snapshots.clearSnapshotsForTests();

    const id = 'bbbbbbbb-0918-4918-8918-bbbbbbbbbbbb';
    const repoRoot = path.join(root, 'repo');
    const rows = [{ type: 'session_meta', payload: { id, cwd: repoRoot } }];
    for (let i = 0; i < 1024; i += 1) rows.push({ type: 'event_msg', payload: {
      type: i % 2 ? 'agent_message' : 'user_message', message: `${i}: ${'synthetic 文本 '.repeat(80)}`,
    } });
    const bytes = Buffer.from(rows.map((record) => JSON.stringify({ timestamp: '2026-09-18T00:00:00Z', ...record })).join('\n') + '\n');
    for (const representation of ['plain', 'zstd']) {
      const home = path.join(root, representation);
      await fsp.mkdir(path.join(home, 'sessions'), { recursive: true });
      await fsp.writeFile(path.join(home, 'sessions', `rollout-${id}.jsonl${representation === 'zstd' ? '.zst' : ''}`),
        representation === 'zstd' ? zstdCompressSync(bytes) : bytes);
      const measurement = { representation, logicalBytes: bytes.length };
      const decodeStart = snapshots.snapshotStatsForTests().decodeCount;
      let start = performance.now();
      const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome: home });
      measurement.coldIndexMs = +(performance.now() - start).toFixed(2);
      start = performance.now();
      const session = await materializeSessionForIndex(index, index.sessionsById.get(id));
      const event = session.logicalEvents.filter((candidate) => candidate.layer === 'main').at(-1);
      await codex.buildHydratedEventDetail(index, session, event.id);
      measurement.firstDetailIncludingMaterializationMs = +(performance.now() - start).toFixed(2);
      start = performance.now();
      await codex.buildHydratedEventDetail(index, session, event.id);
      measurement.warmDetailMs = +(performance.now() - start).toFixed(2);
      measurement.decodeCount = snapshots.snapshotStatsForTests().decodeCount - decodeStart;
      observations.sessions.push(measurement);
    }
    console.log(JSON.stringify(observations, null, 2));
  } finally {
    await snapshots.clearSnapshotsForTests();
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
