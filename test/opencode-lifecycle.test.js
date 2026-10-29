'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { createHistoryService } = require('../src/history-service');
const { buildOpenCodeIndex } = require('../src/opencode');
const storage = require('../src/opencode-storage');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');
const { createOpenCodeFixture } = require('./helpers/opencode-fixture');

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-opencode-lifecycle-'));
  const source = createOpenCodeFixture({ dbPath: path.join(root, 'data', 'opencode.db'),
    repoRoot: path.join(root, 'project'), userText: 'CAPTURED_LIFECYCLE_EVIDENCE', ...overrides });
  const snapshotBase = path.join(root, 'snapshots');
  const indexes = [];
  const servers = [];
  const services = [];
  t.after(async () => {
    for (const server of servers) if (server.listening) await close(server);
    for (const service of services) service.close();
    for (const index of indexes) await disposeIndexResources(index);
    source.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { ...source, root, snapshotBase, indexes, servers, services,
    async build(options = {}) {
      const index = await buildOpenCodeIndex({ sourceHome: source.dbPath, repoRoot: source.repoRoot,
        snapshotBase, ...options });
      indexes.push(index);
      return index;
    },
    async service() {
      const service = await createHistoryService({ source: 'opencode', opencodeHome: source.dbPath, repo: source.repoRoot });
      services.push(service);
      return service;
    } };
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
}
async function request(base, url, body) {
  const response = await fetch(base + url, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function runJob(base, repoRoot) {
  const started = await request(base, '/api/project', { repoRoot });
  assert.equal(started.status, 202);
  const url = '/api/project/status?jobId=' + started.body.job.id;
  for (let i = 0; i < 200; i++) {
    const result = await request(base, url);
    if (!['queued', 'running'].includes(result.body.job.status)) return result.body;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Project job did not settle within the bounded test wait');
}
async function waitRemoved(directory) {
  for (let i = 0; i < 200; i++) {
    if (!await fs.stat(directory).then(() => true, () => false)) return;
    await tick();
  }
  assert.fail('Retired snapshot directory was not removed');
}

for (const firstClose of ['service', 'viewer']) test(`actual OpenCode history/viewer ownership survives closing ${firstClose} first`, async (t) => {
  const f = await fixture(t);
  const service = await f.service();
  const hit = (await service.execute('search', { query: 'CAPTURED_LIFECYCLE_EVIDENCE' })).items[0];
  const resolved = await service.resolveEvidence({ refs: [hit.ref] });
  const viewer = service.createViewerServer(); f.servers.push(viewer);
  const base = await listen(viewer);
  if (firstClose === 'viewer') {
    await close(viewer);
    assert.equal((await service.execute('search', { query: 'CAPTURED_LIFECYCLE_EVIDENCE' })).items.length, 1);
    assert.match(JSON.stringify(await service.execute('read', { refs: [hit.ref], parts: ['message', 'raw'] })),
      /CAPTURED_LIFECYCLE_EVIDENCE/);
  } else {
    service.close();
    await assert.rejects(service.execute('status'), { code: 'CONTEXT_EXPIRED' });
    const sessions = await request(base, '/api/sessions?q=CAPTURED_LIFECYCLE_EVIDENCE&layer=main');
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.sessions.length, 1);
    const target = `/api/sessions/${encodeURIComponent(resolved.target.sessionId)}/events/${encodeURIComponent(resolved.target.eventId)}/detail?layer=main`;
    const detail = await request(base, target);
    assert.equal(detail.status, 200);
    assert.match(JSON.stringify(detail.body), /CAPTURED_LIFECYCLE_EVIDENCE/);
  }
});

test('history close drains an already running disk search before releasing its query store', async (t) => {
  const f = await fixture(t, { messages: Array.from({ length: 1200 }, (_, n) => ({
    id: `msg_pending_${n}`, seq: n + 1,
    data: JSON.stringify({ text: `PENDING_HISTORY_SEARCH ${n}`, files: [] }),
  })) });
  const service = await f.service();
  const pending = service.execute('search', { query: 'PENDING_HISTORY_SEARCH', limit: 100, maxBytes: 1048576 });
  service.close();
  const result = await pending;
  assert.equal(result.items.length, 100);
  assert.equal(result.scan.matchedSessions, 1);
  await assert.rejects(service.execute('search', { query: 'PENDING_HISTORY_SEARCH' }), { code: 'CONTEXT_EXPIRED' });
});

test('retired HTTP materialization keeps snapshot files until its underlying read settles', { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const old = await f.build();
  const fresh = await f.build();
  const started = deferred(); const finish = deferred(); const completed = deferred();
  const originalRead = storage.readOpenCodeSnapshot;
  let held = false;
  storage.readOpenCodeSnapshot = async (...args) => {
    if (args[0] !== old.snapshotRoot || held) return originalRead(...args);
    held = true; started.resolve();
    await finish.promise;
    try { return await originalRead(args[0], args[1]); }
    finally { completed.resolve(); }
  };
  t.after(() => { storage.readOpenCodeSnapshot = originalRead; finish.resolve(); });
  const server = createServer(old, 0, { opencodeHome: f.dbPath, sessionPrewarm: false,
    buildIndex: async () => fresh }); f.servers.push(server);
  const base = await listen(server);
  const pending = request(base, `/api/sessions/${encodeURIComponent(old.sessions[0].id)}/timeline?layer=main&indexRevision=1`);
  await started.promise;
  assert.equal((await runJob(base, f.repoRoot)).job.status, 'succeeded');
  const retired = await pending;
  assert.equal(retired.status, 409);
  assert.equal(retired.body.code, 'INDEX_REVISION_RETIRED');
  assert.equal(await fs.stat(old.snapshotRoot).then(() => true, () => false), true);
  finish.resolve();
  await completed.promise;
  await waitRemoved(old.snapshotRoot);
  assert.equal((await request(base, '/api/sessions?q=CAPTURED_LIFECYCLE_EVIDENCE&layer=main')).status, 200);
});

test('capture, mapping and publication failures preserve a whole old revision and report stale freshness', async (t) => {
  const f = await fixture(t);
  const old = await f.build();
  let stage = 'capture';
  const server = createServer(old, 0, { opencodeHome: f.dbPath, sessionPrewarm: false,
    buildIndex: async (context) => {
      if (stage === 'capture') return f.build({ ...context, limits: { maxMessages: 1 } });
      if (stage === 'mapping') return f.build({ ...context, onProgress(progress) {
        if (progress.phase === 'parsing') throw Object.assign(new Error('Synthetic mapping budget failure'), { code: 'OPENCODE_BUDGET_EXCEEDED' });
      } });
      const candidate = await f.build(context);
      if (stage === 'publication') candidate.sessions[0].materializationDescriptor.payload.fileName = 'invalid.json';
      return candidate;
    } }); f.servers.push(server);
  const base = await listen(server);
  const files = (await fs.readdir(f.snapshotBase)).sort();
  for (stage of ['capture', 'mapping', 'publication']) {
    const result = await runJob(base, f.repoRoot);
    assert.equal(result.job.status, 'failed', stage);
    assert.equal(result.job.retainedIndexRevision, 1, stage);
    assert.equal(result.job.dataMayBeStale, true, stage);
    const state = (await request(base, '/api/state')).body;
    assert.equal(state.indexRevision, 1);
    assert.equal(state.refreshFailure.dataMayBeStale, true);
    assert.equal(state.refreshFailure.errorCode, result.job.errorCode);
    assert.equal(state.totals.sessionCount, 1);
    const materialized = await materializeSessionForIndex(old, old.sessions[0]);
    assert.match(JSON.stringify(materialized.rawEvents), /CAPTURED_LIFECYCLE_EVIDENCE/);
    for (let i = 0; i < 200 && JSON.stringify((await fs.readdir(f.snapshotBase)).sort()) !== JSON.stringify(files); i++) await tick();
    assert.deepEqual((await fs.readdir(f.snapshotBase)).sort(), files, stage + ' failed candidate cleanup');
  }
  stage = 'success';
  assert.equal((await runJob(base, f.repoRoot)).job.status, 'succeeded');
  const state = (await request(base, '/api/state')).body;
  assert.equal(state.indexRevision, 2);
  assert.equal(state.refreshFailure, undefined);
});

test('first build failure publishes no empty project and reports no retained revision', async (t) => {
  const f = await fixture(t);
  const server = createServer(null, 0, { source: 'opencode', opencodeHome: f.dbPath, sessionPrewarm: false,
    buildIndex: (context) => f.build({ ...context, limits: { maxMessages: 1 } }) }); f.servers.push(server);
  const base = await listen(server);
  const result = await runJob(base, f.repoRoot);
  assert.equal(result.job.status, 'failed');
  assert.equal(result.job.errorCode, 'OPENCODE_CAPTURE_LIMIT');
  assert.equal(result.job.retainedIndexRevision, 0);
  assert.equal(result.job.dataMayBeStale, false);
  const state = await request(base, '/api/state');
  assert.equal(state.body.projectSelected, false);
  assert.equal(state.body.totals, undefined);
  assert.equal((await request(base, '/api/sessions')).status, 409);
});

test('a failed different-project selection cannot advertise the old project as its fallback', async (t) => {
  const f = await fixture(t);
  const old = await f.build();
  const server = createServer(old, 0, { opencodeHome: f.dbPath, sessionPrewarm: false,
    buildIndex: () => { throw Object.assign(new Error('Synthetic selected project failure'), { code: 'OPENCODE_PROJECT_INVALID' }); } });
  f.servers.push(server);
  const base = await listen(server);
  const result = await runJob(base, path.join(f.root, 'different-project'));
  assert.equal(result.job.status, 'failed');
  assert.equal(result.job.retainedIndexRevision, 0);
  assert.equal(result.job.dataMayBeStale, false);
  const state = (await request(base, '/api/state')).body;
  assert.equal(state.repoRoot, f.repoRoot);
  assert.equal(state.refreshFailure, undefined);
});
