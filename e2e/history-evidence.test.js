'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const { createHistoryService } = require('../src/history-service');

async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  await fs.mkdir(repo);
  await fs.mkdir(path.join(home, 'sessions'));
  const rows = [{ type: 'session_meta', payload: { id: 'history-browser-session', cwd: repo,
    ...(options.backgroundTerminalRefs ? { session_id: 'history-browser-session', originator: 'codex_cli_rs', cli_version: '0.160.0', source: 'cli', history_mode: 'legacy' } : {}),
    ...(options.parentSession ? { forked_from_id: 'other-browser-session' } : {}) } }];
  const message = (role, text) => rows.push({ type: 'response_item', payload: { type: 'message', role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
  if (options.backgroundTerminalRefs) {
    rows.push({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'origin-command', arguments: '{"cmd":"npm test"}' } });
    rows.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'origin-command', output: 'Wall time: 1.0000 seconds\nProcess running with session ID 1234\nOutput:\n' } });
  }
  for (let n = 0; n < (options.prefixCount ?? 480); n++) message(n % 2 ? 'assistant' : 'user', `Synthetic prefix ${n}`);
  message('user', 'NEARBY_REQUEST: investigate the long synthetic output.');
  if (options.contextGaps) {
    message('assistant', 'NEARBY_PLAN: checking the synthetic result.');
    for (let n = 0; n < (options.gapCommands ?? 1); n++) {
      const id = n ? `before-gap-${n}` : 'before-gap';
      rows.push({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: id, arguments: '{"cmd":"before-check"}' } });
      rows.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: 'BEFORE_GAP_OUTPUT' } });
    }
  }
  rows.push({ type: 'response_item', payload: { type: 'function_call',
    name: options.backgroundTerminalRefs ? 'write_stdin' : 'exec_command', call_id: 'late-output',
    arguments: options.backgroundTerminalRefs ? '{"session_id":1234}' : '{"cmd":"synthetic-check"}' } });
  const output = options.output || 'preface '.repeat(25000) + '\nDEEP_OUTPUT_HIT: synthetic failure\n' + 'tail '.repeat(4000);
  rows.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'late-output',
    output: options.backgroundTerminalRefs ? `Wall time: 1.0000 seconds\nProcess running with session ID 1234\nOutput:\n${output}` : output } });
  if (options.contextGaps) {
    rows.push({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'after-gap', arguments: '{"cmd":"after-check"}' } });
    rows.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'after-gap', output: 'AFTER_GAP_OUTPUT' } });
  }
  message('assistant', options.messageText || '**NEARBY_REPLY**: synthetic `investigation` complete.');
  if (options.contextGaps) message('user', 'NEXT_BOUNDARY: thanks for checking.');
  for (let n = 0; n < (options.suffixCount ?? 0); n++) message(n % 2 ? 'assistant' : 'user', `Synthetic following record ${n}`);
  rows.push({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } } } });
  await fs.writeFile(path.join(home, 'sessions', 'rollout-history-browser.jsonl'), rows.map((row, n) => JSON.stringify({ timestamp: new Date(1790000000000 + n * 1000).toISOString(), ...row })).join('\n'));
  await fs.writeFile(path.join(home, 'sessions', 'rollout-other-browser.jsonl'), [
    { type: 'session_meta', payload: { id: 'other-browser-session', cwd: repo } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'OTHER_SESSION_MESSAGE' } },
  ].map((row) => JSON.stringify({ timestamp: '2026-10-01T00:00:00Z', ...row })).join('\n'));
  const service = await createHistoryService({ repo, source: 'codex', codexHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/`)).status, 200);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: options.viewport || { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => t.diagnostic(error.stack));
  page.on('requestfailed', (request) => t.diagnostic(`${request.url()}: ${request.failure()?.errorText}`));
  t.after(async () => { if (t.error && !page.isClosed()) t.diagnostic((await page.locator('body').innerText()).slice(0, 10000)); });
  const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, '../src/browser/entry.js')], bundle: true, write: false });
  await page.route('**/assets/app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: bundle.outputFiles[0].text }));
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  const search = async (query, layer = 'main') => (await service.execute('search', { query, layer })).items[0];
  const hit = await search('DEEP_OUTPUT_HIT');
  assert.ok(hit?.ref);
  const context = options.withContext ? (await service.execute('context', { refs: [hit.ref] })).items[0] : null;
  return { page, url, service, requests, hit, search, context };
}

async function selected(page, eventId) {
  await page.locator(`#timeline article.selected[data-event-id="${eventId}"]`).waitFor();
}

async function readableSelectedCard(page, eventId) {
  await selected(page, eventId);
  await page.waitForFunction((id) => {
    const card = document.querySelector(`#timeline article[data-event-id="${CSS.escape(id)}"]`);
    const header = card?.querySelector('.eventHeader').getBoundingClientRect();
    const pane = document.querySelector('.timelinePane').getBoundingClientRect();
    const mobile = innerWidth <= 760;
    const top = mobile ? document.querySelector('.mobileViewTabs').getBoundingClientRect().bottom : pane.top;
    const bottom = mobile ? innerHeight : pane.bottom;
    return card?.getClientRects().length && header.top >= top && header.bottom < bottom
      && (!mobile || document.body.dataset.mobileView === 'events');
  }, eventId);
}

for (const width of [1440, 390]) {
  test(`same-layer event reference outside excerpts shows its exact card and restores the excerpt (${width}px)`, { timeout: 30000 }, async (t) => {
    const { page, url, hit, search, context } = await fixture(t, {
      backgroundTerminalRefs: true, prefixCount: 220, withContext: true,
      output: 'DEEP_OUTPUT_HIT: synthetic running poll.', viewport: { width, height: width <= 760 ? 844 : 1000 },
    });
    const origin = await search('npm test');
    assert.ok(origin?.eventId);
    assert.equal(context.events.some((event) => event.eventId === origin.eventId), false);
    await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
    await readableSelectedCard(page, hit.eventId);
    if (width <= 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
    const originRef = page.locator(`#detail [data-target-event-id="${origin.eventId}"]`);
    await originRef.click();
    await readableSelectedCard(page, origin.eventId);
    assert.equal(await page.locator('body').getAttribute('data-history-reading'), 'timeline');
    assert.equal(await page.locator(`#timeline article[data-event-id="${origin.eventId}"]`).count(), 1);
    assert.equal(await page.locator('#timeline article.historyContextRecord').count(), 0);
    assert.equal(await page.locator('#timeline article.temporaryReferenceReveal').count(), 1);
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction((id) => document.body.dataset.historyReading === 'isolated'
      && document.querySelector('#timeline article.selected')?.dataset.eventId === id, hit.eventId);
    await page.waitForFunction((id) => document.activeElement?.dataset.targetEventId === id, origin.eventId);
    assert.deepEqual(await page.locator('#timeline article').evaluateAll((nodes) => nodes.map((node) => node.dataset.eventId)), context.events.map((event) => event.eventId));
    assert.equal(await page.locator(`#timeline article[data-event-id="${hit.eventId}"]`).evaluate((node) => node.classList.contains('expanded')), true);
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('ref'), hit.ref);
    if (width <= 760) {
      assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'detail');
      assert.equal(await originRef.isVisible(), true);
      await page.getByRole('button', { name: 'Events', exact: true }).click();
    }
    await readableSelectedCard(page, hit.eventId);
  });

  test(`delayed outside-excerpt event reference yields to a newer selection after returning (${width}px)`, { timeout: 30000 }, async (t) => {
    const { page, url, hit, search, context } = await fixture(t, {
      backgroundTerminalRefs: true, prefixCount: 220, withContext: true,
      output: 'DEEP_OUTPUT_HIT: synthetic running poll.', viewport: { width, height: width <= 760 ? 844 : 1000 },
    });
    const origin = await search('npm test');
    const next = context.events.find((event) => !event.anchor);
    assert.ok(origin?.eventId && next?.eventId);
    await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
    await readableSelectedCard(page, hit.eventId);
    if (width <= 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
    let release;
    let reached;
    let finished;
    let response;
    const held = new Promise((resolve) => { release = resolve; });
    const arrived = new Promise((resolve) => { reached = resolve; });
    const completed = new Promise((resolve) => { finished = resolve; });
    t.after(() => release());
    const pattern = `**/events/${encodeURIComponent(origin.eventId)}?**`;
    await page.route(pattern, async (route) => {
      try {
        response = await route.fetch();
        reached();
        await held;
        await route.fulfill({ response }).catch(() => {});
      } finally { reached(); finished(); }
    });
    await page.locator(`#detail [data-target-event-id="${origin.eventId}"]`).click();
    await arrived;
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).id, origin.eventId);
    if (width <= 760) await page.getByRole('button', { name: 'Events', exact: true }).click();
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction((id) => document.body.dataset.historyReading === 'isolated'
      && document.querySelector('#timeline article.selected')?.dataset.eventId === id, hit.eventId);
    await page.waitForFunction((id) => document.activeElement?.dataset.targetEventId === id, origin.eventId);
    if (width <= 760) await page.getByRole('button', { name: 'Events', exact: true }).click();
    await page.locator(`#timeline article[data-event-id="${next.eventId}"] .eventKind`).click();
    await readableSelectedCard(page, next.eventId);
    release();
    await completed;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await readableSelectedCard(page, next.eventId);
    assert.equal(await page.locator(`#timeline article[data-event-id="${origin.eventId}"]`).count(), 0);
    assert.deepEqual(await page.locator('#timeline article.historyContextRecord').evaluateAll((nodes) => nodes.map((node) => node.dataset.eventId)), context.events.map((event) => event.eventId));
    assert.equal(await page.locator('#historyEvidence [role="alert"]').count(), 0);
  });
}

