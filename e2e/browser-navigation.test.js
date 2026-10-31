'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { withNavigationDiagnostics } = require('./browser-diagnostics');

const {
  repoRoot,
  deferred,
  openApp,
  writeJsonl,
  fillSearch,
  addSearchFilter,
  switchToProjectScope,
} = require('./browser-helpers');

async function makeCollaborationNavigationFixture(t, { precedingCount = 12, statusOnly = false, repeatedWait = false, nested = false } = {}) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'collaboration-navigation-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  const parentId = 'aaaaaaaa-0922-4922-8922-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-0922-4922-8922-bbbbbbbbbbbb';
  const otherId = 'cccccccc-0922-4922-8922-cccccccccccc';
  const timestamp = '2026-09-22T10:00:00.000Z';
  const message = (text) => ({ timestamp, type: 'event_msg', payload: { type: 'user_message', message: text } });
  await writeJsonl(path.join(home, 'sessions', `rollout-${parentId}.jsonl`), [
    { timestamp, type: 'session_meta', payload: { id: parentId, cwd: project } },
    ...Array.from({ length: precedingCount }, (_, i) => message(`Parent navigation context ${i}`)),
    { timestamp, type: 'response_item', payload: { type: 'function_call', name: statusOnly ? 'list_agents' : 'wait_agent', call_id: 'wait-nav', arguments: JSON.stringify(statusOnly ? {} : { targets: [childId, otherId, 'missing-agent'], timeout_ms: 1000 }) } },
    { timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-nav', output: JSON.stringify({ status: { [childId]: { completed: 'Child recorded result' }, [otherId]: { completed: 'Other recorded result' }, ...(statusOnly ? { 'missing-agent': 'running', status: 'running' } : {}) } }) } },
    ...(repeatedWait ? [
      message('Between collaboration calls'),
      { timestamp, type: 'response_item', payload: { type: 'function_call', name: 'wait_agent', call_id: 'wait-nav-again', arguments: JSON.stringify({ targets: [childId] }) } },
      { timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-nav-again', output: JSON.stringify({ status: { [childId]: { completed: 'Repeated result' } } }) } },
    ] : []),
    ...Array.from({ length: 8 }, (_, i) => message(`Parent trailing context ${i}`)),
  ]);
  for (const [id, title] of [[childId, 'Child own work'], [otherId, 'Other own work']]) {
    await writeJsonl(path.join(home, 'sessions', `rollout-${id}.jsonl`), [
      { timestamp, type: 'session_meta', payload: { id, cwd: project, source: { subagent: { thread_spawn: { parent_thread_id: nested && id === otherId ? childId : parentId } } } } },
      message(title),
      message(`${title} second event`),
      ...(nested && id === childId ? [
        { timestamp, type: 'response_item', payload: { type: 'function_call', name: 'wait_agent', call_id: 'nested-wait', arguments: JSON.stringify({ targets: [otherId] }) } },
        { timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id: 'nested-wait', output: JSON.stringify({ status: { [otherId]: { completed: 'Nested result' } } }) } },
      ] : []),
    ]);
  }
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  const parent = await materializeSessionForIndex(index, index.sessionsById.get(parentId));
  const eventId = parent.logicalEvents.find((event) => event.kind === 'agent_coordination').id;
  return { index, parentId, childId, otherId, eventId,
    repeatedEventId: parent.logicalEvents.find((event) => event.id.endsWith(':wait-nav-again'))?.id,
    sourceEventId: parent.logicalEvents.find((event) => event.layer === 'main').id };
}

async function makeFileNavigationFixture(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-reading-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo');
  const sessionId = 'dddddddd-0922-4922-8922-dddddddddddd';
  const timestamp = '2026-09-22T12:00:00.000Z';
  const patch = (id, extra = '') => [
    { timestamp, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: id,
      input: `*** Begin Patch\n*** Update File: src/a.js\n@@\n-before\n+after\n${extra}*** End Patch` } },
    { timestamp, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: 'Success' } },
  ];
  await writeJsonl(path.join(home, 'sessions', `rollout-${sessionId}.jsonl`), [
    { timestamp, type: 'session_meta', payload: { id: sessionId, cwd: project } },
    ...patch('patch-origin', '*** Add File: src/b.js\n+another file\n'),
    ...Array.from({ length: 170 }, (_, i) => ({ timestamp, type: 'event_msg', payload: { type: 'user_message', message: `Context ${i}` } })),
    ...Array.from({ length: 55 }, (_, i) => patch(`patch-followup-${i}`)).flat(),
  ]);
  const otherId = 'eeeeeeee-0922-4922-8922-eeeeeeeeeeee';
  await writeJsonl(path.join(home, 'sessions', `rollout-${otherId}.jsonl`), [
    { timestamp, type: 'session_meta', payload: { id: otherId, cwd: project } },
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'Other file work' } },
    ...patch('patch-other-session'),
  ]);
  const index = await buildIndex({ repoRoot: project, codexHome: home });
  const session = await materializeSessionForIndex(index, index.sessionsById.get(sessionId));
  return { index, sessionId, otherId, eventId: session.logicalEvents.find((event) => event.kind === 'patch').id,
    lastEventId: session.logicalEvents.filter((event) => event.kind === 'patch').at(-1).id };
}

test('DeepSeek workflow member evidence and raw owners navigate across layers with exact reading return', async (t) => {
  const { buildDeepSeekIndex } = require('../src/deepseek-harness');
  const index = await buildDeepSeekIndex({ sourceHome: path.join(__dirname, '../test/fixtures/deepseek-harness-phase2b/sessions'),
    repoRoot: '/synthetic/deepseek-phase2b-workflow' });
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  const workflow = session.logicalEvents.find((event) => event.subtype === 'tool-workflow/run');
  const { page } = await openApp(t, index, { locale: 'zh-CN' });
  await page.locator('#layerSelect').selectOption('protocol');
  await page.locator(`.event[data-event-id="${workflow.id}"]`).click();
  const member = page.locator('#detail .eventRefsBlock').filter({ hasText: '工作流成员证据' }).locator('[data-target-layer="raw"]').first();
  const rawId = await member.getAttribute('data-target-event-id');
  await member.click();
  await page.waitForFunction(() => document.querySelector('#layerSelect').value === 'raw');
  const owner = page.locator(`#detail [data-target-event-id="${workflow.id}"]`).first();
  await owner.click();
  await page.waitForFunction(() => document.querySelector('#layerSelect').value === 'protocol');
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.querySelector('#layerSelect').value === 'raw' && document.activeElement?.dataset.targetEventId === id, workflow.id);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.querySelector('#layerSelect').value === 'protocol' && document.activeElement?.dataset.targetEventId === id, rawId);
});

test('DeepSeek Code Mode member directory and owner links preserve the reading source', async (t) => {
  const { buildDeepSeekIndex } = require('../src/deepseek-harness');
  const index = await buildDeepSeekIndex({ sourceHome: path.join(__dirname, '../test/fixtures/deepseek-harness-phase2b/sessions'),
    repoRoot: '/synthetic/deepseek-phase2b-code' });
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  const outer = session.logicalEvents.find((event) => event.codeModeOperation?.outerCallId === 'outer-nested');
  const targetId = outer.codeModeOperation.eventRefs[0];
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`.event[data-event-id="${outer.id}"]`).click();
  await page.locator(`#detail [data-target-event-id="${targetId}"]`).click();
  await page.waitForSelector(`#detail [data-target-event-id="${outer.id}"]`);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.activeElement?.dataset.targetEventId === id, targetId);
});

