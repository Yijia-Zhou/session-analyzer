'use strict';

// Minimal synthetic rows matching schema 2.1.4; no runtime, model or export needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionFromOpenCodeSnapshot, sessionIdFor } = require('../src/opencode-logical');
const { buildOpenCodeEventDetail } = require('../src/opencode-detail');
const { validateCanonicalMaterializedSessionShape } = require('../src/canonical-contract');
const { validateStructuredLogicalDetailDto, validateLogicalDetailEnvelope } = require('../src/shared/logical-detail-contract');
const TIME = Date.parse('2026-10-01T12:00:00.000Z');
const SNAPSHOT_ID = 'synthetic-snapshot-1';
function row(id, type, seq, fields = {}) {
  return { id, session_id: 'ses_test', type, seq, time_created: TIME + seq, time_updated: TIME + seq,
    data: JSON.stringify({ time: { created: TIME + seq }, ...fields }) };
}
function snapshot(messages = [], fields = {}) {
  return { formatVersion: 1, source: { databasePath: '/synthetic/opencode.db', identity: 'db:test',
    schemaProfile: 'opencode-2.1.4', schemaDigest: 'synthetic' },
  project: { repoRoot: '/synthetic/project', manifestDigest: 'synthetic' },
  session: { id: 'ses_test', directory: '/synthetic/project/subdir', path: 'subdir', version: '2.1.4',
    title: 'Synthetic title', agent: 'build', time_created: TIME, time_updated: TIME + 1000,
    cost: 0.02, tokens_input: 11, tokens_output: 7, tokens_reasoning: 3,
    tokens_cache_read: 5, tokens_cache_write: 0, ...fields }, messages, relations: {} };
}
function mapped(native) {
  const session = sessionFromOpenCodeSnapshot(native, { snapshotId: SNAPSHOT_ID });
  const { rawEvents, logicalEvents, analysis, presentationIndexes, ...carried } = session;
  const indexed = { ...structuredClone(carried), materializationDescriptor: { schemaVersion: 1,
    dependencySetId: 'synthetic-dependency', sourceSnapshotId: SNAPSHOT_ID, payload: {} },
  queryShardId: session.id, queryProjectionDigest: 'a'.repeat(43) };
  session.materializationSnapshotId = SNAPSHOT_ID;
  validateCanonicalMaterializedSessionShape(indexed, session, 'opencode');
  return session;
}
function tool(name, status, fields = {}) {
  const { id, executed, time, ...state } = fields;
  return { type: 'tool', id: id || 'call_' + name + '_' + status, name,
    ...(executed !== undefined ? { executed } : {}), time: time || { created: TIME, ran: TIME + 5, completed: TIME + 15 },
    state: { status, input: { command: 'printf TOOL_REQUEST', path: 'src/file.js' }, ...state } };
}

test('OpenCode preserves SQL seq/content order and references exact row identities without JSONL lines', () => {
  const native = snapshot([
    row('msg_answer', 'assistant', 7, { content: [{ type: 'text', text: 'first' }, { type: 'reasoning', text: 'consider' },
      tool('read', 'completed', { content: [{ type: 'text', text: 'READ_RESULT' }] }), { type: 'text', text: 'last' }],
    time: { created: TIME + 7, completed: TIME + 8 } }),
    row('msg_user', 'user', 2, { text: '开始', files: [{ uri: 'file:///synthetic/ref', mime: 'text/plain' }] }),
    row('msg_idle', 'idle', 9, { outcome: 'succeeded' }),
  ]);
  const original = JSON.stringify(native);
  const session = mapped(native);
  assert.deepEqual(session.logicalEvents.filter(e => e.layer === 'main').map(e => e.kind),
    ['user_message', 'assistant_message', 'reasoning', 'other_tool_call', 'assistant_message']);
  assert.equal(session.counts.turns, 1);
  assert.equal(session.counts.messages, 3);
  assert.equal(session.counts.toolCalls, 1);
  assert.equal(session.lineCount, 0);
  assert.equal(session.rawEventCount, 4);
  assert.deepEqual(session.cwdSet, ['/synthetic/project/subdir']);
  assert.equal(session.rawEvents[0].sourceLocator.table, 'session_v2');
  assert.deepEqual(session.rawEvents.slice(1).map(r => r.messageId), ['msg_user', 'msg_answer', 'msg_idle']);
  for (const event of session.logicalEvents) for (const ref of event.rawRefs) {
    assert.equal(ref.line, null);
    assert.equal(ref.sourceLocator.snapshotId, SNAPSHOT_ID);
    assert.equal(ref.sourceLocator.type, 'sqlite_row');
    assert.equal(ref.sourceLocator.pointer, '');
    assert.deepEqual(ref.sourceLocator, session.rawEvents.find(r => r.rawId === ref.rawId).sourceLocator);
  }
  assert.equal(JSON.stringify(native), original, 'mapping cannot rewrite native SQL evidence');
});

