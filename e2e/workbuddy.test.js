'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

// Synthetic persisted CodeBuddy 2.179.0 engine records; never a live model call.
for (const width of [1440, 390]) test(`WorkBuddy native search, tool Detail and Raw (${width})`, { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'projects', 'synthetic-project');
  await fs.mkdir(repo); await fs.mkdir(directory, { recursive: true });
  const sessionId = 'synthetic-workbuddy-browser';
  const rows = [
    { id: 'user', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect the synthetic example.' }] },
    { id: 'thought', parentId: 'user', type: 'reasoning', content: [], rawContent: [{ type: 'reasoning_text', text: 'Inspect the recorded file before answering.' }] },
    { id: 'read-call', parentId: 'thought', type: 'function_call', callId: 'read-1', name: 'Read', arguments: JSON.stringify({ file_path: 'example.txt' }) },
    { id: 'read-result', parentId: 'read-call', type: 'function_call_result', callId: 'read-1', name: 'Read', status: 'completed',
      output: { type: 'text', text: 'WORKBUDDY_TOOL_EVIDENCE: synthetic file contents.' },
      providerData: { conversationRequestId: 'request-1', toolResult: { title: 'Read 1 line', content: 'WORKBUDDY_TOOL_EVIDENCE: synthetic file contents.', renderer: { type: 'code', context: { language: 'text' } } } } },
    { id: 'answer', parentId: 'read-result', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'WORKBUDDY_FINAL: the synthetic file was inspected.' }] },
    { id: 'task-call', parentId: 'answer', type: 'function_call', callId: 'task-1', name: 'TaskUpdate', arguments: JSON.stringify({ taskId: '1', status: 'completed' }) },
    { id: 'task-result', parentId: 'task-call', type: 'function_call_result', callId: 'task-1', name: 'TaskUpdate', status: 'completed',
      output: { type: 'text', text: 'Task updated.' }, providerData: { conversationRequestId: 'request-1', toolResult: {
        content: 'Task updated.', rawResponse: { todos: [] },
        acpV2PlanSnapshot: { sourceId: 'plan-1', revision: '2', entries: [{ content: 'WORKBUDDY_COMPLETED_TASK', priority: 'medium', status: 'completed' }] },
      } } },
    { id: 'compact', parentId: 'task-result', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'WORKBUDDY_COMPACT_SUMMARY: the file has been inspected.' }],
      providerData: { conversationRequestId: 'request-1', isSummary: true, isCompacted: true, isCompactInternal: true, compactionKind: 'manual' } },
    { id: 'continuation', parentId: 'compact', type: 'message', role: 'user',
      content: [{ type: 'input_text', text: 'WORKBUDDY_INTERNAL_CONTEXT: continue from the recorded context.' }],
      providerData: { isCompacted: true, isCompactInternal: true, isSummary: false } },
    { id: 'image-input', type: 'message', role: 'user', content: [
      { type: 'input_text', text: '<system-reminder>WORKBUDDY_IMAGE_CONTEXT</system-reminder><user_query>@image#1:WORKBUDDY_IMAGE.png</user_query>' },
      { type: 'image_blob_ref', blob_id: 'synthetic-blob', original_filename: 'WORKBUDDY_IMAGE.png', mime: 'image/png', size: 123, blob_path: '/nonexistent/image.png' },
      { type: 'input_text', text: '<image_local_path>/nonexistent/image.png</image_local_path>' },
    ] },
    { id: 'defer-call', parentId: 'image-input', type: 'function_call', callId: 'defer-1', name: 'DeferExecuteTool',
      arguments: JSON.stringify({ toolName: 'im_list_conversations', arguments: {} }) },
    { id: 'defer-result', parentId: 'defer-call', type: 'function_call_result', callId: 'defer-1', name: 'DeferExecuteTool', status: 'completed',
      output: { type: 'text', text: 'WORKBUDDY_HEADLESS_UNAVAILABLE' },
      providerData: { toolResult: { content: 'WORKBUDDY_HEADLESS_UNAVAILABLE', rawResponse: { is_error: true } } } },
  ].map((row, i) => ({ timestamp: 1790000000000 + i * 1000, sessionId, cwd: repo,
    providerData: { conversationRequestId: 'request-1' }, ...row }));
  const file = path.join(directory, `${sessionId}.jsonl`);
  const original = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, original);
  const service = await createHistoryService({ repo, source: 'workbuddy', workbuddyHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const hits = (await service.execute('search', { query: 'WORKBUDDY_TOOL_EVIDENCE' })).items;
  assert.equal(hits.length, 1, 'the paired tool result has one logical search owner');
  const hit = hits[0];
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#ref=${encodeURIComponent(hit.ref)}`);
  await page.waitForFunction(({ sessionId: selectedSession, eventId }) =>
    document.querySelector('#sessionList .sessionItem.active')?.dataset.sessionId === selectedSession
      && document.querySelector('#timeline article.selected')?.dataset.eventId === eventId,
  { sessionId: hit.sessionId, eventId: hit.eventId });
  await page.waitForFunction(() => document.querySelector('#timeline article.selected')?.innerText.includes('WORKBUDDY_TOOL_EVIDENCE'));
  assert.match(await page.locator('#timeline article.selected').innerText(), /example\.txt|Read/);
  if (width < 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await page.locator('#detail [data-detail-action="raw"]').click();
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('WORKBUDDY_TOOL_EVIDENCE'));
  assert.match(await page.locator('#detail .rawRefsView').innerText(), /read-1/);
  if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => document.body.dataset.mainPresentation === 'trajectory');
  assert.match(await page.locator('#timeline').innerText(), /WORKBUDDY_FINAL|Read|example\.txt/);
  for (const marker of ['WORKBUDDY_COMPLETED_TASK', 'WORKBUDDY_COMPACT_SUMMARY', 'WORKBUDDY_INTERNAL_CONTEXT', 'WORKBUDDY_IMAGE.png', 'WORKBUDDY_HEADLESS_UNAVAILABLE']) {
    const matches = (await service.execute('search', { query: marker, ...(marker === 'WORKBUDDY_INTERNAL_CONTEXT' ? { layer: 'protocol' } : {}) })).items;
    assert.equal(matches.length, 1);
    await page.goto(`http://127.0.0.1:${server.address().port}/#ref=${encodeURIComponent(matches[0].ref)}`);
    await page.waitForFunction((expected) => document.querySelector('#timeline article.selected')?.innerText.includes(expected), marker);
    if (marker === 'WORKBUDDY_COMPLETED_TASK') assert.match(await page.locator('#timeline article.selected').innerText(), /completed/i);
    if (marker === 'WORKBUDDY_IMAGE.png') {
      const text = await page.locator('#timeline article.selected').innerText();
      assert.match(text, /Image attachment|image\/png/);
      // Search-match evidence can quote the hidden source wrapper; the message
      // content itself only presents the attachment metadata.
      assert.doesNotMatch(text.split('Search match')[0], /WORKBUDDY_IMAGE_CONTEXT|image_local_path/);
      if (width < 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
      await page.locator('#detail [data-detail-action="raw"]').click();
      await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('image_blob_ref'));
      assert.match(await page.locator('#detail .rawRefsView').innerText(), /WORKBUDDY_IMAGE_CONTEXT/);
      if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
    }
    if (marker === 'WORKBUDDY_HEADLESS_UNAVAILABLE') {
      assert.equal(matches[0].status, 'failed');
      assert.match(await page.locator('#timeline article.selected').innerText(), /im_list_conversations/);
    }
  }
  assert.equal(await fs.readFile(file, 'utf8'), original, 'reading never rewrites native history');
  assert.deepEqual(errors, []);
});

