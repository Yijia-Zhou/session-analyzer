'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildSourceBackedIndex } = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

const SENTINEL = `M2_RELATIONSHIP_SENTINEL_${'x'.repeat(128 * 1024)}`;

const IDS = Object.freeze({
  lineProjection: '10101010-1010-4010-8010-101010101010',
  uniquePrimary: '20202020-2020-4020-8020-202020202020',
  uniqueReview: '30303030-3030-4030-8030-303030303030',
  ambiguousPrimaryA: '40404040-4040-4040-8040-404040404040',
  ambiguousPrimaryB: '50505050-5050-4050-8050-505050505050',
  ambiguousReview: '60606060-6060-4060-8060-606060606060',
  plainParent: '70707070-7070-4070-8070-707070707070',
  plainChild: '80808080-8080-4080-8080-808080808080',
  materializedParent: '90909090-9090-4090-8090-909090909090',
  materializedChild: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  inheritedReview: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ownedReview: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  cycleFirst: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  cycleSecond: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
});

async function makeFixtureRoot(t, label) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), `session-analyzer-${label}-`));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionRoot = path.join(codexHome, 'sessions', '2026', '09', '01');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionRoot, { recursive: true });
  return { codexHome, repoRoot, sessionRoot };
}

async function writeRecords(file, records) {
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function writeLines(file, lines) {
  await fsp.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
}

function sessionMeta(id, cwd, timestamp, extra = {}) {
  return {
    timestamp,
    type: 'session_meta',
    version: 'm2-fixture-client',
    payload: { id, cwd, ...extra },
  };
}

function reviewRecords({ ownerId, enteredAt, exitedAt, envelope = 'canonical' }) {
  if (envelope === 'legacy') {
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

function reviewChild(id, cwd, timestamp) {
  return [
    sessionMeta(id, cwd, timestamp, {
      thread_source: 'subagent',
      source: { subagent: 'review' },
      agent_nickname: 'Review',
    }),
    {
      timestamp: new Date(Date.parse(timestamp) + 100).toISOString(),
      type: 'event_msg',
      payload: { type: 'task_started' },
    },
  ];
}

function normalizeIndex(index) {
  return { ...index, generatedAt: '<normalized-generated-at>' };
}

function countModes(modes) {
  return modes.reduce((counts, entry) => {
    counts[entry.mode] += 1;
    return counts;
  }, { light: 0, full: 0 });
}

function assertNoRetainedSourceContent(root, sentinel) {
  const forbiddenKeys = new Set([
    'rawEvents',
    'logicalEvents',
    '_logicalEvents',
    'analysis',
    'presentationIndexes',
    '_cacheObservationSeeds',
    'cacheObservation',
    'cacheDiscontinuityLinks',
    'accountingSource',
    'inputTokens',
    'cachedInputTokens',
    'outputTokens',
    'totalTokens',
    'parsed',
    'payload',
    'messageText',
    'searchText',
    'preview',
    'commandText',
    'stdout',
    'stderr',
    'aggregatedOutput',
    'output',
  ]);
  const pending = [root];
  const seen = new Set();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      assert.equal(value.includes(sentinel), false, 'relationship evidence retained sentinel text');
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Map) {
      for (const [key, nested] of value) pending.push(key, nested);
      continue;
    }
    if (value instanceof Set) {
      for (const nested of value) pending.push(nested);
      continue;
    }
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `relationship evidence retained ${key}`);
      pending.push(nested);
    }
  }
}

