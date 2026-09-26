'use strict';

// Synthetic native v4 records from 477b4f42 (DSH 0.1.7-rc.2):
// core/session/src/types.ts, llm/llm/src/{message,assistant-stream}.ts,
// core/tools/src/ptc.ts, session/session-format-v3-to-v4/src/tool-role.ts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { buildDeepSeekIndex, discoverDeepSeekProjects, deepSeekAdapter, parseSessionArtifact, readDeepSeekRawRecord } = require('../src/deepseek-harness');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, buildEventDetailForSession } = require('../src/source-adapters');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');

const row = (type, seq, data = {}, extras = {}) => ({ type, seq, time: 1000 + seq, data, ...extras });
const text = value => [{ type: 'text', text: value }];
const user = (seq, value) => row('user/message', seq, { id: `u${seq}`, role: 'user', source: { kind: 'user' }, content: text(value) }, { surfaceOp: 'append' });
const assistant = (seq, value, extras = {}) => row('assistant/message', seq, {
  turn: 1, step: 1, message: { id: `a${seq}`, role: 'assistant', source: { kind: 'model', provider: 'synthetic', model: 'test' }, content: text(value) },
  stream: [{ type: 'text-chunks', index: 0, time0: 1000, dt: [], texts: [value] }], ...extras,
}, { surfaceOp: 'append' });
const call = (seq, id, name = 'read') => row('tool/call', seq, { turn: 1, step: 1, callId: id, name, arguments: name === 'run_code' ? '{"code":"await tools.read({path: \'sample.txt\'})","description":"Read sample"}' : '{"path":"sample.txt"}' });
const result = (seq, id, value, isError = false, extras = {}) => row('tool/result', seq, {
  turn: 1, step: 1, message: { id: `r-${id}`, role: 'tool', source: { kind: 'tool', callId: id }, toolCallId: id, isError, content: text(value) },
}, { surfaceOp: 'append', ...extras });

async function fixture(t, records, header = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sa-dsh-v4-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'workspace');
  const sourceHome = path.join(root, 'sessions');
  const directory = path.join(sourceHome, 'project', 'synthetic');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'session.v4.jsonl');
  const head = { type: 'session', version: 4, id: 'synthetic', createdAt: 1, cwd: repoRoot, isSeeded: false, delegationDepth: 0, ...header };
  const body = [head, ...records].map(JSON.stringify).join('\n') + '\n';
  await fsp.writeFile(file, body, 'utf8');
  return { sourceHome, repoRoot, directory, file, head, body };
}
async function read(f) {
  const index = await buildDeepSeekIndex(f);
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sourceDiagnostics.totalCount, 0, JSON.stringify(index.sourceDiagnostics));
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  const session = await materializeSessionForIndex(index, indexed);
  assert.equal(indexed.rawEventCount, session.rawEvents.length);
  assert.equal(indexed.logicalEventCount, session.logicalEvents.length);
  assert.deepEqual(indexed.counts, session.counts);
  assert.equal(await projectQueryProjectionDigestAsync(session, deepSeekAdapter.query.projectQueryPresentation), indexed.queryProjectionDigest);
  return { index, indexed, session };
}

test('v4 highest generation wins over v0 without duplicate discovery; encoded physical references remain exact', async t => {
  const f = await fixture(t, [row('turn/start', 0, { turn: 1 }), user(1, 'native v4 prompt'), assistant(2, 'native answer'), row('turn/end', 3, { turn: 1, reason: { kind: 'completed' } })]);
  const legacy = { ...f.head, version: 0 }; delete legacy.isSeeded;
  await fsp.writeFile(path.join(f.directory, 'session.jsonl'), JSON.stringify(legacy) + '\n');
  const discovered = await discoverDeepSeekProjects(f);
  assert.equal(discovered[0].sessionCount, 1);
  const { index, session } = await read(f);
  assert.ok(session.sourceFile.endsWith('session.v4.jsonl'));
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.assistantMessages, 1);
  for (const [kind, english, chinese] of [
    ['user_message', 'User message', '用户消息'],
    ['assistant_message', 'Assistant message', '助手消息'],
  ]) {
    const message = session.logicalEvents.find(event => event.kind === kind);
    assert.equal(deepSeekAdapter.query.getEvent(index, session, message.id, { locale: 'en' }).label, english);
    assert.equal(deepSeekAdapter.query.getEvent(index, session, message.id, { locale: 'zh-CN' }).label, chinese);
  }
  const raw = session.rawEvents[2];
  const resolved = await readDeepSeekRawRecord(index, session, raw);
  assert.equal(JSON.parse(resolved.raw).type, 'user/message');
  assert.equal(raw.sourceLocator.recordOrdinal, 2);
  assert.equal(raw.sourceLocator.seq, 1);
});

