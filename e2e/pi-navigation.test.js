'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');
const { createServer } = require('../server');
const { withNavigationDiagnostics } = require('./browser-diagnostics');

async function fixture(t, extraBranches = 0, statistics = false) {
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
  if (statistics) {
    rows.find((row) => row.id === 'call-a').parentId = 'shared-result-a';
    rows.find((row) => row.id === 'summary-b').parentId = 'shared-result-b';
    rows.find((row) => row.id === 'call-a').message.usage = { input: 0, output: null, cacheRead: 123456789012345680 };
    rows.find((row) => row.id === 'answer-b').message.usage = null;
    rows.splice(3, 0,
      { type: 'message', id: 'shared-call', parentId: 'name', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'shared-tool', name: 'bash', arguments: { command: 'shared request' } }] } },
      { type: 'message', id: 'shared-result-a', parentId: 'shared-call', message: { role: 'toolResult', toolCallId: 'shared-tool', toolName: 'bash', isError: false, content: 'SHARED_TOOL_A_SUCCESS', usage: { input: 5 } } },
      { type: 'message', id: 'shared-result-b', parentId: 'shared-call', message: { role: 'toolResult', toolCallId: 'shared-tool', toolName: 'bash', isError: true, content: 'SHARED_TOOL_B_FAILURE' } },
    );
    rows.push(
      { type: 'usage', id: 'usage-one', parentId: 'label-b', usage: { input: Number.MAX_VALUE } },
      { type: 'usage', id: 'usage-two', parentId: 'usage-one', usage: { input: Number.MAX_VALUE } },
      { type: 'message', id: 'shell', parentId: 'usage-two', message: { role: 'bashExecution', command: 'pwd', output: 'synthetic project', exitCode: 0 } },
      { type: 'message', message: { role: 'assistant', content: 'EXCLUDED_IDLESS', usage: { input: 999 } } },
    );
  }
  for (let i = 0; i < extraBranches; i += 1) rows.push({ type: 'message', id: `extra-${i}`, parentId: 'question',
    message: { role: 'assistant', content: `EXTRA_BRANCH_${i}` } });
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (statistics ? '\n{malformed\n\n' : '\n'));
  const start = async (interactive = false) => {
    const service = interactive ? null : await createHistoryService({ repo, source: 'pi', piHome: home });
    const server = interactive ? createServer(null, 0, { repo, source: 'pi', piHome: home, codexHome: path.join(home, 'empty-codex') }) : service.createViewerServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const close = async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await service?.close(); };
    t.after(close);
    return { origin: `http://127.0.0.1:${server.address().port}`, close, service };
  };
  return { home, repo, file, start };
}

async function openSharedChooser(page, origin) {
  await page.goto(origin);
  const first = page.locator('.sessionItem[data-session-id]').first();
  const sessionId = await first.getAttribute('data-session-id');
  await first.click();
  await page.locator('#layerSelect').selectOption('main');
  const response = await page.request.get(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/timeline?layer=main&limit=150`);
  const shared = (await response.json()).events.find((event) => event.kind === 'user_message');
  await page.locator(`#timeline .event[data-event-id="${shared.id}"] .eventHeader`).click();
  const link = page.locator('#detail [data-pi-entry-actions] a');
  await link.waitFor();
  const href = await link.getAttribute('href');
  await link.click();
  const chooser = page.locator('dialog.piBranchChooser');
  await chooser.waitFor({ state: 'visible' });
  return { chooser, sessionId, href };
}

test('pi shared-entry chooser pages all branches without changing the pending reference or selected history', { timeout: 60000 }, async (t) => {
  const data = await fixture(t, 203);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const { chooser, sessionId, href } = await openSharedChooser(page, server.origin);
  await page.locator('[data-pi-overview] .piOverviewBranches > li').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-pi-overview] .piOverviewBranches > li').count(), 100);
  assert.match(await page.locator('[data-pi-overview] > [data-pi-branches] > summary').innerText(), /100 visible branches\./);
  const statistics = page.locator('[data-pi-native-statistics]');
  assert.equal(await statistics.evaluate((node) => node.open), false);
  // The shared-entry chooser is modal; inspect the background disclosure without input.
  await statistics.evaluate((node) => { node.open = true; });
  assert.equal(await statistics.locator('[data-pi-native-count="rawRecords"]').innerText(), '212');
  assert.equal(await statistics.locator('[data-pi-native-count="assistantMessages"]').innerText(), '205');
  assert.equal(await statistics.locator('[data-pi-native-count="userMessages"]').innerText(), '1');
  const url = page.url();
  const detail = await page.locator('#detail').innerText();
  assert.equal(await chooser.locator('[data-pi-branch]').count(), 100);
  const firstIds = await chooser.locator('[data-pi-branch]').evaluateAll((nodes) => nodes.map((node) => node.dataset.piBranch));
  for (const total of [200, 205]) {
    await chooser.getByRole('button', { name: /^Load more/ }).click();
    await page.waitForFunction((count) => document.querySelectorAll('dialog.piBranchChooser [data-pi-branch]').length === count, total);
    assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), sessionId);
    assert.equal(await page.locator('#detail').innerText(), detail);
    assert.equal(page.url(), url);
  }
  const allIds = await chooser.locator('[data-pi-branch]').evaluateAll((nodes) => nodes.map((node) => node.dataset.piBranch));
  assert.equal(new Set(allIds).size, 205);
  assert.equal(await chooser.locator('[data-pi-branches-more]').isVisible(), false);
  const last = allIds.at(-1);
  assert.equal(firstIds.includes(last), false);
  await chooser.locator(`[data-pi-branch="${last}"]`).click();
  await page.waitForFunction((id) => document.querySelector('[data-pi-overview] [aria-current="true"] [data-pi-session]')?.dataset.piSession === id
    && document.querySelector('#timeline .event.selected')?.dataset.eventId?.startsWith(`${id}:event:2:`), last);
  await page.waitForURL(href);
  assert.equal(await page.locator('dialog.piBranchChooser').count(), 0);
});

