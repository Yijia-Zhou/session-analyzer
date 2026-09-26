'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHistoryService } = require('../src/history-service');

// Real synthetic Codex files exercise indexing, source projections and artifact
// recognition together. A long recent discussion must not hide older constraints.
async function corpus(t, { echoes = false } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-diversity-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  const directory = path.join(home, 'sessions', '2026', '09');
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(directory, { recursive: true });
  for (const [label, day, count, id] of [
    ['newest', '03', 120, '33333333-3333-4333-8333-333333333333'],
    ['middle', '02', 1, '22222222-2222-4222-8222-222222222222'],
    ['oldest', '01', 1, '11111111-1111-4111-8111-111111111111'],
  ]) {
    const rows = [];
    const start = Date.parse(`2026-09-${day}T00:00:00Z`);
    const add = (type, payload) => rows.push({ timestamp: new Date(start + rows.length * 1000).toISOString(), type, payload });
    add('session_meta', { id, cwd: repo, originator: 'codex_cli' });
    if (echoes && label === 'newest') {
      add('response_item', { type: 'function_call', name: 'exec_command', call_id: 'retrieval-echo',
        arguments: JSON.stringify({ cmd: 'session-analyzer history search --query DECISION_TOKEN' }) });
      add('response_item', { type: 'function_call_output', call_id: 'retrieval-echo', output: 'DECISION_TOKEN copied search evidence.' });
    }
    for (let number = 0; number < count; number += 1) {
      add('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text',
        text: `DECISION_TOKEN ${label} constraint marker-${String(number).padStart(3, '0')}.` }] });
    }
    await fs.writeFile(path.join(directory, `rollout-2026-09-${day}T00-00-00-${id}.jsonl`), rows.map(JSON.stringify).join('\n') + '\n');
  }
  const service = await createHistoryService({ repo, source: 'codex', codexHome: home });
  t.after(() => service.close());
  return service;
}

const labelOf = (item) => /DECISION_TOKEN (newest|middle|oldest)/.exec(item.excerpt.text)?.[1];

