'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { zstdCompressSync } = require('node:zlib');
const codex = require('../src/codex');
const { materializeSessionForIndex, buildEventDetailForSession } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createServer } = require('../server');

async function fixture(t, compressed) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'configuration-detail-'));
  const indexes = [], servers = [];
  t.after(async () => {
    for (const server of servers) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    for (const index of indexes) disposeProjectQueryStore(index.projectQueryStore);
    const target = path.resolve(home);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('configuration-detail-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot); await fs.mkdir(path.join(home, 'sessions'));
  const rows = [
    { type: 'session_meta', payload: { id: 'session', cwd: repoRoot } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-a' } },
    { type: 'turn_context', payload: { turn_id: 'turn-a', model: 'model-a', effort: 'low' } },
    { type: 'response_item', payload: { type: 'configuration_update', reasoning: { effort: 'high' } }, metadata: { harness_authored_configuration: false } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'OWN_REQUEST' } },
  ];
  const original = rows.map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ...row })).join('\n') + '\n';
  const encode = content => compressed ? zstdCompressSync(Buffer.from(content)) : Buffer.from(content);
  const file = path.join(home, 'sessions', `rollout-session.jsonl${compressed ? '.zst' : ''}`);
  await fs.writeFile(file, encode(original));
  const build = async (sourceBacked = true) => {
    const index = await (sourceBacked ? codex.buildSourceBackedIndex : codex.buildIndex)({ codexHome: home, repoRoot });
    indexes.push(index); return index;
  };
  const rewrite = async changed => {
    const before = await fs.stat(file, { bigint: true });
    const handle = await fs.open(file, 'r+');
    try { const bytes = encode(changed); await handle.write(bytes, 0, bytes.length, 0); await handle.truncate(bytes.length); }
    finally { await handle.close(); }
    const after = await fs.stat(file, { bigint: true });
    assert.equal(before.ino, after.ino);
    if (!compressed) assert.equal(before.size, after.size);
  };
  const serve = async index => {
    let materializations = 0;
    const server = createServer(index, 0, { sessionPrewarm: false, materializeSession: async (...args) => {
      materializations++; return materializeSessionForIndex(...args);
    } });
    servers.push(server); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const eventId = 'session:logical:user:5';
    const request = async (layer = 'main', id = eventId) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/session/events/${encodeURIComponent(id)}/detail?layer=${layer}`);
      return { status: response.status, body: await response.json() };
    };
    return { request, materializations: () => materializations };
  };
  return { file, original, build, rewrite, serve };
}

for (const compressed of [false, true]) for (const mutation of ['context', 'owner', 'untrusted', 'delete']) {
  test(`cached configuration detail rejects changed ${mutation} evidence, zstd=${compressed}`, async t => {
    const f = await fixture(t, compressed);
    const index = await f.build();
    const server = await f.serve(index);
    const warm = await server.request();
    assert.equal(warm.status, 200);
    const configuration = warm.body.inspectorSections.find(s => s.type === 'recorded_configuration');
    assert.deepEqual(configuration.observations.map(o => o.kind), ['turn_context']);
    assert.equal(configuration.observations[0].model.value, 'model-a');
    const before = server.materializations();
    if (mutation === 'delete') await fs.unlink(f.file);
    else {
      const changed = mutation === 'context' ? f.original.replace('"model":"model-a"', '"model":"model-b"')
        : mutation === 'owner' ? f.original.replace('"turn_id":"turn-a"', '"turn_id":"turn-b"')
          : f.original.replace('"harness_authored_configuration":false', '"harness_authored_configuration":true ');
      assert.notEqual(changed, f.original); assert.equal(Buffer.byteLength(changed), Buffer.byteLength(f.original));
      await f.rewrite(changed);
    }
    const result = await server.request();
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'INDEXED_SOURCE_STALE');
    assert.equal(server.materializations(), before, 'verification must run on a materialized cache hit');
    if (mutation === 'context') {
      const refreshed = await f.serve(await f.build());
      const detail = await refreshed.request(); assert.equal(detail.status, 200);
      assert.equal(detail.body.inspectorSections.find(s => s.type === 'recorded_configuration').observations[0].model.value, 'model-b');
    }
  });
}

test('configuration detail keeps snapshot append semantics, raw detail and resident/hydrated output parity', async t => {
  const f = await fixture(t, false);
  const resident = await f.build(false), strict = await f.build();
  const session = resident.sessionsById.get('session');
  const eventId = 'session:logical:user:5';
  const before = await buildEventDetailForSession(resident, session, eventId, 'main');
  const server = await f.serve(strict);
  assert.deepEqual((await server.request()).body, before);
  const totals = JSON.stringify(strict.totals);
  await fs.appendFile(f.file, JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-a', model: 'later', effort: 'high' } }) + '\n');
  assert.deepEqual((await server.request()).body, before, 'append cannot silently extend accepted evidence');
  assert.equal(JSON.stringify(strict.totals), totals);
  const raw = await server.request('raw', 'session:raw:3'); assert.equal(raw.status, 200);
  assert.ok(!raw.body.inspectorSections?.some(s => s.type === 'recorded_configuration'));
  const refreshed = await f.build();
  assert.notEqual(refreshed.codexConfiguration, strict.codexConfiguration);
});
