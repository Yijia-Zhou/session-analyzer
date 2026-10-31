'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { analyzerSessionId, buildClaudeSourceBackedIndex } = require('../src/claude');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { trustedPolicy } = require('../src/legacy-raw-owner-budget');
const { withNavigationDiagnostics } = require('./browser-diagnostics');

const {
  fixtureCodexHome,
  repoRoot,
  primaryFixtureSessionId,
  deferred,
  buildFixtureIndex,
  materializeIndexedSession,
  openApp,
  openWave1cM1App,
  latestWave1cM1Lifecycle,
  switchHiddenLocale,
  selectPrimarySession,
  writeJsonl,
  expectInputValue,
  fillSearch,
  addSearchFilter,
  clearAllSearch,
  switchToProjectScope,
  waitForNoSearchMarks,
  waitForDetailView,
  makeLongCodexHome,
  makeCacheObservationBrowserFixture,
  makeCodeModeCodexHome,
  makeCodeModeSearchPreviewCodexHome,
} = require('./browser-helpers');

async function makeMaterializedCodexForkFixture(t, options = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-materialized-browser-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const fixtureRepo = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '09');
  const parentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const derivedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await fsp.mkdir(fixtureRepo, { recursive: true });
  const timestamp = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();
  const parentRecords = [
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 0), type: 'session_meta', payload: { id: parentId, cwd: fixtureRepo } },
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inherited browser task' }] } },
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 2), type: 'event_msg', payload: { type: 'user_message', message: 'Inherited browser task', images: [], local_images: [], text_elements: [] } },
    { timestamp: timestamp('2026-08-09T10:00:00.000Z', 3), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Inherited browser answer' }] } },
    ...Array.from({ length: 160 }, (_, index) => ({
      timestamp: timestamp('2026-08-09T10:00:00.000Z', index + 4),
      type: 'turn_context',
      payload: { turn_id: `parent-turn-${index}`, cwd: fixtureRepo, marker: `parent-context-${index}` },
    })),
  ];
  const childRecords = [
    { timestamp: '2026-08-09T10:10:00.000Z', type: 'session_meta', payload: { id: childId, forked_from_id: parentId, cwd: fixtureRepo, thread_source: 'user' } },
    ...parentRecords.map((record, index) => ({ ...structuredClone(record), timestamp: timestamp('2026-08-09T09:00:00.000Z', index) })),
    { timestamp: '2026-08-09T10:11:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Own browser continuation' }] } },
    { timestamp: '2026-08-09T10:11:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Own browser continuation', images: [], local_images: [], text_elements: [] } },
    { timestamp: '2026-08-09T10:11:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Own browser answer' }] } },
  ];
  await writeJsonl(path.join(sessionDir, `rollout-parent-${parentId}.jsonl`), parentRecords);
  await writeJsonl(path.join(sessionDir, `rollout-child-${childId}.jsonl`), childRecords);
  if (options.derived) {
    await writeJsonl(path.join(sessionDir, `rollout-derived-${derivedId}.jsonl`), [
      {
        timestamp: '2026-08-09T10:12:00.000Z',
        type: 'session_meta',
        payload: {
          id: derivedId,
          forked_from_id: childId,
          cwd: fixtureRepo,
          source: { subagent: { thread_spawn: { parent_thread_id: childId, agent_nickname: 'Fixture' } } },
          agent_nickname: 'Fixture',
        },
      },
      { timestamp: '2026-08-09T10:12:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Derived browser task' } },
    ]);
  }
  const index = await buildIndex({ repoRoot: fixtureRepo, codexHome });
  return { index, parentId, childId, derivedId };
}

async function makePrewarmSizeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-prewarm-size-'));
  const fixtureRepo = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '21');
  const largeId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const smallId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  await fsp.mkdir(fixtureRepo, { recursive: true });
  await writeJsonl(path.join(sessionDir, `large-${largeId}.jsonl`), [
    { timestamp: '2026-08-21T10:00:00.000Z', type: 'session_meta', payload: { id: largeId, cwd: fixtureRepo } },
    { timestamp: '2026-08-21T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'L'.repeat(64 * 1024) }] } },
  ]);
  await writeJsonl(path.join(sessionDir, `small-${smallId}.jsonl`), [
    { timestamp: '2026-08-21T09:00:00.000Z', type: 'session_meta', payload: { id: smallId, cwd: fixtureRepo } },
    { timestamp: '2026-08-21T09:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'small eligible Session' }] } },
  ]);
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const index = await buildIndex({ repoRoot: fixtureRepo, codexHome });
  return { index, largeId, smallId };
}

async function makeHookCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-hook-'));
  const hookRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'abababab-abab-abab-abab-abababababab';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '12');
  const file = path.join(dir, `rollout-2026-06-12T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(hookRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    {
      timestamp: '2026-06-12T09:00:00.000Z',
      type: 'session_meta',
      payload: { id: sessionId, cwd: hookRepoRoot },
    },
  ];
  for (let i = 0; i < 170; i += 1) {
    rows.push({
      timestamp: `2026-06-12T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      type: 'response_item',
      payload: {
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Catalog seed row ${i}` }],
      },
    });
  }
  rows.push(
    {
      timestamp: '2026-06-12T09:03:00.000Z',
      type: 'event_msg',
      payload: { type: 'hook_begin', call_id: 'call-hook', tool_name: 'pre_apply_hook', hook: 'pre-apply' },
    },
    {
      timestamp: '2026-06-12T09:03:01.000Z',
      type: 'event_msg',
      payload: { type: 'hook_end', call_id: 'call-hook', tool_name: 'pre_apply_hook', status: 'completed' },
    },
  );
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: hookRepoRoot, sessionId };
}

test('browser navigation diagnostics retain failure evidence and discard passing traces', async (t) => {
  const outputRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'navigation-diagnostics-'));
  t.after(() => {
    assert.equal(path.dirname(outputRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(outputRoot).startsWith('navigation-diagnostics-'));
    return fsp.rm(outputRoot, { recursive: true, force: true });
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const messages = [];
  const failure = new Error('Synthetic navigation diagnostic failure');
  const run = withNavigationDiagnostics(async (_t, diagnostics) => {
    await diagnostics.attach(page);
    await page.goto('data:text/html,<button data-open-collaboration-session="synthetic-child" data-collaboration-action="target:0" onclick="this.remove()">Open synthetic child</button>');
    await page.locator('button').focus();
    await diagnostics.checkpoint('before-enter', { sessionId: 'synthetic-child' });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('button'));
    throw failure;
  }, { outputRoot });
  await assert.rejects(run({ name: 'synthetic-failure', diagnostic: (message) => messages.push(message) }), (error) => error === failure);
  const directory = path.join(outputRoot, `synthetic-failure-${process.pid}`);
  const data = JSON.parse(await fsp.readFile(path.join(directory, 'diagnostics.json'), 'utf8'));
  assert.equal(data.error.message, failure.message);
  assert.equal(data.checkpoints[0].expected.sessionId, 'synthetic-child');
  assert.ok(data.state.events.some((event) => event.type === 'keydown' && event.key === 'Enter'
    && event.target.sessionId === 'synthetic-child'));
  assert.ok(data.state.events.some((event) => event.type === 'action-subtree-removed' && event.removedFocusedAction));
  assert.deepEqual(data.captureErrors, []);
  assert.deepEqual((await fsp.readFile(path.join(directory, 'trace.zip'))).subarray(0, 2), Buffer.from([0x50, 0x4b]));
  assert.deepEqual((await fsp.readFile(path.join(directory, 'screenshot.png'))).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(messages.some((message) => message.includes('Navigation failure artifacts:')));

  await withNavigationDiagnostics(async (_t, diagnostics) => {
    await diagnostics.attach(page);
    await page.goto('data:text/html,<p>Synthetic passing navigation</p>');
  }, { outputRoot })({ name: 'synthetic-success', diagnostic: (message) => messages.push(message) });
  assert.deepEqual(await fsp.readdir(outputRoot), [path.basename(directory)]);

  await assert.rejects(withNavigationDiagnostics(async (_t, diagnostics) => {
    await diagnostics.attach(page);
    await page.close();
    throw failure;
  }, { outputRoot })({ name: 'synthetic-closed-page', diagnostic: (message) => messages.push(message) }), (error) => error === failure);
  const closed = JSON.parse(await fsp.readFile(path.join(outputRoot, `synthetic-closed-page-${process.pid}`, 'diagnostics.json'), 'utf8'));
  assert.ok(closed.captureErrors.some((item) => item.label === 'state'));
  assert.ok(closed.captureErrors.some((item) => item.label === 'screenshot'));
});

for (const locale of ['en', 'zh-CN']) test(`Codex 0.160 Paginated typed tools and answer remain readable through Main and Raw (${locale})`, async (t) => {
  // Synthetic rust-v0.160.0 TurnItem fixtures; no real writer, transcript, or
  // command execution. Exercises the same HTTP/rendering path as imported logs.
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-paginated-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  await fsp.mkdir(project);
  const id = 'dddddddd-0160-4160-8160-dddddddddddd';
  const turn = 'synthetic-paginated-browser';
  const completed = (item) => ({ type: 'event_msg', payload: {
    type: 'item_completed', thread_id: id, turn_id: turn, completed_at_ms: 1790935205000, item,
  } });
  const command = (callId, status, extra = {}) => completed({ type: 'CommandExecution', id: callId,
    command: ['synthetic-command', callId], cwd: project, parsed_cmd: [], source: 'agent', status,
    stdout: `${callId}_OUTPUT`, stderr: '', duration: { secs: 1, nanos: 0 }, ...extra });
  await writeJsonl(path.join(home, 'sessions', `rollout-${id}.jsonl`), [
    { type: 'session_meta', payload: { id, cwd: project, cli_version: '0.160.0', history_mode: 'paginated' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: turn } },
    command('UNKNOWN_EXIT', 'completed'),
    command('FAILED_COMMAND', 'failed', { exit_code: 3, stderr: 'FAILED_COMMAND_ERROR' }),
    completed({ type: 'FileChange', id: 'typed-edit', status: 'completed', stdout: 'PATCH_OUTPUT', stderr: '',
      changes: { 'synthetic-paginated.txt': { type: 'update', unified_diff: '@@ -1 +1 @@\n-OLD_TYPED_VALUE\n+NEW_TYPED_VALUE', move_path: null } } }),
    completed({ type: 'AgentMessage', id: 'typed-answer', phase: 'final_answer',
      content: [{ type: 'Text', text: 'TYPED_FINAL_ANSWER: synthetic review complete.' }] }),
  ].map((row, i) => ({ timestamp: new Date(Date.parse('2026-10-02T10:00:00Z') + i * 1000).toISOString(), ...row })));
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  const session = await materializeIndexedSession(index, id);
  assert.equal(session.counts.toolCalls, 3);
  assert.equal(session.counts.failedCommands, 1);
  assert.equal(session.counts.assistantMessages, 1);
  const unknown = session.logicalEvents.find((e) => e.kind === 'command' && e.preview.includes('UNKNOWN_EXIT'));
  assert.equal(unknown.status, 'completed');
  assert.equal(unknown.outputStats.exitCode, undefined);
  const expected = [
    [unknown, 'UNKNOWN_EXIT_OUTPUT', 'CommandExecution'],
    [session.logicalEvents.find((e) => e.kind === 'command' && e.preview.includes('FAILED_COMMAND')), 'FAILED_COMMAND_ERROR', 'CommandExecution'],
    [session.logicalEvents.find((e) => e.kind === 'patch'), 'NEW_TYPED_VALUE', 'FileChange'],
    [session.logicalEvents.find((e) => e.kind === 'assistant_message'), 'TYPED_FINAL_ANSWER', 'AgentMessage'],
  ];
  for (const [event, text] of expected) {
    const detail = await buildHydratedEventDetail(index, session, event.id, 'main', { locale });
    assert.ok(JSON.stringify(detail.timelineSections).includes(text));
    assert.equal(event.rawRefs.length, 1);
    assert.equal(event.rawRefs[0].sourceEventType, 'item_completed');
  }
  const { page, requestedPaths } = await openApp(t, index, { locale, skipProjectReindex: true });
  for (const [event, text, itemType] of expected) {
    await page.locator('#layerSelect').selectOption('main');
    const card = page.locator(`#timeline .event[data-event-id="${event.id}"]`);
    await card.locator('.eventHeader').click();
    await waitForDetailView(page, 'inspector');
    await page.waitForFunction(({ eventId, text }) => document.querySelector(`[data-event-id="${eventId}"]`)?.textContent.includes(text), { eventId: event.id, text });
    assert.ok((await card.innerText()).includes(text));
    if (event.kind === 'patch') {
      assert.match(await card.innerText(), /OLD_TYPED_VALUE/);
      assert.match(await card.innerText(), /synthetic-paginated\.txt/);
    }
    await page.locator('#detail [data-detail-action="raw"]').click();
    await waitForDetailView(page, 'rawRefs');
    await page.waitForFunction((itemType) => {
      const text = document.querySelector('#detail .rawRefsView')?.textContent || '';
      return text.includes('item_completed') && text.includes(itemType);
    }, itemType);
    await page.locator('#layerSelect').selectOption('raw');
    await page.locator(`#timeline .event[data-event-id="${event.rawRefs[0].rawId}"]`).click();
    await page.waitForFunction((itemType) => document.querySelector('#detail')?.textContent.includes(itemType), itemType);
  }
  assert.ok(requestedPaths.some((value) => value.startsWith(`/api/sessions/${id}/raw/`)));
});