async function collect(service, input, budgets = [{ limit: 7, maxBytes: 24000 }]) {
  const items = [];
  const cursors = new Set();
  let cursor;
  let pages = 0;
  do {
    const budget = budgets[pages % budgets.length];
    const page = await service.execute('search', { ...input, ...budget, ...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= budget.maxBytes);
    assert.ok(page.items.length > 0);
    items.push(...page.items);
    pages += 1;
    assert.ok(pages <= 123, 'pagination must make bounded progress');
    if (!page.hasMore) break;
    assert.ok(page.nextCursor);
    assert.ok(!cursors.has(page.nextCursor), 'cursor must advance');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);
  assert.equal(new Set(items.map((item) => item.ref)).size, items.length, 'no duplicate evidence');
  return { items, pages };
}

test('default diverse search exposes older constraints and paginates all matches beyond 100', async (t) => {
  const service = await corpus(t);
  const input = { queries: ['DECISION_TOKEN'] };
  const first = await service.execute('search', { ...input, limit: 3 });
  assert.deepEqual(first.items.map(labelOf), ['newest', 'middle', 'oldest']);
  assert.equal(first.scan.order, 'diverse');
  assert.equal(first.scan.matchedEvents, 122);
  assert.equal(first.scan.matchedSessions, 3);
  assert.equal(first.scan.scopedSessions, 3);
  const grouped = await service.execute('search', { ...input, order: 'session', limit: 3 });
  assert.deepEqual(grouped.items.map(labelOf), ['newest', 'newest', 'newest']);
  assert.equal(grouped.scan.order, 'session');
  const diverse = (await collect(service, input, [{ limit: 100, maxBytes: 1048576 }, { limit: 5, maxBytes: 9000 }])).items;
  const session = (await collect(service, { ...input, order: 'session' }, [{ limit: 11, maxBytes: 24000 }])).items;
  assert.equal(diverse.length, 122);
  assert.equal(session.length, 122);
  assert.deepEqual(new Set(diverse.map((item) => item.ref)), new Set(session.map((item) => item.ref)));
  assert.deepEqual(session.slice(-2).map(labelOf), ['middle', 'oldest']);
  assert.deepEqual(diverse.filter((item) => labelOf(item) === 'newest').map((item) => item.ref), session.slice(0, 120).map((item) => item.ref));
});

test('session scope uses returned IDs and composes with the same search predicates', async (t) => {
  const service = await corpus(t);
  const first = await service.execute('search', { queries: ['DECISION_TOKEN'], limit: 3 });
  const session = first.items[0].sessionId;
  const input = { session, queries: ['DECISION_TOKEN'], kind: 'assistant_message', exclude: ['marker-001'],
    from: '2026-09-03T00:00:00Z', to: '2026-09-03T00:03:00Z', file: 'rollout-2026-09-03', retrievalArtifacts: 'exclude' };
  const scoped = await service.execute('search', { ...input, limit: 100, maxBytes: 1048576 });
  assert.equal(scoped.scan.scopedSessions, 1);
  assert.equal(scoped.scan.matchedSessions, 1);
  assert.equal(scoped.scan.matchedEvents, 119);
  const all = (await collect(service, input)).items;
  assert.equal(all.length, 119);
  assert.ok(all.every((item) => item.sessionId === session && !item.excerpt.text.includes('marker-001')));
  for (const predicate of [{ queries: ['missing'] }, { exclude: ['DECISION_TOKEN'] }, { kind: 'user_message' },
    { status: 'failed' }, { tool: 'exec_command' }, { file: 'rollout-2026-09-01' }, { to: '2026-09-02T23:59:59Z' }]) {
    const result = await service.execute('search', { session, queries: ['DECISION_TOKEN'], ...predicate });
    assert.equal(result.scan.matchedEvents, 0, JSON.stringify(predicate));
    assert.equal(result.scan.scopedSessions, 1);
    assert.equal(result.scan.matchedSessions, 0);
  }
  await assert.rejects(service.execute('search', { session: 'unknown-session', queries: ['missing'] }), { code: 'UNKNOWN_SESSION' });
});

test('search cursors bind order, scope and predicates while allowing changing page budgets', async (t) => {
  const service = await corpus(t);
  const input = { queries: ['DECISION_TOKEN'] };
  const first = await service.execute('search', { ...input, limit: 3 });
  for (const changed of [{ order: 'session' }, { session: first.items[0].sessionId }, { kind: 'assistant_message' }, { exclude: ['marker-001'] }]) {
    await assert.rejects(service.execute('search', { ...input, ...changed, cursor: first.nextCursor }), { code: 'INVALID_CURSOR' });
  }
  const scoped = await service.execute('search', { ...input, session: first.items[0].sessionId, limit: 1 });
  await assert.rejects(service.execute('search', { ...input, session: first.items[1].sessionId, cursor: scoped.nextCursor }), { code: 'INVALID_CURSOR' });
  await assert.rejects(service.execute('search', { ...input, cursor: scoped.nextCursor }), { code: 'INVALID_CURSOR' });
  const explicitDefault = await service.execute('search', { ...input, order: 'diverse', cursor: first.nextCursor, limit: 1 });
  assert.equal(labelOf(explicitDefault.items[0]), 'newest');
  for (const order of ['diverse', 'session']) {
    const expected = (await collect(service, { ...input, order }, [{ limit: 100, maxBytes: 1048576 }])).items;
    const tiny = await collect(service, { ...input, order }, [{ limit: 100, maxBytes: 4096 }, { limit: 1, maxBytes: 8192 }, { limit: 17, maxBytes: 4096 }]);
    assert.ok(tiny.pages > 10);
    assert.deepEqual(tiny.items.map((item) => item.ref), expected.map((item) => item.ref));
  }
  for (const order of ['invalid', '', 3]) await assert.rejects(service.execute('search', { order }), { code: 'INVALID_ARGUMENT' });
  for (const session of ['', 3]) await assert.rejects(service.execute('search', { session }), { code: 'INVALID_ARGUMENT' });
});

test('retrieval echoes are excluded before assigning per-session matching ordinals', async (t) => {
  const service = await corpus(t, { echoes: true });
  const input = { queries: ['DECISION_TOKEN'], limit: 4 };
  const excluded = await service.execute('search', input);
  assert.deepEqual(excluded.items.map(labelOf), ['newest', 'middle', 'oldest', 'newest']);
  assert.equal(excluded.scan.matchedEvents, 122);
  assert.equal(excluded.scan.retrievalArtifacts.excluded, 1);
  const included = await service.execute('search', { ...input, retrievalArtifacts: 'include' });
  assert.equal(included.scan.matchedEvents, 123);
  assert.equal(included.items[0].retrievalArtifact, true);
  assert.deepEqual(included.items.slice(1).map(labelOf), ['middle', 'oldest', 'newest']);
  const only = await service.execute('search', { ...input, retrievalArtifacts: 'only' });
  assert.equal(only.scan.matchedSessions, 1);
  assert.equal(only.items.length, 1);
  assert.equal(only.items[0].retrievalArtifact, true);
});
