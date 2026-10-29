'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const storage = require('../src/opencode-storage');
const { createOpenCodeFixture, sessionRow, messageRow, insertSession, insertMessage, TIME } = require('./helpers/opencode-fixture');

async function fixture(t, overrides = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sa-opencode-storage-'));
  const result = createOpenCodeFixture({ dbPath: path.join(root, 'source', 'opencode.db'), repoRoot: path.join(root, 'project'), ...overrides });
  t.after(async () => { result.close(); await fsp.rm(root, { recursive: true, force: true }); });
  return { ...result, root, options: { sourceHome: result.dbPath, repoRoot: result.repoRoot, snapshotBase: path.join(root, 'snapshots') } };
}
async function capture(t, input, options = {}) {
  const value = await storage.captureOpenCodeProject({ ...input.options, ...options });
  t.after(() => value.dispose());
  return value;
}
async function assertEmptyCandidates(base) {
  assert.deepEqual((await fsp.readdir(base)).filter(name => name.startsWith('capture-')), []);
}

test('captures persisted raw SQL rows without OpenCode and preserves all incomplete message states', async t => {
  const f = await fixture(t);
  const pending = messageRow({ id: 'msg_incomplete', type: 'assistant', seq: 4,
    data: JSON.stringify({ time: { created: TIME + 2000 }, content: [{ type: 'text', text: 'not completed' }] }) });
  insertMessage(f.db, pending);
  const before = storage.hash(fs.readFileSync(f.dbPath));
  const beforeWal = storage.hash(fs.readFileSync(f.dbPath + '-wal'));
  const cap = await capture(t, f);
  const snapshot = await storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions[0]);
  assert.equal(snapshot.source.schemaProfile, 'opencode-2.1.4');
  assert.equal(snapshot.session.id, f.sessionId);
  assert.deepEqual(snapshot.messages.map(row => [row.id, row.seq]), [
    ['msg_fixture_user', 1], ['msg_fixture_assistant', 2], ['msg_fixture_idle', 3], ['msg_incomplete', 4],
  ]);
  assert.equal(snapshot.messages[3].data, pending.data);
  assert.equal(snapshot.project.metadata.worktree, f.repoRoot);
  assert.equal(before, storage.hash(fs.readFileSync(f.dbPath)));
  assert.equal(beforeWal, storage.hash(fs.readFileSync(f.dbPath + '-wal')));
  assert.equal(cap.manifest.members.length, 1);
  assert.equal(cap.sessions[0].messageCount, 4);
});

test('discovery accepts directory or explicit database and groups real project/worktree membership', async t => {
  const f = await fixture(t);
  insertSession(f.db, { id: 'ses_child', parent_id: f.sessionId, directory: path.join(f.root, 'alternate-worktree') });
  f.db.prepare('INSERT INTO worktree(project_id,directory,strategy,time_created) VALUES(?,?,?,?)')
    .run('project_fixture', path.join(f.root, 'alternate-worktree'), 'git', TIME);
  const projects = await storage.discoverOpenCodeProjects({ sourceHome: path.dirname(f.dbPath) });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].repoRoot, f.repoRoot);
  assert.equal(projects[0].sessionCount, 2);
  assert.equal(projects[0].exists, true);
  assert.equal(await storage.resolveOpenCodeDatabase(f.dbPath), f.dbPath);
});

test('one read transaction captures members and messages across a concurrent WAL commit', async t => {
  const f = await fixture(t);
  const cap = await capture(t, f, { afterReadView() {
    f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'new concurrent text', time: { created: TIME } }), 'msg_fixture_user');
    insertSession(f.db, { id: 'ses_later', directory: f.repoRoot });
  } });
  const old = await storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions[0]);
  assert.equal(JSON.parse(old.messages[0].data).text, 'OpenCode fixture question');
  assert.deepEqual(cap.manifest.members.map(s => s.id), [f.sessionId]);
  const next = await capture(t, f);
  assert.equal(next.sessions.length, 2);
  const changed = await storage.readOpenCodeSnapshot(next.snapshotRoot, next.sessions.find(s => s.sessionId === f.sessionId));
  assert.equal(JSON.parse(changed.messages[0].data).text, 'new concurrent text');
});

