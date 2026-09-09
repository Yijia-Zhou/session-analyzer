'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildIndex, buildSourceBackedIndex } = require('../src/codex');

async function writeJsonl(file, records) {
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function reviewLifecycleRecords({ envelope, ownerId, enteredAt, exitedAt }) {
  if (envelope === 'canonical') {
    return [
      {
        timestamp: enteredAt,
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          thread_id: ownerId,
          item: { type: 'EnteredReviewMode', target: { type: 'uncommittedChanges' } },
        },
      },
      {
        timestamp: exitedAt,
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          thread_id: ownerId,
          item: { type: 'ExitedReviewMode', review_output: { findings: [] } },
        },
      },
    ];
  }
  return [
    {
      timestamp: enteredAt,
      type: 'event_msg',
      payload: {
        type: 'entered_review_mode',
        thread_id: ownerId,
        target: { type: 'uncommittedChanges' },
      },
    },
    {
      timestamp: exitedAt,
      type: 'event_msg',
      payload: {
        type: 'exited_review_mode',
        thread_id: ownerId,
        review_output: { findings: [] },
      },
    },
  ];
}

function reviewChildTranscript(repoRoot, reviewChildId, startedAt = '2026-08-09T10:00:02.000Z') {
  return [
    {
      timestamp: startedAt,
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
      timestamp: new Date(Date.parse(startedAt) + 100).toISOString(),
      type: 'event_msg',
      payload: { type: 'task_started' },
    },
  ];
}

function relationshipProjection(index, sessionIds) {
  return sessionIds.map((id) => {
    const session = index.sessionsById.get(id);
    return {
      id,
      parentSessionId: session.parentSessionId,
      parentSessionInferred: session.parentSessionInferred,
      forkedFromSessionId: session.forkedFromSessionId,
      forkStorageMode: session.forkStorageMode,
    };
  });
}

async function makeOrdinaryReviewFixture(t, { envelope = 'legacy', candidateCount = 1 } = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-ordinary-review-markers-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '09');
  const primaryIds = [
    'aaaaaaaa-1111-4111-8111-111111111111',
    'bbbbbbbb-2222-4222-8222-222222222222',
  ].slice(0, candidateCount);
  const reviewChildId = 'cccccccc-3333-4333-8333-333333333333';
  const primaryFiles = [];
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });

  for (const [index, primaryId] of primaryIds.entries()) {
    const primaryFile = path.join(sessionDir, `rollout-primary-${index}-${primaryId}.jsonl`);
    primaryFiles.push(primaryFile);
    await writeJsonl(primaryFile, [
      {
        timestamp: `2026-08-09T10:00:0${index}.000Z`,
        type: 'session_meta',
        payload: { id: primaryId, cwd: repoRoot },
      },
      ...reviewLifecycleRecords({
        envelope,
        ownerId: primaryId,
        enteredAt: '2026-08-09T10:00:01.000Z',
        exitedAt: '2026-08-09T10:00:03.000Z',
      }),
    ]);
  }
  await writeJsonl(
    path.join(sessionDir, `rollout-review-${reviewChildId}.jsonl`),
    reviewChildTranscript(repoRoot, reviewChildId),
  );
  return { codexHome, primaryFiles, primaryIds, repoRoot, reviewChildId };
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

  const parentFile = path.join(sessionDir, `rollout-parent-${parentId}.jsonl`);
  const materializedChildFile = path.join(
    sessionDir,
    `rollout-materialized-${materializedChildId}.jsonl`,
  );
  await writeJsonl(parentFile, parentRecords);
  await writeJsonl(materializedChildFile, materializedChildRecords);
  await writeJsonl(path.join(sessionDir, `rollout-review-${reviewChildId}.jsonl`), reviewChildRecords);
  return {
    codexHome,
    materializedChildFile,
    materializedChildId,
    materializedChildRecords,
    parentFile,
    parentId,
    parentRecords,
    repoRoot,
    reviewChildId,
    sessionDir,
  };
}

test('strict source-backed ordinary review-parent inference accepts both canonical envelopes', async (t) => {
  for (const envelope of ['legacy', 'canonical']) {
    await t.test(envelope, async (subtest) => {
      const fixture = await makeOrdinaryReviewFixture(subtest, { envelope });
      const resident = await buildIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
      });
      let relationshipEvidence = null;
      const strict = await buildSourceBackedIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
        beforeRelationshipInferenceForTests: ({ relationshipEvidence: evidence }) => {
          relationshipEvidence = evidence;
        },
      });
      const primaryEvidence = relationshipEvidence.find(
        (evidence) => evidence.id === fixture.primaryIds[0],
      );
      const reviewChild = strict.sessionsById.get(fixture.reviewChildId);

      assert.deepEqual(primaryEvidence._reviewMarkers, [{
        enteredAt: '2026-08-09T10:00:01.000Z',
        exitedAt: '2026-08-09T10:00:03.000Z',
      }]);
      assert.equal(reviewChild.parentSessionId, fixture.primaryIds[0]);
      assert.equal(reviewChild.parentSessionInferred, true);
      assert.deepEqual(
        relationshipProjection(strict, [fixture.reviewChildId]),
        relationshipProjection(resident, [fixture.reviewChildId]),
      );
    });
  }
});

