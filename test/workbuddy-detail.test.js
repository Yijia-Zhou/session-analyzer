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
async function detailFor(f, event, options = {}) {
  assert.ok(event, 'the expected event must be represented');
  const detail = await buildEventDetailForSession(f.index, f.session, event.id, event.layer, options);
  validateStructuredLogicalDetailDto(detail);
  validateLogicalDetailEnvelope(detail, event);
  return detail;
}
const toolEvent = (f, id) => f.session.logicalEvents.find((event) => event.workbuddy?.callId === id);
const primary = (detail) => JSON.stringify(detail.timelineSections);

test('desktop file references preserve human text, metadata, one input and exact Raw without loading files', async (t) => {
  const file = 'Z:\\synthetic\\unavailable.txt';
  const envelope = (suffix = '') => `<system-reminder data-role="user-context">FILE_CONTEXT</system-reminder>\n<system-reminder data-role="additional-data"><attached_files>\n<file path="${file}" />\n</attached_files></system-reminder>\n<user_query>@"Z:/synthetic/unavailable.txt"${suffix}</user_query>`;
  const f = await fixture(t, [user(envelope()), { ...user(envelope(' FILE_QUERY: summarize this.')), id: 'with-text' }]);
  const events = f.session.logicalEvents.filter((e) => e.kind === 'user_message');
  assert.equal(events.length, 2); assert.equal(f.session.counts.userMessages, 2); assert.equal(f.session.counts.turns, 2);
  assert.equal(events[0].workbuddy.text, '');
  assert.equal(events[1].workbuddy.text, 'FILE_QUERY: summarize this.');
  assert.match(f.session.title, /unavailable.txt/); assert.doesNotMatch(f.session.title, /system-reminder/);
  for (const event of events) {
    const detail = await detailFor(f, event);
    assert.match(primary(detail), /File reference.*unavailable.txt/);
    assert.doesNotMatch(primary(detail), /FILE_CONTEXT|attached_files|user_query/);
    assert.match(JSON.stringify(detail.inspectorSections), /FILE_CONTEXT/);
    assert.equal((await readIndexedRawRecord(f.index, f.session, event.rawRefs[0].rawId)).raw, f.lines[event.source.line - 1]);
  }
  const { createHistoryService } = require('../src/history-service');
  const service = await createHistoryService({ source: 'workbuddy', repo: f.index.repoRoot, workbuddyHome: f.index.sourceHome });
  t.after(() => service.close());
  assert.equal((await service.execute('search', { query: 'FILE_QUERY', kind: 'user_message' })).items.length, 1);
});

test('file-like literal text and incomplete or mismatched envelopes do not acquire attachment semantics', async (t) => {
  for (const value of [
    '@"Z:/synthetic/file.txt"',
    '<system-reminder>KEEP_LITERAL</system-reminder><user_query>@"Z:/synthetic/file.txt"</user_query>',
    '<system-reminder data-role="additional-data"><attached_files><file path="Z:/other.txt" /></attached_files></system-reminder><user_query>@"Z:/synthetic/file.txt"</user_query>',
    '<system-reminder data-role="additional-data"><attached_files><file path="relative.txt" /></attached_files></system-reminder><user_query>@"relative.txt"</user_query>',
    `<system-reminder data-role="additional-data"><attached_files><file path="${path.join(process.cwd(), 'relative.txt')}" /></attached_files></system-reminder><user_query>@"relative.txt" ACTUAL_TEXT</user_query>`,
  ]) {
    const f = await fixture(t, [user(value)]);const event = f.session.logicalEvents.find((e) => e.kind === 'user_message');
    assert.equal(event.workbuddy.fileMessage, undefined);
    assert.equal(event.workbuddy.text, value);
    assert.equal(f.session.counts.userMessages, 1);
    await detailFor(f, event);
  }
});