async function makeComprehensiveFixture(t) {
  const fixture = await makeFixtureRoot(t, 'codex-relationship-scan');
  const { repoRoot, sessionRoot } = fixture;
  const files = [];
  const addRecords = async (name, records) => {
    const file = path.join(sessionRoot, name);
    files.push(file);
    await writeRecords(file, records);
    return file;
  };

  const lineFile = path.join(sessionRoot, '00-line-projection.jsonl');
  files.push(lineFile);
  await writeLines(lineFile, [
    '',
    'true',
    JSON.stringify(sessionMeta(
      IDS.lineProjection,
      repoRoot,
      '2026-09-01T08:00:00.000Z',
    )),
    JSON.stringify({
      timestamp: '2026-09-01T08:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: SENTINEL },
    }),
  ]);

  await addRecords('01-unique-primary.jsonl', [
    sessionMeta(IDS.uniquePrimary, repoRoot, '2026-09-01T09:59:00.000Z'),
    ...reviewRecords({
      ownerId: IDS.uniquePrimary,
      enteredAt: '2026-09-01T10:00:01.000Z',
      exitedAt: '2026-09-01T10:00:03.000Z',
    }),
  ]);
  await addRecords(
    '02-unique-review.jsonl',
    reviewChild(IDS.uniqueReview, repoRoot, '2026-09-01T10:00:02.000Z'),
  );

  for (const [name, id, envelope] of [
    ['03-ambiguous-primary-a.jsonl', IDS.ambiguousPrimaryA, 'legacy'],
    ['04-ambiguous-primary-b.jsonl', IDS.ambiguousPrimaryB, 'canonical'],
  ]) {
    await addRecords(name, [
      sessionMeta(id, repoRoot, '2026-09-01T13:59:00.000Z'),
      ...reviewRecords({
        ownerId: id,
        enteredAt: '2026-09-01T14:00:01.000Z',
        exitedAt: '2026-09-01T14:00:03.000Z',
        envelope,
      }),
    ]);
  }
  await addRecords(
    '05-ambiguous-review.jsonl',
    reviewChild(IDS.ambiguousReview, repoRoot, '2026-09-01T14:00:02.000Z'),
  );

  const plainParentRecords = [
    sessionMeta(IDS.plainParent, repoRoot, '2026-09-01T11:00:00.000Z'),
    {
      timestamp: '2026-09-01T11:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'plain parent' },
    },
  ];
  await addRecords('06-plain-parent.jsonl', plainParentRecords);
  await addRecords('07-plain-child.jsonl', [
    sessionMeta(IDS.plainChild, repoRoot, '2026-09-01T11:05:00.000Z', {
      forked_from_id: IDS.plainParent,
    }),
    {
      timestamp: '2026-09-01T11:05:00.100Z',
      type: 'event_msg',
      payload: { type: 'warning', message: 'not copied parent metadata' },
    },
    {
      timestamp: '2026-09-01T11:05:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'plain child continuation' },
    },
  ]);

  const materializedParentRecords = [
    sessionMeta(IDS.materializedParent, repoRoot, '2026-09-01T12:00:00.000Z'),
    ...reviewRecords({
      ownerId: IDS.materializedParent,
      enteredAt: '2026-09-01T12:00:01.000Z',
      exitedAt: '2026-09-01T12:00:03.000Z',
      envelope: 'legacy',
    }),
    {
      timestamp: '2026-09-01T12:00:04.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'parent before fork' },
    },
  ];
  await addRecords('08-materialized-parent.jsonl', materializedParentRecords);
  await addRecords('09-materialized-child.jsonl', [
    sessionMeta(IDS.materializedChild, repoRoot, '2026-09-01T12:05:00.000Z', {
      forked_from_id: IDS.materializedParent,
    }),
    ...structuredClone(materializedParentRecords),
    {
      timestamp: '2026-09-01T12:05:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'owned materialized continuation' },
    },
    ...reviewRecords({
      ownerId: IDS.materializedChild,
      enteredAt: '2026-09-01T12:10:01.000Z',
      exitedAt: '2026-09-01T12:10:03.000Z',
    }),
  ]);
  await addRecords(
    '10-inherited-review.jsonl',
    reviewChild(IDS.inheritedReview, repoRoot, '2026-09-01T12:00:02.000Z'),
  );
  await addRecords(
    '11-owned-review.jsonl',
    reviewChild(IDS.ownedReview, repoRoot, '2026-09-01T12:10:02.000Z'),
  );

  const firstMeta = sessionMeta(
    IDS.cycleFirst,
    repoRoot,
    '2026-09-01T15:00:00.000Z',
    { forked_from_id: IDS.cycleSecond },
  );
  const secondMeta = sessionMeta(
    IDS.cycleSecond,
    repoRoot,
    '2026-09-01T15:00:01.000Z',
    { forked_from_id: IDS.cycleFirst },
  );
  await addRecords('12-cycle-first.jsonl', [
    firstMeta,
    structuredClone(secondMeta),
    {
      timestamp: '2026-09-01T15:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'first cycle continuation' },
    },
  ]);
  await addRecords('13-cycle-second.jsonl', [
    secondMeta,
    structuredClone(firstMeta),
    {
      timestamp: '2026-09-01T15:00:03.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'second cycle continuation' },
    },
  ]);

  return { ...fixture, files };
}

async function buildCaptured(fixture, forceFullRelationshipPassForTests = false) {
  const modes = [];
  let relationshipEvidence = null;
  let verificationCount = 0;
  const index = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    forceFullRelationshipPassForTests,
    onRelationshipCandidateModeForTests: (entry) => modes.push(entry),
    beforeSourceSnapshotVerificationForTests: () => {
      verificationCount += 1;
    },
    beforeRelationshipInferenceForTests: ({ relationshipEvidence: evidence }) => {
      relationshipEvidence = structuredClone(evidence);
    },
  });
  return { index, modes, relationshipEvidence, verificationCount };
}

