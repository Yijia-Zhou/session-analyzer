'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectQueryStoreBuilder, buildProjectQueryStore, disposeProjectQueryStore, validateProjectQueryStore } = require('../src/project-query-store');
const { initializeIndexRevisionState, installIndexRevision, clearIndexRevision } = require('../src/index-revision-lease');
const { capacitySession } = require('../scripts/query-capacity-fixture');

test('disk manifest rejects accessors before hashing without invoking them', (t) => {
  const store = buildProjectQueryStore([capacitySession('shape')], { memoryRows: 0 });
  t.after(() => disposeProjectQueryStore(store));
  const shard = store.shardsBySessionId.get('shape').main;
  let invoked = false;
  Object.defineProperty(shard.pages[0], 'start', { enumerable: true, get() { invoked = true; return 0; } });
  assert.throws(() => validateProjectQueryStore(store), { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' });
  assert.equal(invoked, false);
});

test('factory failure after spilling immediately disposes its partial candidate', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => buildProjectQueryStore([capacitySession('duplicate'), capacitySession('duplicate')],
    { memoryRows: 0, tempRoot: root }), { code: 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION' });
  assert.deepEqual(fs.readdirSync(root), []);
});

test('disk initialization and fsync failures release candidate storage without changing committed revision', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-life-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = buildProjectQueryStore([capacitySession('old')], { memoryRows: 0, tempRoot: root });
  const old = { projectQueryStore: store };
  const state = initializeIndexRevisionState({ index: old });
  t.after(() => clearIndexRevision(state));
  for (const name of ['openSync', 'fsyncSync']) {
    const original = fs[name];
    fs[name] = () => { const error = new Error('synthetic quota'); error.code = 'ENOSPC'; throw error; };
    try {
      assert.throws(() => {
        const builder = createProjectQueryStoreBuilder({ memoryRows: 0, tempRoot: root });
        builder.addSession(capacitySession('new'));
        builder.finish();
      }, { code: 'PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED' });
    } finally { fs[name] = original; }
    assert.equal(state.index, old);
    assert.equal(state.indexRevision, 1);
    assert.equal(state.revisionLease.retirementController.signal.aborted, false);
    assert.equal(fs.readdirSync(root).length, 1);
  }
});

test('retirement cleanup failure cannot undo a committed replacement and is retried', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = buildProjectQueryStore([capacitySession('old')], { memoryRows: 0, tempRoot: root });
  const second = buildProjectQueryStore([capacitySession('new')], { memoryRows: 0, tempRoot: root });
  const state = initializeIndexRevisionState({ index: { projectQueryStore: first } });
  t.after(() => clearIndexRevision(state));
  const previous = state.revisionLease;
  const replacement = { projectQueryStore: second };
  const original = fs.rmSync;
  let failures = 0;
  fs.rmSync = () => { failures += 1; const error = new Error('synthetic file lock'); error.code = 'EPERM'; throw error; };
  try { installIndexRevision(state, replacement); } finally { fs.rmSync = original; }
  assert.equal(failures, 1);
  assert.equal(state.index, replacement);
  assert.equal(state.indexRevision, 2);
  assert.equal(previous.retirementController.signal.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(fs.readdirSync(root).length, 1);
  // Reuse of the same store across revisions must not dispose it.
  installIndexRevision(state, { projectQueryStore: second });
  assert.equal(fs.readdirSync(root).length, 1);
  disposeProjectQueryStore(first);
});
