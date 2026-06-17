'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANONICAL_SCHEMA_VERSION,
  CODEX_JSONL_LINE_LOCATOR_TYPE,
  CODEX_SOURCE_KIND,
  codexSourceLocator,
  createCodexRawParser,
  rawEventsForLogicalEvent,
  rawMatchesEvent,
  rawRef,
} = require('../src/codex-source');

function flattenText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return Object.values(value).map(flattenText).filter(Boolean).join('\n');
  }
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
    extractContentText: (content) => Array.isArray(content) ? content.map((item) => item?.text || '').join('\n').trim() : '',
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

test('Codex source constants and typed locator are stable', () => {
  assert.equal(CANONICAL_SCHEMA_VERSION, 1);
  assert.equal(CODEX_SOURCE_KIND, 'codex');
  assert.equal(CODEX_JSONL_LINE_LOCATOR_TYPE, 'jsonl_line');
  assert.deepEqual(codexSourceLocator({ file: '2026\\06\\10\\rollout.jsonl', line: 42 }), {
    type: 'jsonl_line',
    file: '2026/06/10/rollout.jsonl',
    line: 42,
  });
  assert.equal(codexSourceLocator({ file: 'missing-line.jsonl' }), null);
});

test('raw refs preserve legacy fields and source metadata', () => {
  const raw = {
    rawId: 'session:raw:7',
    source: { file: '2026\\06\\10\\rollout.jsonl', line: 7 },
    recordType: 'event_msg',
    payloadType: 'dynamic_tool_call_begin',
  };

  assert.deepEqual(rawRef(raw), {
    file: '2026\\06\\10\\rollout.jsonl',
    line: 7,
    rawId: 'session:raw:7',
    sourceLocator: {
      type: 'jsonl_line',
      file: '2026/06/10/rollout.jsonl',
      line: 7,
    },
    sourceRecordType: 'event_msg',
    sourceEventType: 'dynamic_tool_call_begin',
  });
});

test('raw matching helpers return source-backed raw rows for logical refs', () => {
  const rawA = { rawId: 'session:raw:1' };
  const rawB = { rawId: 'session:raw:2' };
  const logical = { rawRefs: [{ rawId: rawB.rawId }, { rawId: 'missing' }] };
  const session = { rawEvents: [rawA, rawB] };

  assert.equal(rawMatchesEvent(rawA, logical), false);
  assert.equal(rawMatchesEvent(rawB, logical), true);
  assert.deepEqual(rawEventsForLogicalEvent(session, logical), [rawB]);
});

test('raw parser keeps canonical lifecycle aliases without changing payload type', () => {
  const { makeRawEvent } = makeParser();
  const raw = makeRawEvent({
    timestamp: '2026-06-10T10:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'turn_started',
      turn_id: 'turn-1',
      context: 'runtime marker',
    },
  }, 3, '2026\\06\\10\\rollout.jsonl', 'session-id');

  assert.equal(raw.rawId, 'session-id:raw:3');
  assert.equal(raw.recordType, 'event_msg');
  assert.equal(raw.payloadType, 'turn_started');
  assert.equal(raw.canonicalType, 'task_started');
  assert.equal(raw.turnId, 'turn-1');
  assert.equal(raw.source.file, '2026\\06\\10\\rollout.jsonl');
  assert.equal(raw.source.line, 3);
  assert.deepEqual(rawRef(raw).sourceLocator, {
    type: 'jsonl_line',
    file: '2026/06/10/rollout.jsonl',
    line: 3,
  });
});

test('raw parser preserves unknown records through generic fallback fields', () => {
  const { makeRawEvent } = makeParser();
  const raw = makeRawEvent({
    timestamp: '2026-06-10T10:01:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'future_protocol_shape',
      nested: { message: 'new protocol payload at C:\\Users\\Yijia\\repo' },
      status: 'mystery',
    },
  }, 4, '2026\\06\\10\\rollout.jsonl', 'session-id', [{ previewId: 'image-1' }]);

  assert.equal(raw.rawId, 'session-id:raw:4');
  assert.equal(raw.recordType, 'event_msg');
  assert.equal(raw.payloadType, 'future_protocol_shape');
  assert.equal(raw.canonicalType, 'future_protocol_shape');
  assert.equal(raw.status, 'mystery');
  assert.match(raw.preview, /future_protocol_shape|new protocol payload/);
  assert.match(raw.searchText, /new protocol payload/);
  assert.match(raw.searchText, /C:\\Users\\Yijia\\repo/);
  assert.deepEqual(raw.embeddedImages, [{ previewId: 'image-1' }]);
  assert.equal(raw.parsed.payload.type, 'future_protocol_shape');
  assert.equal(raw.parsed.payload.nested.message, 'new protocol payload at C:\\Users\\Yijia\\repo');
});
