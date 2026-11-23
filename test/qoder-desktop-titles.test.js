'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync, StatementSync } = require('node:sqlite');
const { createServer } = require('../server');
const { runHistoryCli } = require('../src/history-cli');
const { buildQoderIndex, discoverQoderProjects, qoderAdapter } = require('../src/qoder');
const { titleState } = require('../src/qoder-desktop-titles');
const { copySqliteMetadataSnapshot } = require('../src/sqlite-metadata-snapshot');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore, projectQueryProjectionDigestAsync } = require('../src/project-query-store');

async function fixture(t, { title = 'Desktop title', extra = { titleSource: 'ai', titleResolved: true, titleRevision: 2 }, manual } = {}) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), 'qoder-titles-test-'));
  t.after(() => fs.rm(sourceHome, { recursive: true, force: true }));
  const repoRoot = path.join(sourceHome, 'repo');
  const sourceFile = 'container/session-a.jsonl';
  const file = path.join(sourceHome, 'projects', sourceFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const records = [{ type: 'user', uuid: 'u', cwd: repoRoot, sessionId: 'session-a', timestamp: '2026-11-13T00:00:00Z',
    message: { role: 'user', content: 'First user prompt' } }];
  if (manual) records.push({ type: 'custom-title', customTitle: manual });
  const text = records.map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(file, text);
  const qoderDesktopDb = path.join(sourceHome, 'desktop.sqlite');
  const db = new DatabaseSync(qoderDesktopDb);
  db.exec(`CREATE TABLE chat_sessions(session_id TEXT PRIMARY KEY, cwd TEXT, title TEXT, extra_json TEXT,
    conversation_mode TEXT DEFAULT 'normal', execution_kind TEXT DEFAULT 'local', deleted_at TEXT, session_kind TEXT DEFAULT 'standard')`);
  db.prepare('INSERT INTO chat_sessions(session_id,cwd,title,extra_json) VALUES(?,?,?,?)')
    .run('session-a', repoRoot, title, typeof extra === 'string' ? extra : JSON.stringify(extra));
  db.close();
  const update = (sql, ...args) => { const writer = new DatabaseSync(qoderDesktopDb); try { writer.prepare(sql).run(...args); } finally { writer.close(); } };
  const index = async (options = {}) => {
    const value = await buildQoderIndex({ sourceHome, repoRoot, qoderDesktopDb, ...options });
    t.after(() => disposeProjectQueryStore(value.projectQueryStore));
    await validateIndexOwnershipForCommit(value);
    return value;
  };
  return { sourceHome, repoRoot, sourceFile, file, text, qoderDesktopDb, update, index };
}

for (const source of ['ai', 'custom', 'fallback', 'legacy', 'absent']) {
  test(`Qoder admits resolved ${source} desktop titles and replays the same metadata`, async (t) => {
    const f = await fixture(t, { extra: source === 'absent' ? {} : { titleSource: source, titleResolved: true, titleRevision: 3 } });
    const index = await f.index();
    assert.equal(index.sourceDiagnostics.totalCount, 0);
    const indexed = index.sessions[0];
    assert.equal(indexed.title, 'Desktop title');
    const deps = index.materializationDependencies.get(indexed.materializationDescriptor.dependencySetId);
    assert.equal(deps.entries[1].evidence.title.source, source === 'absent' ? 'legacy' : source);
    const materialized = await materializeSessionForIndex(index, indexed);
    assert.equal(materialized.title, indexed.title);
    assert.equal(materialized.analysis.title, indexed.title);
    assert.equal(await projectQueryProjectionDigestAsync(materialized, qoderAdapter.query.projectQueryPresentation), indexed.queryProjectionDigest);
    assert.equal((await readIndexedRawRecord(index, materialized, materialized.rawEvents[0].rawId)).raw, f.text.trimEnd());
  });
}

test('JSONL manual titles outrank conflicting desktop custom and automatic titles', async (t) => {
  const f = await fixture(t, { manual: 'Explicit JSONL title' });
  for (const source of ['ai', 'custom']) {
    f.update('UPDATE chat_sessions SET extra_json = ?', JSON.stringify({ titleSource: source, titleResolved: true, titleRevision: 99 }));
    const index = await f.index();
    assert.equal(index.sessions[0].title, 'Explicit JSONL title');
    assert.equal((await materializeSessionForIndex(index, index.sessions[0])).title, 'Explicit JSONL title');
  }
});

