'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');
const {
  buildProjectQueryStore, createProjectQueryStoreBuilder, disposeProjectQueryStore,
  projectQueryProjectionDigest, projectQueryProjectionDigestForSession,
  readProjectQueryRowPreview, scanProjectQueryShard, validateProjectQueryStoreForCommit,
} = require('../src/project-query-store');
const { createSessionQuery } = require('../src/session-query');
const { capacitySession, capacityIndex } = require('../scripts/query-capacity-fixture');
const { parsePiDocument } = require('../src/pi-storage');
const { sessionsFromPiDocument } = require('../src/pi-logical');
const { buildPiIndex, piAdapter } = require('../src/pi');

function root(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'query-shared-text-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function build(t, sessions, options = {}) {
  const directory = root(t);
  const store = buildProjectQueryStore(sessions, { memoryRows: 0, tempRoot: directory, ...options });
  t.after(() => disposeProjectQueryStore(store));
  const file = path.join(directory, fs.readdirSync(directory)[0], 'rows.bin');
  assert.equal(fs.statSync(file).size, store.accountedBytes);
  return { store, directory, file };
}

function storedRows(built, id, layer = 'main') {
  const fd = fs.openSync(built.file, 'r');
  try {
    return built.store.shardsBySessionId.get(id)[layer].pages.flatMap((page) => {
      const bytes = Buffer.alloc(page.bytes);
      fs.readSync(fd, bytes, 0, bytes.length, page.start);
      return v8.deserialize(bytes);
    });
  } finally { fs.closeSync(fd); }
}

async function decodedRows(store, id, layer) {
  const rows = [];
  await scanProjectQueryShard(store, id, layer, { includeText: true }, (row) => {
    rows.push({ ...row, preview: [...row.preview.parts()].join(''), searchText: [...row.searchText.parts()].join('') });
  });
  return rows;
}

async function assertParity(sessions, plain, shared, query = createSessionQuery()) {
  const ids = sessions.map((session) => session.id);
  const index = (store) => ({ ...capacityIndex(query, sessions, store), sourceKind: sessions[0].sourceKind });
  for (const store of [plain, shared]) await validateProjectQueryStoreForCommit(store, ids);
  for (const session of sessions) {
    assert.equal(projectQueryProjectionDigestForSession(shared, session.id), projectQueryProjectionDigestForSession(plain, session.id));
    for (const layer of ['main', 'protocol', 'raw']) {
      assert.deepEqual(await decodedRows(shared, session.id, layer), await decodedRows(plain, session.id, layer));
      const filters = { layer, q: 'needle', limit: 20, offset: 0 };
      assert.deepEqual(await query.filterSessions(index(shared), filters), await query.filterSessions(index(plain), filters));
    }
  }
}

test('opt-in disk sharing preserves complete rows, branch IDs, digests and query results across fields and layers', async (t) => {
  const sessions = ['one', 'two'].map((id) => capacitySession(id, 3, 'shared needle '.repeat(100)));
  sessions[1].logicalEvents[0].status = 'failed';
  sessions[1].logicalEvents[0].preview = 'different preview needle';
  sessions[1].logicalEvents[1].searchText = 'different needle '.repeat(100);
  const plain = build(t, sessions);
  const shared = build(t, sessions, { shareTextRanges: true });
  assert.ok(shared.store.accountedBytes < plain.store.accountedBytes);
  const a = storedRows(shared, 'one');
  const b = storedRows(shared, 'two');
  assert.deepEqual(a[0].searchText, b[0].searchText);
  assert.notDeepEqual(a[0].preview, b[0].preview);
  assert.notDeepEqual(a[0].searchText, b[1].searchText);
  assert.deepEqual(a[0].searchText, storedRows(shared, 'two', 'raw')[0].searchText);
  assert.notEqual(a[0].eventId, b[0].eventId);
  assert.equal(b[0].status, 'failed');
  await assertParity(sessions, plain.store, shared.store);
  assert.equal(await readProjectQueryRowPreview(shared.store, 'two', 'main', 0), 'different preview needle');
});

