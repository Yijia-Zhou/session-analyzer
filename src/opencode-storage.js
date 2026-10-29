'use strict';

// Independent reader for the 2.1.4 persisted projection. Never initializes an
// OpenCode runtime, imports its database service, or changes source SQL data.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { setImmediate: yieldImmediate } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const { isPathInsideOrSame, resolveFsPath } = require('./shared/fs-path');

const SCHEMA_PROFILE = 'opencode-2.1.4';
const FORMAT_VERSION = 1;
const LIMITS = Object.freeze({ maxCatalogSessions: 20000, maxSessions: 2000,
  maxMessages: 200000, maxFieldBytes: 1024 * 1024, maxSessionBytes: 32 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024, maxStoredBytes: 256 * 1024 * 1024,
  maxWalBytes: 256 * 1024 * 1024, maxQueryBytes: 256 * 1024 * 1024,
  maxDepth: 128, maxCaptureMs: 10000, maxBuildMs: 60000, busyTimeoutMs: 50 });
const SCHEMA = Object.freeze({
  project: { text: 'id worktree vcs name icon_url icon_url_override icon_color sandboxes commands', integer: 'time_created time_updated time_initialized time_active time_archived' },
  worktree: { text: 'project_id directory strategy', integer: 'time_created' },
  session_v2: { text: 'id project_id workspace_id parent_id fork_session_id fork_boundary slug directory path title version share_url summary_diffs metadata revert permission agent model idle_outcome', integer: 'summary_additions summary_deletions summary_files tokens_input tokens_output tokens_reasoning tokens_cache_read tokens_cache_write time_created time_updated time_idle time_viewed time_compacting time_archived time_suspended resume_attempts', real: 'cost' },
  session_message: { text: 'id session_id type data', integer: 'seq time_created time_updated' },
  session_pending: { text: 'id session_id type data delivery', integer: 'admitted_seq time_created' },
});
const PRIMARY_KEYS = Object.freeze({ project: ['id'], worktree: ['project_id', 'directory'], session_v2: ['id'], session_message: ['id'], session_pending: ['id'] });
const JSON_COLUMNS = new Set(['fork_boundary', 'summary_diffs', 'metadata', 'revert', 'permission', 'model', 'sandboxes', 'commands', 'data']);
const MARKER = 'session-analyzer-opencode-snapshot';
const PROCESS_TOKEN = crypto.randomBytes(16).toString('hex');
const storedBytesByBase = new Map();
const failedCaptureCleanup = new Map();
const defaultSnapshotBase = () => path.join(os.tmpdir(), 'session-analyzer-opencode');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function error(code, message, cause) {
  const result = new Error(message, cause ? { cause } : undefined);
  result.code = code;
  result.statusCode = ({ OPENCODE_CAPTURE_LIMIT: 413, OPENCODE_DISK_FULL: 507, OPENCODE_PERMISSION_DENIED: 403,
    OPENCODE_DATABASE_BUSY: 503, OPENCODE_DATABASE_INVALID: 422, OPENCODE_DATABASE_NOT_FOUND: 404,
    OPENCODE_SOURCE_UNREADABLE: 422, OPENCODE_SOURCE_UNSUPPORTED: 422, OPENCODE_SQLITE_UNAVAILABLE: 501,
    OPENCODE_SCHEMA_UNSUPPORTED: 422, OPENCODE_DATA_INVALID: 422, OPENCODE_INVALID_LIMIT: 400, OPENCODE_PROJECT_INVALID: 400,
    INDEXED_SOURCE_STALE: 409 })[code] || 500;
  return result;
}
function abort(signal) {
  if (!signal?.aborted) return;
  const result = error('ABORT_ERR', 'OpenCode capture was cancelled'); result.name = 'AbortError'; throw result;
}
function stale(message = 'The captured OpenCode snapshot changed or is unavailable; rebuild the index') {
  return error('INDEXED_SOURCE_STALE', message);
}
function normalizeError(cause) {
  if (cause?.name === 'AbortError' || /^OPENCODE_|^INDEXED_SOURCE_STALE$/.test(cause?.code || '')) return cause;
  const code = cause?.code || '';
  const sqliteCode = Number(cause?.errcode || cause?.errno || 0) & 255;
  if (code === 'ENOSPC' || sqliteCode === 13) return error('OPENCODE_DISK_FULL', 'Insufficient disk space while capturing OpenCode', cause);
  if (['EACCES', 'EPERM', 'EROFS'].includes(code) || [3, 8, 23].includes(sqliteCode)) return error('OPENCODE_PERMISSION_DENIED', 'OpenCode database or WAL side files are not accessible with the required permissions', cause);
  if ([5, 6].includes(sqliteCode) || /database (?:is )?locked|database (?:is )?busy/i.test(cause?.message || '')) return error('OPENCODE_DATABASE_BUSY', 'OpenCode database remained locked past the read timeout', cause);
  if ([11, 26].includes(sqliteCode)) return error('OPENCODE_DATABASE_INVALID', 'OpenCode database or WAL data is invalid', cause);
  if (code === 'ENOENT' || code === 'ENOTDIR') return error('OPENCODE_DATABASE_NOT_FOUND', 'OpenCode database was not found at the selected source', cause);
  return error('OPENCODE_SOURCE_UNREADABLE', 'OpenCode source could not be read', cause);
}
function budget(name, limit) { throw error('OPENCODE_CAPTURE_LIMIT', `OpenCode capture exceeded ${name} (${limit})`); }
function limitsFrom(overrides) {
  const result = { ...LIMITS };
  if (overrides) for (const [key, value] of Object.entries(overrides)) {
    if (!(key in LIMITS) || !Number.isSafeInteger(value) || value < 1) throw error('OPENCODE_INVALID_LIMIT', `Invalid OpenCode limit: ${key}`);
    result[key] = value;
  }
  return result;
}
function checkpoint(context) {
  abort(context.signal);
  if (performance.now() - context.started > context.limits.maxCaptureMs) budget('maxCaptureMs', context.limits.maxCaptureMs);
}
function inspectJson(text, context, owner) {
  if (text === null) return;
  if (typeof text !== 'string') throw error('OPENCODE_DATA_INVALID', `Invalid JSON column in ${owner}`);
  let depth = 0; let quoted = false; let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') { if (++depth > context.limits.maxDepth) budget('maxDepth', context.limits.maxDepth); }
    else if (c === '}' || c === ']') depth--;
  }
  try { JSON.parse(text); } catch (cause) { throw error('OPENCODE_DATA_INVALID', `Invalid JSON column in ${owner}`, cause); }
}
function defaultOpenCodeHome() {
  const data = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode');
  const db = process.env.OPENCODE_DB;
  return db ? (db === ':memory:' ? db : path.resolve(data, db)) : data;
}
async function resolveOpenCodeDatabase(sourceHome = defaultOpenCodeHome()) {
  if (typeof sourceHome !== 'string' || !sourceHome.trim() || sourceHome === ':memory:' || sourceHome.includes('\0')) {
    throw error('OPENCODE_SOURCE_UNSUPPORTED', 'Choose an on-disk OpenCode database or data directory');
  }
  const selected = path.resolve(sourceHome);
  let stat;
  try { stat = await fsp.stat(selected); } catch (cause) { throw normalizeError(cause); }
  if (stat.isFile()) return selected;
  if (!stat.isDirectory()) throw error('OPENCODE_SOURCE_UNSUPPORTED', 'OpenCode source must be a database file or data directory');
  // Stable/default channels use opencode.db. Other channel databases are
  // selected explicitly rather than silently combining independent histories.
  return path.join(selected, 'opencode.db');
}
function loadSqlite() {
  try {
    const sqlite = require('node:sqlite');
    if (typeof sqlite.DatabaseSync !== 'function') throw new Error('DatabaseSync unavailable');
    return sqlite.DatabaseSync;
  } catch (cause) { throw error('OPENCODE_SQLITE_UNAVAILABLE', 'This Node runtime does not provide the required node:sqlite reader; use a supported Node 22/24 release', cause); }
}
function walChecksum(buffer, littleEndian, initial = [0, 0]) {
  let [s0, s1] = initial;
  for (let offset = 0; offset < buffer.length; offset += 8) {
    const first = littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    const second = littleEndian ? buffer.readUInt32LE(offset + 4) : buffer.readUInt32BE(offset + 4);
    s0 = (s0 + first + s1) >>> 0;
    s1 = (s1 + second + s0) >>> 0;
  }
  return [s0, s1];
}
async function checkWal(databasePath, context, frames = false) {
  let handle;
  try {
    handle = await fsp.open(`${databasePath}-wal`, 'r');
    const stat = await handle.stat();
    if (stat.size === 0) return;
    if (stat.size > context.limits.maxWalBytes) budget('maxWalBytes', context.limits.maxWalBytes);
    const header = Buffer.alloc(32);
    const { bytesRead } = await handle.read(header, 0, 32, 0);
    if (bytesRead < 32 || ![0x377f0682, 0x377f0683].includes(header.readUInt32BE(0))) {
      throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL header is invalid or incomplete; retry after its writer settles');
    }
    const pageSize = header.readUInt32BE(8);
    const littleEndian = header.readUInt32BE(0) === 0x377f0682;
    let checksum = walChecksum(header.subarray(0, 24), littleEndian);
    if (header.readUInt32BE(4) !== 3007000 || pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))
      || checksum[0] !== header.readUInt32BE(24) || checksum[1] !== header.readUInt32BE(28)) {
      throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL header format or checksum is invalid');
    }
    if (!frames) return;
    // SQLite deliberately ignores an invalid WAL suffix. That recovery behavior
    // must not make an Analyzer refresh silently serve only older main-file rows.
    // This scan runs with SQLite's read transaction already established: normal
    // writers may append. A view using only checkpointed main-file pages does
    // not pin a WAL cycle; the final header/identity check detects a restart.
    const frame = Buffer.alloc(pageSize + 24);
    let verifiedFrames = 0;
    let tail = null;
    for (let position = 32; position < stat.size; position += frame.length) {
      checkpoint(context);
      let offset = 0;
      while (offset < frame.length && position + offset < stat.size) {
        const read = await handle.read(frame, offset, Math.min(frame.length - offset, stat.size - position - offset), position + offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset !== frame.length) throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL has an incomplete frame; retry after its writer settles');
      const sameCycle = frame.subarray(8, 16).equals(header.subarray(16, 24));
      if (!sameCycle) {
        // A normal restart increments salt1 and randomizes salt2. Arbitrary
        // mismatches must not hide a damaged committed frame. A verified
        // current-cycle prefix is required, but it need not contain a commit:
        // checkpoint + rollback can leave only uncommitted current frames.
        // Retained allocations may span old cycles and contain old commits.
        const age = (header.readUInt32BE(16) - frame.readUInt32BE(8)) >>> 0;
        if (!verifiedFrames || !age || age >= 0x80000000 || frame.readUInt32BE(12) === header.readUInt32BE(20)) {
          throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL frame salt is invalid or ambiguous');
        }
        tail = 'older-cycle';
        continue;
      }
      if (tail === 'older-cycle') throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL returns to current frames after an invalid salt');
      if (!frame.readUInt32BE(0)) throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL frame page number is invalid');
      if (tail === 'uncommitted') {
        if (frame.readUInt32BE(4)) throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL contains a commit after a damaged frame');
        continue;
      }
      checksum = walChecksum(frame.subarray(0, 8), littleEndian, checksum);
      checksum = walChecksum(frame.subarray(24), littleEndian, checksum);
      if (checksum[0] !== frame.readUInt32BE(16) || checksum[1] !== frame.readUInt32BE(20)) {
        // A shorter second rollback can overwrite only a prefix of an earlier
        // spill, breaking the checksum chain with no commit in this WAL cycle.
        // Require a verified prefix and examine ALL remaining frame headers:
        // a commit on/after a broken current-cycle frame still fails, whether
        // or not a valid commit preceded it. Never ignore the suffix at EOF.
        if (!verifiedFrames || frame.readUInt32BE(4)) throw error('OPENCODE_DATABASE_INVALID', 'The OpenCode WAL frame checksum is invalid; retry after its writer settles');
        tail = 'uncommitted';
      } else {
        verifiedFrames++;
      }
    }
    const current = Buffer.alloc(32);
    const reread = await handle.read(current, 0, 32, 0);
    const after = await fsp.stat(`${databasePath}-wal`);
    if (reread.bytesRead !== 32 || !current.equals(header) || stat.dev !== after.dev || stat.ino !== after.ino || after.size < stat.size) {
      throw error('OPENCODE_DATABASE_BUSY', 'The OpenCode WAL changed during validation; retry the capture');
    }
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
    if (handle) throw error('OPENCODE_DATABASE_BUSY', 'The OpenCode WAL disappeared during validation; retry the capture', cause);
  }
  finally { await handle?.close(); }
}
function columnsFor(table) {
  return Object.entries(SCHEMA[table]).flatMap(([type, names]) => names.split(' ').map(name => ({ name, type: type.toUpperCase() }))).sort((a, b) => a.name.localeCompare(b.name));
}
function inspectSchema(db) {
  const result = [];
  for (const table of Object.keys(SCHEMA)) {
    const definition = db.prepare('SELECT type FROM sqlite_schema WHERE name = ?').get(table);
    if (definition?.type !== 'table') throw error('OPENCODE_SCHEMA_UNSUPPORTED', `OpenCode schema profile requires table ${table}`);
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
    const normalized = columns.map(c => ({ name: c.name, type: c.type.toUpperCase() })).sort((a, b) => a.name.localeCompare(b.name));
    const pk = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
    if (JSON.stringify(normalized) !== JSON.stringify(columnsFor(table)) || JSON.stringify(pk) !== JSON.stringify(PRIMARY_KEYS[table])) {
      throw error('OPENCODE_SCHEMA_UNSUPPORTED', `Unsupported OpenCode ${table} layout; expected the ${SCHEMA_PROFILE} profile`);
    }
    result.push({ table, columns: normalized, primaryKey: pk });
  }
  // Stable capture relies on this ordering index to avoid sorting arbitrary
  // source corpora before bounded iteration can observe cancellation.
  const indexes = db.prepare('PRAGMA index_list("session_message")').all();
  const ordering = indexes.find(i => i.name === 'session_message_session_seq_idx' && i.unique === 1);
  if (!ordering || JSON.stringify(db.prepare('PRAGMA index_info("session_message_session_seq_idx")').all().map(c => c.name)) !== JSON.stringify(['session_id', 'seq'])) {
    throw error('OPENCODE_SCHEMA_UNSUPPORTED', 'OpenCode session message ordering index is unavailable');
  }
  if (db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('blob','blob_ref') LIMIT 1").get()) {
    throw error('OPENCODE_SCHEMA_UNSUPPORTED', 'OpenCode blob-backed development storage is not supported by this profile');
  }
  return hash(JSON.stringify(result));
}
function guardedQuery(db, table, where = '', order = '') {
  const columns = columnsFor(table);
  const valid = ({ name, type }) => type === 'TEXT' ? `typeof("${name}") = 'text'`
    : type === 'INTEGER' ? `(typeof("${name}") = 'integer' AND "${name}" BETWEEN -9007199254740991 AND 9007199254740991)`
      : `typeof("${name}") IN ('integer','real')`;
  const guarded = columns.map(column => `CASE WHEN "${column.name}" IS NULL OR (${valid(column)}${column.type === 'TEXT' ? ` AND length(CAST("${column.name}" AS BLOB)) <= :fieldLimit` : ''}) THEN "${column.name}" ELSE NULL END AS "${column.name}"`).join(',');
  const overflow = columns.filter(c => c.type === 'TEXT').map(({ name }) => `(typeof("${name}") = 'text' AND length(CAST("${name}" AS BLOB)) > :fieldLimit)`).join(' OR ');
  const invalid = columns.map(column => `("${column.name}" IS NOT NULL AND NOT (${valid(column)}))`).join(' OR ');
  return db.prepare(`SELECT ${guarded}, CASE WHEN ${overflow} THEN 1 ELSE 0 END AS __oversized, CASE WHEN ${invalid} THEN 1 ELSE 0 END AS __invalid FROM "${table}" ${where} ${order}`);
}
function acceptRow(value, table, context) {
  checkpoint(context);
  if (value.__invalid) throw error('OPENCODE_DATA_INVALID', `Invalid stored column type or integer range in OpenCode ${table}`);
  if (value.__oversized) budget('maxFieldBytes', context.limits.maxFieldBytes);
  const { __oversized, __invalid, ...row } = value;
  for (const [name, data] of Object.entries(row)) {
    if (JSON_COLUMNS.has(name) && data !== null) inspectJson(data, context, `${table}.${name}`);
    if (typeof data === 'number' && (!Number.isFinite(data) || (columnsFor(table).find(c => c.name === name)?.type === 'INTEGER' && !Number.isSafeInteger(data)))) {
      throw error('OPENCODE_DATA_INVALID', `Invalid numeric column ${table}.${name}`);
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(row));
  context.catalogBytes += bytes;
  if (context.catalogBytes > context.limits.maxTotalBytes) budget('maxTotalBytes', context.limits.maxTotalBytes);
  return row;
}
async function readCatalog(db, context) {
  const rows = {};
  for (const table of ['project', 'worktree', 'session_v2']) {
    rows[table] = [];
    const query = guardedQuery(db, table, '', table === 'worktree' ? 'ORDER BY project_id,directory' : 'ORDER BY id');
    for (const row of query.iterate({ fieldLimit: context.limits.maxFieldBytes })) {
      if (rows[table].length >= context.limits.maxCatalogSessions) budget('maxCatalogSessions', context.limits.maxCatalogSessions);
      rows[table].push(acceptRow(row, table, context));
      if (rows[table].length % 32 === 0) { await yieldImmediate(); checkpoint(context); }
    }
  }
  return rows;
}
function hostPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  // OpenCode normalizes Windows UNC paths to //server/share. Preserve their
  // Windows identity instead of reinterpreting them as POSIX /server/share.
  if (value.startsWith('//')) {
    if (process.platform !== 'win32') return null;
    value = value.replaceAll('/', '\\');
  }
  // Do not reinterpret a Windows path as a relative POSIX path after a DB move.
  if (process.platform !== 'win32' && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'))) return null;
  if (!path.isAbsolute(value)) return null;
  return resolveFsPath(value);
}
function sessionRoot(session, projects) {
  const project = projects.get(session.project_id);
  const worktree = project && hostPath(project.worktree);
  return (session.project_id !== 'global' && worktree && worktree !== path.parse(worktree).root)
    ? worktree : hostPath(session.directory);
}
async function openRead(sourceHome, context, operation) {
  const databasePath = await resolveOpenCodeDatabase(sourceHome);
  let db;
  try {
    checkpoint(context);
    const filename = await fsp.realpath(databasePath);
    const before = await fsp.stat(filename, { bigint: true });
    if (!before.isFile()) throw error('OPENCODE_SOURCE_UNSUPPORTED', 'The OpenCode database path is not a regular file');
    await checkWal(filename, context);
    const DatabaseSync = loadSqlite();
    db = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA query_only = ON');
    db.exec(`PRAGMA busy_timeout = ${context.limits.busyTimeoutMs}`);
    db.exec('BEGIN');
    const schemaDigest = inspectSchema(db);
    await checkWal(filename, context, true);
    const source = { databasePath: filename,
      identity: `opencode-db:${hash(JSON.stringify({ path: filename, device: String(before.dev), inode: String(before.ino), birthtime: String(before.birthtimeNs) }))}`,
      schemaProfile: SCHEMA_PROFILE, schemaDigest };
    const result = await operation(db, source);
    checkpoint(context);
    if (db.prepare('PRAGMA query_only').get().query_only !== 1 || db.prepare('SELECT total_changes() AS n').get().n !== 0) {
      throw error('OPENCODE_READONLY_VIOLATION', 'OpenCode reader did not preserve its read-only invariant');
    }
    const after = await fsp.stat(filename, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs) throw stale('OpenCode database was replaced during capture');
    db.exec('ROLLBACK');
    return result;
  } catch (cause) { throw normalizeError(cause); }
  finally { if (db) db.close(); }
}
async function discoverOpenCodeProjects({ sourceHome = defaultOpenCodeHome(), signal, onDiagnostic, limits } = {}) {
  const context = { limits: limitsFrom(limits), signal, started: performance.now(), catalogBytes: 0 };
  try {
    return await openRead(sourceHome, context, async db => {
      const catalog = await readCatalog(db, context); const projects = new Map(catalog.project.map(p => [p.id, p]));
      const found = new Map();
      for (const session of catalog.session_v2) {
        const repoRoot = sessionRoot(session, projects);
        if (!repoRoot) continue;
        const value = found.get(repoRoot) || { repoRoot, sessionCount: 0, updatedAt: '', bytes: 0, exists: false, source: 'opencode-sqlite' };
        value.sessionCount++;
        const timestamp = new Date(session.time_updated).toISOString();
        if (timestamp > value.updatedAt) value.updatedAt = timestamp;
        found.set(repoRoot, value);
      }
      for (const value of found.values()) { try { value.exists = (await fsp.stat(value.repoRoot)).isDirectory(); } catch { /* External or removed working directory. */ } }
      return [...found.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.repoRoot.localeCompare(b.repoRoot));
    });
  } catch (cause) { const result = normalizeError(cause); onDiagnostic?.({ code: result.code, path: String(sourceHome), message: result.message }); throw result; }
}
function deadProcess(pid) {
  try { process.kill(pid, 0); return false; } catch (cause) { return cause.code === 'ESRCH'; }
}
async function sweepOpenCodeSnapshots(base = defaultSnapshotBase()) {
  let entries;
  try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch (cause) { if (cause.code === 'ENOENT') return; throw cause; }
  for (const entry of entries.slice(0, 1000)) {
    if (!entry.isDirectory() || !/^capture-[a-zA-Z0-9]+$/.test(entry.name)) continue;
    const directory = path.join(base, entry.name);
    try {
      const markerPath = path.join(directory, 'owner.json'); const info = await fsp.lstat(markerPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) continue;
      const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
      if (marker.kind !== MARKER || marker.version !== 1 || !Number.isSafeInteger(marker.pid) || marker.pid < 1
        || !Number.isFinite(marker.createdAt) || Date.now() - marker.createdAt < 24 * 60 * 60 * 1000
        || !/^[a-f0-9]{32}$/.test(marker.token || '') || !deadProcess(marker.pid)) continue;
      await fsp.rm(directory, { recursive: true, force: true });
    } catch { /* Conservative: an ambiguous or inaccessible owner is never swept. */ }
  }
}
function relationTarget(id, all, selectedIds) {
  if (!id) return null;
  const target = all.get(id);
  return target ? { id, exists: true, inProject: selectedIds.has(id), projectID: target.project_id, directory: target.directory }
    : { id, exists: false, inProject: false };
}
async function retryFailedCaptureCleanup() {
  for (const [directory, cleanup] of [...failedCaptureCleanup].slice(0, 16)) {
    try { await cleanup.dispose(); failedCaptureCleanup.delete(directory); }
    catch { /* The original failure is observable; preserve ownership for retry/exit. */ }
  }
}
process.on('exit', () => {
  for (const cleanup of failedCaptureCleanup.values()) {
    try { cleanup.disposeSync(); } catch { /* Preserve the original exit status. */ }
  }
});
async function captureOpenCodeProject({ sourceHome = defaultOpenCodeHome(), repoRoot, signal, limits, onProgress,
  snapshotBase = defaultSnapshotBase(), afterReadView } = {}) {
  const context = { limits: limitsFrom(limits), signal, started: performance.now(), catalogBytes: 0 };
  const resolvedRepo = hostPath(repoRoot);
  if (!resolvedRepo) throw error('OPENCODE_PROJECT_INVALID', 'An absolute local project path is required');
  snapshotBase = path.resolve(snapshotBase);
  let snapshotRoot; let disposed = false; let disposePromise; let reservedBytes = 0;
  const reserve = size => {
    const stored = storedBytesByBase.get(snapshotBase) || 0;
    if (stored + size > context.limits.maxStoredBytes) budget('maxStoredBytes', context.limits.maxStoredBytes);
    storedBytesByBase.set(snapshotBase, stored + size); reservedBytes += size;
  };
  const releaseReservation = () => {
    const remaining = (storedBytesByBase.get(snapshotBase) || 0) - reservedBytes;
    if (remaining > 0) storedBytesByBase.set(snapshotBase, remaining); else storedBytesByBase.delete(snapshotBase);
    reservedBytes = 0;
  };
  const disposeSync = () => { if (disposed || !snapshotRoot) return; fs.rmSync(snapshotRoot, { recursive: true, force: true }); disposed = true; releaseReservation(); };
  const dispose = () => {
    if (disposed || !snapshotRoot) return Promise.resolve();
    if (disposePromise) return disposePromise;
    disposePromise = fsp.rm(snapshotRoot, { recursive: true, force: true }).then(() => { disposed = true; releaseReservation(); }).catch(cause => { disposePromise = null; throw cause; });
    return disposePromise;
  };
  try {
    abort(signal); await retryFailedCaptureCleanup();
    await fsp.mkdir(snapshotBase, { recursive: true, mode: 0o700 });
    await sweepOpenCodeSnapshots(snapshotBase);
    snapshotRoot = await fsp.mkdtemp(path.join(snapshotBase, 'capture-'));
    await fsp.chmod(snapshotRoot, 0o700);
    const ownerText = JSON.stringify({ kind: MARKER, version: 1, pid: process.pid, token: PROCESS_TOKEN, createdAt: Date.now() });
    reserve(Buffer.byteLength(ownerText));
    await fsp.writeFile(path.join(snapshotRoot, 'owner.json'), ownerText, { mode: 0o600, flag: 'wx' });
    let totalBytes = 0; let messageCount = 0;
    const capture = await openRead(sourceHome, context, async (db, source) => {
      const catalog = await readCatalog(db, context);
      const projects = new Map(catalog.project.map(p => [p.id, p]));
      const all = new Map(catalog.session_v2.map(s => [s.id, s]));
      const selected = catalog.session_v2.filter(s => {
        const root = sessionRoot(s, projects); const directory = hostPath(s.directory);
        return (root && isPathInsideOrSame(root, resolvedRepo)) || (directory && isPathInsideOrSame(directory, resolvedRepo));
      });
      if (selected.length > context.limits.maxSessions) budget('maxSessions', context.limits.maxSessions);
      const selectedIds = new Set(selected.map(s => s.id));
      const manifest = { formatVersion: FORMAT_VERSION, source, repoRoot: resolvedRepo,
        members: selected.map(s => ({ id: s.id, projectID: s.project_id, directory: s.directory, parentID: s.parent_id, forkSessionID: s.fork_session_id })) };
      const manifestDigest = hash(JSON.stringify(manifest));
      if (afterReadView) await afterReadView(); // Deterministic writer injection in tests; not a source callback.
      checkpoint(context);
      const sessions = [];
      const query = guardedQuery(db, 'session_message', 'WHERE session_id = :sessionId', 'ORDER BY seq');
      for (const session of selected) {
        checkpoint(context);
        const children = catalog.session_v2.filter(s => s.parent_id === session.id).map(s => s.id).sort();
        const relations = { parentID: session.parent_id, forkSessionID: session.fork_session_id, childIDs: children,
          parent: relationTarget(session.parent_id, all, selectedIds), fork: relationTarget(session.fork_session_id, all, selectedIds),
          children: children.map(id => relationTarget(id, all, selectedIds)) };
        const project = { repoRoot: resolvedRepo, metadata: projects.get(session.project_id) || null,
          worktrees: catalog.worktree.filter(w => w.project_id === session.project_id) };
        project.manifestDigest = hash(JSON.stringify({ project, member: manifest.members.find(s => s.id === session.id), relations }));
        const fileName = `session-${hash(session.id)}.json`;
        const filePath = path.join(snapshotRoot, fileName); const handle = await fsp.open(filePath, 'wx', 0o600);
        const digest = crypto.createHash('sha256'); let bytes = 0; let count = 0;
        const write = async text => {
          checkpoint(context); const size = Buffer.byteLength(text); bytes += size; totalBytes += size;
          if (bytes > context.limits.maxSessionBytes) budget('maxSessionBytes', context.limits.maxSessionBytes);
          if (totalBytes > context.limits.maxTotalBytes) budget('maxTotalBytes', context.limits.maxTotalBytes);
          reserve(size); digest.update(text); await handle.writeFile(text, 'utf8'); checkpoint(context);
        };
        try {
          const prefix = JSON.stringify({ formatVersion: FORMAT_VERSION, source, project, session, relations });
          await write(`${prefix.slice(0, -1)},"messages":[`);
          for (const rawRow of query.iterate({ fieldLimit: context.limits.maxFieldBytes, sessionId: session.id })) {
            if (++messageCount > context.limits.maxMessages) budget('maxMessages', context.limits.maxMessages);
            // Catalog accounting is separate; streaming messages need only the
            // per-field and output byte limits, not a second cumulative charge.
            const previousBytes = context.catalogBytes;
            const row = acceptRow(rawRow, 'session_message', context); context.catalogBytes = previousBytes;
            if (!Number.isSafeInteger(row.seq) || row.seq < 1 || typeof row.id !== 'string' || !row.id || row.session_id !== session.id) {
              throw error('OPENCODE_DATA_INVALID', 'Invalid OpenCode message identity or order');
            }
            await write(`${count ? ',' : ''}${JSON.stringify(row)}`); count++;
            if (count % 32 === 0) await yieldImmediate();
          }
          await write(']}\n');
        } finally { await handle.close(); }
        const contentDigest = digest.digest('hex');
        await fsp.chmod(filePath, 0o400);
        sessions.push({ sessionId: session.id, fileName, bytes, digest: contentDigest,
          snapshotId: `opencode-snapshot:${FORMAT_VERSION}:${contentDigest}`, messageCount: count });
        onProgress?.({ phase: 'capturing', sessionId: session.id, sessionCount: sessions.length });
      }
      return { source, manifest, manifestDigest, sessions, totalBytes, messageCount };
    });
    checkpoint(context);
    const manifestText = JSON.stringify(capture.manifest) + '\n';
    if (capture.totalBytes + Buffer.byteLength(manifestText) > context.limits.maxTotalBytes) budget('maxTotalBytes', context.limits.maxTotalBytes);
    reserve(Buffer.byteLength(manifestText));
    await fsp.writeFile(path.join(snapshotRoot, 'manifest.json'), manifestText, { mode: 0o400, flag: 'wx' });
    return { snapshotRoot, ...capture, dispose, disposeSync };
  } catch (cause) {
    let cleanupError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await dispose(); cleanupError = null; break; }
      catch (cleanup) { cleanupError = cleanup; await yieldImmediate(); }
    }
    if (cleanupError) {
      // A failed build has not transferred to index-resources yet. Keep an
      // explicit owner so cleanup and quota release are retried on the next
      // capture and synchronously at process exit, rather than losing the lease.
      failedCaptureCleanup.set(snapshotRoot, { dispose, disposeSync });
      process.emitWarning(`OpenCode staging cleanup failed (${cleanupError.code || cleanupError.name}); retained for retry`, { code: 'OPENCODE_SNAPSHOT_CLEANUP_FAILED' });
    }
    if (cleanupError) cause.cleanupError = cleanupError;
    throw normalizeError(cause);
  }
}
async function readOpenCodeSnapshot(snapshotRoot, metadata, { signal } = {}) {
  abort(signal);
  if (!metadata || !/^session-[a-f0-9]{64}\.json$/.test(metadata.fileName || '')
    || !/^[a-f0-9]{64}$/.test(metadata.digest || '') || !Number.isSafeInteger(metadata.bytes)
    || metadata.bytes < 1 || metadata.bytes > LIMITS.maxTotalBytes
    || metadata.snapshotId !== `opencode-snapshot:${FORMAT_VERSION}:${metadata.digest}`) throw stale();
  let handle;
  try {
    const filename = path.join(snapshotRoot, metadata.fileName);
    const info = await fsp.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== metadata.bytes) throw stale();
    handle = await fsp.open(filename, 'r');
    const opened = await handle.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== metadata.bytes) throw stale();
    // Bound reads by the accepted length even if an external process grows the
    // file after lstat; readFile() would otherwise keep allocating to its EOF.
    const buffer = Buffer.alloc(metadata.bytes); let offset = 0;
    while (offset < buffer.length) {
      abort(signal); const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw stale(); offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, metadata.bytes)).bytesRead) throw stale();
    abort(signal);
    if (buffer.length !== metadata.bytes || hash(buffer) !== metadata.digest) throw stale();
    const snapshot = JSON.parse(buffer.toString('utf8'));
    if (snapshot.formatVersion !== FORMAT_VERSION || snapshot.source?.schemaProfile !== SCHEMA_PROFILE
      || snapshot.session?.id !== metadata.sessionId || !Array.isArray(snapshot.messages)
      || (metadata.messageCount !== undefined && snapshot.messages.length !== metadata.messageCount)) throw stale();
    return snapshot;
  } catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    if (cause.code === 'INDEXED_SOURCE_STALE') throw cause;
    throw stale();
  } finally { await handle?.close(); }
}
module.exports = { SCHEMA_PROFILE, FORMAT_VERSION, LIMITS, hash, abort, stale, normalizeError,
  defaultOpenCodeHome, resolveOpenCodeDatabase, discoverOpenCodeProjects,
  captureOpenCodeProject, readOpenCodeSnapshot, sweepOpenCodeSnapshots };
