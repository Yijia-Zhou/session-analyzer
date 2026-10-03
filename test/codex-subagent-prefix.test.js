'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { codexSubagentHistoryBoundary, restoreCodexSubagentRawSegments, rawForkSegment } = require('../src/codex-forks');

// Synthetic source-shaped records, not a captured user transcript.
// rust-v0.160.0 rollout/src/ordinal.rs accepts a complete inherited prefix
// ending at subagent_history_start_ordinal - 1 before any owned row exists.
const PARENT = 'aaaaaaaa-0160-4160-8160-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-0160-4160-8160-bbbbbbbbbbbb';
const response = (payload) => ({ type: 'response_item', payload });
const event = (type, fields = {}) => ({ type: 'event_msg', payload: { type, ...fields } });

function prefixRecords(cwd = '/synthetic/repo') {
  const rows = [
    { type: 'session_meta', payload: { id: CHILD, cwd, history_mode: 'paginated',
      parent_thread_id: PARENT, forked_from_id: PARENT,
      source: { subagent: { thread_spawn: { parent_thread_id: PARENT, depth: 1 } } } } },
    { type: 'session_meta', payload: { id: PARENT, cwd, history_mode: 'paginated' } },
    { type: 'compacted', payload: { message: 'synthetic rewritten inherited checkpoint' } },
    event('task_started', { turn_id: 'parent-turn' }),
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'prefix-only-parent-prompt' }] }),
    response({ type: 'function_call', call_id: 'parent-call', name: 'shell_command', arguments: '{"command":"echo parent-only-command"}' }),
    response({ type: 'function_call_output', call_id: 'parent-call', output: 'Wall time: 0.01 seconds\nProcess exited with code 0\nFinal output:\nparent-only-command' }),
    event('token_count', { info: { last_token_usage: { input_tokens: 16384, cached_input_tokens: 8192 } } }),
    event('task_complete', { turn_id: 'parent-turn' }),
  ];
  rows[0].payload.subagent_history_start_ordinal = rows.length;
  return rows.map((row, ordinal) => ({ timestamp: new Date(Date.parse('2026-10-03T10:00:00Z') + ordinal * 1000).toISOString(), ordinal, ...row }));
}

function rawRecords(rows) {
  return rows.map((row, index) => ({ sessionId: CHILD, rawId: `prefix-raw-${index}`,
    recordType: row.type, sessionMetaId: row.type === 'session_meta' ? row.payload.id : '', parsed: row }));
}

test('subagent prefix boundary accepts a complete prefix before the first owned record', () => {
  const rows = prefixRecords();
  const raws = rawRecords(rows);
  const before = structuredClone(raws);
  assert.deepEqual(codexSubagentHistoryBoundary(raws), {
    sourceSessionId: PARENT, startOrdinal: rows.length, inheritedRawCount: rows.length - 1,
  });
  assert.deepEqual(raws, before, 'boundary detection must not mutate source records');
  const appended = [...rows, { ordinal: rows.length, ...event('task_started', { turn_id: 'child-turn' }) }];
  assert.deepEqual(codexSubagentHistoryBoundary(rawRecords(appended)), codexSubagentHistoryBoundary(raws),
    'appending the first owned record must not change inherited ownership');
});

test('subagent prefix boundary accepts the minimal two-metadata complete prefix', () => {
  const rows = prefixRecords().slice(0, 2);
  rows[0].payload.subagent_history_start_ordinal = 2;
  assert.deepEqual(codexSubagentHistoryBoundary(rawRecords(rows)), {
    sourceSessionId: PARENT, startOrdinal: 2, inheritedRawCount: 1,
  });
});

test('subagent prefix boundary still rejects unfinished, discontinuous and conflicting prefixes', () => {
  assert.equal(codexSubagentHistoryBoundary(rawRecords(prefixRecords().slice(0, -1))), null);
  for (const mutate of [
    (rows) => { rows[4].ordinal += 1; },
    (rows) => { delete rows[4].ordinal; },
    (rows) => { rows[0].payload.parent_thread_id = CHILD; },
    (rows) => { rows[0].payload.forked_from_id = 'different-parent'; },
    (rows) => { rows[1].payload.id = 'different-parent'; },
    (rows) => { rows[0].payload.subagent_history_start_ordinal = '9'; },
    (rows) => { rows[0].ordinal = 1; },
  ]) {
    const rows = prefixRecords();
    mutate(rows);
    assert.equal(codexSubagentHistoryBoundary(rawRecords(rows)), null);
  }
});

