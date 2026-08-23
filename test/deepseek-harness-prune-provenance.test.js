'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
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

const FIXTURE_ROOT = path.join(
  __dirname,
  'fixtures',
  'deepseek-harness-prune-provenance',
  'sessions',
);
const FIXTURE_FILE = path.join(
  FIXTURE_ROOT,
  '--synthetic-deepseek-prune-provenance--',
  'prune-provenance-current-writer-shape',
  'session.jsonl',
);
const PRUNE_REPO = '/synthetic/deepseek-prune-provenance';
const FIXTURE_SHA256 = '085b7d1647f1396ab90d00c90312e11d175cd8a325d92ed389758678ffe0d266';

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

function relatedEvents(session) {
  return {
    operation: session.logicalEvents.find(event => (
      event.layer === 'main' && event.toolName === 'read'
      && event.rawRefs.map(ref => ref.sourceEventType).join(',') === 'tool/call,tool/result'
    )),
    prune: session.logicalEvents.find(event => event.subtype === 'compaction/prune'),
    replacement: session.logicalEvents.find(event => (
      event.subtype === 'tool/result' && event.label === 'Surface replacement tool result'
    )),
  };
}

function assertNoPruneRelation(session) {
  assert.ok(session.logicalEvents.every(event => !Object.hasOwn(event, 'toolResultPrune')));
}

function toolResult(callId, text, overrides = {}) {
  return {
    type: 'tool/result',
    seq: overrides.seq,
    time: 1000 + overrides.seq,
    surfaceOp: overrides.surfaceOp ?? 'append',
    sourceEventSeqs: overrides.sourceEventSeqs ?? [2],
    data: {
      turn: 1,
      step: 1,
      message: {
        source: { callId },
        content: [{ type: 'tool-result', content: [{ type: 'text', text }] }],
      },
    },
  };
}

function baseRows({
  pruneData = { shadowedRange: { start: 3, end: 3 }, shadowedSeqs: [3], shadowedTokenCount: 17 },
  replacementCallId = 'call-prune-defensive',
  replacementSourceEventSeqs = [3],
  duplicatePrune = false,
  duplicateReplacement = false,
} = {}) {
  const rows = [
    { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 1001, data: { turn: 1, step: 1 } },
    {
      type: 'tool/call', seq: 2, time: 1002,
      data: {
        turn: 1, step: 1, callId: 'call-prune-defensive', name: 'read',
        arguments: '{"file_path":"synthetic.txt"}',
      },
    },
    toolResult('call-prune-defensive', 'DEFENSIVE-ORIGINAL', { seq: 3, sourceEventSeqs: [2] }),
    { type: 'step/end', seq: 4, time: 1004, data: { turn: 1, step: 1 } },
    { type: 'compaction/prune', seq: 5, time: 1005, data: pruneData },
  ];
  if (duplicatePrune) {
    rows.push({ type: 'compaction/prune', seq: 6, time: 1006, data: structuredClone(pruneData) });
  }
  const replacementSeq = rows.length;
  rows.push(toolResult(replacementCallId, 'DEFENSIVE-PRUNED', {
    seq: replacementSeq,
    surfaceOp: { op: 'replace', start: 3, end: 3 },
    sourceEventSeqs: replacementSourceEventSeqs,
  }));
  if (duplicateReplacement) {
    rows.push(toolResult(replacementCallId, 'DEFENSIVE-PRUNED-DUPLICATE', {
      seq: rows.length,
      surfaceOp: { op: 'replace', start: 3, end: 3 },
      sourceEventSeqs: replacementSourceEventSeqs,
    }));
  }
  rows.push(
    { type: 'step/start', seq: rows.length, time: 1100, data: { turn: 1, step: 2 } },
    { type: 'step/end', seq: rows.length + 1, time: 1101, data: { turn: 1, step: 2 } },
    { type: 'turn/end', seq: rows.length + 2, time: 1102, data: { turn: 1, reason: { kind: 'completed' } } },
  );
  return rows;
}

async function makeSyntheticFixture(t, id, records, headerFields = {}) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-prune-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-prune-home-'));
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

