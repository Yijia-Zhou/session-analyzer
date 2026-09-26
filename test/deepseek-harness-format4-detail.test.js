'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { buildDeepSeekIndex, deepSeekAdapter } = require('../src/deepseek-harness');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');
const { buildEventDetailForSession, materializeSessionForIndex } = require('../src/source-adapters');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');

// Synthetic format 4 evidence follows DSH 0.1.7-rc.2 session/src/types.ts,
// llm/src/assistant-stream.ts, tools/src/ptc.ts and llm/src/message.ts.
async function fixture(t, records, { version = 4, compressed = false } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-v4-detail-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sourceHome = path.join(root, 'sessions');
  const sessionDir = path.join(sourceHome, '--synthetic-project--', 'format4-detail');
  await fsp.mkdir(sessionDir, { recursive: true });
  const header = { type: 'session', version, id: 'format4-detail', createdAt: 1, cwd: root, ...(version === 4 ? { isSeeded: false } : {}), delegationDepth: 0 };
  const rows = records.map((record, seq) => ({ seq, time: seq + 10, ...record }));
  const filename = (version === 0 ? 'session.jsonl' : 'session.v4.jsonl') + (compressed ? '.zstd' : '');
  const lines = [header, ...rows].map(record => JSON.stringify(record) + '\n');
  await fsp.writeFile(path.join(sessionDir, filename), compressed
    ? Buffer.concat(lines.map(line => zstdCompressSync(Buffer.from(line))))
    : lines.join(''));
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot: root });
  assert.equal(index.sessions.length, 1, JSON.stringify(index.sourceDiagnostics));
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  const detail = async (predicate) => {
    const event = session.logicalEvents.find(predicate);
    assert.ok(event, 'expected logical event');
    const result = await buildEventDetailForSession(index, session, event.id, event.layer);
    validateStructuredLogicalDetailDto(result);
    return { event, result };
  };
  return { index, session, detail, rows, header };
}

for (const version of [0, 4]) for (const compressed of [false, true]) {
  test(`format ${version} Raw header detail preserves the header without event decoding (compressed=${compressed})`, async t => {
    const data = await fixture(t, [{ type: 'turn/start', data: { turn: 1 } }], { version, compressed });
    for (const [ordinal, expected] of [data.header, ...data.rows].entries()) {
      const raw = data.session.rawEvents.find(row => row.sourceLocator.recordOrdinal === ordinal);
      assert.ok(raw);
      const detail = await buildEventDetailForSession(data.index, data.session, raw.rawId, 'raw');
      assert.equal(detail.layer, 'raw');
      assert.equal(detail.id, raw.rawId);
      assert.deepEqual(detail.timelineSections[0].value, expected);
      assert.deepEqual(detail.sourceLocator, raw.sourceLocator);
      assert.equal(detail.rawRefs.length, 1);
      assert.equal(detail.rawRefs[0].rawId, raw.rawId);
      assert.ok(!detail.inspectorSections.some(section => section.title === 'Owning workflow run'));
    }
  });
}

function message(role, content, source) {
  return { id: `synthetic-${role}`, role, content: [{ type: 'text', text: content }], source };
}

function toolResult(callId, text, isError = false) {
  return {
    type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1, step: 1,
      message: { ...message('tool', text, { kind: 'tool', callId }), toolCallId: callId, isError },
    },
  };
}