for (const locale of ['en', 'zh-CN']) test(`Codex 0.162 recorded output, startup settings and tool declarations render in both presentations (${locale})`, async (t) => {
  // Synthetic pinned rollout shapes; no commands or sub-agents are executed.
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-0162-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  await fsp.mkdir(project);
  const id = 'dddddddd-0162-4162-8162-dddddddddddd';
  const child = 'eeeeeeee-0162-4162-8162-eeeeeeeeeeee';
  const typed = (item) => ({ type: 'event_msg', payload: {
    type: 'item_completed', thread_id: id, turn_id: 'turn-0162', item,
  } });
  const response = (payload) => ({ type: 'response_item', payload });
  const output = `COMMAND_HEAD\n${'x'.repeat(32000)}\n... command output truncated for persistence ...\n${'y'.repeat(32000)}\nCOMMAND_TAIL`;
  await writeJsonl(path.join(home, 'sessions', `rollout-${id}.jsonl`), [
    { type: 'session_meta', payload: { id, cwd: project, cli_version: '0.161.0', history_mode: 'paginated' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-0162' } },
    { type: 'turn_context', payload: { turn_id: 'turn-0162', model: 'synthetic-parent', effort: 'high', summary: 'none' } },
    typed({ type: 'CommandExecution', id: 'merged-command', command: ['synthetic-command'], cwd: project,
      parsed_cmd: [], source: 'agent', status: 'completed', aggregated_output: output, exit_code: 0, duration: { secs: 1, nanos: 0 } }),
    typed({ type: 'McpToolCall', id: 'preview-mcp', server: 'synthetic', tool: 'lookup', arguments: {}, status: 'completed',
      result: { content: [{ type: 'text', text: '{"content":["MCP_HEAD…100000 chars truncated…MCP_TAIL"]}' }], isError: true },
      error: null, duration: { secs: 1, nanos: 0 } }),
    response({ type: 'function_call', call_id: 'spawn-0162', name: 'spawn_agent', arguments: JSON.stringify({
      task_name: 'child', message: 'Synthetic child task', model: 'REQUESTED_MODEL_0162', reasoning_effort: 'low',
    }) }),
    typed({ type: 'SubAgentActivity', id: 'spawn-0162', kind: 'started', agent_thread_id: child,
      agent_path: '/root/child', model: 'RESOLVED_MODEL_0162', reasoning_effort: 'high' }),
    response({ type: 'function_call_output', call_id: 'spawn-0162', output: JSON.stringify({ agent_id: child }) }),
    response({ type: 'additional_tools', role: 'developer', tools: [{ type: 'namespace', name: 'synthetic_namespace',
      tools: [{ type: 'function', name: 'declared_lookup', description: 'DECLARATION_SEARCH_TAIL', parameters: { type: 'object' } }] }] }),
  ].map((row, i) => ({ timestamp: new Date(Date.parse('2026-10-14T00:00:00Z') + i * 1000).toISOString(), ...row })));
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  const session = await materializeIndexedSession(index, id);
  assert.equal(session.counts.toolCalls, 3);
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  const mcp = session.logicalEvents.find((event) => event.kind === 'mcp_call');
  const spawn = session.logicalEvents.find((event) => event.kind === 'agent_coordination');
  const declarations = session.logicalEvents.find((event) => event.subtype === 'additional_tools');
  assert.equal(mcp.status, 'failed');
  assert.equal(spawn.rawRefs.length, 3);
  assert.equal(declarations.layer, 'protocol');
  const { page } = await openApp(t, index, { locale, skipProjectReindex: true });
  const combined = locale === 'en' ? 'Combined output' : '合并输出';
  for (const presentation of ['timeline', 'trajectory']) {
    await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).click();
    for (const [event, marker] of [[command, 'COMMAND_HEAD'], [mcp, 'MCP_HEAD'], [spawn, 'RESOLVED_MODEL_0162']]) {
      const target = presentation === 'timeline'
        ? `.event[data-event-id="${event.id}"] .eventHeader`
        : `[data-trajectory-event-id="${event.id}"]`;
      await page.locator(target).first().click();
      const root = presentation === 'timeline' ? `#timeline .event[data-event-id="${event.id}"]` : '#detail';
      await page.waitForFunction(({ root, marker }) => document.querySelector(root)?.textContent.includes(marker), { root, marker });
      const text = await page.locator(root).textContent();
      if (event === command) {
        assert.ok(text.includes(combined));
        assert.equal(await page.locator(`${root} .commandRunOutput`).count(), 1, 'combined output retains the command-run layout');
        assert.ok((await page.locator(`${root} .notice`).allTextContents()).some((notice) =>
          notice.includes(locale === 'en' ? 'persistence truncation marker' : '持久化截断标记')), 'source truncation evidence has a separate notice');
      } else if (event === spawn) {
        assert.ok(text.includes('REQUESTED_MODEL_0162'));
        assert.ok(text.includes('low'));
        assert.ok(text.includes('high'));
        assert.ok(text.includes(locale === 'en' ? 'Requested model' : '请求模型'));
        assert.ok(text.includes(locale === 'en' ? 'Resolved startup model' : '实际启动模型'));
      } else {
        assert.ok((await page.locator(`${root} .notice`).allTextContents()).some((notice) =>
          notice.includes(locale === 'en' ? 'truncation stage' : '截断阶段')), 'MCP source marker is explained separately');
      }
    }
  }
  await page.locator('#mainPresentationControl [data-main-presentation="timeline"]').click();
  await fillSearch(page, 'RESOLVED_MODEL_0162');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.searchHit').length === 1);
  assert.equal(await page.locator('#timeline .event.searchHit').getAttribute('data-event-id'), spawn.id);
  await fillSearch(page, '');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.searchHit').length === 0);
  await page.locator('#layerSelect').selectOption('protocol');
  await page.locator(`.event[data-event-id="${declarations.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('declared_lookup'));
  assert.ok((await page.locator('#detail').innerText()).includes('synthetic_namespace'));
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('DECLARATION_SEARCH_TAIL'));
});

for (const locale of ['en', 'zh-CN']) test(`Codex reverted rollout chain reads one session with physical Raw references (${locale})`, async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-chain-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  await fsp.mkdir(project);
  const id = 'aaaaaaaa-0162-4162-9162-aaaaaaaaaaaa';
  const rollout = 'bbbbbbbb-0162-4162-9162-bbbbbbbbbbbb';
  const rootFile = `rollout-2026-10-14T10-00-00-${id}.jsonl`;
  const headFile = `rollout-2026-10-14T11-00-00-${id}_${rollout}.jsonl`;
  const rootSourceFile = locale === 'zh-CN' ? `../archived_sessions/${rootFile}` : rootFile;
  const meta = (extra = {}) => ({ type: 'session_meta', payload: { id, cwd: project, history_mode: 'paginated', cli_version: '0.162.1', ...extra } });
  const response = (payload) => ({ type: 'response_item', payload });
  const message = (text) => response({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
  const stamp = (row, ordinal) => ({ timestamp: new Date(Date.parse('2026-10-14T10:00:00Z') + ordinal * 1000).toISOString(), ordinal, ...row });
  const rootRows = [meta(), message('RETAINED_CHAIN_INPUT'), response({ type: 'function_call', name: 'shell_command',
    call_id: 'chain-command', arguments: JSON.stringify({ command: 'echo CHAIN_COMMAND' }) }), message('SUPERSEDED_CHAIN_INPUT')].map(stamp);
  const prefix = rootRows.slice(0, 3).map(JSON.stringify).join('\n') + '\n';
  const headRows = [meta({ history_base: { thread_id: id, end_ordinal_exclusive: 3, end_byte_offset: Buffer.byteLength(prefix) } }),
    response({ type: 'function_call_output', call_id: 'chain-command', output: 'Exit code: 0\nWall time: 1 second\nOutput:\nCHAIN_COMMAND_RESULT' }),
    message('CURRENT_CHAIN_INPUT')].map((row, position) => stamp(row, position + 3));
  await writeJsonl(path.join(home, 'sessions', rootSourceFile), rootRows);
  await writeJsonl(path.join(home, 'sessions', headFile), headRows);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)');
  db.prepare('INSERT INTO threads VALUES (?, ?)').run(id, path.join(home, 'sessions', headFile));
  db.close();
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sourceDiagnostics.totalCount, 0);
  const session = await materializeIndexedSession(index, id);
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  assert.deepEqual(new Set(command.rawRefs.map((ref) => ref.file.replace(/\\/g, '/'))), new Set([rootSourceFile, headFile]));
  const { page } = await openApp(t, index, { locale, skipProjectReindex: true });
  for (const presentation of ['timeline', 'trajectory']) {
    await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).click();
    const selector = presentation === 'timeline' ? `.event[data-event-id="${command.id}"] .eventHeader`
      : `[data-trajectory-event-id="${command.id}"]`;
    await page.locator(selector).first().click();
    const detail = presentation === 'timeline' ? `#timeline .event[data-event-id="${command.id}"]` : '#detail';
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('CHAIN_COMMAND_RESULT'), detail);
  }
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('CHAIN_COMMAND_RESULT'));
  for (const ref of command.rawRefs) {
    await page.locator('#layerSelect').selectOption('raw');
    await page.locator(`#timeline .event[data-event-id="${ref.rawId}"]`).click();
    await page.waitForFunction((ordinal) => document.querySelector('#detail')?.textContent.includes(`"ordinal": ${ordinal}`), ref.file.replace(/\\/g, '/') === rootSourceFile ? 2 : 4);
  }
  await page.locator('#layerSelect').selectOption('main');
  await page.locator('#mainPresentationControl [data-main-presentation="timeline"]').click();
  await fillSearch(page, 'CURRENT_CHAIN_INPUT');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.searchHit').length === 1);
  assert.ok((await page.locator('#timeline .event.searchHit').textContent()).includes('CURRENT_CHAIN_INPUT'));
});

