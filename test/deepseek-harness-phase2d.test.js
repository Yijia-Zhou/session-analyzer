'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildDeepSeekIndex,
  deepSeekAdapter,
} = require('../src/deepseek-harness');
const {
  buildEventDetailForSession,
  materializeSessionForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-phase2d', 'sessions');
const PERMISSION_REPO = '/synthetic/deepseek-phase2d-permission';
const PERMISSION_TYPES = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);

async function buildFor(repoRoot, sourceHome = FIXTURE_ROOT) {
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot });
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  return { index, indexed, materialized };
}

async function assertProjectionParity(index, indexed, materialized) {
  const digest = await projectQueryProjectionDigestAsync(
    materialized,
    deepSeekAdapter.query.projectQueryPresentation,
  );
  assert.equal(digest, indexed.queryProjectionDigest);
}

function rawSeqs(event) {
  return event.rawRefs.map(ref => ref.sourceLocator.seq);
}

async function makeSyntheticFixture(t, id, records, headerFields = {}) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2d-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2d-home-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  t.after(() => fsp.rm(repoRoot, { recursive: true, force: true }));
  const sessionDir = path.join(sourceHome, '--synthetic-project--', id);
  await fsp.mkdir(sessionDir, { recursive: true });
  const header = {
    type: 'session', version: 0, id, createdAt: 1, cwd: repoRoot, delegationDepth: 0,
    ...headerFields,
  };
  await fsp.writeFile(
    path.join(sessionDir, 'session.jsonl'),
    `${[header, ...records].map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );
  return { sourceHome, repoRoot };
}

test('M1 Permission rows expose partial/latest observed state without deployment-bundle inference', async () => {
  const { index, indexed, materialized } = await buildFor(PERMISSION_REPO);
  const permissions = materialized.logicalEvents.filter(event => PERMISSION_TYPES.has(event.subtype));
  assert.equal(permissions.length, 8);
  assert.ok(permissions.every(event => event.layer === 'protocol' && event.kind === 'protocol'));
  assert.deepEqual(permissions.map(rawSeqs), [[0], [1], [2], [8], [9], [10], [11], [12]]);
  assert.deepEqual(permissions.map(event => event.permissionState), [
    { preset: 'workspace-write', sandboxMode: null, approvalPolicy: null, complete: false },
    { preset: 'workspace-write', sandboxMode: 'workspace-write', approvalPolicy: null, complete: false },
    { preset: 'workspace-write', sandboxMode: 'workspace-write', approvalPolicy: 'ask', complete: true },
    { preset: 'custom-lab-profile', sandboxMode: 'workspace-write', approvalPolicy: 'ask', complete: true },
    { preset: 'custom-lab-profile', sandboxMode: 'read-only', approvalPolicy: 'ask', complete: true },
    { preset: 'custom-lab-profile', sandboxMode: 'read-only', approvalPolicy: 'never', complete: true },
    { preset: 'custom-lab-profile', sandboxMode: 'danger-full-access', approvalPolicy: 'never', complete: true },
    { preset: 'custom-lab-profile', sandboxMode: 'danger-full-access', approvalPolicy: 'ask', complete: true },
  ]);
  assert.equal(permissions[3].permissionChange.value, 'custom-lab-profile');
  assert.equal(Object.hasOwn(materialized, 'permissionState'), false);
  assert.equal(Object.hasOwn(materialized, 'sandboxMode'), false);
  assert.equal(Object.hasOwn(materialized, 'approvalPolicy'), false);
  assert.equal(Object.hasOwn(indexed, 'permissionState'), false);
  assert.equal(indexed.counts.protocol, 13);
  assert.equal(indexed.counts.messages, 0);

  const partialDetail = await buildEventDetailForSession(index, materialized, permissions[0].id, 'protocol');
  validateStructuredLogicalDetailDto(partialDetail);
  assert.ok(partialDetail.timelineSections.some(section => (
    section.purpose === 'context' && section.type === 'kv'
    && section.title === 'Permission state after this event'
    && section.entries.some(entry => entry.key === 'Sandbox' && entry.value === 'unknown')
  )));
  assert.ok(partialDetail.inspectorSections.some(section => (
    section.purpose === 'traceability' && section.type === 'kv'
    && section.entries.some(entry => entry.key === 'Observed state' && entry.value === 'partial')
  )));
  const completeDetail = await buildEventDetailForSession(index, materialized, permissions[2].id, 'protocol');
  validateStructuredLogicalDetailDto(completeDetail);
  assert.ok(completeDetail.inspectorSections.some(section => (
    section.type === 'kv'
    && section.entries.some(entry => entry.key === 'Observed state' && entry.value === 'complete')
  )));

  const owned = new Set();
  for (const event of permissions) {
    assert.equal(event.rawRefs.length, 1);
    assert.equal(owned.has(event.rawRefs[0].rawId), false);
    owned.add(event.rawRefs[0].rawId);
  }
  assert.equal(owned.size, 8);
  await assertProjectionParity(index, indexed, materialized);
});

test('M1 malformed Permission knobs fail closed without silently changing the observed fold', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'permission-malformed', [
    { type: 'permission/preset', seq: 0, time: 2, data: { preset: 'custom-history' } },
    { type: 'sandbox/mode', seq: 1, time: 3, data: { mode: 'workspace-write' } },
    { type: 'sandbox/mode', seq: 2, time: 4, data: { mode: 'host-root' } },
    { type: 'approval/policy', seq: 3, time: 5, data: { policy: 'always' } },
    { type: 'approval/policy', seq: 4, time: 6, data: { policy: 'never' } },
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const rows = materialized.logicalEvents.filter(event => PERMISSION_TYPES.has(event.subtype));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.filter(event => event.permissionState).map(rawSeqs), [[0], [1], [4]]);
  assert.ok(rows.filter(event => !event.permissionState).every(event => (
    event.status === 'incomplete' && event.severity === 'warning' && event.rawRefs.length === 1
  )));
  assert.deepEqual(rows.at(-1).permissionState, {
    preset: 'custom-history', sandboxMode: 'workspace-write', approvalPolicy: 'never', complete: true,
  });
});

test('M1 seeded inherited Permission rows never become child-owned observed state', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'permission-seeded-child', [
    { type: 'permission/preset', seq: 0, time: 2, data: { preset: 'parent-preset' } },
    { type: 'sandbox/mode', seq: 1, time: 3, data: { mode: 'workspace-write' } },
    { type: 'approval/policy', seq: 2, time: 4, data: { policy: 'ask' } },
    { type: 'sandbox/mode', seq: 3, time: 5, data: { mode: 'read-only', source: 'delegation' } },
  ], { seedLength: 3, parentSession: 'synthetic-parent' });
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const rows = materialized.logicalEvents.filter(event => PERMISSION_TYPES.has(event.subtype));
  assert.equal(rows.length, 1);
  assert.deepEqual(rawSeqs(rows[0]), [3]);
  assert.deepEqual(rows[0].permissionState, {
    preset: null, sandboxMode: 'read-only', approvalPolicy: null, complete: false,
  });
  assert.equal(rows[0].permissionChange.source, 'delegation');
  assert.equal(materialized.forkStorageMode, 'materialized');
  assert.ok(materialized.inheritedContext);
});

test('M1 accepted snapshot rejects stale Permission Materialized, Detail, and Raw reads', async (t) => {
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2d-fresh-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  const source = path.join(
    FIXTURE_ROOT,
    '--synthetic-deepseek-phase2d-permission--',
    'permission',
    'session.jsonl',
  );
  const target = path.join(sourceHome, '--copy--', 'permission', 'session.jsonl');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot: PERMISSION_REPO });
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  const permission = materialized.logicalEvents.find(event => event.permissionState?.complete === true);
  const raw = materialized.rawEvents.find(candidate => candidate.rawId === permission.rawRefs[0].rawId);
  await fsp.appendFile(target, `${JSON.stringify({
    type: 'session/end-seed', seq: 13, time: 15, data: {},
  })}\n`, 'utf8');
  await assert.rejects(
    materializeSessionForIndex(index, indexed),
    error => error?.code === 'INDEXED_SOURCE_STALE',
  );
  await assert.rejects(
    buildEventDetailForSession(index, materialized, permission.id, 'protocol'),
    error => error?.code === 'INDEXED_SOURCE_STALE',
  );
  await assert.rejects(
    deepSeekAdapter.readRawRecord(index, materialized, raw),
    error => error?.code === 'INDEXED_SOURCE_STALE',
  );
});
