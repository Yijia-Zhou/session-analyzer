'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { buildRawTurnOwnershipIndex } = require('../src/codex-cache-observation');
const { COMPARISON_STATE } = require('../src/cache-observation');

// Synthetic, source-shaped fixtures; no real CLI/daemon writer was exercised.
// Source: rust-v0.160.0, history/src/rollout_payload.rs (CompactedItemWire),
// history/src/compaction_resume_metadata.rs and protocol/src/protocol.rs.
// The checkpoints restore context; their nested messages/settings/usage are
// deliberately not fresh execution or new authoritative request observations.
const ID = 'aaaaaaaa-0160-4160-8160-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-0160-4160-8160-bbbbbbbbbbbb';
const event = (type, fields = {}) => ({ type: 'event_msg', payload: { type, ...fields } });
const message = (text) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const usage = (input, cached = 0) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
  output_tokens: 0, reasoning_output_tokens: 0, total_tokens: input,
});
const tokens = (input, cached) => event('token_count', { info: { last_token_usage: usage(input, cached) } });
const typedCompaction = (fields = {}) => event('item_completed', {
  thread_id: ID, turn_id: 'compaction-turn', completed_at_ms: 1790935204000,
  item: { type: 'ContextCompaction', id: 'compact-1' }, ...fields,
});
const checkpoint = (number = 1) => ({ type: 'compacted', payload: {
  message: 'synthetic summary', window_number: number, window_id: `window-${number}`,
  replacement_history: [message('checkpoint-only user').payload,
    { type: 'function_call', call_id: 'checkpoint-only-call', name: 'fictional', arguments: '{}' },
    { type: 'function_call_output', call_id: 'checkpoint-only-call', output: 'historical result' }],
  latest_token_usage_record: {
    thread_id: ID, turn_id: 'old-turn', session_id: ID, root_turn_id: 'old-turn', response_id: 'old-response',
    usage: usage(999999), turn_token_usage: usage(999999), thread_token_usage: usage(999999),
  },
  resume_metadata: { multi_agent_version: 'v2', last_started_turn_id: 'old-turn',
    previous_turn_settings: { model: 'checkpoint-only-model', comp_hash: 'old-hash', realtime_active: false } },
} });
const stamp = (records, start = 0) => records.map((record, i) => ({
  timestamp: new Date(Date.parse('2026-10-02T10:00:00.000Z') + (start + i) * 1000).toISOString(), ...record,
}));

async function fixture(t, records) {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0160-checkpoint-'));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const root = path.join(codexHome, 'sessions');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(repoRoot);
  const rows = stamp([{ type: 'session_meta', payload: { id: ID, cwd: repoRoot, model: 'observed-model' } }, ...records]);
  const file = path.join(root, `rollout-${ID}.jsonl`);
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  return { rows, file, root, options: { codexHome, repoRoot } };
}

test('checkpoint history and resume metadata stay non-executing across source, compact, reused and appended reads', async (t) => {
  const f = await fixture(t, [event('task_started', { turn_id: 'first' }), message('actual input'),
    tokens(16384, 16384), checkpoint(), checkpoint(2),
    { type: 'compacted', payload: { message: 'legacy checkpoint without resume metadata' } }, tokens(12288, 8192)]);
  let previousIndex;
  for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build({ ...f.options, previousIndex });
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(ID))
      : index.sessionsById.get(ID);
    assert.equal(session.counts.userMessages, 1);
    assert.equal(session.counts.toolCalls, 0);
    assert.equal(session.analysis.tokenStats.maxObserved, 0, 'checkpoint totals cannot create usage-limit statistics');
    assert.equal(session.logicalEvents.filter((e) => e.layer === 'main' && /checkpoint-only/.test(e.preview)).length, 0);
    const observed = session.logicalEvents.filter((e) => e.cacheObservation);
    if (build === codex.buildSourceBackedIndex) {
      assert.equal(observed.length, 2);
      assert.equal(observed[1].cacheObservation.comparison.state, COMPARISON_STATE.COMPACTION_BOUNDARY);
    }
    const checkpointRaw = session.rawEvents.find((r) => r.recordType === 'compacted');
    const raw = await codex.readRawLine(index, checkpointRaw.source.file, checkpointRaw.source.line);
    assert.deepEqual(raw.parsed.payload, checkpoint().payload);
    previousIndex = index;
  }
  await fs.appendFile(f.file, stamp([tokens(10000, 7000)], f.rows.length).map(JSON.stringify).join('\n') + '\n');
  const appended = await codex.buildSourceBackedIndex({ ...f.options, previousIndex });
  const session = await materializeSessionForIndex(appended, appended.sessionsById.get(ID));
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.toolCalls, 0);
  assert.equal(session.logicalEvents.filter((e) => e.cacheObservation).length, 3);
});

