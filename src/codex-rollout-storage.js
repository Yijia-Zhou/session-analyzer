'use strict';

// Codex rollouts are JSONL at the logical boundary.  A rollout may be stored
// as either `name.jsonl` or `name.jsonl.zst`; callers must use this module for
// selection and reading so that logical line numbers do not depend on the
// physical representation.

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { createSnapshotReadStream } = require('./codex-rollout-snapshots');
const { once } = require('node:events');
const { Readable, Transform } = require('node:stream');
const { constants: zlibConstants, createZstdDecompress } = require('node:zlib');

const CODEX_ROLLOUT_STORAGE_INVALID = 'CODEX_ROLLOUT_STORAGE_INVALID';
const CODEX_ROLLOUT_ZSTD_UNAVAILABLE = 'CODEX_ROLLOUT_ZSTD_UNAVAILABLE';
const CODEX_ROLLOUT_SOURCE_BUSY = 'CODEX_ROLLOUT_SOURCE_BUSY';
const CODEX_ROLLOUT_SOURCE_ROOT_NOT_FOUND = 'SOURCE_ROOT_NOT_FOUND';
const CODEX_ROLLOUT_SOURCE_ROOT_NOT_DIRECTORY = 'SOURCE_ROOT_NOT_DIRECTORY';
const CODEX_ROLLOUT_SOURCE_UNREADABLE = 'SOURCE_ARTIFACT_UNREADABLE';

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function storageError(message, code = CODEX_ROLLOUT_STORAGE_INVALID, cause = undefined) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function hasBuiltInZstd() {
  return typeof createZstdDecompress === 'function';
}

function requireBuiltInZstd(pathForError = '') {
  if (hasBuiltInZstd()) return;
  throw storageError(
    `Codex Zstandard rollouts require Node's built-in node:zlib Zstd support, `
      + `which is unavailable on this Node ${process.version} runtime`
      + (pathForError ? ` (while reading ${pathForError})` : '')
      + '. Upgrade to Node 22.15.0 or newer. Plain .jsonl rollouts remain readable.',
    CODEX_ROLLOUT_ZSTD_UNAVAILABLE,
  );
}

function compressionForArtifact(filePath) {
  const base = path.basename(String(filePath || ''));
  if (base.endsWith('.jsonl.zst')) return 'zstd';
  if (base.endsWith('.jsonl')) return 'none';
  throw storageError(`unsupported Codex rollout artifact name: ${base}`);
}

function logicalRolloutPath(filePath) {
  const value = String(filePath || '');
  return value.endsWith('.jsonl.zst') ? value.slice(0, -4) : value;
}

function isCodexRolloutArtifactName(name) {
  const value = String(name || '');
  // Temporary/lock files do not end in these suffixes.  Keeping this check
  // explicit prevents a future broadening of the suffix rule from admitting
  // writer scratch files.
  if (!value || value.endsWith('.tmp') || value.endsWith('.part')
      || value.endsWith('.partial') || value.endsWith('.lock') || value.endsWith('~')) {
    return false;
  }
  return value.endsWith('.jsonl') || value.endsWith('.jsonl.zst');
}

function normalizeArtifactDescriptor(filePath, options = {}) {
  const physicalPath = path.resolve(String(filePath || ''));
  const compression = options.compression || compressionForArtifact(physicalPath);
  if (!['none', 'zstd'].includes(compression)) {
    throw storageError(`unsupported Codex rollout compression: ${compression}`);
  }
  const logicalPath = path.resolve(options.logicalPath || logicalRolloutPath(physicalPath));
  return Object.freeze({
    physicalPath,
    logicalPath,
    compression,
  });
}

function samePhysicalIdentity(left, right) {
  return Boolean(left && right
    && left.device === right.device
    && left.inode === right.inode);
}

function sameRolloutIdentity(left, right) {
  if (!samePhysicalIdentity(left, right)) return false;
  if (left.compression !== undefined || right.compression !== undefined) {
    return left.compression === right.compression;
  }
  return true;
}

function physicalIdentity(stat, descriptor) {
  const identity = {
    device: String(stat.dev),
    inode: String(stat.ino),
  };
  // Preserve the historical two-field identity for plain rollouts.  The
  // compression discriminator is required for representation-change checks.
  if (descriptor.compression === 'zstd') identity.compression = 'zstd';
  return identity;
}

