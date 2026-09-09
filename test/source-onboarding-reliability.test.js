'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const storage = require('../src/deepseek-harness-storage');
const { buildDeepSeekIndex, discoverDeepSeekProjects, deepSeekAdapter } = require('../src/deepseek-harness');
const { materializeSessionForIndex, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { createSourceDiagnostics } = require('../src/source-diagnostics');
const { createServer, discoverProjectsForSource } = require('../server');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'onboarding-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const sourceHome = path.join(root, 'sessions');
  await fsp.mkdir(repoRoot); await fsp.mkdir(sourceHome);
  async function artifact(id, version = 0, cwd = repoRoot) {
    const dir = path.join(sourceHome, id); await fsp.mkdir(dir);
    const file = path.join(dir, 'session.jsonl');
    await fsp.writeFile(file, JSON.stringify({ type: 'session', version, id, createdAt: 1, cwd, delegationDepth: 0 }) + '\n');
    return file;
  }
  return { root, repoRoot, sourceHome, artifact };
}

test('bad sibling sessions are isolated and normal project remains discoverable and readable', async (t) => {
  const f = await fixture(t);
  await f.artifact('normal');
  await f.artifact('future', 1, path.join(f.root, 'other'));
  const dual = await f.artifact('dual', 0, path.join(f.root, 'other'));
  await fsp.writeFile(dual + '.zstd', 'unused conflict');
  const diagnostics = createSourceDiagnostics();
  const projects = await discoverDeepSeekProjects({ ...f, onDiagnostic: diagnostics.add });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].repoRoot, f.repoRoot);
  assert.equal(diagnostics.summary.totalCount, 2);
  const index = await buildDeepSeekIndex(f);
  assert.deepEqual(index.sourceDiagnostics, diagnostics.summary);
  assert.equal(index.sessions.length, 1);
  assert.equal(index.totals.fileCount, 4);
  assert.equal(index.totals.skippedFileCount, 3);
  await validateIndexOwnershipForCommit(index);
  assert.equal((await materializeSessionForIndex(index, index.sessions[0])).sourceSessionId, 'normal');
});

test('all-invalid and missing/not-directory roots carry diagnostics; empty root does not', async (t) => {
  const f = await fixture(t);
  assert.equal((await buildDeepSeekIndex(f)).sourceDiagnostics.totalCount, 0);
  const file = await f.artifact('future', 1);
  for (const [home, code] of [[f.sourceHome, 'DEEPSEEK_FORMAT_VERSION_UNSUPPORTED'],
    [path.join(f.root, 'missing'), 'SOURCE_ROOT_NOT_FOUND'], [file, 'SOURCE_ROOT_NOT_DIRECTORY']]) {
    const index = await buildDeepSeekIndex({ ...f, sourceHome: home });
    assert.equal(index.sessions.length, 0);
    assert.equal(index.sourceDiagnostics.counts[code], 1);
  }
});

test('Zstd capability and busy errors remain visible with mixed and all-unreadable sources', async (t) => {
  const f = await fixture(t);
  const plain = await f.artifact('plain');
  const compressed = await f.artifact('compressed');
  await fsp.rename(compressed, compressed + '.zstd');
  const original = storage.readSessionHeader;
  for (const code of ['DEEPSEEK_ZSTD_UNAVAILABLE', 'DEEPSEEK_SOURCE_BUSY']) {
    const mock = t.mock.method(storage, 'readSessionHeader', async (file, ...args) => {
      if (file.endsWith('.zstd')) throw Object.assign(new Error('runtime or snapshot unavailable'), { code });
      return original(file, ...args);
    });
    const diagnostics = createSourceDiagnostics();
    assert.equal((await discoverDeepSeekProjects({ ...f, onDiagnostic: diagnostics.add })).length, 1);
    assert.equal(diagnostics.summary.counts[code], 1);
    assert.equal((await buildDeepSeekIndex(f)).sourceDiagnostics.counts[code], 1);
    mock.mock.restore();
  }
  await fsp.rm(plain);
  t.mock.method(storage, 'readSessionHeader', async () => { throw Object.assign(new Error('Node missing Zstd'), { code: 'DEEPSEEK_ZSTD_UNAVAILABLE' }); });
  const index = await buildDeepSeekIndex(f);
  assert.equal(index.sessions.length, 0);
  assert.equal(index.sourceDiagnostics.totalCount, 1);
});