for (const locale of ['en', 'zh-CN']) for (const presentation of ['timeline', 'trajectory']) {
  test(`file activity actions preserve recorded identity (${locale}, ${presentation})`, async (t) => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'recorded-file-actions-'));
    t.after(() => fsp.rm(home, { recursive: true, force: true }));
    const project = '/repo';
    const sessionId = 'cccccccc-0923-4923-8923-cccccccccccc';
    const paths = ['src/a.js ', 'src/a.js', '/repo/src/link/../a.js', 'src/link/../a.js', 'Status'];
    await writeJsonl(path.join(home, 'sessions', `rollout-${sessionId}.jsonl`), [
      { type: 'session_meta', payload: { id: sessionId, cwd: project } },
      ...paths.map((file, i) => ({ type: 'event_msg', payload: { type: 'patch_apply_end', call_id: `identity-${i}`,
        success: true, changes: { [file]: { type: 'update', unified_diff: '@@ -1 +1 @@\n-before\n+after' } } } })),
    ]);
    const index = await buildIndex({ repoRoot: project, codexHome: home });
    const session = await materializeSessionForIndex(index, index.sessionsById.get(sessionId));
    const patches = session.logicalEvents.filter((event) => event.kind === 'patch');
    assert.equal(patches.length, paths.length);
    const { page } = await openApp(t, index, { locale });
    await page.locator(`[data-session-id="${sessionId}"]`).click();
    if (presentation === 'trajectory') await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    for (const i of [0, 2, 4]) {
      const eventId = patches[i].id;
      await page.locator(presentation === 'timeline' ? `.event[data-event-id="${eventId}"] .eventHeader` : `[data-trajectory-event-id="${eventId}"]`).first().click();
      const surface = presentation === 'timeline' ? `#timeline .event[data-event-id="${eventId}"]` : '#detail';
      for (const selector of [`${surface} .patchFile [data-file-activity]`, '#detail .kvTable [data-file-activity]']) {
        const button = page.locator(selector).first();
        await button.waitFor();
        if (i === 4) assert.equal(await button.innerText(), 'Status');
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/file-activity'));
        await button.click();
        const response = await responsePromise;
        const data = await response.json();
        assert.equal(new URL(response.url()).searchParams.get('file'), paths[i]);
        assert.deepEqual(data.events.map((event) => event.id), (i === 2 ? [patches[2], patches[3]] : [patches[i]]).map((event) => event.id));
        assert.equal(data.total, i === 2 ? 2 : 1);
        await page.locator('[data-file-activity-entry]').first().waitFor();
        await page.locator('[data-file-activity-close]').click();
      }
    }
  });
}

test('file activity navigation preserves large offsets and rejects a response from a different page', async (t) => {
  const { index, sessionId, eventId } = await makeFileNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  await page.locator(`#timeline .event[data-event-id="${eventId}"] [data-file-activity="src/a.js"]`).first().click();
  await page.waitForSelector('[data-file-activity-page="50"]');
  await page.locator('[data-file-activity-page="50"]').evaluate(button => { button.dataset.fileActivityPage = '1000500'; });
  const responsePromise = page.waitForResponse(response => response.url().includes('/file-activity?')
    && new URL(response.url()).searchParams.get('offset') === '1000500');
  await page.locator('[data-file-activity-page="1000500"]').click();
  const response = await responsePromise;
  const body = await response.json();
  assert.equal(body.offset, 1000500);
  assert.equal(Number(new URL(response.url()).searchParams.get('indexRevision')), body.indexRevision);
  await page.waitForSelector('[data-file-activity-page="1000450"]');
  assert.equal(await page.locator('[data-file-activity-entry]').count(), 0);
  await page.route('**/file-activity?*', async route => {
    const result = await route.fetch();
    const value = await result.json();
    await route.fulfill({ response: result, json: { ...value, offset: 1000000 } });
  });
  await page.locator('[data-file-activity-page="1000450"]').click();
  await page.locator('.fileActivityDialog [role="alert"]').waitFor();
  assert.match(await page.locator('.fileActivityDialog [role="alert"]').innerText(), /page changed/);
  assert.equal(await page.locator('[data-file-activity-entry]').count(), 0);
});

test('file navigation exposes a local patch directory and paginated recorded activities with reading return', async (t) => {
  const { index, sessionId, eventId, lastEventId } = await makeFileNavigationFixture(t);
  for (const presentation of ['timeline', 'trajectory']) {
    const { page, baseUrl } = await openApp(t, index, { locale: 'en' });
    await page.locator(`[data-session-id="${sessionId}"]`).click();
    await page.locator(`.event[data-event-id="${eventId}"] .eventHeader`).click();
    if (presentation === 'trajectory') await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    const surface = presentation === 'timeline' ? `#timeline .event[data-event-id="${eventId}"]` : '#detail';
    await page.locator(`${surface} [data-patch-file-index="1"]`).click();
    assert.equal(await page.locator(`${surface} .patchFile[data-patch-index="1"]`).evaluate((node) => node === document.activeElement), true);
    const file = page.locator(`${surface} .patchFile [data-file-activity="src/a.js"]`).first();
    await file.click();
    await page.waitForSelector('[data-file-activity-entry]');
    assert.equal(await page.locator('[data-file-activity-entry]').count(), 50);
    assert.match(await page.locator('.fileActivityDialog').innerText(), /56 related records/);
    await page.locator('[data-file-activity-page="50"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-file-activity-entry]').length === 6);
    await page.locator('[data-file-activity-entry]').last().click();
    await page.waitForFunction((id) => document.querySelector('body')?.dataset.detailEventId === id
      || document.querySelector(`[data-event-id="${CSS.escape(id)}"].selected, [data-trajectory-event-id="${CSS.escape(id)}"].selected`), lastEventId);
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction(() => document.activeElement?.dataset.fileActivity === 'src/a.js');
    assert.equal(await file.evaluate((node) => node === document.activeElement), true);
    const response = await page.request.get(`${baseUrl}/api/sessions/${sessionId}/file-activity?file=src%2Fa.js.map`);
    assert.equal((await response.json()).total, 0);
  }
});

test('file navigation recovers failed lists, cancels stale requests and searches the project without losing source context', async (t) => {
  const { index, sessionId, otherId, eventId } = await makeFileNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 390, height: 900 } });
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  const file = page.locator(`#timeline .event[data-event-id="${eventId}"] [data-file-activity="src/a.js"]`).first();
  let requests = 0;
  await page.route('**/file-activity?*', async (route) => {
    requests += 1;
    if (requests === 1) await route.fulfill({ status: 503, json: { error: 'Synthetic file list failure' } });
    else await route.continue();
  });
  await file.click();
  await page.locator('[data-file-activity-page="0"]').click();
  await page.waitForSelector('[data-file-activity-entry]');
  await page.locator('[data-file-activity-project]').click();
  await page.waitForFunction(() => document.querySelector('.fileActivityDialog')?.textContent.includes('Project path-filter match'));
  await page.locator('[data-file-activity-entry]').filter({ hasText: 'Other file work' }).click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, otherId);
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'events');
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction(() => document.activeElement?.dataset.fileActivity === 'src/a.js');
  const gate = deferred();
  t.after(() => gate.resolve());
  await page.route('**/file-activity?*', async (route) => { await gate.promise; await route.continue().catch(() => {}); });
  await file.click();
  await page.keyboard.press('Escape');
  gate.resolve();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.fileActivityDialog').count(), 0);
});

