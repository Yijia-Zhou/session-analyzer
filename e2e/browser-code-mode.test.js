'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');

const {
  repoRoot,
  materializeIndexedSession,
  openApp,
  switchHiddenLocale,
  writeJsonl,
  fillSearch,
  addSearchFilter,
  waitForSearchMarks,
  searchNavigationSnapshot,
  waitForDetailView,
  makeCodeModeCodexHome,
  makeContextCodeModeCodexHome,
  makeCodeModeSearchPreviewCodexHome,
} = require('./browser-helpers');

async function captureTerminalPresentation(page, name) {
  if (!process.env.TERMINAL_SCREENSHOTS) return;
  const dir = path.join(__dirname, '../output/playwright', process.env.TERMINAL_SCREENSHOTS);
  await fsp.mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function makeCodeModeDirectWriteStdinCodexHome(t, options = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-write-stdin-'));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionId = 'c8c8c8c8-1234-4234-8234-c8c8c8c8c8c8';
  const dir = path.join(codexHome, 'sessions', '2026', '09', '11');
  const file = path.join(dir, `rollout-2026-09-11T12-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const fixture = await fsp.readFile(path.join(__dirname, '../test/fixtures/code-mode/direct-write-stdin.jsonl'), 'utf8');
  const rows = [
    { timestamp: '2026-09-11T12:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: repoRoot } },
    ...fixture.trim().split(/\r?\n/).map((line) => JSON.parse(line)),
  ];
  if (options.pollResponse) rows[2].payload.output[1].text = JSON.stringify(options.pollResponse);
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot, sessionId };
}

async function makeRawCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-raw-'));
  const rawRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cececece-cece-cece-cece-cececececece';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '15');
  const file = path.join(dir, `rollout-2026-07-15T10-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(rawRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-15T02:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: rawRepoRoot } },
    {
      timestamp: '2026-07-15T02:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'exec-browser-raw',
        input: [
          'const args = { plan: [] };',
          'const plan = await tools.update_plan(args);',
          'const goal = await tools.get_goal(args);',
          'const input = await tools.request_user_input(args);',
          'text(plan);',
        ].join('\n'),
      },
    },
    { timestamp: '2026-07-15T02:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-raw', output: 'Script completed\nOutput:\n{}' } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: rawRepoRoot };
}

async function makeSingleLineRawCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-raw-single-line-'));
  const rawRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cfcfcfcf-cfcf-cfcf-cfcf-cfcfcfcfcfcf';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '15');
  const file = path.join(dir, 'rollout-2026-07-15T10-10-00-' + sessionId + '.jsonl');
  const source = 'const result = await tools.shell_command(args); // ' + 'single logical source preview '.repeat(20);
  await fsp.mkdir(rawRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-15T02:10:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: rawRepoRoot } },
    {
      timestamp: '2026-07-15T02:10:01.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'exec-browser-raw-single-line',
        input: source,
      },
    },
    { timestamp: '2026-07-15T02:10:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-raw-single-line', output: 'Script completed\nOutput:\n{}' } },
  ];
  await fsp.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: rawRepoRoot };
}

async function makeAdaptiveCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-adaptive-'));
  const adaptiveRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'dededede-dede-dede-dede-dededededede';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '16');
  const file = path.join(dir, `rollout-2026-07-16T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(adaptiveRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const singleSource = [
    "const plan = await tools.update_plan({ explanation: 'single fixture', plan: [",
    "  { step: 'Inspect single', status: 'in_progress' },",
    "  { step: 'Finish single', status: 'pending' },",
    '] });',
    'text(plan);',
  ].join('\n');
  const multiSource = [
    "const plan = await tools.update_plan({ plan: [{ step: 'Inspect multi', status: 'in_progress' }] });",
    "const command = await tools.shell_command({ command: 'Write-Output multi' });",
    'text(plan);',
    'text(command);',
  ].join('\n');
  const requestOnlySource = "const plan = await tools.update_plan({ plan: [{ step: 'Request only', status: 'pending' }] }); text(plan);";
  const rows = [
    { timestamp: '2026-07-16T01:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: adaptiveRepoRoot } },
    { timestamp: '2026-07-16T01:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect adaptive Code Mode presentation.' }] } },
    { timestamp: '2026-07-16T01:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-single', turn_id: 'turn-single', input: singleSource } },
    { timestamp: '2026-07-16T01:00:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-single', turn_id: 'turn-single', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: '{}' }] } },
    { timestamp: '2026-07-16T01:00:04.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-multi', turn_id: 'turn-multi', input: multiSource } },
    { timestamp: '2026-07-16T01:00:05.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-multi', turn_id: 'turn-multi', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: '{}' }, { type: 'input_text', text: 'Exit code: 0\nWall time: 1 second\nOutput:\nmulti' }] } },
    { timestamp: '2026-07-16T01:00:06.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-request-only', turn_id: 'turn-request-only', input: requestOnlySource } },
    { timestamp: '2026-07-16T01:00:07.000Z', type: 'response_item', payload: { type: 'function_call', name: 'fixture_other_tool', call_id: 'ordinary-browser-tool', turn_id: 'turn-ordinary', arguments: '{}' } },
    { timestamp: '2026-07-16T01:00:08.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'ordinary-browser-tool', turn_id: 'turn-ordinary', output: 'ordinary fixture output' } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: adaptiveRepoRoot };
}

async function makeWebCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-web-'));
  const webRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'efefefef-efef-efef-efef-efefefefefef';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '16');
  const file = path.join(dir, `rollout-2026-07-16T10-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(webRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const source = "const result = await tools.web__run({ search_query: [{ q: 'site:example.test browser markdown', domains: ['example.test'] }], response_length: 'long' }); text(result);";
  const result = [
    '## Example browser result',
    '',
    '- [Safe source](https://example.test/docs)',
    '- **Rendered browser emphasis**',
    '- [Unsafe source](javascript:alert(1))',
    '',
    '<script>alert("unsafe")</script>',
    '',
    'citeturn0search0',
  ].join('\n');
  const rows = [
    { timestamp: '2026-07-16T02:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: webRepoRoot } },
    { timestamp: '2026-07-16T02:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect Web Code Mode presentation.' }] } },
    { timestamp: '2026-07-16T02:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-web', turn_id: 'turn-web', input: source } },
    { timestamp: '2026-07-16T02:00:02.500Z', type: 'event_msg', payload: { type: 'web_search_end', call_id: 'internal-browser-web', turn_id: 'turn-web', query: 'site:example.test browser markdown', action: { type: 'search', queries: ['site:example.test browser markdown'] }, status: 'completed' } },
    { timestamp: '2026-07-16T02:00:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-web', turn_id: 'turn-web', output: [{ type: 'input_text', text: 'Script completed\nWall time 1.2 seconds\nOutput:\n' }, { type: 'input_text', text: result }] } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: webRepoRoot };
}