test('history reference cold landing is bounded, expanded, repeatable, and continues to the exact late event', async (t) => {
  const { page, url, requests, hit, context } = await fixture(t, { withContext: true });
  await page.goto(`${url}/#evidenceRef=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, hit.eventId);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  assert.match(await page.locator('.historyMatchPreview').innerText(), /DEEP_OUTPUT_HIT/);
  await page.locator('#timeline article.selected.expanded .eventBody').waitFor();
  assert.equal(await page.locator('#historyEvidence details[open]').count(), 0);
  assert.equal(await page.locator('[data-history-action="return"]').count(), 0);
  assert.equal(await page.locator('.timelineFooter').isVisible(), false);
  assert.equal(await page.locator('[data-history-action="continue"]').innerText(), 'Continue in session');
  assert.equal(await page.locator('.searchSupplementLocation').isVisible(), false);
  await page.locator('.historyMatch summary').click();
  const { startLine, endLine, hitLine } = hit.excerpt;
  assert.equal(await page.locator('.searchSupplementLocation').innerText(), startLine === endLine
    ? `Search text · Match on line ${hitLine}`
    : `Search text · Lines ${startLine}–${endLine} · Match on line ${hitLine}`);
  assert.equal(await page.locator('.searchSupplementLocation').evaluate((node) => {
    const copy = node.parentElement.cloneNode(true);
    const metadata = copy.querySelector('.searchSupplementLocation');
    return window.sessionSearchHighlighter.apply(copy, [node.textContent.match(/\d+/)[0]])
      .filter((mark) => metadata.contains(mark)).length;
  }), 0, 'position metadata cannot become a search hit');
  assert.match(await page.locator('.historyHitLine').innerText(), /DEEP_OUTPUT_HIT/);
  await page.locator('.historyMatch summary').click();
  const screenshotDir = path.join(__dirname, '../output/history-open-validation');
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'evidence-landing.png') });
  assert.deepEqual(await page.locator('#timeline article').evaluateAll((nodes) => nodes.map((node) => node.dataset.eventId)), context.events.map((event) => event.eventId));
  assert.equal(await page.locator('#timeline article.summary').count(), context.events.length - 1);
  assert.equal(await page.locator('#historyEvidence').evaluate((node) => node.previousElementSibling.id), 'timeline');
  assert.equal(requests.filter((p) => p.endsWith('/timeline')).length, 0);
  assert.equal(requests.filter((p) => p.endsWith('/navigation')).length, 0);
  assert.equal(await page.locator('#projectSwitchControl').isDisabled(), true);
  assert.equal(await page.locator('#projectRefreshBtn').isDisabled(), true);
  assert.equal(await page.locator('.historyEvidence').count(), 0, 'no permanent evidence panel above the record');
  assert.equal(requests.filter((p) => p === '/api/history/resolve').length, 1);
  await page.reload();
  await selected(page, hit.eventId);
  assert.equal(requests.filter((p) => p === '/api/history/resolve').length, 2);
  await page.locator('[data-history-action="continue"]').click();
  await page.locator('#historyEvidence.historyReadingDock [data-history-action="return"]').waitFor();
  await selected(page, hit.eventId);
  assert.equal(await page.locator('#timeline article.temporaryReferenceReveal').count(), 0);
  assert.ok(await page.locator('#timeline article').count() > 450);
  assert.equal(await page.locator('.timelineFooter').isVisible(), true);
  await page.locator('[data-history-action="return"]').click();
  await selected(page, hit.eventId);
  await page.waitForFunction((count) => document.querySelectorAll('#timeline article').length === count, context.events.length).catch(async (error) => {
    t.diagnostic(await page.locator('#historyEvidence').innerText());
    t.diagnostic(JSON.stringify(requests));
    throw error;
  });
  assert.equal(requests.filter((p) => p === '/api/history/resolve').length, 3);
});

test('nearby cards and raw references keep their exact identities; stale reference reports its code', async (t) => {
  const { page, url, hit, search } = await fixture(t);
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, hit.eventId);
  await page.locator('#timeline article.summary').filter({ hasText: 'NEARBY_REQUEST' }).locator('.eventKind').click();
  await page.waitForFunction(() => document.querySelector('#timeline article.selected')?.textContent.includes('NEARBY_REQUEST'));
  await page.locator('[data-history-action="return"]').click();
  await selected(page, hit.eventId);
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('ref'), hit.ref);
  await page.reload();
  await selected(page, hit.eventId);
  const protocol = await search('', 'protocol');
  assert.ok(protocol);
  await page.goto(`${url}/#ref=${encodeURIComponent(protocol.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, protocol.eventId);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'protocol');
  const raw = await search('DEEP_OUTPUT_HIT', 'raw');
  await page.goto(`${url}/#evidenceRef=${encodeURIComponent(raw.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, raw.eventId);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'raw');
  assert.match(await page.locator('[data-history-action="continue"]').innerText(), /View Main timeline/);
  await page.locator('[data-session-id="other-browser-session"]').click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('OTHER_SESSION_MESSAGE'));
  await page.locator('[data-history-action="continue"]').click();
  await page.waitForFunction(() => document.querySelector('#layerSelect').value === 'main'
    && document.querySelector('.sessionItem.active')?.dataset.sessionId === 'history-browser-session');
  await page.goto(`${url}/#evidenceRef=er2.invalid`, { waitUntil: 'domcontentloaded' });
  await page.locator('#historyEvidence [role="alert"]').waitFor();
  assert.match(await page.locator('#historyEvidence [role="alert"]').innerText(), /INVALID_REFERENCE/);
});

test('user cancellation retires a held reference response and retry remains exact', async (t) => {
  const { page, url, hit } = await fixture(t);
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  await page.route('**/api/history/resolve?**', async (route) => {
    reached();
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto(`${url}/#evidenceRef=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await arrived;
  await page.locator('[data-history-action="cancel"]').click();
  release();
  await page.unroute('**/api/history/resolve?**');
  assert.equal(await page.locator('#timeline article.selected').count(), 0);
  assert.match(await page.locator('#historyEvidence').innerText(), /cancelled/);
  await page.locator('[data-history-action="return"]').click();
  await selected(page, hit.eventId);
});

test('held prefix response cannot override a manual session selection', async (t) => {
  const { page, url, hit } = await fixture(t);
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, hit.eventId);
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  await page.route('**/api/sessions/history-browser-session/timeline?**', async (route) => {
    reached(); await held; await route.continue().catch(() => {});
  });
  await page.locator('[data-history-action="continue"]').click();
  await arrived;
  assert.equal(await page.locator('[data-history-action="continue"]').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('[data-history-action="continue"]').isDisabled(), true);
  await page.locator('[data-session-id="other-browser-session"]').click();
  release();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('OTHER_SESSION_MESSAGE'));
  assert.equal(await page.locator('#timeline article[data-event-id*="history-browser-session"]').count(), 0);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), 'other-browser-session');
  assert.equal(await page.locator('.busyButton[aria-busy="true"]').count(), 0);
});

test('Continue reopens incomplete context after cancellation and reaches a target beyond the first page', async (t) => {
  const { page, url, hit, requests } = await fixture(t, { prefixCount: 170 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  let reached;
  const arrived = new Promise((resolve) => { reached = resolve; });
  const pattern = '**/api/sessions/history-browser-session/events/*?**';
  await page.route(pattern, async (route) => {
    reached(); await gate; await route.continue().catch(() => {});
  });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await arrived;
  const aborted = page.waitForEvent('requestfailed', (request) => request.url().includes('/events/'));
  await page.locator('[data-history-action="cancel"]').click();
  release();
  await aborted;
  await page.unroute(pattern);
  assert.equal(await page.locator('#timeline article').count(), 0);
  await page.locator('[data-history-action="continue"]').click();
  await page.locator('.historyReadingDock').waitFor();
  await selected(page, hit.eventId);
  assert.equal(await page.locator('#historyEvidence [role="alert"]').count(), 0);
  assert.ok(await page.locator('#timeline article').count() > 170);
  assert.equal(requests.filter((p) => p === '/api/history/resolve').length, 2);
});

test('cancelling the reopen inside Continue never starts prefix loading', async (t) => {
  const { page, url, hit, requests } = await fixture(t);
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, hit.eventId);
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => document.body.dataset.mainPresentation === 'trajectory');
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  await page.route('**/api/history/resolve?**', async (route) => {
    reached(); await held; await route.continue().catch(() => {});
  });
  const prefixesBefore = requests.filter((pathname) => pathname.endsWith('/timeline')).length;
  await page.locator('[data-history-action="continue"]').click();
  await arrived;
  const failedRequest = page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === '/api/history/resolve');
  await page.locator('[data-history-action="cancel"]').click();
  release();
  await failedRequest;
  // Let the aborted fetch's catch/finally and awaiting Continue caller settle.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(requests.filter((pathname) => pathname.endsWith('/timeline')).length, prefixesBefore);
  assert.match(await page.locator('#historyEvidence').innerText(), /cancelled/);
  assert.equal(await page.locator('#historyEvidence [role="alert"]').count(), 0);
  assert.equal(await page.locator('[data-history-action="cancel"]').count(), 0);
});

test('reference temporarily uses Timeline and expands a saved hidden event; mobile landing remains readable', async (t) => {
  const { page, url, hit } = await fixture(t, { viewport: { width: 390, height: 844 } });
  const saved = JSON.stringify({ 'history-browser-session': { [hit.eventId]: 'hidden' } });
  await page.addInitScript((value) => localStorage.setItem('sessionAnalyzer.overrides', value), saved);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-session-id="history-browser-session"]').click();
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.evaluate((ref) => { location.hash = `ref=${encodeURIComponent(ref)}`; }, hit.ref);
  await selected(page, hit.eventId);
  assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'timeline');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'events');
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides')), saved);
  await page.locator('#timeline article.selected.expanded .eventBody').waitFor();
  assert.equal(await page.locator('#timeline article.selected').isVisible(), true);
  const landing = await page.locator('#historyEvidence').boundingBox();
  assert.ok(landing.height < 240, `mobile footer remains compact: ${landing.height}`);
  assert.match(await page.locator('.historyMatchPreview').innerText(), /DEEP_OUTPUT_HIT/);
  assert.equal(await page.locator('#analysisPanel').isVisible(), false);
  await page.locator('.historyMatch summary').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.historyHitLine');
    if (!node) return false;
    const hit = node.getBoundingClientRect();
    const excerpt = node.parentElement.getBoundingClientRect();
    return hit.top >= excerpt.top && hit.bottom <= excerpt.bottom;
  });
  await page.locator('.historyMatch summary').click();
  const screenshotDir = path.join(__dirname, '../output/history-open-validation');
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'evidence-mobile.png') });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => document.body.dataset.mainPresentation === 'trajectory');
  await page.locator(`#timeline [data-event-id="${hit.eventId}"].selected`).waitFor();
});

test('evidence presentation switch keeps excerpts until canonical loading succeeds; selected Timeline is a no-op', async (t) => {
  const { page, url, hit, requests, context } = await fixture(t, { prefixCount: 170, withContext: true });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('button[data-main-presentation="timeline"]').click();
  assert.equal(await page.locator('#timeline article').count(), context.events.length);
  assert.equal(requests.filter((p) => p.endsWith('/timeline')).length, 0);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  let reached;
  const arrived = new Promise((resolve) => { reached = resolve; });
  await page.route('**/api/sessions/history-browser-session/timeline?**', async (route) => {
    reached(); await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic timeline unavailable' }) }).catch(() => {});
  });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await arrived;
  assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'timeline');
  await selected(page, hit.eventId);
  assert.equal(await page.locator('#timeline article').count(), context.events.length);
  release();
  await page.locator('#historyEvidence [role="alert"]').waitFor();
  await selected(page, hit.eventId);
  await page.unroute('**/api/sessions/history-browser-session/timeline?**');
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => document.body.dataset.mainPresentation === 'trajectory');
  await page.locator('#timeline [data-event-id].selected').waitFor();
  assert.equal(await page.locator('#timeline [data-event-id].selected').getAttribute('data-event-id'), hit.eventId);
  assert.ok(requests.filter((p) => p.endsWith('/timeline')).length >= 3);
  await page.locator('#analysisPanel .metric').first().waitFor();
});

test('held presentation switch yields to a newer session selection', async (t) => {
  const { page, url, hit } = await fixture(t, { prefixCount: 170 });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  let reached;
  const arrived = new Promise((resolve) => { reached = resolve; });
  await page.route('**/api/sessions/history-browser-session/timeline?**', async (route) => {
    reached(); await gate; await route.continue().catch(() => {});
  });
  await page.locator('[data-main-presentation="trajectory"]').click();
  await arrived;
  const aborted = page.waitForEvent('requestfailed', (request) => request.url().includes('/history-browser-session/timeline?'));
  await page.locator('[data-session-id="other-browser-session"]').click();
  release();
  await aborted;
  await page.waitForFunction(() => document.querySelector('#timeline').textContent.includes('OTHER_SESSION_MESSAGE'));
  assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'timeline');
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), 'other-browser-session');
});

