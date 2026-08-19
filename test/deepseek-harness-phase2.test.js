'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildDeepSeekIndex,
  deepSeekAdapter,
  parseSessionArtifact,
  readDeepSeekRawRecord,
} = require('../src/deepseek-harness');
const {
  buildEventDetailForSession,
  materializeSessionForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const {
  validateStructuredLogicalDetailDto,
} = require('../src/shared/logical-detail-contract');
const {
  projectQueryProjectionDigestAsync,
} = require('../src/project-query-store');

const PHASE2_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-phase2', 'sessions');
const SUBAGENT_REPO = '/home/joejack/dsh_playground/spike/ws/subagent';
const COMPACTION_REPO = '/home/joejack/dsh_playground/spike/ws/compaction';
const PRESET_REPO = '/home/joejack/dsh_playground/spike/ws/preset';

const SPAWN_PARENT_SOURCE = 'session-fcf6d004-5eb4-4f87-bf42-36cb0bc42ec8';
const SPAWN_CHILD_SOURCE = '43e17fdc-4f49-4530-82ab-85440e27dfdb';
const FORK_PARENT_SOURCE = 'session-0b3a0d49-9a13-400f-9420-1d2b376ecc8c';
const FORK_CHILD_SOURCE = '3a7dda0f-58e8-4c13-9f6b-edb6af5f968e';
const SEED_PARENT_SOURCE = 'session-142314a5-db89-4260-b3c6-cbb78f3ff452';
const SEED_CHILD_SOURCE = '1e7def20-9988-42fd-a18b-adb065c1e0b1';
const COMPACTION_OK_SOURCE = 'session-7a361413-5f4a-40ce-b0ca-b4afb44783a4';
const COMPACTION_FAILED_SOURCE = 'session-febafccb-5386-4f4b-9c75-ad74ca492689';

async function buildFor(repoRoot) {
  const index = await buildDeepSeekIndex({ sourceHome: PHASE2_ROOT, repoRoot });
  await validateIndexOwnershipForCommit(index);
  return index;
}

async function materializeFor(index, sourceSessionId) {
  const indexed = index.sessions.find((session) => session.sourceSessionId === sourceSessionId);
  assert.ok(indexed, `missing indexed session ${sourceSessionId}`);
  const materialized = await materializeSessionForIndex(index, indexed);
  return { indexed, materialized };
}

async function assertProjectionParity(index, indexed, materialized) {
  const digest = await projectQueryProjectionDigestAsync(
    materialized,
    deepSeekAdapter.query.projectQueryPresentation,
  );
  assert.equal(digest, indexed.queryProjectionDigest);
}

async function makeSyntheticFixture(t, id, { header = {}, records }) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2-home-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  t.after(() => fsp.rm(repoRoot, { recursive: true, force: true }));
  const sessionDir = path.join(sourceHome, '--synthetic-project--', id);
  await fsp.mkdir(sessionDir, { recursive: true });
  const file = path.join(sessionDir, 'session.jsonl');
  const headerRecord = {
    type: 'session',
    version: 0,
    id,
    createdAt: 1,
    cwd: repoRoot,
    delegationDepth: 0,
    ...header,
  };
  const text = `${[headerRecord, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`;
  await fsp.writeFile(file, text, 'utf8');
  return { sourceHome, repoRoot, file, id };
}

