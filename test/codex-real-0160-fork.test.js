'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { codexSubagentHistoryBoundary, inferCodexMaterializedForks, rawForkSegment } = require('../src/codex-forks');
const { resolveHistoryReference } = require('../src/codex-persisted-history');

// Synthetic minimized structure informed by an authorized 0.160 Paginated
// compact/resume/subagent probe. No original text, IDs, paths, or log data.
// Source authority: rust-v0.160.0 protocol/src/protocol.rs SessionMeta defines
// subagent_history_start_ordinal as the first child-owned projected record.
const PARENT = 'aaaaaaaa-0160-4160-8160-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-0160-4160-8160-bbbbbbbbbbbb';
const msg = (role, text) => ({ type: 'response_item', payload: { type: 'message', role,
  content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const event = (type, fields = {}) => ({ type: 'event_msg', payload: { type, ...fields } });

function records(cwd = '/synthetic/repo') {
  return [
    { type: 'session_meta', payload: { id: CHILD, cwd, history_mode: 'paginated', forked_from_id: PARENT,
      parent_thread_id: PARENT, subagent_history_start_ordinal: 7,
      source: { subagent: { thread_spawn: { parent_thread_id: PARENT, depth: 1 } } } } },
    { type: 'session_meta', payload: { id: PARENT, cwd, history_mode: 'paginated' } },
    { type: 'compacted', payload: { message: 'synthetic inherited checkpoint', latest_token_usage_record: null,
      resume_metadata: { multi_agent_version: 'v2', last_started_turn_id: 'parent-old', previous_turn_settings: null } } },
    event('task_complete', { turn_id: 'parent-old' }),
    event('task_started', { turn_id: 'parent-resumed' }),
    msg('user', 'inherited-user-only-marker'),
    event('token_count', { info: { last_token_usage: { input_tokens: 16384, cached_input_tokens: 16384 } } }),
    event('thread_settings_applied', { thread_id: CHILD, thread_settings: { model: 'synthetic-model' } }),
    event('task_started', { turn_id: 'child-turn' }),
    msg('assistant', 'child-answer-marker'),
    event('token_count', { info: { last_token_usage: { input_tokens: 12288, cached_input_tokens: 0 } } }),
    event('task_complete', { turn_id: 'child-turn' }),
  ].map((row, ordinal) => ({ timestamp: new Date(Date.parse('2026-10-03T10:00:00Z') + ordinal * 1000).toISOString(), ordinal, ...row }));
}

function rawRecords(rows = records()) {
  return rows.map((row, index) => ({ sessionId: CHILD, rawId: `raw-${index}`, recordType: row.type,
    sessionMetaId: row.type === 'session_meta' ? row.payload.id : '', parsed: row }));
}

test('explicit subagent projection boundary uses source ordinals without claiming a matching parent prefix', () => {
  const raw = rawRecords();
  assert.deepEqual(codexSubagentHistoryBoundary(raw), { sourceSessionId: PARENT, startOrdinal: 7, inheritedRawCount: 6 });
  // A dropped physical record invalidates the proof; do not substitute line
  // positions for missing or discontinuous source ordinals.
  const gaps = records();
  gaps[0].payload.subagent_history_start_ordinal = 14;
  for (const row of gaps) row.ordinal *= 2;
  assert.equal(codexSubagentHistoryBoundary(rawRecords(gaps)), null);
  for (let i = 1; i <= 6; i += 1) raw[i].subagentInherited = true;
  const session = { id: CHILD, rawEvents: raw, logicalEvents: [], _parsedAncestry: { forkedFromSessionId: PARENT } };
  const parent = { id: PARENT, rawEvents: raw.slice(1, 7), logicalEvents: [],
    _canonicalRawDigests: raw.slice(1, 7).map((_, i) => `digest-${i}`) };
  session._canonicalRawDigests = ['child-meta', ...parent._canonicalRawDigests,
    ...raw.slice(7).map((_, i) => `own-${i}`)];
  assert.equal(inferCodexMaterializedForks([parent, session]), 0, 'even matching digests cannot replace the declared projection boundary');
  assert.equal(session.forkStorageMode, '');
  assert.equal(rawForkSegment(session, raw[1].rawId), 'inherited_context');
  assert.equal(rawForkSegment(session, raw[7].rawId), 'continuation');
});

test('malformed or contradictory explicit boundaries fail closed', () => {
  for (const mutate of [
    (r) => { r[0].payload.subagent_history_start_ordinal = '7'; },
    (r) => { r[0].payload.subagent_history_start_ordinal = 99; },
    (r) => { r[0].payload.subagent_history_start_ordinal = 1; },
    (r) => { r[0].payload.subagent_history_start_ordinal = Number.MAX_SAFE_INTEGER + 1; },
    (r) => { r[0].payload.parent_thread_id = CHILD; },
    (r) => { r[0].payload.forked_from_id = 'different-parent'; },
    (r) => { r[1].payload.id = 'different-parent'; },
    (r) => { delete r[4].ordinal; },
    (r) => { r[4].ordinal = r[3].ordinal; },
    (r) => { r[4].ordinal = -1; },
    (r) => { r[0].ordinal = 88; },
  ]) {
    const rows = records(); mutate(rows);
    assert.equal(codexSubagentHistoryBoundary(rawRecords(rows)), null);
  }
});

test('rewritten subagent context stays Raw-only across compact, cache reuse, strict hydration and append', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-subagent-ordinal-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', `rollout-${CHILD}.jsonl`);
  const rows = records(repoRoot);
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const options = { repoRoot, codexHome: home };
  let previousIndex;
  let previousBuild;
  for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildIndex, codex.buildSourceBackedIndex, codex.buildSourceBackedIndex]) {
    const index = await build({ ...options, previousIndex });
    if (build === previousBuild) assert.equal(index.totals.reusedFileCount, 1);
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(CHILD)) : index.sessionsById.get(CHILD);
    assert.equal(session.counts.userMessages, 0);
    assert.equal(session.counts.turns, 1);
    assert.equal(session.counts.assistantMessages, 1);
    assert.equal(session.forkStorageMode, '');
    assert.equal(session.rawEvents.length, rows.length);
    assert.deepEqual(session.rawEvents.filter((r) => r.subagentInherited === true).map((r) => r.line), [2, 3, 4, 5, 6, 7]);
    assert.ok(session.logicalEvents.every((e) => e.rawRefs.every((ref) => ref.line === 1 || ref.line >= 8)));
    assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'inherited-user-only-marker' }).searchEventCount, 0);
    const raw = await codex.readRawLine(index, session.rawEvents[5].source.file, 6);
    assert.deepEqual(raw.parsed, rows[5]);
    assert.equal(codex.query.getEvent(index, session, session.rawEvents[5].rawId, { layer: 'raw' }).forkSegment, 'inherited_context');
    if (build === codex.buildSourceBackedIndex) {
      const observations = session.logicalEvents.filter((e) => e.cacheObservation);
      assert.equal(observations.length, 1);
      assert.equal(observations[0].cacheObservation.comparison.state, 'no_previous_observation');
    }
    previousIndex = index;
    previousBuild = build;
  }
  const appended = { timestamp: '2026-10-03T10:01:00Z', ordinal: 12, ...msg('user', 'own-new-input') };
  await fs.appendFile(file, JSON.stringify(appended) + '\n');
  const index = await codex.buildSourceBackedIndex({ ...options, previousIndex });
  assert.equal(index.sessionsById.get(CHILD).counts.userMessages, 1);
});

