'use strict';

// Native CodeBuddy JSONL, read-only. Never import the producer runtime or load
// referenced tool-output/image paths. Every read uses the admitted prefix.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isPathInsideOrSame } = require('./shared/fs-path');

const hash = (value) => createHash('sha256').update(value).digest('hex');
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function stale() { return failure('INDEXED_SOURCE_STALE', 'The indexed WorkBuddy transcript changed; reindex this project.'); }
function abort(signal) { signal?.throwIfAborted(); }
function identity(stat) { return { device: String(stat.dev), inode: String(stat.ino) }; }

async function readWorkbuddySnapshot(filePath, { sessionsRoot, acceptedSnapshot, signal } = {}) {
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
        || before.ctimeNs !== after.ctimeNs)) throw failure('WORKBUDDY_SOURCE_BUSY', 'WorkBuddy transcript changed during indexing; retry.');
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

function parseWorkbuddyDocument(snapshot, sourceFile) {
  const rows = [];
  snapshot.lines.forEach((text, index) => {
    if (!text.trim()) return;
    let parsed = null; let parseError = '';
    try { parsed = JSON.parse(text); } catch { parseError = 'Malformed JSON'; }
    rows.push({ line: index + 1, parsed, parseError });
  });
  const id = path.basename(sourceFile, '.jsonl');
  // The physical filename is the durable session address. Native fork
  // histories may omit sessionId, or preserve foreign source-session IDs.
  // Admit only native envelopes; sessionId alone is not a format signature.
  const native = rows.some(({ parsed: row }) => row && typeof row === 'object' && !Array.isArray(row)
    && ((row.type === 'message' && typeof row.id === 'string' && ['user', 'assistant', 'system'].includes(row.role))
      || (['function_call', 'function_call_result', 'reasoning'].includes(row.type) && typeof row.id === 'string')
      || (row.type === 'session-meta' && (row.meta && typeof row.meta === 'object' || row.contextWindow && typeof row.contextWindow === 'object'))));
  if (!id || !native) throw failure('WORKBUDDY_TRANSCRIPT_INVALID', 'Expected a native WorkBuddy/CodeBuddy transcript envelope.');
  const cwd = rows.map((row) => row.parsed?.cwd).find((value) => typeof value === 'string' && value);
  if (!cwd || !require('./shared/fs-path').fsPathApi(cwd).isAbsolute(cwd)) {
    throw failure('WORKBUDDY_CWD_INVALID', 'Native transcript has no absolute recorded working directory.');
  }
  return { ...snapshot, rows, id, cwd };
}

async function collectWorkbuddyFiles(root, signal, onDiagnostic) {
  const files = [];
  async function readDirectory(dir) {
    abort(signal);
    try { return await fsp.readdir(dir, { withFileTypes: true }); } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'ELOOP'].includes(error.code)) throw error;
      onDiagnostic?.({ code: dir === root ? (error.code === 'ENOENT' ? 'SOURCE_ROOT_NOT_FOUND'
        : error.code === 'ENOTDIR' ? 'SOURCE_ROOT_NOT_DIRECTORY' : 'SOURCE_ROOT_UNREADABLE')
        : 'SOURCE_ARTIFACT_UNREADABLE', path: dir, message: error.message });
      return [];
    }
  }
  const containers = (await readDirectory(root)).sort((a, b) => a.name.localeCompare(b.name));
  for (const container of containers) {
    if (!container.isDirectory()) continue;
    const directory = path.join(root, container.name);
    for (const entry of (await readDirectory(directory)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(directory, entry.name));
      else if (entry.isDirectory()) {
        // Native Agent-tool descendants live in this exact owned layout.
        // Ignore sidecars, output/image blobs, symlinks and arbitrary subtrees.
        const parentDirectory = path.join(directory, entry.name);
        const parentEntries = await readDirectory(parentDirectory);
        if (!parentEntries.some((child) => child.name === 'subagents' && child.isDirectory())) continue;
        const childDirectory = path.join(parentDirectory, 'subagents');
        for (const child of (await readDirectory(childDirectory)).sort((a, b) => a.name.localeCompare(b.name))) {
          if (child.isFile() && child.name.endsWith('.jsonl')) files.push(path.join(childDirectory, child.name));
        }
      }
    }
  }
  return files;
}

module.exports = { abort, collectWorkbuddyFiles, failure, hash, parseWorkbuddyDocument, readWorkbuddySnapshot, stale };
