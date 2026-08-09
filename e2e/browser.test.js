'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { analyzerSessionId, buildClaudeIndex } = require('../src/claude');
const { buildIndex } = require('../src/codex');
const { createServer } = require('../server');
const { createTimelineProfileFixture } = require('../scripts/timeline-profile-fixture');

const fixtureCodexHome = path.join(__dirname, '..', 'test', 'fixtures', 'codex-home');
const repoRoot = 'G:\\vibe\\term-agent';
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';

async function buildFixtureIndex() {
  return buildIndex({ repoRoot, codexHome: fixtureCodexHome });
}

async function startServer(t, index, options = {}) {
  const server = createServer(index, 1, {
    codexHome: index.codexHome,
    ...(options.skipProjectReindex ? {} : { repo: index.repoRoot }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function openApp(t, index, options = {}) {
  const baseUrl = await startServer(t, index, options);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 } });
  if (options.localStorage) {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, value);
      }
    }, options.localStorage);
  }
  if (options.locale) {
    await context.addInitScript((locale) => {
      localStorage.setItem('sessionAnalyzer.locale', locale);
    }, options.locale);
  }
  const page = await context.newPage();
  const requestedPaths = [];
  const requestedUrls = [];
  page.on('request', (request) => {
    const parsed = new URL(request.url());
    if (parsed.origin === baseUrl) {
      requestedPaths.push(parsed.pathname);
      requestedUrls.push(`${parsed.pathname}${parsed.search}`);
    }
  });
  page.on('pageerror', (error) => assert.fail(error.stack || error.message));
  t.after(async () => {
    await context.close();
    await browser.close();
  });
  await page.goto(baseUrl);
  assert.ok(requestedPaths.includes('/assets/app.js'), 'browser should load the generated app bundle');
  for (const oldScript of ['/app.js', '/renderers.js', '/folding.js', '/command-highlighting.js', '/search-query.js', '/search-controls.js', '/highlight.js', '/navigation.js', '/event-chips.js']) {
    assert.equal(requestedPaths.includes(oldScript), false, `browser should not load old source script ${oldScript}`);
  }
  await page.waitForFunction(() => window.sessionFolding && window.sessionRenderers && window.sessionSearchControls);
  await page.waitForSelector('.sessionItem.active', { state: options.activeSessionState || 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length > 0);
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing !== 'true');
  return { page, baseUrl, requestedPaths, requestedUrls };
}

async function openSourceSwitchChooser(t, options = {}) {
  const server = createServer(null, 0, {
    source: 'codex',
    codexHome: fixtureCodexHome,
    claudeHome: path.join(os.tmpdir(), 'session-analyzer-unused-claude'),
    ...options.server,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const storageEntries = {
    'sessionAnalyzer.locale': options.locale || 'en',
    ...(options.localStorage || {}),
  };
  await context.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, value);
    }
  }, storageEntries);
  const page = await context.newPage();
  page.on('pageerror', (error) => assert.fail(error.stack || error.message));
  t.after(async () => {
    await context.close();
    await browser.close();
  });
  if (options.beforeGoto) await options.beforeGoto(page);
  await page.goto(baseUrl);
  await page.waitForFunction(() => !document.querySelector('#projectSourceSwitch')?.hidden);
  return { page, baseUrl };
}

async function makeClaudeSwitchFixture(t) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-source-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-switch-fixture');
  const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const record = (fields) => ({
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: claudeRepo,
    sessionId,
    version: '2.1.220',
    ...fields,
  });
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    record({
      type: 'user',
      parentUuid: null,
      uuid: 'switch-browser-user',
      timestamp: '2026-08-07T12:00:00.000Z',
      message: { role: 'user', content: 'Switch browser task' },
    }),
    record({
      type: 'assistant',
      parentUuid: 'switch-browser-user',
      uuid: 'switch-browser-assistant',
      timestamp: '2026-08-07T12:00:01.000Z',
      message: {
        id: 'switch-browser-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Switch browser answer' }],
      },
    }),
  ]);
  return { claudeHome, claudeRepo };
}

async function confirmSourceAction(page, expectedLabel) {
  await page.waitForFunction((label) => document.querySelector('#projectSourceAction')?.textContent === label, expectedLabel);
  await page.locator('#projectSourceAction').click();
}

async function waitForProjectRoot(page, repoRootPath) {
  await page.waitForFunction((root) => (
    [...document.querySelectorAll('.projectItem[data-project-root]')].some((item) => item.dataset.projectRoot === root)
  ), repoRootPath);
}

async function switchHiddenLocale(page, locale) {
  await page.evaluate((nextLocale) => {
    const select = document.querySelector('#localeSelect');
    select.value = nextLocale;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, locale);
}

async function selectPrimarySession(page) {
  const session = page.locator(`[data-session-id="${primaryFixtureSessionId}"]`);
  await session.click();
  await assertEventCount(page, 29);
  await expectInputValue(page, '#searchInput', '');
}

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function assertEventCount(page, expected) {
  await page.waitForFunction((count) => document.querySelectorAll('#timeline .event[data-event-id]').length === count, expected);
}

async function expectInputValue(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: target, expected: value }) => document.querySelector(target)?.value === value,
    { selector, expected },
  );
}

async function fillSearch(page, value) {
  await page.locator('#searchInput').fill(value);
  await page.locator('#searchInput').dispatchEvent('input');
}

async function addSearchFilter(page, key, value) {
  await page.locator('#searchFilterBtn').click();
  const control = page.locator(`[data-search-filter-control="${key}"]`);
  if (key === 'file') {
    await control.fill(value);
    await control.press('Enter');
  } else {
    await control.selectOption(value);
  }
  await page.waitForFunction(
    ({ key: filterKey, value: filterValue }) => document.querySelector(`[data-search-filter-control="${filterKey}"]`)?.value === filterValue,
    { key, value },
  );
}

async function clearAllSearch(page) {
  await page.locator('#searchFilterBtn').click();
  await page.locator('#searchClearAllBtn').click();
  await expectInputValue(page, '#searchInput', '');
}

async function switchToProjectScope(page) {
  await page.locator('#searchHudScope').click();
  await page.locator('#searchAssist').getByRole('button', { name: 'Entire project' }).click();
  await page.waitForFunction(() => document.body.dataset.searchScope === 'project');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Search the entire project');
}

async function waitForProjectCards(page, minimum = 1) {
  await page.waitForFunction((count) => document.querySelectorAll('[data-project-result-session-id]').length >= count, minimum);
}

async function waitForSearchMarks(page, minimum = 1) {
  await page.waitForFunction((count) => document.querySelectorAll('.searchMark').length >= count, minimum);
}

async function waitForNoSearchMarks(page) {
  await page.waitForFunction(() => document.querySelectorAll('.searchMark').length === 0);
}

async function searchNavigationSnapshot(page) {
  return page.evaluate(() => {
    const label = document.querySelector('.searchInlineCount')?.textContent || '';
    const match = label.match(/^(\d+) \/ (\d+)/);
    const active = document.querySelector('.searchMark.activeSearchMark');
    const metrics = document.querySelector('#searchMetricsPanel');
    const ids = JSON.parse(metrics?.dataset.searchTargetIds || '[]');
    const activeId = metrics?.dataset.searchActiveTargetId || '';
    const bindings = ids.map((id) => {
      const nodes = [...document.querySelectorAll('[data-search-target-id]')]
        .filter((node) => node.dataset.searchTargetId === id);
      return {
        id,
        ownerId: JSON.parse(id).at(-1),
        surfaces: [...new Set(nodes.map((node) => node.dataset.searchTargetSurface))].sort(),
        live: nodes.length > 0,
      };
    });
    return {
      current: Number(match?.[1] || 0),
      total: Number(match?.[2] || 0),
      id: activeId,
      surface: active?.dataset.searchTargetSurface || '',
      ownerId: active?.dataset.searchTargetOwner || (activeId ? JSON.parse(activeId).at(-1) : ''),
      ids,
      bindings,
    };
  });
}

async function clickSearchNavigationAndWait(page, direction, previousId) {
  await page.locator(`.searchInlineMatches [data-search-match-nav="${direction}"]`).click();
  await page.waitForFunction((id) => (
    Boolean(document.querySelector('#searchMetricsPanel')?.dataset.searchActiveTargetId)
      && document.querySelector('#searchMetricsPanel')?.dataset.searchActiveTargetId !== id
  ), previousId);
  return searchNavigationSnapshot(page);
}

async function waitForDetailView(page, type) {
  await page.waitForFunction((expected) => document.body.dataset.detailView === expected, type);
}

async function moveToLastSearchMark(page) {
  const snapshot = () => page.evaluate(() => {
    const active = document.querySelector('.searchMark.activeSearchMark');
    const match = document.querySelector('.searchInlineCount')?.textContent.match(/^(\d+) \/ (\d+)/);
    const current = Number(match?.[1] || 0);
    const total = Number(match?.[2] || 0);
    return {
      atLast: total > 0 && current === total,
      identity: `${active?.dataset.searchTargetId || ''}:${current}/${total}`,
    };
  });

  for (let i = 0; i < 50; i += 1) {
    const before = await snapshot();
    if (before.atLast) return;
    await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
    await page.waitForFunction((identity) => {
      const active = document.querySelector('.searchMark.activeSearchMark');
      const match = document.querySelector('.searchInlineCount')?.textContent.match(/^(\d+) \/ (\d+)/);
      const current = Number(match?.[1] || 0);
      const total = Number(match?.[2] || 0);
      return `${active?.dataset.searchTargetId || ''}:${current}/${total}` !== identity;
    }, before.identity);
  }
  assert.fail('search navigation did not reach the last live mark');
}

async function openColdLongSearchInspector(page) {
  await assertEventCount(page, 150);
  const committedSearch = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '150';
  });
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('37 occurrences'));
  await committedSearch;
  await page.locator('#searchInput').blur();
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail...'));
  return page.locator('#timeline .event.selected').getAttribute('data-event-id');
}

async function makeLongCodexHome(t, options = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-'));
  const longRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'edededed-eded-eded-eded-edededededed';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '11');
  const file = path.join(dir, `rollout-2026-06-11T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(longRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    {
      timestamp: '2026-06-11T09:00:00.000Z',
      type: 'session_meta',
      payload: { id: sessionId, cwd: longRepoRoot },
    },
  ];
  if (options.includeCommandDetailNeedles) {
    rows.push(
      {
        timestamp: '2026-06-11T09:00:00.100Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_begin',
          call_id: 'call-needle-detail',
          command: ['powershell.exe', '-Command', 'Write-Output detail'],
          cwd: longRepoRoot,
        },
      },
      {
        timestamp: '2026-06-11T09:00:00.200Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          call_id: 'call-needle-detail',
          command: ['powershell.exe', '-Command', 'Write-Output detail'],
          cwd: longRepoRoot,
          stdout: 'needle detail needle detail needle detail',
          stderr: '',
          exit_code: 0,
          status: 'completed',
        },
      },
    );
  }
  if (options.includeFoldableSearchTargets) {
    for (let i = 0; i < 3; i += 1) {
      rows.push(
        {
          timestamp: `2026-06-11T09:00:0${i + 1}.100Z`,
          type: 'event_msg',
          payload: {
            type: 'exec_command_begin',
            call_id: `call-foldable-${i}`,
            command: ['powershell.exe', '-Command', `Write-Output ordinary-${i}`],
            cwd: longRepoRoot,
          },
        },
        {
          timestamp: `2026-06-11T09:00:0${i + 1}.200Z`,
          type: 'event_msg',
          payload: {
            type: 'exec_command_end',
            call_id: `call-foldable-${i}`,
            command: ['powershell.exe', '-Command', `Write-Output ordinary-${i}`],
            cwd: longRepoRoot,
            stdout: `fold only target ${i} ${'ordinary output '.repeat(80)}fold only target ${i}`,
            stderr: '',
            exit_code: 0,
            status: 'completed',
          },
        },
      );
    }
  }
  const eventCount = options.eventCount || 180;
  const needleText = Array.from({ length: options.needleRepeats || 1 }, () => 'needle').join(' ');
  const needleIndices = Array.isArray(options.needleIndices) ? new Set(options.needleIndices) : null;
  for (let i = 0; i < eventCount; i += 1) {
    rows.push({
      timestamp: `2026-06-11T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      type: 'response_item',
      payload: {
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Long timeline row ${i} ${(needleIndices ? needleIndices.has(i) : i % 17 === 0) ? needleText : 'ordinary'}` }],
      },
    });
  }
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: longRepoRoot, sessionId };
}

async function makeTransitionProfileIndex(t, options = {}) {
  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-transition-'));
  const fixture = await createTimelineProfileFixture(baseDir, {
    eventCount: options.eventCount || 700,
    searchableTextBytes: options.searchableTextBytes || 512,
    hitPositions: options.hitPositions || [650],
    commonTermEvery: options.commonTermEvery || 1,
    secondaryEventCount: options.secondaryEventCount || 40,
  });
  t.after(() => fsp.rm(baseDir, { recursive: true, force: true }));
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  return { fixture, index };
}

async function makeCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-'));
  const codeModeRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '15');
  const file = path.join(dir, `rollout-2026-07-15T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(codeModeRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-15T01:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: codeModeRepoRoot } },
    { timestamp: '2026-07-15T01:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect Code Mode hierarchy.' }] } },
    { timestamp: '2026-07-15T01:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-hierarchy', turn_id: 'turn-code-mode', input: 'const result = await tools.wait_agent({ timeout_ms: 1000 }); text(result);' } },
    { timestamp: '2026-07-15T01:00:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-hierarchy', turn_id: 'turn-code-mode', output: 'Script running with cell ID 7373\nInitial output' } },
    { timestamp: '2026-07-15T01:00:04.000Z', type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait-browser-1', turn_id: 'turn-code-mode', arguments: '{"cell_id":"7373"}' } },
    { timestamp: '2026-07-15T01:00:05.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-browser-1', turn_id: 'turn-code-mode', output: 'Script running with cell ID 7373\nIntermediate output' } },
    { timestamp: '2026-07-15T01:00:06.000Z', type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait-browser-2', turn_id: 'turn-code-mode', arguments: '{"cell_id":"7373"}' } },
    { timestamp: '2026-07-15T01:00:07.000Z', type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'nested-browser-hierarchy', turn_id: 'turn-code-mode', tool_name: 'fixture', status: 'completed' } },
    { timestamp: '2026-07-15T01:00:08.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-browser-2', turn_id: 'turn-code-mode', output: [{ type: 'input_text', text: 'Script completed\nWall time 3.3 seconds\nOutput:\n' }, { type: 'input_text', text: 'Exit code: 0\nOutput:\n\u001b[32;1mFinal browser output\u001b[0m' }] } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: codeModeRepoRoot };
}