test('same-ID edits, metadata changes and deletions produce new captures without rewriting old snapshots', async t => {
  const f = await fixture(t);
  const first = await capture(t, f); const original = await storage.readOpenCodeSnapshot(first.snapshotRoot, first.sessions[0]);
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'edited', time: { created: TIME } }), 'msg_fixture_user');
  f.db.prepare('UPDATE session_v2 SET title=? WHERE id=?').run('new title without updated watermark', f.sessionId);
  f.db.prepare('DELETE FROM session_message WHERE id=?').run('msg_fixture_idle');
  const second = await capture(t, f);
  assert.notEqual(second.sessions[0].snapshotId, first.sessions[0].snapshotId);
  const current = await storage.readOpenCodeSnapshot(second.snapshotRoot, second.sessions[0]);
  assert.equal(current.session.time_updated, original.session.time_updated);
  assert.equal(current.session.title, 'new title without updated watermark');
  assert.equal(current.messages.length, 2);
  assert.deepEqual(await storage.readOpenCodeSnapshot(first.snapshotRoot, first.sessions[0]), original);
  f.db.prepare('DELETE FROM session_message').run(); f.db.prepare('DELETE FROM session_v2').run();
  const third = await capture(t, f);
  assert.equal(third.sessions.length, 0);
  assert.deepEqual(await storage.readOpenCodeSnapshot(first.snapshotRoot, first.sessions[0]), original);
});

test('project metadata and bounded parent/fork/child facts are in snapshot identity', async t => {
  const f = await fixture(t);
  insertSession(f.db, { id: 'ses_child', directory: f.repoRoot, parent_id: f.sessionId });
  insertSession(f.db, { id: 'ses_fork', directory: f.repoRoot, fork_session_id: 'missing-parent', fork_boundary: '{"messageID":"old"}' });
  const cap = await capture(t, f);
  const rootMeta = cap.sessions.find(s => s.sessionId === f.sessionId);
  const root = await storage.readOpenCodeSnapshot(cap.snapshotRoot, rootMeta);
  assert.deepEqual(root.relations.childIDs, ['ses_child']);
  const fork = await storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions.find(s => s.sessionId === 'ses_fork'));
  assert.deepEqual(fork.relations.fork, { id: 'missing-parent', exists: false, inProject: false });
  f.db.prepare('UPDATE project SET name=? WHERE id=?').run('renamed project', 'project_fixture');
  const next = await capture(t, f);
  assert.notEqual(next.sessions.find(s => s.sessionId === f.sessionId).snapshotId, rootMeta.snapshotId);
});

test('unrelated sibling changes do not invalidate an unchanged session input snapshot', async t => {
  const f = await fixture(t); const first = await capture(t, f);
  insertSession(f.db, { id: 'ses_sibling', directory: f.repoRoot });
  const second = await capture(t, f);
  assert.notEqual(first.manifestDigest, second.manifestDigest);
  assert.equal(first.sessions[0].snapshotId, second.sessions.find(s => s.sessionId === f.sessionId).snapshotId);
});

test('file tampering, deletion and identity mismatch fail instead of returning live content', async t => {
  const f = await fixture(t); const cap = await capture(t, f); const meta = cap.sessions[0];
  const file = path.join(cap.snapshotRoot, meta.fileName);
  await assert.rejects(storage.readOpenCodeSnapshot(cap.snapshotRoot, { ...meta, snapshotId: 'relabelled' }), { code: 'INDEXED_SOURCE_STALE' });
  await fsp.chmod(file, 0o600); const text = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, text.replace('OpenCode fixture question', 'OpenCode fixture changed!'));
  await assert.rejects(storage.readOpenCodeSnapshot(cap.snapshotRoot, meta), { code: 'INDEXED_SOURCE_STALE' });
  await fsp.unlink(file);
  await assert.rejects(storage.readOpenCodeSnapshot(cap.snapshotRoot, meta), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(storage.readOpenCodeSnapshot(cap.snapshotRoot, { ...meta, fileName: '../source/opencode.db' }), { code: 'INDEXED_SOURCE_STALE' });
});