test('M1 effective preset: header fallback, one selection override, and latest valid selection win', async () => {
  const index = await buildFor(PRESET_REPO);
  assert.equal(index.sessions.length, 3);

  const headerOnly = await materializeFor(index, 'preset-header-code');
  assert.equal(headerOnly.indexed.agentNickname, 'code');
  assert.equal(headerOnly.materialized.logicalEvents.some((event) => event.subtype === 'agent-preset/selected'), false);
  const headerRaw = await readDeepSeekRawRecord(
    index,
    headerOnly.materialized,
    headerOnly.materialized.rawEvents.find((raw) => raw.payloadType === 'session'),
  );
  assert.match(headerRaw.raw, /"agentPreset":"code"/);

  const selected = await materializeFor(index, 'preset-selected-code');
  assert.equal(selected.indexed.agentNickname, 'code');
  const selectedHeaderRaw = await readDeepSeekRawRecord(
    index,
    selected.materialized,
    selected.materialized.rawEvents.find((raw) => raw.payloadType === 'session'),
  );
  assert.match(selectedHeaderRaw.raw, /"agentPreset":"standard"/);
  const selection = selected.materialized.logicalEvents.find((event) => event.subtype === 'agent-preset/selected');
  assert.equal(selection.layer, 'protocol');
  assert.equal(selection.preview, 'Agent preset selected: code');
  const selectionDetail = await buildEventDetailForSession(index, selected.materialized, selection.id, 'protocol');
  assert.ok(selectionDetail.timelineSections.some((section) => section.purpose === 'context'));
  assert.ok(selectionDetail.inspectorSections.some((section) => section.purpose === 'traceability'));

  const latest = await materializeFor(index, 'preset-selected-latest');
  assert.equal(latest.indexed.agentNickname, 'standard');
  const selections = latest.materialized.logicalEvents.filter((event) => event.subtype === 'agent-preset/selected');
  assert.deepEqual(selections.map((event) => event.preview), [
    'Agent preset selected: code',
    'Agent preset selected: standard',
  ]);

  for (const fixture of [headerOnly, selected, latest]) {
    await assertProjectionParity(index, fixture.indexed, fixture.materialized);
  }
});

test('M1 spawned subagent: origin classifies subagent, descriptor is v2 provenance, no false seed requirement', async () => {
  const index = await buildFor(SUBAGENT_REPO);
  const parent = (await materializeFor(index, SPAWN_PARENT_SOURCE)).indexed;
  const child = await materializeFor(index, SPAWN_CHILD_SOURCE);
  assert.equal(child.indexed.parentSessionId, parent.id);
  assert.equal(child.indexed.primarySessionMetaKind, 'subagent');
  // Spawn provider is parent/child navigation, not a materialized fork.
  assert.equal(child.indexed.forkedFromSessionId, '');
  assert.equal(child.indexed.forkStorageMode, '');
  assert.equal(child.indexed.inheritedContext, null);
  assert.equal(child.indexed.forkEvidence, null);
  assert.equal(child.indexed.spawnDepth, 1);
  assert.equal(child.indexed.derivedRelationship.kind, 'subagent');
  assert.deepEqual(child.indexed.derivedRelationship.descriptor, {
    version: 2,
    mode: 'one-shot',
    provider: 'spawn',
    label: 'Run printf and report output',
  });

  const descriptorEvent = child.materialized.logicalEvents.find((event) => event.subtype === 'subagent/descriptor');
  assert.equal(descriptorEvent.layer, 'protocol');
  const descriptorRaw = await readDeepSeekRawRecord(
    index,
    child.materialized,
    child.materialized.rawEvents.find((raw) => raw.payloadType === 'subagent/descriptor'),
  );
  assert.match(descriptorRaw.raw, /"version":2/);
  assert.doesNotMatch(descriptorRaw.raw, /seedLength/);
  const descriptorDetail = await buildEventDetailForSession(index, child.materialized, descriptorEvent.id, 'protocol');
  validateStructuredLogicalDetailDto(descriptorDetail);
  assert.ok(descriptorDetail.timelineSections.some((section) => section.purpose === 'context'));
  assert.ok(descriptorDetail.inspectorSections.some((section) => section.purpose === 'traceability'));

  const headerRaw = await readDeepSeekRawRecord(
    index,
    child.materialized,
    child.materialized.rawEvents.find((raw) => raw.payloadType === 'session'),
  );
  assert.match(headerRaw.raw, /"origin":"subagent"/);
  assert.doesNotMatch(headerRaw.raw, /"seedLength"/);
});