test('session reading paths open siblings and resume a previously visited event with return', async (t) => {
  const { index, parentId, childId, otherId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  const second = page.locator('#timeline .event').nth(1);
  const secondId = await second.getAttribute('data-event-id');
  await second.click();
  await page.locator('.sessionReadingRelations summary').click();
  await page.locator(`[data-reading-session="${otherId}"]`).click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Other own work'));
  await page.locator('.sessionReadingRelations summary').click();
  await page.locator(`[data-reading-session="${childId}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`.event[data-event-id="${CSS.escape(id)}"].selected`), secondId);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Other own work'));
  await page.waitForFunction((id) => document.activeElement?.dataset.readingSession === id, childId);
});

for (const mode of ['project', 'session']) for (const intent of ['unchanged', 'query', 'filter', 'presentation', 'mobile', 'stale-error', 'current-error']) {
  test(`file target envelope respects reading context: ${mode} / ${intent}`, async (t) => {
    const { index, sessionId, otherId, lastEventId } = await makeFileNavigationFixture(t);
    const { page } = await openApp(t, index, { locale: 'en', viewport: { width: 390, height: 900 } });
    await page.locator(`[data-session-id="${mode === 'project' ? otherId : sessionId}"]`).click();
    await page.locator('#timeline [data-file-activity="src/a.js"]').first().click();
    if (mode === 'project') await page.locator('[data-file-activity-project]').click();
    else {
      await page.locator('[data-file-activity-page="50"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-file-activity-entry]').length === 6);
    }
    const entry = mode === 'project'
      ? page.locator('[data-file-activity-entry]').filter({ hasNotText: 'Other file work' })
      : page.locator('[data-file-activity-entry]').last();
    await entry.waitFor();
    const started = deferred();
    const release = deferred();
    const finished = deferred();
    t.after(() => release.resolve());
    await page.route(`**/api/sessions/${sessionId}/events/${encodeURIComponent(lastEventId)}?*`, async (route) => {
      started.resolve();
      await release.promise;
      if (intent.endsWith('error')) await route.fulfill({ status: 503, json: { error: 'Synthetic target fetch failure' } }).catch(() => {});
      else await route.continue().catch(() => {});
      finished.resolve();
    });
    await entry.click();
    await started.promise;
    if (intent === 'query' || intent === 'stale-error') await fillSearch(page, 'newer search');
    if (intent === 'filter') await addSearchFilter(page, 'kind', 'user_message');
    if (intent === 'presentation') await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    if (intent === 'mobile') await page.locator('button[data-mobile-view="detail"]').click();
    const before = await page.evaluate(() => ({ surface: document.body.dataset.mobileView, y: window.scrollY,
      selected: document.querySelector('#timeline .event.selected, #timeline [data-trajectory-event-id].selected')?.dataset.eventId || '' }));
    release.resolve();
    await finished.promise;
    await page.waitForLoadState('networkidle');
    if (intent === 'unchanged') {
      await page.waitForFunction((id) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"].selected`), lastEventId);
      await page.locator('#sessionHeader [data-reading-back]').click();
      await page.waitForFunction(() => document.activeElement?.dataset.fileActivity === 'src/a.js');
    } else {
      assert.equal(await page.locator(`#timeline [data-event-id="${lastEventId}"].selected, #timeline [data-trajectory-event-id="${lastEventId}"].selected`).count(), 0);
      if (intent === 'current-error') assert.match(await page.locator('#stateLine').innerText(), /Synthetic target fetch failure/);
      else {
        assert.equal(await page.locator('#timeline .temporaryReferenceReveal').count(), 0);
        assert.equal(await page.locator('body').getAttribute('data-mobile-view'), before.surface);
        assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - before.y) < 3);
        assert.doesNotMatch(await page.locator('#stateLine').innerText(), /Synthetic target fetch failure|Unknown event/);
      }
    }
  });
}

for (const entry of ['related', 'file', 'collaboration']) {
  test(`reading-session entry ${entry} yields to context changes during delayed analysis`, async (t) => {
    const fixture = entry === 'file' ? await makeFileNavigationFixture(t) : await makeCollaborationNavigationFixture(t);
    for (const intent of ['raw', 'query', 'filter', 'presentation', 'failed-raw']) {
      const { page } = await openApp(t, fixture.index, { locale: 'en',
        viewport: entry === 'file' ? { width: 390, height: 900 } : undefined });
      const sourceId = fixture.sessionId || fixture.parentId;
      await page.locator(`[data-session-id="${sourceId}"]`).click();
      let targetId;
      let trigger;
      if (entry === 'file') {
        await page.locator(`#timeline [data-file-activity="src/a.js"]`).first().click();
        await page.locator('[data-file-activity-project]').click();
        trigger = page.locator('[data-file-activity-entry]').filter({ hasText: 'Other file work' });
        await trigger.waitFor();
        targetId = fixture.otherId;
      } else {
        await page.locator(`.event[data-event-id="${fixture.eventId}"]`).click();
        trigger = page.locator(`#timeline [data-open-collaboration-session="${fixture.childId}"]`).first();
        targetId = fixture.childId;
        if (entry === 'related') {
          await trigger.click();
          await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
          await page.waitForLoadState('networkidle');
          await page.locator('.sessionReadingRelations summary').click();
          targetId = fixture.otherId;
          trigger = page.locator(`[data-reading-session="${targetId}"]`);
        }
      }
      const target = await materializeSessionForIndex(fixture.index, fixture.index.sessionsById.get(targetId));
      const gate = deferred();
      const started = deferred();
      t.after(() => gate.resolve());
      await page.route(`**/api/sessions/${targetId}/analysis*`, async (route) => {
        started.resolve(); await gate.promise;
        if (intent === 'failed-raw') await route.fulfill({ status: 503, json: { error: 'Synthetic stale analysis' } }).catch(() => {});
        else await route.continue().catch(() => {});
      });
      await trigger.click();
      await started.promise;
      await page.locator(`.event[data-event-id="${target.logicalEvents.find((event) => event.layer === 'main').id}"]`).waitFor();
      if (intent.endsWith('raw')) {
        await page.locator('#layerSelect').selectOption('raw');
        await page.locator(`.event[data-event-id="${target.rawEvents[0].rawId}"]`).waitFor();
        if (entry === 'file') await page.locator('button[data-mobile-view="detail"]').click();
      } else if (intent === 'query') await fillSearch(page, 'keep this newer query');
      else if (intent === 'filter') await addSearchFilter(page, 'kind', 'user_message');
      else await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
      const selection = page.locator('#timeline .event.selected, #timeline [data-trajectory-event-id].selected');
      const before = await selection.count();
      gate.resolve();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#layerSelect').inputValue(), intent.endsWith('raw') ? 'raw' : 'main');
      assert.equal(await selection.count(), before);
      if (intent === 'query') assert.equal(await page.locator('#searchInput').inputValue(), 'keep this newer query');
      if (intent === 'presentation') assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'trajectory');
      if (intent.endsWith('raw') && entry === 'file') assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'detail');
      assert.doesNotMatch(await page.locator('#stateLine').innerText(), /Unknown event|Synthetic stale analysis/);
    }
  });
}

