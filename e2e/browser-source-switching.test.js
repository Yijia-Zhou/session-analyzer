'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analyzerSessionId, buildClaudeSourceBackedIndex } = require('../src/claude');
const {
  buildIndex: buildResidentCodexIndex,
  buildSourceBackedIndex: buildIndex,
  buildHydratedEventDetail,
} = require('../src/codex');
const { withNavigationDiagnostics } = require('./browser-diagnostics');

const {
  fixtureCodexHome,
  repoRoot,
  primaryFixtureSessionId,
  deferred,
  buildFixtureIndex,
  openApp,
  openSourceSwitchChooser,
  makeClaudeSwitchFixture,
  confirmSourceAction,
  waitForProjectRoot,
  selectPrimarySession,
} = require('./browser-helpers');

async function openPollingRecoveryChooser(t, respond) {
  const counts = { posts: 0, gets: 0, deletes: 0, jobIds: [] };
  const app = await openSourceSwitchChooser(t, {
    beforeGoto: async (page) => {
      await page.route('**/api/project', async (route) => {
        counts.posts += 1;
        await route.continue();
      });
      await page.route('**/api/project/status*', async (route) => {
        const jobId = new URL(route.request().url()).searchParams.get('jobId');
        if (route.request().method() === 'DELETE') counts.deletes += 1;
        else { counts.gets += 1; counts.jobIds.push(jobId); }
        await respond(route, counts, jobId);
      });
    },
  });
  await waitForProjectRoot(app.page, repoRoot);
  await app.page.locator('.projectItem[data-project-root]').first().click();
  return { ...app, counts };
}

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
  const dshHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-browser-dsh-'));
  t.after(() => fsp.rm(dshHome, { recursive: true, force: true }));
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome, dshHome },
  });

  await waitForProjectRoot(page, repoRoot);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixtureCodexHome));
  assert.equal(await page.locator('[data-source-choice="claude-code"]').isVisible(), true);

  await page.locator('[data-source-choice="claude-code"]').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  // Every registered source is directly selectable.
  assert.equal(await page.locator('[data-source-choice="deepseek-harness"]').isVisible(), true);

  await page.locator('[data-source-choice="deepseek-harness"]').click();
  await confirmSourceAction(page, 'Confirm switch to DeepSeek Harness');
  await page.waitForFunction(() => document.querySelector('#projectSourceSwitch')?.dataset.source === 'deepseek-harness');
  assert.equal(await page.locator('[data-source-choice="codex"]').isVisible(), true);

  await page.locator('[data-source-choice="codex"]').click();
  await confirmSourceAction(page, 'Confirm switch to Codex');
  await waitForProjectRoot(page, repoRoot);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Codex/);
});

test('browser source replacement preserves the remembered Main Trajectory presentation without stale event ownership', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot': repoRoot },
  });
  await page.waitForFunction(() => (
    document.body.dataset.projectMode === 'analyzing'
      && Boolean(document.querySelector('.sessionItem.active'))
      && document.querySelectorAll('#timeline .event[data-event-id]').length > 0
  ));
  await page.locator('[data-main-presentation="trajectory"]').click();
  await page.waitForSelector('.trajectoryPresentation');
  const originalEvent = page.locator('[data-trajectory-event-id]').first();
  const originalEventId = await originalEvent.getAttribute('data-trajectory-event-id');
  assert.ok(originalEventId);
  await originalEvent.click();
  await page.waitForFunction((eventId) => (
    document.querySelector('.trajectoryOverviewLocator')?.dataset.trajectoryOverviewSelectedId === eventId
  ), originalEventId);

  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  assert.equal(await page.locator('#mainPresentationControl').isVisible(), false);
  assert.equal(await page.locator('body').getAttribute('data-remembered-main-presentation'), 'trajectory');
  await page.locator('[data-source-choice="claude-code"]').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  await page.evaluate((root) => {
    const project = [...document.querySelectorAll('.projectItem[data-project-root]')]
      .find((item) => item.dataset.projectRoot === root);
    project?.click();
  }, fixture.claudeRepo);
  await page.waitForFunction((sessionId) => (
    document.body.dataset.projectMode === 'analyzing'
      && document.querySelector('.sessionItem.active')?.dataset.sessionId === sessionId
      && Boolean(document.querySelector('.trajectoryPresentation'))
  ), analyzerSessionId(fixture.sessionId));

  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.equal(await page.locator('body').getAttribute('data-remembered-main-presentation'), 'trajectory');
  assert.equal(await page.locator('body').getAttribute('data-main-presentation'), 'trajectory');
  assert.equal(
    await page.locator('#mainPresentationControl [data-main-presentation="trajectory"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator(`[data-event-id="${originalEventId}"]`).count(), 0);
  assert.equal(await page.locator('.trajectoryOverviewLocator[data-trajectory-overview-selected-id]').count(), 0);
  assert.equal(await page.locator('.trajectoryPresentation').getAttribute('data-event-count'), '2');
});