for (const locale of ['en', 'zh-CN']) test(`Claude background terminal evidence stays on the owning MCP and Monitor operation (${locale})`, async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-background-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const project = path.join(claudeHome, 'repo');
  await fsp.mkdir(project);
  const sourceId = 'synthetic-background-browser';
  const receipt = 'MCP tool "synthetic/delay" is still running after 1s. It was moved to the background as task synthetic-mcp and keeps running; you\'ll receive a notification with the result when it completes. You can keep working in the meantime. To stop it, use TaskStop with task_id "synthetic-mcp". Note: it does not survive exiting this session.';
  const rows = [{ type: 'user', message: { content: 'Synthetic background work' } }];
  for (const [id, name, taskId, status, result] of [
    ['mcp', 'mcp__synthetic__delay', 'synthetic-mcp', 'failed', 'SYNTHETIC_MCP_FAILURE'],
    ['watch', 'Monitor', 'synthetic-monitor', 'completed', 'SYNTHETIC_MONITOR_LAST'],
  ]) {
    rows.push({ type: 'assistant', uuid: `${id}-assistant`, message: { content: [{ type: 'tool_use', id, name,
      input: name === 'Monitor' ? { command: 'synthetic-watch', timeout_ms: 3000 } : {} }] } });
    rows.push({ type: 'user', sourceToolAssistantUUID: `${id}-assistant`,
      message: { content: [{ type: 'tool_result', tool_use_id: id,
        content: name === 'Monitor' ? 'Monitor started' : [{ type: 'text', text: receipt }] }] },
      toolUseResult: name === 'Monitor' ? { taskId, timeoutMs: 3000, persistent: false } : [{ type: 'text', text: receipt }] });
    const tag = name === 'Monitor' ? 'event' : 'result';
    if (name === 'Monitor') rows.push({ type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system',
      message: { content: `<task-notification><task-id>${taskId}</task-id><summary>Monitor event</summary><event>XML log: <status>working</status> <tool-use-id>log-value</tool-use-id></event></task-notification>` } });
    rows.push({ type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system',
      message: { content: `<task-notification><task-id>${taskId}</task-id>${name === 'Monitor' ? `<tool-use-id>${id}</tool-use-id>` : ''}<status>${status}</status><summary>Synthetic ${status}</summary><${tag}>${result}</${tag}></task-notification>` } });
  }
  await writeJsonl(path.join(claudeHome, 'projects', 'synthetic', `${sourceId}.jsonl`), rows.map((record, i) => ({
    uuid: `synthetic-${i}`, ...record, cwd: project, sessionId: sourceId, version: '2.1.283',
    timestamp: `2026-09-29T10:00:0${i}.000Z`,
  })));
  const index = await buildClaudeSourceBackedIndex({ repoRoot: project, claudeHome });
  const sessionId = analyzerSessionId(sourceId);
  const session = await materializeIndexedSession(index, sessionId);
  assert.equal(session.counts.userMessages, 1);
  const { page } = await openApp(t, index, { locale, skipProjectReindex: true });
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  for (const [id, status, output] of [['mcp', 'failed', 'SYNTHETIC_MCP_FAILURE'], ['watch', 'success', 'SYNTHETIC_MONITOR_LAST']]) {
    const event = session.logicalEvents.find(item => item.callId === id);
    assert.equal(event.status, status);
    const card = page.locator(`#timeline .event[data-event-id="${event.id}"]`);
    await card.click();
    await waitForDetailView(page, 'inspector');
    await page.waitForFunction(({ eventId, text }) => document.querySelector(`[data-event-id="${eventId}"]`)?.textContent.includes(text), { eventId: event.id, text: output });
    assert.match(await page.locator('#detail').innerText(), locale === 'en'
      ? id === 'mcp' ? /MCP call moved to background/ : /Monitor started/
      : id === 'mcp' ? /MCP 调用已转入后台/ : /监控任务已启动/);
    await page.locator('#detail [data-detail-action="raw"]').click();
    await waitForDetailView(page, 'rawRefs');
    await page.waitForFunction(text => document.querySelector('#detail .rawRefsView')?.textContent.includes(text), output);
  }
});

for (const locale of ['en', 'zh-CN']) test(`Claude 2.1.283 Bash diffs remain readable with file filters and Raw evidence (${locale})`, async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-bash-diff-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const project = path.join(claudeHome, 'repo');
  await fsp.mkdir(project);
  const sourceId = 'synthetic-bash-diff-browser';
  const file = '/synthetic/example.txt';
  const rows = [
    { type: 'user', message: { content: 'Change beta to gamma' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit-call', name: 'Bash', input: { command: 'synthetic-edit example.txt' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit-call', content: 'done' }] }, toolUseResult: {
      stdout: 'done', stderr: '', interrupted: false,
      bashEditDiff: { files: [{ filePath: file, hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' alpha', '-beta', '+gamma'] }] }], changedFiles: [file], moreFiles: 0 },
    } },
    { type: 'assistant', message: { content: 'Synthetic edit completed.' } },
  ];
  await writeJsonl(path.join(claudeHome, 'projects', 'custom-container', `${sourceId}.jsonl`), rows.map((record, i) => ({
    ...record, cwd: project, sessionId: sourceId, version: '2.1.283',
    uuid: `synthetic-${i}`, parentUuid: i ? `synthetic-${i - 1}` : null,
    timestamp: `2026-09-27T10:00:0${i}.000Z`,
  })));
  const index = await buildClaudeSourceBackedIndex({ repoRoot: project, claudeHome });
  const sessionId = analyzerSessionId(sourceId);
  const session = await materializeIndexedSession(index, sessionId);
  const event = session.logicalEvents.find((item) => item.callId === 'edit-call');
  assert.equal(event.kind, 'command');
  assert.deepEqual(session.analysis.patchedFiles, [{ file, count: 1 }]);
  assert.equal(session.counts.patches, 0, 'a Bash edit is still one command, not a synthetic patch event');
  const { page } = await openApp(t, index, { locale, skipProjectReindex: true });
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  const card = page.locator(`#timeline .event[data-event-id="${event.id}"]`);
  await card.click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction((id) => document.querySelector(`[data-event-id="${id}"]`)?.textContent.includes('+gamma'), event.id);
  assert.match(await card.innerText(), /-beta/);
  assert.match(await page.locator('#detail').innerText(), /\/synthetic\/example\.txt/);
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('bashEditDiff'));
  assert.match(await page.locator('#detail .rawRefsView').innerText(), /changedFiles/);
  await addSearchFilter(page, 'file', file);
  await page.waitForFunction((id) => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1 && events[0].dataset.eventId === id;
  }, event.id);
});

test('Codex capacity notice leaves identity-based Raw References usable in both locales', async (t) => {
  const policy = trustedPolicy({ buildWorkUnits: 3 });
  const index = await buildIndex({
    repoRoot, codexHome: fixtureCodexHome, legacyRawOwnerPolicyForTests: policy,
  });
  assert.equal(index.legacyRawOwners.status, 'unavailable');
  for (const locale of ['en', 'zh-CN']) {
    const { page, requestedPaths } = await openApp(t, index, {
      locale,
      skipProjectReindex: true,
      serverOptions: { legacyRawOwnerPolicyForTests: policy },
    });
    const notice = page.locator('#legacyRawNotice');
    await notice.waitFor({ state: 'visible' });
    assert.match(await notice.innerText(), locale === 'en' ? /Legacy file\/line lookup is unavailable/ : /旧式文件／行号定位因容量限制不可用/);
    await selectPrimarySession(page);
    await page.locator('#timeline .event[data-event-id]').first().click();
    await waitForDetailView(page, 'inspector');
    await page.locator('#detail [data-detail-action="raw"]').click();
    await waitForDetailView(page, 'rawRefs');
    await page.waitForSelector('#detail .rawRefsView .inspectorSection');
    assert.ok(requestedPaths.some((value) => value.startsWith(`/api/sessions/${primaryFixtureSessionId}/raw/`)));
    assert.equal(requestedPaths.includes('/api/raw'), false);
    await notice.locator('[data-dismiss-legacy-raw]').click();
    assert.equal(await notice.isHidden(), true);
  }
});

test('Codex identity-free Raw Reference fallback shows capacity without requesting legacy Raw', async (t) => {
  const policy = trustedPolicy({ buildWorkUnits: 3 });
  const index = await buildIndex({
    repoRoot, codexHome: fixtureCodexHome, legacyRawOwnerPolicyForTests: policy,
  });
  const file = index.sessionsById.get(primaryFixtureSessionId).sourceFile;
  const { page, requestedPaths } = await openApp(t, index, {
    locale: 'en', skipProjectReindex: true,
    serverOptions: { legacyRawOwnerPolicyForTests: policy },
    beforeGoto: async (target) => {
      await target.route(`**/api/sessions/${primaryFixtureSessionId}/timeline*`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (body.events?.length) body.events[0].rawRefs = [{ file, line: 1 }];
        await route.fulfill({ response, json: body });
      });
    },
  });
  await selectPrimarySession(page);
  await page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(page, 'inspector');
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('Legacy file/line lookup is unavailable'));
  assert.equal(requestedPaths.includes('/api/raw'), false);
  assert.equal(await page.locator('#detail .rawRefsView .inspectorSection').count(), 0);
});

for (const source of ['codex', 'deepseek-harness']) for (const locale of ['en', 'zh-CN']) {
  test(`native shell exit 7 is failed and readable through browser Detail and Raw (${source}, ${locale})`, async t => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sa-shell-browser-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const project = path.join(root, 'repo');
    await fsp.mkdir(project);
    let index;
    if (source === 'codex') {
      await writeJsonl(path.join(root, 'sessions', 'synthetic.jsonl'), [
        { type: 'session_meta', payload: { id: 'aaaaaaaa-1004-4004-8004-aaaaaaaaaaaa', cwd: project } },
        { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'exit-seven', arguments: '{"cmd":"SYNTHETIC_EXIT_COMMAND"}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'exit-seven', output: 'Wall time: 1.0000 seconds\nProcess exited with code 7\nOutput:\nSYNTHETIC_EXIT_OUTPUT' } },
      ]);
      index = await buildIndex({ repoRoot: project, codexHome: root });
    } else {
      const { buildDeepSeekIndex } = require('../src/deepseek-harness');
      const sourceHome = path.join(root, 'sessions');
      await writeJsonl(path.join(sourceHome, 'project', 'synthetic', 'session.v4.jsonl'), [
        { type: 'session', version: 4, id: 'synthetic', cwd: project, createdAt: 1, isSeeded: false, delegationDepth: 0 },
        { type: 'tool/call', seq: 0, time: 1000, data: { turn: 1, step: 1, callId: 'exit-seven', name: 'pwsh', arguments: '{"command":"SYNTHETIC_EXIT_COMMAND"}' } },
        { type: 'tool/result', seq: 1, time: 1001, surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: 'result', role: 'tool', source: { kind: 'tool', callId: 'exit-seven' }, toolCallId: 'exit-seven', isError: false, content: [{ type: 'text', text: 'SYNTHETIC_EXIT_OUTPUT\n[exit code: 7]' }] } } },
      ]);
      index = await buildDeepSeekIndex({ repoRoot: project, sourceHome });
    }
    const session = await materializeIndexedSession(index);
    const command = session.logicalEvents.find(event => event.kind === 'command');
    assert.equal(command.status, 'failed');
    const { page } = await openApp(t, index, { locale, skipProjectReindex: true });
    const card = page.locator(`#timeline .event[data-event-id="${command.id}"]`);
    await card.click();
    await waitForDetailView(page, 'inspector');
    await page.waitForFunction(id => document.querySelector(`[data-event-id="${id}"]`)?.textContent.includes('SYNTHETIC_EXIT_OUTPUT'), command.id);
    assert.match(await card.innerText(), /SYNTHETIC_EXIT_COMMAND/);
    assert.equal(command.outputStats.exitCode, 7);
    await page.locator('#detail [data-detail-action="raw"]').click();
    await waitForDetailView(page, 'rawRefs');
    await page.locator('#layerSelect').selectOption('raw');
    await page.locator(`#timeline .event[data-event-id="${command.rawRefs.at(-1).rawId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('SYNTHETIC_EXIT_OUTPUT'));
    assert.match(await page.locator('#detail').innerText(), source === 'codex' ? /Process exited with code 7/ : /exit code: 7/);
  });
}

for (const locale of ['en', 'zh-CN']) test(`persisted realtime history navigates Main, Protocol and Raw in both presentations (${locale})`, async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-persisted-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  const id = 'dddddddd-0919-4919-8919-dddddddddddd';
  const realtime = (item, type, fields = {}) => ({ type: 'realtime_item', payload: { id: item, realtime_session_id: 'realtime-browser', type, ...fields } });
  await fsp.mkdir(path.join(home, 'sessions'), { recursive: true });
  await writeJsonl(path.join(home, 'sessions', `rollout-${id}.jsonl`), [
    { type: 'session_meta', payload: { id, cwd: project } },
    realtime('spoken', 'transcript_segment', { role: 'user', text: 'Persisted realtime browser question' }),
    realtime('promotion', 'bem_item_promoted', { turn_id: 'turn', item_id: 'target', presentation: { type: 'inline_visualization', index: 1 } }),
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: id, turn_id: 'turn', item: { type: 'AgentMessage', id: 'target', delivery: 'async', content: [{ type: 'Text', text: 'Backing browser answer' }] } } },
    realtime('raw-promotion', 'bem_item_promoted', { turn_id: 'turn', item_id: 'raw-target', presentation: { type: 'whole_item' } }),
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: id, turn_id: 'turn', item: { type: 'FutureItem', id: 'raw-target', value: 'Raw target evidence' } } },
    { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: id, thread_settings: { model: 'saved-browser-model', reasoning_effort: 'high' } } },
    { type: 'response_item', payload: { type: 'configuration_update', reasoning: { effort: 'low' } }, metadata: { harness_authored_configuration: true } },
  ]);
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  const { page } = await openApp(t, index, { locale });
  for (const presentation of ['timeline', 'trajectory']) {
    await page.locator('#layerSelect').selectOption('main');
    await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).click();
    const message = presentation === 'timeline'
      ? page.locator(`#timeline .event[data-event-id="${id}:logical:realtime:2"]`)
      : page.locator(`[data-trajectory-event-id="${id}:logical:realtime:2"]`);
    await message.waitFor();
    await message.click();
    await page.waitForFunction(() => /Realtime|实时/.test(document.querySelector('#detail')?.textContent || ''));
    assert.match(await page.locator('#timeline').innerText(), /Persisted realtime browser question/);
    await page.locator('#layerSelect').selectOption('protocol');
    await page.locator(`#timeline .event[data-event-id="${id}:logical:protocol:3"]`).click();
    const link = page.locator(`#detail [data-target-event-id="${id}:logical:assistant:4"]`);
    await link.waitFor();
    await link.click();
    await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'main');
    await page.waitForFunction((eventId) => Boolean(document.querySelector(`[data-event-id="${CSS.escape(eventId)}"].selected, [data-trajectory-event-id="${CSS.escape(eventId)}"].selected`)), `${id}:logical:assistant:4`);
    await page.locator('#layerSelect').selectOption('protocol');
    await page.locator(`#timeline .event[data-event-id="${id}:logical:protocol:5"]`).click();
    const rawLink = page.locator(`#detail [data-target-event-id="${id}:raw:6"]`);
    await rawLink.waitFor();
    await rawLink.click();
    await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'raw');
    await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('Raw target evidence'));
  }
});

