'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildSourceBackedIndex } = require('../src/codex');
const { materializeIndexedSession, openApp, switchHiddenLocale, waitForDetailView, writeJsonl } = require('./browser-helpers');

test('Codex 0.172 persisted evidence has the same owners in Timeline and Trajectory', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0172-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const id = 'aaaaaaaa-0172-4172-8172-aaaaaaaaaaaa';
  const turn = 'fixture-turn';
  const response = payload => ({ type: 'response_item', payload });
  const completion = item => ({ type: 'event_msg', payload: { type: 'item_completed', thread_id: id, turn_id: turn, item } });
  const prompt = '<example>submitted question</example>';
  const marker = 'Synthetic side bootstrap evidence';
  const heartbeat = 'Synthetic scheduled heartbeat';
  const records = [
    { type: 'session_meta', payload: { id, cwd: home, history_mode: 'paginated', attached_thread: true,
      thread_source: 'tui_side_chat', forked_from_id: 'bbbbbbbb-0172-4172-8172-bbbbbbbbbbbb' } },
    response({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<side_conversation>fixture policy</side_conversation>' }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['side_conversation.policy'],
        content_item_metadata: [{ provenance: { type: 'harness' } }] } }),
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Side conversation boundary.\n\n' + marker }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['unknown'] } }),
    { type: 'event_msg', payload: { type: 'task_started', turn_id: turn } },
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }],
      internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: ['user.text'],
        content_item_metadata: [{ provenance: { type: 'user' } }] } }),
    completion({ type: 'UserMessage', id: 'submitted', content: [{ type: 'text', text: prompt, text_elements: [] }] }),
    { type: 'realtime_item', payload: { type: 'frame', id: 'frame', realtime_session_id: 'recording',
      channels: { voice_transcript: { role: 'assistant', text: 'spoken fixture answer' } } } },
    completion({ type: 'Extension', kind: 'image_gen.generation', id: 'image', status: 'completed',
      fileId: 'fixture-image', revisedPrompt: 'generated fixture' }),
    response({ type: 'function_call', name: 'echo', namespace: 'mcp__106cd32d0170__notes', arguments: '{}', call_id: 'tool' }),
    completion({ type: 'McpToolCall', id: 'tool', tool: 'echo', server: 'notes', environmentId: 'synthetic-registration-scope',
      status: 'failed', result: { isError: true, content: [{ type: 'text', text: 'fixture failure' }] } }),
    response({ type: 'function_call_output', call_id: 'tool', output: 'fixture failure' }),
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: heartbeat }],
      internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: ['user.heartbeat'],
        content_item_metadata: [{ provenance: { type: 'user' } }] } }),
    completion({ type: 'UserMessage', id: 'scheduled', content: [{ type: 'text', text: heartbeat, text_elements: [] }] }),
  ];
  await writeJsonl(path.join(home, 'sessions', `rollout-2026-11-24T00-00-00-${id}.jsonl`), records.map((row, n) => ({
    timestamp: new Date(Date.UTC(2026, 10, 24, 0, 0, n)).toISOString(), ordinal: n, ...row,
  })));
  const index = await buildSourceBackedIndex({ repoRoot: home, codexHome: home });
  const session = await materializeIndexedSession(index, id);
  const main = session.logicalEvents.filter(event => event.layer === 'main');
  assert.deepEqual(main.map(event => event.rawRefs.map(ref => ref.line)), [[5, 6], [7], [8], [9, 10, 11]]);
  assert.equal(main[3].status, 'failed');
  const controls = [[marker, [3]], [heartbeat, [12, 13]]].map(([text, lines]) => {
    const event = session.logicalEvents.find(e => e.layer === 'protocol' && e.rawRefs.some(ref => ref.line === lines[0]));
    assert.deepEqual(event.rawRefs.map(ref => ref.line), lines);
    return { text, event };
  });
  const { page } = await openApp(t, index, { locale: 'en' });
  for (const locale of ['en', 'zh-CN']) {
    if (locale !== 'en') await switchHiddenLocale(page, locale);
    await page.waitForFunction(lang => document.documentElement.lang === lang, locale);
    await page.locator('#layerSelect').selectOption('main');
    for (const presentation of ['timeline', 'trajectory']) {
      await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).click();
      if (presentation === 'trajectory') {
        await page.locator('.trajectoryPresentation').waitFor();
        for (const group of await page.locator('.trajectoryToolGroup').all()) {
          if (!(await group.evaluate(node => node.open))) await group.locator('summary').click();
        }
      }
      const attribute = presentation === 'timeline' ? 'data-event-id' : 'data-trajectory-event-id';
      for (const event of main) {
        const card = page.locator(`#timeline [${attribute}="${event.id}"]`);
        await card.waitFor();
        assert.equal(await card.count(), 1);
      }
      assert.match(await page.locator('#timeline').innerText(), /spoken fixture answer/);
      for (const { text } of controls) assert.ok(!(await page.locator('#timeline').innerText()).includes(text));
      const speech = page.locator(`#timeline [${attribute}="${main[1].id}"]`);
      await (presentation === 'timeline' ? speech.locator('.eventKind') : speech).click();
      await waitForDetailView(page, 'inspector');
      await page.locator('#detail [data-detail-action="raw"]').click();
      await waitForDetailView(page, 'rawRefs');
      await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('spoken fixture answer'));
    }
    await page.locator('#layerSelect').selectOption('protocol');
    for (const { text, event } of controls) {
      await page.locator(`#timeline [data-event-id="${event.id}"] .eventKind`).click();
      await waitForDetailView(page, 'inspector');
      await page.locator('#detail [data-detail-action="raw"]').click();
      await waitForDetailView(page, 'rawRefs');
      await page.waitForFunction(value => document.querySelector('#detail .rawRefsView')?.textContent.includes(value), text);
    }
  }
});
