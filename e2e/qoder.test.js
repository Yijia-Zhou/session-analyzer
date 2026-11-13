'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const editedPath = `C:\\synthetic\\${'nested'.repeat(16)}\\synthetic.txt`;
const text = (value) => ({ type: 'text', text: value });
const call = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, content) => ({ type: 'tool_result', tool_use_id: id, content, is_error: false });

async function nativeFixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'qoder-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'projects', 'synthetic-project');
  const nativeId = 'qoder-native-browser';
  await fs.mkdir(repo);
  await fs.mkdir(directory, { recursive: true });
  let sequence = 0;
  const message = (type, uuid, parentUuid, content, extra = {}) => ({
    type, uuid, parentUuid, sessionId: nativeId, cwd: repo,
    timestamp: new Date(Date.UTC(2026, 10, 1, 0, 0, sequence++)).toISOString(),
    version: '1.1.79-hotfix.19', isSidechain: false, userType: 'external', entrypoint: 'cli',
    permissionMode: 'default', message: { role: type, content }, ...extra,
  });
  // Synthetic saved Qoder records only; these commands are displayed, never executed.
  const rows = [
    message('user', 'user', null, [text('Inspect the synthetic native Qoder history.')]),
    message('assistant', 'reasoning', 'user', [{ type: 'thinking', thinking: 'QODER_REASONING_MARKER' }]),
    message('assistant', 'command-call', 'reasoning', [call('command-1', 'Bash', { command: 'printf QODER_COMMAND_REQUEST' })]),
    message('user', 'command-result', 'command-call', [result('command-1', 'QODER_COMMAND_OUTPUT')], {
      toolUseResult: { kind: 'completed', exitCode: 0, interrupted: false, stdout: 'QODER_COMMAND_OUTPUT', stderr: '' },
    }),
    message('assistant', 'edit-call', 'command-result', [call('edit-1', 'Edit', {
      file_path: editedPath, replacements: [{ old_string: 'QODER_DIFF_OLD', new_string: 'QODER_DIFF_NEW' }],
    })]),
    message('user', 'edit-result', 'edit-call', [result('edit-1', 'QODER_EDIT_RECEIPT')], {
      toolUseResult: { success: true, file_path: editedPath, additions: 1, deletions: 1,
        diff: '--- a/synthetic.txt\n+++ b/synthetic.txt\n@@ -1 +1 @@\n-QODER_DIFF_OLD\n+QODER_DIFF_NEW' },
    }),
    message('user', 'image-input', 'edit-result', [text('QODER_IMAGE_PROMPT'),
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png, path: '/synthetic/never-open.png' } }]),
    message('assistant', 'agent-call', 'image-input', [call('agent-1', 'Agent', {
      description: 'Inspect the synthetic child', subagent_type: 'general-purpose', prompt: 'QODER_AGENT_PROMPT',
    })]),
  ];
  const childRows = [
    message('user', 'child-user', null, [text('QODER_CHILD_INPUT')], {
      isSidechain: true, agentId: 'child', parent_tool_use_id: 'agent-1',
    }),
    message('assistant', 'child-answer', 'child-user', [text('QODER_CHILD_RESPONSE')], {
      isSidechain: true, agentId: 'child', parent_tool_use_id: 'agent-1',
    }),
  ];
  const parentFile = path.join(directory, nativeId + '.jsonl');
  const childFile = path.join(directory, nativeId, 'subagents', 'agent-child.jsonl');
  await fs.mkdir(path.dirname(childFile), { recursive: true });
  const originals = new Map([[parentFile, rows], [childFile, childRows]].map(([file, records]) => (
    [file, records.map((row) => JSON.stringify(row)).join('\n') + '\n']
  )));
  for (const [file, contents] of originals) await fs.writeFile(file, contents);
  return { home, repo, originals };
}

