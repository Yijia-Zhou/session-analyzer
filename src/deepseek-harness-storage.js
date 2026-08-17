'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { zstdDecompressSync } = require('node:zlib');

const DEEPSEEK_SOURCE_KIND = 'deepseek-harness';
const DEEPSEEK_FORMAT_VERSION = 0;
const DEEPSEEK_STORAGE_LOCATOR_TYPE = 'dsh-storage-record';
const ZSTD_MAGIC = 0xFD2FB528;
const FIRST_FRAME_READ_CHUNK = 64 * 1024;
const FIRST_LINE_READ_CHUNK = 64 * 1024;
const MAX_FIRST_RECORD_BYTES = 4 * 1024 * 1024;

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

function storageError(message, code = 'DEEPSEEK_STORAGE_INVALID', cause = undefined) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function hasBuiltInZstd() {
  return typeof zstdDecompressSync === 'function';
}

function requireBuiltInZstd(pathForError = '') {
  if (hasBuiltInZstd()) return;
  throw storageError(
    `DeepSeek Harness Zstandard artifacts require Node's built-in node:zlib zstd support, `
    + `which is unavailable on this Node ${process.version} runtime${pathForError ? ` (while reading ${pathForError})` : ''}. `
    + 'Uncompressed session.jsonl artifacts remain readable.',
    'DEEPSEEK_ZSTD_UNAVAILABLE',
  );
}