test('collaboration return rebases hidden search expansion after sorting', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const profile = { id: 'custom:hidden-collaboration', name: 'Hidden collaboration',
    rules: { kindStates: { agent_coordination: 'hidden' }, fallback: 'expanded', conditions: [] } };
  const { page } = await openApp(t, index, { locale: 'en', localStorage: {
    'sessionAnalyzer.customProfiles': JSON.stringify([profile]), 'sessionAnalyzer.profile': profile.id,
  } });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await fillSearch(page, 'Child recorded result');
  await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
  const origin = page.locator(`#timeline .event[data-event-id="${eventId}"] .collaborationTargets [data-open-collaboration-session="${childId}"]`);
  await origin.click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  await page.locator('#sortSelect').selectOption('started-asc');
  await page.waitForLoadState('networkidle');
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId, { timeout: 5000 });
  assert.equal(await origin.isVisible(), true);
  assert.equal(await page.locator('#searchInput').inputValue(), 'Child recorded result');
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
  await fillSearch(page, '');
  await page.waitForSelector(`#timeline .event[data-event-id="${eventId}"].hiddenByProfile`, { state: 'attached' });
});

test('collaboration failed paginated return retries the complete saved position', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t, { precedingCount: 170 });
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator('#loadMoreBtn').click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  const origin = page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first();
  await origin.focus();
  const scrollTop = await page.locator('.timelinePane').evaluate((node) => node.scrollTop);
  await origin.click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  let failed = false;
  await page.route(`**/api/sessions/${parentId}/timeline*`, async (route) => {
    const url = new URL(route.request().url());
    if (!failed && url.searchParams.get('limit') === '179') {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic return failure' }) });
    } else await route.continue();
  });
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction(() => document.querySelector('#loadMoreBtn')?.textContent.includes('Retry'));
  assert.equal(failed, true);
  assert.ok(await page.locator('#sessionHeader [data-reading-back]').count());
  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId, { timeout: 5000 });
  assert.equal(await page.locator(`.event[data-event-id="${eventId}"].selected`).count(), 1);
  assert.ok(Math.abs(await page.locator('.timelinePane').evaluate((node) => node.scrollTop) - scrollTop) < 3);
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
});

test('collaboration combines hidden search, pagination, sorting and failed return on desktop and mobile', { timeout: 30000 }, async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t, { precedingCount: 170 });
  const profile = { id: 'custom:hidden-collaboration', name: 'Hidden collaboration',
    rules: { kindStates: { agent_coordination: 'hidden' }, fallback: 'expanded', conditions: [] } };
  for (const mobile of [false, true]) {
    const { page } = await openApp(t, index, { locale: 'en', viewport: mobile ? { width: 390, height: 900 } : undefined,
      localStorage: { 'sessionAnalyzer.customProfiles': JSON.stringify([profile]), 'sessionAnalyzer.profile': profile.id } });
    await page.locator(`[data-session-id="${parentId}"]`).click();
    await fillSearch(page, 'Child recorded result');
    await page.locator('.searchInlineMatches [data-search-match-nav="next"]').click();
    await page.waitForFunction((id) => document.querySelector(`.event[data-event-id="${CSS.escape(id)}"].selected`), eventId);
    const origin = page.locator(`#timeline .event[data-event-id="${eventId}"] .collaborationTargets [data-open-collaboration-session="${childId}"]`);
    if (mobile) await page.locator('button[data-mobile-view="events"]').click();
    await origin.waitFor();
    await page.waitForLoadState('networkidle');
    // This preceding card first enters the mobile viewport after return positioning.
    const lateDetailEventId = mobile ? await page.locator('#timeline .event[data-event-id]').evaluateAll(
      (cards, id) => cards[cards.findIndex((card) => card.dataset.eventId === id) - 3]?.dataset.eventId,
      eventId,
    ) : null;
    if (mobile) assert.ok(lateDetailEventId);
    await origin.evaluate((node, mobile) => node.addEventListener('click', () => {
      window.__collaborationDepartureTop = node.getBoundingClientRect().top
        - (mobile ? 0 : node.closest('.timelinePane').getBoundingClientRect().top);
    }, { capture: true, once: true }), mobile);
    await origin.click();
    const anchorTop = await page.evaluate(() => window.__collaborationDepartureTop);
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
    // On mobile the session sorter lives on the Sessions surface.
    if (mobile) await page.locator('button[data-mobile-view="sessions"]').click();
    await page.locator('#sortSelect').selectOption('started-asc');
    await page.waitForLoadState('networkidle');
    if (mobile) await page.locator('button[data-mobile-view="events"]').click();
    const lateDetailGate = deferred();
    t.after(() => lateDetailGate.resolve());
    let lateDetailRequests = 0;
    if (mobile) await page.route('**/api/sessions/*/events/*/detail?*', async (route) => {
      if (decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)) === lateDetailEventId) {
        lateDetailRequests += 1;
        await lateDetailGate.promise;
      }
      await route.continue().catch(() => {});
    });
    let failures = 0;
    await page.route(`**/api/sessions/${parentId}/timeline*`, async (route) => {
      const url = new URL(route.request().url());
      if (!failures && url.searchParams.get('limit') === '179') {
        failures += 1;
        await route.fulfill({ status: 503, json: { error: 'Synthetic composed return failure' } });
      } else await route.continue();
    });
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction(() => document.querySelector('#loadMoreBtn')?.textContent.includes('Retry'));
    assert.equal(failures, 1);
    const lateDetailRequest = mobile ? page.waitForRequest((request) => {
      const pathname = new URL(request.url()).pathname;
      return pathname.endsWith('/detail') && decodeURIComponent(pathname.split('/').at(-2)) === lateDetailEventId;
    }, { timeout: 10000 }) : null;
    await page.locator('#loadMoreBtn').click();
    await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId);
    assert.equal(await origin.isVisible(), true);
    if (mobile) {
      await lateDetailRequest;
      assert.match(await page.locator(`#timeline .event[data-event-id="${lateDetailEventId}"] > .eventBody`).innerText(), /Loading structured detail/);
      lateDetailGate.resolve();
      await page.waitForFunction((id) => {
        const body = document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"] > .eventBody`);
        return body && !body.textContent.includes('Loading structured detail');
      }, lateDetailEventId);
      assert.equal(lateDetailRequests, 1);
      assert.equal(await origin.evaluate((node) => node === document.activeElement), true);
    }
    const restoredTop = await origin.evaluate((node, mobile) => node.getBoundingClientRect().top
      - (mobile ? 0 : node.closest('.timelinePane').getBoundingClientRect().top), mobile);
    assert.ok(Math.abs(restoredTop - anchorTop) < 3, `${mobile ? 'mobile' : 'desktop'}: ${anchorTop} -> ${restoredTop}`);
    assert.equal(await page.locator('#searchInput').inputValue(), 'Child recorded result');
    assert.equal(await page.locator('[data-reading-back]').count(), 0);
  }
});