function normalizeStat(stat, descriptor) {
  if (typeof stat?.dev !== 'bigint'
      || typeof stat.ino !== 'bigint'
      || typeof stat.size !== 'bigint'
      || typeof stat.mtimeNs !== 'bigint') {
    throw new TypeError('Codex rollout stat requires BigInt dev, ino, size, and mtimeNs');
  }
  const nsPerSecond = 1_000_000_000n;
  let sec = stat.mtimeNs / nsPerSecond;
  let nsec = stat.mtimeNs % nsPerSecond;
  if (nsec < 0n) {
    sec -= 1n;
    nsec += nsPerSecond;
  }
  const mtimeMs = Number(sec) * 1000 + Number(nsec) / 1_000_000;
  return {
    fileIdentity: physicalIdentity(stat, descriptor),
    sizeBigInt: stat.size,
    mtimeMs,
    mtime: new Date(Math.round(mtimeMs)),
    physicalBytes: stat.size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(stat.size) : null,
    descriptor,
  };
}

async function acquireRolloutStat(descriptorOrPath) {
  const descriptor = typeof descriptorOrPath === 'string'
    ? normalizeArtifactDescriptor(descriptorOrPath)
    : normalizeArtifactDescriptor(
      descriptorOrPath?.physicalPath,
      descriptorOrPath,
    );
  return normalizeStat(await fsp.stat(descriptor.physicalPath, { bigint: true }), descriptor);
}

function descriptorForRelativePath(sessionsRoot, relativePath, options = {}) {
  const root = path.resolve(String(sessionsRoot || ''));
  const requested = String(relativePath || '');
  if (!requested || path.isAbsolute(requested)) {
    throw storageError('Codex rollout relative path is invalid', CODEX_ROLLOUT_STORAGE_INVALID);
  }
  const logicalPath = path.resolve(root, logicalRolloutPath(requested));
  if (!isPathWithinRoot(logicalPath, root)) {
    throw storageError('Codex rollout path escapes the sessions root', CODEX_ROLLOUT_STORAGE_INVALID);
  }
  const physicalHint = options.physicalPath ? path.resolve(options.physicalPath) : '';
  const expectedCompression = options.compression || options.expectedCompression || '';
  const candidates = expectedCompression === 'zstd'
    ? [`${logicalPath}.zst`]
    : expectedCompression === 'none'
      ? [logicalPath]
      : [logicalPath, `${logicalPath}.zst`];
  const selected = physicalHint || candidates[0];
  if (!isPathWithinRoot(selected, root)) {
    throw storageError('Codex rollout path escapes the sessions root', CODEX_ROLLOUT_STORAGE_INVALID);
  }
  return normalizeArtifactDescriptor(selected, {
    compression: expectedCompression || undefined,
    logicalPath,
  });
}

