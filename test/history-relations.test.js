'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHistoryService } = require('../src/history-service');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-relations-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  await fs.mkdir(repo);
  await fs.mkdir(path.join(home, 'sessions'));
  async function write(id, metadata = {}, text = 'child implementation') {
    const rows = [{ type: 'session_meta', payload: { id, cwd: repo, ...metadata } }];
    if (text !== null) rows.push({ type: 'event_msg', payload: { type: 'user_message', message: text } });
    await fs.writeFile(path.join(home, 'sessions', `${id}.jsonl`), rows.map((row) =>
      JSON.stringify({ timestamp: '2026-10-22T00:00:00Z', ...row })).join('\n') + '\n');
  }
  async function service() {
    const value = await createHistoryService({ repo, codexHome: home });
    t.after(() => value.close());
    return value;
  }
  return { repo, write, service };
}

const parent = (id) => ({ source: { subagent: { thread_spawn: { parent_thread_id: id } } } });
async function context(service, sessionId, presentation = 'full') {
  const hit = await service.execute('search', { query: 'child implementation', session: sessionId });
  assert.equal(hit.items.length, 1);
  return service.execute('context', { refs: [hit.items[0].ref], presentation });
}

test('context follows an explicit parent to constraints through full and compact refs', async (t) => {
  const f = await fixture(t);
  await f.write('parent', {}, 'Keep exact counts; reject the approximate alternative.');
  await f.write('child', parent('parent'));
  const service = await f.service();
  for (const presentation of ['full', 'compact']) {
    const response = await context(service, 'child', presentation);
    const window = response.items[0];
    assert.deepEqual(window.unavailableRelatedSessions, []);
    assert.equal(window.relatedSessions.length, 1);
    const relation = window.relatedSessions[0];
    assert.equal(relation.relation, 'parentSessionId');
    assert.equal(relation.sessionId, 'parent');
    const target = await service.execute('context', { refs: [relation.ref], contextRef: response.contextRef });
    assert.equal(target.items[0].events[0].sessionId, 'parent');
    const read = await service.execute('read', { refs: [target.items[0].events[0].ref], parts: ['projection'] });
    assert.match(read.items[0].parts[0].text, /Keep exact counts; reject the approximate alternative/u);
  }
  const relation = (await context(service, 'child')).items[0].relatedSessions[0];
  await f.write('parent', {}, 'Rewritten parent source');
  await assert.rejects(service.execute('context', { refs: [relation.ref] }), { code: 'STALE_REFERENCE' });
});

test('context reports explicit missing and out-of-project targets without inventing refs', async (t) => {
  const f = await fixture(t);
  await f.write('child', parent('missing'));
  await f.write('fork-child', { forked_from_id: 'missing-fork' });
  await f.write('outside-child', parent('outside'));
  await f.write('outside', { cwd: path.join(f.repo, '..', 'different-project') });
  const service = await f.service();
  for (const [child, target, relation] of [['child', 'missing', 'parentSessionId'],
    ['outside-child', 'outside', 'parentSessionId'], ['fork-child', 'missing-fork', 'forkedFromSessionId']]) {
    for (const presentation of ['full', 'compact']) {
      const window = (await context(service, child, presentation)).items[0];
      assert.deepEqual(window.relatedSessions, []);
      assert.equal(window.unavailableRelatedSessions.length, 1);
      const entry = window.unavailableRelatedSessions[0];
      assert.equal(entry.relation, relation);
      assert.equal(entry.sessionId, target);
      assert.equal(entry.reason, 'target_not_indexed');
      assert.equal('ref' in entry, false);
      assert.match(entry.message, /snapshot/u);
      assert.match(entry.message, /scope/u);
    }
  }
});

test('context distinguishes indexed targets without Main records from unknown targets', async (t) => {
  const f = await fixture(t);
  await f.write('empty-parent', {}, null);
  await f.write('child', parent('empty-parent'));
  const service = await f.service();
  assert.equal((await service.execute('status')).coverage.sessionCount, 2);
  const window = (await context(service, 'child')).items[0];
  assert.deepEqual(window.relatedSessions, []);
  assert.equal(window.unavailableRelatedSessions[0].reason, 'target_has_no_main_events');
  assert.equal(window.unavailableRelatedSessions[0].sessionId, 'empty-parent');
  // The target is admitted and its original metadata remains searchable on Raw.
  const raw = await service.execute('search', { query: 'empty-parent', session: 'empty-parent', layer: 'raw' });
  assert.equal(raw.items.length, 1);
  assert.equal((await service.execute('read', { refs: [raw.items[0].ref], parts: ['raw'] })).items.length, 1);
});

test('absence of recorded relationships stays distinct from an unavailable relationship', async (t) => {
  const f = await fixture(t);
  await f.write('ordinary');
  const window = (await context(await f.service(), 'ordinary')).items[0];
  assert.deepEqual(window.relatedSessions, []);
  assert.deepEqual(window.unavailableRelatedSessions, []);
});

test('context still excludes inferred review parents from both relationship lists', async (t) => {
  const service = await createHistoryService({ repo: 'G:\\vibe\\term-agent',
    codexHome: path.join(__dirname, 'fixtures', 'codex-home') });
  t.after(() => service.close());
  // This shared source fixture has a unique inferred review parent; parser tests
  // separately verify parentSessionInferred=true rather than explicit metadata.
  const id = '66666666-6666-6666-6666-666666666666';
  const hit = await service.execute('search', { session: id, layer: 'raw', query: id });
  assert.ok(hit.items.length);
  const window = (await service.execute('context', { refs: [hit.items[0].ref] })).items[0];
  assert.equal(window.relatedSessions.some((entry) => entry.relation === 'parentSessionId'), false);
  assert.equal(window.unavailableRelatedSessions.some((entry) => entry.relation === 'parentSessionId'), false);
});
