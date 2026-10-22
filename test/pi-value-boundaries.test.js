'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { piAdapter, buildPiIndex, discoverPiProjects } = require('../src/pi');
const { iso } = require('../src/pi-logical');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');

const timestamp = '2026-10-22T12:00:00.000Z';
const deepJson = '['.repeat(10000) + '0' + ']'.repeat(10000);
const message = (id, parentId, content, role = 'user') => ({
  type: 'message', id, parentId, timestamp, message: { role, content },
});
async function fixture(t, rows, headerFields = {}, replacement = deepJson) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-boundaries-'));
  t.after(() => fs.rm(sourceHome, { recursive: true, force: true }));
  const repoRoot = path.join(sourceHome, 'project');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(sourceHome, 'sessions'));
  const header = { type: 'session', version: 3, id: 'boundary', cwd: repoRoot, timestamp, ...headerFields };
  const text = [header, ...rows].map((row) => JSON.stringify(row).replaceAll('"DEEP_VALUE"', replacement)).join('\n') + '\n';
  const file = path.join(sourceHome, 'sessions', 'boundary.jsonl');
  await fs.writeFile(file, text);
  await fs.writeFile(path.join(sourceHome, 'sessions', 'healthy.jsonl'),
    [JSON.stringify({ ...header, id: 'healthy', timestamp }), JSON.stringify(message('h', null, 'HEALTHY_SIBLING'))].join('\n') + '\n');
  return { sourceHome, repoRoot, text, file };
}
async function indexed(t, f) {
  const index = await buildPiIndex(f);
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  assert.equal(index.sessions.length, 2, 'bad field must not prevent its session or a sibling from indexing');
  const session = await materializeSessionForIndex(index, index.sessions.find((s) => s.sourceSessionId === 'boundary'));
  return { index, session };
}
async function verifyReadback(index, session, f) {
  for (const event of session.logicalEvents) {
    const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
    assert.ok(detail);
    assert.doesNotThrow(() => JSON.stringify(detail));
  }
  for (const raw of session.rawEvents) {
    assert.ok(await buildEventDetailForSession(index, session, raw.rawId, 'raw'));
    const result = await readIndexedRawRecord(index, session, raw.rawId);
    assert.equal(result.raw, f.text.split('\n')[raw.line - 1]);
    assert.doesNotThrow(() => JSON.stringify(result));
  }
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
}

test('pi timestamp normalization rejects unsupported shapes before coercion', () => {
  for (const value of [JSON.parse(deepJson), { toString: null }, [], [0], {}, true, false, null, undefined]) {
    assert.equal(iso(value), '');
  }
  for (const value of ['', 'not-a-date', NaN, Infinity, 9e15]) assert.equal(iso(value), '');
  assert.equal(iso(0), '1970-01-01T00:00:00.000Z');
  assert.equal(iso(timestamp), timestamp);
  assert.equal(iso('2026-10-22T20:00:00+08:00'), timestamp);
});

for (const location of ['header', 'entry', 'message']) {
  test(`pi deep ${location} timestamp keeps discovery, indexing and all readback available`, async (t) => {
    const row = message('u', null, 'READABLE_MESSAGE');
    if (location === 'entry') row.timestamp = 'DEEP_VALUE';
    if (location === 'message') { delete row.timestamp; row.message.timestamp = 'DEEP_VALUE'; }
    const f = await fixture(t, [row], location === 'header' ? { timestamp: 'DEEP_VALUE' } : {});
    assert.equal((await discoverPiProjects(f))[0].sessionCount, 2);
    const { index, session } = await indexed(t, f);
    assert.equal(session.rawEvents[location === 'header' ? 0 : 1].timestamp, '');
    assert.equal(session.startedAt, location === 'header' ? '' : timestamp);
    assert.equal(session.updatedAt, timestamp);
    await verifyReadback(index, session, f);
  });
}