test('native nested error receipts override completed delivery without interpreting lookalike flags', async (t) => {
  const f = await fixture(t, [user(),
    ...tool('deferred', 'DeferExecuteTool', { toolName: 'im_list_conversations', arguments: {} },
      { content: 'SYNTHETIC_HEADLESS_UNAVAILABLE', rawResponse: { is_error: true } }),
    ...tool('shell', 'Bash', { command: 'synthetic-command' }, { rawResponse: { is_error: true } }),
    ...tool('false', 'DeferExecuteTool', { toolName: 'Read' }, { rawResponse: { is_error: false } }),
    ...tool('string', 'DeferExecuteTool', { toolName: 'Read' }, { rawResponse: { is_error: 'true' } }),
    ...tool('nested', 'Read', { file_path: 'example' }, { rawResponse: { content: { is_error: true } } }),
  ]);
  for (const id of ['deferred', 'shell', 'false', 'string', 'nested']) {
    const event = toolEvent(f, id);
    const failed = ['deferred', 'shell'].includes(id);
    assert.equal(event.status, failed ? 'failed' : 'success');
    assert.equal(event.workbuddy.resultStatus, 'completed');
    const detail = await detailFor(f, event);
    assert.equal(primary(detail).includes('recorded tool response reports an error'), failed);
    const raw = await readIndexedRawRecord(f.index, f.session, detail.rawRefs[1].rawId);
    assert.equal(raw.raw, f.lines[detail.rawRefs[1].line - 1]);
    if (id === 'deferred') {
      assert.equal(event.toolName, 'DeferExecuteTool');
      assert.match(event.preview, /im_list_conversations/);
      assert.match(primary(detail), /Requested tool.*im_list_conversations/);
      assert.match(primary(detail), /SYNTHETIC_HEADLESS_UNAVAILABLE/);
    }
  }
});

const imageRef = (fields = {}) => ({ type: 'image_blob_ref', blob_id: 'synthetic-blob', mime: 'image/png',
  original_filename: 'SYNTHETIC_IMAGE.png', size: 123, blob_path: '/nonexistent/synthetic-image.png', ...fields });

test('WorkBuddy attachment and deferred-tool details honor locale without translating source values', async (t) => {
  const paths = Array.from({ length: 17 }, (_, i) => `/synthetic/file-${i}.txt`);
  const fileText = `<system-reminder data-role="additional-data"><attached_files>${paths.map((file) => `\n<file path="${file}" />`).join('')}\n</attached_files></system-reminder>`
    + `<user_query>${paths.map((file) => `@"${file}"`).join(' ')} File reference</user_query>`;
  const f = await fixture(t, [
    { ...user(), content: [{ type: 'input_text', text: 'Image attachment' },
      ...Array.from({ length: 17 }, (_, i) => imageRef({ blob_id: `blob-${i}`, original_filename: i ? '' : 'Name' }))] },
    { ...user(fileText), id: 'files' },
    ...tool('translated', 'DeferExecuteTool', { toolName: 'File reference' },
      { title: 'Image attachment', content: 'Recorded result', rawResponse: { is_error: true } }),
  ]);
  const image = f.session.logicalEvents.find((event) => event.workbuddy?.imageMessage);
  const imageDetail = await detailFor(f, image, { locale: 'zh-CN' });
  const imageSections = imageDetail.timelineSections.filter((section) => section.title === '图片附件');
  assert.equal(imageSections.length, 16);
  assert.deepEqual(imageSections[0].entries.map((entry) => entry.key), ['名称', '媒体类型', '字节数']);
  assert.equal(imageSections[0].entries[0].value, 'Name');
  assert.equal(imageSections[1].entries[0].value, '未命名图片');
  assert.match(primary(imageDetail), /Image attachment/);
  assert.match(primary(imageDetail), /显示 17 个图片引用中的 16 个/);
  assert.match(primary(imageDetail), /无法预览/);

  const file = f.session.logicalEvents.find((event) => event.workbuddy?.fileMessage);
  const fileDetail = await detailFor(f, file, { locale: 'zh-CN' });
  assert.equal(fileDetail.timelineSections.filter((section) => section.title === '文件引用').length, 16);
  assert.match(primary(fileDetail), /显示 17 个文件引用中的 16 个/);
  assert.match(primary(fileDetail), /文件内容不会被读取/);
  assert.match(primary(fileDetail), /File reference/);
  assert.match(primary(fileDetail), /\/synthetic\/file-0\.txt/);

  const toolDetail = await detailFor(f, toolEvent(f, 'translated'), { locale: 'zh-CN' });
  assert.match(primary(toolDetail), /延迟工具请求/);
  assert.match(primary(toolDetail), /工具响应报告错误/);
  assert.match(primary(toolDetail), /File reference/);
  assert.match(primary(toolDetail), /Image attachment/);
});

