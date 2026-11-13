'use strict';

// Minimized synthetic native Qoder records. No real transcript content is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeQoderSession, sanitizeQoderValue } = require('../src/qoder-logical');
const { validateCanonicalMaterializedSessionShape } = require('../src/canonical-contract');

const TIME = '2026-11-01T00:00:00.000Z';
function row(type, uuid, content, parentUuid = null, fields = {}) {
  return { type, uuid, parentUuid, timestamp: TIME, sessionId: 'synthetic', cwd: '/synthetic/repo', version: '1.1.79-hotfix.19',
    message: { role: type, content }, ...fields };
}
const text = (value) => ({ type: 'text', text: value });
const call = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, content, fields = {}) => ({ type: 'tool_result', tool_use_id: id, content, ...fields });
function mapped(rows, sourceFile = 'container/synthetic.jsonl') {
  const document = { id: sourceFile.split('/').at(-1).replace(/\.jsonl$/, ''), cwd: '/synthetic/repo',
    rows: rows.map((parsed, index) => ({ line: index + 1, parsed, parseError: null })),
    lines: rows.map((item) => JSON.stringify(item)), acceptedBytes: Buffer.byteLength(rows.map((item) => JSON.stringify(item)).join('\n')) };
  const before = JSON.stringify(document);
  const session = makeQoderSession(document, sourceFile);
  const { rawEvents, logicalEvents, analysis, presentationIndexes, ...carried } = session;
  const indexed = { ...structuredClone(carried), materializationDescriptor: { schemaVersion: 1,
    dependencySetId: 'synthetic-dependency', sourceSnapshotId: 'synthetic-snapshot', payload: {} },
  queryShardId: session.id, queryProjectionDigest: 'a'.repeat(43) };
  session.materializationSnapshotId = 'synthetic-snapshot';
  validateCanonicalMaterializedSessionShape(indexed, session, 'qoder');
  assert.equal(JSON.stringify(document), before, 'mapping does not rewrite native source objects');
  return session;
}
const main = (session) => session.logicalEvents.filter((event) => event.layer === 'main');
const tools = (session) => session.logicalEvents.filter((event) => event.toolName);

test('Qoder preserves native content order, exact block references, message counts and canonical shape', () => {
  const session = mapped([
    row('user', 'u', [text('Synthetic request'), text('Second paragraph')]),
    row('assistant', 'a', [{ type: 'thinking', thinking: 'Inspect the synthetic input', signature: 'OPAQUE_SIGNATURE' },
      text('I will inspect it.'), call('read', 'Read', { file_path: '/synthetic/repo/input.txt', start_line: 2, end_line: 4 }),
      call('shell', 'Bash', { command: 'printf CHECK' })], 'u'),
    row('user', 'r', [result('read', 'READ_RESULT'), result('shell', 'SHELL_RESULT')], 'a', { sourceToolAssistantUUID: 'a' }),
    row('assistant', 'done', [text('Done')], 'r'),
  ]);
  assert.deepEqual(main(session).map((event) => event.kind), ['user_message', 'user_message', 'reasoning', 'assistant_message',
    'other_tool_call', 'command', 'assistant_message']);
  assert.equal(session.rawEventCount, 4);
  assert.equal(session.counts.messages, 3);
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.assistantMessages, 2);
  assert.equal(session.counts.turns, 1);
  assert.equal(session.counts.toolCalls, 2);
  assert.equal(session.counts.reasoning, 1);
  assert.deepEqual(tools(session).map((event) => event.qoder.blockIndex), [2, 3]);
  assert.deepEqual(tools(session).map((event) => event.qoder.resultBlockIndex), [0, 1]);
  assert.deepEqual(tools(session).map((event) => event.qoder.output), ['READ_RESULT', 'SHELL_RESULT']);
  for (const event of tools(session)) {
    assert.equal(event.qoder.pairing, 'exact_call_source_uuid');
    assert.deepEqual(event.rawRefs.map((ref) => ref.line), [2, 3]);
    assert.deepEqual(event.sourceLocator, { type: 'jsonl_line', file: 'container/synthetic.jsonl', line: 2 });
  }
  assert.doesNotMatch(JSON.stringify(session), /OPAQUE_SIGNATURE/);
});

