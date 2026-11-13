'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { interpretProjectPath } = require('../src/shared/project-path');
const { createProjectPathContext } = require('../src/project-path-context');
const { openSourceSwitchChooser, installWave1bM2SourceBundle, deferred } = require('./browser-helpers');

const UNC = '\\\\server\\share\\Project';
const forwardUNC = '//server/share/Project';
const rulesKey = 'sessionAnalyzer.projectPathRules.v1';
const selectedKey = 'sessionAnalyzer.projectPath.workbuddy';

async function fixture(t, { outside = false } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-project-path-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const originals = new Map();
  async function add(container, id, cwd) {
    const file = path.join(home, 'projects', container, `${id}.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const row = { type: 'message', id: `question-${id}`, sessionId: id, cwd, role: 'user', timestamp: 1794441600000,
      content: [{ type: 'input_text', text: `SYNTHETIC_PATH_${id}` }] };
    const text = `${JSON.stringify(row)}\n`;
    await fs.writeFile(file, text);
    originals.set(file, text);
  }
  await add('chosen', 'forward', forwardUNC);
  await add('chosen', 'backward', UNC);
  if (outside) await add('chosen-2', 'outside', forwardUNC);
  const server = { source: 'workbuddy', workbuddyHome: home, sessionPrewarm: false };
  const rules = [{ scope: 'container', path: 'projects/chosen', interpretation: 'unc' }];
  const storage = { version: 1, entries: [{ sourceKind: 'workbuddy', home, rules }] };
  async function open(options = {}) {
    const beforeGoto = options.beforeGoto;
    return openSourceSwitchChooser(t, { ...options, server: { ...server, ...options.server },
      beforeGoto: async (page) => {
        await installWave1bM2SourceBundle(page);
        if (beforeGoto) await beforeGoto(page);
      } });
  }
  async function unchanged() {
    for (const [file, original] of originals) assert.equal(await fs.readFile(file, 'utf8'), original);
  }
  return { home, add, originals, rules, storage, server, open, unchanged };
}

async function waitForProjects(page, count) {
  await page.waitForFunction((expected) => document.querySelectorAll('#projectList [data-project-root]').length === expected
    && !document.querySelector('#projectList [data-project-root]:disabled'), count);
}

async function saveRule(page, { scope = 'container', path = 'projects/chosen', interpretation = 'unc' } = {}) {
  await page.locator('#projectPathPolicyEditor').evaluate((element) => { element.open = true; });
  await page.locator('#projectPathRuleScope').selectOption(scope);
  await page.locator('#projectPathRulePath').fill(path);
  await page.locator('#projectPathRuleInterpretation').selectOption(interpretation);
  await page.locator('#projectPathRuleApply').click();
}

async function chooseProject(page, repoRoot) {
  const exactRoot = new RegExp(`^${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  await page.locator('#projectList [data-project-root]').filter({ has: page.locator('.projectPath', { hasText: exactRoot }) }).click();
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.waitForSelector('#sessionList .sessionItem.active');
}

async function changeSourceHome(page, home) {
  await page.locator('#projectHomeEditor').evaluate((element) => { element.open = true; });
  await page.locator('#projectWorkbuddyHomeInput').fill(home);
  const response = page.waitForResponse((value) => new URL(value.url()).pathname === '/api/source' && value.request().method() === 'POST');
  await page.locator('#projectHomeApplyBtn').click();
  const payload = await (await response).json();
  await page.waitForFunction((expected) => document.querySelector('#projectSourceHome')?.textContent === expected
    && !document.querySelector('#projectHomeApplyBtn')?.disabled, home);
  return payload;
}

test('browser physical-scope rule unifies UNC discovery, selection, readable Detail and exact Raw', async (t) => {
  const f = await fixture(t, { outside: true });
  const posts = [];
  const { page } = await f.open({ beforeGoto: async (p) => p.route('**/api/project', async (route) => {
    posts.push(route.request().postDataJSON()); await route.continue();
  }) });
  await waitForProjects(page, 2);
  assert.match(await page.locator('#projectPathNotice').innerText(), /legacy POSIX compatibility assumption/);
  assert.match(await page.locator('#projectPathRuleWholeRoot').textContent(), /all unknown \/\/ cwd records/);
  await saveRule(page);
  await page.waitForFunction(() => [...document.querySelectorAll('#projectList [data-project-root]')]
    .some((button) => button.dataset.projectRoot.startsWith('\\\\') && button.querySelector('.projectFacts')?.textContent.includes('2')));
  const discovered = await page.request.get(new URL('/api/projects', page.url()).href).then((response) => response.json());
  const windows = discovered.projects.find((project) => project.projectPath.semantics === 'windows');
  const posix = discovered.projects.find((project) => project.projectPath.semantics === 'posix');
  assert.equal(windows.sessionCount, 2);
  assert.equal(posix.sessionCount, 1, 'adjacent physical container remains outside the UNC rule');
  assert.equal(windows.projectPath.key, interpretProjectPath(UNC).key);
  await chooseProject(page, windows.repoRoot);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].projectPathKey, windows.projectPath.key);
  assert.equal(posts[0].projectPathPolicyId, discovered.projectPathPolicyId);
  assert.equal(posts[0].projectPathSemantics, 'windows');
  const selected = await page.request.get(new URL('/api/state', page.url()).href).then((response) => response.json());
  assert.equal(selected.totals.sessionCount, 2);
  assert.equal(selected.projectPath.key, windows.projectPath.key);
  await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('SYNTHETIC_PATH_'));
  await page.locator('#timeline article.event').first().click();
  await page.locator('#detail [data-detail-action="raw"]').click();
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('SYNTHETIC_PATH_'));
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), selectedKey);
  assert.equal(saved.projectPath.key, windows.projectPath.key);
  assert.equal(saved.policyId, discovered.projectPathPolicyId);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), rulesKey);
  assert.deepEqual(stored.entries.find((item) => item.sourceKind === 'workbuddy').rules, discovered.sourceConfigs.workbuddy.projectPathRules);
  await f.unchanged();
});