test('command run long tokens stay inside event and projection boxes with scrollable output', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent('<body data-mobile-view="events"><main class="timelinePane" style="width:600px"><div id="timeline" class="timeline"></div></main></body>');
  for (const file of ['public/vendor/highlightjs/github.min.css', 'public/styles.css']) {
    await page.addStyleTag({ path: path.join(__dirname, '..', file) });
  }
  for (const file of [
    'public/vendor/highlightjs/highlight.min.js',
    'src/shared/command-highlighting.js', 'src/shared/i18n.js',
    'src/shared/code-mode-presentation-contract.js', 'src/shared/detail-purpose.js',
    'src/browser/renderers.js',
  ]) await page.addScriptTag({ path: path.join(__dirname, '..', file) });

  for (const scenario of ['long-command', 'long-stdout', 'nested-projection']) {
    await t.test(scenario, async () => {
      await page.evaluate((scenario) => {
        const token = 'A'.repeat(4096);
        const sections = [
          { type: 'code', role: 'command', language: 'bash', code: scenario === 'long-stdout' ? 'echo hello' : `echo ${token}` },
          { type: 'terminal', stream: 'stdout', text: token },
        ];
        const content = scenario === 'nested-projection'
          ? [{ type: 'code_mode_tool_projection', toolName: 'exec_command', requestSections: sections }]
          : sections;
        document.querySelector('#timeline').innerHTML = `<article class="event expanded"><div class="eventBody">${window.sessionRenderers.renderSections(content)}</div></article>`;
      }, scenario);
      const geometry = await page.evaluate(() => {
        const pane = document.querySelector('.timelinePane');
        const card = document.querySelector('.event');
        const bounds = (element) => {
          const { left, right } = element.getBoundingClientRect();
          return { left, right };
        };
        const segments = [...card.querySelectorAll('.commandRunSegment')].map((segment) => ({
          container: bounds(segment.closest('.codeModeToolProjection') || card),
          segment: bounds(segment),
          pre: bounds(segment.querySelector('pre')),
        }));
        const output = card.querySelector('.commandRunOutput.stdout pre');
        output.scrollLeft = 100;
        return {
          paneClientWidth: pane.clientWidth, paneScrollWidth: pane.scrollWidth,
          segments, outputClientWidth: output.clientWidth,
          outputScrollWidth: output.scrollWidth, outputScrollLeft: output.scrollLeft,
          outputOverflowX: getComputedStyle(output).overflowX,
          projectionCount: card.querySelectorAll('.codeModeToolProjection').length,
        };
      });
      assert.equal(geometry.segments.length, 2);
      assert.equal(geometry.projectionCount, scenario === 'nested-projection' ? 1 : 0);
      for (const { container, segment, pre } of geometry.segments) {
        for (const box of [segment, pre]) {
          assert.ok(box.left >= container.left - 1 && box.right <= container.right + 1, JSON.stringify({ scenario, container, box }));
        }
      }
      assert.ok(geometry.paneScrollWidth <= geometry.paneClientWidth + 1, JSON.stringify(geometry));
      // Long output must remain accessible through internal scrolling, not clipping.
      assert.ok(geometry.outputScrollWidth > geometry.outputClientWidth);
      assert.ok(['auto', 'scroll'].includes(geometry.outputOverflowX));
      assert.ok(geometry.outputScrollLeft > 0);
      assert.equal(await page.locator('.commandRunOutput.stdout pre code').textContent(), 'A'.repeat(4096));
    });
  }
});

test('background terminal continuation suffix and origin navigation preserve separate events', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'terminal-origin-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const rows = (await fsp.readFile(path.join(__dirname, '../test/fixtures/background-terminal/continuation.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  rows[0].payload.cwd = repoRoot;
  const id = rows[0].payload.id;
  const dir = path.join(home, 'sessions', '2026', '09', '11');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `rollout-${id}.jsonl`), rows.map(JSON.stringify).join('\n') + '\n');
  const index = await buildIndex({ repoRoot, codexHome: home });
  const session = await materializeIndexedSession(index, id);
  const originId = session.logicalEvents.find((event) => event.id.endsWith(':e1')).id;
  const waitId = session.logicalEvents.find((event) => event.id.endsWith(':w1')).id;
  const { page } = await openApp(t, index, { locale: 'zh-CN' });
  const wait = page.locator(`#timeline .event[data-event-id="${waitId}"]`);
  assert.equal(await wait.locator('.eventKind').textContent(), '后台终端轮询请求 · npm test');
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 3);
  await page.locator('#searchInput').fill('npm test');
  await page.locator('#searchInput').dispatchEvent('input');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.searchHit').length === 1);
  assert.equal(await page.locator('#timeline .event.searchHit').getAttribute('data-event-id'), originId);
  assert.equal((await wait.getAttribute('class')).includes('searchHit'), false);
  await page.locator('#searchInput').fill('');
  await page.locator('#searchInput').dispatchEvent('input');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.searchHit').length === 0);
  await wait.locator('.eventKind').click();
  const originLink = page.locator(`#detail [data-target-event-id="${originId}"]`);
  await originLink.waitFor();
  assert.equal(await originLink.textContent(), 'npm test');
  if (!(await wait.locator('.eventBody').isVisible())) await wait.locator('.eventHeader > .eventToggle').click();
  await wait.locator('.eventBody').waitFor();
  assert.equal((await wait.textContent()).match(/后台终端轮询请求/g)?.length, 1);
  assert.equal((await wait.textContent()).includes('请求类型'), false);
  assert.ok((await wait.textContent()).includes('Still working'));
  assert.equal(await wait.locator('.kvTable').count(), 1);
  assert.equal((await wait.locator('.eventBody').textContent()).match(/1234/g)?.length, 1);
  assert.equal((await wait.textContent()).includes('Wall time:'), false);
  await captureTerminalPresentation(page, 'native-poll');
  await originLink.click();
  await page.waitForFunction((id) => document.querySelector('#timeline .event.selected')?.dataset.eventId === id, originId);
  await page.locator('#detail .terminalRequestDirectory > summary').click();
  await page.locator(`#detail [data-target-event-id="${waitId}"]`).click();
  await page.waitForFunction((id) => document.querySelector('#timeline .event.selected')?.dataset.eventId === id, waitId);
  const nextId = session.logicalEvents.find((event) => event.id.endsWith(':w2')).id;
  await page.locator(`#detail .eventRefsBlock`).filter({ hasText: '下一个终端请求' }).locator(`[data-target-event-id="${nextId}"]`).click();
  await page.waitForFunction((id) => document.querySelector('#timeline .event.selected')?.dataset.eventId === id, nextId);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.activeElement?.dataset.targetEventId === id, nextId);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.activeElement?.dataset.targetEventId === id, waitId);
  await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  const group = page.locator('.trajectoryToolGroup');
  if (!(await group.evaluate((node) => node.open))) await group.locator('summary').click();
  assert.ok((await page.locator('#timeline').textContent()).includes('后台终端轮询请求 · npm test'));
  assert.equal((await page.locator('#timeline').textContent()).match(/后台终端轮询请求/g)?.length, 1);
  await captureTerminalPresentation(page, 'native-trajectory');
});

