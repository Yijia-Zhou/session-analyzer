'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-navigation-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'sessions', 'synthetic');
  await fs.mkdir(repo); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'recovery.jsonl');
  const rows = [
    { type: 'session', version: 3, id: 'recovery', cwd: repo },
    { type: 'message', id: 'question', parentId: null, message: { role: 'user', content: 'SHARED_RECOVERY_QUESTION' } },
    { type: 'session_info', id: 'name', parentId: 'question', name: 'Recovery plan' },
    { type: 'message', id: 'call-a', parentId: 'name', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'attempt-a', name: 'bash', arguments: { command: 'attempt A' } }] } },
    { type: 'message', id: 'result-a', parentId: 'call-a', message: { role: 'toolResult', toolCallId: 'attempt-a', toolName: 'bash', isError: true, content: [{ type: 'text', text: 'A_FAILED_EVIDENCE' }] } },
    { type: 'label', id: 'label-a', parentId: 'result-a', targetId: 'result-a', label: 'Failed attempt' },
    { type: 'branch_summary', id: 'summary-b', parentId: 'name', fromId: 'result-a', summary: 'A failed; try B.' },
    { type: 'message', id: 'answer-b', parentId: 'summary-b', message: { role: 'assistant', content: [{ type: 'text', text: 'B_SUCCEEDED_EVIDENCE' }] } },
    { type: 'label', id: 'label-b', parentId: 'answer-b', targetId: 'answer-b', label: 'Successful attempt' },
  ];
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const start = async () => {
    const service = await createHistoryService({ repo, source: 'pi', piHome: home });
    const server = service.createViewerServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const close = async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await service.close(); };
    t.after(close);
    return { origin: `http://127.0.0.1:${server.address().port}`, close };
  };
  return { home, repo, file, start };
}

for (const width of [1440, 390]) test(`pi branch overview, referenced history and stable entry links (${width})`, { timeout: 60000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mobile = async (view) => { if (width < 760) await page.locator(`button[data-mobile-view="${view}"]`).click(); };
  const select = async (leaf) => {
    await mobile('sessions');
    await page.locator(`[data-session-id="pi:recovery:${leaf}"]`).click();
    await page.locator('[data-pi-overview]').waitFor();
  };
  const eventFor = async (layer, predicate) => {
    const response = await page.request.get(`${server.origin}/api/sessions/pi%3Arecovery%3A${predicate.leaf}/timeline?layer=${layer}&profile=all&limit=150`);
    const payload = await response.json();
    return payload.events.find((event) => predicate.test(event));
  };
  const inspect = async (event) => {
    await mobile('events');
    await page.locator('#layerSelect').selectOption(event.layer);
    await mobile('events');
    await page.locator(`#timeline .event[data-event-id="${event.id}"] .eventHeader`).click();
    await page.locator('#detail [data-pi-entry-actions] a').waitFor();
  };
  await page.goto(server.origin);
  await select('label-a');
  await page.getByRole('button', { name: 'Models & usage', exact: true }).click();
  await mobile('detail');
  const recorded = page.locator('#detail .piRecordedDetails');
  await recorded.waitFor();
  assert.equal(await recorded.evaluate((node) => node.open), false);
  assert.match(await page.locator('#detail').innerText(), /Selected model/);
  await recorded.locator('summary').click();
  assert.match(await recorded.innerText(), /partial sums/i);
  await select('label-a');
  await mobile('events');
  await page.locator('#layerSelect').selectOption('main');
  if (width < 760) await page.locator('[data-pi-overview] > details > summary').click();
  assert.match(await page.locator('[data-pi-overview]').innerText(), /Recovery plan/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /A_FAILED_EVIDENCE/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /B_SUCCEEDED_EVIDENCE/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /Failed attempt/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /Branches share history through/);
  if (width < 760) await page.locator('[data-pi-overview] > details > summary').click();
  await mobile('sessions');
  const toggle = page.locator('[data-pi-group-toggle="recovery"]');
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.focus(); await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');

  await mobile('events');
  await page.locator('#searchHudScope').click();
  await page.locator('[data-search-scope="project"]').click();
  await page.locator('#searchInput').fill('SHARED_RECOVERY_QUESTION');
  await page.locator('[data-pi-search-count]').waitFor();
  assert.match(await page.locator('[data-pi-search-count]').innerText(), /1 session · 2 matching branches shown/);
  assert.equal(await page.locator('[data-project-result-session-id]').count(), 2);
  assert.match(await page.locator('#stateLine').innerText(), /2 branches/);
  assert.match(await page.locator('[data-search-match-count]').first().innerText(), /2 branches/);
  assert.match(await page.locator('#searchMetricsPanel').innerText(), /Matching branches/);
  assert.match(await page.locator('#resultSummary').innerText(), /2 matching branches · 2 matching events/);
  await page.locator('#searchInput').fill('');
  await select('label-a');

  const shared = await eventFor('main', { leaf: 'label-a', test: (event) => event.kind === 'user_message' });
  assert.ok(shared);
  await inspect(shared);
  await page.locator('#detail [data-pi-entry-actions] a').click();
  const chooser = page.locator('dialog.piBranchChooser');
  await chooser.waitFor({ state: 'visible' });
  assert.equal(await chooser.locator('[data-pi-branch]').count(), 2);
  await chooser.locator('[data-pi-branch="pi:recovery:label-b"]').click();
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-b');

  const summary = await eventFor('protocol', { leaf: 'label-b', test: (event) => event.subtype === 'pi_branch_summary' });
  assert.ok(summary);
  await inspect(summary);
  await page.getByRole('button', { name: 'Read summarized branch', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#layerSelect')?.value === 'raw');
  await mobile('detail');
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('A_FAILED_EVIDENCE'));
  await page.locator('#detail [data-pi-entry-actions] a').waitFor();
  const savedLink = await page.locator('#detail [data-pi-entry-actions] a').getAttribute('href');
  await page.getByRole('button', { name: 'Copy entry link', exact: true }).click();
  await page.getByRole('button', { name: 'Entry link copied', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), savedLink);

  await fs.appendFile(data.file, JSON.stringify({ type: 'message', id: 'after-a', parentId: 'label-a', message: { role: 'assistant', content: 'A_FOLLOWUP_AFTER_BOOKMARK' } }) + '\n');
  const rebuilt = await data.start();
  await page.addInitScript(() => { window.piInitialHistoryLength = history.length; });
  const bookmark = new URL(savedLink); bookmark.port = new URL(rebuilt.origin).port;
  bookmark.searchParams.set('ref', 'unrelated-snapshot-reference');
  bookmark.searchParams.set('evidenceRef', 'unrelated-snapshot-reference');
  bookmark.hash = 'ref=unrelated-snapshot-reference';
  await page.goto(bookmark.href);
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:after-a'
    && document.querySelector('#detail')?.textContent.includes('A_FAILED_EVIDENCE'));
  assert.equal(await page.locator('dialog.piBranchChooser').count(), 0);
  const hydrated = new URL(page.url());
  assert.equal(hydrated.searchParams.has('ref'), false);
  assert.equal(hydrated.searchParams.has('evidenceRef'), false);
  assert.equal(hydrated.hash, '');
  assert.equal(await page.evaluate(() => history.length), await page.evaluate(() => window.piInitialHistoryLength));
  const wrongProject = new URL(bookmark.href); wrongProject.searchParams.set('repoRoot', path.join(data.home, 'another-project'));
  await page.goto(wrongProject.href);
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('another source or project'));
  assert.deepEqual(errors, []);
});