test('browser preserves ambiguous bare saved roots and pauses their automatic restore', async (t) => {
  const f = await fixture(t);
  let posts = 0;
  const { page } = await f.open({ localStorage: { 'sessionAnalyzer.repoRoot.workbuddy': forwardUNC },
    beforeGoto: async (p) => p.route('**/api/project', async (route) => { posts++; await route.continue(); }) });
  await waitForProjects(page, 2);
  await page.waitForFunction(() => document.querySelector('#projectPathNotice')?.textContent.includes('automatic restore is paused'));
  assert.equal(posts, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('sessionAnalyzer.repoRoot.workbuddy')), forwardUNC);
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'selecting');
  await f.unchanged();
});

test('browser restores stored physical rules only when the same server home has no explicit rules', async (t) => {
  const f = await fixture(t);
  let mutations = 0;
  const { page } = await f.open({ localStorage: { [rulesKey]: JSON.stringify(f.storage) },
    beforeGoto: async (p) => p.route('**/api/source', async (route) => { mutations++; await route.continue(); }) });
  await waitForProjects(page, 1);
  assert.equal(mutations, 1);
  assert.equal(await page.locator('#projectList .projectPath').innerText(), UNC);
  assert.equal(await page.locator('#projectPathRulesList [data-path-rule-remove]').count(), 1);
  await f.unchanged();
});

test('server explicit empty rules take precedence over remembered browser rules', async (t) => {
  const f = await fixture(t);
  let mutations = 0;
  const { page } = await f.open({ server: { sourceConfigs: { workbuddy: { home: f.home, projectPathRules: [] } } },
    localStorage: { [rulesKey]: JSON.stringify(f.storage) },
    beforeGoto: async (p) => p.route('**/api/source', async (route) => { mutations++; await route.continue(); }) });
  await waitForProjects(page, 2);
  assert.equal(mutations, 0);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), rulesKey);
  assert.deepEqual(stored.entries.find((item) => item.sourceKind === 'workbuddy').rules, []);
  await f.unchanged();
});