for (const width of [1440, 390]) test(`Qoder native labels, command, diff, saved image and child navigation (${width})`, { timeout: 45000 }, async (t) => {
  const fixture = await nativeFixture(t);
  const service = await createHistoryService({ repo: fixture.repo, source: 'qoder', qoderHome: fixture.home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const openHit = async (query) => {
    const hits = (await service.execute('search', { query, layer: 'main' })).items;
    assert.equal(hits.length, 1, `${query} has one native logical owner`);
    const hit = hits[0];
    await page.goto(`${base}/#ref=${encodeURIComponent(hit.ref)}`);
    await page.waitForFunction(({ sessionId, eventId }) => (
      document.querySelector('#sessionList .sessionItem.active')?.dataset.sessionId === sessionId
      && document.querySelector('#timeline article.selected')?.dataset.eventId === eventId
    ), hit);
    if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
    await page.waitForFunction((marker) => document.querySelector('#timeline article.selected')?.textContent.includes(marker), query);
    return hit;
  };

  const reasoning = await openHit('QODER_REASONING_MARKER');
  assert.equal(reasoning.kind, 'reasoning');
  const reasoningLabel = page.locator('#timeline article.selected.kind-reasoning > .eventHeader > .eventKind');
  assert.equal(await reasoningLabel.innerText(), 'Reasoning');
  assert.equal(await reasoningLabel.isVisible(), true);
  await page.locator('#localeSelect').selectOption('zh-CN', { force: true });
  await page.waitForFunction(() => (
    document.querySelector('#timeline article.selected.kind-reasoning > .eventHeader > .eventKind')?.textContent === '推理'
  ));
  assert.equal(await reasoningLabel.isVisible(), true);
  await page.locator('#localeSelect').selectOption('en', { force: true });
  await page.waitForFunction(() => (
    document.querySelector('#timeline article.selected.kind-reasoning > .eventHeader > .eventKind')?.textContent === 'Reasoning'
  ));

  const command = await openHit('QODER_COMMAND_OUTPUT');
  assert.equal(command.kind, 'command');
  assert.equal(command.status, 'success');
  const commandText = await page.locator('#timeline article.selected').innerText();
  assert.match(commandText, /printf QODER_COMMAND_REQUEST/);
  assert.match(commandText, /QODER_COMMAND_OUTPUT/);
  if (width < 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await page.locator('#detail [data-detail-action="raw"]').click();
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('QODER_COMMAND_OUTPUT'));
  const rawText = await page.locator('#detail .rawRefsView').innerText();
  assert.match(rawText, /QODER_COMMAND_REQUEST/);
  assert.match(rawText, /command-1/);
  assert.match(rawText, /tool_result/);

  await openHit('QODER_DIFF_NEW');
  await page.locator('#timeline article.selected .diffLine.added').waitFor();
  assert.equal(await page.locator('#timeline article.selected .diffLine.added').innerText(), '+QODER_DIFF_NEW');
  assert.equal(await page.locator('#timeline article.selected .diffLine.removed').innerText(), '-QODER_DIFF_OLD');
  assert.match(await page.locator('#timeline article.selected').innerText(), /synthetic\.txt/);
  assert.match(await page.locator('#timeline article.selected').innerText(), /QODER_EDIT_RECEIPT/);
  const recordedPath = page.locator('#timeline article.selected .kvTable td').filter({ hasText: editedPath });
  assert.equal(await recordedPath.textContent(), editedPath, 'the complete recorded path remains readable');
  const pathLayout = await recordedPath.evaluate((cell) => {
    const wrap = cell.closest('.kvWrap');
    const table = cell.closest('table');
    return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      tableWidth: table.getBoundingClientRect().width, wrapWidth: wrap.clientWidth,
      cellWidth: cell.clientWidth, cellScrollWidth: cell.scrollWidth };
  });
  assert.ok(pathLayout.pageWidth <= pathLayout.viewport, JSON.stringify(pathLayout));
  assert.ok(pathLayout.tableWidth <= pathLayout.wrapWidth, JSON.stringify(pathLayout));
  assert.ok(pathLayout.cellScrollWidth <= pathLayout.cellWidth, JSON.stringify(pathLayout));

  // Leave the bounded search-reference context to read the complete parent Session.
  await page.goto(base);
  await page.locator(`#sessionList .sessionItem[data-session-id="${command.sessionId}"]`).click();
  if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
  await page.waitForFunction((id) => document.querySelector('#sessionList .sessionItem.active')?.dataset.sessionId === id, command.sessionId);
  const timeline = await page.request.get(`${base}/api/sessions/${encodeURIComponent(command.sessionId)}/timeline?layer=main&limit=100`);
  assert.equal(timeline.status(), 200);
  const imageEvent = (await timeline.json()).events.find((event) => event.preview === 'Image attachment');
  assert.ok(imageEvent);
  await page.locator(`#timeline article[data-event-id="${imageEvent.id}"]`).click();
  if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
  const preview = page.locator('#timeline article.selected .imagePreviewGrid img');
  await preview.waitFor();
  await preview.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const image = document.querySelector('#timeline article.selected .imagePreviewGrid img');
    return image?.complete && image.naturalWidth === 1 && image.naturalHeight === 1;
  });
  assert.equal(await preview.getAttribute('loading'), 'lazy');
  assert.equal((await page.locator('#timeline article.selected').innerText()).includes(png), false);
  const imageResponse = await page.request.get(base + await preview.getAttribute('src'));
  assert.equal(imageResponse.status(), 200);
  assert.equal(imageResponse.headers()['content-type'], 'image/png');
  assert.deepEqual(await imageResponse.body(), Buffer.from(png, 'base64'));

  const agent = await openHit('QODER_AGENT_PROMPT');
  if (width < 760) await page.getByRole('button', { name: 'Detail', exact: true }).click();
  const childLink = page.locator('#detail [data-open-collaboration-session]');
  await childLink.waitFor();
  assert.equal(await childLink.count(), 1, 'one native parent call resolves one recorded child');
  const childId = await childLink.getAttribute('data-open-collaboration-session');
  assert.notEqual(childId, agent.sessionId);
  await childLink.click();
  await page.waitForFunction((id) => document.querySelector('#sessionList .sessionItem.active')?.dataset.sessionId === id, childId);
  if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('QODER_CHILD_RESPONSE'));
  assert.equal(await page.locator('#timeline').getByText('QODER_CHILD_RESPONSE', { exact: true }).isVisible(), true);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction(({ sessionId, eventId }) => (
    document.querySelector('#sessionList .sessionItem.active')?.dataset.sessionId === sessionId
    && document.querySelector('#timeline article.selected')?.dataset.eventId === eventId
  ), agent);

  assert.deepEqual(errors, []);
  for (const [file, contents] of fixture.originals) assert.equal(await fs.readFile(file, 'utf8'), contents);
});