test('browser source selector exposes every supported registry source', async (t) => {
  const sourceOptions = [
    { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
    { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    { kind: 'deepseek-harness', label: 'DeepSeek Harness', homeOption: 'dshHome', homeLabel: 'DeepSeek sessions root' },
    { kind: 'future-source', label: 'Future Source', homeOption: 'futureSourceHome', homeLabel: 'Future Source home' },
  ];
  const homes = {
    codex: path.join(os.tmpdir(), 'browser-cycle-codex'),
    'claude-code': path.join(os.tmpdir(), 'browser-cycle-claude'),
    'deepseek-harness': path.join(os.tmpdir(), 'browser-cycle-dsh'),
    'future-source': path.join(os.tmpdir(), 'browser-cycle-future'),
  };
  let currentSource = 'codex';
  const sourcePayload = () => ({
    sourceKind: currentSource,
    sourceHome: homes[currentSource],
    sourceConfigs: Object.fromEntries(Object.keys(homes).map((kind) => [kind, { home: homes[kind] }])),
    codexHome: homes.codex,
    claudeHome: homes['claude-code'],
    dshHome: homes['deepseek-harness'],
    futureSourceHome: homes['future-source'],
    supportedSources: sourceOptions.map((option) => option.kind),
    sourceOptions,
    projects: [],
    projectSelected: false,
  });
  const posts = [];
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: sourcePayload() }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sourcePayload()),
        });
      });
      await p.route('**/api/source', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        posts.push(body.source);
        currentSource = body.source;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sourcePayload()),
        });
      });
    },
  });

  assert.equal(await page.locator('[data-source-choice="claude-code"]').isVisible(), true);
  await page.locator('[data-source-choice="claude-code"]').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await page.waitForFunction(() => !document.querySelector('[data-source-choice="deepseek-harness"]')?.disabled);

  await page.locator('[data-source-choice="deepseek-harness"]').click();
  await confirmSourceAction(page, 'Confirm switch to DeepSeek Harness');
  await page.waitForFunction(() => !document.querySelector('[data-source-choice="future-source"]')?.disabled);

  await page.locator('[data-source-choice="future-source"]').click();
  await confirmSourceAction(page, 'Confirm switch to Future Source');
  await page.waitForFunction(() => !document.querySelector('[data-source-choice="codex"]')?.disabled);
  assert.deepEqual(posts, ['claude-code', 'deepseek-harness', 'future-source']);
});

test('browser hydration prefers canonical source configs over conflicting legacy home fields', async (t) => {
  const canonicalCodexHome = path.join(os.tmpdir(), 'canonical-codex-home');
  const canonicalClaudeHome = path.join(os.tmpdir(), 'canonical-claude-home');
  const payload = {
    sourceKind: 'codex',
    sourceHome: canonicalCodexHome,
    sourceConfigs: {
      codex: { home: canonicalCodexHome },
      'claude-code': { home: canonicalClaudeHome },
    },
    codexHome: path.join(os.tmpdir(), 'legacy-codex-home'),
    claudeHome: path.join(os.tmpdir(), 'legacy-claude-home'),
    supportedSources: ['codex', 'claude-code'],
    sourceOptions: [
      { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
      { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    ],
    projects: [],
    projectSelected: false,
  };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: payload }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      });
    },
  });

  await page.waitForFunction(({ codex, claude }) => (
    document.querySelector('#projectCodexHomeInput')?.value === codex
      && document.querySelector('#projectClaudeHomeInput')?.value === claude
  ), { codex: canonicalCodexHome, claude: canonicalClaudeHome });
  assert.ok(await page.locator('#projectSourceHome').textContent());
});

test('browser does not fall back to a legacy home when a canonical source config is malformed', async (t) => {
  const canonicalClaudeHome = path.join(os.tmpdir(), 'canonical-claude-home');
  const legacyCodexHome = path.join(os.tmpdir(), 'legacy-codex-home');
  const payload = {
    sourceKind: 'codex',
    sourceHome: '',
    sourceConfigs: {
      codex: {},
      'claude-code': { home: canonicalClaudeHome },
    },
    codexHome: legacyCodexHome,
    claudeHome: path.join(os.tmpdir(), 'legacy-claude-home'),
    supportedSources: ['codex', 'claude-code'],
    sourceOptions: [
      { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
      { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    ],
    projects: [],
    projectSelected: false,
  };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: payload }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      });
    },
  });

  await page.waitForFunction(() => Boolean(document.querySelector('#projectCodexHomeInput')));
  assert.deepEqual(await page.evaluate(() => ({
    codex: document.querySelector('#projectCodexHomeInput')?.value || '',
    claude: document.querySelector('#projectClaudeHomeInput')?.value || '',
  })), { codex: '', claude: canonicalClaudeHome });
});

