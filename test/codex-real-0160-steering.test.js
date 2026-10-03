'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

// Minimized synthetic counterpart of the authorized 2026-10-03 CLI probe.
// The real trace used four completed JS exec wrappers to launch/poll one
// native process. User input persisted after process completion in the same
// turn. Neither keystroke timing nor instant_interrupt activation is asserted.
const ID = 'cccccccc-0160-4160-8160-cccccccccccc';
const TURN = 'same-turn';
const record = (type, payload) => ({ type, payload });
const event = (type, fields = {}) => record('event_msg', { type, ...fields });
const response = (type, fields = {}) => record('response_item', { type, ...fields });
const typed = (item) => event('item_completed', { thread_id: ID, turn_id: TURN, item });
const message = (id, role, text) => [
  response('message', { id, role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] }),
  typed({ type: role === 'user' ? 'UserMessage' : 'AgentMessage', id: role === 'user' ? `${id}-typed` : id,
    content: [{ type: role === 'user' ? 'text' : 'Text', text }] }),
];
const call = (id, input) => response('custom_tool_call', { name: 'exec', call_id: id, input });
const output = (id, result) => response('custom_tool_call_output', { call_id: id, output: [
  { type: 'input_text', text: 'Script completed\nWall time 1 seconds\nOutput:\n' },
  { type: 'input_text', text: JSON.stringify(result) },
] });

test('observed completed JS wrappers do not imply the background process finished or was interrupted', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-real-steering-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', `rollout-${ID}.jsonl`);
  const prefix = [
    record('session_meta', { id: ID, cwd: repoRoot, cli_version: '0.160.0', history_mode: 'paginated' }),
    event('task_started', { turn_id: TURN }),
    ...message('request', 'user', 'Run the synthetic progress probe.'),
    call('launch-js', 'text(await tools.exec_command({cmd:"synthetic-command",yield_time_ms:1000}));'),
    output('launch-js', { session_id: 123, output: 'PROCESS_STARTED\nPROGRESS_5\n' }),
  ];
  const stamp = (r, ordinal) => ({ ordinal, timestamp: new Date(Date.parse('2026-10-03T01:00:00Z') + ordinal * 1000).toISOString(), ...r });
  const rows = prefix.map(stamp);
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const options = { repoRoot, codexHome: home };
  const initial = await codex.buildSourceBackedIndex(options);
  const early = await materializeSessionForIndex(initial, initial.sessionsById.get(ID));
  const earlyOuter = early.logicalEvents.find((e) => e.kind === 'code_mode_operation');
  assert.equal(earlyOuter.codeModeOperation.observationState, 'terminal', 'only the JS wrapper completed');
  assert.equal(early.logicalEvents.filter((e) => e.kind === 'command').length, 0, 'no process terminal fact has been observed');
  assert.equal(early.counts.failedCommands, 0);
  assert.equal(early.counts.aborts, 0);

  const tail = [
    call('poll-1', 'text(await tools.write_stdin({session_id:123,chars:"",yield_time_ms:1000}));'),
    output('poll-1', { session_id: 123, output: 'PROGRESS_10\nPROGRESS_15\n' }),
    call('poll-2', 'text(await tools.write_stdin({session_id:123,chars:"",yield_time_ms:1000}));'),
    output('poll-2', { session_id: 123, output: 'PROGRESS_20\nPROGRESS_25\n' }),
    call('poll-3', 'text(await tools.write_stdin({session_id:123,chars:"",yield_time_ms:1000}));'),
    typed({ type: 'CommandExecution', id: 'native-process-call', command: ['synthetic-command'], cwd: repoRoot,
      parsed_cmd: [], source: 'agent', process_id: '123', status: 'completed', exit_code: 0,
      stdout: 'PROCESS_STARTED\nPROGRESS_5\nPROGRESS_10\nPROGRESS_15\nPROGRESS_20\nPROGRESS_25\nPROCESS_FINISHED\n',
      stderr: '', duration: { secs: 30, nanos: 0 } }),
    output('poll-3', { exit_code: 0, output: 'PROCESS_FINISHED\n' }),
    ...message('followup', 'user', 'Stop waiting and reply SYNTHETIC_STEER.'),
    ...message('answer', 'assistant', 'SYNTHETIC_STEER'),
    event('task_complete', { turn_id: TURN }),
  ].map((r, index) => stamp(r, rows.length + index));
  rows.push(...tail);
  await fs.appendFile(file, tail.map(JSON.stringify).join('\n') + '\n');

  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build({ ...options, ...(build === codex.buildSourceBackedIndex ? { previousIndex: initial } : {}) });
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
    assert.equal(session.counts.turns, 1);
    assert.equal(session.counts.userMessages, 2);
    assert.equal(session.counts.assistantMessages, 1);
    assert.equal(session.counts.aborts, 0);
    assert.equal(session.counts.failedCommands, 0);
    assert.equal(session.counts.toolCalls, 5, 'four JS invocations and one recorded command');
    const outers = session.logicalEvents.filter((e) => e.kind === 'code_mode_operation');
    assert.equal(outers.length, 4);
    assert.ok(outers.every((e) => e.codeModeOperation.phases.length === 1 && e.codeModeOperation.observationState === 'terminal'));
    const commands = session.logicalEvents.filter((e) => e.kind === 'command');
    assert.equal(commands.length, 1);
    const command = commands[0];
    assert.equal(command.status, 'success');
    assert.deepEqual(command.outputStats, { exitCode: 0, durationMs: 30000 });
    const detail = await codex.buildHydratedEventDetail(index, session, command.id, 'main');
    assert.match(JSON.stringify(detail.timelineSections), /PROCESS_STARTED/);
    assert.match(JSON.stringify(detail.timelineSections), /PROCESS_FINISHED/);
    assert.ok(codex.query.getTimeline(index, session, { layer: 'main', q: 'PROCESS_STARTED' }).events.some((e) => e.id === command.id));
    const ref = command.rawRefs[0];
    assert.equal(ref.sourceEventType, 'item_completed');
    assert.deepEqual((await codex.readRawLine(index, ref.file, ref.line)).parsed, rows[ref.line - 1]);
  }
});

