'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { workbuddyAdapter, buildWorkbuddyIndex, discoverWorkbuddyProjects, parseWorkbuddySessionArtifact } = require('../src/workbuddy');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore, projectQueryProjectionDigestAsync } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');
const timestamp = 1793400000000;
function record(type, id, parentId, fields = {}) { return { type, id, ...(parentId ? { parentId } : {}), timestamp, ...fields }; }
function user(id = 'u', text = 'USER_MARKER') { return record('message', id, '', { role: 'user', content: [{ type: 'input_text', text }] }); }
function call(name = 'Bash', args = { command: 'printf TOOL_INPUT_MARKER', timeout: 15 }, fields = {}) { return record('function_call', 'c', 'u', { name, callId: 'call1', arguments: JSON.stringify(args), ...fields }); }
function result(name = 'Bash', fields = {}) { return record('function_call_result', 'r', 'c', { name, callId: 'call1', status: 'completed', output: { type: 'text', text: 'TOOL_OUTPUT_MARKER' }, ...fields }); }
function assistant() { return record('message', 'a', 'r', { role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ASSISTANT_MARKER' }] }); }
async function fixture(t, rows = [user(), call(), result(), assistant()]) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-workbuddy-'));
  t.after(() => fs.rm(sourceHome, { recursive: true, force: true }));
  const repoRoot = path.join(sourceHome, 'actual-repo');
  await fs.mkdir(repoRoot); const dir = path.join(sourceHome, 'projects', 'container-name-does-not-identify-project'); await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'native-session.jsonl'); const sourceFile = path.relative(path.join(sourceHome, 'projects'), file);
  const text = rows.map((row) => typeof row === 'string' ? row : JSON.stringify({ sessionId: 'native-session', cwd: repoRoot, ...row })).join('\n') + '\n';
  await fs.writeFile(file, text); return { sourceHome, repoRoot, file, sourceFile, text };
}
async function indexed(t, f) { const index = await buildWorkbuddyIndex(f); t.after(() => disposeProjectQueryStore(index.projectQueryStore)); await validateIndexOwnershipForCommit(index); return index; }
async function materialized(t, f) { const index = await indexed(t, f); assert.equal(index.sessions.length, 1); return { index, session: await materializeSessionForIndex(index, index.sessions[0]) }; }

test('native catalog discovers recorded cwd, includes owned subagents and never changes source', async (t) => {
  const f = await fixture(t); const subdir = path.join(path.dirname(f.file), 'native-session', 'subagents'); await fs.mkdir(subdir, { recursive: true });
  await fs.writeFile(path.join(subdir, 'agent-private.jsonl'), f.text);
  const projects = await discoverWorkbuddyProjects(f); assert.equal(projects.length, 1); assert.equal(projects[0].repoRoot, f.repoRoot); assert.equal(projects[0].sessionCount, 2);
  assert.equal(workbuddyAdapter.sessionLifecycle, 'indexed-materialized-v1');
  const index = await indexed(t, f); assert.equal(index.sessions.length, 2);
  const parent = index.sessions.find((item) => !item.parentSessionId);
  const child = index.sessions.find((item) => item.parentSessionId);
  assert.equal(child.primarySessionMetaKind, 'subagent'); assert.equal(child.parentSessionId, parent.id);
  const session = await materializeSessionForIndex(index, parent);
  assert.equal(Object.hasOwn(index.sessions[0], 'logicalEvents'), false);
  assert.equal(await projectQueryProjectionDigestAsync(session, workbuddyAdapter.query.projectQueryPresentation), parent.queryProjectionDigest);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('messages, readable rawContent reasoning, exact tools, detail and raw preserve native identity', async (t) => {
  const f = await fixture(t, [user(), record('reasoning', 'thinking', 'u', { content: [], rawContent: [{ type: 'reasoning_text', text: 'REASONING_MARKER' }] }), call(), result(), assistant()]);
  const { index, session } = await materialized(t, f);
  assert.equal(session.counts.messages, 2); assert.equal(session.counts.reasoning, 1); assert.equal(session.counts.toolCalls, 1);
  const command = session.logicalEvents.find((event) => event.kind === 'command'); assert.equal(command.status, 'success'); assert.equal(command.role, 'assistant'); assert.equal(command.rawRefs.length, 2);
  const detail = await buildEventDetailForSession(index, session, command.id, 'main'); const shown = JSON.stringify(detail);
  assert.match(shown, /TOOL_INPUT_MARKER/); assert.match(shown, /TOOL_OUTPUT_MARKER/); assert.match(shown, /timeout/);
  for (const ref of command.rawRefs) { const raw = await readIndexedRawRecord(index, session, ref.rawId); assert.equal(raw.sourceKind, 'workbuddy'); assert.equal(raw.raw, f.text.split('\n')[ref.line - 1]); }
  assert.match(session.logicalEvents.find((event) => event.kind === 'reasoning').searchText, /REASONING_MARKER/);
});

test('duplicate shared response IDs retain rows; call ambiguity and wrong parents fail closed', async (t) => {
  for (const variant of [
    [user(), call('Read', { file_path: 'a.txt' }, { id: 'shared' }), record('message', 'shared', 'u', { role: 'assistant', content: [{ type: 'output_text', text: 'response shared id' }] }), result('Read', { parentId: 'shared' })],
    [user(), call(), call('Bash', { command: 'duplicate' }, { id: 'c2' }), result()],
    [user(), call(), result('Bash', { parentId: 'wrong' })],
    [user(), call(), result('Read')],
    [user(), call(), result(), result('Bash', { id: 'r2' })],
  ]) {
    const f = await fixture(t, variant); const { session } = await materialized(t, f);
    assert.equal(session.rawEventCount, variant.length);
    const tools = session.logicalEvents.filter((event) => event.toolName);
    if (variant[1].id === 'shared') { assert.equal(tools[0].status, 'success'); assert.ok(session.logicalEvents.some((event) => event.kind === 'assistant_message')); }
    else { assert.ok(tools.every((event) => event.status === 'incomplete')); assert.ok(session.logicalEvents.some((event) => event.subtype === 'workbuddy_unpaired_tool_result')); }
  }
});

test('completed delivery is not success when native error or shell exit reports failure', async (t) => {
  for (const toolResult of [{ error: 'Permission denied' }, { rawResponse: { exitCode: 3 } }, { rawResponse: { exitCode: 0, interrupted: true } }]) {
    const f = await fixture(t, [user(), call(), result('Bash', { providerData: { toolResult } })]);
    const { session } = await materialized(t, f); const command = session.logicalEvents.find((event) => event.kind === 'command');
    assert.equal(command.status, toolResult.rawResponse?.interrupted ? 'incomplete' : 'failed');
    if (toolResult.rawResponse?.exitCode === 3) assert.equal(command.outputStats.exitCode, 3);
  }
});

test('read/write/edit, task and coordination requests remain readable without loading referenced files', async (t) => {
  const cases = [['Read', { file_path: '/nonexistent/file', offset: 2, limit: 3 }, 'read'], ['Write', { file_path: 'new.txt', content: 'NEW_TEXT' }, 'write'], ['Edit', { file_path: 'a.txt', old_string: 'OLD_TEXT', new_string: 'NEW_TEXT' }, 'edit'], ['TaskCreate', { subject: 'TASK_MARKER', description: 'desc' }, 'plan'], ['SendMessage', { recipient: 'peer', content: 'HELLO_PEER' }, 'coordination']];
  for (const [name, args, activity] of cases) {
    const f = await fixture(t, [user(), call(name, args), result(name, { output: '<persisted-output>/do/not/load/external.txt</persisted-output>' })]);
    const { index, session } = await materialized(t, f); const tool = session.logicalEvents.find((event) => event.toolName);
    assert.equal(tool.workbuddy.activity, activity); const detail = await buildEventDetailForSession(index, session, tool.id, 'main');
    assert.match(JSON.stringify(detail), /persisted-output/); assert.match(JSON.stringify(detail), new RegExp(Object.keys(args)[0]));
    assert.equal(tool.kind, 'other_tool_call');
  }
});

test('unknown, metadata, bad shapes and malformed bytes retain Protocol and exact Raw fallback', async (t) => {
  const malformed = '{"type":"message","content":"NOT_SEARCHABLE_BROKEN"';
  const f = await fixture(t, [user(), { type: 'session-meta', timestamp, contextWindow: { id: 'window' } }, { type: 'file-history-snapshot', timestamp, snapshot: { messageId: 'u', trackedFileBackups: {} } }, { type: 'future-native-kind', detail: 'FUTURE_EVIDENCE' }, record('message', 'bad', '', { parentId: {}, role: 'assistant', content: [{ type: 'output_text', text: 'BAD_SHAPE' }] }), malformed]);
  const { index, session } = await materialized(t, f);
  assert.equal(session.counts.messages, 1); assert.ok(session.logicalEvents.some((event) => event.subtype === 'future-native-kind'));
  const raw = session.rawEvents.find((event) => event.parseError); assert.doesNotMatch(raw.searchText, /NOT_SEARCHABLE_BROKEN/);
  assert.equal((await readIndexedRawRecord(index, session, raw.rawId)).raw, malformed);
});

test('accepted prefixes survive append and reject same-length rewrite, truncation and replacement', async (t) => {
  const f = await fixture(t); const { index, session } = await materialized(t, f); const raw = session.rawEvents[0];
  await fs.appendFile(f.file, JSON.stringify({ type: 'future', detail: 'new tail' }) + '\n');
  assert.equal((await readIndexedRawRecord(index, session, raw.rawId)).raw, f.text.split('\n')[0]);
  await fs.writeFile(f.file, f.text.replace('USER_MARKER', 'EVIL_MARKER'));
  await assert.rejects(readIndexedRawRecord(index, session, raw.rawId), { code: 'INDEXED_SOURCE_STALE' });
  await fs.writeFile(f.file, f.text.slice(0, 10));
  await assert.rejects(readIndexedRawRecord(index, session, raw.rawId), { code: 'INDEXED_SOURCE_STALE' });
  // Keep the old inode allocated: unlink followed by immediate recreation can
  // reuse it on Linux, which does not establish a distinct file replacement.
  await fs.rename(f.file, `${f.file}.previous`); await fs.writeFile(f.file, f.text);
  await assert.rejects(readIndexedRawRecord(index, session, raw.rawId), { code: 'INDEXED_SOURCE_STALE' });
});

test('torn tail is excluded, invalid native identity diagnosed and symlink artifacts ignored', async (t) => {
  const f = await fixture(t); await fs.appendFile(f.file, '{"type":"message"}'); const diagnostics = [];
  const index = await indexed(t, { ...f, onDiagnostic: (d) => diagnostics.push(d) }); assert.equal(index.sessions[0].lineCount, 4); assert.ok(diagnostics.some((d) => d.code === 'WORKBUDDY_TORN_TAIL'));
  await fs.writeFile(f.file, JSON.stringify({ type: 'unproven-envelope', sessionId: 'native-session', cwd: f.repoRoot }) + '\n'); const invalid = await indexed(t, { ...f, onDiagnostic: (d) => diagnostics.push(d) });
  assert.equal(invalid.sessions.length, 0); assert.ok(diagnostics.some((d) => d.code === 'WORKBUDDY_TRANSCRIPT_INVALID'));
  await fs.unlink(f.file); await fs.symlink(path.join(f.sourceHome, 'missing'), f.file); assert.equal((await indexed(t, f)).sessions.length, 0);
});

test('archival fork markers, native summaries, goals, titles, usage and model remain visible', async (t) => {
  const f = await fixture(t, [user(), record('resend-fork-notice', 'fork', '', { editedUserItemId: 'u' }), record('message', 'sum', 'u', { role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'COMPACT_SUMMARY' }], providerData: { agent: 'compact', isSummary: true, isCompacted: true, model: 'synthetic-model', usage: { inputTokens: 42, outputTokens: 7 } } }), { type: 'goal-result', condition: 'GOAL_EVIDENCE', ok: true, durationMs: 2, turnCount: 1, tokenDelta: 4 }, { type: 'ai-title', aiTitle: 'Generated title' }, { type: 'custom-title', customTitle: 'Named synthetic session' }]);
  const { index, session } = await materialized(t, f); assert.equal(session.title, 'Named synthetic session'); assert.equal(session.counts.compactions, 1);
  assert.ok(session.logicalEvents.some((e) => e.subtype === 'workbuddy_recorded_history' && e.preview.includes('earlier resend/rewind branches')));
  assert.ok(session.logicalEvents.some((e) => e.kind === 'goal')); const usage = session.logicalEvents.find((e) => e.subtype === 'workbuddy_usage');
  assert.match(JSON.stringify(await buildEventDetailForSession(index, session, usage.id, 'protocol')), /synthetic-model|inputTokens/);
});

test('history query reaches native request/result and resolves readable detail and exact raw', async (t) => {
  const f = await fixture(t); const service = await createHistoryService({ repo: f.repoRoot, source: 'workbuddy', workbuddyHome: f.sourceHome }); t.after(() => service.close());
  const result = await service.execute('search', { query: 'TOOL_OUTPUT_MARKER' }); assert.equal(result.scan.matchedSessions, 1); assert.equal(result.scan.matchedEvents, 1);
  const detail = await service.execute('read', { refs: [result.items[0].ref], parts: ['request', 'result', 'raw'] }); assert.match(JSON.stringify(detail), /TOOL_INPUT_MARKER/); assert.match(JSON.stringify(detail), /TOOL_OUTPUT_MARKER/);
});

test('parallel result parents may follow other calls and results without losing exact ownership', async (t) => {
  const request = { conversationRequestId: 'request1' };
  const f = await fixture(t, [user(), call('Read', { file_path: 'a.txt' }, { providerData: request }),
    call('Read', { file_path: 'b.txt' }, { id: 'c2', parentId: 'c', callId: 'call2', providerData: request }),
    result('Read', { parentId: 'c2', providerData: request }), result('Read', { id: 'r2', parentId: 'r', callId: 'call2', providerData: request })]);
  const { session } = await materialized(t, f); const tools = session.logicalEvents.filter((event) => event.toolName);
  assert.equal(tools.length, 2); assert.ok(tools.every((event) => event.status === 'success' && event.rawRefs.length === 2));
  assert.deepEqual(tools.map((event) => event.rawRefs[1].line), [4, 5]);
});

test('foreign or missing runtime session IDs are legitimate copied histories; physical identities remain distinct', async (t) => {
  const f = await fixture(t, [user(), call(), result(), assistant()].map((row) => ({ ...row, sessionId: row.id === 'u' ? 'foreign-source' : null })));
  // Modern copied root prefixes omit sessionId; legacy copies retain foreign IDs.
  const records = (await fs.readFile(f.file, 'utf8')).trim().split('\n').map(JSON.parse);
  for (const row of records) if (row.sessionId === null) delete row.sessionId;
  await fs.writeFile(f.file, records.map(JSON.stringify).join('\n') + '\n');
  const second = path.join(f.sourceHome, 'projects', 'second-container'); await fs.mkdir(second);
  await fs.copyFile(f.file, path.join(second, 'native-session.jsonl'));
  const index = await indexed(t, f); assert.equal(index.sessions.length, 2); assert.notEqual(index.sessions[0].id, index.sessions[1].id);
  for (const stored of index.sessions) assert.equal((await materializeSessionForIndex(index, stored)).counts.toolCalls, 1);
});

test('runtime user meta is Protocol and cannot begin a turn or replace title; title snapshots retain custom name', async (t) => {
  const f = await fixture(t, [record('message', 'meta', '', { role: 'user', content: [{ type: 'input_text', text: 'SYSTEM_META_SHOULD_NOT_TITLE' }], providerData: { isMeta: true, startsNewUserRequest: false } }), user(),
    { type: 'session-meta', meta: { 'codebuddy.ai/sessionTitle': [{ type: 'custom-title', customTitle: 'Snapshot custom title' }, { type: 'ai-title', aiTitle: 'Snapshot generated title' }] } }]);
  const { session } = await materialized(t, f); assert.equal(session.counts.userMessages, 1); assert.equal(session.counts.turns, 1);
  assert.equal(session.title, 'Snapshot custom title'); assert.ok(session.logicalEvents.some((event) => event.subtype === 'workbuddy_meta_message'));
});

test('malformed tool arguments cannot acquire command or file semantics; request mismatch and fork markers prohibit pairing', async (t) => {
  const f = await fixture(t, [user(), call('Bash', {}, { arguments: '{bad json', providerData: { conversationRequestId: 'req1' } }), result('Bash', { providerData: { conversationRequestId: 'req2' } }),
    call('Read', { file_path: '/do/not/load' }, { id: 'c2', callId: 'call2' }), record('resend-fork-notice', 'fork', 'u'), result('Read', { id: 'r2', parentId: 'c2', callId: 'call2' })]);
  const { session } = await materialized(t, f); const tools = session.logicalEvents.filter((event) => event.toolName);
  assert.equal(tools[0].kind, 'other_tool_call'); assert.equal(tools[0].workbuddy.argumentsValid, false);
  assert.ok(tools.every((event) => event.status === 'incomplete'));
});

test('deep extension data and long messages have bounded detail while Raw preserves the original bytes', async (t) => {
  let nested = { note: 'deep' }; for (let n = 0; n < 200; n++) nested = { child: nested };
  const f = await fixture(t, [user('u', 'X'.repeat(150000)), { type: 'future-extension', nested }]);
  const { index, session } = await materialized(t, f); const message = session.logicalEvents.find((event) => event.kind === 'user_message');
  assert.ok(JSON.stringify(await buildEventDetailForSession(index, session, message.id, 'main')).length < 200000);
  assert.equal((await readIndexedRawRecord(index, session, session.rawEvents[0].rawId)).raw, f.text.split('\n')[0]);
  const extension = session.logicalEvents.find((event) => event.subtype === 'future-extension');
  assert.ok(JSON.stringify(await buildEventDetailForSession(index, session, extension.id, 'protocol')).length < 200000);
});

test('a materialized old session cannot mix its detail with a rebuilt index snapshot', async (t) => {
  const f = await fixture(t); const original = await materialized(t, f);
  await fs.writeFile(f.file, f.text.replace('USER_MARKER', 'EDIT_MARKER'));
  const rebuilt = await indexed(t, f); assert.equal(rebuilt.sessions[0].id, original.session.id);
  const event = original.session.logicalEvents.find((item) => item.kind === 'user_message');
  await assert.rejects(buildEventDetailForSession(rebuilt, original.session, event.id, 'main'), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(readIndexedRawRecord(rebuilt, original.session, original.session.rawEvents[0].rawId), { code: 'INDEXED_SOURCE_STALE' });
});

test('aborted indexing disposes spilled query storage before propagating cancellation', async (t) => {
  const f = await fixture(t, [user('u', 'X'.repeat(4 * 1024 * 1024 + 1))]);
  await fs.writeFile(path.join(path.dirname(f.file), 'z-later.jsonl'), JSON.stringify({ ...user(), cwd: f.repoRoot }) + '\n');
  const syncFs = require('node:fs'); const originalMkdtemp = syncFs.mkdtempSync; const created = [];
  t.mock.method(syncFs, 'mkdtempSync', function(prefix, ...args) { const directory = originalMkdtemp.call(this, prefix, ...args); if (String(prefix).includes('session-analyzer-query-')) created.push(directory); return directory; });
  const controller = new AbortController(); let parsed = 0;
  await assert.rejects(buildWorkbuddyIndex({ ...f, signal: controller.signal, onProgress() { if (++parsed === 2) controller.abort(); } }), { name: 'AbortError' });
  assert.ok(created.length > 0, 'large native evidence must exercise actual disk spill');
  for (const directory of created) await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});

test('native assistant failures with empty content stay readable and searchable without a fabricated message', async (t) => {
  const f = await fixture(t, [user(), record('message', 'failure', 'u', { role: 'assistant', status: 'incomplete', content: [], providerData: { error: { message: 'EMPTY_CONTENT_NATIVE_FAILURE' } } }),
    record('message', 'failure-with-text', 'failure', { role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: 'Partial answer' }], providerData: { error: { message: 'PARTIAL_MESSAGE_NATIVE_FAILURE' } } })]);
  const { index, session } = await materialized(t, f); const failure = session.logicalEvents.find((event) => event.kind === 'error');
  assert.equal(failure.status, 'failed'); assert.equal(failure.role, 'assistant'); assert.match(failure.searchText, /EMPTY_CONTENT_NATIVE_FAILURE/);
  assert.equal(session.counts.errors, 1); assert.equal(session.counts.issueEvents, 2); assert.equal(session.counts.assistantMessages, 1);
  assert.match(JSON.stringify(await buildEventDetailForSession(index, session, failure.id, 'main')), /EMPTY_CONTENT_NATIVE_FAILURE/);
  assert.match(session.logicalEvents.find((event) => event.kind === 'assistant_message').searchText, /PARTIAL_MESSAGE_NATIVE_FAILURE/);
});

