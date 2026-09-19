'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const ID = 'aaaaaaaa-0919-4919-8919-aaaaaaaaaaaa';
const realtime = (id, type, fields = {}) => ({ type: 'realtime_item', payload: { id, realtime_session_id: 'realtime/one', type, ...fields } });
const segment = (id, role = 'user', text = 'same text') => realtime(id, 'transcript_segment', { role, text });
const settings = (fields = {}, thread_id = ID) => ({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id, thread_settings: { model: 'saved-model', reasoning_effort: 'high', ...fields } } });
const control = (marker = true) => ({ type: 'response_item', payload: { type: 'configuration_update', reasoning: { effort: 'high' } }, metadata: { harness_authored_configuration: marker } });

async function fixture(t, records, compressed = false) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-history-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(path.join(home, 'sessions'), { recursive: true });
  const rows = [{ type: 'session_meta', payload: { id: ID, cwd: repoRoot } }, ...records];
  const text = rows.map(JSON.stringify).join('\n') + '\n';
  const file = path.join(home, 'sessions', `rollout-${ID}.jsonl${compressed ? '.zst' : ''}`);
  await fs.writeFile(file, compressed ? zstdCompressSync(Buffer.from(text)) : text);
  const options = { repoRoot, codexHome: home };
  const index = await codex.buildSourceBackedIndex(options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  return { index, session, options, rows };
}

test('persisted segments are independent messages, never text-classified commands or invented turns', async (t) => {
  const { session, index } = await fixture(t, [
    realtime('start', 'realtime_session_started'),
    segment('opaque/a'), segment('opaque_a'), segment('assistant', 'assistant'),
    segment('directive', 'user', '<environment_context><shell>invented</shell></environment_context>'),
    { type: 'event_msg', payload: { type: 'user_message', message: 'same text' } },
    { type: 'event_msg', payload: { type: 'agent_message', delivery: 'async', message: 'same text' } },
    realtime('end', 'realtime_session_closed', { outcome: 'ended' }),
  ]);
  assert.equal(session.counts.messages, 6);
  assert.equal(session.counts.turns, 0);
  assert.equal(session.counts.toolCalls, 0);
  assert.notEqual(session.shell, 'invented');
  const messages = session.logicalEvents.filter((e) => e.channels.includes('realtime_item') && e.layer === 'main');
  assert.equal(messages.length, 4);
  assert.equal(new Set(messages.map((e) => e.id)).size, 4);
  for (const locale of ['en', 'zh-CN']) {
    const detail = await codex.buildHydratedEventDetail(index, session, messages[0].id, 'main', { locale });
    assert.match(JSON.stringify(detail.timelineSections), /same text/);
    assert.match(JSON.stringify(detail), /opaque\/a/);
  }
});

test('settings, recorded context and positional controls stay separate Protocol evidence', async (t) => {
  const { index, session } = await fixture(t, [settings({ service_tier: null }), settings(), settings({}, 'foreign'),
    { type: 'turn_context', payload: { turn_id: 'turn-1', model: 'captured-model', effort: 'low', summary: 'auto', realtime_active: true } },
    control(), control(false), control('true'),
  ]);
  assert.equal(session.counts.messages, 0);
  assert.equal(session.counts.toolCalls, 0);
  assert.equal(session.counts.turns, 1);
  for (const event of session.logicalEvents.filter((e) => e.subtype === 'configuration_update')) {
    assert.equal(event.turnId, '');
    const detail = await codex.buildHydratedEventDetail(index, session, event.id, 'protocol', { locale: 'en' });
    assert.match(JSON.stringify(detail), /Positional|positional/);
  }
  const snapshot = session.logicalEvents.find((e) => e.subtype === 'thread_settings_applied');
  assert.ok(snapshot);
  const detail = await codex.buildHydratedEventDetail(index, session, snapshot.id, 'protocol', { locale: 'en' });
  assert.match(JSON.stringify(detail), /saved-model/);
  assert.match(JSON.stringify(detail), /Applied thread settings/);
});