test('M1 child header alone is enough for parent navigation; parent transcript body is not required', async (t) => {
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2-child-only-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  const childSource = path.join(
    PHASE2_ROOT,
    '--home-joejack-dsh_playground-spike-ws-subagent--',
    SPAWN_CHILD_SOURCE,
  );
  const target = path.join(sourceHome, '--home-joejack-dsh_playground-spike-ws-subagent--', SPAWN_CHILD_SOURCE);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.cp(childSource, target, { recursive: true });

  const index = await buildDeepSeekIndex({ sourceHome, repoRoot: SUBAGENT_REPO });
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  assert.equal(indexed.parentSessionId, `deepseek-harness:${SPAWN_PARENT_SOURCE}`);
  assert.equal(index.sessionsById.has(`deepseek-harness:${SPAWN_PARENT_SOURCE}`), false);
  const materialized = await materializeSessionForIndex(index, indexed);
  assert.equal(materialized.parentSessionId, indexed.parentSessionId);
});

test('M1 seedless parented fork is distinguished from seeded fork without inventing inherited context', async () => {
  const index = await buildFor(SUBAGENT_REPO);
  const parent = (await materializeFor(index, FORK_PARENT_SOURCE)).indexed;
  const child = await materializeFor(index, FORK_CHILD_SOURCE);
  assert.equal(child.indexed.parentSessionId, parent.id);
  assert.equal(child.indexed.primarySessionMetaKind, 'subagent');
  assert.equal(child.indexed.forkedFromSessionId, parent.id);
  assert.equal(child.indexed.forkStorageMode, '');
  assert.equal(child.indexed.inheritedContext, null);
  assert.equal(child.indexed.forkEvidence, null);
  const headerRaw = await readDeepSeekRawRecord(
    index,
    child.materialized,
    child.materialized.rawEvents.find((raw) => raw.payloadType === 'session'),
  );
  assert.match(headerRaw.raw, /"origin":"subagent"/);
  assert.doesNotMatch(headerRaw.raw, /"seedLength"/);
});

test('M1 seeded fork: explicit seed ownership, inherited Raw inspectability, and child-owned counts', async () => {
  const index = await buildFor(SUBAGENT_REPO);
  const parent = (await materializeFor(index, SEED_PARENT_SOURCE)).indexed;
  const child = await materializeFor(index, SEED_CHILD_SOURCE);

  assert.equal(child.indexed.parentSessionId, parent.id);
  assert.equal(child.indexed.primarySessionMetaKind, 'subagent');
  assert.equal(child.indexed.forkedFromSessionId, parent.id);
  assert.equal(child.indexed.forkStorageMode, 'materialized');
  assert.equal(child.indexed.forkEvidence.seedLength, 54);
  assert.equal(child.indexed.forkEvidence.seedBoundarySeq, 54);
  assert.equal(child.indexed.forkEvidence.inheritedRawRecordCount, 25);
  assert.equal(child.indexed.forkEvidence.inheritedLogicalEventCount, 18);
  assert.equal(child.indexed.inheritedContext.seedLength, 54);
  assert.equal(child.indexed.inheritedContext.rawRecordCount, 25);
  assert.equal(child.indexed.inheritedContext.mainEventCount, 3);
  assert.equal(child.indexed.inheritedContext.previewEventCount, 3);
  assert.equal(child.indexed.inheritedContext.forkPointTarget, null);

  // Child list metrics must not attribute inherited parent work to the
  // continuation. The physical artifact still exposes every inherited row.
  assert.equal(child.indexed.rawEventCount, 57);
  assert.equal(child.indexed.counts.messages, 3);
  assert.equal(child.indexed.counts.userMessages, 1);
  assert.equal(child.indexed.counts.toolCalls, 1);
  assert.equal(child.indexed.counts.turns, 1);
  assert.equal(child.materialized.rawEvents.length, 57);
  assert.equal(child.materialized.logicalEvents.length, child.indexed.logicalEventCount);
  assert.equal(child.materialized.logicalEvents.some((event) => /fx-seed-parent-ok/.test(event.preview)), false);
  assert.ok(child.materialized.rawEvents.some((raw) => /fx-seed-parent-ok/.test(raw.preview || raw.searchText)));

  const boundary = child.materialized.logicalEvents.find((event) => event.subtype === 'session/end-seed');
  assert.equal(boundary.layer, 'protocol');
  assert.equal(boundary.preview, 'Seed boundary: 54 inherited events end here');
  const boundaryRaw = await readDeepSeekRawRecord(
    index,
    child.materialized,
    child.materialized.rawEvents.find((raw) => raw.payloadType === 'session/end-seed'),
  );
  assert.equal(JSON.parse(boundaryRaw.raw).seq, 54);
  const boundaryDetail = await buildEventDetailForSession(index, child.materialized, boundary.id, 'protocol');
  assert.ok(boundaryDetail.timelineSections.some((section) => section.purpose === 'content'));

  const rawTimeline = deepSeekAdapter.query.getTimeline(index, child.materialized, {
    layer: 'raw',
    offset: 0,
    limit: 100,
  });
  const segments = rawTimeline.events.map((event) => event.forkSegment);
  assert.equal(segments[0], 'fork_metadata');
  assert.ok(segments.includes('inherited_context'));
  assert.ok(segments.includes('continuation'));
  assert.equal(child.materialized._forkSegmentsByRawId.size, 57);

  const detail = await buildEventDetailForSession(
    index,
    child.materialized,
    child.materialized.logicalEvents.find((event) => event.kind === 'user_message').id,
    'main',
  );
  validateStructuredLogicalDetailDto(detail);
  await assertProjectionParity(index, child.indexed, child.materialized);
});