test('hybrid LIGHT evidence and final Index exactly match the corrected forced-full oracle', async (t) => {
  const fixture = await makeComprehensiveFixture(t);
  const hybrid = await buildCaptured(fixture, false);
  const forced = await buildCaptured(fixture, true);

  assert.deepEqual(hybrid.relationshipEvidence, forced.relationshipEvidence);
  assert.deepEqual(normalizeIndex(hybrid.index), normalizeIndex(forced.index));
  assert.deepEqual(countModes(hybrid.modes), { light: 8, full: 6 });
  assert.deepEqual(countModes(forced.modes), { light: 0, full: 14 });
  assert.equal(
    hybrid.verificationCount,
    30,
    '14 relationship scans, two cycle prerequisite parses, and 14 final parses',
  );
  assert.equal(forced.verificationCount, 30);
  const hybridModesByBasename = new Map(
    hybrid.modes.map((entry) => [path.basename(entry.sourceFile), entry.mode]),
  );
  for (const basename of [
    '06-plain-parent.jsonl',
    '07-plain-child.jsonl',
    '08-materialized-parent.jsonl',
    '09-materialized-child.jsonl',
    '12-cycle-first.jsonl',
    '13-cycle-second.jsonl',
  ]) {
    assert.equal(hybridModesByBasename.get(basename), 'full', basename);
  }
  assert.equal(hybridModesByBasename.get('00-line-projection.jsonl'), 'light');
  assert.equal(hybridModesByBasename.get('01-unique-primary.jsonl'), 'light');

  const lineEvidence = hybrid.relationshipEvidence.find(
    (evidence) => evidence.id === IDS.lineProjection,
  );
  assert.equal(lineEvidence.lineCount, 3);
  assert.equal(lineEvidence.rawEventCount, 3);
  assert.equal(lineEvidence.sourceClientVersion, 'm2-fixture-client');
  assert.equal(lineEvidence._forkRawFacts.length, 2);
  assert.equal(lineEvidence._forkRawFacts[0][0], '00-line-projection:raw:2');
  assert.equal(lineEvidence._forkRawFacts[1][0], `${IDS.lineProjection}:raw:3`);
  assert.deepEqual(lineEvidence._canonicalRawDigests, []);
  assert.deepEqual(lineEvidence._forkLogicalRanges, []);
  assertNoRetainedSourceContent(hybrid.relationshipEvidence, 'M2_RELATIONSHIP_SENTINEL_');

  const uniqueReview = hybrid.index.sessionsById.get(IDS.uniqueReview);
  const ambiguousReview = hybrid.index.sessionsById.get(IDS.ambiguousReview);
  const plainChild = hybrid.index.sessionsById.get(IDS.plainChild);
  const materializedParent = hybrid.index.sessionsById.get(IDS.materializedParent);
  const materializedChild = hybrid.index.sessionsById.get(IDS.materializedChild);
  const inheritedReview = hybrid.index.sessionsById.get(IDS.inheritedReview);
  const ownedReview = hybrid.index.sessionsById.get(IDS.ownedReview);
  assert.equal(uniqueReview.parentSessionId, IDS.uniquePrimary);
  assert.equal(uniqueReview.parentSessionInferred, true);
  assert.equal(ambiguousReview.parentSessionId, '');
  assert.equal(ambiguousReview.parentSessionInferred, false);
  assert.equal(plainChild.forkedFromSessionId, IDS.plainParent);
  assert.equal(plainChild.forkStorageMode, '');
  assert.equal(materializedChild.forkStorageMode, 'materialized');
  assert.equal(materializedParent.supersededBySessionId, IDS.materializedChild);
  assert.equal(inheritedReview.parentSessionId, IDS.materializedParent);
  assert.equal(ownedReview.parentSessionId, IDS.materializedChild);
  assert.equal(hybrid.index.sessionsById.get(IDS.cycleFirst).forkStorageMode, 'materialized');
  assert.equal(hybrid.index.sessionsById.get(IDS.cycleSecond).forkStorageMode, 'materialized');

  const evidenceById = new Map(
    hybrid.relationshipEvidence.map((evidence) => [evidence.id, evidence]),
  );
  assert.deepEqual(evidenceById.get(IDS.uniquePrimary)._reviewMarkers, [{
    enteredAt: '2026-09-01T10:00:01.000Z',
    exitedAt: '2026-09-01T10:00:03.000Z',
  }]);
  assert.equal(evidenceById.get(IDS.materializedChild)._reviewMarkers, null);
});