test('project scope and a new query retire excerpts even when drilling into the same session', async (t) => {
  const { page, url, hit, search } = await fixture(t, { prefixCount: 170 });
  const earlier = await search('Synthetic prefix 169');
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('#searchHudScope').click();
  await page.locator('#searchAssist').getByRole('button', { name: 'Entire project' }).click();
  await page.locator('#searchInput').fill('Synthetic prefix 169');
  await page.locator('#sessionList .projectResultCard').click();
  await selected(page, earlier.eventId);
  assert.equal(await page.locator('#timeline .historyContextRecord').count(), 0);
  assert.match(await page.locator('#timeline article.selected').innerText(), /Synthetic prefix 169/);
  await page.locator('[data-history-action="return"]').click();
  await selected(page, hit.eventId);
  await page.locator('#timeline article.historyContextRecord.selected').waitFor();
});

test('early evidence continuation restores manual pagination, summary and metric shortcuts', async (t) => {
  const { page, url, hit, requests } = await fixture(t, { prefixCount: 8, suffixCount: 400 });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  assert.equal(requests.filter((p) => p.endsWith('/analysis')).length, 0);
  await page.locator('[data-history-action="continue"]').click();
  await page.locator('.historyReadingDock').waitFor();
  await selected(page, hit.eventId);
  await page.locator('#loadMoreBtn:enabled').waitFor();
  const count = await page.locator('#timeline article').count();
  assert.equal(count, 150);
  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction((before) => document.querySelectorAll('#timeline article').length > before, count);
  await page.locator('#analysisPanel .metric').first().waitFor();
  assert.equal(await page.locator('#analysisPanel .metric').count(), 6);
  await page.locator('[data-metric-action="profile"][data-metric-value="conversation"]').click();
  await page.waitForFunction(() => document.querySelector('#profileSelect').value === 'conversation');
});