async function resolveRolloutArtifact(sessionsRoot, relativePath, options = {}) {
  const root = path.resolve(String(sessionsRoot || ''));
  const requested = String(relativePath || '');
  if (!requested || path.isAbsolute(requested)) {
    throw storageError('Codex rollout relative path is invalid', CODEX_ROLLOUT_STORAGE_INVALID);
  }
  const logicalPath = path.resolve(root, logicalRolloutPath(requested));
  if (!isPathWithinRoot(logicalPath, root)) {
    throw storageError('Codex rollout path escapes the sessions root', CODEX_ROLLOUT_STORAGE_INVALID);
  }
  const expectedCompression = options.compression || options.expectedCompression || '';
  const expectedPhysicalPath = options.physicalPath
    ? path.resolve(options.physicalPath)
    : '';
  if (expectedPhysicalPath) {
    if (!isPathWithinRoot(expectedPhysicalPath, root)) {
      throw storageError('Codex rollout path escapes the sessions root', CODEX_ROLLOUT_STORAGE_INVALID);
    }
    return normalizeArtifactDescriptor(expectedPhysicalPath, {
      compression: expectedCompression || undefined,
      logicalPath,
    });
  }
  const candidates = expectedCompression === 'zstd'
    ? [`${logicalPath}.zst`]
    : expectedCompression === 'none'
      ? [logicalPath]
      : [logicalPath, `${logicalPath}.zst`];
  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate);
      if (stat.isFile()) {
        return normalizeArtifactDescriptor(candidate, {
          compression: expectedCompression || undefined,
          logicalPath,
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  const error = new Error(`Codex rollout artifact not found for ${path.relative(root, logicalPath)}`);
  error.code = 'ENOENT';
  throw error;
}

function isPathWithinRoot(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function collectCodexRolloutFiles(root, options = {}) {
  const resolvedRoot = path.resolve(String(root || ''));
  const signal = options.signal;
  const onDiagnostic = options.onDiagnostic;
  const byLogicalPath = new Map();
  const report = (error, target, rootFailure = false) => {
    if (!onDiagnostic) return;
    const code = rootFailure
      ? (error.code === 'ENOENT' ? CODEX_ROLLOUT_SOURCE_ROOT_NOT_FOUND
        : error.code === 'ENOTDIR' ? CODEX_ROLLOUT_SOURCE_ROOT_NOT_DIRECTORY
          : CODEX_ROLLOUT_SOURCE_UNREADABLE)
      : (error.code || CODEX_ROLLOUT_SOURCE_UNREADABLE);
    onDiagnostic({ code, path: target, message: error.message });
  };
  async function walk(dir) {
    throwIfAborted(signal);
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      throwIfAborted(signal);
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO'].includes(error?.code)) throw error;
      // A fresh Codex home need not contain a sessions directory yet. Preserve
      // the existing empty-source onboarding contract for absent directories.
      if (error.code === 'ENOENT') return;
      report(error, dir, dir === resolvedRoot);
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      throwIfAborted(signal);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !isCodexRolloutArtifactName(entry.name)) continue;
      const descriptor = normalizeArtifactDescriptor(full);
      const logicalKey = descriptor.logicalPath;
      const previous = byLogicalPath.get(logicalKey);
      // Plain JSONL is the canonical sibling.  A compressed sibling is used
      // only when the plain artifact is absent; no timestamp/name heuristic
      // is used to merge unrelated rollouts.
      if (!previous || (previous.compression === 'zstd' && descriptor.compression === 'none')) {
        byLogicalPath.set(logicalKey, descriptor);
      }
    }
  }
  await walk(resolvedRoot);
  throwIfAborted(signal);
  return [...byLogicalPath.values()].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
}

function mapDecoderError(error, descriptor) {
  if (!error || error.name === 'AbortError' || error.code === 'ABORT_ERR') return error;
  if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', CODEX_ROLLOUT_SOURCE_BUSY].includes(error.code)) return error;
  if (descriptor.compression !== 'zstd') return error;
  if (error.code === CODEX_ROLLOUT_ZSTD_UNAVAILABLE || error.code === CODEX_ROLLOUT_STORAGE_INVALID) return error;
  return storageError(
    `Unable to decode Codex Zstandard rollout ${descriptor.physicalPath}: ${error.message}`,
    CODEX_ROLLOUT_STORAGE_INVALID,
    error,
  );
}

const ZSTD_MAGIC = 0xFD2FB528;
const ZSTD_SKIPPABLE_MAGIC_BASE = 0x184D2A50;
const CODEX_ZSTD_WINDOW_LOG_MAX = 27;

function zstdDecoderOptions() {
  const parameter = zlibConstants?.ZSTD_d_windowLogMax;
  return parameter === undefined
    ? {}
    : { params: { [parameter]: CODEX_ZSTD_WINDOW_LOG_MAX } };
}

class ZstdFrameTransform extends Transform {
  constructor(descriptor, signal) {
    super();
    this.descriptor = descriptor;
    this.signal = signal;
    this.decoder = null;
    this.decoderError = null;
    this.state = 'magic';
    this.magic = 0;
    this.magicBytes = 0;
    this.magicBuffer = Buffer.alloc(4);
    this.skippableHeader = Buffer.alloc(4);
    this.skippableHeaderBytes = 0;
    this.skippablePayloadRemaining = 0;
    this.frameDescriptor = 0;
    this.headerRemaining = 0;
    this.blockHeader = Buffer.alloc(3);
    this.blockHeaderBytes = 0;
    this.payloadRemaining = 0;
    this.lastBlock = false;
    this.checksumRemaining = 0;
    this.pausedDecoder = null;
    this.abort = () => this.destroy(abortError(signal));
    signal?.addEventListener('abort', this.abort, { once: true });
    this.once('close', () => signal?.removeEventListener('abort', this.abort));
  }

  _newDecoder() {
    this.decoder = createZstdDecompress(zstdDecoderOptions());
    const decoder = this.decoder;
    decoder.on('error', (error) => {
      this.decoderError ||= error;
    });
    decoder.on('data', (chunk) => {
      if (!this.push(chunk) && this.pausedDecoder === null) {
        this.pausedDecoder = decoder;
        decoder.pause();
      }
    });
  }

  _read(size) {
    if (this.pausedDecoder) {
      const decoder = this.pausedDecoder;
      this.pausedDecoder = null;
      decoder.resume();
    }
    Transform.prototype._read.call(this, size);
  }

  async _writeDecoder(chunk) {
    if (!chunk.length) return;
    throwIfAborted(this.signal);
    if (this.decoderError) throw this.decoderError;
    if (!this.decoder) this._newDecoder();
    if (this.destroyed) throw abortError(this.signal);
    if (!this.decoder.write(chunk)) await once(this.decoder, 'drain');
  }

  _resetFrameState() {
    this.state = 'magic';
    this.magic = 0;
    this.magicBytes = 0;
    this.magicBuffer.fill(0);
    this.skippableHeaderBytes = 0;
    this.skippablePayloadRemaining = 0;
    this.frameDescriptor = 0;
    this.headerRemaining = 0;
    this.blockHeaderBytes = 0;
    this.payloadRemaining = 0;
    this.lastBlock = false;
    this.checksumRemaining = 0;
  }

  async _finishDecoder() {
    if (!this.decoder) return;
    const decoder = this.decoder;
    try {
      if (this.decoderError) throw this.decoderError;
      await new Promise((resolve, reject) => {
        const onEnd = () => {
          decoder.removeListener('error', onError);
          resolve();
        };
        const onError = (error) => {
          decoder.removeListener('end', onEnd);
          reject(error);
        };
        decoder.once('end', onEnd);
        decoder.once('error', onError);
        decoder.end();
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
      throw storageError(
        `Unable to decode Codex Zstandard rollout ${this.descriptor.physicalPath}: ${error.message}`,
        CODEX_ROLLOUT_STORAGE_INVALID,
        error,
      );
    } finally {
      decoder.destroy();
      this.decoder = null;
      this.decoderError = null;
    }
    this._resetFrameState();
  }

  async _consume(chunk) {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.state === 'magic') {
        const take = Math.min(4 - this.magicBytes, chunk.length - offset);
        chunk.copy(this.magicBuffer, this.magicBytes, offset, offset + take);
        this.magicBytes += take;
        offset += take;
        if (this.magicBytes < 4) continue;
        this.magic = this.magicBuffer.readUInt32LE(0);
        if ((this.magic & 0xFFFFFFF0) === ZSTD_SKIPPABLE_MAGIC_BASE) {
          this.state = 'skippableHeader';
          continue;
        }
        if (this.magic !== ZSTD_MAGIC) {
          throw storageError('corrupt Codex Zstandard rollout: invalid frame magic');
        }
        await this._writeDecoder(this.magicBuffer);
        this.state = 'descriptor';
      }
      if (this.state === 'skippableHeader') {
        const take = Math.min(4 - this.skippableHeaderBytes, chunk.length - offset);
        chunk.copy(this.skippableHeader, this.skippableHeaderBytes, offset, offset + take);
        this.skippableHeaderBytes += take;
        offset += take;
        if (this.skippableHeaderBytes < 4) continue;
        this.skippablePayloadRemaining = this.skippableHeader.readUInt32LE(0);
        if (this.skippablePayloadRemaining === 0) this._resetFrameState();
        else this.state = 'skippablePayload';
      }
      if (this.state === 'skippablePayload') {
        const take = Math.min(this.skippablePayloadRemaining, chunk.length - offset);
        this.skippablePayloadRemaining -= take;
        offset += take;
        if (this.skippablePayloadRemaining > 0) continue;
        this._resetFrameState();
      }
      if (this.state === 'descriptor') {
        // A frame magic may end exactly at the input chunk boundary.
        // Keep the descriptor state until a real byte is available.
        if (offset >= chunk.length) break;
        await this._writeDecoder(chunk.subarray(offset, offset + 1));
        const descriptor = chunk[offset++];
        this.frameDescriptor = descriptor;
        if ((descriptor & 0x18) !== 0) {
          throw storageError('corrupt Codex Zstandard rollout: reserved frame-header bit');
        }
        const contentSizeFlag = descriptor >>> 6;
        const singleSegment = (descriptor & 0x20) !== 0;
        const dictionaryFlag = descriptor & 0x03;
        const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
        const contentSizeBytes = contentSizeFlag === 0
          ? (singleSegment ? 1 : 0)
          : 1 << contentSizeFlag;
        this.headerRemaining = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
        this.state = 'header';
      }
      if (this.state === 'header') {
        const take = Math.min(this.headerRemaining, chunk.length - offset);
        await this._writeDecoder(chunk.subarray(offset, offset + take));
        this.headerRemaining -= take;
        offset += take;
        if (this.headerRemaining > 0) continue;
        this.state = 'blockHeader';
      }
      if (this.state === 'blockHeader') {
        const take = Math.min(3 - this.blockHeaderBytes, chunk.length - offset);
        await this._writeDecoder(chunk.subarray(offset, offset + take));
        chunk.copy(this.blockHeader, this.blockHeaderBytes, offset, offset + take);
        this.blockHeaderBytes += take;
        offset += take;
        if (this.blockHeaderBytes < 3) continue;
        const blockHeader = this.blockHeader.readUIntLE(0, 3);
        this.blockHeaderBytes = 0;
        this.lastBlock = (blockHeader & 1) !== 0;
        const blockType = (blockHeader >>> 1) & 0x03;
        const blockSize = blockHeader >>> 3;
        if (blockType === 0x03) {
          throw storageError('corrupt Codex Zstandard rollout: reserved block type');
        }
        this.payloadRemaining = blockType === 0x01 ? 1 : blockSize;
        this.state = 'blockPayload';
      }
      if (this.state === 'blockPayload') {
        const take = Math.min(this.payloadRemaining, chunk.length - offset);
        await this._writeDecoder(chunk.subarray(offset, offset + take));
        this.payloadRemaining -= take;
        offset += take;
        if (this.payloadRemaining > 0) continue;
        if (this.lastBlock) {
          this.checksumRemaining = (this.frameDescriptor & 0x04) !== 0 ? 4 : 0;
          this.state = this.checksumRemaining ? 'checksum' : 'complete';
        } else {
          this.state = 'blockHeader';
        }
      }
      if (this.state === 'checksum') {
        const take = Math.min(this.checksumRemaining, chunk.length - offset);
        await this._writeDecoder(chunk.subarray(offset, offset + take));
        this.checksumRemaining -= take;
        offset += take;
        if (this.checksumRemaining > 0) continue;
        this.state = 'complete';
      }
      if (this.state === 'complete') await this._finishDecoder();
    }
  }

  _transform(chunk, encoding, callback) {
    this._consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
      .then(() => callback(), (error) => callback(mapDecoderError(error, this.descriptor)));
  }

  _flush(callback) {
    const incomplete = this.state !== 'magic' || this.magicBytes !== 0 || this.decoder;
    if (incomplete) {
      callback(storageError('corrupt Codex Zstandard rollout: truncated frame'));
      return;
    }
    callback();
  }

  _destroy(error, callback) {
    this.decoder?.destroy(error);
    this.decoder = null;
    callback(error);
  }
}

function openDecodedStream(descriptorOrPath, options = {}) {
  const descriptor = typeof descriptorOrPath === 'string'
    ? normalizeArtifactDescriptor(descriptorOrPath)
    : normalizeArtifactDescriptor(descriptorOrPath?.physicalPath, descriptorOrPath);
  const signal = options.signal;
  throwIfAborted(signal);
  if (descriptor.compression === 'none') {
    const stream = fs.createReadStream(descriptor.physicalPath, options.streamOptions || {});
    const abort = () => stream.destroy(abortError(signal));
    signal?.addEventListener('abort', abort, { once: true });
    stream.once('close', () => signal?.removeEventListener('abort', abort));
    return stream;
  }
  requireBuiltInZstd(descriptor.physicalPath);
  const input = fs.createReadStream(descriptor.physicalPath, options.streamOptions || {});
  const decoder = new ZstdFrameTransform(descriptor, signal);
  input.on('error', (error) => decoder.destroy(mapDecoderError(error, descriptor)));
  decoder.once('close', () => input.destroy());
  input.pipe(decoder);
  return decoder;
}

function createLogicalReadStream(descriptorOrPath, options = {}) {
  const descriptor = typeof descriptorOrPath === 'string'
    ? normalizeArtifactDescriptor(descriptorOrPath)
    : normalizeArtifactDescriptor(descriptorOrPath?.physicalPath, descriptorOrPath);
  const maxBytes = options.maxBytes === undefined ? Number.POSITIVE_INFINITY : Number(options.maxBytes);
  if (!(maxBytes >= 0) || (!Number.isFinite(maxBytes) && maxBytes !== Number.POSITIVE_INFINITY)) {
    throw storageError('Codex rollout logical byte bound is invalid');
  }
  const signal = options.signal;
  const decoded = descriptor.compression === 'zstd'
    ? createSnapshotReadStream(descriptor, { ...options, decode: () => openDecodedStream(descriptor, options) })
    : openDecodedStream(descriptor, options);
  const generator = async function* logicalChunks() {
    let remaining = maxBytes;
    try {
      for await (const chunk of decoded) {
        throwIfAborted(signal);
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (remaining <= 0) break;
        const part = remaining < value.length ? value.subarray(0, remaining) : value;
        remaining -= part.length;
        if (part.length) yield part;
        if (remaining <= 0) break;
      }
    } catch (error) {
      throw mapDecoderError(error, descriptor);
    } finally {
      decoded.destroy();
    }
  };
  return Readable.from(generator());
}

async function hashLogicalPrefix(descriptorOrPath, byteLength, signal, options = {}) {
  const expected = Number(byteLength);
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw storageError('Codex rollout logical byte prefix is invalid');
  }
  const descriptor = typeof descriptorOrPath === 'string'
    ? normalizeArtifactDescriptor(descriptorOrPath)
    : normalizeArtifactDescriptor(descriptorOrPath?.physicalPath, descriptorOrPath);
  const hash = crypto.createHash('sha256');
  let bytesRead = 0;
  const stream = createLogicalReadStream(descriptor, { ...options, signal, maxBytes: expected });
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      bytesRead += chunk.length;
      hash.update(chunk);
    }
  } finally {
    stream.destroy();
  }
  return { bytesRead, fingerprint: hash.digest('base64url') };
}