test('saved pre-start input after a completed turn or failed compaction never belongs to the old turn', async (t) => {
  const f = await fixture(t, [event('task_started', { turn_id: 'old' }), message('old input'),
    event('task_complete', { turn_id: 'old' }), event('error', { message: 'compaction failed' }),
    message('accepted but not started'), event('task_started', { turn_id: 'new' }), message('new input')]);
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  const pending = session.logicalEvents.find((e) => e.kind === 'user_message' && e.preview.includes('accepted but not started'));
  assert.ok(pending);
  assert.equal(pending.turnId, '');
  const ownership = buildRawTurnOwnershipIndex(session.rawEvents);
  const owner = ownership.byRawId.get(pending.rawRefs[0].rawId);
  assert.match(owner.turnOwnerKey, /^implicit:/);
  assert.equal(owner.isTrailing, false);
  assert.equal(session.counts.userMessages, 3);
});

test('exact full and truncated fork prefixes exclude inherited checkpoint and token observations', async (t) => {
  for (const truncate of [false, true]) {
    const f = await fixture(t, [message('inherited input'), tokens(16384, 16384), checkpoint(),
      event('warning', { message: 'parent tail' })]);
    const copied = truncate ? f.rows.slice(0, -1) : f.rows;
    const child = stamp([{ type: 'session_meta', payload: { id: CHILD, cwd: f.options.repoRoot, forked_from_id: ID } },
      ...copied, message('child input'), tokens(1024, 0)], 30);
    await fs.writeFile(path.join(f.root, `rollout-${CHILD}.jsonl`), child.map(JSON.stringify).join('\n') + '\n');
    for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
      const index = await build(f.options);
      const session = build === codex.buildSourceBackedIndex
        ? await materializeSessionForIndex(index, index.sessionsById.get(CHILD))
        : index.sessionsById.get(CHILD);
      assert.equal(session.forkStorageMode, 'materialized');
      assert.equal(session.counts.userMessages, 1);
      assert.equal(session.analysis.tokenStats.maxObserved, 0, 'inherited checkpoint totals are not child usage');
      const observations = session.logicalEvents.filter((e) => e.cacheObservation);
      if (build === codex.buildSourceBackedIndex) {
        assert.equal(observations.length, 1);
        assert.equal(observations[0].cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
      }
    }
  }
});

test('rewritten checkpoint prefixes retain declared ancestry without claiming exact inheritance', async (t) => {
  const f = await fixture(t, [message('parent input'), checkpoint(), event('warning', { message: 'parent tail' })]);
  const copied = structuredClone(f.rows);
  const rewritten = copied.find((row) => row.type === 'compacted');
  // A minimized ambiguity probe, not a complete synthetic spawn transcript.
  // 0.160 core/src/agent/control/spawn.rs rewrites these fields and also filters
  // history. Matching that transformed stream requires separate proof; simply
  // dropping these fields from every canonical digest would weaken ownership.
  rewritten.payload.latest_token_usage_record = null;
  rewritten.payload.resume_metadata.previous_turn_settings = null;
  const child = stamp([{ type: 'session_meta', payload: { id: CHILD, cwd: f.options.repoRoot, forked_from_id: ID } },
    ...copied, message('child input')], 30);
  await fs.writeFile(path.join(f.root, `rollout-${CHILD}.jsonl`), child.map(JSON.stringify).join('\n') + '\n');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    const session = index.sessionsById.get(CHILD);
    assert.equal(session.forkedFromSessionId, ID);
    assert.equal(session.forkStorageMode, '');
    assert.equal(session.inheritedContext, null);
  }
});

