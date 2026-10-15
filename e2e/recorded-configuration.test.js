'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

const longModel = 'synthetic-model-' + 'long-model-name-'.repeat(24);
const recordedModel = 'gpt-6.1-sol';
const sampleCopy = {
  en: {
    query: 'Review the event reading experience',
    request: 'Review the event reading experience.\n\nKeep the request, action and result easy to follow. Configuration should add useful context without taking attention away from the work.\n\n- Check the mobile layout and keyboard navigation.\n- Show the recorded model and effort, with evidence available on demand.',
    progress: 'I will check the reading flow, then verify that opening evidence and returning preserves the selected event.',
    result: 'The reading checks passed. Event content remains readable on mobile, and returning from evidence restores the original selection and focus.',
    unknown: 'Inspect the earlier session settings without filling in values that were not recorded.',
    long: 'Check that an unusually long model identifier remains readable on a narrow screen.',
  },
  'zh-CN': {
    query: '检查事件详情的阅读体验',
    request: '检查事件详情的阅读体验。\n\n让请求、操作和结果容易顺着读下去。配置可以补充上下文，但不要盖过工作内容。\n\n- 检查移动端布局和键盘导航。\n- 展示已记录的模型与推理强度，需要时再展开依据。',
    progress: '我会先检查阅读流程，再确认打开依据并返回后，选中的事件和按钮焦点都能恢复。',
    result: '阅读检查已通过。移动端正文保持可读，查看依据后返回也能恢复原来的事件选择和焦点。',
    unknown: '检查早期会话的配置，未记录的值保持未知。',
    long: '检查超长模型标识在窄屏上是否仍然可读。',
  },
};
const event = (type, fields = {}) => ({ type: 'event_msg', payload: { type, ...fields } });
const context = (turn_id, fields = {}) => ({ type: 'turn_context', payload: { turn_id, model: longModel, effort: 'low', ...fields } });
const message = (message) => event('user_message', { message });
const response = (payload) => ({ type: 'response_item', payload });

