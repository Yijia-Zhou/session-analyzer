'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, discoverPiProjects } = require('../src/pi');
const { buildEventDetailForSession, materializeSessionForIndex, readIndexedRawRecord } = require('../src/source-adapters');

const timestamp = '2026-10-20T12:00:00.000Z';
const message = (id, parentId, role, content, extra = {}) => ({
  type: 'message', id, parentId, timestamp,
  message: { role, content, timestamp: Date.parse(timestamp), ...extra },
});
const assistant = (id, parentId, content, extra) => message(id, parentId, 'assistant', content, {
  provider: 'synthetic', model: 'synthetic-model', api: 'synthetic-api', stopReason: 'stop', ...extra,
});
const call = (id, name = 'read') => ({ type: 'toolCall', id, name, arguments: { path: `${id}.txt` } });
const result = (id, parentId, toolCallId, text, extra = {}) => message(id, parentId, 'toolResult',
  [{ type: 'text', text }], { toolCallId, toolName: 'read', isError: false, ...extra });

async function fixture(t, rows, suffix = '') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pi-adversarial-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sourceHome = path.join(root, 'agent');
  const repoRoot = path.join(root, 'repo');
  const container = path.join(sourceHome, 'sessions', '--opaque--');
  await fsp.mkdir(container, { recursive: true });
  await fsp.mkdir(repoRoot);
  const file = path.join(container, 'synthetic.jsonl');
  const header = { type: 'session', version: 3, id: 'adversarial', timestamp, cwd: repoRoot };
  const text = `${[header, ...rows].map((row) => JSON.stringify(row)).join('\n')}\n${suffix}`;
  await fsp.writeFile(file, text);
  return { root, sourceHome, repoRoot, container, file, text, header };
}

async function load(f) {
  const index = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
  assert.equal(index.sessions.length, 1);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  return { index, session };
}

for (const [name, rows] of [
  ['missing parent', [message('orphan', 'absent', 'user', 'orphan evidence')]],
  ['duplicate entry ids', [message('same', null, 'user', 'first evidence'), message('same', null, 'user', 'second evidence')]],
  ['cycle', [message('one', 'two', 'user', 'cycle one'), message('two', 'one', 'user', 'cycle two')]],
  ['self parent', [message('self', 'self', 'user', 'self evidence')]],
]) {
  test(`pi ${name} preserves whole artifact without fabricating conversation order`, async (t) => {
    const f = await fixture(t, rows);
    const { index, session } = await load(f);
    assert.equal(session.rawEvents.length, rows.length + 1);
    assert.ok(session.logicalEvents.length > 0);
    assert.ok(session.logicalEvents.every((event) => event.layer === 'protocol'));
    for (const raw of session.rawEvents) {
      const readback = await readIndexedRawRecord(index, session, raw.rawId);
      assert.ok(readback.raw);
    }
    assert.equal(await fsp.readFile(f.file, 'utf8'), f.text, 'read-only parsing must not repair input');
  });
}

test('pi duplicate call ids and non-causal results never produce an invented match', async (t) => {
  const f = await fixture(t, [
    message('u', null, 'user', 'tool identity adversary'),
    result('early', 'u', 'future', 'early-result-marker'),
    assistant('future-row', 'early', [call('future')]),
    assistant('a', 'future-row', [call('duplicate')]),
    assistant('b', 'a', [call('duplicate')]),
    result('ambiguous', 'b', 'duplicate', 'ambiguous-result-marker'),
  ]);
  const { session } = await load(f);
  const tools = session.logicalEvents.filter((event) => event.toolName);
  assert.equal(tools.length, 3);
  assert.ok(tools.every((event) => event.status !== 'success'));
  assert.ok(tools.every((event) => !/early-result-marker|ambiguous-result-marker/.test(event.searchText || '')));
  const protocol = session.logicalEvents.filter((event) => event.layer === 'protocol');
  assert.ok(protocol.some((event) => (event.searchText || '').includes('early-result-marker')));
  assert.ok(protocol.some((event) => (event.searchText || '').includes('ambiguous-result-marker')));
});