test('collaboration return retries failures at each required loading phase', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  for (const phase of ['analysis', 'suggestions', 'timeline', 'detail']) {
    const { page } = await openApp(t, index, { locale: 'en' });
    await page.locator(`[data-session-id="${parentId}"]`).click();
    await page.locator(`.event[data-event-id="${eventId}"]`).click();
    await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
    let failures = 0;
    const routePattern = phase === 'suggestions' ? '**/api/file-suggestions?*'
      : phase === 'detail' ? `**/api/sessions/${parentId}/events/${encodeURIComponent(eventId)}/detail*`
        : `**/api/sessions/${parentId}/${phase}*`;
    await page.route(routePattern, async (route) => {
      if (!failures) {
        failures += 1;
        await route.fulfill({ status: 503, json: { error: `Synthetic ${phase} failure` } });
      } else await route.continue();
    });
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction(() => document.querySelector('#loadMoreBtn')?.textContent.includes('Retry'));
    assert.equal(failures, 1, phase);
    await page.waitForFunction((phase) => document.querySelector('#stateLine')?.textContent.includes(`Synthetic ${phase} failure`), phase);
    assert.equal(await page.locator('#sessionHeader [data-reading-back]').count(), 1, phase);
    // Both retry entry points must resume the complete restoration, including cached detail failures.
    await page.locator(phase === 'detail' ? '#sessionHeader [data-reading-back]' : '#loadMoreBtn').click();
    await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId);
    assert.equal(await page.locator(`.event[data-event-id="${eventId}"].selected`).count(), 1, phase);
    assert.equal(await page.locator('[data-reading-back]').count(), 0, phase);
  }
});

test('collaboration return coalesces repeated clicks without consuming another history entry', async (t) => {
  const { index, parentId, childId, otherId, eventId } = await makeCollaborationNavigationFixture(t, { nested: true });
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  await page.locator('#timeline .event.kind-agent-coordination').click();
  const nestedOrigin = page.locator(`#timeline [data-open-collaboration-session="${otherId}"]`).first();
  await nestedOrigin.click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Other own work'));
  const gate = deferred();
  const started = deferred();
  t.after(() => gate.resolve());
  let loads = 0;
  await page.route(`**/api/sessions/${childId}/analysis*`, async (route) => {
    loads += 1;
    started.resolve();
    await gate.promise;
    await route.continue().catch(() => {});
  });
  await page.locator('#sessionHeader [data-reading-back]').evaluate((node) => { node.click(); node.click(); });
  await started.promise;
  await page.locator('#sessionHeader [data-reading-back]').click();
  gate.resolve();
  await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, otherId);
  assert.equal(loads, 1);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), childId);
  assert.equal(await page.locator('#sessionHeader [data-reading-back]').count(), 1);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), parentId);
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
});

test('collaboration return waits for sibling requests before exposing a full retry', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  const gate = deferred();
  const started = deferred();
  t.after(() => gate.resolve());
  let attempts = 0;
  await page.route(`**/api/sessions/${parentId}/analysis*`, async (route) => {
    started.resolve();
    await gate.promise;
    await route.continue().catch(() => {});
  });
  await page.route(`**/api/sessions/${parentId}/timeline*`, async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 503, json: { error: 'Synthetic return failure before analysis' } });
    else await route.continue();
  });
  const failureResponse = page.waitForResponse((response) => response.url().includes(`/sessions/${parentId}/timeline`) && response.status() === 503);
  await page.locator('#sessionHeader [data-reading-back]').click();
  await started.promise;
  await (await failureResponse).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#loadMoreBtn').isDisabled(), true);
  assert.match(await page.locator('#loadMoreBtn').innerText(), /Loading/);
  await page.locator('#sessionHeader [data-reading-back]').click();
  assert.equal(attempts, 1);
  gate.resolve();
  await page.waitForFunction(() => document.querySelector('#loadMoreBtn')?.textContent.includes('Retry'));
  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId);
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
});

test('collaboration delayed return yields to newer event, profile, presentation or session intent', async (t) => {
  const { index, parentId, childId, otherId, eventId, sourceEventId } = await makeCollaborationNavigationFixture(t);
  for (const intent of ['event', 'profile', 'presentation', 'session', 'failed-session']) {
    const { page } = await openApp(t, index, { locale: 'en' });
    await page.locator(`[data-session-id="${parentId}"]`).click();
    await page.locator(`.event[data-event-id="${eventId}"]`).click();
    await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
    const gate = deferred();
    const started = deferred();
    t.after(() => gate.resolve());
    await page.route(`**/api/sessions/${parentId}/analysis*`, async (route) => {
      started.resolve();
      await gate.promise;
      if (intent === 'failed-session') await route.fulfill({ status: 503, json: { error: 'Synthetic obsolete return failure' } }).catch(() => {});
      else await route.continue().catch(() => {});
    });
    await page.locator('#sessionHeader [data-reading-back]').click();
    await started.promise;
    await page.locator(`.event[data-event-id="${sourceEventId}"]`).waitFor();
    if (intent === 'event') await page.locator(`.event[data-event-id="${sourceEventId}"]`).click();
    if (intent === 'profile') await page.locator('#profileSelect:visible, #detail [data-profile-picker]:visible').selectOption('debug');
    if (intent === 'presentation') await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    if (intent.endsWith('session')) await page.locator(`[data-session-id="${otherId}"]`).click();
    gate.resolve();
    await page.waitForLoadState('networkidle');
    if (intent === 'event') assert.equal(await page.locator(`.event[data-event-id="${sourceEventId}"].selected`).count(), 1);
    if (intent === 'profile') assert.equal(await page.locator('#profileSelect').inputValue(), 'debug');
    if (intent === 'presentation') assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'trajectory');
    if (intent.endsWith('session')) {
      assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), otherId);
      assert.equal(await page.locator('[data-reading-back]').count(), 0);
      assert.equal((await page.locator('#stateLine').innerText()).includes('Synthetic obsolete return failure'), false);
    } else assert.equal(await page.locator('#sessionHeader [data-reading-back]').count(), 1);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.dataset.openCollaborationSession)), false);
  }
});

test('collaboration history survives sorting and retains the originating project search', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  for (const projectSearch of [false, true]) {
    const { page } = await openApp(t, index, { locale: 'en' });
    if (projectSearch) {
      await switchToProjectScope(page);
      await fillSearch(page, 'recorded result');
      await page.locator(`[data-project-result-session-id="${parentId}"]`).click();
    } else await page.locator(`[data-session-id="${parentId}"]`).click();
    await page.locator(`.event[data-event-id="${eventId}"]`).click();
    const origin = page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first();
    await origin.click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
    await page.locator('#sortSelect').selectOption('started-asc');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), childId);
    assert.equal(await page.locator('[data-reading-back]').count(), 2);
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction((id) => document.querySelector(`#timeline .event[data-event-id="${CSS.escape(id)}"]`)?.classList.contains('selected'), eventId);
    await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId);
    assert.equal(await page.locator('#searchInput').inputValue(), projectSearch ? 'recorded result' : '');
    if (projectSearch) {
      await page.locator('#sessionHeader [data-search-back-to-project]').click();
      await page.locator(`[data-project-result-session-id="${parentId}"]`).waitFor();
      assert.equal(await page.locator('#searchInput').inputValue(), 'recorded result');
    } else {
      await origin.click();
      await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
      await page.locator(`[data-session-id="${childId}"]`).click();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('[data-reading-back]').count(), 0, 'explicit selection still clears reading history');
    }
  }
});