async function makeContextCodeModeCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-context-'));
  const contextRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'cacacaca-caca-caca-caca-cacacacacaca';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '22');
  const file = path.join(dir, `rollout-2026-07-22T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(contextRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    { timestamp: '2026-07-22T01:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: contextRepoRoot } },
    { timestamp: '2026-07-22T01:00:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-browser-context', turn_id: 'turn-context', input: "const value = await tools.fixture({ status: 'failed' }); text(value);" } },
    { timestamp: '2026-07-22T01:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-browser-context', turn_id: 'turn-context', output: 'Script running with cell ID 4242\nexec-context-output' } },
    { timestamp: '2026-07-22T01:00:03.000Z', type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait-browser-context', turn_id: 'turn-context', arguments: '{"cell_id":"4242"}' } },
    { timestamp: '2026-07-22T01:00:04.000Z', type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'nested-browser-context', turn_id: 'turn-context', tool_name: 'nested-context-token', status: 'failed' } },
    { timestamp: '2026-07-22T01:00:05.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-browser-context', turn_id: 'turn-context', output: 'Script completed\ncontext-wait-output' } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: contextRepoRoot, sessionId };
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

async function makeCodeModeSearchPreviewCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-code-mode-search-'));
  const searchRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'dfdfdfdf-dfdf-dfdf-dfdf-dfdfdfdfdfdf';
  const dir = path.join(codexHome, 'sessions', '2026', '07', '16');
  const file = path.join(dir, `rollout-2026-07-16T09-30-00-${sessionId}.jsonl`);
  await fsp.mkdir(searchRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const singleSource = "const plan = await tools.update_plan({ plan: [{ step: 'Visible single request', status: 'pending' }] }); text(plan);";
  const multiSource = [
    "const plan = await tools.update_plan({ plan: [{ step: 'Visible multi request', status: 'pending' }] });",
    "const command = await tools.shell_command({ command: 'Write-Output visible-multi-command' });",
    'text(plan);',
    'text(command);',
  ].join('\n');
  const rawSource = [
    'const args = { plan: [] };',
    'const plan = await tools.update_plan(args);',
    'const goal = await tools.get_goal(args);',
    "const hidden = 'raw source navigation needle';",
    'text(plan);',
  ].join('\n');
  const rows = [
    { timestamp: '2026-07-16T01:30:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: searchRepoRoot } },
    { timestamp: '2026-07-16T01:30:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-search-single', input: singleSource } },
    { timestamp: '2026-07-16T01:30:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-search-single', output: 'Script completed\nOutput:\n{"message":"single result navigation needle"}' } },
    { timestamp: '2026-07-16T01:30:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-search-multi', input: multiSource } },
    { timestamp: '2026-07-16T01:30:04.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-search-multi', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: '{"message":"multi result navigation needle"}' }, { type: 'input_text', text: 'Exit code: 0\nOutput:\nordinary output' }] } },
    { timestamp: '2026-07-16T01:30:05.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-search-raw', input: rawSource } },
  ];
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: searchRepoRoot, sessionId };
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

async function makeHookCodexHome(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-hook-'));
  const hookRepoRoot = path.join(codexHome, 'repo');
  const sessionId = 'abababab-abab-abab-abab-abababababab';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '12');
  const file = path.join(dir, `rollout-2026-06-12T09-00-00-${sessionId}.jsonl`);
  await fsp.mkdir(hookRepoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const rows = [
    {
      timestamp: '2026-06-12T09:00:00.000Z',
      type: 'session_meta',
      payload: { id: sessionId, cwd: hookRepoRoot },
    },
  ];
  for (let i = 0; i < 170; i += 1) {
    rows.push({
      timestamp: `2026-06-12T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      type: 'response_item',
      payload: {
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Catalog seed row ${i}` }],
      },
    });
  }
  rows.push(
    {
      timestamp: '2026-06-12T09:03:00.000Z',
      type: 'event_msg',
      payload: { type: 'hook_begin', call_id: 'call-hook', tool_name: 'pre_apply_hook', hook: 'pre-apply' },
    },
    {
      timestamp: '2026-06-12T09:03:01.000Z',
      type: 'event_msg',
      payload: { type: 'hook_end', call_id: 'call-hook', tool_name: 'pre_apply_hook', status: 'completed' },
    },
  );
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return { codexHome, repoRoot: hookRepoRoot, sessionId };
}

test('browser locale bootstrap keeps narrow screens on sessions view', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { viewport: { width: 390, height: 760 }, locale: 'zh-CN', activeSessionState: 'attached' });

  await page.waitForFunction(() => document.body.dataset.mobileView === 'sessions');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');

  await fillSearch(page, 'patch');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'sessions');
});

test('browser locale localizes static shell and dirty profile dialog', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('logical events'));
  assert.equal(await page.locator('#dirtyProfileTitle').textContent(), 'Unsaved folding strategy changes');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Find in current session');
  assert.equal(await page.locator('#searchKindLabel').textContent(), 'Kind');
  assert.equal(await page.locator('.localeControl').isVisible(), false);
  assert.equal(await page.locator('#localeSelect').count(), 1);

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), '在当前 session 中查找');
  assert.equal(await page.locator('#searchKindLabel').textContent(), '类型');
  assert.equal(
    await page.locator('#searchKindSelect optgroup').first().getAttribute('label'),
    '对话与计划',
  );
  assert.equal(await page.locator('.mobileViewTab[data-mobile-view="events"]').textContent(), '事件');
  assert.equal(await page.locator('#searchStatusGoalGroup').getAttribute('label'), '目标生命周期');
  assert.equal(await page.locator('#searchStatusExecutionGroup').getAttribute('label'), '执行结果');
  assert.equal(await page.locator('#searchStatusEventGroup').getAttribute('label'), '事件生命周期');
  assert.equal(await page.locator('#searchStatusSelect option[value="complete"]').textContent(), '目标已完成');
  assert.equal(await page.locator('#searchStatusSelect option[value="completed"]').textContent(), '事件已完成');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /加载更多|已加载|加载中/);
  await fillSearch(page, 'zzzz-no-match');
  await page.waitForFunction(() => document.querySelector('[data-search-match-count]')?.textContent === '0 / 0 个目标');
  await fillSearch(page, '');

  await switchHiddenLocale(page, 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  await selectPrimarySession(page);
  const timelineHeaderText = await page.locator('#timeline .eventHeader').allTextContents();
  assert.equal(await page.locator('#timeline .eventHeader .channelChip').count(), 0);
  assert.doesNotMatch(timelineHeaderText.join('\n'), /(?:^|\s)\d+ raw(?:\s|$)|event_msg|response_item/);
  const messagesMetricTitle = await page.locator('.metric', { hasText: 'Messages' }).getAttribute('title');
  assert.match(messagesMetricTitle || '', /Switch to conversation reading folding strategy/);
  assert.equal((messagesMetricTitle || '').includes('切换到'), false);
  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.locator('#detail [data-profile-picker]').selectOption('conversation');
  await page.waitForSelector('#dirtyProfileDialog:not([hidden])');

  assert.equal(await page.locator('#dirtyProfileTitle').textContent(), 'Unsaved folding strategy changes');
  assert.equal(await page.locator('#dirtyProfileMessage').textContent(), 'Before switching strategies, save the current changes, discard them, or stay on the current strategy.');
  assert.equal(await page.locator('[data-dirty-profile-choice="save"]').textContent(), 'Save and switch');
  assert.equal(await page.locator('[data-dirty-profile-choice="discard"]').textContent(), 'Discard and switch');
  assert.equal(await page.locator('[data-dirty-profile-choice="cancel"]').textContent(), 'Cancel');
});

test('browser locale switch preserves unsaved folding draft', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');

  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');

  await expectInputValue(page, '#detail [data-profile-kind="command"]', 'expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));
});

test('browser presents Claude pointer fork context without child search or event ownership', async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-pointer-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const parentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sourceRecord = (sessionId, fields) => ({
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: claudeRepo,
    sessionId,
    version: '2.1.220',
    ...fields,
  });
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    sourceRecord(parentId, {
      type: 'user',
      parentUuid: null,
      message: { role: 'user', content: 'Inherited task' },
      uuid: 'pointer-parent-user',
      timestamp: '2026-07-31T12:00:00.000Z',
    }),
    sourceRecord(parentId, {
      type: 'assistant',
      parentUuid: 'pointer-parent-user',
      message: {
        id: 'pointer-parent-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Inherited answer' }],
      },
      uuid: 'pointer-parent-assistant',
      timestamp: '2026-07-31T12:00:01.000Z',
    }),
    sourceRecord(parentId, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'pointer-parent-assistant',
      content: '<command-name>/fork</command-name>',
      uuid: 'pointer-fork-command',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    sourceRecord(parentId, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'pointer-fork-command',
      content: '<local-command-stdout>session waiting for a prompt · Pointer child ⑂ · bbbbbbbb</local-command-stdout>',
      uuid: 'pointer-fork-output',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    sourceRecord(parentId, {
      type: 'user',
      parentUuid: 'pointer-fork-output',
      message: { role: 'user', content: 'Parent-only continuation' },
      uuid: 'pointer-parent-after-fork',
      timestamp: '2026-07-31T12:00:03.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Pointer child ⑂', sessionId: childId },
    { type: 'agent-name', agentName: 'Pointer child ⑂', sessionId: childId },
  ]);

  const index = await buildClaudeIndex({ repoRoot: claudeRepo, claudeHome });
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${analyzerSessionId(childId)}"]`).click();

  const context = page.locator('[data-inherited-context]');
  await context.waitFor();
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);
  assert.match(await page.locator('.sessionHeader').innerText(), /Pointer-backed fork/);
  assert.match(await page.locator('.sessionHeader').innerText(), /Waiting for prompt/);
  assert.match(await context.innerText(), /2 parent Raw Records at the fork point support 2 Main and 0 Protocol events/);
  assert.match(await context.innerText(), /Fork point pointer-/);

  await context.locator('summary').click();
  assert.equal(await context.locator('.inheritedContextEvent').count(), 2);
  assert.match(await context.innerText(), /Inherited task/);
  assert.match(await context.innerText(), /Inherited answer/);
  assert.doesNotMatch(await context.innerText(), /Parent-only continuation/);

  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('q') === 'Inherited task';
  });
  await fillSearch(page, 'Inherited task');
  await searchResponse;
  await waitForNoSearchMarks(page);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 0);

  const parentTimelinePath = `/api/sessions/${encodeURIComponent(analyzerSessionId(parentId))}/timeline`;
  let signalParentTimeline;
  let releaseParentTimeline;
  const parentTimelineStarted = new Promise((resolve) => { signalParentTimeline = resolve; });
  const parentTimelineRelease = new Promise((resolve) => { releaseParentTimeline = resolve; });
  await page.route((url) => new URL(String(url)).pathname === parentTimelinePath, async (route) => {
    signalParentTimeline();
    await parentTimelineRelease;
    await route.continue();
  });
  const parentTimelineResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === parentTimelinePath
  ));

  await context.getByRole('button', { name: 'Open parent session' }).click();
  try {
    await parentTimelineStarted;
    await page.waitForFunction(() => document.querySelector('.sessionHeader h2')?.textContent === 'Inherited task');
    assert.equal(await page.locator('[data-inherited-context]').count(), 0);
  } finally {
    releaseParentTimeline();
  }
  await parentTimelineResponse;
});

test('browser Raw refs preserve malformed Claude source text instead of rendering null', async (t) => {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-malformed-browser-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const claudeRepo = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const sessionId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  const file = path.join(container, `${sessionId}.jsonl`);
  await fsp.mkdir(claudeRepo, { recursive: true });
  await writeJsonl(file, [{
    type: 'user',
    message: { role: 'user', content: 'Inspect malformed evidence' },
    cwd: claudeRepo,
    sessionId,
    uuid: 'malformed-parent-user',
    timestamp: '2026-07-31T12:30:00.000Z',
  }]);
  const malformedLine = '{"type":"assistant","message":';
  await fsp.appendFile(file, `${malformedLine}\n`, 'utf8');

  const index = await buildClaudeIndex({ repoRoot: claudeRepo, claudeHome });
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator('#layerSelect').selectOption('protocol');
  await expectInputValue(page, '#layerSelect', 'protocol');
  const eventId = `${analyzerSessionId(sessionId)}:logical:protocol:2`;
  const malformedEvent = page.locator(`#timeline .event[data-event-id="${eventId}"]`);
  await malformedEvent.waitFor();
  await malformedEvent.click();
  await waitForDetailView(page, 'inspector');
  await page.locator('#detail [data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading...'));
  assert.equal((await page.locator('#detail .rawRefsView pre').textContent()).trim(), malformedLine);
});

test('browser groups derived sessions under their parent and collapses them by default', async (t) => {
  const index = await buildFixtureIndex();
  const childSessionId = '33333333-3333-3333-3333-333333333333';
  const orphanReviewSessionId = '88888888-8888-8888-8888-888888888888';
  const normalForkSessionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const expectedChildCount = index.sessions.filter((session) => session.parentSessionId === primaryFixtureSessionId).length;
  const { page } = await openApp(t, index, { locale: 'en', skipProjectReindex: true });

  const parentBranch = page.locator(`[data-session-branch-id="${primaryFixtureSessionId}"]`);
  const toggle = parentBranch.locator(`:scope > .sessionRow [data-session-children-toggle="${primaryFixtureSessionId}"]`);
  const children = parentBranch.locator(':scope > .sessionChildren');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.match(await toggle.getAttribute('aria-label'), new RegExp(`Show ${expectedChildCount} child sessions`));
  assert.equal((await toggle.textContent()).trim(), `${expectedChildCount} child sessions`);
  assert.equal(await toggle.locator('.sessionChildrenChevron').getAttribute('aria-hidden'), 'true');
  const bridgePlacement = await parentBranch.locator(':scope > .sessionRow').evaluate((row) => {
    const card = row.querySelector('.sessionItem').getBoundingClientRect();
    const control = row.querySelector('.sessionChildrenToggle').getBoundingClientRect();
    return {
      centerDelta: Math.abs((card.left + card.right) / 2 - (control.left + control.right) / 2),
      edgeDelta: Math.abs(card.bottom - (control.top + control.bottom) / 2),
    };
  });
  assert.ok(bridgePlacement.centerDelta <= 1, `expected centered bridge, got ${bridgePlacement.centerDelta}`);
  assert.ok(bridgePlacement.edgeDelta <= 1, `expected bottom-edge bridge, got ${bridgePlacement.edgeDelta}`);
  assert.equal(await children.getAttribute('hidden'), '');
  assert.equal(await page.locator(`[data-session-id="${orphanReviewSessionId}"]`).isVisible(), true);
  assert.equal(await page.locator(`[data-session-id="${normalForkSessionId}"]`).isVisible(), true);

  await toggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await children.getAttribute('hidden'), null);
  const child = children.locator(`[data-session-id="${childSessionId}"]`);
  assert.equal(await child.isVisible(), true);
  assert.match(await child.textContent(), /Subagent Fixture.*from/s);

  await child.click();
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, childSessionId);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
});

test('browser uses singular child session labels for one derived child', async (t) => {
  const index = await buildFixtureIndex();
  const childSessionId = '33333333-3333-3333-3333-333333333333';
  index.sessions = index.sessions.filter(
    (session) => session.parentSessionId !== primaryFixtureSessionId || session.id === childSessionId,
  );
  const { page } = await openApp(t, index, { locale: 'en', skipProjectReindex: true });

  const toggle = page.locator(`[data-session-children-toggle="${primaryFixtureSessionId}"]`);
  assert.equal((await toggle.textContent()).trim(), '1 child session');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show 1 child session');

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-label'), 'Hide 1 child session');
});

test('browser locale switch reloads cached expanded event detail', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  const detailResponseFor = (locale) => (response) => {
    const parsed = new URL(response.url());
    return parsed.pathname.includes('/events/')
      && parsed.pathname.endsWith('/detail')
      && parsed.searchParams.get('locale') === locale
      && response.status() === 200;
  };

  const event = page.locator('#timeline .event.kind-command').first();
  await Promise.all([
    page.waitForResponse(detailResponseFor('en')),
    event.click(),
  ]);
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody');

  await Promise.all([
    page.waitForResponse(detailResponseFor('zh-CN')),
    switchHiddenLocale(page, 'zh-CN'),
  ]);
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody');
});

test('browser single-tool Code Mode keeps native request and operation output primary while moving trace to inspector', async (t) => {
  const fixture = await makeCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = Array.from(index.sessionsById.values())[0];
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
  assert.match(await page.locator('#detail .inspectorDetailBody').textContent(), /Operation metadata.*Poll count.*2.*Projection evidence.*wait_agent.*Result association note.*No result output matched the supported shape.*Code Mode source.*Execution trace.*Observed nested activity.*MCP tool/s);
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
  const localizedInspectorTrace = page.locator('#detail .codeModeTrace');
  await localizedInspectorTrace.locator('summary').click();
  assert.notEqual(await localizedInspectorTrace.getAttribute('open'), null);
  assert.match(await localizedInspectorTrace.textContent(), /执行阶段.*Initial output.*等待阶段 1.*Intermediate output.*等待阶段 2/s);
  assert.equal((await localizedInspectorTrace.textContent()).includes('Final browser output'), false);
});

