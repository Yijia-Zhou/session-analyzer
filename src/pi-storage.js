'use strict';

// Native pi JSONL only. Never import SessionManager: its loader may migrate and
// rewrite files. Admission and every later read use the same immutable prefix.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isPathInsideOrSame } = require('./shared/fs-path');

const hash = (value) => createHash('sha256').update(value).digest('hex');
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function stale() { return failure('INDEXED_SOURCE_STALE', 'The indexed pi transcript changed; reindex this project.'); }
function abort(signal) { signal?.throwIfAborted(); }
function identity(stat) { return { device: String(stat.dev), inode: String(stat.ino) }; }

async function readPiSnapshot(filePath, { sessionsRoot, acceptedSnapshot, signal } = {}) {
  abort(signal);
  let handle;
  try {
    if (sessionsRoot) {
      const [root, target] = await Promise.all([fsp.realpath(sessionsRoot), fsp.realpath(filePath)]);
      if (!isPathInsideOrSame(target, root)) throw stale();
    }
    handle = await fsp.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw stale();
    const acceptedBytes = acceptedSnapshot?.acceptedBytes ?? Number(before.size);
    if (!Number.isSafeInteger(acceptedBytes) || acceptedBytes < 0 || before.size < BigInt(acceptedBytes)) throw stale();
    if (acceptedSnapshot?.fileIdentity && (String(before.dev) !== acceptedSnapshot.fileIdentity.device
        || String(before.ino) !== acceptedSnapshot.fileIdentity.inode)) throw stale();
    const chunks = [];
    let position = 0;
    while (position < acceptedBytes) {
      abort(signal);
      const chunk = Buffer.allocUnsafe(Math.min(256 * 1024, acceptedBytes - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) throw stale();
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!acceptedSnapshot && (before.size !== after.size || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs)) throw failure('PI_SOURCE_BUSY', 'pi transcript changed during indexing; retry.');
    let buffer = Buffer.concat(chunks);
    // A final non-newline record may still be in flight. Only committed lines
    // participate in accepted-prefix reconstruction, even if JSON parses.
    const committedBytes = acceptedSnapshot ? buffer.length : buffer.lastIndexOf(10) + 1;
    const torn = committedBytes !== buffer.length;
    buffer = buffer.subarray(0, committedBytes);
    const digest = hash(buffer);
    if (acceptedSnapshot && digest !== acceptedSnapshot.digest) throw stale();
    abort(signal);
    const lines = buffer.toString('utf8').split('\n');
    lines.pop();
    return { lines, acceptedBytes: committedBytes, digest, torn, fileIdentity: identity(before) };
  } catch (error) {
    abort(signal);
    if (acceptedSnapshot && ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code)) throw stale();
    throw error;
  } finally { await handle?.close(); }
}

function parsePiDocument(snapshot) {
  const rows = [];
  snapshot.lines.forEach((text, index) => {
    if (!text.trim()) return;
    let parsed;
    let parseError = '';
    try { parsed = JSON.parse(text); } catch { parseError = 'Malformed JSON'; parsed = null; }
    rows.push({ line: index + 1, parsed, parseError, text });
  });
  const header = rows[0]?.parsed;
  if (!header || header.type !== 'session' || typeof header.id !== 'string' || !header.id
      || typeof header.cwd !== 'string') throw failure('PI_HEADER_INVALID', 'Expected a native pi session header with id and cwd.');
  if (header.version !== 3) throw failure('PI_SESSION_VERSION_UNSUPPORTED', 'Only native pi session format version 3 is supported.');
  const entries = rows.slice(1);
  const byId = new Map();
  const children = new Set();
  let invalidTree = false;
  for (const row of entries) {
    const entry = row.parsed;
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    if (byId.has(entry.id) || !(entry.parentId === null || typeof entry.parentId === 'string')) invalidTree = true;
    byId.set(entry.id, row);
    if (typeof entry.parentId === 'string') children.add(entry.parentId);
  }
  // Persisted append order proves ancestry, and rules out forward links/cycles.
  for (const row of byId.values()) {
    const parent = row.parsed.parentId;
    if (parent !== null && (!byId.has(parent) || byId.get(parent).line >= row.line)) invalidTree = true;
  }
  const leaves = [...byId.values()].filter((row) => !children.has(row.parsed.id));
  const resumedLeafId = entries.at(-1)?.parsed?.id || '';
  return { ...snapshot, rows, header, entries, byId, leaves, invalidTree, resumedLeafId };
}

async function collectPiFiles(root, signal, onDiagnostic) {
  const files = [];
  async function walk(dir) {
    abort(signal);
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO'].includes(error.code)) throw error;
      onDiagnostic?.({ code: dir === root ? (error.code === 'ENOENT' ? 'SOURCE_ROOT_NOT_FOUND'
        : error.code === 'ENOTDIR' ? 'SOURCE_ROOT_NOT_DIRECTORY' : 'SOURCE_ROOT_UNREADABLE')
        : 'SOURCE_ARTIFACT_UNREADABLE', path: dir, message: error.message });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(dir, entry.name));
    }
  }
  await walk(root);
  return files;
}

module.exports = { abort, collectPiFiles, failure, hash, parsePiDocument, readPiSnapshot, stale };
