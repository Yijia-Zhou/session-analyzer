'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceReferenceLabel } = require('../src/shared/source-reference-presentation');

test('SQLite references identify primary keys without file-line or staging-path labels', () => {
  const sourceLocator = { type: 'sqlite_row', databaseId: 'db-1', table: 'session_message',
    sessionID: 'ses_one', messageID: 'msg_one', pointer: '/content/2', snapshotId: 'snapshot-one' };
  assert.equal(sourceReferenceLabel({ sourceLocator, source: { file: '/tmp/snapshot.json', line: null } }),
    'session_message:msg_one /content/2');
  assert.equal(sourceReferenceLabel({ sourceLocator: { ...sourceLocator, table: 'session_v2', messageID: undefined, pointer: '' } }),
    'session_v2:ses_one');
  assert.equal(sourceReferenceLabel({ file: '/data/opencode.db', line: null }), '/data/opencode.db');
});

test('existing file-line references and Raw identity fallback retain their labels', () => {
  assert.equal(sourceReferenceLabel({ file: 'session.jsonl', line: 2 }), 'session.jsonl:2');
  assert.equal(sourceReferenceLabel({ sourceLocator: { file: 'nested/session.jsonl', line: 3 } }), 'nested/session.jsonl:3');
  assert.equal(sourceReferenceLabel({ rawId: 'raw-only' }), 'raw-only');
  assert.equal(sourceReferenceLabel(null), '');
});
