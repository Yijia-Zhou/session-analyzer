'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer, discoverProjectsForSource, resolveSourceMutation } = require('../server');

const codexFixtureHome = path.join(__dirname, 'fixtures', 'codex-home');
const codexFixtureRepo = 'G:\\vibe\\term-agent';

async function makeClaudeFixture(t) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-source-switch-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-switch-fixture');
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await fsp.mkdir(repoRoot, { recursive: true });
  const records = [
    {
      isSidechain: false,
      userType: 'external',
      entrypoint: 'cli',
      cwd: repoRoot,
      sessionId,
      version: '2.1.220',
      type: 'user',
      parentUuid: null,
      promptId: 'switch-prompt',
      uuid: '11111111-1111-4111-8111-111111111111',
      timestamp: '2026-08-07T10:00:00.000Z',
      message: { role: 'user', content: 'Switch fixture task' },
    },
    {
      isSidechain: false,
      userType: 'external',
      entrypoint: 'cli',
      cwd: repoRoot,
      sessionId,
      version: '2.1.220',
      type: 'assistant',
      parentUuid: '11111111-1111-4111-8111-111111111111',
      promptId: 'switch-prompt',
      uuid: '22222222-2222-4222-8222-222222222222',
      timestamp: '2026-08-07T10:00:01.000Z',
      message: {
        id: 'switch-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Switched fixture reply' }],
      },
    },
  ];
  await fsp.mkdir(container, { recursive: true });
  await fsp.writeFile(
    path.join(container, `${sessionId}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  return { claudeHome, repoRoot };
}

async function startServer(t, options = {}) {
  const server = createServer(null, 0, options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  return `http://127.0.0.1:${server.address().port}`;
}

async function requestJson(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function jsonRequestOptions(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function waitForJob(base, jobId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, json } = await requestJson(base, `/api/project/status?jobId=${encodeURIComponent(jobId)}`);
    if (status === 200 && json?.job && ['succeeded', 'failed', 'cancelled'].includes(json.job.status)) {
      return json.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('Timed out waiting for project indexing job');
}

test('POST /api/source validates source, homes, body shape, and payload size', async (t) => {
  const fixture = await makeClaudeFixture(t);
  const base = await startServer(t, {
    source: 'codex',
    codexHome: codexFixtureHome,
    claudeHome: path.join(fixture.claudeHome, 'unused'),
  });

  const invalidBodies = [
    'not json',
    'null',
    '[]',
    '{}',
    JSON.stringify({ source: false }),
    JSON.stringify({ source: 0 }),
    JSON.stringify({ source: '' }),
    JSON.stringify({ source: 'all' }),
    JSON.stringify({ source: 'codex', codexHome: '' }),
    JSON.stringify({ source: 'codex', codexHome: 123 }),
    JSON.stringify({ source: 'codex', claudeHome: '   ' }),
    JSON.stringify({ source: 'codex', unknownField: true }),
  ];
  for (const body of invalidBodies) {
    const result = await requestJson(base, '/api/source', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(result.status, 400, `expected 400 for body ${body}`);
  }

  const oversized = await requestJson(base, '/api/source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'codex', codexHome: 'x'.repeat(70 * 1024) }),
  });
  assert.equal(oversized.status, 413);

  const state = await requestJson(base, '/api/state');
  assert.equal(state.status, 409);
  assert.equal(state.json.details.sourceKind, 'codex');
  assert.equal(state.json.details.codexHome, path.resolve(codexFixtureHome));
  assert.equal(state.json.details.claudeHome, path.resolve(fixture.claudeHome, 'unused'));
  assert.deepEqual(state.json.details.supportedSources, ['codex', 'claude-code']);
});

test('POST /api/source switches source and exposes unified configuration payloads', async (t) => {
  const fixture = await makeClaudeFixture(t);
  const base = await startServer(t, {
    source: 'codex',
    codexHome: codexFixtureHome,
    claudeHome: path.join(fixture.claudeHome, 'unused'),
  });

  const initialProjects = await requestJson(base, '/api/projects');
  assert.equal(initialProjects.status, 200);
  assert.equal(initialProjects.json.sourceKind, 'codex');
  assert.equal(initialProjects.json.codexHome, path.resolve(codexFixtureHome));
  assert.equal(initialProjects.json.claudeHome, path.resolve(fixture.claudeHome, 'unused'));
  assert.deepEqual(initialProjects.json.supportedSources, ['codex', 'claude-code']);
  assert.ok(initialProjects.json.projects.some((project) => project.repoRoot === codexFixtureRepo));

  const switched = await requestJson(
    base,
    '/api/source',
    jsonRequestOptions({ source: 'claude', claudeHome: fixture.claudeHome }),
  );
  assert.equal(switched.status, 200);
  assert.equal(switched.json.sourceKind, 'claude-code');
  assert.equal(switched.json.sourceHome, path.resolve(fixture.claudeHome));
  assert.equal(switched.json.codexHome, path.resolve(codexFixtureHome));
  assert.equal(switched.json.claudeHome, path.resolve(fixture.claudeHome));
  assert.deepEqual(switched.json.supportedSources, ['codex', 'claude-code']);
  assert.equal(switched.json.projectSelected, false);

  const state = await requestJson(base, '/api/state');
  assert.equal(state.status, 409);
  assert.equal(state.json.details.sourceKind, 'claude-code');
  assert.equal(state.json.details.sourceHome, path.resolve(fixture.claudeHome));
  assert.equal(state.json.details.codexHome, path.resolve(codexFixtureHome));
  assert.equal(state.json.details.claudeHome, path.resolve(fixture.claudeHome));
  assert.deepEqual(state.json.details.supportedSources, ['codex', 'claude-code']);

  const projects = await requestJson(base, '/api/projects');
  assert.equal(projects.status, 200);
  assert.equal(projects.json.sourceKind, 'claude-code');
  assert.equal(projects.json.codexHome, path.resolve(codexFixtureHome));
  assert.equal(projects.json.claudeHome, path.resolve(fixture.claudeHome));
  assert.ok(projects.json.projects.some((project) => project.repoRoot === fixture.repoRoot));
});

test('project indexing uses the active adapter after a source switch', async (t) => {
  const fixture = await makeClaudeFixture(t);
  const base = await startServer(t, {
    source: 'codex',
    codexHome: codexFixtureHome,
    claudeHome: path.join(fixture.claudeHome, 'unused'),
  });

  const switched = await requestJson(
    base,
    '/api/source',
    jsonRequestOptions({ source: 'claude-code', claudeHome: fixture.claudeHome }),
  );
  assert.equal(switched.status, 200);

  const started = await requestJson(
    base,
    '/api/project',
    jsonRequestOptions({ repoRoot: fixture.repoRoot }),
  );
  assert.equal(started.status, 202);
  const job = await waitForJob(base, started.json.job.id);
  assert.equal(job.status, 'succeeded');

  const state = await requestJson(base, '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.sourceKind, 'claude-code');
  assert.ok(state.json.totals.sessionCount >= 1, 'Claude adapter must build the selected index');
});

test('source switch distinguishes no-op, inactive home update, and active identity reset', async (t) => {
  const fixture = await makeClaudeFixture(t);
  const base = await startServer(t, {
    source: 'codex',
    codexHome: codexFixtureHome,
    claudeHome: path.join(fixture.claudeHome, 'unused'),
  });

  const started = await requestJson(base, '/api/project', jsonRequestOptions({ repoRoot: codexFixtureRepo }));
  assert.equal(started.status, 202);
  const job = await waitForJob(base, started.json.job.id);
  assert.equal(job.status, 'succeeded');

  const noop = await requestJson(base, '/api/source', jsonRequestOptions({ source: 'codex' }));
  assert.equal(noop.status, 200);
  assert.equal(noop.json.projectSelected, true);
  assert.equal((await requestJson(base, '/api/state')).status, 200);

  const newClaudeHome = path.join(fixture.claudeHome, 'new-claude');
  const inactiveUpdate = await requestJson(
    base,
    '/api/source',
    jsonRequestOptions({ source: 'codex', claudeHome: newClaudeHome }),
  );
  assert.equal(inactiveUpdate.status, 200);
  assert.equal(inactiveUpdate.json.projectSelected, true);
  assert.equal(inactiveUpdate.json.claudeHome, path.resolve(newClaudeHome));
  const preservedState = await requestJson(base, '/api/state');
  assert.equal(preservedState.status, 200);
  assert.equal(preservedState.json.claudeHome, path.resolve(newClaudeHome));

  const newCodexHome = path.join(fixture.claudeHome, 'other-codex');
  const activeReset = await requestJson(
    base,
    '/api/source',
    jsonRequestOptions({ source: 'codex', codexHome: newCodexHome }),
  );
  assert.equal(activeReset.status, 200);
  assert.equal(activeReset.json.projectSelected, false);
  assert.equal(activeReset.json.sourceHome, path.resolve(newCodexHome));
  assert.equal((await requestJson(base, '/api/state')).status, 409);
});

test('resolveSourceMutation bumps revision for any config change and resets only active identity', () => {
  const index = { repoRoot: '/repo' };
  const state = {
    sourceKind: 'codex',
    sourceHome: path.resolve('/codex-home'),
    codexHome: path.resolve('/codex-home'),
    claudeHome: path.resolve('/claude-home'),
    sourceRevision: 0,
    index,
    projectCache: { generatedAt: '', projects: [] },
    buildMs: 10,
    adapter: { buildIndex() {} },
    activeProjectJob: null,
  };

  const noop = resolveSourceMutation(state, { source: 'codex' });
  assert.equal(noop.errors.length, 0);
  assert.equal(state.sourceRevision, 0);
  assert.equal(noop.payload.projectSelected, true);

  const inactive = resolveSourceMutation(state, { source: 'codex', claudeHome: '/new-claude' });
  assert.equal(inactive.errors.length, 0);
  assert.equal(state.sourceRevision, 1);
  assert.equal(state.claudeHome, path.resolve('/new-claude'));
  assert.equal(state.index, index);
  assert.equal(inactive.payload.projectSelected, true);

  const active = resolveSourceMutation(state, { source: 'codex', codexHome: '/new-codex' });
  assert.equal(active.errors.length, 0);
  assert.equal(state.sourceRevision, 2);
  assert.equal(state.index, null);
  assert.equal(active.payload.projectSelected, false);

  const switched = resolveSourceMutation(state, { source: 'claude-code' });
  assert.equal(switched.errors.length, 0);
  assert.equal(state.sourceKind, 'claude-code');
  assert.equal(state.sourceHome, state.claudeHome);
  assert.equal(state.sourceRevision, 3);

  assert.ok(resolveSourceMutation(state, {}).errors.length > 0);
  assert.ok(resolveSourceMutation(state, { source: 'all' }).errors.length > 0);
});

test('source switch cancels the active job and never commits a stale index', async (t) => {
  const fixture = await makeClaudeFixture(t);
  let resolveBuild;
  const buildIndex = () => new Promise((resolve) => {
    resolveBuild = resolve;
  });
  const base = await startServer(t, {
    source: 'codex',
    codexHome: codexFixtureHome,
    claudeHome: path.join(fixture.claudeHome, 'unused'),
    buildIndex,
  });

  const started = await requestJson(base, '/api/project', jsonRequestOptions({ repoRoot: codexFixtureRepo }));
  assert.equal(started.status, 202);

  const runningState = await requestJson(base, '/api/state');
  assert.equal(runningState.status, 202);
  assert.equal(runningState.json.sourceKind, 'codex');
  assert.equal(runningState.json.projectSelected, false);
  assert.equal(runningState.json.job.status, 'running');
  assert.deepEqual(runningState.json.supportedSources, ['codex', 'claude-code']);

  const switched = await requestJson(
    base,
    '/api/source',
    jsonRequestOptions({ source: 'claude-code', claudeHome: fixture.claudeHome }),
  );
  assert.equal(switched.status, 200);

  const cancelled = await requestJson(base, `/api/project/status?jobId=${encodeURIComponent(started.json.job.id)}`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.job.status, 'cancelled');

  resolveBuild({ repoRoot: codexFixtureRepo, sourceKind: 'codex', sessions: [] });
  await new Promise((resolve) => setTimeout(resolve, 25));

  const after = await requestJson(base, '/api/state');
  assert.equal(after.status, 409);
  assert.equal(after.json.details.sourceKind, 'claude-code');
});

test('summary project discovery is rejected when the source changes mid-flight', async () => {
  let releaseConfigured;
  const configuredGate = new Promise((resolve) => {
    releaseConfigured = resolve;
  });
  const state = {
    sourceRevision: 0,
    sourceKind: 'codex',
    sourceHome: path.resolve('/codex-home'),
    codexHome: path.resolve('/codex-home'),
    claudeHome: path.resolve('/claude-home'),
    projectCache: null,
    adapter: {
      async discoverConfiguredProjects() {
        await configuredGate;
        return [{ repoRoot: '/old/project' }];
      },
      async discoverProjects() {
        return [];
      },
    },
  };
  const pending = discoverProjectsForSource(state, 'summary');
  await new Promise((resolve) => setImmediate(resolve));
  state.sourceRevision = 1;
  releaseConfigured();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(state.projectCache, null);
});

test('full project discovery does not write the cache when the source changes mid-scan', async () => {
  let releaseConfigured;
  let releaseScanned;
  const configuredGate = new Promise((resolve) => {
    releaseConfigured = resolve;
  });
  const scannedGate = new Promise((resolve) => {
    releaseScanned = resolve;
  });
  const state = {
    sourceRevision: 0,
    sourceKind: 'codex',
    sourceHome: path.resolve('/codex-home'),
    codexHome: path.resolve('/codex-home'),
    claudeHome: path.resolve('/claude-home'),
    projectCache: null,
    adapter: {
      async discoverConfiguredProjects() {
        await configuredGate;
        return [];
      },
      async discoverProjects() {
        await scannedGate;
        return [{ repoRoot: '/new/project' }];
      },
    },
  };
  const pending = discoverProjectsForSource(state, 'full');
  await new Promise((resolve) => setImmediate(resolve));
  releaseConfigured();
  await new Promise((resolve) => setImmediate(resolve));
  state.sourceRevision = 1;
  releaseScanned();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(state.projectCache, null);
});