for (const change of ['cancel', 'session', 'source', 'index']) test(`pi branch paging discards a late response after ${change}`, { timeout: 60000 }, async (t) => {
  const data = await fixture(t, 101);
  const server = await data.start(['source', 'index'].includes(change));
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const { chooser, sessionId } = await openSharedChooser(page, server.origin);
  await page.locator('[data-pi-overview] .piOverviewBranches > li').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-pi-overview] .piOverviewBranches > li').count(), 100);
  assert.match(await page.locator('[data-pi-overview] > [data-pi-branches] > summary').innerText(), /100 条可见分支/);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let started; const pending = new Promise((resolve) => { started = resolve; });
  let delivered; const completed = new Promise((resolve) => { delivered = resolve; });
  t.after(() => release());
  await page.route('**/api/pi/entry?**', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('branchOffset')) { await route.continue(); return; }
    const response = await route.fetch(); started(); await gate;
    try { await route.fulfill({ response }); } catch { /* The retired page request is intentionally aborted. */ }
    delivered();
  });
  const more = chooser.locator('[data-pi-branches-more]');
  assert.match(await more.innerText(), /^加载更多/);
  await more.click(); await pending;
  assert.equal(await more.isDisabled(), true);
  // Deliver real application transitions directly while the modal makes the
  // background inert; each transition must retire paging without an Escape first.
  if (change === 'cancel') await page.keyboard.press('Escape');
  else if (change === 'session') {
    await page.locator(`.sessionItem[data-session-id]:not([data-session-id="${sessionId}"])`).first().evaluate((node) => node.click());
    await page.waitForFunction((old) => document.querySelector('.sessionItem.active')?.dataset.sessionId !== old, sessionId);
  } else if (change === 'source') {
    await page.locator('#projectSwitchControl').evaluate((node) => node.click());
    await page.locator('[data-source-choice="codex"]').click();
    if (await page.locator('#projectSourceAction').isVisible()) await page.locator('#projectSourceAction').click();
    await page.waitForFunction(() => document.querySelector('#projectSourceSwitch')?.dataset.source === 'codex');
  } else if (change === 'index') {
    await fs.appendFile(data.file, JSON.stringify({ type: 'message', id: 'after-page', parentId: 'extra-0', message: { role: 'assistant', content: 'NEW_INDEX_EVIDENCE' } }) + '\n');
    await page.locator('#projectRefreshBtn').evaluate((node) => node.click());
    await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false'
      && document.querySelector('#projectRefreshStatus')?.classList.contains('success'));
  }
  const active = await page.locator('.sessionItem.active').evaluateAll((nodes) => nodes[0]?.dataset.sessionId || null);
  const url = page.url();
  release(); await completed;
  // A fresh UI request fences the released handler before checking for stale publication.
  await page.request.get(server.origin + '/api/state');
  assert.equal(await page.locator('dialog.piBranchChooser').count(), 0);
  assert.equal(await page.locator('.sessionItem.active').evaluateAll((nodes) => nodes[0]?.dataset.sessionId || null), active);
  assert.equal(page.url(), url);
  assert.deepEqual(errors, []);
});

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
  await page.getByRole('button', { name: 'Selected branch models and usage', exact: true }).click();
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
  if (width < 760) await page.locator('[data-pi-overview] > [data-pi-branches] > summary').click();
  assert.match(await page.locator('[data-pi-overview]').innerText(), /Recovery plan/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /A_FAILED_EVIDENCE/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /B_SUCCEEDED_EVIDENCE/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /Failed attempt/);
  assert.match(await page.locator('[data-pi-overview]').innerText(), /Branches share history through/);
  if (width < 760) await page.locator('[data-pi-overview] > [data-pi-branches] > summary').click();
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