test('OpenCode distinguishes tool completion, process exit, unfinished states and user shell accounting', () => {
  const tools = [tool('shell', 'streaming', { input: '{"command":' }), tool('shell', 'running'),
    tool('shell', 'completed', { content: [{ type: 'text', text: 'process failed' }], metadata: { status: 'exited', exit: 7 } }),
    tool('shell', 'completed', { content: [{ type: 'text', text: 'background handle' }], metadata: { status: 'running' } }),
    tool('read', 'error', { error: { message: 'FILE_MISSING' } }),
    tool('read', 'completed', { content: [{ type: 'text', text: 'provider-native' }], executed: false })];
  const session = mapped(snapshot([
    row('msg_assistant', 'assistant', 1, { content: tools }),
    row('msg_shell', 'shell', 2, { shellID: 'sh_1', command: 'exit 2', status: 'exited', exit: 2,
      output: { output: 'USER_OUTPUT', cursor: 11, size: 11, truncated: false } }),
    row('msg_missing_exit', 'shell', 3, { command: 'exit', status: 'exited' }),
  ]));
  const events = session.logicalEvents.filter(e => e.kind !== 'protocol');
  assert.deepEqual(events.map(e => e.status), ['incomplete', 'incomplete', 'failed', 'incomplete', 'failed', 'success', 'failed', 'incomplete']);
  assert.equal(events[2].opencode.toolStatus, 'completed');
  assert.equal(events[2].outputStats.exitCode, 7);
  assert.equal(events[2].outputStats.durationMs, 10);
  assert.equal(events[6].opencode.userInitiated, true);
  assert.equal(session.counts.toolCalls, 6, 'providerExecuted false is still a model tool call; user shell is not');
  assert.equal(session.counts.failedCommands, 2);
});