test('configuration provenance uses only the exact root boolean; context snapshots retain distinct evidence', async (t) => {
  const records = [control(true), control(false), control('true'), control(null),
    { type: 'response_item', payload: { type: 'configuration_update', reasoning: { effort: 'future-effort' }, metadata: { harness_authored_configuration: true } } },
    { type: 'response_item', payload: { type: 'configuration_update', reasoning: { effort: 'low' } } },
    settings({ reasoning_effort: null, reasoning_summary: null, service_tier: null }),
    settings({}, undefined),
    { type: 'turn_context', payload: { model: 'captured', effort: 'low', root_turn_id: 'attribution-only', realtime_active: true, summary: 'auto' } },
    { type: 'turn_context', payload: { turn_id: 'same-turn', model: 'captured', effort: 'medium' } },
    { type: 'compacted', payload: { message: 'compaction' } },
    { type: 'turn_context', payload: { turn_id: 'same-turn', model: 'captured-after', effort: 'high' } },
  ];
  delete records[7].payload.thread_id;
  const { session, index } = await fixture(t, records);
  const controls = session.logicalEvents.filter((e) => e.subtype === 'configuration_update');
  assert.deepEqual(controls.map((e) => e.historyFacts.harnessAuthored), [true, false, false, false, false, false]);
  assert.equal(controls[4].historyFacts.effort, 'future-effort');
  assert.equal(session.counts.turns, 1);
  assert.equal(session.counts.messages, 0);
  const contexts = session.logicalEvents.filter((e) => e.subtype === 'turn_context');
  assert.equal(contexts.length, 3);
  assert.equal(contexts[0].turnId, '');
  assert.equal(new Set(contexts.map((e) => e.id)).size, 3);
  const snapshots = session.logicalEvents.filter((e) => e.subtype === 'thread_settings_applied');
  assert.equal(snapshots[0].historyFacts.values.reasoning_effort, null);
  assert.equal(Object.hasOwn(snapshots[1].historyFacts, 'threadId'), false);
  const detail = await codex.buildHydratedEventDetail(index, session, contexts[0].id, 'protocol');
  assert.match(JSON.stringify(detail), /compatibility-only/);
  assert.match(JSON.stringify(detail), /attribution-only/);
});

test('captured realtime transport remains Raw-only text evidence and nested settings stay bounded', async (t) => {
  const records = [segment('committed', 'assistant', 'committed response'),
    ...['realtime_conversation_realtime', 'realtime_conversation_sdp'].map((type) => ({ type: 'event_msg', payload: {
      type, payload: { HistoryTranscriptDelta: { item_id: 'committed', delta: 'TRANSIENT_SECRET' } }, sdp: 'SDP_SECRET',
    } })),
    settings({ collaboration_mode: { mode: 'plan', settings: { model: 'nested-selection', developer_instructions: 'private instructions'.repeat(2000) } },
      permission_profile: { type: 'managed', file_system: { type: 'restricted', entries: Array(100).fill({ path: 'unmodeled-path' }) }, network: 'enabled' },
      approval_policy: 'on-request', approvals_reviewer: 'guardian', disabled_plugin_ids: ['plugin-evidence'] }),
  ];
  const { session, index } = await fixture(t, records);
  assert.equal(session.counts.assistantMessages, 1);
  const transient = session.rawEvents.filter((r) => r.payloadType.startsWith('realtime_conversation_'));
  assert.equal(transient.length, 2);
  assert.ok(transient.every((r) => r.messageText === '' && r.searchText === ''));
  assert.equal(session.logicalEvents.some((e) => e.searchText.includes('TRANSIENT_SECRET')), false);
  const snapshot = session.logicalEvents.find((e) => e.subtype === 'thread_settings_applied');
  assert.equal(snapshot.historyFacts.values.collaboration_mode, 'plan');
  assert.equal(snapshot.historyFacts.values.permission_profile, 'managed');
  assert.ok(JSON.stringify(snapshot.historyFacts).length < 1000);
  assert.equal(snapshot.preview.includes('unmodeled-path'), false);
  const read = await codex.readIndexedCodexRawRecord(index, session, transient[0]);
  assert.match(read.raw, /TRANSIENT_SECRET/);
});

