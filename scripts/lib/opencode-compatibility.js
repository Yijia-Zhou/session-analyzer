'use strict';

// Maintenance-only evidence helpers. Never imported by the product reader.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const BASELINE = Object.freeze({ version: '2.1.4', commit: '68bc26b7da1990ce10ffecfbc1e09eb13aa5d824' });
const SOURCE_FILES = Object.freeze([
  'packages/core/src/session/sql.ts', 'packages/core/src/session/projector.ts',
  'packages/core/src/session/transfer.ts', 'packages/core/src/project/sql.ts',
  'packages/schema/src/session-message.ts', 'packages/schema/src/session.ts',
  'packages/schema/src/session-event.ts', 'packages/protocol/src/groups/session.ts',
  'packages/protocol/src/groups/message.ts', 'packages/cli/src/server-process.ts',
  'packages/cli/src/database-path.ts', 'packages/util/src/global.ts',
]);
const GAPS = Object.freeze(['model-generated assistant/tool lifecycle', 'interruption/retry/compaction writer paths',
  'all client entry points', 'Windows/macOS producer execution', 'upgrade of an existing user database',
  'WAL corruption/permission/resource-budget matrix (covered separately by offline reader tests)']);
const CHECKS = Object.freeze(['session-create', 'database-layout', 'live-shell-start', 'running-api-sql-snapshot',
  'export-omits-running-shell', 'same-message-completion-and-old-snapshot', 'metadata-update',
  'import-settled-messages', 'parent-and-fork-relations', 'delete-and-held-snapshot']);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const digest = value => hash(JSON.stringify(stable(value)));