test('database replacement changes source identity even for identical rows', async t => {
  const f = await fixture(t); const first = await capture(t, f);
  f.close();
  await fsp.rename(f.dbPath, f.dbPath + '.old');
  const replacement = createOpenCodeFixture({ dbPath: f.dbPath, repoRoot: f.repoRoot });
  try {
    const second = await capture(t, f);
    assert.notEqual(first.source.identity, second.source.identity);
    assert.notEqual(first.sessions[0].snapshotId, second.sessions[0].snapshotId);
  } finally { replacement.close(); }
});

test('unknown or incomplete schemas are diagnosed and leave no candidate snapshot', async t => {
  const f = await fixture(t);
  f.db.exec('ALTER TABLE session_message ADD COLUMN unexpected TEXT');
  await assert.rejects(storage.captureOpenCodeProject(f.options), { code: 'OPENCODE_SCHEMA_UNSUPPORTED' });
  await assertEmptyCandidates(f.options.snapshotBase);
});

test('development blob schema is not silently treated as the pinned stable layout', async t => {
  const f = await fixture(t); f.db.exec('CREATE TABLE blob (id TEXT)');
  await assert.rejects(storage.captureOpenCodeProject(f.options), { code: 'OPENCODE_SCHEMA_UNSUPPORTED' });
});

for (const [name, prepare, limits] of [
  ['field bytes', f => f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'x'.repeat(2000) }), 'msg_fixture_user'), { maxFieldBytes: 1000 }],
  ['JSON depth', f => f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run('['.repeat(20) + '0' + ']'.repeat(20), 'msg_fixture_user'), { maxDepth: 10 }],
  ['session bytes', () => {}, { maxSessionBytes: 200 }],
  ['total bytes', () => {}, { maxTotalBytes: 100 }],
  ['message count', () => {}, { maxMessages: 2 }],
  ['session count', f => insertSession(f.db, { id: 'ses_extra', directory: f.repoRoot }), { maxSessions: 1 }],
  ['catalog count', f => insertSession(f.db, { id: 'ses_extra', directory: f.repoRoot }), { maxCatalogSessions: 1 }],
]) test(`budget failure for ${name} never returns a partial capture`, async t => {
  const f = await fixture(t); prepare(f);
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, limits }), { code: 'OPENCODE_CAPTURE_LIMIT' });
  await assertEmptyCandidates(f.options.snapshotBase);
});

test('capture timeout and cancellation release candidate files and database transaction', async t => {
  const f = await fixture(t);
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, limits: { maxCaptureMs: 10 },
    afterReadView: () => new Promise(resolve => setTimeout(resolve, 20)) }), { code: 'OPENCODE_CAPTURE_LIMIT' });
  await assertEmptyCandidates(f.options.snapshotBase);
  const controller = new AbortController();
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, signal: controller.signal, afterReadView() { controller.abort(); } }), { code: 'ABORT_ERR' });
  await assertEmptyCandidates(f.options.snapshotBase);
  assert.equal(f.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy, 0);
});

test('malformed JSON produces a data diagnostic and no partial revision', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run('{invalid', 'msg_fixture_user');
  await assert.rejects(storage.captureOpenCodeProject(f.options), { code: 'OPENCODE_DATA_INVALID' });
  await assertEmptyCandidates(f.options.snapshotBase);
});

test('missing default database is explicit, while an existing database with no WAL is valid', async t => {
  const f = await fixture(t, { journalMode: 'DELETE' });
  assert.equal(fs.existsSync(f.dbPath + '-wal'), false);
  const cap = await capture(t, f); assert.equal(cap.sessions[0].messageCount, 3);
  const diagnostic = [];
  await assert.rejects(storage.discoverOpenCodeProjects({ sourceHome: path.join(f.root, 'missing'), onDiagnostic: v => diagnostic.push(v) }), { code: 'OPENCODE_DATABASE_NOT_FOUND' });
  assert.equal(diagnostic[0].code, 'OPENCODE_DATABASE_NOT_FOUND');
});

test('invalid WAL header is diagnosed without attempting main-file-only recovery', async t => {
  const f = await fixture(t, { journalMode: 'DELETE' });
  await fsp.writeFile(f.dbPath + '-wal', Buffer.alloc(64, 42));
  await assert.rejects(storage.captureOpenCodeProject(f.options), { code: 'OPENCODE_DATABASE_INVALID' });
  await assertEmptyCandidates(f.options.snapshotBase);
});

