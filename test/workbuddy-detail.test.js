'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildWorkbuddyIndex } = require('../src/workbuddy');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, buildEventDetailForSession,
  readIndexedRawRecord } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');
const { validateLogicalDetailEnvelope, validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');

const timestamp = 1793400000000;
const user = (value = 'Inspect synthetic project') => ({ type: 'message', id: 'u', role: 'user',
  content: [{ type: 'input_text', text: value }] });
function tool(id, name, args, receipt, fields = {}) {
  return [{ type: 'function_call', id: `call-${id}`, parentId: 'u', name, callId: id, arguments: JSON.stringify(args) },
    { type: 'function_call_result', id: `result-${id}`, parentId: `call-${id}`, name, callId: id, status: 'completed',
      output: { type: 'text', text: typeof receipt?.content === 'string' ? receipt.content : '' },
      providerData: { toolResult: receipt }, ...fields }];
}
async function fixture(t, rows) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-workbuddy-detail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceHome = path.join(root, 'source');
  const repoRoot = path.join(root, 'project');
  const directory = path.join(sourceHome, 'projects', 'synthetic-project');
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(repoRoot);
  const file = path.join(directory, 'synthetic-detail.jsonl');
  const lines = rows.map((row) => typeof row === 'string' ? row : JSON.stringify({ timestamp,
    sessionId: 'synthetic-detail', cwd: repoRoot, ...row }));
  await fs.writeFile(file, lines.join('\n') + '\n');
  const index = await buildWorkbuddyIndex({ sourceHome, repoRoot });
  t.after(() => disposeIndexResources(index));
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sessions.length, 1);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  return { index, session, file, lines };
}
async function detailFor(f, event) {
  assert.ok(event, 'the expected event must be represented');
  const detail = await buildEventDetailForSession(f.index, f.session, event.id, event.layer);
  validateStructuredLogicalDetailDto(detail);
  validateLogicalDetailEnvelope(detail, event);
  return detail;
}
const toolEvent = (f, id) => f.session.logicalEvents.find((event) => event.workbuddy?.callId === id);
const primary = (detail) => JSON.stringify(detail.timelineSections);

test('tool details retain native failure, interruption and successful delivery evidence', async (t) => {
  const f = await fixture(t, [user(),
    ...tool('ok', 'Bash', { command: 'printf SUCCESS_OUTPUT' }, { content: 'SUCCESS_OUTPUT', rawResponse: { exitCode: 0 } }),
    ...tool('failed', 'Bash', { command: 'exit 7' }, { content: 'FAILED_OUTPUT', rawResponse: { exitCode: 7 } }),
    ...tool('denied', 'Bash', { command: 'blocked-command' }, { error: 'SYNTHETIC_PERMISSION_DENIED' }, { status: 'incomplete' }),
    ...tool('interrupted', 'Bash', { command: 'long-command' }, { rawResponse: { exitCode: 0, interrupted: true } }, { status: 'incomplete' }),
    ...tool('empty', 'Bash', { command: 'true' }, {})]);
  for (const [id, status] of [['ok', 'success'], ['failed', 'failed'], ['denied', 'failed'], ['interrupted', 'incomplete'], ['empty', 'success']]) {
    const event = toolEvent(f, id);
    assert.equal(event.status, status);
    const detail = await detailFor(f, event);
    assert.deepEqual(detail.rawRefs, event.rawRefs);
    assert.equal(detail.rawRefs.length, 2);
    if (id === 'ok') assert.match(primary(detail), /SUCCESS_OUTPUT/);
    if (id === 'denied') assert.match(primary(detail), /SYNTHETIC_PERMISSION_DENIED/);
    if (id === 'empty') {
      assert.match(primary(detail), /No textual result/);
      assert.doesNotMatch(primary(detail), /No unique completed result/);
    }
  }
});

test('completed tasks remain readable when the native active todo list is empty', async (t) => {
  const f = await fixture(t, [user(), ...tool('task', 'TaskUpdate', { taskId: '1', status: 'completed' }, {
    content: 'Task #1 completed', renderer: { type: 'todo' },
    rawResponse: { task: { id: '1', subject: 'Review synthetic file', status: 'completed' }, todos: [] },
    acpV2PlanSnapshot: { sourceId: 'synthetic-task-list', revision: '2', entries: [
      { content: 'Review synthetic file', priority: 'medium', status: 'completed' },
    ] },
  })]);
  const detail = await detailFor(f, toolEvent(f, 'task'));
  const tasks = detail.timelineSections.flatMap((section) => section.type === 'plan_update' ? section.steps : []);
  assert.ok(tasks.some((task) => task.step === 'Review synthetic file' && task.status === 'completed'));
  const raw = await readIndexedRawRecord(f.index, f.session, detail.rawRefs[1].rawId);
  assert.deepEqual(raw.parsed.providerData.toolResult.rawResponse.todos, []);
});