test('manual turn interruption preserves a later successful native command without reopening or nesting the turn', async (t) => {
  // Synthetic replacement of the second real probe: Esc aborts the outer
  // invocation, but a typed native command completion persists 24 seconds later.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-real-stop-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', `rollout-${ID}.jsonl`);
  const stamp = (r, ordinal) => ({ ordinal,
    timestamp: new Date(Date.parse('2026-10-03T02:00:00Z') + ordinal * 1000).toISOString(), ...r });
  const rows = [
    record('session_meta', { id: ID, cwd: repoRoot, cli_version: '0.160.0', history_mode: 'paginated' }),
    event('task_started', { turn_id: TURN }),
    ...message('request', 'user', 'Run the synthetic progress probe.'),
    call('interrupted-js', 'text(await tools.exec_command({cmd:"synthetic-command",yield_time_ms:10000}));'),
    response('custom_tool_call_output', { call_id: 'interrupted-js', output: 'aborted by user after 6.8s' }),
    event('turn_aborted', { turn_id: TURN, reason: 'interrupted' }),
  ].map(stamp);
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const options = { repoRoot, codexHome: home };
  const builds = [codex.buildIndex, codex.buildSourceBackedIndex];
  const previous = new Map();
  for (const build of builds) {
    const index = await build(options);
    previous.set(build, index);
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
    assert.equal(session.counts.aborts, 1);
    assert.equal(session.counts.failedCommands, 0);
    assert.equal(session.logicalEvents.filter((e) => e.kind === 'command').length, 0,
      'turn interruption alone supplies no native process outcome');
  }
  const late = { ...stamp(typed({ type: 'CommandExecution', id: 'late-native-call',
    command: ['synthetic-command'], cwd: repoRoot, parsed_cmd: [], source: 'agent',
    status: 'completed', exit_code: 0, duration: { secs: 30, nanos: 325544900 },
    stdout: 'PROCESS_STARTED\nPROGRESS_5\nPROGRESS_30\nPROCESS_FINISHED\n', stderr: '',
  }), rows.length), timestamp: '2026-10-03T02:00:30.000Z' };
  rows.push(late);
  await fs.appendFile(file, JSON.stringify(late) + '\n');

  for (const build of builds) {
    const appended = await build({ ...options, previousIndex: previous.get(build) });
    const warm = await build({ ...options, previousIndex: appended });
    for (const index of [appended, warm]) {
      const session = build === codex.buildSourceBackedIndex
        ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
      assert.equal(session.counts.turns, 1);
      assert.equal(session.counts.userMessages, 1);
      assert.equal(session.counts.aborts, 1);
      assert.equal(session.counts.failedCommands, 0);
      assert.equal(session.counts.toolCalls, 2);
      const commands = session.logicalEvents.filter((e) => e.kind === 'command');
      assert.equal(commands.length, 1);
      const command = commands[0];
      assert.equal(command.status, 'success');
      assert.deepEqual(command.outputStats, { exitCode: 0, durationMs: 30326 });
      const operation = session.logicalEvents.find((e) => e.kind === 'code_mode_operation');
      assert.deepEqual(operation.codeModeOperation.eventRefs, [], 'late completion cannot prove nested ownership');
      assert.equal(Object.hasOwn(codex.getEvent(index, session, command.id, { layer: 'main' }), 'presentationContext'), false);
      const outerDetail = await codex.buildHydratedEventDetail(index, session, operation.id, 'main');
      assert.match(JSON.stringify(outerDetail), /aborted by user after 6\.8s/);
      const detail = await codex.buildHydratedEventDetail(index, session, command.id, 'main');
      assert.match(JSON.stringify(detail.timelineSections), /PROCESS_STARTED/);
      assert.match(JSON.stringify(detail.timelineSections), /PROCESS_FINISHED/);
      assert.ok(codex.query.getTimeline(index, session, { layer: 'main', q: 'PROCESS_FINISHED' })
        .events.some((e) => e.id === command.id));
      for (const ref of [...command.rawRefs, ...operation.rawRefs]) {
        assert.deepEqual((await codex.readRawLine(index, ref.file, ref.line)).parsed, rows[ref.line - 1]);
      }
    }
  }
});