test('unknown prototype-like tool names stay generic and cannot fabricate file activity', async (t) => {
  for (const name of ['constructor', '__proto__', 'toString', 'valueOf']) {
    const f = await fixture(t, [user(), call(name, { file_path: '/nonexistent/invented-file' }), result(name)]);
    const { session } = await materialized(t, f); const tool = session.logicalEvents.find((event) => event.toolName);
    assert.equal(tool.kind, 'other_tool_call'); assert.equal(tool.workbuddy.activity, ''); assert.deepEqual(tool.touchedFiles, []);
  }
});

test('generic summary metadata remains Protocol unless native compaction flags prove the boundary', async (t) => {
  const f = await fixture(t, [user(), { type: 'summary', summary: 'GENERIC_SUMMARY_METADATA' }]);
  const { session } = await materialized(t, f); assert.equal(session.counts.compactions, 0);
  const summary = session.logicalEvents.find((event) => event.subtype === 'summary'); assert.equal(summary.layer, 'protocol'); assert.match(summary.searchText, /GENERIC_SUMMARY_METADATA/);
});

test('PowerShell preserves native success receipts for command-specific nonzero exit semantics', async (t) => {
  const f = await fixture(t, [user(), call('PowerShell', { command: 'robocopy src dst' }), result('PowerShell', { providerData: { toolResult: { rawResponse: { exitCode: 1 } } } })]);
  const { session } = await materialized(t, f); const command = session.logicalEvents.find((event) => event.kind === 'command');
  assert.equal(command.status, 'success'); assert.equal(command.outputStats.exitCode, 1); assert.equal(session.counts.failedCommands, 0);
});
