'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { setImmediate: yieldImmediate } = require('node:timers/promises');

// Pinned rust-v0.162.1 state/src/sqlite.rs and thread-store/src/local/revert_thread.rs.
// Only the current artifact pointer is read. SQLite history projections are not
// transcript evidence, and this reader never initializes or migrates a database.
const STATE_FILE = 'state_5.sqlite';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  throw error;
}

async function containedPath(root, canonicalRoot, value) {
  if (typeof value !== 'string' || !value || value.length > 32768 || value.includes('\0')) return null;
  // Codex writes absolute paths. A relative or foreign-host path is not rooted
  // against this machine's cwd or silently repaired by its basename.
  if (!path.isAbsolute(value)) return null;
  let absolute;
  try {
    absolute = await fsp.realpath(value);
  } catch (error) {
    if (error?.code !== 'ENOENT') return null;
    // The pointer may name the logical plain sibling of a compressed file.
    // Resolve its parent, retaining the basename for artifact discovery to check.
    try { absolute = path.join(await fsp.realpath(path.dirname(value)), path.basename(value)); }
    catch { return null; }
  }
  const relative = path.relative(canonicalRoot, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return path.join(root, relative);
}

async function readCurrentRolloutPaths({ codexHome, sessionsRoot, sessionIds = [], signal } = {}) {
  abortIfNeeded(signal);
  const currentPaths = new Map();
  const diagnostics = [];
  const ids = [...new Set(sessionIds.filter((id) => typeof id === 'string' && UUID_RE.test(id)).map((id) => id.toLowerCase()))].sort();
  const sourceFile = path.join(path.resolve(codexHome), STATE_FILE);
  const root = path.resolve(sessionsRoot || path.join(codexHome, 'sessions'));
  const entries = [];
  let status = ids.length ? 'available' : 'not-needed';
  let db;
  try {
    if (ids.length) {
      const stat = await fsp.stat(sourceFile);
      if (!stat.isFile()) throw new Error('State pointer source is not a file');
      const canonicalRoot = await fsp.realpath(root);
      abortIfNeeded(signal);
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(sourceFile, { readOnly: true, allowExtension: false });
      db.exec('PRAGMA query_only = ON');
      db.exec('PRAGMA busy_timeout = 50');
      db.exec('BEGIN');
      // Parameterized identity lookups keep work bounded by discovered artifacts.
      // length() guards against retaining a corrupt, arbitrarily large text cell.
      const query = db.prepare('SELECT CASE WHEN typeof(rollout_path) = \'text\' AND length(rollout_path) <= 32768 THEN rollout_path ELSE NULL END AS rollout_path FROM threads WHERE id = ? LIMIT 2');
      for (let i = 0; i < ids.length; i += 1) {
        abortIfNeeded(signal);
        const id = ids[i];
        const rows = query.all(id);
        const pointer = rows.length === 1 ? await containedPath(root, canonicalRoot, rows[0].rollout_path) : null;
        entries.push(Object.freeze({ sessionId: id, rolloutPath: pointer,
          status: pointer ? 'valid' : rows.length ? 'invalid' : 'absent' }));
        if (pointer) currentPaths.set(id, pointer);
        else if (rows.length && !diagnostics.length) diagnostics.push({ code: 'CODEX_CURRENT_ROLLOUT_INVALID', path: STATE_FILE,
          message: 'The current rollout pointer is ambiguous, invalid, or outside the selected source root.' });
        if ((i + 1) % 128 === 0) await yieldImmediate();
      }
      db.exec('ROLLBACK');
    }
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) {
      abortIfNeeded(signal);
      throw error;
    }
    currentPaths.clear();
    entries.length = 0;
    status = error?.code === 'ENOENT' ? 'missing' : 'unavailable';
    diagnostics.length = 0;
    diagnostics.push({ code: 'CODEX_CURRENT_ROLLOUT_UNAVAILABLE', path: STATE_FILE,
      message: status === 'missing' ? 'The current rollout pointer database is absent.'
        : 'The current rollout pointer database could not be read with the supported schema.' });
  } finally {
    if (db) db.close();
  }
  abortIfNeeded(signal);
  const facts = { kind: 'codex-current-rollout-v1', status, sourceFile, entries: Object.freeze(entries) };
  const digest = crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex');
  return { currentPaths, diagnostics, evidence: Object.freeze({ ...facts, digest }) };
}

module.exports = { readCurrentRolloutPaths };