for (const deltas of [false, true]) {
  test(`attempt completed blocks supply authoritative text once in Detail and search (deltas=${deltas})`, async t => {
    const chunk = value => ({ type: 'chunk', time: 20, chunk: value });
    const stream = [chunk({ type: 'block-start', index: 7, blockType: 'text' }),
      ...(deltas ? [{ type: 'text-chunks', time0: 20, index: 7, dt: [], texts: ['stale text '.repeat(2000)] }] : []),
      chunk({ type: 'block-end', index: 7, block: { type: 'text', text: 'COMPLETE_TEXT_MARKER' } }),
      chunk({ type: 'block-start', index: 2, blockType: 'reasoning' }),
      ...(deltas ? [chunk({ type: 'reasoning-delta', index: 2, text: 'stale reasoning' })] : []),
      chunk({ type: 'block-end', index: 2, block: { type: 'reasoning', text: 'COMPLETE_REASON_MARKER' } }),
      chunk({ type: 'text-delta', index: 7, text: 'late text must be ignored' }),
      chunk({ type: 'block-end', index: 7, block: { type: 'text', text: 'second close must be ignored' } }),
      { type: 'text-chunks', time0: 20, index: 9, dt: [1], texts: ['OPEN_', 'PREFIX'] },
      chunk({ type: 'block-end', index: 10, block: { type: 'tool-call', id: 'never', name: 'read', arguments: '{}' } }),
    ];
    const data = await fixture(t, [{ type: 'assistant/attempt', data: { turn: 1, step: 1, stream } }]);
    const { event, result } = await data.detail(e => e.subtype === 'assistant/attempt');
    assert.equal(event.layer, 'protocol'); assert.equal(event.status, '');
    for (const marker of ['COMPLETE_TEXT_MARKER', 'COMPLETE_REASON_MARKER', 'OPEN_PREFIX']) {
      assert.equal(event.searchText.split(marker).length - 1, 1);
      assert.equal(JSON.stringify(result.timelineSections).split(marker).length - 1, 1);
      assert.equal(deepSeekAdapter.query.getTimeline(data.index, data.session, { layer: 'protocol', q: marker }).searchEventCount, 1);
    }
    assert.doesNotMatch(event.searchText, /stale|late text|second close/);
    assert.doesNotMatch(JSON.stringify(result.timelineSections), /stale|late text|second close|no visible text/);
    assert.ok(event.searchText.indexOf('COMPLETE_TEXT_MARKER') < event.searchText.indexOf('COMPLETE_REASON_MARKER'));
    assert.equal(await projectQueryProjectionDigestAsync(data.session, deepSeekAdapter.query.projectQueryPresentation), data.index.sessions[0].queryProjectionDigest);
    assert.equal(data.session.counts.toolCalls, 0); assert.equal(data.session.counts.assistantMessages, 0);
    const raw = data.session.rawEvents.find(r => r.payloadType === 'assistant/attempt');
    assert.deepEqual((await buildEventDetailForSession(data.index, data.session, raw.rawId, 'raw')).timelineSections[0].value.data.stream, stream);
  });
}

test('completed attempt blocks keep bounded projections without truncating Raw', async t => {
  const stream = ['text', 'reasoning'].map((type, index) => ({ type: 'chunk', time: 20 + index,
    chunk: { type: 'block-end', index, block: { type, text: type[0].repeat(16000) + 'RAW_ONLY_TAIL' } } }));
  const data = await fixture(t, [{ type: 'assistant/attempt', data: { turn: 1, step: 1, stream } }]);
  const { event, result } = await data.detail(e => e.subtype === 'assistant/attempt');
  assert.ok(event.searchText.length <= 16000);
  assert.doesNotMatch(JSON.stringify(result.timelineSections), /RAW_ONLY_TAIL/);
  assert.ok(result.timelineSections.some(s => s.html?.includes('t'.repeat(16000))));
  assert.ok(result.timelineSections.some(s => s.html?.includes('r'.repeat(16000))));
  const raw = data.session.rawEvents.find(r => r.payloadType === 'assistant/attempt');
  assert.deepEqual((await buildEventDetailForSession(data.index, data.session, raw.rawId, 'raw')).timelineSections[0].value.data.stream, stream);
});

test('format 4 direct tool results and native PTC dispatches have readable details and exact Raw', async (t) => {
  const nested = { rootCallId: 'outer', parentCallId: 'outer', subCallId: 'inner', name: 'read_file', arguments: { path: 'synthetic.txt' } };
  const data = await fixture(t, [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'outer', name: 'run_code', arguments: '{"code":"return 1","description":"Synthetic PTC"}' } },
    { type: 'tool/ptc-dispatch-start', data: nested },
    { type: 'tool/ptc-dispatch', data: { ...nested, isError: false, content: [{ type: 'text', text: 'nested result content' }] } },
    toolResult('outer', 'outer result content'),
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'plain', name: 'read_file', arguments: '{}' } },
    toolResult('plain', 'direct tool failure', true),
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]);
  const outer = await data.detail(event => event.kind === 'code_mode_operation');
  assert.ok(outer.result.timelineSections.some(section => section.text === 'outer result content'));
  assert.equal(outer.result.timelineSections.find(section => section.title === 'Code').language, undefined);
  const nestedDetail = await data.detail(event => event.channels.includes('tool/ptc-dispatch'));
  assert.ok(nestedDetail.result.timelineSections.some(section => section.text === 'nested result content'));
  assert.ok(nestedDetail.result.timelineSections.some(section => section.code?.includes('synthetic.txt')));
  const plain = await data.detail(event => event.id.endsWith(':tool:plain'));
  assert.equal(plain.event.status, 'failed');
  assert.ok(plain.result.timelineSections.some(section => section.text === 'direct tool failure'));
  const raw = data.session.rawEvents.find(row => row.payloadType === 'tool/result');
  const rawDetail = await buildEventDetailForSession(data.index, data.session, raw.rawId, 'raw');
  assert.deepEqual(rawDetail.timelineSections[0].value, data.rows[5]);
});