test('native image-only envelope has one searchable user event and keeps wrappers in inspection and exact Raw', async (t) => {
  const f = await fixture(t, [{ ...user(), content: [
    { type: 'input_text', text: '<system-reminder data-role="user-context">SYNTHETIC_CONTEXT</system-reminder>\n<user_query>@image#1:SYNTHETIC_IMAGE.png</user_query>' },
    imageRef(), { type: 'input_text', text: '<image_local_path>/nonexistent/synthetic-image.png</image_local_path>\n' },
  ] }]);
  const events = f.session.logicalEvents.filter((event) => event.rawRefs.some((ref) => ref.line === 1)
    && event.subtype !== 'workbuddy_recorded_history');
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.kind, 'user_message');
  assert.equal(f.session.counts.userMessages, 1);
  assert.equal(f.session.counts.turns, 1);
  assert.match(f.session.title, /SYNTHETIC_IMAGE.png/);
  assert.doesNotMatch(f.session.title, /system-reminder/);
  const detail = await detailFor(f, event);
  assert.match(primary(detail), /Image attachment.*SYNTHETIC_IMAGE.png.*image\/png.*123/);
  assert.match(primary(detail), /preview is not available/);
  assert.doesNotMatch(primary(detail), /SYNTHETIC_CONTEXT|image_local_path|nonexistent/);
  assert.match(JSON.stringify(detail.inspectorSections), /SYNTHETIC_CONTEXT/);
  assert.match(JSON.stringify(detail.inspectorSections), /image_local_path/);
  const { createHistoryService } = require('../src/history-service');
  const service = await createHistoryService({ source: 'workbuddy', repo: f.index.repoRoot, workbuddyHome: path.dirname(f.index.sessionsRoot) });
  t.after(() => service.close());
  for (const query of ['SYNTHETIC_IMAGE.png', 'SYNTHETIC_CONTEXT']) {
    const hits = (await service.execute('search', { query, layer: 'main' })).items;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].eventId, event.id);
  }
  assert.equal((await readIndexedRawRecord(f.index, f.session, event.rawRefs[0].rawId)).raw, f.lines[0]);
});

test('reference-only and mixed image messages preserve text, bounded metadata and runtime identity exclusions', async (t) => {
  const f = await fixture(t, [
    { ...user(), content: [imageRef()] },
    { ...user(), id: 'mixed', content: [{ type: 'input_text', text: 'Explain this image' }, imageRef(),
      { type: 'input_text', text: '<image_local_path>LITERAL_PATH</image_local_path>' }] },
    { ...user(), id: 'many', content: Array.from({ length: 150 }, (_, n) => imageRef({ blob_id: `blob-${n}` })) },
    { ...user(), id: 'internal', content: [imageRef()], providerData: { teammateMessage: { from: 'synthetic-peer' } } },
  ]);
  const events = f.session.logicalEvents.filter((event) => event.kind === 'user_message');
  assert.equal(events.length, 3);
  assert.equal(f.session.counts.userMessages, 3);
  assert.equal(f.session.counts.turns, 3);
  const mixed = await detailFor(f, events[1]);
  assert.match(primary(mixed), /Explain this image/);
  assert.match(primary(mixed), /LITERAL_PATH/);
  const many = await detailFor(f, events[2]);
  assert.equal(many.timelineSections.filter((section) => section.title === 'Image attachment').length, 16);
  assert.match(primary(many), /Showing 16 of 150/);
  assert.ok(JSON.stringify(many).length < 200_000);
  assert.ok(f.session.logicalEvents.some((event) => event.layer === 'protocol' && event.source.line === 4));
});