async function readLogicalLine(descriptorOrPath, lineNumber, options = {}) {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) return null;
  const signal = options.signal;
  const descriptor = typeof descriptorOrPath === 'string'
    ? normalizeArtifactDescriptor(descriptorOrPath)
    : normalizeArtifactDescriptor(descriptorOrPath?.physicalPath, descriptorOrPath);
  const stream = createLogicalReadStream(descriptor, { signal });
  let current = 0;
  let line = null;
  let carry = '';
  const decoder = new TextDecoder('utf-8');
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      carry += decoder.decode(chunk, { stream: true });
      const parts = carry.split('\n');
      carry = parts.pop() || '';
      for (const part of parts) {
        current += 1;
        const value = part.endsWith('\r') ? part.slice(0, -1) : part;
        if (current === lineNumber) {
          line = value;
          break;
        }
      }
      if (line !== null) break;
    }
    if (line === null) {
      carry += decoder.decode();
      if (carry.length > 0) {
        current += 1;
        if (current === lineNumber) line = carry;
      }
    }
  } finally {
    stream.destroy();
  }
  return line === null ? null : { line, lineNumber, descriptor };
}

function logicalRelativePath(sessionsRoot, descriptorOrPath) {
  const descriptor = typeof descriptorOrPath === 'string'
    ? normalizeArtifactDescriptor(descriptorOrPath)
    : normalizeArtifactDescriptor(descriptorOrPath?.physicalPath, descriptorOrPath);
  return path.relative(path.resolve(sessionsRoot), descriptor.logicalPath);
}