test('bounded terminal directory explains its limit and links beyond it in both presentations', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'terminal-directory-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const template = (await fsp.readFile(path.join(__dirname, '../test/fixtures/background-terminal/continuation.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const rows = template.slice(0, 3);
  rows[0].payload.cwd = repoRoot;
  for (let i = 0; i < 129; i += 1) {
    for (const row of template.slice(3, 5)) {
      const poll = structuredClone(row);
      poll.payload.call_id = `directory-${i}`;
      rows.push(poll);
    }
  }
  await writeJsonl(path.join(home, 'sessions', 'directory.jsonl'), rows);
  const index = await buildIndex({ repoRoot, codexHome: home });
  const session = await materializeIndexedSession(index, rows[0].payload.id);
  const originId = [...session.presentationIndexes.backgroundTerminalOrigins.keys()][0];
  const requests = session.logicalEvents.filter((event) => session.presentationIndexes.backgroundTerminalContinuations.has(event.id));
  for (const presentation of ['timeline', 'trajectory']) {
    const locale = presentation === 'timeline' ? 'en' : 'zh-CN';
    const { page } = await openApp(t, index, { locale });
    await page.locator(`#timeline .event[data-event-id="${originId}"] .eventKind`).click();
    if (presentation === 'trajectory') await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    await page.locator('#detail .terminalRequestDirectory > summary').click();
    await page.locator(`#detail [data-target-event-id="${requests[127].id}"]`).waitFor();
    assert.match(await page.locator('#detail').innerText(), /128.*129/);
    assert.equal(await page.locator('#detail .eventRefsBlock [data-target-event-id]').count(), 128);
    await page.locator(`#detail [data-target-event-id="${requests[127].id}"]`).click();
    await page.locator(`#detail [data-target-event-id="${requests[128].id}"]`).click();
    await page.locator(`#detail [data-target-event-id="${requests[127].id}"]`).waitFor();
    assert.equal(await page.locator('#detail .eventRefsBlock').filter({ hasText: locale === 'en' ? 'Next terminal request' : '下一个终端请求' }).count(), 0);
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction((id) => document.activeElement?.dataset.targetEventId === id, requests[128].id);
  }
});

