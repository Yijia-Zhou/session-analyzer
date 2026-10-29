'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '../fixtures/opencode/schema-2.1.4.sql'), 'utf8');
const TIME = Date.parse('2026-10-01T10:00:00.000Z');

function sessionRow(overrides = {}) {
  return { id: 'ses_fixture', project_id: 'project_fixture', workspace_id: null,
    parent_id: null, fork_session_id: null, fork_boundary: null, slug: 'fixture',
    directory: process.cwd(), path: '', title: 'Synthetic OpenCode session', version: '2.1.4',
    share_url: null, summary_additions: null, summary_deletions: null, summary_files: null,
    summary_diffs: null, metadata: null, cost: 0, tokens_input: 7, tokens_output: 4,
    tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0, revert: null,
    permission: null, agent: 'build', model: JSON.stringify({ id: 'synthetic-model', providerID: 'synthetic' }),
    time_created: TIME, time_updated: TIME + 1000, time_idle: TIME + 1000,
    time_viewed: null, idle_outcome: 'succeeded', time_compacting: null, time_archived: null,
    time_suspended: null, resume_attempts: 0, ...overrides };
}
function messageRow(overrides = {}) {
  return { id: 'msg_fixture_user', session_id: 'ses_fixture', type: 'user', seq: 1,
    time_created: TIME, time_updated: TIME,
    data: JSON.stringify({ time: { created: TIME }, text: 'OpenCode fixture question', files: [] }),
    ...overrides };
}
function insert(db, table, row) {
  const keys = Object.keys(row);
  if (!keys.every(key => /^[a-z_]+$/.test(key))) throw new Error('Invalid fixture column');
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
}
function insertSession(db, row) { insert(db, 'session_v2', sessionRow(row)); }
function insertMessage(db, row) { insert(db, 'session_message', messageRow(row)); }
function createOpenCodeFixture({ dbPath, repoRoot, sessionId = 'ses_fixture', userText = 'OpenCode fixture question', journalMode = 'WAL', sessions, messages } = {}) {
  if (!dbPath || !repoRoot) throw new Error('dbPath and repoRoot are required');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (!['WAL', 'DELETE'].includes(journalMode)) throw new Error('Invalid synthetic journal mode');
  db.exec(`PRAGMA journal_mode=${journalMode}; PRAGMA wal_autocheckpoint=0;`);
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT INTO project(id,worktree,vcs,time_created,time_updated,time_active,sandboxes) VALUES(?,?,?,?,?,?,?)')
    .run('project_fixture', repoRoot, 'git', TIME, TIME, TIME, '[]');
  db.prepare('INSERT INTO worktree(project_id,directory,strategy,time_created) VALUES(?,?,?,?)')
    .run('project_fixture', repoRoot, 'main', TIME);
  for (const row of sessions || [{ id: sessionId, directory: repoRoot }]) insertSession(db, row);
  const defaults = [
    messageRow({ session_id: sessionId, data: JSON.stringify({ time: { created: TIME }, text: userText, files: [] }) }),
    messageRow({ id: 'msg_fixture_assistant', session_id: sessionId, type: 'assistant', seq: 2, time_created: TIME + 10, time_updated: TIME + 900,
      data: JSON.stringify({ time: { created: TIME + 10, completed: TIME + 900 }, content: [{ type: 'text', text: 'Synthetic OpenCode answer' }],
        agent: 'build', model: { id: 'synthetic-model', providerID: 'synthetic' }, cost: 0, tokens: { input: 7, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } }) }),
    messageRow({ id: 'msg_fixture_idle', session_id: sessionId, type: 'idle', seq: 3, time_created: TIME + 1000, time_updated: TIME + 1000,
      data: JSON.stringify({ time: { created: TIME + 1000 }, outcome: 'succeeded' }) }),
  ];
  for (const row of messages || defaults) insertMessage(db, row);
  let closed = false;
  return { db, dbPath, repoRoot, sessionId, messageId: 'msg_fixture_user', close() { if (!closed) { closed = true; db.close(); } } };
}
module.exports = { SCHEMA_SQL, TIME, sessionRow, messageRow, insertSession, insertMessage, createOpenCodeFixture };
