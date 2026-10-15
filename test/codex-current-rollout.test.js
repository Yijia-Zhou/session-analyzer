'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readCurrentRolloutPaths } = require('../src/codex-current-rollout');
const A = 'aaaaaaaa-0162-4162-9162-aaaaaaaaaaaa';
const B = 'bbbbbbbb-0162-4162-9162-bbbbbbbbbbbb';

async function fixture(t, schema = 'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sa-rollout-pointer-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sessionsRoot = path.join(root, 'sessions');
  await fsp.mkdir(sessionsRoot);
  const file = path.join(root, 'state_5.sqlite');
  const db = new DatabaseSync(file);
  db.exec(schema);
  db.close();
  return { root, file, options: { codexHome: root, sessionsRoot, sessionIds: [A, B] } };
}

test('current rollout reads only requested pointers and never changes database bytes', async (t) => {
  const { file, options } = await fixture(t);
  const db = new DatabaseSync(file);
  const first = path.join(options.sessionsRoot, 'rollout-first.jsonl');
  const second = path.join(options.sessionsRoot, 'rollout-reverted.jsonl');
  db.prepare('INSERT INTO threads VALUES (?, ?)').run(A, first);
  db.prepare('INSERT INTO threads VALUES (?, ?)').run(B, second);
  db.close();
  const before = await fsp.readFile(file);
  const firstRead = await readCurrentRolloutPaths({ ...options, sessionIds: [A] });
  assert.deepEqual([...firstRead.currentPaths], [[A, first]]);
  assert.deepEqual(firstRead.diagnostics, []);
  assert.deepEqual(await fsp.readFile(file), before);
  assert.equal((await readCurrentRolloutPaths({ ...options, sessionIds: [A] })).evidence.digest, firstRead.evidence.digest);
  const writer = new DatabaseSync(file);
  writer.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?').run(second, A);
  writer.close();
  const changed = await readCurrentRolloutPaths({ ...options, sessionIds: [A] });
  assert.equal(changed.currentPaths.get(A), second);
  assert.notEqual(changed.evidence.digest, firstRead.evidence.digest);
  assert.equal(firstRead.currentPaths.get(A), first, 'accepted evidence does not mutate after a later cutover');
});

test('current rollout sees committed WAL pointers without changing journal mode', async (t) => {
  let writer;
  t.after(() => writer?.close());
  const { file, options } = await fixture(t);
  writer = new DatabaseSync(file);
  writer.exec('PRAGMA journal_mode = WAL');
  const target = path.join(options.sessionsRoot, 'wal-head.jsonl');
  writer.prepare('INSERT INTO threads VALUES (?, ?)').run(A, target);
  const read = await readCurrentRolloutPaths(options);
  assert.equal(read.currentPaths.get(A), target);
  assert.equal(writer.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
});

test('missing database is not created; unrelated files and unsupported schemas are not adopted', async (t) => {
  const { root, file, options } = await fixture(t, 'CREATE TABLE unrelated (id TEXT)');
  assert.equal((await readCurrentRolloutPaths(options)).evidence.status, 'unavailable');
  await fsp.rename(file, path.join(root, 'state_999.sqlite'));
  const missing = await readCurrentRolloutPaths(options);
  assert.equal(missing.evidence.status, 'missing');
  assert.equal(missing.currentPaths.size, 0);
  await assert.rejects(fsp.stat(file), { code: 'ENOENT' });
  const unused = await readCurrentRolloutPaths({ ...options, sessionIds: [] });
  assert.equal(unused.evidence.status, 'not-needed');
  assert.deepEqual(unused.diagnostics, []);
});

test('out-of-root, relative, corrupt and duplicate pointer rows are rejected', async (t) => {
  const { file, root, options } = await fixture(t, 'CREATE TABLE threads (id TEXT, rollout_path TEXT)');
  const writer = new DatabaseSync(file);
  const insert = writer.prepare('INSERT INTO threads VALUES (?, ?)');
  for (const pointer of [path.join(root, 'sessions-other', 'escape.jsonl'), '../escape.jsonl', 'x'.repeat(40000), null]) {
    writer.exec('DELETE FROM threads');
    insert.run(A, pointer);
    const result = await readCurrentRolloutPaths(options);
    assert.equal(result.currentPaths.size, 0);
    assert.equal(result.diagnostics[0].code, 'CODEX_CURRENT_ROLLOUT_INVALID');
  }
  writer.exec('DELETE FROM threads');
  insert.run(A, path.join(options.sessionsRoot, 'a.jsonl'));
  insert.run(A, path.join(options.sessionsRoot, 'b.jsonl'));
  assert.equal((await readCurrentRolloutPaths(options)).currentPaths.size, 0);
  writer.close();
});

test('pointer reads honor cancellation before opening the database', async (t) => {
  const { options } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readCurrentRolloutPaths({ ...options, signal: controller.signal }), { name: 'AbortError' });
});

test('directory aliases and Windows namespace paths resolve to the selected root; escaped links do not', async (t) => {
  const { root, file, options } = await fixture(t);
  const alias = path.join(root, 'sessions-alias');
  await fsp.symlink(options.sessionsRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const target = path.join(options.sessionsRoot, 'aliased.jsonl');
  await fsp.writeFile(target, '{}\n');
  const outside = path.join(root, 'outside');
  await fsp.mkdir(outside);
  await fsp.writeFile(path.join(outside, 'escape.jsonl'), '{}\n');
  const escape = path.join(options.sessionsRoot, 'escape');
  await fsp.symlink(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
  const writer = new DatabaseSync(file);
  writer.prepare('INSERT INTO threads VALUES (?, ?)').run(A, path.toNamespacedPath(target));
  writer.prepare('INSERT INTO threads VALUES (?, ?)').run(B, path.join(escape, 'escape.jsonl'));
  writer.close();
  const result = await readCurrentRolloutPaths({ ...options, sessionsRoot: alias });
  assert.equal(result.currentPaths.get(A), path.join(alias, 'aliased.jsonl'));
  assert.equal(result.currentPaths.has(B), false);
  assert.equal(result.evidence.entries.find((entry) => entry.sessionId === B).status, 'invalid');
});