test('deferred summary failure is locally retryable and does not undo continuation', async (t) => {
  const { page, url, hit } = await fixture(t, { prefixCount: 8 });
  await page.route('**/api/sessions/history-browser-session/analysis?**', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic summary unavailable' }),
  }));
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('[data-history-action="continue"]').click();
  await page.locator('[data-analysis-retry]').waitFor();
  await page.locator('.historyReadingDock').waitFor();
  await selected(page, hit.eventId);
  assert.equal(await page.locator('#historyEvidence [role="alert"]').count(), 0);
  await page.unroute('**/api/sessions/history-browser-session/analysis?**');
  await page.locator('[data-analysis-retry]').click();
  await page.locator('#analysisPanel .metric').first().waitFor();
  assert.equal(await page.locator('[data-analysis-retry]').count(), 0);
});

test('direct session search from isolated evidence restores summary without needing another page', async (t) => {
  const { page, url, hit, requests } = await fixture(t, { prefixCount: 8 });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  assert.equal(requests.filter((p) => p.endsWith('/analysis')).length, 0);
  await page.locator('#searchInput').fill('NEARBY_REPLY');
  await page.locator('#timeline article.searchHit').waitFor();
  await page.locator('#analysisPanel .metric').first().waitFor();
  assert.equal(await page.locator('#analysisPanel .metric').count(), 6);
  assert.equal(await page.locator('#loadMoreBtn').isDisabled(), true);
  assert.equal(await page.locator('#timeline .historyContextRecord').count(), 0);
  assert.equal(requests.filter((p) => p.endsWith('/analysis')).length, 1);
  await page.locator('[data-metric-value="conversation"]').click();
  await page.waitForFunction(() => document.querySelector('#profileSelect').value === 'conversation');
});

test('deferred summary response cannot replace another session summary', async (t) => {
  const { page, url, hit } = await fixture(t, { prefixCount: 8 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  let reached;
  const arrived = new Promise((resolve) => { reached = resolve; });
  await page.route('**/api/sessions/history-browser-session/analysis?**', async (route) => {
    reached(); await gate; await route.continue().catch(() => {});
  });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('[data-history-action="continue"]').click();
  await arrived;
  await page.locator('.historyReadingDock').waitFor();
  await page.locator('[data-session-id="other-browser-session"]').click();
  await page.waitForFunction(() => document.querySelector('#timeline').textContent.includes('OTHER_SESSION_MESSAGE'));
  await page.locator('#analysisPanel .metric').first().waitFor();
  const summary = await page.locator('#analysisPanel').innerText();
  release();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#analysisPanel').innerText(), summary);
  assert.equal(await page.locator('[data-metric-value="conversation"] strong').innerText(), '1');
});

test('message landing prioritizes the body, discloses supporting text on demand, and localizes the reading controls', async (t) => {
  const { page, url, search, requests } = await fixture(t);
  const hit = await search('NEARBY_REPLY');
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, hit.eventId);
  await page.locator('#timeline article.selected.expanded .eventBody').waitFor();
  await page.waitForFunction(() => document.querySelector('#timeline article.selected .eventBody')?.textContent.includes('NEARBY_REPLY'));
  assert.equal(await page.locator('.historyMatchPreview').isVisible(), false, 'message body is not duplicated above the record');
  assert.equal(await page.locator('.historyExcerpt').isVisible(), false);
  assert.equal(await page.locator('#historyEvidence details[open]').count(), 0);
  assert.match(await page.locator('#timeline article.selected .eventBody').innerText(), /NEARBY_REPLY/);
  assert.equal(await page.locator('[data-history-action="return"]').count(), 0);
  const body = await page.locator('#timeline article.selected .eventBody').boundingBox();
  assert.ok(body.y < 650, `record body is in the first viewport: ${body.y}`);
  assert.equal(await page.locator('.historyNearby').count(), 0);
  assert.equal(await page.locator('#timeline article .historyLinkedRecord').count(), 1);
  // The locale control is intentionally hidden; exercise the existing locale
  // change handler just as the general browser locale regression does.
  await page.locator('#localeSelect').selectOption('zh-CN', { force: true });
  await page.waitForFunction(() => document.querySelector('.historyLinkedRecord')?.textContent === '链接指向的记录');
  await selected(page, hit.eventId);
  assert.equal(await page.locator('[data-history-action="continue"]').innerText(), '在会话中继续阅读');
  assert.equal(requests.filter((pathname) => pathname.endsWith('/timeline')).length, 0, 'language change keeps the isolated target without loading the prefix');
  await page.waitForFunction(() => document.querySelector('#timeline article.selected .eventBody')?.textContent.includes('NEARBY_REPLY'));
  assert.equal(await page.locator('.historyMatch').isVisible(), false, 'readable Markdown keeps the redundant excerpt hidden in either language');
  const screenshotDir = path.join(__dirname, '../output/history-open-validation');
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'evidence-message-ux.png') });
});

