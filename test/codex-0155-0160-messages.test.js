'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

// Synthetic, not observed writer logs. Pinned rust-v0.160.0: protocol/items.rs,
// protocol/user_input.rs, core/event_mapping.rs, session/mod.rs and hook_runtime.rs.
// User typed IDs are new UUIDs; assistant/reasoning/external-output IDs copy a
// present response ID. Image references are flattened in both wire families.
const ID = 'dddddddd-0160-4160-9160-dddddddddddd';
const TURN = 'message-turn';
const event = (payload) => ({ type: 'event_msg', payload });
const response = (payload) => ({ type: 'response_item', payload });
const typed = (item, fields = {}) => event({ type: 'item_completed', thread_id: ID,
  turn_id: TURN, completed_at_ms: 1790935200000, item, ...fields });
const user = (id, text, images = []) => ({ type: 'UserMessage', id,
  content: [{ type: 'text', text, text_elements: [] }, ...images.map((file_id) => ({ type: 'image', file_id }))] });
const userResponse = (id, text, images = []) => response({ type: 'message', id, role: 'user',
  content: [{ type: 'input_text', text }, ...images.map((file_id) => ({ type: 'input_image', file_id }))] });
const assistant = (id, text, fields = {}) => ({ type: 'AgentMessage', id,
  content: [{ type: 'Text', text }], phase: 'final_answer', ...fields });
const assistantResponse = (id, text) => response({ type: 'message', id, role: 'assistant',
  phase: 'final_answer', content: [{ type: 'output_text', text }] });

async function fixture(t, rows) {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0160-messages-'));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'projectless-directory');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(codexHome, 'sessions'));
  const records = [{ type: 'session_meta', payload: { id: ID, cwd: repoRoot, history_mode: 'paginated' } },
    event({ type: 'task_started', turn_id: TURN }), ...rows].map((row, i) => ({
    timestamp: new Date(Date.parse('2026-10-02T10:00:00Z') + i * 1000).toISOString(), ...row,
  }));
  const file = path.join(codexHome, 'sessions', `rollout-${ID}.jsonl`);
  await fs.writeFile(file, records.map(JSON.stringify).join('\n') + '\n');
  return { records, file, options: { codexHome, repoRoot } };
}

async function representations(f, check) {
  for (const [name, build] of [['strict', codex.__testOnly.buildUncompactedIndexForDetailTests],
    ['compact', codex.buildIndex], ['source-backed', codex.buildSourceBackedIndex]]) {
    const index = await build(f.options);
    const indexed = index.sessionsById.get(ID);
    assert.ok(indexed, `${name}: projectless cwd remains discoverable`);
    const session = name === 'source-backed' ? await materializeSessionForIndex(index, indexed) : indexed;
    await check(index, session, name);
  }
}

function main(session) { return session.logicalEvents.filter((e) => e.layer === 'main'); }
async function assertReadPaths(index, session, e, text, f) {
  const found = codex.query.getTimeline(index, session, { layer: 'main', q: text, limit: 100 });
  assert.ok(found.searchEventCount >= 1, `search ${text}`);
  assert.equal(codex.query.getEvent(index, session, e.id, { layer: 'main' }).id, e.id);
  const detail = await codex.buildHydratedEventDetail(index, session, e.id, 'main', { locale: 'en' });
  assert.ok(JSON.stringify(detail).includes(text), `detail ${text}`);
  assert.deepEqual(detail.rawRefs, e.rawRefs);
  const sourceChannels = [...new Set(e.rawRefs.map((ref) => ref.sourceRecordType))].sort();
  assert.deepEqual([...e.channels].sort(), sourceChannels);
  assert.deepEqual([...detail.meta.channels].sort(), sourceChannels);
  if (e.kind === 'external_tool_input') {
    assert.equal(detail.timelineSections.filter((s) => s.title === 'External source').length, 1);
    assert.equal(detail.timelineSections.filter((s) => s.title === 'Message').length, 1);
  }
  for (const ref of e.rawRefs) {
    const raw = session.rawEvents.find((r) => r.rawId === ref.rawId);
    const result = await codex.readRawLine(index, raw.source.file, raw.source.line);
    assert.deepEqual(result.parsed, f.records[raw.source.line - 1]);
  }
}