test('same-process source-home A to B to A restores only A rules in the home-change transaction', async (t) => {
  const a = await fixture(t); const b = await fixture(t);
  const mutations = [];
  const { page } = await a.open({ beforeGoto: async (p) => p.route('**/api/source', async (route) => {
    mutations.push(route.request().postDataJSON()); await route.continue();
  }) });
  await waitForProjects(page, 2);
  await saveRule(page);
  await waitForProjects(page, 1);
  const initial = await page.request.get(new URL('/api/projects', page.url()).href).then((response) => response.json());
  const originalRules = initial.sourceConfigs.workbuddy.projectPathRules;
  assert.equal(initial.projects[0].sessionCount, 2);

  const away = await changeSourceHome(page, b.home);
  await waitForProjects(page, 2);
  assert.equal(Object.hasOwn(away.sourceConfigs.workbuddy, 'projectPathRules'), false, 'A rules do not cross into B');
  assert.equal(Object.hasOwn(mutations.at(-1).sourceConfigs.workbuddy, 'projectPathRules'), false);
  const returned = await changeSourceHome(page, a.home);
  assert.deepEqual(mutations.at(-1).sourceConfigs.workbuddy.projectPathRules, originalRules,
    'the same home-change POST carries remembered rules for A');
  assert.equal(mutations.length, 3, 'there is no intermediate default-policy POST followed by another restore POST');
  assert.equal(returned.projectPathPolicyId, initial.projectPathPolicyId);
  await waitForProjects(page, 1);
  await chooseProject(page, UNC);
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .sessionItem').length === 2);
  await a.unchanged(); await b.unchanged();
});

test('an explicit clear remains authoritative when the same browser returns to that source home', async (t) => {
  const a = await fixture(t); const b = await fixture(t);
  const mutations = [];
  const { page } = await a.open({
    server: { sourceConfigs: { workbuddy: { home: a.home, projectPathRules: [] } } },
    localStorage: { [rulesKey]: JSON.stringify(a.storage) },
    beforeGoto: async (p) => p.route('**/api/source', async (route) => {
      mutations.push(route.request().postDataJSON()); await route.continue();
    }),
  });
  await waitForProjects(page, 2);
  await changeSourceHome(page, b.home);
  await waitForProjects(page, 2);
  const returned = await changeSourceHome(page, a.home);
  assert.deepEqual(mutations.at(-1).sourceConfigs.workbuddy.projectPathRules, [], 'the explicit empty policy survives the round trip');
  assert.deepEqual(returned.sourceConfigs.workbuddy.projectPathRules, []);
  assert.equal(mutations.length, 2);
  await waitForProjects(page, 2);
  await a.unchanged(); await b.unchanged();
});

test('a lost home-change response accepts reliable target-home rules when none were submitted', async (t) => {
  const a = await fixture(t); const b = await fixture(t);
  const targetRules = [{ scope: 'container', path: 'projects/chosen', interpretation: 'posix' }];
  const mutations = [];
  let injected = false;
  const { page } = await a.open({ beforeGoto: async (p) => p.route('**/api/source', async (route) => {
    const submitted = route.request().postDataJSON();
    mutations.push(submitted);
    if (injected || submitted.sourceConfigs?.workbuddy?.home !== b.home) return route.continue();
    injected = true;
    // A separate authoritative client reaches this home first and explicitly
    // configures its rules. The pending browser POST omits rules, so the server
    // preserves them; lose only that POST's response to force reconciliation.
    const concurrent = await p.request.post(route.request().url(), { data: { source: 'workbuddy',
      sourceConfigs: { workbuddy: { home: b.home, projectPathRules: targetRules } } } });
    assert.equal(concurrent.status(), 200);
    const accepted = await route.fetch();
    assert.equal(accepted.status(), 200);
    await route.abort('failed');
  }) });
  await waitForProjects(page, 2);
  await page.locator('#projectHomeEditor').evaluate((element) => { element.open = true; });
  await page.locator('#projectWorkbuddyHomeInput').fill(b.home);
  await page.locator('#projectHomeApplyBtn').click();
  await page.waitForFunction((expected) => document.querySelector('#projectSourceHome')?.textContent === expected
    && !document.querySelector('#projectHomeApplyBtn')?.disabled, b.home);
  assert.equal(mutations.length, 1, 'reconciliation observes state without posting a replacement rule set');
  assert.equal(Object.hasOwn(mutations[0].sourceConfigs.workbuddy, 'projectPathRules'), false);
  assert.equal(await page.locator('#projectSourceError').textContent(), '', 'omission is not an explicit empty rule set');
  const current = await page.request.get(new URL('/api/projects', page.url()).href).then((response) => response.json());
  assert.deepEqual(current.sourceConfigs.workbuddy.projectPathRules, [{ ...targetRules[0], path: path.join(b.home, 'projects/chosen') }]);
  await waitForProjects(page, 2);
  await a.unchanged(); await b.unchanged();
});