test('WorkBuddy runtime user envelopes stay in Protocol while real requests and steers retain identity', { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-identity-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'projects', 'synthetic-project');
  await fs.mkdir(repo); await fs.mkdir(directory, { recursive: true });
  const sessionId = 'synthetic-workbuddy-identity';
  const internal = [
    ['recovery', 'WB_RECOVERY_ONLY', { isCompactInternal: true, isPtlRecovery: true, isPtlRetryMarker: true, skipRun: false }],
    ['media', 'WB_MEDIA_ONLY', { isCompactInternal: true, isMediaBodyRecovery: true, isPtlRetryMarker: true, skipRun: false }],
    ['teammate', 'WB_TEAMMATE_ONLY', { teammateMessage: { from: 'agent-a', summary: 'Synthetic peer evidence' } }],
    ['command', 'WB_COMMAND_ONLY', { skipRun: true }],
    ['summary', 'WB_PARTIAL_SUMMARY_ONLY', { isSummary: true }],
    ['compact-type', 'WB_PARTIAL_COMPACT_ONLY', { compactType: 'auto' }],
  ];
  const requestText = 'WB_REAL_REQUEST: explain literal <system-reminder> and <teammate-message> tags.';
  const messages = [
    ...internal.map(([id, text, providerData]) => ({ id, text, providerData })),
    { id: 'request', text: requestText, providerData: { startsNewUserRequest: true } },
    { id: 'steer', text: 'WB_REAL_STEER: also explain the closing tags.', providerData: { startsNewUserRequest: false } },
    { id: 'external-meta', text: 'WB_EXTERNAL_META: inspect the next synthetic example.', providerData: { isMeta: true, startsNewUserRequest: true } },
  ];
  const rows = messages.map(({ id, text, providerData }, i) => ({ id, ...(i ? { parentId: messages[i - 1].id } : {}),
    type: 'message', role: 'user', content: [{ type: 'input_text', text }], providerData,
    sessionId, cwd: repo, timestamp: 1790000000000 + i * 1000 }));
  const lines = rows.map((row) => JSON.stringify(row));
  const file = path.join(directory, `${sessionId}.jsonl`);
  const original = `${lines.join('\n')}\n`;
  await fs.writeFile(file, original);
  const service = await createHistoryService({ repo, source: 'workbuddy', workbuddyHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const session = page.locator('#sessionList .sessionItem').first();
  await session.click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('WB_REAL_STEER'));
  assert.equal(await session.locator('.sessionTitle').innerText(), requestText, 'runtime envelopes cannot supply the session title');
  const mainText = await page.locator('#timeline').innerText();
  for (const marker of ['WB_REAL_REQUEST', 'WB_REAL_STEER', 'WB_EXTERNAL_META']) assert.ok(mainText.includes(marker), marker);
  for (const [, marker] of internal) assert.ok(!mainText.includes(marker), marker);
  const indexedId = await session.getAttribute('data-session-id');
  const analysis = await (await page.request.get(`${origin}/api/sessions/${encodeURIComponent(indexedId)}/analysis`)).json();
  assert.equal(analysis.counts.userMessages, 3);
  assert.equal(analysis.counts.turns, 2);
  const main = await (await page.request.get(`${origin}/api/sessions/${encodeURIComponent(indexedId)}/timeline?layer=main&limit=150`)).json();
  assert.deepEqual(main.events.map((event) => [event.kind, event.turnId]), [
    ['user_message', 'request'], ['user_message', 'request'], ['user_message', 'external-meta'],
  ], 'a genuine steer remains in its existing user turn');
  for (const [index, [, marker]] of internal.entries()) {
    assert.equal((await service.execute('search', { query: marker, layer: 'main' })).items.length, 0, marker);
    const hits = (await service.execute('search', { query: marker, layer: 'protocol' })).items;
    assert.equal(hits.length, 1, `${marker} has one Protocol owner`);
    const hit = hits[0];
    await page.goto(`${origin}/#ref=${encodeURIComponent(hit.ref)}`);
    await page.waitForFunction((eventId) => document.querySelector('#timeline article.selected')?.dataset.eventId === eventId, hit.eventId);
    assert.equal(await page.locator('#layerSelect').inputValue(), 'protocol');
    await page.locator('#detail [data-detail-action="raw"]').waitFor();
    assert.ok((await page.locator('#detail').textContent()).includes(marker), `${marker} remains inspectable in Detail`);
    const rawResponse = page.waitForResponse((response) => new URL(response.url()).pathname.includes('/raw/'));
    await page.locator('#detail [data-detail-action="raw"]').click();
    const raw = await (await rawResponse).json();
    assert.equal(raw.raw, lines[index], `${marker} resolves to its exact physical record`);
    await page.waitForFunction((expected) => document.querySelector('#detail .rawRefsView pre')?.textContent.includes(expected), marker);
    assert.equal(await page.locator('#detail .rawRefsView pre').count(), 1);
    assert.deepEqual(JSON.parse(await page.locator('#detail .rawRefsView pre').textContent()), rows[index]);
  }
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.deepEqual(errors, []);
});