test('M1 normal parentSession without origin is lineage, not subagent classification', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'normal-parented-fork', {
    records: [
      { type: 'turn/start', seq: 0, time: 1002, data: { turn: 1 } },
      {
        type: 'user/message', seq: 1, time: 1003, surfaceOp: 'append',
        data: {
          turn: 1, step: 1, source: { kind: 'user' },
          content: [{ type: 'text', text: 'fork continuation question' }],
        },
      },
      {
        type: 'assistant/message', seq: 2, time: 1004, surfaceOp: 'append',
        data: {
          turn: 1, step: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: 'fork continuation answer' }] },
        },
      },
      { type: 'step/end', seq: 3, time: 1005, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 4, time: 1006, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
    header: { parentSession: 'source-parent-session', delegationDepth: 0 },
  });
  const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
  const indexed = index.sessions[0];
  assert.equal(indexed.parentSessionId, 'deepseek-harness:source-parent-session');
  assert.equal(indexed.forkedFromSessionId, 'deepseek-harness:source-parent-session');
  assert.equal(indexed.primarySessionMetaKind, '');
  assert.equal(indexed.forkStorageMode, '');
  assert.equal(indexed.inheritedContext, null);
  const materialized = await materializeSessionForIndex(index, indexed);
  const summary = deepSeekAdapter.query.getTimeline(index, materialized, {}).session;
  assert.equal(summary.isDerivedSession, false);
  assert.equal(summary.derivedKind, '');
  assert.equal(summary.parentSessionId, indexed.parentSessionId);
});

