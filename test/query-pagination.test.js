'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createServer } = require('../server');
const { buildSourceBackedIndex } = require('../src/codex');
const { createSessionQuery } = require('../src/session-query');
const { queryPagination } = require('../src/shared/query-pagination');

test('query pagination preserves positions and rejects ambiguous or unsafe numbers', () => {
  const query = createSessionQuery();
  for (const offset of [0, 999999, 1000000, 1000001, 1000500, Number.MAX_SAFE_INTEGER]) {
    assert.equal(query.filtersFromSearchParams(new URLSearchParams({ offset })).offset, offset);
    assert.equal(queryPagination({ offset }).offset, offset);
  }
  for (const offset of ['', ' ', '-1', '1.5', '1e6', '0x10', 'Infinity', 'NaN', '9007199254740992', '1x']) {
    assert.throws(() => query.filtersFromSearchParams(new URLSearchParams({ offset })), { code: 'INVALID_PAGINATION' });
  }
  assert.deepEqual(queryPagination(), { offset: 0, limit: 150 });
  assert.deepEqual(queryPagination({ limit: 10000 }), { offset: 0, limit: 500 });
});

test('real HTTP timeline and file activity preserve large empty-page offsets and revision boundaries', async (t) => {
  const index = await buildSourceBackedIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: path.join(__dirname, 'fixtures', 'codex-home'),
  });
  const server = createServer(index, 0, { buildIndex: async () => index });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessionId = encodeURIComponent(index.sessions[0].id);
  const routes = [`/api/sessions/${sessionId}/timeline`, `/api/sessions/${sessionId}/file-activity?file=src%2Fa.js`];
  const request = async (route, values) => {
    const url = new URL(route, base);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  };
  for (const route of routes) {
    for (const offset of [999999, 1000000, 1000001, 1000500, Number.MAX_SAFE_INTEGER]) {
      const { status, body } = await request(route, { offset, limit: 9999, indexRevision: 1 });
      assert.equal(status, 200);
      assert.equal(body.offset, offset);
      assert.deepEqual(body.events, []);
      assert.equal(body.limit, route.endsWith('/timeline') ? 500 : 100);
      assert.equal(body.indexRevision, 1);
    }
    const defaults = await request(route, {});
    assert.equal(defaults.body.limit, route.endsWith('/timeline') ? 150 : 50);
    for (const offset of ['', '-1', '1.25', 'NaN', 'Infinity', '9007199254740992']) {
      const result = await request(route, { offset });
      assert.equal(result.status, 400, offset);
      assert.equal(result.body.code, 'INVALID_PAGINATION');
    }
    assert.equal((await request(route, { limit: 0 })).status, 400);
    const stale = await request(route, { offset: 1, indexRevision: 2 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'INDEX_REVISION_RETIRED');
  }
  const start = await fetch(`${base}/api/project`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoRoot: index.repoRoot }) });
  const { job } = await start.json();
  let result;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    result = await (await fetch(`${base}/api/project/status?jobId=${job.id}`)).json();
    if (result.job.status === 'succeeded') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.job.status, 'succeeded');
  for (const route of routes) {
    assert.equal((await request(route, { offset: 1, indexRevision: 1 })).status, 409);
    assert.equal((await request(route, { offset: 1, indexRevision: result.state.indexRevision })).status, 200);
  }
});