test('browser clears stale source config and active home after a later malformed canonical hydration', async (t) => {
  const canonicalCodexHome = path.join(os.tmpdir(), 'canonical-codex-home');
  const canonicalClaudeHome = path.join(os.tmpdir(), 'canonical-claude-home');
  const initialPayload = {
    sourceKind: 'codex',
    sourceHome: canonicalCodexHome,
    sourceConfigs: {
      codex: { home: canonicalCodexHome },
      'claude-code': { home: canonicalClaudeHome },
    },
    codexHome: path.join(os.tmpdir(), 'legacy-codex-home'),
    claudeHome: path.join(os.tmpdir(), 'legacy-claude-home'),
    supportedSources: ['codex', 'claude-code'],
    sourceOptions: [
      { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
      { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
    ],
    projects: [],
    projectSelected: false,
  };
  const malformedPayload = {
    ...initialPayload,
    sourceHome: '',
    sourceConfigs: {
      codex: {},
      'claude-code': { home: canonicalClaudeHome },
    },
  };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state', async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Project not selected', details: initialPayload }),
        });
      });
      await p.route('**/api/projects*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(malformedPayload),
        });
      });
    },
  });

  await page.waitForFunction((expectedClaudeHome) => (
    document.querySelector('#projectCodexHomeInput')?.value === ''
      && document.querySelector('#projectClaudeHomeInput')?.value === expectedClaudeHome
  ), canonicalClaudeHome);
  assert.equal(await page.locator('#projectSourceHome').textContent(), '');
});

test('browser clears old project rows before successor discovery settles after a source switch', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  let projectPosts = 0;
  let holdSuccessorFull = false;
  let releaseSuccessorFull;
  const successorFullGate = new Promise((resolve) => {
    releaseSuccessorFull = resolve;
  });
  let markSuccessorFullStarted;
  const successorFullStarted = new Promise((resolve) => {
    markSuccessorFullStarted = resolve;
  });
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source' && request.method() === 'POST') sourcePosts += 1;
        if (url.pathname === '/api/project' && request.method() === 'POST') projectPosts += 1;
      });
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') === '1') {
          if (sourcePosts === 0) {
            await route.continue();
            return;
          }
          const response = await route.fetch();
          const data = await response.json();
          data.projects = [];
          await route.fulfill({ response, json: data });
          return;
        }
        if (sourcePosts > 0 && !holdSuccessorFull) {
          holdSuccessorFull = true;
          markSuccessorFullStarted();
          await successorFullGate;
        }
        await route.continue();
      });
    },
  });
  t.after(() => releaseSuccessorFull());

  await waitForProjectRoot(page, repoRoot);
  await page.locator('[data-source-choice="claude-code"]').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await successorFullStarted;

  assert.equal(await page.locator('.projectItem[data-project-root]').count(), 0);
  assert.equal(projectPosts, 0);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);

  releaseSuccessorFull();
  await waitForProjectRoot(page, fixture.claudeRepo);
});

test('browser does not resurrect cached project rows when reopening the chooser', async (t) => {
  let summaryCalls = 0;
  let releaseReopenSummary;
  const reopenSummaryGate = new Promise((resolve) => {
    releaseReopenSummary = resolve;
  });
  let markReopenSummaryStarted;
  const reopenSummaryStarted = new Promise((resolve) => {
    markReopenSummaryStarted = resolve;
  });
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('summary') !== '1') {
          await route.continue();
          return;
        }
        summaryCalls += 1;
        if (summaryCalls === 2) {
          markReopenSummaryStarted();
          await reopenSummaryGate;
        }
        await route.continue();
      });
    },
  });
  t.after(() => releaseReopenSummary());

  await waitForProjectRoot(page, repoRoot);
  await page.locator('.projectItem[data-project-root]').first().click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'selecting');
  await reopenSummaryStarted;

  assert.equal(await page.locator('.projectItem[data-project-root]').count(), 0);

  releaseReopenSummary();
  await waitForProjectRoot(page, repoRoot);
});

test('browser chooser shows the server source before any switch', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { source: 'claude-code', claudeHome: fixture.claudeHome },
  });

  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.match(await page.locator('#projectSourceKind').textContent(), /Transcript source: Claude Code/);
  assert.ok((await page.locator('#projectSourceHome').textContent()).includes(fixture.claudeHome));
  assert.equal(await page.locator('[data-source-choice="deepseek-harness"]').isVisible(), true);
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
  await page.locator('[data-source-choice="claude-code"]').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await waitForProjectRoot(page, fixture.claudeRepo);
  assert.equal(await page.locator('.projectItem.lastSelected').count(), 0);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Select project');
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.repoRoot.claude-code')), null);
});