test('typed messages, reasoning and external outputs retain one semantic event across source representations and mirrors', async (t) => {
  const cases = [
    { kind: 'user_message', text: 'synthetic-user-marker', item: user('new-user-id', 'synthetic-user-marker'),
      mirror: userResponse('different-response-id', 'synthetic-user-marker'), counter: 'userMessages' },
    { kind: 'assistant_message', text: 'synthetic-answer-marker', item: assistant('answer-id', 'synthetic-answer-marker'),
      mirror: assistantResponse('answer-id', 'synthetic-answer-marker'), counter: 'assistantMessages' },
    { kind: 'reasoning', text: 'synthetic-reasoning-marker', item: { type: 'Reasoning', id: 'reason-id',
      summary_text: ['synthetic-reasoning-marker'], raw_content: ['synthetic-raw-reason'] },
      mirror: response({ type: 'reasoning', id: 'reason-id', summary: [{ type: 'summary_text', text: 'synthetic-reasoning-marker' }],
        content: [{ type: 'reasoning_text', text: 'synthetic-raw-reason' }] }), counter: 'reasoning' },
    { kind: 'external_tool_input', text: 'synthetic-external-output', item: { type: 'FunctionCallOutput', id: 'external-id',
      name: 'external-fixture', namespace: 'fixture', output: 'synthetic-external-output' },
      mirror: response({ type: 'function_call_output', id: 'external-id', call_id: null,
        name: 'external-fixture', namespace: 'fixture', output: 'synthetic-external-output' }) },
  ];
  for (const c of cases) await t.test(c.kind, async (t) => {
    for (const mode of ['response-only', 'typed-only', 'mixed']) {
      const rows = mode === 'response-only' ? [c.mirror] : mode === 'typed-only' ? [typed(c.item)] : [c.mirror, typed(c.item)];
      const f = await fixture(t, rows);
      await representations(f, async (index, session, repr) => {
        assert.equal(main(session).length, 1, `${mode}/${repr} semantic count`);
        const e = main(session)[0];
        assert.equal(e.kind, c.kind, `${mode}/${repr}`);
        assert.equal(e.rawRefs.length, rows.length, `${mode}/${repr} mirror traceability`);
        if (c.counter) assert.equal(session.counts[c.counter], 1);
        assert.equal(session.counts.toolCalls, 0, 'external input is not a dispatched tool');
        assert.equal(session.counts.errors, 0);
        await assertReadPaths(index, session, e, c.text, f);
      });
    }
  });
});

test('user fanout merges only the immediate prepared response with equal ordered attachments', async (t) => {
  const text = 'same-input-image-marker';
  const f = await fixture(t, [userResponse('prepared-image', text, ['file-first', 'file-second']),
    typed(user('typed-image', text, ['file-first', 'file-second'])),
    userResponse('different-images', text, ['file-first']), typed(user('typed-other-images', text, ['file-second']))]);
  await representations(f, async (index, session) => {
    const users = main(session).filter((e) => e.kind === 'user_message');
    assert.equal(users.length, 3);
    assert.equal(session.counts.userMessages, 3);
    assert.deepEqual(users.map((e) => e.rawRefs.length), [2, 1, 1]);
    const detail = await codex.buildHydratedEventDetail(index, session, users[0].id, 'main', { locale: 'en' });
    const section = detail.timelineSections.find((s) => s.title === 'Image attachments');
    assert.deepEqual(section.entries.map((e) => e.value), ['File reference', 'File reference']);
    const refs = JSON.stringify(detail.inspectorSections);
    assert.ok(refs.includes('file-first') && refs.includes('file-second'));
    await assertReadPaths(index, session, users[0], text, f);
  });
});