test('M1 seedLength and session/end-seed consistency is validated; header-only boundary remains explicit evidence', async (t) => {
  await t.test('a marker after the header boundary fails closed', async (subtest) => {
    const fixture = await makeSyntheticFixture(subtest, 'seed-mismatch', {
      header: { seedLength: 1 },
      records: [
        { type: 'turn/start', seq: 0, time: 1001, data: { turn: 1 } },
        { type: 'turn/end', seq: 1, time: 1002, data: { turn: 1 } },
        { type: 'session/end-seed', seq: 2, time: 1003, data: {} },
      ],
    });
    await assert.rejects(
      buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot }),
      (error) => error?.code === 'DEEPSEEK_STORAGE_INVALID'
        && /does not match header seedLength/.test(error.message),
    );
  });

  await t.test('a marker inside the inherited prefix does not move the authoritative header boundary', async (subtest) => {
    const fixture = await makeSyntheticFixture(subtest, 'seed-nested-marker', {
      header: { seedLength: 2 },
      records: [
        { type: 'session/end-seed', seq: 0, time: 1001, data: {} },
        { type: 'turn/start', seq: 1, time: 1002, data: { turn: 1 } },
        { type: 'step/start', seq: 2, time: 1003, data: { turn: 1, step: 1 } },
        { type: 'step/end', seq: 3, time: 1004, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 4, time: 1005, data: { turn: 1 } },
      ],
    });
    const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
    const indexed = index.sessions[0];
    assert.equal(indexed.forkEvidence.seedLength, 2);
    assert.equal(indexed.forkEvidence.seedBoundaryRawId, '');
    const materialized = await materializeSessionForIndex(index, indexed);
    assert.equal(materialized.logicalEvents.some((event) => event.subtype === 'session/end-seed'), false);
  });

  await t.test('header-only seedLength is explicit evidence without a manufactured marker', async (subtest) => {
    const fixture = await makeSyntheticFixture(subtest, 'seed-header-only', {
      header: { seedLength: 2 },
      records: [
        { type: 'turn/start', seq: 0, time: 1002, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: 1003, data: { turn: 1, step: 1 } },
        { type: 'step/end', seq: 2, time: 1004, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 3, time: 1005, data: { turn: 1 } },
      ],
    });
    const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
    const indexed = index.sessions[0];
    assert.equal(indexed.forkStorageMode, 'materialized');
    assert.equal(indexed.forkEvidence.seedLength, 2);
    assert.equal(indexed.forkEvidence.seedBoundaryRawId, '');
  });
});

test('M2 successful compaction is one coherent model-only projection and never erases human transcript', async () => {
  const index = await buildFor(COMPACTION_REPO);
  const { indexed, materialized } = await materializeFor(index, COMPACTION_OK_SOURCE);
  assert.equal(indexed.counts.compactions, 1);

  const compactionEvents = materialized.logicalEvents.filter((event) => event.kind === 'compaction');
  assert.equal(compactionEvents.length, 1);
  const compaction = compactionEvents[0];
  assert.equal(compaction.layer, 'main');
  assert.equal(compaction.status, 'success');
  assert.match(compaction.preview, /10 surface events replaced/);
  assert.deepEqual(compaction.rawRefs.map((ref) => ref.sourceEventType), [
    'compaction/start',
    'compaction/summary',
    'user/message',
    'compaction/end',
  ]);

  // Lifecycle rows are not four unrelated opaque protocol events.
  assert.equal(materialized.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.subtype.startsWith('compaction/')
  )), false);
  // The replacement user/message is model-only and never becomes a human Main prompt.
  assert.equal(materialized.logicalEvents.some((event) => (
    event.kind === 'user_message' && /automatically generated checkpoint/.test(event.preview + event.searchText)
  )), false);
  // Append-origin conversation the user saw remains in Main history.
  const humanMessages = materialized.logicalEvents.filter((event) => event.kind === 'user_message');
  assert.equal(humanMessages.length, 4);
  for (const expected of ['fx-alpha-ok', 'fx-compact-beta-ok', 'fx-gamma-ok', 'fx-delta-ok']) {
    assert.ok(humanMessages.some((event) => (event.preview + event.searchText).includes(expected)));
  }

  for (const ref of compaction.rawRefs) {
    const raw = materialized.rawEvents.find((candidate) => candidate.rawId === ref.rawId);
    assert.ok(raw);
    const readback = await readDeepSeekRawRecord(index, materialized, raw);
    assert.equal(JSON.parse(readback.raw).type, ref.sourceEventType);
  }

  const detail = await buildEventDetailForSession(index, materialized, compaction.id, 'main');
  validateStructuredLogicalDetailDto(detail);
  assert.deepEqual(detail.timelineSections.map((section) => section.purpose), ['content', 'result']);
  assert.ok(detail.inspectorSections.some((section) => section.purpose === 'traceability' && section.type === 'kv'));
  assert.ok(detail.inspectorSections.some((section) => section.purpose === 'context' && section.type === 'token_usage'));
  assert.equal(detail.inspectorSections.some((section) => section.type === 'raw_json'), false);

  await assertProjectionParity(index, indexed, materialized);
});

