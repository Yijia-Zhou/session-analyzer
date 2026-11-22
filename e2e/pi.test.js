'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { requestHistory } = require('../src/history-cli');
const { startHistoryServer } = require('../src/history-server');
const { createHistoryService } = require('../src/history-service');

// Synthetic native-v3 shapes. This checks the shared viewer, not pi's TUI.
for (const width of [1440, 390]) test(`pi branch default compact handoff, detail and Raw reading (${width})`, { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'sessions', '--synthetic-project--');
  await fs.mkdir(repo); await fs.mkdir(directory, { recursive: true });
  const msg = (id, parentId, role, content, extra = {}) => ({
    type: 'message', id, parentId, message: { role, content, ...extra },
  });
  const rows = [
    { type: 'session', version: 3, id: 'synthetic-browser-pi', cwd: repo },
    msg('root', null, 'user', 'Compare two synthetic implementations.'),
    msg('route-a', 'root', 'assistant', [{ type: 'text', text: 'ALPHA_BRANCH_ONLY: use implementation A.' }]),
    msg('route-b', 'root', 'user', 'BETA_BRANCH_ONLY: inspect implementation B.'),
    msg('call', 'route-b', 'assistant', [{ type: 'toolCall', id: 'lookup-1', name: 'read', arguments: { path: 'example.txt' } }]),
    msg('result', 'call', 'toolResult', [{ type: 'text', text: 'BETA_TOOL_OUTPUT: synthetic file contents.' }], { toolCallId: 'lookup-1', toolName: 'read', isError: false }),
    msg('answer', 'result', 'assistant', [{ type: 'text', text: 'BETA_FINAL: implementation B is ready.' }]),
  ].map((row, i) => ({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ...row }));
  const file = path.join(directory, 'synthetic.jsonl');
  const original = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, original);
  const service = await createHistoryService({ repo, source: 'pi', piHome: home });
  const running = await startHistoryServer({ port: 0 }, async () => service);
  t.after(() => running.close());
  const alpha = await requestHistory(running.endpoint, 'search', { query: 'ALPHA_BRANCH_ONLY' });
  const beta = await requestHistory(running.endpoint, 'search', { query: 'BETA_TOOL_OUTPUT' });
  assert.equal(alpha.items.length, 1); assert.equal(beta.items.length, 1);
  assert.notEqual(alpha.items[0].sessionId, beta.items[0].sessionId);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const open = async (search, expectedText) => {
    const [hit] = search.items;
    assert.equal(search.presentation, 'compact');
    assert.match(hit.ref, /^hr1\./u);
    const read = await requestHistory(running.endpoint, 'read', {
      refs: [hit.ref], contextRef: search.contextRef, parts: ['projection'],
    });
    assert.equal(read.presentation, 'compact');
    const [item] = read.items;
    assert.ok(item.parts.some((part) => part.part === 'projection' && part.text.includes(expectedText)));
    assert.match(item.evidenceRef, /^er2\./u);
    const handoff = await requestHistory(running.endpoint, 'open', { refs: [item.evidenceRef] });
    assert.equal(handoff.evidenceRef, item.evidenceRef);
    assert.equal(handoff.targetVerified, true);
    assert.deepEqual(handoff.target, { sessionId: hit.sessionId, eventId: hit.eventId, layer: 'main' });
    await page.goto(handoff.url);
    await page.waitForFunction(({ sessionId, eventId }) =>
      document.querySelector('#sessionList .sessionItem.active')?.dataset.sessionId === sessionId
        && document.querySelector('#timeline article.selected')?.dataset.eventId === eventId,
    { sessionId: hit.sessionId, eventId: hit.eventId });
    // Selection can precede asynchronous Detail rendering. Wait for this
    // linked record's body, not merely its selected loading placeholder.
    await page.waitForFunction(({ eventId, expectedText }) => {
      const selected = document.querySelector('#timeline article.selected');
      return selected?.dataset.eventId === eventId && selected.innerText.includes(expectedText);
    }, { eventId: hit.eventId, expectedText });
  };
  await open(alpha, 'ALPHA_BRANCH_ONLY');
  assert.match(await page.locator('#timeline').innerText(), /ALPHA_BRANCH_ONLY/);
  assert.doesNotMatch(await page.locator('#timeline').innerText(), /BETA_BRANCH_ONLY|BETA_FINAL/);
  await open(beta, 'BETA_TOOL_OUTPUT');
  assert.doesNotMatch(await page.locator('#timeline').innerText(), /ALPHA_BRANCH_ONLY/);
  if (width < 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await page.locator('#detail [data-detail-action="raw"]').click();
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('BETA_TOOL_OUTPUT'));
  assert.match(await page.locator('#detail .rawRefsView').innerText(), /lookup-1/);
  if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForFunction(() => document.body.dataset.mainPresentation === 'trajectory');
  assert.doesNotMatch(await page.locator('#timeline').innerText(), /ALPHA_BRANCH_ONLY/);
  assert.equal(await fs.readFile(file, 'utf8'), original, 'viewer preserves source bytes');
  assert.deepEqual(errors, []);
});