async function makeOrdinaryFixture(t, label, count = 1) {
  const fixture = await makeFixtureRoot(t, label);
  const ids = [];
  const files = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index + 1).padStart(12, String(index + 1));
    const id = `${String(index + 1).repeat(8)}-${String(index + 1).repeat(4)}-4${String(index + 1).repeat(3)}-8${String(index + 1).repeat(3)}-${suffix}`;
    const file = path.join(fixture.sessionRoot, `${String(index).padStart(2, '0')}-ordinary.jsonl`);
    ids.push(id);
    files.push(file);
    await writeRecords(file, [
      sessionMeta(id, fixture.repoRoot, `2026-09-01T16:00:0${index}.000Z`),
      {
        timestamp: `2026-09-01T16:01:0${index}.000Z`,
        type: 'event_msg',
        payload: { type: 'user_message', message: `ordinary fixture ${index}` },
      },
    ]);
  }
  return { ...fixture, files, ids };
}

test('all-ordinary relationship candidates stay LIGHT with one relationship scan each', async (t) => {
  const fixture = await makeOrdinaryFixture(t, 'all-ordinary-relationship-scan', 3);
  const hybrid = await buildCaptured(fixture, false);
  const forced = await buildCaptured(fixture, true);

  assert.deepEqual(countModes(hybrid.modes), { light: 3, full: 0 });
  assert.deepEqual(countModes(forced.modes), { light: 0, full: 3 });
  assert.equal(hybrid.verificationCount, 6, 'three relationship scans plus three final parses');
  assert.equal(forced.verificationCount, 6, 'forced oracle still has one relationship parse per file');
  assert.deepEqual(hybrid.relationshipEvidence, forced.relationshipEvidence);
  assert.deepEqual(normalizeIndex(hybrid.index), normalizeIndex(forced.index));
});

test('malformed and falsy nonblank rows fail closed to FULL_FIRST_PARSE', async (t) => {
  const fixture = await makeFixtureRoot(t, 'uncertain-relationship-scan');
  const id = '12121212-1212-4212-8212-121212121212';
  const file = path.join(fixture.sessionRoot, 'uncertain.jsonl');
  await writeLines(file, [
    JSON.stringify(sessionMeta(id, fixture.repoRoot, '2026-09-01T16:30:00.000Z')),
    '{not valid json',
    'false',
    'null',
    JSON.stringify({
      timestamp: '2026-09-01T16:30:01.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'valid tail' },
    }),
  ]);

  const hybrid = await buildCaptured(fixture, false);
  const forced = await buildCaptured(fixture, true);
  assert.deepEqual(countModes(hybrid.modes), { light: 0, full: 1 });
  assert.deepEqual(countModes(forced.modes), { light: 0, full: 1 });
  assert.equal(hybrid.verificationCount, 3, 'uncertain scan, full fallback, and final parse');
  assert.equal(forced.verificationCount, 2, 'forced relationship parse and final parse');
  assert.deepEqual(hybrid.relationshipEvidence, forced.relationshipEvidence);
  assert.equal(hybrid.relationshipEvidence[0].lineCount, 5);
  assert.equal(hybrid.relationshipEvidence[0].rawEventCount, 2);
  assert.deepEqual(normalizeIndex(hybrid.index), normalizeIndex(forced.index));
});

async function makePlanningPromotionFixture(t, label) {
  const fixture = await makeFixtureRoot(t, label);
  const parentId = '13131313-1313-4313-8313-131313131313';
  const childId = '14141414-1414-4414-8414-141414141414';
  const parentFile = path.join(fixture.sessionRoot, '00-promotion-parent.jsonl');
  const childFile = path.join(fixture.sessionRoot, '01-promotion-child.jsonl');
  const parentRecords = [
    sessionMeta(parentId, fixture.repoRoot, '2026-09-01T17:00:00.000Z'),
    {
      timestamp: '2026-09-01T17:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'promotion parent context' },
    },
  ];
  const initialChildRecords = [
    sessionMeta(childId, fixture.repoRoot, '2026-09-01T17:05:00.000Z'),
    ...structuredClone(parentRecords),
    {
      timestamp: '2026-09-01T17:05:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'promotion child continuation' },
    },
  ];
  const promotedChildRecords = structuredClone(initialChildRecords);
  promotedChildRecords[0].payload.forked_from_id = parentId;
  await writeRecords(parentFile, parentRecords);
  await writeRecords(childFile, initialChildRecords);
  return {
    ...fixture,
    childFile,
    childId,
    parentId,
    promotedChildText: `${promotedChildRecords.map(JSON.stringify).join('\n')}\n`,
  };
}