test('browser nested Code Mode context reveals a distinct parent row without changing search owners or fold overrides', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = index.sessionsById.get(fixture.sessionId);
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

test('browser nested Code Mode context late responses are invalidated by same-source detail, fold, and profile transitions', async (t) => {
  const fixture = await makeContextCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = index.sessionsById.get(fixture.sessionId);
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
});

test('browser Code Mode raw fallback keeps a shared origin tag instead of the outer exec tool tag', async (t) => {
  const fixture = await makeRawCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = Array.from(index.sessionsById.values())[0];
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
  const session = Array.from(index.sessionsById.values())[0];
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
  const session = Array.from(index.sessionsById.values())[0];
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
  const session = Array.from(index.sessionsById.values())[0];
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
  assert.match(await multiPreview.textContent(), /声明顺序.*计划更新.*1 个步骤.*Inspect multi.*终端命令.*Write-Output multi/s);
  assert.doesNotMatch(await requestOnlyEvent.locator('.eventHeader').textContent(), /结果输出|未关联输出/);
  assert.match(await requestOnlyPreview.textContent(), /请求.*1 个步骤.*Request only/s);
});

test('browser search-hit snippets stay navigable ahead of every folded Code Mode preview', async (t) => {
  const fixture = await makeCodeModeSearchPreviewCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const session = index.sessionsById.get(fixture.sessionId);
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
  const session = Array.from(index.sessionsById.values())[0];
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

test('browser topbar width priorities keep search, Layer, and folding controls responsive', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { viewport: { width: 1280, height: 900 }, locale: 'en' });

  const readLayout = () => page.locator('.searchbar').evaluate((searchbar) => {
    const rect = (selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      return { top: bounds.top, left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
    };
    return {
      project: rect('.projectHeader'),
      sessions: rect('.sessionsPane'),
      searchbar: rect('.searchbar'),
      search: rect('.searchField'),
      layer: rect('#layerSelect'),
      folds: rect('.foldControls'),
      detailControls: rect('.topbarDetailControls'),
      timeline: rect('.timelinePane'),
      detail: rect('.detailPane'),
    };
  });

  let layout = await readLayout();
  assert.ok(Math.abs(layout.project.left - layout.sessions.left) < 1
    && Math.abs(layout.project.right - layout.sessions.right) < 1,
  'project header should share the sessions workspace column');
  assert.ok(layout.search.width <= 760.5, `expected capped search width, got ${layout.search.width}`);
  assert.ok(Math.abs(layout.search.left - (layout.timeline.left + 16)) < 1,
    'search should align with the padded timeline content edge');
  assert.ok(layout.search.left + layout.search.width <= layout.timeline.left + layout.timeline.width + 1,
    'search should not cross the timeline right boundary');
  assert.ok(Math.abs(layout.detailControls.left - layout.detail.left) < 1
    && Math.abs(layout.detailControls.right - layout.detail.right) < 1,
  'detail controls should occupy the same workspace column as the detail pane');
  assert.ok(layout.layer.width >= 129 && layout.layer.width <= 171);
  const topbarChrome = await page.locator('.topbar').evaluate((topbar) => {
    const chrome = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return { background: style.backgroundColor, borderLeft: style.borderLeftWidth, borderRight: style.borderRightWidth };
    };
    return {
      topbar: chrome('.topbar'),
      regions: ['.projectHeader', '.searchField', '.topbarDetailControls'].map(chrome),
    };
  });
  assert.notEqual(topbarChrome.topbar.background, 'rgba(0, 0, 0, 0)');
  assert.equal(topbarChrome.regions.every((region) => region.background === 'rgba(0, 0, 0, 0)'
    && region.borderLeft === '0px' && region.borderRight === '0px'), true,
  'workspace alignment should not visually split the topbar');

  await page.setViewportSize({ width: 820, height: 900 });
  layout = await readLayout();
  assert.ok(layout.search.top < layout.detailControls.top, 'search should occupy the first compact-medium row');
  assert.ok(layout.layer.left >= layout.detailControls.left && layout.layer.right <= layout.detailControls.right);
  assert.ok(layout.folds.width === 0
    || (layout.folds.left >= layout.detailControls.left && layout.folds.right <= layout.detailControls.right));
  assert.ok(Math.abs(layout.search.width - (layout.searchbar.width - 32)) < 2,
    'search should span the compact-medium workspace column with shared padding');

  await page.locator('#searchFilterBtn').click();
  const assistLayout = await page.locator('#searchAssist').evaluate((assist) => {
    const field = document.querySelector('.searchField').getBoundingClientRect();
    const bounds = assist.getBoundingClientRect();
    return { fieldWidth: field.width, assistWidth: bounds.width, aligned: Math.abs(field.left - bounds.left) < 2 };
  });
  assert.equal(assistLayout.aligned, true);
  assert.equal(Math.round(assistLayout.assistWidth), Math.round(Math.min(560, Math.max(500, assistLayout.fieldWidth))));
  await page.locator('#searchAssistClose').click();

  await fillSearch(page, 'patch');
  const resultsAlignment = await page.locator('#searchAssist').evaluate((assist) => {
    const input = document.querySelector('#searchInput').getBoundingClientRect();
    const metrics = document.querySelector('#searchMetricsPanel').getBoundingClientRect();
    return { inputLeft: input.left, metricsLeft: metrics.left, assistMode: assist.dataset.mode };
  });
  assert.equal(resultsAlignment.assistMode, 'results');
  assert.ok(Math.abs(resultsAlignment.inputLeft - resultsAlignment.metricsLeft) < 2,
    'results metrics should align with the free-text input');
  await page.locator('#searchInput').fill('');
  await page.locator('#searchInput').press('Escape');

  await page.setViewportSize({ width: 760, height: 900 });
  layout = await readLayout();
  assert.ok(layout.search.top < layout.detailControls.top && layout.layer.top >= layout.detailControls.top,
    'narrow controls should stack in priority order');
  assert.ok(Math.abs(layout.search.width - layout.layer.width) < 2);
  assert.ok(layout.folds.width === 0 || Math.abs(layout.layer.width - layout.folds.width) < 2);
});

test('browser search HUD starts in current-session mode with persistent global Layer context', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  assert.equal(await page.locator('body').getAttribute('data-search-scope'), 'session');
  assert.equal(await page.locator('#searchHudScopeValue').textContent(), 'session');
  await page.locator('#searchHudScope').click();
  assert.equal(await page.locator('#searchAssist').getByRole('button', { name: 'Current session' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#searchAssist').getByRole('button', { name: 'Entire project' }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Find in current session');
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');

  await fillSearch(page, 'definitely-no-search-hit');
  await page.locator('#searchInput').press('Escape');
  await page.waitForSelector('[data-search-project-fallback]');
  assert.equal(await page.getByRole('button', { name: 'Search entire project' }).count(), 1);

  await page.locator('[data-search-project-fallback]').click();
  await page.waitForFunction(() => document.body.dataset.searchScope === 'project');
  assert.equal(await page.locator('#searchHudScopeValue').textContent(), 'project');
  assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), 'Search the entire project');
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  await page.waitForFunction(() => document.querySelector('#timeline .projectSearchState')?.textContent.includes('No project events match this expression.'));
});

test('browser search parameter popover exposes direct fixed filters, Escape layers, and the global Layer shortcut', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await page.locator('#searchFilterBtn').click();
  assert.equal(await page.locator('#searchAssistHeading').textContent(), 'Search options');
  assert.equal(await page.locator('#searchResultsSection').isHidden(), true);
  assert.equal(await page.locator('#searchAssistFooter').isHidden(), true);
  assert.equal(await page.locator('[data-search-filter-row]').count(), 3);
  assert.equal(await page.locator('[data-search-filter-row][hidden]').count(), 0);
  assert.equal(await page.locator('[data-search-filter-row="file"] label').textContent(), 'Touched file');
  assert.equal(await page.locator('#searchFileInput').getAttribute('placeholder'), 'Any touched file');
  assert.equal(await page.locator('#searchKindSelect').evaluate((select) => document.activeElement === select), true);
  const mainKindOrder = await page.locator('#searchKindSelect option').evaluateAll((options) => (
    options.map((option) => option.value).filter((value) => [
      'user_message',
      'assistant_message',
      'command',
      'patch',
      'error',
      'warning',
      'reasoning',
    ].includes(value))
  ));
  assert.deepEqual(
    mainKindOrder,
    ['user_message', 'assistant_message', 'command', 'patch', 'error', 'warning', 'reasoning'],
    'Main Kind options should follow the folding editor semantic order',
  );
  assert.deepEqual(
    await page.locator('#searchKindSelect optgroup').evaluateAll((groups) => groups.map((group) => group.label)),
    ['Conversation and plans', 'Work and tools', 'Issues and risks', 'Agent and system events'],
  );
  assert.equal(
    await page.locator('#searchKindSelect optgroup[label="Work and tools"] option[value="command"]').count(),
    1,
  );
  assert.equal(
    await page.locator('#searchKindSelect optgroup[label="Issues and risks"] option[value="error"]').count(),
    1,
  );
  assert.equal(
    await page.locator('#searchKindSelect optgroup[label="Agent and system events"] option[value="reasoning"]').count(),
    1,
  );

  const filterLayout = await page.locator('#searchFilterRows').evaluate((filters) => {
    const kind = filters.querySelector('[data-search-filter-row="kind"]')?.getBoundingClientRect();
    const status = filters.querySelector('[data-search-filter-row="status"]')?.getBoundingClientRect();
    const file = filters.querySelector('[data-search-filter-row="file"]')?.getBoundingClientRect();
    return {
      kindTop: kind?.top || 0,
      statusTop: status?.top || 0,
      kindBottom: kind?.bottom || 0,
      fileTop: file?.top || 0,
    };
  });
  assert.ok(Math.abs(filterLayout.kindTop - filterLayout.statusTop) < 2, 'Kind and Status should share one row');
  assert.ok(filterLayout.fileTop >= filterLayout.kindBottom, 'File should span the next row');

  await page.locator('#searchFileInput').fill('definitely-no-touched-file');
  assert.equal(await page.locator('#searchFileSuggestions').isVisible(), true);
  assert.equal(await page.locator('#searchFileSuggestions .fileSuggestionEmpty').textContent(), 'No matching touched files.');
  assert.equal(await page.locator('#searchFileInput').getAttribute('aria-expanded'), 'true');
  const suggestionOverlay = await page.locator('#searchFileSuggestions').evaluate((list) => {
    const input = document.querySelector('#searchFileInput').getBoundingClientRect();
    const rect = list.getBoundingClientRect();
    return {
      position: getComputedStyle(list).position,
      aligned: Math.abs(rect.left - input.left) < 2 && Math.abs(rect.width - input.width) < 2,
      insideViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
    };
  });
  assert.equal(suggestionOverlay.position, 'fixed');
  assert.equal(suggestionOverlay.aligned, true);
  assert.equal(suggestionOverlay.insideViewport, true);
  await page.locator('#searchFileInput').press('Escape');
  assert.equal(await page.locator('#searchFileSuggestions').isHidden(), true);
  await page.locator('#searchFileInput').fill('');

  await addSearchFilter(page, 'kind', 'patch');
  await addSearchFilter(page, 'status', 'failed');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 2');
  assert.match(await page.locator('#searchFilterBtn').getAttribute('title'), /Kind: Patch/);
  assert.match(await page.locator('#searchFilterBtn').getAttribute('title'), /Status: Failed/);

  await page.locator('#searchStatusSelect').selectOption('');
  await page.waitForFunction(() => document.querySelector('#searchFilterCount')?.textContent === 'Filters · 1');
  assert.equal(await page.locator('[data-search-filter-row="status"]').isVisible(), true);

  await page.locator('#searchLayerShortcut').click();
  assert.equal(await page.locator('#searchAssist').isHidden(), true);
  assert.equal(await page.locator('#layerSelect').evaluate((select) => document.activeElement === select), true);

  await page.locator('#searchFilterBtn').click();
  await page.locator('#searchClearAllBtn').click();
  await expectInputValue(page, '#searchInput', '');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters');
  assert.equal(await page.locator('#searchAssist').isHidden(), true);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);

  await page.locator('#searchHudScope').click();
  assert.equal(await page.locator('button[data-search-scope="session"]').evaluate((button) => document.activeElement === button), true);
  await page.locator('#searchAssistClose').click();
  assert.equal(await page.locator('#searchHudScope').evaluate((button) => document.activeElement === button), true);

});

test('browser search HUD stays inert while the analyzer is disabled for project selection', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await page.locator('#searchFilterBtn').click();
  assert.equal(await page.locator('#searchAssist').isVisible(), true);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  assert.equal(await page.locator('#searchAssist').evaluate((popover) => popover.hidden), true);
  for (const selector of ['#searchHudScope', '#searchFilterBtn', '#searchInput']) {
    assert.equal(await page.locator(selector).evaluate((control) => control.disabled), true);
  }

  for (const selector of ['#searchHudScope', '#searchFilterBtn']) {
    await page.locator(selector).dispatchEvent('click');
    assert.equal(await page.locator('#searchAssist').evaluate((popover) => popover.hidden), true);
  }
  await page.locator('#searchInput').evaluate((input) => {
    input.value = 'disabled mutation';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectInputValue(page, '#searchInput', '');
  assert.equal(await page.locator('#searchAssist').evaluate((popover) => popover.hidden), true);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  assert.equal(await page.locator('#searchAssist').isVisible(), false);
  for (const selector of ['#searchHudScope', '#searchFilterBtn', '#searchInput']) {
    assert.equal(await page.locator(selector).evaluate((control) => control.disabled), false);
  }
});

test('browser project chrome separates project switching from session-list reindexing', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedPaths } = await openApp(t, index, { locale: 'en' });
  const refreshButton = page.locator('#projectRefreshBtn');

  assert.equal(await page.locator('.projectMark').isVisible(), true);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Change project');
  assert.equal(await refreshButton.getAttribute('title'), 'Reindex current project');
  assert.equal(await refreshButton.evaluate((button) => button.parentElement?.classList.contains('sessionListTitleGroup')), true);

  const selectedSessionId = await page.locator('.sessionItem.active').getAttribute('data-session-id');
  let releasePost;
  let markPostStarted;
  const postGate = new Promise((resolve) => {
    releasePost = resolve;
  });
  const postStarted = new Promise((resolve) => {
    markPostStarted = resolve;
  });
  await page.route('**/api/project', async (route) => {
    markPostStarted();
    await postGate;
    await route.continue();
  });

  await refreshButton.click();
  await postStarted;
  assert.equal(await refreshButton.isDisabled(), true);
  assert.equal(await refreshButton.getAttribute('data-refreshing'), 'true');
  assert.equal(await page.locator('#projectSwitchControl').isDisabled(), true);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), selectedSessionId);
  assert.match(await page.locator('#projectRefreshStatus').textContent(), /Reindexing|Preparing/);

  releasePost();
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false');
  assert.equal(await page.locator('#projectRefreshStatus').textContent(), 'Project reindexed');
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), selectedSessionId);
  assert.equal(requestedPaths.includes('/api/project'), true);
});

test('browser chooser switches transcript source and refreshes project candidates', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, { server: { claudeHome: fixture.claudeHome } });

  await waitForProjectRoot(page, repoRoot);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixtureCodexHome));
  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to Claude Code');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to Codex');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Codex');
  await waitForProjectRoot(page, repoRoot);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
});

test('browser chooser shows the server source before any switch', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { source: 'claude-code', claudeHome: fixture.claudeHome },
  });

  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  assert.equal(await page.locator('#projectSourceAction').textContent(), 'Switch to Codex');
  const chooserOrder = await page.locator('.projectChooserHeader').evaluate((header) => (
    [...header.children].map((child) => child.id || child.tagName)
  ));
  assert.ok(chooserOrder.indexOf('projectStatus') < chooserOrder.indexOf('projectProgress'));
  assert.ok(chooserOrder.indexOf('projectProgress') < chooserOrder.indexOf('projectSourceSwitch'));
});

test('browser chooser keeps sparse project rows content-sized', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { source: 'claude-code', claudeHome: fixture.claudeHome },
  });

  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(await page.locator('.projectItem').count(), 1);
  await page.locator('#projectHomeEditor summary').click();

  const layout = await page.locator('#projectList').evaluate((list) => {
    const item = list.querySelector('.projectItem');
    const main = item?.querySelector('.projectMain');
    return {
      listHeight: list.getBoundingClientRect().height,
      itemHeight: item?.getBoundingClientRect().height || 0,
      mainHeight: main?.getBoundingClientRect().height || 0,
    };
  });
  assert.ok(layout.listHeight > layout.itemHeight + 80, 'fixture should leave unused vertical space below the only project');
  assert.ok(layout.itemHeight <= 100, `project row should stay content-sized, got ${layout.itemHeight}px`);
  assert.ok(layout.mainHeight <= 64, `project main content should not stretch, got ${layout.mainHeight}px`);
});

test('browser last-selected repo is scoped per source and migrates legacy Codex storage', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot': repoRoot },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  const migrated = await page.evaluate(() => ({
    legacy: localStorage.getItem('sessionAnalyzer.repoRoot'),
    codex: localStorage.getItem('sessionAnalyzer.repoRoot.codex'),
    claude: localStorage.getItem('sessionAnalyzer.repoRoot.claude-code'),
  }));
  assert.equal(migrated.legacy, null);
  assert.equal(migrated.codex, repoRoot);
  assert.equal(migrated.claude, null);

  await page.evaluate(() => localStorage.setItem('sessionAnalyzer.repoRoot', 'stale-legacy-repo'));
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.waitForFunction(() => localStorage.getItem('sessionAnalyzer.repoRoot') === null);
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(await page.locator('.projectItem.lastSelected').count(), 0);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Select project');
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.repoRoot.claude-code')), null);
});

test('browser home directory edits preserve or drop Return by active identity', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
      });
    },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.locator('#projectHomeEditor summary').click();

  const inactiveClaudeHome = path.join(fixture.claudeHome, 'inactive-claude');
  await page.locator('#projectClaudeHomeInput').fill(inactiveClaudeHome);
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction((value) => document.querySelector('#projectClaudeHomeInput')?.value === value, inactiveClaudeHome);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');

  const emptyCodexHome = path.join(fixture.claudeHome, 'empty-codex');
  await page.locator('#projectCodexHomeInput').fill(emptyCodexHome);
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceConfirm')?.hidden === false);
  assert.match(await page.locator('#projectSourceConfirm').textContent(), /current project/);
  const sourcePostsBeforeConfirm = sourcePosts;
  await page.locator('#projectCodexHomeInput').fill('relative-codex-home');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Home paths must be absolute'));
  assert.equal(sourcePosts, sourcePostsBeforeConfirm);

  await page.locator('#projectCodexHomeInput').fill(emptyCodexHome);
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('.projectSwitchHint')?.textContent === 'Select project');
  await page.waitForFunction(() => document.querySelectorAll('.projectItem').length === 0);
});

test('browser re-enables source controls and reconciles discovery after a failed source commit', async (t) => {
  let releaseFirstFull;
  const firstFullGate = new Promise((resolve) => {
    releaseFirstFull = resolve;
  });
  let fullCalls = 0;
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
      });
      await p.route('**/api/source', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":"synthetic failure"}',
        });
      });
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          await firstFullGate;
        }
        await route.continue();
      });
    },
  });

  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceAction')?.textContent === 'Confirm switch to Claude Code');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Source switch failed'));
  assert.equal(sourcePosts, 1);
  assert.equal(await page.locator('#projectSourceAction').isDisabled(), false);
  assert.equal(await page.locator('#projectSourceCancel').isHidden(), true);
  releaseFirstFull();
  await waitForProjectRoot(page, repoRoot);
  assert.ok(fullCalls >= 2, 'failed source commit should start a successor discovery');
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
});

test('browser reconciles lost source mutation responses against authoritative state', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: path.join(fixture.claudeHome, 'unused') },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      await p.route('**/api/source', async (route) => {
        sourcePosts += 1;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort('connectionreset');
      });
    },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.locator('#projectHomeEditor summary').click();

  await page.locator('#projectClaudeHomeInput').fill(fixture.claudeHome);
  const inactiveHomeDiscovery = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/projects' && !url.searchParams.has('summary') && response.status() === 200;
  });
  await page.locator('#projectHomeApplyBtn').click();
  await inactiveHomeDiscovery;
  assert.equal(sourcePosts, 1);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');
  assert.equal(await page.locator('#projectSourceError').textContent(), '');

  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(sourcePosts, 2);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Select project');
  assert.equal(await page.locator('#projectSourceError').textContent(), '');
});

test('browser locks Return, project selection, and home inputs while a source mutation is in flight', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseSourcePost;
  const sourcePostGate = new Promise((resolve) => {
    releaseSourcePost = resolve;
  });
  let markSourcePostStarted;
  const sourcePostStarted = new Promise((resolve) => {
    markSourcePostStarted = resolve;
  });
  let projectPosts = 0;
  let stateRequests = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/project' && request.method() === 'POST') projectPosts += 1;
        if (url.pathname === '/api/state' && request.method() === 'GET') stateRequests += 1;
      });
      await p.route('**/api/source', async (route) => {
        markSourcePostStarted();
        await sourcePostGate;
        await route.continue();
      });
    },
  });
  t.after(() => releaseSourcePost());

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await waitForProjectRoot(page, repoRoot);
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await sourcePostStarted;

  const projectPostsBeforeSyntheticClicks = projectPosts;
  const stateRequestsBeforeSyntheticClicks = stateRequests;
  const projectRows = page.locator('.projectItem[data-project-root]');
  const projectRowCount = await projectRows.count();
  assert.ok(projectRowCount > 0);
  assert.equal(await page.locator('.projectItem[data-project-root]:disabled').count(), projectRowCount);
  assert.equal(await page.locator('#projectSwitchControl').isDisabled(), true);
  assert.equal(await page.locator('#projectCodexHomeInput').isDisabled(), true);
  assert.equal(await page.locator('#projectClaudeHomeInput').isDisabled(), true);
  await projectRows.first().dispatchEvent('click');
  await page.locator('#projectSwitchControl').dispatchEvent('click');
  const lateClaudeDraft = path.join(fixture.claudeHome, 'late-unsent-draft');
  await page.locator('#projectClaudeHomeInput').evaluate((input, value) => {
    input.disabled = false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, lateClaudeDraft);
  await page.waitForTimeout(50);
  assert.equal(projectPosts, projectPostsBeforeSyntheticClicks);
  assert.equal(stateRequests, stateRequestsBeforeSyntheticClicks);
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'selecting');

  releaseSourcePost();
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(await page.locator('.projectItem:disabled').count(), 0);
  assert.equal(await page.locator('#projectSwitchControl').isDisabled(), false);
  assert.equal(await page.locator('#projectClaudeHomeInput').inputValue(), lateClaudeDraft);
});

test('browser ignores a non-409 failure from invalidated project discovery', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseObsoleteFull;
  const obsoleteFullGate = new Promise((resolve) => {
    releaseObsoleteFull = resolve;
  });
  let markObsoleteFullStarted;
  const obsoleteFullStarted = new Promise((resolve) => {
    markObsoleteFullStarted = resolve;
  });
  let markObsoleteFullSettled;
  const obsoleteFullSettled = new Promise((resolve) => {
    markObsoleteFullSettled = resolve;
  });
  let fullCalls = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          markObsoleteFullStarted();
          await obsoleteFullGate;
          await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"obsolete discovery failure"}' });
          markObsoleteFullSettled();
          return;
        }
        await route.continue();
      });
    },
  });
  t.after(() => releaseObsoleteFull());

  await obsoleteFullStarted;
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  const successorStatus = await page.locator('#projectStatus').textContent();

  releaseObsoleteFull();
  await obsoleteFullSettled;
  await page.waitForTimeout(100);
  assert.ok(fullCalls >= 2, 'source switch should start a successor discovery');
  assert.equal(await page.locator('#projectStatus').textContent(), successorStatus);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  await waitForProjectRoot(page, fixture.claudeRepo);
});