test('candidate byte comparison rejects a false hash candidate and falls back to independent storage', async (t) => {
  const directory = root(t);
  const builder = createProjectQueryStoreBuilder({ memoryRows: 0, tempRoot: directory, shareTextRanges: true });
  t.after(() => builder.dispose());
  const first = capacitySession('first', 1, 'equal length needle', ['main']);
  const second = capacitySession('second', 1, 'equal length needle', ['main']);
  builder.addSession(first);
  const originalRead = fs.readSync;
  let compared = false;
  fs.readSync = function (fd, buffer, offset, length, position) {
    const count = originalRead.call(this, fd, buffer, offset, length, position);
    if (!compared && count) { buffer[offset] ^= 1; compared = true; }
    return count;
  };
  try { builder.addSession(second); } finally { fs.readSync = originalRead; }
  assert.ok(compared, 'an existing encoded range was read rather than trusting its digest');
  const store = builder.finish();
  t.after(() => disposeProjectQueryStore(store));
  const file = path.join(directory, fs.readdirSync(directory)[0], 'rows.bin');
  const built = { store, file };
  assert.notDeepEqual(storedRows(built, 'first')[0].preview, storedRows(built, 'second')[0].preview);
  await validateProjectQueryStoreForCommit(store, ['first', 'second']);
  assert.equal(projectQueryProjectionDigestForSession(store, 'second'), projectQueryProjectionDigest(second));
  assert.deepEqual(await decodedRows(store, 'first', 'main'),
    (await decodedRows(store, 'second', 'main')).map((row) => ({ ...row, eventId: 'first:main:0', filterFiles: ['first.jsonl', 'src/capacity.js'] })));
});