test('cancellation and unexpected programming errors propagate', async (t) => {
  const f = await fixture(t); await f.artifact('normal');
  const controller = new AbortController();
  t.mock.method(storage, 'readSessionHeader', async () => {
    controller.abort(); throw Object.assign(new Error('bad storage'), { code: 'DEEPSEEK_STORAGE_INVALID' });
  });
  await assert.rejects(buildDeepSeekIndex({ ...f, signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(discoverDeepSeekProjects({ ...f, signal: controller.signal }), { name: 'AbortError' });
  t.mock.restoreAll();
  t.mock.method(storage, 'readSessionHeader', async () => { throw new TypeError('programming bug'); });
  await assert.rejects(buildDeepSeekIndex(f), /programming bug/);
});

test('discovery diagnostics are bounded, cached, and stale discovery cannot overwrite the cache', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 25; i++) await f.artifact('future-' + i, 1);
  const state = { sourceKind: 'deepseek-harness', sourceHome: f.sourceHome, sourceRevision: 0, adapter: deepSeekAdapter };
  const full = await discoverProjectsForSource(state, 'full');
  assert.equal(full.payload.sourceDiagnostics.totalCount, 25);
  assert.equal(full.payload.sourceDiagnostics.samples.length, 20);
  assert.equal(full.payload.sourceDiagnostics.truncatedCount, 5);
  assert.deepEqual((await discoverProjectsForSource(state, 'summary')).payload.sourceDiagnostics, full.payload.sourceDiagnostics);
  const cache = state.projectCache;
  state.adapter = { ...deepSeekAdapter, async discoverProjects(context) {
    context.onDiagnostic({ code: 'SOURCE_ROOT_UNREADABLE', path: 'x', message: 'x' });
    state.sourceRevision++; return [];
  } };
  assert.equal((await discoverProjectsForSource(state, 'full')).stale, true);
  assert.equal(state.projectCache, cache);
});

async function serve(t, initial, options) {
  const server = createServer(initial, 0, { sessionPrewarm: false, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return async (route, init) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, init);
    return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() };
  };
}

test('failed startup stays visible on first state request and callback settles exactly once', async (t) => {
  const f = await fixture(t); let settle; const finished = new Promise((resolve) => { settle = resolve; }); let calls = 0;
  const request = await serve(t, null, { source: 'deepseek-harness', sourceHome: f.sourceHome, repo: f.repoRoot,
    buildIndex: async () => { throw Object.assign(new Error('startup rejected'), { code: 'TEST_STARTUP_FAILURE' }); },
    onProjectJobSettled(job) { calls++; settle(job); throw new Error('callback cannot change job'); },
  });
  const job = await finished;
  const state = await request('/api/state');
  assert.equal(state.status, 200); assert.equal(state.body.projectSelected, false);
  assert.equal(state.body.job.errorCode, 'TEST_STARTUP_FAILURE');
  assert.equal(state.body.job.error, 'startup rejected');
  assert.equal((await request('/api/project/status')).body.job.status, 'failed');
  assert.equal(job.status, 'failed'); assert.equal(calls, 1);
  await request('/api/source', { method: 'POST', body: JSON.stringify({ source: 'codex' }) });
  assert.equal((await request('/api/state')).status, 409);
  await request('/api/source', { method: 'POST', body: JSON.stringify({ source: 'deepseek-harness' }) });
  assert.equal((await request('/api/state')).status, 409);
  assert.equal((await request('/api/project/status')).body.job.status, 'failed');
});

test('inactive directory edits and source no-ops preserve startup failure context', async (t) => {
  const f = await fixture(t); let settle; const finished = new Promise((resolve) => { settle = resolve; });
  const request = await serve(t, null, { source: 'deepseek-harness', sourceHome: f.sourceHome, repo: f.repoRoot,
    buildIndex: async () => { throw new Error('original startup failure'); }, onProjectJobSettled: settle,
  });
  await finished;
  for (const mutation of [{ source: 'deepseek-harness' },
    { source: 'deepseek-harness', codexHome: path.join(f.root, 'inactive-codex') }]) {
    assert.equal((await request('/api/source', { method: 'POST', body: JSON.stringify(mutation) })).status, 200);
    const state = await request('/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.job.error, 'original startup failure');
  }
});

test('failed refresh preserves valid old index and diagnostics in state', async (t) => {
  const f = await fixture(t); await f.artifact('normal'); await f.artifact('future', 1);
  const index = await buildDeepSeekIndex(f);
  let settle; const finished = new Promise((resolve) => { settle = resolve; });
  const request = await serve(t, index, { repo: f.repoRoot,
    buildIndex: async () => { throw new Error('refresh rejected'); }, onProjectJobSettled: settle });
  await finished;
  const state = await request('/api/state');
  assert.equal(state.status, 200); assert.equal(state.body.projectSelected, true);
  assert.equal(state.body.totals.sessionCount, 1);
  assert.equal(state.body.sourceDiagnostics.counts.DEEPSEEK_FORMAT_VERSION_UNSUPPORTED, 1);
});

test('actual storage module with missing built-in Zstd explains runtime and preserves plain reads', async (t) => {
  const filename = require.resolve('../src/deepseek-harness-storage');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, process,
    require: (name) => name === 'node:zlib' ? {} : localRequire(name),
  }, { filename });
  const isolated = module.exports;
  const f = await fixture(t); const file = await f.artifact('plain');
  assert.equal((await isolated.readSessionHeader(file, 'none')).id, 'plain');
  await assert.rejects(isolated.readSessionHeader(file, 'zstd'), (error) => {
    assert.equal(error.code, 'DEEPSEEK_ZSTD_UNAVAILABLE');
    assert.ok(error.message.includes(process.version));
    assert.match(error.message, /[Uu]pgrade/);
    return true;
  });
});