test('Codex external inputs, asynchronous questions and file images render read-only in both locales', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-reading-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  const id = 'cccccccc-0917-4917-8917-cccccccccccc';
  const records = [
    { type: 'session_meta', payload: { id, cwd: project } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: null, name: 'notifications', namespace: 'example_service', output: 'External result is available.' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Choose a format', phase: 'final_answer', delivery: 'async', questions: [{ title: 'Output format?', options: ['Markdown', 'JSON'] }, { title: 'Any notes?' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_image', file_id: 'file_browser_example', detail: 'high' }] } },
  ].map((record) => ({ timestamp: '2026-09-17T10:00:00.000Z', ...record }));
  await fsp.mkdir(path.join(home, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(home, 'sessions', `rollout-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  const session = await materializeSessionForIndex(index, index.sessionsById.get(id));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<main id="content"></main>');
  for (const file of ['src/shared/command-highlighting.js', 'src/shared/i18n.js', 'src/shared/code-mode-presentation-contract.js', 'src/shared/detail-purpose.js', 'src/browser/renderers.js']) {
    await page.addScriptTag({ path: path.join(__dirname, '..', file) });
  }
  for (const locale of ['en', 'zh-CN']) {
    const details = await Promise.all(session.logicalEvents.filter((event) => event.layer === 'main')
      .map((event) => buildHydratedEventDetail(index, session, event.id, 'main', { locale })));
    await page.evaluate((details) => {
      document.querySelector('#content').innerHTML = details.map((detail) => window.sessionRenderers.renderSections(detail.timelineSections)).join('');
    }, details);
    const text = await page.locator('#content').innerText();
    assert.match(text, /External result is available/);
    assert.match(text, /example_service/);
    assert.match(text, /Output format\?/);
    assert.match(text, /Markdown/);
    assert.match(text, /JSON/);
    assert.match(text, /Any notes\?/);
    assert.match(text, locale === 'en' ? /Asynchronous message/ : /异步消息/);
    assert.match(text, locale === 'en' ? /Local preview is unavailable/ : /无法从本地预览/);
    assert.equal(await page.locator('#content input, #content select, #content textarea, #content button[type="submit"]').count(), 0);
    assert.equal(await page.locator('#content img').count(), 0);
    assert.equal(text.includes('file_browser_example'), false, 'opaque IDs belong in Inspector');
  }
});

test('browser retries one bounded materialization-busy GET before showing an error', async (t) => {
  const index = await buildFixtureIndex();
  let attempts = 0;
  const { page } = await openApp(t, index, {
    locale: 'en',
    beforeGoto: async (targetPage) => {
      await targetPage.route('**/api/sessions/*/timeline?*', async (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.searchParams.get('offset') === '0' && attempts === 0) {
          attempts += 1;
          await route.fulfill({
            status: 503,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
            body: JSON.stringify({
              error: 'Internal server error',
              code: 'MATERIALIZATION_BUSY',
            }),
          });
          return;
        }
        attempts += 1;
        await route.continue();
      });
    },
  });
  assert.ok(attempts >= 2);
  assert.equal((await page.locator('#stateLine').textContent()).includes('Internal server error'), false);
});

test('browser receives a prewarm cache hit before first Session paint', async (t) => {
  const fixture = await makeLongCodexHome(t, { eventCount: 20 });
  const index = await buildIndex(fixture);
  const wakeReady = deferred();
  let wake;
  let wakeOutcome;
  let materializationCalls = 0;
  let releasedSessionsAt = 0;
  let timelineRequestedAt = 0;
  let timelineRespondedAt = 0;
  let releasedSessions = false;
  const { page } = await openApp(t, index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 8 * 1024 * 1024,
      individualBytes: 4 * 1024 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 61;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        materializationCalls += 1;
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      targetPage.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/timeline')) timelineRequestedAt ||= performance.now();
      });
      targetPage.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('/timeline')) timelineRespondedAt ||= performance.now();
      });
      await targetPage.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
        if (!releasedSessions && new URL(route.request().url()).pathname === '/api/sessions') {
          releasedSessions = true;
          await wakeReady.promise;
          wakeOutcome = await wake();
          releasedSessionsAt = performance.now();
        }
        await route.continue();
      });
    },
  });

  assert.equal(materializationCalls, 1);
  assert.equal(wakeOutcome.completedCount, 1);
  assert.equal(wakeOutcome.failedCount, 0);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.sessionId);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'prewarm-hit',
    requestHeaderMs: timelineRespondedAt - timelineRequestedAt,
    sessionsReleaseToPaintMs: performance.now() - releasedSessionsAt,
    materializationCalls,
  }));
});

test('browser foreground selection beats the idle timer without duplicate materialization', async (t) => {
  const fixture = await makeLongCodexHome(t, { eventCount: 20 });
  const index = await buildIndex(fixture);
  const wakeReady = deferred();
  let wake;
  let materializationCalls = 0;
  let navigationStartedAt = 0;
  let timelineRequestedAt = 0;
  let timelineRespondedAt = 0;
  const { page } = await openApp(t, index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 8 * 1024 * 1024,
      individualBytes: 4 * 1024 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 71;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        materializationCalls += 1;
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      navigationStartedAt = performance.now();
      targetPage.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/timeline')) timelineRequestedAt ||= performance.now();
      });
      targetPage.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('/timeline')) timelineRespondedAt ||= performance.now();
      });
    },
  });
  await wakeReady.promise;
  const outcome = await wake();

  assert.equal(materializationCalls, 1);
  assert.equal(outcome.attemptedCount, 0);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.sessionId);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'foreground-beats-timer',
    requestHeaderMs: timelineRespondedAt - timelineRequestedAt,
    navigationToPaintMs: performance.now() - navigationStartedAt,
    materializationCalls,
  }));
});

test('browser wrong prediction preempts a speculative derived Session before opening the visible root', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t, { derived: true });
  const wakeReady = deferred();
  const speculativeStarted = deferred();
  let wake;
  let waking;
  let releasedSessions = false;
  let abortObservedAt = 0;
  let foregroundStartedAt = 0;
  const order = [];
  const { page } = await openApp(t, fixture.index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 3,
      budgetBytes: 8 * 1024 * 1024,
      individualBytes: 4 * 1024 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 81;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        if (indexedSession.id === fixture.derivedId) {
          order.push('speculative:start');
          speculativeStarted.resolve();
          return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              abortObservedAt = performance.now();
              order.push('speculative:abort');
              reject(options.signal.reason);
            }, { once: true });
          });
        }
        if (indexedSession.id === fixture.childId) {
          foregroundStartedAt = performance.now();
          order.push('foreground:start');
        }
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
        if (!releasedSessions && new URL(route.request().url()).pathname === '/api/sessions') {
          releasedSessions = true;
          await wakeReady.promise;
          waking = wake();
          await speculativeStarted.promise;
        }
        await route.continue();
      });
    },
  });
  const outcome = await waking;

  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.childId);
  assert.deepEqual(order.slice(0, 3), [
    'speculative:start',
    'speculative:abort',
    'foreground:start',
  ]);
  assert.equal(outcome.preemptedCount, 1);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'wrong-prediction',
    abortToForegroundStartMs: foregroundStartedAt - abortObservedAt,
  }));
});

test('browser startup prewarm skips an oversized top candidate and continues to one eligible recent Session', async (t) => {
  const fixture = await makePrewarmSizeCodexHome(t);
  const wakeReady = deferred();
  let wake;
  let wakeOutcome;
  let releasedSessions = false;
  const materializedIds = [];
  const { page } = await openApp(t, fixture.index, {
    locale: 'en',
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 2,
      budgetBytes: 1024 * 1024,
      individualBytes: 32 * 1024,
      setTimer(callback) {
        wake = callback;
        wakeReady.resolve();
        return 91;
      },
      clearTimer() {},
    },
    serverOptions: {
      materializeSession: async (currentIndex, indexedSession, options) => {
        materializedIds.push(indexedSession.id);
        return materializeSessionForIndex(currentIndex, indexedSession, options);
      },
    },
    beforeGoto: async (targetPage) => {
      await targetPage.route(/\/api\/sessions(?:\?.*)?$/, async (route) => {
        if (!releasedSessions && new URL(route.request().url()).pathname === '/api/sessions') {
          releasedSessions = true;
          await wakeReady.promise;
          wakeOutcome = await wake();
        }
        await route.continue();
      });
    },
  });

  assert.deepEqual(materializedIds, [fixture.smallId, fixture.largeId]);
  assert.equal(wakeOutcome.consideredCount, 2);
  assert.equal(wakeOutcome.completedCount, 1);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), fixture.largeId);
  assert.equal(await page.locator('#stateLine[data-state="error"]').count(), 0);
  t.diagnostic(JSON.stringify({
    scenario: 'large-candidate-skip',
    prewarmMaterializationCalls: 1,
    foregroundMaterializationCalls: 1,
  }));
});

test('browser locale bootstrap keeps narrow screens on sessions view', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { viewport: { width: 390, height: 760 }, locale: 'zh-CN', activeSessionState: 'attached' });

  await page.waitForFunction(() => document.body.dataset.mobileView === 'sessions');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');

  await fillSearch(page, 'patch');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');
});

test('browser locale localizes static shell and dirty profile dialog', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('logical events'));
  assert.equal(await page.locator('#dirtyProfileTitle').textContent(), 'Unsaved folding strategy changes');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Find in current session');
  assert.equal(await page.locator('#searchKindLabel').textContent(), 'Kind');
  assert.equal(await page.locator('.localeControl').isVisible(), false);
  assert.equal(await page.locator('#localeSelect').count(), 1);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), '在当前 session 中查找');
  assert.equal(await page.locator('#searchKindLabel').textContent(), '类型');
  assert.equal(
    await page.locator('#searchKindSelect optgroup').first().getAttribute('label'),
    '对话与计划',
  );
  assert.equal(await page.locator('.mobileViewTab[data-mobile-view="events"]').textContent(), '事件');
  assert.equal(await page.locator('#searchStatusGoalGroup').getAttribute('label'), '目标生命周期');
  assert.equal(await page.locator('#searchStatusExecutionGroup').getAttribute('label'), '执行结果');
  assert.equal(await page.locator('#searchStatusEventGroup').getAttribute('label'), '事件生命周期');
  assert.equal(await page.locator('#searchStatusSelect option[value="complete"]').textContent(), '目标已完成');
  assert.equal(await page.locator('#searchStatusSelect option[value="completed"]').textContent(), '事件已完成');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /加载更多|已加载|加载中/);
  await fillSearch(page, 'zzzz-no-match');
  await page.waitForFunction(() => document.querySelector('[data-search-match-count]')?.textContent === '0 / 0 个目标');
  await fillSearch(page, '');

  await switchHiddenLocale(page, 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  await selectPrimarySession(page);
  const timelineHeaderText = await page.locator('#timeline .eventHeader').allTextContents();
  assert.equal(await page.locator('#timeline .eventHeader .channelChip').count(), 0);
  assert.doesNotMatch(timelineHeaderText.join('\n'), /(?:^|\s)\d+ raw(?:\s|$)|event_msg|response_item/);
  const messagesMetricTitle = await page.locator('.metric', { hasText: 'Messages' }).getAttribute('title');
  assert.match(messagesMetricTitle || '', /Switch to conversation reading folding strategy/);
  assert.equal((messagesMetricTitle || '').includes('切换到'), false);
  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.locator('#detail [data-profile-picker]').selectOption('conversation');
  await page.waitForSelector('#dirtyProfileDialog:not([hidden])');

  assert.equal(await page.locator('#dirtyProfileTitle').textContent(), 'Unsaved folding strategy changes');
  assert.equal(await page.locator('#dirtyProfileMessage').textContent(), 'Before switching strategies, save the current changes, discard them, or stay on the current strategy.');
  assert.equal(await page.locator('[data-dirty-profile-choice="save"]').textContent(), 'Save and switch');
  assert.equal(await page.locator('[data-dirty-profile-choice="discard"]').textContent(), 'Discard and switch');
  assert.equal(await page.locator('[data-dirty-profile-choice="cancel"]').textContent(), 'Cancel');
});

test('browser locale switch preserves unsaved folding draft', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');

  await expectInputValue(page, '#detail [data-profile-kind="command"]', 'expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));
});

test('browser presents Claude pointer fork context without child search or event ownership', async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-pointer-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const parentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sourceRecord = (sessionId, fields) => ({
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: claudeRepo,
    sessionId,
    version: '2.1.220',
    ...fields,
  });
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    sourceRecord(parentId, {
      type: 'user',
      parentUuid: null,
      message: { role: 'user', content: 'Inherited task' },
      uuid: 'pointer-parent-user',
      timestamp: '2026-07-31T12:00:00.000Z',
    }),
    sourceRecord(parentId, {
      type: 'assistant',
      parentUuid: 'pointer-parent-user',
      message: {
        id: 'pointer-parent-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Inherited answer' }],
      },
      uuid: 'pointer-parent-assistant',
      timestamp: '2026-07-31T12:00:01.000Z',
    }),
    sourceRecord(parentId, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'pointer-parent-assistant',
      content: '<command-name>/fork</command-name>',
      uuid: 'pointer-fork-command',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    sourceRecord(parentId, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'pointer-fork-command',
      content: '<local-command-stdout>session waiting for a prompt · Pointer child ⑂ · bbbbbbbb</local-command-stdout>',
      uuid: 'pointer-fork-output',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    sourceRecord(parentId, {
      type: 'user',
      parentUuid: 'pointer-fork-output',
      message: { role: 'user', content: 'Parent-only continuation' },
      uuid: 'pointer-parent-after-fork',
      timestamp: '2026-07-31T12:00:03.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Pointer child ⑂', sessionId: childId },
    { type: 'agent-name', agentName: 'Pointer child ⑂', sessionId: childId },
  ]);

  const index = await buildClaudeSourceBackedIndex({ repoRoot: claudeRepo, claudeHome });
  const pointerChild = index.sessionsById.get(analyzerSessionId(childId));
  const forkPointTarget = pointerChild?.inheritedContext?.forkPointTarget;
  assert.equal(forkPointTarget?.layer, 'main');
  assert.ok(forkPointTarget?.eventId);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${analyzerSessionId(childId)}"]`).click();

  const context = page.locator('[data-inherited-context]');
  await context.waitFor();
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);
  assert.match(await page.locator('.sessionHeader').innerText(), /Pointer-backed fork/);
  assert.match(await page.locator('.sessionHeader').innerText(), /Waiting for prompt/);
  assert.match(await context.innerText(), /2 inherited Raw Records at the fork point support 2 Main and 0 Protocol events/);
  assert.match(await context.innerText(), /Fork point pointer-/);

  await context.locator('summary').click();
  assert.equal(await context.locator('.inheritedContextEvent').count(), 2);
  assert.match(await context.innerText(), /Inherited task/);
  assert.match(await context.innerText(), /Inherited answer/);
  assert.doesNotMatch(await context.innerText(), /Parent-only continuation/);

  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'Inherited task';
  });
  await fillSearch(page, 'Inherited task');
  await searchResponse;
  await waitForNoSearchMarks(page);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);

  const parentTimelinePath = `/api/sessions/${encodeURIComponent(analyzerSessionId(parentId))}/timeline`;
  let signalParentTimeline;
  let releaseParentTimeline;
  const parentTimelineStarted = new Promise((resolve) => { signalParentTimeline = resolve; });
  const parentTimelineRelease = new Promise((resolve) => { releaseParentTimeline = resolve; });
  await page.route((url) => new URL(String(url)).pathname === parentTimelinePath, async (route) => {
    signalParentTimeline();
    await parentTimelineRelease;
    await route.continue();
  });
  const parentTimelineResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === parentTimelinePath
  ));

  await context.getByRole('button', { name: 'Open parent session' }).click();
  try {
    await parentTimelineStarted;
    await expectInputValue(page, '#searchInput', '');
    await expectInputValue(page, '#layerSelect', forkPointTarget.layer);
    await page.waitForFunction(() => document.querySelector('.sessionHeader h2')?.textContent === 'Inherited task');
    assert.equal(await page.locator('[data-inherited-context]').count(), 0);
  } finally {
    releaseParentTimeline();
  }
  await parentTimelineResponse;
  await page.waitForFunction((eventId) => (
    document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), forkPointTarget.eventId);

  const { page: fallbackPage } = await openApp(t, index, {
    locale: 'en',
    skipProjectReindex: true,
    beforeGoto: async (targetlessPage) => {
      await targetlessPage.route('**/api/sessions*', async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        const pointerSession = data.sessions.find((session) => session.id === analyzerSessionId(childId));
        if (pointerSession) pointerSession.inheritedContext.forkPointTarget = null;
        await route.fulfill({ response, json: data });
      });
    },
  });
  await fallbackPage.locator(`[data-session-id="${analyzerSessionId(childId)}"]`).click();
  const fallbackContext = fallbackPage.locator('[data-inherited-context]');
  await fallbackContext.waitFor();
  assert.equal(
    await fallbackContext.getByRole('button', { name: 'Open parent session' }).getAttribute('data-inherited-target-event'),
    '',
  );
  const fallbackSearchResponse = fallbackPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'Inherited task';
  });
  await fillSearch(fallbackPage, 'Inherited task');
  await fallbackSearchResponse;
  const fallbackParentResponse = fallbackPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === parentTimelinePath && url.searchParams.get('q') === 'Inherited task';
  });
  await fallbackContext.getByRole('button', { name: 'Open parent session' }).click();
  await fallbackParentResponse;
  await expectInputValue(fallbackPage, '#searchInput', 'Inherited task');
  await expectInputValue(fallbackPage, '#layerSelect', 'main');
});