for (const version of [1, 2, 3, 5]) {
  test(`unsupported generation ${version} reports a diagnostic instead of falling back`, async t => {
    const f = await fixture(t, []);
    await fsp.rm(f.file);
    const old = { ...f.head, version: 0 }; delete old.isSeeded;
    await fsp.writeFile(path.join(f.directory, 'session.jsonl'), JSON.stringify(old) + '\n');
    await fsp.writeFile(path.join(f.directory, `session.v${version}.jsonl`), JSON.stringify({ ...f.head, version }) + '\n');
    const index = await buildDeepSeekIndex(f);
    assert.equal(index.sessions.length, 0);
    assert.equal(index.sourceDiagnostics.counts.DEEPSEEK_FORMAT_VERSION_UNSUPPORTED, 1);
  });
}

test('v4 duplicate encoding and filename/header mismatch are visible exclusions', async t => {
  const f = await fixture(t, []);
  await fsp.writeFile(f.file + '.zstd', zstdCompressSync(Buffer.from(f.body)));
  let index = await buildDeepSeekIndex(f);
  assert.equal(index.sessions.length, 0);
  assert.equal(index.sourceDiagnostics.counts.DEEPSEEK_STORAGE_INVALID, 1);
  await fsp.rm(f.file + '.zstd');
  await fsp.writeFile(f.file, JSON.stringify({ ...f.head, version: 0 }) + '\n');
  index = await buildDeepSeekIndex(f);
  assert.equal(index.sessions.length, 0);
  assert.equal(index.sourceDiagnostics.counts.DEEPSEEK_STORAGE_INVALID, 1);
});

