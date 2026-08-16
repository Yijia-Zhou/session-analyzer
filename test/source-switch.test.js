'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer, discoverProjectsForSource, resolveSourceMutation } = require('../server');
const {
  adapterForSession,
  getSourceAdapter,
  queryForIndex,
  validateIndexOwnership,
} = require('../src/source-adapters');
const { strictClaudeIndexFromComplete } = require('./strict-claude-fixture');

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
    JSON.stringify({ source: 'codex', sourceConfigs: { codex: '/not-an-object' } }),
    JSON.stringify({ source: 'codex', sourceConfigs: { codex: { home: '' } } }),
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
  assert.deepEqual(state.json.details.sourceConfigs, {
    codex: { home: path.resolve(codexFixtureHome) },
    'claude-code': { home: path.resolve(fixture.claudeHome, 'unused') },
  });
  assert.deepEqual(state.json.details.sourceOptions, [
    { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
    { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
  ]);
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
  assert.equal(initialProjects.json.sourceConfigs.codex.home, path.resolve(codexFixtureHome));
  assert.equal(initialProjects.json.sourceConfigs['claude-code'].home, path.resolve(fixture.claudeHome, 'unused'));
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
  assert.equal(switched.json.sourceConfigs.codex.home, path.resolve(codexFixtureHome));
  assert.equal(switched.json.sourceConfigs['claude-code'].home, path.resolve(fixture.claudeHome));
  assert.deepEqual(switched.json.supportedSources, ['codex', 'claude-code']);
  assert.equal(switched.json.projectSelected, false);

  const state = await requestJson(base, '/api/state');
  assert.equal(state.status, 409);
  assert.equal(state.json.details.sourceKind, 'claude-code');
  assert.equal(state.json.details.sourceHome, path.resolve(fixture.claudeHome));
  assert.equal(state.json.details.codexHome, path.resolve(codexFixtureHome));
  assert.equal(state.json.details.claudeHome, path.resolve(fixture.claudeHome));
  assert.equal(state.json.details.sourceConfigs.codex.home, path.resolve(codexFixtureHome));
  assert.equal(state.json.details.sourceConfigs['claude-code'].home, path.resolve(fixture.claudeHome));
  assert.deepEqual(state.json.details.supportedSources, ['codex', 'claude-code']);

  const projects = await requestJson(base, '/api/projects');
  assert.equal(projects.status, 200);
  assert.equal(projects.json.sourceKind, 'claude-code');
  assert.equal(projects.json.codexHome, path.resolve(codexFixtureHome));
  assert.equal(projects.json.claudeHome, path.resolve(fixture.claudeHome));
  assert.equal(projects.json.sourceConfigs['claude-code'].home, path.resolve(fixture.claudeHome));
  assert.ok(projects.json.projects.some((project) => project.repoRoot === fixture.repoRoot));

  const canonical = await requestJson(
    base,
    '/api/source',
    jsonRequestOptions({
      source: 'claude-code',
      sourceConfigs: {
        codex: { home: codexFixtureHome },
        'claude-code': { home: fixture.claudeHome },
      },
    }),
  );
  assert.equal(canonical.status, 200);
  assert.equal(canonical.json.sourceKind, 'claude-code');
  assert.equal(canonical.json.sourceConfigs.codex.home, path.resolve(codexFixtureHome));
  assert.equal(canonical.json.sourceConfigs['claude-code'].home, path.resolve(fixture.claudeHome));
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

test('shared query routes use the neutral Claude query after a source switch', async (t) => {
  const fixture = await makeClaudeFixture(t);
  const base = await startServer(t, {
    source: 'claude-code',
    codexHome: codexFixtureHome,
    claudeHome: fixture.claudeHome,
  });

  const started = await requestJson(base, '/api/project', jsonRequestOptions({ repoRoot: fixture.repoRoot }));
  assert.equal(started.status, 202);
  assert.equal((await waitForJob(base, started.json.job.id)).status, 'succeeded');

  const sessions = await requestJson(base, '/api/sessions?q=Switched%20fixture');
  assert.equal(sessions.status, 200);
  assert.equal(sessions.json.total, 1);
  const session = sessions.json.sessions[0];
  assert.equal(session.sourceKind, 'claude-code');

  const codexOnlyFacet = await requestJson(base, '/api/sessions?codeModeRequest=shell_command');
  assert.equal(codexOnlyFacet.status, 200);
  assert.equal(codexOnlyFacet.json.total, 1);

  const timeline = await requestJson(
    base,
    `/api/sessions/${encodeURIComponent(session.id)}/timeline?layer=main&offset=0&limit=20`,
  );
  assert.equal(timeline.status, 200);
  assert.equal(timeline.json.session.sourceKind, 'claude-code');
  assert.ok(timeline.json.events.some((event) => event.sourceKind === 'claude-code'));

  const timelineWithCodexOnlyFacet = await requestJson(
    base,
    `/api/sessions/${encodeURIComponent(session.id)}/timeline?layer=main&offset=0&limit=20&codeModeRequest=shell_command`,
  );
  assert.equal(timelineWithCodexOnlyFacet.status, 200);
  assert.ok(timelineWithCodexOnlyFacet.json.total > 0);

  const event = timeline.json.events.find((item) => item.kind === 'assistant_message');
  assert.ok(event, 'Claude assistant event should be queryable through the shared timeline');
  const lookup = await requestJson(
    base,
    `/api/sessions/${encodeURIComponent(session.id)}/events/${encodeURIComponent(event.id)}?layer=main`,
  );
  assert.equal(lookup.status, 200);
  assert.equal(lookup.json.sourceKind, 'claude-code');
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
    sourceConfigs: {
      codex: { home: path.resolve('/codex-home') },
      'claude-code': { home: path.resolve('/claude-home') },
    },
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
  assert.equal(state.sourceConfigs['claude-code'].home, path.resolve('/new-claude'));
  assert.equal(state.index, index);
  assert.equal(inactive.payload.projectSelected, true);

  const active = resolveSourceMutation(state, { source: 'codex', codexHome: '/new-codex' });
  assert.equal(active.errors.length, 0);
  assert.equal(state.sourceRevision, 2);
  assert.equal(state.sourceConfigs.codex.home, path.resolve('/new-codex'));
  assert.equal(state.index, null);
  assert.equal(active.payload.projectSelected, false);

  const switched = resolveSourceMutation(state, { source: 'claude-code' });
  assert.equal(switched.errors.length, 0);
  assert.equal(state.sourceKind, 'claude-code');
  assert.equal(state.sourceConfigs['claude-code'].home, path.resolve('/new-claude'));
  assert.equal(state.sourceRevision, 3);

  assert.ok(resolveSourceMutation(state, {}).errors.length > 0);
  assert.ok(resolveSourceMutation(state, { source: 'all' }).errors.length > 0);
});

test('canonical source configs are authoritative over legacy home compatibility fields', () => {
  const makeState = () => ({
    sourceKind: 'codex',
    sourceConfigs: {
      codex: { home: path.resolve('/initial-codex') },
      'claude-code': { home: path.resolve('/initial-claude') },
    },
    sourceRevision: 0,
    index: null,
    projectCache: null,
    buildMs: 0,
    adapter: { buildIndex() {} },
    activeProjectJob: null,
  });

  const canonicalOnly = makeState();
  assert.equal(resolveSourceMutation(canonicalOnly, {
    source: 'codex',
    sourceConfigs: { codex: { home: '/canonical-codex' } },
  }).errors.length, 0);
  assert.equal(canonicalOnly.sourceConfigs.codex.home, path.resolve('/canonical-codex'));

  const missingCanonicalHome = makeState();
  const missingCanonicalHomeResult = resolveSourceMutation(missingCanonicalHome, {
    source: 'codex',
    sourceConfigs: { codex: {} },
    codexHome: '/legacy-must-not-win',
  });
  assert.match(missingCanonicalHomeResult.errors.join('\n'), /codex\.home must be an explicitly provided non-empty string/);
  assert.equal(missingCanonicalHome.sourceConfigs.codex.home, path.resolve('/initial-codex'));

  const emptyCanonicalHome = makeState();
  const emptyCanonicalHomeResult = resolveSourceMutation(emptyCanonicalHome, {
    source: 'codex',
    sourceConfigs: { codex: { home: '   ' } },
  });
  assert.match(emptyCanonicalHomeResult.errors.join('\n'), /codex\.home must be an explicitly provided non-empty string/);
  assert.equal(emptyCanonicalHome.sourceConfigs.codex.home, path.resolve('/initial-codex'));

  const invalidCanonicalHome = makeState();
  const invalidCanonicalHomeResult = resolveSourceMutation(invalidCanonicalHome, {
    source: 'codex',
    sourceConfigs: { codex: { home: 42 } },
  });
  assert.match(invalidCanonicalHomeResult.errors.join('\n'), /codex\.home must be an explicitly provided non-empty string/);
  assert.equal(invalidCanonicalHome.sourceConfigs.codex.home, path.resolve('/initial-codex'));

  const legacyOnly = makeState();
  assert.equal(resolveSourceMutation(legacyOnly, {
    source: 'codex',
    codexHome: '/legacy-codex',
  }).errors.length, 0);
  assert.equal(legacyOnly.sourceConfigs.codex.home, path.resolve('/legacy-codex'));

  const equal = makeState();
  assert.equal(resolveSourceMutation(equal, {
    source: 'codex',
    sourceConfigs: { codex: { home: '/same-codex' } },
    codexHome: '/same-codex',
  }).errors.length, 0);
  assert.equal(equal.sourceConfigs.codex.home, path.resolve('/same-codex'));

  const conflicting = makeState();
  assert.equal(resolveSourceMutation(conflicting, {
    source: 'codex',
    sourceConfigs: { codex: { home: '/canonical-codex' } },
    codexHome: '/legacy-codex',
  }).errors.length, 0);
  assert.equal(conflicting.sourceConfigs.codex.home, path.resolve('/canonical-codex'));
});

test('runtime initialization keeps canonical source configs authoritative and rejects malformed entries', async (t) => {
  const canonicalHome = path.join(os.tmpdir(), 'session-analyzer-initial-canonical-codex');
  const legacyHome = path.join(os.tmpdir(), 'session-analyzer-initial-legacy-codex');
  const conflictingActiveHome = path.join(os.tmpdir(), 'session-analyzer-initial-conflicting-active');
  const base = await startServer(t, {
    source: 'codex',
    sourceConfigs: { codex: { home: canonicalHome } },
    codexHome: legacyHome,
    sourceHome: conflictingActiveHome,
  });

  const state = await requestJson(base, '/api/state');
  assert.equal(state.status, 409);
  assert.equal(state.json.details.sourceHome, path.resolve(canonicalHome));
  assert.equal(state.json.details.sourceConfigs.codex.home, path.resolve(canonicalHome));
  assert.equal(state.json.details.codexHome, path.resolve(canonicalHome));

  const initialIndex = await getSourceAdapter('codex').buildIndex({
    repoRoot: codexFixtureRepo,
    sourceHome: codexFixtureHome,
  });
  initialIndex.sourceConfigs = { codex: { home: canonicalHome } };
  const initialIndexServer = createServer(initialIndex, 0, {
    codexHome: legacyHome,
    sourceHome: conflictingActiveHome,
  });
  await new Promise((resolve) => initialIndexServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    initialIndexServer.close((error) => (error ? reject(error) : resolve()));
  }));
  const initialState = await requestJson(
    `http://127.0.0.1:${initialIndexServer.address().port}`,
    '/api/state',
  );
  assert.equal(initialState.status, 200);
  assert.equal(initialState.json.sourceHome, path.resolve(canonicalHome));
  assert.equal(initialState.json.sourceConfigs.codex.home, path.resolve(canonicalHome));

  for (const sourceConfigs of [
    { codex: {} },
    { codex: { home: '' } },
    { codex: 'legacy-shaped-string' },
  ]) {
    assert.throws(
      () => createServer(null, 0, { source: 'codex', sourceConfigs, codexHome: legacyHome }),
      { code: 'INVALID_SOURCE_CONFIG' },
    );
  }
  assert.throws(
    () => createServer(null, 0, {
      source: 'codex',
      sourceConfigs: {
        codex: { home: canonicalHome },
        mystery: { home: path.join(os.tmpdir(), 'session-analyzer-unknown-home') },
      },
      codexHome: legacyHome,
    }),
    { code: 'UNSUPPORTED_SOURCE_CONFIG' },
  );
});

