'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { setImmediate: yieldImmediate } = require('node:timers/promises');
const { copySqliteMetadataSnapshot } = require('./sqlite-metadata-snapshot');
const { projectPathFor } = require('./project-path-context');
const { hash } = require('./qoder-storage');

const MAX_DATABASE_BYTES = 512 * 1024 * 1024;
const MAX_CANDIDATES = 10000;
const scalar = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 4096 && !v.includes('\0');
const titleSources = new Set(['ai', 'custom', 'fallback', 'legacy']);
const voicePlaceholders = new Set(['新语音会话', 'New voice chat', 'New voice session']);

// Qoder CN desktop 0.4.9: missing title state is legacy, except voice placeholders.
// Unknown or malformed explicit state is kept out rather than guessed.
function titleState(row) {
  if (!scalar(row.title) || typeof row.extra_json !== 'string' || !scalar(row.conversation_mode)) return null;
  let extra;
  try { extra = JSON.parse(row.extra_json); } catch { return null; }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const revision = extra.titleRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  if (!Object.hasOwn(extra, 'titleSource') && !Object.hasOwn(extra, 'titleResolved')) {
    if (row.conversation_mode === 'voice' && voicePlaceholders.has(row.title.trim())) return null;
    return { source: 'legacy', revision };
  }
  return extra.titleResolved === true && titleSources.has(extra.titleSource)
    ? { source: extra.titleSource, revision } : null;
}

function validTitle(value, sessionId, cwd) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join(',') === 'cwd,revision,sessionId,source,title'
    && [value.sessionId, value.cwd, value.title].every(scalar)
    && value.sessionId === sessionId && value.cwd === cwd
    && titleSources.has(value.source) && Number.isSafeInteger(value.revision) && value.revision >= 0;
}

async function readDesktopTitles(filename, candidates, { signal, onDiagnostic, physicalIdentities,
  scanComplete, projectPathContext } = {}) {
  const titles = new Map();
  signal?.throwIfAborted();
  if (!filename || !candidates.some((c) => c.sourceFile.split('/').length === 2)) return titles;
  let snapshot; let db;
  try {
    if (!scanComplete || candidates.length > MAX_CANDIDATES) throw new Error('Incomplete or oversized candidate set');
    const root = await fs.realpath(path.dirname(filename));
    snapshot = await copySqliteMetadataSnapshot(filename, { root, signal,
      maxFileBytes: MAX_DATABASE_BYTES, maxTotalBytes: MAX_DATABASE_BYTES, prefix: 'session-analyzer-qoder-title-' });
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(snapshot.filename, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 50; BEGIN');
    const schema = db.prepare("SELECT type FROM sqlite_master WHERE name = 'chat_sessions'").get();
    const columns = db.prepare('PRAGMA table_info(chat_sessions)').all();
    if (schema?.type !== 'table' || columns.filter((c) => c.pk).length !== 1
      || !columns.some((c) => c.name === 'session_id' && c.pk === 1)) throw new Error('Unsupported desktop title identity');
    // SQLite length(TEXT) stops at NUL. Bound UTF-8 bytes as well, before any
    // string reaches JS, allowing at most four bytes per Unicode character.
    const query = db.prepare(`SELECT
      CASE WHEN typeof(session_id) = 'text' AND length(CAST(session_id AS BLOB)) <= 16384
        AND length(session_id) <= 4096 THEN session_id END AS session_id,
      CASE WHEN typeof(cwd) = 'text' AND length(CAST(cwd AS BLOB)) <= 16384
        AND length(cwd) <= 4096 THEN cwd END AS cwd,
      CASE WHEN typeof(title) = 'text' AND length(CAST(title AS BLOB)) <= 16384
        AND length(title) <= 4096 THEN title END AS title,
      CASE WHEN typeof(extra_json) = 'text' AND length(CAST(extra_json AS BLOB)) <= 262144
        AND length(extra_json) <= 65536 THEN extra_json END AS extra_json,
      CASE WHEN typeof(conversation_mode) = 'text' AND length(CAST(conversation_mode AS BLOB)) <= 512
        AND length(conversation_mode) <= 128 THEN conversation_mode END AS conversation_mode,
      CASE WHEN execution_kind = 'local' AND session_kind = 'standard' THEN 1 ELSE 0 END AS local_execution
      FROM chat_sessions WHERE session_id = ? AND deleted_at IS NULL LIMIT 2`);
    let checked = 0;
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      if (++checked % 128 === 0) { await yieldImmediate(); signal?.throwIfAborted(); }
      if (candidate.sourceFile.split('/').length !== 2) continue;
      const rows = query.all(candidate.header.id);
      if (!rows.length) continue;
      const row = rows[0];
      const state = rows.length === 1 ? titleState(row) : null;
      const artifact = path.resolve(projectPathContext.sourceHome, 'projects', candidate.sourceFile);
      const databasePath = scalar(row.cwd) && projectPathFor(row.cwd, projectPathContext, artifact);
      const transcriptPath = projectPathFor(candidate.header.cwd, projectPathContext, artifact);
      if (!state || row.local_execution !== 1 || physicalIdentities.get(candidate.header.id) !== 1
        || row.session_id !== candidate.header.id || databasePath?.status !== 'valid'
        || transcriptPath.status !== 'valid' || databasePath.key !== transcriptPath.key) {
        onDiagnostic?.({ code: 'QODER_DESKTOP_TITLE_UNVERIFIED', path: candidate.sourceFile,
          message: 'Desktop title lacks a unique matching local transcript or resolved title state; the JSONL title is retained.' });
        continue;
      }
      const value = { sessionId: candidate.header.id, cwd: candidate.header.cwd, title: row.title.trim(), ...state };
      if (validTitle(value, candidate.header.id, candidate.header.cwd)) titles.set(candidate.sourceFile, value);
    }
    db.exec('ROLLBACK');
    return titles;
  } catch (error) {
    signal?.throwIfAborted();
    onDiagnostic?.({ code: 'QODER_DESKTOP_TITLES_UNAVAILABLE', path: filename,
      message: 'Optional desktop titles could not be captured (missing, busy, unsupported or over budget); JSONL sessions remain readable.' });
    return new Map();
  } finally {
    try { db?.close(); } finally { await snapshot?.dispose(); }
  }
}

function titleDependency(value) {
  const text = JSON.stringify(value);
  return { role: 'desktop_session_title', pathIdentity: 'qoder-desktop:chat_sessions', existence: 'present', kind: 'file',
    policy: 'copied_value', acceptedBytes: Buffer.byteLength(text), lineCount: 0, digest: hash(text),
    directoryEntries: [], evidence: { title: value } };
}

module.exports = { readDesktopTitles, titleState, validTitle, titleDependency };