test('external output mirrors require full output and untruncated source attribution', async (t) => {
  const prefix = 'x'.repeat(17000);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  for (const [name, left, right, merged, markers] of [
    ['different-text-tail', { output: prefix + ' response-tail-marker' }, { output: prefix + ' typed-tail-marker' }, false,
      ['response-tail-marker', 'typed-tail-marker']],
    ['equal-long-text', { output: prefix + ' same-tail-marker' }, { output: prefix + ' same-tail-marker' }, true, ['same-tail-marker']],
    ['different-array-tail', { output: [{ type: 'input_text', text: prefix + ' response-array-marker' }] },
      { output: [{ type: 'input_text', text: prefix + ' typed-array-marker' }] }, false, ['response-array-marker', 'typed-array-marker']],
    ['different-name', { name: 'n'.repeat(1000) + 'left' }, { name: 'n'.repeat(1000) + 'right' }, false, []],
    ['different-namespace', { namespace: 'n'.repeat(1000) + 'left' }, { namespace: 'n'.repeat(1000) + 'right' }, false, []],
    ['different-opaque', { output: [{ type: 'encrypted_content', encrypted_content: 'opaque-left' }] },
      { output: [{ type: 'encrypted_content', encrypted_content: 'opaque-right' }] }, false, []],
    ['equal-array-reordered-keys', { output: [{ type: 'input_text', text: 'equal-array-marker' }] },
      { output: [{ text: 'equal-array-marker', type: 'input_text' }] }, true, ['equal-array-marker']],
    ['different-externalized-image', { output: [{ type: 'input_image', image_url: `data:image/png;base64,${png}` }] },
      { output: [{ type: 'input_image', image_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }] }, false, []],
  ]) await t.test(name, async (t) => {
    const common = { id: 'external-compare', name: 'source-fixture', namespace: 'fixture', output: 'short-output' };
    const f = await fixture(t, [response({ type: 'function_call_output', call_id: null, ...common, ...left }),
      typed({ type: 'FunctionCallOutput', ...common, ...right })]);
    await representations(f, async (index, session) => {
      const inputs = main(session).filter((e) => e.kind === 'external_tool_input');
      assert.equal(inputs.length, merged ? 1 : 2, name);
      assert.deepEqual(inputs.map((e) => e.rawRefs.length), merged ? [2] : [1, 1]);
      assert.equal(session.counts.toolCalls, 0);
      assert.equal(session.counts.userMessages, 0);
      for (const marker of markers) {
        const found = codex.query.getTimeline(index, session, { layer: 'main', q: marker });
        assert.equal(found.searchEventCount, 1, `${marker} remains searchable`);
        assert.ok(found.events.some((e) => inputs.some((input) => input.id === e.id)));
      }
      for (const e of inputs) {
        const detail = await codex.buildHydratedEventDetail(index, session, e.id, 'main');
        assert.equal(detail.timelineSections.filter((s) => s.title === 'External source' && s.type === 'kv').length, 1);
        for (const ref of e.rawRefs) assert.deepEqual((await codex.readRawLine(index, ref.file, ref.line)).parsed, f.records[ref.line - 1]);
      }
    });
  });
});

