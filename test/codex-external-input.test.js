'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { externalToolInputFromRaw } = require('../src/codex-external-input');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

// Synthetic, source-derived from the handoff's Codex e269f216 producer/types.
function raw(fields = {}) {
  return { recordType: 'response_item', payloadType: 'function_call_output', parsed: {
    payload: { type: 'function_call_output', name: 'notifications', output: '外部任务完成', ...fields },
  } };
}

test('external inputs require absent/null identity, valid attribution and output', () => {
  assert.equal(externalToolInputFromRaw(raw()).text, '外部任务完成');
  assert.equal(externalToolInputFromRaw(raw({ call_id: null })).name, 'notifications');
  for (const call_id of ['', 'call-1', 0, false, [], {}]) {
    assert.equal(externalToolInputFromRaw(raw({ call_id })), null);
  }
  for (const name of ['', ' ', 1, null]) assert.equal(externalToolInputFromRaw(raw({ name })), null);
  for (const output of [null, 1, {}, [{ type: 'unknown', text: 'no' }]]) {
    assert.equal(externalToolInputFromRaw(raw({ output })), null);
  }
  assert.equal(externalToolInputFromRaw(raw({ callId: 'conflict' })), null);
});

test('structured external content has bounded readable text without media bytes', () => {
  const result = externalToolInputFromRaw(raw({ namespace: 'example_service', output: [
    { type: 'input_text', text: '第一段' },
    { type: 'input_image', file_id: 'file_example' },
    { type: 'input_image', image_url: 'data:image/png;base64,secret' },
    { type: 'input_text', text: '第二段' },
  ] }));
  assert.deepEqual(result, { name: 'notifications', namespace: 'example_service', text: '第一段\n第二段' });
});

test('valid audio and encrypted output remain external inputs without decoding or indexing opaque bytes', () => {
  const result = externalToolInputFromRaw(raw({ output: [
    { type: 'input_audio', audio_url: 'data:audio/wav;base64,opaque-audio' },
    { type: 'encrypted_content', encrypted_content: 'opaque-encrypted' },
  ] }));
  assert.equal(result.text, '');
  assert.deepEqual(result.opaqueContent, ['input_audio', 'encrypted_content']);
  assert.equal(JSON.stringify(result).includes('opaque-audio'), false);
  assert.equal(JSON.stringify(result).includes('opaque-encrypted'), false);
  assert.equal(externalToolInputFromRaw(raw({ output: [{ type: 'input_image', file_id: 'file_one', image_url: 'data:image/png;base64,a' }] })), null);
});

test('external inputs survive source-backed cold/warm reads without fictional calls or messages', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-external-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const rows = [
    { type: 'session_meta', payload: { id, cwd: repoRoot } },
    { type: 'response_item', payload: { ...raw().parsed.payload, call_id: null, namespace: 'example_service' } },
    { type: 'response_item', payload: { ...raw().parsed.payload, output: '第二条独立消息' } },
    { type: 'response_item', payload: { ...raw().parsed.payload, call_id: '', output: 'invalid-empty' } },
    { type: 'response_item', payload: { type: 'function_call_output', output: 'orphan' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'normal', name: 'example', arguments: '{}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'normal', output: 'normal result' } },
  ].map((row) => ({ timestamp: '2026-09-17T10:00:00.000Z', ...row }));
  await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'sessions', `rollout-${id}.jsonl`), rows.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  const indexed = index.sessionsById.get(id);
  assert.equal(indexed.counts.toolCalls, 1);
  assert.equal(indexed.counts.messages, 0);
  const search = await codex.filterSessions(index, { q: 'example_service', layer: 'main', kind: 'external_tool_input', locale: 'en' });
  assert.equal(search.total, 1);
  assert.equal(search.matchingEventTotal, 1);
  for (let pass = 0; pass < 2; pass += 1) {
    const session = await materializeSessionForIndex(index, indexed);
    const inputs = session.logicalEvents.filter((event) => event.kind === 'external_tool_input');
    assert.equal(inputs.length, 2);
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(inputs[0].status, '');
    assert.equal(inputs[0].severity, 'normal');
    assert.match(inputs[0].searchText, /notifications\nexample_service\n外部任务完成/);
    assert.equal(inputs[0].rawRefs[0].line, 2);
    assert.ok(session.logicalEvents.some((event) => event.layer === 'protocol' && event.rawRefs.some((ref) => ref.line === 4)));
    for (const locale of ['en', 'zh-CN']) {
      const detail = await codex.buildHydratedEventDetail(index, session, inputs[0].id, 'main', { locale });
      assert.match(JSON.stringify(detail.timelineSections), /外部任务完成/);
      assert.match(JSON.stringify(detail.timelineSections), /example_service/);
    }
  }
});