test('accepted-prefix planning promotes newly deep paths without downgrading or double-counting', async (t) => {
  const fixture = await makePlanningPromotionFixture(t, 'relationship-planning-promotion');
  const fingerprintForText = (text) => require('node:crypto')
    .createHash('sha256')
    .update(text, 'utf8')
    .digest('base64url');
  const postSnapshotTimestamp = '2026-09-01T17:30:00.000Z';
  const postSnapshotSentinel = 'post-light-promotion-append-must-stay-out';
  const postSnapshotRecord = {
    timestamp: postSnapshotTimestamp,
    type: 'event_msg',
    payload: { type: 'agent_message', message: postSnapshotSentinel },
  };
  const modes = [];
  let verificationCount = 0;
  let rewritten = false;
  let appendedAfterLight = false;
  let acceptedP = null;
  let physicalP2 = null;
  let evidenceById = null;
  const index = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    onProgress: (progress) => {
      if (!rewritten && progress.phase === 'parsing' && !progress.analyzedFileCount) {
        rewritten = true;
        fs.writeFileSync(fixture.childFile, fixture.promotedChildText, 'utf8');
        return;
      }
      if (appendedAfterLight
          || progress.phase !== 'parsing'
          || progress.analyzedFileCount !== 2
          || progress.indexedFileCount !== 0) return;
      const pText = fs.readFileSync(fixture.childFile, 'utf8');
      const pStat = fs.statSync(fixture.childFile);
      const pLineCount = pText.trimEnd().split(/\r?\n/).length;
      acceptedP = {
        bytes: Buffer.byteLength(pText, 'utf8'),
        lineCount: pLineCount,
        rawEventCount: pLineCount,
        sourceFingerprint: fingerprintForText(pText),
        sourceIdentity: {
          device: String(pStat.dev),
          inode: String(pStat.ino),
        },
        updatedAt: '2026-09-01T17:05:01.000Z',
      };
      appendedAfterLight = true;
      fs.appendFileSync(
        fixture.childFile,
        `${JSON.stringify(postSnapshotRecord)}\n`,
        'utf8',
      );
      const p2Text = fs.readFileSync(fixture.childFile, 'utf8');
      const p2Stat = fs.statSync(fixture.childFile);
      physicalP2 = {
        bytes: Buffer.byteLength(p2Text, 'utf8'),
        lineCount: pLineCount + 1,
        rawEventCount: pLineCount + 1,
        sourceFingerprint: fingerprintForText(p2Text),
        sourceIdentity: {
          device: String(p2Stat.dev),
          inode: String(p2Stat.ino),
        },
        updatedAt: postSnapshotTimestamp,
        containsSentinel: p2Text.includes(postSnapshotSentinel),
      };
    },
    beforeSourceSnapshotVerificationForTests: () => {
      verificationCount += 1;
    },
    onRelationshipCandidateModeForTests: (entry) => modes.push(entry),
    beforeRelationshipInferenceForTests: ({ relationshipEvidence }) => {
      evidenceById = new Map(
        structuredClone(relationshipEvidence).map((evidence) => [evidence.id, evidence]),
      );
    },
  });

  assert.equal(rewritten, true);
  assert.equal(appendedAfterLight, true);
  assert.ok(acceptedP);
  assert.ok(physicalP2);
  assert.ok(physicalP2.bytes > acceptedP.bytes);
  assert.equal(physicalP2.lineCount, acceptedP.lineCount + 1);
  assert.equal(physicalP2.rawEventCount, acceptedP.rawEventCount + 1);
  assert.notEqual(physicalP2.sourceFingerprint, acceptedP.sourceFingerprint);
  assert.deepEqual(physicalP2.sourceIdentity, acceptedP.sourceIdentity);
  assert.equal(physicalP2.updatedAt, postSnapshotTimestamp);
  assert.equal(physicalP2.containsSentinel, true);
  assert.deepEqual(countModes(modes), { light: 0, full: 2 });
  assert.equal(verificationCount, 6, 'two scans, two promotions, and two final parses');
  const childEvidence = evidenceById.get(fixture.childId);
  assert.deepEqual({
    bytes: childEvidence.bytes,
    lineCount: childEvidence.lineCount,
    rawEventCount: childEvidence.rawEventCount,
    sourceFingerprint: childEvidence.sourceFingerprint,
    sourceIdentity: childEvidence.sourceIdentity,
    updatedAt: childEvidence.updatedAt,
  }, acceptedP);
  assert.equal(childEvidence._forkRawFacts.length, acceptedP.rawEventCount);
  assert.equal(
    childEvidence._forkRawFacts.some((fact) => fact[1] === postSnapshotTimestamp),
    false,
  );
  const indexedChild = index.sessionsById.get(fixture.childId);
  assert.equal(indexedChild.forkStorageMode, 'materialized');
  assert.equal(indexedChild.bytes, acceptedP.bytes);
  assert.equal(indexedChild.lineCount, acceptedP.lineCount);
  assert.equal(indexedChild.rawEventCount, acceptedP.rawEventCount);
  assert.equal(indexedChild.updatedAt, acceptedP.updatedAt);
  const childDependencySet = index.materializationDependencies.get(
    indexedChild.materializationDescriptor.dependencySetId,
  );
  const childTranscriptDependency = childDependencySet.entries.find(
    (entry) => entry.role === 'primary_transcript',
  );
  assert.equal(childTranscriptDependency.acceptedBytes, acceptedP.bytes);
  assert.equal(childTranscriptDependency.lineCount, acceptedP.lineCount);
  assert.equal(childTranscriptDependency.digest, acceptedP.sourceFingerprint);
  assert.equal(
    evidenceById.get(fixture.parentId)._canonicalRawDigests.length,
    evidenceById.get(fixture.parentId).rawEventCount,
  );
  assert.equal(
    evidenceById.get(fixture.childId)._canonicalRawDigests.length,
    evidenceById.get(fixture.childId).rawEventCount,
  );
  assert.equal(index.totals.candidateFileCount, 2);
  assert.equal(index.totals.indexedFileCount, 2);
});