function safeIso(value) {
  if (value == null || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function truncate(value, limit = 240) {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function flattenBounded(value, budget = 12_000) {
  if (budget <= 0 || value == null) return '';
  if (typeof value === 'string') return value.slice(0, budget);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    let remaining = budget;
    for (const item of value) {
      const text = flattenBounded(item, remaining);
      if (!text) continue;
      parts.push(text);
      remaining -= text.length;
      if (remaining <= 0) break;
    }
    return parts.join('\n').slice(0, budget);
  }
  if (typeof value !== 'object') return '';
  const preferredKeys = [
    'text', 'content', 'message', 'title', 'name', 'provider', 'model',
    'command', 'stdout', 'stderr', 'error', 'reason', 'policy', 'mode',
    'preset', 'turn', 'step', 'kind', 'callId', 'id',
  ];
  const keys = [
    ...preferredKeys.filter((key) => Object.hasOwn(value, key)),
    ...Object.keys(value).filter((key) => !preferredKeys.includes(key)),
  ];
  const parts = [];
  let remaining = budget;
  for (const key of keys) {
    if (key === 'signature') continue;
    const text = flattenBounded(value[key], remaining);
    if (!text) continue;
    parts.push(text);
    remaining -= text.length;
    if (remaining <= 0) break;
  }
  return parts.join('\n').slice(0, budget);
}

function compressionForArtifact(filePath) {
  const base = path.basename(filePath);
  if (base === 'session.jsonl.zstd') return 'zstd';
  if (base === 'session.jsonl') return 'none';
  throw storageError(`unsupported DeepSeek session artifact name: ${path.basename(filePath)}`);
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('base64url');
}

function hashPlainValue(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function fileIdentity(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function sameFileIdentity(left, right) {
  return Boolean(left && right
    && left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs);
}

async function readStableFile(filePath, signal) {
  for (;;) {
    throwIfAborted(signal);
    const before = await fsp.stat(filePath, { bigint: true });
    const buffer = await fsp.readFile(filePath, { signal });
    throwIfAborted(signal);
    const after = await fsp.stat(filePath, { bigint: true });
    if (sameFileIdentity(fileIdentity(before), fileIdentity(after))) {
      return { buffer, identity: fileIdentity(after) };
    }
  }
}

// Structural Zstandard frame scanning, copied from the writer's own reader
// semantics. It finds complete frames without decompressing blocks and returns
// the start of an incomplete final frame.
function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw storageError(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) {
      throw storageError(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) {
        throw storageError(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

function decompressFrame(buffer, start, end) {
  requireBuiltInZstd();
  try {
    return zstdDecompressSync(buffer.subarray(start, end));
  } catch (error) {
    throw storageError(
      `corrupt Zstandard session log: frame at byte ${start} failed validation`,
      'DEEPSEEK_STORAGE_INVALID',
      error,
    );
  }
}

// Parse the immutable header record. Future versions fail explicitly before
// any event interpretation is attempted.
function parseHeaderLine(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw storageError('corrupt session log: header line is not valid JSON', 'DEEPSEEK_STORAGE_INVALID', error);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.type !== 'session') {
    throw storageError('corrupt session log: first line is not a session header');
  }
  if (typeof parsed.version !== 'number' || !Number.isSafeInteger(parsed.version)) {
    throw storageError('corrupt session log: header version is invalid');
  }
  if (parsed.version !== DEEPSEEK_FORMAT_VERSION) {
    throw storageError(
      `DeepSeek session format version ${parsed.version} is newer than the supported version ${DEEPSEEK_FORMAT_VERSION}`,
      'DEEPSEEK_FORMAT_VERSION_UNSUPPORTED',
    );
  }
  if (typeof parsed.id !== 'string' || !parsed.id.trim()) {
    throw storageError('corrupt session log: header id is invalid');
  }
  if (!Number.isSafeInteger(parsed.createdAt) || parsed.createdAt < 0 || Object.is(parsed.createdAt, -0)) {
    throw storageError('corrupt session log: header createdAt is invalid');
  }
  if (Object.hasOwn(parsed, 'cwd') && typeof parsed.cwd !== 'string') {
    throw storageError('corrupt session log: header cwd is invalid');
  }
  if (!Number.isSafeInteger(parsed.delegationDepth)
      || parsed.delegationDepth < 0
      || Object.is(parsed.delegationDepth, -0)) {
    throw storageError('corrupt session log: header delegationDepth is invalid');
  }
  return {
    version: parsed.version,
    id: parsed.id,
    createdAt: parsed.createdAt,
    ...(typeof parsed.cwd === 'string' ? { cwd: parsed.cwd } : {}),
    ...(typeof parsed.parentSession === 'string' ? { parentSession: parsed.parentSession } : {}),
    ...(Number.isSafeInteger(parsed.seedLength) ? { seedLength: parsed.seedLength } : {}),
    ...(parsed.origin === 'subagent' ? { origin: parsed.origin } : {}),
    delegationDepth: parsed.delegationDepth,
    ...(typeof parsed.agentPreset === 'string' ? { agentPreset: parsed.agentPreset } : {}),
  };
}

function parseHeaderText(text) {
  const line = String(text || '').replace(/\r?\n$/, '');
  return parseHeaderLine(line);
}

// Split decoded physical records. Every complete record is newline-terminated,
// so the splitter removes the trailing empty element and rejects a complete
// frame that contains a partial JSONL record.
function physicalRecordTexts(text, { requireNewlineTerminated = true } = {}) {
  if (!text) return [];
  const lines = text.split('\n');
  if (requireNewlineTerminated && lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  } else if (requireNewlineTerminated && lines.length > 0 && lines[lines.length - 1] !== '') {
    throw storageError('corrupt DeepSeek session log: complete frame contains a torn JSONL record');
  }
  return lines.filter((line) => line.trim().length > 0);
}

function committedArtifactPrefix(buffer, compression) {
  if (compression === 'zstd') {
    requireBuiltInZstd();
    const { frames, tornStart } = scanZstdFrames(buffer);
    if (frames.length === 0) throw storageError('empty or header-less Zstandard session log');
    const plaintexts = [];
    for (const frame of frames) {
      plaintexts.push(decompressFrame(buffer, frame.start, frame.end));
    }
    const first = plaintexts[0].toString('utf8');
    if (!first.endsWith('\n') || first.indexOf('\n') !== first.length - 1) {
      throw storageError('corrupt Zstandard session log: first frame is not exactly one header line');
    }
    const content = plaintexts.map((part) => part.toString('utf8')).join('');
    const recordTexts = physicalRecordTexts(content);
    const committedBytes = frames[frames.length - 1].end;
    return {
      compression,
      recordTexts,
      committedBytes,
      torn: tornStart !== undefined,
      tornStart,
    };
  }
  if (compression === 'none') {
    let lastNewline = -1;
    for (let offset = buffer.length - 1; offset >= 0; offset -= 1) {
      if (buffer[offset] === 0x0A) {
        lastNewline = offset;
        break;
      }
    }
    if (lastNewline < 0) return { compression, recordTexts: [], committedBytes: 0, torn: buffer.length > 0 };
    const committedBytes = lastNewline + 1;
    const recordTexts = physicalRecordTexts(buffer.subarray(0, committedBytes).toString('utf8'));
    return {
      compression,
      recordTexts,
      committedBytes,
      torn: committedBytes < buffer.length,
    };
  }
  throw storageError(`unsupported DeepSeek compression: ${compression}`);
}

async function readFirstLineBytes(filePath, signal) {
  const handle = await fsp.open(filePath, 'r');
  try {
    let offset = 0;
    for (;;) {
      throwIfAborted(signal);
      const length = Math.min(FIRST_LINE_READ_CHUNK, MAX_FIRST_RECORD_BYTES - offset);
      if (length <= 0) break;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      throwIfAborted(signal);
      if (bytesRead === 0) break;
      const newline = buffer.indexOf(0x0A, 0, bytesRead);
      if (newline >= 0) return buffer.subarray(0, newline + 1);
      offset += bytesRead;
    }
    return Buffer.alloc(0);
  } finally {
    await handle.close();
  }
}

// Header-only discovery: for Zstd this reads only enough bytes to complete the
// first independently-decodable frame and decompresses exactly that frame.
async function readSessionHeader(filePath, compression = compressionForArtifact(filePath), signal) {
  throwIfAborted(signal);
  if (compression === 'zstd') {
    requireBuiltInZstd(filePath);
    const handle = await fsp.open(filePath, 'r');
    try {
      let chunks = [];
      let totalBytes = 0;
      let frameBytes = null;
      while (totalBytes < MAX_FIRST_RECORD_BYTES) {
        throwIfAborted(signal);
        const buffer = Buffer.alloc(FIRST_FRAME_READ_CHUNK);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, totalBytes);
        throwIfAborted(signal);
        if (bytesRead === 0) break;
        const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
        chunks.push(chunk);
        totalBytes += bytesRead;
        const current = Buffer.concat(chunks, totalBytes);
        const scanned = scanZstdFrames(current, 1);
        if (scanned.frames.length === 1) {
          frameBytes = current.subarray(0, scanned.frames[0].end);
          break;
        }
      }
      if (!frameBytes) {
        throw storageError('empty or header-less Zstandard session log');
      }
      const plaintext = decompressFrame(frameBytes, 0, frameBytes.length);
      const text = plaintext.toString('utf8');
      if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
        throw storageError('corrupt Zstandard session log: first frame is not exactly one header line');
      }
      return parseHeaderText(text);
    } finally {
      await handle.close();
    }
  }
  if (compression === 'none') {
    const firstLine = await readFirstLineBytes(filePath, signal);
    if (firstLine.length === 0) throw storageError('empty or header-less session log');
    return parseHeaderText(firstLine.toString('utf8'));
  }
  throw storageError(`unsupported DeepSeek compression: ${compression}`);
}

async function readPhysicalRecordText(filePath, compression, recordOrdinal, signal) {
  if (!Number.isSafeInteger(recordOrdinal) || recordOrdinal < 0) {
    throw storageError(`invalid DeepSeek storage record ordinal: ${recordOrdinal}`);
  }
  const { buffer } = await readStableFile(filePath, signal);
  const prefix = committedArtifactPrefix(buffer, compression);
  const recordText = prefix.recordTexts[recordOrdinal];
  if (recordText === undefined) {
    throw storageError(`DeepSeek storage record ${recordOrdinal} is outside the committed prefix`);
  }
  return {
    recordText,
    committedBytes: prefix.committedBytes,
    torn: prefix.torn,
  };
}

// Lossless packed-row decoder. It returns the exact `assistant/chunk` events
// stored by one physical record without retaining any per-delta object.
function decodeStorageRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [value];
  const tag = value.type;
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') {
    return [value];
  }
  const malformed = (message) => storageError(`malformed ${tag} storage row: ${message}`);
  const exactKeys = (candidate, keys) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const own = Object.keys(candidate);
    return own.length === keys.length && keys.every((key) => Object.hasOwn(candidate, key));
  };
  if (!exactKeys(value, ['type', 'seq0', 'time0', 'data'])
      || !Number.isSafeInteger(value.seq0) || value.seq0 < 0
      || !Number.isSafeInteger(value.time0)) {
    throw malformed('envelope must be exactly {type, seq0, time0, data} with safe integers');
  }
  const data = value.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw malformed('data must be an object');
  const tool = tag === 'tool-call-chunks';
  const withName = tool && exactKeys(data, ['turn', 'step', 'index', 'id', 'name', 'dt', 'args']);
  const requiredDataKeys = tool
    ? ['turn', 'step', 'index', 'id', 'dt', 'args']
    : ['turn', 'step', 'index', 'dt', 'texts'];
  if (!exactKeys(data, requiredDataKeys) && !withName) {
    throw malformed(`data must be exactly {${requiredDataKeys.join(', ')}}${tool ? ' with optional name' : ''}`);
  }
  if (typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number') {
    throw malformed('turn/step/index must be numbers');
  }
  const payloadKey = tool ? 'args' : 'texts';
  const members = data[payloadKey];
  if (!Array.isArray(members) || members.length === 0
      || members.some((entry) => typeof entry !== 'string')) {
    throw malformed(`${payloadKey} must be a non-empty string array`);
  }
  if (!Array.isArray(data.dt) || data.dt.length !== members.length - 1
      || data.dt.some((gap) => !Number.isSafeInteger(gap))) {
    throw malformed(`dt must contain exactly ${members.length - 1} safe integers`);
  }
  if (!Number.isSafeInteger(value.seq0 + members.length - 1)) {
    throw malformed('member seqs must stay safe integers');
  }
  let time = value.time0;
  for (const gap of data.dt) {
    time += gap;
    if (!Number.isSafeInteger(time)) throw malformed('member times must stay safe integers');
  }
  const chunkKind = tag === 'text-chunks'
    ? 'text-delta'
    : (tag === 'reasoning-chunks' ? 'reasoning-delta' : 'tool-call-delta');
  const events = [];
  let memberTime = value.time0;
  for (let index = 0; index < members.length; index += 1) {
    if (index > 0) memberTime += data.dt[index - 1];
    const chunk = tool
      ? {
        type: 'tool-call-delta',
        index: data.index,
        id: data.id,
        ...(Object.hasOwn(data, 'name') ? { name: data.name } : {}),
        argumentsDelta: members[index],
      }
      : {
        type: chunkKind,
        index: data.index,
        text: members[index],
      };
    events.push({
      type: 'assistant/chunk',
      seq: value.seq0 + index,
      time: memberTime,
      data: { turn: data.turn, step: data.step, chunk },
    });
  }
  return events;
}

module.exports = {
  DEEPSEEK_FORMAT_VERSION,
  DEEPSEEK_SOURCE_KIND,
  DEEPSEEK_STORAGE_LOCATOR_TYPE,
  MAX_FIRST_RECORD_BYTES,
  committedArtifactPrefix,
  compressionForArtifact,
  decodeStorageRecord,
  fileIdentity,
  flattenBounded,
  hasBuiltInZstd,
  hashBuffer,
  hashPlainValue,
  parseHeaderLine,
  parseHeaderText,
  readPhysicalRecordText,
  readSessionHeader,
  readStableFile,
  safeIso,
  sameFileIdentity,
  scanZstdFrames,
  storageError,
  throwIfAborted,
  truncate,
};