test('rule editor preserves native POSIX edge spaces instead of selecting the trimmed physical container', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  await f.add(' chosen ', 'spaced', forwardUNC);
  await f.add(' chosen', 'decoy', forwardUNC);
  const physicalScope = 'projects/ chosen ';
  const [exact, trimmed] = await Promise.all([fs.stat(path.join(f.home, physicalScope)), fs.stat(path.join(f.home, physicalScope.trim()))]);
  assert.notEqual(`${exact.dev}:${exact.ino}`, `${trimmed.dev}:${trimmed.ino}`, 'native filesystem distinguishes both scope directories');
  const { page } = await f.open();
  await waitForProjects(page, 2);
  await saveRule(page, { path: physicalScope });
  await page.waitForFunction(() => !document.querySelector('#projectPathRuleApply')?.disabled);
  const discovered = await page.request.get(new URL('/api/projects', page.url()).href).then((response) => response.json());
  assert.equal(discovered.sourceConfigs.workbuddy.projectPathRules[0].path, path.join(f.home, physicalScope));
  await chooseProject(page, UNC);
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .sessionItem').length === 2);
  assert.match(await page.locator('#sessionList').innerText(), /SYNTHETIC_PATH_spaced/);
  assert.doesNotMatch(await page.locator('#sessionList').innerText(), /SYNTHETIC_PATH_decoy/);
  await page.locator('#projectSwitchControl').click();
  await waitForProjects(page, 2);
  const leadingAndTrailing = ' leading-container ';
  await fs.mkdir(path.join(f.home, leadingAndTrailing));
  await saveRule(page, { path: leadingAndTrailing, interpretation: 'posix' });
  await page.waitForFunction(() => !document.querySelector('#projectPathRuleApply')?.disabled);
  const saved = await page.request.get(new URL('/api/projects', page.url()).href).then((response) => response.json());
  assert.ok(saved.sourceConfigs.workbuddy.projectPathRules.some((rule) => rule.path === path.join(f.home, leadingAndTrailing)),
    'leading and trailing spaces both survive the browser configuration boundary');
  await f.unchanged();
});

test('a first explicit empty rule set prevents another browser from restoring remembered rules', async (t) => {
  const f = await fixture(t);
  const { page, baseUrl } = await f.open();
  await waitForProjects(page, 2);
  const cleared = await page.request.post(baseUrl + '/api/source', { data: {
    source: 'workbuddy', sourceConfigs: { workbuddy: { home: f.home, projectPathRules: [] } },
  } }).then(response => response.json());
  assert.deepEqual(cleared.sourceConfigs.workbuddy.projectPathRules, []);
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  await context.addInitScript(({ key, value }) => {
    localStorage.setItem('sessionAnalyzer.locale', 'en'); localStorage.setItem(key, value);
  }, { key: rulesKey, value: JSON.stringify(f.storage) });
  const next = await context.newPage();
  await installWave1bM2SourceBundle(next);
  let mutations = 0;
  await next.route('**/api/source', async route => { mutations++; await route.continue(); });
  await next.goto(baseUrl);
  await waitForProjects(next, 2);
  assert.equal(mutations, 0);
  assert.equal(await next.locator('#projectPathRulesList [data-path-rule-remove]').count(), 0);
  await f.unchanged();
});

test('cross-policy saved metadata is kept without automatically choosing its same-looking project', async (t) => {
  const f = await fixture(t);
  const saved = { version: 1, repoRoot: UNC, sourceHome: f.home, policyId: 'obsolete-policy', projectPath: interpretProjectPath(UNC), legacyAssumption: false };
  let posts = 0;
  const { page } = await f.open({ localStorage: { 'sessionAnalyzer.repoRoot.workbuddy': UNC, [selectedKey]: JSON.stringify(saved) },
    beforeGoto: async (p) => p.route('**/api/project', async (route) => { posts++; await route.continue(); }) });
  await waitForProjects(page, 2);
  await page.waitForFunction(() => document.querySelector('#projectPathNotice')?.textContent.includes('automatic restore is paused'));
  assert.equal(posts, 0);
  assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), selectedKey), saved);
});