function isStorageFailure(error) {
  return [
    CODEX_ROLLOUT_STORAGE_INVALID,
    CODEX_ROLLOUT_ZSTD_UNAVAILABLE,
    CODEX_ROLLOUT_SOURCE_BUSY,
    'ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO',
  ].includes(error?.code);
}

module.exports = {
  CODEX_ROLLOUT_SOURCE_BUSY,
  CODEX_ROLLOUT_SOURCE_ROOT_NOT_DIRECTORY,
  CODEX_ROLLOUT_SOURCE_ROOT_NOT_FOUND,
  CODEX_ROLLOUT_SOURCE_UNREADABLE,
  CODEX_ROLLOUT_STORAGE_INVALID,
  CODEX_ROLLOUT_ZSTD_UNAVAILABLE,
  acquireRolloutStat,
  compressionForArtifact,
  collectCodexRolloutFiles,
  createLogicalReadStream,
  descriptorForRelativePath,
  hasBuiltInZstd,
  hashLogicalPrefix,
  isCodexRolloutArtifactName,
  isStorageFailure,
  logicalRelativePath,
  logicalRolloutPath,
  normalizeArtifactDescriptor,
  openDecodedStream,
  readLogicalLine,
  requireBuiltInZstd,
  resolveRolloutArtifact,
  samePhysicalIdentity,
  sameRolloutIdentity,
  storageError,
  throwIfAborted,
};