test('uploaded image pairs and pasted image queries unwrap only complete native envelopes', async (t) => {
  const envelope = (query) => ({ type: 'input_text', text: `<system-reminder>HIDDEN_NATIVE_CONTEXT</system-reminder><user_query>${query}</user_query>` });
  const localPath = { type: 'input_text', text: '<image_local_path>C:\\synthetic\\clipboard.jpg</image_local_path>' };
  const first = imageRef({ original_filename: '上传 图片.png' });
  const second = imageRef({ blob_id: 'second', original_filename: 'second.png', mime: 'image/jpeg' });
  const query = 'Describe the trees; keep <image_local_path>LITERAL_TEXT</image_local_path>.';
  const f = await fixture(t, [
    { ...user(), content: [envelope('@image#1:"上传 图片.png" @image#2:"second.png"'), first, localPath, second, localPath] },
    { ...user(), id: 'pasted', content: [envelope(`@image#1:SYNTHETIC_IMAGE.png ${query}`), imageRef(), localPath] },
  ]);
  const events = f.session.logicalEvents.filter((event) => event.kind === 'user_message');
  assert.equal(events.length, 2);
  assert.equal(f.session.counts.userMessages, 2);
  assert.equal(f.session.counts.turns, 2);
  assert.deepEqual(events.map((event) => event.workbuddy.imageCount), [2, 1]);
  assert.equal(events[0].workbuddy.text, '');
  assert.equal(events[1].workbuddy.text, query);
  assert.match(f.session.title, /上传 图片.png/);
  for (const event of events) {
    const detail = await detailFor(f, event);
    assert.doesNotMatch(primary(detail), /HIDDEN_NATIVE_CONTEXT|clipboard.jpg|@image#/);
    assert.match(JSON.stringify(detail.inspectorSections), /HIDDEN_NATIVE_CONTEXT/);
    assert.equal((await readIndexedRawRecord(f.index, f.session, event.rawRefs[0].rawId)).raw, f.lines[event.rawRefs[0].line - 1]);
  }
  const pair = await detailFor(f, events[0]);
  assert.equal(pair.timelineSections.filter((section) => section.title === 'Image attachment').length, 2);
  assert.match(primary(pair), /image\/jpeg/, 'recorded MIME wins over filename extension');
  assert.match(primary(await detailFor(f, events[1])), /LITERAL_TEXT/);
  const { createHistoryService } = require('../src/history-service');
  const service = await createHistoryService({ source: 'workbuddy', repo: f.index.repoRoot, workbuddyHome: f.index.sourceHome });
  t.after(() => service.close());
  for (const [term, event] of [['上传 图片.png', events[0]], ['second.png', events[0]], ['Describe the trees', events[1]]]) {
    const hits = (await service.execute('search', { query: term, layer: 'main' })).items;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].eventId, event.id);
  }
});