for (const extra of [null, [], '{bad', { titleSource: 'future', titleResolved: true },
  { titleSource: 'ai', titleResolved: false }, { titleSource: 'provisional', titleResolved: true },
  { titleSource: 'custom' }, { titleSource: 'ai', titleResolved: true, titleRevision: -1 }]) {
  test(`unverified title state falls back: ${JSON.stringify(extra)}`, async (t) => {
    const f = await fixture(t, { extra });
    const index = await f.index();
    assert.equal(index.sessions[0].title, 'First user prompt');
    assert.equal(index.sourceDiagnostics.counts.QODER_DESKTOP_TITLE_UNVERIFIED, 1);
  });
}

test('voice placeholders, oversized titles and metadata are never treated as resolved legacy titles', async (t) => {
  for (const title of ['新语音会话', 'New voice chat', 'New voice session']) {
    assert.equal(titleState({ title, conversation_mode: 'voice', extra_json: '{}' }), null);
  }
  const f = await fixture(t, { title: 'x'.repeat(4097) });
  assert.equal((await f.index()).sessions[0].title, 'First user prompt');
  f.update('UPDATE chat_sessions SET title = ?, extra_json = ?', 'Good title', JSON.stringify({ otherMetadata: 'x'.repeat(65536) }));
  assert.equal((await f.index()).sessions[0].title, 'First user prompt');
});

test('resolved titles remain readable alongside bounded larger desktop metadata', async (t) => {
  const f = await fixture(t, { extra: { titleSource: 'ai', titleResolved: true,
    titleRevision: 2, otherMetadata: 'x'.repeat(60000) } });
  const index = await f.index();
  assert.equal(index.sessions[0].title, 'Desktop title');
  assert.equal(index.sourceDiagnostics.totalCount, 0);
});

test('embedded NUL cannot bypass SQLite return-size budgets', async (t) => {
  const f = await fixture(t);
  const oversized = 'x\0' + 'x'.repeat(2 * 1024 * 1024);
  f.update('UPDATE chat_sessions SET title = ?, cwd = ?, extra_json = ?, conversation_mode = ?',
    oversized, oversized, '{}\0' + oversized, oversized);
  const originalAll = StatementSync.prototype.all;
  let inspected = false;
  t.mock.method(StatementSync.prototype, 'all', function (...args) {
    const rows = originalAll.apply(this, args);
    if (rows.length && Object.hasOwn(rows[0], 'extra_json')) {
      inspected = true;
      for (const field of ['title', 'cwd', 'extra_json', 'conversation_mode']) assert.equal(rows[0][field], null);
    }
    return rows;
  });
  const index = await f.index();
  assert.equal(inspected, true);
  assert.equal(index.sessions[0].title, 'First user prompt');
  assert.equal(index.sourceDiagnostics.counts.QODER_DESKTOP_TITLE_UNVERIFIED, 1);
});

test('desktop updates and removal do not change an accepted index; reindex captures new title', async (t) => {
  const f = await fixture(t);
  const before = await f.index();
  f.update('UPDATE chat_sessions SET title = ?', 'Renamed title');
  const after = await f.index();
  assert.equal(after.sessions[0].title, 'Renamed title');
  assert.notEqual(before.sessions[0].materializationDescriptor.sourceSnapshotId, after.sessions[0].materializationDescriptor.sourceSnapshotId);
  assert.equal(before.sessions[0].rawEventCount, after.sessions[0].rawEventCount);
  await fs.rm(f.qoderDesktopDb);
  assert.equal((await materializeSessionForIndex(before, before.sessions[0])).title, 'Desktop title');
  assert.equal((await materializeSessionForIndex(after, after.sessions[0])).title, 'Renamed title');
  const missing = await f.index();
  assert.equal(missing.sessions[0].title, 'First user prompt');
  assert.equal(missing.sourceDiagnostics.counts.QODER_DESKTOP_TITLES_UNAVAILABLE, 1);
});

