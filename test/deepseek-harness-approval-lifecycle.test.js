'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { buildDeepSeekIndex, deepSeekAdapter } = require('../src/deepseek-harness');
const {
  buildEventDetailForSession,
  materializeSessionForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-approval-lifecycle', 'sessions');
const FIXTURE_FILE = path.join(
  FIXTURE_ROOT,
  '--synthetic-deepseek-approval-lifecycle--',
  'approval-lifecycle',
  'session.jsonl',
);
const FIXTURE_REPO = '/synthetic/deepseek-approval-lifecycle';
const FIXTURE_SHA256 = '60a1b4a4b24664ca8ce75b25ca655b40832ca2f35a4c7a7ab5f568c230798aca';

function row(type, data, extra = {}) {
  return { type, data, ...extra };
}

function asked(id, toolName = 'write', optional = {}) {
  return row('approval/asked', { id, toolName, ...optional });
}

function decided(id, outcome) {
  return row('approval/decided', { id, outcome });
}

function toolCall(callId, name = 'write') {
  return row('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' });
}

function toolResult(callId, isError = false) {
  return row('tool/result', {
    turn: 1,
    step: 1,
    message: {
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result', toolCallId: callId,
        content: [{ type: 'text', text: isError ? 'error' : 'ok' }], isError,
      }],
      role: 'user', id: `result-${callId}`,
    },
  }, { sourceEventSeqs: [0], surfaceOp: 'append' });
}

function dispatch(type, rootCallId, subCallId, extra = {}) {
  return row(type, {
    rootCallId,
    parentCallId: rootCallId,
    subCallId,
    name: 'write',
    arguments: { path: 'nested-sanitized.txt' },
    ...extra,
  });
}

function inTurn(...rows) {
  return [
    row('turn/start', { turn: 1 }),
    row('step/start', { turn: 1, step: 1 }),
    ...rows,
    row('step/end', { turn: 1, step: 1 }),
    row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ];
}

function sequence(rows) {
  return rows.map((candidate, seq) => ({ ...candidate, seq, time: 1001 + seq }));
}

async function buildFor(repoRoot, sourceHome = FIXTURE_ROOT) {
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot });
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  return { index, indexed, materialized };
}