test('cancellation is observed during LIGHT streaming and full promotion parsing', async (t) => {
  await t.test('LIGHT streaming', async (subtest) => {
    const fixture = await makeFixtureRoot(subtest, 'relationship-light-abort');
    const id = '15151515-1515-4515-8515-151515151515';
    const file = path.join(fixture.sessionRoot, 'large-ordinary.jsonl');
    const records = [sessionMeta(id, fixture.repoRoot, '2026-09-01T18:00:00.000Z')];
    for (let index = 0; index < 20_000; index += 1) {
      records.push({
        timestamp: new Date(Date.parse('2026-09-01T18:00:01.000Z') + index).toISOString(),
        type: 'event_msg',
        payload: { type: 'warning', message: `stream row ${index}` },
      });
    }
    await writeRecords(file, records);
    const controller = new AbortController();
    let scheduled = false;
    await assert.rejects(
      buildSourceBackedIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
        signal: controller.signal,
        onProgress: (progress) => {
          if (scheduled || progress.phase !== 'parsing') return;
          scheduled = true;
          setImmediate(() => controller.abort());
        },
      }),
      { name: 'AbortError' },
    );
    assert.equal(scheduled, true);
  });

  await t.test('full promotion parse', async (subtest) => {
    const fixture = await makePlanningPromotionFixture(subtest, 'relationship-promotion-abort');
    const controller = new AbortController();
    let rewritten = false;
    let verificationCount = 0;
    await assert.rejects(
      buildSourceBackedIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
        signal: controller.signal,
        onProgress: (progress) => {
          if (rewritten || progress.phase !== 'parsing' || progress.analyzedFileCount) return;
          rewritten = true;
          fs.writeFileSync(fixture.childFile, fixture.promotedChildText, 'utf8');
        },
        beforeSourceSnapshotVerificationForTests: () => {
          verificationCount += 1;
          if (verificationCount === 3) controller.abort();
        },
      }),
      { name: 'AbortError' },
    );
    assert.equal(rewritten, true);
    assert.equal(verificationCount, 3);
  });
});

async function makeSnapshotFixture(t, label) {
  const fixture = await makeFixtureRoot(t, label);
  const id = '16161616-1616-4616-8616-161616161616';
  const file = path.join(fixture.sessionRoot, 'snapshot.jsonl');
  const records = [
    sessionMeta(id, fixture.repoRoot, '2026-09-01T19:00:00.000Z'),
    {
      timestamp: '2026-09-01T19:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'stable-body' },
    },
  ];
  const originalText = `${records.map(JSON.stringify).join('\n')}\n`;
  await fsp.writeFile(file, originalText, 'utf8');
  return { ...fixture, file, id, originalText };
}