test('browser keeps home-directory edits while project discovery settles', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseFull;
  const fullGate = new Promise((resolve) => {
    releaseFull = resolve;
  });
  const typedCodexHome = path.join(fixture.claudeHome, 'typed-codex');
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        await fullGate;
        await route.continue();
      });
    },
  });

  await page.locator('#projectHomeEditor summary').click();
  await page.locator('#projectCodexHomeInput').fill(typedCodexHome);
  releaseFull();
  await page.waitForFunction(() => document.querySelectorAll('.projectItem[data-project-root]').length > 0);
  assert.equal(await page.locator('#projectCodexHomeInput').inputValue(), typedCodexHome);
});

test('browser shows empty-state guidance after project discovery fails', async (t) => {
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"synthetic failure"}' });
      });
    },
  });

  await page.waitForFunction(() => document.querySelector('#projectSourceKind')?.textContent.includes('Try switching to'));
  const emptySummary = page.locator('.projectSourceSummary[data-empty="true"]');
  await emptySummary.waitFor();
  assert.equal(await emptySummary.evaluate((element) => getComputedStyle(element).fontWeight), '600');
  assert.equal(await page.locator('.projectItem').count(), 0);
});

test('browser skips home-change confirmation for path-equivalent inputs', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.locator('#projectHomeEditor summary').click();
  const equivalentHome = process.platform === 'win32'
    ? `${fixtureCodexHome.toUpperCase()}\\`
    : `${fixtureCodexHome}/`;
  await page.locator('#projectCodexHomeInput').fill(equivalentHome);
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction((value) => document.querySelector('#projectCodexHomeInput')?.value === value, fixtureCodexHome);
  assert.equal(await page.locator('#projectSourceConfirm').isHidden(), true);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');
});

test('browser treats backslashes as literal characters in POSIX home paths', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  const posixCodexHome = '/home/me/.codex';
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        Object.assign(data, {
          sourceKind: 'codex',
          sourceHome: posixCodexHome,
          codexHome: posixCodexHome,
          claudeHome: '/home/me/.claude',
        });
        await route.fulfill({ response, json: data });
      });
      await p.route('**/api/source', async (route) => {
        sourcePosts += 1;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unexpected source mutation"}' });
      });
    },
  });

  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await page.waitForFunction((value) => document.querySelector('#projectCodexHomeInput')?.value === value, posixCodexHome);
  await page.locator('#projectHomeEditor summary').click();
  await page.locator('#projectCodexHomeInput').fill(`${posixCodexHome}\\`);
  await page.locator('#projectHomeApplyBtn').click();

  assert.equal(await page.locator('#projectSourceConfirm').isHidden(), false);
  assert.match(await page.locator('#projectSourceConfirm').textContent(), /current project/);
  assert.equal(sourcePosts, 0);
});

test('browser source switch carries unapplied home-directory edits', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: path.join(fixture.claudeHome, 'unused') },
  });
  await waitForProjectRoot(page, repoRoot);

  await page.locator('#projectHomeEditor summary').click();
  const draftClaudeHome = fixture.claudeHome;
  await page.locator('#projectClaudeHomeInput').fill(draftClaudeHome);
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  await page.waitForFunction((value) => document.querySelector('#projectClaudeHomeInput')?.value === value, draftClaudeHome);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(draftClaudeHome));
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
});

test('browser reapplies inactive home edits with a successor discovery while scan is in flight', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let releaseFirstFull;
  const firstFullGate = new Promise((resolve) => {
    releaseFirstFull = resolve;
  });
  let fullCalls = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          await firstFullGate;
        }
        await route.continue();
      });
    },
  });

  await page.locator('#projectHomeEditor summary').click();
  const inactiveHome = path.join(fixture.claudeHome, 'inactive-race');
  await page.locator('#projectClaudeHomeInput').fill(inactiveHome);
  const sourcePost = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/source'
    && response.request().method() === 'POST'
  ));
  await page.locator('#projectHomeApplyBtn').click();
  await sourcePost;
  releaseFirstFull();

  await waitForProjectRoot(page, repoRoot);
  await page.waitForFunction((value) => document.querySelector('#projectClaudeHomeInput')?.value === value, inactiveHome);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixtureCodexHome));
});

test('browser applies source config from a 202 indexing-job state', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let resolveIndex;
  const buildIndex = () => new Promise((resolve) => {
    resolveIndex = resolve;
  });
  const { page } = await openSourceSwitchChooser(t, {
    server: {
      source: 'claude-code',
      claudeHome: fixture.claudeHome,
      repo: fixture.claudeRepo,
      buildIndex,
    },
  });

  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  resolveIndex({
    repoRoot: fixture.claudeRepo,
    sourceKind: 'claude-code',
    sourceHome: fixture.claudeHome,
    codexHome: path.join(fixture.claudeHome, 'unused-codex'),
    claudeHome: fixture.claudeHome,
    generatedAt: new Date().toISOString(),
    totals: { sessionCount: 0, eventCount: 0, rawEventCount: 0 },
    eventKinds: { main: [], protocol: [], raw: [] },
    codeModeRequests: [],
    foldingProfiles: [],
    sessions: [],
  });
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
});

test('browser keeps discovery alive when source confirmation fails empty or relative home validation', async (t) => {
  let releaseFirstFull;
  const firstFullGate = new Promise((resolve) => {
    releaseFirstFull = resolve;
  });
  let fullCalls = 0;
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
      });
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          await route.continue();
          return;
        }
        fullCalls += 1;
        if (fullCalls === 1) {
          await firstFullGate;
        }
        await route.continue();
      });
    },
  });

  await page.locator('#projectHomeEditor summary').click();
  await page.locator('#projectClaudeHomeInput').fill('');
  await page.locator('#projectSourceAction').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Home paths must not be empty'));
  assert.equal(sourcePosts, 0);

  await page.locator('#projectClaudeHomeInput').fill('relative-claude-home');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Home paths must be absolute'));
  assert.equal(sourcePosts, 0);

  releaseFirstFull();
  await waitForProjectRoot(page, repoRoot);
  assert.equal(sourcePosts, 0);
});

test('browser reindex retries transient status and committed-session transport failures', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  let statusAttempts = 0;
  let sessionAttempts = 0;

  await page.route('**/api/project/status?*', async (route) => {
    statusAttempts += 1;
    if (statusAttempts === 1) {
      await route.abort('connectionrefused');
      return;
    }
    await route.continue();
  });
  await page.route('**/api/sessions?*', async (route) => {
    sessionAttempts += 1;
    if (sessionAttempts === 1) {
      await route.abort('connectionrefused');
      return;
    }
    await route.continue();
  });

  await page.locator('#projectRefreshBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectRefreshBtn')?.dataset.refreshing === 'false');

  assert.equal(await page.locator('#projectRefreshStatus').textContent(), 'Project reindexed');
  assert.ok(statusAttempts >= 2, 'status polling should retry after a transport failure');
  assert.ok(sessionAttempts >= 2, 'committed session loading should retry through the succeeded job');
});

test('browser project scope renders cards, aggregate summary, and filter-only results without jump targets', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await page.waitForFunction(() => document.querySelector('#timeline .projectSearchState')?.textContent.includes('Enter text or add a file'));
  assert.equal(await page.locator('[data-project-result-session-id]').count(), 0);
  assert.ok(await page.locator('[data-session-id]').count() > 0, 'empty project expression should show ordinary session rows');
  assert.equal(await page.locator('#detail').textContent(), '');

  await fillSearch(page, 'patch');
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('matching sessions'));
  assert.equal(await page.locator('#searchEnterHint').isVisible(), true);
  assert.equal(await page.locator('#searchEnterHint').textContent(), 'Press Enter to focus the first project result');

  const cards = await page.locator('[data-project-result-session-id]').evaluateAll((items) => items.map((item) => {
    const countText = item.querySelector('.projectResultCount')?.textContent || '';
    return {
      sessionId: item.dataset.projectResultSessionId,
      count: Number(countText.match(/\d+/)?.[0] || 0),
      text: item.textContent,
      highlighted: item.querySelectorAll('mark.projectSearchHighlight').length,
    };
  }));
  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => card.sessionId && card.count > 0));
  assert.ok(cards.some((card) => card.highlighted > 0), 'project snippets should highlight with project-only marks');
  assert.equal(await page.locator('.searchMark').count(), 0, 'project cards must not enter the session jump-target registry');
  assert.equal(await page.locator('[data-search-match-controls]').first().getAttribute('hidden'), null);
  assert.equal(await page.locator('[data-search-match-nav]').first().isHidden(), true);
  assert.match((await page.locator('.searchInlineCount').textContent()).trim(), /^\d+ sessions$/);

  const summary = await page.locator('#resultSummary').textContent();
  assert.match(summary, /^\d+ matching sessions · \d+ matching events$/);
  assert.equal(Number(summary.match(/^(\d+)/)?.[1] || 0), cards.length);
  assert.equal(Number(summary.match(/· (\d+) matching events/)?.[1] || 0), cards.reduce((sum, card) => sum + card.count, 0));
  assert.equal(requestedUrls.some((value) => {
    const url = new URL(value, 'http://local');
    return url.pathname === '/api/sessions'
      && url.searchParams.get('q') === 'patch'
      && url.searchParams.get('sort') === 'latest-match-desc'
      && url.searchParams.get('layer') === 'main';
  }), true);

  await page.locator('#searchInput').press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('[data-project-result-session-id]'));

  const statusProjectResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/sessions'
      && url.searchParams.get('status') === 'failed'
      && url.searchParams.get('sort') === 'latest-match-desc'
      && !url.searchParams.has('q');
  });
  await fillSearch(page, '');
  await addSearchFilter(page, 'status', 'failed');
  await statusProjectResponse;
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#searchFilterCount')?.textContent === 'Filters · 1');
  assert.equal(requestedUrls.some((value) => {
    const url = new URL(value, 'http://local');
    return url.pathname === '/api/sessions'
      && url.searchParams.get('status') === 'failed'
      && url.searchParams.get('sort') === 'latest-match-desc'
      && !url.searchParams.has('q');
  }), true);
});

test('browser project result drill-down loads a deep latest event and returns to project cards', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, {
    locale: 'en',
    viewport: { width: 390, height: 760 },
    activeSessionState: 'attached',
  });

  await switchToProjectScope(page);
  await fillSearch(page, 'needle');
  await waitForProjectCards(page);
  await page.locator('#searchInput').press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('[data-project-result-session-id]'));
  const focusedSessionId = await page.evaluate(() => document.activeElement?.dataset.projectResultSessionId || '');
  assert.equal(focusedSessionId, longFixture.sessionId);

  const requestStart = requestedUrls.length;
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'session'
      && document.body.dataset.mobileView === 'events'
      && document.querySelector('#timeline .event.selected')?.textContent.includes('Long timeline row 170')
  ));
  await assertEventCount(page, 171);
  assert.equal(requestedUrls.slice(requestStart).some((value) => {
    const url = new URL(value, 'http://local');
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '171'
      && url.searchParams.get('q') === 'needle';
  }), true);

  const clickedBackToProject = await page.evaluate(() => {
    const button = document.querySelector('#timeline [data-search-back-to-project], #resultSummary [data-search-back-to-project]');
    button?.click();
    return Boolean(button);
  });
  assert.equal(clickedBackToProject, true);
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && document.body.dataset.mobileView === 'sessions'
      && document.querySelectorAll('[data-project-result-session-id]').length > 0
  ));
  await page.waitForFunction((sessionId) => document.activeElement?.dataset.projectResultSessionId === sessionId, longFixture.sessionId);
  assert.equal(await page.locator('#timeline .projectSearchState').count(), 1);
});

test('browser project return ignores stale selected-session analysis responses', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await fillSearch(page, 'patch');
  await waitForProjectCards(page);

  let releaseAnalysis;
  const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve; });
  let delayedOnce = false;
  t.after(() => releaseAnalysis?.());
  await page.route('**/api/sessions/*/analysis', async (route) => {
    if (!delayedOnce) {
      delayedOnce = true;
      await analysisGate;
    }
    await route.continue();
  });

  await page.locator('[data-project-result-session-id]').first().click();
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'session'
      && document.querySelector('#sessionHeader [data-search-back-to-project]')
  ));
  await page.evaluate(() => document.querySelector('#sessionHeader [data-search-back-to-project]')?.click());
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && document.querySelectorAll('[data-project-result-session-id]').length > 0
  ));
  releaseAnalysis();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#analysisPanel .metric').count(), 0);
  assert.equal(await page.locator('#timeline .projectSearchState').count(), 1);
});

test('browser project query transitions clear stale cards and counts before the new context commits', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await fillSearch(page, 'patch');
  await waitForProjectCards(page);
  const previousSummary = await page.locator('#resultSummary').textContent();
  assert.match(previousSummary, /^\d+ matching sessions · \d+ matching events$/);

  let releaseSearch;
  let markSearchSeen;
  const searchGate = new Promise((resolve) => { releaseSearch = resolve; });
  const searchSeen = new Promise((resolve) => { markSearchSeen = resolve; });
  t.after(() => releaseSearch?.());
  await page.route('**/api/sessions*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sessions'
        && url.searchParams.get('q') === 'alpha'
        && url.searchParams.get('sort') === 'latest-match-desc') {
      markSearchSeen();
      await searchGate;
    }
    await route.continue();
  });

  await fillSearch(page, 'alpha');
  await searchSeen;
  assert.equal(await page.locator('[data-project-result-session-id]').count(), 0);
  assert.equal((await page.locator('.searchInlineCount').textContent()).trim(), 'Searching…');
  assert.equal((await page.locator('#searchMetricsPanel').textContent()).trim(), 'Searching…');
  assert.equal((await page.locator('#resultSummary').textContent()).trim(), '');
  assert.match(await page.locator('#timeline .projectSearchState').textContent(), /Searching…/);

  releaseSearch();
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('matching sessions'));
  assert.doesNotMatch((await page.locator('#searchMetricsPanel').textContent()).trim(), /Searching/);
  assert.match((await page.locator('.searchInlineCount').textContent()).trim(), /^\d+ sessions$/);
});

test('browser superseded project results abort and an immediate retry settles Searching state', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await switchToProjectScope(page);
  const failures = [];
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/sessions') failures.push(request.failure()?.errorText || '');
  });
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  let markSlow;
  const slowStarted = new Promise((resolve) => { markSlow = resolve; });
  await page.route('**/api/sessions?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== 'slow-project') {
      await route.continue();
      return;
    }
    markSlow();
    await slowGate;
    try {
      await route.continue();
    } catch {}
  });

  await fillSearch(page, 'slow-project');
  await slowStarted;
  await fillSearch(page, 'fixture');
  await waitForProjectCards(page);
  releaseSlow();
  await page.waitForTimeout(300);

  assert.ok(failures.some((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), failures.join(', '));
  assert.equal(await page.locator('#searchInput').inputValue(), 'fixture');
  assert.equal((await page.locator('#timeline').textContent()).includes('Searching'), false);
  assert.ok(await page.locator('[data-project-result-session-id]').count() > 0);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
});

test('browser project search commits after folding profile changes during an in-flight request', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);

  let releaseProjectSearch;
  let markProjectSearchSeen;
  const projectSearchGate = new Promise((resolve) => { releaseProjectSearch = resolve; });
  const projectSearchSeen = new Promise((resolve) => { markProjectSearchSeen = resolve; });
  let delayedOnce = false;
  t.after(() => releaseProjectSearch?.());
  await page.route('**/api/sessions*', async (route) => {
    const url = new URL(route.request().url());
    if (!delayedOnce
        && url.pathname === '/api/sessions'
        && url.searchParams.get('q') === 'patch'
        && url.searchParams.get('sort') === 'latest-match-desc') {
      delayedOnce = true;
      markProjectSearchSeen();
      await projectSearchGate;
    }
    await route.continue();
  });

  await fillSearch(page, 'patch');
  await projectSearchSeen;
  await page.evaluate(() => {
    const select = document.querySelector('#profileSelect');
    select.value = 'debug';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  releaseProjectSearch();
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('matching sessions'));
  assert.equal(await page.locator('#profileSelect').inputValue(), 'debug');
});

test('browser project scope profile changes do not repopulate the detail pane', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });

  await switchToProjectScope(page);
  await fillSearch(page, 'patch');
  await waitForProjectCards(page);
  await page.waitForFunction(() => document.querySelector('#timeline .projectSearchState'));
  assert.equal(await page.locator('#detail').textContent(), '');

  await page.evaluate(() => {
    const select = document.querySelector('#profileSelect');
    select.value = 'debug';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value === 'debug');
  assert.equal(await page.locator('#detail').textContent(), '');
  assert.equal(await page.locator('#timeline .projectSearchState').count(), 1);
});

test('browser find keeps loaded timeline range and clearing find does not reset pagination', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 180);

  await fillSearch(page, 'needle');
  await assertEventCount(page, 180);
  await waitForSearchMarks(page);

  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  assert.equal(await page.locator('#searchAssist').getAttribute('data-mode'), 'results');
  assert.equal(await page.locator('#resultSummary').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Clear all' }).count(), 0);

  await page.locator('#searchInput').press('Escape');
  assert.equal(await page.locator('#searchAssist').isVisible(), false);
  assert.equal(await page.locator('#resultSummary').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Clear all' }).count(), 0);

  await clearAllSearch(page);
  await assertEventCount(page, 180);
  await waitForNoSearchMarks(page);
});

test('browser search count separates discovered jump targets from full-text occurrences', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page);

  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent === '1 / 9 targets'
      && document.querySelector('#searchMetricsPanel')?.textContent.includes('11 occurrences')
  ));
});

test('browser search discovery waits for a structured result view to commit', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await fillSearch(page, 'src');
  await waitForSearchMarks(page);

  let releaseTimeline;
  let markTimelineRequestSeen;
  const timelineGate = new Promise((resolve) => { releaseTimeline = resolve; });
  const timelineRequestSeen = new Promise((resolve) => { markTimelineRequestSeen = resolve; });
  t.after(() => releaseTimeline());
  await page.route('**/api/sessions/*/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('kind') === 'patch') {
      markTimelineRequestSeen();
      await timelineGate;
    }
    await route.continue();
  });

  await addSearchFilter(page, 'kind', 'patch');
  await timelineRequestSeen;
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('.searchMark').count(),
    0,
    'old DOM must not register targets under the pending structured-search key',
  );
  assert.equal(await page.locator('[data-search-match-nav="next"]').first().isDisabled(), true);

  releaseTimeline();
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length > 0 && events.every((event) => event.classList.contains('kind-patch'));
  });
  await waitForSearchMarks(page);
  const committed = await searchNavigationSnapshot(page);
  assert.equal(committed.total, await page.locator('.searchMark').count());
});