test('format 4 attempts, interrupted messages, and system/developer content retain their distinct evidence', async (t) => {
  const stream = [
    { type: 'reasoning-chunks', time0: 11, index: 0, dt: [], texts: ['attempt reasoning'] },
    { type: 'text-chunks', time0: 12, index: 1, dt: [1], texts: ['attempt ', 'prefix'] },
    { type: 'tool-call-chunks', time0: 14, index: 2, dt: [], id: 'never-dispatched', name: 'read_file', args: ['{}'] },
    { type: 'chunk', time: 15, chunk: { type: 'finish', reason: { kind: 'aborted', failure: { message: 'synthetic cancellation', code: 'cancelled' } } } },
  ];
  const data = await fixture(t, [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'request/header', data: { header: { config: { provider: 'stealth', model: 'space-bunny-alpha' } }, reason: 'initial', startsSeries: true } },
    { type: 'system/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: message('system', 'system instructions beyond a short preview', { kind: 'system-prompt' }) } },
    { type: 'developer/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: message('developer', 'developer tool change instructions', { kind: 'agent-session-changes', form: 'notice', summary: 'Tools changed' }) } },
    { type: 'assistant/attempt', data: { turn: 1, step: 1, stream } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: message('assistant', 'committed interrupted prefix', { kind: 'model', provider: 'stealth', model: 'space-bunny-alpha' }), stream: [stream[1]], interrupted: true } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
  ]);
  const attempt = await data.detail(event => event.subtype === 'assistant/attempt');
  assert.equal(attempt.event.layer, 'protocol');
  assert.match(JSON.stringify(attempt.result.timelineSections), /attempt prefix/);
  assert.match(JSON.stringify(attempt.result.timelineSections), /attempt reasoning/);
  assert.match(JSON.stringify(attempt.result.inspectorSections), /no surface message/i);
  assert.ok(attempt.result.inspectorSections.some(section => section.entries?.some(entry => entry.key === 'Finish reason' && entry.value === 'aborted')));
  assert.notEqual(attempt.event.status, 'failed');
  assert.notEqual(attempt.event.status, 'aborted');
  assert.notEqual(attempt.event.severity, 'error');
  const attemptRaw = data.session.rawEvents.find(row => row.payloadType === 'assistant/attempt');
  const attemptRawDetail = await buildEventDetailForSession(data.index, data.session, attemptRaw.rawId, 'raw');
  assert.deepEqual(attemptRawDetail.timelineSections[0].value.data.stream, stream);
  assert.ok(!data.session.logicalEvents.some(event => event.layer === 'main' && event.toolName === 'read_file'));
  const assistant = await data.detail(event => event.kind === 'assistant_message');
  assert.equal(assistant.event.status, 'interrupted');
  assert.match(JSON.stringify(assistant.result.inspectorSections), /interrupted/i);
  assert.match(JSON.stringify(assistant.result.inspectorSections), /Embedded stream/);
  for (const type of ['system/message', 'developer/message']) {
    const context = await data.detail(event => event.subtype === type);
    assert.equal(context.event.layer, 'protocol');
    assert.ok(context.result.timelineSections.some(section => section.type === 'markdown' && section.html.includes('instructions')));
  }
  const header = await data.detail(event => event.subtype === 'request/header');
  assert.doesNotMatch(JSON.stringify(header.result.inspectorSections), /System prompt bytes/);
  assert.match(JSON.stringify(header.result.timelineSections), /Starts series/);
});