test('strict source-backed review-parent ambiguity remains fail-closed', async (t) => {
  const fixture = await makeOrdinaryReviewFixture(t, { candidateCount: 2 });
  const resident = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const strict = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  const reviewChild = strict.sessionsById.get(fixture.reviewChildId);

  assert.equal(reviewChild.parentSessionId, '');
  assert.equal(reviewChild.parentSessionInferred, false);
  assert.deepEqual(
    relationshipProjection(strict, [fixture.reviewChildId]),
    relationshipProjection(resident, [fixture.reviewChildId]),
  );
});

test('materialized inherited review markers do not participate in review parent inference or reindex', async (t) => {
  const fixture = await makeMaterializedReviewMarkerFixture(t);
  const first = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const materializedChild = first.sessionsById.get(fixture.materializedChildId);
  const reviewChild = first.sessionsById.get(fixture.reviewChildId);
  assert.equal(materializedChild.forkStorageMode, 'materialized');
  assert.equal(materializedChild.logicalEvents.some((event) => event.kind === 'review'), false);
  assert.deepEqual(materializedChild._reviewMarkers, []);
  assert.equal(reviewChild.parentSessionId, fixture.parentId);
  assert.equal(reviewChild.parentSessionInferred, true);

  const second = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: first,
  });
  const reindexedReviewChild = second.sessionsById.get(fixture.reviewChildId);
  const reindexedMaterializedChild = second.sessionsById.get(fixture.materializedChildId);
  assert.ok(second.totals.reusedFileCount >= 3);
  assert.deepEqual(reindexedMaterializedChild._reviewMarkers, []);
  assert.equal(reindexedReviewChild.parentSessionId, fixture.parentId);
  assert.equal(reindexedReviewChild.parentSessionInferred, true);
});

test('strict source-backed materialized review inference excludes inherited markers', async (t) => {
  const fixture = await makeMaterializedReviewMarkerFixture(t);
  const resident = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  let evidenceById = null;
  const strict = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    beforeRelationshipInferenceForTests: ({ relationshipEvidence }) => {
      evidenceById = new Map(relationshipEvidence.map((evidence) => [evidence.id, evidence]));
      assert.equal(evidenceById.get(fixture.materializedChildId)._reviewMarkers, null);
    },
  });
  const materializedChild = strict.sessionsById.get(fixture.materializedChildId);
  const reviewChild = strict.sessionsById.get(fixture.reviewChildId);

  assert.equal(materializedChild.forkStorageMode, 'materialized');
  assert.equal(Object.hasOwn(materializedChild, '_reviewMarkers'), false);
  assert.deepEqual(evidenceById.get(fixture.materializedChildId)._reviewMarkers, []);
  assert.deepEqual(evidenceById.get(fixture.parentId)._reviewMarkers, [{
    enteredAt: '2026-08-09T10:00:01.000Z',
    exitedAt: '2026-08-09T10:00:03.000Z',
  }]);
  assert.equal(reviewChild.parentSessionId, fixture.parentId);
  assert.equal(reviewChild.parentSessionInferred, true);
  assert.deepEqual(
    relationshipProjection(strict, [fixture.materializedChildId, fixture.reviewChildId]),
    relationshipProjection(resident, [fixture.materializedChildId, fixture.reviewChildId]),
  );

  const unchanged = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: strict,
  });
  assert.equal(unchanged.sessions, strict.sessions);
  assert.equal(unchanged.sessionsById, strict.sessionsById);
  assert.deepEqual(
    relationshipProjection(unchanged, [fixture.materializedChildId, fixture.reviewChildId]),
    relationshipProjection(strict, [fixture.materializedChildId, fixture.reviewChildId]),
  );
});

test('strict source-backed materialized review inference accepts owned continuation markers', async (t) => {
  const fixture = await makeMaterializedReviewMarkerFixture(t);
  const ownedReviewChildId = '44444444-4444-4444-8444-444444444444';
  const enteredAt = '2026-08-09T10:10:01.000Z';
  const exitedAt = '2026-08-09T10:10:03.000Z';
  await writeJsonl(fixture.materializedChildFile, [
    ...fixture.materializedChildRecords,
    ...reviewLifecycleRecords({
      envelope: 'canonical',
      ownerId: fixture.materializedChildId,
      enteredAt,
      exitedAt,
    }),
  ]);
  await writeJsonl(
    path.join(fixture.sessionDir, `rollout-owned-review-${ownedReviewChildId}.jsonl`),
    reviewChildTranscript(fixture.repoRoot, ownedReviewChildId, '2026-08-09T10:10:02.000Z'),
  );

  const resident = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  let childEvidence = null;
  const strict = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    beforeRelationshipInferenceForTests: ({ relationshipEvidence }) => {
      childEvidence = relationshipEvidence.find(
        (evidence) => evidence.id === fixture.materializedChildId,
      );
      assert.equal(childEvidence._reviewMarkers, null);
    },
  });
  const materializedChild = strict.sessionsById.get(fixture.materializedChildId);
  const ownedReviewChild = strict.sessionsById.get(ownedReviewChildId);

  assert.equal(materializedChild.forkStorageMode, 'materialized');
  assert.deepEqual(childEvidence._reviewMarkers, [{ enteredAt, exitedAt }]);
  assert.equal(ownedReviewChild.parentSessionId, fixture.materializedChildId);
  assert.equal(ownedReviewChild.parentSessionInferred, true);
  assert.deepEqual(
    relationshipProjection(strict, [fixture.materializedChildId, ownedReviewChildId]),
    relationshipProjection(resident, [fixture.materializedChildId, ownedReviewChildId]),
  );
});

