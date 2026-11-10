'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { buildWorkbuddyIndex } = require('../src/workbuddy');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');
const { validateLogicalDetailEnvelope, validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
const { createHistoryService } = require('../src/history-service');
async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-origin-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project'); const dir = path.join(home, 'projects', 'synthetic');
  await fs.mkdir(repo); await fs.mkdir(dir, { recursive: true });
  const lines = [
    { type: 'message', id: 'initial', role: 'user', content: [{ type: 'input_text', text: 'AUTOMATIC_INPUT_MARKER' }], providerData: { startsNewUserRequest: true } },
    { type: 'message', id: 'answer', role: 'assistant', content: [{ type: 'output_text', text: 'AUTOMATIC_RESULT' }] },
    { type: 'message', id: 'followup', role: 'user', content: [{ type: 'input_text', text: 'HUMAN_FOLLOWUP' }], providerData: { startsNewUserRequest: true } },
  ].map(row => JSON.stringify({ timestamp: 1794300000000, sessionId: 'scheduled', cwd: repo, ...row }));
  const file = path.join(dir, 'scheduled.jsonl'); await fs.writeFile(file, lines.join('\n') + '\n');
  const dbFile = path.join(home, 'workbuddy.db');
  if (!options.absent) {
    const db = new DatabaseSync(dbFile);
    try {
      db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY, cwd TEXT, is_background_automation INTEGER, session_settings TEXT); CREATE TABLE automation_runs(thread_id TEXT PRIMARY KEY, automation_id TEXT, source_cwd TEXT, metadata_json TEXT)');
      const settings = options.settings ?? JSON.stringify({ conversationTags: { automationId: 'automation-1' } });
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('scheduled', options.sessionCwd || repo, options.flag ?? 1, settings);
      const insert = db.prepare('INSERT INTO automation_runs VALUES (?, ?, ?, ?)');
      const meta = { sessionId: 'scheduled', conversationId: 'scheduled', runKind: 'scheduled', ...options.meta };
      insert.run('run-1', options.automationId || 'automation-1', options.runCwd || repo, JSON.stringify(meta));
      if (options.ambiguous) insert.run('run-2', 'automation-1', repo, JSON.stringify(meta));
    } finally { db.close(); }
  }
  return { home, repo, file, dbFile, lines };
}
async function indexFor(t, f) {
  const index = await buildWorkbuddyIndex({ sourceHome: f.home, repoRoot: f.repo });
  t.after(() => disposeIndexResources(index)); await validateIndexOwnershipForCommit(index); return index;
}

test('desktop scheduled origin excludes only initial input and preserves query, detail and exact JSONL Raw', async (t) => {
  const f = await fixture(t); const dbBefore = await fs.readFile(f.dbFile);
  const index = await indexFor(t, f); const indexed = index.sessions[0];
  assert.equal(index.sourceDiagnostics.totalCount, 0);
  assert.equal(indexed.counts.userMessages, 1); assert.equal(indexed.counts.turns, 1); assert.equal(indexed.title, 'HUMAN_FOLLOWUP');
  const session = await materializeSessionForIndex(index, indexed);
  const event = session.logicalEvents.find(e => e.subtype === 'workbuddy_scheduled_input');
  assert.equal(event.kind, 'protocol'); assert.equal(event.layer, 'protocol'); assert.equal(event.role, 'user');
  assert.equal(session.rawEvents[0].turnId, ''); assert.equal(session.rawEvents[2].turnId, 'followup');
  const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
  validateStructuredLogicalDetailDto(detail); validateLogicalDetailEnvelope(detail, event);
  assert.match(JSON.stringify(detail.timelineSections), /AUTOMATIC_INPUT_MARKER/);
  assert.match(JSON.stringify(detail.inspectorSections), /workbuddy.db: sessions \+ automation_runs.*copied_value.*automation-1.*run-1/);
  assert.equal((await readIndexedRawRecord(index, session, event.rawRefs[0].rawId)).raw, f.lines[0]);
  const service = await createHistoryService({ source: 'workbuddy', workbuddyHome: f.home, repo: f.repo });
  t.after(() => service.close());
  assert.equal((await service.execute('search', { query: 'AUTOMATIC_INPUT_MARKER', layer: 'protocol' })).items.length, 1);
  assert.equal((await service.execute('search', { query: 'AUTOMATIC_INPUT_MARKER', kind: 'user_message' })).items.length, 0);
  assert.deepEqual(await fs.readFile(f.dbFile), dbBefore);
});