test('same-key saved metadata restores under its captured source home and path policy', async (t) => {
  const f = await fixture(t);
  const policy = createProjectPathContext({ sourceKind: 'workbuddy', sourceHome: f.home, projectPathRules: f.rules });
  const saved = { version: 1, repoRoot: UNC, sourceHome: f.home, policyId: policy.digest,
    projectPath: interpretProjectPath(UNC), legacyAssumption: false };
  let posts = 0;
  const { page } = await f.open({ server: { sourceConfigs: { workbuddy: { home: f.home, projectPathRules: f.rules } } },
    localStorage: { 'sessionAnalyzer.repoRoot.workbuddy': UNC, [selectedKey]: JSON.stringify(saved) },
    beforeGoto: async (p) => p.route('**/api/project', async (route) => { posts++; await route.continue(); }) });
  await page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .sessionItem').length === 2);
  assert.equal(posts, 1);
  const state = await page.request.get(new URL('/api/state', page.url()).href).then((response) => response.json());
  assert.equal(state.projectPathPolicyId, saved.policyId);
  assert.equal(state.projectPath.key, saved.projectPath.key);
  await f.unchanged();
});

test('a delayed discovery response from the previous policy cannot replace the new project list', async (t) => {
  const f = await fixture(t);
  const captured = deferred(); const release = deferred(); const settled = deferred();
  t.after(() => release.resolve());
  let calls = 0;
  const { page } = await f.open({ beforeGoto: async (p) => p.route('**/api/projects*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('summary') || ++calls !== 1) return route.continue();
    const response = await route.fetch();
    captured.resolve(); await release.promise;
    await route.fulfill({ response }); settled.resolve();
  }) });
  await captured.promise;
  await saveRule(page);
  await waitForProjects(page, 1);
  const newKey = await page.locator('#projectList [data-project-root]').getAttribute('data-project-key');
  assert.equal(newKey, interpretProjectPath(UNC).key);
  release.resolve(); await settled.promise;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#projectList [data-project-root]').count(), 1);
  assert.equal(await page.locator('#projectList [data-project-root]').getAttribute('data-project-key'), newKey);
});

test('browser rejects an indexing response with a different captured path policy', async (t) => {
  const f = await fixture(t);
  const { page } = await f.open({ beforeGoto: async (p) => p.route('**/api/project/status*', async (route) => {
    const response = await route.fetch(); const body = await response.json();
    body.job.projectPathPolicyId = 'obsolete-policy';
    await route.fulfill({ response, json: body });
  }) });
  await waitForProjects(page, 2);
  await page.locator('#projectList [data-project-root]').filter({ has: page.locator('.projectPath', { hasText: UNC }) }).click();
  await page.waitForFunction(() => !document.querySelector('#projectPollRecovery')?.hidden);
  assert.equal(await page.locator('body').getAttribute('data-project-mode'), 'selecting');
  assert.equal(await page.locator('#sessionList .sessionItem').count(), 0);
});

test('retired Detail cannot publish after a physical path rule changes the reading scope', async (t) => {
  const f = await fixture(t);
  const captured = deferred(); const release = deferred(); const settled = deferred();
  t.after(() => release.resolve());
  let held = false;
  const { page } = await f.open({ beforeGoto: async (p) => p.route('**/api/sessions/*/events/*/detail?*', async (route) => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('SYNTHETIC_PATH_backward', 'OLD_POLICY_DETAIL_LEAK');
    captured.resolve(); await release.promise;
    try { await route.fulfill({ response, body }); } catch { /* A retired fetch may already be aborted. */ }
    settled.resolve();
  }) });
  await waitForProjects(page, 2);
  await chooseProject(page, UNC);
  await captured.promise;
  await page.locator('#projectSwitchControl').click();
  await waitForProjects(page, 2);
  await saveRule(page);
  await waitForProjects(page, 1);
  await chooseProject(page, UNC);
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .sessionItem').length === 2);
  release.resolve(); await settled.promise;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.doesNotMatch(await page.locator('body').innerText(), /OLD_POLICY_DETAIL_LEAK/);
  await f.unchanged();
});

test('a pi bookmark from another path policy is retained and paused without reference rewriting', async (t) => {
  const f = await fixture(t);
  const repo = path.join(f.home, 'pi-repo');
  const file = path.join(f.home, 'sessions', 'chosen', 'session.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const timestamp = '2026-11-12T00:00:00.000Z';
  const text = [
    { type: 'session', version: 3, id: 'synthetic-pi-bookmark', cwd: repo, timestamp },
    { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: 'SYNTHETIC_PI_BOOKMARK', timestamp: Date.parse(timestamp) } },
  ].map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(file, text);
  const { page, baseUrl } = await f.open({ server: { source: 'pi', piHome: f.home } });
  await waitForProjects(page, 1);
  await chooseProject(page, repo);
  let resolutions = 0;
  await page.route('**/api/pi/entry*', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/pi/entry') resolutions++;
    await route.continue();
  });
  const target = new URL(baseUrl);
  target.searchParams.set('source', 'pi'); target.searchParams.set('repoRoot', repo);
  target.searchParams.set('piEntry', 'opaque-old-reference'); target.searchParams.set('projectPathPolicyId', 'obsolete-policy');
  await page.goto(target.href);
  await page.waitForFunction(() => document.querySelector('#stateLine')?.textContent.includes('another source or project'));
  assert.equal(page.url(), target.href);
  assert.equal(resolutions, 0);
  assert.equal(await fs.readFile(file, 'utf8'), text);
});