async function makeSyntheticFixture(t, id, rows, headerFields = {}) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-approval-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-approval-home-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  t.after(() => fsp.rm(repoRoot, { recursive: true, force: true }));
  const sessionDir = path.join(sourceHome, '--synthetic-project--', id);
  await fsp.mkdir(sessionDir, { recursive: true });
  const header = {
    type: 'session', version: 0, id, createdAt: 1000, cwd: repoRoot, delegationDepth: 0,
    ...headerFields,
  };
  await fsp.writeFile(
    path.join(sessionDir, 'session.jsonl'),
    `${[header, ...sequence(rows)].map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );
  return { sourceHome, repoRoot };
}

function approvals(session) {
  return session.logicalEvents.filter(event => event.subtype === 'approval/lifecycle');
}

function genericEndpoints(session) {
  return session.logicalEvents.filter(event => (
    event.subtype === 'approval/asked' || event.subtype === 'approval/decided'
  ));
}

function rawSeqs(event) {
  return event.rawRefs.map(ref => ref.sourceLocator.seq);
}

async function assertParity(index, indexed, materialized) {
  const digest = await projectQueryProjectionDigestAsync(
    materialized,
    deepSeekAdapter.query.projectQueryPresentation,
  );
  assert.equal(digest, indexed.queryProjectionDigest);
}

test('sanitized fixture projects exact complete/incomplete ownership, neutral outcomes, relations, and parity', async () => {
  const bytes = await fsp.readFile(FIXTURE_FILE);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FIXTURE_SHA256);
  const { index, indexed, materialized } = await buildFor(FIXTURE_REPO);
  const events = approvals(materialized);
  assert.equal(events.length, 3);
  const byId = new Map(events.map(event => [event.approvalLifecycle.requestId, event]));
  assert.deepEqual(rawSeqs(byId.get('request-allowed')), [6, 7]);
  assert.deepEqual(rawSeqs(byId.get('request-rejected')), [10, 12]);
  assert.deepEqual(rawSeqs(byId.get('request-incomplete')), [11]);
  assert.deepEqual(
    events.map(event => event.approvalLifecycle.outcome || '').sort(),
    ['', 'allowed-once', 'rejected'],
  );
  assert.deepEqual(events.map(event => event.status).sort(), ['incomplete', 'recorded', 'recorded']);
  assert.ok(events.every(event => event.severity === 'normal' && event.layer === 'protocol'));
  assert.equal(genericEndpoints(materialized).length, 0);
  assert.equal(materialized.logicalEvents.filter(event => event.layer === 'main').length, 2);
  assert.equal(indexed.counts.toolCalls, 2);
  assert.equal(indexed.counts.issueEvents, 1, 'only the rejected tool result is an issue');
  assert.equal(byId.get('request-allowed').approvalLifecycle.toolRef.callId, 'call-allowed');
  assert.match(byId.get('request-allowed').approvalLifecycle.toolRef.eventId, /:logical:tool:call-allowed$/u);
  assert.match(byId.get('request-rejected').approvalLifecycle.toolRef.eventId, /:logical:tool:call-rejected$/u);
  assert.equal(Object.hasOwn(byId.get('request-incomplete').approvalLifecycle, 'toolRef'), false);
  assert.ok(materialized.logicalEvents.some(event => event.permissionChange?.field === 'approvalPolicy'));
  assert.ok(events.every(event => !event.permissionState && !event.permissionChange));
  assert.ok(events.every(event => !event.relations && !event.eventRefs && !event.toolRefSuppressed));
  assert.equal(new Set(events.flatMap(event => event.rawRefs.map(ref => ref.rawId))).size, 5);
  await assertParity(index, indexed, materialized);

  const incomplete = byId.get('request-incomplete');
  const en = await buildEventDetailForSession(index, materialized, incomplete.id, 'protocol', { locale: 'en' });
  const zh = await buildEventDetailForSession(index, materialized, incomplete.id, 'protocol', { locale: 'zh-CN' });
  validateStructuredLogicalDetailDto(en);
  validateStructuredLogicalDetailDto(zh);
  assert.equal(en.title, 'Interactive approval');
  assert.equal(zh.title, '交互式审批');
  assert.ok(en.timelineSections.some(section => section.text === 'Approval requested — no durable decision recorded'));
  assert.ok(zh.timelineSections.some(section => section.text === '已记录审批请求，但没有持久化决定'));
  assert.ok(en.inspectorSections.some(section => section.entries?.some(entry => entry.key === 'Request ID')));
});

test('all source-contract outcomes keep exact values and intended neutral count semantics', async (t) => {
  const rows = inTurn(
    asked('allow'), decided('allow', 'allowed-once'),
    asked('reject'), decided('reject', 'rejected'),
    asked('cancel'), decided('cancel', 'cancelled'),
    asked('unavailable'), decided('unavailable', 'unavailable'),
  );
  const fixture = await makeSyntheticFixture(t, 'all-outcomes', rows);
  const { index, indexed, materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const events = approvals(materialized);
  assert.deepEqual(events.map(event => event.approvalLifecycle.outcome).sort(), [
    'allowed-once', 'cancelled', 'rejected', 'unavailable',
  ]);
  assert.ok(events.every(event => event.status === 'recorded'));
  assert.deepEqual(events.map(event => event.severity), ['normal', 'normal', 'normal', 'warning']);
  assert.equal(indexed.counts.issueEvents, 0, 'Protocol warning severity does not increment issueEvents');
  const unavailable = events.find(event => event.approvalLifecycle.outcome === 'unavailable');
  const en = await buildEventDetailForSession(index, materialized, unavailable.id, 'protocol', { locale: 'en' });
  const zh = await buildEventDetailForSession(index, materialized, unavailable.id, 'protocol', { locale: 'zh-CN' });
  assert.ok(en.timelineSections.some(section => section.text === 'Approval was unavailable.'));
  assert.ok(zh.timelineSections.some(section => section.text === '审批不可用。'));
});

test('asked-only, absent callId, and unresolved callId remain valid incomplete or complete evidence without a toolRef', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'optional-relations', inTurn(
    asked('asked-only', 'read', { reason: '' }),
    asked('no-call'), decided('no-call', 'allowed-once'),
    asked('unresolved', 'write', { callId: 'missing-call' }), decided('unresolved', 'rejected'),
    asked('empty-call', 'write', { callId: '' }), decided('empty-call', 'cancelled'),
  ));
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const events = approvals(materialized);
  assert.equal(events.length, 4);
  assert.equal(events.find(event => event.approvalLifecycle.requestId === 'asked-only').status, 'incomplete');
  assert.equal(events.find(event => event.approvalLifecycle.requestId === 'asked-only').approvalLifecycle.reason, '');
  assert.ok(events.every(event => !Object.hasOwn(event.approvalLifecycle, 'toolRef')));
  assert.equal(events.find(event => event.approvalLifecycle.requestId === 'no-call').approvalLifecycle.callId, undefined);
  assert.equal(events.find(event => event.approvalLifecycle.requestId === 'unresolved').approvalLifecycle.callId, 'missing-call');
  assert.equal(events.find(event => event.approvalLifecycle.requestId === 'empty-call').approvalLifecycle.callId, '');
});

test('unique exact callId resolves only to an existing child-owned tool Logical Event', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'unique-tool-ref', inTurn(
    toolCall('exact-call'),
    asked('exact-request', 'write', { callId: 'exact-call' }),
    decided('exact-request', 'allowed-once'),
    toolResult('exact-call'),
  ));
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const approval = approvals(materialized)[0];
  const tool = materialized.logicalEvents.find(event => event.id === approval.approvalLifecycle.toolRef.eventId);
  assert.ok(tool);
  assert.equal(approval.approvalLifecycle.toolRef.callId, 'exact-call');
  assert.deepEqual(rawSeqs(approval), [3, 4]);
  assert.deepEqual(rawSeqs(tool), [2, 5]);
});

test('exact nested Code Mode subCallId resolves to the existing nested dispatch Logical Event', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'nested-code-tool-ref', inTurn(
    toolCall('outer-code-call', 'run_code'),
    dispatch('tool/code-dispatch-start', 'outer-code-call', 'outer-code-call:code:1'),
    asked('nested-request', 'write', { callId: 'outer-code-call:code:1' }),
    decided('nested-request', 'allowed-once'),
    dispatch('tool/code-dispatch', 'outer-code-call', 'outer-code-call:code:1', {
      isError: false,
      content: [{ type: 'text', text: 'nested write complete' }],
    }),
    toolResult('outer-code-call'),
  ));
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const approval = approvals(materialized)[0];
  const nested = materialized.logicalEvents.find(event => (
    event.id.endsWith(':logical:code-dispatch:outer-code-call:code:1')
  ));
  assert.ok(nested);
  assert.deepEqual(approval.approvalLifecycle.toolRef, {
    callId: 'outer-code-call:code:1',
    eventId: nested.id,
  });
  assert.deepEqual(rawSeqs(approval), [4, 5]);
  assert.deepEqual(rawSeqs(nested), [3, 6]);
});

test('duplicate tool identity is ambiguous and never receives a manufactured relation', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'ambiguous-tool-ref', inTurn(
    toolCall('duplicate-call'),
    toolCall('duplicate-call'),
    asked('ambiguous-request', 'write', { callId: 'duplicate-call' }),
    decided('ambiguous-request', 'allowed-once'),
    toolResult('duplicate-call'),
  ));
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const approval = approvals(materialized)[0];
  assert.equal(approval.approvalLifecycle.callId, 'duplicate-call');
  assert.equal(Object.hasOwn(approval.approvalLifecycle, 'toolRef'), false);

  const crossKind = await makeSyntheticFixture(t, 'direct-nested-ambiguous-tool-ref', inTurn(
    toolCall('shared-call'),
    toolCall('outer-shared-code', 'run_code'),
    dispatch('tool/code-dispatch-start', 'outer-shared-code', 'shared-call'),
    asked('shared-request', 'write', { callId: 'shared-call' }),
    decided('shared-request', 'allowed-once'),
    dispatch('tool/code-dispatch', 'outer-shared-code', 'shared-call', {
      isError: false,
      content: [{ type: 'text', text: 'nested complete' }],
    }),
    toolResult('shared-call'),
    toolResult('outer-shared-code'),
  ));
  const crossKindBuilt = await buildFor(crossKind.repoRoot, crossKind.sourceHome);
  const crossKindApproval = approvals(crossKindBuilt.materialized)[0];
  assert.equal(crossKindApproval.approvalLifecycle.callId, 'shared-call');
  assert.equal(Object.hasOwn(crossKindApproval.approvalLifecycle, 'toolRef'), false);
});

test('recoverable malformed counterparts poison their whole requestId group', async (t) => {
  const cases = [
    {
      name: 'malformed-decided',
      rows: [asked('shared-a'), row('approval/decided', { id: 'shared-a', outcome: 'future-outcome' })],
    },
    {
      name: 'malformed-asked',
      rows: [row('approval/asked', { id: 'shared-b', toolName: 'write', callId: 7 }), decided('shared-b', 'rejected')],
    },
  ];
  for (const candidate of cases) {
    await t.test(candidate.name, async (subtest) => {
      const fixture = await makeSyntheticFixture(subtest, candidate.name, inTurn(...candidate.rows));
      const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
      assert.equal(approvals(materialized).length, 0);
      assert.equal(genericEndpoints(materialized).length, 2);
      assert.ok(genericEndpoints(materialized).every(event => (
        event.status === 'incomplete' && event.severity === 'warning'
      )));
    });
  }
});

test('duplicates, decided-only, invalid outcomes, empty IDs, malformed fields, and extra keys fail closed', async (t) => {
  const cases = [
    ['decided-only', [decided('orphan', 'rejected')]],
    ['duplicate-asked', [asked('dup'), asked('dup'), decided('dup', 'rejected')]],
    ['duplicate-decided', [asked('dup'), decided('dup', 'rejected'), decided('dup', 'cancelled')]],
    ['empty-asked-id', [asked('')]],
    ['empty-decided-id', [row('approval/decided', { id: '', outcome: 'rejected' })]],
    ['invalid-outcome', [asked('bad-outcome'), decided('bad-outcome', 'allowed-always')]],
    ['malformed-call-id', [row('approval/asked', { id: 'bad-call', toolName: 'write', callId: 1 })]],
    ['malformed-reason', [row('approval/asked', { id: 'bad-reason', toolName: 'write', reason: null })]],
    ['extra-asked-key', [row('approval/asked', { id: 'extra-a', toolName: 'write', extra: true }), decided('extra-a', 'rejected')]],
    ['extra-decided-key', [asked('extra-d'), row('approval/decided', { id: 'extra-d', outcome: 'rejected', extra: true })]],
  ];
  for (const [name, endpoints] of cases) {
    await t.test(name, async (subtest) => {
      const fixture = await makeSyntheticFixture(subtest, name, inTurn(...endpoints));
      const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
      assert.equal(approvals(materialized).length, 0);
      assert.equal(genericEndpoints(materialized).length, endpoints.length);
      assert.ok(genericEndpoints(materialized).every(event => event.severity === 'warning'));
    });
  }
});

test('mismatched IDs and interleaving pair strictly by requestId rather than adjacency', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'pairing-identity', inTurn(
    asked('mismatch-a'),
    decided('mismatch-b', 'rejected'),
    asked('interleave-a'),
    asked('interleave-b'),
    decided('interleave-b', 'cancelled'),
    decided('interleave-a', 'allowed-once'),
  ));
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const events = approvals(materialized);
  assert.equal(events.length, 3);
  const facts = new Map(events.map(event => [event.approvalLifecycle.requestId, event.approvalLifecycle]));
  assert.equal(Object.hasOwn(facts.get('mismatch-a'), 'outcome'), false);
  assert.equal(facts.get('interleave-a').outcome, 'allowed-once');
  assert.equal(facts.get('interleave-b').outcome, 'cancelled');
  assert.equal(genericEndpoints(materialized).length, 1);
  assert.equal(genericEndpoints(materialized)[0].subtype, 'approval/decided');
});

test('approval endpoints outside an open turn stay generic warnings and cannot act as counterparts', async (t) => {
  const askedOutside = await makeSyntheticFixture(t, 'asked-outside', [asked('outside-a')]);
  const askedBuilt = await buildFor(askedOutside.repoRoot, askedOutside.sourceHome);
  assert.equal(approvals(askedBuilt.materialized).length, 0);
  assert.equal(genericEndpoints(askedBuilt.materialized)[0].severity, 'warning');

  const decidedOutside = await makeSyntheticFixture(t, 'decided-outside', [
    row('turn/start', { turn: 1 }),
    asked('inside-a'),
    row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    decided('inside-a', 'rejected'),
  ]);
  const decidedBuilt = await buildFor(decidedOutside.repoRoot, decidedOutside.sourceHome);
  assert.equal(approvals(decidedBuilt.materialized).length, 0);
  assert.equal(genericEndpoints(decidedBuilt.materialized).length, 2);
  assert.ok(genericEndpoints(decidedBuilt.materialized).every(event => event.severity === 'warning'));

  const askedCounterpartOutside = await makeSyntheticFixture(t, 'asked-counterpart-outside', [
    asked('inside-b'),
    row('turn/start', { turn: 1 }),
    decided('inside-b', 'rejected'),
    row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]);
  const askedCounterpartBuilt = await buildFor(
    askedCounterpartOutside.repoRoot,
    askedCounterpartOutside.sourceHome,
  );
  assert.equal(approvals(askedCounterpartBuilt.materialized).length, 0);
  assert.equal(genericEndpoints(askedCounterpartBuilt.materialized).length, 2);
  assert.ok(genericEndpoints(askedCounterpartBuilt.materialized).every(event => event.severity === 'warning'));
});

test('open-turn enclosure does not invent a same-turn pairing requirement', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'cross-turn-pair', [
    row('turn/start', { turn: 1 }),
    asked('cross-turn'),
    row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    row('turn/start', { turn: 2 }),
    decided('cross-turn', 'cancelled'),
    row('turn/end', { turn: 2, reason: { kind: 'completed' } }),
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  assert.equal(approvals(materialized).length, 1);
  assert.equal(approvals(materialized)[0].approvalLifecycle.outcome, 'cancelled');
  assert.equal(genericEndpoints(materialized).length, 0);
});

test('seed ownership prevents inherited pairing and cross-seed tool relation', async (t) => {
  const splitPair = await makeSyntheticFixture(t, 'split-pair', [
    row('turn/start', { turn: 1 }),
    asked('split-request'),
    decided('split-request', 'rejected'),
    row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ], { parentSession: 'parent-approval', origin: 'subagent', seedLength: 2, delegationDepth: 1 });
  const splitBuilt = await buildFor(splitPair.repoRoot, splitPair.sourceHome);
  assert.equal(approvals(splitBuilt.materialized).length, 0);
  assert.equal(genericEndpoints(splitBuilt.materialized).length, 1);

  const crossTool = await makeSyntheticFixture(t, 'cross-tool', [
    row('turn/start', { turn: 1 }),
    row('step/start', { turn: 1, step: 1 }),
    toolCall('inherited-call'),
    toolResult('inherited-call'),
    asked('child-request', 'write', { callId: 'inherited-call' }),
    decided('child-request', 'allowed-once'),
    row('step/end', { turn: 1, step: 1 }),
    row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ], { parentSession: 'parent-tool', origin: 'subagent', seedLength: 4, delegationDepth: 1 });
  const crossBuilt = await buildFor(crossTool.repoRoot, crossTool.sourceHome);
  const approval = approvals(crossBuilt.materialized)[0];
  assert.ok(approval);
  assert.equal(approval.approvalLifecycle.callId, 'inherited-call');
  assert.equal(Object.hasOwn(approval.approvalLifecycle, 'toolRef'), false);
});

test('permission state, sandbox denial, and escalated approval stay independent with no retry provenance', async (t) => {
  const fixture = await makeSyntheticFixture(t, 'independent-state', [
    row('permission/preset', { preset: 'workspace-write' }),
    row('sandbox/mode', { mode: 'workspace-write' }),
    row('approval/policy', { policy: 'ask' }),
    ...inTurn(
      toolCall('denied-call'), toolResult('denied-call', true),
      toolCall('escalated-call'),
      asked('escalated-request', 'write', { callId: 'escalated-call' }),
      decided('escalated-request', 'allowed-once'),
      toolResult('escalated-call'),
    ),
  ]);
  const { materialized } = await buildFor(fixture.repoRoot, fixture.sourceHome);
  const approval = approvals(materialized)[0];
  assert.match(approval.approvalLifecycle.toolRef.eventId, /:logical:tool:escalated-call$/u);
  assert.doesNotMatch(approval.approvalLifecycle.toolRef.eventId, /denied-call/u);
  assert.equal(Object.hasOwn(approval, 'permissionState'), false);
  assert.equal(Object.hasOwn(approval, 'relations'), false);
  assert.equal(Object.hasOwn(approval, 'provenance'), false);
});