test('background terminal requests render in Timeline, hydrated Detail and Trajectory without an origin', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'terminal-browser-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const id = 'ab123456-1234-4234-8234-123456789abc';
  const dir = path.join(home, 'sessions', '2026', '09', '11');
  await fsp.mkdir(dir, { recursive: true });
  const fixture = await fsp.readFile(path.join(__dirname, '../test/fixtures/background-terminal/requests.jsonl'), 'utf8');
  await fsp.writeFile(path.join(dir, `rollout-${id}.jsonl`),
    JSON.stringify({ type: 'session_meta', payload: { id, cwd: repoRoot } }) + '\n' + fixture);
  const index = await buildIndex({ repoRoot, codexHome: home });
  const session = await materializeIndexedSession(index, id);
  const inputId = session.logicalEvents.find((event) => event.id.endsWith(':input')).id;
  const pollId = session.logicalEvents.find((event) => event.id.endsWith(':omitted')).id;
  const { page } = await openApp(t, index, { locale: 'en' });
  const input = page.locator(`#timeline .event[data-event-id="${inputId}"]`);
  const poll = page.locator(`#timeline .event[data-event-id="${pollId}"]`);
  assert.equal(await input.locator('.eventKind').textContent(), 'Background terminal input request');
  assert.equal(await poll.locator('.eventKind').textContent(), 'Background terminal poll request');
  assert.equal(await input.locator('.eventPreview').count(), 0);
  await input.locator('.eventHeader > .eventToggle').click();
  await page.waitForFunction((eventId) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`)?.textContent.includes('Requested input (JSON string)'), inputId);
  const detailText = await input.textContent();
  assert.ok(detailText.includes('\\u0003\\u001b[31m'));
  assert.ok(detailText.includes('synthetic rejection'));
  assert.equal(detailText.match(/Background terminal input request/g)?.length, 1);
  assert.equal(detailText.includes('Request type'), false);
  assert.equal(detailText.includes('· npm test'), false);
  await input.locator('.eventHeader > .eventKind').click();
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('synthetic rejection'));
  await captureTerminalPresentation(page, 'native-input');
  await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  assert.ok((await page.locator('#timeline').textContent()).includes('Background terminal'));
  assert.equal((await page.locator('#timeline').textContent()).includes('· npm test'), false);
});

test('browser single-tool Code Mode keeps native request and operation output primary while moving trace to inspector', async (t) => {
  const fixture = await makeCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation, 'fixture should create one Code Mode operation');
  const { page } = await openApp(t, index, { locale: 'en' });
  const renderedEventIds = await page.locator('#timeline .event[data-event-id]').evaluateAll((events) => events.map((eventNode) => eventNode.dataset.eventId));
  assert.ok(renderedEventIds.includes(operation.id), `expected Code Mode event in ${JSON.stringify(renderedEventIds)}`);
  const event = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);

  await page.waitForFunction((eventId) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`)?.classList.contains('code-mode-single-tool'), operation.id);
  assert.equal(await event.locator('.eventKind').textContent(), 'Wait for subagent');
  const compactHeader = await event.locator('.eventHeader').textContent();
  assert.match(compactHeader, /Code Mode/);
  assert.doesNotMatch(compactHeader, /Unassociated|Unattributed/);
  assert.doesNotMatch(compactHeader, /Declared request|response_item|2 raw|wait_agent/);
  assert.equal(compactHeader.includes('exec'), false);
  const requestPreview = event.locator('.codeModeRequestSummaryPreview');
  assert.equal(await requestPreview.count(), 1);
  assert.match(await requestPreview.textContent(), /Request.*1000/s);

  await event.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operation.id}"] .collaborationBlock`);
  assert.match(await event.locator('.collaborationBlock').textContent(), /Wait for subagent.*Timeout ms.*1000/s);
  assert.match(await event.locator('.terminalBlock').textContent(), /Operation output.*Final browser output/s);
  assert.equal((await event.locator('.terminalBlock').textContent()).includes('Script completed'), false);
  assert.doesNotMatch(await event.locator('.terminalBlock').textContent(), /\[32;1m|\[0m/);
  assert.equal(await event.locator('.codeModeTrace').count(), 0);
  assert.equal((await event.textContent()).includes('Operation metadata'), false);

  await waitForDetailView(page, 'inspector');
  await page.waitForSelector('#detail .inspectorDetailBody');
  assert.match(await page.locator('#detail .inspectorDetailBody').textContent(), /Operation metadata.*Poll count.*2.*Code Mode source.*Projection evidence.*wait_agent.*Result association note.*No result output matched the supported shape.*Execution trace.*Observed nested activity.*MCP tool/s);
  assert.deepEqual(
    (await page.locator('#detail .inspector > .inspectorSection > h3').allTextContents()).map((value) => value.trim()),
    ['Details', 'Metadata', 'Source'],
  );
  const metadataText = await page.locator('#detail .inspectorMetadataSection').textContent();
  assert.doesNotMatch(metadataText, /Status|Severity/);
  const rawAction = page.locator('#detail .detailViewHeader [data-detail-action="raw"]');
  assert.equal(await rawAction.count(), 1);
  assert.equal((await rawAction.textContent()).trim(), `Raw · ${operation.rawRefs.length}`);
  assert.equal(await page.locator('#detail .inspector [data-detail-action="raw"]').count(), 0);
  const inspectorTrace = page.locator('#detail .codeModeTrace');
  assert.equal(await inspectorTrace.getAttribute('open'), null);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.waitForFunction((eventId) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .terminalBlock`)?.textContent.includes('操作输出'), operation.id);
  assert.equal(await event.locator('.eventKind').textContent(), '等待子代理');
  assert.match(await event.locator('.eventHeader').textContent(), /代码模式/);
  assert.doesNotMatch(await event.locator('.eventHeader').textContent(), /未关联|未归属/);
  assert.equal((await event.locator('.eventHeader').textContent()).includes('wait_agent'), false);

  await event.click();
  await waitForDetailView(page, 'inspector');
  await page.waitForSelector('#detail .codeModeTrace');
  assert.equal((await page.locator('#detail .detailViewHeader [data-detail-action="raw"]').textContent()).trim(), `原始记录 · ${operation.rawRefs.length}`);
  const localizedInspectorTrace = page.locator('#detail .codeModeTrace');
  await localizedInspectorTrace.locator('summary').click();
  assert.notEqual(await localizedInspectorTrace.getAttribute('open'), null);
  assert.match(await localizedInspectorTrace.textContent(), /执行阶段.*Initial output.*等待阶段 1.*Intermediate output.*等待阶段 2/s);
  assert.equal((await localizedInspectorTrace.textContent()).includes('Final browser output'), false);
});

test('browser Code Mode projects direct write_stdin emissions as terminal requests without native origin relation', async (t) => {
  const fixture = await makeCodeModeDirectWriteStdinCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operations = session.logicalEvents.filter((event) => event.kind === 'code_mode_operation');
  assert.equal(operations.length, 2);
  assert.equal(session.presentationIndexes.backgroundTerminalRequests.size, 0);
  assert.equal(session.presentationIndexes.backgroundTerminalContinuations.size, 0);

  const { page } = await openApp(t, index, { locale: 'en' });
  const poll = page.locator(`#timeline .event[data-event-id="${operations[0].id}"]`);
  const input = page.locator(`#timeline .event[data-event-id="${operations[1].id}"]`);
  await page.waitForFunction(({ pollId, inputId }) => (
    document.querySelector(`#timeline .event[data-event-id="${CSS.escape(pollId)}"]`)?.classList.contains('code-mode-single-tool')
      && document.querySelector(`#timeline .event[data-event-id="${CSS.escape(inputId)}"]`)?.classList.contains('code-mode-single-tool')
  ), { pollId: operations[0].id, inputId: operations[1].id });
  assert.equal(await poll.locator('.eventKind').textContent(), 'Background terminal poll request');
  assert.equal(await input.locator('.eventKind').textContent(), 'Background terminal input request');
  assert.match(await poll.locator('.eventHeader').textContent(), /Code Mode/);
  assert.equal((await poll.locator('.eventHeader').textContent()).includes('npm test'), false);

  await poll.locator('.eventHeader > .eventToggle').click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operations[0].id}"] .eventBody`);
  assert.match(await poll.textContent(), /Background terminal poll request.*Process ID.*49497.*Output.*still working/s);
  assert.equal((await poll.textContent()).match(/Background terminal poll request/g)?.length, 1);
  assert.equal((await poll.textContent()).includes('Request type'), false);
  assert.equal((await poll.textContent()).includes('"output"'), false);
  assert.equal(await poll.locator('.kvTable').count(), 1);
  assert.equal((await poll.locator('.eventBody').textContent()).match(/49497/g)?.length, 1);
  assert.match(await poll.locator('.kvTable').textContent(), /Process ID.*49497.*Wall time.*5.0025895/s);
  assert.equal(await poll.locator('.codeModeSource').count(), 0);

  await input.locator('.eventHeader > .eventToggle').click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operations[1].id}"] .eventBody`);
  assert.match(await input.textContent(), /Background terminal input request.*Requested input \(JSON string\).*q\\n/s);
  assert.equal((await input.textContent()).includes('Originating command'), false);
  assert.equal((await input.textContent()).match(/Background terminal input request/g)?.length, 1);

  await input.locator('.eventKind').click();
  await waitForDetailView(page, 'inspector');
  assert.match(await page.locator('#detail .detailViewHeader').textContent(), /Background terminal input request/);
  assert.equal((await page.locator('#detail').textContent()).includes('Originating command'), false);
  const associatedResult = page.locator('#detail .codeModeSource').filter({ hasText: 'Associated result' });
  await associatedResult.locator('summary').click();
  assert.ok((await associatedResult.textContent()).includes('"output":"accepted"'));
  await associatedResult.locator('summary').click();

  await captureTerminalPresentation(page, 'code-mode-input-poll');

  await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  assert.equal(await page.locator('[data-trajectory-event-id]').count(), 2);
  assert.match(await page.locator('#timeline').textContent(), /Background terminal poll request/);
  assert.match(await page.locator('#timeline').textContent(), /Background terminal input request/);
  assert.equal((await page.locator('#timeline').textContent()).includes('text(await'), false);
  await captureTerminalPresentation(page, 'code-mode-trajectory');
});