test('browser search discovery excludes the previous timeline while switching sessions', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  await fillSearch(page, 'src');
  await waitForSearchMarks(page);

  const targetSession = page.locator('.sessionItem:not(.active)').first();
  const targetSessionId = await targetSession.getAttribute('data-session-id');
  assert.ok(targetSessionId);
  let releaseTimeline;
  let markTimelineRequestSeen;
  const timelineGate = new Promise((resolve) => { releaseTimeline = resolve; });
  const timelineRequestSeen = new Promise((resolve) => { markTimelineRequestSeen = resolve; });
  t.after(() => releaseTimeline());
  await page.route(`**/api/sessions/${targetSessionId}/timeline*`, async (route) => {
    markTimelineRequestSeen();
    await timelineGate;
    await route.continue();
  });

  await targetSession.click();
  await timelineRequestSeen;
  assert.equal(
    await page.locator('.searchMark').count(),
    0,
    'the previous session DOM must not register targets under the next session key',
  );
  assert.equal(await page.locator('[data-search-match-nav="next"]').first().isDisabled(), true);

  const timelineResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/api/sessions/${targetSessionId}/timeline`)
  ));
  releaseTimeline();
  await timelineResponse;
  await page.waitForFunction((sessionId) => (
    document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
      && document.querySelectorAll('#timeline .event[data-event-id]').length > 0
  ), targetSessionId);
  const committed = await searchNavigationSnapshot(page);
  assert.equal(committed.total, await page.locator('.searchMark').count());
});

test('browser search discovery waits for localized timeline content to commit', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);

  let releaseTimeline;
  let markTimelineRequestSeen;
  const timelineGate = new Promise((resolve) => { releaseTimeline = resolve; });
  const timelineRequestSeen = new Promise((resolve) => { markTimelineRequestSeen = resolve; });
  t.after(() => releaseTimeline());
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('locale') === 'zh-CN') {
      markTimelineRequestSeen();
      await timelineGate;
    }
    await route.continue();
  });

  await switchHiddenLocale(page, 'zh-CN');
  await timelineRequestSeen;
  assert.equal(
    await page.locator('.searchMark').count(),
    0,
    'the previous locale DOM must not register targets under the next locale key',
  );
  assert.equal(await page.locator('[data-search-match-nav="next"]').first().isDisabled(), true);

  const timelineResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('locale') === 'zh-CN';
  });
  releaseTimeline();
  await timelineResponse;
  await waitForSearchMarks(page, 9);
  const committed = await searchNavigationSnapshot(page);
  assert.equal(committed.total, await page.locator('.searchMark').count());
});

test('browser search target identities and denominator stay stable across inspector redraws', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  assert.equal(
    await page.locator('[data-search-load-more-targets]').count(),
    0,
    'a fully loaded timeline must not expose a no-op Load more action',
  );
  const initial = await searchNavigationSnapshot(page);
  assert.ok(initial.total >= 4, `expected enough patch events, got ${initial.total}`);
  assert.equal(initial.total, initial.ids.length);
  assert.equal(new Set(initial.ids).size, initial.ids.length);
  assert.ok(initial.bindings.every((binding) => !binding.surfaces.includes('inspector')));

  const inspectorCounts = new Map();
  let previous = initial;
  for (let i = 0; i < initial.total; i += 1) {
    const next = await clickSearchNavigationAndWait(page, 'next', previous.id);
    assert.deepEqual(next.ids, initial.ids, 'Inspector navigation must not add, remove, or reorder canonical IDs');
    assert.equal(next.total, initial.total);
    const selectedId = await page.evaluate(() => document.querySelector('#timeline .event.selected')?.dataset.eventId || '');
    if (selectedId) inspectorCounts.set(selectedId, await page.locator('#detail mark.searchMark').count());
    previous = next;
    if (new Set(inspectorCounts.values()).size > 1) break;
  }
  assert.ok([...inspectorCounts.values()].some((count) => count > 0), 'Inspector highlights should remain visible');
  assert.ok(new Set(inspectorCounts.values()).size > 1, 'fixture should exercise different inspector match counts');
  assert.ok((await searchNavigationSnapshot(page)).bindings.some((binding) => binding.surfaces.includes('inspector')));

  if (await page.locator('[data-detail-action="close"]').count()) {
    await page.locator('[data-detail-action="close"]').click();
    await waitForDetailView(page, 'profileRules');
  }
  const closed = await searchNavigationSnapshot(page);
  assert.deepEqual(closed.ids, initial.ids, 'closing Inspector must not alter canonical membership');
  assert.ok(closed.bindings.every((binding) => !binding.surfaces.includes('inspector')));
});

test('browser manual fold replaces occurrence bindings without changing event-anchor membership', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1,
    includeFoldableSearchTargets: true,
  });
  const index = await buildIndex(longFixture);
  const hiddenCommandProfile = {
    id: 'custom:hidden-foldable-command',
    name: 'Hidden foldable command search test',
    description: 'Keep command body matches unavailable until search navigation expands them.',
    rules: {
      kindStates: { command: 'hidden' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenCommandProfile]),
      'sessionAnalyzer.profile': hiddenCommandProfile.id,
    },
  });

  await fillSearch(page, 'fold only target');
  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 3 targets')
      && document.querySelector('#searchMetricsPanel')?.textContent.includes('6 occurrences')
  ));

  const empty = await searchNavigationSnapshot(page);
  const first = await clickSearchNavigationAndWait(page, 'next', empty.id);
  const second = await clickSearchNavigationAndWait(page, 'next', first.id);
  assert.notEqual(second.ownerId, first.ownerId, 'event-anchor navigation must advance once per event');
  assert.deepEqual(second.ids, empty.ids);
  const knownTotal = second.total;

  const event = page.locator(`#timeline .event[data-event-id="${first.ownerId}"]`);
  await event.locator('.eventHeader [data-action="toggle"]').click();
  await page.waitForFunction(({ eventId }) => {
    const owner = document.querySelector(`#timeline .event[data-event-id="${eventId}"]`);
    return owner && !owner.classList.contains('expanded');
  }, { eventId: first.ownerId });
  const folded = await searchNavigationSnapshot(page);
  assert.deepEqual(folded.ids, empty.ids);
  assert.equal(folded.total, knownTotal);

  await page.locator('.searchInlineMatches [data-search-match-nav="previous"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-search-navigation-pending]'));
  const reverse = await searchNavigationSnapshot(page);
  assert.equal(reverse.total, knownTotal);
  assert.deepEqual(reverse.ids, empty.ids, 'folding changes bindings, not canonical membership');
});

test('browser search registry follows folding profile rule revisions', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 1,
    includeFoldableSearchTargets: true,
  });
  const expandedCommandProfile = {
    id: 'custom:search-rule-revision',
    name: 'Search rule revision test',
    description: 'Exercises registry invalidation while the profile ID stays unchanged.',
    rules: {
      kindStates: { command: 'expanded' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, longFixture, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([expandedCommandProfile]),
      'sessionAnalyzer.profile': expandedCommandProfile.id,
    },
  });

  await fillSearch(page, 'fold only target');
  await waitForSearchMarks(page, 6);
  if (await page.locator('[data-detail-action="close"]').count()) {
    await page.locator('[data-detail-action="close"]').click();
    await waitForDetailView(page, 'profileRules');
  }
  const initial = await searchNavigationSnapshot(page);
  assert.equal(initial.total, 3, `expected one canonical target per matching command event, got ${initial.total}`);

  await page.locator('#detail [data-profile-kind="command"]').selectOption('hidden');
  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.kind-command.hiddenByProfile').length === 3
  ));
  await waitForNoSearchMarks(page);
  const hiddenDraft = await searchNavigationSnapshot(page);
  assert.equal(hiddenDraft.total, 3, 'hidden matching events remain canonical but have no live bindings');
  assert.notDeepEqual(hiddenDraft.ids, initial.ids, 'a rule revision must replace the prior search-key identities');
  assert.equal(await page.locator('#profileSelect').inputValue(), expandedCommandProfile.id);

  await page.locator('#detail [data-detail-action="save-profile"]').click();
  assert.equal(await page.locator('#profileSelect').inputValue(), expandedCommandProfile.id);
  assert.deepEqual((await searchNavigationSnapshot(page)).ids, hiddenDraft.ids, 'same-ID save must preserve the committed hidden-rule identities');

  await page.locator('#detail [data-profile-kind="command"]').selectOption('expanded');
  await waitForSearchMarks(page, 6);
  const expandedDraft = await searchNavigationSnapshot(page);
  assert.equal(expandedDraft.total, 3);
  assert.equal(await page.locator('.searchMark').count(), 6, 'occurrence highlights must not multiply event anchors');

  await page.locator('#detail [data-detail-action="cancel-profile"]').click();
  await waitForNoSearchMarks(page);
  assert.deepEqual((await searchNavigationSnapshot(page)).ids, hiddenDraft.ids, 'cancel must restore the saved canonical context');
});

test('browser rapid search navigation is serialized without skips or duplicates', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  const initial = await searchNavigationSnapshot(page);
  assert.equal(initial.current, 1);

  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.startsWith('4 /'));
  const advanced = await searchNavigationSnapshot(page);
  assert.equal(advanced.current, 4);
  assert.notEqual(advanced.id, initial.id);

  await page.locator('.searchInlineMatches [data-search-match-nav="previous"]').evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent.startsWith('1 /'));
  const restored = await searchNavigationSnapshot(page);
  assert.equal(restored.id, initial.id);
});

test('browser search count hit testing keeps input and navigation controls distinct', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  assert.equal(await page.locator('#searchMetricsPanel [data-search-match-nav]').count(), 2);
  assert.equal(await page.locator('#searchMetricsPanel .searchMetricTargets [data-search-match-nav]').count(), 2);
  assert.equal(await page.locator('#searchMetricsPanel .searchMetricsFooter [data-search-match-nav]').count(), 0);
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]')?.disabled);
  const loadMoreBefore = await searchNavigationSnapshot(page);
  const discoveredBefore = Number((await page.locator('.searchMetricTargets strong').textContent()).match(/\/\s*(\d+)/)?.[1] || 0);
  await page.locator('[data-search-load-more-targets]').click();
  await page.waitForFunction((count) => {
    const text = document.querySelector('.searchMetricTargets strong')?.textContent || '';
    const discovered = Number(text.match(/\/\s*(\d+)/)?.[1] || 0);
    return discovered > count || !document.querySelector('[data-search-load-more-targets]');
  }, discoveredBefore);
  const loadMoreAfter = await searchNavigationSnapshot(page);
  assert.equal(loadMoreAfter.id, loadMoreBefore.id, 'loading more targets should preserve the active target');
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  const panelBefore = await searchNavigationSnapshot(page);
  await page.locator('#searchMetricsPanel [data-search-match-nav="next"]').click();
  await page.waitForFunction((id) => document.querySelector('.searchMark.activeSearchMark')?.dataset.searchTargetId !== id, panelBefore.id);
  const panelNext = await searchNavigationSnapshot(page);
  assert.equal(panelNext.current, panelBefore.current + 1);
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  assert.equal(await page.locator('#searchAssist').getAttribute('data-mode'), 'results');
  await page.locator('#searchMetricsPanel [data-search-match-nav="previous"]').click();
  await page.waitForFunction((id) => document.querySelector('.searchMark.activeSearchMark')?.dataset.searchTargetId === id, panelBefore.id);
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  await page.locator('#searchInput').press('Escape');
  await page.locator('#searchInput').blur();
  const countBox = await page.locator('.searchInlineCount').boundingBox();
  assert.ok(countBox);
  await page.mouse.click(countBox.x + countBox.width / 2, countBox.y + countBox.height / 2);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);

  const before = await searchNavigationSnapshot(page);
  const next = await clickSearchNavigationAndWait(page, 'next', before.id);
  assert.equal(next.current, before.current + 1);
  const previous = await clickSearchNavigationAndWait(page, 'previous', next.id);
  assert.equal(previous.id, before.id);
});

test('browser canonical Load more scans multiple pages once and becomes idempotent at exhaustion', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 620,
    needleIndices: [0, 1, 2, 3, 4, 455],
  });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent === '1 / 5 targets');
  const before = await searchNavigationSnapshot(page);
  const beforeState = await page.evaluate(() => ({
    selected: document.querySelector('#timeline .event.selected')?.dataset.eventId || '',
    detail: document.body.dataset.detailView,
    scrollTop: document.querySelector('.timelinePane')?.scrollTop || 0,
  }));
  assert.equal(beforeState.detail, 'profileRules');
  const requestStart = requestedUrls.length;

  await page.locator('[data-search-load-more-targets]').click();
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 6 targets'));
  const after = await searchNavigationSnapshot(page);
  const afterState = await page.evaluate(() => ({
    selected: document.querySelector('#timeline .event.selected')?.dataset.eventId || '',
    detail: document.body.dataset.detailView,
    scrollTop: document.querySelector('.timelinePane')?.scrollTop || 0,
  }));
  assert.deepEqual(after.ids.slice(0, before.ids.length), before.ids);
  assert.equal(after.ids.length, before.ids.length + 1);
  assert.equal(after.id, before.id);
  assert.deepEqual(afterState, beforeState, 'discovery must preserve selection, detail, and scroll');
  const discoveryRequests = requestedUrls.slice(requestStart)
      .filter((value) => value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '150')
  assert.deepEqual(
    discoveryRequests.map((value) => new URL(value, 'http://local').searchParams.get('offset')),
    ['150', '300', '450'],
    discoveryRequests.join('\n'),
  );

  await page.locator('[data-search-load-more-targets]').click();
  await page.waitForFunction(() => !document.querySelector('[data-search-load-more-targets]'));
  const exhausted = await searchNavigationSnapshot(page);
  assert.deepEqual(exhausted.ids, after.ids);
  assert.equal(exhausted.id, before.id);
  const allOffsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '150')
    .map((value) => new URL(value, 'http://local').searchParams.get('offset'));
  assert.deepEqual(allOffsets, ['150', '300', '450', '600']);
  assert.equal(new Set(allOffsets).size, allOffsets.length, 'no timeline page may be requested twice');
});

test('browser query edits invalidate an in-flight canonical discovery', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 620,
    needleIndices: [0, 1, 2, 3, 4, 455],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent === '1 / 5 targets');

  let releaseOldPage;
  let markOldPageStarted;
  const oldPageRelease = new Promise((resolve) => { releaseOldPage = resolve; });
  const oldPageStarted = new Promise((resolve) => { markOldPageStarted = resolve; });
  t.after(() => releaseOldPage());
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle' && url.searchParams.get('offset') === '150') {
      markOldPageStarted();
      await oldPageRelease;
    }
    await route.continue();
  });

  await page.locator('[data-search-load-more-targets]').click();
  await oldPageStarted;
  await fillSearch(page, 'ordinary');
  releaseOldPage();
  await page.waitForFunction(() => {
    const ids = JSON.parse(document.querySelector('#searchMetricsPanel')?.dataset.searchTargetIds || '[]');
    return ids.length > 0 && ids.every((id) => JSON.parse(id)[0].split('\u001f')[4] === 'ordinary');
  });
  const committed = await searchNavigationSnapshot(page);
  assert.ok(committed.ids.length > 0);
  assert.ok(committed.ids.every((id) => JSON.parse(id)[0].split('\u001f')[4] === 'ordinary'));
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser rapid navigation and Load more interleaving commits one ordered activation', async (t) => {
  const longFixture = await makeLongCodexHome(t, {
    eventCount: 320,
    needleIndices: [0, 1, 2, 3, 4, 155],
  });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });
  await fillSearch(page, 'needle');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent === '1 / 5 targets');
  const before = await searchNavigationSnapshot(page);

  await page.locator('[data-search-load-more-targets]').click();
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await page.waitForFunction(() => (
    document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 6 targets')
      && !document.querySelector('[data-search-navigation-pending]')
      && !document.querySelector('[data-search-load-more-targets][disabled]')
  ));
  const after = await searchNavigationSnapshot(page);
  assert.equal(after.id, before.ids[1]);
  assert.equal(after.current, 2);
  assert.equal(after.ids.length, 6);
  assert.equal(new Set(after.ids).size, after.ids.length);
});

test('browser canonical membership is independent of responsive detail visibility and event layer chrome', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 1280, height: 900 } });
  await selectPrimarySession(page);
  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  const desktop = await searchNavigationSnapshot(page);

  for (const width of [900, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(50);
    assert.deepEqual((await searchNavigationSnapshot(page)).ids, desktop.ids);
  }

  for (const layer of ['protocol', 'raw', 'main']) {
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('layer') === layer;
    });
    await page.locator('#layerSelect').selectOption(layer);
    await response;
    await page.waitForFunction((expected) => document.querySelector('#layerSelect')?.value === expected, layer);
    const snapshot = await searchNavigationSnapshot(page);
    assert.equal(snapshot.ids.length, new Set(snapshot.ids).size);
    assert.ok(snapshot.bindings.every((binding) => (
      binding.surfaces.every((surface) => ['timeline', 'inspector'].includes(surface))
    )));
  }
});