test('subagent prefix boundary restores inherited Raw segments without an owned continuation', () => {
  const raws = rawRecords(prefixRecords());
  const boundary = codexSubagentHistoryBoundary(raws);
  assert.ok(boundary);
  for (let index = 1; index <= boundary.inheritedRawCount; index += 1) raws[index].subagentInherited = true;
  const session = { rawEvents: raws };
  assert.equal(restoreCodexSubagentRawSegments(session), true);
  assert.equal(rawForkSegment(session, raws[0].rawId), 'fork_metadata');
  for (const raw of raws.slice(1)) assert.equal(rawForkSegment(session, raw.rawId), 'inherited_context');
  assert.equal([...session._forkSegmentsByRawId.values()].includes('continuation'), false);
});

test('prefix-only subagent remains empty through cold parsing, reuse, hydration and first owned append', async (t) => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const codex = require('../src/codex');
  const { materializeSessionForIndex } = require('../src/source-adapters');
  for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-prefix-only-'));
    t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
    const repoRoot = path.join(codexHome, 'repo');
    await fs.mkdir(repoRoot);
    await fs.mkdir(path.join(codexHome, 'sessions'));
    const file = path.join(codexHome, 'sessions', `rollout-${CHILD}.jsonl`);
    const rows = prefixRecords(repoRoot);
    await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
    const options = { repoRoot, codexHome };
    let previousIndex;
    for (let pass = 0; pass < 2; pass += 1) {
      const index = await build({ ...options, previousIndex });
      const session = build === codex.buildSourceBackedIndex
        ? await materializeSessionForIndex(index, index.sessionsById.get(CHILD)) : index.sessionsById.get(CHILD);
      assert.ok(session, 'a persisted prefix-only child remains discoverable');
      assert.equal(session.counts.userMessages, 0);
      assert.equal(session.counts.assistantMessages, 0);
      assert.equal(session.counts.turns, 0);
      assert.equal(session.counts.toolCalls, 0);
      assert.equal(session.rawEvents.length, rows.length);
      assert.equal(session.rawEvents.filter((raw) => raw.subagentInherited === true).length, rows.length - 1);
      assert.equal(session.logicalEvents.some((e) => e.cacheObservation), false);
      assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'parent-only-command' }).searchEventCount, 0);
      assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'prefix-only-parent-prompt' }).searchEventCount, 0);
      const inherited = session.rawEvents[4];
      assert.equal(codex.query.getEvent(index, session, inherited.rawId, { layer: 'raw' }).forkSegment, 'inherited_context');
      assert.deepEqual((await codex.readRawLine(index, inherited.source.file, inherited.source.line)).parsed, rows[4]);
      if (pass && build !== codex.__testOnly.buildUncompactedIndexForDetailTests) assert.equal(index.totals.reusedFileCount, 1);
      previousIndex = index;
    }
    const ownedRows = [event('task_started', { turn_id: 'child-turn' }),
      response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first-child-owned-input' }] })]
      .map((row, offset) => ({ timestamp: `2026-10-03T10:01:0${offset}Z`, ordinal: rows.length + offset, ...row }));
    await fs.appendFile(file, ownedRows.map(JSON.stringify).join('\n') + '\n');
    const updated = await build({ ...options, previousIndex });
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(updated, updated.sessionsById.get(CHILD)) : updated.sessionsById.get(CHILD);
    assert.equal(session.counts.userMessages, 1);
    assert.equal(session.counts.turns, 1);
    assert.equal(session.counts.toolCalls, 0);
    assert.equal(session.rawEvents.filter((raw) => raw.subagentInherited === true).length, rows.length - 1);
    assert.equal(codex.query.getTimeline(updated, session, { layer: 'main', q: 'first-child-owned-input' }).searchEventCount, 1);
  }
});