test('typed inline image identity survives externalization, hydration and appended mirror matching', async (t) => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const imageUrl = `data:image/png;base64,${png}`;
  const text = 'inline-mirror-marker';
  const prepared = (id, url) => response({ type: 'message', id, role: 'user', content: [
    { type: 'input_text', text }, { type: 'input_image', image_url: url }, { type: 'input_image', file_id: 'file-mixed' },
  ] });
  const completed = (id, url) => typed({ type: 'UserMessage', id, content: [
    { type: 'text', text }, { type: 'image', image_url: url }, { type: 'image', file_id: 'file-mixed' },
  ] });
  const f = await fixture(t, [prepared('response-id', imageUrl)]);
  const initial = await codex.buildSourceBackedIndex(f.options);
  const appended = { timestamp: '2026-10-02T10:01:00Z', ...completed('typed-id', imageUrl) };
  f.records.push(appended);
  await fs.appendFile(f.file, JSON.stringify(appended) + '\n');
  const check = async (index, session) => {
    assert.equal(session.counts.userMessages, 1);
    const users = main(session).filter((e) => e.kind === 'user_message');
    assert.equal(users.length, 1);
    assert.equal(users[0].rawRefs.length, 2);
    await assertReadPaths(index, session, users[0], text, f);
    const detail = await codex.buildHydratedEventDetail(index, session, users[0].id, 'main');
    assert.deepEqual(detail.timelineSections.find((s) => s.title === 'Image attachments').entries.map((e) => e.value),
      ['Inline image', 'File reference']);
    assert.ok(!JSON.stringify(detail).includes(png));
    assert.ok(!JSON.stringify(session).includes(png));
  };
  await representations(f, check);
  const updated = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: initial });
  const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: updated });
  for (const index of [updated, warm]) await check(index, await materializeSessionForIndex(index, index.sessionsById.get(ID)));

  const different = await fixture(t, [prepared('response-different', imageUrl), completed('typed-different', 'https://example.invalid/different.png')]);
  await representations(different, async (_index, session) => {
    assert.equal(session.counts.userMessages, 2, 'externalization must not merge different image identities');
  });
});

test('same-text user inputs remain separate across a second acceptance, intervening records and turn epochs', async (t) => {
  const text = 'repeated-user-input-marker';
  const f = await fixture(t, [
    userResponse('prepared-one', text), typed(user('typed-one', text)),
    userResponse('prepared-two', text), typed(user('typed-two', text)),
    userResponse('nonadjacent', text), event({ type: 'future_event', note: 'fanout barrier' }), typed(user('nonadjacent-typed', text)),
    userResponse('before-turn-end', text), event({ type: 'task_complete', turn_id: TURN }),
    event({ type: 'task_started', turn_id: 'next-turn' }), typed(user('next-turn-user', text), { turn_id: 'next-turn' }),
  ]);
  await representations(f, async (_index, session) => {
    const users = main(session).filter((e) => e.kind === 'user_message');
    assert.equal(users.length, 6);
    assert.equal(session.counts.userMessages, 6);
    assert.deepEqual(users.map((e) => e.rawRefs.length), [2, 2, 1, 1, 1, 1]);
  });
});

test('assistant and reasoning mirrors require unique exact IDs and compatible content and turn', async (t) => {
  const text = 'same-assistant-marker';
  const f = await fixture(t, [assistantResponse('different-id', text), typed(assistant('typed-different-id', text)),
    assistantResponse('conflict-id', 'original-answer-marker'), typed(assistant('conflict-id', 'changed-answer-marker')),
    assistantResponse('cross-turn-id', text), event({ type: 'task_complete', turn_id: TURN }),
    event({ type: 'task_started', turn_id: 'second-turn' }), typed(assistant('cross-turn-id', text), { turn_id: 'second-turn' }),
    response({ type: 'reasoning', id: 'reason-response', summary: [{ type: 'summary_text', text: 'same-reason-marker' }] }),
    typed({ type: 'Reasoning', id: 'reason-other', summary_text: ['same-reason-marker'], raw_content: [] }, { turn_id: 'second-turn' })]);
  await representations(f, async (_index, session) => {
    assert.equal(session.counts.assistantMessages, 6);
    assert.equal(session.counts.reasoning, 2);
    assert.ok(main(session).filter((e) => ['assistant_message', 'reasoning'].includes(e.kind)).every((e) => e.rawRefs.length === 1));
  });
});