test('collaboration return focuses the originating event and target or status action', async (t) => {
  const { index, parentId, childId, eventId, repeatedEventId } = await makeCollaborationNavigationFixture(t, { repeatedWait: true });
  assert.ok(repeatedEventId);
  const { page } = await openApp(t, index, { locale: 'en', beforeGoto: async (page) => {
    await page.route(`**/api/sessions/${parentId}/events/${encodeURIComponent(repeatedEventId)}/detail*`, async (route) => {
      const response = await route.fetch();
      const detail = await response.json();
      // Multiple collaboration sections can also occur inside one operation.
      detail.timelineSections.push(structuredClone(detail.timelineSections.find((section) => section.type === 'collaboration')));
      await route.fulfill({ response, json: detail });
    });
  } });
  for (const presentation of ['timeline', 'trajectory']) {
    for (const group of ['collaborationTargets', 'collaborationStatuses']) {
      await page.locator(`[data-session-id="${parentId}"]`).click();
      await page.locator('#mainPresentationControl [data-main-presentation="timeline"]').click();
      await page.locator(`.event[data-event-id="${eventId}"]`).click();
      await page.locator(`.event[data-event-id="${repeatedEventId}"]`).click();
      await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).click();
      const root = presentation === 'timeline' ? `.event[data-event-id="${repeatedEventId}"]` : '#detail';
      const origin = page.locator(`${root} .collaborationBlock`).last().locator(`.${group} [data-open-collaboration-session="${childId}"]`).first();
      await origin.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
      await page.locator('#sessionHeader [data-reading-back]').click();
      await origin.waitFor();
      await page.waitForFunction(({ root, group, childId }) => {
        const blocks = [...document.querySelector(root).querySelectorAll('.collaborationBlock')];
        return blocks.at(-1)?.querySelector(`.${group} [data-open-collaboration-session="${childId}"]`) === document.activeElement;
      }, { root, group, childId }, { timeout: 5000 });
      await page.waitForLoadState('networkidle');
      assert.equal(await origin.evaluate((node) => node === document.activeElement), true,
        `${presentation} ${group}: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500))}`);
    }
  }
});

test('collaboration refresh clears history when the selected session is no longer available', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  await page.route('**/api/sessions?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.sessions = data.sessions.filter((session) => session.id !== childId);
    data.total = data.sessions.length;
    await route.fulfill({ response, json: data });
  });
  await page.locator('#sortSelect').selectOption('started-asc');
  await page.waitForLoadState('networkidle');
  assert.notEqual(await page.locator('.sessionItem.active').getAttribute('data-session-id'), childId);
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
});

test('collaboration return does not replace a missing originating status action with a target link', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  await page.locator(`#timeline .collaborationStatuses [data-open-collaboration-session="${childId}"]`).click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  await page.route(`**/api/sessions/${parentId}/events/${encodeURIComponent(eventId)}/detail*`, async (route) => {
    const response = await route.fetch();
    const detail = await response.json();
    detail.timelineSections.find((section) => section.type === 'collaboration').statuses = [];
    await route.fulfill({ response, json: detail });
  });
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.locator(`#timeline .collaborationTargets [data-open-collaboration-session="${childId}"]`).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#timeline .collaborationStatuses [data-open-collaboration-session]').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.matches('[data-open-collaboration-session]'))), false);
});

test('collaboration return restores source profile rules and unsaved drafts', async (t) => {
  const { index, parentId, childId, eventId, sourceEventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  for (const draft of [false, true]) {
    await page.locator(`[data-session-id="${parentId}"]`).click();
    if (draft) await page.locator('#detail [data-profile-kind="user_message"]').selectOption('summary');
    const source = page.locator(`.event[data-event-id="${sourceEventId}"]`);
    // Keep a manual override as well as the active rules: restoring via setProfileId would erase it.
    await source.locator('[data-action="toggle"]').first().click();
    const sourceDisplay = await source.getAttribute('class');
    const ruleDisplay = await page.locator('#timeline .event[data-event-id]').nth(1).getAttribute('class');
    await page.locator(`.event[data-event-id="${eventId}"]`).click();
    await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
    if (draft) {
      await page.locator('#detail [data-detail-action="close"]').click();
      await page.locator('#detail [data-profile-kind="user_message"]').selectOption('hidden');
    } else {
      await page.locator('#profileSelect').selectOption('debug');
      await page.waitForFunction(() => document.querySelector('#profileSelect').value === 'debug');
    }
    await page.locator('#sessionHeader [data-reading-back]').click();
    await page.waitForFunction((id) => document.querySelector(`#timeline [data-open-collaboration-session="${id}"]`) === document.activeElement, childId);
    assert.equal(await page.locator('#profileSelect').inputValue(), 'narrative');
    assert.equal(await source.getAttribute('class'), sourceDisplay);
    assert.equal(await page.locator('#timeline .event[data-event-id]').nth(1).getAttribute('class'), ruleDisplay);
    await page.locator('#detail [data-detail-action="close"]').click();
    assert.equal((await page.locator('#detail').innerText()).includes('Unsaved preview'), draft);
    if (draft) assert.equal(await page.locator('#detail [data-profile-kind="user_message"]').inputValue(), 'summary');
  }
});

test('localized Codex agent status rows navigate independently of targets in both presentations', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t, { statusOnly: true });
  for (const locale of ['en', 'zh-CN']) {
    const { page, baseUrl } = await openApp(t, index, { locale });
    const response = await page.request.get(`${baseUrl}/api/sessions/${parentId}/events/${encodeURIComponent(eventId)}/detail?layer=main&locale=${locale}`);
    assert.equal(response.status(), 200);
    const section = (await response.json()).timelineSections.find((item) => item.type === 'collaboration');
    assert.deepEqual(section.targets, []);
    assert.deepEqual(section.statuses.map((item) => item.labelKind), ['agent', 'agent', 'agent', 'generic']);
    for (const presentation of ['timeline', 'trajectory']) {
      await page.locator(`[data-session-id="${parentId}"]`).click();
      await page.locator('#mainPresentationControl [data-main-presentation="timeline"]').click();
      await page.locator(`.event[data-event-id="${eventId}"]`).click();
      await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).click();
      const surface = presentation === 'timeline' ? '#timeline' : '#detail';
      const rows = page.locator(`${surface} .collaborationStatuses li`);
      const link = rows.locator(`[data-open-collaboration-session="${childId}"]`);
      await link.waitFor();
      assert.equal(await rows.locator('[data-open-collaboration-session]').count(), 2);
      assert.match(await rows.nth(2).innerText(), locale === 'en' ? /Session unavailable/ : /当前项目中无可用会话/);
      assert.equal(await rows.nth(3).locator('button, small').count(), 0);
      assert.match(await rows.nth(3).innerText(), locale === 'en' ? /Status/ : /状态/);
      await link.click();
      await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
      await page.locator('#sessionHeader [data-reading-back]').click();
      await link.waitFor();
    }
  }
});