test('desktop title identity cannot cross cwd, native IDs, duplicate files or child transcripts', async (t) => {
  const f = await fixture(t);
  f.update('UPDATE chat_sessions SET cwd = ?', path.join(f.sourceHome, 'other'));
  assert.equal((await f.index()).sessions[0].title, 'First user prompt');
  f.update('UPDATE chat_sessions SET cwd = ?, session_id = ?', f.repoRoot, 'another-id');
  assert.equal((await f.index()).sessions[0].title, 'First user prompt');
  f.update('UPDATE chat_sessions SET session_id = ?', 'session-a');
  const duplicate = path.join(f.sourceHome, 'projects', 'other-container', 'session-a.jsonl');
  await fs.mkdir(path.dirname(duplicate)); await fs.copyFile(f.file, duplicate);
  let index = await f.index();
  assert.equal(index.sessions.length, 2);
  assert.equal(index.sessions.every((s) => s.title === 'First user prompt'), true);
  await fs.rm(duplicate);
  const child = path.join(f.sourceHome, 'projects', 'container', 'session-a', 'subagents', 'agent-child.jsonl');
  await fs.mkdir(path.dirname(child), { recursive: true });
  await fs.writeFile(child, f.text);
  index = await f.index();
  assert.equal(index.sessions.find((s) => s.sourceSessionId === 'agent-child').title, 'First user prompt');
  assert.equal(index.sessions.find((s) => s.sourceSessionId === 'session-a').title, 'Desktop title');
});

for (const kind of ['missing', 'corrupt', 'schema', 'view', 'journal', 'oversized']) {
  test(`optional ${kind} database cannot prevent native reading`, async (t) => {
    const f = await fixture(t);
    if (kind === 'missing') await fs.rm(f.qoderDesktopDb);
    if (kind === 'corrupt') await fs.writeFile(f.qoderDesktopDb, 'bad SQLite bytes');
    if (kind === 'schema') f.update('ALTER TABLE chat_sessions RENAME COLUMN cwd TO unsupported_cwd');
    if (kind === 'view') { f.update('ALTER TABLE chat_sessions RENAME TO original'); f.update('CREATE VIEW chat_sessions AS SELECT * FROM original'); }
    if (kind === 'journal') await fs.writeFile(f.qoderDesktopDb + '-journal', 'active');
    if (kind === 'oversized') await fs.truncate(f.qoderDesktopDb, 513 * 1024 * 1024);
    const index = await f.index();
    assert.equal(index.sessions[0].title, 'First user prompt');
    assert.equal(index.sourceDiagnostics.counts.QODER_DESKTOP_TITLES_UNAVAILABLE, 1);
    assert.equal((await materializeSessionForIndex(index, index.sessions[0])).counts.userMessages, 1);
    const without = await f.index({ qoderDesktopDb: undefined });
    assert.equal(without.sourceDiagnostics.totalCount, 0);
    const projects = await discoverQoderProjects({ ...f, onDiagnostic: () => assert.fail('Discovery must not consult optional titles') });
    assert.equal(projects[0].sessionCount, 1);
  });
}

test('WAL titles are captured without modifying source DB/WAL/SHM or leaving temporary snapshots', async (t) => {
  const f = await fixture(t);
  const writer = new DatabaseSync(f.qoderDesktopDb);
  try {
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    writer.prepare('UPDATE chat_sessions SET title = ?').run('WAL title');
    const state = async () => Object.fromEntries(await Promise.all(['', '-wal', '-shm'].map(async (s) => {
      const st = await fs.stat(f.qoderDesktopDb + s, { bigint: true });
      return [s, [st.dev, st.ino, st.size, st.mtimeNs, st.ctimeNs, await fs.readFile(f.qoderDesktopDb + s)]];
    })));
    const temporary = async () => (await fs.readdir(os.tmpdir())).filter((f) => f.startsWith('session-analyzer-qoder-title-')).sort();
    const before = await state(); const dirs = await temporary();
    assert.equal((await f.index()).sessions[0].title, 'WAL title');
    assert.deepEqual(await state(), before);
    assert.deepEqual(await temporary(), dirs);
  } finally {
    writer.close();
  }
});