test('file requests and result receipts distinguish requested edits from recorded diffs', async (t) => {
  const patch = 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+new\n';
  const f = await fixture(t, [user(),
    ...tool('read', 'Read', { file_path: '/synthetic/missing.txt', offset: 2, limit: 3 }, {
      content: '   2→READ_RESULT', renderer: { type: 'code', context: { language: 'text' } },
    }),
    ...tool('write', 'Write', { file_path: '/synthetic/new.txt', content: 'REQUESTED_FILE_CONTENT' }, {
      content: 'Wrote one line', renderer: { type: 'code', value: 'SAVED_FILE_CONTENT', context: { language: 'text' } },
    }),
    ...tool('requested', 'Edit', { file_path: '/synthetic/example.txt', old_string: 'OLD_REQUEST', new_string: 'NEW_REQUEST' }, {
      content: 'Made one replacement', renderer: { type: 'diff' },
    }),
    ...tool('recorded', 'MultiEdit', { file_path: '/synthetic/example.txt', edits: [{ old_string: 'old', new_string: 'new' }] }, {
      content: 'Made one replacement', renderer: { type: 'diff' },
      acpV2FileChange: { changes: [{ operation: 'modify', path: '/synthetic/example.txt' }], patch: { format: 'git_patch', text: patch } },
    })]);
  const read = await detailFor(f, toolEvent(f, 'read'));
  assert.match(primary(read), /READ_RESULT/);
  assert.match(primary(read), /\/synthetic\/missing.txt/);
  const write = await detailFor(f, toolEvent(f, 'write'));
  assert.match(primary(write), /REQUESTED_FILE_CONTENT/);
  assert.match(primary(write), /SAVED_FILE_CONTENT/);
  const requested = await detailFor(f, toolEvent(f, 'requested'));
  assert.match(primary(requested), /OLD_REQUEST/);
  assert.match(primary(requested), /NEW_REQUEST/);
  assert.ok(requested.timelineSections.every((section) => !['diff', 'patch'].includes(section.type)));
  const recorded = await detailFor(f, toolEvent(f, 'recorded'));
  assert.ok(recorded.timelineSections.some((section) => section.purpose === 'result' && section.type === 'diff' && section.text === patch));
});

test('messages and reasoning redact complete embedded URLs before markdown rendering and omission', async (t) => {
  const payload = 'QUJD'.repeat(40_000);
  const f = await fixture(t, [user(`Message before [attachment](data:text/plain;base64,${payload}) message after`),
    { type: 'reasoning', id: 'thinking', parentId: 'u', content: [], rawContent: [
      { type: 'reasoning_text', text: `Reason before ![image](data:image/png;base64,${payload}) reason after` },
    ] },
    { type: 'message', id: 'long', parentId: 'u', role: 'assistant', status: 'completed', content: [
      { type: 'output_text', text: '<script>unsafe()</script> **Readable markdown** ' + 'x'.repeat(60_000) + 'OMITTED_TAIL_MARKER' },
    ] }]);
  for (const kind of ['user_message', 'reasoning']) {
    const detail = await detailFor(f, f.session.logicalEvents.find((event) => event.kind === kind));
    assert.match(primary(detail), /embedded data URL omitted/);
    assert.doesNotMatch(primary(detail), /QUJDQUJD|data:image|data:text/);
    assert.match(primary(detail), kind === 'reasoning' ? /reason after/ : /message after/);
    const raw = await readIndexedRawRecord(f.index, f.session, detail.rawRefs[0].rawId);
    assert.ok(raw.raw.includes(payload), 'the original payload remains exact Raw evidence');
  }
  const longEvent = f.session.logicalEvents.find((event) => event.kind === 'assistant_message');
  const long = await detailFor(f, longEvent);
  assert.match(primary(long), /<strong>Readable markdown<\/strong>/);
  assert.doesNotMatch(primary(long), /<script>|OMITTED_TAIL_MARKER/);
  assert.match(primary(long), /Display limited|large detail value omitted/);
  assert.ok(JSON.stringify(long).length < 200_000);
  const raw = await readIndexedRawRecord(f.index, f.session, long.rawRefs[0].rawId);
  assert.match(raw.raw, /OMITTED_TAIL_MARKER/);
});