test('collaboration delayed child analysis preserves newer selection and close intent', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  for (const close of [false, true]) {
    await page.locator(`[data-session-id="${parentId}"]`).click();
    await page.locator(`.event[data-event-id="${eventId}"]`).click();
    const gate = deferred();
    const started = deferred();
    t.after(() => gate.resolve());
    const routeHandler = async (route) => { started.resolve(); await gate.promise; await route.continue().catch(() => {}); };
    await page.route(`**/api/sessions/${childId}/analysis*`, routeHandler);
    await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
    await started.promise;
    const second = page.locator('#timeline .event').filter({ hasText: 'Child own work second event' }).first();
    await second.click();
    const selectedId = await second.getAttribute('data-event-id');
    if (close) await page.locator('#detail [data-detail-action="close"]').click();
    const surface = await page.locator('body').getAttribute('data-mobile-view');
    gate.resolve();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#timeline .event.selected').count(), close ? 0 : 1);
    if (!close) assert.equal(await page.locator('#timeline .event.selected').getAttribute('data-event-id'), selectedId);
    assert.equal(await page.locator('body').getAttribute('data-mobile-view'), surface);
    await page.unroute(`**/api/sessions/${childId}/analysis*`, routeHandler);
  }
});

test('collaboration return preserves an unloaded reference beside its source', async (t) => {
  const { index, parentId, childId, eventId, sourceEventId } = await makeCollaborationNavigationFixture(t, { precedingCount: 170 });
  const { page } = await openApp(t, index, { locale: 'en', beforeGoto: async (page) => {
    // Inject a synthetic shared event-reference DTO; this test exercises navigation, not adapter admission.
    await page.route(`**/api/sessions/${parentId}/events/${encodeURIComponent(sourceEventId)}/detail*`, async (route) => {
      const response = await route.fetch();
      const detail = await response.json();
      detail.inspectorSections.push({ type: 'event_refs', purpose: 'context', title: 'Recorded reference',
        items: [{ id: eventId, layer: 'main', label: 'Referenced collaboration', kind: 'agent_coordination', status: 'success' }] });
      await route.fulfill({ response, json: detail });
    });
  } });
  page.setDefaultTimeout(5000);
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${sourceEventId}"]`).click();
  await page.locator(`#detail [data-target-event-id="${eventId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  const link = page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first();
  await link.waitFor();
  const order = () => page.locator('#timeline .event[data-event-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.eventId));
  const before = await order();
  assert.equal(before.indexOf(eventId), before.indexOf(sourceEventId) + 1);
  await link.click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  await page.locator('#sessionHeader [data-reading-back]').click();
  await link.waitFor();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(await order(), before);
});

test('collaboration return settles delayed Inspector navigation before restoring disclosures and focus', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en', beforeGoto: async (page) => {
    await page.route(`**/api/sessions/${parentId}/events/${encodeURIComponent(eventId)}/detail*`, async (route) => {
      const response = await route.fetch();
      const detail = await response.json();
      detail.inspectorSections.push({ type: 'raw_json', purpose: 'fallback', title: 'Synthetic evidence', value: { recorded: true } });
      await route.fulfill({ response, json: detail });
    });
  } });
  for (const outcome of ['success', 'failure', 'new-selection']) {
    await page.locator(`[data-session-id="${parentId}"]`).click();
    await page.locator('#mainPresentationControl [data-main-presentation="timeline"]').click();
    await page.locator(`.event[data-event-id="${eventId}"]`).click();
    await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    const link = page.locator(`#detail [data-open-collaboration-session="${childId}"]`).first();
    await link.waitFor();
    await page.waitForLoadState('networkidle');
    const disclosures = page.locator('#detail details');
    assert.ok(await disclosures.count() > 0);
    await disclosures.evaluateAll((nodes) => nodes.forEach((node) => { node.open = true; }));
    await link.click();
    await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('Child own work'));
    const gate = deferred();
    const started = deferred();
    t.after(() => gate.resolve());
    const routeHandler = async (route) => {
      if (new URL(route.request().url()).searchParams.get('limit') !== '500') return route.continue();
      started.resolve();
      await gate.promise;
      if (outcome === 'failure') await route.fulfill({ status: 500, json: { error: 'Synthetic navigation failure' } });
      else await route.continue().catch(() => {});
    };
    await page.route(`**/api/sessions/${parentId}/timeline?*`, routeHandler);
    await page.locator('#detail [data-reading-back]').click();
    await started.promise;
    await link.waitFor();
    await page.waitForLoadState('networkidle');
    if (outcome === 'new-selection') await page.locator('#detail [data-detail-action="close"]').click();
    gate.resolve();
    if (outcome === 'new-selection') {
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('body').getAttribute('data-detail-view'), 'profileRules');
      assert.equal(await page.locator('#detail [data-open-collaboration-session]').count(), 0);
    } else {
      await page.waitForFunction((id) => document.activeElement?.dataset.openCollaborationSession === id, childId, { timeout: 5000 });
      await page.waitForLoadState('networkidle');
      assert.equal(await link.evaluate((node) => node === document.activeElement), true,
        `${outcome}: ${await page.evaluate(() => JSON.stringify({ active: document.activeElement.outerHTML.slice(0, 200), error: document.querySelector('#stateLine').textContent, open: [...document.querySelectorAll('#detail details')].map(node => node.open) }))}`);
      assert.ok((await disclosures.evaluateAll((nodes) => nodes.map((node) => node.open))).every(Boolean));
    }
    await page.unroute(`**/api/sessions/${parentId}/timeline?*`, routeHandler);
  }
});

test('collaboration navigation opens each confirmed target and restores reading context in both presentations', withNavigationDiagnostics(async (t, diagnostics) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en', beforeGoto: diagnostics.attach });
  for (const presentation of ['timeline', 'trajectory']) {
    await page.locator(`[data-session-id="${parentId}"]`).click();
    await page.locator('#searchInput').fill('recorded result');
    await page.locator('#searchInput').dispatchEvent('input');
    await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).click();
    const event = page.locator(presentation === 'timeline'
      ? `#timeline .event[data-event-id="${eventId}"]`
      : `[data-trajectory-event-id="${eventId}"]`).first();
    await event.click();
    const surface = presentation === 'timeline' ? '#timeline' : '#detail';
    const link = page.locator(`${surface} [data-open-collaboration-session="${childId}"]`).first();
    await link.waitFor().catch(async (error) => {
      throw new Error(`${error.message}\n${await event.getAttribute('class')}\n${await event.innerText()}\n${await page.locator('#detail').innerText()}`);
    });
    assert.match(await page.locator(surface).innerText(), /Session unavailable in this project/);
    // Native focus reveals the link without a separate scroll action holding
    // a DOM node that viewport-driven detail hydration can replace.
    await link.focus();
    await page.waitForLoadState('networkidle');
    await link.focus();
    await page.waitForFunction((id) => {
      const active = document.activeElement;
      if (active?.dataset.openCollaborationSession !== id) return false;
      const rect = active.getBoundingClientRect();
      const pane = active.closest('.timelinePane, .detailPane')?.getBoundingClientRect();
      return pane && rect.top >= pane.top && rect.bottom <= pane.bottom;
    }, childId);
    const before = await page.locator('.timelinePane').evaluate((pane) => pane.scrollTop);
    await diagnostics.checkpoint(`${presentation}:before-enter`, { childId, eventId, timelineScrollTop: before });
    await page.keyboard.press('Enter');
    await diagnostics.checkpoint(`${presentation}:after-enter`, { childId });
    await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, childId);
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
    assert.equal(await page.locator('#searchInput').inputValue(), '');
    await page.locator('#sessionHeader [data-reading-back]').click();
    await diagnostics.checkpoint(`${presentation}:after-return-click`, { parentId, timelineScrollTop: before });
    await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, parentId);
    await page.waitForFunction((id) => document.querySelector('[data-open-collaboration-session]') && document.querySelector(`[data-event-id="${CSS.escape(id)}"].selected, [data-trajectory-event-id="${CSS.escape(id)}"].selected`), eventId, { timeout: 5000 }).catch(async (error) => {
      throw new Error(`${presentation}: ${error.message}\n${await page.locator('#detail').innerText()}\n${await page.locator('#timeline').innerText()}`);
    });
    assert.equal(await page.locator('#searchInput').inputValue(), 'recorded result');
    assert.equal(await page.locator(`#mainPresentationControl [data-main-presentation="${presentation}"]`).getAttribute('aria-pressed'), 'true');
    await page.waitForFunction((top) => Math.abs(document.querySelector('.timelinePane').scrollTop - top) < 3, before);
    assert.equal(await page.locator('[data-reading-back]').count(), 0);
    await page.locator('#searchInput').fill('');
    await page.locator('#searchInput').dispatchEvent('input');
  }
}));