for (const cancelAt of [null, 'cleanup', 'copy']) {
  test(`persistent snapshot cleanup failure ${cancelAt ? `preserves cancellation during ${cancelAt}` : 'keeps Qoder sessions readable'}`, async (t) => {
    const f = await fixture(t);
    const controller = new AbortController();
    const diagnostics = [];
    const originalRemove = fs.rm;
    let removal;
    t.mock.method(fs, 'rm', async (filename, options) => {
      if (!path.basename(filename).startsWith('session-analyzer-qoder-title-')) return originalRemove(filename, options);
      removal = { filename, options };
      if (cancelAt === 'cleanup') controller.abort();
      throw Object.assign(new Error('Synthetic lock persists after rm retries'), { code: 'EBUSY' });
    });
    if (cancelAt === 'copy') abortOnSnapshotRead(t, f.qoderDesktopDb, controller);
    try {
      const pending = f.index({ signal: controller.signal, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
      if (cancelAt) {
        await assert.rejects(pending, (error) => error === controller.signal.reason && error?.name === 'AbortError');
      } else {
        const index = await pending;
        const indexed = index.sessions[0];
        assert.equal(indexed.title, 'Desktop title');
        const session = await materializeSessionForIndex(index, indexed);
        assert.equal((await readIndexedRawRecord(index, session, session.rawEvents[0].rawId)).raw, f.text.trimEnd());
        assert.equal(index.sourceDiagnostics.counts.QODER_DESKTOP_TITLE_SNAPSHOT_CLEANUP_FAILED, 1);
      }
      assert.ok(removal.options.maxRetries > 0 && removal.options.retryDelay > 0);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].code, 'QODER_DESKTOP_TITLE_SNAPSHOT_CLEANUP_FAILED');
      assert.equal(diagnostics[0].path, removal.filename);
      assert.equal((await fs.stat(removal.filename)).isDirectory(), true);
    } finally {
      if (removal) await originalRemove(removal.filename, removal.options);
    }
  });
}

function abortOnSnapshotRead(t, database, controller) {
  const originalOpen = fs.open;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    const handle = await originalOpen(filename, ...args);
    if (filename === database) {
      const originalRead = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await originalRead(...readArgs);
        controller.abort();
        return result;
      };
    }
    return handle;
  });
}

test('snapshot copying cancels during I/O and removes its private directory', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const prefix = `qoder-cancel-${path.basename(f.sourceHome)}-`;
  const root = await fs.realpath(f.sourceHome);
  abortOnSnapshotRead(t, f.qoderDesktopDb, controller);
  await assert.rejects(copySqliteMetadataSnapshot(f.qoderDesktopDb, { root, prefix, signal: controller.signal }),
    (error) => error === controller.signal.reason && error?.name === 'AbortError');
  assert.equal((await fs.readdir(os.tmpdir())).some((f) => f.startsWith(prefix)), false);
});

test('cancelling a server index still reports the private snapshot that could not be removed', { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const originalRemove = fs.rm;
  const cleanup = Promise.withResolvers();
  const release = Promise.withResolvers();
  const settled = Promise.withResolvers();
  const warnings = [];
  let directory;
  t.mock.method(fs, 'rm', async (filename, options) => {
    if (!path.basename(filename).startsWith('session-analyzer-qoder-title-')) return originalRemove(filename, options);
    directory = filename;
    cleanup.resolve();
    await release.promise;
    throw Object.assign(new Error('Synthetic lock persists after rm retries'), { code: 'EBUSY' });
  });
  const server = createServer(null, 0, { source: 'qoder', qoderHome: f.sourceHome, qoderDesktopDb: f.qoderDesktopDb,
    warn: (message) => warnings.push(message), onProjectJobSettled: settled.resolve });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const start = await fetch(base + '/api/project', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: f.repoRoot }), signal: t.signal });
    assert.equal(start.status, 202);
    const { job } = await start.json();
    await Promise.race([cleanup.promise, settled.promise]);
    assert.ok(directory, 'The job must reach snapshot cleanup');
    const cancel = await fetch(base + '/api/project/status?jobId=' + job.id, { method: 'DELETE', signal: t.signal });
    assert.equal(cancel.status, 200);
    release.resolve();
    assert.equal((await settled.promise).status, 'cancelled');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].startsWith(`QODER_DESKTOP_TITLE_SNAPSHOT_CLEANUP_FAILED: ${directory}: `));
  } finally {
    release.resolve();
    await new Promise((resolve) => server.close(resolve));
    if (directory) await originalRemove(directory, { recursive: true, force: true });
  }
});

