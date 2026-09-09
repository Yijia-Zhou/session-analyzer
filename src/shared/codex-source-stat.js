'use strict';

const fsp = require('node:fs/promises');

const NS_PER_SECOND = 1_000_000_000n;
const MAX_SAFE_SOURCE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

async function acquireCodexSourceStat(filePath) {
  return normalizeCodexSourceBigIntStat(
    await fsp.stat(filePath, { bigint: true }),
  );
}

function normalizeCodexSourceBigIntStat(stat) {
  if (typeof stat?.dev !== 'bigint'
      || typeof stat.ino !== 'bigint'
      || typeof stat.size !== 'bigint'
      || typeof stat.mtimeNs !== 'bigint') {
    throw new TypeError('Codex source stat requires BigInt dev, ino, size, and mtimeNs');
  }

  let sec = stat.mtimeNs / NS_PER_SECOND;
  let nsec = stat.mtimeNs % NS_PER_SECOND;
  if (nsec < 0n) {
    sec -= 1n;
    nsec += NS_PER_SECOND;
  }

  const mtimeMs = Number(sec) * 1000 + Number(nsec) / 1_000_000;
  const mtime = new Date(Math.round(mtimeMs));

  return {
    fileIdentity: {
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
    },
    sizeBigInt: stat.size,
    mtimeMs,
    mtime,
  };
}

function sameCodexSourceIdentity(left, right) {
  return Boolean(left && right
    && left.device === right.device
    && left.inode === right.inode);
}

function sourceSizeToSafeNumber(sizeBigInt) {
  if (typeof sizeBigInt !== 'bigint') throw new TypeError('Codex source size must be a BigInt');
  if (sizeBigInt < 0n || sizeBigInt > MAX_SAFE_SOURCE_BYTES) return null;
  return Number(sizeBigInt);
}

function sourceSizeCoversAcceptedBytes(sizeBigInt, acceptedBytes) {
  if (typeof sizeBigInt !== 'bigint') throw new TypeError('Codex source size must be a BigInt');
  if (!Number.isSafeInteger(acceptedBytes) || acceptedBytes < 0) return false;
  return sizeBigInt >= BigInt(acceptedBytes);
}

function sourceSizeEqualsAcceptedBytes(sizeBigInt, acceptedBytes) {
  if (typeof sizeBigInt !== 'bigint') throw new TypeError('Codex source size must be a BigInt');
  if (!Number.isSafeInteger(acceptedBytes) || acceptedBytes < 0) return false;
  return sizeBigInt === BigInt(acceptedBytes);
}

module.exports = {
  acquireCodexSourceStat,
  normalizeCodexSourceBigIntStat,
  sameCodexSourceIdentity,
  sourceSizeToSafeNumber,
  sourceSizeCoversAcceptedBytes,
  sourceSizeEqualsAcceptedBytes,
};
