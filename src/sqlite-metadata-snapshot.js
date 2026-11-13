'use strict';

// Copy optional SQLite metadata without opening the live database with SQLite.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isPathInsideOrSame } = require('./shared/fs-path');
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((key) => a[key] === b[key]);
async function inspectDatabase(filename, root, maxFileBytes) {
  const states = new Map();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    let stat;
    try { stat = await fs.lstat(filename + suffix, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT' && suffix) continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(maxFileBytes)
      || !isPathInsideOrSame(await fs.realpath(filename + suffix), root)) throw new Error('Unsafe or oversized desktop metadata');
    if (suffix === '-journal' && stat.size) throw new Error('Desktop rollback journal is active');
    if (suffix === '' || suffix === '-wal') states.set(suffix, stat);
  }
  return states;
}
async function copyDatabaseFile(source, destination, expected, signal) {
  let input; let output;
  try {
    input = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!sameFile(expected, await input.stat({ bigint: true }))) throw new Error('Desktop database changed before copy');
    output = await fs.open(destination, 'wx');
    const buffer = Buffer.allocUnsafe(256 * 1024); let offset = 0;
    while (offset < Number(expected.size)) {
      signal?.throwIfAborted();
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, Number(expected.size) - offset), offset);
      if (!bytesRead) throw new Error('Desktop database truncated during copy');
      let written = 0;
      while (written < bytesRead) {
        const { bytesWritten } = await output.write(buffer, written, bytesRead - written, offset + written);
        if (!bytesWritten) throw new Error('Desktop snapshot write failed');
        written += bytesWritten;
      }
      offset += bytesRead;
    }
    if (!sameFile(expected, await input.stat({ bigint: true }))) throw new Error('Desktop database changed during copy');
  } finally { await input?.close(); await output?.close(); }
}

async function copySqliteMetadataSnapshot(filename, { root, signal,
  maxFileBytes = 256 * 1024 * 1024, maxTotalBytes = Number.POSITIVE_INFINITY,
  prefix = 'session-analyzer-sqlite-metadata-' } = {}) {
  signal?.throwIfAborted();
  let directory;
  try {
    const before = await inspectDatabase(filename, root, maxFileBytes);
    const bytes = [...before.values()].reduce((sum, stat) => sum + Number(stat.size), 0);
    if (bytes > maxTotalBytes) throw new Error('Desktop metadata snapshot exceeds its byte budget');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const copied = path.join(directory, 'metadata.sqlite');
    for (const [suffix, stat] of before) await copyDatabaseFile(filename + suffix, copied + suffix, stat, signal);
    const after = await inspectDatabase(filename, root, maxFileBytes);
    if (before.size !== after.size || [...before].some(([suffix, stat]) => !after.has(suffix) || !sameFile(stat, after.get(suffix)))) {
      throw new Error('Desktop database changed across copy');
    }
    signal?.throwIfAborted();
    return { filename: copied, bytes, dispose: () => fs.rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { copySqliteMetadataSnapshot };