test('Qoder uses exact sourceToolAssistantUUID or unique earlier ancestry and preserves physical branches', () => {
  const session = mapped([
    row('user', 'root', [text('First request')]),
    row('assistant', 'a', [call('unlinked', 'Bash', { command: 'printf A' })], 'root'),
    row('user', 'sibling', [text('Replacement request')], 'root'),
    { type: 'active-leaf', leafUuid: 'sibling', explicit: true, rewound: true, timestamp: TIME },
    row('user', 'wrong-branch', [result('unlinked', 'SIBLING_OUTPUT')], 'sibling'),
    row('assistant', 'b', [call('explicit', 'Read', { file_path: '/synthetic/repo/a' })], 'root'),
    row('user', 'explicit-result', [result('explicit', 'EXPLICIT_OUTPUT')], 'sibling', { sourceToolAssistantUUID: 'b' }),
    row('assistant', 'c', [call('ancestry', 'Read', { file_path: '/synthetic/repo/b' })], 'root'),
    row('assistant', 'between', [text('Intermediate native message')], 'c'),
    row('user', 'ancestry-result', [result('ancestry', 'ANCESTRY_OUTPUT')], 'between'),
  ]);
  assert.equal(tools(session)[0].status, 'incomplete');
  assert.equal(tools(session)[0].qoder.output, '');
  assert.equal(tools(session)[1].qoder.pairing, 'exact_call_source_uuid');
  assert.equal(tools(session)[2].qoder.pairing, 'exact_call_ancestry');
  assert.ok(session.logicalEvents.some((event) => event.subtype.startsWith('qoder_unpaired_tool_result')));
  assert.equal(session.rawEventCount, 10);
  assert.equal(session.counts.turns, 2);
  assert.equal(tools(session)[2].turnId, main(session)[0].turnId, 'older branch keeps its own ancestor turn');
  assert.notEqual(tools(session)[2].turnId, main(session).find((event) => event.preview === 'Replacement request').turnId);
  assert.equal(session.logicalEvents[0].qoder.historyView, 'physical');
  assert.ok(session.logicalEvents.some((event) => event.subtype === 'active-leaf'));
});

test('Qoder fails closed on duplicate identities, duplicate results, conflicting owners and forward results', () => {
  const cases = [
    [row('assistant', 'same', [call('c', 'Bash', { command: 'printf X' })]), row('assistant', 'same', [text('duplicate UUID')]),
      row('user', 'r', [result('c', 'DUPLICATE_UUID')], 'same', { sourceToolAssistantUUID: 'same' })],
    [row('assistant', 'a', [call('c', 'Bash', { command: 'printf X' }), call('c', 'Bash', { command: 'printf Y' })]),
      row('user', 'r', [result('c', 'DUPLICATE_CALL')], 'a')],
    [row('assistant', 'a', [call('c', 'Bash', { command: 'printf X' })]),
      row('user', 'r', [result('c', 'DUPLICATE_RESULT'), result('c', 'SECOND_RESULT')], 'a')],
    [row('assistant', 'a', [call('c', 'Bash', { command: 'printf X' })]),
      row('user', 'r', [result('c', 'CONFLICTING_OWNER')], 'a', { sourceToolAssistantUUID: 'other' })],
    [row('user', 'r', [result('c', 'FORWARD_RESULT')], 'a'), row('assistant', 'a', [call('c', 'Bash', { command: 'printf X' })])],
    [row('assistant', 'a', [call('c', 'Bash', { command: 'printf X' })]),
      row('user', 'r', [result('c', 'FOREIGN_SESSION')], 'a', { sourceToolAssistantUUID: 'a', sessionId: 'other-session' })],
  ];
  for (const rows of cases) {
    const session = mapped(rows);
    assert.ok(tools(session).length);
    for (const event of tools(session)) {
      assert.equal(event.status, 'incomplete');
      assert.equal(event.qoder.pairing, 'missing_or_ambiguous_result');
      assert.equal(event.rawRefs.length, 1);
      assert.equal(event.qoder.output, '');
    }
    assert.ok(session.logicalEvents.some((event) => event.subtype.startsWith('qoder_unpaired_tool_result')));
  }
});