test('browser presents materialized fork ownership, earlier-branch hierarchy, Raw segments, and fork-point navigation', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t);
  const { page } = await openApp(t, fixture.index, { locale: 'en', skipProjectReindex: true });
  const childBranch = page.locator(`[data-session-branch-id="${fixture.childId}"]`);
  const childCard = childBranch.locator(`:scope > .sessionRow [data-session-id="${fixture.childId}"]`);
  const toggle = childBranch.locator(`:scope > .sessionRow [data-session-children-toggle="${fixture.childId}"]`);
  assert.match(await childCard.innerText(), /Continues from earlier branch/);
  assert.doesNotMatch(await childCard.innerText(), /Fork · from/);
  assert.equal((await toggle.textContent()).trim(), 'Earlier branch');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator(`[data-session-id="${fixture.parentId}"]`).isVisible(), false);

  await toggle.click();
  const earlier = childBranch.locator(`[data-session-id="${fixture.parentId}"]`);
  assert.equal(await earlier.isVisible(), true);
  assert.match(await earlier.innerText(), /Earlier branch/);
  assert.match(await earlier.innerText(), /did not continue after the current branch was created/);
  await earlier.click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, fixture.parentId);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'direct selection expands the earlier branch ancestor');

  await childCard.click();
  const context = page.locator('[data-inherited-context]');
  await context.waitFor();
  assert.match(await page.locator('.sessionHeader').innerText(), /Materialized fork/);
  assert.match(await context.innerText(), /Inherited through/);
  assert.match(await context.innerText(), /not counted as this session's continuation activity/);
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event')].some((event) => event.textContent.includes('Own browser continuation')));
  assert.equal(await page.locator('#timeline .event').filter({ hasText: 'Inherited browser task' }).count(), 0);
  assert.equal(await page.locator('#timeline .event').filter({ hasText: 'Own browser continuation' }).count(), 1);

  await page.locator('#layerSelect').selectOption('raw');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .rawForkSegmentHeading').length >= 2);
  assert.deepEqual(
    await page.locator('#timeline .rawForkSegmentHeading').allTextContents(),
    ['Fork metadata', 'Inherited context'],
  );
  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#timeline .rawForkSegmentHeading').length === 3);
  assert.deepEqual(
    await page.locator('#timeline .rawForkSegmentHeading').allTextContents(),
    ['Fork metadata', 'Inherited context', 'Fork continuation'],
    'pagination re-render keeps one heading per contiguous segment',
  );

  const parentButton = context.getByRole('button', { name: 'Open parent session' });
  await parentButton.click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, fixture.parentId);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  const selected = page.locator('#timeline .event.selected');
  await selected.waitFor();
  await page.waitForFunction(() => (
    document.querySelector('#timeline .event.selected')?.textContent.includes('Inherited browser answer')
  ));
  assert.match(await selected.innerText(), /Inherited browser answer/);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.waitForFunction((id) => (
    document.querySelector(`[data-session-children-toggle="${CSS.escape(id)}"]`)?.textContent.includes('较早分支')
  ), fixture.childId);
  assert.match(await toggle.innerText(), /较早分支/);

  await page.locator('#layerSelect').selectOption('raw');
  await page.locator('#searchHudScope').click();
  await page.locator('#searchAssist button[data-search-scope="project"]').click();
  await fillSearch(page, 'Inherited browser task');
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .projectResultCard').length === 2);
  assert.equal(await page.locator('#sessionList .projectResultCard').count(), 2);
  assert.equal(await page.locator('#sessionList .sessionChildrenToggle').count(), 0, 'project search stays flat');
  const projectResultChipText = (await page.locator('#sessionList .projectResultCard .chip').allTextContents()).join(' | ');
  assert.doesNotMatch(projectResultChipText, /Codex/);
});

test('browser fork-point navigation temporarily reveals a profile-hidden target without changing saved folds', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t);
  const child = fixture.index.sessionsById.get(fixture.childId);
  const targetEventId = child?.inheritedContext?.forkPointTarget?.eventId || '';
  assert.ok(targetEventId);
  const hiddenAssistantProfile = {
    id: 'custom:hidden-fork-point-assistant',
    name: 'Hidden fork-point assistant',
    description: 'Hide the inherited assistant event selected by fork-point navigation.',
    rules: {
      kindStates: { assistant_message: 'hidden' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const savedOverrides = {
    [fixture.parentId]: { [targetEventId]: 'hidden' },
  };
  const { page } = await openWave1cM1App(t, fixture.index, {
    locale: 'en',
    skipProjectReindex: true,
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenAssistantProfile]),
      'sessionAnalyzer.profile': hiddenAssistantProfile.id,
      'sessionAnalyzer.overrides': JSON.stringify(savedOverrides),
    },
  });

  const context = page.locator('[data-inherited-context]');
  await context.waitFor();
  await page.evaluate(() => window.__wave1cM1.reset());
  await context.getByRole('button', { name: 'Open parent session' }).click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, fixture.parentId);
  const selected = page.locator(`#timeline .event[data-event-id="${targetEventId}"].selected`);
  await selected.waitFor();
  assert.equal(await selected.isVisible(), true);
  assert.equal(await selected.evaluate((node) => node.classList.contains('hiddenByProfile')), false);
  assert.equal(await selected.evaluate((node) => node.classList.contains('summary')), true);
  assert.equal(
    await selected.evaluate((node) => node.classList.contains('temporaryReferenceReveal')),
    false,
    'fork-point navigation reveal is not a temporaryEventReveal membership probe',
  );
  assert.equal(
    await page.evaluate(({ sessionId, eventId }) => (
      JSON.parse(localStorage.getItem('sessionAnalyzer.overrides'))?.[sessionId]?.[eventId]
    ), { sessionId: fixture.parentId, eventId: targetEventId }),
    'hidden',
    'fork-point reveal must not overwrite the saved folding override',
  );
  assert.equal(await page.evaluate(() => window.__wave1cM1.evidence.revisions.some(
    (item) => item.revisionKind === 'navigationRevealRevision',
  )), true);
  assert.ok((await latestWave1cM1Lifecycle(page))
    .mountedPresentationToken.navigationRevealRevision > 0);
});

test('browser labels mixed Derived and Earlier children as related sessions', async (t) => {
  const fixture = await makeMaterializedCodexForkFixture(t, { derived: true });
  const { page } = await openApp(t, fixture.index, { locale: 'en', skipProjectReindex: true });
  const toggle = page.locator(`[data-session-children-toggle="${fixture.childId}"]`);
  assert.equal((await toggle.textContent()).trim(), '2 related sessions');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show 2 related sessions');
  await toggle.click();
  assert.match(await page.locator(`[data-session-id="${fixture.parentId}"]`).innerText(), /Earlier branch/);
  assert.match(await page.locator(`[data-session-id="${fixture.derivedId}"]`).innerText(), /Subagent Fixture · from/);
});