for (const location of ['header', 'frame', 'salt']) test(`a damaged WAL ${location} never silently returns older checkpointed rows`, async t => {
  const f = await fixture(t);
  f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'new committed text' }), 'msg_fixture_user');
  // The writer is quiescent. This isolated damaged copy deliberately omits SHM
  // so SQLite recovery would otherwise ignore corruption and read the old main.
  const copy = path.join(f.root, 'damaged.db');
  await fsp.copyFile(f.dbPath, copy);
  const wal = await fsp.readFile(f.dbPath + '-wal');
  wal[location === 'header' ? 18 : location === 'salt' ? 32 + 8 : wal.length - 10] ^= 1;
  await fsp.writeFile(copy + '-wal', wal);
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, sourceHome: copy }), { code: 'OPENCODE_DATABASE_INVALID' });
  await assertEmptyCandidates(f.options.snapshotBase);
});

test('salt corruption after a valid commit is not mistaken for an old allocated tail', async t => {
  const f = await fixture(t); f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (const text of ['first committed text', 'second committed text']) {
    f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text }), 'msg_fixture_user');
  }
  const copy = path.join(f.root, 'damaged-salt.db'); await fsp.copyFile(f.dbPath, copy);
  const wal = await fsp.readFile(f.dbPath + '-wal'); const frameBytes = wal.readUInt32BE(8) + 24;
  assert.ok(wal.length >= 32 + 2 * frameBytes);
  wal[wal.length - frameBytes + 8] ^= 1;
  await fsp.writeFile(copy + '-wal', wal);
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, sourceHome: copy }), { code: 'OPENCODE_DATABASE_INVALID' });
});

test('rolled-back same-cycle spill frames do not invalidate a later healthy commit', async t => {
  const f = await fixture(t); f.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA cache_size=5; BEGIN');
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'uncommitted ' + 'x'.repeat(200000) }), 'msg_fixture_user');
  f.db.exec('ROLLBACK');
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'new committed short' }), 'msg_fixture_user');
  for (const sourceHome of [f.dbPath, path.join(f.root, 'rollback-copy.db')]) {
    if (sourceHome !== f.dbPath) {
      await fsp.copyFile(f.dbPath, sourceHome); await fsp.copyFile(f.dbPath + '-wal', sourceHome + '-wal');
    }
    const cap = await capture(t, f, { sourceHome });
    const snapshot = await storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions[0]);
    assert.equal(JSON.parse(snapshot.messages[0].data).text, 'new committed short');
  }
});

for (const mode of ['TRUNCATE', 'RESTART']) for (const recover of [false, true]) {
  test(`${mode} checkpoint followed only by rollback remains readable (${recover ? 'recover without SHM' : 'live connection'})`, async t => {
    const f = await fixture(t, { userText: 'durable' });
    const update = f.db.prepare('UPDATE session_message SET data=? WHERE id=?');
    if (mode === 'RESTART') {
      // Retain an older allocation with commit markers beyond the next spill.
      update.run(JSON.stringify({ text: 'x'.repeat(1000000) }), f.messageId);
      update.run(JSON.stringify({ text: 'durable' }), f.messageId);
    }
    assert.equal(f.db.prepare(`PRAGMA wal_checkpoint(${mode})`).get().busy, 0);
    f.db.exec('PRAGMA cache_size=5');
    // Different bytes and lengths make the shorter second spill overwrite only
    // a prefix of the first, leaving a same-cycle checksum discontinuity.
    for (const [size, character] of mode === 'TRUNCATE' ? [[200000, 'a'], [100000, 'b']] : [[100000, 'b']]) {
      f.db.exec('BEGIN');
      update.run(JSON.stringify({ text: character.repeat(size) }), f.messageId);
      f.db.exec('ROLLBACK');
    }
    assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(JSON.parse(f.db.prepare('SELECT data FROM session_message WHERE id=?').get(f.messageId).data).text, 'durable');
    const wal = await fsp.readFile(f.dbPath + '-wal'); const stride = 24 + wal.readUInt32BE(8);
    let currentFrames = 0; let olderCommits = 0;
    for (let offset = 32; offset + stride <= wal.length; offset += stride) {
      if (wal.subarray(offset + 8, offset + 16).equals(wal.subarray(16, 24))) {
        currentFrames++; assert.equal(wal.readUInt32BE(offset + 4), 0, 'no new commit after checkpoint');
      } else if (wal.readUInt32BE(offset + 4)) olderCommits++;
    }
    assert.ok(currentFrames > 1, 'real SQLite cache spill occurred');
    if (mode === 'RESTART') assert.ok(olderCommits > 0, 'old-cycle committed allocation remains');
    const sourceHome = recover ? path.join(f.root, 'rollback-only.db') : f.dbPath;
    if (recover) {
      await fsp.copyFile(f.dbPath, sourceHome); await fsp.copyFile(f.dbPath + '-wal', sourceHome + '-wal');
      assert.equal(fs.existsSync(sourceHome + '-shm'), false);
    }
    const before = storage.hash(await fsp.readFile(sourceHome)); const beforeWal = storage.hash(wal);
    const projects = await storage.discoverOpenCodeProjects({ sourceHome });
    assert.equal(projects.length, 1); assert.equal(projects[0].repoRoot, f.repoRoot); assert.equal(projects[0].sessionCount, 1);
    const cap = await capture(t, f, { sourceHome });
    const snapshot = await storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions[0]);
    assert.equal(snapshot.messages.length, 3); assert.equal(JSON.parse(snapshot.messages[0].data).text, 'durable');
    assert.equal(storage.hash(await fsp.readFile(sourceHome)), before);
    assert.equal(storage.hash(await fsp.readFile(sourceHome + '-wal')), beforeWal);
  });
}