test('Qoder distinguishes foreground failure, background launch, cancellation and agent termination receipts', () => {
  const scenarios = [
    ['Bash', { command: 'exit 7' }, { kind: 'completed', exitCode: 7, interrupted: false, stdout: '', stderr: 'FAILED' }, {}, 'failed'],
    ['Bash', { command: 'start', is_background: true }, { kind: 'backgrounded', taskId: 'synthetic-task', outputFile: '/synthetic/no-read', pid: 2 }, {}, 'incomplete'],
    ['Bash', { command: 'cancel' }, { kind: 'tool-status', status: 'cancelled', isHardFailure: false, summary: 'Cancelled' }, { is_error: true }, 'incomplete'],
    ['Bash', { command: 'ok' }, { kind: 'completed', exitCode: 0, interrupted: false }, {}, 'success'],
    ['Agent', { prompt: 'Synthetic task', subagent_type: 'Explore' }, { isAsync: true, status: 'async_launched', agentId: 'agent-one' }, {}, 'incomplete'],
    ['Agent', { prompt: 'Synthetic task', subagent_type: 'Explore' }, { kind: 'agent-result', state: 'error', apiError: 'SYNTHETIC_ERROR' }, {}, 'failed'],
    ['Read', { file_path: '/synthetic/missing' }, { isHardFailure: false }, { is_error: true }, 'failed'],
  ];
  const rows = scenarios.flatMap(([name, input, toolUseResult, fields], index) => [
    row('assistant', `a${index}`, [call(`c${index}`, name, input)]),
    row('user', `r${index}`, [result(`c${index}`, 'Recorded result', fields)], `a${index}`, { toolUseResult }),
  ]);
  const session = mapped(rows);
  assert.deepEqual(tools(session).map((event) => event.status), scenarios.map((item) => item[4]));
  assert.equal(tools(session)[0].outputStats.exitCode, 7);
  assert.equal(tools(session)[2].qoder.resultStatus, 'cancelled');
  assert.equal(tools(session)[1].qoder.toolResult.outputFile, '/synthetic/no-read');
  assert.equal(session.counts.failedCommands, 1);
  assert.equal(session.counts.issueEvents, 3);
});

test('Qoder preserves native tool argument variants, planning facets, MCP identity and only successful changes', () => {
  const requests = [
    ['Write', { file_path: '/synthetic/file', file_content: 'NATIVE_CONTENT' }, false],
    ['Edit', { file_path: '/synthetic/file', replacements: [{ old_string: 'old', new_string: 'new' }], allow_multiple: true }, false],
    ['DeleteFile', { file_path: '/synthetic/missing' }, true],
    ['TodoWrite', { todos: [{ description: 'Inspect', status: 'in_progress' }] }, false],
    ['TaskCreate', { subject: 'Synthetic task', description: 'Synthetic description' }, false],
    ['Grep', { path: '/synthetic', regex: 'needle' }, false],
    ['Glob', { query: '*.txt' }, false],
    ['mcp_call', { toolName: 'Bash', arguments: { command: 'NOT_NATIVE_BASH' } }, false],
    ['Bash', { __qoder_unparsed_tool_input: 'bad', command: 'NOT_PARSED' }, false],
    ['constructor', { file_path: '/synthetic/not-native' }, false],
  ];
  const session = mapped(requests.flatMap(([name, input, is_error], index) => [
    row('assistant', `a${index}`, [call(`c${index}`, name, input)]),
    row('user', `r${index}`, [result(`c${index}`, 'Recorded result', { is_error })], `a${index}`),
  ]));
  const events = tools(session);
  assert.deepEqual(events.slice(0, 7).map((event) => event.qoder.activity), ['write', 'edit', 'delete', 'plan', 'plan', 'search', 'search']);
  assert.equal(events[0].qoder.arguments.file_content, 'NATIVE_CONTENT');
  assert.equal(events[4].subtype, 'TaskCreate');
  assert.equal(events[7].qoder.requestedToolName, 'Bash');
  assert.equal(events[7].kind, 'other_tool_call');
  assert.equal(events[7].qoder.command, '');
  assert.equal(events[8].qoder.argumentsValid, false);
  assert.equal(events[8].kind, 'other_tool_call');
  assert.equal(events[9].qoder.activity, '');
  assert.deepEqual(events[9].touchedFiles, []);
  assert.equal(session.counts.planEvents, 2);
  assert.equal(session.counts.patches, 2);
  assert.deepEqual(session.analysis.patchedFiles, [{ file: '/synthetic/file', count: 2 }]);
});

