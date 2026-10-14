'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { startHistoryServer, createHistoryServer } = require('../src/history-server');
const { requestHistory } = require('../src/history-cli');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-open-'));
  const repo = path.join(home, 'repo');
  await fs.mkdir(repo);
  await fs.mkdir(path.join(home, 'sessions'));
  const sourceFile = path.join(home, 'sessions', 'rollout-open.jsonl');
  const message = (role, text) => ({ type: 'response_item', payload: {
    type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
  } });
  const rows = [
    { type: 'session_meta', payload: { id: 'history-open-synthetic', cwd: repo } },
    message('user', 'Synthetic context before the evidence.'),
    message('assistant', `${'Long unrelated line.\n'.repeat(2000)}THE_EXACT_EVIDENCE_HIT\nFinal line.`),
    message('user', 'Synthetic context after the evidence.'),
  ];
  const original = rows.map((row) => JSON.stringify({ timestamp: '2026-09-01T00:00:00Z', ...row })).join('\n') + '\n';
  await fs.writeFile(sourceFile, original);
  const options = { repo, source: 'codex', codexHome: home, port: 0 };
  const running = await startHistoryServer(options);
  t.after(async () => {
    if (running.server.listening) await running.close();
    await fs.rm(home, { recursive: true, force: true });
  });
  const search = await requestHistory(running.endpoint, 'search', { query: 'THE_EXACT_EVIDENCE_HIT' });
  assert.equal(search.items.length, 1);
  return { ...running, options, ref: search.items[0].ref, sourceFile, original };
}