test('pi duplicate results stay separately inspectable and cannot overwrite the first result', async (t) => {
  const f = await fixture(t, [
    assistant('a', null, [call('once')]),
    result('r1', 'a', 'once', 'first-result-marker'),
    result('r2', 'r1', 'once', 'second-result-marker', { isError: true }),
  ]);
  const { index, session } = await load(f);
  const tool = session.logicalEvents.find((event) => event.toolName);
  assert.ok(tool);
  assert.ok(!((tool.searchText || '').includes('first-result-marker') && (tool.searchText || '').includes('second-result-marker')));
  const texts = await Promise.all(session.rawEvents.map(async (raw) => (await readIndexedRawRecord(index, session, raw.rawId)).raw));
  assert.ok(texts.some((text) => text.includes('first-result-marker')));
  assert.ok(texts.some((text) => text.includes('second-result-marker')));
  assert.ok(session.logicalEvents.some((event) => event.layer === 'protocol' && /result-marker/.test(event.searchText || '')));
});

test('pi unknown blocks and newline-terminated malformed JSON retain exact raw evidence without repairs', async (t) => {
  const unknown = { type: 'futureBlock', payload: { syntheticMarker: 'unknown-block-evidence' } };
  const f = await fixture(t, [assistant('a', null, [{ type: 'text', text: 'Known visible text' }, unknown])], '{"partial":\n');
  const { index, session } = await load(f);
  const readbacks = await Promise.all(session.rawEvents.map((raw) => readIndexedRawRecord(index, session, raw.rawId)));
  assert.ok(readbacks.some((raw) => raw.raw.includes('unknown-block-evidence')));
  assert.ok(readbacks.some((raw) => raw.raw === '{"partial":'));
  assert.equal(await fsp.readFile(f.file, 'utf8'), f.text);
});

for (const stopReason of ['aborted', 'pending', 'deferred']) {
  test(`pi ${stopReason} assistant cannot mark an unreturned tool call successful`, async (t) => {
    const f = await fixture(t, [assistant('a', null, [call('unfinished')], { stopReason })]);
    const { session } = await load(f);
    const tool = session.logicalEvents.find((event) => event.toolName);
    assert.ok(tool);
    assert.notEqual(tool.status, 'success');
  });
}

test('pi completing an uncommitted tail does not alter the accepted snapshot', async (t) => {
  const f = await fixture(t, [message('u', null, 'user', 'accepted snapshot')], '{"type":"custom","id":"tail"');
  const index = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
  const indexed = index.sessions[0];
  await fsp.appendFile(f.file, ',"parentId":"u","timestamp":"2026-10-20T12:00:01.000Z","customType":"later"}\n');
  const materialized = await materializeSessionForIndex(index, indexed);
  assert.equal(materialized.rawEvents.length, indexed.rawEventCount);
  const raws = await Promise.all(materialized.rawEvents.map((raw) => readIndexedRawRecord(index, materialized, raw.rawId)));
  assert.ok(raws.every((raw) => !raw.raw.includes('"id":"tail"')));
  assert.ok(raws.every((raw) => !raw.raw.includes('"customType":"later"')));
});

test('pi appended sibling branch does not leak into cold materialization of an indexed branch', async (t) => {
  const f = await fixture(t, [message('u', null, 'user', 'shared ancestry'), assistant('a', 'u', [{ type: 'text', text: 'accepted branch' }])]);
  const index = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
  const indexed = index.sessions[0];
  await fsp.appendFile(f.file, `${JSON.stringify(assistant('b', 'u', [{ type: 'text', text: 'new sibling marker' }]))}\n`);
  const session = await materializeSessionForIndex(index, indexed);
  assert.equal(session.id, indexed.id);
  assert.equal(session.rawEvents.length, indexed.rawEventCount);
  assert.ok(session.logicalEvents.every((event) => !(event.searchText || '').includes('new sibling marker')));
  const rebuilt = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
  assert.equal(rebuilt.sessions.length, 2);
});

