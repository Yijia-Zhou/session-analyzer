'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { parseArgs, loadPathConfig } = require('../src/cli');
const { parseHistoryArgs } = require('../src/history-cli');
const { createHistoryService } = require('../src/history-service');
const { createServer, resolveSourceMutation } = require('../server');

test('normal and History CLI accept optional desktop paths and path config resolves them locally', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'qoder-config-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const file = path.join(home, 'paths.json');
  await fs.writeFile(file, JSON.stringify({ qoder: { home: 'native', desktopDb: 'desktop/main.sqlite' } }));
  assert.deepEqual((await loadPathConfig(file)).qoder, { home: path.join(home, 'native'), desktopDb: path.join(home, 'desktop/main.sqlite') });
  const flags = ['--source', 'qoder', '--repo', home, '--qoder-home', home, '--qoder-desktop-db', path.join(home, 'desktop.sqlite')];
  const normal = parseArgs(['node', 'server.js', ...flags]);
  assert.deepEqual(normal.errors, []);
  assert.equal(normal.qoderDesktopDb, path.join(home, 'desktop.sqlite'));
  assert.equal(parseHistoryArgs(['serve', ...flags]).qoderDesktopDb, normal.qoderDesktopDb);
  assert.ok(parseArgs(['node', 'server.js', '--qoder-desktop-db']).errors.length);
  for (const config of [{ codex: { home, desktopDb: 'x' } }, { qoder: { home, desktopDb: 2 } }, { qoder: { home, desktopDb: ' ' } }]) {
    await fs.writeFile(file, JSON.stringify(config));
    await assert.rejects(loadPathConfig(file), { code: 'INVALID_PROJECT_PATH_POLICY' });
  }
});

test('Qoder desktop config survives source switches, invalidates changed titles, and clears for a different home', () => {
  const home = path.resolve('/synthetic-qoder'); const desktopDb = path.resolve('/synthetic-desktop/main.sqlite');
  const state = { sourceKind: 'qoder', sourceRevision: 0, activeSourceRevision: 0, index: null,
    sourceConfigs: { qoder: { home, desktopDb } }, projectCache: { projects: [] } };
  const mutate = (body) => { const result = resolveSourceMutation(state, body); assert.deepEqual(result.errors, []); return result.payload; };
  assert.equal(mutate({ source: 'codex' }).sourceConfigs.qoder.desktopDb, desktopDb);
  assert.equal(mutate({ source: 'qoder', sourceConfigs: { qoder: { home } } }).sourceConfigs.qoder.desktopDb, desktopDb);
  const revision = state.activeSourceRevision;
  state.projectCache = { projects: [] };
  const replacement = path.resolve('/other-desktop/main.sqlite');
  assert.equal(mutate({ source: 'qoder', sourceConfigs: { qoder: { home, desktopDb: replacement } } }).sourceConfigs.qoder.desktopDb, replacement);
  assert.equal(state.activeSourceRevision, revision + 1);
  assert.equal(state.projectCache, null);
  assert.equal(mutate({ source: 'qoder', qoderHome: home + '-changed' }).sourceConfigs.qoder.desktopDb, undefined);
  mutate({ source: 'qoder', sourceConfigs: { qoder: { home, desktopDb } } });
  assert.equal(mutate({ source: 'qoder', sourceConfigs: { qoder: { home, desktopDb: '' } } }).sourceConfigs.qoder.desktopDb, undefined);
  assert.ok(resolveSourceMutation(state, { source: 'qoder', sourceConfigs: { qoder: { home, desktopDb: 3 } } }).errors.length);
  assert.ok(resolveSourceMutation(state, { source: 'codex', sourceConfigs: { codex: { home, desktopDb } } }).errors.length);
});

test('History CLI configuration supplies title metadata to its fixed index and viewer', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'qoder-history-titles-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo'); const directory = path.join(home, 'projects', 'container');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'native.jsonl'), JSON.stringify({ type: 'user', uuid: 'u', sessionId: 'native', cwd: repo,
    message: { role: 'user', content: 'CONFIG_TITLE_SENTINEL' } }) + '\n');
  const file = path.join(home, 'desktop.sqlite'); const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE chat_sessions(session_id TEXT PRIMARY KEY, cwd TEXT, title TEXT, extra_json TEXT,
    conversation_mode TEXT, execution_kind TEXT, deleted_at TEXT, session_kind TEXT DEFAULT 'standard')`);
  db.prepare("INSERT INTO chat_sessions(session_id,cwd,title,extra_json,conversation_mode,execution_kind,deleted_at) VALUES(?,?,?,'{}','normal','local',NULL)").run('native', repo, 'Configured desktop title');
  db.close();
  const service = await createHistoryService({ source: 'qoder', repo, qoderHome: home, qoderDesktopDb: file });
  t.after(() => service.close());
  const viewer = service.createViewerServer();
  await new Promise((resolve) => viewer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => viewer.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${viewer.address().port}/api/sessions`, { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sessions[0].title, 'Configured desktop title');
  // Normal server startup preserves configured metadata even when another source is initially selected.
  const server = createServer(null, 0, { source: 'codex', qoderHome: home, qoderDesktopDb: file });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const changed = await fetch(base + '/api/source', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'qoder' }) });
  assert.equal((await changed.json()).sourceConfigs.qoder.desktopDb, file);
});
