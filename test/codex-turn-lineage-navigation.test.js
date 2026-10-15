'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { zstdCompressSync } = require('node:zlib');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createServer } = require('../server');

for (const compressed of [false, true]) {
  for (const sameSession of [false, true]) {
    test(`cached turn navigation verifies ownership: zstd=${compressed}, sameSession=${sameSession}`, async () => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lineage-navigation-'));
      let index, server;
      try {
        const repoRoot = path.join(home, 'repo');
        await fs.mkdir(repoRoot);
        await fs.mkdir(path.join(home, 'sessions'));
        const start = (turn_id, parent_turn_id) => ({ type: 'event_msg', payload: {
          type: 'task_started', turn_id, ...(parent_turn_id ? {
            root_turn_id: parent_turn_id,
            turn_attribution: { turn_id, parent_turn_id, root_turn_id: parent_turn_id },
          } : {}),
        } });
        const message = (text) => ({ type: 'event_msg', payload: { type: 'user_message', message: text } });
        const rows = (id, events) => [{ type: 'session_meta', payload: { id, cwd: repoRoot } }, ...events]
          .map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ...row }))
          .join('\n') + '\n';
        const childRows = [start('child-turn', 'parent-turn'), message('child request')];
        const parentRows = [start('parent-turn'), message('parent request')];
        if (sameSession) parentRows.push(...childRows);
        const original = rows('parent', parentRows);
        const encode = (text) => compressed ? zstdCompressSync(Buffer.from(text)) : Buffer.from(text);
        const parentFile = path.join(home, 'sessions', `rollout-parent.jsonl${compressed ? '.zst' : ''}`);
        await fs.writeFile(parentFile, encode(original));
        if (!sameSession) await fs.writeFile(path.join(home, 'sessions', 'rollout-child.jsonl'), rows('child', childRows));
        index = await codex.buildSourceBackedIndex({ codexHome: home, repoRoot });
        const ownerId = sameSession ? 'parent' : 'child';
        const eventId = Object.entries(index.codexTurnLineage.sessions[ownerId].events)
          .find(([id, turn]) => id.includes(':logical:user:') && turn === 'child-turn')[0];
        let materializations = 0;
        server = createServer(index, 0, { sessionPrewarm: false, materializeSession: async (...args) => {
          materializations++;
          return materializeSessionForIndex(...args);
        } });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const jump = async (relation) => {
          const query = new URLSearchParams({ relation, source: 'codex', repoRoot, indexRevision: '1' });
          const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/${ownerId}/events/${encodeURIComponent(eventId)}/turn-lineage?${query}`);
          return { status: response.status, body: await response.json() };
        };
        for (const relation of ['parent', 'root']) {
          const result = await jump(relation);
          assert.equal(result.status, 200);
          assert.equal(result.body.turnId, 'parent-turn');
        }
        const warmedMaterializations = materializations;
        if (!compressed) {
          // Appends outside the accepted snapshot must remain navigable.
          await fs.appendFile(parentFile, JSON.stringify(message('later append')) + '\n');
          assert.equal((await jump('parent')).status, 200);
        }
        const changed = original.replace('"turn_id":"parent-turn"', '"turn_id":"absent-turn"');
        assert.notEqual(changed, original);
        assert.equal(Buffer.byteLength(changed), Buffer.byteLength(original));
        const before = await fs.stat(parentFile, { bigint: true });
        const handle = await fs.open(parentFile, 'r+');
        try {
          const bytes = encode(changed);
          await handle.write(bytes, 0, bytes.length, 0);
          if (compressed) await handle.truncate(bytes.length);
        } finally { await handle.close(); }
        const after = await fs.stat(parentFile, { bigint: true });
        assert.equal(before.ino, after.ino);
        if (!compressed) assert.equal(before.size, after.size);
        for (const relation of ['parent', 'root']) {
          const result = await jump(relation);
          assert.equal(result.status, 409, `${relation} must reject changed ownership`);
          assert.equal(result.body.code, 'INDEXED_SOURCE_STALE');
        }
        assert.equal(materializations, warmedMaterializations, 'requests must hit the materialized cache');
      } finally {
        if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
        if (index) disposeProjectQueryStore(index.projectQueryStore);
        const target = path.resolve(home);
        assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
        assert.ok(path.basename(target).startsWith('lineage-navigation-'));
        await fs.rm(target, { recursive: true, force: true });
      }
    });
  }
}
