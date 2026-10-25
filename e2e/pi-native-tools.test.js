'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

for (const locale of ['en-US', 'zh-CN']) test(`mobile pi failed command automatically loads when document scrolling reveals it (${locale})`, { timeout: 30000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-mobile-visible-detail-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'sessions', 'synthetic');
  await fs.mkdir(repo);
  await fs.mkdir(directory, { recursive: true });
  const rows = [{ type: 'session', version: 3, id: 'mobile-failed-command', cwd: repo }];
  let parentId = null;
  const add = (id, message) => {
    rows.push({ type: 'message', id, parentId, message });
    parentId = id;
  };
  for (let i = 0; i < 20; i += 1) {
    add(`before-${i}`, { role: 'user', content: `Synthetic preceding message ${i}.` });
  }
  add('call-failure', { role: 'assistant', content: [{ type: 'toolCall', id: 'failure', name: 'bash',
    arguments: { command: 'synthetic-failed-command' } }] });
  add('result-failure', { role: 'toolResult', toolName: 'bash', toolCallId: 'failure', isError: true,
    content: [{ type: 'text', text: 'MOBILE_FAILED_COMMAND_OUTPUT: expected 0.1, received 0.09' }] });
  await fs.writeFile(path.join(directory, 'mobile.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const service = await createHistoryService({ repo, source: 'pi', piHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ locale, viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const detailPaths = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/detail')) detailPaths.push(pathname);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('.sessionItem').first().click();
  const failed = page.locator('#timeline .event.kind-command.status-failed');
  await failed.waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle');
  const eventId = await failed.getAttribute('data-event-id');
  const isTargetDetail = (pathname) => decodeURIComponent(pathname.split('/').at(-2)) === eventId;
  assert.equal(detailPaths.filter(isTargetDetail).length, 0);
  assert.ok(await failed.evaluate((node) => node.classList.contains('expanded')
    && node.getBoundingClientRect().top > innerHeight));
  assert.match(await failed.locator('.eventBody').innerText(), /Loading structured detail|结构化详情加载中/);
  await failed.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  assert.ok(await page.evaluate(() => scrollY > 1000));
  assert.equal(await page.locator('.timelinePane').evaluate((node) => node.scrollTop), 0);
  await page.waitForFunction((id) => {
    const owner = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"]`);
    return owner?.querySelector('.eventBody')?.textContent.includes('MOBILE_FAILED_COMMAND_OUTPUT');
  }, eventId, { timeout: 3000 });
  assert.equal(detailPaths.filter(isTargetDetail).length, 1);
  assert.equal(await failed.evaluate((node) => node.classList.contains('expanded')), true);
  assert.doesNotMatch(await failed.locator('.eventBody').innerText(), /Loading structured detail|结构化详情加载中/);
  assert.deepEqual(errors, []);
});

for (const locale of ['en-US', 'zh-CN']) for (const width of [1440, 390]) test(`native pi edit patch reading (${locale}, ${width})`, { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-branches-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'sessions', 'synthetic');
  await fs.mkdir(repo); await fs.mkdir(directory, { recursive: true });
  const patch = '--- src/a.js\n+++ src/a.js\n@@ -1 +1 @@\n-OLD_NATIVE\n+NEW_NATIVE\n';
  const rows = [{ type: 'session', version: 3, id: 'native-tools', cwd: repo }];
  let parentId = null;
  const add = (id, message) => { rows.push({ type: 'message', id, parentId, message }); parentId = id; };
  for (const [id, isError] of [['success', false], ['failure', true], ['contradictory', false]]) {
    add(`call-${id}`, { role: 'assistant', content: [{ type: 'toolCall', id, name: 'edit', arguments: { path: 'src/a.js', edits: [{ oldText: 'OLD_NATIVE', newText: 'NEW_NATIVE' }] } }] });
    add(`result-${id}`, { role: 'toolResult', toolName: 'edit', toolCallId: id, isError, content: [{ type: 'text', text: `${id} recorded receipt` }], details: { patch: id === 'contradictory' ? patch.replace('+1 @@', '+20 @@') : patch } });
  }
  add('call-write', { role: 'assistant', content: [{ type: 'toolCall', id: 'write', name: 'write', arguments: { path: 'src/a.js', content: 'RECORDED_WRITE_CONTENT' } }] });
  add('result-write', { role: 'toolResult', toolName: 'write', toolCallId: 'write', isError: false, content: [{ type: 'text', text: 'Write completed' }] });
  add('call-read', { role: 'assistant', content: [{ type: 'toolCall', id: 'read-other', name: 'read', arguments: { path: 'other.txt' } }] });
  add('result-read', { role: 'toolResult', toolName: 'read', toolCallId: 'read-other', isError: false, content: [{ type: 'text', text: 'OTHER_FILE' }] });
  await fs.writeFile(path.join(directory, 'tools.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const service = await createHistoryService({ repo, source: 'pi', piHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale, viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('.sessionItem').first().click();
  await page.locator('#timeline .patchFile').waitFor();
  const successCard = page.locator('#timeline .event').filter({ has: page.locator('.patchFile') });
  const successId = await successCard.getAttribute('data-event-id');
  assert.match(await successCard.innerText(), /OLD_NATIVE/);
  assert.match(await successCard.innerText(), /NEW_NATIVE/);
  assert.equal(await page.locator('#timeline .patchFile').count(), 1, 'failed/contradictory edits and successful writes do not fabricate patches');
  assert.match(await page.locator('[data-metric-value="changes"]').innerText(), /1/);
  assert.match(await page.locator('[data-metric-value="changes"]').innerText(), locale === 'zh-CN' ? /文件/ : /Files/);
  await successCard.locator('.eventHeader').click();
  if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/file-activity'));
  await successCard.locator('[data-file-activity="src/a.js"]').first().click();
  const response = await responsePromise;
  assert.equal(new URL(response.url()).searchParams.get('file'), 'src/a.js');
  const activity = await response.json();
  assert.equal(activity.events.filter((event) => event.kind === 'patch').length, 1);
  assert.ok(activity.events.some((event) => event.id === successId));
  assert.equal(activity.total, 4, 'recorded file activity includes all three edit requests and the write request');
  assert.equal(activity.events.filter((event) => event.association === 'patch_record').length, 1);
  assert.equal(activity.events.filter((event) => event.association === 'recorded_path').length, 3);
  await page.locator('[data-file-activity-close]').click();
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.locator(`[data-trajectory-event-id="${successId}"]`).first().click();
  if (width < 760) await page.locator('button[data-mobile-view="detail"]').click();
  await page.locator('#detail .patchFile').waitFor();
  assert.match(await page.locator('#detail .patchFile').innerText(), /OLD_NATIVE/);
  assert.match(await page.locator('#detail .patchFile').innerText(), /NEW_NATIVE/);
  await page.locator('#detail [data-detail-action="raw"]').click();
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('result-success'));
  const raw = await page.locator('#detail .rawRefsView').innerText();
  assert.match(raw, /call-success/);
  assert.match(raw, /result-success/);
  assert.doesNotMatch(raw, /"id": "result-failure"/);
  assert.deepEqual(errors, []);
});