test('entry and byte budgets bound candidate retention and safely fall back without changing projections', async (t) => {
  const session = capacitySession('budgets', 4, 'needle text', ['main']);
  for (const event of session.logicalEvents) event.preview = event.searchText;
  const plain = build(t, [session]);
  const shared = build(t, [session], { shareTextRanges: true, textRangeCacheEntries: 1, textRangeCacheBytes: 1024 });
  const rows = storedRows(shared, session.id);
  assert.deepEqual(rows[0].preview, rows[3].searchText, 'one candidate can serve repeated equal fields');
  assert.ok(shared.store.accountedBytes < plain.store.accountedBytes);
  for (const options of [{ textRangeCacheEntries: 0 }, { textRangeCacheBytes: 0 }, { textRangeCacheBytes: 1 }]) {
    const disabled = build(t, [session], { shareTextRanges: true, ...options });
    assert.equal(disabled.store.accountedBytes, plain.store.accountedBytes);
    await assertParity([session], plain.store, disabled.store);
  }
  const alternating = capacitySession('eviction', 3, 'BBBB needle', ['main']);
  for (const event of alternating.logicalEvents) event.preview = 'AAAA needle';
  for (const options of [{ textRangeCacheEntries: 1 }, { textRangeCacheBytes: 200 }]) {
    const evicted = build(t, [alternating], { shareTextRanges: true, ...options });
    const references = storedRows(evicted, alternating.id);
    assert.notDeepEqual(references[0].preview, references[2].preview, 'intervening candidate evicts the earlier range');
    assert.equal(projectQueryProjectionDigestForSession(evicted.store, alternating.id), projectQueryProjectionDigest(alternating));
  }
  for (const value of [-1, Infinity, NaN, 0.5]) {
    const directory = root(t);
    for (const name of ['textRangeCacheEntries', 'textRangeCacheBytes']) {
      assert.throws(() => buildProjectQueryStore([session], { memoryRows: 0, tempRoot: directory,
        shareTextRanges: true, [name]: value }), { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' });
      assert.deepEqual(fs.readdirSync(directory), []);
    }
  }
});

test('streamed UTF-8 equality handles surrogate boundaries, replacement encoding, empty and large fields', async (t) => {
  const values = ['', '\ud800', '\ufffd', `${'a'.repeat(65535)}😀中文 needle`,
    `${'b'.repeat(2 * 1024 * 1024)}😀 tail needle`];
  const session = capacitySession('utf8', values.length * 2, '', ['main']);
  session.logicalEvents.forEach((event, index) => { event.preview = ''; event.searchText = values[index % values.length]; });
  const plain = build(t, [session]);
  const shared = build(t, [session], { shareTextRanges: true });
  const rows = storedRows(shared, session.id);
  for (let index = 0; index < values.length; index += 1) assert.deepEqual(rows[index].searchText, rows[index + values.length].searchText);
  assert.deepEqual(rows[1].searchText, rows[2].searchText, 'different UTF-16 strings with equal encoded bytes can share');
  assert.ok(shared.store.accountedBytes < plain.store.accountedBytes);
  await assertParity([session], plain.store, shared.store);
});

test('async spilling transfers previous memory rows and preserves completed-builder behavior', async (t) => {
  const directory = root(t);
  const sessions = ['before', 'spill', 'after'].map((id) => capacitySession(id, 1, 'shared needle', ['main']));
  const builder = createProjectQueryStoreBuilder({ memoryRows: 1, tempRoot: directory, shareTextRanges: true });
  await builder.addSessionAsync(sessions[0]);
  assert.deepEqual(fs.readdirSync(directory), []);
  await builder.addSessionAsync(sessions[1]);
  await builder.addSessionAsync(sessions[2]);
  const store = builder.finish();
  t.after(() => disposeProjectQueryStore(store));
  assert.throws(() => builder.addSession(sessions[0]), { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' });
  const file = path.join(directory, fs.readdirSync(directory)[0], 'rows.bin');
  assert.deepEqual(storedRows({ store, file }, 'before')[0].searchText, storedRows({ store, file }, 'after')[0].searchText);
  const plain = build(t, sessions);
  await assertParity(sessions, plain.store, store);
});

test('hash and comparison cancellation and read failures remove only the failed candidate storage', async (t) => {
  const directory = root(t);
  const committed = buildProjectQueryStore([capacitySession('committed')], { memoryRows: 0, tempRoot: directory });
  t.after(() => disposeProjectQueryStore(committed));
  const large = capacitySession('large', 1, 'z'.repeat(2 * 1024 * 1024), ['main']);
  const reason = new Error('cancel shared encoding work');
  for (const phase of ['hash', 'comparison', 'read-error']) {
    const controller = new AbortController();
    const builder = createProjectQueryStoreBuilder({ memoryRows: 0, tempRoot: directory,
      shareTextRanges: true, signal: controller.signal });
    const originalRead = fs.readSync;
    try {
      if (phase !== 'hash') {
        builder.addSession(large);
        fs.readSync = function (...args) {
          if (phase === 'read-error') { const error = new Error('synthetic read resource failure'); error.code = 'ENOMEM'; throw error; }
          const count = originalRead.apply(this, args);
          // Skip the small preview; abort after a large candidate is read.
          if (args[3] >= 65536) setImmediate(() => controller.abort(reason));
          return count;
        };
      } else { setImmediate(() => controller.abort(reason)); }
      const candidate = { ...large, id: `${large.id}-${phase}` };
      if (phase === 'read-error') await assert.rejects(builder.addSessionAsync(candidate), { code: 'PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED' });
      else await assert.rejects(builder.addSessionAsync(candidate), (error) => error === reason);
    } finally { fs.readSync = originalRead; builder.dispose(); }
    assert.equal(fs.readdirSync(directory).length, 1);
  }
  const query = createSessionQuery();
  assert.equal((await query.filterSessions(capacityIndex(query, [capacitySession('committed')], committed), { layer: 'main', q: 'needle' })).total, 1);
});

test('pi shared requests retain sibling outcomes and descendant pairing ambiguity on shared disk ranges', async (t) => {
  const message = (id, parentId, value) => ({ type: 'message', id, parentId, message: value });
  const rows = [{ type: 'session', version: 3, id: 'paired-sharing', cwd: '/synthetic' },
    message('user', null, { role: 'user', content: 'shared needle prompt' }),
    message('request', 'user', { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo needle' } }] }),
    message('success', 'request', { role: 'toolResult', toolCallId: 'call', toolName: 'bash', isError: false, content: 'successful needle output' }),
    { type: 'label', id: 'good', parentId: 'success', targetId: 'success', label: 'unique successful branch' },
    message('failure', 'request', { role: 'toolResult', toolCallId: 'call', toolName: 'bash', isError: true, content: 'failed needle output' }),
    message('duplicate', 'success', { role: 'toolResult', toolCallId: 'call', toolName: 'bash', isError: false, content: 'duplicate result' })];
  const document = parsePiDocument({ lines: rows.map((row) => JSON.stringify(row)) });
  const sessions = sessionsFromPiDocument(document, 'branches.jsonl');
  const expected = { good: 'success', failure: 'failed', duplicate: 'incomplete' };
  for (const session of sessions) {
    const call = session.logicalEvents.find((event) => event.pi?.callId === 'call');
    assert.equal(call.status, expected[session.sourceDerivedId]);
    assert.equal(call.rawRefs.length, session.sourceDerivedId === 'duplicate' ? 1 : 2);
  }
  const options = { presentationForEvent: piAdapter.query.projectQueryPresentation };
  const plain = build(t, sessions, options);
  const shared = build(t, sessions, { ...options, shareTextRanges: true });
  await assertParity(sessions, plain.store, shared.store, piAdapter.query);
  const calls = sessions.map((session) => storedRows(shared, session.id).find((row) => row.toolName === 'bash'));
  assert.deepEqual(calls[0].preview, calls[1].preview);
  assert.equal(new Set(calls.map((row) => row.searchText.start)).size, 3);
  const rawRequests = sessions.map((session) => storedRows(shared, session.id, 'raw').find((row) => row.eventId.endsWith(':raw:3')));
  assert.deepEqual(rawRequests[0].searchText, rawRequests[1].searchText);
  assert.deepEqual(rawRequests[1].searchText, rawRequests[2].searchText);
});

test('pi index opts into disk sharing while small pi indexes keep the existing memory representation', async (t) => {
  const home = root(t);
  fs.mkdirSync(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', 'history.jsonl');
  const rows = [{ type: 'session', version: 3, id: 'index-sharing', cwd: home },
    { type: 'message', id: 'root', parentId: null, message: { role: 'user', content: 'needle' } }];
  fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n');
  const small = await buildPiIndex({ sourceHome: home, repoRoot: home });
  assert.equal(small.projectQueryStore.schemaVersion, 2);
  rows[1].message.content = `${'x'.repeat(4 * 1024 * 1024)} needle`;
  rows.push({ type: 'label', id: 'a', parentId: 'root', targetId: 'root', label: 'A' },
    { type: 'label', id: 'b', parentId: 'root', targetId: 'root', label: 'B' });
  fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n');
  const index = await buildPiIndex({ sourceHome: home, repoRoot: home });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  assert.equal(index.projectQueryStore.schemaVersion, 3);
  const sessions = sessionsFromPiDocument(parsePiDocument({ lines: rows.map(JSON.stringify) }), 'history.jsonl');
  const plain = build(t, sessions, { presentationForEvent: piAdapter.query.projectQueryPresentation });
  assert.ok(index.projectQueryStore.accountedBytes < plain.store.accountedBytes);
  for (const session of index.sessions) assert.equal(session.queryProjectionDigest,
    projectQueryProjectionDigestForSession(plain.store, session.id));
});