test('browser large full-text counts stay unabridged beside canonical event targets in both locales', async (t) => {
  const longFixture = await makeLongCodexHome(t, { needleRepeats: 20 });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 1365, height: 900 } });
  const fullTextTotal = 987654321;

  await page.route('**/timeline*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (new URL(route.request().url()).searchParams.get('q') === 'needle') data.searchMatchCount = fullTextTotal;
    await route.fulfill({ response, json: data });
  });
  await fillSearch(page, 'needle');
  await page.waitForFunction((count) => document.querySelector('#searchMetricsPanel')?.textContent.includes(String(count)), fullTextTotal);

  const assertLayout = async ({ expectedText, compactHidden }) => {
    const layout = await page.evaluate(() => {
      const row = document.querySelector('.searchInputRow');
      const input = document.querySelector('#searchInput');
      const controls = document.querySelector('.searchInlineMatches');
      const count = document.querySelector('.searchInlineCount');
      const metrics = document.querySelector('#searchMetricsPanel');
      const rowRect = row.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      const style = getComputedStyle(count);
      const match = count.textContent.match(/^(\d+) \/ (\d+)/);
      return {
        text: metrics.textContent,
        jumpTotal: Number(match?.[2] || 0),
        compactDisplay: style.display,
        singleLine: Math.abs(inputRect.top - controlsRect.top) < rowRect.height,
        separated: inputRect.right <= controlsRect.left,
        rowHeight: rowRect.height,
      };
    });
    assert.ok(layout.text.includes(expectedText));
    assert.equal(layout.jumpTotal, 9, 'large occurrence totals must not inflate event-anchor membership');
    assert.equal(layout.singleLine, true);
    assert.equal(layout.separated, true);
    assert.ok(layout.rowHeight <= 48, `expected one-line HUD, got ${layout.rowHeight}px`);
    assert.equal(layout.compactDisplay === 'none', compactHidden);
  };

  await assertLayout({ expectedText: `${fullTextTotal} occurrences`, compactHidden: false });
  await page.setViewportSize({ width: 900, height: 900 });
  await assertLayout({ expectedText: `${fullTextTotal} occurrences`, compactHidden: false });
  await page.setViewportSize({ width: 390, height: 760 });
  await switchHiddenLocale(page, 'zh-CN');
  await page.waitForFunction((count) => document.querySelector('#searchMetricsPanel')?.textContent.includes(`${count} 处`), fullTextTotal);
  await assertLayout({ expectedText: `${fullTextTotal} 处`, compactHidden: true });
});

test('browser focused search input reopens assist through residual navigation scroll', async (t) => {
  const longFixture = await makeLongCodexHome(t);
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.locator('#searchInput').press('Escape');
  assert.equal(await page.locator('#searchAssist').isVisible(), false);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);
  await page.locator('#searchInput').click();
  assert.equal(await page.locator('#searchAssist').isVisible(), true);

  await page.locator('#searchInput').press('Enter');
  await page.locator('#searchInput').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#searchAssist').isVisible(), true);
  assert.equal(await page.locator('#searchInput').evaluate((input) => document.activeElement === input), true);
});

test('browser user scroll during the search-scroll guard still loads the next page', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  const before = await searchNavigationSnapshot(page);
  await clickSearchNavigationAndWait(page, 'next', before.id);

  const requestStart = requestedUrls.length;
  const timelinePane = page.locator('.timelinePane');
  await timelinePane.hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 300);

  const paginationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(paginationRequests.some((url) => url.searchParams.get('offset') === '150'), true);
});

test('browser an above-threshold user scroll cannot authorize a later programmatic bottom scroll', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const timelinePane = page.locator('.timelinePane');

  await assertEventCount(page, 150);
  await timelinePane.hover();
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => document.querySelector('.timelinePane')?.scrollTop > 0);
  await page.waitForTimeout(180);
  const programmaticScrollStart = requestedUrls.length;
  await timelinePane.evaluate((pane) => {
    pane.querySelector('.event[data-event-id]:last-of-type')?.scrollIntoView({ block: 'end', behavior: 'auto' });
  });
  await page.waitForTimeout(300);

  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150);
  const leakedRequests = requestedUrls.slice(programmaticScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(leakedRequests.some((url) => url.searchParams.get('offset') === '150'), false);

  await timelinePane.evaluate((pane) => { pane.scrollTop = 0; });
  await timelinePane.hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 300);
});

test('browser a scroll during an in-flight append cannot leak pagination authority after loading settles', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 450 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const timelinePane = page.locator('.timelinePane');
  let releaseAppend;
  const appendGate = new Promise((resolve) => { releaseAppend = resolve; });
  let markAppendStarted;
  const appendStarted = new Promise((resolve) => { markAppendStarted = resolve; });
  let gated = false;
  t.after(() => releaseAppend?.());
  await page.route('**/api/sessions/*/timeline?*', async (route) => {
    const url = new URL(route.request().url());
    if (!gated && url.searchParams.get('offset') === '150') {
      gated = true;
      markAppendStarted();
      await appendGate;
    }
    await route.continue();
  });

  await page.locator('#loadMoreBtn').click();
  await appendStarted;
  await timelinePane.evaluate(async (pane) => {
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    pane.scrollTop = 120;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  releaseAppend();
  await assertEventCount(page, 300);

  const programmaticScrollStart = requestedUrls.length;
  await timelinePane.evaluate((pane) => {
    pane.querySelector('.event[data-event-id]:last-of-type')?.scrollIntoView({ block: 'end', behavior: 'auto' });
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 300);
  const leakedRequests = requestedUrls.slice(programmaticScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(leakedRequests.some((url) => url.searchParams.get('offset') === '300'), false);
});

test('browser touch inertia keeps one pagination sequence until its later bottom scroll', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const requestStart = requestedUrls.length;

  await assertEventCount(page, 150);
  await page.locator('.timelinePane').evaluate(async (pane) => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    pane.dispatchEvent(new Event('touchmove', { bubbles: true }));
    pane.scrollTop = 120;
    await nextFrame();
    pane.scrollTop = 240;
    await nextFrame();
    pane.scrollTop = pane.scrollHeight;
    await nextFrame();
  });
  await assertEventCount(page, 300);
  const paginationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(paginationRequests.map((url) => url.searchParams.get('offset')), ['150']);
});

test('browser reverse touch or pointer movement and modified scrolling input cannot authorize pagination', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 300 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const requestStart = requestedUrls.length;
  const timelinePane = page.locator('.timelinePane');

  const moveNearBottom = async () => {
    await timelinePane.evaluate(async (pane) => {
      pane.scrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight - 48);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  };
  const assertNotAppended = async (message) => {
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 150, message);
  };

  await assertEventCount(page, 150);
  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    pane.dispatchEvent(new Event('touchmove', { bubbles: true }));
    pane.scrollTop = Math.max(0, pane.scrollTop - 12);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('reverse touch movement must not append');

  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    const pointerMove = new Event('pointermove', { bubbles: true });
    Object.defineProperty(pointerMove, 'buttons', { value: 1 });
    pane.dispatchEvent(pointerMove);
    pane.scrollTop = Math.max(0, pane.scrollTop - 12);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('reverse pointer movement must not append');

  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    pane.focus();
    pane.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', shiftKey: true }));
    pane.scrollTop = Math.max(0, pane.scrollTop - 12);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('Shift+Space must not append');

  await moveNearBottom();
  await timelinePane.evaluate(async (pane) => {
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120, ctrlKey: true }));
    pane.scrollTop = pane.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await assertNotAppended('modified wheel input must not append');
  const paginationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(paginationRequests.some((url) => url.searchParams.get('offset') === '150'), false);
});

test('browser replacement pagination requires current-context intent while explicit wheel and keyboard scrolling still append', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  await assertEventCount(page, 150);
  let previousOffset = 150;
  for (const expected of [300, 450, 600]) {
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('offset') === String(previousOffset);
    });
    await page.locator('#loadMoreBtn').click();
    await response;
    await assertEventCount(page, expected);
    previousOffset = expected;
  }
  const deepEventId = await page.locator('#timeline .event[data-event-id]').nth(501).getAttribute('data-event-id');
  await page.locator(`[data-event-id="${deepEventId}"]`).click();
  await waitForDetailView(page, 'inspector');

  const filterRequestStart = requestedUrls.length;
  const filterPageZero = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '0';
  });
  await addSearchFilter(page, 'kind', 'assistant_message');
  await filterPageZero;
  await assertEventCount(page, 150);
  await page.waitForTimeout(500);

  const filterRequests = requestedUrls.slice(filterRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(filterRequests.map((url) => url.searchParams.get('offset')), ['0']);
  assert.equal(await page.locator('#timeline .event.selected').count(), 0, 'deep selection outside page zero resets deterministically');
  assert.equal(await page.locator('.timelinePane').evaluate((pane) => pane.scrollTop), 0);

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 300);
  const explicitRequest = new URL(requestedUrls.filter((value) => value.includes('/timeline?')).at(-1), 'http://local');
  assert.equal(explicitRequest.searchParams.get('offset'), '150');

  const userScrollStart = requestedUrls.length;
  await page.locator('.timelinePane').hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 350);
  const userScrollRequests = requestedUrls.slice(userScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(userScrollRequests.map((url) => url.searchParams.get('offset')), ['300']);

  await page.locator('.timelinePane').evaluate((pane) => { pane.scrollTop = pane.scrollHeight; });
  const clearRequestStart = requestedUrls.length;
  const clearPageZero = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && !url.searchParams.has('kind')
      && url.searchParams.get('offset') === '0';
  });
  await clearAllSearch(page);
  await clearPageZero;
  await assertEventCount(page, 150);
  await page.waitForTimeout(500);
  const clearRequests = requestedUrls.slice(clearRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(clearRequests.map((url) => url.searchParams.get('offset')), ['0']);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  assert.equal(await page.locator('body').getAttribute('data-search-scope'), 'session');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /150\/700/);

  const keyboardScrollStart = requestedUrls.length;
  const keyboardTimelinePane = page.locator('.timelinePane');
  await page.waitForFunction(() => document.querySelector('.timelinePane')?.scrollTop === 0);
  await keyboardTimelinePane.click({ position: { x: 5, y: 5 } });
  assert.equal(await keyboardTimelinePane.evaluate((pane) => document.activeElement === pane), true);
  const keyboardAppend = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline') && url.searchParams.get('offset') === '150';
  });
  await keyboardTimelinePane.press('End');
  await keyboardAppend;
  await assertEventCount(page, 300);
  const keyboardScrollRequests = requestedUrls.slice(keyboardScrollStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(keyboardScrollRequests.map((url) => url.searchParams.get('offset')), ['150']);

  const retainedEvent = page.locator('#timeline .event[data-event-id]').nth(1);
  const retainedEventId = await retainedEvent.getAttribute('data-event-id');
  await retainedEvent.click();
  const retainedPageZero = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '0';
  });
  await addSearchFilter(page, 'kind', 'assistant_message');
  await retainedPageZero;
  await assertEventCount(page, 150);
  assert.equal(await page.locator('#timeline .event.selected').getAttribute('data-event-id'), retainedEventId);
});

test('browser Layer focus restoration keeps its explicit deep loads without a residual append', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  await page.waitForSelector(`[data-session-id="${fixture.longSessionId}"].active`);
  for (const expected of [300, 450, 600]) {
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname.endsWith('/timeline') && url.searchParams.get('offset') === String(expected - 150);
    });
    await page.locator('#loadMoreBtn').click();
    await response;
    await assertEventCount(page, expected);
  }
  await page.locator('#timeline .event[data-event-id]').nth(501).click();
  await waitForDetailView(page, 'inspector');

  const layerRequestStart = requestedUrls.length;
  await page.locator('#layerSelect').selectOption('raw');
  await page.waitForFunction(() => document.querySelector('#layerSelect')?.value === 'raw');
  await page.waitForFunction(() => document.querySelector('#timeline .event.selected'));
  await page.waitForFunction(() => !document.querySelector('#loadMoreBtn')?.textContent.includes('Loading'));
  await page.waitForTimeout(500);

  const rawRequests = requestedUrls.slice(layerRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('layer') === 'raw');
  assert.ok(rawRequests.some((url) => url.searchParams.get('offset') === '0'));
  assert.ok(rawRequests.some((url) => url.searchParams.get('offset') === '450'));
  assert.equal(rawRequests.some((url) => url.searchParams.get('offset') === '600'), false, rawRequests.map((url) => url.search).join('\n'));
  assert.ok(await page.locator('#timeline .event[data-event-id]').count() >= 502);
});

test('browser rapid query filter and Session replacement aborts old work and settles latest intent', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  const failed = [];
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/timeline')) failed.push(request.failure()?.errorText || '');
  });

  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  let slowCount = 0;
  let markFirst;
  let markSecond;
  const firstSlowRequest = new Promise((resolve) => { markFirst = resolve; });
  const secondSlowRequest = new Promise((resolve) => { markSecond = resolve; });
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== 'slow-query') {
      await route.continue();
      return;
    }
    slowCount += 1;
    if (slowCount === 1) markFirst();
    if (slowCount === 2) markSecond();
    await slowGate;
    try {
      await route.continue();
    } catch {}
  });

  await fillSearch(page, 'slow-query');
  await firstSlowRequest;
  await addSearchFilter(page, 'kind', 'assistant_message');
  await secondSlowRequest;
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 20);
  releaseSlow();
  await page.waitForTimeout(400);

  assert.ok(failed.length >= 2, `expected both superseded timeline requests to abort, received ${failed.join(', ')}`);
  assert.ok(failed.every((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), failed.join(', '));
  const newSessionRequests = requestedUrls
    .filter((value) => value.includes(`/api/sessions/${fixture.secondarySessionId}/timeline?`))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(newSessionRequests.at(-1).searchParams.get('offset'), '0');
  assert.equal(await page.locator('.timelinePane').evaluate((pane) => pane.scrollTop), 0);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
  assert.equal((await page.locator('#loadMoreBtn').textContent()).includes('Loading'), false);
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser intentional timeline abort permits an immediate same-surface retry without stale cleanup', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  const failed = [];
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/timeline')) failed.push(request.failure()?.errorText || '');
  });

  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  let markSlow;
  const slowStarted = new Promise((resolve) => { markSlow = resolve; });
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== 'slow-query') {
      await route.continue();
      return;
    }
    markSlow();
    await slowGate;
    try {
      await route.continue();
    } catch {}
  });

  await fillSearch(page, 'slow-query');
  await slowStarted;
  await fillSearch(page, 'far-needle');
  await page.waitForFunction(() => document.querySelectorAll('#timeline .event[data-event-id]').length === 600);
  releaseSlow();
  await page.waitForTimeout(300);

  assert.ok(failed.some((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), failed.join(', '));
  assert.equal(await page.locator('#searchInput').inputValue(), 'far-needle');
  assert.match(await page.locator('#loadMoreBtn').textContent(), /600\/700/);
  assert.equal((await page.locator('#stateLine').textContent()).includes('AbortError'), false);
  assert.equal(await page.locator('[data-search-navigation-pending]').count(), 0);
});

test('browser real timeline errors remain visible and leave explicit retry available', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  let failNext = true;
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (failNext && url.searchParams.get('offset') === '150') {
      failNext = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic timeline failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic timeline failure'));
  assert.equal(await page.locator('#loadMoreBtn').isEnabled(), true);
  assert.equal((await page.locator('#loadMoreBtn').textContent()).includes('Loading'), false);

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 300);
  assert.match(await page.locator('#loadMoreBtn').textContent(), /300\/700/);
});

test('browser successful page-zero append retry recommits automatic pagination', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  let failReplacement = true;
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (failReplacement && url.searchParams.get('offset') === '0') {
      failReplacement = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic replacement failure' }),
      });
      return;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await page.locator(`[data-session-id="${fixture.longSessionId}"]`).click();
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic replacement failure'));
  assert.equal(await page.locator('#loadMoreBtn').isEnabled(), true);

  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 150);

  await page.locator('.timelinePane').hover();
  await page.mouse.wheel(0, 100000);
  await assertEventCount(page, 300);

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local').searchParams.get('offset'));
  assert.deepEqual(offsets, ['0', '0', '150']);
});

test('browser retries a failed replacement in its new structured context before normal append resumes', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  let failReplacement = true;
  await page.route(`**/api/sessions/${fixture.longSessionId}/timeline?*`, async (route) => {
    const url = new URL(route.request().url());
    if (failReplacement
        && url.searchParams.get('kind') === 'assistant_message'
        && url.searchParams.get('offset') === '0') {
      failReplacement = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic structured replacement failure' }),
      });
      return;
    }
    await route.continue();
  });

  const requestStart = requestedUrls.length;
  await addSearchFilter(page, 'kind', 'assistant_message');
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('synthetic structured replacement failure'));
  assert.equal(await page.locator('#loadMoreBtn').isEnabled(), true);
  assert.equal(await page.locator('#loadMoreBtn').textContent(), 'Retry timeline');

  const retryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '0'
      && response.status() === 200;
  });
  await page.locator('#loadMoreBtn').click();
  await retryResponse;
  await assertEventCount(page, 150);

  const appendResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('kind') === 'assistant_message'
      && url.searchParams.get('offset') === '150'
      && response.status() === 200;
  });
  await page.locator('#loadMoreBtn').click();
  await appendResponse;
  await assertEventCount(page, 300);

  const offsets = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('kind') === 'assistant_message')
    .map((url) => url.searchParams.get('offset'));
  assert.deepEqual(offsets, ['0', '0', '150']);
});

test('browser search navigation loads only the next hit page before wrapping', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('37 occurrences'));

  const inspectorRequestStart = requestedUrls.length;
  await moveToLastSearchMark(page);

  const inspectorRequests = requestedUrls.slice(inspectorRequestStart)
    .filter((value) => value.includes('/timeline?'));
  assert.equal(
    inspectorRequests.some((value) => new URL(value, 'http://local').searchParams.get('limit') === '500'),
    false,
    `search-origin inspector should not preload navigation events: ${inspectorRequests.join(', ')}`,
  );

  const beforeBoundary = await searchNavigationSnapshot(page);
  assert.equal(beforeBoundary.current, beforeBoundary.total);
  const boundaryRequestStart = requestedUrls.length;
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();

  await assertEventCount(page, 300);
  await page.waitForFunction(() => (
    document.querySelector('#timeline mark.searchMark.activeSearchMark')
      ?.closest('[data-event-id]')
      ?.textContent
      ?.includes('Long timeline row 153')
  ));
  const afterBoundary = await searchNavigationSnapshot(page);
  assert.ok(afterBoundary.total > beforeBoundary.total);
  assert.ok(afterBoundary.current > beforeBoundary.current);
  assert.notEqual(afterBoundary.id, beforeBoundary.id);

  const boundaryRequests = requestedUrls.slice(boundaryRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.equal(boundaryRequests.length, 1, `expected one UI timeline page, got ${boundaryRequests.map((url) => url.href).join(', ')}`);
  assert.equal(boundaryRequests[0].searchParams.get('offset'), '150');
  assert.equal(boundaryRequests[0].searchParams.get('limit'), '150');
  assert.equal(boundaryRequests[0].searchParams.get('q'), 'needle');
  assert.equal(boundaryRequests.some((url) => url.searchParams.get('limit') === '500'), false);
  assert.equal(boundaryRequests.some((url) => Number(url.searchParams.get('offset')) >= 300), false);
});

