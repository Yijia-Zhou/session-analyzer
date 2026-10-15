'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

async function fixture(t, width) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lineage-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  await fs.mkdir(repo); await fs.mkdir(path.join(home, 'sessions'));
  const start = (turn_id, parent_turn_id, root_turn_id) => ({ type: 'event_msg', payload: {
    type: 'task_started', turn_id, root_turn_id, turn_attribution: { turn_id, parent_turn_id, root_turn_id },
  } });
  const msg = (message) => ({ type: 'event_msg', payload: { type: 'user_message', message } });
  const files = {};
  for (const [session, rows] of Object.entries({
    parent: [start('root-turn', null, 'root-turn'), msg('ROOT_REQUEST')],
    child: [start('child-turn', 'root-turn', 'root-turn'), msg('CHILD_REQUEST')],
    protocol: [start('protocol-turn', 'root-turn', 'root-turn')],
    same: [start('same-root', null, 'same-root'), msg('SAME_ROOT'),
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'same-root' } },
      start('same-child', 'same-root', 'same-root'), msg('SAME_CHILD')],
    fallback: [start('fallback-turn', 'protocol-turn', 'root-turn'), msg('FALLBACK_REQUEST')],
  })) {
    files[session] = path.join(home, 'sessions', `rollout-${session}.jsonl`);
    await fs.writeFile(files[session], [{ type: 'session_meta', payload: { id: session, cwd: repo } }, ...rows]
      .map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ...row })).join('\n') + '\n');
  }
  const service = await createHistoryService({ repo, source: 'codex', codexHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  return { page, url, files, search: async (query) => (await service.execute('search', { query })).items[0] };
}

for (const width of [1440, 390]) for (const presentation of ['timeline', 'trajectory']) for (const locale of ['en', 'zh-CN']) {
  test(`turn lineage keyboard, evidence and reading return: ${width} ${presentation} ${locale}`, { timeout: 45000 }, async (t) => {
    const { page, url, search } = await fixture(t, width);
    const hit = await search('CHILD_REQUEST');
    await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
    await page.locator('#detail .turnLineage').waitFor({ state: 'attached' });
    if (locale !== 'en') await page.locator('#localeSelect').selectOption(locale, { force: true });
    if (presentation === 'trajectory') await page.locator('[data-main-presentation="trajectory"]').click();
    if (width < 760) await page.getByRole('button', { name: locale === 'en' ? 'Detail' : '详情', exact: true }).click();
    const button = page.locator('#detail [data-turn-lineage="parent"]');
    await button.waitFor();
    assert.match(await page.locator('#detail .turnLineage').innerText(), locale === 'en' ? /Direct parent/ : /直接父级/);
    const departure = hit.eventId;
    await button.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (document.querySelector('#timeline article.selected')?.dataset.eventId
      || document.querySelector('[data-trajectory-event-id].selected')?.dataset.trajectoryEventId)?.startsWith('parent:'));
    await page.locator('[data-reading-back]:visible').first().click();
    await page.waitForFunction((eventId) => Boolean(document.querySelector(`[data-event-id="${CSS.escape(eventId)}"].selected, [data-trajectory-event-id="${CSS.escape(eventId)}"].selected`)), departure);
    await page.waitForFunction(() => document.activeElement?.dataset.turnLineage === 'parent');
    assert.equal(await page.locator('body').getAttribute('data-main-presentation'), presentation);
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('ref'), hit.ref);
    await page.locator('#detail .turnLineage details summary').first().click();
    await page.locator('#detail .turnLineage [data-target-layer="raw"]').first().click();
    await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'raw');
    await page.locator('[data-reading-back]:visible').first().click();
    await button.waitFor();
    await page.waitForFunction(() => document.activeElement?.dataset.targetLayer === 'raw');
    assert.equal(await page.locator('#detail .turnLineage details').first().getAttribute('open'), '');
    const dir = path.join(__dirname, '../output/turn-lineage-browser'); await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${width}-${presentation}-${locale}.png`) });
  });
}

test('turn lineage same-session and Protocol targets; stale revisions and deleted sources fail closed', { timeout: 45000 }, async (t) => {
  const { page, url, files, search } = await fixture(t, 1440);
  for (const [query, prefix, layer] of [['SAME_CHILD', 'same:', 'main'], ['FALLBACK_REQUEST', 'protocol:', 'protocol']]) {
    const hit = await search(query);
    await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
    await page.waitForFunction((id) => document.querySelector('#timeline article.selected')?.dataset.eventId === id, hit.eventId);
    const button = page.locator('#detail [data-turn-lineage="parent"]'); await button.waitFor();
    await page.waitForFunction((prefix) => document.querySelector('#detail [data-turn-lineage="parent"]')?.dataset.lineageEvent.startsWith(prefix), prefix);
    const targetEvent = await button.getAttribute('data-lineage-event');
    await button.click();
    await page.waitForFunction(({ targetEvent, layer }) => document.querySelector('#timeline article.selected')?.dataset.eventId === targetEvent
      && document.querySelector('#layerSelect')?.value === layer, { targetEvent, layer }).catch(async (error) => {
        t.diagnostic(JSON.stringify({ query, targetEvent, state: await page.evaluate(() => ({ layer: document.querySelector('#layerSelect')?.value,
          selected: document.querySelector('#timeline article.selected')?.dataset.eventId, detail: document.querySelector('#detail')?.innerText })) })); throw error;
      });
    assert.ok(targetEvent.startsWith(prefix));
    await page.locator('#sessionHeader [data-reading-back]').click(); await button.waitFor();
  }
  const hit = await search('CHILD_REQUEST'); await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  await page.waitForFunction((id) => document.querySelector('#timeline article.selected')?.dataset.eventId === id, hit.eventId);
  const button = page.locator('#detail [data-turn-lineage="parent"]'); await button.waitFor();
  await page.waitForFunction(() => document.querySelector('#detail [data-turn-lineage="parent"]')?.dataset.lineageSession === 'parent');
  const revision = Number(await button.getAttribute('data-navigation-revision'));
  const params = new URLSearchParams({ relation: 'parent', source: 'codex', repoRoot: await button.getAttribute('data-navigation-project'), indexRevision: String(revision + 1) });
  const endpoint = `${url}/api/sessions/child/events/${encodeURIComponent(hit.eventId)}/turn-lineage`;
  assert.equal((await fetch(`${endpoint}?${params}`)).status, 409);
  params.set('indexRevision', String(revision));
  params.set('source', 'claude-code'); assert.equal((await fetch(`${endpoint}?${params}`)).status, 404);
  params.set('source', 'codex');
  await fs.unlink(files.parent);
  assert.notEqual((await fetch(`${endpoint}?${params}`)).status, 200);
  await button.click();
  await page.waitForFunction(() => document.body.textContent.includes('This reading target is no longer available'));
  assert.equal(await page.locator('#timeline article.selected').getAttribute('data-event-id'), hit.eventId);
});

test('newer presentation intent cancels a pending turn jump', { timeout: 30000 }, async (t) => {
  const { page, url, search } = await fixture(t, 1440);
  const hit = await search('CHILD_REQUEST');
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  const button = page.locator('#detail [data-turn-lineage="parent"]'); await button.waitFor();
  let release, arrived;
  const held = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { arrived = resolve; });
  await page.route('**/turn-lineage?**', async (route) => { arrived(); await held; await route.continue(); });
  await button.click(); await requested;
  await page.locator('[data-main-presentation="trajectory"]').click();
  const response = page.waitForResponse((r) => r.url().includes('/turn-lineage?'));
  release(); await response;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('[data-trajectory-event-id].selected').getAttribute('data-trajectory-event-id'), hit.eventId);
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
});