async function runAcceptedPrefixTransition(t, forceFullRelationshipPassForTests, transition) {
  const fixture = await makeSnapshotFixture(
    t,
    `relationship-${transition}-${forceFullRelationshipPassForTests ? 'full' : 'hybrid'}`,
  );
  const modes = [];
  try {
    const index = await buildSourceBackedIndex({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
      forceFullRelationshipPassForTests,
      onRelationshipCandidateModeForTests: (entry) => modes.push(entry),
      beforeRelationshipInferenceForTests: async () => {
        if (transition === 'append') {
          await fsp.appendFile(fixture.file, `${JSON.stringify({
            timestamp: '2026-09-01T19:00:02.000Z',
            type: 'event_msg',
            payload: { type: 'agent_message', message: 'ignored append' },
          })}\n`, 'utf8');
        } else if (transition === 'rewrite') {
          const rewritten = fixture.originalText.replace('stable-body', 'mutant-body');
          assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(fixture.originalText));
          await fsp.writeFile(fixture.file, rewritten, 'utf8');
        } else if (transition === 'truncate') {
          await fsp.truncate(fixture.file, Math.floor(Buffer.byteLength(fixture.originalText) / 2));
        } else if (transition === 'remove') {
          await fsp.rename(fixture.file, `${fixture.file}.removed`);
        } else if (transition === 'replace-identity') {
          const replacement = `${fixture.file}.replacement`;
          await fsp.writeFile(replacement, fixture.originalText, 'utf8');
          await fsp.rename(fixture.file, `${fixture.file}.displaced`);
          await fsp.rename(replacement, fixture.file);
        }
      },
    });
    return {
      modes,
      outcome: {
        status: 'ok',
        rawEventCount: index.sessionsById.get(fixture.id).rawEventCount,
      },
    };
  } catch (error) {
    return {
      modes,
      outcome: {
        status: 'error',
        name: error?.name || '',
        code: error?.code || '',
      },
    };
  }
}

test('hybrid and forced-full accepted-prefix transitions have identical outcomes', async (t) => {
  for (const transition of ['append', 'rewrite', 'truncate', 'remove', 'replace-identity']) {
    await t.test(transition, async (subtest) => {
      const hybrid = await runAcceptedPrefixTransition(subtest, false, transition);
      const forced = await runAcceptedPrefixTransition(subtest, true, transition);
      assert.deepEqual(hybrid.outcome, forced.outcome);
      assert.deepEqual(countModes(hybrid.modes), { light: 1, full: 0 });
      assert.deepEqual(countModes(forced.modes), { light: 0, full: 1 });
      if (transition === 'append') {
        assert.equal(hybrid.outcome.status, 'ok');
        assert.equal(hybrid.outcome.rawEventCount, 2);
      } else {
        assert.deepEqual(hybrid.outcome, {
          status: 'error',
          name: 'Error',
          code: 'SOURCE_CHANGED_DURING_INDEX',
        });
      }
    });
  }
});

async function runVerificationRewrite(t, forceFullRelationshipPassForTests) {
  const fixture = await makeSnapshotFixture(
    t,
    `relationship-verification-rewrite-${forceFullRelationshipPassForTests ? 'full' : 'hybrid'}`,
  );
  let rewritten = false;
  try {
    await buildSourceBackedIndex({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
      forceFullRelationshipPassForTests,
      beforeSourceSnapshotVerificationForTests: async () => {
        if (rewritten) return;
        rewritten = true;
        const changed = fixture.originalText.replace('stable-body', 'mutant-body');
        await fsp.writeFile(fixture.file, changed, 'utf8');
      },
    });
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', name: error?.name || '', code: error?.code || '' };
  }
}

test('hybrid and forced-full detect rewrites during relationship verification identically', async (t) => {
  const hybrid = await runVerificationRewrite(t, false);
  const forced = await runVerificationRewrite(t, true);
  assert.deepEqual(hybrid, forced);
  assert.deepEqual(hybrid, {
    status: 'error',
    name: 'Error',
    code: 'SOURCE_CHANGED_DURING_INDEX',
  });
});

test('hybrid and forced-full cancellation before inference stays AbortError', async (t) => {
  for (const forceFullRelationshipPassForTests of [false, true]) {
    const fixture = await makeSnapshotFixture(
      t,
      `relationship-inference-abort-${forceFullRelationshipPassForTests ? 'full' : 'hybrid'}`,
    );
    const controller = new AbortController();
    await assert.rejects(
      buildSourceBackedIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
        forceFullRelationshipPassForTests,
        signal: controller.signal,
        beforeRelationshipInferenceForTests: () => controller.abort(),
      }),
      { name: 'AbortError' },
    );
  }
});