test('browser search inspector hides idle navigation and user confirmation loads it', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  const transientRequestStart = requestedUrls.length;
  const eventId = await openColdLongSearchInspector(page);
  assert.ok(eventId);
  assert.equal(await page.locator('#detail .eventNavigator').count(), 0);
  assert.equal(await page.locator('#detail .navStatus').count(), 0);
  assert.equal(
    requestedUrls.slice(transientRequestStart).some((value) => (
      value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '500'
    )),
    false,
  );

  let releaseNavigation;
  const navigationGate = new Promise((resolve) => { releaseNavigation = resolve; });
  t.after(() => releaseNavigation());
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'needle'
        && url.searchParams.get('offset') === '0'
        && url.searchParams.get('limit') === '500') {
      await navigationGate;
    }
    await route.continue();
  });

  const navigationRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
  });
  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await navigationRequest;
  await page.waitForSelector('#detail .eventNavigator .navStatus');
  releaseNavigation();

  await page.waitForSelector('#detail .eventNavigator .navPosition');
  assert.equal(await page.locator('#detail .navStatus').count(), 0);
  assert.equal(await page.locator('#timeline .event.selected').getAttribute('data-event-id'), eventId);

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'inspector');
});

test('browser inspector navigation failure clears loading and explicit click retries', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  const eventId = await openColdLongSearchInspector(page);
  assert.ok(eventId);
  const requestStart = requestedUrls.length;
  const previousStateLine = await page.locator('#stateLine').textContent();
  let failNavigation = true;
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    if (failNavigation && url.searchParams.get('limit') === '500') {
      failNavigation = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await page.waitForFunction((previous) => document.querySelector('#stateLine')?.textContent !== previous, previousStateLine);
  await page.waitForFunction(() => !document.querySelector('#detail .eventNavigator'));

  const navigationRequests = requestedUrls.slice(requestStart).filter((value) => (
    value.includes('/timeline?') && new URL(value, 'http://local').searchParams.get('limit') === '500'
  ));
  assert.equal(navigationRequests.length, 1);
  assert.equal(await page.locator('#detail .navStatus').count(), 0);

  const retryRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
  });
  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await retryRequest;
  await page.waitForSelector('#detail .eventNavigator .navPosition');

  const retriedNavigationRequests = requestedUrls.slice(requestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'))
    .filter((url) => url.searchParams.get('limit') === '500');
  assert.deepEqual(retriedNavigationRequests.map((url) => url.searchParams.get('offset')), ['0', '0', '500']);
  assert.equal(await page.locator('#detail .navStatus').count(), 0);
});

test('browser intentional navigation abort invalidates an incomplete same-key cache', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  const eventId = await openColdLongSearchInspector(page);
  assert.ok(eventId);
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  t.after(() => releaseFirst());
  let navigationRequestCount = 0;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  await page.route('**/timeline*', async (route) => {
    const url = new URL(route.request().url());
    const isNavigationRequest = url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
    if (!isNavigationRequest) {
      await route.continue();
      return;
    }
    navigationRequestCount += 1;
    if (navigationRequestCount === 1) {
      markFirstStarted();
      await firstGate;
    }
    try {
      await route.continue();
    } catch {}
  });

  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await firstStarted;
  await page.waitForSelector('#detail .eventNavigator .navStatus');

  const retry = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '500';
  });
  const aborted = page.waitForEvent('requestfailed', (request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('limit') === '500';
  });
  await fillSearch(page, 'different-query');
  await fillSearch(page, 'needle');
  await page.locator('[data-detail-action="close"]').click();
  releaseFirst();
  await aborted;
  await page.waitForTimeout(100);

  await page.locator(`#timeline .event[data-event-id="${eventId}"]`).click();
  await retry;
  await page.waitForSelector('#detail .eventNavigator .navPosition');
  assert.equal(navigationRequestCount, 2);
});

test('browser previous search navigation scans backward wrap through UI pages', async (t) => {
  const longFixture = await makeLongCodexHome(t, { eventCount: 620 });
  const index = await buildIndex(longFixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  const committedSearch = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('q') === 'needle'
      && url.searchParams.get('offset') === '0'
      && url.searchParams.get('limit') === '150';
  });
  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('37 occurrences'));
  await committedSearch;
  await page.locator('#searchInput').blur();
  await assertEventCount(page, 150);

  const boundaryRequestStart = requestedUrls.length;
  await page.locator('.searchInlineMatches [data-search-match-nav="previous"]').click();
  await Promise.all([
    assertEventCount(page, 620),
    page.waitForFunction(() => (
      document.querySelector('#timeline mark.searchMark.activeSearchMark')
        ?.closest('[data-event-id]')
        ?.textContent
        ?.includes('Long timeline row 612')
    )),
  ]);

  const boundaryRequests = requestedUrls.slice(boundaryRequestStart)
    .filter((value) => value.includes('/timeline?'))
    .map((value) => new URL(value, 'http://local'));
  assert.deepEqual(
    boundaryRequests.map((url) => ({
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit'),
      q: url.searchParams.get('q'),
    })),
    [
      { offset: '150', limit: '150', q: 'needle' },
      { offset: '300', limit: '150', q: 'needle' },
      { offset: '450', limit: '150', q: 'needle' },
      { offset: '600', limit: '150', q: 'needle' },
    ],
  );
  assert.equal(boundaryRequests.some((url) => url.searchParams.get('offset') === '0'), false);
  assert.equal(boundaryRequests.some((url) => url.searchParams.get('limit') === '500'), false);
});

test('browser search navigation preserves inspector marks while ignoring raw-detail chrome', async (t) => {
  const longFixture = await makeLongCodexHome(t, { includeCommandDetailNeedles: true });
  const index = await buildIndex(longFixture);
  const { page } = await openApp(t, index, { locale: 'en' });

  await assertEventCount(page, 150);
  await page.locator('#timeline .event.kind-command').first().click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail...'));
  await fillSearch(page, 'status');
  await page.waitForSelector('#detail mark.searchMark');
  const beforeInspector = await searchNavigationSnapshot(page);

  const inspectorTargetIds = await page.locator('#detail mark.searchMark').evaluateAll((marks) => (
    marks.map((mark) => mark.dataset.searchTargetId).filter(Boolean)
  ));
  assert.ok(await page.locator('#detail mark.searchMark').count() > 0, 'Inspector occurrences remain highlighted');
  assert.ok(inspectorTargetIds.every((id) => beforeInspector.ids.includes(id)));
  assert.ok(new Set(inspectorTargetIds).size <= 1, 'one Inspector event may bind at most one event anchor');

  let releaseRawRequest;
  let markRawRequestStarted;
  const rawRequestRelease = new Promise((resolve) => { releaseRawRequest = resolve; });
  const rawRequestStarted = new Promise((resolve) => { markRawRequestStarted = resolve; });
  await page.route('**/api/sessions/*/raw/*', async (route) => {
    markRawRequestStarted();
    await rawRequestRelease;
    await route.continue();
  });
  await page.locator('#detail [data-detail-action="raw"]').click();
  await rawRequestStarted;
  await waitForDetailView(page, 'rawRefs');
  await page.waitForSelector('#detail .rawRefsView');
  assert.equal(await page.locator('#detail').textContent().then((text) => text.includes('Loading...')), true);
  assert.equal(await page.locator('#detail mark.searchMark').count(), 0);

  releaseRawRequest();
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.toLowerCase().includes('status'));
  assert.equal(await page.locator('#detail mark.searchMark').count(), 0);
  assert.deepEqual((await searchNavigationSnapshot(page)).ids, beforeInspector.ids, 'Raw refs transition must not change membership');

  await fillSearch(page, 'needle');
  await waitForSearchMarks(page, 9);
  await page.waitForFunction(() => document.querySelector('#searchMetricsPanel')?.textContent.includes('14 occurrences'));
  assert.equal(await page.locator('#detail mark.searchMark').count(), 0);
});

test('browser search navigation temporarily expands hidden command detail targets', async (t) => {
  const index = await buildFixtureIndex();
  const hiddenCommandProfile = {
    id: 'custom:hidden-command',
    name: 'Hidden command search test',
    description: 'Hide commands so search navigation must materialize command details.',
    rules: {
      kindStates: { command: 'hidden' },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenCommandProfile]),
      'sessionAnalyzer.profile': hiddenCommandProfile.id,
    },
  });
  await selectPrimarySession(page);

  await page.waitForFunction(() => document.querySelector('#timeline .event.kind-command.hiddenByProfile'));
  await fillSearch(page, 'alpha failed');
  await page.waitForFunction(() => document.querySelector('.searchInlineCount')?.textContent?.endsWith('/ 1 targets')
    && document.querySelector('#searchMetricsPanel')?.textContent.includes('1 occurrences'));

  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  await page.waitForSelector('#timeline .event.kind-command.expanded .eventBody mark.searchMark.activeSearchMark');

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await page.waitForFunction(() => document.querySelector('#timeline .event.kind-command.hiddenByProfile'));
});

test('browser inspector search reacquires live marks after redraw', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await page.locator('#searchInput').press('Enter');
  await page.waitForSelector('#detail .searchMark');
  const firstDetailTitle = await page.locator('#detail h2').first().textContent();

  await page.locator('[data-search-match-nav="next"]').first().click();
  await page.waitForFunction((title) => document.querySelector('#detail h2')?.textContent !== title, firstDetailTitle);
  await page.waitForSelector('#detail .searchMark.activeSearchMark, #detail .searchMark');
});

test('browser search-transient detail closes when free text no longer matches', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await page.locator('#searchInput').press('Enter');
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, 'definitely-no-search-hit');
  await waitForNoSearchMarks(page);
  await waitForDetailView(page, 'profileRules');

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await page.locator('#searchInput').press('Enter');
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, '');
  await waitForDetailView(page, 'profileRules');
});

test('browser user-confirmed inspector and raw refs persist across free-text changes', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, 'definitely-no-search-hit');
  await waitForNoSearchMarks(page);
  await waitForDetailView(page, 'inspector');

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'inspector');

  await page.locator('[data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');

  await fillSearch(page, 'definitely-no-search-hit');
  await waitForNoSearchMarks(page);
  await waitForDetailView(page, 'rawRefs');

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'rawRefs');
});

test('browser obsolete detail and Raw Reference requests abort without redrawing the replacement view', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(targetId);
  const targetDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(targetId)}/detail`;
  const failures = [];
  page.on('requestfailed', (request) => failures.push({
    path: new URL(request.url()).pathname,
    error: request.failure()?.errorText || '',
  }));

  let releaseDetail;
  const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  let markDetail;
  const detailStarted = new Promise((resolve) => { markDetail = resolve; });
  let firstDetail = true;
  await page.route((url) => new URL(String(url)).pathname === targetDetailPath, async (route) => {
    if (!firstDetail) {
      await route.continue();
      return;
    }
    firstDetail = false;
    markDetail();
    await detailGate;
    try {
      await route.continue();
    } catch {}
  });

  await target.click();
  await detailStarted;
  await page.locator(`[data-session-id="${fixture.secondarySessionId}"]`).click();
  await page.waitForSelector(`[data-session-id="${fixture.secondarySessionId}"].active`);
  await assertEventCount(page, 40);
  releaseDetail();
  await page.waitForTimeout(300);
  assert.ok(failures.some((failure) => (
    failure.path === targetDetailPath && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)
  )));
  assert.equal(await page.locator(`[data-session-id="${fixture.secondarySessionId}"].active`).count(), 1);
  assert.equal(await page.locator('#timeline .event[data-event-id]').count(), 40);

  await page.locator(`[data-session-id="${fixture.longSessionId}"]`).click();
  await assertEventCount(page, 150);
  await page.locator(`[data-event-id="${targetId}"]`).click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading structured detail'));

  const fixtureIndex = await buildFixtureIndex();
  const secondApp = await openApp(t, fixtureIndex, { locale: 'en' });
  await selectPrimarySession(secondApp.page);
  await secondApp.page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(secondApp.page, 'inspector');
  const rawFailures = [];
  secondApp.page.on('requestfailed', (request) => {
    if (/^\/api\/sessions\/[^/]+\/raw\/[^/]+$/.test(new URL(request.url()).pathname)) {
      rawFailures.push(request.failure()?.errorText || '');
    }
  });
  let releaseRaw;
  const rawGate = new Promise((resolve) => { releaseRaw = resolve; });
  let markRaw;
  const rawStarted = new Promise((resolve) => { markRaw = resolve; });
  let rawRequestCount = 0;
  await secondApp.page.route('**/api/sessions/*/raw/*', async (route) => {
    rawRequestCount += 1;
    if (rawRequestCount > 1) {
      await route.continue();
      return;
    }
    markRaw();
    await rawGate;
    try {
      await route.continue();
    } catch {}
  });
  await secondApp.page.locator('[data-detail-action="raw"]').click();
  await rawStarted;
  await waitForDetailView(secondApp.page, 'rawRefs');
  await secondApp.page.locator('[data-detail-action="inspect"]').click();
  await waitForDetailView(secondApp.page, 'inspector');
  releaseRaw();
  await secondApp.page.waitForTimeout(300);
  assert.ok(rawFailures.some((value) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(value)), rawFailures.join(', '));
  await secondApp.page.locator('[data-detail-action="raw"]').click();
  await waitForDetailView(secondApp.page, 'rawRefs');
  await secondApp.page.waitForFunction(() => !document.querySelector('#detail')?.textContent.includes('Loading'));
});

test('browser project scope aborts in-flight selected structured detail before it can restore a session Inspector', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(targetId);
  const targetDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(targetId)}/detail`;
  let releaseDetail;
  const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  let markDetail;
  const detailStarted = new Promise((resolve) => { markDetail = resolve; });
  let firstDetail = true;
  await page.route((url) => new URL(String(url)).pathname === targetDetailPath, async (route) => {
    if (!firstDetail) {
      await route.continue();
      return;
    }
    firstDetail = false;
    markDetail();
    await detailGate;
    try {
      await route.continue();
    } catch {}
  });

  await target.click();
  await detailStarted;
  const detailAbort = page.waitForEvent('requestfailed', (request) => (
    new URL(request.url()).pathname === targetDetailPath
      && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(request.failure()?.errorText || '')
  ));

  await switchToProjectScope(page);
  releaseDetail();
  await detailAbort;
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && Boolean(document.querySelector('#timeline .projectSearchState'))
      && document.querySelector('#detail')?.textContent === ''
  ));
  assert.equal(await page.locator(`[data-event-id="${targetId}"]`).count(), 0);
});

test('browser project scope aborts in-flight Raw References before they can restore a session detail view', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  await page.locator('#timeline .event[data-event-id]').first().click();
  await waitForDetailView(page, 'inspector');

  let releaseRaw;
  const rawGate = new Promise((resolve) => { releaseRaw = resolve; });
  let markRaw;
  const rawStarted = new Promise((resolve) => { markRaw = resolve; });
  let firstRaw = true;
  await page.route('**/api/sessions/*/raw/*', async (route) => {
    if (!firstRaw) {
      await route.continue();
      return;
    }
    firstRaw = false;
    markRaw();
    await rawGate;
    try {
      await route.continue();
    } catch {}
  });

  await page.locator('[data-detail-action="raw"]').click();
  await rawStarted;
  const rawAbort = page.waitForEvent('requestfailed', (request) => (
    /^\/api\/sessions\/[^/]+\/raw\/[^/]+$/.test(new URL(request.url()).pathname)
      && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(request.failure()?.errorText || '')
  ));

  await switchToProjectScope(page);
  releaseRaw();
  await rawAbort;
  await page.waitForFunction(() => (
    document.body.dataset.searchScope === 'project'
      && Boolean(document.querySelector('#timeline .projectSearchState'))
      && document.querySelector('#detail')?.textContent === ''
  ));
});