test('Qoder joins only exact compaction boundary/summary records and keeps runtime input outside user counts', () => {
  const session = mapped([
    row('user', 'human', [text('Visible request')], null, { origin: { kind: 'human' }, humanInput: { text: 'Recorded plain request', mode: 'prompt' } }),
    row('user', 'meta', [text('TASK_NOTIFICATION')], 'human', { isMeta: true, origin: { kind: 'task-notification' } }),
    { type: 'system', uuid: 'boundary', parentUuid: null, logicalParentUuid: 'meta', timestamp: TIME, subtype: 'compact_boundary',
      isCompactSummary: true, content: 'Compaction boundary', requiresActiveLeafCommit: true,
      compactMetadata: { trigger: 'auto', preTokens: 10, postTokens: 3, messagesSummarized: 2, durationMs: 4 } },
    row('user', 'summary', [text('SYNTHETIC_SUMMARY')], 'boundary', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    { type: 'active-leaf', leafUuid: 'summary', compactBoundaryUuid: 'boundary', explicit: true },
    row('user', 'injected', [text('RUNTIME_INPUT')], 'summary', { origin: { kind: 'stream-recovery' } }),
    { type: 'attachment', uuid: 'attachment', parentUuid: 'summary', attachment: { type: 'plan_file_reference', planContent: 'SYNTHETIC_PLAN', planFilePath: '/synthetic/no-read' } },
    row('assistant', 'api-error', [text('SYNTHETIC_API_ERROR')], 'summary', { isApiErrorMessage: true, error: 'api_error' }),
    row('assistant', 'abort', [text('Partial response')], 'api-error', { aborted: true }),
  ]);
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.turns, 1);
  assert.equal(session.counts.compactions, 1);
  assert.equal(session.counts.errors, 1);
  assert.equal(session.counts.aborts, 1);
  const compaction = main(session).find((event) => event.kind === 'compaction');
  assert.equal(compaction.qoder.text, 'SYNTHETIC_SUMMARY');
  assert.equal(compaction.qoder.summaryPaired, true);
  assert.deepEqual(compaction.rawRefs.map((ref) => ref.line), [3, 4]);
  assert.equal(compaction.qoder.compactMetadata.messagesSummarized, 2);
  assert.ok(session.logicalEvents.some((event) => event.qoder.attachment?.planContent === 'SYNTHETIC_PLAN'));
  assert.equal(session.title, 'Visible request');
});