test('missing event offers an explicit session fallback without claiming evidence verification', async (t) => {
  const { page, url, hit } = await fixture(t);
  const parts = hit.ref.split('.');
  parts[6] = 'A'.repeat(22);
  await page.goto(`${url}/#ref=${encodeURIComponent(parts.join('.'))}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#historyEvidence [role="alert"]').waitFor();
  assert.match(await page.locator('#historyEvidence [role="alert"]').innerText(), /INVALID_REFERENCE/);
  assert.equal(await page.locator('#timeline article.selected').count(), 0);
  await page.locator('[data-history-action="session"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#timeline article').length > 0);
  assert.match(await page.locator('#historyEvidence').innerText(), /referenced event was not verified/);
  assert.match(await page.locator('#historyEvidence [role="alert"]').innerText(), /INVALID_REFERENCE/);
  assert.equal(await page.locator('#timeline article.selected').count(), 0);
});

test('excerpt visibility follows delayed detail, folded content, and readable tool output', async (t) => {
  const text = 'DEEP_OUTPUT_HIT: synthetic visible output';
  const { page, url, hit } = await fixture(t, { output: text });
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  t.after(() => release());
  const detailRoute = '**/events/*/detail?**';
  await page.route(detailRoute, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    reached();
    await held;
    // Inspector retains the ordinary readable result. Only Timeline coverage
    // counts; a folded section must not hide the supplemental hit.
    await route.fulfill({ json: { ...payload, inspectorSections: [...(payload.inspectorSections || []), { type: 'terminal', text, stream: 'stdout' }], timelineSections: [
      { type: 'raw_json', title: 'Synthetic folded result', expanded: false, value: { output: text } },
    ] } });
  });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, hit.eventId);
  await arrived;
  assert.equal(await page.locator('.historyMatch').isVisible(), false, 'loading is not yet evidence that body text is missing');
  release();
  await page.locator('#timeline article.selected .rawJsonDetails').waitFor();
  await page.locator('.historyMatch').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.historyMatch summary').innerText(), 'View match not shown in the record');
  assert.match(await page.locator('#detail').innerText(), /DEEP_OUTPUT_HIT/);
  await page.locator('#timeline article.selected .rawJsonDetails summary').click();
  await page.locator('.historyMatch').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.historyMatchPreview').isVisible(), false);
  await page.locator('#timeline article.selected .rawJsonDetails summary').click();
  await page.locator('.historyMatch').waitFor({ state: 'visible' });
  await page.unroute(detailRoute);
  await page.reload();
  await selected(page, hit.eventId);
  await page.waitForFunction(() => document.querySelector('#timeline article.selected .eventBody')?.textContent.includes('DEEP_OUTPUT_HIT'));
  await page.locator('.historyMatch').waitFor({ state: 'hidden' });
});

test('failed detail keeps the missing hit readable and leaving the target hides its supplement', async (t) => {
  const { page, url, hit } = await fixture(t);
  await page.route('**/events/*/detail?**', (route) => route.fulfill({ status: 503,
    json: { error: 'Synthetic unavailable detail', code: 'DETAIL_UNAVAILABLE' } }));
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`, { waitUntil: 'domcontentloaded' });
  await selected(page, hit.eventId);
  await page.locator('.historyMatch').waitFor({ state: 'visible' });
  await page.locator('.historyMatch summary').click();
  assert.match(await page.locator('.historyExcerpt').innerText(), /DEEP_OUTPUT_HIT/);
  await page.locator('[data-session-id="other-browser-session"]').click();
  await page.locator('.historyMatch').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-history-action="return"]').isVisible(), true);
});

async function manualSearch(page, url, query) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-session-id="history-browser-session"]').click();
  await page.locator('#searchInput').fill(query);
  await page.waitForFunction(() => document.querySelector('#timeline .searchHit'));
}

async function expandSearchCard(page, eventId) {
  const card = page.locator(`#timeline article[data-event-id="${eventId}"]`);
  await card.waitFor();
  if (!(await card.getAttribute('class')).includes('expanded')) await card.locator('.eventToggle').click();
  return card;
}

test('manual search keeps cropped hits inside their cards and navigation opens the supplement without adding targets', async (t) => {
  const { page, url, hit } = await fixture(t);
  await manualSearch(page, url, 'DEEP_OUTPUT_HIT');
  const card = await expandSearchCard(page, hit.eventId);
  const supplement = card.locator('.searchSupplement');
  await supplement.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#historyEvidence .searchSupplement').count(), 0);
  assert.equal(await page.locator('.timelinePane > .searchSupplement').count(), 0);
  assert.equal(await supplement.locator('details').getAttribute('open'), null);
  assert.equal(await supplement.locator('.searchSupplementLocation').count(), 0, 'ordinary snippets do not invent line numbers');
  assert.match(await supplement.locator('pre').textContent(), /DEEP_OUTPUT_HIT/);
  const before = await page.locator('.searchInlineCount').innerText();
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await supplement.locator('details[open]').waitFor();
  await page.waitForFunction(() => {
    const mark = document.querySelector('#timeline .searchSupplement mark.activeSearchMark');
    if (!mark) return false;
    const hit = mark.getBoundingClientRect();
    const pane = document.querySelector('.timelinePane').getBoundingClientRect();
    const excerpt = mark.closest('pre').getBoundingClientRect();
    return hit.top >= Math.max(0, pane.top, excerpt.top)
      && hit.bottom <= Math.min(innerHeight, pane.bottom, excerpt.bottom);
  });
  assert.equal(await page.locator('.searchInlineCount').innerText(), before);
  await page.locator('#searchInput').fill('OTHER_SESSION_MESSAGE');
  await page.waitForFunction(() => !document.querySelector('#timeline .searchSupplement:not([hidden])'));
  await page.locator('#searchInput').fill('');
  await page.waitForFunction(() => !document.querySelector('#timeline .searchSupplement'));
});