test('OpenCode maps the native patch tool and recorded changed files', async (t) => {
  // 2.1.4 packages/core/src/tool/plugin/patch.ts: name, Input and metadata.files.
  const patchText = '*** Begin Patch\n*** Update File: src/example.js\n@@\n-old\n+new\n*** End Patch';
  const native = snapshot([row('msg_native_patch', 'assistant', 1, { content: [{
    type: 'tool', id: 'call_native_patch', name: 'patch',
    time: { created: TIME, ran: TIME + 5, completed: TIME + 15 },
    state: { status: 'completed', input: { patchText },
      content: [{ type: 'text', text: 'Success. Updated the following files:\nM src/example.js' }],
      metadata: { files: [{ file: 'src/example.js', status: 'modified', additions: 1, deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new' }] } },
  }] })]);
  const session = mapped(native);
  const event = session.logicalEvents.find(item => item.toolName === 'patch');
  assert.equal(event.kind, 'patch');
  assert.equal(event.status, 'success');
  assert.deepEqual(event.touchedFiles, ['src/example.js']);
  assert.equal(session.counts.patches, 1);
  assert.deepEqual(session.analysis.patchedFiles, [{ file: 'src/example.js', count: 1 }]);
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => native);
  const detail = await buildOpenCodeEventDetail({}, session, event.id);
  validateStructuredLogicalDetailDto(detail);
  validateLogicalDetailEnvelope(detail, event);
  assert.ok(detail.timelineSections.some(section => section.purpose === 'request' && section.code === patchText));
  assert.ok(detail.timelineSections.some(section => section.purpose === 'result' && section.text.includes('Success. Updated')));
  assert.ok(detail.inspectorSections.some(section => section.purpose === 'request' && section.value.patchText === patchText));
});

test('OpenCode keeps a completed tool with a termination signal distinct from a successful process', async (t) => {
  // 2.1.4 shell/result.ts carries signal separately from exit; plugin/shell.ts
  // settles the tool with status completed even when the process was signalled.
  const native = snapshot([row('msg_signal', 'assistant', 1, { content: [tool('shell', 'completed', {
    metadata: { status: 'completed', signal: 'SIGTERM' },
    content: [{ type: 'text', text: 'Killed by SIGTERM' }],
  })] })]);
  const session = mapped(native);
  const event = session.logicalEvents.find(item => item.kind === 'command');
  assert.equal(event.opencode.toolStatus, 'completed');
  assert.equal(event.status, 'failed');
  assert.equal(event.outputStats.exitCode, null);
  assert.equal(session.counts.failedCommands, 1);
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => native);
  const detail = await buildOpenCodeEventDetail({}, session, event.id);
  validateStructuredLogicalDetailDto(detail);
  assert.ok(detail.inspectorSections.some(section => section.entries?.some(entry => entry.key === 'Termination signal' && entry.value === 'SIGTERM')));
});

test('OpenCode completed provider compaction does not invent a readable summary or pending state', async (t) => {
  // 2.1.4 schema/session-message.ts and core/session/compaction.ts permit a
  // completed empty summary with a provider-owned replacement in native.messages.
  const native = snapshot([row('msg_provider_compaction', 'compaction', 1, {
    status: 'completed', reason: 'auto', summary: '',
    native: { messages: [{ type: 'opaque-replacement', payload: 'OPAQUE_COMPACTION_PAYLOAD' }] },
  }), row('msg_empty_compaction', 'compaction', 2, { status: 'completed', reason: 'manual', summary: '' }),
  row('msg_running_compaction', 'compaction', 3, { status: 'running', reason: 'auto', summary: '' }),
  row('msg_failed_compaction', 'compaction', 4, { status: 'failed', reason: 'auto', error: { message: 'Compaction request failed' } })]);
  const session = mapped(native);
  const events = session.logicalEvents.filter(item => item.kind === 'compaction');
  assert.deepEqual(events.map(event => event.status), ['success', 'success', 'incomplete', 'failed']);
  assert.match(events[0].preview, /completed without a readable summary/);
  assert.match(events[1].preview, /completed without a readable summary/);
  assert.match(events[2].preview, /in progress/);
  assert.match(events[3].preview, /Compaction request failed/);
  assert.equal(events[0].opencode.hasNativeReplacement, true);
  assert.equal(events[1].opencode.hasNativeReplacement, false);
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => native);
  const detail = await buildOpenCodeEventDetail({}, session, events[0].id);
  validateStructuredLogicalDetailDto(detail);
  assert.match(JSON.stringify(detail), /provider-owned replacement data and no readable summary/);
  assert.doesNotMatch(JSON.stringify(detail), /OPAQUE_COMPACTION_PAYLOAD|in progress|This is the recorded compaction summary/);
  assert.doesNotMatch(events[0].searchText, /OPAQUE_COMPACTION_PAYLOAD/);
  const rawDetail = await buildOpenCodeEventDetail({}, session, events[0].rawRefs[0].rawId, 'raw');
  assert.match(rawDetail.timelineSections[0].value.data, /OPAQUE_COMPACTION_PAYLOAD/);
});

test('OpenCode marks a bounded readable detail and keeps its omitted tail available in Raw', async (t) => {
  const text = 'x'.repeat(100_000) + 'TAIL_DETAIL_MARKER';
  const native = snapshot([row('msg_long_user', 'user', 1, { text })]);
  const session = mapped(native);
  const event = session.logicalEvents.find(item => item.kind === 'user_message');
  assert.match(event.searchText, /TAIL_DETAIL_MARKER/);
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => native);
  const detail = await buildOpenCodeEventDetail({}, session, event.id);
  validateStructuredLogicalDetailDto(detail);
  assert.doesNotMatch(detail.timelineSections[0].html, /TAIL_DETAIL_MARKER/);
  assert.ok(detail.timelineSections.some(section => section.type === 'notice' && /100,000 characters.*omitted.*Raw/.test(section.text)));
  const rawDetail = await buildOpenCodeEventDetail({}, session, event.rawRefs[0].rawId, 'raw');
  assert.match(rawDetail.timelineSections[0].value.data, /TAIL_DETAIL_MARKER/);
});