for (const damage of ['checksum', 'salt']) test(`rollback-only WAL still requires a verified current-cycle prefix (${damage})`, async t => {
  const f = await fixture(t, { userText: 'durable' });
  f.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA cache_size=5; BEGIN');
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'x'.repeat(200000) }), f.messageId);
  f.db.exec('ROLLBACK');
  const copy = path.join(f.root, 'damaged-rollback.db'); await fsp.copyFile(f.dbPath, copy);
  const wal = await fsp.readFile(f.dbPath + '-wal');
  wal[damage === 'salt' ? 32 + 8 : 32 + 24 + 2] ^= 1;
  await fsp.writeFile(copy + '-wal', wal);
  await assert.rejects(storage.discoverOpenCodeProjects({ sourceHome: copy }), { code: 'OPENCODE_DATABASE_INVALID' });
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, sourceHome: copy }), { code: 'OPENCODE_DATABASE_INVALID' });
  await assertEmptyCandidates(f.options.snapshotBase);
});

for (const priorCommit of [false, true]) test(`corrupt uncommitted-looking frames cannot hide a following commit marker (prior commit: ${priorCommit})`, async t => {
  const f = await fixture(t); f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  if (priorCommit) f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'first commit' }), 'msg_fixture_user');
  const firstBytes = priorCommit ? (await fsp.stat(f.dbPath + '-wal')).size : 32;
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'second commit ' + 'x'.repeat(200000) }), 'msg_fixture_user');
  const copy = path.join(f.root, 'damaged-prefix.db'); await fsp.copyFile(f.dbPath, copy);
  const wal = await fsp.readFile(f.dbPath + '-wal');
  // With no prior commit, keep the first frame valid so rejection must inspect
  // the suffix after a damaged frame rather than only require a valid prefix.
  const damagedOffset = priorCommit ? firstBytes : firstBytes + wal.readUInt32BE(8) + 24;
  assert.equal(wal.readUInt32BE(damagedOffset + 4), 0, 'the corrupted frame precedes a commit marker');
  wal[damagedOffset + 30] ^= 1; await fsp.writeFile(copy + '-wal', wal);
  await assert.rejects(storage.discoverOpenCodeProjects({ sourceHome: copy }), { code: 'OPENCODE_DATABASE_INVALID' });
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, sourceHome: copy }), { code: 'OPENCODE_DATABASE_INVALID' });
});