test('copied desktop origin replays the accepted index even when live metadata is edited or removed', async (t) => {
  const f = await fixture(t); const index = await indexFor(t, f);
  const db = new DatabaseSync(f.dbFile); db.exec('UPDATE sessions SET is_background_automation=0'); db.close();
  const old = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(old.counts.userMessages, 1);
  const rebuilt = await indexFor(t, f); assert.equal(rebuilt.sessions[0].counts.userMessages, 2);
  await fs.unlink(f.dbFile);
  const replay = await materializeSessionForIndex(index, index.sessions[0]); assert.equal(replay.counts.userMessages, 1);
  const event = replay.logicalEvents.find(e => e.subtype === 'workbuddy_scheduled_input');
  await buildEventDetailForSession(index, replay, event.id, event.layer);
});

test('missing, ambiguous, mismatched and malformed desktop provenance never creates scheduled identity', async (t) => {
  for (const options of [{ absent: true }, { flag: 0 }, { flag: 'true' }, { ambiguous: true },
    { settings: '{broken' }, { sessionCwd: '/different' }, { runCwd: '/different' },
    { automationId: 'other' }, { meta: { conversationId: 'other' } }, { meta: { runKind: 'manual' } }]) {
    const f = await fixture(t, options); const index = await indexFor(t, f);
    assert.equal(index.sessions[0].counts.userMessages, 2);
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    assert.ok(session.logicalEvents.every(e => e.subtype !== 'workbuddy_scheduled_input'));
  }
});

test('corrupt and symlink desktop databases produce diagnostics without breaking standalone JSONL reading', async (t) => {
  for (const symlink of [false, true]) {
    const f = await fixture(t, { absent: true });
    if (symlink) {
      const target = path.join(f.home, 'untrusted.db'); await fs.writeFile(target, 'not a database'); await fs.symlink(target, f.dbFile);
    } else await fs.writeFile(f.dbFile, 'not a database');
    const index = await indexFor(t, f); assert.equal(index.sessions[0].counts.userMessages, 2);
    assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNAVAILABLE, 1);
  }
});

test('a forged copied origin is rejected by the materialization descriptor validator', async (t) => {
  const f = await fixture(t); const index = await indexFor(t, f); const indexed = index.sessions[0];
  const dependency = index.materializationDependencies.get(indexed.materializationDescriptor.dependencySetId);
  dependency.entries[1].evidence.origin.sessionId = 'another-session';
  await assert.rejects(validateIndexOwnershipForCommit(index));
});

test('duplicate physical session names cannot borrow a unique desktop origin', async (t) => {
  const f = await fixture(t); const other = path.join(f.home, 'projects', 'another-container');
  await fs.mkdir(other); await fs.copyFile(f.file, path.join(other, 'scheduled.jsonl'));
  const index = await indexFor(t, f); assert.equal(index.sessions.length, 2);
  assert.ok(index.sessions.every(s => s.counts.userMessages === 2));
  assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, 2);
});

test('WAL capture preserves committed WAL evidence without creating or changing source side files', async (t) => {
  for (const live of [false, true]) {
    const f = await fixture(t, { flag: 0 }); const writer = new DatabaseSync(f.dbFile);
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE sessions SET is_background_automation=1');
    if (!live) writer.close();
    t.after(() => { if (live) writer.close(); });
    const namesBefore = (await fs.readdir(f.home)).sort();
    const captured = new Map();
    for (const name of namesBefore.filter(n => n.startsWith('workbuddy.db'))) captured.set(name, await fs.readFile(path.join(f.home, name)));
    const index = await indexFor(t, f);
    assert.equal(index.sourceDiagnostics.totalCount, 0);
    assert.equal(index.sessions[0].counts.userMessages, 1, 'committed WAL metadata is included');
    assert.deepEqual((await fs.readdir(f.home)).sort(), namesBefore, 'source directory members are unchanged');
    for (const [name, bytes] of captured) assert.deepEqual(await fs.readFile(path.join(f.home, name)), bytes, name);
  }
});