test('browser Raw refs preserve malformed Claude source text instead of rendering null', async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-malformed-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const sessionId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  const file = path.join(container, `${sessionId}.jsonl`);
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(file, [{
    type: 'user',
    message: { role: 'user', content: 'Inspect malformed evidence' },
    cwd: claudeRepo,
    sessionId,
    uuid: 'malformed-parent-user',
    timestamp: '2026-07-31T12:30:00.000Z',
  }]);
  const malformedLine = '{"type":"assistant","message":';
  await fsp.appendFile(file, `${malformedLine}\n`, 'utf8');

  const index = await buildClaudeSourceBackedIndex({ repoRoot: claudeRepo, claudeHome });
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator('#layerSelect').selectOption('protocol');
  await expectInputValue(page, '#layerSelect', 'protocol');
  const eventId = `${analyzerSessionId(sessionId)}:logical:protocol:2`;
  const malformedEvent = page.locator(`#timeline .event[data-event-id="${eventId}"]`);
  await malformedEvent.waitFor();
  await malformedEvent.click();
  await waitForDetailView(page, 'inspector');
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading...'));
  assert.equal((await page.locator('#detail .rawRefsView pre').textContent()).trim(), malformedLine);
});

test('browser groups derived sessions under their parent and collapses them by default', async (t) => {
  const index = await buildFixtureIndex();
  const childSessionId = '33333333-3333-3333-3333-333333333333';
  const orphanReviewSessionId = '88888888-8888-8888-8888-888888888888';
  const normalForkSessionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const expectedChildCount = index.sessions.filter((session) => session.parentSessionId === primaryFixtureSessionId).length;
  const { page } = await openApp(t, index, { locale: 'en', skipProjectReindex: true });
  const sessionChipText = (await page.locator('#sessionList .sessionItem .chip').allTextContents()).join(' | ');
  assert.doesNotMatch(sessionChipText, /Codex/);
  assert.doesNotMatch(sessionChipText, /protocol/i);

  const parentBranch = page.locator(`[data-session-branch-id="${primaryFixtureSessionId}"]`);
  const toggle = parentBranch.locator(`:scope > .sessionRow [data-session-children-toggle="${primaryFixtureSessionId}"]`);
  const children = parentBranch.locator(':scope > .sessionChildren');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.match(await toggle.getAttribute('aria-label'), new RegExp(`Show ${expectedChildCount} child sessions`));
  assert.equal((await toggle.textContent()).trim(), `${expectedChildCount} child sessions`);
  assert.equal(await toggle.locator('.sessionChildrenChevron').getAttribute('aria-hidden'), 'true');
  const bridgePlacement = await parentBranch.locator(':scope > .sessionRow').evaluate((row) => {
    const card = row.querySelector('.sessionItem').getBoundingClientRect();
    const control = row.querySelector('.sessionChildrenToggle').getBoundingClientRect();
    return {
      centerDelta: Math.abs((card.left + card.right) / 2 - (control.left + control.right) / 2),
      edgeDelta: Math.abs(card.bottom - (control.top + control.bottom) / 2),
    };
  });
  assert.ok(bridgePlacement.centerDelta <= 1, `expected centered bridge, got ${bridgePlacement.centerDelta}`);
  assert.ok(bridgePlacement.edgeDelta <= 1, `expected bottom-edge bridge, got ${bridgePlacement.edgeDelta}`);
  assert.equal(await children.getAttribute('hidden'), '');
  assert.equal(await page.locator(`[data-session-id="${orphanReviewSessionId}"]`).isVisible(), true);
  assert.equal(await page.locator(`[data-session-id="${normalForkSessionId}"]`).isVisible(), true);

  await toggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await children.getAttribute('hidden'), null);
  const child = children.locator(`[data-session-id="${childSessionId}"]`);
  assert.equal(await child.isVisible(), true);
  assert.match(await child.textContent(), /Subagent Fixture.*from/s);

  await child.click();
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, childSessionId);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
});

test('browser uses singular child session labels for one derived child', async (t) => {
  const residentIndex = await buildResidentCodexIndex({ repoRoot, codexHome: fixtureCodexHome });
  const childSessionId = '33333333-3333-3333-3333-333333333333';
  const retainedSessions = residentIndex.sessions.filter(
    (session) => session.parentSessionId !== primaryFixtureSessionId || session.id === childSessionId,
  );
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-single-child-browser-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const sessionsRoot = path.join(codexHome, 'sessions');
  await fsp.mkdir(sessionsRoot, { recursive: true });
  await Promise.all(retainedSessions.map((session) => (
    fsp.copyFile(session.sourceAbsFile, path.join(sessionsRoot, path.basename(session.sourceAbsFile)))
  )));
  const index = await buildIndex({ repoRoot, codexHome });
  const { page } = await openApp(t, index, { locale: 'en', skipProjectReindex: true });

  const toggle = page.locator(`[data-session-children-toggle="${primaryFixtureSessionId}"]`);
  assert.equal((await toggle.textContent()).trim(), '1 child session');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show 1 child session');

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-label'), 'Hide 1 child session');
});

test('browser locale switch reloads cached expanded event detail', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  const detailResponseFor = (locale) => (response) => {
    const parsed = new URL(response.url());
    return parsed.pathname.includes('/events/')
      && parsed.pathname.endsWith('/detail')
      && parsed.searchParams.get('locale') === locale
      && response.status() === 200;
  };

  const event = page.locator('#timeline .event.kind-command').first();
  await Promise.all([
    page.waitForResponse(detailResponseFor('en')),
    event.click(),
  ]);
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody');

  await Promise.all([
    page.waitForResponse(detailResponseFor('zh-CN')),
    switchHiddenLocale(page, 'zh-CN'),
  ]);
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody');
});

test('browser reading controls borrow search width for visible reset folds and fit narrow screens in both locales', async (t) => {
  const index = await buildFixtureIndex();
  const session = await materializeIndexedSession(index, primaryFixtureSessionId);
  const commandId = session.logicalEvents.find((event) => event.kind === 'command').id;
  const { page } = await openApp(t, index, { viewport: { width: 1600, height: 900 }, locale: 'en' });
  await selectPrimarySession(page);
  const command = page.locator(`#timeline .event[data-event-id="${commandId}"]`);
  await command.locator('.eventToggle').click();
  await command.click();
  await page.locator('#resetFoldsBtn').waitFor({ state: 'visible' });
  for (const locale of ['en', 'zh-CN']) {
    await page.setViewportSize({ width: 1536, height: 900 });
    await switchHiddenLocale(page, locale);
    await command.locator('.eventKind').click();
    await page.locator('#detail .inspector').waitFor();
    await page.locator('#resetFoldsBtn').waitFor({ state: 'visible' });
    for (const width of [1536, 1280, 1101, 820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        searchFits: document.querySelector('.searchInputRow').scrollWidth <= document.querySelector('.searchInputRow').clientWidth,
        controls: ['#layerSelect', '.profilePickerTopbar select', '.profilePickerTopbar .profileInfoBtn', '#resetFoldsBtn', '.searchField'].map((selector) => {
          const node = document.querySelector(selector);
          if (!node) throw new Error(`Missing ${selector} at ${innerWidth}`);
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const label = node.tagName === 'SELECT' ? node.selectedOptions[0].textContent : node.textContent;
          const textWidth = context.measureText(label.trim()).width;
          return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
            textFits: node.tagName !== 'SELECT' || textWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2 <= rect.width };
        }),
      }));
      assert.ok(geometry.scrollWidth <= geometry.width && geometry.searchFits, JSON.stringify({ locale, width, ...geometry }));
      for (const control of geometry.controls) {
        assert.ok(control.width > 0 && control.left >= 0 && control.right <= geometry.width
          && control.top >= 0 && control.bottom <= 900 && control.textFits, JSON.stringify({ locale, width, control }));
      }
      if (width > 1100) {
        const [layer, profile, info, reset, search] = geometry.controls;
        assert.ok([profile, info, reset].every((item) => Math.abs(item.top - layer.top) < 4),
          JSON.stringify({ locale, width, controls: geometry.controls }));
        assert.ok(search.right <= layer.left, 'desktop search must leave room for the complete control row');
        assert.ok(layer.right <= profile.left && profile.right <= info.left && info.right <= reset.left,
          JSON.stringify({ locale, width, controls: geometry.controls }));
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#resetFoldsBtn').click();
  assert.equal(await page.locator('#resetFoldsBtn').isHidden(), true);
  await page.locator('#layerSelect').selectOption('raw');
  assert.equal(await page.locator('#layerSelect').inputValue(), 'raw');
});

test('browser topbar bounds persisted long profile names with visible reset folds on narrow desktops', async (t) => {
  const index = await buildFixtureIndex();
  const session = await materializeIndexedSession(index, primaryFixtureSessionId);
  const commandId = session.logicalEvents.find((event) => event.kind === 'command').id;
  const profile = { id: 'custom:long-topbar-name', name: 'A long custom folding strategy name '.repeat(20),
    description: 'Synthetic long-name layout fixture.', rules: { fallback: 'summary', kindStates: {}, conditions: [] } };
  const { page } = await openApp(t, index, { viewport: { width: 1101, height: 900 }, locale: 'en',
    localStorage: { 'sessionAnalyzer.customProfiles': JSON.stringify([profile]) } });
  await selectPrimarySession(page);
  const command = page.locator(`#timeline .event[data-event-id="${commandId}"]`);
  for (const selectedProfile of ['narrative', profile.id]) {
    // An unselected long option must be bounded too: native selects measure all options.
    await command.locator('.eventKind').click();
    await page.locator('#profileSelect').selectOption(selectedProfile);
    await command.locator('.eventToggle').click();
    await command.locator('.eventKind').click();
    await page.locator('#resetFoldsBtn').waitFor({ state: 'visible' });
    for (const width of [1101, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const selectors = ['#layerSelect', '#profileSelect', '#resetFoldsBtn', '.searchField'];
        const controls = selectors.map((selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, top: rect.top, width: rect.width };
        });
        const row = document.querySelector('.searchInputRow');
        return { viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
          searchFits: row.scrollWidth <= row.clientWidth, controls };
      });
      assert.ok(layout.scrollWidth <= layout.viewport && layout.searchFits, JSON.stringify({ selectedProfile, width, layout }));
      assert.ok(layout.controls.every((control) => control.width > 0 && control.left >= 0 && control.right <= layout.viewport),
        JSON.stringify({ selectedProfile, width, layout }));
      assert.ok(layout.controls.slice(0, 3).every((control) => Math.abs(control.top - layout.controls[0].top) < 4),
        JSON.stringify({ selectedProfile, width, layout }));
    }
  }
  assert.equal(await page.locator('#profileSelect').inputValue(), profile.id);
  assert.equal(await page.locator('#profileSelect option:checked').textContent(), profile.name);
  await page.locator('#resetFoldsBtn').click();
  assert.equal(await page.locator('#resetFoldsBtn').isHidden(), true);
});

