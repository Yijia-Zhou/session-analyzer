'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { buildProjectQueryStore, projectQueryProjectionDigestForSession } = require('../src/project-query-store');
const { getSourceAdapter } = require('../src/source-adapters');
const { capacitySession } = require('../scripts/query-capacity-fixture');
const { strictClaudeIndexFromComplete } = require('./strict-claude-fixture');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function diskIndex(root, id) {
  const session = capacitySession(id, 3, `${id} needle`, ['main']);
  const index = strictClaudeIndexFromComplete({
    repoRoot: path.join(root, id), sessions: [session], sessionsById: new Map([[id, session]]),
    generatedAt: '2026-10-02T00:00:00.000Z',
    totals: { sessionCount: 1, eventCount: 3, rawEventCount: 0 },
  }, { sourceRoot: root });
  const query = getSourceAdapter('claude-code').query;
  index.projectQueryStore = buildProjectQueryStore([session], {
    memoryRows: 0, tempRoot: root, presentationForEvent: query.projectQueryPresentation,
  });
  for (const indexed of index.sessions) {
    indexed.queryProjectionDigest = projectQueryProjectionDigestForSession(index.projectQueryStore, indexed.id);
  }
  return index;
}

async function until(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'server-owned build storage did not settle/clean up');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function start(t, buildIndex) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-http-'));
  const initial = diskIndex(root, 'initial');
  const settled = deferred();
  const server = createServer(initial, 1, {
    buildIndex: context => buildIndex(context, root),
    onProjectJobSettled: settled.resolve,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await until(() => fs.readdirSync(root).length === 0);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, initial, server, settled,
    base: `http://127.0.0.1:${server.address().port}` };
}

async function begin(f) {
  const response = await fetch(`${f.base}/api/project`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoRoot: path.join(f.root, 'replacement') }) });
  assert.equal(response.status, 202);
  return (await response.json()).job.id;
}

async function assertInitialStillQueryable(f) {
  const stateResponse = await fetch(`${f.base}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.indexRevision, 1);
  assert.equal(state.repoRoot, f.initial.repoRoot);
  const response = await fetch(`${f.base}/api/sessions?q=initial%20needle&layer=main`);
  assert.equal(response.status, 200);
  const found = await response.json();
  assert.equal(found.matchingEventTotal, 3);
  assert.equal(found.sessions[0].id, 'initial');
}

for (const outcome of ['failed', 'cancelled']) {
  test(`HTTP ${outcome} disk-index replacement preserves old search and reclaims candidate storage`, { timeout: 5000 }, async t => {
    const created = deferred();
    const release = deferred();
    const f = await start(t, async ({ signal }, root) => {
      diskIndex(root, 'replacement');
      created.resolve();
      if (outcome === 'cancelled') {
        await new Promise((resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      } else {
        await release.promise;
        const error = new Error('synthetic query storage quota exhausted');
        error.code = 'PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED';
        throw error;
      }
    });
    const id = await begin(f);
    await created.promise;
    assert.equal(fs.readdirSync(f.root).length, 2);
    if (outcome === 'cancelled') {
      const response = await fetch(`${f.base}/api/project/status?jobId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).job.status, outcome);
    } else release.resolve();
    const job = await f.settled.promise;
    assert.equal(job.status, outcome);
    if (outcome === 'failed') assert.equal(job.errorCode, 'PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED');
    await until(() => fs.readdirSync(f.root).length === 1);
    await assertInitialStillQueryable(f);
  });
}

test('HTTP server.close aborts an in-flight disk build and releases both revision and candidate', { timeout: 5000 }, async t => {
  const created = deferred();
  let observedAbort = false;
  const f = await start(t, async ({ signal }, root) => {
    diskIndex(root, 'replacement');
    created.resolve();
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(signal.reason);
      }, { once: true });
    });
  });
  await begin(f);
  await created.promise;
  assert.equal(fs.readdirSync(f.root).length, 2);
  await new Promise(resolve => f.server.close(resolve));
  assert.equal((await f.settled.promise).status, 'cancelled');
  assert.equal(observedAbort, true);
  await until(() => fs.readdirSync(f.root).length === 0);
});