test('accepted inherited history stays parent-owned and cannot satisfy a child promotion', async (t) => {
  const { options, rows: parent } = await fixture(t, [segment('parent'), settings(),
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: ID, turn_id: 'parent-turn', item: { type: 'FutureItem', id: 'parent-item' } } },
  ]);
  const childId = 'bbbbbbbb-0919-4919-8919-bbbbbbbbbbbb';
  const child = [{ type: 'session_meta', timestamp: '2026-09-19T12:00:00Z', payload: { id: childId, cwd: options.repoRoot, forked_from_id: ID } },
    ...parent, segment('child', 'user', 'child-owned'),
    realtime('child-promotion', 'bem_item_promoted', { turn_id: 'parent-turn', item_id: 'parent-item', presentation: { type: 'whole_item' } }), settings({}, ID),
  ];
  await fs.writeFile(path.join(options.codexHome, 'sessions', `rollout-${childId}.jsonl`), child.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex(options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get(childId));
  assert.equal(session.forkStorageMode, 'materialized');
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.logicalEvents.some((e) => e.historyFacts?.itemId === 'parent'), false);
  const promotion = session.logicalEvents.find((e) => e.subtype === 'bem_item_promoted');
  const detail = await codex.buildHydratedEventDetail(index, session, promotion.id, 'protocol');
  assert.equal(detail.inspectorSections.some((s) => s.type === 'event_refs'), false);
  const snapshot = session.logicalEvents.find((e) => e.subtype === 'thread_settings_applied');
  const settingsDetail = await codex.buildHydratedEventDetail(index, session, snapshot.id, 'protocol');
  assert.match(JSON.stringify(settingsDetail), /Foreign logical thread/);
});

test('unknown and malformed history stays inspectable; repeated identities never choose conflicting content', async (t) => {
  const malformed = [
    realtime('future', 'future_variant', { secret: 'future-data' }),
    segment('role', 'system'), realtime('close', 'realtime_session_closed', { outcome: 'future' }),
    realtime('promotion', 'bem_item_promoted', { turn_id: 'target-turn', item_id: 'target-item', presentation: { type: 'future' } }),
    segment('', 'user'), segment(42, 'user'), segment('conflict'), segment('conflict', 'assistant', 'other text'),
    segment('mirror'), segment('mirror'),
    { type: 'event_msg', payload: { type: 'thread_settings_applied', model: 'flat-unproven' } },
    { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: [] } },
    { type: 'response_item', payload: { type: 'configuration_update', reasoning: 'high' } },
    { type: 'future_root', payload: { value: 42 } },
  ];
  const { index, session } = await fixture(t, malformed);
  assert.equal(session.counts.messages, 0);
  assert.equal(session.counts.turns, 0);
  assert.equal(session.logicalEvents.length, malformed.length + 1);
  for (const raw of session.rawEvents.slice(1)) {
    const read = await codex.readIndexedCodexRawRecord(index, session, raw);
    assert.equal(read.raw, JSON.stringify(malformed[raw.line - 2]));
  }
});