function runtimeDigest(root) {
  // Bind uncommitted reader changes too; HEAD alone is not an input identity.
  const files = {};
  function visit(relative) {
    const target = path.join(root, relative); const stat = fs.lstatSync(target);
    assert.ok(!stat.isSymbolicLink(), 'runtime inputs must not be symlinks');
    if (stat.isDirectory()) for (const name of fs.readdirSync(target).sort()) visit(`${relative}/${name}`);
    else { assert.ok(stat.isFile(), 'runtime inputs must be regular files'); files[relative] = hash(fs.readFileSync(target)); }
  }
  for (const relative of ['src', 'package.json', 'package-lock.json']) visit(relative);
  return digest(files);
}
function version(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw Object.assign(new Error('Use an exact stable x.y.z version'), { code: 'INVALID_VERSION' });
  return value;
}
function sourceEvidence(checkout, requestedVersion) {
  version(requestedVersion);
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { timeout: 15000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = git('rev-parse', '--verify', `refs/tags/v${requestedVersion}^{commit}`).toString().trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  if (requestedVersion === BASELINE.version) assert.equal(commit, BASELINE.commit, 'accepted baseline tag must still resolve to the reviewed commit');
  const files = Object.fromEntries(SOURCE_FILES.map(file => {
    try { return [file, hash(git('show', `${commit}:${file}`))]; }
    catch (error) { if (error.status === 128) return [file, null]; throw error; }
  }));
  // Include the whole migration tree, not just one hand-picked migration.
  const migrations = git('ls-tree', '-r', commit, '--', 'packages/core/src/database/migration',
    'packages/core/src/database/migration.ts', 'packages/core/src/database/migration.gen.ts').toString().trim();
  return { version: requestedVersion, tag: `v${requestedVersion}`, commit, files, migrationTreeDigest: hash(migrations),
    binding: 'release tag and separately version-checked binary; not a reproducible-build attestation' };
}
function isolatedEnv(root, inherited = process.env) {
  // Do not inherit provider keys, auth/config overrides, NODE_OPTIONS or plugins.
  // Retain the managed network proxy and CA trust configuration.
  const allowed = ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE'];
  const env = Object.fromEntries(allowed.filter(key => inherited[key] !== undefined).map(key => [key, inherited[key]]));
  Object.assign(env, { XDG_DATA_HOME: path.join(root, 'data'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    TMPDIR: path.join(root, 'tmp'), OPENCODE_TEST_HOME: path.join(root, 'home'),
    OPENCODE_CONFIG_DIR: path.join(root, 'config', 'opencode'), OPENCODE_DB: path.join(root, 'data', 'opencode.db'),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FREE_MODELS: '1',
    OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1',
    OPENCODE_CONFIG_CONTENT: '{"provider":{},"plugin":[]}',
    OPENCODE_SERVER_PASSWORD: crypto.randomBytes(32).toString('hex'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C.UTF-8' });
  return env;
}
function inspectDatabase(dbPath, sessionID) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: false });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100; BEGIN');
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 201").all();
    assert.ok(tables.length <= 200, 'schema table limit');
    const schema = tables.map(({ name }) => {
      const columns = db.prepare('SELECT name,type,"notnull",dflt_value,pk FROM pragma_table_info(?) ORDER BY cid').all(name);
      const indexes = db.prepare('SELECT name,"unique",origin,partial FROM pragma_index_list(?) ORDER BY name').all(name)
        .map(index => ({ ...index, columns: db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(index.name).map(c => c.name) }));
      return { name, columns, indexes };
    });
    // The table layout is evidence even when a candidate cannot satisfy the reader.
    if (!tables.some(t => t.name === 'session_message') || !tables.some(t => t.name === 'session_v2')) return { schema, rows: null, session: null };
    const session = sessionID ? db.prepare('SELECT * FROM session_v2 WHERE id=?').get(sessionID) : null;
    const rows = sessionID ? db.prepare('SELECT * FROM session_message WHERE session_id=? ORDER BY seq LIMIT 101').all(sessionID) : [];
    assert.ok(rows.length <= 100, 'probe message limit');
    return { schema, session, rows };
  } finally { db.close(); }
}
function compareApiRows(api, rows) {
  assert.ok(Array.isArray(api) && Array.isArray(rows));
  assert.deepEqual(api, rows.map(row => ({ ...JSON.parse(row.data), id: row.id, type: row.type })), 'API/SQL message order and content');
}
async function readApiMessages(request, sessionID) {
  const messages = []; const seen = new Set(); let cursor;
  for (let page = 0; page < 10; page++) {
    const query = cursor ? `cursor=${encodeURIComponent(cursor)}` : 'order=asc';
    const result = await request(`/api/session/${encodeURIComponent(sessionID)}/message?${query}&limit=100`);
    assert.ok(Array.isArray(result.data), 'message response shape');
    messages.push(...result.data); assert.ok(messages.length <= 100, 'API message limit');
    if (!result.data.length || !result.cursor?.next) return messages;
    // 2.1.4 supplies a next cursor even for its last nonempty page.
    cursor = result.cursor.next; assert.ok(typeof cursor === 'string' && !seen.has(cursor), 'non-advancing API cursor'); seen.add(cursor);
  }
  throw new Error('API page limit');
}
function messageShapes(messages) {
  const shapes = new Set();
  function walk(value, at, depth) {
    assert.ok(depth < 32 && shapes.size < 5000, 'shape inventory limit');
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    shapes.add(`${at}:${type}`);
    if (Array.isArray(value)) value.forEach(v => walk(v, `${at}[]`, depth + 1));
    else if (value && typeof value === 'object') for (const key of Object.keys(value).sort()) walk(value[key], `${at}.${key}`, depth + 1);
  }
  for (const message of messages) walk(message, message.type, 0);
  return [...shapes].sort();
}
function compareReports(baseline, candidate) {
  assert.equal(baseline.format, 'session-analyzer-opencode-compatibility-v1');
  assert.equal(baseline.probeVersion, candidate.probeVersion);
  assert.equal(baseline.producer.version, BASELINE.version);
  assert.equal(baseline.producer.commit, BASELINE.commit);
  assert.equal(baseline.outcome, 'passed', 'comparison requires a successful accepted baseline');
  assert.equal(baseline.cleanup, 'completed', 'baseline cleanup must have completed');
  assert.ok(baseline.checks.every(c => c.status === 'passed'));
  assert.equal(baseline.analyzer.commit, candidate.analyzer.commit, 'compare using the same analyzer commit');
  assert.match(baseline.analyzer.runtimeDigest, /^[a-f0-9]{64}$/, 'baseline must bind actual runtime inputs');
  assert.equal(baseline.analyzer.runtimeDigest, candidate.analyzer.runtimeDigest, 'compare using the same analyzer runtime bytes');
  assert.equal(baseline.analyzer.node, candidate.analyzer.node, 'compare using the same Node version');
  assert.equal(baseline.analyzer.platform, candidate.analyzer.platform, 'compare on the same platform');
  assert.equal(baseline.probeDigest, candidate.probeDigest, 'compare using the same probe bytes');
  assert.deepEqual(baseline.checks.map(c => c.name), CHECKS);
  assert.deepEqual(baseline.checks.map(c => c.name), candidate.checks.map(c => c.name), 'check coverage must match');
  const sourceFiles = SOURCE_FILES.filter(file => baseline.producer.files[file] !== candidate.producer.files[file]);
  return { sourceFiles, migrationTreeChanged: baseline.producer.migrationTreeDigest !== candidate.producer.migrationTreeDigest,
    databaseSchemaChanged: digest(baseline.databaseSchema) !== digest(candidate.databaseSchema),
    // A stopped candidate has observed only a prefix of the scenarios. Missing
    // later message families are not evidence that their wire shapes changed.
    messageShapesChanged: candidate.checks.every(c => c.status === 'passed')
      ? digest(baseline.messageShapes) !== digest(candidate.messageShapes) : null,
    unrunChecks: candidate.checks.filter(c => c.status === 'not-run').map(c => c.name),
    failedChecks: candidate.checks.filter(c => c.status === 'failed').map(c => c.name) };
}
module.exports = { BASELINE, SOURCE_FILES, GAPS, CHECKS, hash, digest, runtimeDigest, version, sourceEvidence, isolatedEnv,
  inspectDatabase, compareApiRows, readApiMessages, messageShapes, compareReports };