test('WAL validation permits stale allocated frames after a normal restart', async t => {
  const f = await fixture(t);
  const previousBytes = (await fsp.stat(f.dbPath + '-wal')).size;
  f.db.exec('PRAGMA wal_checkpoint(RESTART)');
  f.db.prepare('UPDATE session_message SET data=? WHERE id=?').run(JSON.stringify({ text: 'valid restarted WAL' }), 'msg_fixture_user');
  assert.equal((await fsp.stat(f.dbPath + '-wal')).size, previousBytes, 'restart retains the old allocated tail');
  const cap = await capture(t, f);
  const row = await storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions[0]);
  assert.equal(JSON.parse(row.messages[0].data).text, 'valid restarted WAL');
});

test('WAL validation budget fails before publication and releases its candidate', async t => {
  const f = await fixture(t);
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, limits: { maxWalBytes: 32 } }), error => {
    assert.equal(error.code, 'OPENCODE_CAPTURE_LIMIT');
    assert.match(error.message, /maxWalBytes/); return true;
  });
  await assertEmptyCandidates(f.options.snapshotBase);
});

test('inaccessible WAL is a permission failure, not a main-file-only fallback', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const f = await fixture(t); const wal = f.dbPath + '-wal';
  await fsp.chmod(wal, 0o000);
  try {
    await assert.rejects(fsp.access(wal, fs.constants.R_OK), { code: 'EACCES' });
    await assert.rejects(storage.captureOpenCodeProject(f.options), { code: 'OPENCODE_PERMISSION_DENIED' });
    await assertEmptyCandidates(f.options.snapshotBase);
  } finally { await fsp.chmod(wal, 0o600); }
});

test('lost uncheckpointed WAL is not accepted as a successful empty database', async t => {
  const f = await fixture(t);
  const copy = path.join(f.root, 'without-wal.db');
  await fsp.copyFile(f.dbPath, copy);
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, sourceHome: copy }), { code: 'OPENCODE_SCHEMA_UNSUPPORTED' });
  await assertEmptyCandidates(f.options.snapshotBase);
  // After a complete checkpoint, an absent WAL is legitimate even though the
  // database header remains in WAL mode. Lost commits cannot always be inferred
  // from a main file alone, so the reader makes no historical-loss guarantee.
  f.close();
  assert.equal(fs.existsSync(f.dbPath + '-wal'), false);
  const cap = await capture(t, f); assert.equal(cap.sessions[0].messageCount, 3);
});

test('missing node:sqlite is diagnosed lazily without preventing other sources from loading', async t => {
  const f = await fixture(t);
  const script = `const Module=require('node:module');const original=Module._load;Module._load=function(id,...args){if(id==='node:sqlite')throw Object.assign(new Error('disabled synthetic capability'),{code:'ERR_UNKNOWN_BUILTIN_MODULE'});return original.call(this,id,...args)};const adapters=require(${JSON.stringify(path.resolve(__dirname, '../src/source-adapters'))});const storage=require(${JSON.stringify(path.resolve(__dirname, '../src/opencode-storage'))});storage.captureOpenCodeProject(${JSON.stringify(f.options)}).then(()=>{process.exitCode=1},e=>{process.stdout.write(e.code)});`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OPENCODE_SQLITE_UNAVAILABLE');
  await assertEmptyCandidates(f.options.snapshotBase);
});

test('active snapshot quota rejects a replacement without deleting still-owned evidence', async t => {
  const f = await fixture(t); const first = await capture(t, f);
  const names = await fsp.readdir(first.snapshotRoot);
  const size = (await Promise.all(names.map(name => fsp.stat(path.join(first.snapshotRoot, name))))).reduce((total, stat) => total + stat.size, 0);
  const limits = { maxStoredBytes: size + 64 };
  await assert.rejects(storage.captureOpenCodeProject({ ...f.options, limits }), error => {
    assert.equal(error.code, 'OPENCODE_CAPTURE_LIMIT'); assert.match(error.message, /maxStoredBytes/); return true;
  });
  assert.equal((await storage.readOpenCodeSnapshot(first.snapshotRoot, first.sessions[0])).messages.length, 3);
  assert.deepEqual((await fsp.readdir(f.options.snapshotBase)).filter(name => name.startsWith('capture-')), [path.basename(first.snapshotRoot)]);
  await first.dispose();
  const replacement = await capture(t, f, { limits });
  assert.equal(replacement.sessions[0].messageCount, 3, 'disposal and failed staging both release quota');
});

