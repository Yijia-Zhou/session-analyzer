'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

for (const width of [1440, 390]) test(`native pi sidebar branch switching (${width})`, { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-branches-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'sessions', 'synthetic');
  await fs.mkdir(repo); await fs.mkdir(directory, { recursive: true });
  const rows = [
    { type: 'session', version: 3, id: 'native-group', cwd: repo },
    { type: 'message', id: 'root', parentId: null, message: { role: 'user', content: 'Shared question' } },
    { type: 'message', id: 'leaf-a', parentId: 'root', message: { role: 'assistant', content: [{ type: 'text', text: 'ONLY_ALPHA' }] } },
    { type: 'message', id: 'leaf-b', parentId: 'root', message: { role: 'assistant', content: [{ type: 'text', text: 'ONLY_BETA' }] } },
  ];
  await fs.writeFile(path.join(directory, 'branches.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  await fs.writeFile(path.join(directory, 'single.jsonl'), [
    { type: 'session', version: 3, id: 'single-native', cwd: repo, parentSession: 'branches.jsonl' },
    { type: 'message', id: 'single-leaf', parentId: null, message: { role: 'user', content: 'Single branch question' } },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  const service = await createHistoryService({ repo, source: 'pi', piHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const group = page.locator('[data-pi-native-session="native-group"]');
  await group.waitFor({ state: 'attached' });
  assert.equal(await group.locator('[data-session-id]').count(), 2);
  const single = page.locator('[data-pi-native-session="single-native"]');
  assert.equal(await single.locator('[data-session-id]').count(), 1);
  assert.equal(await single.locator('.sessionChildrenToggle').count(), 0);
  assert.match(await group.innerText(), /Shared history/);
  for (const [leaf, content, excluded] of [['leaf-a', 'ONLY_ALPHA', 'ONLY_BETA'], ['leaf-b', 'ONLY_BETA', 'ONLY_ALPHA']]) {
    if (width < 760) await page.locator('button[data-mobile-view="sessions"]').click();
    const button = group.locator('[data-session-id]').filter({ hasText: `Branch · leaf ${leaf}` });
    await button.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction((text) => document.querySelector('#timeline')?.textContent.includes(text), content);
    assert.doesNotMatch(await page.locator('#timeline').innerText(), new RegExp(excluded));
    assert.equal(await group.locator('.sessionItem.active').count(), 1);
  }
  assert.equal(await group.locator('.sessionChildrenToggle').count(), 0);
});