test('history serve reports a retained snapshot locally and keeps its JSON protocol available', { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const originalRemove = fs.rm;
  const originalListen = http.Server.prototype.listen;
  let directory;
  let server;
  let stderr = '';
  let stdout = '';
  t.mock.method(fs, 'rm', async (filename, options) => {
    if (!path.basename(filename).startsWith('session-analyzer-qoder-title-')) return originalRemove(filename, options);
    directory = filename;
    throw Object.assign(new Error('Synthetic lock persists after rm retries'), { code: 'EBUSY' });
  });
  t.mock.method(http.Server.prototype, 'listen', function (_port, ...args) {
    server = this;
    return originalListen.call(this, 0, ...args);
  });
  try {
    assert.equal(await runHistoryCli(['serve', '--source', 'qoder', '--repo', f.repoRoot,
      '--qoder-home', f.sourceHome, '--qoder-desktop-db', f.qoderDesktopDb], {
      stderr: { write: (text) => { stderr += text; } },
      stdout: { write: (text) => { stdout += text; } },
    }), 0);
    assert.equal(stdout, '');
    const records = stderr.trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 2);
    const [ready, { message, ...warning }] = records;
    assert.deepEqual(ready, { producer: 'session-analyzer', operation: 'history.serve', schemaVersion: 1,
      endpoint: `http://127.0.0.1:${server.address().port}` });
    assert.deepEqual(warning, { producer: 'session-analyzer', operation: 'history.diagnostic', schemaVersion: 1,
      code: 'QODER_DESKTOP_TITLE_SNAPSHOT_CLEANUP_FAILED', path: directory });
    assert.match(message, /EBUSY/);
    assert.ok((await fs.stat(directory)).isDirectory());

    const request = async (operation, input) => {
      const response = await fetch(`${ready.endpoint}/api/history/${operation}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: t.signal,
      });
      assert.equal(response.status, 200);
      const envelope = await response.json();
      assert.equal(envelope.operation, `history.${operation}`);
      return envelope;
    };
    const status = await request('status', {});
    assert.equal(status.coverage.sessionCount, 1);
    assert.deepEqual(status.coverage.diagnostics, { totalCount: 1, counts: { QODER_DESKTOP_TITLE_SNAPSHOT_CLEANUP_FAILED: 1 } });
    assert.equal(JSON.stringify(status).includes(JSON.stringify(directory).slice(1, -1)), false);
    const search = await request('search', { queries: ['First user prompt'] });
    assert.equal(search.items.length, 1);
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    if (directory) await originalRemove(directory, { recursive: true, force: true });
  }
});

test('remote, deleted and side-chat desktop rows cannot supply a main local title', async (t) => {
  const f = await fixture(t);
  for (const sql of ["UPDATE chat_sessions SET execution_kind = 'remote'",
    "UPDATE chat_sessions SET execution_kind = 'local', session_kind = 'sideChat'",
    "UPDATE chat_sessions SET session_kind = 'standard', deleted_at = '2026-11-13'"]) {
    f.update(sql);
    assert.equal((await f.index()).sessions[0].title, 'First user prompt');
  }
});

test('a title configuration bound to another source home is not used', async (t) => {
  const f = await fixture(t);
  const index = await f.index({ sourceConfigs: { qoder: { home: f.sourceHome + '-other', desktopDb: f.qoderDesktopDb } } });
  assert.equal(index.sessions[0].title, 'First user prompt');
  assert.equal(index.sourceDiagnostics.counts.QODER_DESKTOP_TITLES_UNAVAILABLE, 1);
});

test('copied title identity and dependency fields are validated before materialization', async (t) => {
  const f = await fixture(t); const index = await f.index();
  const deps = index.materializationDependencies.get(index.sessions[0].materializationDescriptor.dependencySetId);
  deps.entries[1].evidence.title.sessionId = 'wrong-session';
  await assert.rejects(validateIndexOwnershipForCommit(index), /Qoder desktop title/);
});

test('optional title database symlinks are rejected without reading the linked database', async (t) => {
  const f = await fixture(t); const linked = f.qoderDesktopDb + '.link';
  try { await fs.symlink(f.qoderDesktopDb, linked); }
  catch (error) { if (error.code === 'EPERM') { t.skip('File symlinks are unavailable'); return; } throw error; }
  const index = await f.index({ qoderDesktopDb: linked });
  assert.equal(index.sessions[0].title, 'First user prompt');
  assert.equal(index.sourceDiagnostics.counts.QODER_DESKTOP_TITLES_UNAVAILABLE, 1);
});

test('new duplicate main transcripts during database capture invalidate title ownership', async (t) => {
  const f = await fixture(t); const originalOpen = fs.open; let changed = false;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    if (filename === f.qoderDesktopDb && !changed) {
      changed = true;
      const duplicate = path.join(f.sourceHome, 'projects', 'new-container', 'session-a.jsonl');
      await fs.mkdir(path.dirname(duplicate)); await fs.copyFile(f.file, duplicate);
    }
    return originalOpen(filename, ...args);
  });
  const index = await f.index();
  assert.equal(changed, true);
  assert.equal(index.sessions[0].title, 'First user prompt');
  assert.equal(index.sourceDiagnostics.counts.QODER_DESKTOP_TITLE_UNVERIFIED, 1);
});