test('canonical source ownership dispatch fails closed instead of defaulting to Codex', () => {
  assert.throws(
    () => queryForIndex({}),
    { code: 'MISSING_SOURCE_OWNERSHIP' },
  );
  assert.throws(
    () => adapterForSession({ id: 'missing-source' }),
    { code: 'MISSING_SOURCE_OWNERSHIP' },
  );
  assert.throws(
    () => validateIndexOwnership({ sourceKind: 'claude-code', sessions: [{ id: 'wrong', sourceKind: 'codex' }] }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
  const rightSession = {
    id: 'right',
    sourceKind: 'claude-code',
    rawEvents: [],
    logicalEvents: [],
    counts: { messages: 0, toolCalls: 0, failedCommands: 0 },
  };
  assert.equal(
    validateIndexOwnership(strictClaudeIndexFromComplete({
      sourceKind: 'claude-code',
      repoRoot: '/repo',
      sessions: [rightSession],
      sessionsById: new Map([[rightSession.id, rightSession]]),
    })),
    'claude-code',
  );
  const unownedReachableSession = { id: 'reachable-without-source' };
  assert.throws(
    () => validateIndexOwnership({
      sourceKind: 'claude-code',
      sessionsById: new Map([[unownedReachableSession.id, unownedReachableSession]]),
      get sessions() {
        throw new Error('sessions getter must not be invoked for ownership validation');
      },
    }),
    { code: 'MISSING_SOURCE_OWNERSHIP' },
  );
  const validMapSession = {
    id: 'valid-map-session',
    sourceKind: 'claude-code',
    rawEvents: [],
    logicalEvents: [],
    counts: { messages: 0, toolCalls: 0, failedCommands: 0 },
  };
  const invalidArraySession = { id: 'invalid-array-session', sourceKind: 'codex' };
  const mixedIndex = strictClaudeIndexFromComplete({
    sourceKind: 'claude-code',
    repoRoot: '/repo',
    sessions: [validMapSession],
    sessionsById: new Map([[validMapSession.id, validMapSession]]),
  });
  mixedIndex.sessions = [mixedIndex.sessions[0], invalidArraySession];
  assert.throws(
    () => validateIndexOwnership(mixedIndex),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('an adapter index without canonical ownership is rejected before runtime commit', async (t) => {
  const base = await startServer(t, {
    source: 'codex',
    codexHome: codexFixtureHome,
    buildIndex: async ({ repoRoot }) => ({ repoRoot, sessions: [] }),
  });
  const started = await requestJson(base, '/api/project', jsonRequestOptions({ repoRoot: codexFixtureRepo }));
  assert.equal(started.status, 202);
  const job = await waitForJob(base, started.json.job.id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /Missing source ownership on index/);
  assert.equal((await requestJson(base, '/api/state')).status, 409);
});

test('an adapter index with accessor-backed sessions is rejected before runtime commit', async (t) => {
  const base = await startServer(t, {
    source: 'codex',
    codexHome: codexFixtureHome,
    buildIndex: async ({ repoRoot, sourceKind }) => {
      const index = {
        repoRoot,
        sourceKind,
        sessionsById: new Map(),
      };
      Object.defineProperty(index, 'sessions', {
        configurable: true,
        get() {
          throw new Error('adapter sessions getter must not be invoked');
        },
      });
      return index;
    },
  });
  const started = await requestJson(base, '/api/project', jsonRequestOptions({ repoRoot: codexFixtureRepo }));
  assert.equal(started.status, 202);
  const job = await waitForJob(base, started.json.job.id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /Canonical index\.sessions must be a data-property array/);
  assert.equal((await requestJson(base, '/api/state')).status, 409);
});

test('an adapter index owned by another source is rejected before runtime commit', async (t) => {
  const fixture = await makeClaudeFixture(t);
  const base = await startServer(t, {
    source: 'claude-code',
    claudeHome: fixture.claudeHome,
    buildIndex: async ({ repoRoot, sourceKind }) => {
      assert.equal(sourceKind, 'claude-code');
      return {
        repoRoot,
        sourceKind: 'codex',
        sessions: [],
        sessionsById: new Map(),
      };
    },
  });
  const started = await requestJson(base, '/api/project', jsonRequestOptions({ repoRoot: fixture.repoRoot }));
  assert.equal(started.status, 202);
  const job = await waitForJob(base, started.json.job.id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /Source ownership mismatch: job claude-code, index codex/);
  const state = await requestJson(base, '/api/state');
  assert.equal(state.status, 409);
  assert.equal(state.json.details.sourceKind, 'claude-code');
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
    sourceConfigs: {
      codex: { home: path.resolve('/codex-home') },
      'claude-code': { home: path.resolve('/claude-home') },
    },
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
    sourceConfigs: {
      codex: { home: path.resolve('/codex-home') },
      'claude-code': { home: path.resolve('/claude-home') },
    },
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