test('background terminal metadata keeps differing response IDs and raw evidence in both locales', async (t) => {
  for (const locale of ['en', 'zh-CN']) await t.test(locale, async (t) => {
    const fixture = await makeCodeModeDirectWriteStdinCodexHome(t, {
      pollResponse: { session_id: 49498, wall_time_seconds: 0, output: '{"label":"actual stdout"}\nsecond line' },
    });
    const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
    const session = await materializeIndexedSession(index, fixture.sessionId);
    const event = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
    const { page } = await openApp(t, index, { locale });
    const card = page.locator(`#timeline .event[data-event-id="${event.id}"]`);
    await page.waitForFunction((id) => document.querySelector(`[data-event-id="${CSS.escape(id)}"]`)?.classList.contains('code-mode-single-tool'), event.id);
    await card.locator('.eventHeader > .eventToggle').click();
    await card.locator('.eventBody').waitFor();
    assert.equal(await card.locator('.kvTable').count(), 1);
    const metadata = await card.locator('.kvTable').textContent();
    assert.match(metadata, /49497.*49498.*0/s);
    assert.ok(metadata.includes(locale === 'en' ? 'Response Process ID' : '响应进程 ID'));
    assert.ok((await card.textContent()).includes('{"label":"actual stdout"}'));
    for (const width of [960, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    await page.waitForSelector('.trajectoryPresentation');
    await page.locator(`[data-trajectory-event-id="${event.id}"]`).click();
    await waitForDetailView(page, 'inspector');
    const result = page.locator('#detail .codeModeSource').filter({ hasText: locale === 'en' ? 'Associated result' : '关联结果' });
    await result.locator('summary').click();
    assert.ok((await result.textContent()).includes('"session_id":49498'));
    await page.locator('[data-detail-action="raw"]').click();
    await page.waitForSelector('#detail .rawRefsView');
    await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('49498'));
    assert.ok((await page.locator('#detail').textContent()).includes('49498'));
    assert.ok((await page.locator('#detail').textContent()).includes('49497'));
    await captureTerminalPresentation(page, `different-pid-${locale}`);
  });
});

test('browser nested Code Mode context reveals a distinct parent row without changing search owners or fold overrides', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((candidate) => candidate.toolName === 'nested-context-token');
  assert.ok(operation && nested);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ operationId, nestedId }) => (
    Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`))
      && Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(nestedId)}"]`))
  ), { operationId: operation.id, nestedId: nested.id });
  await fillSearch(page, 'nested-context-token');
  await waitForSearchMarks(page);

  await addSearchFilter(page, 'status', 'failed');
  await page.waitForFunction((nestedId) => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return cards.length === 1 && cards[0].dataset.eventId === nestedId;
  }, nested.id);
  await page.locator('#searchAssistClose').click();
  const beforeSearch = await page.evaluate(() => ({
    result: document.querySelector('#resultSummary')?.textContent || '',
    owners: [...document.querySelectorAll('[data-search-target-owner]')].map((node) => node.getAttribute('data-search-target-owner')),
  }));
  const affordance = page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="reveal-context-parent"]`);
  await affordance.click();
  await page.waitForSelector('.contextRevealRow');
  const revealed = await page.locator('.contextRevealRow').evaluate((row, nestedId) => {
    const slot = row.closest('.contextRevealSlot');
    const child = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(nestedId)}"]`);
    return {
      isEvent: row.classList.contains('event'),
      eventId: row.getAttribute('data-event-id'),
      searchOwner: row.getAttribute('data-search-target-owner'),
      beforeChild: slot?.nextElementSibling === child,
    };
  }, nested.id);
  assert.deepEqual(revealed, { isEvent: false, eventId: null, searchOwner: null, beforeChild: true });
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 1);
  assert.equal(await page.locator('#resultSummary').textContent(), beforeSearch.result);
  const afterOwners = await page.locator('[data-search-target-owner]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-search-target-owner')));
  assert.deepEqual(afterOwners, beforeSearch.owners);
  const overridesBefore = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides'));

  await page.locator('.contextRevealAction').click();
  await page.waitForSelector('#detail .detailView');
  assert.equal(await page.locator('.contextRevealRow').count(), 0);
  assert.equal(await page.locator(`#timeline .event[data-event-id="${operation.id}"]`).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.overrides')), overridesBefore);

  await page.locator('[data-detail-action="close"]').click();
  await page.locator('#searchFilterBtn').click();
  await page.locator('#searchStatusSelect').selectOption('');
  await page.locator('#searchAssistClose').click();
  await page.waitForFunction((operationId) => Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`)), operation.id);
  await page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="reveal-context-parent"]`).click();
  await page.waitForFunction((operationId) => document.querySelector(`#timeline .event.selected[data-event-id="${CSS.escape(operationId)}"]`), operation.id);
});

test('browser nested Code Mode context late responses are invalidated by detail, fold, profile, and Main presentation transitions', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((candidate) => candidate.toolName === 'nested-context-token');
  assert.ok(operation && nested);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ operationId, nestedId }) => (
    Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`))
      && Boolean(document.querySelector(`#timeline .event[data-event-id="${CSS.escape(nestedId)}"]`))
  ), { operationId: operation.id, nestedId: nested.id });
  await fillSearch(page, 'nested-context-token');
  await waitForSearchMarks(page);
  await addSearchFilter(page, 'status', 'failed');
  await page.waitForFunction((nestedId) => {
    const cards = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return cards.length === 1 && cards[0].dataset.eventId === nestedId;
  }, nested.id);
  await page.locator('#searchAssistClose').click();

  const parentPath = `/api/sessions/${fixture.sessionId}/events/${encodeURIComponent(operation.id)}`;
  const parentPayload = JSON.stringify(operation);
  const gates = [];
  await page.route((url) => new URL(String(url)).pathname === parentPath, async (route) => {
    const gate = gates.shift();
    if (!gate) {
      await route.continue();
      return;
    }
    gate.startedResolve();
    await gate.releasePromise;
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: parentPayload });
    } catch {
      // The transition under test may abort the request before the late response is delivered.
    } finally {
      gate.finishedResolve();
    }
  });

  const queueParentGate = () => {
    let releaseResolve;
    let startedResolve;
    let finishedResolve;
    const gate = {
      releasePromise: new Promise((resolve) => { releaseResolve = resolve; }),
      started: new Promise((resolve) => { startedResolve = resolve; }),
      finished: new Promise((resolve) => { finishedResolve = resolve; }),
      release: () => releaseResolve(),
      startedResolve: () => startedResolve(),
      finishedResolve: () => finishedResolve(),
    };
    gates.push(gate);
    return gate;
  };
  const revealAndWaitForRequest = async (gate) => {
    await page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="reveal-context-parent"]`).click();
    await gate.started;
  };
  const assertContextRowGone = async () => {
    await page.waitForFunction(() => !document.querySelector('.contextRevealRow'));
    assert.equal(await page.locator('.contextRevealRow').count(), 0);
  };

  const detailGate = queueParentGate();
  await revealAndWaitForRequest(detailGate);
  await page.locator(`#timeline .event[data-event-id="${nested.id}"] .eventKind`).click();
  await waitForDetailView(page, 'inspector');
  await assertContextRowGone();
  detailGate.release();
  await detailGate.finished;

  const rawGate = queueParentGate();
  await revealAndWaitForRequest(rawGate);
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await assertContextRowGone();
  rawGate.release();
  await rawGate.finished;

  const foldGate = queueParentGate();
  await revealAndWaitForRequest(foldGate);
  await page.locator(`#timeline .event[data-event-id="${nested.id}"] [data-action="toggle"]`).first().click();
  await assertContextRowGone();
  foldGate.release();
  await foldGate.finished;

  const profileGate = queueParentGate();
  await revealAndWaitForRequest(profileGate);
  await page.locator('#profileSelect').selectOption('debug');
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value === 'debug');
  await assertContextRowGone();
  profileGate.release();
  await profileGate.finished;

  const presentationGate = queueParentGate();
  await revealAndWaitForRequest(presentationGate);
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  await assertContextRowGone();
  presentationGate.release();
  await presentationGate.finished;
  assert.equal(await page.locator('.contextRevealRow').count(), 0);
});

