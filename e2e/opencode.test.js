'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const { createServer } = require('../server');
const { createHistoryService } = require('../src/history-service');
const { createOpenCodeFixture, TIME } = require('../test/helpers/opencode-fixture');
const { withNavigationDiagnostics } = require('./browser-diagnostics');

// Fixed native 2.1.4 shapes: this suite never starts OpenCode or calls a model.
function assistant(output) {
  return JSON.stringify({ time: { created: TIME + 10, completed: TIME + 900 },
    agent: 'build', model: { id: 'synthetic-model', providerID: 'synthetic' },
    content: [{ type: 'tool', id: 'call_browser_shell', name: 'shell', providerExecuted: false,
      time: { created: TIME + 10, ran: TIME + 20, completed: TIME + 800 },
      state: { status: 'completed', input: { command: 'printf synthetic' },
        content: [{ type: 'text', text: output }], metadata: { status: 'exited', exit: 0 } } },
    { type: 'text', text: 'Synthetic browser answer.' }] });
}

let bundle;
async function browserBundle() {
  bundle ||= esbuild.build({ entryPoints: [path.join(__dirname, '../src/browser/entry.js')],
    bundle: true, write: false });
  return (await bundle).outputFiles[0].text;
}

for (const width of [1440, 390]) test(`OpenCode source choice, search, Detail, Raw and refresh (${width})`,
  { timeout: 60000 }, withNavigationDiagnostics(async (t, diagnostics) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-browser-'));
    const repo = path.join(home, 'project');
    const dbPath = path.join(home, 'data', 'opencode.db');
    const fixture = createOpenCodeFixture({ dbPath, repoRoot: repo });
    const update = (text) => fixture.db.prepare('UPDATE session_message SET data = ? WHERE id = ?')
      .run(assistant(text), 'msg_fixture_assistant');
    update('OPENCODE_OUTPUT_V1: captured synthetic output');
    let browser; let server; let oldService; let newService;
    t.after(async () => {
      await browser?.close();
      if (server?.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      await oldService?.close(); await newService?.close(); fixture.close();
      await fs.rm(home, { recursive: true, force: true });
    });

    // Hold a separate fixed revision to verify that refreshing the Web index
    // does not redirect a previously returned durable evidence reference.
    oldService = await createHistoryService({ source: 'opencode', opencodeHome: dbPath, repo });
    const oldHit = (await oldService.execute('search', { query: 'OPENCODE_OUTPUT_V1' })).items[0];
    assert.ok(oldHit?.ref);
    server = createServer(null, 0, { source: 'codex', codexHome: path.join(home, 'empty-codex'),
      opencodeHome: dbPath, sessionPrewarm: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
    await diagnostics.attach(page);
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => localStorage.setItem('sessionAnalyzer.locale', 'en'));
    const body = await browserBundle();
    await page.route('**/assets/app.js', (route) => route.fulfill({ contentType: 'application/javascript', body }));
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(url);
    await page.locator('[data-source-choice="opencode"]').click();
    await page.waitForFunction(() => document.querySelector('#projectSourceSwitch')?.dataset.source === 'opencode'
      || document.querySelector('#projectSourceAction')?.textContent === 'Confirm switch to OpenCode');
    if (await page.locator('#projectSourceAction').isVisible()) await page.locator('#projectSourceAction').click();
    await page.waitForFunction((root) => [...document.querySelectorAll('.projectItem[data-project-root]')]
      .some((item) => item.dataset.projectRoot === root), repo);
    assert.match(await page.locator('#projectSourceKind').innerText(), /OpenCode/);
    await page.locator('.projectItem[data-project-root]').filter({ hasText: repo }).click();
    await page.locator('#sessionList .sessionItem').first().click();

    const readToolRaw = async (token) => {
      if (width < 760 && await page.locator('button[data-mobile-view="events"]').isVisible()) {
        await page.locator('button[data-mobile-view="events"]').click();
      }
      await page.locator('#searchInput').fill(token);
      await page.locator('#searchInput').dispatchEvent('input');
      await page.waitForFunction(() => document.querySelectorAll('#timeline .event.searchHit').length === 1);
      await page.locator('#timeline .event.searchHit .eventKind').click();
      await page.waitForFunction((value) => document.querySelector('#timeline .event.searchHit .eventBody')?.textContent.includes(value), token);
      if (width < 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('call_browser_shell'));
      await page.locator('#detail [data-detail-action="raw"]').click();
      await page.waitForFunction((value) => document.querySelector('#detail .rawRefsView')?.textContent.includes(value), token);
      const raw = await page.locator('#detail .rawRefsView').innerText();
      assert.match(raw, /session_message:msg_fixture_assistant/);
      assert.match(raw, /call_browser_shell/);
      assert.doesNotMatch(raw, /opencode\.db:\d+/);
    };
    await readToolRaw('OPENCODE_OUTPUT_V1');

    // Same IDs, seq and timestamps; only message content changes in live WAL.
    update('OPENCODE_OUTPUT_V2: newer synthetic output');
    await page.reload();
    await page.locator('#sessionList .sessionItem').first().click();
    await readToolRaw('OPENCODE_OUTPUT_V1');
    assert.doesNotMatch(await page.locator('#detail .rawRefsView').innerText(), /OPENCODE_OUTPUT_V2/);

    // An incompatible replacement cannot erase the readable prior revision.
    // Its stale-data warning must survive a fresh browser bootstrap as well.
    fixture.db.exec('ALTER TABLE session_message ADD COLUMN unsupported_fixture TEXT');
    if (width < 760) await page.locator('button[data-mobile-view="sessions"]').click();
    await page.locator('#projectRefreshBtn').click();
    await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false'
      && document.querySelector('#projectRefreshStatus')?.classList.contains('error'));
    assert.match(await page.locator('#projectRefreshStatus').innerText(), /may be out of date/i);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#projectRefreshStatus')?.classList.contains('error'));
    assert.match(await page.locator('#projectRefreshStatus').innerText(), /may be out of date/i);
    await page.locator('#sessionList .sessionItem').first().click();
    await readToolRaw('OPENCODE_OUTPUT_V1');
    fixture.db.exec('ALTER TABLE session_message DROP COLUMN unsupported_fixture');

    if (width < 760) await page.locator('button[data-mobile-view="sessions"]').click();
    await page.locator('#projectRefreshBtn').click();
    await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false'
      && document.querySelector('#projectRefreshStatus')?.textContent === 'Project reindexed');
    await readToolRaw('OPENCODE_OUTPUT_V2');
    assert.doesNotMatch(await page.locator('#detail .rawRefsView').innerText(), /OPENCODE_OUTPUT_V1/);

    const priorRead = await oldService.execute('read', { refs: [oldHit.ref], parts: ['projection'] });
    assert.match(JSON.stringify(priorRead.items), /OPENCODE_OUTPUT_V1/);
    assert.doesNotMatch(JSON.stringify(priorRead.items), /OPENCODE_OUTPUT_V2/);
    newService = await createHistoryService({ source: 'opencode', opencodeHome: dbPath, repo });
    assert.equal((await newService.execute('search', { query: 'OPENCODE_OUTPUT_V2' })).items.length, 1);
    await assert.rejects(newService.execute('read', { refs: [oldHit.ref], parts: ['projection'] }), { code: 'STALE_REFERENCE' });

    // Whole-session deletion disappears only after a successful replacement;
    // an already-held service revision still owns its original evidence.
    fixture.db.exec('BEGIN');
    fixture.db.prepare('DELETE FROM session_message WHERE session_id = ?').run('ses_fixture');
    fixture.db.prepare('DELETE FROM session_v2 WHERE id = ?').run('ses_fixture');
    fixture.db.exec('COMMIT');
    if (width < 760) await page.locator('button[data-mobile-view="sessions"]').click();
    await page.locator('#projectRefreshBtn').click();
    await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false'
      && document.querySelector('#projectRefreshStatus')?.textContent === 'Project reindexed');
    assert.equal(await page.locator('#sessionList .sessionItem').count(), 0);
    assert.equal(await page.locator('#timeline .event').count(), 0);
    assert.doesNotMatch(await page.locator('#detail').innerText(), /OPENCODE_OUTPUT_V2/);
    const oldEvidence = await oldService.execute('read', { refs: [oldHit.ref], parts: ['projection', 'raw'] });
    assert.match(JSON.stringify(oldEvidence.items), /OPENCODE_OUTPUT_V1/);
    const oldRaw = await oldService.execute('read', { refs: oldEvidence.items[0].rawRefs, parts: ['raw'] });
    assert.match(JSON.stringify(oldRaw.items), /OPENCODE_OUTPUT_V1/);
    assert.doesNotMatch(JSON.stringify(oldRaw.items), /OPENCODE_OUTPUT_V2/);
    assert.deepEqual(errors, []);
  }));