async function makeSwitchingReviewFixture(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-switching-review-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '09');
  const firstPrimaryId = 'dddddddd-4444-4444-8444-444444444444';
  const secondPrimaryId = 'eeeeeeee-5555-4555-8555-555555555555';
  const reviewChildId = 'ffffffff-6666-4666-8666-666666666666';
  const firstPrimaryFile = path.join(sessionDir, `rollout-first-${firstPrimaryId}.jsonl`);
  const secondPrimaryFile = path.join(sessionDir, `rollout-second-${secondPrimaryId}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });

  const writePrimary = (file, primaryId, matching) => writeJsonl(file, [
    {
      timestamp: '2026-08-09T09:59:00.000Z',
      type: 'session_meta',
      payload: { id: primaryId, cwd: repoRoot },
    },
    ...reviewLifecycleRecords({
      envelope: 'legacy',
      ownerId: primaryId,
      enteredAt: matching ? '2026-08-09T10:00:01.000Z' : '2026-08-09T11:00:01.000Z',
      exitedAt: matching ? '2026-08-09T10:00:03.000Z' : '2026-08-09T11:00:03.000Z',
    }),
  ]);
  await writePrimary(firstPrimaryFile, firstPrimaryId, true);
  await writePrimary(secondPrimaryFile, secondPrimaryId, false);
  await writeJsonl(
    path.join(sessionDir, `rollout-review-${reviewChildId}.jsonl`),
    reviewChildTranscript(repoRoot, reviewChildId),
  );

  return {
    codexHome,
    firstPrimaryId,
    repoRoot,
    reviewChildId,
    secondPrimaryId,
    switchAcceptedLifecycleSources: async () => {
      await writePrimary(firstPrimaryFile, firstPrimaryId, false);
      await writePrimary(secondPrimaryFile, secondPrimaryId, true);
    },
  };
}

test('strict source-backed reindex preserves unchanged review relationships and recomputes changes', async (t) => {
  const fixture = await makeSwitchingReviewFixture(t);
  const first = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  const firstReviewChild = first.sessionsById.get(fixture.reviewChildId);
  assert.equal(firstReviewChild.parentSessionId, fixture.firstPrimaryId);
  assert.equal(firstReviewChild.parentSessionInferred, true);

  const unchanged = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: first,
  });
  assert.equal(unchanged.sessions, first.sessions);
  assert.equal(unchanged.sessionsById, first.sessionsById);
  assert.deepEqual(
    relationshipProjection(unchanged, [fixture.reviewChildId]),
    relationshipProjection(first, [fixture.reviewChildId]),
  );

  await fixture.switchAcceptedLifecycleSources();
  const changed = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: unchanged,
  });
  const changedReviewChild = changed.sessionsById.get(fixture.reviewChildId);
  assert.notEqual(changedReviewChild, firstReviewChild);
  assert.equal(changedReviewChild.parentSessionId, fixture.secondPrimaryId);
  assert.equal(changedReviewChild.parentSessionInferred, true);

  const changedResident = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  assert.deepEqual(
    relationshipProjection(changed, [fixture.reviewChildId]),
    relationshipProjection(changedResident, [fixture.reviewChildId]),
  );
});

test('strict source-backed review relationship inference preserves snapshot and abort contracts', async (t) => {
  await t.test('accepted source rewrite fails the in-progress Index', async (subtest) => {
    const fixture = await makeOrdinaryReviewFixture(subtest);
    await assert.rejects(
      buildSourceBackedIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
        beforeRelationshipInferenceForTests: async () => {
          const original = await fsp.readFile(fixture.primaryFiles[0], 'utf8');
          const rewritten = original.replace('10:00:01.000Z', '10:00:04.000Z');
          assert.equal(rewritten.length, original.length);
          await fsp.writeFile(fixture.primaryFiles[0], rewritten, 'utf8');
        },
      }),
      { code: 'SOURCE_CHANGED_DURING_INDEX' },
    );
  });

  await t.test('abort during relationship inference rejects without an Index', async (subtest) => {
    const fixture = await makeOrdinaryReviewFixture(subtest);
    const controller = new AbortController();
    let reachedRelationshipInference = false;
    await assert.rejects(
      buildSourceBackedIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
        signal: controller.signal,
        beforeRelationshipInferenceForTests: () => {
          reachedRelationshipInference = true;
          controller.abort();
        },
      }),
      { name: 'AbortError' },
    );
    assert.equal(reachedRelationshipInference, true);
  });
});
