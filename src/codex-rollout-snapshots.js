'use strict';

// Private, process-local decoded snapshots. Source identity is checked using
// compressed bytes, while consumers continue to address logical JSONL bytes.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAX_IDLE_SNAPSHOTS = 4;
const IDLE_BYTE_BUDGET = 512 * 1024 * 1024;
const IDLE_TTL_MS = 60_000;
const snapshots = new Map();
const constructions = new Map();
const privateDirectories = new Set();
let decodeCount = 0;

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  throw error;
}

function changedSource() {
  const error = new Error('Codex compressed rollout changed while creating a private snapshot; rebuild the index.');
  error.code = 'CODEX_ROLLOUT_SOURCE_BUSY';
  return error;
}

function sameStat(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

async function physicalFingerprint(file, signal) {
  throwIfAborted(signal);
  const before = await fsp.stat(file, { bigint: true });
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file, { signal });
  let bytes = 0n;
  for await (const chunk of stream) {
    throwIfAborted(signal);
    hash.update(chunk);
    bytes += BigInt(chunk.length);
  }
  const after = await fsp.stat(file, { bigint: true });
  if (!sameStat(before, after) || bytes !== before.size) throw changedSource();
  return JSON.stringify([file, String(after.dev), String(after.ino), String(after.size),
    String(after.mtimeNs), hash.digest('base64url')]);
}

async function removeSnapshot(entry) {
  if (entry.refs > 0 || entry.removing) return;
  entry.removing = true;
  clearTimeout(entry.timer);
  if (snapshots.get(entry.key) === entry) snapshots.delete(entry.key);
  try {
    await fsp.rm(entry.directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 10 });
    privateDirectories.delete(entry.directory);
  } catch {
    // Keep the exact private path registered for process-exit cleanup.
  }
}

async function trimIdleSnapshots(keep = null) {
  const idle = [...snapshots.values()].filter((entry) => entry.refs === 0 && !entry.removing)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  let count = idle.length;
  let bytes = idle.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const entry of idle) {
    if (count <= MAX_IDLE_SNAPSHOTS && bytes <= IDLE_BYTE_BUDGET) break;
    // One oversized current snapshot may remain warm. Its memory use is still
    // streaming-bounded; a second snapshot can evict it and TTL always applies.
    if (entry === keep) continue;
    count -= 1;
    bytes -= entry.bytes;
    await removeSnapshot(entry);
  }
}

function acquireEntry(entry) {
  clearTimeout(entry.timer);
  entry.refs += 1;
  entry.lastUsed = Date.now();
  return entry;
}

async function releaseEntry(entry, discard = false) {
  entry.refs -= 1;
  if (entry.refs !== 0) return;
  if (discard) return removeSnapshot(entry);
  entry.lastUsed = Date.now();
  entry.timer = setTimeout(() => { void removeSnapshot(entry); }, IDLE_TTL_MS);
  entry.timer.unref();
  await trimIdleSnapshots(entry);
}

async function acquireSnapshot(descriptor, options) {
  const { signal } = options;
  const file = descriptor.physicalPath;
  const key = await physicalFingerprint(file, signal);
  throwIfAborted(signal);
  const cached = snapshots.get(key);
  if (cached && !cached.removing) return acquireEntry(cached);
  const pending = constructions.get(key);
  if (pending) {
    await new Promise((resolve, reject) => {
      const abort = () => {
        try { throwIfAborted(signal); } catch (error) { reject(error); }
      };
      signal?.addEventListener('abort', abort, { once: true });
      pending.then(() => { signal?.removeEventListener('abort', abort); resolve(); });
    });
    // A cancelled creator does not cancel independent readers. Recheck the
    // source fingerprint before reusing or retrying its construction.
    return acquireSnapshot(descriptor, options);
  }
  const work = buildSnapshot(descriptor, options, key);
  const settled = work.then(() => {}, () => {});
  constructions.set(key, settled);
  try {
    return await work;
  } finally {
    if (constructions.get(key) === settled) constructions.delete(key);
  }
}

async function buildSnapshot(descriptor, options, key) {
  const { signal, decode } = options;
  const file = descriptor.physicalPath;
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-decoded-'));
  privateDirectories.add(directory);
  const target = path.join(directory, 'snapshot.jsonl');
  let bytes = 0;
  try {
    await fsp.chmod(directory, 0o700);
    throwIfAborted(signal);
    const counter = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    } });
    decodeCount += 1;
    await pipeline(decode(), counter, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
    if (await physicalFingerprint(file, signal) !== key) throw changedSource();
    throwIfAborted(signal);
    // Concurrent cold readers can finish independently; publish only one copy.
    const concurrent = snapshots.get(key);
    if (concurrent && !concurrent.removing) {
      await fsp.rm(directory, { recursive: true, force: true });
      privateDirectories.delete(directory);
      return acquireEntry(concurrent);
    }
    const entry = { key, directory, file: target, bytes, refs: 0, timer: null,
      lastUsed: Date.now(), removing: false };
    snapshots.set(key, entry);
    return acquireEntry(entry);
  } catch (error) {
    await fsp.rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 10 }).catch(() => {});
    // Leave failed removals in the exact-path exit cleanup registry.
    try { await fsp.access(directory); } catch { privateDirectories.delete(directory); }
    throw error;
  }
}

function createSnapshotReadStream(descriptor, options) {
  return Readable.from((async function* readSnapshot() {
    const entry = await acquireSnapshot(descriptor, options);
    let input;
    try {
      throwIfAborted(options.signal);
      input = fs.createReadStream(entry.file, { signal: options.signal });
      for await (const chunk of input) {
        throwIfAborted(options.signal);
        yield chunk;
      }
    } finally {
      input?.destroy();
      await releaseEntry(entry, options.signal?.aborted === true);
    }
  })());
}

function snapshotStatsForTests() {
  return { decodeCount, entries: snapshots.size, privateDirectories: privateDirectories.size,
    decodedBytes: [...snapshots.values()].reduce((sum, entry) => sum + entry.bytes, 0),
    activeReaders: [...snapshots.values()].reduce((sum, entry) => sum + entry.refs, 0) };
}

async function clearSnapshotsForTests() {
  for (const entry of snapshots.values()) await removeSnapshot(entry);
}

process.once('exit', () => {
  for (const directory of privateDirectories) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* OS may already be shutting down. */ }
  }
});

module.exports = { createSnapshotReadStream, snapshotStatsForTests, clearSnapshotsForTests };