test('manual search hides redundant snippets for readable tool output and keeps link labels navigable', async (t) => {
  const { page, url, hit, search } = await fixture(t, { output: 'DEEP_OUTPUT_HIT: short readable output', messageText: 'NEARBY_REPLY: [Human readable link](https://example.test/hidden-address).' });
  await manualSearch(page, url, 'DEEP_OUTPUT_HIT');
  const toolCard = await expandSearchCard(page, hit.eventId);
  await page.waitForFunction((id) => document.querySelector(`#timeline article[data-event-id="${CSS.escape(id)}"] .eventBody`)?.textContent.includes('short readable output'), hit.eventId);
  assert.equal(await toolCard.locator('.searchSupplement').isVisible(), false);
  const link = await search('Human readable link');
  await page.locator('#searchInput').fill('Human readable link');
  await page.waitForFunction((id) => document.querySelector(`#timeline article[data-event-id="${CSS.escape(id)}"]`)?.classList.contains('searchHit'), link.eventId);
  const card = await expandSearchCard(page, link.eventId);
  await card.locator('.eventBody a').waitFor();
  assert.equal(await card.locator('.searchSupplement').isVisible(), false);
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await selected(page, link.eventId);
  assert.equal(await card.evaluate((node) => node.classList.contains('activeSearchMark')), false, 'event-level landing uses ordinary selection, not a whole-card text highlight');
  await page.locator('#searchInput').fill('https://example.test/hidden-address');
  await card.locator('.searchSupplement').waitFor({ state: 'visible' });
  assert.match(await card.locator('.searchSupplement pre').textContent(), /hidden-address/);
});

test('Trajectory keeps search supplements in the selected event Detail and clears stale query text', async (t) => {
  const { page, url, hit } = await fixture(t);
  await manualSearch(page, url, 'DEEP_OUTPUT_HIT');
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  const event = page.locator(`#timeline [data-trajectory-event-id="${hit.eventId}"]`);
  await event.click();
  const supplement = page.locator('#detail .inspectorDetailBody .searchSupplement');
  await supplement.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#timeline .searchSupplement').count(), 0);
  await supplement.locator('summary').click();
  assert.match(await supplement.locator('pre').innerText(), /DEEP_OUTPUT_HIT/);
  await page.locator('#searchInput').fill('NEARBY_REPLY');
  await supplement.waitFor({ state: 'hidden' });
});

test('manual search retires a delayed detail on query change and exposes failed detail locally on mobile', async (t) => {
  // This case owns a delayed detail, not deep-prefix pagination. Keep unrelated
  // message hydration bounded so it cannot move the mobile toggle during input.
  const { page, url, hit } = await fixture(t, { viewport: { width: 390, height: 844 }, prefixCount: 8 });
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  t.after(() => release());
  await page.route('**/events/*/detail?**', async (route) => {
    if (!decodeURIComponent(route.request().url()).includes(hit.eventId)) return route.continue();
    reached();
    await held;
    await route.fulfill({ status: 503, json: { error: 'Synthetic unavailable detail' } }).catch(() => {});
  });
  await manualSearch(page, url, 'DEEP_OUTPUT_HIT');
  await expandSearchCard(page, hit.eventId);
  await arrived;
  assert.equal(await page.locator('.searchSupplement:not([hidden])').count(), 0);
  await page.locator('#searchInput').fill('NEARBY_REPLY');
  release();
  await page.waitForFunction(() => document.querySelector('#timeline .searchHit')?.textContent.includes('NEARBY_REPLY'));
  assert.equal(await page.locator('.searchSupplement:not([hidden])').count(), 0);
  await page.locator('#searchInput').fill('DEEP_OUTPUT_HIT');
  const supplement = page.locator(`#timeline article[data-event-id="${hit.eventId}"] .searchSupplement`);
  await supplement.waitFor({ state: 'visible' });
  await supplement.locator('summary').click();
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'events');
  assert.match(await supplement.locator('pre').innerText(), /DEEP_OUTPUT_HIT/);
  const bounds = await supplement.boundingBox();
  assert.ok(bounds.width < 390 && bounds.x >= 0);
  await fs.mkdir(path.join(__dirname, '../output/history-open-validation'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '../output/history-open-validation/manual-search-mobile.png') });
});

test('project search drilldown places the missing hit beside the exact event and retires it on return', async (t) => {
  const { page, url, hit } = await fixture(t);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#searchHudScope').click();
  await page.locator('#searchAssist').getByRole('button', { name: 'Entire project' }).click();
  await page.locator('#searchInput').fill('DEEP_OUTPUT_HIT');
  await page.locator('#sessionList .projectResultCard').click();
  await selected(page, hit.eventId);
  const card = await expandSearchCard(page, hit.eventId);
  const supplement = card.locator('.searchSupplement');
  await supplement.waitFor({ state: 'visible' });
  await supplement.locator('summary').click();
  assert.match(await supplement.locator('pre').innerText(), /DEEP_OUTPUT_HIT/);
  await page.locator('[data-search-back-to-project]').click();
  await page.waitForFunction(() => document.body.dataset.searchScope === 'project');
  assert.equal(await page.locator('.searchSupplement:not([hidden])').count(), 0);
});

test('Trajectory navigation retains an excerpt when the detail has no readable sections', async (t) => {
  const { page, url, hit } = await fixture(t);
  await page.route('**/events/*/detail?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), timelineSections: [], inspectorSections: [] } });
  });
  await manualSearch(page, url, 'DEEP_OUTPUT_HIT');
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  const supplement = page.locator('#detail .inspectorDetailBody .searchSupplement');
  await supplement.waitFor({ state: 'visible' });
  assert.equal(await supplement.getAttribute('data-supplement-event'), hit.eventId);
  assert.match(await supplement.locator('pre').textContent(), /DEEP_OUTPUT_HIT/);
});

test('context cards preserve exact gaps, local folds and selection while prefix loading leaves their DOM untouched', async (t) => {
  const { page, url, hit, context, requests } = await fixture(t, { contextGaps: true, withContext: true });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  assert.equal(context.gaps.length, 2);
  const gaps = await page.locator('.historyContextGap').evaluateAll((nodes) => nodes
    .filter((node) => node.textContent.includes('omitted'))
    .map((node) => ({ before: node.previousElementSibling.dataset.eventId,
      after: node.nextElementSibling.dataset.eventId, text: node.textContent })));
  assert.deepEqual(gaps.map(({ before, after }) => [before, after]), context.gaps.map((gap) => [gap.beforeEventId, gap.afterEventId]));
  gaps.forEach((gap, index) => assert.match(gap.text, new RegExp(`${context.gaps[index].count} records omitted`)));
  const near = context.events.find((event) => event.excerpt.text.includes('NEARBY_REPLY'));
  const card = page.locator(`#timeline article[data-event-id="${near.eventId}"]`);
  const stored = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides'));
  await card.locator('.eventKind').click();
  await selected(page, near.eventId);
  await card.locator('.eventBody .mdBlock').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides')), stored);
  assert.equal(await page.locator('.historyLinkedRecord').evaluate((node) => node.closest('article').dataset.eventId), hit.eventId);
  await page.locator('.timelinePane').evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.mouse.wheel(0, 1000);
  assert.equal(requests.filter((name) => name.endsWith('/timeline')).length, 0);
  let release;
  let reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  t.after(() => release());
  await page.route('**/timeline?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('offset') === '150') { reached(); await gate; }
    await route.continue().catch(() => {});
  });
  await page.evaluate(() => { window.contextCards = [...document.querySelectorAll('#timeline article')]; });
  await page.locator('[data-history-action="continue"]').click();
  await arrived;
  assert.equal(await page.evaluate(() => window.contextCards.every((node) => node.isConnected)), true);
  release();
  await page.waitForFunction(() => document.body.dataset.historyReading === 'timeline');
  await selected(page, near.eventId);
  assert.equal(await card.evaluate((node) => node.classList.contains('expanded')), true);
  const ids = await page.locator('#timeline article').evaluateAll((nodes) => nodes.map((node) => node.dataset.eventId));
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(context.events.every((event) => ids.includes(event.eventId)));
  assert.equal(await page.locator('.historyContextGap').count(), 0);
});