test('browser home directory edits preserve or drop Return by active identity', withNavigationDiagnostics(async (t, diagnostics) => {
  const fixture = await makeClaudeSwitchFixture(t);
  let sourcePosts = 0;
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      await diagnostics.attach(p);
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
  const sourcePostsBeforeInactiveEdit = sourcePosts;
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction((value) => document.querySelector('#projectClaudeHomeInput')?.value === value, inactiveClaudeHome);
  await page.waitForFunction(() => document.querySelector('#projectHomeApplyBtn')?.disabled === false);
  assert.ok(sourcePosts > sourcePostsBeforeInactiveEdit);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');
  await diagnostics.checkpoint('inactive-home-applied');

  const emptyCodexHome = path.join(fixture.claudeHome, 'empty-codex');
  await page.locator('#projectCodexHomeInput').fill(emptyCodexHome);
  await diagnostics.checkpoint('active-home-draft');
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceConfirm')?.hidden === false);
  assert.match(await page.locator('#projectSourceConfirm').textContent(), /current project/);
  const sourcePostsBeforeConfirm = sourcePosts;
  await page.locator('#projectCodexHomeInput').fill('relative-codex-home');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Source paths must be absolute'));
  assert.equal(sourcePosts, sourcePostsBeforeConfirm);

  await page.locator('#projectCodexHomeInput').fill(emptyCodexHome);
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('.projectSwitchHint')?.textContent === 'Select project');
  await page.waitForFunction(() => document.querySelectorAll('.projectItem').length === 0);
}));

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

  await page.locator('[data-source-choice="claude-code"]').click();
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

  await page.locator('[data-source-choice="claude-code"]').click();
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
  await page.locator('[data-source-choice="claude-code"]').click();
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
  await page.locator('[data-source-choice="claude-code"]').click();
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

test('browser ignores successful stale full-scan discovery after manual project selection', { timeout: 45000 }, async (t) => {
  const fullStarted = deferred();
  const releaseFull = deferred();
  t.after(() => releaseFull.resolve());
  const projectPosts = [];
  const staleRoot = `${repoRoot}\\stale-full-scan-only`;
  let fullCalls = 0;
  const { page, baseUrl } = await openSourceSwitchChooser(t, {
    // init() must have a saved project eligible for auto-restore after discovery.
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/project' && request.method() === 'POST') {
          projectPosts.push(request.postDataJSON().repoRoot);
        }
      });
      await p.route('**/api/projects*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.has('summary')) {
          const response = await route.fetch();
          const payload = await response.json();
          // The shared fixture has transcripts but no config.toml summary project.
          await route.fulfill({ response, json: { ...payload, projects: [{ repoRoot }] } });
          return;
        }
        fullCalls += 1;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        const payload = await response.json();
        assert.ok(payload.projects.some((project) => project.repoRoot === repoRoot));
        payload.projects.push({ repoRoot: staleRoot, sessionCount: 1 });
        fullStarted.resolve();
        await releaseFull.promise;
        await route.fulfill({ response, json: payload });
      });
    },
  });

  await fullStarted.promise;
  await waitForProjectRoot(page, repoRoot);
  assert.deepEqual(projectPosts, [], 'summary must be selectable before full discovery/auto-restore');
  const project = page.locator('.projectItem[data-project-root]').filter({
    hasText: repoRoot,
  }).first();
  assert.equal(await project.getAttribute('data-project-root'), repoRoot);
  await project.click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await selectPrimarySession(page);
  const message = page.locator('#timeline .kind-user-message').first();
  await message.waitFor();
  // Card visibility precedes async detail hydration; snapshot the rendered body.
  await message.locator('.eventBody .mdBlock').waitFor();
  const messageText = await message.innerText();
  assert.ok(messageText.trim(), 'selected project must expose readable history');
  const eventIds = await page.locator('#timeline .event[data-event-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.dataset.eventId),
  );
  assert.deepEqual(projectPosts, [repoRoot]);

  const fullResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/projects' && !url.searchParams.has('summary');
  });
  releaseFull.resolve();
  const response = await fullResponse;
  assert.equal(response.status(), 200);
  await response.finished();
  // Include response consumption, its auto-restore continuation, and any resulting requests.
  await page.waitForLoadState('networkidle');
  assert.equal(fullCalls, 1);
  assert.deepEqual(projectPosts, [repoRoot], 'stale success must not issue a second auto-restore POST');
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'analyzing');
  assert.equal(await page.locator('.sessionItem.active').getAttribute('data-session-id'), primaryFixtureSessionId);
  assert.equal(await message.innerText(), messageText);
  assert.deepEqual(await page.locator('#timeline .event[data-event-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.dataset.eventId),
  ), eventIds);
  assert.equal(await page.locator('[data-project-root]').evaluateAll(
    (nodes, root) => nodes.some((node) => node.dataset.projectRoot === root), staleRoot,
  ), false, 'stale success must not replace the project list');
  const state = await (await page.request.get(`${baseUrl}/api/state`)).json();
  assert.equal(state.repoRoot, repoRoot);
  assert.equal(state.sourceKind, 'codex');
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

  await page.waitForFunction(() => document.querySelector('#projectSourceKind')?.textContent.includes('Choose a transcript source'));
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
  const posixDshHome = '/home/me/.dsh/sessions';
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
          dshHome: posixDshHome,
          sourceConfigs: {
            ...data.sourceConfigs,
            codex: { home: posixCodexHome },
            'claude-code': { home: '/home/me/.claude' },
            'deepseek-harness': { home: posixDshHome },
          },
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
  await page.locator('[data-source-choice="claude-code"]').click();
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
  resolveIndex(await buildClaudeSourceBackedIndex({
    repoRoot: fixture.claudeRepo,
    claudeHome: fixture.claudeHome,
  }));
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
  await page.locator('[data-source-choice="claude-code"]').click();
  await confirmSourceAction(page, 'Confirm switch to Claude Code');
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Source paths must not be empty'));
  assert.equal(sourcePosts, 0);

  await page.locator('#projectClaudeHomeInput').fill('relative-claude-home');
  await page.locator('#projectSourceAction').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceError')?.textContent.includes('Source paths must be absolute'));
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