test('duplicate typed identity and foreign-thread messages stay inspectable without semantic inflation', async (t) => {
  const f = await fixture(t, [typed(user('duplicate-user', 'first-duplicate-marker')),
    typed(user('duplicate-user', 'second-duplicate-marker')),
    typed(assistant('foreign-agent', 'foreign-message-marker'), { thread_id: 'eeeeeeee-0160-4160-9160-eeeeeeeeeeee' }),
    typed({ type: 'Reasoning', id: 'foreign-reasoning', summary_text: ['foreign-reasoning-marker'], raw_content: [] },
      { thread_id: 'eeeeeeee-0160-4160-9160-eeeeeeeeeeee' })]);
  await representations(f, async (index, session) => {
    assert.equal(main(session).length, 0);
    assert.equal(session.counts.messages, 0);
    assert.equal(session.counts.reasoning, 0);
    const protocol = session.logicalEvents.filter((e) => e.subtype === 'item_completed');
    assert.equal(protocol.length, 4);
    for (const e of protocol) assert.ok(await codex.buildHydratedEventDetail(index, session, e.id, 'protocol', { locale: 'en' }));
  });
});

test('canonical async delivery retains its question provenance and is not an ordinary response mirror', async (t) => {
  const text = 'async-question-marker';
  const f = await fixture(t, [assistantResponse('async-id', text), typed(assistant('async-id', text,
    { delivery: 'async', questions: [{ title: 'Choose format', options: ['Text', 'JSON'] }] }))]);
  await representations(f, async (index, session) => {
    const answers = main(session).filter((e) => e.kind === 'assistant_message');
    assert.equal(answers.length, 2);
    const async = answers.find((e) => e.asyncMessage);
    assert.equal(async.asyncMessage.delivery, 'async');
    assert.deepEqual(async.asyncMessage.questions, [{ title: 'Choose format', options: ['Text', 'JSON'] }]);
    assert.equal(session.counts.toolCalls, 0);
    await assertReadPaths(index, session, async, text, f);
  });
});

test('typed message counts survive warm reuse and source-backed incremental append', async (t) => {
  const f = await fixture(t, [typed(user('initial-user', 'initial-message-marker'))]);
  const cold = await codex.buildSourceBackedIndex(f.options);
  const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: cold });
  assert.equal(warm.totals.reusedFileCount, 1);
  assert.equal(warm.sessionsById.get(ID).counts.userMessages, 1);
  const warmSession = await materializeSessionForIndex(warm, warm.sessionsById.get(ID));
  assert.deepEqual(main(warmSession)[0].channels, ['event_msg']);
  await fs.appendFile(f.file, JSON.stringify({ timestamp: '2026-10-02T10:01:00Z',
    ...typed(assistant('appended-answer', 'appended-answer-marker')) }) + '\n');
  const updated = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: warm });
  const session = await materializeSessionForIndex(updated, updated.sessionsById.get(ID));
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.assistantMessages, 1);
  assert.equal(main(session).length, 2);
  for (const e of main(session)) {
    assert.deepEqual(e.channels, ['event_msg']);
    assert.deepEqual((await codex.buildHydratedEventDetail(updated, session, e.id, 'main')).meta.channels, ['event_msg']);
  }
});

test('conflicting full external output stays separately searchable after append and warm reuse', async (t) => {
  const common = { id: 'external-append', name: 'external-fixture', namespace: 'fixture' };
  const prefix = 'x'.repeat(17000);
  const f = await fixture(t, [response({ type: 'function_call_output', ...common, output: prefix + ' first-tail-marker' })]);
  const initial = await codex.buildSourceBackedIndex(f.options);
  const next = { timestamp: '2026-10-02T10:01:00Z',
    ...typed({ type: 'FunctionCallOutput', ...common, output: prefix + ' second-tail-marker' }) };
  await fs.appendFile(f.file, JSON.stringify(next) + '\n');
  const appended = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: initial });
  const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: appended });
  for (const index of [appended, warm]) {
    const session = await materializeSessionForIndex(index, index.sessionsById.get(ID));
    const inputs = main(session);
    assert.equal(inputs.length, 2);
    assert.deepEqual(inputs.map((e) => e.channels), [['response_item'], ['event_msg']]);
    for (const marker of ['first-tail-marker', 'second-tail-marker']) {
      assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: marker }).searchEventCount, 1);
    }
  }
});