test('OpenCode native attachments expose metadata while keeping base64 bytes in exact Raw only', async (t) => {
  // 2.1.4 schema/prompt.ts: FileAttachment.data is bare Base64, with mime/source.
  const opaque = Buffer.from('synthetic opaque attachment bytes').toString('base64');
  const files = [
    { data: opaque, mime: 'image/png', source: { type: 'inline' }, name: 'inline.png' },
    { data: opaque, mime: 'text/plain', source: { type: 'uri', uri: 'file:///synthetic/attachment.txt' },
      name: 'attachment.txt', description: 'Recorded attachment description' },
  ];
  const native = snapshot([row('msg_attachments', 'user', 1, { text: 'ATTACHMENT_CAPTION', files })]);
  const original = native.messages[0].data;
  const session = mapped(native);
  const event = session.logicalEvents.find(item => item.kind === 'user_message');
  for (const item of [...session.rawEvents, ...session.logicalEvents]) assert.equal(item.searchText.includes(opaque), false);
  assert.match(event.searchText, /inline.png.*attachment.txt.*Recorded attachment description/s);
  assert.equal(JSON.stringify(event.opencode.files).includes(opaque), false);
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => native);
  const detail = await buildOpenCodeEventDetail({}, session, event.id);
  validateStructuredLogicalDetailDto(detail);
  assert.equal(JSON.stringify(detail).includes(opaque), false);
  assert.match(JSON.stringify(detail), /attachment bytes omitted; see raw refs/);
  assert.match(JSON.stringify(detail), /file:\/\/\/synthetic\/attachment.txt/);
  const rawDetail = await buildOpenCodeEventDetail({}, session, event.rawRefs[0].rawId, 'raw');
  assert.equal(rawDetail.timelineSections[0].value.data, original);
  assert.equal(native.messages[0].data, original);
});

test('OpenCode fork activity counts describe captured history while session usage excludes copied usage', async (t) => {
  const native = snapshot([
    row('msg_copied_history', 'assistant', 1, { content: [tool('shell', 'completed', {
      metadata: { exit: 0 }, content: [{ type: 'text', text: 'copied command result' }],
    })], cost: 12, tokens: { input: 100, output: 20 } }),
    row('msg_new_history', 'assistant', 2, { content: [tool('read', 'completed', {
      content: [{ type: 'text', text: 'new command result' }],
    })], cost: 1, tokens: { input: 10, output: 2 } }),
  ], { fork_session_id: 'ses_parent', fork_boundary: JSON.stringify({ type: 'through', messageID: 'msg_parent_boundary' }),
    cost: 1, tokens_input: 10, tokens_output: 2 });
  const session = mapped(native);
  assert.equal(session.counts.toolCalls, 2, 'all captured tool events remain visible; ownership is not guessed from ids or timestamps');
  assert.equal(session.forkEvidence.activityBasis, 'captured_transcript_including_copied_history');
  assert.equal(session.analysis.tokenStats.recordedSessionCost, 1);
  assert.equal(session.analysis.tokenStats.recordedSessionTotals.input, 10);
  assert.equal(session.analysis.tokenStats.includesCopiedMessageUsage, false);
  const header = session.logicalEvents.find(item => item.subtype === 'opencode_session');
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => native);
  const detail = await buildOpenCodeEventDetail({}, session, header.id, 'protocol');
  validateStructuredLogicalDetailDto(detail);
  assert.match(JSON.stringify(detail), /Activity counts describe the captured transcript, including copied fork history/);
});