test('browser Code Mode raw fallback keeps a shared origin tag instead of the outer exec tool tag', async (t) => {
  const fixture = await makeRawCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation);

  const { page } = await openApp(t, index, { locale: 'en' });
  const event = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return card?.classList.contains('collapsed') && card.classList.contains('code-mode-raw-code-mode');
  }, operation.id);
  assert.equal(await event.locator('.eventKind').textContent(), 'Scripted operation');
  assert.match(await event.locator('.eventHeader').textContent(), /Code Mode/);
  assert.equal(await event.locator('.codeModeChip').count(), 1);
  assert.equal(await event.locator('.toolChip').count(), 0);
  const rawPreview = event.locator('.codeModeSourceExcerptPreview');
  assert.equal(await rawPreview.count(), 1);
  assert.match(await rawPreview.textContent(), /Source.*update_plan\(args\)/s);
  assert.equal((await rawPreview.textContent()).includes('tools.'), false);
  assert.equal((await rawPreview.textContent()).includes('{}'), false);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction((eventId) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"] .eventKind`)?.textContent === '脚本化操作', operation.id);
  assert.match(await event.locator('.eventHeader').textContent(), /代码模式/);
  assert.equal(await event.locator('.toolChip').count(), 0);
  assert.match(await rawPreview.textContent(), /源码.*update_plan\(args\)/s);
});

test('browser Code Mode summary presents a readable source excerpt instead of raw code', async (t) => {
  const fixture = await makeRawCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation);

  const summaryProfile = {
    id: 'custom:code-mode-summary',
    name: 'Code Mode summary test',
    description: 'Shows Code Mode operations in summary state.',
    rules: {
      kindStates: { other_tool_call: 'summary' },
      fallback: 'hidden',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([summaryProfile]),
      'sessionAnalyzer.profile': summaryProfile.id,
    },
  });
  const event = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return card?.classList.contains('summary')
      && card.classList.contains('code-mode-raw-code-mode')
      && Boolean(card.querySelector('.codeModeSummaryPreview'));
  }, operation.id);

  const summaryPreview = event.locator('.codeModeSummaryPreview');
  assert.equal(await event.locator('.eventKind').textContent(), 'Scripted operation');
  assert.equal(await event.locator('.toolChip').count(), 0);
  assert.equal(await summaryPreview.count(), 1);
  assert.equal(await summaryPreview.locator('code').count(), 0);
  assert.equal(await summaryPreview.locator('.codeModeSummaryExcerptBodySingleLine').count(), 0);
  assert.equal(await summaryPreview.locator('.codeModeCollapsedPreviewLabel').textContent(), 'Source');
  const previewChrome = await summaryPreview.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      borderLeftWidth: style.borderLeftWidth,
    };
  });
  assert.deepEqual(previewChrome, {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderTopWidth: '0px',
    borderLeftWidth: '0px',
  });
  const summaryLines = summaryPreview.locator('.codeModeSummaryExcerptLine');
  assert.equal(await summaryLines.count(), 2);
  assert.match(await summaryLines.nth(0).textContent(), /update_plan\(args\)/);
  assert.match(await summaryLines.nth(1).textContent(), /get_goal\(args\)/);
  assert.equal((await summaryPreview.textContent()).includes('tools.'), false);
  const continuation = summaryPreview.locator('.codeModeSummaryExcerptContinuation');
  assert.equal(await continuation.count(), 1);
  assert.equal(await continuation.locator('[aria-hidden="true"]').textContent(), '…');
  assert.match(await summaryPreview.textContent(), /Additional source not shown\./);
  assert.equal((await summaryPreview.textContent()).includes('request_user_input(args)'), false);

  await event.locator('.eventToggle').first().click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operation.id}"].expanded .commandRun`);
  await event.locator('.eventToggle').first().click();
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return card?.classList.contains('summary') && Boolean(card.querySelector('.codeModeSummaryPreview'));
  }, operation.id);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction((eventId) => {
    const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
      return card?.classList.contains('summary')
      && card.querySelector('.eventKind')?.textContent === '脚本化操作'
      && Boolean(card.querySelector('.codeModeSummaryPreview .codeModeSummaryExcerptLine'));
  }, operation.id);
  assert.match(await summaryPreview.textContent(), /源码.*还有未显示的源码。/s);
  assert.equal(await summaryPreview.locator('code').count(), 0);
});

test('browser Code Mode summary keeps one logical source line to one visual row', async (t) => {
  const fixture = await makeSingleLineRawCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(operation);

  const summaryProfile = {
    id: 'custom:code-mode-summary-single-line',
    name: 'Code Mode summary single-line test',
    description: 'Shows one raw source line with the summary presentation.',
    rules: {
      kindStates: { other_tool_call: 'summary' },
      fallback: 'hidden',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([summaryProfile]),
      'sessionAnalyzer.profile': summaryProfile.id,
    },
  });
  await page.setViewportSize({ width: 820, height: 900 });
  const event = page.locator('#timeline .event[data-event-id="' + operation.id + '"]');
  await page.waitForFunction((eventId) => {
    const card = document.querySelector('#timeline .event[data-event-id="' + CSS.escape(eventId) + '"]');
    return card?.classList.contains('summary')
      && card?.classList.contains('code-mode-raw-code-mode')
      && Boolean(card.querySelector('.codeModeSummaryExcerptLine'));
  }, operation.id);

  const summaryPreview = event.locator('.codeModeSummaryPreview');
  const summaryLine = summaryPreview.locator('.codeModeSummaryExcerptLine');
  assert.equal(await summaryLine.count(), 1);
  assert.equal(await summaryPreview.locator('.codeModeSummaryExcerptBodySingleLine').count(), 0);
  assert.equal(await summaryPreview.locator('code').count(), 0);
  const metrics = await summaryLine.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      whiteSpace: style.whiteSpace,
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  assert.equal(metrics.whiteSpace, 'nowrap');
  assert.ok(metrics.height <= metrics.lineHeight * 1.2, JSON.stringify(metrics));
});