test('returning to the reference during Continue cancels its previous selection owner', async (t) => {
  const { page, url, hit, context } = await fixture(t, { withContext: true });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  const nearby = context.events.find((event) => !event.anchor);
  await page.locator(`#timeline article[data-event-id="${nearby.eventId}"] .eventKind`).click();
  await selected(page, nearby.eventId);
  let release;
  let reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  t.after(() => release());
  await page.route('**/timeline?**', async (route) => { reached(); await gate; await route.continue().catch(() => {}); });
  await page.locator('[data-history-action="continue"]').click();
  await arrived;
  await page.locator('[data-history-action="return"]').evaluate((button) => button.click());
  release();
  await selected(page, hit.eventId);
  assert.equal(await page.locator('body').getAttribute('data-history-reading'), 'isolated');
  assert.equal(await page.locator('#timeline article').count(), context.events.length);
});

test('related-session reading returns to the same excerpt group and expanded nearby record without loading its prefix', async (t) => {
  const { page, url, hit, context, requests } = await fixture(t, { parentSession: true, withContext: true });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  const nearby = context.events.find((event) => !event.anchor);
  await page.locator(`#timeline article[data-event-id="${nearby.eventId}"] .eventKind`).click();
  await selected(page, nearby.eventId);
  await page.locator('#sessionHeader [data-reading-session="other-browser-session"]').click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('OTHER_SESSION_MESSAGE'));
  const before = requests.filter((name) => name === '/api/sessions/history-browser-session/timeline').length;
  await page.locator('[data-reading-back]').first().click();
  await selected(page, nearby.eventId);
  assert.equal(await page.locator('#timeline article').count(), context.events.length);
  assert.equal(await page.locator(`#timeline article[data-event-id="${nearby.eventId}"]`).evaluate((node) => node.classList.contains('expanded')), true);
  assert.equal(requests.filter((name) => name === '/api/sessions/history-browser-session/timeline').length, before);
});

test('continuing the excerpt group preserves a closed Inspector or the selected Raw view', async (t) => {
  for (const view of ['close', 'raw']) {
    const { page, url, hit } = await fixture(t);
    await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
    await selected(page, hit.eventId);
    await page.locator(`#detail [data-detail-action="${view}"]`).click();
    const expected = view === 'close' ? 'profileRules' : 'rawRefs';
    await page.waitForFunction((type) => document.body.dataset.detailView === type, expected);
    await page.locator('[data-history-action="continue"]').click();
    await page.waitForFunction(() => document.body.dataset.historyReading === 'timeline');
    assert.equal(await page.locator('body').getAttribute('data-detail-view'), expected);
    if (view === 'close') assert.equal(await page.locator('#timeline article.selected').count(), 0);
    else await selected(page, hit.eventId);
  }
});

test('initial reference positioning waits for the readable body height rather than the short loading preview', async (t) => {
  const { page, url, search } = await fixture(t, {
    viewport: { width: 1280, height: 900 },
    messageText: 'TARGET_BODY_HEIGHT\n\n' + Array.from({ length: 18 }, (_, i) => `Paragraph ${i}: synthetic readable content.`).join('\n\n'),
  });
  const hit = await search('TARGET_BODY_HEIGHT');
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('#timeline article.selected .mdBlock').waitFor();
  await page.waitForFunction(() => {
    const header = document.querySelector('#timeline article.selected .eventHeader').getBoundingClientRect();
    const pane = document.querySelector('.timelinePane').getBoundingClientRect();
    return header.top >= pane.top && header.top < pane.top + 80;
  });
});

test('tapping a nearby summary on mobile expands it in the timeline and keeps the original reference', async (t) => {
  const { page, url, hit } = await fixture(t, { viewport: { width: 390, height: 844 }, prefixCount: 8 });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  const nearby = page.locator('#timeline article.summary').filter({ hasText: 'NEARBY_REPLY' });
  const id = await nearby.getAttribute('data-event-id');
  await nearby.locator('.historyContextPreview').click();
  await selected(page, id);
  await page.locator(`#timeline article[data-event-id="${id}"] .mdBlock`).waitFor();
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'events');
  assert.equal(await page.locator('.historyLinkedRecord').evaluate((node) => node.closest('article').dataset.eventId), hit.eventId);
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('ref'), hit.ref);
});

test('return to the reference stays reachable after continuing into a long timeline', async (t) => {
  const { page, url, hit, context } = await fixture(t, { prefixCount: 8, suffixCount: 180, withContext: true });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('[data-history-action="continue"]').click();
  await page.waitForFunction(() => document.querySelector('#historyEvidence')?.classList.contains('historyReadingDock'));
  const action = await page.locator('[data-history-action="return"]').boundingBox();
  const pane = await page.locator('.timelinePane').boundingBox();
  assert.ok(action.y >= pane.y && action.y + action.height <= pane.y + pane.height);
  await page.locator('[data-history-action="return"]').click();
  await page.locator('#timeline article.historyContextRecord.selected').waitFor();
  await selected(page, hit.eventId);
  assert.equal(await page.locator('#timeline article').count(), context.events.length);
  assert.equal(await page.locator('#historyEvidence').evaluate((node) => node.classList.contains('historyReadingDock')), false);
});

test('failed reference resolution during reading return keeps the saved group retryable', async (t) => {
  const { page, url, hit, context } = await fixture(t, { parentSession: true, withContext: true });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  const nearby = context.events.find((event) => !event.anchor);
  await page.locator(`#timeline article[data-event-id="${nearby.eventId}"] .eventKind`).click();
  await selected(page, nearby.eventId);
  await page.locator('#sessionHeader [data-reading-session="other-browser-session"]').click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('OTHER_SESSION_MESSAGE'));
  let failed = false;
  await page.route('**/api/history/resolve?**', async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic resolution unavailable' }) });
    } else await route.continue();
  });
  await page.locator('[data-reading-back]').first().click();
  await page.locator('#historyEvidence [role="alert"]').waitFor();
  await page.locator('[data-reading-back]').first().click();
  await selected(page, nearby.eventId);
  assert.equal(await page.locator('#timeline article').count(), context.events.length);
  assert.equal(await page.locator(`#timeline article[data-event-id="${nearby.eventId}"]`).evaluate((node) => node.classList.contains('expanded')), true);
});

