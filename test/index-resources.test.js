'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createProjectQueryStoreBuilder, scanProjectQueryShard } = require('../src/project-query-store');
const {
  attachIndexResource, disposeIndexResources, registerIndexResource,
  retainIndexResources, withIndexResourceBuildScope, withIndexResources,
} = require('../src/index-resources');
const {
  clearIndexRevision, initializeIndexRevisionState, installIndexRevision,
  withIndexRevisionLease,
} = require('../src/index-revision-lease');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function capturedIndex(dispose = () => {}) {
  const resource = registerIndexResource({ dispose });
  const index = {};
  attachIndexResource(index, resource);
  return { index, resource };
}

test('a cancelled caller cannot delete files while actual resource I/O is pending', async () => {
  const finish = deferred();
  let disposed = 0;
  const { index, resource } = capturedIndex(() => { disposed++; });
  const state = initializeIndexRevisionState({ index });
  const reading = withIndexRevisionLease(state, null, async ({ signal }) => {
    await finish.promise; // Simulate an I/O operation that does not honor abort.
    assert.equal(signal.aborted, true);
    assert.equal(disposed, 0);
    return 'original snapshot bytes';
  });
  installIndexRevision(state, {});
  assert.equal(resource.stats().phase, 'retired');
  assert.equal(disposed, 0);
  await assert.rejects(withIndexResources(index, () => 'new read'), { code: 'INDEX_REVISION_RETIRED' });
  finish.resolve();
  await assert.rejects(reading, { code: 'INDEX_REVISION_RETIRED' });
  await resource.dispose();
  assert.equal(disposed, 1);
});

test('history service and viewer retain the same snapshot independently', async () => {
  let disposed = 0;
  const { index, resource } = capturedIndex(() => { disposed++; });
  const releaseService = retainIndexResources(index);
  const viewer = initializeIndexRevisionState({ index });
  releaseService();
  assert.equal(resource.stats().holders, 1);
  assert.equal(await withIndexRevisionLease(viewer, null, async () => 'viewer data').then((r) => r.value), 'viewer data');
  assert.equal(disposed, 0);
  clearIndexRevision(viewer, { dispose: false });
  await resource.dispose();
  assert.equal(disposed, 1);
});

test('closing the viewer leaves an owning history service readable', async () => {
  let disposed = 0;
  const { index, resource } = capturedIndex(() => { disposed++; });
  const releaseService = retainIndexResources(index);
  const viewer = initializeIndexRevisionState({ index });
  clearIndexRevision(viewer, { dispose: false });
  assert.equal(disposed, 0);
  assert.equal(await withIndexResources(index, () => 'history data'), 'history data');
  releaseService();
  await resource.dispose();
  assert.equal(disposed, 1);
});

test('failed outer validation reclaims a successful nested build and preserves old revision', async () => {
  let discarded = 0;
  const previous = capturedIndex();
  const state = initializeIndexRevisionState({ index: previous.index });
  await assert.rejects(withIndexResourceBuildScope(async () => {
    await withIndexResourceBuildScope(async () => {
      const { index } = capturedIndex(() => { discarded++; });
      return index;
    });
    throw Object.assign(new Error('validation failed'), { code: 'INVALID_CAPTURE' });
  }), { code: 'INVALID_CAPTURE' });
  assert.equal(discarded, 1);
  assert.equal(state.index, previous.index);
  assert.equal(previous.resource.stats().phase, 'published');
  clearIndexRevision(state);
  await previous.resource.dispose();
});

test('build cancellation before publication disposes unreturned candidates', async () => {
  let disposed = 0;
  let candidate;
  const result = await withIndexResourceBuildScope(async () => {
    candidate = capturedIndex(() => { disposed++; });
    return undefined;
  });
  assert.equal(result, undefined);
  assert.equal(disposed, 1);
  assert.equal(candidate.resource.stats().phase, 'disposed');
});

test('successful direct builds transfer ownership and explicit disposal waits for readers', async () => {
  let disposed = 0;
  let resource;
  const index = await withIndexResourceBuildScope(async () => {
    const captured = capturedIndex(() => { disposed++; });
    resource = captured.resource;
    return captured.index;
  });
  assert.equal(disposed, 0);
  const finish = deferred();
  const pending = withIndexResources(index, () => finish.promise);
  let cleanupSettled = false;
  const cleanup = disposeIndexResources(index).then(() => { cleanupSettled = true; });
  await tick();
  assert.equal(cleanupSettled, false);
  assert.equal(resource.stats().readers, 1);
  finish.resolve();
  await pending;
  await cleanup;
  assert.equal(disposed, 1);
  await disposeIndexResources(index);
  assert.equal(disposed, 1);
});