test('browser onboarding selects DeepSeek directly from an empty Codex source', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'analyzer-direct-source-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const posts = [];
  const scans = [];
  let selected = 'codex';
  const { page } = await openSourceSwitchChooser(t, {
    server: { codexHome: home, claudeHome: home, dshHome: home },
    beforeGoto: async (p) => {
      p.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/api/source') {
          selected = request.postDataJSON().source;
          posts.push(selected);
        }
        if (url.pathname === '/api/projects') scans.push(selected);
      });
    },
  });
  await page.waitForFunction(() => document.querySelector('#projectList')?.textContent.includes('No transcript projects'));
  assert.deepEqual(await page.locator('[data-source-choice]').allTextContents(), ['Codex', 'Claude Code', 'DeepSeek Harness', 'pi', 'OpenCode', 'WorkBuddy / CodeBuddy']);
  await page.locator('[data-source-choice="deepseek-harness"]').click();
  await page.waitForFunction(() => document.querySelector('#projectSourceSwitch')?.dataset.source === 'deepseek-harness' && !document.querySelector('[data-source-choice]')?.disabled);
  assert.deepEqual(posts, ['deepseek-harness']);
  assert.ok(!scans.includes('claude-code'));
  assert.equal(await page.locator('#projectSourceAction').isHidden(), true);
  assert.equal(await page.locator('[data-source-choice="deepseek-harness"]').getAttribute('aria-pressed'), 'true');
});

test('browser onboarding source confirmation cancel preserves project and directory draft', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const posts = [];
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    localStorage: { 'sessionAnalyzer.repoRoot.codex': repoRoot },
    beforeGoto: async (p) => p.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/source') posts.push(request.postDataJSON());
    }),
  });
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.locator('#projectSwitchControl').click();
  await waitForProjectRoot(page, repoRoot);
  await page.locator('#projectHomeEditor summary').click();
  const draft = path.join(fixture.claudeHome, 'edited');
  await page.locator('#projectClaudeHomeInput').fill(draft);
  await page.locator('[data-source-choice="deepseek-harness"]').click();
  assert.match(await page.locator('#projectSourceConfirm').textContent(), /close the current project.*also apply the edited source paths/);
  assert.match(await page.locator('#projectSourceAction').textContent(), /DeepSeek Harness/);
  await page.locator('#projectSourceCancel').click();
  assert.deepEqual(posts, []);
  assert.equal(await page.locator('#projectClaudeHomeInput').inputValue(), draft);
  assert.equal(await page.locator('.projectSwitchHint').textContent(), 'Return');
  assert.equal(await page.locator('[data-source-choice="codex"]').getAttribute('aria-pressed'), 'true');
});

test('browser onboarding distinguishes source diagnostics from an empty source and bounds escaped details', async (t) => {
  const fullDiscoveryStarted = deferred();
  const releaseFullDiscovery = deferred();
  t.after(() => releaseFullDiscovery.resolve());
  const diagnostics = {
    totalCount: 23, counts: { DEEPSEEK_ZSTD_UNAVAILABLE: 23 }, truncatedCount: 3,
    samples: Array.from({ length: 20 }, (_, i) => ({ code: 'DEEPSEEK_ZSTD_UNAVAILABLE', path: `/session-${i}/<img src=x>.zstd`, message: 'Node v22.0.0 lacks zstdDecompressSync <script>alert(1)</script>' })),
  };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => p.route('**/api/projects*', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      if (!new URL(route.request().url()).searchParams.has('summary')) {
        fullDiscoveryStarted.resolve();
        await releaseFullDiscovery.promise;
      }
      await route.fulfill({ json: { ...payload, projects: [], sourceDiagnostics: diagnostics } });
    }),
  });
  await fullDiscoveryStarted.promise;
  // Summary diagnostics render before full discovery finishes. Hold the latter
  // response so this intermediate state is deterministic, not scheduler luck.
  await page.waitForFunction(() => document.querySelector('#sourceDiagnostics')?.hidden === false);
  assert.equal(await page.locator('#projectList').textContent(), '');
  releaseFullDiscovery.resolve();
  await page.waitForFunction(() => (
    document.querySelector('#sourceDiagnostics')?.hidden === false
      && document.querySelector('#projectList')?.textContent.includes('No readable project')
  ));
  assert.match(await page.locator('#projectList').textContent(), /No readable project/);
  assert.doesNotMatch(await page.locator('#projectList').textContent(), /No transcript projects/);
  assert.match(await page.locator('#sourceDiagnostics').textContent(), /22.15.0/);
  assert.equal(await page.locator('#sourceDiagnostics details').getAttribute('open'), null);
  await page.locator('#sourceDiagnostics summary').click();
  assert.equal(await page.locator('#sourceDiagnostics details li code').count(), 20);
  assert.match(await page.locator('#sourceDiagnostics summary').innerText(), /23.*Results may be incomplete/);
  assert.equal(await page.locator('#sourceDiagnostics img, #sourceDiagnostics script').count(), 0);
  assert.match(await page.locator('#sourceDiagnostics').textContent(), /Node v22.0.0/);
  await page.locator('#localeSelect').selectOption('zh-CN', { force: true });
  assert.match(await page.locator('#sourceDiagnostics').textContent(), /来源读取问题/);
});