test('Qoder retains unknown shapes and malformed lines through Protocol/Raw without inventing user turns', () => {
  const session = mapped([
    row('user', 'unknown', [{ type: 'future_user_payload', text: 'UNKNOWN_BLOCK' }]),
    row('user', 'bad-marker', [text('INVALID_MARKER')], null, { isMeta: 'true' }),
    row('assistant', 'future', [{ type: 'future_thinking', text: 'FUTURE_THINKING' }]),
    { type: 'future-record', payload: { note: 'FUTURE_RECORD' } },
  ]);
  assert.equal(session.counts.turns, 0);
  assert.equal(session.counts.messages, 0);
  assert.equal(session.rawEventCount, 4);
  assert.match(session.logicalEvents.map((event) => event.searchText).join('\n'), /UNKNOWN_BLOCK|FUTURE_RECORD/);
  const malformed = makeQoderSession({ id: 'malformed', cwd: '/synthetic/repo', acceptedBytes: 4, lines: ['{bad'],
    rows: [{ line: 1, parsed: null, parseError: 'Unexpected token' }] }, 'container/malformed.jsonl');
  assert.equal(malformed.rawEvents[0].recordType, 'malformed');
  assert.ok(malformed.logicalEvents.some((event) => event.subtype === 'malformed_json'));
});

test('Qoder omits image payloads and signatures from projections while retaining per-block image identity', () => {
  const secret = 'SYNTHETIC_ENCODED_IMAGE_PAYLOAD';
  const session = mapped([
    row('user', 'image-user', [text('Inspect the synthetic image'),
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: secret } }]),
    row('assistant', 'image-call', [call('image-read', 'Read', { file_path: '/synthetic/image.png' })], 'image-user'),
    row('user', 'image-result', [result('image-read', [{ type: 'image', source: { type: 'url', url: `data:image/png;base64,${secret}` } }])], 'image-call'),
    row('assistant', 'reason', [{ type: 'thinking', thinking: 'Readable reasoning', signature: 'SYNTHETIC_SIGNATURE' }], 'image-result'),
  ]);
  const event = main(session).find((item) => item.qoder.imageMessage);
  assert.equal(event.qoder.blockIndex, 1);
  assert.equal(event.qoder.images[0].mediaType, 'image/png');
  assert.equal(session.counts.userMessages, 1);
  assert.equal(tools(session)[0].qoder.resultBlockIndex, 0);
  assert.equal(tools(session)[0].qoder.output, '');
  assert.doesNotMatch(JSON.stringify(session), /SYNTHETIC_ENCODED_IMAGE_PAYLOAD|SYNTHETIC_SIGNATURE/);
  const unknown = sanitizeQoderValue({ type: 'image', source: { type: 'future-encoding', data: secret } });
  assert.doesNotMatch(JSON.stringify(unknown), /SYNTHETIC_ENCODED_IMAGE_PAYLOAD/);
  assert.equal(Object.getPrototypeOf(sanitizeQoderValue(JSON.parse('{"__proto__":{"safe":"value"}}'))), Object.prototype);
  assert.equal({}.safe, undefined);
});

test('Qoder retains zero recorded token usage, physical child identity and metadata titles', () => {
  const session = mapped([
    row('user', 'child-input', [text('Delegated synthetic task')], null, { agentId: 'child-id', parent_tool_use_id: 'parent-call' }),
    row('assistant', 'answer', [text('Done')], 'child-input', { agentId: 'child-id', parent_tool_use_id: 'parent-call',
      message: { role: 'assistant', content: [text('Done')], model: 'native-model', usage: { input_tokens: 0, output_tokens: 0, credits: 1.25, context_usage_ratio: 0.5 } } }),
    { type: 'custom-title', customTitle: 'Synthetic child title' },
  ], 'container/parent/subagents/agent-child-id.jsonl');
  assert.equal(session.title, 'Synthetic child title');
  assert.equal(session.sourceSessionId, 'agent-child-id');
  assert.equal(session.sourceDerivedId, 'child-id');
  assert.equal(session.parentSessionId, 'qoder:container%002fparent%002ejsonl');
  assert.equal(main(session)[0].label, 'Subagent input');
  assert.equal(main(session)[0].qoder.inputScope, 'subagent');
  assert.equal(session.sourceClientVersion, '1.1.79-hotfix.19');
  const usage = session.logicalEvents.find((event) => event.subtype === 'qoder_usage');
  assert.deepEqual(usage.qoder.usage, { input_tokens: 0, output_tokens: 0, credits: 1.25, context_usage_ratio: 0.5 });
  assert.equal(session.analysis.tokenStats.maxObserved, 0);
});