test('new selected generation invalidates materialization, detail and Raw readback', async t => {
  const f = await fixture(t, [user(0, 'snapshot')]);
  const { index, indexed, session } = await read(f);
  await fsp.writeFile(path.join(f.directory, 'session.v5.jsonl'), JSON.stringify({ ...f.head, version: 5 }) + '\n');
  await assert.rejects(materializeSessionForIndex(index, indexed), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(readDeepSeekRawRecord(index, session, session.rawEvents[1]), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(buildEventDetailForSession(index, session, session.logicalEvents[0].id, 'main'), { code: 'INDEXED_SOURCE_STALE' });
});

test('v4 attempts remain Protocol; interrupted messages and system/developer content retain native Raw ownership', async t => {
  const f = await fixture(t, [
    row('turn/start', 0, { turn: 1 }), row('step/start', 1, { turn: 1, step: 1 }),
    row('system/message', 2, { turn: 1, step: 1, message: { role: 'system', id: 's', source: { kind: 'system-prompt' }, content: text('system needle') } }, { surfaceOp: 'append' }),
    row('developer/message', 3, { turn: 1, step: 1, message: { role: 'developer', id: 'd', source: { kind: '@deepseek-ai/dsh-agent-instructions' }, content: text('developer needle') } }, { surfaceOp: 'append' }),
    row('assistant/attempt', 4, { turn: 1, step: 1, stream: [{ type: 'text-chunks', index: 0, time0: 1000, dt: [1], texts: ['discarded ', 'needle'] }] }),
    assistant(5, 'interrupted needle', { interrupted: true }),
    row('step/end', 6, { turn: 1, step: 1 }), row('turn/end', 7, { turn: 1, reason: { kind: 'aborted' } }),
  ]);
  const { session } = await read(f);
  assert.equal(session.counts.assistantMessages, 1);
  const attempt = session.logicalEvents.find(e => e.subtype === 'assistant/attempt');
  assert.equal(attempt.layer, 'protocol'); assert.match(attempt.searchText, /discarded needle/);
  assert.deepEqual(attempt.rawRefs.map(r => r.sourceLocator.seq), [4]);
  assert.equal(session.logicalEvents.find(e => e.kind === 'assistant_message').status, 'interrupted');
  for (const type of ['system/message', 'developer/message']) {
    const event = session.logicalEvents.find(e => e.subtype === type);
    assert.equal(event.layer, 'protocol'); assert.match(event.searchText, /needle/);
  }
});

test('v4 tool-role results preserve success, failure, pruning and compact source ranges', async t => {
  const replacement = result(5, 'read', 'short result', false, { surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [[3, 3]] });
  const f = await fixture(t, [
    row('turn/start', 0, { turn: 1 }), row('step/start', 1, { turn: 1, step: 1 }),
    call(2, 'read'), result(3, 'read', 'original result', false, { sourceEventSeqs: [[2, 2]] }),
    row('compaction/prune', 4, { shadowedRange: { start: 3, end: 3 }, shadowedSeqs: [3], shadowedTokenCount: 17 }), replacement,
    call(6, 'fail', 'bash'), result(7, 'fail', 'failure result', true, { sourceEventSeqs: [[6, 6]] }),
    row('step/end', 8, { turn: 1, step: 1 }), row('turn/end', 9, { turn: 1, reason: { kind: 'completed' } }),
  ]);
  const { index, session } = await read(f);
  const operation = session.logicalEvents.find(e => e.toolName === 'read');
  assert.equal(operation.status, 'success'); assert.match(operation.searchText, /original result/);
  assert.ok(operation.toolResultPrune);
  assert.equal(session.logicalEvents.find(e => e.toolName === 'bash').status, 'failed');
  const raw = session.rawEvents.find(r => r.seq0 === 5);
  const resolved = await readDeepSeekRawRecord(index, session, raw);
  assert.deepEqual(JSON.parse(resolved.raw), replacement);
});

test('v4 native PTC tags form nested operations with unchanged source identities', async t => {
  const dispatch = (type, seq, subCallId, parentCallId, name, extra = {}) => row(type, seq, { rootCallId: 'outer', parentCallId, subCallId, name, arguments: {}, ...extra });
  const f = await fixture(t, [
    row('turn/start', 0, { turn: 1 }), row('step/start', 1, { turn: 1, step: 1 }), call(2, 'outer', 'run_code'),
    dispatch('tool/ptc-dispatch-start', 3, 'nested', 'outer', 'run_code'),
    dispatch('tool/ptc-dispatch-start', 4, 'read', 'nested', 'read'),
    dispatch('tool/ptc-dispatch', 5, 'read', 'nested', 'read', { isError: false, content: text('nested needle') }),
    dispatch('tool/ptc-dispatch', 6, 'nested', 'outer', 'run_code', { isError: false, content: text('nested complete') }),
    result(7, 'outer', 'outer complete'), row('step/end', 8, { turn: 1, step: 1 }), row('turn/end', 9, { turn: 1, reason: { kind: 'completed' } }),
  ]);
  const { session } = await read(f);
  const outer = session.logicalEvents.find(e => e.kind === 'code_mode_operation');
  assert.equal(outer.codeModeOperation.dispatches.length, 2);
  assert.equal(outer.codeModeOperation.dispatches.find(d => d.subCallId === 'read').depth, 2);
  const nested = session.logicalEvents.find(e => e.toolName === 'read');
  assert.match(nested.searchText, /nested needle/);
  assert.deepEqual(nested.rawRefs.map(r => r.sourceEventType), ['tool/ptc-dispatch-start', 'tool/ptc-dispatch']);
  assert.ok(session.logicalEvents.indexOf(nested) < session.logicalEvents.findIndex(e => e.subtype === 'step/end'));
});

test('v4 last tagged inherited marker determines ownership, untagged resume markers do not', async t => {
  const f = await fixture(t, [
    user(0, 'parent'), row('session/end-seed', 1, { inherited: true }), user(2, 'older fork'),
    row('session/end-seed', 3, { inherited: true }), user(4, 'child'), row('session/end-seed', 5, {}), user(6, 'resumed child'),
  ], { isSeeded: true, parentSession: 'parent' });
  const { session } = await read(f);
  assert.equal(session.forkEvidence.seedLength, 3);
  assert.equal(session.counts.userMessages, 2);
  assert.equal(session.inheritedContext.mainEventCount, 2);
  assert.equal(session.rawEvents.find(r => r.seq0 === 2).forkSegment, 'inherited_context');
  assert.equal(session.rawEvents.find(r => r.seq0 === 4).forkSegment, 'continuation');
  const ordinary = await fixture(t, [row('session/end-seed', 0, {}), user(1, 'ordinary')]);
  assert.equal((await read(ordinary)).session.counts.userMessages, 1);
});

test('v4 seeded headers without matching markers and huge seq jumps fail before semantic projection', async t => {
  const missing = await fixture(t, [user(0, 'orphan')], { isSeeded: true });
  await assert.rejects(parseSessionArtifact(missing.file, 'session.v4.jsonl', missing.repoRoot), { code: 'DEEPSEEK_STORAGE_INVALID' });
  const huge = await fixture(t, [row('user/message', Number.MAX_SAFE_INTEGER, {}, { sourceEventSeqs: [[0, Number.MAX_SAFE_INTEGER - 1]] })]);
  await assert.rejects(parseSessionArtifact(huge.file, 'session.v4.jsonl', huge.repoRoot), { code: 'DEEPSEEK_STORAGE_INVALID' });
});

for (const started of [true, false]) {
  test(`v4 fork repair preserves child closure without claiming inherited tool execution (started=${started})`, async t => {
    const request = assistant(2, '');
    request.data.message.content = [{ type: 'tool-call', id: 'pending', name: 'read', arguments: '{}' }];
    const rows = [row('turn/start', 0, { turn: 1 }), row('step/start', 1, { turn: 1, step: 1 }), request];
    if (started) rows.push(call(rows.length, 'pending'));
    const boundary = rows.length;
    rows.push(row('session/end-seed', boundary, { inherited: true }));
    const closure = result(rows.length, 'pending', 'synthetic inherited closure needle', true);
    closure.data.error = started
      ? { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' }
      : { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' };
    if (started) closure.sourceEventSeqs = [3];
    rows.push(closure, row('step/end', rows.length + 1, { turn: 1, step: 1 }),
      row('turn/end', rows.length + 2, { turn: 1, reason: { kind: 'forked' } }));
    rows.push(row('turn/start', rows.length, { turn: 2 }));
    rows.push(user(rows.length, 'child continuation'));
    rows.push(row('turn/end', rows.length, { turn: 2, reason: { kind: 'completed' } }));
    const f = await fixture(t, rows, { isSeeded: true, parentSession: 'parent' });
    const { index, session } = await read(f);
    assert.deepEqual(session.analysis.toolUsage, []);
    assert.equal(session.counts.userMessages, 1);
    assert.equal(session.counts.turns, 1);
    const logical = session.logicalEvents.find(e => e.subtype === 'tool/result');
    assert.equal(logical.layer, 'protocol');
    assert.equal(logical.status, 'incomplete');
    assert.deepEqual(logical.rawRefs.map(ref => ref.sourceLocator.seq), [closure.seq]);
    assert.match(logical.searchText, /inherited closure needle/);
    const detail = await buildEventDetailForSession(index, session, logical.id, 'protocol');
    assert.match(JSON.stringify(detail.timelineSections), /inherited closure needle/);
    const raw = session.rawEvents.find(r => r.seq0 === closure.seq);
    assert.equal(raw.forkSegment, 'continuation');
    assert.deepEqual(JSON.parse((await readDeepSeekRawRecord(index, session, raw)).raw), closure);
  });
}

test('v4 crash recovery records unknown outcome as incomplete and never-started requests as Protocol', async t => {
  const unknown = result(1, 'started', 'unknown outcome', true);
  unknown.data.error = { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' };
  const notStarted = result(2, 'requested', 'not started', true);
  notStarted.data.error = { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' };
  const { session } = await read(await fixture(t, [call(0, 'started'), unknown, notStarted]));
  assert.equal(session.logicalEvents.find(e => e.toolName === 'read').status, 'incomplete');
  assert.equal(session.logicalEvents.find(e => e.subtype === 'tool/result').layer, 'protocol');
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'read', count: 1 }]);
});

test('v4 terminal request failure is visible without assigning failure to uncommitted attempts', async t => {
  const f = await fixture(t, [row('turn/start', 0, { turn: 1 }),
    row('assistant/attempt', 1, { turn: 1, step: 1, stream: [] }),
    row('turn/end', 2, { turn: 1, reason: { kind: 'error', error: { message: 'synthetic provider unavailable', code: 'SERVER', status: 503 } } }),
  ]);
  const { index, session } = await read(f);
  const ending = session.logicalEvents.find(e => e.subtype === 'turn/end');
  assert.equal(ending.layer, 'protocol');
  assert.equal(ending.status, 'failed');
  assert.equal(ending.severity, 'error');
  assert.equal(session.counts.issueEvents, 1);
  assert.equal(session.counts.assistantMessages, 0);
  assert.equal(session.logicalEvents.find(e => e.subtype === 'assistant/attempt').status, '');
  assert.deepEqual(ending.rawRefs.map(ref => ref.sourceLocator.seq), [2]);
  const detail = await buildEventDetailForSession(index, session, ending.id, 'protocol');
  assert.match(JSON.stringify(detail.timelineSections), /synthetic provider unavailable/);
  assert.match(JSON.stringify(detail.inspectorSections), /SERVER/);
});

test('v4 approval, command and plan pairing remains source-bound', async t => {
  const f = await fixture(t, [
    row('turn/start', 0, { turn: 1 }), row('step/start', 1, { turn: 1, step: 1 }), call(2, 'call'),
    row('approval/asked', 3, { id: 'a', toolName: 'read', callId: 'call', reason: 'synthetic' }),
    row('approval/decided', 4, { id: 'a', outcome: 'allowed-once' }), result(5, 'call', 'approved'),
    row('command/run', 6, { commandId: 'c', name: 'plan', args: '', source: { kind: 'user' } }),
    row('plan/mode', 7, { active: true }), row('command/done', 8, { commandId: 'c', kind: 'success', text: 'Plan enabled' }),
    row('step/end', 9, { turn: 1, step: 1 }), row('turn/end', 10, { turn: 1, reason: { kind: 'completed' } }),
  ]);
  const { session } = await read(f);
  const approval = session.logicalEvents.find(e => e.subtype === 'approval/lifecycle');
  assert.ok(approval.approvalLifecycle.toolRef);
  assert.ok(session.logicalEvents.indexOf(approval) < session.logicalEvents.findIndex(e => e.subtype === 'turn/end'));
  assert.equal(session.logicalEvents.filter(e => e.subtype === 'command/lifecycle').length, 1);
  assert.equal(session.logicalEvents.find(e => e.subtype === 'plan/mode').planModeState.active, true);
});

test('v4 native PowerShell calls preserve command semantics and readable requests', async t => {
  const direct = call(0, 'direct', 'pwsh');
  direct.data.arguments = JSON.stringify({ command: "Write-Output 'native marker'", description: 'Synthetic print' });
  const pending = call(2, 'pending', 'pwsh');
  pending.data.arguments = JSON.stringify({ command: "Write-Output 'pending marker'", description: 'Unfinished print' });
  const f = await fixture(t, [direct, result(1, 'direct', 'synthetic failure', true), pending]);
  const { index, session } = await read(f);
  const operation = session.logicalEvents.find(e => e.status === 'failed');
  assert.equal(operation.kind, 'command');
  assert.equal(operation.preview, "Write-Output 'native marker'");
  assert.equal(session.counts.failedCommands, 1);
  assert.equal(session.logicalEvents.find(e => e.status === 'incomplete').kind, 'command');
  const detail = await buildEventDetailForSession(index, session, operation.id, 'main');
  assert.ok(detail.timelineSections.some(section => section.type === 'code'
    && section.language === 'powershell' && section.code === "Write-Output 'native marker'"));
});

test('v4 PowerShell PTC dispatch is a command with its own Raw ownership', async t => {
  const args = { command: "Write-Output 'nested marker'", description: 'Nested print' };
  const dispatch = { rootCallId: 'outer', parentCallId: 'outer', subCallId: 'print', name: 'pwsh', arguments: args };
  const f = await fixture(t, [call(0, 'outer', 'run_code'),
    row('tool/ptc-dispatch-start', 1, dispatch),
    row('tool/ptc-dispatch', 2, { ...dispatch, content: text('nested marker'), isError: false }),
    result(3, 'outer', 'done')]);
  const { session } = await read(f);
  const nested = session.logicalEvents.find(e => e.toolName === 'pwsh');
  assert.equal(nested.kind, 'command');
  assert.deepEqual(nested.rawRefs.map(ref => ref.sourceLocator.seq), [1, 2]);
});

test('v4 compaction uses native replacement bounds and exact source references without replacing human history', async t => {
  for (const matching of [true, false]) {
    const rows = [
      user(0, 'human history'), row('compaction/start', 1, { compactionId: 'c', turn: 1 }),
      row('compaction/summary', 2, { compactionId: 'c', summary: text('summary needle'), shadowedRange: { start: 0, end: 0 }, shadowedSeqs: [0], shadowedTokenCount: 10 }),
      row('user/message', 3, { id: 'checkpoint', role: 'user', source: { kind: 'compact-checkpoint', compactionId: 'c' }, content: text('checkpoint') }, {
        surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 }, sourceEventSeqs: matching ? [[0, 2]] : [0],
      }), row('compaction/end', 4, { compactionId: 'c' }),
    ];
    const f = await fixture(t, rows);
    const { session } = await read(f);
    assert.equal(session.counts.userMessages, 1);
    assert.equal(session.logicalEvents.find(e => e.kind === 'compaction').status, matching ? 'success' : 'incomplete');
    assert.equal(session.logicalEvents.filter(e => e.subtype === 'user/message').length, matching ? 0 : 1);
  }
});

for (const version of [0, 4]) {
  test(`format ${version} repeated compaction follows surface order even when seq endpoints descend`, async t => {
    const summary = (seq, id, start, end, shadowedSeqs) => row('compaction/summary', seq, {
      compactionId: id, summary: text('synthetic summary ' + id),
      shadowedRange: { start, end }, shadowedSeqs, shadowedTokenCount: 10,
    });
    const replacement = (seq, id, start, end, refs) => row('user/message', seq, {
      id, role: 'user', content: text('checkpoint ' + id),
      source: version === 4 ? { kind: 'compact-checkpoint', compactionId: id } : { kind: 'plugin', plugin: 'compact' },
    }, { surfaceOp: version === 4 ? { op: 'replace', startSeq: start, endSeq: end } : { op: 'replace', start, end }, sourceEventSeqs: refs });
    // First replacement changes surface [0, 1, 2] to [5, 2]. Its next
    // replacement is forward in surface order, despite numeric 5 > 2.
    const rows = [user(0, 'first'), user(1, 'second'), user(2, 'third'),
      row('compaction/start', 3, { compactionId: 'one' }), summary(4, 'one', 0, 1, [0, 1]),
      replacement(5, 'one', 0, 1, [0, 1, 3, 4]), row('compaction/end', 6, { compactionId: 'one' }),
      row('compaction/start', 7, { compactionId: 'two' }), summary(8, 'two', 5, 2, [5, 2]),
      replacement(9, 'two', 5, 2, [2, 5, 7, 8]), row('compaction/end', 10, { compactionId: 'two' })];
    const f = await fixture(t, rows);
    if (version === 0) {
      const header = { ...f.head, version: 0 }; delete header.isSeeded;
      await fsp.rm(f.file);
      f.file = path.join(f.directory, 'session.jsonl');
      await fsp.writeFile(f.file, [header, ...rows].map(JSON.stringify).join('\n') + '\n');
    }
    const { index, session } = await read(f);
    const compactions = session.logicalEvents.filter(e => e.kind === 'compaction');
    assert.deepEqual(compactions.map(e => e.status), ['success', 'success']);
    assert.deepEqual(compactions[1].rawRefs.map(r => r.sourceLocator.seq), [7, 8, 9, 10]);
    assert.equal(session.counts.userMessages, 3);
    assert.equal(session.logicalEvents.filter(e => e.subtype === 'user/message').length, 0);
    const raw = session.rawEvents.find(r => r.seq0 === 9);
    assert.deepEqual(JSON.parse((await readDeepSeekRawRecord(index, session, raw)).raw), rows[9]);
  });
}

test('ignorable retired PTC tags stay Protocol and invalid v4 replacement bounds fail closed', async t => {
  const f = await fixture(t, [call(0, 'outer', 'run_code'), row('tool/code-dispatch', 1, { rootCallId: 'outer', parentCallId: 'outer', subCallId: 'old', name: 'read', arguments: {}, content: text('old') }, { ignorable: true }), result(2, 'outer', 'done')]);
  const { session } = await read(f);
  const retired = session.logicalEvents.find(e => e.subtype === 'tool/code-dispatch');
  assert.equal(retired.layer, 'protocol');
  assert.equal(session.logicalEvents.find(e => e.kind === 'code_mode_operation').codeModeOperation.dispatches?.length || 0, 0);
  const invalid = await fixture(t, [user(0, 'old'), row('user/message', 1, { id: 'new', role: 'user', source: { kind: 'user' }, content: text('new') }, { surfaceOp: { op: 'replace', start: 0, end: 0 } })]);
  await assert.rejects(parseSessionArtifact(invalid.file, 'session.v4.jsonl', invalid.repoRoot), { code: 'DEEPSEEK_STORAGE_INVALID' });
});