test('browser onboarding keeps mixed source diagnostics visible beside readable indexed sessions', async (t) => {
  const index = await buildFixtureIndex();
  const { page } = await openApp(t, index, {
    locale: 'en', skipProjectReindex: true,
    beforeGoto: async (p) => p.route('**/api/state*', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      await route.fulfill({ json: { ...payload, sourceDiagnostics: { totalCount: 1, counts: { DEEPSEEK_FORMAT_VERSION_UNSUPPORTED: 1 }, samples: [{ code: 'DEEPSEEK_FORMAT_VERSION_UNSUPPORTED', path: '/other/session.jsonl', message: 'Unsupported version 99' }], truncatedCount: 0 } } });
    }),
  });
  assert.equal(await page.locator('#sourceDiagnostics').isVisible(), true);
  assert.match(await page.locator('#sourceDiagnostics').textContent(), /unsupported format/);
  assert.equal(await page.locator('.sessionItem.active').count(), 1);
});

test('browser onboarding preserves failed startup across reload and retries the specified project', async (t) => {
  let postCount = 0;
  let statusCount = 0;
  const failure = { id: 'failed-before-open', status: 'failed', repoRoot, error: 'Source snapshot is busy; retry shortly', errorCode: 'DEEPSEEK_SOURCE_BUSY' };
  const { page } = await openSourceSwitchChooser(t, {
    beforeGoto: async (p) => {
      await p.route('**/api/state*', async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        await route.fulfill({ status: 200, json: { ...(payload.details || payload), projectSelected: false, job: failure } });
      });
      await p.route('**/api/project', async (route) => {
        assert.equal(route.request().postDataJSON().repoRoot, repoRoot);
        postCount += 1;
        await route.fulfill({ status: 202, json: { job: { ...failure, id: 'retry-job', status: 'queued' } } });
      });
      await p.route('**/api/project/status*', async (route) => {
        statusCount += 1;
        await route.fulfill({ json: { job: { ...failure, id: 'retry-job' } } });
      });
    },
  });
  await page.waitForFunction(() => !document.querySelector('#projectFailure')?.hidden);
  assert.match(await page.locator('#projectFailure').textContent(), /Source snapshot is busy/);
  assert.equal(statusCount, 0);
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'selecting');
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#projectFailure')?.hidden);
  assert.equal(statusCount, 0);
  await page.locator('[data-project-config]').click();
  assert.equal(await page.locator('#projectHomeEditor').getAttribute('open'), '');
  await page.locator('[data-project-retry]').click();
  await page.waitForFunction(() => document.querySelector('[data-project-retry]')?.disabled === false);
  assert.equal(postCount, 1);
  assert.equal(statusCount, 1);
  assert.match(await page.locator('#projectFailure').textContent(), /Source snapshot is busy/);
});

test('browser onboarding zero-session indexes distinguish unreadable files from repository mismatch', async (t) => {
  const index = await buildIndex({ repoRoot: path.join(os.tmpdir(), 'analyzer-no-matching-repo'), codexHome: fixtureCodexHome });
  let withDiagnostics = true;
  const { page } = await openApp(t, index, {
    locale: 'en', skipProjectReindex: true, activeSessionState: 'hidden', expectTimeline: false,
    beforeGoto: async (p) => p.route('**/api/state*', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      await route.fulfill({ json: { ...payload, sourceDiagnostics: withDiagnostics ? { totalCount: 1, counts: { SOURCE_ARTIFACT_UNREADABLE: 1 }, samples: [{ code: 'SOURCE_ARTIFACT_UNREADABLE', path: '/session.jsonl', message: 'Cannot read session' }], truncatedCount: 0 } : { totalCount: 0, counts: {}, samples: [], truncatedCount: 0 } } });
    }),
  });
  await page.waitForSelector('[data-session-empty]');
  assert.match(await page.locator('[data-session-empty]').textContent(), /No readable sessions/);
  withDiagnostics = false;
  await page.reload();
  await page.waitForSelector('[data-session-empty]');
  assert.match(await page.locator('[data-session-empty]').textContent(), /No sessions match this repository/);
  assert.equal(await page.locator('#sourceDiagnostics').isHidden(), true);
});