test('pi entry browser Back restores an ordinary reading entry and Forward retains the target', { timeout: 45000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  await page.goto(server.origin);
  await page.locator('[data-session-id="pi:recovery:label-a"]').click();
  // Establish an independent in-app return entry before the browser round trip.
  await page.getByRole('button', { name: 'Selected branch models and usage', exact: true }).click();
  await page.locator('#detail .piRecordedDetails').waitFor();
  await page.locator('#layerSelect').selectOption('main');
  const response = await page.request.get(`${server.origin}/api/sessions/pi%3Arecovery%3Alabel-a/timeline?layer=main&limit=150`);
  const event = (await response.json()).events.find((item) => item.kind === 'command');
  await page.locator(`#timeline .event[data-event-id="${event.id}"] .eventHeader`).click();
  await page.locator('#detail [data-pi-entry-actions] a').waitFor();
  const pane = page.locator('.timelinePane');
  await pane.evaluate((node) => { node.scrollTop = 20; });
  const scrollTop = await pane.evaluate((node) => node.scrollTop);
  assert.ok(scrollTop > 0);
  const original = page.url();
  const initialLength = await page.evaluate(() => history.length);
  // Keep the saved viewport intact while activating the actual overview label.
  await page.locator('[data-pi-overview] [data-pi-entry]').filter({ hasText: 'Successful attempt' }).evaluate((node) => node.click());
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-b'
    && document.querySelector('#layerSelect')?.value === 'raw' && new URL(location.href).searchParams.has('piEntry'));
  const target = page.url();
  const targetEvent = await page.locator('#timeline .event.selected').getAttribute('data-event-id');
  await page.goBack();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#layerSelect')?.value === 'main' && document.querySelector('#timeline .event.selected')?.dataset.eventId === id, event.id);
  await page.waitForFunction((top) => Math.abs(document.querySelector('.timelinePane').scrollTop - top) < 1, scrollTop);
  assert.equal(page.url(), original);
  assert.match(await page.locator('#detail').innerText(), /attempt A/);
  assert.equal(await page.evaluate(() => history.length), initialLength + 1);
  await page.goForward();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-b'
    && document.querySelector('#layerSelect')?.value === 'raw' && document.querySelector('#timeline .event.selected')?.dataset.eventId === id, targetEvent);
  assert.equal(page.url(), target);
  assert.equal(await page.evaluate(() => history.length), initialLength + 1);
  await page.locator('[data-reading-back]:visible').first().click();
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#layerSelect')?.value === 'main' && !document.querySelector('#timeline .event.selected'));
  await page.waitForFunction(() => !document.querySelector('[data-reading-back]'));
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
});

test('pi chooser browser Forward retires an unfinished Back and retains the chosen branch', { timeout: 45000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const { chooser, sessionId, href } = await openSharedChooser(page, server.origin);
  const target = await chooser.locator(`[data-pi-branch]:not([data-pi-branch="${sessionId}"])`).getAttribute('data-pi-branch');
  const originalEvent = await page.locator('#timeline .event.selected').getAttribute('data-event-id');
  await chooser.locator(`[data-pi-branch="${target}"]`).click();
  await page.waitForURL(href);
  const targetEvent = await page.locator('#timeline .event.selected').getAttribute('data-event-id');
  const length = await page.evaluate(() => history.length);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let started; const pending = new Promise((resolve) => { started = resolve; });
  let delivered; const completed = new Promise((resolve) => { delivered = resolve; });
  t.after(() => release());
  let delayed = false;
  await page.route('**/api/sessions/*/timeline?**', async (route) => {
    if (delayed || !decodeURIComponent(new URL(route.request().url()).pathname).includes(`/sessions/${sessionId}/timeline`)) {
      await route.continue(); return;
    }
    delayed = true;
    const response = await route.fetch(); started(); await gate;
    try { await route.fulfill({ response }); } catch { /* Forward retires the Back request. */ }
    delivered();
  });
  await page.goBack(); await pending;
  await page.goForward();
  await page.waitForFunction(({ session, event }) => document.querySelector('.sessionItem.active')?.dataset.sessionId === session
    && document.querySelector('#timeline .event.selected')?.dataset.eventId === event, { session: target, event: targetEvent });
  release(); await completed;
  await page.request.get(server.origin + '/api/state');
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), target);
  assert.equal(await page.locator('dialog.piBranchChooser').count(), 0);
  assert.equal(page.url(), href);
  assert.equal(await page.evaluate(() => history.length), length);
  await page.goBack();
  await page.waitForFunction(({ session, event }) => document.querySelector('.sessionItem.active')?.dataset.sessionId === session
    && document.querySelector('#timeline .event.selected')?.dataset.eventId === event, { session: sessionId, event: originalEvent });
  assert.equal(new URL(page.url()).searchParams.has('piEntry'), false);
  assert.equal(await page.evaluate(() => history.length), length);
  assert.deepEqual(errors, []);
});