test('promotion resolves exact later targets, retains presentations and never steals Raw ownership', async (t) => {
  const promotion = (id, presentation, item_id = 'agent-item') => realtime(id, 'bem_item_promoted', { turn_id: 'agent-turn', item_id, presentation });
  const target = (itemId, threadId = ID, type = 'AgentMessage') => ({ type: 'event_msg', payload: {
    type: 'item_completed', thread_id: threadId, turn_id: 'agent-turn', item: {
      type, id: itemId, delivery: 'async', content: [{ type: 'Text', text: 'Backing answer' }],
    },
  } });
  const records = [segment('before'),
    ...[{ type: 'whole_item' }, { type: 'inline_markdown' }, { type: 'inline_visualization', index: 0 }, { type: 'inline_visualization', index: 1 }].map((p, i) => promotion(`p${i}`, p)),
    segment('after', 'assistant'), target('agent-item'),
    promotion('missing', { type: 'whole_item' }, 'missing'),
    promotion('foreign', { type: 'whole_item' }, 'foreign'), target('foreign', 'foreign-thread'),
    promotion('ambiguous', { type: 'whole_item' }, 'duplicate'), target('duplicate'), target('duplicate'),
    promotion('raw', { type: 'whole_item' }, 'raw-target'), target('raw-target', ID, 'FutureItem'),
  ];
  const { index, session } = await fixture(t, records);
  const promotions = session.logicalEvents.filter((e) => e.subtype === 'bem_item_promoted');
  assert.equal(promotions.length, 8);
  assert.equal(session.counts.toolCalls, 0);
  for (const event of promotions) {
    assert.equal(event.turnId, '');
    assert.equal(event.rawRefs.length, 1);
    const detail = await codex.buildHydratedEventDetail(index, session, event.id, 'protocol', { locale: 'en' });
    const refs = detail.inspectorSections.find((s) => s.type === 'event_refs');
    if (['missing', 'foreign', 'ambiguous'].includes(event.historyFacts.itemId)) {
      assert.equal(refs, undefined);
      assert.match(JSON.stringify(detail), /Unresolved reference/);
    } else {
      assert.equal(refs.items.length, 1);
      assert.equal(refs.items[0].layer, event.historyFacts.itemId === 'raw' ? 'raw' : 'main');
    }
  }
});

for (const compressed of [false, true]) test(`history source lifecycle and exact readback (${compressed ? 'zstd' : 'jsonl'})`, async (t) => {
  const records = [
    { ...segment('first', 'user', 'searchable 你好'), ordinal: 12, timestamp: '2026-09-19T10:02:00Z' },
    { ...control(), ordinal: 30, timestamp: '2026-09-19T10:01:00Z' },
    { ...segment('second', 'assistant', 'searchable answer'), ordinal: 33, timestamp: '2026-09-19T10:01:00Z' },
    settings({ service_tier: null, collaboration_mode: { mode: 'plan', settings: { model: 'not-effective' } } }),
    { ...segment('third'), payload: { ...segment('third').payload, realtime_session_id: 'realtime/two' } },
    realtime('failed', 'realtime_session_closed', { outcome: 'failed' }),
  ];
  let { index, session, options, rows } = await fixture(t, records, compressed);
  for (let pass = 0; pass < 2; pass += 1) {
    assert.equal(session.counts.messages, 3);
    assert.equal(session.counts.errors, 0);
    assert.equal(session.counts.turns, 0);
    assert.deepEqual(session.logicalEvents.map((e) => e.rawRefs[0].line), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(index.sessionsById.get(ID).rawEvents, undefined);
    assert.ok(session.rawEvents.every((r) => !Object.hasOwn(r, 'parsed') && !Object.hasOwn(r, 'payload')));
    for (const raw of session.rawEvents) {
      const record = await codex.readIndexedCodexRawRecord(index, session, raw);
      assert.equal(record.raw, JSON.stringify(rows[raw.line - 1]));
    }
    for (const locale of ['en', 'zh-CN']) for (const event of session.logicalEvents.slice(1)) {
      const detail = await codex.buildHydratedEventDetail(index, session, event.id, event.layer, { locale });
      assert.ok(detail.timelineSections.length + detail.inspectorSections.length > 0);
      if (event.subtype === 'thread_settings_applied') assert.match(JSON.stringify(detail), locale === 'en' ? /Applied thread settings/ : /已应用的线程设置/);
    }
    const timeline = codex.getTimeline(index, session, { layer: 'main', q: 'searchable', locale: 'en', offset: 0, limit: 100 });
    assert.equal(timeline.searchEventCount, 2);
    const matches = await codex.filterSessions(index, { q: 'searchable', layer: 'main', locale: 'en', offset: 0, limit: 100 });
    assert.ok(JSON.stringify(matches).includes(ID));
    index = await codex.buildSourceBackedIndex({ ...options, previousIndex: index });
    assert.equal(index.totals.reusedFileCount, 1);
    session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
  }
});
