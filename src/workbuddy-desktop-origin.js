'use strict';

// Optional desktop metadata, never a source of transcript bodies or execution.
// Values are copied at index build; materialization replays that accepted value.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setImmediate: yieldImmediate } = require('node:timers/promises');
const { isPathInsideOrSame, fsPathApi } = require('./shared/fs-path');
const storage = require('./workbuddy-storage');
const scalar = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096;
function recordedPathIdentity(value) {
  if (typeof value !== 'string' || !value) return '';
  // Treat both slash spellings of a UNC path as Windows paths. The shared
  // path helper otherwise treats a forward-slash UNC as a POSIX path.
  const api = /^[\\/]{2}/.test(value) ? path.win32 : fsPathApi(value);
  if (!api.isAbsolute(value)) return '';
  // Windows root-relative paths without a drive still borrow the process's
  // current drive even though path.win32.isAbsolute returns true.
  if (api === path.win32) {
    const root = api.parse(value).root.replace(/\//g, '\\');
    if (!/^[A-Za-z]:\\/.test(root) && !/^\\\\[^\\]+\\[^\\]+/.test(root)) return '';
    return `windows:${api.resolve(value).toLowerCase()}`;
  }
  return `posix:${api.resolve(value)}`;
}
function sameRecordedPath(left, right) {
  const identity = recordedPathIdentity(left);
  return Boolean(identity) && identity === recordedPathIdentity(right);
}
function validOrigin(value, sessionId, cwd) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join(',') === 'automationId,cwd,runId,runKind,sessionId'
    && ['sessionId', 'cwd', 'automationId', 'runId'].every((key) => scalar(value[key]))
    && value.runKind === 'scheduled' && value.sessionId === sessionId
    && sameRecordedPath(value.cwd, cwd);
}
function json(value) { try { return JSON.parse(value); } catch { return null; } }
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((key) => a[key] === b[key]);
async function inspectDatabase(filename, root) {
  const states = new Map();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    let stat;
    try { stat = await fs.lstat(filename + suffix, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT' && suffix) continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256n * 1024n * 1024n
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
      storage.abort(signal);
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
async function readDesktopOrigins(sourceHome, candidates, signal, onDiagnostic) {
  const origins = new Map(); const filename = path.join(sourceHome, 'workbuddy.db');
  const identities = new Map(); let processed = 0;
  for (const candidate of candidates) {
    storage.abort(signal);
    if (++processed % 128 === 0) { await yieldImmediate(); storage.abort(signal); }
    if (candidate.sourceFile.split('/').length === 2) identities.set(candidate.header.id, (identities.get(candidate.header.id) || 0) + 1);
  }
  let db; let temporary;
  try {
    storage.abort(signal);
    if (!identities.size) return origins;
    try { await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return origins; throw error; }
    const root = await fs.realpath(sourceHome);
    const before = await inspectDatabase(filename, root);
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-workbuddy-origin-'));
    const copied = path.join(temporary, 'workbuddy.db');
    for (const [suffix, stat] of before) await copyDatabaseFile(filename + suffix, copied + suffix, stat, signal);
    const after = await inspectDatabase(filename, root);
    if (before.size !== after.size || [...before].some(([suffix, stat]) => !after.has(suffix) || !sameFile(stat, after.get(suffix)))) throw new Error('Desktop database changed across copy');
    // SQLite readOnly can still create WAL/SHM side files. Open only our private
    // stable DB+WAL copy; never open the live database with SQLite or ignore WAL.
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(copied, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 50; BEGIN');
    for (const [table, key] of [['sessions', 'id'], ['automation_runs', 'thread_id']]) {
      const schema = db.prepare('SELECT type FROM sqlite_master WHERE name = ?').get(table);
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (schema?.type !== 'table' || columns.filter((column) => column.pk).length !== 1
        || !columns.some((column) => column.name === key && column.pk === 1)) throw new Error('Unsupported desktop identity table');
    }
    const sessionQuery = db.prepare(`SELECT
      CASE WHEN typeof(id) = 'text' AND length(id) <= 4096 THEN id END AS id,
      CASE WHEN typeof(cwd) = 'text' AND length(cwd) <= 4096 THEN cwd END AS cwd,
      CASE WHEN typeof(is_background_automation) IN ('integer', 'real') AND is_background_automation = 1 THEN 1
        WHEN typeof(is_background_automation) IN ('integer', 'real') AND is_background_automation = 0 THEN 0 END AS is_background_automation,
      CASE WHEN typeof(session_settings) = 'text' AND length(session_settings) <= 16384 THEN session_settings END AS settings
      FROM sessions WHERE id = ? LIMIT 2`);
    // Scan the copied run table once, rather than once per session. Guard
    // returned types so an unsafe SQLite integer in one row cannot prevent
    // independent candidates from being checked.
    const runQuery = db.prepare(`SELECT
      CASE WHEN typeof(thread_id) = 'text' AND length(thread_id) <= 4096 THEN thread_id END AS thread_id,
      CASE WHEN typeof(automation_id) = 'text' AND length(automation_id) <= 4096 THEN automation_id END AS automation_id,
      CASE WHEN typeof(source_cwd) = 'text' AND length(source_cwd) <= 16384 THEN source_cwd END AS source_cwd,
      CASE WHEN typeof(metadata_json) = 'text' AND length(metadata_json) <= 16384 THEN metadata_json END AS metadata
      FROM automation_runs`);
    const groups = new Map();
    for (const candidate of candidates) {
      storage.abort(signal);
      if (++processed % 128 === 0) { await yieldImmediate(); storage.abort(signal); }
      if (candidate.sourceFile.split('/').length !== 2) continue;
      const sessions = sessionQuery.all(candidate.header.id);
      if (sessions.length !== 1 || sessions[0].is_background_automation === 0) continue;
      const session = sessions[0];
      const unverified = () => onDiagnostic?.({ code: 'WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED', path: candidate.sourceFile,
        message: 'Background session metadata lacks a unique matching scheduled run; recorded JSONL identity is retained.' });
      const tags = json(session.settings)?.conversationTags;
      if (session.is_background_automation !== 1 || session.id !== candidate.header.id
        || identities.get(candidate.header.id) !== 1 || !scalar(tags?.automationId)
        || !scalar(session.cwd) || !sameRecordedPath(session.cwd, candidate.header.cwd)) { unverified(); continue; }
      if (!groups.has(tags.automationId)) groups.set(tags.automationId, new Map());
      groups.get(tags.automationId).set(session.id, { candidate, session, automationId: tags.automationId,
        correlatedRuns: 0, matchingRuns: 0, runId: null, unverified });
    }
    if (groups.size) for (const run of runQuery.iterate()) {
      storage.abort(signal);
      if (++processed % 128 === 0) { await yieldImmediate(); storage.abort(signal); }
      const group = groups.get(run.automation_id);
      if (!group) continue;
      const meta = json(run.metadata); const target = group.get(meta?.sessionId);
      if (!target || meta?.runKind !== 'scheduled' || meta.conversationId !== target.session.id) continue;
      target.correlatedRuns++;
      if (target.correlatedRuns <= 100 && sameRecordedPath(run.source_cwd, target.session.cwd)) {
        target.matchingRuns++; target.runId = run.thread_id;
      }
    }
    for (const group of groups.values()) for (const target of group.values()) {
      storage.abort(signal);
      if (++processed % 128 === 0) { await yieldImmediate(); storage.abort(signal); }
      const { candidate, session, automationId, correlatedRuns, matchingRuns, runId, unverified } = target;
      if (correlatedRuns > 100 || matchingRuns !== 1) { unverified(); continue; }
      const value = { sessionId: session.id, cwd: session.cwd, automationId, runId, runKind: 'scheduled' };
      if (validOrigin(value, candidate.header.id, candidate.header.cwd)) origins.set(candidate.sourceFile, value);
      else unverified();
    }
    db.exec('ROLLBACK');
    return origins;
  } catch (error) {
    storage.abort(signal);
    onDiagnostic?.({ code: 'WORKBUDDY_DESKTOP_ORIGIN_UNAVAILABLE', path: filename,
      message: 'Desktop automation origin could not be captured; JSONL remains readable without inferred automation identity.' });
    return new Map();
  } finally {
    try { db?.close(); } finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
  }
}

function originDependency(origin) {
  const serialized = JSON.stringify(origin);
  return { role: 'desktop_automation_origin', pathIdentity: 'workbuddy.db', existence: 'present', kind: 'file',
    policy: 'copied_value', acceptedBytes: Buffer.byteLength(serialized), lineCount: 0,
    digest: storage.hash(serialized), directoryEntries: [], evidence: { origin } };
}
module.exports = { readDesktopOrigins, validOrigin, originDependency };