async function fixture(t, width, locale) {
  const copy = sampleCopy[locale];
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'configuration-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  await fs.mkdir(repo); await fs.mkdir(path.join(home, 'sessions'));
  for (const [session, rows] of Object.entries({
    recorded: [event('thread_settings_applied', { thread_id: 'recorded', thread_settings: { model: recordedModel, reasoning_effort: 'medium' } }),
      event('task_started', { turn_id: 'recorded-turn', root_turn_id: 'recorded-turn' }), context('recorded-turn', { model: recordedModel }),
      { ...response({ type: 'configuration_update', reasoning: { effort: 'high' } }), metadata: { harness_authored_configuration: true } },
      context('recorded-turn', { model: recordedModel }), message(copy.request),
      event('agent_message', { message: copy.progress }),
      response({ type: 'function_call', name: 'exec_command', call_id: 'reading-checks', arguments: JSON.stringify({ cmd: 'node --test test/reading-return.test.js' }) }),
      response({ type: 'function_call_output', call_id: 'reading-checks', output: 'Wall time: 0.8 seconds\nProcess exited with code 0\nOutput:\n✔ Mobile event content remains readable\n✔ Evidence return restores selection and focus\n2 tests passed' }),
      event('agent_message', { message: copy.result })],
    mixed: [event('task_started', { turn_id: 'mixed-turn' }), context('mixed-turn', { model: 'first-recorded-model' }),
      response({ type: 'function_call', name: 'exec_command', call_id: 'mixed-command', arguments: JSON.stringify({ cmd: 'node --test test/configuration-boundaries.test.js' }) }),
      context('mixed-turn', { model: 'second-recorded-model', effort: 'high' }),
      response({ type: 'function_call_output', call_id: 'mixed-command', output: 'Wall time: 1.0000 seconds\nProcess exited with code 0\nOutput:\nConfiguration boundary checks passed' })],
    unknown: [event('task_started', { turn_id: 'unknown-turn' }), context('unknown-turn', { model: undefined, effort: null,
      collaboration_mode: { settings: { model: 'collaboration-model', reasoning_effort: 42 } } }), message(copy.unknown)],
    long: [event('task_started', { turn_id: 'long-turn' }), context('long-turn'), message(copy.long)],
  })) {
    await fs.writeFile(path.join(home, 'sessions', `rollout-${session}.jsonl`),
      [{ type: 'session_meta', payload: { id: session, cwd: repo, cli_version: '0.162.1' } }, ...rows]
        .map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ...row })).join('\n') + '\n');
  }
  const service = await createHistoryService({ repo, source: 'codex', codexHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  return { page, url: `http://127.0.0.1:${server.address().port}`,
    search: async (query) => (await service.execute('search', { query })).items[0] };
}

async function openDetail({ page, url, search }, query, width, presentation, locale) {
  const hit = await search(query);
  assert.ok(hit, `synthetic search hit for ${query}`);
  await page.goto(`${url}/#ref=${encodeURIComponent(hit.ref)}`);
  // Hash navigation can leave the previous session's detail attached while resolving.
  const waitForTarget = (title = null) => page.waitForFunction(({ sessionId, eventId, title }) => {
    const session = document.querySelector('#sessionList .sessionItem.active');
    const selected = document.querySelector('#timeline article.selected');
    const configuration = document.querySelector('#detail .recordedConfiguration');
    return session?.dataset.sessionId === sessionId
      && selected?.dataset.eventId === eventId
      && Boolean(configuration)
      && (title === null || configuration.querySelector('.configurationTitle')?.textContent === title);
  }, { sessionId: hit.sessionId, eventId: hit.eventId, title });
  await waitForTarget();
  if (locale !== 'en') {
    await page.locator('#localeSelect').selectOption(locale, { force: true });
    // Locale changes asynchronously reopen the evidence before subsequent input is safe.
    await waitForTarget('已记录配置');
  }
  if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
  if (presentation === 'trajectory') await page.locator('button[data-main-presentation="trajectory"]').click();
  if (width < 760) await page.getByRole('button', { name: locale === 'en' ? 'Detail' : '详情', exact: true }).click();
  await page.locator('#detail .recordedConfiguration > summary').waitFor();
  return hit;
}

async function assertNoOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'viewport has no horizontal overflow');
  assert.equal(await page.locator('#detail .recordedConfiguration').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, 'configuration wraps within inspector');
}