test('current-writer-shaped prune fixture keeps exact bytes and relates three disjoint Logical Events', async () => {
  const bytes = await fsp.readFile(FIXTURE_FILE);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FIXTURE_SHA256);

  const { index, indexed, materialized } = await buildFor(PRUNE_REPO);
  const { operation, prune, replacement } = relatedEvents(materialized);
  assert.ok(operation);
  assert.ok(prune);
  assert.ok(replacement);

  assert.equal(materialized.logicalEvents.filter(event => event.layer === 'main').length, 1);
  assert.equal(indexed.counts.toolCalls, 1);
  assert.equal(indexed.counts.compactions, 0);
  assert.equal(operation.layer, 'main');
  assert.equal(prune.layer, 'protocol');
  assert.equal(replacement.layer, 'protocol');
  assert.deepEqual(rawSeqs(operation), [2, 3]);
  assert.deepEqual(rawSeqs(prune), [5]);
  assert.deepEqual(rawSeqs(replacement), [6]);

  assert.deepEqual(operation.toolResultPrune, {
    pruneEventId: prune.id,
    replacementEventId: replacement.id,
    originalResultSeq: 3,
    replacementResultSeq: 6,
  });
  assert.deepEqual(prune.toolResultPrune, {
    originalOperationEventId: operation.id,
    replacementEventId: replacement.id,
    originalResultSeq: 3,
    replacementResultSeq: 6,
    shadowedTokenCount: 17,
    writerAdjacent: true,
  });
  assert.deepEqual(replacement.toolResultPrune, {
    originalOperationEventId: operation.id,
    pruneEventId: prune.id,
    originalResultSeq: 3,
  });

  const ownerIds = [operation, prune, replacement].flatMap(event => event.rawRefs.map(ref => ref.rawId));
  assert.equal(ownerIds.length, new Set(ownerIds).size);

  const operationDetail = await buildEventDetailForSession(index, materialized, operation.id, 'main');
  const pruneDetail = await buildEventDetailForSession(index, materialized, prune.id, 'protocol');
  const replacementDetail = await buildEventDetailForSession(index, materialized, replacement.id, 'protocol');
  for (const detail of [operationDetail, pruneDetail, replacementDetail]) {
    validateStructuredLogicalDetailDto(detail);
  }

  const originalResult = operationDetail.timelineSections.find(section => section.title === 'Tool result');
  assert.match(originalResult.text, /ORIGINAL-ONLY-CONTENT-ALPHA-BETA-GAMMA/u);
  assert.doesNotMatch(originalResult.text, /PRUNED-SURFACE/u);
  const replacementResult = replacementDetail.timelineSections.find(section => section.title === 'Pruned surface result');
  assert.match(replacementResult.text, /PRUNED-SURFACE-HEAD/u);
  assert.doesNotMatch(replacementResult.text, /ORIGINAL-ONLY-CONTENT/u);

  const operationRefs = operationDetail.inspectorSections.find(section => section.type === 'event_refs');
  const pruneRefs = pruneDetail.inspectorSections.find(section => section.type === 'event_refs');
  const replacementRefs = replacementDetail.inspectorSections.find(section => section.type === 'event_refs');
  assert.deepEqual(operationRefs.items.map(item => item.id), [prune.id, replacement.id]);
  assert.deepEqual(pruneRefs.items.map(item => item.id), [operation.id, replacement.id]);
  assert.deepEqual(replacementRefs.items.map(item => item.id), [operation.id, prune.id]);
  assert.ok(pruneDetail.timelineSections.some(section => (
    section.type === 'kv'
    && section.entries.some(entry => entry.key === 'Original result seq' && entry.value === '3')
    && section.entries.some(entry => entry.key === 'Shadowed token count' && entry.value === '17')
    && section.entries.some(entry => entry.key === 'Replacement result seq' && entry.value === '6')
  )));

  await assertProjectionParity(index, indexed, materialized);
});