for (const [column, value] of [['cost', 'x'.repeat(2000)], ['cost', Buffer.alloc(2 * 1024 * 1024)], ['time_updated', 'invalid timestamp']]) {
  test(`non-STRICT ${column} data of type ${typeof value} is rejected before materializing an unbounded field`, async t => {
    const f = await fixture(t);
    f.db.prepare(`UPDATE session_v2 SET ${column}=? WHERE id=?`).run(value, f.sessionId);
    await assert.rejects(storage.captureOpenCodeProject({ ...f.options, limits: { maxFieldBytes: 1000 } }), { code: 'OPENCODE_DATA_INVALID' });
    await assertEmptyCandidates(f.options.snapshotBase);
  });
}

test('failed staging cleanup retries and preserves an owner until a later capture succeeds', async t => {
  const f = await fixture(t); const remove = fsp.rm; let attempts = 0;
  fsp.rm = async (target, options) => {
    if (String(target).startsWith(f.options.snapshotBase + path.sep + 'capture-')) {
      attempts++; throw Object.assign(new Error('synthetic transient filesystem denial'), { code: 'EPERM' });
    }
    return remove(target, options);
  };
  try { await assert.rejects(storage.captureOpenCodeProject({ ...f.options, limits: { maxMessages: 1 } }), { code: 'OPENCODE_CAPTURE_LIMIT' }); }
  finally { fsp.rm = remove; }
  assert.equal(attempts, 3);
  const residual = (await fsp.readdir(f.options.snapshotBase)).filter(name => name.startsWith('capture-'));
  assert.equal(residual.length, 1);
  const cap = await capture(t, f);
  assert.equal(fs.existsSync(path.join(f.options.snapshotBase, residual[0])), false, 'next capture retries the retained failed owner');
  assert.equal(cap.sessions[0].messageCount, 3);
});

test('persistent async staging cleanup failure retains a synchronous process-exit owner', async t => {
  const f = await fixture(t);
  const script = `const fs=require('node:fs/promises');const remove=fs.rm;fs.rm=async function(target,...args){if(String(target).includes('capture-'))throw Object.assign(new Error('synthetic denial'),{code:'EPERM'});return remove.call(this,target,...args)};const s=require(${JSON.stringify(path.resolve(__dirname, '../src/opencode-storage'))});s.captureOpenCodeProject(${JSON.stringify({ ...f.options, limits: { maxMessages: 1 } })}).then(()=>{process.exitCode=1},e=>process.stdout.write(e.code));`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OPENCODE_CAPTURE_LIMIT');
  assert.match(result.stderr, /OPENCODE_SNAPSHOT_CLEANUP_FAILED/);
  await assertEmptyCandidates(f.options.snapshotBase);
});

test('upstream slash-normalized UNC projects retain Windows identity', async t => {
  const f = await fixture(t); const unc = '//example-server/share/project';
  f.db.prepare('UPDATE project SET worktree=?').run(unc);
  f.db.prepare('UPDATE session_v2 SET directory=?').run(unc);
  const projects = await storage.discoverOpenCodeProjects({ sourceHome: f.dbPath });
  if (process.platform === 'win32') {
    assert.equal(projects[0].repoRoot, path.win32.resolve(unc));
    const cap = await capture(t, f, { repoRoot: unc }); assert.equal(cap.sessions.length, 1);
  } else {
    assert.deepEqual(projects, []);
    await assert.rejects(storage.captureOpenCodeProject({ ...f.options, repoRoot: unc }), { code: 'OPENCODE_PROJECT_INVALID' });
  }
});

test('writer lock reports busy and can be retried after transaction release', async t => {
  const f = await fixture(t, { journalMode: 'DELETE' }); f.db.exec('BEGIN EXCLUSIVE');
  try { await assert.rejects(storage.captureOpenCodeProject(f.options), { code: 'OPENCODE_DATABASE_BUSY' }); }
  finally { f.db.exec('ROLLBACK'); }
  const cap = await capture(t, f); assert.equal(cap.sessions.length, 1);
});

test('normal dispose is idempotent and snapshot reads reject removed files', async t => {
  const f = await fixture(t); const cap = await capture(t, f);
  await Promise.all([cap.dispose(), cap.dispose()]); cap.disposeSync();
  assert.equal(fs.existsSync(cap.snapshotRoot), false);
  await assert.rejects(storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions[0]), { code: 'INDEXED_SOURCE_STALE' });
});