test('pi navigation localizes its controls and retires a delayed entry request on branch selection', { timeout: 45000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  await page.goto(server.origin);
  await page.locator('[data-session-id="pi:recovery:label-a"]').click();
  await page.locator('[data-pi-overview]').waitFor();
  assert.match(await page.locator('[data-pi-overview]').innerText(), /会话分支/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /模型与用量/);
  assert.match(await page.locator('#stateLine').innerText(), /2 个分支/);
  await page.locator('#searchHudScope').click();
  await page.locator('[data-search-scope="project"]').click();
  await page.locator('#searchInput').fill('SHARED_RECOVERY_QUESTION');
  await page.locator('[data-pi-search-count]').waitFor();
  assert.match(await page.locator('[data-pi-search-count]').innerText(), /1 个会话 · 2 个匹配分支/);
  assert.match(await page.locator('[data-search-match-count]').first().innerText(), /2 个分支/);
  assert.match(await page.locator('#searchMetricsPanel').innerText(), /匹配分支/);
  assert.match(await page.locator('#resultSummary').innerText(), /2 个匹配分支 · 2 个匹配事件/);
  await page.locator('#searchInput').fill('');
  await page.locator('[data-session-id="pi:recovery:label-a"]').click();
  const response = await page.request.get(`${server.origin}/api/sessions/pi%3Arecovery%3Alabel-a/timeline?layer=main&limit=150`);
  const shared = (await response.json()).events.find((event) => event.kind === 'user_message');
  await page.locator(`#timeline .event[data-event-id="${shared.id}"] .eventHeader`).click();
  const link = page.locator('#detail [data-pi-entry-actions] a');
  await link.waitFor();
  assert.equal(await link.innerText(), '打开条目链接');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  let delivered;
  const completed = new Promise((resolve) => { delivered = resolve; });
  await page.route('**/api/pi/entry?**', async (route) => {
    const response = await route.fetch(); started(); await gate;
    try { await route.fulfill({ response }); } catch { /* Input intentionally aborts the request. */ }
    delivered();
  });
  await link.click(); await pending;
  await page.locator('[data-session-id="pi:recovery:label-b"]').click();
  release(); await completed;
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-b'
    && document.querySelector('#timeline')?.textContent.includes('B_SUCCEEDED_EVIDENCE'));
  assert.equal(await page.locator('dialog.piBranchChooser').count(), 0);
});

test('pi entry browser back and forward resolve without growing browser history', { timeout: 45000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  await page.goto(server.origin);
  const openBranchEntry = async (leaf, kind) => {
    await page.locator(`[data-session-id="pi:recovery:${leaf}"]`).click();
    await page.locator('#layerSelect').selectOption('main');
    const response = await page.request.get(`${server.origin}/api/sessions/pi%3Arecovery%3A${leaf}/timeline?layer=main&limit=150`);
    const event = (await response.json()).events.find((event) => event.kind === kind);
    await page.locator(`#timeline .event[data-event-id="${event.id}"] .eventHeader`).click();
    const link = page.locator('#detail [data-pi-entry-actions] a');
    await link.waitFor(); const href = await link.getAttribute('href');
    await link.click();
    await page.waitForURL(href);
    return href;
  };
  const first = await openBranchEntry('label-a', 'command');
  const second = await openBranchEntry('label-b', 'assistant_message');
  const length = await page.evaluate(() => history.length);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#detail [data-pi-entry-actions] a')?.href === location.href);
  assert.equal(page.url(), first);
  assert.equal(await page.evaluate(() => history.length), length);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-b'
    && document.querySelector('#detail [data-pi-entry-actions] a')?.href === location.href);
  assert.equal(page.url(), second);
  assert.equal(await page.evaluate(() => history.length), length);
});
