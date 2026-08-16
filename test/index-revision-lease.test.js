'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clearIndexRevision,
  initializeIndexRevisionState,
  installIndexRevision,
  materializeSessionWithLease,
  withIndexRevisionLease,
} = require('../src/index-revision-lease');

test('IndexRevisionLease installs and clears cache with monotonic revisions', async () => {
  const first = { id: 'first' };
  const state = initializeIndexRevisionState({ index: first });
  assert.equal(state.indexRevision, 1);
  assert.equal(state.revisionLease.index, first);
  const firstLease = state.revisionLease;
  const indexedSession = { id: 'session-a' };
  first.sessionsById = new Map([[indexedSession.id, indexedSession]]);
  const materializedSession = { id: indexedSession.id, rawEvents: [], logicalEvents: [] };
  assert.equal(await materializeSessionWithLease(
    firstLease,
    indexedSession,
    null,
    async () => materializedSession,
  ), materializedSession);
  assert.equal(firstLease.materializedSessionOwner.cache.size, 1);

  clearIndexRevision(state);
  assert.equal(state.index, null);
  assert.equal(state.indexRevision, 2);
  assert.equal(firstLease.retirementController.signal.aborted, true);
  assert.equal(firstLease.materializedSessionOwner.cache.size, 0);
  assert.equal(firstLease.materializedSessionOwner.retired, true);

  const second = { id: 'second' };
  installIndexRevision(state, second);
  assert.equal(state.indexRevision, 3);
  assert.equal(state.revisionLease.index, second);
});

test('IndexRevisionLease rejects work retired during await with stable 409 code', async () => {
  const state = initializeIndexRevisionState({ index: { id: 'first' } });
  let release;
  const pending = withIndexRevisionLease(state, null, async ({ signal, indexRevision }) => {
    assert.equal(indexRevision, 1);
    await new Promise((resolve) => { release = resolve; });
    assert.equal(signal.aborted, true);
    return 'stale';
  });
  await new Promise((resolve) => setImmediate(resolve));
  installIndexRevision(state, { id: 'second' });
  release();
  await assert.rejects(pending, (error) => (
    error.code === 'INDEX_REVISION_RETIRED' && error.statusCode === 409
  ));
});

test('caller cancellation remains AbortError when its lease is still current', async () => {
  const state = initializeIndexRevisionState({ index: { id: 'first' } });
  const caller = new AbortController();
  const pending = withIndexRevisionLease(state, caller.signal, async ({ signal }) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  caller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});
