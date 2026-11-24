'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');

test('a reverted TUI child keeps only a bootstrap proven by the original owned physical prefix', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-reverted-side-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'sessions');
  await fs.mkdir(dir);
  const parent = 'aaaaaaaa-0172-4172-8172-aaaaaaaaaaaa';
  const chosen = new Map();
  const scenarios = [];
  const file = (thread, rollout = thread) => path.join(dir, 'rollout-2026-11-24T02-00-00-' + thread
    + (rollout === thread ? '' : '_' + rollout) + '.jsonl');
  const encode = (row, ordinal) => JSON.stringify({ timestamp: new Date(1790000000000 + 1000 * ordinal).toISOString(), ordinal, ...row }) + '\n';
  const header = (id, fields = {}) => ({ type: 'session_meta', payload: { id, cwd: home, history_mode: 'paginated', ...fields } });
  const event = (type) => ({ type: 'event_msg', payload: { type } });
  const base = (thread_id, end_ordinal_exclusive, prefix) => ({ thread_id, end_ordinal_exclusive, end_byte_offset: Buffer.byteLength(prefix) });
  const message = (role, text, attribution) => ({ type: 'response_item', payload: {
    type: 'message', role, content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: attribution,
  } });
  const policy = message('developer', '<side_conversation>fixture</side_conversation>', {
    content_item_kinds: ['side_conversation.policy'], content_item_metadata: [{ provenance: { type: 'harness' } }],
  });
  const boundary = message('user', 'Side conversation boundary.\n\nOriginal context.', { content_item_kinds: ['unknown'] });
  const parentFile = encode(header(parent), 0);
  await fs.writeFile(file(parent), parentFile);
  for (const [n, kept] of [4, 3, 2, 0].entries()) {
    const child = 'bbbbbbbb-0172-4172-8172-00000000000' + n;
    const replacement = 'cccccccc-0172-4172-8172-00000000000' + n;
    const side = { thread_source: 'tui_side_chat', forked_from_id: parent, attached_thread: true };
    const old = [header(child, { ...side, history_base: base(parent, 1, parentFile) }),
      event('thread_settings_applied'), policy, boundary];
    const prefix = old.slice(0, kept).map((row, i) => encode(row, 1 + i)).join('');
    await fs.writeFile(file(child), old.map((row, i) => encode(row, 1 + i)).join(''));
    // A revert into the parent's prefix drops the original child artifact
    // completely, even if its old file still exists on disk.
    const position = kept ? base(child, 1 + kept, prefix) : base(parent, 1, parentFile);
    const tail = [header(child, { ...side, history_base: position }), ...old.slice(kept || 1),
      event('task_started'), message('user', 'New question.')];
    await fs.writeFile(file(child, replacement), tail.map((row, i) => encode(row, 1 + kept + i)).join(''));
    chosen.set(child, file(child, replacement));
    scenarios.push({ child, kept });
  }
  const options = { repoRoot: home, codexHome: home, currentRolloutPathsForTests: chosen };
  const cold = await codex.buildSourceBackedIndex(options);
  const reindex = await codex.buildSourceBackedIndex({ ...options, previousIndex: cold });
  for (const index of [await codex.__testOnly.buildUncompactedIndexForDetailTests(options),
    await codex.buildIndex(options), cold, reindex]) {
    t.after(() => disposeIndexResources(index));
    for (const { child, kept } of scenarios) {
      const indexed = index.sessionsById.get(child);
      assert.ok(indexed, 'admitted revert');
      assert.equal(indexed.counts.userMessages, kept === 4 ? 1 : 2, 'owned rows before revert: ' + kept);
      const session = indexed.logicalEvents ? indexed : await materializeSessionForIndex(index, indexed);
      const boundaries = session.logicalEvents.filter(e => e.subtype === 'side_conversation_boundary');
      assert.equal(boundaries.length, kept === 4 ? 1 : 0);
      for (const row of boundaries) {
        const [ref] = row.rawRefs;
        assert.equal(path.basename(ref.file), path.basename(file(child)));
        assert.equal(ref.line, 4);
        const raw = await codex.readIndexedCodexRawRecord(index, session, session.rawEvents.find(r => r.rawId === ref.rawId));
        assert.deepEqual(raw.parsed.payload, boundary.payload);
      }
    }
  }
});