test('inherited shell and history targets cannot gain child authority through owned promotions', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-subagent-authority-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(home, 'sessions'));
  const rows = records(repoRoot);
  rows[5] = { ...rows[5], ...msg('user', '<environment_context><shell>inherited-shell-only</shell></environment_context>') };
  rows[6] = { ...rows[6], ...event('item_completed', { thread_id: CHILD, turn_id: 'child-turn',
    item: { type: 'AgentMessage', id: 'inherited-target', content: [{ type: 'Text', text: 'inherited-target-only' }] } }) };
  rows.push({ timestamp: '2026-10-03T10:01:00Z', ordinal: 12, type: 'realtime_item', payload: {
    id: 'own-promotion', realtime_session_id: 'own-realtime', type: 'bem_item_promoted', turn_id: 'child-turn',
    item_id: 'inherited-target', presentation: { type: 'whole_item' },
  } });
  await fs.writeFile(path.join(home, 'sessions', `rollout-${CHILD}.jsonl`), rows.map(JSON.stringify).join('\n') + '\n');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build({ repoRoot, codexHome: home });
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(CHILD)) : index.sessionsById.get(CHILD);
    assert.equal(session.shell || session._shell || '', '');
    assert.equal(session.counts.assistantMessages, 1);
    const promotion = session.logicalEvents.find((event) => event.historyFacts?.type === 'bem_item_promoted');
    assert.ok(promotion);
    assert.equal(resolveHistoryReference(session, promotion), null);
    assert.equal(rawForkSegment(session, session.rawEvents[6].rawId), 'inherited_context');
  }
});

test('Paginated ordinary fork history_base does not turn parent ordinals into local inherited rows', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-history-base-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(home, 'sessions'));
  const rows = [
    { type: 'session_meta', payload: { id: CHILD, cwd: repoRoot, history_mode: 'paginated', forked_from_id: PARENT,
      forked_from_ordinal_exclusive: 88, history_base: { thread_id: PARENT, end_ordinal_exclusive: 88, end_byte_offset: 9000 } } },
    event('task_started', { turn_id: 'own-fork-turn' }), msg('user', 'ordinary-fork-own-input'),
    msg('assistant', 'ordinary-fork-own-answer'), event('task_complete', { turn_id: 'own-fork-turn' }),
  ].map((row, index) => ({ timestamp: `2026-10-03T10:00:0${index}Z`, ordinal: 88 + index, ...row }));
  await fs.writeFile(path.join(home, 'sessions', `rollout-${CHILD}.jsonl`), rows.map(JSON.stringify).join('\n') + '\n');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build({ repoRoot, codexHome: home });
    const session = build === codex.buildSourceBackedIndex
      ? await materializeSessionForIndex(index, index.sessionsById.get(CHILD)) : index.sessionsById.get(CHILD);
    assert.equal(session.forkedFromSessionId, PARENT);
    assert.equal(session.forkStorageMode, '');
    assert.equal(session.counts.userMessages, 1);
    assert.equal(session.counts.assistantMessages, 1);
    assert.equal(session.counts.turns, 1);
    assert.equal(session.rawEvents.some((raw) => raw.subagentInherited === true), false);
    assert.equal(session.rawEvents[0].source.line, 1);
    const hydrated = await codex.readRawLine(index, session.rawEvents[0].source.file, 1);
    assert.equal(hydrated.parsed.ordinal, 88);
  }
});