test('pi browser Back restores the mobile reading surface and document scroll', { timeout: 45000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 900 } });
  const mobile = (view) => page.locator(`button[data-mobile-view="${view}"]`).click();
  await page.goto(server.origin);
  await mobile('sessions');
  await page.locator('[data-session-id="pi:recovery:label-a"]').click();
  await mobile('events');
  await page.locator('#layerSelect').selectOption('main');
  const response = await page.request.get(`${server.origin}/api/sessions/pi%3Arecovery%3Alabel-a/timeline?layer=main&limit=150`);
  const event = (await response.json()).events.find((item) => item.kind === 'command');
  await page.locator(`#timeline .event[data-event-id="${event.id}"] .eventHeader`).click();
  await page.locator('#detail [data-pi-entry-actions] a').waitFor();
  await mobile('events');
  await page.evaluate(() => window.scrollTo(0, 120));
  const scrollTop = await page.evaluate(() => window.scrollY);
  assert.ok(scrollTop > 0);
  await page.locator('[data-pi-overview] [data-pi-entry]').filter({ hasText: 'Successful attempt' }).evaluate((node) => node.click());
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-b'
    && document.querySelector('#layerSelect')?.value === 'raw' && new URL(location.href).searchParams.has('piEntry'));
  const target = page.url(); const length = await page.evaluate(() => history.length);
  await page.goBack();
  await page.waitForFunction(({ id, top }) => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#layerSelect')?.value === 'main' && document.querySelector('#timeline .event.selected')?.dataset.eventId === id
    && document.body.dataset.mobileView === 'events' && Math.abs(window.scrollY - top) < 1, { id: event.id, top: scrollTop });
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-b'
    && document.querySelector('#layerSelect')?.value === 'raw' && document.body.dataset.mobileView === 'detail');
  assert.equal(page.url(), target);
  assert.equal(await page.evaluate(() => history.length), length);
});

test('pi browser reading snapshots reject an index revision change', { timeout: 45000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start(true);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  await page.goto(server.origin);
  await page.locator('[data-session-id="pi:recovery:label-a"]').click();
  await page.locator('[data-pi-overview] [data-pi-entry]').filter({ hasText: 'Successful attempt' }).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.has('piEntry'));
  await fs.appendFile(data.file, JSON.stringify({ type: 'message', id: 'next-b', parentId: 'label-b',
    message: { role: 'assistant', content: 'B_AFTER_REFRESH' } }) + '\n');
  await page.locator('#projectRefreshBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false'
    && document.querySelector('#projectRefreshStatus')?.classList.contains('success'));
  const active = await page.locator('.sessionItem.active').getAttribute('data-session-id');
  const length = await page.evaluate(() => history.length);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('entry is unavailable'));
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), active);
  assert.equal(await page.evaluate(() => history.length), length);
});

// Observe the complete application from before its listeners are installed. These
// This helper only observes events and real fetches. The separately named
// simulated-companion test explicitly labels its one untrusted event delivery.
async function observeExcerptNavigation(page) {
  await page.addInitScript(() => {
    window.__piExcerptTrace = { events: [], requests: [], pending: 0 };
    for (const type of ['popstate', 'hashchange']) window.addEventListener(type, (event) => {
      window.__piExcerptTrace.events.push({ type, trusted: event.isTrusted, url: location.href, state: structuredClone(history.state) });
    });
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const trace = window.__piExcerptTrace;
      const request = { url: String(args[0]), settled: false };
      trace.requests.push(request); trace.pending += 1;
      try { return await fetch(...args); }
      finally { request.settled = true; trace.pending -= 1; }
    };
  });
}

async function excerptSettled(page, eventId, detailView = 'inspector') {
  await page.waitForFunction(({ eventId, detailView }) => document.body.dataset.historyReading === 'isolated'
    && document.body.dataset.detailView === detailView
    && document.querySelector('#timeline .event.selected')?.dataset.eventId === eventId
    && !document.querySelector('[data-history-action="cancel"]')
    && window.__piExcerptTrace.pending === 0, { eventId, detailView });
  // Fetch settlement precedes JSON parsing/rendering. Fence the next painted DOM.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function excerptSnapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    session: document.querySelector('.sessionItem.active')?.dataset.sessionId,
    layer: document.querySelector('#layerSelect').value,
    reading: document.body.dataset.historyReading,
    selected: document.querySelector('#timeline .event.selected')?.dataset.eventId,
    view: document.body.dataset.detailView,
    mobileView: document.body.dataset.mobileView,
    cards: [...document.querySelectorAll('#timeline .event')].map((node) => ({
      id: node.dataset.eventId, expanded: node.classList.contains('expanded'),
      details: [...node.querySelectorAll('details')].map((detail) => detail.open),
    })),
    inspectorDetails: [...document.querySelectorAll('#detail details')].map((node) => node.open),
    // The separate local Detail-view stack is not part of a reading position.
    detail: (() => {
      const node = document.querySelector('#detail').cloneNode(true);
      node.querySelector('[data-detail-action="back"]')?.remove();
      return node.textContent;
    })(),
    scroll: document.querySelector('.timelinePane').scrollTop,
    detailScroll: document.querySelector('.detailPane').scrollTop,
    returns: [...document.querySelectorAll('[data-reading-back]')].map((node) => node.textContent),
  }));
}