for (const change of ['mutate', 'truncate', 'delete']) {
  test(`pi accepted source ${change} rejects cold materialization as stale`, async (t) => {
    const f = await fixture(t, [message('u', null, 'user', 'accepted snapshot')]);
    const index = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
    if (change === 'mutate') await fsp.writeFile(f.file, f.text.replace('accepted', 'modified'));
    if (change === 'truncate') await fsp.truncate(f.file, 12);
    if (change === 'delete') await fsp.unlink(f.file);
    await assert.rejects(materializeSessionForIndex(index, index.sessions[0]), { code: 'INDEXED_SOURCE_STALE' });
  });
}

test('pi discovery does not traverse source-container or file symlinks outside its root', async (t) => {
  const f = await fixture(t, [message('u', null, 'user', 'inside evidence')]);
  const outside = path.join(f.root, 'outside');
  await fsp.mkdir(outside);
  const escapedText = f.text.replace('adversarial', 'escaped-session');
  await fsp.writeFile(path.join(outside, 'escaped.jsonl'), escapedText);
  try {
    await fsp.symlink(outside, path.join(f.sourceHome, 'sessions', 'escape'), 'dir');
    await fsp.symlink(path.join(outside, 'escaped.jsonl'), path.join(f.container, 'escape.jsonl'), 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlinks unavailable');
    throw error;
  }
  const index = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
  assert.equal(index.sessions.length, 1);
  const projects = await discoverPiProjects({ sourceHome: f.sourceHome });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].sessionCount, 1);
});

test('pi session identity components cannot collide through delimiter characters', async (t) => {
  const f = await fixture(t, []);
  const documents = [
    [{ ...f.header, id: 'a:b' }, message('c', null, 'user', 'first identity')],
    [{ ...f.header, id: 'a' }, message('b:c', null, 'user', 'second identity')],
    [{ ...f.header, id: 'surrogate\ud800' }, message('leaf:%', null, 'user', 'third identity')],
  ];
  await fsp.unlink(f.file);
  for (const [i, rows] of documents.entries()) {
    await fsp.writeFile(path.join(f.container, `${i}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  }
  const index = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
  assert.equal(index.sessions.length, 3);
  assert.equal(new Set(index.sessions.map((session) => session.id)).size, 3);
  assert.equal(index.sessionsById.size, 3);
  for (const indexed of index.sessions) {
    const session = await materializeSessionForIndex(index, indexed);
    assert.equal(session.sourceSessionId, indexed.sourceSessionId);
  }
});

test('pi warm Detail and Raw reads reject changed source evidence', async (t) => {
  const f = await fixture(t, [message('u', null, 'user', 'accepted snapshot')]);
  const { index, session } = await load(f);
  const event = session.logicalEvents.find((item) => item.kind === 'user_message');
  await fsp.writeFile(f.file, f.text.replace('accepted', 'modified'));
  await assert.rejects(buildEventDetailForSession(index, session, event.id, event.layer), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(readIndexedRawRecord(index, session, session.rawEvents[0].rawId), { code: 'INDEXED_SOURCE_STALE' });
});

test('pi accepted file replaced by a symlink outside the root is stale even with identical bytes', async (t) => {
  const f = await fixture(t, [message('u', null, 'user', 'accepted snapshot')]);
  const index = await buildPiIndex({ sourceHome: f.sourceHome, repoRoot: f.repoRoot });
  const outside = path.join(f.root, 'outside.jsonl');
  await fsp.writeFile(outside, f.text);
  await fsp.unlink(f.file);
  try {
    await fsp.symlink(outside, f.file, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlinks unavailable');
    throw error;
  }
  await assert.rejects(materializeSessionForIndex(index, index.sessions[0]), { code: 'INDEXED_SOURCE_STALE' });
});