test('sparse physical lines and malformed Raw details preserve the selected locator and original bytes', async (t) => {
  const malformed = '{"type":"future","value":"MALFORMED_RAW_MARKER"';
  const f = await fixture(t, ['', user(), '', ...tool('sparse', 'Read', { file_path: '/synthetic/ref-only' }, { content: 'SPARSE_RESULT' }), '', malformed]);
  for (const raw of f.session.rawEvents) {
    const detail = await buildEventDetailForSession(f.index, f.session, raw.rawId, 'raw');
    assert.deepEqual(detail.sourceLocator, raw.sourceLocator);
    assert.equal(detail.rawRefs[0].line, raw.line);
    const original = await readIndexedRawRecord(f.index, f.session, raw.rawId);
    assert.equal(original.raw, f.lines[raw.line - 1]);
    if (raw.parseError) assert.match(primary(detail), /MALFORMED_RAW_MARKER/);
    else assert.deepEqual(detail.timelineSections[0].value, JSON.parse(original.raw));
  }
  const event = toolEvent(f, 'sparse');
  assert.deepEqual(event.rawRefs.map((ref) => ref.line), [4, 5]);
  await detailFor(f, event);
});

test('compaction details retain readable summaries, execution model and recorded usage metadata', async (t) => {
  const f = await fixture(t, [user(), {
    type: 'message', id: 'summary', parentId: 'u', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'RECORDED_COMPACTION_SUMMARY' }],
    providerData: { agent: 'compact', isSummary: true, isCompacted: true, isCompactInternal: true,
      compactType: 'user-command', compactionId: 'synthetic-compaction', model: 'execution-model', requestModelId: 'selected-model',
      conversationRequestId: 'synthetic-request', usage: { inputTokens: 42, outputTokens: 7 } },
  }]);
  const event = f.session.logicalEvents.find((item) => item.kind === 'compaction');
  const detail = await detailFor(f, event);
  assert.match(primary(detail), /RECORDED_COMPACTION_SUMMARY/);
  const metadata = JSON.stringify(detail.inspectorSections);
  for (const value of ['execution-model', 'selected-model', 'synthetic-compaction', 'synthetic-request', 'Input tokens', '42', 'Output tokens', '7']) {
    assert.ok(metadata.includes(value), `recorded metadata must retain ${value}`);
  }
  const usage = f.session.logicalEvents.find((item) => item.subtype === 'workbuddy_usage');
  const usageDetail = await detailFor(f, usage);
  assert.deepEqual(usageDetail.rawRefs, event.rawRefs, 'the usage receipt refers to the same original summary record');
});

test('unknown result blocks and future protocol fields retain bounded fallback and exact Raw evidence', async (t) => {
  const future = { type: 'future-native-event', id: 'future', extension: { marker: 'FUTURE_FIELD_MARKER' } };
  const f = await fixture(t, [user(), ...tool('external', 'Agent', { prompt: 'Review reference', subagent_type: 'explore' }, {
    content: 'CHILD_RESULT', subAgent: { sessionId: 'synthetic-child', afterId: 'before', lastId: 'after' },
  }, { output: [{ type: 'future_result_block', value: 'UNMODELED_RESULT_MARKER', path: '/synthetic/do-not-load' }] }), future]);
  const toolDetail = await detailFor(f, toolEvent(f, 'external'));
  assert.match(JSON.stringify(toolDetail), /UNMODELED_RESULT_MARKER/);
  assert.match(JSON.stringify(toolDetail), /synthetic-child/);
  const event = f.session.logicalEvents.find((item) => item.subtype === future.type);
  const detail = await detailFor(f, event);
  assert.ok(detail.inspectorSections.some((section) => section.type === 'raw_json' && JSON.stringify(section.value).includes('FUTURE_FIELD_MARKER')));
  const raw = await readIndexedRawRecord(f.index, f.session, event.rawRefs[0].rawId);
  assert.equal(raw.raw, f.lines[event.rawRefs[0].line - 1]);
});

test('warm detail requests reject rewritten evidence while retaining the selected event identity', async (t) => {
  const f = await fixture(t, [user('ORIGINAL_SOURCE_MARKER')]);
  const event = f.session.logicalEvents.find((item) => item.kind === 'user_message');
  const before = await detailFor(f, event);
  assert.match(primary(before), /ORIGINAL_SOURCE_MARKER/);
  await fs.writeFile(f.file, f.lines.join('\n').replace('ORIGINAL_SOURCE_MARKER', 'REPLACED_SOURCE_MARKER') + '\n');
  await assert.rejects(buildEventDetailForSession(f.index, f.session, event.id, event.layer), { code: 'INDEXED_SOURCE_STALE' });
});
