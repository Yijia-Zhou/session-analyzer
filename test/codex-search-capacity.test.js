'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

async function fixture(t, payloads) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-full-search-'));
  let index;
  t.after(async () => { disposeProjectQueryStore(index?.projectQueryStore); await fs.rm(home, { recursive: true, force: true }); });
  const repoRoot = path.join(home, 'repo');
  const folder = path.join(home, 'sessions', '2026', '08', '16');
  const id = '11111111-1111-4111-8111-111111111111';
  await fs.mkdir(repoRoot); await fs.mkdir(folder, { recursive: true });
  const records = [{ type: 'session_meta', payload: { id, cwd: repoRoot } }, ...payloads]
    .map((record, i) => ({ timestamp: `2026-08-16T10:00:${String(i).padStart(2, '0')}Z`, ...record }));
  await fs.writeFile(path.join(folder, `rollout-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  index = await codex.buildSourceBackedIndex({ codexHome: home, repoRoot });
  await validateIndexOwnershipForCommit(index);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(id));
  return { index, session };
}

test('Codex full search preserves body, reasoning, command, async and protocol tails independently', async (t) => {
  const long = (tail) => `${'界'.repeat(20_000)} ${tail}`;
  const { index, session } = await fixture(t, [
    { type: 'event_msg', payload: { type: 'user_message', message: long('body-tail') } },
    { type: 'event_msg', payload: { type: 'agent_message', message: long('assistant-tail') } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: long('summary-tail') }], encrypted_content: 'opaque-encryption' } },
    { type: 'response_item', payload: { type: 'reasoning', content: [{ type: 'reasoning_text', text: long('reasoning-tail') }, { type: 'unknown_reasoning', text: 'opaque-unknown' }] } },
    { type: 'event_msg', payload: { type: 'agent_reasoning', message: long('event-reasoning-tail') } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'command', arguments: JSON.stringify({ command: long('command-tail') }) } },
    { type: 'event_msg', payload: { type: 'exec_command_end', call_id: 'command', command: long('command-tail'), stdout: long('stdout-tail'), stderr: 'short-error', exit_code: 1 } },
    { type: 'event_msg', payload: { type: 'agent_message', delivery: 'async', message: long('async-tail'), questions: [{ title: long('question-tail'), options: [long('option-tail')] }] } },
    { type: 'response_item', payload: { type: 'function_call_output', name: 'external-source', output: [{ type: 'input_text', text: long('external-tail') }, { type: 'input_audio', audio_url: 'opaque-audio' }] } },
    { type: 'event_msg', payload: { type: 'future_protocol_shape', content: long('protocol-tail'), signature: 'opaque-signature',
      nested: { type: 'image', data: 'opaque-media' },
      opaqueBlocks: ['redacted_thinking', 'encrypted_reasoning', 'document', 'video']
        .map((type) => ({ type, text: `opaque-${type}` })),
      ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field${i}`, `field-${i}`])), final: 'after-property-limit' } },
    { type: 'event_msg', payload: { type: 'plan_update', explanation: long('plan-tail') } },
    { type: 'response_item', payload: { type: 'reasoning',
      summary: [{ type: 'summary_text', text: long('independent-summary-tail') }],
      content: [{ type: 'reasoning_text', text: long('independent-content-tail') }] } },
    { type: 'response_item', payload: { type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'same-readable-reasoning' }],
      content: [{ type: 'reasoning_text', text: 'same-readable-reasoning' }] } },
    { type: 'event_msg', payload: { type: 'agent_message', delivery: 'async', message: 'short-async-body',
      questions: [{ title: 'short-async-question' }] } },
    { type: 'event_msg', payload: { type: 'future_protocol_shape', signature: 'early-opaque-signature',
      nested: { type: 'document', text: 'early-opaque-document' }, visible: 'early-public-text' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'search-tool', call_id: 'structured-args',
      arguments: JSON.stringify({ signature: 'early-argument-signature', query: 'argument-public-text',
        media: { type: 'image', data: 'early-argument-media' } }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'structured-args',
      output: JSON.stringify({ signature: 'early-result-signature', result: 'result-public-text' }) } },
  ]);
  for (const [q, layers] of [
    ...['body-tail', 'assistant-tail', 'summary-tail', 'reasoning-tail', 'event-reasoning-tail', 'command-tail', 'stdout-tail', 'short-error', 'async-tail', 'question-tail', 'option-tail', 'external-tail', 'plan-tail', 'independent-summary-tail', 'independent-content-tail'].map((q) => [q, ['main', 'raw']]),
    ['protocol-tail', ['protocol', 'raw']], ['after-property-limit', ['protocol', 'raw']],
    ['early-public-text', ['protocol', 'raw']], ['argument-public-text', ['main', 'raw']], ['result-public-text', ['main', 'raw']],
  ]) for (const layer of layers) {
    const project = await codex.query.filterSessions(index, { q, layer });
    const timeline = codex.query.getTimeline(index, session, { q, layer, limit: 100 });
    assert.equal(project.total, 1, `${q}/${layer}`);
    assert.equal(project.matchingEventTotal, timeline.searchEventCount, `${q}/${layer} event parity`);
    assert.ok(timeline.searchMatchCount > 0);
    assert.ok(timeline.events.every((event) => !Object.hasOwn(event, 'searchText')));
  }
  for (const q of ['opaque-encryption', 'opaque-unknown', 'opaque-signature', 'opaque-media', 'opaque-audio',
    'opaque-redacted_thinking', 'opaque-encrypted_reasoning', 'opaque-document', 'opaque-video',
    'early-opaque-signature', 'early-opaque-document', 'early-argument-signature', 'early-argument-media', 'early-result-signature']) {
    for (const layer of ['main', 'protocol', 'raw']) assert.equal((await codex.query.filterSessions(index, { q, layer })).total, 0, `${q}/${layer}`);
  }
  const reason = session.rawEvents.find((raw) => raw.payloadType === 'agent_reasoning');
  assert.equal(reason.messageText.length, 16_000, 'display extraction remains bounded');
  assert.ok(reason.searchText.endsWith('event-reasoning-tail'));
  for (const layer of ['main', 'raw']) {
    assert.equal(codex.query.getTimeline(index, session, { q: 'same-readable-reasoning', layer }).searchMatchCount, 1);
  }
  assert.equal(codex.query.getTimeline(index, session, { q: 'short-async-body', layer: 'main' }).searchMatchCount, 2,
    'preserve the previous async body occurrence count');
  assert.equal(codex.query.getTimeline(index, session, { q: 'short-async-question', layer: 'main' }).searchMatchCount, 1);
  assert.equal(codex.query.getTimeline(index, session, { q: 'short-async-body', layer: 'raw' }).searchMatchCount, 1);
});

