'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { importUsage } = require('../scripts/import-history-codex-usage');
const { normalizeUsage } = require('../scripts/aggregate-history-eval');

const identity = { condition: 'raw', trial: 'synthetic', corpusHash: 'a'.repeat(64), model: 'synthetic-model' };
const complete = { exitCode: 0, subagents: 'disabled' };
const thread = { type: 'thread.started', thread_id: 'synthetic-thread' };
const started = { type: 'turn.started' };
const done = (usage) => ({ type: 'turn.completed', usage });
const baseUsage = { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20 };
function file(t, events) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, 'tmp/history-usage-test-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const target = path.join(directory, 'events.jsonl');
  fs.writeFileSync(target, events.map((event) => typeof event === 'string' ? event : JSON.stringify(event)).join('\n') + '\n');
  return target;
}

test('usage imports raw single-turn counters without inventing totals, reasoning or cost', (t) => {
  const events = file(t, [thread, started, done(baseUsage)]);
  const result = importUsage(events, identity, complete);
  const entry = result.usage[0];
  assert.equal(result.audit.complete, true);
  assert.equal(entry.inputTokens, 100); assert.equal(entry.cachedInputTokens, 60); assert.equal(entry.outputTokens, 20);
  assert.equal(entry.totalTokens, null); assert.equal(entry.reasoningTokens, null); assert.equal(entry.costUsd, null);
  assert.equal(entry.provenance.eventsSha256, sha256(fs.readFileSync(events)));
  assert.deepEqual(result.audit.reported[0].raw, baseUsage);
  assert.deepEqual(normalizeUsage(result.usage), result.usage);
});

test('missing usage fields stay null; invalid numbers fail coverage instead of becoming zero', (t) => {
  const result = importUsage(file(t, [thread, started, done({ input_tokens: 0, output_tokens: 0 })]), identity, complete);
  assert.equal(result.usage[0].inputTokens, 0);
  assert.equal(result.usage[0].cachedInputTokens, null);
  const invalid = importUsage(file(t, [thread, started, done({ input_tokens: -1, output_tokens: 3.5 })]), identity, complete);
  assert.equal(invalid.audit.complete, false);
  assert.equal(invalid.usage[0].inputTokens, null);
  assert.deepEqual(invalid.audit.issues, ['invalid_input_tokens:3', 'invalid_output_tokens:3']);
});

test('native 0.169 reasoning_output_tokens is preserved without double counting or accepting alias conflicts', (t) => {
  const reported = { ...baseUsage, reasoning_output_tokens: 12, cache_write_input_tokens: 4 };
  const result = importUsage(file(t, [thread, started, done(reported)]), identity, complete);
  assert.equal(result.usage[0].reasoningTokens, 12);
  assert.equal(result.usage[0].outputTokens, 20);
  assert.equal(result.usage[0].totalTokens, null);
  assert.equal(result.audit.reported[0].raw.cache_write_input_tokens, 4);
  const conflict = importUsage(file(t, [thread, started, done({ ...reported, reasoning_tokens: 13 })]), identity, complete);
  assert.equal(conflict.audit.complete, false);
  assert.equal(conflict.usage[0].reasoningTokens, null);
  assert.ok(conflict.audit.issues.includes('conflicting_reasoning_tokens:3'));
});

test('failed, timed out and truncated streams preserve observed usage but cannot claim trial totals', (t) => {
  for (const options of [{ exitCode: 1 }, { exitCode: 0, timedOut: true }, { exitCode: 0, cancelled: true }, { exitCode: 0, signal: 'SIGTERM' }]) {
    const result = importUsage(file(t, [thread, started, done(baseUsage)]), identity, { ...complete, ...options });
    assert.equal(result.audit.complete, false);
    assert.equal(result.usage[0].inputTokens, null);
    assert.equal(result.audit.observed.inputTokens, 100);
    assert.ok(result.audit.issues.includes('process_not_successfully_completed'));
  }
  const partial = importUsage(file(t, [thread, started, done(baseUsage), started, '{"type":']), identity, complete);
  assert.equal(partial.usage[0].inputTokens, null);
  assert.equal(partial.audit.observed.inputTokens, 100);
  assert.ok(partial.audit.issues.includes('unfinished_turn'));
  assert.ok(partial.audit.issues.includes('invalid_event_line:5'));
  const failed = importUsage(file(t, [thread, started, { type: 'turn.failed', error: { message: 'synthetic' } }]), identity, complete);
  assert.equal(failed.audit.complete, false);
  assert.equal(failed.audit.observed.inputTokens, null);
  const uncaptured = importUsage(file(t, [thread, started, done(baseUsage)]), identity, { ...complete, captureComplete: false });
  assert.equal(uncaptured.audit.complete, false);
  assert.ok(uncaptured.audit.issues.includes('process_capture_incomplete'));
});

test('multiple turns need explicit delta semantics and fields sum only when every turn reports them', (t) => {
  const events = file(t, [thread, started, done({ ...baseUsage, total_tokens: 120, reasoning_tokens: 10 }), started,
    done({ input_tokens: 200, cached_input_tokens: 100, output_tokens: 40, total_tokens: 240 })]);
  const unknown = importUsage(events, identity, complete);
  assert.equal(unknown.usage[0].inputTokens, null);
  assert.ok(unknown.audit.issues.includes('multiple_turn_usage_semantics_unverified'));
  const result = importUsage(events, identity, { ...complete, usageSemantics: 'per-turn-delta' });
  assert.equal(result.audit.complete, true);
  assert.equal(result.usage[0].inputTokens, 300); assert.equal(result.usage[0].cachedInputTokens, 160);
  assert.equal(result.usage[0].outputTokens, 60); assert.equal(result.usage[0].totalTokens, 360);
  assert.equal(result.usage[0].reasoningTokens, null);
});

test('unconfirmed or observed subagents, duplicate threads and unmatched completions cannot certify coverage', (t) => {
  const unconfirmed = importUsage(file(t, [thread, started, done(baseUsage)]), identity, { exitCode: 0 });
  assert.equal(unconfirmed.audit.complete, false);
  const observed = importUsage(file(t, [thread, started, { type: 'item.completed', item: { type: 'collab_tool_call' } }, done(baseUsage)]), identity, complete);
  assert.equal(observed.audit.complete, false);
  assert.equal(observed.usage[0].inputTokens, null);
  const duplicate = importUsage(file(t, [thread, thread, started, done(baseUsage), done(baseUsage)]), identity, { ...complete, usageSemantics: 'per-turn-delta' });
  assert.equal(duplicate.audit.complete, false);
  assert.ok(duplicate.audit.issues.includes('invalid_thread_start:2'));
  assert.ok(duplicate.audit.issues.includes('unmatched_completed_turn:5'));
  assert.throws(() => importUsage(file(t, []), { ...identity, corpusHash: 'wrong' }, complete), /fixed condition/u);
});
