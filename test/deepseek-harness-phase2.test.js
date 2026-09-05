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
  assert.equal(boundary.preview, 'Session constructor seed ended at seq 54');
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

test('M1 SessionHeader seedLength alone owns inherited history; constructor seed markers remain Protocol', async (t) => {
  await t.test('top-level resume marker does not manufacture inherited ownership', async (subtest) => {
    const fixture = await makeSyntheticFixture(subtest, 'top-level-resume', {
      records: [
        { type: 'turn/start', seq: 0, time: 1001, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: 1002, data: { turn: 1, step: 1 } },
        {
          type: 'user/message', seq: 2, time: 1003, surfaceOp: 'append',
          data: { turn: 1, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'before resume' }] },
        },
        {
          type: 'assistant/message', seq: 3, time: 1004, surfaceOp: 'append',
          data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'before answer' }] } },
        },
        { type: 'step/end', seq: 4, time: 1005, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 5, time: 1006, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'session/end-seed', seq: 6, time: 1007, data: {} },
        { type: 'turn/start', seq: 7, time: 1008, data: { turn: 2 } },
        { type: 'step/start', seq: 8, time: 1009, data: { turn: 2, step: 1 } },
        {
          type: 'user/message', seq: 9, time: 1010, surfaceOp: 'append',
          data: { turn: 2, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'after resume' }] },
        },
        {
          type: 'tool/call', seq: 10, time: 1011,
          data: { turn: 2, step: 1, callId: 'resume-call', name: 'read', arguments: '{"path":"synthetic"}' },
        },
        {
          type: 'tool/result', seq: 11, time: 1012, surfaceOp: 'append',
          data: {
            turn: 2, step: 1,
            message: {
              source: { kind: 'tool', callId: 'resume-call' }, role: 'user',
              content: [{ type: 'tool-result', toolCallId: 'resume-call', content: [{ type: 'text', text: 'synthetic result' }], isError: false }],
            },
          },
        },
        { type: 'step/end', seq: 12, time: 1013, data: { turn: 2, step: 1 } },
        { type: 'turn/end', seq: 13, time: 1014, data: { turn: 2, reason: { kind: 'completed' } } },
      ],
    });
    const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
    const indexed = index.sessions[0];
    assert.equal(indexed.forkStorageMode, '');
    assert.equal(indexed.forkEvidence, null);
    assert.equal(indexed.inheritedContext, null);
    assert.equal(indexed.counts.messages, 3);
    assert.equal(indexed.counts.userMessages, 2);
    assert.equal(indexed.counts.toolCalls, 1);
    assert.equal(indexed.counts.turns, 2);
    assert.equal(indexed.title, 'before resume');
    assert.deepEqual(indexed.summary.topTools, [{ name: 'read', count: 1 }]);
    const materialized = await materializeSessionForIndex(index, indexed);
    assert.equal(materialized._forkSegmentsByRawId, undefined);
    assert.deepEqual(
      materialized.logicalEvents.filter((event) => event.kind === 'user_message').map((event) => event.preview),
      ['before resume', 'after resume'],
    );
    const marker = materialized.logicalEvents.find((event) => event.subtype === 'session/end-seed');
    assert.equal(marker.layer, 'protocol');
    assert.equal(marker.preview, 'Session constructor seed ended at seq 6');
    const detail = await buildEventDetailForSession(index, materialized, marker.id, 'protocol');
    assert.match(detail.timelineSections[0].text, /does not establish inherited ownership/);
    await assertProjectionParity(index, indexed, materialized);
  });

  await t.test('repeated resume markers preserve work before, between, and after boundaries', async (subtest) => {
    const fixture = await makeSyntheticFixture(subtest, 'repeated-resume', {
      records: [
        { type: 'turn/start', seq: 0, time: 1101, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: 1102, data: { turn: 1, step: 1 } },
        {
          type: 'user/message', seq: 2, time: 1103, surfaceOp: 'append',
          data: { turn: 1, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'before first marker' }] },
        },
        { type: 'step/end', seq: 3, time: 1104, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 4, time: 1105, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'session/end-seed', seq: 5, time: 1106, data: {} },
        { type: 'turn/start', seq: 6, time: 1107, data: { turn: 2 } },
        { type: 'step/start', seq: 7, time: 1108, data: { turn: 2, step: 1 } },
        {
          type: 'user/message', seq: 8, time: 1109, surfaceOp: 'append',
          data: { turn: 2, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'between markers' }] },
        },
        {
          type: 'tool/call', seq: 9, time: 1110,
          data: { turn: 2, step: 1, callId: 'between-call', name: 'read', arguments: '{"path":"synthetic"}' },
        },
        {
          type: 'tool/result', seq: 10, time: 1111, surfaceOp: 'append',
          data: {
            turn: 2, step: 1,
            message: {
              source: { kind: 'tool', callId: 'between-call' }, role: 'user',
              content: [{ type: 'tool-result', toolCallId: 'between-call', content: [{ type: 'text', text: 'synthetic result' }], isError: false }],
            },
          },
        },
        { type: 'step/end', seq: 11, time: 1112, data: { turn: 2, step: 1 } },
        { type: 'turn/end', seq: 12, time: 1113, data: { turn: 2, reason: { kind: 'completed' } } },
        { type: 'session/end-seed', seq: 13, time: 1114, data: {} },
        { type: 'turn/start', seq: 14, time: 1115, data: { turn: 3 } },
        { type: 'step/start', seq: 15, time: 1116, data: { turn: 3, step: 1 } },
        {
          type: 'user/message', seq: 16, time: 1117, surfaceOp: 'append',
          data: { turn: 3, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'after second marker' }] },
        },
        {
          type: 'assistant/message', seq: 17, time: 1118, surfaceOp: 'append',
          data: { turn: 3, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] } },
        },
        { type: 'step/end', seq: 18, time: 1119, data: { turn: 3, step: 1 } },
        { type: 'turn/end', seq: 19, time: 1120, data: { turn: 3, reason: { kind: 'completed' } } },
      ],
    });
    const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
    const indexed = index.sessions[0];
    assert.equal(indexed.forkStorageMode, '');
    assert.equal(indexed.inheritedContext, null);
    assert.equal(indexed.counts.messages, 4);
    assert.equal(indexed.counts.userMessages, 3);
    assert.equal(indexed.counts.toolCalls, 1);
    assert.equal(indexed.counts.turns, 3);
    assert.equal(indexed.title, 'before first marker');
    assert.deepEqual(indexed.summary.topTools, [{ name: 'read', count: 1 }]);
    const materialized = await materializeSessionForIndex(index, indexed);
    assert.equal(materialized._forkSegmentsByRawId, undefined);
    assert.deepEqual(
      materialized.logicalEvents.filter((event) => event.kind === 'user_message').map((event) => event.preview),
      ['before first marker', 'between markers', 'after second marker'],
    );
    assert.deepEqual(
      materialized.logicalEvents.filter((event) => event.subtype === 'session/end-seed').map((event) => event.preview),
      ['Session constructor seed ended at seq 5', 'Session constructor seed ended at seq 13'],
    );
    await assertProjectionParity(index, indexed, materialized);
  });

  await t.test('seeded derived Session keeps its header boundary across a later resume marker', async (subtest) => {
    const fixture = await makeSyntheticFixture(subtest, 'seeded-derived-resume', {
      header: { parentSession: 'synthetic-parent', seedLength: 5 },
      records: [
        { type: 'turn/start', seq: 0, time: 1201, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: 1202, data: { turn: 1, step: 1 } },
        {
          type: 'user/message', seq: 2, time: 1203, surfaceOp: 'append',
          data: { turn: 1, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'inherited parent work' }] },
        },
        { type: 'step/end', seq: 3, time: 1204, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 4, time: 1205, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'session/end-seed', seq: 5, time: 1206, data: {} },
        { type: 'turn/start', seq: 6, time: 1207, data: { turn: 2 } },
        { type: 'step/start', seq: 7, time: 1208, data: { turn: 2, step: 1 } },
        {
          type: 'user/message', seq: 8, time: 1209, surfaceOp: 'append',
          data: { turn: 2, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'first child work' }] },
        },
        {
          type: 'tool/call', seq: 9, time: 1210,
          data: { turn: 2, step: 1, callId: 'child-call', name: 'read', arguments: '{"path":"synthetic"}' },
        },
        {
          type: 'tool/result', seq: 10, time: 1211, surfaceOp: 'append',
          data: {
            turn: 2, step: 1,
            message: {
              source: { kind: 'tool', callId: 'child-call' }, role: 'user',
              content: [{ type: 'tool-result', toolCallId: 'child-call', content: [{ type: 'text', text: 'synthetic result' }], isError: false }],
            },
          },
        },
        { type: 'step/end', seq: 11, time: 1212, data: { turn: 2, step: 1 } },
        { type: 'turn/end', seq: 12, time: 1213, data: { turn: 2, reason: { kind: 'completed' } } },
        { type: 'session/end-seed', seq: 13, time: 1214, data: {} },
        { type: 'turn/start', seq: 14, time: 1215, data: { turn: 3 } },
        { type: 'step/start', seq: 15, time: 1216, data: { turn: 3, step: 1 } },
        {
          type: 'user/message', seq: 16, time: 1217, surfaceOp: 'append',
          data: { turn: 3, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'resumed child work' }] },
        },
        {
          type: 'assistant/message', seq: 17, time: 1218, surfaceOp: 'append',
          data: { turn: 3, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'resumed answer' }] } },
        },
        { type: 'step/end', seq: 18, time: 1219, data: { turn: 3, step: 1 } },
        { type: 'turn/end', seq: 19, time: 1220, data: { turn: 3, reason: { kind: 'completed' } } },
      ],
    });
    const index = await buildDeepSeekIndex({ sourceHome: fixture.sourceHome, repoRoot: fixture.repoRoot });
    const indexed = index.sessions[0];
    assert.equal(indexed.forkStorageMode, 'materialized');
    assert.equal(indexed.forkEvidence.seedLength, 5);
    assert.equal(indexed.forkEvidence.seedBoundarySeq, 5);
    assert.equal(indexed.forkEvidence.inheritedRawRecordCount, 5);
    assert.equal(indexed.inheritedContext.seedLength, 5);
    assert.equal(indexed.inheritedContext.mainEventCount, 1);
    assert.equal(indexed.counts.messages, 3);
    assert.equal(indexed.counts.userMessages, 2);
    assert.equal(indexed.counts.toolCalls, 1);
    assert.equal(indexed.counts.turns, 2);
    assert.equal(indexed.title, 'first child work');
    assert.deepEqual(indexed.summary.topTools, [{ name: 'read', count: 1 }]);
    const materialized = await materializeSessionForIndex(index, indexed);
    assert.deepEqual(
      materialized.logicalEvents.filter((event) => event.kind === 'user_message').map((event) => event.preview),
      ['first child work', 'resumed child work'],
    );
    assert.equal(materialized.logicalEvents.some((event) => /inherited parent work/.test(event.preview)), false);
    assert.deepEqual(
      materialized.logicalEvents.filter((event) => event.subtype === 'session/end-seed').map((event) => event.preview),
      ['Session constructor seed ended at seq 5', 'Session constructor seed ended at seq 13'],
    );
    const rawTimeline = deepSeekAdapter.query.getTimeline(index, materialized, { layer: 'raw', offset: 0, limit: 100 });
    assert.deepEqual(rawTimeline.events.slice(0, 7).map((event) => event.forkSegment), [
      'fork_metadata',
      'inherited_context',
      'inherited_context',
      'inherited_context',
      'inherited_context',
      'inherited_context',
      'continuation',
    ]);
    assert.ok(rawTimeline.events.slice(7).every((event) => event.forkSegment === 'continuation'));
    await assertProjectionParity(index, indexed, materialized);
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
