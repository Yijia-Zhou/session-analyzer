'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asyncAgentMessageFromRecord,
  asyncMessageIdentityMatches,
  normalizeAsyncQuestions,
} = require('../src/codex-async-message');
const { createCodexRawParser } = require('../src/codex-source');
const { createCodexLogicalBuilder } = require('../src/codex-logical');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

function flattenText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.values(value).map(flattenText).filter(Boolean).join('\n');
  return '';
}

function truncate(value, limit = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function makeParser() {
  return createCodexRawParser({
    commandToText: (command) => Array.isArray(command) ? command.join(' ') : String(command || ''),
    displayValue: (value) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value),
    durationMs: () => 0,
    extractContentText: (content) => Array.isArray(content)
      ? content.map((item) => item?.text || '').join('\n').trim() : '',
    extractEventReasoningText: (payload) => String(payload?.message || payload?.text || '').trim(),
    extractReasoningText: (payload) => String(payload?.summary?.[0]?.text || payload?.content?.[0]?.text || '').trim(),
    firstNonEmpty: (...values) => values.find((value) => value != null && value !== '') || '',
    flattenText,
    formatTokenUsagePreview: () => '',
    safeIso: (value) => new Date(value).toISOString(),
    stringifyValue: (value) => typeof value === 'string' ? value : JSON.stringify(value),
    tokenUsageSearchText: () => '',
    truncate,
  });
}

function makeLogicalBuilder() {
  return createCodexLogicalBuilder({
    messages: {
      ...require('../src/codex-async-message'),
      ...require('../src/codex-attachments'),
      ...require('../src/codex-external-input'),
    },
    agentCoordination: {
      AGENT_COORDINATION_KIND: 'agent_coordination',
      isAgentCoordinationTool: () => false,
    },
    codeMode: {
      deriveCodeModeFacts: () => ({ operationFacts: [], claimedRawIds: new Set() }),
      projectCodeModeOperations: () => ({ operations: [] }),
    },
    reviewLifecycle: { reviewLifecycleFromRaw: () => null },
    envelope: {
      CANONICAL_SCHEMA_VERSION: 1,
      CODEX_SOURCE_KIND: 'codex',
      sanitizeLogicalEnvelopeValue: (value) => value,
      rawRef: require('../src/codex-source').rawRef,
      subAgentActivityEventId: () => '',
    },
    goal: {
      goalResponseFromValue: () => ({ snapshot: null }),
      goalSnapshotFromGoal: () => null,
      goalSnapshotFromRaw: () => null,
      goalSnapshotSignature: () => '',
      goalSnapshotTransition: () => null,
      normalizeGoalStatus: (value) => value || '',
    },
    protocol: {
      classifyProtocolText: () => '',
      humanizeProtocolSubtype: (value) => String(value || ''),
      protocolLabelFor: (value) => String(value || ''),
      protocolPreviewFor: (raw) => raw.preview || raw.payloadType,
    },
    tool: {
      TOOL_LIFECYCLE_EVENT_TYPES: [],
      TOOL_LIFECYCLE_FAMILY: {
        COMMAND: 'command',
        PATCH: 'patch',
        MCP_TOOL: 'mcp_tool',
        IMAGE_GENERATION: 'image_generation',
        DYNAMIC_TOOL: 'dynamic_tool',
        APPROVAL: 'approval',
        HOOK: 'hook',
        COLLABORATION: 'collaboration',
      },
      commandArgsFromRaw: () => null,
      commandToText: (command) => Array.isArray(command) ? command.join(' ') : String(command || ''),
      inferPatchSuccess: () => null,
      isFiniteNumberValue: (value) => Number.isFinite(Number(value)),
      numericExitCode: () => null,
      parseFormattedCommandOutput: () => null,
      parseOutputEnvelope: () => null,
      patchFilesFromPatchInput: () => [],
      touchFilesFromOutputText: () => [],
      isToolLifecycleCallGroupType: () => false,
      isToolLifecycleFamily: () => false,
      isToolLifecycleStandaloneType: () => false,
      toolLifecycleRepresentativeRank: () => 0,
    },
    text: {
      displayValue: (value) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value),
      firstNonEmpty: (...values) => values.find((value) => value != null && value !== '') || '',
      planUpdateText: (raw) => raw.searchText,
      relatedReasoning: () => false,
      truncate,
      uniqueNonEmpty: (values) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))],
    },
    usage: {
      tokenUsageItems: () => [],
      collectUsageLimitItems: () => [],
      rateLimitReachedType: () => '',
    },
  });
}

