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
const {
  validateStructuredLogicalDetailDto,
} = require('../src/shared/logical-detail-contract');
const {
  projectQueryProjectionDigestAsync,
} = require('../src/project-query-store');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-phase2b', 'sessions');
const CODE_REPO = '/synthetic/deepseek-phase2b-code';
const WORKFLOW_REPO = '/synthetic/deepseek-phase2b-workflow';

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

function outerByCall(session, callId) {
  return session.logicalEvents.find((event) => (
    event.kind === 'code_mode_operation'
    && event.codeModeOperation?.outerCallId === callId
  ));
}

function nestedBySubCall(session, subCallId) {
  return session.logicalEvents.find((event) => event.id.endsWith(`:code-dispatch:${subCallId}`));
}

function rawSeqs(event) {
  return event.rawRefs.map((ref) => ref.sourceLocator.seq);
}

async function makeSyntheticFixture(t, id, records) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2b-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2b-home-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  t.after(() => fsp.rm(repoRoot, { recursive: true, force: true }));
  const sessionDir = path.join(sourceHome, '--synthetic-project--', id);
  await fsp.mkdir(sessionDir, { recursive: true });
  const header = {
    type: 'session', version: 0, id, createdAt: 1, cwd: repoRoot, delegationDepth: 0,
  };
  await fsp.writeFile(
    path.join(sessionDir, 'session.jsonl'),
    `${[header, ...records].map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );
  return { sourceHome, repoRoot };
}

test('M1 DeepSeek Code Mode uses explicit durable topology with disjoint outer and nested Raw ownership', async () => {
  const { index, indexed, materialized } = await buildFor(CODE_REPO);
  const outer = materialized.logicalEvents.filter((event) => event.kind === 'code_mode_operation');
  const nested = materialized.logicalEvents.filter((event) => event.id.includes(':logical:code-dispatch:'));

  assert.equal(outer.length, 6);
  assert.equal(nested.length, 9);
  assert.equal(materialized.logicalEvents.some((event) => (
    event.kind === 'other_tool_call'
    && event.toolName === 'run_code'
    && !event.id.includes(':logical:code-dispatch:')
  )), false);
  assert.equal(indexed.counts.toolCalls, 15);
  assert.deepEqual(indexed.analysis, undefined);
  assert.deepEqual(
    materialized.analysis.timelineStats.find((item) => item.name === 'code_mode_operation'),
    { name: 'code_mode_operation', count: 6 },
  );

  const sequential = outerByCall(materialized, 'outer-sequential');
  assert.deepEqual(
    sequential.codeModeOperation.dispatches.map((dispatch) => ({
      rootCallId: dispatch.rootCallId,
      parentCallId: dispatch.parentCallId,
      subCallId: dispatch.subCallId,
      depth: dispatch.depth,
    })),
    [
      {
        rootCallId: 'outer-sequential', parentCallId: 'outer-sequential',
        subCallId: 'outer-sequential:code:1', depth: 1,
      },
      {
        rootCallId: 'outer-sequential', parentCallId: 'outer-sequential',
        subCallId: 'outer-sequential:code:2', depth: 1,
      },
    ],
  );
  assert.deepEqual(rawSeqs(sequential), [2, 7]);
  assert.deepEqual(rawSeqs(nestedBySubCall(materialized, 'outer-sequential:code:1')), [3, 4]);
  assert.deepEqual(rawSeqs(nestedBySubCall(materialized, 'outer-sequential:code:2')), [5, 6]);

  const interleaved = outerByCall(materialized, 'outer-interleaved');
  assert.deepEqual(
    interleaved.codeModeOperation.dispatches.map((dispatch) => dispatch.subCallId),
    ['outer-interleaved:code:1', 'outer-interleaved:code:2'],
  );
  assert.deepEqual(rawSeqs(nestedBySubCall(materialized, 'outer-interleaved:code:1')), [11, 14]);
  assert.deepEqual(rawSeqs(nestedBySubCall(materialized, 'outer-interleaved:code:2')), [12, 13]);

  const nestedOuter = outerByCall(materialized, 'outer-nested');
  const parentDispatch = nestedOuter.codeModeOperation.dispatches[0];
  const grandchildDispatch = nestedOuter.codeModeOperation.dispatches[1];
  assert.equal(parentDispatch.depth, 1);
  assert.equal(parentDispatch.parentEventId, nestedOuter.id);
  assert.equal(grandchildDispatch.depth, 2);
  assert.equal(grandchildDispatch.parentCallId, parentDispatch.subCallId);
  assert.equal(grandchildDispatch.parentEventId, parentDispatch.eventId);

  const caughtOuter = outerByCall(materialized, 'outer-caught-error');
  const caughtNested = nestedBySubCall(materialized, 'outer-caught-error:code:1');
  assert.equal(caughtOuter.status, 'success');
  assert.equal(caughtOuter.severity, 'normal');
  assert.equal(caughtNested.status, 'failed');
  assert.equal(caughtNested.severity, 'error');
  const failedOuter = outerByCall(materialized, 'outer-failed');
  assert.equal(failedOuter.status, 'failed');
  assert.equal(nestedBySubCall(materialized, 'outer-failed:code:1').status, 'success');
  const incompleteOuter = outerByCall(materialized, 'outer-incomplete');
  const incompleteNested = nestedBySubCall(materialized, 'outer-incomplete:code:1');
  assert.equal(incompleteOuter.status, 'incomplete');
  assert.equal(incompleteNested.status, 'incomplete');
  assert.deepEqual(rawSeqs(incompleteOuter), [38]);
  assert.deepEqual(rawSeqs(incompleteNested), [39]);

  const ownedRawIds = new Set();
  for (const event of [...outer, ...nested]) {
    for (const ref of event.rawRefs) {
      assert.equal(ownedRawIds.has(ref.rawId), false, `Raw row is multiply owned: ${ref.rawId}`);
      ownedRawIds.add(ref.rawId);
    }
  }

  const timeline = deepSeekAdapter.query.getTimeline(index, materialized, {
    layer: 'main', offset: 0, limit: 100,
  });
  const publicNested = timeline.events.find((event) => event.id === caughtNested.id);
  assert.deepEqual(publicNested.presentationContext, {
    relation: 'enclosed_by_code_mode_operation',
    codeModeParentId: caughtOuter.id,
  });
  const scripted = deepSeekAdapter.query.getTimeline(index, materialized, {
    layer: 'main', kind: 'code_mode_script_operation', offset: 0, limit: 100,
  });
  assert.deepEqual(scripted.events.map((event) => event.id), outer.map((event) => event.id));
  assert.deepEqual(
    timeline.eventKinds.main.find((item) => item.value === 'code_mode_script_operation'),
    { value: 'code_mode_script_operation', label: 'Scripted operation', count: 6, matchField: 'presentation_fallback' },
  );

  const outerDetail = await buildEventDetailForSession(index, materialized, nestedOuter.id, 'main');
  validateStructuredLogicalDetailDto(outerDetail);
  assert.ok(outerDetail.timelineSections.some((section) => section.purpose === 'request' && section.type === 'code'));
  assert.ok(outerDetail.timelineSections.some((section) => section.purpose === 'result' && section.type === 'terminal'));
  const eventRefs = outerDetail.inspectorSections.find((section) => section.type === 'event_refs');
  assert.equal(eventRefs.items.length, 2);
  assert.match(eventRefs.items[1].label, /^↳ /);

  const nestedDetail = await buildEventDetailForSession(
    index,
    materialized,
    grandchildDispatch.eventId,
    'main',
  );
  validateStructuredLogicalDetailDto(nestedDetail);
  assert.deepEqual(nestedDetail.timelineSections.map((section) => section.purpose), ['request', 'result']);
  assert.ok(nestedDetail.inspectorSections.some((section) => section.purpose === 'traceability'));
  const incompleteDetail = await buildEventDetailForSession(index, materialized, incompleteNested.id, 'main');
  validateStructuredLogicalDetailDto(incompleteDetail);
  assert.ok(incompleteDetail.timelineSections.some((section) => (
    section.purpose === 'result' && section.type === 'notice'
  )));

  await assertProjectionParity(index, indexed, materialized);
});

test('M1 malformed or unowned DeepSeek dispatch identities fail closed to separate Protocol evidence', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'malformed-code-dispatch', [
    { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
    {
      type: 'tool/call', seq: 1, time: 3,
      data: { turn: 1, step: 1, callId: 'outer', name: 'run_code', arguments: '{"code":"text(1)","description":"synthetic"}' },
    },
    {
      type: 'tool/code-dispatch-start', seq: 2, time: 4,
      data: { rootCallId: 'missing-root', parentCallId: 'missing-root', subCallId: 'orphan:code:1', name: 'read', arguments: { path: 'x' } },
    },
    {
      type: 'tool/result', seq: 3, time: 5, surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: {
          source: { kind: 'tool', callId: 'outer' }, role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'outer', content: [{ type: 'text', text: 'ok' }], isError: false }],
        },
      },
    },
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const outer = outerByCall(materialized, 'outer');
  assert.deepEqual(outer.codeModeOperation.eventRefs, []);
  assert.equal(materialized.logicalEvents.some((event) => event.id.includes(':logical:code-dispatch:')), false);
  const fallback = materialized.logicalEvents.find((event) => event.subtype === 'tool/code-dispatch-start');
  assert.ok(fallback);
  assert.equal(fallback.layer, 'protocol');
  assert.equal(fallback.status, 'incomplete');
  assert.deepEqual(rawSeqs(fallback), [2]);

  const duplicateFixture = await makeSyntheticFixture(t, 'ambiguous-code-dispatch-root', [
    { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
    {
      type: 'tool/call', seq: 1, time: 3,
      data: { turn: 1, step: 1, callId: 'duplicate-root', name: 'run_code', arguments: '{"code":"text(1)"}' },
    },
    {
      type: 'tool/call', seq: 2, time: 4,
      data: { turn: 1, step: 1, callId: 'duplicate-root', name: 'run_code', arguments: '{"code":"text(2)"}' },
    },
    {
      type: 'tool/code-dispatch-start', seq: 3, time: 5,
      data: {
        rootCallId: 'duplicate-root', parentCallId: 'duplicate-root',
        subCallId: 'duplicate-root:code:1', name: 'read', arguments: { path: 'x' },
      },
    },
    {
      type: 'tool/result', seq: 4, time: 6, surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: {
          source: { kind: 'tool', callId: 'duplicate-root' }, role: 'user',
          content: [{
            type: 'tool-result', toolCallId: 'duplicate-root',
            content: [{ type: 'text', text: 'ok' }], isError: false,
          }],
        },
      },
    },
  ]);
  const duplicate = await buildFor(duplicateFixture.repoRoot, duplicateFixture.sourceHome);
  assert.equal(duplicate.materialized.logicalEvents.some((event) => (
    event.id.includes(':logical:code-dispatch:')
  )), false);
  const duplicateFallback = duplicate.materialized.logicalEvents.find((event) => (
    event.subtype === 'tool/code-dispatch-start'
  ));
  assert.ok(duplicateFallback);
  assert.match(duplicateFallback.searchText, /is not an outer run_code call/);
  assert.deepEqual(rawSeqs(duplicateFallback), [3]);
});

test('M1 source-permitted settlement-only history remains one successful nested activity', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'settlement-only-code-dispatch', [
    { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
    {
      type: 'tool/call', seq: 1, time: 3,
      data: { turn: 1, step: 1, callId: ' outer ', name: 'run_code', arguments: '{"code":"text(1)","description":"synthetic"}' },
    },
    {
      type: 'tool/code-dispatch', seq: 2, time: 4,
      data: {
        rootCallId: ' outer ', parentCallId: ' outer ', subCallId: ' child ',
        name: 'read', arguments: { path: 'settled.txt' }, isError: false,
        content: [{ type: 'text', text: 'settled-only result' }],
      },
    },
    {
      type: 'tool/result', seq: 3, time: 5, surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: {
          source: { kind: 'tool', callId: ' outer ' }, role: 'user',
          content: [{ type: 'tool-result', toolCallId: ' outer ', content: [{ type: 'text', text: 'ok' }], isError: false }],
        },
      },
    },
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const outer = outerByCall(materialized, ' outer ');
  const nested = nestedBySubCall(materialized, ' child ');
  assert.equal(nested.status, 'success');
  assert.deepEqual(rawSeqs(nested), [2]);
  assert.deepEqual(outer.codeModeOperation.eventRefs, [nested.id]);
  assert.equal(outer.codeModeOperation.dispatches[0].rootCallId, ' outer ');
  assert.equal(outer.codeModeOperation.dispatches[0].subCallId, ' child ');
});

test('M1 accepted snapshot rejects stale Code Mode Materialized, Detail, and Raw reads after append', async (t) => {
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-p2b-fresh-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  const source = path.join(
    FIXTURE_ROOT,
    '--synthetic-deepseek-phase2b-code--',
    'code-mode',
    'session.jsonl',
  );
  const target = path.join(sourceHome, '--copy--', 'code-mode', 'session.jsonl');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot: CODE_REPO });
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  const outer = outerByCall(materialized, 'outer-sequential');
  const outerRaw = materialized.rawEvents.find((raw) => raw.rawId === outer.rawRefs[0].rawId);
  await fsp.appendFile(target, `${JSON.stringify({
    type: 'turn/end', seq: 40, time: 1041, data: { turn: 1, reason: { kind: 'completed' } },
  })}\n`, 'utf8');
  await assert.rejects(
    materializeSessionForIndex(index, indexed),
    (error) => error?.code === 'INDEXED_SOURCE_STALE',
  );
  await assert.rejects(
    buildEventDetailForSession(index, materialized, outer.id, 'main'),
    (error) => error?.code === 'INDEXED_SOURCE_STALE',
  );
  await assert.rejects(
    deepSeekAdapter.readRawRecord(index, materialized, outerRaw),
    (error) => error?.code === 'INDEXED_SOURCE_STALE',
  );
});

test('M2 workflow lifecycle is one source-grouped Protocol run with exact member evidence and no fabricated call owner', async () => {
  const { index, indexed, materialized } = await buildFor(WORKFLOW_REPO);
  const workflows = materialized.logicalEvents.filter((event) => event.subtype === 'tool-workflow/run');
  const tools = materialized.logicalEvents.filter((event) => event.layer === 'main' && event.toolName === 'workflow');
  assert.equal(workflows.length, 3);
  assert.equal(tools.length, 3);
  assert.deepEqual(workflows.map((event) => event.status), ['success', 'failed', 'incomplete']);
  assert.deepEqual(workflows.map((event) => rawSeqs(event)), [[3, 4, 5, 6], [11, 12, 13, 14], [19, 20]]);
  assert.deepEqual(tools.map((event) => rawSeqs(event)), [[2, 7], [10, 15], [18]]);
  assert.equal(indexed.counts.toolCalls, 3);
  assert.equal(indexed.counts.protocol, 9);
  assert.deepEqual(
    materialized.analysis.protocolStats.find((item) => item.name === 'tool-workflow/run'),
    { name: 'tool-workflow/run', count: 3 },
  );
  assert.equal(materialized.analysis.protocolStats.some((item) => item.name === 'tool-workflow/run-start'), false);

  const workflowRawIds = new Set(workflows.flatMap((event) => event.rawRefs.map((ref) => ref.rawId)));
  for (const tool of tools) {
    assert.ok(tool.rawRefs.every((ref) => !workflowRawIds.has(ref.rawId)));
  }
  assert.ok(workflows.every((event) => !event.toolName));
  assert.ok(workflows.every((event) => !Object.hasOwn(event, 'codeModeOperation')));

  const completedDetail = await buildEventDetailForSession(index, materialized, workflows[0].id, 'protocol');
  validateStructuredLogicalDetailDto(completedDetail);
  assert.ok(completedDetail.timelineSections.some((section) => (
    section.type === 'kv' && section.entries.some((entry) => entry.key === 'Child Session ID' && entry.value === 'synthetic-child-complete')
  )));
  assert.ok(completedDetail.inspectorSections.some((section) => (
    section.purpose === 'traceability'
    && section.entries?.some((entry) => entry.key === 'Run ID' && entry.value === 'workflow-run-complete')
  )));
  const incompleteDetail = await buildEventDetailForSession(index, materialized, workflows[2].id, 'protocol');
  validateStructuredLogicalDetailDto(incompleteDetail);
  assert.ok(incompleteDetail.inspectorSections.some((section) => section.type === 'notice'));

  const protocolTimeline = deepSeekAdapter.query.getTimeline(index, materialized, {
    layer: 'protocol', kind: 'tool-workflow/run', offset: 0, limit: 100,
  });
  assert.deepEqual(protocolTimeline.events.map((event) => event.id), workflows.map((event) => event.id));
  await assertProjectionParity(index, indexed, materialized);
});

test('M2 contradictory workflow identities fail closed to row-level Protocol evidence', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'malformed-workflow', [
    { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
    { type: 'tool-workflow/run-start', seq: 1, time: 3, data: { runId: 'bad-run', name: 'bad' } },
    {
      type: 'tool-workflow/agent-start', seq: 2, time: 4,
      data: { runId: 'bad-run', seq: 1, label: 'open agent', childId: 'bad-child' },
    },
    { type: 'tool-workflow/run-end', seq: 3, time: 5, data: { runId: 'bad-run', stopReason: 'completed' } },
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  assert.equal(materialized.logicalEvents.some((event) => event.subtype === 'tool-workflow/run'), false);
  const fallbacks = materialized.logicalEvents.filter((event) => event.subtype.startsWith('tool-workflow/'));
  assert.equal(fallbacks.length, 3);
  assert.ok(fallbacks.every((event) => event.layer === 'protocol' && event.rawRefs.length === 1));
  assert.deepEqual(fallbacks.map((event) => rawSeqs(event)[0]), [1, 2, 3]);
});

test('M2 source-defined workflow cancellation remains distinct from failure and incompleteness', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'cancelled-workflow', [
    { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
    { type: 'tool-workflow/run-start', seq: 1, time: 3, data: { runId: ' cancelled-run ', name: 'cancelled' } },
    {
      type: 'tool-workflow/agent-start', seq: 2, time: 4,
      data: { runId: ' cancelled-run ', seq: 1, label: 'cancelled agent', childId: 'cancelled-child' },
    },
    {
      type: 'tool-workflow/agent-end', seq: 3, time: 5,
      data: { runId: ' cancelled-run ', seq: 1, outcome: 'cancelled' },
    },
    { type: 'tool-workflow/run-end', seq: 4, time: 6, data: { runId: ' cancelled-run ', stopReason: 'cancelled' } },
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const workflow = materialized.logicalEvents.find((event) => event.subtype === 'tool-workflow/run');
  assert.equal(workflow.status, 'cancelled');
  assert.equal(workflow.severity, 'warning');
  assert.deepEqual(rawSeqs(workflow), [1, 2, 3, 4]);
  assert.match(workflow.searchText, /runId= cancelled-run /);
});
