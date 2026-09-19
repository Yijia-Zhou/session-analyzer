'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { zstdCompressSync } = require('node:zlib');
const snapshots = require('../src/codex-rollout-snapshots');
const storage = require('../src/codex-rollout-storage');

async function fixture(t, name = 'rollout') {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-snapshot-test-'));
  t.after(async () => {
    await snapshots.clearSnapshotsForTests();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, `${name}.jsonl.zst`);
  return { directory, file, descriptor: storage.normalizeArtifactDescriptor(file) };
}

async function read(descriptor, options = {}) {
  let result = '';
  for await (const chunk of storage.createLogicalReadStream(descriptor, options)) result += chunk.toString();
  return result;
}

test('warm snapshots reuse one decode and detect same-stat compressed rewrites', async (t) => {
  const { file, descriptor } = await fixture(t);
  const first = zstdCompressSync(Buffer.from('AAAA\n'));
  const second = zstdCompressSync(Buffer.from('BBBB\n'));
  assert.equal(first.length, second.length);
  await fsp.writeFile(file, first);
  const originalTime = new Date('2026-09-17T00:00:00Z');
  await fsp.utimes(file, originalTime, originalTime);
  const before = snapshots.snapshotStatsForTests().decodeCount;
  assert.equal(await read(descriptor), 'AAAA\n');
  assert.equal(await read(descriptor), 'AAAA\n');
  assert.equal(snapshots.snapshotStatsForTests().decodeCount, before + 1);
  await fsp.writeFile(file, second);
  await fsp.utimes(file, originalTime, originalTime);
  assert.equal(await read(descriptor), 'BBBB\n');
  assert.equal(snapshots.snapshotStatsForTests().decodeCount, before + 2);
  assert.equal(snapshots.snapshotStatsForTests().activeReaders, 0);
});

test('failed and cancelled snapshot construction cleans private resources', async (t) => {
  const { file, descriptor } = await fixture(t);
  await snapshots.clearSnapshotsForTests();
  await fsp.writeFile(file, zstdCompressSync(Buffer.from('source\n')));
  const baseline = snapshots.snapshotStatsForTests().privateDirectories;
  const failed = snapshots.createSnapshotReadStream(descriptor, {
    decode: () => Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('synthetic failure'); })()),
  });
  await assert.rejects(async () => { for await (const chunk of failed) void chunk; }, /synthetic failure/);
  assert.equal(snapshots.snapshotStatsForTests().privateDirectories, baseline);
  const controller = new AbortController();
  const cancelled = snapshots.createSnapshotReadStream(descriptor, {
    signal: controller.signal,
    decode: () => Readable.from((async function* () {
      yield Buffer.alloc(65536);
      controller.abort();
      yield Buffer.alloc(65536);
    })()),
  });
  await assert.rejects(async () => { for await (const chunk of cancelled) void chunk; }, { name: 'AbortError' });
  assert.equal(snapshots.snapshotStatsForTests().privateDirectories, baseline);
  assert.equal(snapshots.snapshotStatsForTests().activeReaders, 0);
});

test('idle snapshot eviction and explicit cleanup keep resource ownership bounded', async (t) => {
  const { directory } = await fixture(t);
  await snapshots.clearSnapshotsForTests();
  for (let i = 0; i < 7; i += 1) {
    const file = path.join(directory, `rollout-${i}.jsonl.zst`);
    await fsp.writeFile(file, zstdCompressSync(Buffer.from(`row-${i}\n`)));
    assert.equal(await read(storage.normalizeArtifactDescriptor(file)), `row-${i}\n`);
  }
  const stats = snapshots.snapshotStatsForTests();
  assert.ok(stats.entries <= 4);
  assert.ok(stats.privateDirectories <= 4);
  await snapshots.clearSnapshotsForTests();
  assert.equal(snapshots.snapshotStatsForTests().privateDirectories, 0);
});

test('concurrent cold readers share one private decode', async (t) => {
  const { file, descriptor } = await fixture(t);
  const text = 'synthetic shared row\n'.repeat(100_000);
  await fsp.writeFile(file, zstdCompressSync(Buffer.from(text)));
  const before = snapshots.snapshotStatsForTests().decodeCount;
  const results = await Promise.all(Array.from({ length: 6 }, () => read(descriptor)));
  for (const result of results) assert.equal(result, text);
  assert.equal(snapshots.snapshotStatsForTests().decodeCount, before + 1);
  assert.equal(snapshots.snapshotStatsForTests().activeReaders, 0);
});