test('a late child load cannot replace a newer session selection', async (t) => {
  const { index, parentId, childId, otherId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  const gate = deferred();
  let blocked = false;
  await page.route(`**/api/sessions/${childId}/timeline?*`, async (route) => {
    blocked = true;
    await gate.promise;
    await route.continue().catch(() => {});
  });
  await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id, childId);
  await page.locator(`[data-session-id="${otherId}"]`).click();
  gate.resolve();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Other own work'));
  assert.ok(blocked);
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), otherId);
  assert.equal(await page.locator('[data-reading-back]').count(), 0);
});

test('collaboration reading return preserves project search and structured filters', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'zh-CN' });
  await page.locator('#searchHudScope').click();
  await page.locator('[data-search-scope="project"]').click();
  await page.waitForFunction(() => document.body.dataset.searchScope === 'project');
  await fillSearch(page, 'recorded result');
  await addSearchFilter(page, 'kind', 'agent_coordination');
  await page.locator(`[data-project-result-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  const button = page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first();
  await button.waitFor();
  assert.equal(await button.innerText(), '打开会话 ↗');
  await button.click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  assert.equal(await page.locator('#searchKindSelect').inputValue(), '');
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.querySelector(`[data-event-id="${CSS.escape(id)}"].selected`), eventId);
  assert.equal(await page.locator('#searchKindSelect').inputValue(), 'agent_coordination');
  assert.equal(await page.locator('#searchInput').inputValue(), 'recorded result');
  await page.locator('#sessionHeader [data-search-back-to-project]').click();
  await page.locator(`[data-project-result-session-id="${parentId}"]`).waitFor();
  assert.equal(await page.locator('body').getAttribute('data-search-scope'), 'project');
  assert.equal(await page.locator('#searchKindSelect').inputValue(), 'agent_coordination');
});

test('collaboration return restores a paginated source and works from mobile Trajectory detail', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t, { precedingCount: 170 });
  const { page } = await openApp(t, index, { locale: 'en' });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator('#loadMoreBtn').click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Child own work'));
  await page.locator('#sessionHeader [data-reading-back]').click();
  await page.waitForFunction((id) => document.querySelector(`[data-event-id="${CSS.escape(id)}"].selected.expanded`), eventId);
  await page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first().waitFor();
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator(`#detail [data-open-collaboration-session="${childId}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('Child own work'));
  await page.locator('#detail [data-reading-back]').click();
  await page.locator(`#detail [data-open-collaboration-session="${childId}"]`).first().waitFor();
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'detail');
  assert.equal(await page.locator('#detail [data-open-collaboration-session]').first().evaluate((node) => node === document.activeElement), true);
});

test('collaboration mobile Timeline opens visible child content and restores document scroll', withNavigationDiagnostics(async (t, diagnostics) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t, { precedingCount: 35 });
  const { page } = await openApp(t, index, { locale: 'en', beforeGoto: diagnostics.attach });
  await page.locator(`[data-session-id="${parentId}"]`).click();
  await page.locator(`.event[data-event-id="${eventId}"]`).click();
  const link = page.locator(`#timeline [data-open-collaboration-session="${childId}"]`).first();
  await link.waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('[data-mobile-view="events"].mobileViewTab').click();
  await link.scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  const before = await page.evaluate(() => window.scrollY);
  assert.ok(before > 1000, `expected nonzero document scroll, got ${before}`);
  await diagnostics.checkpoint('mobile:before-child-click', { childId, eventId, documentScrollY: before });
  await link.click();
  await diagnostics.checkpoint('mobile:after-child-click', { childId });
  await page.waitForFunction((id) => document.querySelector('.sessionItem.active')?.dataset.sessionId === id
    && document.querySelector('#timeline')?.textContent.includes('Child own work'), childId);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('body').getAttribute('data-mobile-view'), 'events');
  const child = page.locator('#timeline .event.selected');
  assert.equal(await child.isVisible(), true);
  assert.match(await child.innerText(), /Child own work/);
  const bounds = await child.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 900, JSON.stringify(bounds));
  await page.locator('#sessionHeader [data-reading-back]').click();
  await diagnostics.checkpoint('mobile:after-return-click', { parentId, documentScrollY: before });
  await link.waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForFunction((top) => Math.abs(window.scrollY - top) < 3, before, { timeout: 5000 });
  assert.equal(await link.evaluate((node) => node === document.activeElement), true);
}));

test('collaboration Trajectory return restores desktop Inspector and mobile document scroll', async (t) => {
  const { index, parentId, childId, eventId } = await makeCollaborationNavigationFixture(t);
  const { page } = await openApp(t, index, { locale: 'en' });
  for (const mobile of [false, true]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator(`[data-session-id="${parentId}"]`).click();
    await page.locator('#mainPresentationControl [data-main-presentation="timeline"]').click();
    await page.locator(`.event[data-event-id="${eventId}"]`).click();
    await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').click();
    const link = page.locator(`#detail [data-open-collaboration-session="${childId}"]`).first();
    await link.waitFor();
    if (mobile) await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForLoadState('networkidle');
    await page.evaluate((mobile) => {
      if (mobile) window.scrollTo(0, 150);
      else document.querySelector('.detailPane').scrollTop = 150;
    }, mobile);
    await link.focus();
    const before = await page.evaluate((mobile) => mobile ? window.scrollY : document.querySelector('.detailPane').scrollTop, mobile);
    assert.ok(before > 50, `expected meaningful ${mobile ? 'document' : 'Inspector'} scroll, got ${before}`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('Child own work'));
    await page.locator('#detail [data-reading-back]').click();
    await link.waitFor();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(({ mobile, top }) => Math.abs((mobile ? window.scrollY : document.querySelector('.detailPane').scrollTop) - top) < 3,
      { mobile, top: before }, { timeout: 5000 }).catch(async (error) => {
      const actual = await page.evaluate(() => ({ window: window.scrollY, detail: document.querySelector('.detailPane').scrollTop, surface: document.body.dataset.mobileView, error: document.querySelector('#stateLine')?.textContent }));
      throw new Error(`${error.message}: ${JSON.stringify({ mobile, before, actual })}`);
    });
    assert.equal(await link.evaluate((node) => node === document.activeElement), true);
  }
});