test('browser Code Mode adaptively unwraps one declared tool and labels multiple declared tools without changing counts', async (t) => {
  const fixture = await makeAdaptiveCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operations = session.logicalEvents.filter((candidate) => candidate.kind === 'code_mode_operation');
  const single = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-browser-single');
  const multi = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-browser-multi');
  const requestOnly = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-browser-request-only');
  assert.ok(single && multi && requestOnly);
  assert.equal(session.counts.toolCalls, 4);
  assert.deepEqual(session.analysis.toolUsage, [
    { name: 'exec', count: 3 },
    { name: 'fixture_other_tool', count: 1 },
  ]);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ singleId, multiId, requestOnlyId }) => {
    const singleEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(singleId)}"]`);
    const multiEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(multiId)}"]`);
    const requestOnlyEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(requestOnlyId)}"]`);
    return singleEvent?.classList.contains('code-mode-single-tool')
      && multiEvent?.classList.contains('code-mode-multi-tool')
      && requestOnlyEvent?.classList.contains('code-mode-single-tool');
  }, { singleId: single.id, multiId: multi.id, requestOnlyId: requestOnly.id });

  const singleEvent = page.locator(`#timeline .event[data-event-id="${single.id}"]`);
  const multiEvent = page.locator(`#timeline .event[data-event-id="${multi.id}"]`);
  const requestOnlyEvent = page.locator(`#timeline .event[data-event-id="${requestOnly.id}"]`);
  assert.equal(await singleEvent.locator('.eventKind').textContent(), 'Plan update');
  assert.match(await singleEvent.locator('.eventHeader').textContent(), /Code Mode/);
  assert.doesNotMatch(await singleEvent.locator('.eventHeader').textContent(), /Result output/);
  assert.doesNotMatch(await singleEvent.locator('.eventHeader').textContent(), /Declared request|response_item|2 raw|update_plan/);
  assert.equal(await singleEvent.locator('.toolChip').count(), 0, 'the native single-tool title makes the tool-name chip redundant');
  const singlePreview = singleEvent.locator('.codeModeRequestSummaryPreview');
  assert.equal(await singlePreview.count(), 1);
  assert.match(await singlePreview.textContent(), /Request.*2 steps.*Inspect single/s);
  const requestOnlyPreview = requestOnlyEvent.locator('.codeModeRequestSummaryPreview');
  assert.equal(await requestOnlyPreview.count(), 1);
  assert.match(await requestOnlyPreview.textContent(), /Request.*1 step.*Request only/s);
  await singleEvent.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${single.id}"] .planUpdateBlock`);
  assert.equal(await singleEvent.locator('.codeModeToolProjection').count(), 0);
  assert.equal(await singleEvent.locator('.codeModeSource').count(), 1, 'associated result remains folded in the timeline');
  assert.equal((await singleEvent.locator('.codeModeSource').textContent()).includes('const plan'), false);

  assert.equal(await multiEvent.locator('.eventKind').textContent(), 'Multiple operations');
  const multiHeader = await multiEvent.locator('.eventHeader').textContent();
  assert.match(multiHeader, /2 tools/);
  assert.doesNotMatch(multiHeader, /Result output/);
  assert.doesNotMatch(multiHeader, /Declared request|response_item|2 raw/);
  assert.equal(await multiEvent.locator('.toolChip').count(), 0);
  const multiPreview = multiEvent.locator('.codeModeDeclaredSequencePreview');
  assert.equal(await multiPreview.count(), 1);
  assert.match(await multiPreview.textContent(), /Declared sequence.*Plan update.*1 step.*Inspect multi.*Shell command.*Write-Output multi/s);
  await multiEvent.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${multi.id}"] .codeModeToolProjection`);
  assert.equal(await multiEvent.locator('.codeModeToolProjection').count(), 2);
  assert.equal(await multiEvent.locator('.codeModeSource').count(), 3, 'two associated results plus outer source remain folded');
  await multiEvent.locator('.eventToggle').click();
  await page.waitForFunction((eventId) => {
    const event = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return event && !event.classList.contains('expanded') && Boolean(event.querySelector('.codeModeDeclaredSequencePreview'));
  }, multi.id);
  if (await page.locator('[data-detail-action="close"]').count()) {
    await page.locator('[data-detail-action="close"]').click();
    await waitForDetailView(page, 'profileRules');
  }
  await page.locator('#detail [data-profile-kind="other_tool_call"]').selectOption('summary');
  await page.locator('#resetFoldsBtn').click();
  await page.waitForFunction((eventId) => {
    const event = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return event?.classList.contains('summary') && Boolean(event.querySelector('.codeModeDeclaredSequencePreview.codeModeSummaryPreview'));
  }, multi.id);
  assert.equal(await multiPreview.locator('code').count(), 0);
  await page.waitForFunction((eventId) => {
    const event = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
    return event?.classList.contains('summary')
      && Boolean(event.querySelector('.codeModeRequestSummaryPreview.codeModeSummaryPreview'));
  }, requestOnly.id);
  assert.match(await requestOnlyPreview.textContent(), /Request.*1 step.*Request only/s);

  assert.equal(await requestOnlyEvent.locator('.eventKind').textContent(), 'Plan update');
  assert.match(await requestOnlyEvent.locator('.eventHeader').textContent(), /Code Mode/);
  assert.doesNotMatch(await requestOnlyEvent.locator('.eventHeader').textContent(), /Result output|Unassociated output/);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(({ singleId, multiId, requestOnlyId }) => {
    const label = (id) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"] .eventKind`)?.textContent;
    return label(singleId) === '计划更新'
      && label(multiId) === '多个操作'
      && label(requestOnlyId) === '计划更新';
  }, { singleId: single.id, multiId: multi.id, requestOnlyId: requestOnly.id });
  assert.match(await multiEvent.locator('.eventHeader').textContent(), /2 个工具/);
  assert.doesNotMatch(await multiEvent.locator('.eventHeader').textContent(), /结果输出/);
  assert.equal((await multiEvent.locator('.eventHeader').textContent()).includes('代码模式'), true, 'the Code Mode chip retains the shared origin identity');
  assert.equal(await multiEvent.locator('.codeModeChip').count(), 1);
  assert.match(await multiPreview.textContent(), /声明顺序.*计划更新.*1 个步骤.*Inspect multi.*Shell 命令.*Write-Output multi/s);
  assert.doesNotMatch(await requestOnlyEvent.locator('.eventHeader').textContent(), /结果输出|未关联输出/);
  assert.match(await requestOnlyPreview.textContent(), /请求.*1 个步骤.*Request only/s);
});