test('native POSIX case-distinct projects stay distinct in browser discovery and selection', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  await fs.rm(path.join(f.home, 'projects'), { recursive: true });
  f.originals.clear();
  const upper = path.join(f.home, 'Project'); const lower = path.join(f.home, 'project');
  await fs.mkdir(upper); await fs.mkdir(lower);
  const [a, b] = await Promise.all([fs.stat(upper), fs.stat(lower)]);
  assert.notEqual(`${a.dev}:${a.ino}`, `${b.dev}:${b.ino}`, 'native filesystem supplies two different directories');
  await f.add('upper', 'upper', `/${upper}`); await f.add('lower', 'lower', `/${lower}`);
  const { page } = await f.open();
  await waitForProjects(page, 2);
  const keys = await page.locator('#projectList [data-project-key]').evaluateAll((nodes) => nodes.map((node) => node.dataset.projectKey));
  assert.equal(new Set(keys).size, 2);
  await chooseProject(page, upper);
  assert.equal(await page.locator('#sessionList .sessionItem').count(), 1);
  assert.match(await page.locator('#timeline').innerText(), /SYNTHETIC_PATH_upper/);
  assert.doesNotMatch(await page.locator('#timeline').innerText(), /SYNTHETIC_PATH_lower/);
  await f.unchanged();
});

test('synthetic native-backslash extended namespace stays readable and restores within its own policy', async (t) => {
  // This is a recorded-path compatibility test using a native local JSONL file.
  // It does not open a Windows namespace or claim native Windows FS behavior.
  const f = await fixture(t);
  await fs.rm(path.join(f.home, 'projects'), { recursive: true });
  f.originals.clear();
  const special = '\\\\?\\C:\\Project';
  await f.add('chosen', 'namespace', special);
  const first = await f.open();
  await waitForProjects(first.page, 1);
  assert.equal(await first.page.locator('#projectPathNotice').isVisible(), false, 'namespace compatibility is not an unknown // assumption');
  await chooseProject(first.page, special);
  await first.page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('SYNTHETIC_PATH_namespace'));
  const diagnostics = first.page.locator('#sourceDiagnostics');
  await diagnostics.locator('details').evaluate((element) => { element.open = true; });
  assert.match(await diagnostics.innerText(), /Native namespace compatibility/);
  assert.doesNotMatch(await diagnostics.innerText(), /Some source files could not be read|source reading issue|Results may be incomplete/);
  const saved = await first.page.evaluate((key) => JSON.parse(localStorage.getItem(key)), selectedKey);
  assert.equal(saved.projectPath.namespace, 'windows-extended');
  assert.equal(saved.projectPath.namespaceCompatibility, true);
  assert.equal(saved.legacyAssumption, false);
  assert.notEqual(saved.projectPath.key, interpretProjectPath('C:\\Project').key);
  const second = await f.open({ locale: 'zh-CN', localStorage: {
    'sessionAnalyzer.repoRoot.workbuddy': special, [selectedKey]: JSON.stringify(saved),
  } });
  await second.page.waitForFunction(() => document.body.dataset.projectMode === 'analyzing');
  await second.page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('SYNTHETIC_PATH_namespace'));
  await second.page.locator('#sourceDiagnostics details').evaluate((element) => { element.open = true; });
  const restoredDiagnostics = await second.page.locator('#sourceDiagnostics').innerText();
  assert.match(restoredDiagnostics, /原生命名空间兼容/);
  assert.doesNotMatch(restoredDiagnostics, /部分来源文件无法读取/);
  assert.equal(await second.page.locator('#sessionList .sessionItem').count(), 1);
  const restored = await second.page.request.get(new URL('/api/state', second.page.url()).href).then((response) => response.json());
  assert.equal(restored.projectPath.key, saved.projectPath.key);
  assert.equal(restored.projectPathPolicyId, saved.policyId);
  await f.unchanged();
});