test('Codex Code Mode aggregates over 4 MiB into one searchable operation with original Raw owners', async (t) => {
  const first = `Script running with cell ID 4242\n${'a'.repeat(2_200_000)} first-output-tail`;
  const second = `Script completed\n${'界'.repeat(750_000)} second-output-tail`;
  const { index, session } = await fixture(t, [
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec', input: 'text("capacity");' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec', output: first } },
    { type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait', arguments: '{"cell_id":"4242"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait', output: [
      { type: 'text', text: second },
      { type: 'encrypted_content', encrypted_content: 'opaque-code-mode-encrypted' },
      { type: 'image', data: 'opaque-code-mode-image' },
    ] } },
  ]);
  assert.equal(index.projectQueryStore.schemaVersion, 3);
  const operations = session.logicalEvents.filter((event) => event.kind === 'code_mode_operation');
  assert.equal(operations.length, 1);
  const operation = operations[0];
  assert.ok(Buffer.byteLength(operation.searchText) > 4 * 1024 * 1024);
  assert.deepEqual(operation.rawRefs.map((ref) => ref.rawId), [2, 3, 4, 5].map((line) => `${session.id}:raw:${line}`));
  assert.equal(session.rawEvents.length, 5);
  for (const q of ['first-output-tail', 'second-output-tail', 'first-output-tail Script completed']) {
    const project = await codex.query.filterSessions(index, { q, layer: 'main' });
    const timeline = codex.query.getTimeline(index, session, { q, layer: 'main' });
    assert.equal(project.matchingEventTotal, 1, q);
    assert.equal(timeline.searchEventCount, 1, q);
    assert.deepEqual(timeline.events.filter((event) => event.hasSearchHit).map((event) => event.id), [operation.id]);
  }
  for (const q of ['opaque-code-mode-encrypted', 'opaque-code-mode-image']) {
    for (const layer of ['main', 'protocol', 'raw']) assert.equal((await codex.query.filterSessions(index, { q, layer })).total, 0);
  }
});

test('deep JSON tool arguments retain syntax and searchable tails with and without opaque fields', async (t) => {
  const deep = (leaf) => '{"nested":'.repeat(6000) + leaf + '}'.repeat(6000);
  const { index, session } = await fixture(t, [
    { type: 'response_item', payload: { type: 'function_call', name: 'deep-tool', call_id: 'deep-safe',
      arguments: deep('"deep-readable-tail"') } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'deep-safe', output: 'done' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'deep-tool', call_id: 'deep-filtered',
      arguments: deep('{"signature":"deep-opaque-secret","query":"deep-filtered-tail","__proto__":{"polluted":"safe-own-key"}}') } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'deep-filtered', output: 'done' } },
  ]);
  for (const layer of ['main', 'raw']) {
    for (const q of ['deep-readable-tail', 'deep-filtered-tail', 'safe-own-key']) {
      assert.equal((await codex.query.filterSessions(index, { q, layer })).total, 1);
      assert.ok(codex.query.getTimeline(index, session, { q, layer }).searchMatchCount > 0);
    }
    assert.equal((await codex.query.filterSessions(index, { q: 'deep-opaque-secret', layer })).total, 0);
  }
  assert.equal({}.polluted, undefined);
});