test('malformed or ambiguous prune evidence stays generic Protocol/Raw without provenance', async (t) => {
  const noncausalPruneRows = [
    { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 1001, data: { turn: 1, step: 1 } },
    {
      type: 'compaction/prune', seq: 2, time: 1002,
      data: { shadowedRange: { start: 4, end: 4 }, shadowedSeqs: [4], shadowedTokenCount: 17 },
    },
    {
      type: 'tool/call', seq: 3, time: 1003,
      data: {
        turn: 1, step: 1, callId: 'call-prune-defensive', name: 'read',
        arguments: '{"file_path":"synthetic.txt"}',
      },
    },
    toolResult('call-prune-defensive', 'DEFENSIVE-ORIGINAL', { seq: 4, sourceEventSeqs: [3] }),
    toolResult('call-prune-defensive', 'DEFENSIVE-PRUNED', {
      seq: 5,
      surfaceOp: { op: 'replace', start: 4, end: 4 },
      sourceEventSeqs: [4],
    }),
    { type: 'step/end', seq: 6, time: 1006, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 7, time: 1007, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const duplicateCallIdRows = [
    { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 1001, data: { turn: 1, step: 1 } },
    {
      type: 'tool/call', seq: 2, time: 1002,
      data: {
        turn: 1, step: 1, callId: 'call-prune-defensive', name: 'read',
        arguments: '{"file_path":"first.txt"}',
      },
    },
    {
      type: 'tool/call', seq: 3, time: 1003,
      data: {
        turn: 1, step: 1, callId: 'call-prune-defensive', name: 'read',
        arguments: '{"file_path":"second.txt"}',
      },
    },
    toolResult('call-prune-defensive', 'DEFENSIVE-ORIGINAL', { seq: 4, sourceEventSeqs: [3] }),
    { type: 'step/end', seq: 5, time: 1005, data: { turn: 1, step: 1 } },
    {
      type: 'compaction/prune', seq: 6, time: 1006,
      data: { shadowedRange: { start: 4, end: 4 }, shadowedSeqs: [4], shadowedTokenCount: 17 },
    },
    toolResult('call-prune-defensive', 'DEFENSIVE-PRUNED', {
      seq: 7,
      surfaceOp: { op: 'replace', start: 4, end: 4 },
      sourceEventSeqs: [4],
    }),
    { type: 'step/start', seq: 8, time: 1008, data: { turn: 1, step: 2 } },
    { type: 'step/end', seq: 9, time: 1009, data: { turn: 1, step: 2 } },
    { type: 'turn/end', seq: 10, time: 1010, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const cases = [
    {
      name: 'malformed-shadowed-seqs',
      rows: baseRows({
        pruneData: {
          shadowedRange: { start: 3, end: 3 },
          shadowedSeqs: [3, 3],
          shadowedTokenCount: 17,
        },
      }),
    },
    {
      name: 'mismatched-source-event-seqs',
      rows: baseRows({ replacementSourceEventSeqs: [2] }),
    },
    {
      name: 'mismatched-call-id',
      rows: baseRows({ replacementCallId: 'call-prune-other' }),
    },
    {
      name: 'duplicate-replacement',
      rows: baseRows({ duplicateReplacement: true }),
    },
    {
      name: 'duplicate-prune',
      rows: baseRows({ duplicatePrune: true }),
    },
    {
      name: 'duplicate-call-id',
      rows: duplicateCallIdRows,
    },
    {
      name: 'prune-before-original-result',
      rows: noncausalPruneRows,
    },
  ];

  for (const candidate of cases) {
    await t.test(candidate.name, async (subtest) => {
      const fixture = await makeSyntheticFixture(subtest, candidate.name, candidate.rows);
      const { index, indexed, materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
      const { operation, prune, replacement } = relatedEvents(materialized);
      assert.ok(operation);
      assert.ok(prune);
      assert.ok(replacement);
      assert.equal(materialized.logicalEvents.filter(event => event.layer === 'main').length, 1);
      assertNoPruneRelation(materialized);
      assert.equal(prune.layer, 'protocol');
      assert.equal(replacement.layer, 'protocol');
      await assertProjectionParity(index, indexed, materialized);
    });
  }
});

test('exact source identities correlate without requiring writer adjacency', async (t) => {
  const rows = baseRows();
  for (const event of rows) {
    if (event.seq >= 6) event.seq += 1;
  }
  rows.splice(6, 0, {
    type: 'session/title',
    seq: 6,
    time: 1006,
    data: { title: 'Synthetic intervening protocol event', source: 'fallback', messageSeqs: [] },
  });
  const fixture = await makeSyntheticFixture(t, 'nonadjacent-prune', rows);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const { operation, prune, replacement } = relatedEvents(materialized);
  assert.ok(operation?.toolResultPrune);
  assert.ok(prune?.toolResultPrune);
  assert.ok(replacement?.toolResultPrune);
  assert.equal(prune.toolResultPrune.writerAdjacent, false);
  assert.equal(prune.toolResultPrune.replacementResultSeq, 7);
});

test('seeded child continuation never attaches inherited parent result provenance', async (t) => {
  const rows = baseRows();
  const fixture = await makeSyntheticFixture(t, 'seeded-prune-child', rows, {
    parentSession: 'parent-prune-session',
    origin: 'subagent',
    seedLength: 5,
    delegationDepth: 1,
  });
  const { index, indexed, materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  assert.equal(materialized.forkStorageMode, 'materialized');
  assert.equal(materialized.logicalEvents.some(event => event.layer === 'main'), false);
  const prune = materialized.logicalEvents.find(event => event.subtype === 'compaction/prune');
  const replacement = materialized.logicalEvents.find(event => event.subtype === 'tool/result');
  assert.ok(prune);
  assert.ok(replacement);
  assertNoPruneRelation(materialized);
  assert.deepEqual(rawSeqs(prune), [5]);
  assert.deepEqual(rawSeqs(replacement), [6]);
  await assertProjectionParity(index, indexed, materialized);
});