test('browser onboarding retains startup failure through discovery errors and inactive config then successfully retries', async (t) => {
  const fixture = await makeClaudeSwitchFixture(t);
  const { page } = await openSourceSwitchChooser(t, {
    server: { claudeHome: fixture.claudeHome },
    beforeGoto: async (p) => {
      await p.route('**/api/state*', async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        await route.fulfill({ status: 200, json: { ...(payload.details || payload), projectSelected: false, job: { id: 'initial-failure', status: 'failed', repoRoot, error: 'Original startup failure' } } });
      });
      await p.route('**/api/projects*', (route) => route.fulfill({ status: 500, json: { error: 'Discovery temporarily failed' } }));
    },
  });
  await page.waitForFunction(() => document.querySelector('#projectStatus')?.textContent.includes('Discovery temporarily failed'));
  assert.match(await page.locator('#projectFailure').textContent(), /Original startup failure/);
  await page.unroute('**/api/projects*');
  await page.locator('[data-project-config]').click();
  await page.locator('#projectClaudeHomeInput').fill(path.join(fixture.claudeHome, 'inactive-draft'));
  await page.locator('#projectHomeApplyBtn').click();
  await waitForProjectRoot(page, repoRoot);
  assert.match(await page.locator('#projectFailure').textContent(), /Original startup failure/);
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction(() => !document.querySelector('#projectHomeApplyBtn')?.disabled);
  assert.match(await page.locator('#projectFailure').textContent(), /Original startup failure/);
  await page.unroute('**/api/state*');
  await page.locator('[data-project-retry]').click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing' && Boolean(document.querySelector('.sessionItem.active')));
  assert.equal(await page.locator('#projectFailure').isHidden(), true);
  assert.equal(await page.locator('.sessionItem.active').count(), 1);
});

for (const firstFailure of [false, true]) {
  test(`browser polling recovery resumes original job after ${firstFailure ? 'initial' : 'scheduled'} transport failure`, async (t) => {
    const { page, counts } = await openPollingRecoveryChooser(t, async (route, counts, jobId) => {
      if (!firstFailure && counts.gets === 1) {
        await route.fulfill({ json: { job: { id: jobId, status: 'running', repoRoot } } });
      } else if (counts.gets === (firstFailure ? 1 : 2)) await route.abort('failed');
      else await route.continue();
    });
    await page.waitForSelector('.sessionItem.active');
    assert.equal(counts.posts, 1);
    assert.equal(new Set(counts.jobIds).size, 1);
    assert.ok(counts.gets >= (firstFailure ? 2 : 3));
    assert.equal(await page.locator('#projectPollRecovery').isHidden(), true);
  });
}

test('browser polling recovery exhausts budget and manually continues original job', async (t) => {
  let recover = false;
  const { page, counts } = await openPollingRecoveryChooser(t, async (route) => {
    if (recover) await route.continue();
    else await route.fulfill({ status: 503, json: { error: '<b>temporary status failure</b>' } });
  });
  await page.waitForSelector('[data-project-continue]');
  assert.equal(counts.gets, 4);
  assert.equal(await page.locator('#projectPollRecovery b').count(), 0);
  assert.match(await page.locator('#projectPollRecovery').textContent(), /task may still be running/);
  await page.waitForTimeout(600);
  assert.equal(counts.gets, 4);
  recover = true;
  await page.locator('[data-project-continue]').click();
  await page.waitForSelector('.sessionItem.active');
  assert.equal(counts.posts, 1);
  assert.equal(new Set(counts.jobIds).size, 1);
});

for (const invalid of ['404', '404-null', 'malformed', 'unknown', 'wrong-job']) {
  test(`browser polling recovery pauses ${invalid} status and permits cancellation`, async (t) => {
    const { page, counts } = await openPollingRecoveryChooser(t, async (route, counts, jobId) => {
      if (invalid === '404-null') {
        await route.fulfill({ status: 404, body: 'null', contentType: 'application/json' });
      } else if (route.request().method() === 'DELETE' || invalid === '404') {
        await route.fulfill({ status: 404, json: { error: 'Job unavailable' } });
      } else if (invalid === 'malformed') await route.fulfill({ body: 'not json', contentType: 'application/json' });
      else await route.fulfill({ json: { job: { id: invalid === 'wrong-job' ? 'other' : jobId, status: invalid === 'unknown' ? 'surprise' : 'running' } } });
    });
    await page.waitForSelector('[data-project-continue]');
    await page.waitForTimeout(600);
    assert.equal(counts.gets, 1);
    await page.locator('#projectCancelBtn').click();
    await page.waitForFunction(() => document.querySelector('#projectCancelBtn').hidden);
    assert.equal(await page.locator('#projectPollRecovery').isHidden(), true);
    assert.equal(counts.deletes, 1);
  });
}