test('OpenCode retains interrupted/retrying assistant work, steering turns and context/configuration evidence', () => {
  const records = [row('msg_user', 'user', 1, { text: 'one' }),
    row('msg_partial', 'assistant', 2, { content: [{ type: 'text', text: 'PARTIAL_ANSWER' }],
      retry: { attempt: 2, at: TIME + 20, error: { message: 'TRY_AGAIN' } } }),
    row('msg_steer', 'user', 3, { text: 'STEERING' }),
    row('msg_stop', 'idle', 4, { outcome: 'interrupted' }),
    row('msg_user2', 'user', 5, { text: 'new turn' })];
  for (const [i, type] of ['system', 'synthetic', 'skill', 'agent-switched', 'model-switched', 'location-switched'].entries()) {
    records.push(row('msg_context_' + i, type, i + 6, { text: 'CONTEXT_' + type, description: 'Recorded context',
      model: { providerID: 'fixture', id: 'model-b' }, previous: null }));
  }
  const session = mapped(snapshot(records));
  const main = session.logicalEvents.filter(e => e.layer === 'main');
  assert.equal(main.find(e => e.kind === 'assistant_message').status, 'incomplete');
  assert.equal(main[0].turnId, main.find(e => e.preview === 'STEERING').turnId);
  assert.notEqual(main[0].turnId, main.find(e => e.preview === 'new turn').turnId);
  assert.equal(session.counts.turns, 2);
  assert.equal(session.counts.aborts, 1);
  assert.equal(session.counts.errors, 0, 'interruption is not model failure');
  assert.ok(session.logicalEvents.some(e => e.subtype === 'opencode_retry' && e.searchText.includes('TRY_AGAIN')));
  for (const type of ['system', 'synthetic', 'skill', 'agent-switched', 'model-switched', 'location-switched']) {
    assert.ok(session.logicalEvents.some(e => e.subtype === 'opencode_' + type && e.layer === 'protocol'));
  }
});

test('OpenCode compaction keeps preceding history and fork usage uses authoritative session totals', () => {
  const session = mapped(snapshot([
    row('msg_copied', 'assistant', 1, { content: [{ type: 'text', text: 'COPIED_PREFIX' }], cost: 100,
      tokens: { input: 100000, output: 10000, reasoning: 5, cache: { read: 9000, write: 20 } } }),
    row('msg_compaction', 'compaction', 2, { status: 'completed', reason: 'auto', summary: 'COMPACT_SUMMARY',
      cost: 20, tokens: { input: 3000, output: 100 } }),
    row('msg_child', 'assistant', 3, { content: [tool('subagent', 'completed', { content: [{ type: 'text', text: 'CHILD_RESULT' }],
      metadata: { sessionID: 'ses_child' } })] }),
  ], { parent_id: 'ses_parent', fork_session_id: 'ses_fork_source',
    fork_boundary: JSON.stringify({ type: 'through', messageID: 'msg_original_boundary' }), cost: 0,
    tokens_input: 0, tokens_output: 0, tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0 }));
  assert.equal(session.parentSessionId, sessionIdFor('ses_parent', 'db:test'));
  assert.equal(session.forkedFromSessionId, sessionIdFor('ses_fork_source', 'db:test'));
  assert.notEqual(session.parentSessionId, session.forkedFromSessionId);
  assert.equal(session.forkStorageMode, 'copied_prefix');
  assert.equal(session.forkEvidence.boundary.type, 'through');
  assert.equal(session.analysis.tokenStats.recordedSessionCost, 0);
  assert.equal(session.analysis.tokenStats.recordedSessionTotals.input, 0);
  assert.equal(session.analysis.tokenStats.includesCopiedMessageUsage, false);
  assert.ok(session.logicalEvents.some(e => e.searchText.includes('COPIED_PREFIX')));
  assert.ok(session.logicalEvents.some(e => e.kind === 'compaction' && e.opencode.preservesTranscript));
  assert.equal(session.logicalEvents.find(e => e.toolName === 'subagent').opencode.childSessionId,
    sessionIdFor('ses_child', 'db:test'));
  assert.equal(session.logicalEvents.filter(e => e.subtype === 'opencode_step_usage').length, 1);
});

