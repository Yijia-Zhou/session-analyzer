'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildSourceBackedIndex } = require('../src/codex');
const { fillSearch, materializeIndexedSession, openApp, switchHiddenLocale, waitForDetailView, writeJsonl } = require('./browser-helpers');

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
  const namespace = 'mcp__106cd32d0170__notes';
  const shellReceipt = 'scoped-shell-receipt';
  const foreignReceipt = 'another-tool-receipt';
  const foreignEnd = 'another-environment-terminal';
  const foreignTyped = 'foreign-typed-completion';
  const foreignBegin = 'foreign-dynamic-start';
  const oldTurnReceipt = 'old-turn-tool-receipt';
  const transport = 'dynamic-transport-only';
  const priorTurn = 'prior-turn-transport-response';
  const foreignCommand = 'foreign-begin-output';
  const foreignArguments = 'another-invocation-result';
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
    response({ type: 'function_call', name: 'shell_command', namespace, arguments: '{}', call_id: 'tool' }),
    completion({ type: 'McpToolCall', id: 'tool', tool: 'shell_command', server: 'notes', environmentId: 'synthetic-registration-scope',
      status: 'failed', result: { isError: true, content: [{ type: 'text', text: 'fixture failure' }] } }),
    response({ type: 'function_call_output', call_id: 'tool', output: 'fixture failure' }),
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: heartbeat }],
      internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: ['user.heartbeat'],
        content_item_metadata: [{ provenance: { type: 'user' } }] } }),
    completion({ type: 'UserMessage', id: 'scheduled', content: [{ type: 'text', text: heartbeat, text_elements: [] }] }),
    response({ type: 'function_call', name: 'shell_command', namespace, arguments: '{"command":"echo synthetic"}', call_id: 'scoped-shell' }),
    response({ type: 'function_call_output', call_id: 'scoped-shell', output: shellReceipt }),
    response({ type: 'function_call', name: 'spawn_agent', namespace, arguments: '{}', call_id: 'scoped-agent' }),
    response({ type: 'function_call_output', call_id: 'scoped-agent', output: 'scoped-agent-receipt' }),
    response({ type: 'function_call', name: 'shell_command', namespace: 'functions', arguments: '{"command":"echo native"}', call_id: 'native' }),
    response({ type: 'function_call_output', call_id: 'native', output: 'native-shell-receipt' }),
    response({ type: 'function_call_output', call_id: 'tool', name: 'different', output: foreignReceipt }),
    { type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'tool',
      invocation: { server: 'notes', tool: 'shell_command', environment_id: 'other-environment' },
      result: { Ok: { content: [{ type: 'text', text: foreignEnd }] } } } },
    { type: 'event_msg', payload: { type: 'dynamic_tool_call_end', call_id: 'scoped-shell',
      tool_name: namespace + '.shell_command', success: false } },
    completion({ type: 'McpToolCall', id: 'tool', server: 'notes', tool: 'shell_command', environmentId: 'other-environment',
      status: 'completed', result: { content: [{ type: 'text', text: foreignTyped }] } }),
    { type: 'event_msg', payload: { type: 'dynamic_tool_call_begin', call_id: 'tool',
      tool_name: namespace + '.other', message: foreignBegin } },
    response({ type: 'function_call_output', call_id: 'tool', output: oldTurnReceipt,
      internal_chat_message_metadata_passthrough: { turn_id: 'earlier-turn' } }),
    { type: 'event_msg', payload: { type: 'dynamic_tool_call_request', callId: 'scoped-shell', turnId: turn,
      namespace, tool: 'shell_command', arguments: { query: transport } } },
    completion({ type: 'DynamicToolCall', id: 'scoped-shell', namespace, tool: 'shell_command',
      arguments: { command: 'echo synthetic' }, status: 'failed', success: false, error: 'typed dynamic failure' }),
    response({ type: 'custom_tool_call', name: 'custom', namespace, call_id: 'native', input: 'independent request' }),
    completion({ type: 'CommandExecution', id: 'native', source: 'agent', command: ['/bin/sh', '-c', 'echo native'],
      cwd: 'file:///synthetic/project', parsed_cmd: [], status: 'failed', exit_code: 72, aggregated_output: 'native failure' }),
    response({ type: 'custom_tool_call_output', call_id: 'native', output: 'independent custom receipt' }),
    { type: 'event_msg', payload: { type: 'exec_command_begin', call_id: 'native', source: 'user_shell',
      command: ['echo', foreignCommand] } },
    response({ type: 'custom_tool_call', call_id: 'shared-mcp', namespace, name: 'custom', input: 'custom channel' }),
    response({ type: 'function_call', call_id: 'shared-mcp', name: 'mcp__notes__echo', arguments: '{}' }),
    { type: 'event_msg', payload: { type: 'dynamic_tool_call_response', call_id: 'shared-mcp', turn_id: 'prior-turn',
      tool: 'echo', success: true, content_items: [{ type: 'inputText', text: priorTurn }] } },
    completion({ type: 'McpToolCall', id: 'shared-mcp', server: 'notes', tool: 'echo', arguments: {},
      status: 'failed', error: { message: 'verified-flat-mcp-failure' } }),
    response({ type: 'function_call_output', call_id: 'shared-mcp', output: 'ordinary MCP receipt' }),
    { type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'tool',
      invocation: { server: 'notes', tool: 'shell_command', environment_id: 'synthetic-registration-scope', arguments: { q: 'other' } },
      result: { Ok: { content: [{ type: 'text', text: foreignArguments }] } } } },
    response({ type: 'custom_tool_call', call_id: 'shared-mcp', namespace, name: 'custom', input: 'second custom request' }),
  ].map((row, n) => ({
    timestamp: new Date(Date.UTC(2026, 10, 24, 0, 0, n)).toISOString(), ordinal: n, ...row,
  }));
  await writeJsonl(path.join(home, 'sessions', `rollout-2026-11-24T00-00-00-${id}.jsonl`), records);
  const index = await buildSourceBackedIndex({ repoRoot: home, codexHome: home });
  const session = await materializeIndexedSession(index, id);
  const main = session.logicalEvents.filter(event => event.layer === 'main');
  assert.deepEqual(main.map(event => event.rawRefs.map(ref => ref.line)),
    [[5, 6], [7], [8], [9, 10, 11], [14, 15, 22, 27], [16, 17], [18, 19, 29], [28, 30], [32], [33, 35, 36], [38]]);
  const tools = [
    [main[3], 'mcp_call', 'failed'],
    [main[4], 'other_tool_call', 'failed'],
    [main[5], 'other_tool_call', 'completed'],
    [main[6], 'command', 'failed'],
    [main[7], 'other_tool_call', 'completed'],
    [main[8], 'other_tool_call', 'incomplete'],
    [main[9], 'mcp_call', 'failed'],
    [main[10], 'other_tool_call', 'incomplete'],
  ];
  const controls = [[marker, [3]], [heartbeat, [12, 13]], [foreignReceipt, [20]], [foreignEnd, [21]],
    [foreignTyped, [23]], [foreignBegin, [24]], [oldTurnReceipt, [25]], [transport, [26]],
    [foreignCommand, [31]], [priorTurn, [34]], [foreignArguments, [37]]].map(([text, lines]) => {
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
      for (const [event, kind, status] of tools) {
        const card = page.locator(`#timeline [${attribute}="${event.id}"]`);
        if (presentation === 'timeline') {
          assert.ok(await card.evaluate((node, kind) => node.classList.contains('kind-' + kind.replaceAll('_', '-')), kind));
          assert.equal(await card.locator('.statusChip').textContent(), status);
        } else {
          assert.equal(await card.getAttribute('data-kind'), kind);
          assert.equal(await card.locator('.trajectoryEventStatus').textContent(), status);
        }
      }
      assert.match(await page.locator('#timeline').innerText(), /spoken fixture answer/);
      for (const { text } of controls) assert.ok(!(await page.locator('#timeline').innerText()).includes(text));
      const speech = page.locator(`#timeline [${attribute}="${main[1].id}"]`);
      await (presentation === 'timeline' ? speech.locator('.eventKind') : speech).click();
      await waitForDetailView(page, 'inspector');
      await page.locator('#detail [data-detail-action="raw"]').click();
      await waitForDetailView(page, 'rawRefs');
      await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('spoken fixture answer'));

      await fillSearch(page, shellReceipt);
      const hit = page.locator(`#timeline .searchHit[${attribute}]`);
      await hit.locator('.searchMark').first().waitFor({ state: 'attached' });
      const foldedMatch = hit.locator('details.searchSupplementDetails:not([open])').filter({ has: page.locator('.searchMark') });
      if (await foldedMatch.count()) await foldedMatch.first().locator('summary').click();
      await hit.locator('.searchMark:visible').first().waitFor();
      assert.equal(await hit.count(), 1);
      assert.equal(await page.locator('body').getAttribute('data-main-presentation'), presentation);
      assert.equal(await hit.getAttribute(attribute), main[4].id);
      await (presentation === 'timeline' ? hit.locator('.eventKind') : hit).click();
      await waitForDetailView(page, 'inspector');
      await page.locator('#detail [data-detail-action="raw"]').click();
      const raw = page.locator('#detail .rawRefsView pre');
      await raw.first().waitFor();
      assert.deepEqual((await raw.allTextContents()).map(text => JSON.parse(text)), [records[13], records[14], records[21], records[26]]);
      await fillSearch(page, '');
      await hit.waitFor({ state: 'detached' });
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