test('incomplete image sequences and mismatched marker boundaries retain original text', async (t) => {
  const image = imageRef();
  const localPath = { type: 'input_text', text: '<image_local_path>/synthetic/KEEP_PATH.png</image_local_path>' };
  for (const [query, tail] of [
    ['@image#1:SYNTHETIC_IMAGE.png.extra text', [image, localPath]],
    ['@image#2:SYNTHETIC_IMAGE.png', [image, localPath]],
    ['@image#1:SYNTHETIC_IMAGE.png', [image]],
    ['@image#1:SYNTHETIC_IMAGE.png @image#2:wrong.png', [image, localPath, imageRef({ blob_id: 'second' }), localPath]],
    ['@image#1:SYNTHETIC_IMAGE.png @image#2:SYNTHETIC_IMAGE.png', [image, imageRef({ blob_id: 'second' }), localPath, localPath]],
  ]) {
    const f = await fixture(t, [{ ...user(), content: [
      { type: 'input_text', text: `<system-reminder>KEEP_CONTEXT</system-reminder><user_query>${query}</user_query>` }, ...tail,
    ] }]);
    const event = f.session.logicalEvents.find((item) => item.kind === 'user_message');
    assert.equal(f.session.counts.userMessages, 1);
    assert.match(primary(await detailFor(f, event)), /KEEP_CONTEXT/);
  }
});

test('malformed image references stay Protocol while uncorroborated literal envelopes remain readable', async (t) => {
  for (const ref of [imageRef({ blob_id: '' }), imageRef({ mime: 'text/plain' }), imageRef({ blob_id: 7 })]) {
    const f = await fixture(t, [{ ...user(), content: [ref] }]);
    assert.equal(f.session.counts.userMessages, 0);
    assert.equal(f.session.counts.turns, 0);
    const event = f.session.logicalEvents.find((item) => item.subtype !== 'workbuddy_recorded_history');
    assert.equal(event.layer, 'protocol');
    assert.equal((await readIndexedRawRecord(f.index, f.session, event.rawRefs[0].rawId)).raw, f.lines[0]);
  }
  for (const literal of [
    '<system-reminder>LITERAL_CONTEXT</system-reminder><user_query>@image#1:other.png</user_query>',
    '<system-reminder>LITERAL_CONTEXT</system-reminder>'.repeat(100),
  ]) {
    for (const extra of [[], [imageRef()]]) {
      const f = await fixture(t, [{ ...user(literal), content: [...user(literal).content, ...extra] }]);
      const event = f.session.logicalEvents.find((item) => item.kind === 'user_message');
      assert.match(primary(await detailFor(f, event)), /LITERAL_CONTEXT/);
    }
  }
});

test('image wrapper recognition requires the complete native shape and a recorded filename', async (t) => {
  const envelope = (name) => ({ type: 'input_text', text: `<system-reminder>KEEP_CONTEXT</system-reminder><user_query>@image#1:${name}</user_query>` });
  const localPath = { type: 'input_text', text: '<image_local_path>/synthetic/KEEP_LITERAL.png</image_local_path>' };
  for (const blocks of [
    [envelope('SYNTHETIC_IMAGE.png'), imageRef(), { type: 'input_text', text: 'Explain this literal path.' }, localPath],
    [envelope('SYNTHETIC_IMAGE.png'), imageRef(), { type: 'future_block', marker: 'KEEP_UNKNOWN' }, localPath],
    [envelope('undefined'), imageRef({ original_filename: undefined }), localPath],
    [envelope('42'), imageRef({ original_filename: 42 }), localPath],
    [envelope('SYNTHETIC_IMAGE.png'), imageRef(), { type: 'input_text', text: '<image_local_path>KEEP_LITERAL</image_local_path>' }],
  ]) {
    const f = await fixture(t, [{ ...user(), content: blocks }]);
    const event = f.session.logicalEvents.find((item) => item.kind === 'user_message');
    assert.equal(f.session.counts.userMessages, 1);
    const detail = await detailFor(f, event);
    assert.match(primary(detail), /KEEP_CONTEXT/);
    assert.match(primary(detail), /KEEP_LITERAL/);
    assert.equal((await readIndexedRawRecord(f.index, f.session, event.rawRefs[0].rawId)).raw, f.lines[0]);
    if (blocks.some((block) => block.type === 'future_block')) {
      assert.ok(f.session.logicalEvents.some((item) => item.layer === 'protocol' && item.subtype === 'workbuddy_content_2'));
    }
  }
});

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
  const chinese = await detailFor(f, event, { locale: 'zh-CN' });
  assert.match(JSON.stringify(chinese.inspectorSections), /已记录的压缩消息/);
  assert.match(primary(detail), /RECORDED_COMPACTION_SUMMARY/);
  const metadata = JSON.stringify(detail.inspectorSections);
  for (const value of ['execution-model', 'selected-model', 'synthetic-compaction', 'synthetic-request', 'Input tokens', '42', 'Output tokens', '7']) {
    assert.ok(metadata.includes(value), `recorded metadata must retain ${value}`);
  }
  const usage = f.session.logicalEvents.find((item) => item.subtype === 'workbuddy_usage');
  const usageDetail = await detailFor(f, usage);
  assert.deepEqual(usageDetail.rawRefs, event.rawRefs, 'the usage receipt refers to the same original summary record');
});