test('OpenCode fallback retains unknown and malformed evidence while search excludes opaque provider bytes', () => {
  const longText = 'a'.repeat(150000) + 'TAIL_SEARCH_EVIDENCE';
  const native = snapshot([
    row('msg_future', 'future-message', 1, { text: 'FUTURE_RECORD', native: { payload: 'OPAQUE_PROVIDER_BYTES' } }),
    row('msg_unknown_block', 'assistant', 2, { content: [{ type: 'future-block', text: 'FUTURE_BLOCK' },
      { type: 'text', text: longText, native: { signature: 'OPAQUE_PROVIDER_BYTES' } },
      { type: 'tool', name: 'future-tool', state: { status: 'future-state', note: 'FUTURE_TOOL' } }] }),
    { ...row('msg_bad', 'assistant', 3), data: '{broken' },
    row('msg_file', 'user', 4, { text: 'VISIBLE_CAPTION', files: [{ uri: 'data:image/png;base64,OPAQUE_FILE_BYTES', mime: 'image/png' }] }),
  ]);
  const session = mapped(native);
  assert.ok(session.logicalEvents.some(e => e.subtype === 'opencode_unknown_message'));
  assert.ok(session.logicalEvents.some(e => e.subtype.startsWith('opencode_unknown_content_')));
  assert.ok(session.logicalEvents.some(e => e.subtype.startsWith('opencode_unknown_tool_state_')));
  assert.ok(session.logicalEvents.some(e => e.subtype === 'opencode_malformed_message'));
  assert.ok(session.logicalEvents.some(e => e.searchText.includes('TAIL_SEARCH_EVIDENCE')));
  for (const event of [...session.rawEvents, ...session.logicalEvents]) {
    assert.doesNotMatch(event.searchText, /OPAQUE_PROVIDER_BYTES|OPAQUE_FILE_BYTES/);
  }
  assert.equal(native.messages[2].data, '{broken');
  const other = snapshot([], { id: 'ses_test' }); other.source.identity = 'other-database';
  assert.notEqual(mapped(other).id, session.id, 'native ids from separate databases must never alias');
});

test('OpenCode rejects duplicate rows and foreign session membership instead of publishing ambiguous evidence', () => {
  const original = row('msg_one', 'user', 1, { text: 'one' });
  for (const extra of [{ ...original }, { ...original, id: 'msg_other' }, { ...original, id: 'msg_other', seq: 2, session_id: 'ses_foreign' }]) {
    assert.throws(() => mapped(snapshot([original, extra])), { code: 'OPENCODE_INVALID_SNAPSHOT' });
  }
});

test('OpenCode details validate their exact logical envelope and preserve safe content, usage and native Raw rows', async (t) => {
  const native = snapshot([row('msg_user', 'user', 1, { text: '<script>alert(1)</script> **SAFE_TEXT**', files: [{ uri: 'file:///synthetic/file' }] }),
    row('msg_assistant', 'assistant', 2, { content: [tool('shell', 'completed', { content: [{ type: 'text', text: 'TOOL_RESULT' }], metadata: { exit: 0 } }),
      { type: 'reasoning', text: 'THOUGHT' }, { type: 'future-block', text: 'FALLBACK_BLOCK' }],
    cost: 0.01, tokens: { input: 3, output: 2, reasoning: 1, cache: { read: 0, write: 0 } } }),
    row('msg_compact', 'compaction', 3, { status: 'completed', summary: 'SUMMARY', tokens: { input: 4 }, cost: 0.01 })]);
  const session = mapped(native);
  let validations = 0;
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => { validations++; return native; });
  for (const event of session.logicalEvents) {
    const detail = await buildOpenCodeEventDetail({}, session, event.id, event.layer);
    validateStructuredLogicalDetailDto(detail);
    validateLogicalDetailEnvelope(detail, event);
    if (event.kind === 'user_message') {
      const html = detail.timelineSections.find(s => s.type === 'markdown').html;
      assert.doesNotMatch(html, /<script>/);
      assert.match(html, /&lt;script&gt;/);
      assert.match(html, /<strong>SAFE_TEXT<\/strong>/);
    }
    if (event.kind === 'command') assert.match(JSON.stringify(detail), /TOOL_REQUEST.*TOOL_RESULT/s);
  }
  const raw = session.rawEvents.find(r => r.messageId === 'msg_assistant');
  const rawDetail = await buildOpenCodeEventDetail({}, session, raw.rawId, 'raw');
  assert.deepEqual(rawDetail.timelineSections[0].value, native.messages[1]);
  assert.equal(typeof rawDetail.timelineSections[0].value.data, 'string');
  assert.equal(validations, session.logicalEvents.length + 1, 'each detail read validates even a cached materialization');
  t.mock.method(require('../src/opencode'), 'snapshotForSession', async () => { throw Object.assign(new Error('Changed snapshot'), { code: 'INDEXED_SOURCE_STALE' }); });
  await assert.rejects(buildOpenCodeEventDetail({}, session, session.logicalEvents[0].id, 'protocol'), { code: 'INDEXED_SOURCE_STALE' });
});