test('browser topbar width priorities keep search, Layer, and folding controls responsive', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { viewport: { width: 1280, height: 900 }, locale: 'en' });

  const readLayout = () => page.locator('.searchbar').evaluate((searchbar) => {
    const rect = (selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      return { top: bounds.top, left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
    };
    return {
      project: rect('.projectHeader'),
      sessions: rect('.sessionsPane'),
      searchbar: rect('.searchbar'),
      search: rect('.searchField'),
      layer: rect('#layerSelect'),
      folds: rect('.foldControls'),
      detailControls: rect('.topbarDetailControls'),
      timeline: rect('.timelinePane'),
      detail: rect('.detailPane'),
    };
  });

  let layout = await readLayout();
  assert.ok(Math.abs(layout.project.left - layout.sessions.left) < 1
    && Math.abs(layout.project.right - layout.sessions.right) < 1,
  'project header should share the sessions workspace column');
  assert.ok(layout.search.width <= 760.5, `expected capped search width, got ${layout.search.width}`);
  assert.ok(Math.abs(layout.search.left - (layout.timeline.left + 16)) < 1,
    'search should align with the padded timeline content edge');
  assert.ok(layout.search.left + layout.search.width <= layout.timeline.left + layout.timeline.width + 1,
    'search should not cross the timeline right boundary');
  assert.ok(Math.abs(layout.detailControls.left - layout.detail.left) < 1
    && Math.abs(layout.detailControls.right - layout.detail.right) < 1,
  'detail controls should occupy the same workspace column as the detail pane');
  assert.ok(layout.layer.width >= 129 && layout.layer.width <= 171);
  const topbarChrome = await page.locator('.topbar').evaluate((topbar) => {
    const chrome = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return { background: style.backgroundColor, borderLeft: style.borderLeftWidth, borderRight: style.borderRightWidth };
    };
    return {
      topbar: chrome('.topbar'),
      regions: ['.projectHeader', '.searchField', '.topbarDetailControls'].map(chrome),
    };
  });
  assert.notEqual(topbarChrome.topbar.background, 'rgba(0, 0, 0, 0)');
  assert.equal(topbarChrome.regions.every((region) => region.background === 'rgba(0, 0, 0, 0)'
    && region.borderLeft === '0px' && region.borderRight === '0px'), true,
  'workspace alignment should not visually split the topbar');

  await page.setViewportSize({ width: 820, height: 900 });
  layout = await readLayout();
  assert.ok(layout.search.top < layout.detailControls.top, 'search should occupy the first compact-medium row');
  assert.ok(layout.layer.left >= layout.detailControls.left && layout.layer.right <= layout.detailControls.right);
  assert.ok(layout.folds.width === 0
    || (layout.folds.left >= layout.detailControls.left && layout.folds.right <= layout.detailControls.right));
  assert.ok(Math.abs(layout.search.width - (layout.searchbar.width - 32)) < 2,
    'search should span the compact-medium workspace column with shared padding');

  await page.locator('#searchFilterBtn').click();
  const assistLayout = await page.locator('#searchAssist').evaluate((assist) => {
    const field = document.querySelector('.searchField').getBoundingClientRect();
    const bounds = assist.getBoundingClientRect();
    return { fieldWidth: field.width, assistWidth: bounds.width, aligned: Math.abs(field.left - bounds.left) < 2 };
  });
  assert.equal(assistLayout.aligned, true);
  assert.equal(Math.round(assistLayout.assistWidth), Math.round(Math.min(560, Math.max(500, assistLayout.fieldWidth))));
  await page.locator('#searchAssistClose').click();

  await fillSearch(page, 'patch');
  const resultsAlignment = await page.locator('#searchAssist').evaluate((assist) => {
    const input = document.querySelector('#searchInput').getBoundingClientRect();
    const metrics = document.querySelector('#searchMetricsPanel').getBoundingClientRect();
    return { inputLeft: input.left, metricsLeft: metrics.left, assistMode: assist.dataset.mode };
  });
  assert.equal(resultsAlignment.assistMode, 'results');
  assert.ok(Math.abs(resultsAlignment.inputLeft - resultsAlignment.metricsLeft) < 2,
    'results metrics should align with the free-text input');
  await page.locator('#searchInput').fill('');
  await page.locator('#searchInput').press('Escape');

  await page.setViewportSize({ width: 760, height: 900 });
  layout = await readLayout();
  assert.ok(layout.search.top < layout.detailControls.top && layout.layer.top >= layout.detailControls.top,
    'narrow controls should stack in priority order');
  assert.ok(Math.abs(layout.search.width - layout.layer.width) < 2);
  assert.ok(layout.folds.width === 0 || Math.abs(layout.layer.width - layout.folds.width) < 2);
});

test('browser folding rule keyboard changes retain the same select and adjacent Inspector focus', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 1280, height: 800 } });
  await selectPrimarySession(page);
  const rule = page.locator('#detail [data-profile-kind="command"]');
  await rule.focus();
  const before = await rule.inputValue();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.notEqual(await rule.inputValue(), before);
  assert.equal(await rule.evaluate((select) => select === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#detail').contains(document.activeElement)), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#detail').contains(document.activeElement)), true);
});

test('browser folding profile edits save, cancel, and repair invalid localStorage state', async (t) => {
  const index = await buildFixtureIndex();
  const { page, baseUrl } = await openApp(t, index);
  await selectPrimarySession(page);

  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="subagent"]').count(), 0);
  const fallbackPlacement = await page.locator('#detail [data-profile-fallback]').evaluate((select) => ({
    inDefaultDetailsSummary: Boolean(document.querySelector('#detail .profileRuleDetails:first-of-type summary')?.contains(select)),
    inSectionHeader: Boolean(select.closest('.profileRuleSectionHeader')),
  }));
  assert.deepEqual(fallbackPlacement, { inDefaultDetailsSummary: true, inSectionHeader: false });
  await page.locator('#detail [data-profile-fallback]').selectOption('collapsed');
  await expectInputValue(page, '#detail [data-profile-fallback]', 'collapsed');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForSelector('#detail [data-detail-action="cancel-profile"]');
  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));
  await page.locator('#detail [data-detail-action="save-profile"]').click();
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value.startsWith('custom:'));
  const savedProfileId = await page.locator('#profileSelect').inputValue();

  await page.reload();
  await page.waitForSelector('.sessionItem.active');
  await selectPrimarySession(page);
  await expectInputValue(page, '#profileSelect', savedProfileId);
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));

  await page.locator('[data-profile-kind="command"]').selectOption('hidden');
  await page.waitForSelector('#detail [data-detail-action="cancel-profile"]');
  await page.locator('#detail [data-detail-action="cancel-profile"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));

  await page.evaluate(() => localStorage.setItem('sessionAnalyzer.profile', 'missing-profile'));
  await page.goto(baseUrl);
  await page.waitForSelector('.sessionItem.active');
  await expectInputValue(page, '#profileSelect', 'narrative');
  const repaired = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.profile'));
  assert.equal(repaired, 'narrative');
});

test('browser folding profile exposes declared Code Mode requests and previews request rules immediately', async (t) => {
  const fixture = await makeCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const { page } = await openApp(t, index);

  const codeModeSection = page.locator('#detail [data-profile-section="code-mode"]');
  await codeModeSection.waitFor();
  const eventKindGroupNames = await page.locator(
    '#detail .profileRuleSection',
  ).first().locator(':scope > .profileRuleList > .profileRuleGroup > h4').allTextContents();
  const commonWorkIndex = eventKindGroupNames.findIndex((name) => /Work and tools|工作与工具/.test(name));
  const codeModeIndex = eventKindGroupNames.findIndex((name) => /Code Mode tool calls|Code Mode 工具调用/.test(name));
  assert.ok(commonWorkIndex >= 0);
  assert.equal(codeModeIndex, -1);
  assert.match(
    await codeModeSection.locator('xpath=ancestor::section[contains(@class, "profileRuleGroup")]/h4').textContent(),
    /Work and tools|工作与工具/,
  );
  assert.equal(
    await page.locator('#detail .profileDetailHeader').evaluate((header) => getComputedStyle(header).position),
    'sticky',
  );
  assert.equal(await page.locator('#detail .profileStrategyDescription').count(), 1);
  const stickyHeaderPosition = await page.locator('.detailPane').evaluate((pane) => {
    pane.scrollTop = pane.scrollHeight;
    const header = pane.querySelector('.profileDetailHeader');
    const paneRect = pane.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return {
      scrollable: pane.scrollHeight > pane.clientHeight,
      scrollTop: pane.scrollTop,
      paneTop: paneRect.top,
      panePaddingTop: Number.parseFloat(getComputedStyle(pane).paddingTop) || 0,
      headerTop: headerRect.top,
    };
  });
  if (stickyHeaderPosition.scrollable) {
    assert.ok(stickyHeaderPosition.scrollTop > 0);
    assert.ok(
      Math.abs(
        stickyHeaderPosition.headerTop
        - stickyHeaderPosition.paneTop
        - stickyHeaderPosition.panePaddingTop
      ) <= 2,
      `expected sticky profile header at detail-pane top: ${JSON.stringify(stickyHeaderPosition)}`,
    );
  }
  assert.equal(await codeModeSection.locator('[data-profile-condition="codeModeScriptOperation"]').count(), 1);
  assert.equal(
    await page.locator('#detail [data-profile-condition="codeModeScriptOperation"]').count(),
    1,
  );
  assert.equal(await page.locator('#detail [data-profile-kind="code_mode_script_operation"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="command"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="error"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-default-kinds]').count(), 0);
  assert.match(await codeModeSection.locator(':scope > p > strong').textContent(), /Code Mode tool calls|Code Mode 工具调用/);
  assert.equal(await codeModeSection.locator('h4').count(), 0);
  assert.equal(await codeModeSection.locator('[data-profile-condition="codeModeOperation"]').count(), 0);
  assert.match(
    await codeModeSection.locator('[data-profile-condition="codeModeScriptOperation"] option:checked').textContent(),
    /Inherit:|继承：/,
  );
  assert.equal(await codeModeSection.locator('.codeModeRuleCard, .codeModeRequestDetails, .profileRuleCount').count(), 0);
  for (const profileId of ['conversation', 'changes', 'debug', 'search', 'compact']) {
    await page.evaluate((id) => {
      const select = document.querySelector('#detail [data-profile-picker]');
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, profileId);
    await page.waitForFunction((id) => document.querySelector('#profileSelect')?.value === id, profileId);
    if (await page.locator('#detail [data-detail-action="close"]').count()) {
      await page.locator('#detail [data-detail-action="close"]').click();
    }
    await waitForDetailView(page, 'profileRules');
    const placement = await page.evaluate(() => {
      const section = document.querySelector('#detail [data-profile-section="code-mode"]');
      return {
        profile: document.querySelector('#detail [data-profile-picker]')?.value || '',
        count: document.querySelectorAll('#detail [data-profile-section="code-mode"]').length,
        inGroup: Boolean(section?.closest('.profileRuleGroup')),
        inDefaults: Boolean(section?.closest('[data-profile-default-kinds]')),
      };
    });
    assert.deepEqual(placement, {
      profile: profileId,
      count: 1,
      inGroup: true,
      inDefaults: false,
    }, `${profileId} keeps Code Mode controls in the explicit Work and tools group`);
  }
  await page.evaluate(() => {
    const select = document.querySelector('#detail [data-profile-picker]');
    select.value = 'narrative';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value === 'narrative');
  if (await page.locator('#detail [data-detail-action="close"]').count()) {
    await page.locator('#detail [data-detail-action="close"]').click();
  }
  await page.waitForFunction(() => (
    document.querySelector('#detail [data-profile-picker]')?.value === 'narrative'
    && document.querySelectorAll('#detail [data-profile-section="code-mode"]').length === 1
  ));
  const requestRule = page.locator('#detail [data-profile-code-mode-request="wait_agent"]');
  await requestRule.waitFor();
  const rowText = await requestRule.locator('xpath=..').textContent();
  assert.match(rowText, /Wait for subagent|等待子代理/);
  assert.match(rowText, /wait_agent/);
  assert.match(rowText, /Inherit:|继承：/);
  assert.match(await requestRule.locator('option[value=""]').textContent(), /Collapsed|折叠/);

  assert.equal(
    await page.locator('#detail [data-profile-kind="other_tool_call"]').count(),
    0,
    'zero-count ordinary tool kinds stay hidden even when Code Mode requests inherit their rules',
  );

  await requestRule.selectOption('expanded');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.code-mode-single-tool')]
    .some((event) => event.classList.contains('expanded')));
  assert.equal(await requestRule.locator('xpath=..').locator('.profileRuleChanged').count(), 1);
});

test('browser structured filters keep profile-hidden Code Mode request results visible', async (t) => {
  const fixture = await makeCodeModeSearchPreviewCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const hiddenProfile = {
    id: 'custom:hidden-code-mode-filter-results',
    name: 'Hidden Code Mode filter results',
    description: 'Exercises the structured-filter visibility floor.',
    rules: {
      kindStates: {},
      codeModeRequestStates: {},
      fallback: 'hidden',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenProfile]),
      'sessionAnalyzer.profile': hiddenProfile.id,
    },
  });

  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.hiddenByProfile').length >= 3
  ));
  assert.equal(await page.locator('#searchKindSelect option[value="code_mode_operation"]').count(), 0);
  assert.equal(await page.locator('[data-search-filter-row="codeModeRequest"]').count(), 0);
  assert.equal(
    await page.locator('#searchKindSelect optgroup[data-kind-group="code-mode"]').getAttribute('label'),
    '↳ Code Mode tool call',
  );
  const execRequestOption = page.locator('#searchKindSelect option[value="code_mode_request:exec_command"]');
  assert.equal(await execRequestOption.count(), 1);
  assert.match(await execRequestOption.textContent(), /^Declared: Exec command \(1\)$/);
  assert.doesNotMatch(await execRequestOption.textContent(), /\(exec_command\)/);
  assert.match(
    await page.locator('#searchKindSelect option[value="code_mode_request:shell_command"]').textContent(),
    /Declared: Shell command \(1\)/,
  );
  assert.doesNotMatch(
    await page.locator('#searchKindSelect option[value="code_mode_request:shell_command"]').textContent(),
    /\(shell_command\)/,
  );
  assert.match(
    await page.locator('#searchKindSelect option[value="code_mode_script_operation"]').textContent(),
    /Scripted operation \(1\)/,
  );
  await addSearchFilter(page, 'kind', 'code_mode_request:exec_command');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:exec_command');

  await addSearchFilter(page, 'kind', 'code_mode_request:shell_command');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:shell_command');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters · 1');

  await addSearchFilter(page, 'kind', 'code_mode_script_operation');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_script_operation');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters · 1');

  await clearAllSearch(page);
  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.hiddenByProfile').length >= 3
  ));
  await switchToProjectScope(page);
  await page.waitForFunction(() => (
    document.querySelector('#searchKindSelect option[value="code_mode_request:exec_command"]')?.textContent
      === 'Declared: Exec command (1)'
    && document.querySelector('#searchKindSelect option[value="code_mode_request:shell_command"]')?.textContent
      === 'Declared: Shell command (1)'
  ));
});