for (const [label, value] of [['deep array', deepJson], ['structured object', '{"toString":null}'], ['boolean', 'false']]) {
  test(`pi invalid ${label} parent ID keeps Protocol Detail and exact Raw readable`, async (t) => {
    const f = await fixture(t, [message('u', 'DEEP_VALUE', 'INVALID_PARENT_EVIDENCE')], {}, value);
    const { index, session } = await indexed(t, f);
    assert.equal(session.sourceDerivedId, 'invalid-tree');
    assert.ok(session.logicalEvents.every((event) => event.layer === 'protocol'));
    const event = session.logicalEvents.find((event) => event.rawRefs[0].line === 2);
    const detail = await buildEventDetailForSession(index, session, event.id, 'protocol');
    const parent = detail.inspectorSections.flatMap((section) => section.entries || []).find((item) => item.key === 'Parent entry id');
    assert.match(parent.value, /invalid parent id/i);
    await verifyReadback(index, session, f);
  });
}

test('pi unsupported context metadata stays readable without implicit object conversion', async (t) => {
  const row = message('u', null, 'CONTEXT_METADATA_EVIDENCE', 'assistant');
  row.message.provider = { toString: null };
  row.message.model = 'DEEP_VALUE';
  row.message.api = { toString: 'not a method' };
  row.message.stopReason = { toString: null };
  const f = await fixture(t, [row]);
  const { index, session } = await indexed(t, f);
  const event = session.logicalEvents.find((event) => event.kind === 'assistant_message');
  const detail = await buildEventDetailForSession(index, session, event.id, 'main');
  const context = detail.inspectorSections.flatMap((section) => section.entries || []);
  for (const key of ['Provider', 'Model', 'API', 'Stop reason']) {
    assert.match(context.find((item) => item.key === key).value, /unsupported value; see raw refs/);
  }
  await verifyReadback(index, session, f);
});

test('pi redacts media before preview truncation and every timeline/search projection', async (t) => {
  const payload = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
  const caption = `caption data:image/png;base64,${payload}`;
  const f = await fixture(t, [
    message('u', null, caption),
    message('call', 'u', [{ type: 'toolCall', id: 'tc', name: 'bash', arguments: { command: `echo ${caption}` } }], 'assistant'),
    { type: 'compaction', id: 'c', parentId: 'call', timestamp, summary: caption },
    { type: 'branch_summary', id: 'b', parentId: 'c', timestamp, summary: caption },
    message('long', 'b', `caption ${'x'.repeat(215)} data:image/png;base64,${payload}`),
  ]);
  const { index, session } = await indexed(t, f);
  for (const event of [...session.rawEvents, ...session.logicalEvents]) {
    assert.doesNotMatch(event.preview, /data:image|QUJDREV/);
    assert.ok(event.preview.length <= 240);
  }
  for (const layer of ['main', 'protocol', 'raw']) {
    for (const query of ['caption', payload]) {
      const filters = piAdapter.query.filtersFromSearchParams(new URLSearchParams({ layer, q: query, limit: '100' }));
      for (const get of ['getTimeline', 'getTimelineAsync']) {
        const result = await piAdapter.query[get](index, session, filters);
        assert.equal(result.searchEventCount > 0, query === 'caption');
        for (const event of result.events) assert.doesNotMatch(event.preview + event.snippet, /data:image|QUJDREV/);
      }
      const projects = await piAdapter.query.filterSessions(index, filters);
      assert.doesNotMatch(JSON.stringify(projects), /data:image|QUJDREV/);
    }
  }
  const service = await createHistoryService({ source: 'pi', piHome: f.sourceHome, repo: f.repoRoot });
  t.after(() => service.close());
  for (const layer of ['main', 'protocol', 'raw']) {
    assert.equal((await service.execute('search', { layer, query: payload })).scan.matchedEvents, 0);
    assert.ok((await service.execute('search', { layer, query: 'caption' })).scan.matchedEvents > 0);
  }
  await verifyReadback(index, session, f);
});