test('continuation and return keep the linked record readable across inserted expanded tool cards', async (t) => {
  const { page, url, hit, context } = await fixture(t, {
    prefixCount: 8, contextGaps: true, gapCommands: 12, withContext: true,
    output: 'DEEP_OUTPUT_HIT: short readable output.', viewport: { width: 1536, height: 900 },
  });
  const overrides = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [
    `history-browser-session:logical:call:before-gap${n ? `-${n}` : ''}`, 'expanded',
  ]));
  await page.addInitScript((values) => localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify({
    'history-browser-session': values,
  })), overrides);
  const assertReadable = async () => {
    await selected(page, hit.eventId);
    await page.waitForFunction(() => {
      const card = document.querySelector('#timeline article.selected');
      const header = card.querySelector('.eventHeader').getBoundingClientRect();
      const body = card.querySelector('.eventBody').getBoundingClientRect();
      const pane = document.querySelector('.timelinePane').getBoundingClientRect();
      const mobile = innerWidth <= 760;
      const top = mobile ? document.querySelector('.mobileViewTabs').getBoundingClientRect().bottom : pane.top;
      const bottom = mobile ? innerHeight : pane.bottom;
      return header.top >= top && header.bottom < bottom && body.top < bottom - 80;
    }).catch(async (error) => {
      t.diagnostic(JSON.stringify(await page.evaluate(() => ({
        width: innerWidth, reading: document.body.dataset.historyReading, scroll: scrollY,
        header: document.querySelector('#timeline article.selected .eventHeader').getBoundingClientRect().toJSON(),
        body: document.querySelector('#timeline article.selected .eventBody').getBoundingClientRect().toJSON(),
        pane: document.querySelector('.timelinePane').getBoundingClientRect().toJSON(),
        tabs: document.querySelector('.mobileViewTabs').getBoundingClientRect().toJSON(),
      }))));
      throw error;
    });
  };
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
    await assertReadable();
    await page.locator('[data-history-action="continue"]').click();
    await page.locator('.historyReadingDock').waitFor();
    assert.ok(await page.locator('#timeline article').count() > context.events.length);
    await assertReadable();
    // Returning must restore visible evidence, not merely keep the same selected ID.
    await page.locator('.timelinePane').evaluate((pane) => { pane.scrollTop = 0; window.scrollTo(0, 0); });
    await page.locator('[data-history-action="return"]').click();
    await page.locator('#timeline article.historyContextRecord.selected').waitFor();
    await assertReadable();
    assert.equal(await page.locator('#timeline article').count(), context.events.length);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sessionAnalyzer.overrides'))['history-browser-session']), overrides);
  }
});

test('returning within excerpts waits for target detail and yields to a newer nearby selection', async (t) => {
  const { page, url, hit } = await fixture(t, { prefixCount: 8 });
  let release;
  let reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  t.after(() => release());
  await page.route('**/events/*/detail?**', async (route) => {
    if (decodeURIComponent(route.request().url()).includes(hit.eventId)) { reached(); await gate; }
    await route.continue().catch(() => {});
  });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await arrived;
  const nearbyId = await page.locator('#timeline article.summary').filter({ hasText: 'NEARBY_REPLY' }).getAttribute('data-event-id');
  const nearby = page.locator(`#timeline article[data-event-id="${nearbyId}"]`);
  await nearby.locator('.eventKind').click();
  await selected(page, nearbyId);
  await page.locator('[data-history-action="return"]').click();
  await selected(page, hit.eventId);
  await page.locator('[data-history-action="cancel"]').waitFor();
  assert.equal(await page.locator('[data-history-action="return"]').getAttribute('aria-busy'), 'true');
  await nearby.locator('.eventKind').click();
  await selected(page, nearbyId);
  release();
  await page.locator(`#timeline article[data-event-id="${hit.eventId}"] .eventBody .searchSupplement`).waitFor({ state: 'visible' });
  await selected(page, nearbyId);
  assert.equal(await page.locator('[data-history-action="cancel"]').count(), 0);
  assert.equal(await page.locator('.busyButton[aria-busy="true"]').count(), 0);
  await page.locator('[data-history-action="return"]').click();
  await selected(page, hit.eventId);
  await page.waitForFunction(() => {
    const header = document.querySelector('#timeline article.selected .eventHeader').getBoundingClientRect();
    const pane = document.querySelector('.timelinePane').getBoundingClientRect();
    return header.top >= pane.top && header.bottom < pane.bottom;
  });
});

test('return feedback stays in the button, ignores repeats and honors reduced motion until resolution completes', async (t) => {
  const { page, url, hit, requests } = await fixture(t, { prefixCount: 8 });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('[data-history-action="continue"]').click();
  await page.locator('.historyReadingDock [data-history-action="return"]').waitFor();
  const button = page.locator('[data-history-action="return"]');
  const before = { text: await button.innerText(), width: (await button.boundingBox()).width,
    requests: requests.filter((name) => name === '/api/history/resolve').length };
  let release;
  let reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  t.after(() => release());
  await page.route('**/api/history/resolve?**', async (route) => { reached(); await gate; await route.continue().catch(() => {}); });
  await button.focus();
  await button.press('Enter');
  await arrived;
  assert.equal(await button.getAttribute('aria-busy'), 'true');
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.innerText(), before.text);
  assert.ok(Math.abs((await button.boundingBox()).width - before.width) < 1);
  assert.equal(await button.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.locator('.historyReadingDock').isVisible(), true);
  const indicator = button.locator('.busyButtonIndicator');
  assert.equal(await indicator.getAttribute('aria-hidden'), 'true');
  assert.equal(await indicator.evaluate((node) => getComputedStyle(node).animationName), 'busyButtonSpin');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await indicator.evaluate((node) => getComputedStyle(node).animationName), 'none');
  await button.evaluate((node) => {
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    node.click();
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    node.click();
  });
  assert.equal(requests.filter((name) => name === '/api/history/resolve').length, before.requests + 1);
  assert.equal(await button.getAttribute('aria-busy'), 'true');
  await page.locator('[data-history-action="cancel"]').waitFor();
  release();
  await page.locator('#timeline article.historyContextRecord.selected').waitFor();
  await page.locator('.busyButton[aria-busy="true"]').waitFor({ state: 'detached' });
  await selected(page, hit.eventId);
});

test('cancelled return feedback cannot clear a newer action and failed resolution remains retryable', async (t) => {
  const { page, url, hit } = await fixture(t, { prefixCount: 8 });
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await selected(page, hit.eventId);
  await page.locator('[data-history-action="continue"]').click();
  await page.locator('.historyReadingDock').waitFor();
  const releases = [];
  const gates = [0, 1].map(() => new Promise((resolve) => releases.push(resolve)));
  t.after(() => releases.forEach((release) => release()));
  let count = 0;
  await page.route('**/api/history/resolve?**', async (route) => {
    const index = count++;
    if (index < gates.length) await gates[index];
    if (index === 1) await route.fulfill({ status: 503, json: { error: 'Synthetic resolution failure' } }).catch(() => {});
    else await route.continue().catch(() => {});
  });
  const button = page.locator('[data-history-action="return"]');
  await button.click();
  await page.waitForFunction(() => document.querySelector('[data-history-action="return"]')?.getAttribute('aria-busy') === 'true');
  await page.locator('[data-history-action="cancel"]').click();
  assert.equal(await page.locator('.busyButton[aria-busy="true"]').count(), 0);
  await button.click();
  await page.waitForFunction(() => document.querySelector('[data-history-action="return"]')?.getAttribute('aria-busy') === 'true');
  releases[0]();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  assert.equal(await button.getAttribute('aria-busy'), 'true');
  releases[1]();
  await page.locator('#historyEvidence [role="alert"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('.busyButton[aria-busy="true"]'));
  assert.equal(await button.isEnabled(), true);
  await button.click();
  await page.locator('#timeline article.historyContextRecord.selected').waitFor();
  await page.waitForFunction(() => !document.querySelector('.busyButton[aria-busy="true"]'));
  await selected(page, hit.eventId);
  assert.equal(count, 3);
});