test('browser search-hit snippets stay navigable ahead of every folded Code Mode preview', async (t) => {
  const fixture = await makeCodeModeSearchPreviewCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index, fixture.sessionId);
  const operations = session.logicalEvents.filter((candidate) => candidate.kind === 'code_mode_operation');
  const single = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-search-single');
  const multi = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-search-multi');
  const raw = operations.find((candidate) => candidate.codeModeOperation?.outerCallId === 'exec-search-raw');
  assert.ok(single && multi && raw);

  const overrides = {
    [session.id]: {
      [single.id]: 'collapsed',
      [multi.id]: 'summary',
      [raw.id]: 'collapsed',
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: { 'sessionAnalyzer.overrides': JSON.stringify(overrides) },
  });
  const cases = [
    { event: single, state: 'collapsed', query: 'single result navigation needle', preview: '.codeModeRequestSummaryPreview' },
    { event: multi, state: 'summary', query: 'multi result navigation needle', preview: '.codeModeDeclaredSequencePreview' },
    { event: raw, state: 'collapsed', query: 'raw source navigation needle', preview: '.codeModeSourceExcerptPreview' },
  ];

  for (const item of cases) {
    const event = page.locator(`#timeline .event[data-event-id="${item.event.id}"]`);
    await page.waitForSelector(`#timeline .event[data-event-id="${item.event.id}"].${item.state} ${item.preview}`);
    await fillSearch(page, item.query);
    await page.waitForFunction(({ eventId, query }) => {
      const card = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(eventId)}"]`);
      return card?.classList.contains('searchHit')
        && (card.classList.contains('collapsed') || card.classList.contains('summary'))
        && card.querySelector('.eventPreview .searchMark')?.textContent.toLowerCase() === query;
    }, { eventId: item.event.id, query: item.query });
    assert.equal(await event.locator(item.preview).count(), 0, 'the bounded preview must yield to the active search snippet');
    const beforeNavigation = await searchNavigationSnapshot(page);
    const binding = beforeNavigation.bindings.find((candidate) => candidate.ownerId === item.event.id);
    assert.ok(binding?.live);
    assert.deepEqual(binding.surfaces, ['timeline']);
    await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
    await page.waitForFunction((eventId) => (
      document.querySelector(`.searchMark.activeSearchMark[data-search-target-owner="${CSS.escape(eventId)}"]`)
    ), item.event.id);
    assert.ok(await event.locator('.eventPreview .searchMark.activeSearchMark').count());
    assert.ok(await event.evaluate((node, state) => node.classList.contains(state), item.state));
    await fillSearch(page, '');
    await page.waitForSelector(`#timeline .event[data-event-id="${item.event.id}"].${item.state} ${item.preview}`);
  }
});

test('browser Code Mode presents web requests structurally, renders safe Markdown, and compacts associated lifecycle evidence', async (t) => {
  const fixture = await makeWebCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = await materializeIndexedSession(index);
  const operation = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  const webLifecycle = session.logicalEvents.find((candidate) => candidate.kind === 'web_search');
  assert.ok(operation && webLifecycle);
  assert.equal(session.counts.toolCalls, 2);
  assert.deepEqual(session.analysis.toolUsage, [{ name: 'exec', count: 1 }, { name: 'web_search', count: 1 }]);

  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(({ operationId, lifecycleId }) => {
    const operationEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(operationId)}"]`);
    const lifecycleEvent = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(lifecycleId)}"]`);
    return operationEvent?.classList.contains('code-mode-single-tool')
      && lifecycleEvent?.classList.contains('code-mode-web-lifecycle');
  }, { operationId: operation.id, lifecycleId: webLifecycle.id });

  const operationEvent = page.locator(`#timeline .event[data-event-id="${operation.id}"]`);
  const lifecycleEvent = page.locator(`#timeline .event[data-event-id="${webLifecycle.id}"]`);
  assert.equal(await operationEvent.locator('.eventKind').textContent(), 'Web search');
  assert.match(await operationEvent.locator('.eventHeader').textContent(), /Code Mode/);
  assert.doesNotMatch(await operationEvent.locator('.eventHeader').textContent(), /Result output/);
  assert.equal(await operationEvent.locator('.toolChip').count(), 0);
  assert.equal(await lifecycleEvent.locator('.eventKind').textContent(), 'Web activity observed');
  assert.equal(await lifecycleEvent.locator('.eventPreview').count(), 0);
  assert.equal(await lifecycleEvent.locator('.toolChip').count(), 0);

  await operationEvent.click();
  await page.waitForSelector(`#timeline .event[data-event-id="${operation.id}"] .webRequestBlock`);
  assert.match(await operationEvent.locator('.webRequestBlock').textContent(), /Web request.*Queries.*site:example\.test browser markdown.*Domains.*example\.test.*Response length.*long/s);
  const markdown = operationEvent.locator('.webResultMarkdown');
  assert.equal(await markdown.locator('h2').textContent(), 'Example browser result');
  assert.equal(await markdown.locator('strong').textContent(), 'Rendered browser emphasis');
  assert.equal(await markdown.locator('a[href="https://example.test/docs"]').count(), 1);
  assert.equal(await markdown.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await markdown.locator('script').count(), 0);
  assert.match(await markdown.textContent(), /citeturn0search0/);
  assert.equal((await operationEvent.textContent()).includes('Script completed'), false);
  assert.equal((await operationEvent.textContent()).includes('Associated result'), false);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(({ operationId, lifecycleId }) => {
    const label = (id) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"] .eventKind`)?.textContent;
    return label(operationId) === '网页搜索' && label(lifecycleId) === '已观测网页活动';
  }, { operationId: operation.id, lifecycleId: webLifecycle.id });
  assert.match(await operationEvent.locator('.webRequestBlock').textContent(), /网络请求.*查询.*域名.*响应长度/s);
  assert.match(await operationEvent.locator('.webResultMarkdown').textContent(), /网页结果.*Example browser result/s);
});