test('only the owned pre-turn TUI side-chat bootstrap leaves the user timeline', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-side-chat-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'sessions');
  await fs.mkdir(dir);
  const message = (role, text, metadata) => ({ type: 'response_item', payload: {
    type: 'message', role, content: [{ type: 'input_text', text }],
    ...(metadata && { internal_chat_message_metadata_passthrough: metadata }),
  } });
  const policy = message('developer', '<side_conversation>fixture policy</side_conversation>', {
    content_item_kinds: ['side_conversation.policy'], content_item_metadata: [{ provenance: { type: 'harness', hook: false } }],
  });
  const boundary = message('user', 'Side conversation boundary.\n\nFixture inherited reference.', { content_item_kinds: ['unknown'] });
  const started = { type: 'event_msg', payload: { type: 'task_started', turn_id: 'side-turn' } };
  const question = message('user', 'Fixture child question.');
  const header = { cwd: home, history_mode: 'paginated', forked_from_id: 'parent',
    attached_thread: true, thread_source: 'tui_side_chat' };
  const cases = [
    ['side', {}, [policy, boundary, started, question, boundary], 2, 1],
    ['generic', { thread_source: 'user' }, [policy, boundary], 1, 0],
    ['ordinary', { attached_thread: false }, [policy, boundary], 1, 0],
    ['standalone-replacement', {}, [policy, boundary], 1, 0],
    ['unknown-file-identity', {}, [policy, boundary], 1, 0],
    ['no-parent', { forked_from_id: null }, [policy, boundary], 1, 0],
    ['late', {}, [started, policy, boundary], 1, 0],
    ['uncertain-prefix', {}, [{ type: 'event_msg', payload: { type: 'future_event' } }, policy, boundary], 1, 0],
    ['physical-gap', {}, [null, policy, boundary], 1, 0],
    ['ordinal-gap', {}, [policy, { ...boundary, ordinal: 122 }], 1, 0],
    ['missing-ordinal', {}, [policy, { ...boundary, ordinal: undefined }], 1, 0],
    ['missing-policy', {}, [boundary], 1, 0],
    ['unattributed-policy', {}, [message('developer', policy.payload.content[0].text), boundary], 1, 0],
    ['typed-submission', {}, [policy, boundary, { type: 'event_msg', payload: { type: 'item_completed',
      thread_id: 'typed-submission', turn_id: 'user-turn', item: { type: 'UserMessage', id: 'fresh', content: [
        { type: 'text', text: boundary.payload.content[0].text, text_elements: [] }] } } }], 1, 0],
    ['reversed', {}, [boundary, policy], 1, 0],
    ['wrong-policy', {}, [message('developer', '<side_conversation>not closed'), boundary], 1, 0],
    ['extra-content', {}, [policy, { ...boundary, payload: { ...boundary.payload,
      content: [...boundary.payload.content, { type: 'input_text', text: 'another input' }] } }], 1, 0],
    ['wrong-heading', {}, [policy, message('user', 'Side conversation boundary. A quotation.')], 1, 0],
    ['attributed-input', {}, [policy, message('user', boundary.payload.content[0].text, {
      content_item_kinds: ['user.text'], content_item_metadata: [{ provenance: { type: 'user' } }],
    })], 1, 0],
  ];
  const ids = new Map();
  for (const [index, [name, fields, body]] of cases.entries()) {
    const id = 'dddddddd-0172-4172-8172-' + String(index).padStart(12, '0');
    ids.set(name, id);
    for (const row of body) if (row?.payload?.type === 'item_completed') row.payload.thread_id = id;
    const rows = [{ type: 'session_meta', payload: { ...header, id, ...fields } },
      { type: 'event_msg', payload: { type: 'thread_settings_applied' } }, ...body];
    const suffix = name === 'standalone-replacement' ? '_eeeeeeee-0172-4172-8172-eeeeeeeeeeee' : '';
    const file = name === 'unknown-file-identity' ? 'rollout-import.jsonl' : 'rollout-2026-11-24T02-00-00-' + id + suffix + '.jsonl';
    const startOrdinal = suffix ? 0 : 14;
    await fs.writeFile(path.join(dir, file), rows.map((row, n) => row === null ? '' :
      JSON.stringify({ ordinal: startOrdinal + n, timestamp: new Date(1790000000000 + n * 1000).toISOString(), ...row })).join('\n') + '\n');
  }
  const options = { repoRoot: home, codexHome: home };
  const cold = await codex.buildSourceBackedIndex(options);
  const warm = await codex.buildSourceBackedIndex({ ...options, previousIndex: cold });
  assert.ok(warm.totals.reusedFileCount > 0);
  for (const index of [await codex.__testOnly.buildUncompactedIndexForDetailTests(options),
    await codex.buildIndex(options), cold, warm]) {
    t.after(() => disposeIndexResources(index));
    for (const [name, , , users, boundaries] of cases) {
      const indexed = index.sessionsById.get(ids.get(name));
      assert.ok(indexed, name);
      assert.equal(indexed.counts.userMessages, users, name);
      const session = indexed.logicalEvents ? indexed : await materializeSessionForIndex(index, indexed);
      const matches = session.logicalEvents.filter(e => e.subtype === 'side_conversation_boundary');
      assert.equal(matches.length, boundaries, name);
      if (!boundaries) continue;
      const [match] = matches;
      assert.equal(match.layer, 'protocol');
      assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'Fixture inherited reference' }).searchEventCount, 1);
      assert.equal(codex.query.getTimeline(index, session, { layer: 'protocol', q: 'Fixture inherited reference' }).searchEventCount, 1);
      assert.deepEqual(match.rawRefs.map(ref => ref.line), [4]);
      const raw = await codex.readIndexedCodexRawRecord(index, session, session.rawEvents.find(r => r.rawId === match.rawRefs[0].rawId));
      assert.deepEqual(raw.parsed.payload, boundary.payload);
    }
  }
});
