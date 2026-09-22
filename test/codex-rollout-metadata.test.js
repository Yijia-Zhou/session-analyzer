'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

// Synthetic wire fixtures derived from Codex e269f216, history/rollout_payload.rs,
// history/lib.rs and protocol/models.rs as recorded by the 2026-09-17 handoff.
// No real transcript observations; metadata is deliberately not execution proof.
test('rollout metadata stays lossless Raw evidence without duplicate execution or user authority', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-metadata-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const rows = [
    { type: 'session_meta', payload: { id, cwd: repoRoot } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'direct', name: 'example', arguments: '{}' } },
    { type: 'response_item', ordinal: 14, payload: {
      type: 'function_call_output', call_id: 'direct', output: 'visible output',
      internal_chat_message_metadata_passthrough: { cell_id: 'example-cell', executed_tool_calls: [{ name: 'fictional_inner', arguments: {} }], tool_calls_complete: true },
    }, metadata: { client_authored: false, fallback_token_limit_override: 4096 } },
    // Deliberately malformed parallel arrays: upstream rejects this length
    // mismatch; Analyzer must preserve Raw without guessing metadata ownership.
    { type: 'compacted', payload: { message: 'summary', replacement_history: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'inherited context only' }] },
      { type: 'function_call_output', call_id: 'old', output: 'old output' },
    ], replacement_history_metadata: [{ inherited_user_message: true }] } },
    { type: 'event_msg', ordinal: 20, payload: { type: 'future_event', opaque: 'preserved', turn_id: 'turn-explicit' } },
  ].map((row) => ({ timestamp: '2026-09-17T10:00:00.000Z', ...row }));
  await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  const sourceFile = `rollout-${id}.jsonl`;
  await fsp.writeFile(path.join(codexHome, 'sessions', sourceFile), rows.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  const indexed = index.sessionsById.get(id);
  assert.equal(indexed.counts.toolCalls, 1);
  assert.equal(indexed.counts.userMessages, 0);
  const session = await materializeSessionForIndex(index, indexed);
  assert.equal(session.logicalEvents.filter((event) => event.toolName === 'fictional_inner').length, 0);
  for (let line = 1; line <= rows.length; line += 1) {
    const result = await codex.readRawLine(index, sourceFile, line);
    assert.deepEqual(result.parsed, rows[line - 1]);
  }
  assert.equal(session.rawEvents[2].sourceLocator.line, 3, 'ordinal is not the JSONL line');
  assert.equal(session.rawEvents[4].turnId, 'turn-explicit');
});