for (const width of [1440, 390]) for (const presentation of ['timeline', 'trajectory']) for (const locale of ['en', 'zh-CN']) {
  test(`recorded configuration compact keyboard/evidence return: ${width} ${presentation} ${locale}`, { timeout: 45000 }, async (t) => {
    const app = await fixture(t, width, locale);
    const { page } = app;
    const hit = await openDetail(app, sampleCopy[locale].query, width, presentation, locale);
    const configuration = page.locator('#detail .recordedConfiguration');
    const summary = configuration.locator(':scope > summary');
    assert.equal(await configuration.getAttribute('open'), null);
    const collapsed = await configuration.innerText();
    assert.match(collapsed, locale === 'en' ? /Recorded configuration/ : /已记录配置/);
    assert.ok(collapsed.includes(recordedModel));
    assert.match(collapsed, locale === 'en' ? /Context effort: low/ : /上下文推理强度: low/);
    assert.match(collapsed, locale === 'en' ? /Effort update instruction: high/ : /推理强度更新指令: high/);
    assert.doesNotMatch(collapsed, /Thread defaults|线程默认设置|\.jsonl|per-request|逐请求|collaboration/i);
    assert.equal(await configuration.locator('.configurationBody').isVisible(), false);
    await assertNoOverflow(page);
    const capture = (width === 1440 && locale === 'en') || (width === 390 && locale === 'zh-CN');
    const dir = path.join(__dirname, '../output/recorded-configuration-browser');
    if (capture) {
      await fs.mkdir(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${width}-${presentation}-${locale}-collapsed.png`) });
    }
    await summary.focus(); await page.keyboard.press('Enter');
    await configuration.locator('.configurationBody').waitFor();
    assert.match(await configuration.innerText(), locale === 'en' ? /Thread defaults/ : /线程默认设置/);
    assert.equal(await configuration.locator('[data-configuration-kind="turn_context"] .configurationValues code').first().innerText(), recordedModel);
    await assertNoOverflow(page);
    const evidence = configuration.locator('[data-configuration-kind="effort_update"] [data-target-layer="raw"]').first();
    const rawId = await evidence.getAttribute('data-target-event-id');
    await evidence.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'raw');
    await page.waitForFunction((id) => document.querySelector('#timeline article.selected')?.dataset.eventId === id, rawId);
    assert.equal(await page.locator('#detail .recordedConfiguration').count(), 0, 'Raw keeps its original evidence surface');
    await page.locator('[data-reading-back]:visible').first().click();
    await page.waitForFunction((eventId) => Boolean(document.querySelector(`[data-event-id="${CSS.escape(eventId)}"].selected, [data-trajectory-event-id="${CSS.escape(eventId)}"].selected`)), hit.eventId);
    await page.waitForFunction((id) => document.activeElement?.dataset.targetEventId === id, rawId);
    assert.equal(await configuration.getAttribute('open'), '');
    assert.equal(await page.locator('body').getAttribute('data-main-presentation'), presentation);
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('ref'), hit.ref);
    assert.equal(await evidence.evaluate((node) => node === document.activeElement), true);
    await assertNoOverflow(page);
    if (capture) await page.screenshot({ path: path.join(dir, `${width}-${presentation}-${locale}-expanded.png`) });
    if (capture) {
      await summary.click();
      if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
      await page.locator('[data-history-action="continue"]').click();
      await page.waitForFunction(() => document.body.dataset.historyReading === 'timeline');
      await page.locator(`button[data-main-presentation="${presentation}"]`).click();
      await page.waitForFunction(value => document.body.dataset.mainPresentation === value, presentation);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(dir, `${width}-${presentation}-${locale}-events.png`) });
    }
  });
}

for (const locale of ['en', 'zh-CN']) {
  test(`recorded configuration mixed observations and unknown fields: ${locale}`, { timeout: 45000 }, async (t) => {
    const app = await fixture(t, 390, locale);
    const { page } = app;
    await openDetail(app, 'Configuration boundary checks passed', 390, 'trajectory', locale);
    const configuration = page.locator('#detail .recordedConfiguration');
    assert.match(await configuration.innerText(), locale === 'en' ? /Multiple observations/ : /涉及多段观测/);
    assert.doesNotMatch(await configuration.innerText(), /first-recorded-model|second-recorded-model/);
    await configuration.locator(':scope > summary').click();
    assert.match(await configuration.innerText(), /first-recorded-model/);
    assert.match(await configuration.innerText(), /second-recorded-model/);
    await assertNoOverflow(page);
    await openDetail(app, sampleCopy[locale].unknown, 390, 'trajectory', locale);
    assert.match(await configuration.innerText(), locale === 'en' ? /Not recorded/ : /未记录/);
    assert.match(await configuration.innerText(), locale === 'en' ? /Explicit null/ : /显式空值/);
    assert.doesNotMatch(await configuration.innerText(), /collaboration-model|medium/);
    await configuration.locator(':scope > summary').click();
    assert.match(await configuration.innerText(), locale === 'en' ? /Invalid value/ : /无效值/);
    assert.match(await configuration.innerText(), /collaboration-model/);
    await assertNoOverflow(page);
    await openDetail(app, sampleCopy[locale].long, 390, 'trajectory', locale);
    assert.match(await configuration.innerText(), /synthetic-model-/);
    await configuration.locator(':scope > summary').click();
    assert.equal(await configuration.locator('.configurationValues code').first().innerText(), longModel);
    await assertNoOverflow(page);
  });
}