test('M2 failed compaction is represented coherently without inventing summary or replacement', async () => {
  const index = await buildFor(COMPACTION_REPO);
  const { indexed, materialized } = await materializeFor(index, COMPACTION_FAILED_SOURCE);
  assert.equal(indexed.counts.compactions, 1);
  assert.ok(indexed.counts.issueEvents >= 1);

  const compactions = materialized.logicalEvents.filter((event) => event.kind === 'compaction');
  assert.equal(compactions.length, 1);
  const compaction = compactions[0];
  assert.equal(compaction.status, 'failed');
  assert.equal(compaction.severity, 'error');
  assert.match(compaction.preview, /summary is not smaller/);
  assert.deepEqual(compaction.rawRefs.map((ref) => ref.sourceEventType), [
    'compaction/start',
    'compaction/end',
  ]);
  assert.equal(materialized.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.subtype.startsWith('compaction/')
  )), false);
  assert.equal(materialized.rawEvents.some((raw) => raw.payloadType === 'compaction/summary'), false);

  const detail = await buildEventDetailForSession(index, materialized, compaction.id, 'main');
  validateStructuredLogicalDetailDto(detail);
  assert.deepEqual(detail.timelineSections.map((section) => section.purpose), ['result']);
  assert.ok(detail.inspectorSections.some((section) => section.purpose === 'traceability'));
  assert.equal(detail.inspectorSections.some((section) => section.type === 'raw_json'), false);
  await assertProjectionParity(index, indexed, materialized);
});

test('M2 unobserved compaction/prune stays recognized Protocol and is never fabricated into compaction semantics', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'prune-only', {
    records: [
      { type: 'turn/start', seq: 0, time: 1001, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1002, data: { turn: 1, step: 1 } },
      { type: 'step/end', seq: 2, time: 1003, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 3, time: 1004, data: { turn: 1 } },
      {
        type: 'compaction/prune', seq: 4, time: 1005,
        data: { shadowedRange: { start: 1, end: 1 }, shadowedSeqs: [1], shadowedTokenCount: 42 },
      },
      {
        type: 'tool/result', seq: 5, time: 1006,
        surfaceOp: { op: 'replace', start: 1, end: 1 },
        data: {
          turn: 1, step: 1,
          message: { source: { callId: 'call-prune' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'pruned' }] }] },
        },
      },
    ],
  });
  const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  const prune = materialized.logicalEvents.find((event) => event.subtype === 'compaction/prune');
  assert.ok(prune);
  assert.equal(prune.layer, 'protocol');
  assert.equal(materialized.logicalEvents.some((event) => event.kind === 'compaction'), false);
  const replacement = materialized.logicalEvents.find((event) => (
    event.subtype === 'tool/result' && event.label === 'Surface replacement tool result'
  ));
  assert.ok(replacement);
  assert.equal(replacement.layer, 'protocol');
  const pruneRaw = await readDeepSeekRawRecord(
    index,
    materialized,
    materialized.rawEvents.find((raw) => raw.payloadType === 'compaction/prune'),
  );
  assert.equal(JSON.parse(pruneRaw.raw).type, 'compaction/prune');
});

test('M2 orphan replacement user/message stays model-only Protocol and not Main human history', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'orphan-replacement', {
    records: [
      { type: 'turn/start', seq: 0, time: 1001, data: { turn: 1 } },
      {
        type: 'user/message', seq: 1, time: 1002,
        surfaceOp: { op: 'replace', start: 0, end: 0 },
        data: {
          turn: 1, step: 1, source: { kind: 'plugin', plugin: 'compact' },
          content: [{ type: 'text', text: 'model-only orphan checkpoint' }],
        },
      },
    ],
  });
  const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
  const materialized = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(materialized.logicalEvents.some((event) => event.kind === 'user_message'), false);
  const protocol = materialized.logicalEvents.find((event) => (
    event.subtype === 'user/message' && event.label === 'Surface replacement user message'
  ));
  assert.equal(protocol.layer, 'protocol');
});
