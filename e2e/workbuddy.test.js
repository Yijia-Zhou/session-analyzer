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
  for (const marker of ['WORKBUDDY_COMPLETED_TASK', 'WORKBUDDY_COMPACT_SUMMARY']) {
    const matches = (await service.execute('search', { query: marker })).items;
    assert.equal(matches.length, 1);
    await page.goto(`http://127.0.0.1:${server.address().port}/#ref=${encodeURIComponent(matches[0].ref)}`);
    await page.waitForFunction((expected) => document.querySelector('#timeline article.selected')?.innerText.includes(expected), marker);
    if (marker === 'WORKBUDDY_COMPLETED_TASK') assert.match(await page.locator('#timeline article.selected').innerText(), /completed/i);
  }
  assert.equal(await fs.readFile(file, 'utf8'), original, 'reading never rewrites native history');
  assert.deepEqual(errors, []);
});