test('residue sweep conservatively preserves active, unmarked and recent directories', async t => {
  const f = await fixture(t); const cap = await capture(t, f);
  const unmarked = path.join(f.options.snapshotBase, 'capture-unmarked'); await fsp.mkdir(unmarked);
  const recent = path.join(f.options.snapshotBase, 'capture-recent'); await fsp.mkdir(recent);
  await fsp.writeFile(path.join(recent, 'owner.json'), JSON.stringify({ kind: 'session-analyzer-opencode-snapshot', version: 1, pid: process.pid, token: '0'.repeat(32), createdAt: Date.now() }));
  await storage.sweepOpenCodeSnapshots(f.options.snapshotBase);
  assert.equal(fs.existsSync(cap.snapshotRoot), true); assert.equal(fs.existsSync(unmarked), true); assert.equal(fs.existsSync(recent), true);
});

test('source directory and SHM permission matrix uses effective permissions, not root chmod assumptions', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const source = path.dirname(f.dbPath);
  // The fixture writer remains open; copy a controlled, quiescent main+WAL+SHM
  // set for each independent permission scenario. Never do this to a user DB.
  const main = await fsp.readFile(f.dbPath), wal = await fsp.readFile(f.dbPath + '-wal'), shm = await fsp.readFile(f.dbPath + '-shm');
  await fsp.chmod(f.root, 0o755);
  for (const writable of [false, true]) for (const hasShm of [false, true]) {
    const dir = path.join(f.root, `permissions-${writable}-${hasShm}`); await fsp.mkdir(dir, { mode: 0o777 });
    const dbPath = path.join(dir, 'opencode.db'); await fsp.writeFile(dbPath, main, { mode: 0o444 });
    await fsp.writeFile(dbPath + '-wal', wal, { mode: 0o444 });
    if (hasShm) await fsp.writeFile(dbPath + '-shm', shm, { mode: 0o444 });
    await fsp.chmod(dir, writable ? 0o777 : 0o555);
    const out = path.join(f.root, `output-${writable}-${hasShm}`); await fsp.mkdir(out, { mode: 0o777 }); await fsp.chmod(out, 0o777);
    const script = `const fs=require('node:fs');const s=require(${JSON.stringify(path.resolve(__dirname, '../src/opencode-storage'))});(async()=>{let writable;try{fs.accessSync(${JSON.stringify(dir)},fs.constants.W_OK);writable=true}catch{writable=false}try{const c=await s.captureOpenCodeProject({sourceHome:${JSON.stringify(dbPath)},repoRoot:${JSON.stringify(f.repoRoot)},snapshotBase:${JSON.stringify(out)}});const r=await s.readOpenCodeSnapshot(c.snapshotRoot,c.sessions[0]);await c.dispose();process.stdout.write(JSON.stringify({writable,count:r.messages.length}))}catch(e){process.stdout.write(JSON.stringify({writable,code:e.code}))}})();`;
    let result;
    if (process.getuid?.() === 0) {
      const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', uid: 65534, gid: 65534 });
      assert.ifError(run.error); assert.equal(run.status, 0, run.stderr); result = JSON.parse(run.stdout);
    } else {
      let canWrite;
      try { await fsp.access(dir, fs.constants.W_OK); canWrite = true; } catch { canWrite = false; }
      try {
        const cap = await storage.captureOpenCodeProject({ sourceHome: dbPath, repoRoot: f.repoRoot, snapshotBase: out });
        try { result = { writable: canWrite, count: (await storage.readOpenCodeSnapshot(cap.snapshotRoot, cap.sessions[0])).messages.length }; }
        finally { await cap.dispose(); }
      } catch (error) { result = { writable: canWrite, code: error.code }; }
    }
    assert.equal(result.writable, writable, 'permission setup must actually be enforced');
    if (result.count !== undefined) assert.equal(result.count, 3);
    else assert.ok(['OPENCODE_PERMISSION_DENIED', 'OPENCODE_SOURCE_UNREADABLE', 'OPENCODE_SOURCE_UNSUPPORTED'].includes(result.code), JSON.stringify(result));
    await fsp.chmod(dir, 0o755);
  }
  assert.equal(source, path.dirname(f.dbPath));
});