async function preparedExcerpt(t, detailView, diagnostics) {
  const data = await fixture(t);
  const rows = (await fs.readFile(data.file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  rows.find((row) => row.id === 'summary-b').summary += '\n\n' + Array.from({ length: 24 }, (_, i) => `Synthetic recovery paragraph ${i}: retain the reader viewport and disclosure choices.`).join('\n\n');
  await fs.writeFile(data.file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const server = await data.start();
  const hit = (await server.service.execute('search', { query: 'A failed', layer: 'protocol' })).items[0];
  assert.ok(hit?.ref);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  await diagnostics?.attach(page);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await observeExcerptNavigation(page);
  const original = `${server.origin}/#ref=${encodeURIComponent(hit.ref)}`;
  await page.goto(original);
  await excerptSettled(page, hit.eventId);
  // Retain a real, independent in-app return entry through the browser trips.
  await page.getByRole('button', { name: 'Read summarized branch', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#layerSelect').value === 'raw' && new URL(location.href).searchParams.has('piEntry'));
  const returnEvent = await page.locator('#timeline .event.selected').getAttribute('data-event-id');
  await page.getByRole('button', { name: 'Selected branch models and usage', exact: true }).click();
  await page.locator('[data-reading-back]').first().waitFor();
  await page.goBack();
  await excerptSettled(page, hit.eventId);
  const nearby = page.locator('#timeline .event').filter({ hasText: 'Successful attempt' });
  const selected = await nearby.getAttribute('data-event-id');
  assert.notEqual(selected, hit.eventId, 'exercise a nearby record, not the linked anchor');
  assert.equal(await nearby.evaluate((node) => node.classList.contains('expanded')), false);
  await nearby.locator('.eventHeader').click();
  await excerptSettled(page, selected);
  // Keep the new manual expansion and open Timeline and Detail disclosures.
  // The original anchor supplies enough real content for pane scrolling.
  const anchorDisclosure = page.locator(`#timeline .event[data-event-id="${hit.eventId}"] details`).first();
  await anchorDisclosure.locator('summary').click();
  const inspectorDisclosure = page.locator('#detail details').first();
  await inspectorDisclosure.locator('summary').click();
  if (detailView === 'rawRefs') {
    await page.locator('#detail [data-detail-action="raw"]').click();
    await excerptSettled(page, selected, detailView);
  }
  await page.locator('.timelinePane').evaluate((node) => { node.scrollTop = 160; });
  await page.locator('.detailPane').evaluate((node) => { node.scrollTop = 70; });
  await excerptSettled(page, selected, detailView);
  const snapshot = await excerptSnapshot(page);
  assert.ok(snapshot.scroll > 0, 'the saved excerpt has a meaningful scrolled viewport');
  assert.ok(snapshot.cards.some((card) => card.id === selected && card.expanded), 'save a manual fold override');
  assert.ok(snapshot.cards.some((card) => card.details.some(Boolean)), 'save an open Timeline disclosure');
  if (detailView === 'inspector') assert.ok(snapshot.inspectorDetails.some(Boolean), 'save an open Detail disclosure');
  assert.ok(snapshot.returns.length, 'the independent in-app return must still exist');
  return { page, server, hit, selected, original, snapshot, returnEvent, errors };
}

function excerptReads(requests) {
  return {
    resolve: requests.filter(({ url }) => url.startsWith('/api/history/resolve?')).length,
    context: requests.filter(({ url }) => /^\/api\/sessions\/[^/]+\/events\/[^/?]+\?/.test(url)).length,
  };
}

function excerptTraversal(events) {
  return events.map(({ type, trusted, url, state }) => ({ type, trusted,
    hash: new URL(url).hash ? 'reference' : 'empty',
    nativeEntry: new URL(url).searchParams.has('piEntry'),
    savedPosition: state?.sessionAnalyzerPiReading?.id ?? null,
  }));
}

for (const view of ['inspector', 'rawRefs']) test(`pi browser Back restores the complete snapshot-bound excerpt (${view})`, { timeout: 45000 }, async (t) => {
  const { page, hit, selected, snapshot, returnEvent, errors } = await preparedExcerpt(t, view);
  // Activate the real native-entry action without Playwright scrolling the saved
  // viewport to it. This invokes the application's normal delegated click path.
  await page.getByRole('button', { name: 'Read referenced entry', exact: true }).evaluate((node) => node.click());
  await page.waitForFunction(() => new URL(location.href).searchParams.has('piEntry') && window.__piExcerptTrace.pending === 0);
  const target = page.url();
  const length = await page.evaluate(() => history.length);
  const targetEvent = await page.locator('#timeline .event.selected').getAttribute('data-event-id');
  for (let trip = 0; trip < 2; trip += 1) {
    const before = await page.evaluate(() => ({ events: window.__piExcerptTrace.events.length, requests: window.__piExcerptTrace.requests.length }));
    await page.goBack();
    await excerptSettled(page, selected, view);
    const trace = await page.evaluate(({ events, requests }) => ({ events: window.__piExcerptTrace.events.slice(events), requests: window.__piExcerptTrace.requests.slice(requests) }), before);
    t.diagnostic(JSON.stringify({ trip, traversal: excerptTraversal(trace.events), reads: excerptReads(trace.requests) }));
    assert.equal(excerptReads(trace.requests).resolve, 1, 'one owner resolves the saved excerpt');
    assert.equal(excerptReads(trace.requests).context, snapshot.cards.length, 'each context record is fetched once');
    assert.deepEqual(await excerptSnapshot(page), snapshot, 'restore selection, folds, disclosures, Detail, viewport, and in-app return');
    assert.equal(await page.evaluate(() => history.length), length);
    assert.ok(trace.events.length && trace.events[0].type === 'popstate');
    assert.ok(trace.events[0].state?.sessionAnalyzerPiReading, 'the real popstate carries its snapshot owner');
    if (trip === 0) {
      await page.goForward();
      await page.waitForFunction((id) => location.href.includes('piEntry=') && document.querySelector('#timeline .event.selected')?.dataset.eventId === id
        && window.__piExcerptTrace.pending === 0, targetEvent);
      assert.equal(page.url(), target);
      assert.equal(await page.evaluate(() => history.length), length);
    }
  }
  await page.locator('[data-reading-back]:visible').first().click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#layerSelect').value === 'raw'
    && document.querySelector('#timeline .event.selected')?.dataset.eventId === id
    && !document.querySelector('[data-reading-back]') && window.__piExcerptTrace.pending === 0, returnEvent);
  assert.notEqual(returnEvent, hit.eventId);
  assert.deepEqual(errors, []);
});

for (const simulatedCompanion of [false, true]) test(simulatedCompanion
  ? 'pi excerpt simulated companion hashchange preserves the gated Back owner and later Forward'
  : 'pi excerpt browser Forward retires a gated Back before its real response arrives', { timeout: 45000 }, withNavigationDiagnostics(async (t, diagnostics) => {
  const { page, selected, snapshot, errors } = await preparedExcerpt(t, 'rawRefs', diagnostics);
  await page.getByRole('button', { name: 'Read referenced entry', exact: true }).evaluate((node) => node.click());
  await page.waitForFunction(() => new URL(location.href).searchParams.has('piEntry') && window.__piExcerptTrace.pending === 0);
  // The fetch observer sees headers before the entry-action JSON updates Detail.
  // Capture the completed target surface, including its native-entry actions.
  await page.locator('#detail [data-pi-copy-entry]').waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const target = await excerptSnapshot(page);
  await diagnostics.checkpoint('native-entry-target-ready', { eventId: target.selected });
  const length = await page.evaluate(() => history.length);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let started; const pending = new Promise((resolve) => { started = resolve; });
  let delivered; const completed = new Promise((resolve) => { delivered = resolve; });
  t.after(() => release());
  let delayed = false;
  await page.route('**/api/history/resolve?**', async (route) => {
    if (delayed) { await route.continue(); return; }
    delayed = true;
    const response = await route.fetch(); started(); await gate;
    try { await route.fulfill({ response }); } catch { /* A newer traversal may abort the old real request. */ }
    delivered();
  });
  const before = await page.evaluate(() => ({ events: window.__piExcerptTrace.events.length, requests: window.__piExcerptTrace.requests.length }));
  await page.goBack(); await pending;
  if (simulatedCompanion) {
    const owner = await page.evaluate(() => structuredClone(history.state));
    assert.ok(owner?.sessionAnalyzerPiReading, 'the native Back establishes its saved reading owner');
    // Delivery-channel simulation only: Chromium's native query-changing Back
    // above emits popstate alone here. Deliberately deliver its companion hash
    // event to the real application while its real resolution request is held.
    await page.evaluate((oldURL) => {
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
    }, target.url);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const companion = await page.evaluate(({ events, requests }) => ({
      events: window.__piExcerptTrace.events.slice(events),
      requests: window.__piExcerptTrace.requests.slice(requests),
      state: structuredClone(history.state),
    }), before);
    t.diagnostic(JSON.stringify({ simulatedCompanion: true, traversal: excerptTraversal(companion.events),
      reads: excerptReads(companion.requests), savedPosition: companion.state?.sessionAnalyzerPiReading?.id ?? null }));
    assert.deepEqual(companion.state, owner, 'the simulated companion must retain the Back snapshot owner and id');
    assert.equal(excerptReads(companion.requests).resolve, 1, 'the simulated companion must not start a second evidence resolver');
  }
  await page.goForward();
  await page.waitForFunction(({ url, id, view }) => location.href === url
    && document.querySelector('#timeline .event.selected')?.dataset.eventId === id
    && document.body.dataset.detailView === view && window.__piExcerptTrace.pending <= 1
    && document.querySelector('#detail').textContent.includes('B_SUCCEEDED_EVIDENCE'), { url: target.url, id: target.selected, view: target.view });
  await page.locator('#detail [data-pi-copy-entry]').waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const forwarded = await excerptSnapshot(page);
  assert.deepEqual({ ...forwarded, scroll: target.scroll }, target, 'Forward restores the target reading surface');
  release(); await completed;
  await page.waitForFunction(() => window.__piExcerptTrace.pending === 0 && !document.querySelector('[data-history-action="cancel"]'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const trace = await page.evaluate(({ events, requests }) => ({ events: window.__piExcerptTrace.events.slice(events), requests: window.__piExcerptTrace.requests.slice(requests) }), before);
  t.diagnostic(JSON.stringify({ gatedTraversal: excerptTraversal(trace.events), reads: excerptReads(trace.requests) }));
  assert.equal(excerptReads(trace.requests).resolve, 1, 'the gated Back starts one evidence resolver');
  assert.deepEqual(await excerptSnapshot(page), forwarded, 'the late Back cannot replace the newer Forward surface or viewport');
  assert.equal(await page.evaluate(() => history.length), length);
  await page.goBack();
  await excerptSettled(page, selected, 'rawRefs');
  assert.deepEqual(await excerptSnapshot(page), snapshot, 'a later Back still restores the unconsumed excerpt');
  assert.deepEqual(errors, []);
}));

test('pi excerpt manual reference changes still resolve after snapshot-owned browser Back', { timeout: 45000 }, async (t) => {
  const { page, server, selected, errors } = await preparedExcerpt(t, 'inspector');
  await page.getByRole('button', { name: 'Read referenced entry', exact: true }).evaluate((node) => node.click());
  await page.waitForFunction(() => new URL(location.href).searchParams.has('piEntry') && window.__piExcerptTrace.pending === 0);
  await page.goBack(); await excerptSettled(page, selected);
  const alternate = (await server.service.execute('search', { query: 'Successful attempt', layer: 'protocol' })).items[0];
  assert.ok(alternate?.ref);
  const before = await page.evaluate(() => window.__piExcerptTrace.requests.length);
  // Assigning location.hash is a real user-style fragment navigation; the browser
  // generates its events and a fresh history entry without a synthetic dispatch.
  await page.evaluate((ref) => { location.hash = `ref=${encodeURIComponent(ref)}`; }, alternate.ref);
  await excerptSettled(page, alternate.eventId);
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('ref'), alternate.ref);
  assert.equal(new URL(page.url()).searchParams.has('piEntry'), false);
  const requests = await page.evaluate((start) => window.__piExcerptTrace.requests.slice(start), before);
  assert.equal(excerptReads(requests).resolve, 1, 'a genuine new hash still has one evidence resolver');
  await page.evaluate(() => { location.hash = ''; });
  await page.waitForFunction(() => document.body.dataset.historyReading !== 'isolated' && window.__piExcerptTrace.pending === 0);
  assert.deepEqual(errors, []);
});

test('pi browser references still resolve after their bounded reading snapshot is evicted', { timeout: 45000 }, async (t) => {
  const data = await fixture(t);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  await page.goto(server.origin);
  await page.locator('[data-session-id="pi:recovery:label-a"]').click();
  await page.locator('#layerSelect').selectOption('main');
  const response = await page.request.get(`${server.origin}/api/sessions/pi%3Arecovery%3Alabel-a/timeline?layer=main&limit=150`);
  const event = (await response.json()).events.find((item) => item.kind === 'command');
  await page.locator(`#timeline .event[data-event-id="${event.id}"] .eventHeader`).click();
  const link = page.locator('#detail [data-pi-entry-actions] a');
  await link.waitFor(); const original = await link.getAttribute('href');
  await link.click(); await page.waitForURL(original);
  for (let i = 0; i < 41; i += 1) {
    const before = page.url();
    await page.locator('[data-pi-overview] [data-pi-entry]').filter({ hasText: i % 2 ? 'Failed attempt' : 'Successful attempt' }).evaluate((node) => node.click());
    await page.waitForFunction((url) => location.href !== url, before);
  }
  const length = await page.evaluate(() => history.length);
  await page.evaluate(() => history.go(-41));
  await page.waitForFunction((event) => document.querySelector('.sessionItem.active')?.dataset.sessionId === 'pi:recovery:label-a'
    && document.querySelector('#layerSelect')?.value === 'main' && document.querySelector('#timeline .event.selected')?.dataset.eventId === event, event.id);
  assert.equal(page.url(), original);
  assert.equal(await page.locator('dialog.piBranchChooser').count(), 0);
  assert.equal(await page.evaluate(() => history.length), length);
});

for (const [locale, width] of [['en-US', 1440], ['zh-CN', 390]]) test(`pi whole-native statistics preserve physical scope and usage coverage (${locale}, ${width})`, { timeout: 60000 }, async (t) => {
  const data = await fixture(t, 0, true);
  const server = await data.start();
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale, viewport: { width, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const mobile = async (view) => { if (width < 760) await page.locator(`button[data-mobile-view="${view}"]`).click(); };
  const select = async (leaf) => {
    await mobile('sessions');
    await page.locator(`[data-session-id="pi:recovery:${leaf}"]`).click();
    await mobile('events');
    await page.waitForFunction((id) => document.querySelector('[data-pi-overview] [aria-current="true"] [data-pi-session]')?.dataset.piSession === id, `pi:recovery:${leaf}`);
  };
  await page.goto(server.origin);
  await select('label-a');
  const statistics = page.locator('[data-pi-native-statistics]');
  assert.equal(await statistics.evaluate((node) => node.open), false);
  assert.equal(await statistics.locator(':scope > summary').innerText(), locale === 'en-US' ? 'Whole native session statistics' : '整个原生会话统计');
  assert.equal(await page.getByRole('button', { name: locale === 'en-US' ? 'Selected branch models and usage' : '所选分支模型与用量', exact: true }).count(), 1);
  await statistics.locator(':scope > summary').click();
  const counts = await statistics.locator('[data-pi-native-count]').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.dataset.piNativeCount, node.textContent])));
  assert.deepEqual(counts, { rawRecords: '17', entryRecords: '16', unlinkedRecords: '2', malformedRecords: '1', userMessages: '1', assistantMessages: '3', systemMessages: '0', toolResultMessages: '3', otherMessages: '0', assistantToolRequests: '2', directShellExecutions: '1' });
  for (const category of ['assistant', 'tool_nested_model_work', 'usage', 'branch_summary']) await statistics.locator(`[data-pi-usage-category="${category}"] > summary`).click();
  const assistant = statistics.locator('[data-pi-usage-category="assistant"]');
  const input = assistant.locator('[data-pi-usage-field="input"]');
  assert.match(await input.innerText(), locale === 'en-US' ? /0 recorded partial sum/ : /0 已记录部分和/);
  assert.match(await input.innerText(), locale === 'en-US' ? /1 recorded · 1 missing · 0 invalid/ : /1 已记录 · 1 缺失 · 0 无效/);
  assert.match(await assistant.locator('[data-pi-usage-field="output"]').innerText(), locale === 'en-US' ? /Unknown[\s\S]*0 recorded · 1 missing · 1 invalid/ : /未知[\s\S]*0 已记录 · 1 缺失 · 1 无效/);
  assert.match(await statistics.locator('[data-pi-usage-category="usage"] [data-pi-usage-field="input"]').innerText(), locale === 'en-US' ? /Unknown \(sum overflow\)/ : /未知（求和溢出）/);
  assert.match(await statistics.locator('[data-pi-usage-category="branch_summary"]').innerText(), locale === 'en-US' ? /Records eligible for usage: 1 · Usage receipts: 0 · Without saved usage: 1/ : /可记录用量的记录：1 · 用量回执：0 · 未保存用量：1/);
  assert.match(await statistics.innerText(), locale === 'en-US' ? /A shared request can have different results on sibling branches/ : /共享请求可在兄弟分支有不同结果/);
  assert.match(await statistics.innerText(), locale === 'en-US' ? /not combined into a grand total or reconstructed bill/ : /不将类别部分和合并成总计，也不重建账单/);
  assert.equal(await statistics.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  const lastField = statistics.locator('[data-pi-usage-category="branch_summary"] [data-pi-usage-field="totalTokens"]');
  await lastField.scrollIntoViewIfNeeded();
  const lastFieldBox = await lastField.boundingBox();
  assert.ok(lastFieldBox.y >= 0 && lastFieldBox.y + lastFieldBox.height <= 900, 'expanded coverage stays vertically reachable');
  const before = await statistics.innerText();
  const sharedResult = async (expected) => {
    const card = page.locator('#timeline .event').filter({ hasText: 'shared request' });
    if (!await card.evaluate((node) => node.classList.contains('expanded'))) await card.locator('.eventToggle').click();
    await page.waitForFunction((text) => document.querySelector('#timeline')?.textContent.includes(text), expected);
    assert.match(await card.innerText(), new RegExp(expected));
  };
  await sharedResult('SHARED_TOOL_A_SUCCESS');
  await select('shell');
  assert.equal(await statistics.evaluate((node) => node.open), false);
  await statistics.locator(':scope > summary').click();
  for (const category of ['assistant', 'tool_nested_model_work', 'usage', 'branch_summary']) await statistics.locator(`[data-pi-usage-category="${category}"] > summary`).click();
  assert.equal(await statistics.innerText(), before);
  await sharedResult('SHARED_TOOL_B_FAILURE');
  assert.deepEqual(errors, []);
});

for (const change of ['branch', 'source']) test(`pi native statistics discard a late overview after changing ${change}`, { timeout: 45000 }, async (t) => {
  const data = await fixture(t, 0, true);
  const server = await data.start(change === 'source');
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  await page.goto(server.origin);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let started; const pending = new Promise((resolve) => { started = resolve; });
  let delivered; const completed = new Promise((resolve) => { delivered = resolve; });
  t.after(() => release());
  await page.route('**/api/pi/navigation?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('sessionId') !== 'pi:recovery:label-a') { await route.continue(); return; }
    const response = await route.fetch(); const body = await response.json();
    body.nativeStatistics.counts.rawRecords = 987654;
    started(); await gate;
    try { await route.fulfill({ response, body: JSON.stringify(body) }); } catch { /* Retired overview requests are intentionally aborted. */ }
    delivered();
  });
  await page.locator('[data-session-id="pi:recovery:label-a"]').click(); await pending;
  if (change === 'branch') {
    await page.locator('[data-session-id="pi:recovery:shell"]').click();
    await page.waitForFunction(() => document.querySelector('[data-pi-overview] [aria-current="true"] [data-pi-session]')?.dataset.piSession === 'pi:recovery:shell');
  } else {
    await page.locator('#projectSwitchControl').click();
    await page.locator('[data-source-choice="codex"]').click();
    if (await page.locator('#projectSourceAction').isVisible()) await page.locator('#projectSourceAction').click();
    await page.waitForFunction(() => document.querySelector('#projectSourceSwitch')?.dataset.source === 'codex');
  }
  release(); await completed;
  await page.request.get(server.origin + '/api/state');
  if (change === 'branch') {
    assert.equal(await page.locator('[data-pi-overview] [aria-current="true"] [data-pi-session]').getAttribute('data-pi-session'), 'pi:recovery:shell');
    assert.equal(await page.locator('[data-pi-native-count="rawRecords"]').textContent(), '17');
  } else assert.equal(await page.locator('[data-pi-overview]').count(), 0);
});