test('browser Layer transitions abort an in-flight selected detail instead of restoring the previous-layer Inspector', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(targetId);
  const targetDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(targetId)}/detail`;
  let releaseDetail;
  const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  let markDetail;
  const detailStarted = new Promise((resolve) => { markDetail = resolve; });
  let firstDetail = true;
  await page.route((url) => new URL(String(url)).pathname === targetDetailPath, async (route) => {
    if (!firstDetail) {
      await route.continue();
      return;
    }
    firstDetail = false;
    markDetail();
    await detailGate;
    try {
      await route.continue();
    } catch {}
  });

  await target.click();
  await detailStarted;
  const detailAbort = page.waitForEvent('requestfailed', (request) => (
    new URL(request.url()).pathname === targetDetailPath
      && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(request.failure()?.errorText || '')
  ));
  const protocolTimeline = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('layer') === 'protocol'
      && url.searchParams.get('offset') === '0';
  });

  await page.locator('#layerSelect').selectOption('protocol');
  await protocolTimeline;
  releaseDetail();
  await detailAbort;
  await page.waitForFunction(() => (
    document.querySelector('#layerSelect')?.value === 'protocol'
      && !document.querySelector('#detail')?.textContent.includes('Synthetic timeline event 0100.')
  ));
});

test('browser delayed background detail prefetch does not redraw the selected Inspector', async (t) => {
  const { fixture, index } = await makeTransitionProfileIndex(t, { eventCount: 200, hitPositions: [180] });
  const { page } = await openApp(t, index, { locale: 'en' });
  const background = page.locator('#timeline .event[data-event-id]').nth(21);
  const target = page.locator('#timeline .event[data-event-id]').nth(100);
  const backgroundId = await background.getAttribute('data-event-id');
  const targetId = await target.getAttribute('data-event-id');
  assert.ok(backgroundId);
  assert.ok(targetId);
  const backgroundDetailPath = `/api/sessions/${fixture.longSessionId}/events/${encodeURIComponent(backgroundId)}/detail`;
  let releaseBackground;
  const backgroundGate = new Promise((resolve) => { releaseBackground = resolve; });
  let markBackgroundStarted;
  const backgroundStarted = new Promise((resolve) => { markBackgroundStarted = resolve; });
  await page.route((url) => new URL(String(url)).pathname === backgroundDetailPath, async (route) => {
    markBackgroundStarted();
    await backgroundGate;
    try {
      await route.continue();
    } catch {}
  });

  const backgroundToggle = background.locator('.eventHeader [data-action="toggle"]');
  if (await background.evaluate((event) => event.classList.contains('expanded'))) {
    await backgroundToggle.click();
    await page.waitForFunction((eventId) => {
      const event = [...document.querySelectorAll('#timeline .event[data-event-id]')]
        .find((candidate) => candidate.dataset.eventId === eventId);
      return Boolean(event && !event.classList.contains('expanded'));
    }, backgroundId);
  }
  await backgroundToggle.click();
  await backgroundStarted;

  await target.click();
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction((eventId) => {
    const targetEvent = [...document.querySelectorAll('#timeline .event[data-event-id]')]
      .find((candidate) => candidate.dataset.eventId === eventId);
    const detail = document.querySelector('#detail')?.textContent || '';
    return Boolean(targetEvent?.classList.contains('selected'))
      && !detail.includes('Loading structured detail')
      && !document.querySelector('#detail .navStatus');
  }, targetId);
  const selectedInspector = await page.locator('#detail').innerHTML();
  const backgroundResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === backgroundDetailPath && response.status() === 200
  ));

  releaseBackground();
  await backgroundResponse;
  await page.waitForFunction(({ backgroundId: currentBackgroundId, targetId: currentTargetId }) => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    const backgroundEvent = events.find((candidate) => candidate.dataset.eventId === currentBackgroundId);
    const targetEvent = events.find((candidate) => candidate.dataset.eventId === currentTargetId);
    return Boolean(backgroundEvent?.classList.contains('expanded')
      && !backgroundEvent.textContent.includes('Loading structured detail')
      && targetEvent?.classList.contains('selected')
      && !backgroundEvent.classList.contains('selected'));
  }, { backgroundId, targetId });
  assert.equal(await page.locator('#detail').innerHTML(), selectedInspector);
});

test('browser passive search refresh does not downgrade user-confirmed detail views', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await page.locator('#timeline .event[data-event-id]:not(.kind-patch)').first().click();
  await waitForDetailView(page, 'inspector');
  const confirmedTitle = await page.locator('#detail h2').textContent();

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await waitForDetailView(page, 'inspector');
  assert.equal(await page.locator('#detail h2').textContent(), confirmedTitle);

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'inspector');
  assert.equal(await page.locator('#detail h2').textContent(), confirmedTitle);

  await page.locator('[data-detail-action="raw"]').click();
  await waitForDetailView(page, 'rawRefs');
  await page.waitForFunction((title) => document.querySelector('#detail h2')?.textContent !== title, confirmedTitle);
  const rawTitle = await page.locator('#detail h2').textContent();

  await fillSearch(page, 'patch');
  await waitForSearchMarks(page);
  await waitForDetailView(page, 'rawRefs');
  assert.equal(await page.locator('#detail h2').textContent(), rawTitle);

  await page.locator('#searchInput').press('Enter');
  await waitForDetailView(page, 'inspector');
  await page.waitForFunction((title) => document.querySelector('#detail h2')?.textContent !== title, rawTitle);

  await fillSearch(page, '');
  await expectInputValue(page, '#searchInput', '');
  await waitForDetailView(page, 'profileRules');
});

test('browser user-confirmed detail closes when structured filters remove the selected event', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await page.locator('#timeline .event[data-event-id]:not(.kind-patch)').first().click();
  await waitForDetailView(page, 'inspector');

  await addSearchFilter(page, 'kind', 'patch');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length > 0 && events.every((event) => event.classList.contains('kind-patch'));
  });
  await waitForDetailView(page, 'profileRules');
});

test('browser search input treats operator-like text literally and GUI filters stay authoritative', async (t) => {
  const index = await buildFixtureIndex();
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);
  const requestStart = requestedUrls.length;

  await page.locator('#layerSelect').selectOption('raw');
  await expectInputValue(page, '#layerSelect', 'raw');
  await addSearchFilter(page, 'kind', 'exec_command_end');
  await addSearchFilter(page, 'file', 'src/parser.js');

  const committedTimeline = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('layer') === 'raw'
      && url.searchParams.get('q') === 'alpha owner:me status:failed'
      && url.searchParams.get('kind') === 'exec_command_end'
      && url.searchParams.get('file') === 'src/parser.js'
      && !url.searchParams.has('status');
  });
  await fillSearch(page, 'alpha owner:me status:failed');
  await committedTimeline;

  await expectInputValue(page, '#searchInput', 'alpha owner:me status:failed');
  assert.equal(await page.locator('#searchInput').getAttribute('aria-invalid'), null);
  assert.equal(await page.locator('#layerSelect').inputValue(), 'raw');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 2');
  assert.equal(await page.locator('#searchKindSelect').inputValue(), 'exec_command_end');
  assert.equal(await page.locator('#searchFileInput').inputValue(), 'src/parser.js');
  assert.equal(requestedUrls.slice(requestStart).some((value) => value.startsWith('/api/sessions?')), false);

  await addSearchFilter(page, 'status', 'failed');
  await expectInputValue(page, '#searchInput', 'alpha owner:me status:failed');
  assert.equal((await page.locator('#searchFilterCount').textContent()).trim(), 'Filters · 3');

  await clearAllSearch(page);
  await expectInputValue(page, '#layerSelect', 'raw');
  assert.equal(await page.locator('#layerSelect').inputValue(), 'raw');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters');
});

test('browser assist filter transition keeps the next free-text edit on the find-refresh path', async (t) => {
  const fixture = await makeLongCodexHome(t);
  const index = await buildIndex(fixture);
  const { page, requestedUrls } = await openApp(t, index, { locale: 'en' });

  await page.locator('#searchInput').click();
  await addSearchFilter(page, 'file', fixture.sessionId);
  await assertEventCount(page, 150);
  await page.locator('#loadMoreBtn').click();
  await assertEventCount(page, 180);
  const requestStart = requestedUrls.length;

  const findResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/timeline')
      && url.searchParams.get('file') === fixture.sessionId
      && url.searchParams.get('q') === 'alpha';
  });
  await fillSearch(page, 'alpha');
  const response = await findResponse;
  const url = new URL(response.url());
  assert.equal(url.searchParams.get('limit'), '180');
  await assertEventCount(page, 180);
  assert.equal(requestedUrls.slice(requestStart).some((value) => value.startsWith('/api/sessions?')), false);
});

test('browser read from here clears structured filters and preserves free text', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  await fillSearch(page, 'failed');
  await addSearchFilter(page, 'kind', 'patch');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length > 0 && events.every((event) => event.classList.contains('kind-patch'));
  });
  await page.locator('#timeline .event.kind-patch.status-failed').first().click();
  await page.waitForSelector('[data-detail-action="read-from-here"]');
  const selectedId = await page.locator('#timeline .event.selected').first().getAttribute('data-event-id');

  await page.locator('[data-detail-action="read-from-here"]').click();
  await expectInputValue(page, '#searchInput', 'failed');
  await expectInputValue(page, '#layerSelect', 'main');
  await assertEventCount(page, 29);
  await page.waitForFunction((id) => document.querySelector('#timeline .event.selected')?.dataset.eventId === id, selectedId);
});

test('browser folding profile edits save, cancel, and repair invalid localStorage state', async (t) => {
  const index = await buildFixtureIndex();
  const { page, baseUrl } = await openApp(t, index);
  await selectPrimarySession(page);

  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="subagent"]').count(), 0);
  const fallbackPlacement = await page.locator('#detail [data-profile-fallback]').evaluate((select) => ({
    inDefaultDetailsSummary: Boolean(document.querySelector('#detail .profileRuleDetails:first-of-type summary')?.contains(select)),
    inSectionHeader: Boolean(select.closest('.profileRuleSectionHeader')),
  }));
  assert.deepEqual(fallbackPlacement, { inDefaultDetailsSummary: true, inSectionHeader: false });
  await page.locator('#detail [data-profile-fallback]').selectOption('collapsed');
  await expectInputValue(page, '#detail [data-profile-fallback]', 'collapsed');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForSelector('#detail [data-detail-action="cancel-profile"]');
  await page.locator('[data-profile-kind="command"]').selectOption('expanded');
  await page.waitForSelector('#detail [data-detail-action="save-profile"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));
  await page.locator('#detail [data-detail-action="save-profile"]').click();
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value.startsWith('custom:'));
  const savedProfileId = await page.locator('#profileSelect').inputValue();

  await page.reload();
  await page.waitForSelector('.sessionItem.active');
  await selectPrimarySession(page);
  await expectInputValue(page, '#profileSelect', savedProfileId);
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));

  await page.locator('[data-profile-kind="command"]').selectOption('hidden');
  await page.waitForSelector('#detail [data-detail-action="cancel-profile"]');
  await page.locator('#detail [data-detail-action="cancel-profile"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.kind-command')].some((event) => event.classList.contains('expanded')));

  await page.evaluate(() => localStorage.setItem('sessionAnalyzer.profile', 'missing-profile'));
  await page.goto(baseUrl);
  await page.waitForSelector('.sessionItem.active');
  await expectInputValue(page, '#profileSelect', 'narrative');
  const repaired = await page.evaluate(() => localStorage.getItem('sessionAnalyzer.profile'));
  assert.equal(repaired, 'narrative');
});

test('browser folding profile exposes declared Code Mode requests and previews request rules immediately', async (t) => {
  const fixture = await makeCodeModeCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const { page } = await openApp(t, index);

  const codeModeSection = page.locator('#detail [data-profile-section="code-mode"]');
  await codeModeSection.waitFor();
  const eventKindGroupNames = await page.locator(
    '#detail .profileRuleSection',
  ).first().locator(':scope > .profileRuleList > .profileRuleGroup > h4').allTextContents();
  const commonWorkIndex = eventKindGroupNames.findIndex((name) => /Work and tools|工作与工具/.test(name));
  const codeModeIndex = eventKindGroupNames.findIndex((name) => /Code Mode tool calls|Code Mode 工具调用/.test(name));
  assert.ok(commonWorkIndex >= 0);
  assert.equal(codeModeIndex, -1);
  assert.match(
    await codeModeSection.locator('xpath=ancestor::section[contains(@class, "profileRuleGroup")]/h4').textContent(),
    /Work and tools|工作与工具/,
  );
  assert.equal(
    await page.locator('#detail .profileDetailHeader').evaluate((header) => getComputedStyle(header).position),
    'sticky',
  );
  assert.equal(await page.locator('#detail .profileStrategyDescription').count(), 1);
  const stickyHeaderPosition = await page.locator('.detailPane').evaluate((pane) => {
    pane.scrollTop = pane.scrollHeight;
    const header = pane.querySelector('.profileDetailHeader');
    const paneRect = pane.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return {
      scrollable: pane.scrollHeight > pane.clientHeight,
      scrollTop: pane.scrollTop,
      paneTop: paneRect.top,
      panePaddingTop: Number.parseFloat(getComputedStyle(pane).paddingTop) || 0,
      headerTop: headerRect.top,
    };
  });
  if (stickyHeaderPosition.scrollable) {
    assert.ok(stickyHeaderPosition.scrollTop > 0);
    assert.ok(
      Math.abs(
        stickyHeaderPosition.headerTop
        - stickyHeaderPosition.paneTop
        - stickyHeaderPosition.panePaddingTop
      ) <= 2,
      `expected sticky profile header at detail-pane top: ${JSON.stringify(stickyHeaderPosition)}`,
    );
  }
  assert.equal(await codeModeSection.locator('[data-profile-condition="codeModeScriptOperation"]').count(), 1);
  assert.equal(
    await page.locator('#detail [data-profile-condition="codeModeScriptOperation"]').count(),
    1,
  );
  assert.equal(await page.locator('#detail [data-profile-kind="code_mode_script_operation"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="command"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-kind="error"]').count(), 0);
  assert.equal(await page.locator('#detail [data-profile-default-kinds]').count(), 0);
  assert.match(await codeModeSection.locator(':scope > p > strong').textContent(), /Code Mode tool calls|Code Mode 工具调用/);
  assert.equal(await codeModeSection.locator('h4').count(), 0);
  assert.equal(await codeModeSection.locator('[data-profile-condition="codeModeOperation"]').count(), 0);
  assert.match(
    await codeModeSection.locator('[data-profile-condition="codeModeScriptOperation"] option:checked').textContent(),
    /Inherit:|继承：/,
  );
  assert.equal(await codeModeSection.locator('.codeModeRuleCard, .codeModeRequestDetails, .profileRuleCount').count(), 0);
  for (const profileId of ['conversation', 'changes', 'debug', 'search', 'compact']) {
    await page.evaluate((id) => {
      const select = document.querySelector('#detail [data-profile-picker]');
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, profileId);
    await page.waitForFunction((id) => document.querySelector('#profileSelect')?.value === id, profileId);
    if (await page.locator('#detail [data-detail-action="close"]').count()) {
      await page.locator('#detail [data-detail-action="close"]').click();
    }
    await waitForDetailView(page, 'profileRules');
    const placement = await page.evaluate(() => {
      const section = document.querySelector('#detail [data-profile-section="code-mode"]');
      return {
        profile: document.querySelector('#detail [data-profile-picker]')?.value || '',
        count: document.querySelectorAll('#detail [data-profile-section="code-mode"]').length,
        inGroup: Boolean(section?.closest('.profileRuleGroup')),
        inDefaults: Boolean(section?.closest('[data-profile-default-kinds]')),
      };
    });
    assert.deepEqual(placement, {
      profile: profileId,
      count: 1,
      inGroup: true,
      inDefaults: false,
    }, `${profileId} keeps Code Mode controls in the explicit Work and tools group`);
  }
  await page.evaluate(() => {
    const select = document.querySelector('#detail [data-profile-picker]');
    select.value = 'narrative';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#profileSelect')?.value === 'narrative');
  if (await page.locator('#detail [data-detail-action="close"]').count()) {
    await page.locator('#detail [data-detail-action="close"]').click();
  }
  await page.waitForFunction(() => (
    document.querySelector('#detail [data-profile-picker]')?.value === 'narrative'
    && document.querySelectorAll('#detail [data-profile-section="code-mode"]').length === 1
  ));
  const requestRule = page.locator('#detail [data-profile-code-mode-request="wait_agent"]');
  await requestRule.waitFor();
  const rowText = await requestRule.locator('xpath=..').textContent();
  assert.match(rowText, /Wait for subagent|等待子代理/);
  assert.match(rowText, /wait_agent/);
  assert.match(rowText, /Inherit:|继承：/);
  assert.match(await requestRule.locator('option[value=""]').textContent(), /Collapsed|折叠/);

  assert.equal(
    await page.locator('#detail [data-profile-kind="other_tool_call"]').count(),
    0,
    'zero-count ordinary tool kinds stay hidden even when Code Mode requests inherit their rules',
  );

  await requestRule.selectOption('expanded');
  await page.waitForFunction(() => [...document.querySelectorAll('#timeline .event.code-mode-single-tool')]
    .some((event) => event.classList.contains('expanded')));
  assert.equal(await requestRule.locator('xpath=..').locator('.profileRuleChanged').count(), 1);
});

test('browser structured filters keep profile-hidden Code Mode request results visible', async (t) => {
  const fixture = await makeCodeModeSearchPreviewCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const hiddenProfile = {
    id: 'custom:hidden-code-mode-filter-results',
    name: 'Hidden Code Mode filter results',
    description: 'Exercises the structured-filter visibility floor.',
    rules: {
      kindStates: {},
      codeModeRequestStates: {},
      fallback: 'hidden',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    locale: 'en',
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([hiddenProfile]),
      'sessionAnalyzer.profile': hiddenProfile.id,
    },
  });

  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.hiddenByProfile').length >= 3
  ));
  assert.equal(await page.locator('#searchKindSelect option[value="code_mode_operation"]').count(), 0);
  assert.equal(await page.locator('[data-search-filter-row="codeModeRequest"]').count(), 0);
  assert.equal(
    await page.locator('#searchKindSelect optgroup[data-kind-group="code-mode"]').getAttribute('label'),
    '↳ Code Mode tool call',
  );
  assert.match(
    await page.locator('#searchKindSelect option[value="code_mode_request:shell_command"]').textContent(),
    /Declared: Shell command \(1\)/,
  );
  assert.match(
    await page.locator('#searchKindSelect option[value="code_mode_script_operation"]').textContent(),
    /Scripted operation \(1\)/,
  );
  await addSearchFilter(page, 'kind', 'code_mode_request:shell_command');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_request:shell_command');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters · 1');

  await addSearchFilter(page, 'kind', 'code_mode_script_operation');
  await page.waitForFunction(() => {
    const events = [...document.querySelectorAll('#timeline .event[data-event-id]')];
    return events.length === 1
      && events[0].classList.contains('collapsed')
      && !events[0].classList.contains('hiddenByProfile');
  });
  await expectInputValue(page, '#searchKindSelect', 'code_mode_script_operation');
  assert.equal(await page.locator('#searchFilterCount').textContent(), 'Filters · 1');

  await clearAllSearch(page);
  await page.waitForFunction(() => (
    document.querySelectorAll('#timeline .event.hiddenByProfile').length >= 3
  ));
});

test('browser folding profile seeds dynamic kinds from the full session catalog', async (t) => {
  const fixture = await makeHookCodexHome(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const { page } = await openApp(t, index);

  await page.waitForFunction(() => document.querySelectorAll('#timeline .event.kind-hook').length === 0);
  await page.waitForSelector('#detail [data-profile-kind="hook"]');
  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').inputValue(), 'summary');
});

test('browser folding profile ignores inherited dynamic kinds in legacy custom profiles', async (t) => {
  const index = await buildFixtureIndex();
  const legacyProfile = {
    id: 'custom:legacy',
    name: 'Legacy custom profile',
    description: 'Saved before custom profile base ids were available.',
    rules: {
      kindStates: {
        user_message: 'expanded',
        assistant_message: 'expanded',
        hook: 'summary',
      },
      fallback: 'summary',
      conditions: [],
    },
  };
  const { page } = await openApp(t, index, {
    localStorage: {
      'sessionAnalyzer.customProfiles': JSON.stringify([legacyProfile]),
    },
  });
  await selectPrimarySession(page);

  assert.equal(await page.locator('#detail [data-profile-kind="hook"]').count(), 0);
});

test('browser issues metric toggles error-focus profile without losing session or adding filters', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, { locale: 'en' });
  await selectPrimarySession(page);

  const issuesMetric = page.locator('.metric', { hasText: 'Issues' }).first();
  await issuesMetric.click();
  await expectInputValue(page, '#profileSelect', 'debug');
  await expectInputValue(page, '#searchInput', '');
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, primaryFixtureSessionId);
  assert.equal(await issuesMetric.getAttribute('aria-pressed'), 'true');

  await issuesMetric.click();
  await expectInputValue(page, '#profileSelect', 'narrative');
  await page.waitForFunction((sessionId) => document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId, primaryFixtureSessionId);
});

test('browser expanded event collapse works with mouse and keyboard controls', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index);
  await selectPrimarySession(page);

  const firstEvent = page.locator('#timeline .event[data-event-id]').first();
  const headerToggle = firstEvent.locator('.eventHeader [data-action="toggle"]');
  const footerToggle = firstEvent.locator('.eventFooterActions [data-action="toggle"]');
  await firstEvent.click();
  await page.waitForFunction(() => document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
  await footerToggle.click();
  await page.waitForFunction(() => !document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));

  await headerToggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
  await footerToggle.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('#timeline .event[data-event-id]')?.classList.contains('expanded'));
});