test('open verifies exact hit and serves the same fixed snapshot in one lazy viewer', async (t) => {
  const running = await fixture(t);
  const [one, two] = await Promise.all([1, 2].map(() => requestHistory(running.endpoint, 'open', { refs: [running.ref] })));
  assert.equal(one.targetVerified, true);
  assert.equal(one.viewerReady, true);
  assert.equal(one.browserOpenRequested, false);
  assert.equal(one.url, two.url);
  assert.match(one.excerpt.text, /THE_EXACT_EVIDENCE_HIT/);
  assert.ok(one.excerpt.text.length < 3000);
  assert.equal(one.context.events.find((event) => event.anchor).eventId, one.target.eventId);
  const viewer = new URL(one.url).origin;
  t.after(async () => { await assert.rejects(fetch(`${viewer}/api/state`)); });
  assert.equal(new URLSearchParams(new URL(one.url).hash.slice(1)).get('ref'), one.evidenceRef);
  const state = await (await fetch(`${viewer}/api/state`)).json();
  assert.deepEqual(state.historyViewer, { fixedScope: true });
  const resolveUrl = `${viewer}/api/history/resolve?ref=${encodeURIComponent(one.evidenceRef)}`;
  const resolved = await (await fetch(resolveUrl, { headers: { origin: viewer } })).json();
  assert.deepEqual(resolved.target, one.target);
  assert.deepEqual(resolved.excerpt, one.excerpt);
  const event = await (await fetch(`${viewer}/api/sessions/${encodeURIComponent(one.target.sessionId)}/events/${encodeURIComponent(one.target.eventId)}?layer=${one.target.layer}`)).json();
  assert.equal(event.id, one.target.eventId);
  assert.equal(event.layer, one.target.layer);
  assert.equal((await fetch(viewer)).status, 200);
  const crossSiteNavigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  // node fetch overrides Sec-Fetch-Mode, so send browser navigation headers via HTTP.
  const statusFor = (route, headers) => new Promise((resolve, reject) => {
    require('node:http').get(viewer + route, { headers }, (res) => { res.resume(); resolve(res.statusCode); }).once('error', reject);
  });
  assert.equal(await statusFor('/', crossSiteNavigation), 200);
  assert.equal(await statusFor('/', { 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await statusFor('/', { ...crossSiteNavigation, origin: 'https://foreign.invalid' }), 403);
  assert.equal(await statusFor('/api/state', crossSiteNavigation), 403);
  assert.equal(await statusFor('/api/history/resolve?ref=' + encodeURIComponent(one.evidenceRef), crossSiteNavigation), 403);
  for (const route of ['/api/projects', '/api/source', '/api/project', '/api/project/status']) {
    assert.equal((await fetch(`${viewer}${route}`)).status, 403);
    assert.equal((await fetch(`${viewer}${route}`, { method: 'POST' })).status, 403);
  }
  for (const headers of [{ origin: 'https://foreign.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await fetch(resolveUrl, { headers })).status, 403, JSON.stringify(headers));
  }
  const foreignHostStatus = await new Promise((resolve, reject) => {
    require('node:http').get(resolveUrl, { headers: { host: 'foreign.invalid' } }, (res) => {
      res.resume(); resolve(res.statusCode);
    }).once('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(`${running.endpoint}/api/history/open`, { method: 'POST', headers: { origin: viewer, 'content-type': 'application/json' }, body: JSON.stringify({ refs: [one.evidenceRef] }) })).status, 403);
  // Append does not reindex or admit the newly recorded suffix.
  await fs.appendFile(running.sourceFile, JSON.stringify({ timestamp: '2026-09-02T00:00:00Z', type: 'event_msg', payload: { type: 'user_message', message: 'NEW_SUFFIX_ONLY' } }) + '\n');
  assert.equal((await fetch(resolveUrl)).status, 200);
  assert.equal((await requestHistory(running.endpoint, 'search', { query: 'NEW_SUFFIX_ONLY' })).items.length, 0);
  // Reverification must reject changed indexed bytes even after viewer reads.
  await fs.writeFile(running.sourceFile, running.original.replace('THE_EXACT_EVIDENCE_HIT', 'THE_OTHER_EVIDENCE_HIT'));
  const stale = await (await fetch(resolveUrl)).json();
  assert.equal(stale.code, 'STALE_REFERENCE');
});

test('open admits only one event and context-bound handles; borrowed viewer shutdown preserves history', async (t) => {
  const running = await fixture(t);
  for (const refs of [[], [running.ref, running.ref], ['invalid']]) {
    assert.ok((await requestHistory(running.endpoint, 'open', { refs })).error);
  }
  const context = await requestHistory(running.endpoint, 'context', { refs: [running.ref], presentation: 'compact' });
  const handle = context.events.find((event) => event.excerpt.text.includes('THE_EXACT_EVIDENCE_HIT')).ref;
  assert.equal((await requestHistory(running.endpoint, 'open', { refs: [handle] })).error.code, 'CONTEXT_REQUIRED');
  assert.equal((await requestHistory(running.endpoint, 'open', { refs: [handle], contextRef: 'expired-context' })).error.code, 'CONTEXT_EXPIRED');
  const opened = await requestHistory(running.endpoint, 'open', { refs: [handle], contextRef: context.contextRef });
  assert.equal(opened.evidenceRef, running.ref);
  const range = running.ref.split('.').slice(0, 5).concat(['f', '0', '0']).join('.');
  assert.equal((await requestHistory(running.endpoint, 'open', { refs: [range] })).error.code, 'INVALID_REFERENCE');
  const foreign = running.ref.split('.'); foreign[1] = 'A'.repeat(22);
  assert.equal((await requestHistory(running.endpoint, 'open', { refs: [foreign.join('.')] })).error.code, 'REFERENCE_SCOPE_MISMATCH');
  const borrowed = running.service.createViewerServer();
  await new Promise((resolve) => borrowed.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => borrowed.close(resolve));
  assert.equal((await requestHistory(running.endpoint, 'search', { query: 'THE_EXACT_EVIDENCE_HIT' })).items.length, 1);
  assert.equal((await requestHistory(running.endpoint, 'read', { refs: [running.ref] })).items.length, 1);
});

test('viewer startup failure retains target verification and can retry', async (t) => {
  const http = require('node:http');
  let attempts = 0;
  const server = createHistoryServer({
    async execute() { return { producer: 'session-analyzer', operation: 'history.open', schemaVersion: 1, targetVerified: true, evidenceRef: 'synthetic' }; },
    createViewerServer() { if (++attempts === 1) throw new Error('synthetic start failure'); return http.createServer((req, res) => res.end('ok')); },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await server.closeViewer(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const failed = await requestHistory(endpoint, 'open', { refs: ['synthetic'] });
  assert.equal(failed.targetVerified, true);
  assert.equal(failed.viewerReady, false);
  assert.equal(failed.error.code, 'VIEWER_START_FAILED');
  assert.equal((await requestHistory(endpoint, 'open', { refs: ['synthetic'] })).viewerReady, true);
});

test('open preserves Protocol and Raw event identity instead of mapping them to Main', async (t) => {
  const running = await fixture(t);
  for (const layer of ['protocol', 'raw']) {
    const search = await requestHistory(running.endpoint, 'search', { layer, retrievalArtifacts: 'include' });
    assert.ok(search.items.length > 0, layer);
    const item = search.items[0];
    const opened = await requestHistory(running.endpoint, 'open', { refs: [item.ref] });
    assert.deepEqual(opened.target, { sessionId: item.sessionId, layer, eventId: item.eventId });
    const viewer = new URL(opened.url).origin;
    const resolved = await (await fetch(`${viewer}/api/history/resolve?ref=${encodeURIComponent(opened.evidenceRef)}`)).json();
    assert.deepEqual(resolved.target, opened.target);
  }
});

test('open revalidates durable evidence after unchanged restart and rejects a reindexed appended snapshot', async (t) => {
  const running = await fixture(t);
  const first = await requestHistory(running.endpoint, 'open', { refs: [running.ref] });
  await running.close();
  const unchanged = await startHistoryServer(running.options);
  try {
    const reopened = await requestHistory(unchanged.endpoint, 'open', { refs: [first.evidenceRef] });
    assert.equal(reopened.targetVerified, true);
    assert.equal(reopened.viewerReady, true);
    assert.deepEqual(reopened.target, first.target);
    assert.equal(reopened.evidenceRef, first.evidenceRef);
    assert.notEqual(reopened.contextRef, first.contextRef);
    assert.equal((await requestHistory(unchanged.endpoint, 'open', {
      refs: [first.evidenceRef], contextRef: first.contextRef,
    })).error.code, 'CONTEXT_EXPIRED');
  } finally { await unchanged.close(); }
  await fs.appendFile(running.sourceFile, JSON.stringify({ timestamp: '2026-09-02T00:00:00Z',
    type: 'event_msg', payload: { type: 'user_message', message: 'REINDEXED_NEW_SUFFIX' } }) + '\n');
  const appended = await startHistoryServer(running.options);
  try {
    const rejected = await requestHistory(appended.endpoint, 'open', { refs: [first.evidenceRef] });
    assert.equal(rejected.error.code, 'STALE_REFERENCE');
    assert.equal(rejected.targetVerified, false);
    assert.equal(rejected.viewerReady, false);
    assert.equal(rejected.url, undefined);
    const freshSearch = await requestHistory(appended.endpoint, 'search', { query: 'THE_EXACT_EVIDENCE_HIT' });
    assert.notEqual(freshSearch.items[0].ref, first.evidenceRef);
    assert.equal((await requestHistory(appended.endpoint, 'open', { refs: [freshSearch.items[0].ref] })).targetVerified, true);
  } finally { await appended.close(); }
});

test('open and browser resolution report stale evidence after its source is deleted', async (t) => {
  const running = await fixture(t);
  const first = await requestHistory(running.endpoint, 'open', { refs: [running.ref] });
  await fs.unlink(running.sourceFile);
  const rejected = await requestHistory(running.endpoint, 'open', { refs: [first.evidenceRef] });
  assert.equal(rejected.error.code, 'STALE_REFERENCE');
  assert.equal(rejected.targetVerified, false);
  assert.equal(rejected.url, undefined);
  const response = await fetch(`${new URL(first.url).origin}/api/history/resolve?ref=${encodeURIComponent(first.evidenceRef)}`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'STALE_REFERENCE');
});

test('history viewer scope and shutdown leave a separately owned ordinary Web instance unchanged', async (t) => {
  const running = await fixture(t);
  const index = await require('../src/source-adapters').requireSourceAdapter('codex').buildIndex({
    repoRoot: running.options.repo, sourceHome: running.options.codexHome,
  });
  const ordinary = require('../server').createServer(index, 0, { codexHome: running.options.codexHome, sessionPrewarm: false });
  await new Promise((resolve) => ordinary.listen(0, '127.0.0.1', resolve));
  try {
    const ordinaryUrl = `http://127.0.0.1:${ordinary.address().port}`;
    const before = await (await fetch(`${ordinaryUrl}/api/state`)).json();
    assert.equal(before.historyViewer, undefined);
    const opened = await requestHistory(running.endpoint, 'open', { refs: [running.ref] });
    const viewer = new URL(opened.url).origin;
    const mutation = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'deepseek-harness' }) };
    assert.equal((await fetch(`${viewer}/api/source`, mutation)).status, 403);
    assert.deepEqual(await (await fetch(`${ordinaryUrl}/api/state`)).json(), before);
    await running.server.closeViewer();
    const target = opened.target;
    const event = await (await fetch(`${ordinaryUrl}/api/sessions/${encodeURIComponent(target.sessionId)}/events/${encodeURIComponent(target.eventId)}?layer=${target.layer}`)).json();
    assert.equal(event.id, target.eventId);
    // Read-only mode has not spread to the ordinary instance, and changing that
    // instance does not change the independent history retrieval scope.
    assert.equal((await fetch(`${ordinaryUrl}/api/source`, mutation)).status, 200);
    const read = await requestHistory(running.endpoint, 'read', { refs: [opened.evidenceRef] });
    assert.equal(read.items[0].ref, opened.evidenceRef);
  } finally {
    await new Promise((resolve) => { ordinary.close(resolve); ordinary.closeAllConnections(); });
  }
});

test('only a missing exact event in a verified session offers an explicit session fallback', async (t) => {
  const running = await fixture(t);
  const opened = await requestHistory(running.endpoint, 'open', { refs: [running.ref] });
  const absent = running.ref.split('.');
  absent[6] = 'A'.repeat(22);
  const missingRef = absent.join('.');
  const expectedFallback = { sessionId: opened.target.sessionId, layer: opened.target.layer };
  const rejected = await requestHistory(running.endpoint, 'open', { refs: [missingRef] });
  assert.equal(rejected.error.code, 'INVALID_REFERENCE');
  assert.equal(rejected.targetVerified, false);
  assert.equal(rejected.viewerReady, false);
  assert.equal(rejected.url, undefined);
  assert.deepEqual(rejected.sessionFallback, expectedFallback);
  const viewer = new URL(opened.url).origin;
  const resolve = async (ref) => (await fetch(`${viewer}/api/history/resolve?ref=${encodeURIComponent(ref)}`)).json();
  const browserMissing = await resolve(missingRef);
  assert.equal(browserMissing.code, 'INVALID_REFERENCE');
  assert.equal(browserMissing.targetVerified, false);
  assert.deepEqual(browserMissing.sessionFallback, expectedFallback);
  const scope = running.ref.split('.'); scope[1] = 'A'.repeat(22);
  const snapshot = running.ref.split('.'); snapshot[3] = 'A'.repeat(22);
  const range = running.ref.split('.').slice(0, 5).concat(['f', '0', '0']).join('.');
  for (const ref of ['invalid', scope.join('.'), snapshot.join('.'), range]) {
    const error = await requestHistory(running.endpoint, 'open', { refs: [ref] });
    assert.ok(error.error);
    assert.equal(error.sessionFallback, undefined);
    assert.equal((await resolve(ref)).sessionFallback, undefined);
  }
  // Even a syntactically valid missing event must not offer a session if its
  // indexed source can no longer be verified.
  await fs.unlink(running.sourceFile);
  const stale = await requestHistory(running.endpoint, 'open', { refs: [missingRef] });
  assert.equal(stale.error.code, 'STALE_REFERENCE');
  assert.equal(stale.sessionFallback, undefined);
  assert.equal((await resolve(missingRef)).sessionFallback, undefined);
});