test('nested resource readers all release on errors and do not mask the read failure', async () => {
  const { index, resource } = capturedIndex();
  await assert.rejects(withIndexResources(index, () => resource.withReader(async () => {
    assert.equal(resource.stats().readers, 2);
    throw Object.assign(new Error('original read failure'), { code: 'READ_FAILED' });
  })), { code: 'READ_FAILED' });
  assert.equal(resource.stats().readers, 0);
  await disposeIndexResources(index);
});

test('multiple resources are disposed once and legacy indexes need no lifecycle opt-in', async () => {
  const disposed = [];
  const { index } = capturedIndex(() => { disposed.push('first'); });
  attachIndexResource(index, registerIndexResource({ dispose: () => { disposed.push('second'); } }));
  const release = retainIndexResources(index);
  release(); release();
  await disposeIndexResources(index);
  assert.deepEqual(disposed.sort(), ['first', 'second']);
  const plain = { id: 'legacy' };
  assert.equal(await withIndexResources(plain, () => plain.id), 'legacy');
  assert.deepEqual(await disposeIndexResources(plain), []);
});

test('snapshot ownership keeps a real disk query store readable across shared consumers', async () => {
  const builder = createProjectQueryStoreBuilder({ memoryRows: 0 });
  builder.addSession({ id: 'session', rawEvents: [], logicalEvents: [{
    id: 'event', layer: 'main', kind: 'message', timestamp: '', subtype: '', status: '',
    toolName: '', preview: 'snapshot preview', searchText: 'snapshot search',
    source: { file: 'synthetic' }, touchedFiles: [], rawRefs: [],
  }] });
  const index = { projectQueryStore: builder.finish() };
  assert.equal(index.projectQueryStore.schemaVersion, 3);
  const resource = registerIndexResource({ dispose() {} });
  attachIndexResource(index, resource);
  const first = retainIndexResources(index);
  const second = retainIndexResources(index);
  first();
  const rows = [];
  await withIndexResources(index, () => scanProjectQueryShard(index.projectQueryStore,
    'session', 'main', { includeText: true }, (row) => rows.push(row.preview)));
  assert.equal(rows[0].parts ? [...rows[0].parts()].join('') : rows[0], 'snapshot preview');
  second();
  await disposeIndexResources(index);
  await assert.rejects(scanProjectQueryShard(index.projectQueryStore,
    'session', 'main', {}, () => {}), /closed/);
});

test('cleanup failure preserves the build error and reports retry state', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { registerIndexResource, withIndexResourceBuildScope } = require('./src/index-resources');
    (async () => {
      let attempts = 0, resource;
      const warnings = [];
      process.on('warning', (warning) => warnings.push(warning.code));
      await assert.rejects(withIndexResourceBuildScope(async () => {
        resource = registerIndexResource({ dispose() {
          if (++attempts === 1) throw Object.assign(new Error('busy directory'), { code: 'EBUSY' });
        } });
        throw Object.assign(new Error('original capture error'), { code: 'CAPTURE_FAILED' });
      }), { code: 'CAPTURE_FAILED' });
      assert.equal(resource.stats().phase, 'retired');
      assert.equal(resource.stats().cleanupError, 'EBUSY');
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(resource.stats().phase, 'disposed');
      assert.equal(attempts, 2);
      assert.ok(warnings.includes('INDEX_RESOURCE_CLEANUP_FAILED'));
    })().catch((e) => { console.error(e); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('normal process exit removes a resource through its synchronous disposer', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-resource-exit-'));
  try {
    const script = `
      const fs = require('node:fs');
      const { registerIndexResource } = require('./src/index-resources');
      const directory = process.argv[1];
      registerIndexResource({ dispose: () => fs.promises.rm(directory, { recursive: true, force: true }),
        disposeSync: () => fs.rmSync(directory, { recursive: true, force: true }) });
    `;
    const result = spawnSync(process.execPath, ['-e', script, directory],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(directory), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