test('legacy, paginated and adjacent mirrored compaction keep one semantic event and the cache boundary', async (t) => {
  const cases = [
    ['legacy', [event('context_compacted')]],
    ['paginated', [typedCompaction()]],
    ['typed then legacy', [typedCompaction(), event('context_compacted')]],
    ['legacy then typed', [event('context_compacted'), typedCompaction()]],
  ];
  for (const [label, boundary] of cases) {
    await t.test(label, async (t) => {
      const f = await fixture(t, [event('task_started', { turn_id: 'compaction-turn' }),
        message('actual input'), tokens(16384, 16384), ...boundary, tokens(12288, 0)]);
      for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
        const index = await build(f.options);
        const session = build === codex.buildSourceBackedIndex
          ? await materializeSessionForIndex(index, index.sessionsById.get(ID))
          : index.sessionsById.get(ID);
        const compactions = session.logicalEvents.filter((e) => e.kind === 'compaction');
        assert.equal(compactions.length, 1, label);
        assert.equal(session.counts.compactions, 1, label);
        assert.equal(compactions[0].rawRefs.length, boundary.length, 'all mirror Raw refs survive');
        assert.equal(session.counts.toolCalls, 0);
        assert.equal(session.counts.userMessages, 1);
        assert.equal(session.rawEvents.length, f.rows.length);
        if (build === codex.buildSourceBackedIndex) {
          const observed = session.logicalEvents.filter((e) => e.cacheObservation);
          assert.equal(observed.length, 2);
          assert.equal(observed[1].cacheObservation.comparison.state, COMPARISON_STATE.COMPACTION_BOUNDARY);
          for (const ref of compactions[0].rawRefs) {
            const raw = session.rawEvents.find((candidate) => candidate.rawId === ref.rawId);
            const hydrated = await codex.readRawLine(index, raw.source.file, raw.source.line);
            assert.deepEqual(hydrated.parsed, f.rows[raw.source.line - 1]);
          }
        }
      }
    });
  }
});

test('foreign-thread typed compaction remains Raw evidence and cannot alter owned cache comparisons', async (t) => {
  const f = await fixture(t, [event('task_started', { turn_id: 'compaction-turn' }), message('actual input'),
    tokens(16384, 16384), typedCompaction({ thread_id: CHILD }), tokens(12288, 0)]);
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  assert.equal(session.counts.compactions, 0);
  assert.equal(session.rawEvents.length, f.rows.length);
  const typedRaw = session.rawEvents.find((r) => r.payloadType === 'item_completed');
  assert.ok(session.logicalEvents.some((e) => e.layer === 'protocol' && e.rawRefs.some((r) => r.rawId === typedRaw.rawId)));
  const observed = session.logicalEvents.filter((e) => e.cacheObservation);
  assert.equal(observed.length, 2);
  assert.equal(observed[1].cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
});

test('repeated typed compaction IDs never silently coalesce separate physical records', async (t) => {
  const f = await fixture(t, [event('task_started', { turn_id: 'compaction-turn' }),
    typedCompaction(), typedCompaction()]);
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  const ids = new Set(session.rawEvents.filter((r) => r.payloadType === 'item_completed').map((r) => r.rawId));
  assert.equal(ids.size, 2);
  const projected = session.logicalEvents.filter((e) => e.rawRefs.some((r) => ids.has(r.rawId)));
  assert.equal(projected.length, 2);
  assert.ok(projected.every((e) => e.rawRefs.filter((r) => ids.has(r.rawId)).length === 1));
});
