'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, discoverPiProjects } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');

const created = '2026-10-01T00:00:00.000Z';
const older = '2026-10-20T00:00:00.000Z';
const recent = '2026-10-22T12:00:00.000Z';
const message = (id, parentId, timestamp, role, content, fields = {}) => ({
  type: 'message', id, parentId, timestamp, message: { role, content, ...fields },
});
async function fixture(t) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-role-recency-'));
  t.after(() => fs.rm(sourceHome, { recursive: true, force: true }));
  const repoRoot = path.join(sourceHome, 'project');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(sourceHome, 'sessions'));
  async function write(id, rows, tail = '', cwd = repoRoot) {
    const text = [JSON.stringify({ type: 'session', version: 3, id, cwd, timestamp: created }),
      ...rows.map((row) => JSON.stringify(row))].join('\n') + '\n' + tail;
    const file = path.join(sourceHome, 'sessions', `${id}.jsonl`);
    await fs.writeFile(file, text);
    return { file, text };
  }
  return { sourceHome, repoRoot, write };
}
async function indexed(t, f) {
  const index = await buildPiIndex(f);
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  return index;
}

for (const [label, content, fields, marker] of [
  ['thinking', [{ type: 'text', text: 'USER_TEXT' }, { type: 'thinking', thinking: 'USER_OPAQUE_THINKING' }], {}, 'USER_OPAQUE_THINKING'],
  ['error', 'USER_TEXT', { stopReason: 'error', errorMessage: 'USER_ERROR_FIELD' }, 'USER_ERROR_FIELD'],
  ['abort', 'USER_TEXT', { stopReason: 'aborted', errorMessage: 'USER_ABORT_FIELD' }, 'USER_ABORT_FIELD'],
  ['usage', 'USER_TEXT', { usage: { input: 10, extension: 'USER_USAGE_FIELD' } }, 'USER_USAGE_FIELD'],
]) {
  test(`pi user ${label} remains fallback evidence without assistant facts`, async (t) => {
    const f = await fixture(t);
    const original = await f.write('roles', [
      message('u', null, older, 'user', content, fields),
      message('a', 'u', recent, 'assistant', [{ type: 'thinking', thinking: 'ASSISTANT_THINKING' }], {
        stopReason: 'error', errorMessage: 'ASSISTANT_ERROR', usage: { input: 2 },
      }),
      message('b', 'a', recent, 'assistant', 'ASSISTANT_TEXT', { stopReason: 'aborted' }),
    ]);
    const index = await indexed(t, f);
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    const userEvents = session.logicalEvents.filter((event) => event.rawRefs.some((ref) => ref.line === 2));
    assert.deepEqual(userEvents.filter((e) => e.layer === 'main').map((e) => e.kind), ['user_message']);
    assert.ok(userEvents.some((e) => e.layer === 'protocol' && e.searchText.includes(marker)));
    assert.ok(!userEvents.some((e) => e.subtype === 'pi_usage'));
    assert.equal(session.counts.reasoning, 1);
    assert.equal(session.counts.errors, 1);
    assert.equal(session.counts.aborts, 1);
    assert.equal(session.counts.issueEvents, 2);
    assert.equal(session.logicalEvents.filter((e) => e.subtype === 'pi_usage').length, 1);
    const details = await Promise.all(userEvents.filter((e) => e.layer === 'protocol')
      .map((e) => buildEventDetailForSession(index, session, e.id, 'protocol')));
    assert.ok(JSON.stringify(details).includes(marker), 'unsupported evidence is inspectable in fallback Detail');
    const raw = session.rawEvents.find((r) => r.line === 2);
    assert.equal((await readIndexedRawRecord(index, session, raw.rawId)).raw, original.text.split('\n')[1]);
    const service = await createHistoryService({ source: 'pi', piHome: f.sourceHome, repo: f.repoRoot });
    t.after(() => service.close());
    assert.equal((await service.execute('search', { layer: 'main', query: marker })).scan.matchedEvents, 0);
    for (const layer of ['protocol', 'raw']) {
      assert.ok((await service.execute('search', { layer, query: marker })).scan.matchedEvents > 0);
    }
    assert.equal(await fs.readFile(original.file, 'utf8'), original.text);
  });
}

test('pi malformed and timestamp-less tails preserve branch-local and project recency', async (t) => {
  const f = await fixture(t);
  const original = await f.write('branches', [
    message('u', null, created, 'user', 'shared'),
    message('recent', 'u', recent, 'assistant', 'RECENT_BRANCH'),
    message('old', 'u', older, 'assistant', 'OLDER_BRANCH'),
    { type: 'custom', id: 'invalid-date', parentId: 'recent', timestamp: 'not-a-date' },
    { type: 'custom', id: 'no-date', parentId: 'invalid-date' },
  ], '{malformed}\n');
  await f.write('middle', [message('m', null, '2026-10-21T00:00:00.000Z', 'user', 'middle')]);
  const otherProject = path.join(f.sourceHome, 'other-project');
  await fs.mkdir(otherProject);
  await f.write('other', [message('o', null, '2026-10-21T00:00:00.000Z', 'user', 'other')], '', otherProject);
  const index = await indexed(t, f);
  assert.deepEqual(index.sessions.map((s) => [s.sourceSessionId, s.sourceDerivedId, s.updatedAt]), [
    ['branches', 'no-date', recent], ['middle', 'm', '2026-10-21T00:00:00.000Z'], ['branches', 'old', older],
  ]);
  for (const stored of index.sessions) {
    const session = await materializeSessionForIndex(index, stored);
    assert.equal(session.updatedAt, stored.updatedAt);
    if (stored.sourceSessionId === 'branches') {
      const raw = session.rawEvents.at(-1);
      assert.equal((await readIndexedRawRecord(index, session, raw.rawId)).raw, '{malformed}');
    }
  }
  // Project recency follows the last valid timestamp in file order, not the
  // maximum timestamp across branches: the older branch was appended last.
  // Remove the middle artifact to expose that value in discovery.
  await fs.rm(path.join(f.sourceHome, 'sessions', 'middle.jsonl'));
  const projects = await discoverPiProjects({ sourceHome: f.sourceHome });
  assert.deepEqual(projects.map((p) => [p.repoRoot, p.updatedAt]), [
    [otherProject, '2026-10-21T00:00:00.000Z'], [f.repoRoot, older],
  ]);
  assert.equal(await fs.readFile(original.file, 'utf8'), original.text);
});

test('pi recency falls back to header only when no entry has a usable timestamp', async (t) => {
  const f = await fixture(t);
  await f.write('empty', [], '{malformed}\n');
  await f.write('undated', [message('u', null, 'invalid', 'user', 'undated')]);
  const index = await indexed(t, f);
  assert.ok(index.sessions.every((s) => s.updatedAt === created));
  assert.equal((await discoverPiProjects({ sourceHome: f.sourceHome }))[0].updatedAt, created);
});