function makeRaw(parser, record, line) {
  return parser.makeRawEvent(record, line, '2026/09/17/async.jsonl', 'session-async');
}

function legacyRecord(overrides = {}) {
  return {
    timestamp: '2026-09-17T10:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'agent_message',
      message: '请选择输出格式：\n- Markdown\n- JSON',
      phase: 'final_answer',
      delivery: 'async',
      questions: [{ title: '请选择输出格式：', options: ['Markdown', 'JSON'] }],
      ...overrides,
    },
  };
}

function canonicalRecord(overrides = {}) {
  return {
    timestamp: '2026-09-17T10:00:01.000Z',
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: 'turn-1',
      item: {
        type: 'AgentMessage',
        id: 'call-async-1',
        content: [{ type: 'Text', text: '请选择输出格式：\n- Markdown\n- JSON' }],
        phase: 'final_answer',
        delivery: 'async',
        questions: [{ title: '请选择输出格式：', options: ['Markdown', 'JSON'] }],
        ...overrides,
      },
    },
  };
}

test('canonical async questions survive source-backed reuse and hydrated detail while the turn continues', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-async-materialized-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'aaaaaaaa-0917-4917-8917-aaaaaaaaaaaa';
  const row = (payload) => ({ type: 'response_item', timestamp: '2026-09-17T10:00:02.000Z', payload });
  const records = [
    { type: 'session_meta', payload: { id, cwd: repoRoot } },
    row({ type: 'function_call', name: 'request_user_input_async', call_id: 'call-async-1', arguments: '{}' }),
    canonicalRecord(),
    row({ type: 'function_call_output', call_id: 'call-async-1', output: '{"accepted":true}' }),
    row({ type: 'function_call', name: 'example', call_id: 'continued', arguments: '{}' }),
    row({ type: 'function_call_output', call_id: 'continued', output: 'still working' }),
  ];
  await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'sessions', `rollout-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  let index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  for (let pass = 0; pass < 2; pass += 1) {
    const indexed = index.sessionsById.get(id);
    assert.equal(indexed.counts.assistantMessages, 1);
    assert.equal(indexed.counts.userMessages, 0);
    assert.equal(indexed.counts.toolCalls, 2);
    const session = await materializeSessionForIndex(index, indexed);
    const event = session.logicalEvents.find((candidate) => candidate.kind === 'assistant_message');
    assert.equal(event.asyncMessage.delivery, 'async');
    assert.equal(event.status, '');
    assert.match(event.searchText, /Markdown/);
    for (const locale of ['en', 'zh-CN']) {
      const detail = await codex.buildHydratedEventDetail(index, session, event.id, 'main', { locale });
      assert.match(JSON.stringify(detail.timelineSections), /Markdown/);
      assert.match(JSON.stringify(detail.timelineSections), locale === 'en' ? /Asynchronous message/ : /异步消息/);
    }
    index = await codex.buildSourceBackedIndex({ repoRoot, codexHome, previousIndex: index });
  }
});

test('async helper follows pinned legacy and canonical AgentMessage shapes', () => {
  const legacy = asyncAgentMessageFromRecord(legacyRecord());
  assert.deepEqual(legacy, {
    delivery: 'async',
    phase: 'final_answer',
    questions: [{ title: '请选择输出格式：', options: ['Markdown', 'JSON'] }],
    text: '请选择输出格式：\n- Markdown\n- JSON',
    source: 'legacy',
  });
  assert.equal(asyncAgentMessageFromRecord(legacyRecord({ id: 'unsupported-legacy-id' })).itemId, undefined);

  const canonical = asyncAgentMessageFromRecord(canonicalRecord());
  assert.deepEqual(canonical, {
    delivery: 'async',
    phase: 'final_answer',
    itemId: 'call-async-1',
    questions: [{ title: '请选择输出格式：', options: ['Markdown', 'JSON'] }],
    text: '请选择输出格式：\n- Markdown\n- JSON',
    source: 'canonical',
  });
  assert.equal(asyncAgentMessageFromRecord(canonicalRecord({ delivery: undefined })), null);
  assert.equal(asyncAgentMessageFromRecord({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'Message', text: 'ordinary' } } }), null);
});

test('source parser projects async metadata and searchable question text without changing raw identity', () => {
  const parser = makeParser();
  const raw = makeRaw(parser, legacyRecord(), 7);
  assert.equal(raw.rawId, 'session-async:raw:7');
  assert.equal(raw.messageText, '请选择输出格式：\n- Markdown\n- JSON');
  assert.deepEqual(raw.asyncMessage, {
    delivery: 'async',
    phase: 'final_answer',
    questions: [{ title: '请选择输出格式：', options: ['Markdown', 'JSON'] }],
  });
  assert.match(raw.searchText, /Markdown/);
  assert.match(raw.searchText, /JSON/);

  const canonical = makeRaw(parser, canonicalRecord(), 8);
  assert.equal(canonical.messageText, raw.messageText);
  assert.equal(canonical.asyncMessage.itemId, 'call-async-1');
  assert.equal(canonical.parsed.payload.item.type, 'AgentMessage');
});

test('malformed and oversized questions stay bounded and readable', () => {
  const questions = normalizeAsyncQuestions([
    { title: '有效问题', options: ['可选项', '', 42] },
    null,
    { title: '' },
    { title: '自由回答' },
    { title: 'x'.repeat(100000), options: ['y'.repeat(100000)] },
  ]);
  assert.deepEqual(questions.slice(0, 2), [
    { title: '有效问题', options: ['可选项'] },
    { title: '自由回答' },
  ]);
  assert.ok(JSON.stringify(questions).length <= 34000);
});

test('async identity deduplication requires an exact item ID', () => {
  assert.equal(asyncMessageIdentityMatches({ itemId: 'call-1' }, { itemId: 'call-1' }), true);
  assert.equal(asyncMessageIdentityMatches({ itemId: 'call-1', text: 'same', questions: [{ title: 'A' }] }, { itemId: 'call-1', text: 'same', questions: [{ title: 'B' }] }), false);
  assert.equal(asyncMessageIdentityMatches({ itemId: 'call-1' }, { itemId: 'call-1-extra' }), false);
  assert.equal(asyncMessageIdentityMatches({ itemId: ' call-1' }, { itemId: 'call-1' }), false);
  assert.equal(asyncMessageIdentityMatches({ itemId: 'call 1' }, { itemId: 'call 1' }), false);
  assert.equal(asyncMessageIdentityMatches({ itemId: 'x'.repeat(4097) }, { itemId: 'x'.repeat(4097) }), false);
  assert.equal(asyncMessageIdentityMatches({ itemId: '' }, { itemId: '' }), false);
});

test('logical builder keeps async message visible and does not treat accepted output as an answer or turn completion', () => {
  const parser = makeParser();
  const builder = makeLogicalBuilder();
  const records = [
    makeRaw(parser, {
      timestamp: '2026-09-17T10:00:00.000Z',
      type: 'response_item',
      payload: { type: 'function_call', call_id: 'call-async-1', name: 'request_user_input_async', arguments: '{}' },
    }, 1),
    makeRaw(parser, {
      timestamp: '2026-09-17T10:00:00.500Z',
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'call-async-1', output: '{"accepted":true}' },
    }, 2),
    makeRaw(parser, canonicalRecord(), 3),
  ];
  const events = builder.buildLogicalEvents(records);
  const assistant = events.filter((event) => event.kind === 'assistant_message');
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0].asyncMessage.delivery, 'async');
  assert.deepEqual(assistant[0].asyncMessage.questions, [{ title: '请选择输出格式：', options: ['Markdown', 'JSON'] }]);
  assert.equal(events.some((event) => event.kind === 'task_complete'), false);
  assert.equal(events.filter((event) => event.kind === 'other_tool_call').length, 1);
});

test('canonical and legacy rows remain independent because legacy AgentMessageEvent has no item identity', () => {
  const parser = makeParser();
  const builder = makeLogicalBuilder();
  const legacy = makeRaw(parser, legacyRecord({ id: 'call-shared' }), 1);
  const canonical = makeRaw(parser, canonicalRecord({ id: 'call-shared' }), 2);
  const differentQuestions = makeRaw(parser, canonicalRecord({ id: 'call-other', questions: [{ title: '另一问题' }] }), 3);
  const events = builder.buildLogicalEvents([legacy, canonical, differentQuestions]);
  const assistants = events.filter((event) => event.kind === 'assistant_message');
  assert.equal(assistants.length, 3);
  assert.deepEqual(assistants.map((event) => event.rawRefs.map((ref) => ref.line)), [[1], [2], [3]]);
});

test('canonical AgentMessage mirrors merge only on exact compatible identity', () => {
  const parser = makeParser();
  const builder = makeLogicalBuilder();
  const first = makeRaw(parser, canonicalRecord(), 1);
  const exactMirror = makeRaw(parser, canonicalRecord(), 2);
  const crossTurn = canonicalRecord();
  crossTurn.payload.turn_id = 'turn-2';
  const conflictingContent = makeRaw(parser, canonicalRecord({
    content: [{ type: 'Text', text: 'same item id with conflicting content' }],
  }), 4);
  const events = builder.buildLogicalEvents([
    first,
    exactMirror,
    makeRaw(parser, crossTurn, 3),
    conflictingContent,
  ]);
  const assistants = events.filter((event) => event.kind === 'assistant_message');
  assert.equal(assistants.length, 3);
  assert.deepEqual(assistants.map((event) => event.rawRefs.map((ref) => ref.line)), [[1, 2], [3], [4]]);
});

test('canonical async AgentMessage with an explicit foreign thread stays in Protocol', () => {
  const parser = makeParser();
  const builder = makeLogicalBuilder();
  const raw = makeRaw(parser, {
    timestamp: '2026-09-17T10:00:02.000Z',
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      thread_id: 'foreign-session',
      item: {
        type: 'AgentMessage',
        id: 'call-foreign-thread',
        content: [{ type: 'Text', text: 'Foreign canonical message' }],
        phase: 'final_answer',
        delivery: 'async',
      },
    },
  }, 4);

  const events = builder.buildLogicalEvents([raw]);
  assert.equal(events.some((event) => event.kind === 'assistant_message'), false);
  assert.deepEqual(events.map((event) => ({ kind: event.kind, subtype: event.subtype })), [
    { kind: 'protocol', subtype: 'item_completed' },
  ]);
});

test('async legacy text is not deduplicated against an ordinary response mirror without identity', () => {
  const parser = makeParser();
  const builder = makeLogicalBuilder();
  const asyncLegacy = makeRaw(parser, legacyRecord(), 1);
  const ordinaryMirror = makeRaw(parser, {
    timestamp: '2026-09-17T10:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: asyncLegacy.messageText }],
    },
  }, 2);
  const assistants = builder.buildLogicalEvents([asyncLegacy, ordinaryMirror])
    .filter((event) => event.kind === 'assistant_message');
  assert.equal(assistants.length, 2);
  assert.equal(assistants[0].asyncMessage.delivery, 'async');
  assert.equal(assistants[1].asyncMessage, undefined);
});