test('candidate parse failures are isolated after successful header inspection', async (t) => {
  const f = await fixture(t); await f.artifact('normal');
  const bad = await f.artifact('bad'); await fsp.appendFile(bad, '{invalid json}\n');
  const index = await buildDeepSeekIndex(f);
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sourceDiagnostics.counts.DEEPSEEK_STORAGE_INVALID, 1);
  await validateIndexOwnershipForCommit(index);
});

test('runtime busy response keeps actionable message and structured retry status', async (t) => {
  const f = await fixture(t); await f.artifact('normal'); const index = await buildDeepSeekIndex(f);
  const request = await serve(t, index, { materializeSession: async () => {
    throw Object.assign(new Error('Source is changing; retry shortly.'), {
      code: 'DEEPSEEK_SOURCE_BUSY', statusCode: 503, retryAfterSeconds: 1,
    });
  } });
  const response = await request('/api/sessions/' + encodeURIComponent(index.sessions[0].id) + '/timeline');
  assert.equal(response.status, 503);
  assert.equal(response.retryAfter, '1');
  assert.equal(response.body.code, 'DEEPSEEK_SOURCE_BUSY');
  assert.match(response.body.error, /retry shortly/);
});

test('CLI reports terminal zero-session diagnostics while remaining available', { timeout: 10000 }, async (t) => {
  const f = await fixture(t); await f.artifact('future', 1);
  const portServer = require('node:net').createServer();
  await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--source', 'deepseek-harness',
    '--dsh-home', f.sourceHome, '--repo', f.repoRoot, '--port', String(port)], { windowsHide: true });
  t.after(() => { child.kill(); });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI did not report terminal diagnostics: ' + output)), 7000);
    t.after(() => clearTimeout(timer));
    const receive = (chunk) => {
      output += chunk.toString();
      if (output.includes('DEEPSEEK_FORMAT_VERSION_UNSUPPORTED') && output.includes('indexing succeeded')) {
        clearTimeout(timer); resolve();
      }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error('CLI exited early: ' + code + ': ' + output)));
  });
  assert.match(output, /0 sessions, 1 source diagnostics/);
  assert.match(output, /No readable matching sessions/);
  assert.equal(child.exitCode, null);
});

test('unreadable child directories cannot poison readable siblings or masquerade as empty root', async (t) => {
  const f = await fixture(t); await f.artifact('normal');
  const blocked = path.join(f.sourceHome, 'blocked'); await fsp.mkdir(blocked);
  const readdir = fsp.readdir;
  t.mock.method(fsp, 'readdir', async (dir, options) => {
    if (dir === blocked) throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    return readdir(dir, options);
  });
  const index = await buildDeepSeekIndex(f);
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sourceDiagnostics.counts.SOURCE_ARTIFACT_UNREADABLE, 1);
  assert.equal((await buildDeepSeekIndex({ ...f, sourceHome: blocked })).sourceDiagnostics.counts.SOURCE_ROOT_UNREADABLE, 1);
});

test('successful settlement callback failure cannot overturn the installed index', async (t) => {
  const f = await fixture(t); await f.artifact('normal');
  let settle; const finished = new Promise((resolve) => { settle = resolve; }); let calls = 0;
  const request = await serve(t, null, { source: 'deepseek-harness', sourceHome: f.sourceHome, repo: f.repoRoot,
    onProjectJobSettled(job) { calls++; settle(job); throw new Error('callback rejected'); },
  });
  const job = await finished;
  assert.equal(job.totals.sessionCount, 1); assert.equal(job.status, 'succeeded');
  assert.equal((await request('/api/state')).body.projectSelected, true);
  assert.equal((await request('/api/project/status')).body.job.status, 'succeeded');
  assert.equal(calls, 1);
});