test('internal compaction continuation is searchable in Protocol and preserves exact Raw', async (t) => {
  const row = { type: 'message', id: 'continuation', role: 'user',
    content: [{ type: 'input_text', text: 'INTERNAL_CONTINUATION_CONTEXT' }],
    providerData: { isCompacted: true, isCompactInternal: true, isSummary: false } };
  const f = await fixture(t, [row, user()]);
  assert.equal(f.session.title, 'Inspect synthetic project');
  assert.equal(f.session.counts.compactions, 0);
  assert.equal(f.session.counts.userMessages, 1);
  assert.equal(f.session.counts.messages, 1);
  const event = f.session.logicalEvents.find((item) => item.subtype === 'workbuddy_internal_message');
  const detail = await detailFor(f, event);
  assert.match(JSON.stringify(detail), /INTERNAL_CONTINUATION_CONTEXT/);
  assert.equal(event.layer, 'protocol');
  assert.doesNotMatch(JSON.stringify(detail.inspectorSections), /This is the recorded summary/);
  assert.equal(event.role, 'user', 'preserve the recorded role without counting a human message');
  assert.equal((await readIndexedRawRecord(f.index, f.session, event.rawRefs[0].rawId)).raw, f.lines[0]);
  const { createHistoryService } = require('../src/history-service');
  const service = await createHistoryService({ repo: f.index.repoRoot, source: 'workbuddy', workbuddyHome: f.index.sourceHome });
  t.after(() => service.close());
  const hits = await service.execute('search', { query: 'INTERNAL_CONTINUATION_CONTEXT', layer: 'protocol' });
  assert.equal(hits.items.length, 1);
  const messages = await service.execute('search', { query: 'INTERNAL_CONTINUATION_CONTEXT', kind: 'user_message' });
  assert.equal(messages.items.length, 0);
});

test('partial and nonboolean compaction markers retain Protocol evidence', async (t) => {
  for (const providerData of [{ isCompacted: true }, { isCompactInternal: true },
    { isSummary: true }, { isCompacted: false, isCompactInternal: true },
    { isCompacted: true, isCompactInternal: 'true', isSummary: false },
    { isCompacted: 'true', isCompactInternal: true }]) {
    const f = await fixture(t, [{ ...user(), providerData }]);
    assert.equal(f.session.counts.compactions, 0);
    assert.equal(f.session.counts.userMessages, 0);
    assert.equal(f.session.counts.turns, 0);
    const event = f.session.logicalEvents.find((item) => item.subtype !== 'workbuddy_recorded_history');
    assert.equal(event.layer, 'protocol');
    const detail = await detailFor(f, event);
    assert.equal((await readIndexedRawRecord(f.index, f.session, detail.rawRefs[0].rawId)).raw, f.lines[0]);
  }
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