test('browser polling recovery observes original job after cancellation transport failure', async (t) => {
  const { page, counts } = await openPollingRecoveryChooser(t, async (route, counts, jobId) => {
    if (route.request().method() === 'DELETE') await route.abort('failed');
    else if (!counts.deletes) await route.fulfill({ json: { job: { id: jobId, status: 'running', repoRoot } } });
    else await route.continue();
  });
  await page.locator('#projectCancelBtn').click();
  await page.waitForSelector('.sessionItem.active');
  assert.equal(counts.posts, 1);
  assert.equal(counts.deletes, 1);
  assert.equal(new Set(counts.jobIds).size, 1);
});

test('browser polling recovery ignores a delayed success after cancellation', async (t) => {
  let release;
  let pending;
  const delayed = new Promise((resolve) => { release = resolve; });
  const observed = new Promise((resolve) => { pending = resolve; });
  const { page, counts } = await openPollingRecoveryChooser(t, async (route, counts, jobId) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ json: { job: { id: jobId, status: 'cancelled', repoRoot } } });
    } else {
      const response = await route.fetch();
      pending();
      await delayed;
      await route.fulfill({ response });
    }
  });
  await observed;
  await page.locator('#projectCancelBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectCancelBtn').hidden);
  release();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'selecting');
  assert.equal(await page.locator('.sessionItem.active').count(), 0);
  assert.equal(counts.posts, 1);
});

test('browser polling recovery resumes startup job after initial query failure without POST', async (t) => {
  const index = await buildFixtureIndex();
  let appState;
  let gets = 0;
  let posts = 0;
  const { page } = await openApp(t, index, {
    locale: 'en', skipProjectReindex: true,
    beforeGoto: async (page) => {
      await page.route('**/api/state*', async (route) => {
        const response = await route.fetch();
        appState = await response.json();
        await route.fulfill({ json: { ...appState, projectSelected: false, job: { id: 'startup-job', status: 'running', repoRoot } } });
      });
      await page.route('**/api/project', async (route) => { posts += 1; await route.continue(); });
      await page.route('**/api/project/status*', async (route) => {
        gets += 1;
        assert.equal(new URL(route.request().url()).searchParams.get('jobId'), 'startup-job');
        if (gets === 1) await route.abort('failed');
        else await route.fulfill({ json: { job: { id: 'startup-job', status: 'succeeded', repoRoot }, state: appState } });
      });
    },
  });
  assert.equal(gets, 2);
  assert.equal(posts, 0);
  assert.equal(await page.locator('#projectPollRecovery').isHidden(), true);
});

test('browser polling recovery ignores delayed fallback state after cancellation', async (t) => {
  let release;
  let pending;
  const delayed = new Promise((resolve) => { release = resolve; });
  const observed = new Promise((resolve) => { pending = resolve; });
  const { page, counts } = await openPollingRecoveryChooser(t, async (route, counts, jobId) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ json: { job: { id: jobId, status: 'cancelled', repoRoot } } });
    } else {
      const response = await route.fetch();
      const data = await response.json();
      delete data.state;
      await route.fulfill({ json: data });
    }
  });
  // The initial poll may already have fetched state; re-enter with interception installed.
  await page.waitForSelector('.sessionItem.active');
  await page.locator('#projectSwitchControl').click();
  await waitForProjectRoot(page, repoRoot);
  await page.route('**/api/state*', async (route) => {
    const response = await route.fetch();
    pending();
    await delayed;
    await route.fulfill({ response });
  });
  await page.locator('.projectItem[data-project-root]').first().click();
  await observed;
  await page.locator('#projectCancelBtn').click();
  await page.waitForFunction(() => document.querySelector('#projectCancelBtn').hidden);
  release();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'selecting');
  assert.equal(counts.posts, 2);
});

test('browser polling recovery retries non-JSON temporary HTTP response', async (t) => {
  const { page, counts } = await openPollingRecoveryChooser(t, async (route, counts) => {
    if (counts.gets === 1) await route.fulfill({ status: 503, body: '<html>Temporarily unavailable</html>', contentType: 'text/html' });
    else await route.continue();
  });
  await page.waitForSelector('.sessionItem.active');
  assert.equal(counts.posts, 1);
  assert.ok(counts.gets >= 2);
  assert.equal(await page.locator('#projectPollRecovery').isHidden(), true);
});

test('browser polling recovery resets consecutive error budget after valid running status', async (t) => {
  const { page, counts } = await openPollingRecoveryChooser(t, async (route, counts, jobId) => {
    if (counts.gets === 4) {
      await route.fulfill({ json: { job: { id: jobId, status: 'running', repoRoot } } });
    } else if (counts.gets < 8) await route.abort('failed');
    else await route.continue();
  });
  await page.waitForSelector('.sessionItem.active');
  assert.equal(counts.posts, 1);
  assert.equal(counts.gets, 8);
  assert.equal(new Set(counts.jobIds).size, 1);
  assert.equal(await page.locator('#projectPollRecovery').isHidden(), true);
});