test('same-turn steering between a partial poll and native completion does not invent interruption or another poll', async (t) => {
  // Third real probe, replaced with synthetic identities and content. Input
  // persists after the last partial poll, before native completion; the final
  // assistant reply follows completion without any additional tool invocation.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-real-midprocess-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', `rollout-${ID}.jsonl`);
  const stamp = (r, ordinal) => ({ ordinal,
    timestamp: new Date(Date.parse('2026-10-03T03:00:00Z') + ordinal * 1000).toISOString(), ...r });
  const rows = [
    record('session_meta', { id: ID, cwd: repoRoot, cli_version: '0.160.0', history_mode: 'paginated' }),
    event('task_started', { turn_id: TURN }),
    ...message('request', 'user', 'Run the synthetic progress probe.'),
    call('launch-js', 'text(await tools.exec_command({cmd:"synthetic-command",yield_time_ms:10000}));'),
    output('launch-js', { session_id: 123, output: 'PROCESS_STARTED\nPROGRESS_5\n' }),
    call('poll-1', 'text(await tools.write_stdin({session_id:123,chars:"",yield_time_ms:1000}));'),
    output('poll-1', { session_id: 123, output: 'PROGRESS_10\nPROGRESS_15\n' }),
    call('poll-2', 'text(await tools.write_stdin({session_id:123,chars:"",yield_time_ms:1000}));'),
    output('poll-2', { session_id: 123, output: 'PROGRESS_20\nPROGRESS_25\n' }),
    ...message('steer', 'user', 'Stop waiting and reply SYNTHETIC_STEER.'),
  ].map(stamp);
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const options = { repoRoot, codexHome: home };
  const initial = await codex.buildSourceBackedIndex(options);
  const early = await materializeSessionForIndex(initial, initial.sessionsById.get(ID));
  assert.equal(early.counts.turns, 1);
  assert.equal(early.counts.userMessages, 2);
  assert.equal(early.counts.aborts, 0);
  assert.equal(early.logicalEvents.filter((e) => e.kind === 'command').length, 0);
  const tail = [
    typed({ type: 'CommandExecution', id: 'native-call', command: ['synthetic-command'], cwd: repoRoot,
      parsed_cmd: [], source: 'agent', status: 'completed', exit_code: 0,
      duration: { secs: 30, nanos: 337226600 }, stdout: 'PROCESS_STARTED\nPROGRESS_25\nPROCESS_FINISHED\n', stderr: '' }),
    ...message('reply', 'assistant', 'SYNTHETIC_STEER'),
    event('task_complete', { turn_id: TURN }),
  ].map((r, i) => stamp(r, rows.length + i));
  rows.push(...tail);
  await fs.appendFile(file, tail.map(JSON.stringify).join('\n') + '\n');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build({ ...options, ...(build === codex.buildSourceBackedIndex ? { previousIndex: initial } : {}) });
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(ID)) : index.sessionsById.get(ID);
    assert.equal(session.counts.turns, 1);
    assert.equal(session.counts.userMessages, 2);
    assert.equal(session.counts.assistantMessages, 1);
    assert.equal(session.counts.aborts, 0);
    assert.equal(session.counts.failedCommands, 0);
    assert.equal(session.counts.toolCalls, 4);
    const operations = session.logicalEvents.filter((e) => e.kind === 'code_mode_operation');
    assert.equal(operations.length, 3, 'no invented final polling invocation');
    assert.ok(operations.every((e) => e.codeModeOperation.observationState === 'terminal'));
    assert.ok(operations.every((e) => e.codeModeOperation.eventRefs.length === 0));
    const commands = session.logicalEvents.filter((e) => e.kind === 'command');
    assert.equal(commands.length, 1);
    const command = commands[0];
    assert.equal(command.status, 'success');
    assert.deepEqual(command.outputStats, { exitCode: 0, durationMs: 30337 });
    const detail = await codex.buildHydratedEventDetail(index, session, command.id, 'main');
    assert.match(JSON.stringify(detail.timelineSections), /PROCESS_FINISHED/);
    assert.ok(codex.query.getTimeline(index, session, { layer: 'main', q: 'PROCESS_FINISHED' })
      .events.some((e) => e.id === command.id));
    for (const ref of command.rawRefs) {
      assert.deepEqual((await codex.readRawLine(index, ref.file, ref.line)).parsed, rows[ref.line - 1]);
    }
  }
});
