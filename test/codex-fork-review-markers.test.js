'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../src/codex');

async function writeJsonl(file, records) {
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function makeMaterializedReviewMarkerFixture(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-fork-review-markers-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '09');
  const parentId = '11111111-1111-4111-8111-111111111111';
  const materializedChildId = '22222222-2222-4222-8222-222222222222';
  const reviewChildId = '33333333-3333-4333-8333-333333333333';
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });

  const parentRecords = [
    {
      timestamp: '2026-08-09T10:00:00.000Z',
      type: 'session_meta',
      payload: { id: parentId, cwd: repoRoot },
    },
    {
      timestamp: '2026-08-09T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'entered_review_mode', target: { type: 'uncommittedChanges' } },
    },
    {
      timestamp: '2026-08-09T10:00:03.000Z',
      type: 'event_msg',
      payload: { type: 'exited_review_mode', review_output: { findings: [] } },
    },
  ];
  const materializedChildRecords = [
    {
      timestamp: '2026-08-09T10:05:00.000Z',
      type: 'session_meta',
      payload: { id: materializedChildId, forked_from_id: parentId, cwd: repoRoot, thread_source: 'user' },
    },
    ...parentRecords.map((record) => structuredClone(record)),
    {
      timestamp: '2026-08-09T10:05:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Owned materialized continuation' },
    },
  ];
  const reviewChildRecords = [
    {
      timestamp: '2026-08-09T10:00:02.000Z',
      type: 'session_meta',
      payload: {
        id: reviewChildId,
        cwd: repoRoot,
        thread_source: 'subagent',
        source: { subagent: 'review' },
        agent_nickname: 'Review',
      },
    },
    {
      timestamp: '2026-08-09T10:00:02.100Z',
      type: 'event_msg',
      payload: { type: 'task_started' },
    },
  ];

  await writeJsonl(path.join(sessionDir, `rollout-parent-${parentId}.jsonl`), parentRecords);
  await writeJsonl(path.join(sessionDir, `rollout-materialized-${materializedChildId}.jsonl`), materializedChildRecords);
  await writeJsonl(path.join(sessionDir, `rollout-review-${reviewChildId}.jsonl`), reviewChildRecords);
  return { codexHome, repoRoot, parentId, materializedChildId, reviewChildId };
}

test('materialized inherited review markers do not participate in review parent inference or reindex', async (t) => {
  const fixture = await makeMaterializedReviewMarkerFixture(t);
  const first = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const materializedChild = first.sessionsById.get(fixture.materializedChildId);
  const reviewChild = first.sessionsById.get(fixture.reviewChildId);
  assert.equal(materializedChild.forkStorageMode, 'materialized');
  assert.equal(materializedChild.logicalEvents.some((event) => event.kind === 'review'), false);
  assert.equal(reviewChild.parentSessionId, fixture.parentId);
  assert.equal(reviewChild.parentSessionInferred, true);

  const second = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: first,
  });
  const reindexedReviewChild = second.sessionsById.get(fixture.reviewChildId);
  assert.ok(second.totals.reusedFileCount >= 3);
  assert.equal(reindexedReviewChild.parentSessionId, fixture.parentId);
  assert.equal(reindexedReviewChild.parentSessionInferred, true);
});