test('hybrid and forced-full accepted snapshots both become INDEXED_SOURCE_STALE', async (t) => {
  const fixture = await makeSnapshotFixture(t, 'relationship-indexed-source-stale');
  const hybrid = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  const forced = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    forceFullRelationshipPassForTests: true,
  });
  const rewritten = fixture.originalText.replace('stable-body', 'mutant-body');
  await fsp.writeFile(fixture.file, rewritten, 'utf8');

  await assert.rejects(
    materializeSessionForIndex(hybrid, hybrid.sessionsById.get(fixture.id)),
    { code: 'INDEXED_SOURCE_STALE' },
  );
  await assert.rejects(
    materializeSessionForIndex(forced, forced.sessionsById.get(fixture.id)),
    { code: 'INDEXED_SOURCE_STALE' },
  );
});

async function makeReviewSwitchFixture(t) {
  const fixture = await makeFixtureRoot(t, 'relationship-review-reindex');
  const firstPrimaryId = '17171717-1717-4717-8717-171717171717';
  const secondPrimaryId = '18181818-1818-4818-8818-181818181818';
  const reviewId = '19191919-1919-4919-8919-191919191919';
  const firstFile = path.join(fixture.sessionRoot, '00-first-primary.jsonl');
  const secondFile = path.join(fixture.sessionRoot, '01-second-primary.jsonl');
  const reviewFile = path.join(fixture.sessionRoot, '02-review.jsonl');
  const writePrimary = (file, id, matching) => writeRecords(file, [
    sessionMeta(id, fixture.repoRoot, '2026-09-01T19:59:00.000Z'),
    ...reviewRecords({
      ownerId: id,
      enteredAt: matching
        ? '2026-09-01T20:00:01.000Z'
        : '2026-09-01T21:00:01.000Z',
      exitedAt: matching
        ? '2026-09-01T20:00:03.000Z'
        : '2026-09-01T21:00:03.000Z',
    }),
  ]);
  await writePrimary(firstFile, firstPrimaryId, true);
  await writePrimary(secondFile, secondPrimaryId, false);
  await writeRecords(reviewFile, reviewChild(
    reviewId,
    fixture.repoRoot,
    '2026-09-01T20:00:02.000Z',
  ));
  return {
    ...fixture,
    firstPrimaryId,
    reviewId,
    secondPrimaryId,
    switchParents: async () => {
      await writePrimary(firstFile, firstPrimaryId, false);
      await writePrimary(secondFile, secondPrimaryId, true);
    },
  };
}

test('unchanged reindex skips scanning and changed relationship reindex matches forced-full', async (t) => {
  const fixture = await makeReviewSwitchFixture(t);
  const first = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  assert.equal(first.sessionsById.get(fixture.reviewId).parentSessionId, fixture.firstPrimaryId);

  const unchangedModes = [];
  let unchangedParseVerifications = 0;
  const unchanged = await buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: first,
    forceFullRelationshipPassForTests: true,
    onRelationshipCandidateModeForTests: (entry) => unchangedModes.push(entry),
    beforeSourceSnapshotVerificationForTests: () => {
      unchangedParseVerifications += 1;
    },
  });
  assert.equal(unchanged.sessions, first.sessions);
  assert.equal(unchanged.sessionsById, first.sessionsById);
  assert.equal(unchangedModes.length, 0);
  assert.equal(unchangedParseVerifications, 0);

  await fixture.switchParents();
  const buildChanged = async (forceFullRelationshipPassForTests) => {
    const modes = [];
    let relationshipEvidence = null;
    const index = await buildSourceBackedIndex({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
      previousIndex: first,
      forceFullRelationshipPassForTests,
      onRelationshipCandidateModeForTests: (entry) => modes.push(entry),
      beforeRelationshipInferenceForTests: ({ relationshipEvidence: evidence }) => {
        relationshipEvidence = structuredClone(evidence);
      },
    });
    return { index, modes, relationshipEvidence };
  };
  const hybrid = await buildChanged(false);
  const forced = await buildChanged(true);

  assert.deepEqual(countModes(hybrid.modes), { light: 3, full: 0 });
  assert.deepEqual(countModes(forced.modes), { light: 0, full: 3 });
  assert.deepEqual(hybrid.relationshipEvidence, forced.relationshipEvidence);
  assert.deepEqual(normalizeIndex(hybrid.index), normalizeIndex(forced.index));
  assert.equal(
    hybrid.index.sessionsById.get(fixture.reviewId).parentSessionId,
    fixture.secondPrimaryId,
  );
  assert.equal(
    hybrid.index.sessionsById.get(fixture.reviewId).parentSessionInferred,
    true,
  );
});