test('browser folding profile seeds dynamic kinds from the full session catalog', async (t) => {
  const fixture = await makeHookCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const { page } = await openApp(t, index);

  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.kind-hook').length === 0);
  await page.waitForSelector('#detail [data-profile-kind="hook"]');
  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').inputValue(), 'summary');
});

test('browser folding profile ignores inherited dynamic kinds in legacy custom profiles', async (t) => {
  const index = await buildFixtureIndex();
  const legacyProfile = {
    id: 'custom:legacy',
    name: 'Legacy custom profile',
    description: 'Saved before custom profile base ids were available.',
    rules: {
      kindStates: {
        user_message: 'expanded',
        assistant_message: 'expanded',
        hook: 'summary',
      },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([legacyProfile]),
    },
  });
  await selectPrimarySession(page);

  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').count(), 0);
});

test('browser issues metric toggles error-focus profile without losing session or adding filters', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  const issuesMetric = page.locator('.metric', { hasText: 'Issues' }).first();
  await issuesMetric.click();
  await expectInputValue(page, '#profileSelect', 'debug');
  await expectInputValue(page, '#searchInput', '');
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, primaryFixtureSessionId);
  assert.equal(await issuesMetric.getAttribute('aria-pressed'), 'true');

  await issuesMetric.click();
  await expectInputValue(page, '#profileSelect', 'narrative');
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, primaryFixtureSessionId);
});

test('browser expanded event collapse works with mouse and keyboard controls', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  const firstEvent = page.locator('#timeline .event[data-event-id]').first();
  const headerToggle = firstEvent.locator('.eventHeader [data-action="toggle"]');
  const footerToggle = firstEvent.locator('.eventFooterActions [data-action="toggle"]');
  await firstEvent.click();
  await page.waitForFunction(() => document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
  await footerToggle.click();
  await page.waitForFunction(() => !document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));

  await headerToggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
  await footerToggle.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
});

test('browser projects source-backed Cache Observation evidence and navigates Main to Protocol to Main', async (t) => {
  const fixture = await makeCacheObservationBrowserFixture(t);
  const materialized = await materializeIndexedSession(
    fixture.index,
    fixture.discontinuitySessionId,
  );
  const links = materialized.presentationIndexes.cacheDiscontinuityLinks;
  assert.equal(links.protocolEventIdsByMainEventId.size, 1);
  const [mainEventId, protocolEventIds] = [...links.protocolEventIdsByMainEventId][0];
  assert.equal(protocolEventIds.length, 2);
  const protocolEvents = materialized.logicalEvents.filter((event) => event.layer === 'protocol');
  assert.ok(protocolEvents.findIndex((event) => event.id === protocolEventIds[0]) >= 150);
  const codeModeMaterialized = await materializeIndexedSession(
    fixture.index,
    fixture.codeModeSessionId,
  );
  const codeModeLinks = codeModeMaterialized.presentationIndexes.cacheDiscontinuityLinks;
  assert.equal(codeModeLinks.protocolEventIdsByMainEventId.size, 1);
  const [codeModeMainEventId, codeModeProtocolEventIds] = [...codeModeLinks.protocolEventIdsByMainEventId][0];
  assert.equal(codeModeProtocolEventIds.length, 1);
  assert.equal(
    codeModeMaterialized.logicalEvents.find((event) => event.id === codeModeMainEventId)?.kind,
    'code_mode_operation',
  );

  const consoleProblems = [];
  const { page, requestedUrls } = await openApp(t, fixture.index, {
    locale: 'en',
    skipProjectReindex: true,
    beforeGoto: async (browserPage) => {
      browserPage.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          consoleProblems.push(`${message.type()}: ${message.text()}`);
        }
      });
    },
  });
  await page.locator(`[data-session-id="${fixture.discontinuitySessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.discontinuitySessionId);

  const mainAnchor = page.locator(`#timeline .event[data-event-id="${mainEventId}"]`);
  const affordance = mainAnchor.locator('.cacheDiscontinuityAffordance');
  await affordance.waitFor();
  assert.equal(await page.locator('#timeline .cacheDiscontinuityAffordance').count(), 1);
  assert.equal((await affordance.textContent()).trim(), '2 cache discontinuities · View evidence');
  assert.equal(await mainAnchor.locator('.cacheUsagePreview').count(), 0);
  assert.equal(await page.locator('#analysisPanel').getByText(/Cache reuse|Discontinuities|Cache health/).count(), 0);

  await addSearchFilter(page, 'kind', 'assistant_message');
  await page.waitForFunction((eventId) => (
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .cacheDiscontinuityAffordance`)
  ), mainEventId);
  await page.keyboard.press('Escape');
  const overridesBeforeNavigation = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides'));

  await affordance.click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'protocol'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: protocolEventIds[0] });
  const protocolTarget = page.locator(`#timeline .event[data-event-id="${protocolEventIds[0]}"]`);
  assert.equal(await protocolTarget.count(), 1);
  assert.equal(await protocolTarget.evaluate((element) => element.classList.contains('temporaryReferenceReveal')), true);
  assert.ok(requestedUrls.some((url) => (
    url.includes('/timeline?')
      && url.includes('layer=protocol')
      && url.includes('kind=assistant_message')
  )));
  assert.equal((await protocolTarget.locator('.eventKind').textContent()).trim(), 'Token usage');
  assert.equal(await protocolTarget.locator('.cacheDiscontinuityChip').textContent(), 'Cache discontinuity');
  assert.match(await protocolTarget.locator('.cacheUsagePreview').textContent(), /Input.*12\.3k.*Cached.*0.*0%.*Output.*589/s);
  assert.match(await protocolTarget.locator('.cacheDiscontinuityContext').textContent(), /after 14s.*cached 16\.4k → 0/s);
  assert.ok(requestedUrls.some((url) => (
    url.includes(`/events/${encodeURIComponent(protocolEventIds[0])}?`)
      && !url.includes('/detail')
  )));

  await page.waitForFunction(() => (
    document.querySelector('#detail')?.textContent.includes('Comparison Context')
      && document.querySelector('#detail')?.textContent.includes('explicit cache-expiry evidence')
  ));
  const inspectorText = await page.locator('#detail').textContent();
  assert.match(inspectorText, /Input12,288/);
  assert.match(inspectorText, /Cached input0/);
  assert.match(inspectorText, /Input-token delta−4,096 \(−25%\)/);
  assert.match(inspectorText, /Cache-read delta−16,384/);
  assert.match(inspectorText, /Cache reuse100% → 0%/);
  assert.match(inspectorText, /Comparison stateCache discontinuity/);
  assert.equal(inspectorText.includes('reasonCodes'), false);

  const reverse = page.locator('#detail [data-detail-action="navigate-linked-event"]');
  assert.equal((await reverse.textContent()).trim(), 'View Main context');
  await reverse.click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'main'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: mainEventId });
  await expectInputValue(page, '#searchKindSelect', 'assistant_message');
  assert.equal(await page.locator('#timeline .temporaryReferenceReveal').count(), 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides')),
    overridesBeforeNavigation,
  );
  assert.equal(await page.locator(`#timeline .event[data-event-id="${mainEventId}"] .cacheDiscontinuityAffordance`).count(), 1);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => (
    document.querySelector('#timeline .cacheDiscontinuityAffordance')?.textContent
      === '2 次缓存复用中断 · 查看证据'
  ));

  await clearAllSearch(page);

  await page.locator(`[data-session-id="${fixture.singleSessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.singleSessionId);
  assert.equal(
    (await page.locator('#timeline .cacheDiscontinuityAffordance').textContent()).trim(),
    '缓存复用中断 · 查看证据',
  );

  await page.locator(`[data-session-id="${fixture.ordinarySessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.ordinarySessionId);
  assert.equal(await page.locator('#timeline .cacheDiscontinuityAffordance').count(), 0);
  assert.equal(await page.locator('#analysisPanel').getByText(/缓存复用|缓存健康/).count(), 0);
  await page.locator('#layerSelect').selectOption('protocol');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .cacheUsageEvent').length === 2);
  assert.equal(await page.locator('#timeline .cacheDiscontinuityChip').count(), 0);
  assert.equal(await page.locator('#timeline .cacheDiscontinuityContext').count(), 0);
  assert.equal(await page.locator('#timeline .cacheUsageEvent .eventKind').last().textContent(), 'Token 使用情况');
  await page.locator('#timeline .cacheUsageEvent').last().click();
  await page.locator('#detail .tokenUsageBlock').waitFor();
  assert.equal(await page.locator('#detail [data-detail-action="navigate-linked-event"]').count(), 0);

  await switchHiddenLocale(page, 'en');
  const mainLayerResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('layer') === 'main';
  });
  await page.locator('#layerSelect').selectOption('main');
  await mainLayerResponse;
  await page.locator(`[data-session-id="${fixture.codeModeSessionId}"]`).click();
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
  ), fixture.codeModeSessionId);
  const codeModeAnchor = page.locator(`#timeline .event[data-event-id="${codeModeMainEventId}"]`);
  const codeModeAffordance = codeModeAnchor.locator('.cacheDiscontinuityAffordance');
  await codeModeAffordance.waitFor();

  await addSearchFilter(page, 'kind', 'code_mode_request:exec_command');
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:exec_command');
  await page.waitForFunction((eventId) => (
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .cacheDiscontinuityAffordance`)
  ), codeModeMainEventId);
  await page.keyboard.press('Escape');
  const linkedRequestStart = requestedUrls.length;

  await codeModeAffordance.click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'protocol'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: codeModeProtocolEventIds[0] });
  const codeModeProtocolTarget = page.locator(`#timeline .event[data-event-id="${codeModeProtocolEventIds[0]}"]`);
  assert.equal(await codeModeProtocolTarget.evaluate((element) => element.classList.contains('temporaryReferenceReveal')), true);
  const linkedProtocolRequests = requestedUrls.slice(linkedRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('layer') === 'protocol');
  assert.ok(linkedProtocolRequests.length > 0);
  assert.ok(linkedProtocolRequests.every((url) => !url.searchParams.has('codeModeRequest')));
  assert.ok(linkedProtocolRequests.some((url) => url.searchParams.get('kind') === 'code_mode_operation'));
  assert.equal(await page.locator('#searchKindSelect').inputValue(), '');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 1');
  assert.match(await page.locator('#searchFilterBtn').getAttribute('title'), /Code Mode tool call/);
  assert.doesNotMatch(await page.locator('#searchFilterBtn').getAttribute('title'), /Exec command|Declared/);

  await page.locator('#detail [data-detail-action="navigate-linked-event"]').click();
  await page.waitForFunction(({ eventId }) => (
    document.querySelector('#layerSelect')?.value === 'main'
      && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
  ), { eventId: codeModeMainEventId });
  assert.equal(await page.locator('#searchKindSelect').inputValue(), '');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 1');
  assert.doesNotMatch(await page.locator('#searchFilterBtn').getAttribute('title'), /Exec command|Declared/);

  await addSearchFilter(page, 'kind', 'code_mode_request:exec_command');
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:exec_command');
  await page.keyboard.press('Escape');
  const manualRequestStart = requestedUrls.length;
  const manualProtocolResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('layer') === 'protocol';
  });
  await page.locator('#layerSelect').selectOption('protocol');
  await manualProtocolResponse;
  const manualProtocolRequests = requestedUrls.slice(manualRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('layer') === 'protocol');
  assert.ok(manualProtocolRequests.length > 0);
  assert.ok(manualProtocolRequests.every((url) => !url.searchParams.has('codeModeRequest')));
  assert.equal(await page.locator('#searchKindSelect').inputValue(), '');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 1');
  assert.deepEqual(consoleProblems, []);
});
