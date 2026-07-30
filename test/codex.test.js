'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildIndex, buildEventDetail, decodeImagePreviewDataUrl, discoverConfiguredProjects, discoverProjects, fileSuggestions, filterSessions, getTimeline, matchTerms, readImagePreview, readRawLine, isPathInsideOrSame } = require('../src/codex');
const { createServer, parseArgs, resolveStaticAssetPath } = require('../server');
const { DISPLAY_STATES, EDITABLE_EVENT_KINDS, foldingProfiles } = require('../src/folding');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';
const repoRoot = path.join(__dirname, '..');

async function buildFixtureIndex() {
  return buildIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
  });
}

function primaryFixtureSession(index) {
  return index.sessionsById.get(primaryFixtureSessionId);
}

function allSections(detail) {
  return [...(detail.timelineSections || []), ...(detail.inspectorSections || [])];
}

async function makeTempCodexHome(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeFixtureTranscript(codexHome, cwd, id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') {
  const dir = path.join(codexHome, 'sessions', '2026', '05', '25');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-05-25T10-00-00-${id}.jsonl`);
  await fsp.writeFile(file, `${JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-05-25T10:00:00.000Z',
    payload: { id, cwd },
  })}\n`, 'utf8');
  return file;
}

test('parseArgs leaves repo unset unless --repo is provided', () => {
  assert.equal(parseArgs(['node', 'server.js']).repo, null);
  assert.equal(parseArgs(['node', 'server.js', '--repo', 'G:\\vibe\\term-agent']).repo, 'G:\\vibe\\term-agent');
});

test('parseArgs accepts limited typo aliases for common options', () => {
  assert.equal(parseArgs(['node', 'server.js', '--repos', 'G:\\vibe\\term-agent']).repo, 'G:\\vibe\\term-agent');
  assert.equal(parseArgs(['node', 'server.js', '--repo-root', 'G:\\vibe\\term-agent']).repo, 'G:\\vibe\\term-agent');
  assert.equal(parseArgs(['node', 'server.js', '--codexhome', 'G:\\codex']).codexHome, 'G:\\codex');
  assert.equal(parseArgs(['node', 'server.js', '--codex_home', 'G:\\codex']).codexHome, 'G:\\codex');
  assert.equal(parseArgs(['node', 'server.js', '--host-name', '0.0.0.0']).host, '0.0.0.0');
});

test('parseArgs rejects unknown flags and positional arguments', () => {
  assert.deepEqual(
    parseArgs(['node', 'server.js', '--codex-hmoe', 'G:\\codex']).errors,
    ['Unknown option: --codex-hmoe.'],
  );
  assert.deepEqual(
    parseArgs(['node', 'server.js', 'G:\\vibe\\term-agent']).errors,
    ['Unexpected positional argument: G:\\vibe\\term-agent. Use --repo <repo-path> to choose a repository.'],
  );
  assert.deepEqual(
    parseArgs(['node', 'server.js', '--repo', '--port', '9000']).errors,
    ['Missing value for --repo. Expected a repository path.'],
  );
  assert.equal(parseArgs(['node', 'server.js', '--repo', '--port', '9000']).port, 9000);
  assert.deepEqual(
    parseArgs(['node', 'server.js', '--repo', '-h']).errors,
    ['Missing value for --repo. Expected a repository path.'],
  );
  assert.deepEqual(
    parseArgs(['node', 'server.js', '--codex-home']).errors,
    ['Missing value for --codex-home. Expected a Codex home path.'],
  );
});

test('parseArgs validates explicit port values', () => {
  assert.equal(parseArgs(['node', 'server.js', '--port', '3000']).port, 3000);

  const invalidCases = [
    { argv: ['node', 'server.js', '--port'], error: 'Missing value for --port. Expected an integer between 1 and 65535.' },
    { argv: ['node', 'server.js', '--port', ''], error: 'Missing value for --port. Expected an integer between 1 and 65535.' },
    { argv: ['node', 'server.js', '--port', '   '], error: 'Missing value for --port. Expected an integer between 1 and 65535.' },
    { argv: ['node', 'server.js', '--port', 'NaN'], error: 'Invalid value for --port: "NaN". Expected an integer between 1 and 65535.' },
    { argv: ['node', 'server.js', '--port', '1.5'], error: 'Invalid value for --port: "1.5". Expected an integer between 1 and 65535.' },
    { argv: ['node', 'server.js', '--port', '0'], error: 'Invalid value for --port: "0". Expected an integer between 1 and 65535.' },
    { argv: ['node', 'server.js', '--port', '-1'], error: 'Invalid value for --port: "-1". Expected an integer between 1 and 65535.' },
    { argv: ['node', 'server.js', '--port', '65536'], error: 'Invalid value for --port: "65536". Expected an integer between 1 and 65535.' },
  ];

  for (const { argv, error } of invalidCases) {
    assert.deepEqual(parseArgs(argv).errors, [error]);
  }
});

test('parseArgs validates host values', () => {
  assert.equal(parseArgs(['node', 'server.js', '--host', '0.0.0.0']).host, '0.0.0.0');
  assert.deepEqual(
    parseArgs(['node', 'server.js', '--host']).errors,
    ['Missing value for --host. Expected a non-empty host name or IP address.'],
  );
  assert.deepEqual(
    parseArgs(['node', 'server.js', '--host', '']).errors,
    ['Missing value for --host. Expected a non-empty host name or IP address.'],
  );
  assert.deepEqual(
    parseArgs(['node', 'server.js', '--host', '   ']).errors,
    ['Missing value for --host. Expected a non-empty host name or IP address.'],
  );
  const opts = parseArgs(['node', 'server.js', '--host', '--port', '9000']);
  assert.deepEqual(opts.errors, ['Missing value for --host. Expected a non-empty host name or IP address.']);
  assert.equal(opts.port, 9000);
});

test('CLI exits early with usage when argument validation fails', () => {
  const result = childProcess.spawnSync(process.execPath, ['server.js', '--port', '0'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Invalid value for --port: "0"\. Expected an integer between 1 and 65535\./);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.stdout, /Codex Session Analyzer: http:\/\//);
});

test('CLI exits early with usage when an unknown option is provided', () => {
  const result = childProcess.spawnSync(process.execPath, ['server.js', '--codex-hmoe', fixtureCodexHome], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Unknown option: --codex-hmoe\./);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.stdout, /Codex Session Analyzer: http:\/\//);
});

test('discoverProjects groups Codex sessions by cwd', async () => {
  const projects = await discoverProjects({ codexHome: fixtureCodexHome });
  const byRoot = new Map(projects.map((project) => [project.repoRoot, project]));

  assert.equal(byRoot.get('G:\\vibe\\term-agent').sessionCount, 10);
  assert.equal(byRoot.get('G:\\other\\repo').sessionCount, 3);
  assert.equal(typeof byRoot.get('G:\\vibe\\term-agent').exists, 'boolean');
});

test('discoverConfiguredProjects reads Codex config project headers', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const projectA = path.join(codexHome, 'project-a');
  const projectB = path.join(codexHome, 'project-b');
  const missing = path.join(codexHome, 'missing-project');
  await fsp.mkdir(projectA, { recursive: true });
  await fsp.mkdir(projectB, { recursive: true });

  await fsp.writeFile(path.join(codexHome, 'config.toml'), [
    `[projects.'${projectA}']`,
    `[projects.'\\\\?\\${projectA}'] # duplicate with Windows extended prefix`,
    `[projects."${projectB.replace(/\\/g, '\\\\')}"]`,
    `[projects.'${missing}']`,
    '[not_projects.\'ignored\']',
    '',
  ].join('\n'), 'utf8');

  const projects = await discoverConfiguredProjects({ codexHome });
  const byRoot = new Map(projects.map((project) => [project.repoRoot, project]));

  assert.equal(projects.length, 3);
  assert.equal(byRoot.get(path.resolve(projectA)).exists, true);
  assert.equal(byRoot.get(path.resolve(projectB)).exists, true);
  assert.equal(byRoot.get(path.resolve(missing)).exists, false);
  assert.equal(byRoot.get(path.resolve(projectA)).statsPending, true);
  assert.equal(byRoot.get(path.resolve(projectA)).sessionCount, null);
});

test('discoverConfiguredProjects returns empty list when config is absent', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  assert.deepEqual(await discoverConfiguredProjects({ codexHome }), []);
});

test('buildIndex exposes dynamic event kind options by layer', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const mainKinds = new Set(index.eventKinds.main.map((item) => item.value));
  const protocolKinds = new Set(index.eventKinds.protocol.map((item) => item.value));
  const rawKinds = new Set(index.eventKinds.raw.map((item) => item.value));
  const sessionMainKinds = new Set(session.eventKinds.main.map((item) => item.value));

  assert.ok(mainKinds.has('review'));
  assert.ok(mainKinds.has('plan_update'));
  assert.ok(mainKinds.has('warning'));
  assert.equal(mainKinds.has('turn'), false);
  assert.ok(protocolKinds.has('session_meta'));
  assert.ok(protocolKinds.has('task_started'));
  assert.ok(protocolKinds.has('task_complete'));
  assert.ok(rawKinds.has('exec_command_begin'));
  assert.ok(index.eventKinds.main.find((item) => item.value === 'review').label);
  assert.ok(index.eventKinds.raw.find((item) => item.value === 'exec_command_begin').count > 0);
  assert.ok(sessionMainKinds.has('review'));
  assert.ok(session.eventKinds.raw.find((item) => item.value === 'exec_command_begin').count > 0);
});

test('thread and unmodeled item lifecycle records stay in protocol layer', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'lifecycle-project');
  const id = '12121212-1212-1212-1212-121212121212';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '05');
  const file = path.join(dir, `rollout-2026-06-05T10-00-00-${id}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(file, [
    JSON.stringify({ timestamp: '2026-06-05T10:00:00.000Z', type: 'session_meta', payload: { id, cwd: repoRoot } }),
    JSON.stringify({ timestamp: '2026-06-05T10:00:01.000Z', type: 'event_msg', payload: { type: 'thread_name_updated', thread_name: 'Renamed session' } }),
    JSON.stringify({ timestamp: '2026-06-05T10:00:02.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'Message', text: 'Internal response item completed.' } } }),
    '',
  ].join('\n'), 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const mainTimeline = getTimeline(index, id, { offset: 0, limit: 100, layer: 'main' });
  const protocolTimeline = getTimeline(index, id, { offset: 0, limit: 100, layer: 'protocol' });
  const protocolSubtypes = new Set(protocolTimeline.events.map((event) => event.subtype));

  assert.equal(mainTimeline.events.some((event) => event.kind === 'turn'), false);
  assert.equal(mainTimeline.events.some((event) => event.subtype === 'thread_name_updated'), false);
  assert.equal(mainTimeline.events.some((event) => event.subtype === 'item_completed'), false);
  assert.ok(protocolSubtypes.has('thread_name_updated'));
  assert.ok(protocolSubtypes.has('item_completed'));
});

test('state endpoint includes dynamic event kind options', async () => {
  const index = await buildFixtureIndex();
  const server = createServer(index, 1, { codexHome: fixtureCodexHome });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.eventKinds.main.some((item) => item.value === 'review'));
    assert.ok(body.eventKinds.protocol.some((item) => item.value === 'session_meta'));
    assert.ok(body.eventKinds.raw.some((item) => item.value === 'exec_command_begin'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('resolveStaticAssetPath rejects sibling-prefix paths outside the public root', () => {
  const publicRoot = path.join('G:\\vibe\\session-analyzer', 'public');
  assert.equal(resolveStaticAssetPath(publicRoot, '/index.html'), path.join(publicRoot, 'index.html'));
  assert.equal(resolveStaticAssetPath(publicRoot, '/../public-evil/secret.txt'), '');
});

test('server hides 500 stack details by default but preserves thrown 4xx status codes', async () => {
  const stackError = new Error('Exploded while listing sessions');
  stackError.stack = `Error: ${stackError.message}\n    at G:\\vibe\\session-analyzer\\src\\boom.js:7:9`;
  const errorIndex = {
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
    sessionsById: new Map(),
    get sessions() {
      throw stackError;
    },
  };
  const server = createServer(errorIndex, 1, { codexHome: fixtureCodexHome });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/sessions`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Internal server error');
    assert.equal(body.details, undefined);
    assert.doesNotMatch(JSON.stringify(body), /boom\.js|Exploded while listing sessions/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  const notFoundError = new Error('Custom missing session');
  notFoundError.statusCode = 404;
  const notFoundIndex = {
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
    sessionsById: new Map(),
    get sessions() {
      throw notFoundError;
    },
  };
  const notFoundServer = createServer(notFoundIndex, 1, { codexHome: fixtureCodexHome });
  await new Promise((resolve) => notFoundServer.listen(0, '127.0.0.1', resolve));
  const notFoundAddress = notFoundServer.address();
  try {
    const res = await fetch(`http://127.0.0.1:${notFoundAddress.port}/api/sessions`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Custom missing session');
    assert.equal(body.details, undefined);
  } finally {
    await new Promise((resolve, reject) => notFoundServer.close((error) => (error ? reject(error) : resolve())));
  }

  const internalStatusError = new Error('Internal path G:\\vibe\\session-analyzer\\src\\internal.js');
  internalStatusError.statusCode = 500;
  const internalStatusIndex = {
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
    sessionsById: new Map(),
    get sessions() {
      throw internalStatusError;
    },
  };
  const internalStatusServer = createServer(internalStatusIndex, 1, { codexHome: fixtureCodexHome });
  await new Promise((resolve) => internalStatusServer.listen(0, '127.0.0.1', resolve));
  const internalStatusAddress = internalStatusServer.address();
  try {
    const res = await fetch(`http://127.0.0.1:${internalStatusAddress.port}/api/sessions`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Internal server error');
    assert.equal(body.details, undefined);
    assert.doesNotMatch(JSON.stringify(body), /internal\.js|Internal path/);
  } finally {
    await new Promise((resolve, reject) => internalStatusServer.close((error) => (error ? reject(error) : resolve())));
  }
});

test('server exposes 500 stack details only when debug mode is explicitly enabled', async () => {
  const stackError = new Error('Debug trace enabled');
  stackError.stack = `Error: ${stackError.message}\n    at G:\\vibe\\session-analyzer\\src\\debug.js:4:2`;
  const debugIndex = {
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
    sessionsById: new Map(),
    get sessions() {
      throw stackError;
    },
  };
  const server = createServer(debugIndex, 1, { codexHome: fixtureCodexHome, debugErrors: true });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const res = await fetch(`http://127.0.0.1:${address.port}/api/sessions`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Internal server error');
    assert.match(String(body.details || ''), /debug\.js:4:2/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('buildIndex deduplicates mirrored messages and keeps protocol separately', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  assert.equal(index.totals.fileCount, 11);
  assert.equal(index.totals.candidateFileCount, 10);
  assert.equal(index.totals.indexedFileCount, 10);
  assert.equal(index.totals.skippedFileCount, 1);
  assert.equal(index.totals.unknownFileCount, 0);
  assert.equal(index.totals.sessionCount, 10);
  assert.equal(session.id, '11111111-1111-1111-1111-111111111111');
  assert.equal(session.title, 'fixture repo session');
  assert.equal(Object.hasOwn(session, 'searchText'), false);
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.assistantMessages, 1);
  assert.equal(session.counts.messages, 2);
  assert.equal(session.counts.reasoning, 1);
  assert.equal(session.counts.failedCommands, 1);
  assert.equal(session.counts.issueEvents, 11);
  assert.equal(session.counts.patches, 6);
  assert.equal(session.counts.compactions, 1);
  assert.equal(session.counts.planArtifacts, 1);
  assert.equal(session.counts.planEvents, 4);
  assert.ok(session.counts.protocol >= 3);
});

test('buildIndex keeps files whose later metadata cwd matches the repo', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessionsById.get('99999999-9999-9999-9999-999999999999');
  const afterWindowSession = index.sessionsById.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

  assert.ok(session);
  assert.equal(session.title, 'late matching cwd fixture');
  assert.equal(session.matchesRepo, true);
  assert.deepEqual([...session.cwdSet].sort(), ['G:\\other\\repo', 'G:\\vibe\\term-agent'].sort());
  assert.ok(afterWindowSession);
  assert.equal(afterWindowSession.title, 'late matching cwd after scan window fixture');
  assert.equal(afterWindowSession.matchesRepo, true);
  assert.deepEqual([...afterWindowSession.cwdSet].sort(), ['G:\\other\\repo', 'G:\\vibe\\term-agent'].sort());
});

test('buildIndex excludes no-cwd files from candidates while tracking them as unknown', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '06', '18');
  const file = path.join(sessionDir, 'rollout-2026-06-18T10-00-00-ffffffff-ffff-ffff-ffff-ffffffffffff.jsonl');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(file, [
    JSON.stringify({ timestamp: '2026-06-18T10:00:00.000Z', type: 'session_meta', payload: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' } }),
    JSON.stringify({ timestamp: '2026-06-18T10:00:01.000Z', type: 'event_msg', payload: { type: 'thread_name_updated', thread_name: 'no cwd fixture' } }),
    '',
  ].join('\n'), 'utf8');

  const progress = [];
  const index = await buildIndex({
    repoRoot,
    codexHome,
    onProgress: (entry) => progress.push(entry),
  });

  assert.equal(index.totals.fileCount, 1);
  assert.equal(index.totals.unknownFileCount, 1);
  assert.equal(index.totals.candidateFileCount, 0);
  assert.equal(index.totals.indexedFileCount, 0);
  assert.equal(index.totals.sessionCount, 0);
  assert.equal(index.sessions.length, 0);
  const selecting = progress.filter((entry) => entry.phase === 'selecting').at(-1);
  const complete = progress.filter((entry) => entry.phase === 'complete').at(-1);
  assert.equal(selecting.filesScanned, 1);
  assert.equal(selecting.unknownFileCount, 1);
  assert.equal(selecting.candidateFileCount, 0);
  assert.equal(complete.unknownFileCount, 1);
  assert.equal(complete.candidateFileCount, 0);
  assert.equal(complete.indexedFileCount, 0);
});

test('buildIndex reports progress and supports cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    buildIndex({
      repoRoot: 'G:\\vibe\\term-agent',
      codexHome: fixtureCodexHome,
      signal: controller.signal,
      onProgress: () => {},
    }),
    { name: 'AbortError' },
  );

  const phases = [];
  await buildIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: fixtureCodexHome,
    onProgress: (progress) => phases.push(progress.phase),
  });
  assert.ok(phases.includes('selecting'));
  assert.ok(phases.includes('parsing'));
  assert.equal(phases.at(-1), 'complete');
});

test('buildIndex reuses unchanged session payloads while reparsing changed transcripts', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const projectRoot = path.join(codexHome, 'reuse-project');
  const unchangedId = '10101010-1010-1010-1010-101010101010';
  const changedId = '20202020-2020-2020-2020-202020202020';
  await fsp.mkdir(projectRoot, { recursive: true });
  await writeFixtureTranscript(codexHome, projectRoot, unchangedId);
  const changedFile = await writeFixtureTranscript(codexHome, projectRoot, changedId);
  const first = await buildIndex({ repoRoot: projectRoot, codexHome });

  await fsp.appendFile(changedFile, `${JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-05-25T10:01:00.000Z',
    payload: { type: 'warning', message: 'changed transcript' },
  })}\n`, 'utf8');
  const progress = [];
  const second = await buildIndex({
    repoRoot: projectRoot,
    codexHome,
    previousIndex: first,
    onProgress: (entry) => progress.push(entry),
  });

  const oldUnchanged = first.sessionsById.get(unchangedId);
  const newUnchanged = second.sessionsById.get(unchangedId);
  const oldChanged = first.sessionsById.get(changedId);
  const newChanged = second.sessionsById.get(changedId);
  assert.notEqual(newUnchanged, oldUnchanged, 'reused top-level metadata must remain commit-isolated');
  assert.equal(newUnchanged.rawEvents, oldUnchanged.rawEvents, 'unchanged heavy event payload should be shared');
  assert.notEqual(newChanged.rawEvents, oldChanged.rawEvents, 'changed transcripts must be reparsed');
  assert.equal(newChanged.rawEvents.length, oldChanged.rawEvents.length + 1);
  assert.equal(second.totals.reusedFileCount, 1);
  assert.equal(progress.at(-1).reusedFileCount, 1);
});

test('buildIndex ignores an incomplete previous-index placeholder', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const projectRoot = path.join(codexHome, 'placeholder-project');
  const id = '21212121-2121-2121-2121-212121212121';
  await fsp.mkdir(projectRoot, { recursive: true });
  await writeFixtureTranscript(codexHome, projectRoot, id);

  const index = await buildIndex({
    repoRoot: projectRoot,
    codexHome,
    previousIndex: { repoRoot: projectRoot, codexHome },
  });

  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessions[0].id, id);
  assert.equal(index.totals.reusedFileCount, 0);
});

test('buildIndex re-stats a transcript before reuse when it grows after selecting', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const projectRoot = path.join(codexHome, 'concurrent-append-project');
  const id = '30303030-3030-3030-3030-303030303030';
  await fsp.mkdir(projectRoot, { recursive: true });
  const file = await writeFixtureTranscript(codexHome, projectRoot, id);
  const first = await buildIndex({ repoRoot: projectRoot, codexHome });
  let appended = false;

  const second = await buildIndex({
    repoRoot: projectRoot,
    codexHome,
    previousIndex: first,
    onProgress: (entry) => {
      if (appended || entry.phase !== 'parsing' || entry.indexedFileCount !== 0) return;
      appended = true;
      fs.appendFileSync(file, `${JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-05-25T10:01:00.000Z',
        payload: { type: 'warning', message: 'appended after selecting' },
      })}\n`, 'utf8');
    },
  });

  assert.equal(appended, true);
  assert.equal(second.totals.reusedFileCount, 0);
  assert.equal(
    second.sessionsById.get(id).rawEvents.length,
    first.sessionsById.get(id).rawEvents.length + 1,
  );
});

test('buildIndex refreshes reused session title, updatedAt, and ordering from session index', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const projectRoot = path.join(codexHome, 'session-index-refresh-project');
  const refreshedId = '40404040-4040-4040-4040-404040404040';
  const otherId = '50505050-5050-5050-5050-505050505050';
  await fsp.mkdir(projectRoot, { recursive: true });
  await writeFixtureTranscript(codexHome, projectRoot, refreshedId);
  const otherFile = await writeFixtureTranscript(codexHome, projectRoot, otherId);
  await fsp.appendFile(otherFile, `${JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-05-25T11:00:00.000Z',
    payload: { type: 'warning', message: 'initially newer session' },
  })}\n`, 'utf8');
  const first = await buildIndex({ repoRoot: projectRoot, codexHome });
  const sessionIndexPath = path.join(codexHome, 'session_index.jsonl');
  await fsp.writeFile(sessionIndexPath, `${JSON.stringify({
    id: refreshedId,
    thread_name: 'Renamed reused session',
    updated_at: '2026-05-25T12:00:00.000Z',
  })}\n`, 'utf8');

  const second = await buildIndex({ repoRoot: projectRoot, codexHome, previousIndex: first });
  const oldSession = first.sessionsById.get(refreshedId);
  const refreshedSession = second.sessionsById.get(refreshedId);
  assert.equal(refreshedSession.rawEvents, oldSession.rawEvents);
  assert.equal(refreshedSession.title, 'Renamed reused session');
  assert.equal(refreshedSession.updatedAt, '2026-05-25T12:00:00.000Z');
  assert.equal(second.sessions[0].id, refreshedId);
  assert.equal(second.totals.reusedFileCount, 2);

  await fsp.writeFile(sessionIndexPath, '', 'utf8');
  const withoutIndexEntry = await buildIndex({
    repoRoot: projectRoot,
    codexHome,
    previousIndex: second,
  });
  const restoredSession = withoutIndexEntry.sessionsById.get(refreshedId);
  assert.equal(restoredSession.rawEvents, refreshedSession.rawEvents);
  assert.equal(restoredSession.title, restoredSession.transcriptTitle);
  assert.equal(restoredSession.updatedAt, '2026-05-25T10:00:00.000Z');
  assert.equal(withoutIndexEntry.sessions[0].id, otherId);

  await fsp.writeFile(sessionIndexPath, `${JSON.stringify({
    id: refreshedId,
    thread_name: 'Earlier index timestamp',
    updated_at: '2026-05-25T10:30:00.000Z',
  })}\n`, 'utf8');
  const earlierIndexEntry = await buildIndex({
    repoRoot: projectRoot,
    codexHome,
    previousIndex: second,
  });
  const movedBackwardSession = earlierIndexEntry.sessionsById.get(refreshedId);
  assert.equal(movedBackwardSession.rawEvents, refreshedSession.rawEvents);
  assert.equal(movedBackwardSession.title, 'Earlier index timestamp');
  assert.equal(movedBackwardSession.updatedAt, '2026-05-25T10:30:00.000Z');
  assert.equal(earlierIndexEntry.sessions[0].id, otherId);
});

test('buildIndex keeps forked subagent identity separate from embedded parent metadata', async () => {
  const index = await buildFixtureIndex();
  const parent = index.sessions.find((session) => session.id === '11111111-1111-1111-1111-111111111111');
  const child = index.sessions.find((session) => session.id === '33333333-3333-3333-3333-333333333333');
  const review = index.sessions.find((session) => session.id === '55555555-5555-5555-5555-555555555555');
  const reviewWithoutParent = index.sessions.find((session) => session.id === '66666666-6666-6666-6666-666666666666');
  const ambiguousReview = index.sessions.find((session) => session.id === '88888888-8888-8888-8888-888888888888');
  const normalFork = index.sessions.find((session) => session.id === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

  assert.ok(parent);
  assert.ok(child);
  assert.ok(review);
  assert.ok(reviewWithoutParent);
  assert.ok(ambiguousReview);
  assert.ok(normalFork);
  assert.equal(child.parentSessionId, parent.id);
  assert.equal(child.forkedFromSessionId, parent.id);
  assert.equal(child.agentNickname, 'Fixture');
  assert.equal(child.title, 'Subagent Fixture: Check the fixture subagent path');
  assert.equal(review.parentSessionId, parent.id);
  assert.equal(review.forkedFromSessionId, parent.id);
  assert.equal(review.agentNickname, 'Review');
  assert.equal(review.title, 'Review session: Review Fixture: verify derived review session styling metadata');
  assert.equal(reviewWithoutParent.parentSessionId, parent.id);
  assert.equal(reviewWithoutParent.parentSessionInferred, true);
  assert.equal(reviewWithoutParent.title, 'Review session: Review the fixture code changes and provide prioritized findings.');
  assert.equal(ambiguousReview.parentSessionId, '');
  assert.equal(ambiguousReview.parentSessionInferred, false);
  assert.equal(normalFork.parentSessionId, '');
  assert.equal(normalFork.parentSessionInferred, false);
  assert.equal(normalFork.forkedFromSessionId, parent.id);
  assert.equal(normalFork.title, 'Normal fork fixture should stay primary');
  assert.equal(index.sessionsById.get(parent.id), parent);
  assert.equal(index.sessionsById.get(child.id), child);
  assert.equal(index.sessionsById.get(review.id), review);
  assert.equal(index.sessionsById.get(reviewWithoutParent.id), reviewWithoutParent);
  assert.equal(index.sessionsById.get(normalFork.id), normalFork);
  assert.ok(child.rawEvents.every((raw) => raw.sessionId === child.id));
  assert.ok(child.logicalEvents.every((event) => event.id.startsWith(`${child.id}:logical:`)));

  const summaries = filterSessions(index, { q: '', sort: 'updated-desc', layer: 'main' }).sessions;
  const childSummary = summaries.find((session) => session.id === child.id);
  const reviewSummary = summaries.find((session) => session.id === review.id);
  const reviewWithoutParentSummary = summaries.find((session) => session.id === reviewWithoutParent.id);
  const ambiguousReviewSummary = summaries.find((session) => session.id === ambiguousReview.id);
  const normalForkSummary = summaries.find((session) => session.id === normalFork.id);
  assert.equal(childSummary.parentSessionId, parent.id);
  assert.equal(childSummary.parentSessionTitle, parent.title);
  assert.equal(childSummary.forkedFromSessionId, parent.id);
  assert.equal(childSummary.forkedFromSessionTitle, parent.title);
  assert.equal(childSummary.agentNickname, 'Fixture');
  assert.equal(childSummary.isDerivedSession, true);
  assert.equal(childSummary.derivedKind, 'subagent');
  assert.equal(reviewSummary.parentSessionId, parent.id);
  assert.equal(reviewSummary.parentSessionTitle, parent.title);
  assert.equal(reviewSummary.forkedFromSessionId, parent.id);
  assert.equal(reviewSummary.forkedFromSessionTitle, parent.title);
  assert.equal(reviewSummary.agentNickname, 'Review');
  assert.equal(reviewSummary.isDerivedSession, true);
  assert.equal(reviewSummary.derivedKind, 'review');
  assert.equal(reviewWithoutParentSummary.parentSessionId, parent.id);
  assert.equal(reviewWithoutParentSummary.parentSessionInferred, true);
  assert.equal(reviewWithoutParentSummary.parentSessionTitle, parent.title);
  assert.equal(reviewWithoutParentSummary.isDerivedSession, true);
  assert.equal(reviewWithoutParentSummary.derivedKind, 'review');
  assert.equal(ambiguousReviewSummary.parentSessionId, '');
  assert.equal(ambiguousReviewSummary.parentSessionInferred, false);
  assert.equal(ambiguousReviewSummary.parentSessionTitle, '');
  assert.equal(ambiguousReviewSummary.isDerivedSession, true);
  assert.equal(ambiguousReviewSummary.derivedKind, 'review');
  assert.equal(normalForkSummary.parentSessionId, '');
  assert.equal(normalForkSummary.parentSessionInferred, false);
  assert.equal(normalForkSummary.parentSessionTitle, '');
  assert.equal(normalForkSummary.forkedFromSessionId, parent.id);
  assert.equal(normalForkSummary.forkedFromSessionTitle, parent.title);
  assert.equal(normalForkSummary.isDerivedSession, false);
  assert.equal(normalForkSummary.derivedKind, '');

  const childTimeline = getTimeline(index, child.id, {
    q: '',
    offset: 0,
    limit: 20,
    layer: 'main',
  });
  const normalForkTimeline = getTimeline(index, normalFork.id, {
    q: '',
    offset: 0,
    limit: 20,
    layer: 'main',
  });
  assert.equal(childTimeline.session.parentSessionTitle, parent.title);
  assert.equal(childTimeline.session.forkedFromSessionTitle, parent.title);
  assert.equal(normalForkTimeline.session.parentSessionTitle, '');
  assert.equal(normalForkTimeline.session.forkedFromSessionTitle, parent.title);
});

test('buildIndex correlates subagent activity only to a same-session coordination owner', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const fixtureRepoRoot = path.join(codexHome, 'repo');
  const ownerSessionId = 'aaaaaaaa-7777-4444-9999-aaaaaaaaaaaa';
  const replicaSessionId = 'bbbbbbbb-7777-4444-9999-bbbbbbbbbbbb';
  const ownerFile = await writeFixtureTranscript(codexHome, fixtureRepoRoot, ownerSessionId);
  const replicaFile = await writeFixtureTranscript(codexHome, fixtureRepoRoot, replicaSessionId);
  const eventId = 'coordination-call-fixture';
  const observationPayload = {
    type: 'sub_agent_activity',
    event_id: eventId,
    agent_thread_id: 'agent-thread-fixture',
    agent_path: '/root/fixture-agent',
    kind: 'started',
    occurred_at_ms: 1785405660000,
  };

  await fsp.appendFile(ownerFile, [
    {
      type: 'event_msg',
      timestamp: '2026-07-30T10:01:00.000Z',
      payload: observationPayload,
    },
    {
      type: 'response_item',
      timestamp: '2026-07-30T10:01:01.000Z',
      payload: {
        type: 'function_call',
        name: 'spawn_agent',
        call_id: eventId,
        arguments: { task_name: 'fixture-agent', message: 'Run the fixture task.' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-07-30T10:01:02.000Z',
      payload: {
        type: 'function_call_output',
        call_id: eventId,
        output: { agent_id: 'agent-thread-fixture' },
      },
    },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  await fsp.appendFile(replicaFile, `${JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-07-30T10:01:03.000Z',
    payload: observationPayload,
  })}\n`, 'utf8');

  const index = await buildIndex({ repoRoot: fixtureRepoRoot, codexHome });
  const ownerSession = index.sessionsById.get(ownerSessionId);
  const replicaSession = index.sessionsById.get(replicaSessionId);
  const coordination = ownerSession.logicalEvents.find((event) => event.toolName === 'spawn_agent');
  const ownerObservationRaw = ownerSession.rawEvents.find((raw) => raw.payloadType === 'sub_agent_activity');
  const replicaObservation = replicaSession.logicalEvents.find((event) => event.subtype === 'sub_agent_activity');

  assert.ok(coordination);
  assert.equal(coordination.kind, 'agent_coordination');
  assert.deepEqual(coordination.rawRefs.map((ref) => ref.sourceEventType), [
    'function_call',
    'function_call_output',
    'sub_agent_activity',
  ]);
  assert.equal(coordination.source.line, 3);
  assert.doesNotMatch(coordination.searchText, /\/root\/fixture-agent|sub_agent_activity/);
  assert.equal(ownerObservationRaw.callId, '');
  assert.equal(ownerSession.logicalEvents.some((event) => event.layer === 'protocol'
    && event.subtype === 'sub_agent_activity'), false);

  assert.ok(replicaObservation);
  assert.equal(replicaObservation.layer, 'protocol');
  assert.deepEqual(replicaObservation.rawRefs.map((ref) => ref.sourceEventType), ['sub_agent_activity']);
  assert.equal(replicaSession.rawEvents.find((raw) => raw.payloadType === 'sub_agent_activity').callId, '');
});

test('buildIndex infers fallback titles from real user tasks after protocol wrappers', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessions.find((item) => item.id === '44444444-4444-4444-4444-444444444444');

  assert.ok(session);
  assert.equal(session.title, 'Repair fallback session titles');
  assert.equal(session.counts.userMessages, 1);

  const mainTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  const shellWrapper = mainTimeline.events.find((event) => event.subtype === 'user_shell_command');
  assert.ok(shellWrapper);
  assert.equal(shellWrapper.kind, 'user_shell_command');
  assert.equal(shellWrapper.label, 'User shell command');
  assert.notEqual(shellWrapper.label, 'Command');
  assert.notEqual(shellWrapper.label, 'User message');
  assert.equal(shellWrapper.preview, 'Get-ChildItem -Force');
  assert.deepEqual(shellWrapper.rawRefs.map((ref) => ref.line), [2]);
  assert.deepEqual(shellWrapper.channels, ['event_msg']);
  assert.ok(mainTimeline.eventKinds.main.some((item) => item.value === 'user_message' && item.count === 1));
  assert.ok(mainTimeline.eventKinds.main.some((item) => item.value === 'user_shell_command' && item.label === 'User shell command' && item.count === 1));
  assert.equal(mainTimeline.eventKinds.protocol.some((item) => item.value === 'user_shell_command'), false);
  assert.deepEqual(mainTimeline.eventKinds, session.eventKinds);

  const protocolTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'protocol',
  });
  assert.equal(protocolTimeline.events.some((event) => event.subtype === 'user_shell_command'), false);
});

test('buildIndex shows response-item-only user shell command wrappers as main events without message counts', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const projectRoot = path.join(codexHome, 'response-item-shell-project');
  const id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '17');
  const file = path.join(dir, `rollout-2026-06-17T16-10-07-${id}.jsonl`);
  const shellText = [
    '<user_shell_command>',
    '<command>',
    'git fetch origin',
    '</command>',
    '<result>',
    'Exit code: 0',
    'Duration: 7.9050 seconds',
    'Output:',
    'From github.com:Yijia-Zhou/session-analyzer',
    ' * [new branch]      main       -> origin/main',
    '',
    '</result>',
    '</user_shell_command>',
  ].join('\n');
  const taskText = 'Repair fallback session titles';
  const records = [
    {
      timestamp: '2026-06-17T08:10:07.000Z',
      type: 'session_meta',
      payload: { id, cwd: projectRoot },
    },
    {
      timestamp: '2026-06-17T08:10:07.100Z',
      type: 'event_msg',
      payload: { type: 'thread_goal_updated', message: 'Goal changed' },
    },
    {
      timestamp: '2026-06-17T08:10:07.200Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: shellText }],
      },
    },
    {
      timestamp: '2026-06-17T08:10:08.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: taskText }],
      },
    },
  ];
  await fsp.mkdir(projectRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot: projectRoot, codexHome });
  const session = index.sessionsById.get(id);
  assert.ok(session);
  assert.equal(session.title, taskText);
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.counts.messages, 1);

  const mainTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  const userEvents = mainTimeline.events.filter((event) => event.kind === 'user_message');
  assert.equal(userEvents.length, 1);
  assert.equal(userEvents[0].preview, taskText);
  assert.deepEqual(userEvents[0].rawRefs.map((ref) => ref.line), [4]);
  const shellWrapper = mainTimeline.events.find((event) => event.subtype === 'user_shell_command');
  assert.ok(shellWrapper);
  assert.equal(shellWrapper.kind, 'user_shell_command');
  assert.equal(shellWrapper.label, 'User shell command');
  assert.notEqual(shellWrapper.label, 'Command');
  assert.notEqual(shellWrapper.label, 'User message');
  assert.match(shellWrapper.preview, /git fetch origin/);
  assert.deepEqual(shellWrapper.rawRefs.map((ref) => ref.line), [3]);
  assert.deepEqual(shellWrapper.channels, ['response_item']);
  const shellDetail = buildEventDetail(session, shellWrapper.id, 'main');
  assert.equal(shellDetail.timelineSections[0].title, 'Shell command wrapper');
  assert.match(shellDetail.timelineSections[0].code, /git fetch origin/);
  assert.equal(mainTimeline.eventKinds.main.find((item) => item.value === 'user_message')?.count, 1);
  assert.equal(mainTimeline.eventKinds.main.find((item) => item.value === 'user_shell_command')?.count, 1);
  assert.equal(mainTimeline.eventKinds.main.find((item) => item.value === 'user_shell_command')?.label, 'User shell command');
  assert.equal(mainTimeline.eventKinds.protocol.some((item) => item.value === 'user_shell_command'), false);
  assert.deepEqual(mainTimeline.eventKinds, session.eventKinds);

  const protocolTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'protocol',
  });
  assert.equal(protocolTimeline.events.some((event) => event.subtype === 'user_shell_command'), false);

  const raw = await readRawLine(index, session.sourceFile, 3);
  assert.equal(raw.parsed.type, 'response_item');
  assert.equal(raw.parsed.payload.type, 'message');
  assert.equal(raw.parsed.payload.role, 'user');
  assert.equal(raw.parsed.payload.content[0].text, shellText);
});

test('timeline main layer returns logical events without duplicate user or assistant messages', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const timeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });

  const userEvents = timeline.events.filter((event) => event.kind === 'user_message');
  const assistantEvents = timeline.events.filter((event) => event.kind === 'assistant_message');
  const reasoningEvents = timeline.events.filter((event) => event.kind === 'reasoning');
  const planEvents = timeline.events.filter((event) => event.kind === 'proposed_plan');
  const reviewEvents = timeline.events.filter((event) => event.kind === 'review');

  assert.equal(userEvents.length, 1);
  assert.equal(assistantEvents.length, 1);
  assert.equal(reasoningEvents.length, 1);
  assert.equal(reasoningEvents[0].hasReadableReasoning, true);
  assert.equal(planEvents.length, 1);
  assert.equal(reviewEvents.length, 4);
  assert.equal(reviewEvents[0].label, 'Review started');
  assert.equal(reviewEvents[0].preview, 'Review started: current changes');
  assert.equal(reviewEvents[1].label, 'Review completed');
  assert.match(reviewEvents[1].preview, /Review completed: patch is correct - 0 findings - No findings\./);
  const reviewStartDetail = buildEventDetail(session, reviewEvents[0].id, 'main');
  assert.deepEqual(allSections(reviewStartDetail).find((section) => section.title === 'Review request').entries, [
    { key: 'Status', value: 'Started' },
    { key: 'Target', value: 'Uncommitted changes' },
    { key: 'Hint', value: 'current changes' },
  ]);
  const reviewDoneDetail = buildEventDetail(session, reviewEvents[1].id, 'main');
  assert.deepEqual(allSections(reviewDoneDetail).find((section) => section.title === 'Review result').entries, [
    { key: 'Status', value: 'Completed' },
    { key: 'Correctness', value: 'patch is correct' },
    { key: 'Findings', value: '0' },
  ]);
  assert.equal(allSections(reviewDoneDetail).some((section) => section.title === 'Findings' && section.text === 'No findings were reported.'), true);
  const reviewFindingDetail = buildEventDetail(session, reviewEvents[3].id, 'main');
  const findingSummary = allSections(reviewFindingDetail).find((section) => section.title === 'Review result');
  assert.deepEqual(findingSummary.entries, [
    { key: 'Status', value: 'Completed' },
    { key: 'Correctness', value: 'patch has issue' },
    { key: 'Confidence', value: '0.77' },
    { key: 'Findings', value: '1' },
  ]);
  const findingsSection = allSections(reviewFindingDetail).find((section) => section.title === 'Findings');
  assert.match(findingsSection.html, /Guard duplicate rows/);
  assert.match(findingsSection.html, /P2 \| confidence 0\.61 \| G:\\vibe\\term-agent\\src\\sessions\.js:lines 42-45/);
  assert.equal(userEvents[0].rawRefs.length, 2);
  assert.equal(assistantEvents[0].rawRefs.length, 2);
  assert.equal(planEvents[0].rawRefs.length, 2);

  assert.equal(timeline.events.some((event) => event.kind === 'usage_limit_warning'), false);
  assert.equal(session.analysis.tokenStats.maxObserved, 0);
});

test('reasoning row extraction accepts readable fields without exposing encrypted or unknown content', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'reasoning-project');
  const id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '04');
  const file = path.join(dir, `rollout-2026-06-04T10-00-00-${id}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  const longReasoningText = 'x'.repeat(16050);
  const longEventReasoningText = 'y'.repeat(16050);
  const mirroredReasoningText = `Mirror prefix ${'z'.repeat(15970)}TAIL`;
  const records = [
    {
      timestamp: '2026-06-04T10:00:00.000Z',
      type: 'session_meta',
      payload: { id, cwd: repoRoot },
    },
    {
      timestamp: '2026-06-04T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'Readable summary' }],
        content: [{ type: 'reasoning_text', text: 'Content should not replace summary' }],
        encrypted_content: 'encrypted-summary',
      },
    },
    {
      timestamp: '2026-06-04T10:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [],
        content: [{ type: 'reasoning_text', text: 'Readable content fallback' }],
        encrypted_content: 'encrypted-content',
      },
    },
    {
      timestamp: '2026-06-04T10:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [],
        content: [{ type: 'unknown_reasoning_text', text: 'Unknown text must stay hidden' }],
        encrypted_content: 'encrypted-only',
      },
    },
    {
      timestamp: '2026-06-04T10:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [],
        content: [{ type: 'reasoning_text', text: longReasoningText }],
      },
    },
    {
      timestamp: '2026-06-04T10:00:05.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        message: 'Readable event message reasoning',
      },
    },
    {
      timestamp: '2026-06-04T10:00:06.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        message: { text: 'Object-shaped message must stay hidden' },
        text: 'Readable event text fallback',
      },
    },
    {
      timestamp: '2026-06-04T10:00:07.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        text: longEventReasoningText,
      },
    },
    {
      timestamp: '2026-06-04T10:00:08.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        text: { text: 'Object-shaped event reasoning must stay hidden' },
      },
    },
    {
      timestamp: '2026-06-04T10:00:09.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        text: 'Mirror prefix',
      },
    },
    {
      timestamp: '2026-06-04T10:00:10.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: mirroredReasoningText }],
        content: [],
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const reasoningEvents = session.logicalEvents.filter((event) => event.kind === 'reasoning');
  const mainReasoning = reasoningEvents.filter((event) => event.layer === 'main');
  const emptyReasoning = reasoningEvents.filter((event) => event.layer === 'protocol');
  const longReasoning = mainReasoning.find((event) => event.searchText.startsWith('x'));
  const longEventReasoning = mainReasoning.find((event) => event.searchText.startsWith('y'));
  const mirroredReasoning = mainReasoning.find((event) => event.searchText.includes('TAIL'));
  const mirroredDetail = buildEventDetail(session, mirroredReasoning.id);
  const mirroredSection = allSections(mirroredDetail).find((section) => section.title === 'Reasoning');

  assert.deepEqual(mainReasoning.slice(0, 2).map((event) => event.searchText), ['Readable summary', 'Readable content fallback']);
  assert.ok(mainReasoning.some((event) => event.searchText === 'Readable event message reasoning'));
  assert.ok(mainReasoning.some((event) => event.searchText === 'Readable event text fallback'));
  assert.equal(longReasoning.searchText, longReasoningText.slice(0, 16000));
  assert.equal(longReasoning.searchText.length, 16000);
  assert.equal(longEventReasoning.searchText, longEventReasoningText.slice(0, 16000));
  assert.equal(longEventReasoning.searchText.length, 16000);
  assert.equal(mirroredReasoning.rawRefs.length, 2);
  assert.doesNotMatch(mirroredSection.html, /TAIL/);
  assert.ok(mainReasoning.every((event) => event.hasReadableReasoning));
  assert.equal(emptyReasoning.length, 2);
  assert.ok(emptyReasoning.every((event) => event.label === 'Empty reasoning'));
  assert.ok(emptyReasoning.every((event) => event.hasReadableReasoning === false));
  assert.equal(reasoningEvents.some((event) => event.searchText.includes('encrypted')), false);
  assert.equal(reasoningEvents.some((event) => event.searchText.includes('Unknown text')), false);
  assert.equal(reasoningEvents.some((event) => event.searchText.includes('Object-shaped message')), false);
  assert.equal(reasoningEvents.some((event) => event.searchText.includes('Object-shaped event reasoning')), false);
});

test('timeline protocol layer exposes injected records and raw layer keeps all rows', async () => {
  const index = await buildFixtureIndex();
  const protocolTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'protocol',
  });
  assert.ok(protocolTimeline.events.some((event) => event.subtype === 'agents_instructions'));
  assert.ok(protocolTimeline.events.some((event) => event.subtype === 'developer_permissions'));
  assert.ok(protocolTimeline.events.some((event) => event.subtype === 'environment_context'));
  const protocolBySubtype = new Map(protocolTimeline.events.map((event) => [event.subtype, event]));
  assert.equal(protocolBySubtype.get('agents_instructions').label, 'AGENTS.md instructions');
  assert.equal(protocolBySubtype.get('agents_instructions').preview, 'Repository instructions for G:\\vibe\\term-agent');
  assert.equal(protocolBySubtype.get('developer_permissions').label, 'Developer permissions');
  assert.equal(protocolBySubtype.get('developer_permissions').preview, 'Filesystem sandboxing defines which files can be read or written.');
  assert.equal(protocolBySubtype.get('environment_context').label, 'Environment context');
  assert.equal(protocolBySubtype.get('environment_context').preview, 'cwd: G:\\vibe\\term-agent; shell: powershell');
  assert.equal(protocolBySubtype.get('session_meta').label, 'Session metadata');
  assert.equal(protocolBySubtype.get('turn_context').preview, 'turn_id: turn-1; cwd: G:\\vibe\\term-agent; model: gpt-5');
  assert.equal(protocolBySubtype.get('token_count').label, 'Token count');
  assert.match(protocolBySubtype.get('token_count').preview, /5 hour usage limit: 12% remaining; Resets/);
  assert.match(protocolBySubtype.get('token_count').preview, /Weekly usage limit: 67% remaining; Resets/);
  assert.equal(protocolBySubtype.get('session_configured').label, 'Session configured');
  assert.equal(protocolBySubtype.get('session_configured').preview, 'thread_name: configured fixture title; cwd: G:\\vibe\\term-agent; model: gpt-5.1');
  assert.equal(protocolBySubtype.get('thread_goal_updated').label, 'Thread goal updated');
  assert.equal(protocolBySubtype.get('thread_goal_updated').preview, 'Keep protocol coverage readable.');

  const rawTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'raw',
  });
  assert.ok(rawTimeline.total > protocolTimeline.total);
  assert.ok(rawTimeline.events.some((event) => event.recordType === 'response_item'));
});

test('current protocol plan, severity, lifecycle aliases, and incomplete tool records are readable', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const timeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 200,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });

  const planUpdates = timeline.events.filter((event) => event.kind === 'plan_update');
  assert.equal(planUpdates.length, 2);
  assert.deepEqual(planUpdates.map((event) => event.label), ['Plan update', 'Plan delta']);
  assert.equal(planUpdates[0].preview, 'Protocol plan update fixture');
  assert.equal(planUpdates[1].preview, 'Verify folding completed');

  const warningEvents = timeline.events.filter((event) => event.kind === 'warning');
  assert.deepEqual(warningEvents.map((event) => [event.subtype, event.severity]), [
    ['warning', 'warning'],
    ['guardian_warning', 'warning'],
  ]);
  const streamError = timeline.events.find((event) => event.subtype === 'stream_error');
  assert.equal(streamError.kind, 'error');
  assert.equal(streamError.severity, 'error');

  assert.equal(timeline.events.some((event) => event.turnId === 'turn-alias'), false);
  const protocolTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 200,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'protocol',
  });
  const aliasTurns = protocolTimeline.events.filter((event) => event.turnId === 'turn-alias');
  assert.deepEqual(aliasTurns.map((event) => event.subtype), ['task_started', 'task_complete']);

  const incompleteCommand = timeline.events.find((event) => event.preview.includes('npm run watch'));
  assert.equal(incompleteCommand.kind, 'command');
  assert.equal(incompleteCommand.status, 'incomplete');
  assert.equal(incompleteCommand.severity, 'warning');

  const declinedCommand = timeline.events.find((event) => event.preview.includes('git commit'));
  assert.equal(declinedCommand.status, 'declined');
  assert.equal(declinedCommand.severity, 'warning');

  const incompletePatch = timeline.events.find((event) => event.preview.includes('src/incomplete.js'));
  assert.equal(incompletePatch.kind, 'patch');
  assert.equal(incompletePatch.status, 'incomplete');
  assert.deepEqual(incompletePatch.rawRefs.map((ref) => ref.line), [41]);

  const declinedPatch = timeline.events.find((event) => event.preview.includes('src/declined.js'));
  assert.equal(declinedPatch.status, 'declined');
  assert.equal(declinedPatch.severity, 'warning');

  const mcpBegin = timeline.events.find((event) => event.toolName === 'mcp__fixture__lookup');
  assert.equal(mcpBegin.kind, 'mcp_call');
  assert.equal(mcpBegin.status, 'incomplete');
  assert.equal(mcpBegin.rawRefs.length, 1);

  const planDetail = buildEventDetail(session, planUpdates[0].id, 'main');
  assert.equal(allSections(planDetail)[0].type, 'markdown');
  assert.match(allSections(planDetail)[0].html, /Protocol plan update fixture/);
});

test('grouped generic protocol tool labels prefer terminal lifecycle rows', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'eeeeeeee-1111-4444-8888-eeeeeeeeeeee';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '10');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const file = path.join(dir, `rollout-2026-06-10T12-00-00-${id}.jsonl`);
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-06-10T12:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:01.000Z',
      payload: { type: 'dynamic_tool_call_begin', call_id: 'call-dynamic', tool_name: 'asset_lookup', request: { query: 'begin query' } },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:01.100Z',
      payload: { type: 'dynamic_tool_call_end', call_id: 'call-dynamic', tool_name: 'asset_lookup', result: { count: 1 } },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:02.000Z',
      payload: { type: 'image_generation_call_begin', call_id: 'call-image', tool_name: 'image_generation', prompt: 'draw a release icon' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:02.100Z',
      payload: { type: 'image_generation_call_end', call_id: 'call-image', tool_name: 'image_generation', output: { image_count: 1 } },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:03.000Z',
      payload: { type: 'approval_request_begin', call_id: 'call-approval', tool_name: 'approval', action: 'run command' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:03.100Z',
      payload: { type: 'approval_request_declined', call_id: 'call-approval', tool_name: 'approval', status: 'declined', reason: 'not allowed' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:04.000Z',
      payload: { type: 'hook_begin', call_id: 'call-hook', tool_name: 'pre_apply_hook', hook: 'pre-apply' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:04.100Z',
      payload: { type: 'hook_end', call_id: 'call-hook', tool_name: 'pre_apply_hook', status: 'completed' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:05.000Z',
      payload: { type: 'collab_agent_spawn_begin', call_id: 'call-collab', new_thread_id: 'agent-1', message: 'start helper' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:05.100Z',
      payload: { type: 'collab_agent_spawn_end', call_id: 'call-collab', new_thread_id: 'agent-1', status: 'pending_init' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T12:00:06.000Z',
      payload: { type: 'dynamic_tool_call_declined', call_id: 'call-dynamic-declined', tool_name: 'asset_lookup', status: 'declined', reason: 'not allowed' },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const timeline = getTimeline(index, id, {
    offset: 0,
    limit: 20,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  const byCall = new Map(timeline.events.map((event) => [event.id.split(':call:')[1], event]));

  assert.deepEqual({
    dynamic: {
      label: byCall.get('call-dynamic').label,
      status: byCall.get('call-dynamic').status,
      severity: byCall.get('call-dynamic').severity,
      rawLines: byCall.get('call-dynamic').rawRefs.map((ref) => ref.line),
    },
    image: {
      label: byCall.get('call-image').label,
      status: byCall.get('call-image').status,
      severity: byCall.get('call-image').severity,
      rawLines: byCall.get('call-image').rawRefs.map((ref) => ref.line),
    },
    approval: {
      label: byCall.get('call-approval').label,
      status: byCall.get('call-approval').status,
      severity: byCall.get('call-approval').severity,
      rawLines: byCall.get('call-approval').rawRefs.map((ref) => ref.line),
    },
    hook: {
      kind: byCall.get('call-hook').kind,
      label: byCall.get('call-hook').label,
      status: byCall.get('call-hook').status,
      severity: byCall.get('call-hook').severity,
      rawLines: byCall.get('call-hook').rawRefs.map((ref) => ref.line),
    },
    collab: {
      label: byCall.get('call-collab').label,
      status: byCall.get('call-collab').status,
      severity: byCall.get('call-collab').severity,
      rawLines: byCall.get('call-collab').rawRefs.map((ref) => ref.line),
    },
  }, {
    dynamic: {
      label: 'Dynamic Tool Call End',
      status: 'success',
      severity: 'normal',
      rawLines: [2, 3],
    },
    image: {
      label: 'Image Generation',
      status: 'success',
      severity: 'normal',
      rawLines: [4, 5],
    },
    approval: {
      label: 'Approval Request Declined',
      status: 'declined',
      severity: 'warning',
      rawLines: [6, 7],
    },
    hook: {
      kind: 'hook',
      label: 'pre-apply',
      status: 'completed',
      severity: 'normal',
      rawLines: [8, 9],
    },
    collab: {
      label: 'Collab Agent Spawn End',
      status: 'success',
      severity: 'normal',
      rawLines: [10, 11],
    },
  });

  const rawTimeline = getTimeline(index, id, {
    offset: 0,
    limit: 20,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'raw',
  });
  const rawDeclined = rawTimeline.events.find((event) => event.payloadType === 'dynamic_tool_call_declined');
  assert.ok(rawDeclined);
  assert.equal(rawDeclined.label, 'dynamic_tool_call_declined');

  const session = index.sessionsById.get(id);
  assert.ok(session);
  const rawDetail = buildEventDetail(session, rawDeclined.id, 'raw');
  assert.equal(rawDetail.title, 'dynamic_tool_call_declined');
});

test('real image generation response item and event rows group as one tool event', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'edededed-2222-4444-8888-edededededed';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '19');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const file = path.join(dir, `rollout-2026-06-19T12-00-00-${id}.jsonl`);
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-06-19T12:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-19T12:00:01.000Z',
      payload: {
        type: 'image_generation_end',
        call_id: 'ig_fixture_call',
        status: 'completed',
        saved_path: 'output/fixture-image.png',
        revised_prompt: 'sanitized prompt',
        result: pngBase64,
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-19T12:00:01.100Z',
      payload: {
        type: 'image_generation_call',
        id: 'ig_fixture_call',
        status: 'completed',
        revised_prompt: 'sanitized prompt',
        result: pngBase64,
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  assert.ok(session);

  const rawResponse = session.rawEvents.find((raw) => raw.payloadType === 'image_generation_call');
  assert.equal(rawResponse.callId, 'ig_fixture_call');
  assert.equal(rawResponse.toolName, 'image_generation');
  assert.equal(rawResponse.embeddedImages.length, 1);
  assert.equal(JSON.stringify(session).includes(pngBase64), false);

  const timeline = getTimeline(index, id, {
    offset: 0,
    limit: 20,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  const imageEvent = timeline.events.find((event) => event.toolName === 'image_generation');
  assert.ok(imageEvent);
  assert.equal(imageEvent.kind, 'other_tool_call');
  assert.equal(imageEvent.label, 'Image Generation');
  assert.equal(imageEvent.status, 'success');
  assert.deepEqual(imageEvent.rawRefs.map((ref) => ({
    line: ref.line,
    recordType: ref.sourceRecordType,
    eventType: ref.sourceEventType,
  })), [
    { line: 2, recordType: 'event_msg', eventType: 'image_generation_end' },
    { line: 3, recordType: 'response_item', eventType: 'image_generation_call' },
  ]);

  const detail = buildEventDetail(session, imageEvent.id, 'main');
  assert.deepEqual(detail.timelineSections.map((section) => section.title), ['Image generation']);
  assert.equal(detail.timelineSections[0].type, 'markdown');
  assert.match(detail.timelineSections[0].html, /Image generation/);
  assert.match(detail.timelineSections[0].html, /output\/fixture-image\.png/);
  assert.match(detail.timelineSections[0].html, /1 image/);
  assert.doesNotMatch(detail.timelineSections[0].html, /2 images/);
  assert.doesNotMatch(detail.timelineSections[0].html, /Response summary/);
  assert.deepEqual(detail.inspectorSections.map((section) => section.type), ['image_preview', 'kv', 'json']);
  assert.deepEqual(detail.inspectorSections.map((section) => section.title), ['Image preview', 'Tool context', 'Response']);
  const preview = detail.inspectorSections.find((section) => section.type === 'image_preview').images[0];
  assert.equal(preview.mimeType, 'image/png');
  assert.equal(detail.inspectorSections.find((section) => section.title === 'Response').value.result, '[embedded image payload externalized; open raw refs for source]');
  const decoded = await readImagePreview(index, id, imageEvent.id, preview.previewId);
  assert.equal(decoded.mimeType, 'image/png');
  assert.equal(decoded.bytes[0], 0x89);
});

test('response-only image generation calls are successful and readable', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'edededed-3333-4444-8888-edededededed';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '19');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const file = path.join(dir, `rollout-2026-06-19T12-30-00-${id}.jsonl`);
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-06-19T12:30:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-19T12:30:01.000Z',
      payload: {
        type: 'image_generation_call',
        id: 'ig_response_only',
        status: 'completed',
        revised_prompt: 'response only prompt',
        result: pngBase64,
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const timeline = getTimeline(index, id, {
    offset: 0,
    limit: 20,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  const imageEvent = timeline.events.find((event) => event.toolName === 'image_generation');
  assert.ok(imageEvent);
  assert.equal(imageEvent.label, 'Image Generation');
  assert.equal(imageEvent.status, 'success');
  assert.equal(imageEvent.severity, 'normal');
  assert.deepEqual(imageEvent.rawRefs.map((ref) => ({
    line: ref.line,
    recordType: ref.sourceRecordType,
    eventType: ref.sourceEventType,
  })), [
    { line: 2, recordType: 'response_item', eventType: 'image_generation_call' },
  ]);

  const detail = buildEventDetail(session, imageEvent.id, 'main');
  assert.deepEqual(detail.timelineSections.map((section) => section.title), ['Image generation']);
  assert.match(detail.timelineSections[0].html, /1 image/);
  assert.match(detail.timelineSections[0].html, /response only prompt/);
  const preview = detail.inspectorSections.find((section) => section.type === 'image_preview').images[0];
  assert.equal(preview.mimeType, 'image/png');
  assert.equal(detail.inspectorSections.find((section) => section.title === 'Response').value.result, '[embedded image payload externalized; open raw refs for source]');
});

test('tool logical events merge new and old format patch records and search still works', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  const searched = filterSessions(index, { q: 'alpha', sort: 'updated-desc', layer: 'main' });
  assert.equal(searched.total, 1);

  const parserTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: 'parser.js',
    layer: 'main',
  });
  assert.equal(parserTimeline.total, 1);
  assert.equal(parserTimeline.events[0].kind, 'patch');
  assert.equal(parserTimeline.events[0].status, 'success');
  const parserDetail = buildEventDetail(session, parserTimeline.events[0].id, 'main');
  assert.deepEqual(allSections(parserDetail).find((section) => section.title === 'Files').entries, [
    { key: 'G:/vibe/term-agent/src/parser.js', value: '+1 / -1' },
  ]);
  const parserPreviewSearch = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: 'G:\\vibe\\term-agent\\src\\parser.js',
    kind: 'patch',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(parserPreviewSearch.searchMatchCount, 1);
  assert.equal(parserPreviewSearch.events[0].hasSearchHit, true);
  assert.equal(parserPreviewSearch.events[0].snippet, 'G:\\vibe\\term-agent\\src\\parser.js');

  const legacyTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: 'legacy.js',
    layer: 'main',
  });
  assert.equal(legacyTimeline.total, 1);
  assert.equal(legacyTimeline.events[0].kind, 'patch');
  assert.equal(legacyTimeline.events[0].status, 'success');
  const legacyDetail = buildEventDetail(session, legacyTimeline.events[0].id, 'main');
  assert.deepEqual(allSections(legacyDetail).find((section) => section.title === 'Files').entries, [
    { key: 'src/legacy.js', value: '+1 / -1' },
  ]);

  const statsTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: '',
    tool: '',
    file: 'stats.js',
    layer: 'main',
  });
  assert.equal(statsTimeline.total, 1);
  assert.equal(statsTimeline.events[0].kind, 'patch');
  assert.equal(statsTimeline.events[0].status, 'success');
  const statsDetail = buildEventDetail(session, statsTimeline.events[0].id, 'main');
  assert.deepEqual(allSections(statsDetail).find((section) => section.title === 'Files').entries, [
    { key: 'G:/vibe/term-agent/src/stats.js', value: '+2 / -1' },
  ]);

  const failedTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: '',
    kind: '',
    status: 'failed',
    tool: '',
    file: 'failed.js',
    layer: 'main',
  });
  assert.equal(failedTimeline.total, 1);
  assert.equal(failedTimeline.events[0].kind, 'patch');
  assert.equal(failedTimeline.events[0].label, 'Patch failed');
  assert.equal(failedTimeline.events[0].status, 'failed');
  const failedDetail = buildEventDetail(session, failedTimeline.events[0].id, 'main');
  assert.deepEqual(allSections(failedDetail).find((section) => section.title === 'Files').entries, [
    { key: 'src/failed.js', value: '+1 / -1' },
  ]);

  const outputOnlyCommandTimeline = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: 'rg -n -F',
    kind: 'command',
    status: 'success',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(outputOnlyCommandTimeline.total, 1);
  assert.equal(outputOnlyCommandTimeline.events[0].label, 'Command');
  assert.equal(outputOnlyCommandTimeline.events[0].status, 'success');
  assert.equal(outputOnlyCommandTimeline.events[0].outputStats.exitCode, 0);
  assert.match(outputOnlyCommandTimeline.events[0].preview, /rg -n -F 'alpha' 'src'/);
  const outputOnlyCommandDetail = buildEventDetail(session, outputOnlyCommandTimeline.events[0].id, 'main');
  assert.equal(outputOnlyCommandDetail.timelineSections[0].language, 'powershell');

  const failedCommandOutputSearch = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: 'alpha failed',
    kind: 'command',
    status: 'failed',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(failedCommandOutputSearch.total, 1);
  assert.equal(failedCommandOutputSearch.searchMatchCount, 1);
  assert.equal(failedCommandOutputSearch.events[0].hasSearchHit, true);

  const failedCommandTextSearch = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: 'npm test',
    kind: 'command',
    status: 'failed',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(failedCommandTextSearch.total, 1);
  assert.equal(failedCommandTextSearch.searchMatchCount, 1);

  const failedCommandStderrSearch = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: 'parser stack',
    kind: 'command',
    status: 'failed',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(failedCommandStderrSearch.total, 1);
  assert.equal(failedCommandStderrSearch.searchMatchCount, 1);

  const outputOnlyCommandOutputSearch = getTimeline(index, primaryFixtureSessionId, {
    offset: 0,
    limit: 100,
    q: 'src/parser.js:1:alpha',
    kind: 'command',
    status: 'success',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(outputOnlyCommandOutputSearch.total, 1);
  assert.equal(outputOnlyCommandOutputSearch.searchMatchCount, 1);
});

test('free-text search matches one case-insensitive phrase with flexible whitespace', () => {
  assert.equal(matchTerms('before Foo \n\t bar after', 'foo bar'), true);
  assert.equal(matchTerms('before foo unrelated bar after', 'foo bar'), false);
  assert.equal(matchTerms('before a+b after', 'a+b'), true);
  assert.equal(matchTerms('before aaab after', 'a+b'), false);
});

test('command search keeps unique parsed function output without duplicate stream counts', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const sessionId = 'abababab-abab-abab-abab-abababababab';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '26');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `rollout-2026-06-26T10-00-00-${sessionId}.jsonl`), [
    JSON.stringify({ timestamp: '2026-06-26T10:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: repoRoot } }),
    JSON.stringify({
      timestamp: '2026-06-26T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        call_id: 'call-shell-stream-and-tail',
        arguments: JSON.stringify({ command: 'npm test', workdir: repoRoot }),
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-26T10:00:01.100Z',
      type: 'event_msg',
      payload: {
        type: 'exec_command_end',
        call_id: 'call-shell-stream-and-tail',
        turn_id: 'turn-1',
        command: ['powershell.exe', '-Command', 'npm test'],
        cwd: repoRoot,
        stdout: 'stdout mirror phrase',
        stderr: 'stderr mirror phrase',
        aggregated_output: 'stdout mirror phrase\nstderr mirror phrase',
        exit_code: 0,
        duration: { secs: 1, nanos: 0 },
        status: 'completed',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-26T10:00:01.200Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-shell-stream-and-tail',
        output: 'Exit code: 0\nWall time: 1.0 seconds\nOutput:\nstdout mirror phrase\nstderr mirror phrase\nunique parsed function tail',
      },
    }),
    '',
  ].join('\n'), 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const stdoutSearch = getTimeline(index, sessionId, {
    offset: 0,
    limit: 100,
    q: 'stdout mirror phrase',
    kind: 'command',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(stdoutSearch.total, 1);
  assert.equal(stdoutSearch.searchMatchCount, 1);

  const tailSearch = getTimeline(index, sessionId, {
    offset: 0,
    limit: 100,
    q: 'unique parsed function tail',
    kind: 'command',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(tailSearch.total, 1);
  assert.equal(tailSearch.searchMatchCount, 1);
  assert.equal(tailSearch.events[0].hasSearchHit, true);
});

test('command search preserves output from update and delta rows', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const sessionId = 'bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '26');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `rollout-2026-06-26T11-00-00-${sessionId}.jsonl`), [
    JSON.stringify({ timestamp: '2026-06-26T11:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: repoRoot } }),
    JSON.stringify({
      timestamp: '2026-06-26T11:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        call_id: 'call-shell-incremental-output',
        arguments: JSON.stringify({ command: 'npm test', workdir: repoRoot }),
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-26T11:00:01.100Z',
      type: 'event_msg',
      payload: {
        type: 'exec_command_begin',
        call_id: 'call-shell-incremental-output',
        turn_id: 'turn-1',
        command: ['powershell.exe', '-Command', 'npm test'],
        cwd: repoRoot,
        status: 'running',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-26T11:00:01.200Z',
      type: 'event_msg',
      payload: {
        type: 'exec_command_update',
        call_id: 'call-shell-incremental-output',
        turn_id: 'turn-1',
        stdout: 'first incremental chunk',
        status: 'running',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-26T11:00:01.300Z',
      type: 'event_msg',
      payload: {
        type: 'exec_command_delta',
        call_id: 'call-shell-incremental-output',
        turn_id: 'turn-1',
        stdout: 'later delta only chunk',
        status: 'running',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-26T11:00:01.400Z',
      type: 'event_msg',
      payload: {
        type: 'exec_command_end',
        call_id: 'call-shell-incremental-output',
        turn_id: 'turn-1',
        stdout: 'final end chunk',
        aggregated_output: 'final end chunk\naggregate only final summary',
        formatted_output: 'formatted only final note',
        exit_code: 0,
        duration: { secs: 1, nanos: 0 },
        status: 'completed',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-26T11:00:01.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-shell-incremental-output',
        output: 'Exit code: 0\nWall time: 1.0 seconds\nOutput:\nfunction output only tail',
      },
    }),
    '',
  ].join('\n'), 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  for (const q of [
    'first incremental chunk',
    'later delta only chunk',
    'final end chunk',
    'aggregate only final summary',
    'formatted only final note',
    'function output only tail',
  ]) {
    const timeline = getTimeline(index, sessionId, {
      offset: 0,
      limit: 100,
      q,
      kind: 'command',
      status: '',
      tool: '',
      file: '',
      layer: 'main',
    });
    assert.equal(timeline.total, 1);
    assert.equal(timeline.searchMatchCount, 1, q);
    assert.equal(timeline.events[0].hasSearchHit, true, q);
  }
});

test('command language inference uses session shell context for bare external commands', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const dir = path.join(codexHome, 'sessions', '2026', '06', '08');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(dir, { recursive: true });

  async function writeShellSession(id, shell, command, callId) {
    await fsp.writeFile(path.join(dir, `rollout-2026-06-08T10-00-00-${id}.jsonl`), [
      JSON.stringify({ timestamp: '2026-06-08T10:00:00.000Z', type: 'session_meta', payload: { id, cwd: repoRoot } }),
      JSON.stringify({
        timestamp: '2026-06-08T10:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `<environment_context>\n  <cwd>${repoRoot}</cwd>\n  <shell>${shell}</shell>\n</environment_context>` }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-08T10:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          call_id: callId,
          arguments: JSON.stringify({ command, workdir: repoRoot }),
        },
      }),
      '',
    ].join('\n'), 'utf8');
  }

  const bashId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const powershellId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const wrappedBashId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  await writeShellSession(bashId, 'bash', 'rg -n TODO src', 'call-bash');
  await writeShellSession(powershellId, 'powershell', 'pip3 install tox; python3 -m pytest', 'call-powershell');
  await writeShellSession(wrappedBashId, 'powershell', ['bash', '-lc', 'pwsh -Command "rg -n TODO src"'], 'call-wrapped-bash');

  const index = await buildIndex({ repoRoot, codexHome });
  const bashSession = index.sessionsById.get(bashId);
  const powershellSession = index.sessionsById.get(powershellId);
  const wrappedBashSession = index.sessionsById.get(wrappedBashId);
  const bashEvent = bashSession.logicalEvents.find((event) => event.kind === 'command');
  const powershellEvent = powershellSession.logicalEvents.find((event) => event.kind === 'command');
  const wrappedBashEvent = wrappedBashSession.logicalEvents.find((event) => event.kind === 'command');

  assert.equal(buildEventDetail(bashSession, bashEvent.id, 'main').timelineSections[0].language, 'shell');
  assert.equal(buildEventDetail(powershellSession, powershellEvent.id, 'main').timelineSections[0].language, 'powershell');
  assert.equal(buildEventDetail(wrappedBashSession, wrappedBashEvent.id, 'main').timelineSections[0].language, 'bash');
});

test('filterSessions uses contiguous phrase semantics for project event search', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const event = session.logicalEvents.find((candidate) => candidate.layer === 'main');
  event.preview = 'before Foo \n\t bar after; alpha unrelated beta';
  event.searchText = event.preview;
  index.sessions = [session];

  assert.equal(filterSessions(index, { q: 'foo bar', layer: 'main', sort: 'latest-match-desc' }).total, 1);
  assert.equal(filterSessions(index, { q: 'alpha beta', layer: 'main', sort: 'latest-match-desc' }).total, 0);
});

test('filterSessions applies from/to date filters on the same activity timestamp basis', () => {
  const makeSession = (id, startedAt, updatedAt) => ({
    id,
    title: id,
    sourceFile: `${id}.jsonl`,
    bytes: 1,
    lineCount: 1,
    cwdSet: new Set(),
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt,
    updatedAt,
    counts: { failedCommands: 0 },
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents: [],
    rawEvents: [],
  });
  const index = {
    sessions: [
      makeSession('updated-late', '2026-06-01T08:00:00.000Z', '2026-06-10T12:00:00.000Z'),
      makeSession('started-only', '2026-06-04T09:00:00.000Z', ''),
    ],
    sessionsById: new Map(),
  };

  assert.deepEqual(
    filterSessions(index, { from: '2026-06-05', sort: 'updated-desc' }).sessions.map((session) => session.id),
    ['updated-late'],
  );
  assert.deepEqual(
    filterSessions(index, { to: '2026-06-05', sort: 'updated-desc' }).sessions.map((session) => session.id),
    ['started-only'],
  );
});

test('patches with ambiguous outputs stay incomplete and warning-severity', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'abababab-abab-abab-abab-abababababab';
  const sessionDir = path.join(codexHome, 'sessions', '2026', '06', '18');
  const file = path.join(sessionDir, `rollout-2026-06-18T09-00-00-${id}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(file, [
    JSON.stringify({ timestamp: '2026-06-18T09:00:00.000Z', type: 'session_meta', payload: { id, cwd: repoRoot } }),
    JSON.stringify({ timestamp: '2026-06-18T09:00:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-patch-unknown', input: '*** Begin Patch\n*** Update File: src/unknown.js\n@@\n-old\n+new\n*** End Patch' } }),
    JSON.stringify({ timestamp: '2026-06-18T09:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-patch-unknown', output: '{"output":"Patch request sent to helper.","metadata":{"duration_seconds":0.1}}' } }),
    '',
  ].join('\n'), 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const patchEvent = session.logicalEvents.find((event) => event.kind === 'patch');
  const rawOutput = session.rawEvents.find((raw) => raw.payloadType === 'custom_tool_call_output');
  const rawDetail = buildEventDetail(session, rawOutput.rawId, 'raw');
  const resultNotice = allSections(rawDetail).find((section) => section.type === 'notice' && section.title === 'Result');

  assert.ok(patchEvent);
  assert.equal(patchEvent.status, 'incomplete');
  assert.equal(patchEvent.severity, 'warning');
  assert.equal(patchEvent.label, 'Incomplete patch');
  assert.equal(resultNotice.level, 'warning');
});

test('patch stderr failure markers override incidental stdout', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'acacacac-acac-acac-acac-acacacacacac';
  const sessionDir = path.join(codexHome, 'sessions', '2026', '06', '18');
  const file = path.join(sessionDir, `rollout-2026-06-18T09-05-00-${id}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(file, [
    JSON.stringify({ timestamp: '2026-06-18T09:05:00.000Z', type: 'session_meta', payload: { id, cwd: repoRoot } }),
    JSON.stringify({
      timestamp: '2026-06-18T09:05:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'patch_apply_end',
        call_id: 'call-patch-stderr-failure',
        stdout: 'Done',
        stderr: 'error: invalid patch',
      },
    }),
    '',
  ].join('\n'), 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const patchEvent = session.logicalEvents.find((event) => event.kind === 'patch');
  const rawPatchEnd = session.rawEvents.find((raw) => raw.payloadType === 'patch_apply_end');
  const rawDetail = buildEventDetail(session, rawPatchEnd.rawId, 'raw');
  const resultNotice = allSections(rawDetail).find((section) => section.type === 'notice' && section.title === 'Result');

  assert.ok(patchEvent);
  assert.equal(patchEvent.status, 'failed');
  assert.equal(patchEvent.severity, 'error');
  assert.equal(patchEvent.label, 'Patch failed');
  assert.equal(resultNotice.level, 'error');
  assert.match(resultNotice.text, /Done/);
  assert.match(resultNotice.text, /invalid patch/);
});

test('patch detail preserves changed lines that begin with diff marker characters', () => {
  const patchText = [
    '*** Begin Patch',
    '*** Update File: sample.md',
    '@@',
    ' alpha',
    '----',
    '+++i',
    ' omega',
    '*** End Patch',
  ].join('\n');
  const raw = {
    rawId: 'fixture:patch-marker:1',
    recordType: 'response_item',
    payloadType: 'custom_tool_call',
    toolName: 'apply_patch',
    output: patchText,
    parsed: { payload: {} },
    source: { file: 'fixture.jsonl', line: 1 },
  };
  const event = {
    id: 'logical:patch-marker',
    kind: 'patch',
    subtype: 'apply_patch',
    layer: 'main',
    label: 'Patch applied',
    status: 'success',
    severity: 'normal',
    toolName: 'apply_patch',
    touchedFiles: ['sample.md'],
    outputStats: {},
    channels: ['response_item'],
    rawRefs: [{ rawId: raw.rawId, file: 'fixture.jsonl', line: 1 }],
  };
  const detail = buildEventDetail({ rawEvents: [raw], logicalEvents: [event] }, event.id, 'main');
  const patch = detail.timelineSections.find((section) => section.type === 'patch');
  const file = patch.files[0];
  const lines = file.hunks[0].lines;

  assert.equal(patch.lineNumbers, false);
  assert.equal(file.lineNumbers, false);
  assert.equal(file.additions, 1);
  assert.equal(file.deletions, 1);
  assert.deepEqual(lines.map((line) => [line.kind, line.content, line.oldLine, line.newLine]), [
    ['context', 'alpha', 1, 1],
    ['removed', '---', 2, null],
    ['added', '++i', null, 2],
    ['context', 'omega', 3, 3],
  ]);
  assert.deepEqual(detail.inspectorSections.find((section) => section.title === 'Files').entries, [
    { key: 'sample.md', value: '+1 / -1' },
  ]);
});

test('patch detail prefers applied unified diff with reliable file line numbers', () => {
  const raw = {
    rawId: 'fixture:patch-end:1',
    recordType: 'event_msg',
    payloadType: 'patch_apply_end',
    toolName: 'apply_patch',
    output: '',
    parsed: {
      payload: {
        type: 'patch_apply_end',
        changes: {
          'src/app.js': {
            type: 'update',
            unified_diff: '@@ -9,3 +9,4 @@\n const before = true;\n-old();\n+newCall();\n+extra();\n const after = true;\n',
          },
        },
      },
    },
    source: { file: 'fixture.jsonl', line: 2 },
  };
  const event = {
    id: 'logical:patch-end',
    kind: 'patch',
    subtype: 'apply_patch',
    layer: 'main',
    label: 'Patch applied',
    status: 'success',
    severity: 'normal',
    toolName: 'apply_patch',
    touchedFiles: ['src/app.js'],
    outputStats: {},
    channels: ['event_msg'],
    rawRefs: [{ rawId: raw.rawId, file: 'fixture.jsonl', line: 2 }],
  };
  const detail = buildEventDetail({ rawEvents: [raw], logicalEvents: [event] }, event.id, 'main');
  const patch = detail.timelineSections.find((section) => section.type === 'patch');
  const file = patch.files[0];
  const lines = file.hunks[0].lines;

  assert.equal(patch.lineNumbers, true);
  assert.equal(file.lineNumbers, true);
  assert.equal(file.path, 'src/app.js');
  assert.deepEqual(lines.map((line) => [line.kind, line.oldLine, line.newLine, line.lineNumberReliable]), [
    ['context', 9, 9, true],
    ['removed', 10, null, true],
    ['added', null, 10, true],
    ['added', null, 11, true],
    ['context', 11, 12, true],
  ]);
});

test('patch detail preserves applied unified diff lines that look like file headers', () => {
  const raw = {
    rawId: 'fixture:patch-header-like:1',
    recordType: 'event_msg',
    payloadType: 'patch_apply_end',
    toolName: 'apply_patch',
    output: '',
    parsed: {
      payload: {
        type: 'patch_apply_end',
        changes: {
          'src/markers.txt': {
            type: 'update',
            unified_diff: '--- a/src/markers.txt\n+++ b/src/markers.txt\n@@ -1,2 +1,2 @@\n---removed marker\n+++added marker\n context\n',
          },
        },
      },
    },
    source: { file: 'fixture.jsonl', line: 3 },
  };
  const event = {
    id: 'logical:patch-header-like',
    kind: 'patch',
    subtype: 'apply_patch',
    layer: 'main',
    label: 'Patch applied',
    status: 'success',
    severity: 'normal',
    toolName: 'apply_patch',
    touchedFiles: ['src/markers.txt'],
    outputStats: {},
    channels: ['event_msg'],
    rawRefs: [{ rawId: raw.rawId, file: 'fixture.jsonl', line: 3 }],
  };
  const detail = buildEventDetail({ rawEvents: [raw], logicalEvents: [event] }, event.id, 'main');
  const patch = detail.timelineSections.find((section) => section.type === 'patch');
  const lines = patch.files[0].hunks[0].lines;

  assert.equal(patch.files[0].additions, 1);
  assert.equal(patch.files[0].deletions, 1);
  assert.deepEqual(lines.map((line) => [line.kind, line.content, line.oldLine, line.newLine]), [
    ['removed', '--removed marker', 1, null],
    ['added', '++added marker', null, 1],
    ['context', 'context', 2, 2],
  ]);
  assert.deepEqual(detail.inspectorSections.find((section) => section.title === 'Files').entries, [
    { key: 'src/markers.txt', value: '+1 / -1' },
  ]);
});

test('patch detail keeps mixed applied diff and content changes with display paths', () => {
  const raw = {
    rawId: 'fixture:patch-mixed:1',
    recordType: 'event_msg',
    payloadType: 'patch_apply_end',
    toolName: 'apply_patch',
    output: '',
    parsed: {
      payload: {
        type: 'patch_apply_end',
        changes: {
          'G:\\vibe\\session-analyzer\\src\\app.js': {
            type: 'update',
            unified_diff: '@@ -4,1 +4,1 @@\n-old();\n+newCall();\n',
          },
          'G:\\vibe\\session-analyzer\\src\\created.js': {
            type: 'Add',
            content: 'const created = true;\nexport default created;\n',
          },
        },
      },
    },
    source: { file: 'fixture.jsonl', line: 3 },
  };
  const event = {
    id: 'logical:patch-mixed',
    kind: 'patch',
    subtype: 'apply_patch',
    layer: 'main',
    label: 'Patch applied',
    status: 'success',
    severity: 'normal',
    toolName: 'apply_patch',
    touchedFiles: ['src/app.js', 'src/created.js'],
    outputStats: {},
    channels: ['event_msg'],
    rawRefs: [{ rawId: raw.rawId, file: 'fixture.jsonl', line: 3 }],
  };
  const detail = buildEventDetail({ repoRoot: 'G:\\vibe\\session-analyzer', rawEvents: [raw], logicalEvents: [event] }, event.id, 'main');
  const patch = detail.timelineSections.find((section) => section.type === 'patch');

  assert.deepEqual(patch.files.map((file) => file.path), ['src/app.js', 'src/created.js']);
  assert.equal(patch.files[0].lineNumbers, true);
  assert.equal(patch.files[1].lineNumbers, false);
  assert.deepEqual(patch.files[1].hunks[0].lines.map((line) => [line.kind, line.content, line.lineNumberReliable]), [
    ['added', 'const created = true;', false],
    ['added', 'export default created;', false],
  ]);
  assert.deepEqual(detail.inspectorSections.find((section) => section.title === 'Files').entries, [
    { key: 'src/app.js', value: '+1 / -1' },
    { key: 'src/created.js', value: '+2 / -0' },
  ]);
});

test('patch detail skips unified diff no-newline metadata lines', () => {
  const raw = {
    rawId: 'fixture:patch-newline:1',
    recordType: 'event_msg',
    payloadType: 'patch_apply_end',
    toolName: 'apply_patch',
    output: '',
    parsed: {
      payload: {
        type: 'patch_apply_end',
        changes: {
          'src/app.js': {
            type: 'update',
            unified_diff: '@@ -1,2 +1,2 @@\n const before = true;\n-old();\n\\ No newline at end of file\n+newCall();\n\\ No newline at end of file\n',
          },
        },
      },
    },
    source: { file: 'fixture.jsonl', line: 4 },
  };
  const event = {
    id: 'logical:patch-newline',
    kind: 'patch',
    subtype: 'apply_patch',
    layer: 'main',
    label: 'Patch applied',
    status: 'success',
    severity: 'normal',
    toolName: 'apply_patch',
    touchedFiles: ['src/app.js'],
    outputStats: {},
    channels: ['event_msg'],
    rawRefs: [{ rawId: raw.rawId, file: 'fixture.jsonl', line: 4 }],
  };
  const detail = buildEventDetail({ rawEvents: [raw], logicalEvents: [event] }, event.id, 'main');
  const patch = detail.timelineSections.find((section) => section.type === 'patch');
  const lines = patch.files[0].hunks[0].lines;

  assert.deepEqual(lines.map((line) => [line.kind, line.content, line.oldLine, line.newLine]), [
    ['context', 'const before = true;', 1, 1],
    ['removed', 'old();', 2, null],
    ['added', 'newCall();', null, 2],
  ]);
  assert.equal(lines.some((line) => line.content.includes('No newline')), false);
});

test('file suggestions come from analyzed session touched files', async () => {
  const index = await buildFixtureIndex();
  const suggestions = fileSuggestions(index).map((item) => item.file);

  assert.ok(suggestions.includes('src/parser.js'));
  assert.ok(suggestions.includes('src/legacy.js'));
  assert.equal(suggestions.includes('public/app.js'), false);
});

test('web search logical events merge end/call rows and expose structured detail', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  const webTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: '',
    kind: 'web_search',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(webTimeline.total, 3);

  const completedSearch = webTimeline.events.find((event) => event.rawRefs.length === 2);
  assert.ok(completedSearch);
  assert.equal(completedSearch.label, 'Web search');
  assert.equal(completedSearch.status, 'completed');
  assert.equal(completedSearch.toolName, 'web_search');
  assert.deepEqual(completedSearch.channels, ['event_msg', 'response_item']);

  const openPageSearch = webTimeline.events.find((event) => event.preview.includes('https://example.test/docs'));
  assert.ok(openPageSearch);
  assert.deepEqual(openPageSearch.channels, ['event_msg', 'response_item']);
  assert.deepEqual(openPageSearch.rawRefs.map((ref) => ref.line), [16, 17]);

  const orphanSearch = webTimeline.events.find((event) => event.rawRefs.length === 1 && event.preview.includes('orphan web search end fixture'));
  assert.ok(orphanSearch);
  assert.equal(orphanSearch.status, 'completed');
  assert.deepEqual(orphanSearch.channels, ['event_msg']);

  const searchedTimeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    q: 'detail extraction',
    kind: 'web_search',
    status: '',
    tool: '',
    file: '',
    layer: 'main',
  });
  assert.equal(searchedTimeline.total, 3);
  assert.equal(searchedTimeline.searchMatchCount, 1);
  assert.equal(searchedTimeline.events[0].id, completedSearch.id);
  assert.equal(searchedTimeline.events[0].hasSearchHit, true);
  assert.match(searchedTimeline.events[0].snippet, /detail extraction/);

  const detail = buildEventDetail(session, completedSearch.id, 'main');
  const actionSection = allSections(detail).find((section) => section.title === 'Search action');
  assert.equal(actionSection.type, 'json');
  assert.equal(actionSection.value.query, 'normalization web search fixture');

  const metadataSection = allSections(detail).find((section) => section.title === 'Search status');
  assert.deepEqual(metadataSection.entries, [
    { key: 'status', value: 'completed' },
  ]);

  const payloadSection = allSections(detail).find((section) => section.title === 'Search payload');
  assert.equal(payloadSection.type, 'json');
  assert.equal(payloadSection.value.query, 'normalization web search fixture');
  assert.equal(payloadSection.value.results[0].snippet, 'web search detail extraction result');
});

test('buildEventDetail extracts structured sections for messages, tools, protocol, empty reasoning, and raw records', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);

  const userEvent = session.logicalEvents.find((event) => event.kind === 'user_message');
  const userDetail = buildEventDetail(session, userEvent.id, 'main');
  assert.equal(allSections(userDetail)[0].title, 'Message');
  assert.equal(allSections(userDetail)[0].hideTitle, true);
  assert.match(allSections(userDetail)[0].html, /<h1>Fix the alpha parser regression<\/h1>/);
  assert.match(allSections(userDetail)[0].html, /<table>/);
  assert.match(allSections(userDetail)[0].html, /<li>render markdown<\/li>/);
  assert.match(allSections(userDetail)[0].html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(allSections(userDetail)[0].html, /href="javascript:/i);

  const assistantEvent = session.logicalEvents.find((event) => event.kind === 'assistant_message');
  const assistantDetail = buildEventDetail(session, assistantEvent.id, 'main');
  assert.equal(allSections(assistantDetail)[0].type, 'markdown');
  assert.equal(allSections(assistantDetail)[0].hideTitle, true);
  assert.match(allSections(assistantDetail)[0].html, /inspect the parser first/i);
  assert.deepEqual(Object.keys(assistantDetail.meta), ['timestamp', 'turnId', 'status', 'severity', 'toolName', 'touchedFiles', 'outputStats', 'channels', 'source']);

  const commandEvent = session.logicalEvents.find((event) => event.kind === 'command');
  const commandDetail = buildEventDetail(session, commandEvent.id, 'main');
  assert.equal(commandDetail.sections, undefined);
  assert.deepEqual(commandDetail.timelineSections.map((section) => section.title), ['Command', 'stdout', 'stderr']);
  assert.equal(commandDetail.timelineSections[0].type, 'code');
  assert.equal(commandDetail.timelineSections[0].language, 'powershell');
  assert.ok(commandDetail.timelineSections.some((section) => section.type === 'terminal' && section.stream === 'stderr'));
  assert.ok(commandDetail.inspectorSections.some((section) => section.type === 'json' && section.title === 'Arguments'));
  assert.ok(commandDetail.inspectorSections.some((section) => section.type === 'kv' && section.title === 'Run context'));
  assert.equal(commandDetail.timelineSections.filter((section) => section.type === 'code').length, 1);
  assert.equal(commandDetail.timelineSections.some((section) => section.title === 'Tool output'), false);

  const patchEvents = session.logicalEvents.filter((event) => event.kind === 'patch');
  const newPatchDetail = buildEventDetail(session, patchEvents[0].id, 'main');
  const oldPatchDetail = buildEventDetail(session, patchEvents[1].id, 'main');
  assert.equal(newPatchDetail.timelineSections[0].type, 'patch');
  assert.equal(oldPatchDetail.timelineSections[0].type, 'patch');
  assert.ok(newPatchDetail.inspectorSections.some((section) => section.title === 'Files'));

  const planEvent = session.logicalEvents.find((event) => event.kind === 'proposed_plan');
  const planDetail = buildEventDetail(session, planEvent.id, 'main');
  assert.equal(allSections(planDetail)[0].type, 'markdown');
  assert.equal(allSections(planDetail)[0].hideTitle, true);
  assert.doesNotMatch(allSections(planDetail)[0].html, /proposed_plan/i);
  assert.ok(allSections(planDetail).some((section) => section.type === 'raw_json'));
  assert.equal(allSections(planDetail).find((section) => section.type === 'raw_json').expanded, false);

  const updatePlanEvent = session.logicalEvents.find((event) => event.toolName === 'update_plan');
  const updatePlanDetail = buildEventDetail(session, updatePlanEvent.id, 'main');
  assert.equal(updatePlanDetail.timelineSections.length, 2);
  assert.equal(updatePlanDetail.timelineSections[0].type, 'plan_update');
  assert.equal(updatePlanDetail.timelineSections[0].title, 'Plan update');
  assert.match(updatePlanDetail.timelineSections[0].explanationHtml, /Parser inspection is complete/);
  assert.deepEqual(updatePlanDetail.timelineSections[0].steps, [
    { step: 'Inspect parser', status: 'completed' },
    { step: 'Patch regression', status: 'in_progress' },
  ]);
  assert.equal(updatePlanDetail.timelineSections[1].type, 'code');
  assert.match(updatePlanDetail.timelineSections[1].code, /Plan updated/);
  assert.ok(updatePlanDetail.inspectorSections.some((section) => section.type === 'json' && section.title === 'Request'));

  const protocolEvent = session.logicalEvents.find((event) => event.subtype === 'agents_instructions');
  const protocolDetail = buildEventDetail(session, protocolEvent.id, 'protocol');
  assert.equal(allSections(protocolDetail)[0].type, 'markdown');
  assert.equal(allSections(protocolDetail)[0].hideTitle, true);

  const envEvent = session.logicalEvents.find((event) => event.subtype === 'environment_context');
  const envDetail = buildEventDetail(session, envEvent.id, 'protocol');
  assert.equal(allSections(envDetail)[0].type, 'kv');
  assert.equal(allSections(envDetail)[1].type, 'raw_json');

  const sessionMetaEvent = session.logicalEvents.find((event) => event.subtype === 'session_meta');
  const sessionMetaDetail = buildEventDetail(session, sessionMetaEvent.id, 'protocol');
  assert.equal(allSections(sessionMetaDetail)[0].type, 'kv');
  assert.equal(allSections(sessionMetaDetail)[1].type, 'raw_json');

  const emptyReasoningEvent = session.logicalEvents.find((event) => event.kind === 'reasoning' && event.label === 'Empty reasoning');
  const emptyReasoningDetail = buildEventDetail(session, emptyReasoningEvent.id, 'protocol');
  assert.equal(allSections(emptyReasoningDetail)[0].type, 'notice');
  assert.equal(allSections(emptyReasoningDetail)[0].hideTitle, true);

  const tokenEvent = session.logicalEvents.find((event) => event.subtype === 'token_count');
  const tokenDetail = buildEventDetail(session, tokenEvent.id, 'protocol');
  const usageLimits = allSections(tokenDetail).find((section) => section.title === 'Usage limits');
  assert.equal(usageLimits.type, 'usage_limits');
  assert.deepEqual(usageLimits.items.map((item) => [item.label, item.remaining]), [
    ['5 hour usage limit', '12%'],
    ['Weekly usage limit', '67%'],
  ]);

  const taskStartedEvent = session.logicalEvents.find((event) => event.layer === 'protocol' && event.subtype === 'task_started');
  const taskStartedDetail = buildEventDetail(session, taskStartedEvent.id, 'protocol');
  assert.deepEqual(taskStartedDetail.timelineSections, []);
  assert.equal(taskStartedDetail.inspectorSections[0].type, 'raw_json');

  const rawRecord = session.rawEvents.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'task_started');
  const rawDetail = buildEventDetail(session, rawRecord.rawId, 'raw');
  assert.equal(allSections(rawDetail).at(-1).type, 'raw_json');
  assert.equal(allSections(rawDetail).at(-1).expanded, true);

  const rawUserRecord = session.rawEvents.find((raw) => raw.recordType === 'event_msg' && raw.payloadType === 'user_message');
  const rawUserDetail = buildEventDetail(session, rawUserRecord.rawId, 'raw');
  assert.equal(allSections(rawUserDetail)[0].type, 'markdown');
  assert.equal(allSections(rawUserDetail)[0].hideTitle, true);
  assert.match(allSections(rawUserDetail)[0].html, /<h1>Fix the alpha parser regression<\/h1>/);
  assert.equal(allSections(rawUserDetail).find((section) => section.type === 'kv').entries.some((entry) => entry.key === 'message'), false);
  assert.equal(allSections(rawUserDetail).at(-1).type, 'raw_json');
  assert.equal(allSections(rawUserDetail).at(-1).expanded, true);

  const rawEnvironmentRecord = session.rawEvents.find((raw) => raw.messageText.startsWith('<environment_context>'));
  const rawEnvironmentDetail = buildEventDetail(session, rawEnvironmentRecord.rawId, 'raw');
  assert.equal(allSections(rawEnvironmentDetail)[0].type, 'kv');
  assert.equal(allSections(rawEnvironmentDetail)[0].title, 'Protocol fields');
  assert.equal(allSections(rawEnvironmentDetail).some((section) => section.title === 'Message'), false);

  const rawCommandCall = session.rawEvents.find((raw) => raw.payloadType === 'function_call' && raw.toolName === 'shell_command');
  const rawCommandCallDetail = buildEventDetail(session, rawCommandCall.rawId, 'raw');
  assert.equal(allSections(rawCommandCallDetail)[0].type, 'code');
  assert.equal(allSections(rawCommandCallDetail)[0].title, 'Command');
  assert.equal(allSections(rawCommandCallDetail).some((section) => section.title === 'Payload'), false);

  const rawPatchCall = session.rawEvents.find((raw) => raw.payloadType === 'custom_tool_call' && raw.toolName === 'apply_patch');
  const rawPatchCallDetail = buildEventDetail(session, rawPatchCall.rawId, 'raw');
  assert.equal(allSections(rawPatchCallDetail)[0].type, 'patch');
  assert.equal(allSections(rawPatchCallDetail)[0].title, 'Patch');
  assert.equal(allSections(rawPatchCallDetail).some((section) => section.title === 'Payload'), false);

  const rawPatchEnd = session.rawEvents.find((raw) => raw.payloadType === 'patch_apply_end');
  const rawPatchEndDetail = buildEventDetail(session, rawPatchEnd.rawId, 'raw');
  assert.equal(allSections(rawPatchEndDetail)[0].type, 'patch');
  assert.equal(allSections(rawPatchEndDetail).some((section) => section.title === 'Result'), true);
});

test('object-shaped protocol and tool fields stay readable', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const dir = path.join(codexHome, 'sessions', '2026', '05', '27');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const file = path.join(dir, `rollout-2026-05-27T10-00-00-${id}.jsonl`);
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-05-27T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-27T10:00:00.500Z',
      payload: {
        type: 'thread_goal_updated',
        thread_id: 'thread-1',
        goal: {
          objective: 'Analyze object-shaped events',
          status: 'active',
          token_budget: 5000,
          tokens_used: 120,
          time_used_seconds: 12,
          created_at: 100,
          updated_at: 112,
        },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-27T10:00:00.700Z',
      payload: {
        type: 'entered_review_mode',
        target: {
          type: 'custom',
          instructions: { text: 'Review structured target' },
        },
        user_facing_hint: { text: 'Check object fields' },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-27T10:00:00.800Z',
      payload: {
        type: 'exited_review_mode',
        review_output: {
          overall_correctness: { text: 'patch is correct' },
          overall_confidence_score: { text: 'high' },
          overall_explanation: { text: 'No object coercion remains.' },
          findings: [{
            title: { text: 'Structured finding' },
            body: { text: 'Finding body is readable.' },
            priority: { text: '1' },
            confidence_score: { text: '0.95' },
            location: {
              path: { text: 'src/codex.js' },
              line_range: { start: 10, end: 12 },
            },
          }],
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-27T10:00:01.000Z',
      payload: {
        type: 'function_call',
        name: 'view_image',
        call_id: 'call-view-image',
        arguments: { path: 'G:\\vibe\\session-analyzer\\output\\image.png' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-27T10:00:01.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-view-image',
        output: { width: 640, height: 480, mimeType: 'image/png' },
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const event = session.logicalEvents.find((candidate) => candidate.toolName === 'view_image');
  const goalEvent = session.logicalEvents.find((candidate) => candidate.subtype === 'thread_goal_updated');
  const reviewStarted = session.logicalEvents.find((candidate) => candidate.subtype === 'entered_review_mode');
  const reviewFinished = session.logicalEvents.find((candidate) => candidate.subtype === 'exited_review_mode');
  const detail = buildEventDetail(session, event.id, 'main');
  const goalDetail = buildEventDetail(session, goalEvent.id, 'main');
  const goalUsage = goalDetail.timelineSections.find((section) => section.title === 'Goal usage');
  const request = detail.inspectorSections.find((section) => section.title === 'Request');
  const response = detail.inspectorSections.find((section) => section.title === 'Response');
  const imagePreview = detail.inspectorSections.find((section) => section.type === 'image_preview');
  const reviewStartedDetail = buildEventDetail(session, reviewStarted.id, 'main');
  const reviewFinishedDetail = buildEventDetail(session, reviewFinished.id, 'main');
  const reviewRequest = allSections(reviewStartedDetail).find((section) => section.title === 'Review request');
  const reviewResult = allSections(reviewFinishedDetail).find((section) => section.title === 'Review result');
  const reviewFindings = allSections(reviewFinishedDetail).find((section) => section.title === 'Findings');

  assert.equal(event.preview.includes('[object Object]'), false);
  assert.equal(goalEvent.preview.includes('[object Object]'), false);
  assert.equal(reviewStarted.preview.includes('[object Object]'), false);
  assert.equal(reviewFinished.preview.includes('[object Object]'), false);
  assert.match(goalEvent.preview, /Analyze object-shaped events/);
  assert.equal(goalEvent.kind, 'goal');
  assert.equal(goalEvent.layer, 'main');
  assert.match(goalEvent.preview, /budget: 5000/);
  assert.match(goalEvent.preview, /tokens: 120/);
  assert.equal(goalDetail.timelineSections[0].title, 'Goal');
  assert.match(goalDetail.timelineSections[0].html, /Analyze object-shaped events/);
  assert.match(goalDetail.timelineSections[0].html, /Token budget:<\/strong> 5000/);
  assert.deepEqual(goalUsage.entries, [
    { key: 'Status', value: 'Active' },
    { key: 'Token budget', value: '5000' },
    { key: 'Tokens used', value: '120' },
    { key: 'Time used', value: '12s' },
    { key: 'Created', value: '100' },
    { key: 'Updated', value: '112' },
  ]);
  assert.equal(goalDetail.inspectorSections[0].title, 'Goal status');
  assert.equal(goalDetail.inspectorSections[0].value.status, 'active');
  assert.equal(goalDetail.inspectorSections[0].value.token_budget, 5000);
  assert.equal(request.type, 'json');
  assert.equal(request.value.path, 'G:\\vibe\\session-analyzer\\output\\image.png');
  assert.equal(response.type, 'json');
  assert.deepEqual(response.value, { width: 640, height: 480, mimeType: 'image/png' });
  assert.deepEqual(imagePreview.images, []);
  assert.match(imagePreview.notice, /unavailable/);
  assert.equal(detail.timelineSections[0].type, 'markdown');
  assert.match(detail.timelineSections[0].html, /Image inspection/);
  assert.match(detail.timelineSections[0].html, /G:\\vibe\\session-analyzer\\output\\image\.png/);
  assert.match(detail.timelineSections[0].html, /640 x 480/);
  assert.match(detail.timelineSections[0].html, /image\/png/);
  assert.deepEqual(reviewRequest.entries, [
    { key: 'Status', value: 'Started' },
    { key: 'Target', value: 'Custom: Review structured target' },
    { key: 'Hint', value: 'Check object fields' },
  ]);
  assert.equal(reviewResult.entries.some((entry) => String(entry.value).includes('[object Object]')), false);
  assert.deepEqual(reviewResult.entries.slice(0, 3), [
    { key: 'Status', value: 'Completed' },
    { key: 'Correctness', value: 'patch is correct' },
    { key: 'Confidence', value: 'high' },
  ]);
  assert.equal(reviewFindings.html.includes('[object Object]'), false);
  assert.match(reviewFindings.html, /Structured finding/);
  assert.match(reviewFindings.html, /P1/);
  assert.match(reviewFindings.html, /confidence 0\.95/);
  assert.match(reviewFindings.html, /src\/codex\.js:lines 10-12/);
});

test('goal context stays protocol while goal tool lifecycle is readable on main timeline', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repo = path.join(codexHome, 'repo');
  const id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const dir = path.join(codexHome, 'sessions', '2026', '06', '10');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repo, { recursive: true });
  const file = path.join(dir, `rollout-2026-06-10T10-00-00-${id}.jsonl`);
  const objective = 'Ship goal cards without exposing internal audit text.';
  const goalContext = `<codex_internal_context source="goal">
Continue working toward the active thread goal.

<objective>
${objective}
</objective>

Budget:
- Tokens used: 12
- Token budget: none
</codex_internal_context>`;
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-06-10T10:00:00.000Z',
      payload: { id, cwd: repo },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-10T10:00:01.000Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: goalContext }],
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T10:00:01.100Z',
      payload: {
        type: 'thread_goal_updated',
        threadId: id,
        goal: {
          threadId: id,
          objective,
          status: 'active',
          tokenBudget: 100000,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1781102515,
          updatedAt: 1781102515,
        },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T10:00:01.200Z',
      payload: {
        type: 'thread_goal_updated',
        threadId: id,
        goal: {
          threadId: id,
          objective,
          status: 'active',
          tokenBudget: 100000,
          tokensUsed: 12,
          timeUsedSeconds: 1,
          createdAt: 1781102515,
          updatedAt: 1781102516,
        },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T10:00:01.300Z',
      payload: {
        type: 'thread_goal_updated',
        threadId: id,
        goal: {
          threadId: id,
          objective,
          status: 'active',
          tokenBudget: 200000,
          tokensUsed: 12,
          timeUsedSeconds: 1,
          createdAt: 1781102515,
          updatedAt: 1781102517,
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-10T10:00:02.000Z',
      payload: {
        type: 'function_call',
        name: 'update_goal',
        arguments: JSON.stringify({ status: 'complete' }),
        call_id: 'call-goal-complete',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-10T10:00:02.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-goal-complete',
        output: JSON.stringify({
          goal: {
            threadId: id,
            objective,
            status: 'complete',
            createdAt: 1781102515,
            updatedAt: 1781102876,
          },
          remainingTokens: null,
          completionBudgetReport: { finalTokenUsage: 132017 },
        }),
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-10T10:00:02.200Z',
      payload: {
        type: 'thread_goal_updated',
        threadId: id,
        goal: {
          threadId: id,
          objective,
          status: 'complete',
          tokenBudget: 200000,
          tokensUsed: 132017,
          timeUsedSeconds: 361,
          createdAt: 1781102515,
          updatedAt: 1781102876,
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-10T10:00:03.000Z',
      payload: {
        type: 'function_call',
        name: 'update_goal',
        arguments: JSON.stringify({ status: 'blocked' }),
        call_id: 'call-goal-blocked',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-10T10:00:03.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-goal-blocked',
        output: JSON.stringify({
          goal: {
            threadId: id,
            objective: 'Wait for external service access.',
            status: 'blocked',
            tokensUsed: 150,
            timeUsedSeconds: 30,
          },
        }),
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-10T10:00:04.000Z',
      payload: {
        type: 'function_call',
        name: 'create_goal',
        arguments: JSON.stringify({ objective: 'Interrupted goal create.' }),
        call_id: 'call-goal-create-incomplete',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-10T10:00:05.000Z',
      payload: {
        type: 'function_call',
        name: 'update_goal',
        arguments: JSON.stringify({ status: 'complete' }),
        call_id: 'call-goal-update-incomplete',
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot: repo, codexHome });
  const session = index.sessionsById.get(id);
  const mainTimeline = getTimeline(index, id, { layer: 'main', offset: 0, limit: 20, q: '', kind: '', status: '', tool: '', file: '' });
  const protocolTimeline = getTimeline(index, id, { layer: 'protocol', offset: 0, limit: 20, q: '', kind: '', status: '', tool: '', file: '' });
  const goalContextEvent = protocolTimeline.events.find((event) => event.subtype === 'goal_context');
  const goalHeartbeatEvent = protocolTimeline.events.find((event) => event.subtype === 'thread_goal_updated');
  const goalEvents = mainTimeline.events.filter((event) => event.kind === 'goal');
  const complete = goalEvents.find((event) => event.status === 'complete');
  const blocked = goalEvents.find((event) => event.status === 'blocked');
  const budgetUpdate = goalEvents.find((event) => event.subtype === 'thread_goal_updated' && event.label === 'Goal updated');
  const incomplete = goalEvents.filter((event) => event.status === 'incomplete');
  const incompleteUpdate = incomplete.find((event) => event.toolName === 'update_goal');
  const detail = buildEventDetail(session, complete.id, 'main');
  const detailUsage = detail.timelineSections.find((section) => section.title === 'Goal usage');
  const budgetUpdateDetail = buildEventDetail(session, budgetUpdate.id, 'main');
  const budgetUpdateUsage = budgetUpdateDetail.timelineSections.find((section) => section.title === 'Goal usage');
  const incompleteUpdateDetail = buildEventDetail(session, incompleteUpdate.id, 'main');
  const protocolDetail = buildEventDetail(session, goalContextEvent.id, 'protocol');

  assert.ok(goalContextEvent);
  assert.equal(goalContextEvent.label, 'Goal context');
  assert.match(goalContextEvent.preview, /Ship goal cards/);
  assert.equal(mainTimeline.events.some((event) => event.rawRefs.some((ref) => ref.line === 2)), false);
  assert.ok(goalHeartbeatEvent);
  assert.deepEqual(goalHeartbeatEvent.rawRefs.map((ref) => ref.line), [4]);
  assert.equal(mainTimeline.events.some((event) => event.rawRefs.some((ref) => ref.line === 4)), false);
  assert.equal(goalEvents.length, 6);
  assert.equal(goalEvents[0].label, 'Goal created');
  assert.equal(goalEvents[0].subtype, 'thread_goal_updated');
  assert.match(budgetUpdate.preview, /budget: 200000/);
  assert.match(budgetUpdateDetail.timelineSections[0].html, /Token budget:<\/strong> 200000/);
  assert.equal(budgetUpdateUsage.entries.some((entry) => entry.key === 'Token budget' && entry.value === '200000'), true);
  assert.equal(complete.label, 'Goal complete');
  assert.equal(complete.toolName, 'update_goal');
  assert.equal(complete.rawRefs.length, 3);
  assert.match(complete.preview, /complete/);
  assert.match(complete.preview, /budget: 200000/);
  assert.match(complete.preview, /Ship goal cards/);
  assert.equal(blocked.label, 'Goal blocked');
  assert.equal(blocked.severity, 'warning');
  assert.equal(incomplete.length, 2);
  assert.ok(incomplete.every((event) => event.label === 'Incomplete goal call'));
  assert.ok(incomplete.every((event) => event.severity === 'warning'));
  assert.equal(incomplete.some((event) => event.preview.includes('active')), false);
  assert.match(incompleteUpdateDetail.timelineSections[0].html, /Status:<\/strong> Incomplete/);
  assert.doesNotMatch(incompleteUpdateDetail.timelineSections[0].html, /Objective/);
  assert.doesNotMatch(incompleteUpdateDetail.timelineSections[0].html, /incomplete<\/p>/);
  assert.equal(session.counts.toolCalls, 4);
  assert.ok(mainTimeline.eventKinds.main.some((item) => item.value === 'goal'));
  assert.ok(EDITABLE_EVENT_KINDS.includes('goal'));
  assert.equal(foldingProfiles.find((profile) => profile.id === 'planning').rules.kindStates.goal, 'expanded');
  assert.equal(detail.timelineSections.some((section) => section.title === 'Goal'), true);
  assert.equal(detail.timelineSections.some((section) => section.title === 'Goal usage'), true);
  assert.equal(detailUsage.entries.some((entry) => entry.key === 'Token budget' && entry.value === '200000'), true);
  assert.equal(detailUsage.entries.some((entry) => entry.key === 'Remaining tokens' && entry.value === 'Unbounded'), true);
  assert.equal(detail.timelineSections.some((section) => section.title === 'Completion budget'), true);
  assert.equal(detail.inspectorSections.some((section) => section.title === 'Request'), true);
  assert.equal(detail.inspectorSections.some((section) => section.title === 'Response'), true);
  assert.equal(protocolDetail.timelineSections.some((section) => section.title === 'Goal objective'), true);
});

test('other tool call detail renders readable summaries and omits large data URLs', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const longPrompt = `Start prompt ${'x'.repeat(5000)} End prompt`;
  const longResult = `Start result ${'y'.repeat(5000)} End result`;
  const dir = path.join(codexHome, 'sessions', '2026', '05', '28');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const file = path.join(dir, `rollout-2026-05-28T10-00-00-${id}.jsonl`);
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-05-28T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:01.000Z',
      payload: {
        type: 'function_call',
        name: 'request_user_input',
        call_id: 'call-question',
        arguments: {
          questions: [{
            id: 'display_mode',
            header: 'Display',
            question: 'Which display mode should be used?',
            options: [{ label: 'Timeline', description: 'Show readable timeline detail.' }],
          }],
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:01.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-question',
        output: { answers: { display_mode: { answers: ['Timeline'] } } },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.000Z',
      payload: {
        type: 'function_call',
        name: 'wait_agent',
        call_id: 'call-wait',
        arguments: { targets: ['agent-1'], timeout_ms: 120000 },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-28T10:00:02.100Z',
      payload: {
        type: 'collab_waiting_end',
        call_id: 'call-wait',
        agent_statuses: [{ thread_id: 'agent-1', agent_nickname: 'Builder', status: { completed: longResult } }],
        statuses: { 'agent-1': { completed: longResult } },
        timed_out: true,
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.200Z',
      payload: {
        type: 'function_call',
        name: 'spawn_agent',
        call_id: 'call-spawn',
        arguments: { agent_type: 'worker', model: 'gpt-test', reasoning_effort: 'medium', fork_context: true, message: longPrompt },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-28T10:00:02.300Z',
      payload: {
        type: 'collab_agent_spawn_end',
        call_id: 'call-spawn',
        new_thread_id: 'agent-2',
        new_agent_nickname: 'Builder',
        status: 'pending_init',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.400Z',
      payload: {
        type: 'function_call',
        name: 'send_input',
        call_id: 'call-send',
        arguments: { target: 'agent-2', message: longPrompt },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-28T10:00:02.500Z',
      payload: {
        type: 'collab_agent_interaction_end',
        call_id: 'call-send',
        receiver_thread_id: 'agent-2',
        receiver_agent_nickname: 'Builder',
        status: 'running',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.600Z',
      payload: {
        type: 'function_call',
        name: 'close_agent',
        call_id: 'call-close',
        arguments: { target: 'agent-2' },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-28T10:00:02.700Z',
      payload: {
        type: 'collab_close_end',
        call_id: 'call-close',
        status: { completed: longResult },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.710Z',
      payload: {
        type: 'function_call',
        name: 'spawn_agent',
        call_id: 'call-spawn-output',
        arguments: { agent_type: 'reviewer', message: 'Review the patch.' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.720Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-spawn-output',
        output: { agent_id: 'agent-3', nickname: 'Reviewer' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.730Z',
      payload: {
        type: 'function_call',
        name: 'wait_agent',
        call_id: 'call-wait-output',
        arguments: { targets: ['agent-3'], timeout_ms: 60000 },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.740Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-wait-output',
        output: { status: { 'agent-3': { completed: 'Function result' } }, timed_out: false },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.750Z',
      payload: {
        type: 'function_call',
        name: 'close_agent',
        call_id: 'call-close-output',
        arguments: { target: 'agent-3' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.760Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-close-output',
        output: { previous_status: { completed: 'Previous result' } },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.770Z',
      payload: {
        type: 'function_call',
        name: 'list_agents',
        call_id: 'call-list-output',
        arguments: {},
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.780Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-list-output',
        output: {
          agents: [
            { agent_name: 'Builder', agent_status: 'running', last_task_message: 'Implement the fix.' },
            { agent_name: 'Reviewer', agent_status: 'completed', last_task_message: 'Review complete.' },
          ],
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.790Z',
      payload: {
        type: 'function_call',
        name: 'send_message',
        call_id: 'call-send-fallback',
        arguments: { target: 'agent-3', message: 'Continue.' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.795Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-send-fallback',
        output: { delivery_receipt: 'receipt-1' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.800Z',
      payload: {
        type: 'function_call',
        name: 'view_image',
        call_id: 'call-image',
        arguments: { path: 'G:\\repo\\preview.png', detail: 'high' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:02.900Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-image',
        output: [
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'high' },
          { type: 'input_image', image_url: 'data:text/html;base64,PHNjcmlwdD4=', detail: 'high' },
        ],
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-28T10:00:03.000Z',
      payload: {
        type: 'dynamic_tool_call_begin',
        call_id: 'call-dynamic',
        tool_name: 'asset_lookup',
        request: { query: 'timeline image', image_url: 'data:image/png;base64,request-image-payload' },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-28T10:00:03.100Z',
      payload: {
        type: 'dynamic_tool_call_end',
        call_id: 'call-dynamic',
        tool_name: 'asset_lookup',
        result: { image_url: 'data:image/png;base64,very-large-image-payload', count: 1 },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:03.200Z',
      payload: {
        type: 'function_call',
        name: 'view_image',
        call_id: 'call-image-error',
        arguments: { path: 'G:\\repo\\missing.png' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-28T10:00:03.300Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-image-error',
        output: 'image decode failed',
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const question = session.logicalEvents.find((event) => event.toolName === 'request_user_input');
  const wait = session.logicalEvents.find((event) => event.toolName === 'wait_agent');
  const spawn = session.logicalEvents.find((event) => event.toolName === 'spawn_agent');
  const send = session.logicalEvents.find((event) => event.toolName === 'send_input');
  const close = session.logicalEvents.find((event) => event.toolName === 'close_agent');
  const image = session.logicalEvents.find((event) => event.toolName === 'view_image');
  const dynamic = session.logicalEvents.find((event) => event.toolName === 'asset_lookup');
  const imageError = session.logicalEvents.find((event) => event.id.includes('call-image-error'));
  const spawnOutput = session.logicalEvents.find((event) => event.id.includes('call-spawn-output'));
  const waitOutput = session.logicalEvents.find((event) => event.id.includes('call-wait-output'));
  const closeOutput = session.logicalEvents.find((event) => event.id.includes('call-close-output'));
  const listOutput = session.logicalEvents.find((event) => event.id.includes('call-list-output'));
  const sendFallback = session.logicalEvents.find((event) => event.id.includes('call-send-fallback'));
  const questionDetail = buildEventDetail(session, question.id, 'main');
  const waitDetail = buildEventDetail(session, wait.id, 'main');
  const spawnDetail = buildEventDetail(session, spawn.id, 'main');
  const sendDetail = buildEventDetail(session, send.id, 'main');
  const closeDetail = buildEventDetail(session, close.id, 'main');
  const imageDetail = buildEventDetail(session, image.id, 'main');
  const dynamicDetail = buildEventDetail(session, dynamic.id, 'main');
  const imageErrorDetail = buildEventDetail(session, imageError.id, 'main');
  const spawnOutputDetail = buildEventDetail(session, spawnOutput.id, 'main');
  const waitOutputDetail = buildEventDetail(session, waitOutput.id, 'main');
  const closeOutputDetail = buildEventDetail(session, closeOutput.id, 'main');
  const listOutputDetail = buildEventDetail(session, listOutput.id, 'main');
  const sendFallbackDetail = buildEventDetail(session, sendFallback.id, 'main');

  assert.equal(questionDetail.timelineSections[0].type, 'user_input');
  assert.equal(questionDetail.timelineSections[0].questions[0].prompt, 'Which display mode should be used?');
  assert.deepEqual(questionDetail.timelineSections[0].questions[0].options, [
    { label: 'Timeline', description: 'Show readable timeline detail.', selected: true },
  ]);
  assert.deepEqual(questionDetail.timelineSections[0].questions[0].answers, ['Timeline']);
  assert.equal(wait.label, 'Collab Waiting End');
  assert.equal(waitDetail.timelineSections[0].type, 'collaboration');
  assert.deepEqual(waitDetail.timelineSections[0].targets, ['agent-1']);
  assert.deepEqual(waitDetail.timelineSections[0].statuses, [{ label: 'Builder', status: 'completed' }]);
  assert.equal(waitDetail.timelineSections[0].timedOut, true);
  assert.match(waitDetail.timelineSections[0].resultHtml, /Builder · completed/);
  assert.match(waitDetail.timelineSections[0].resultHtml, /End result/);
  assert.equal(spawnDetail.timelineSections[0].type, 'collaboration');
  assert.match(spawnDetail.timelineSections[0].messageHtml, /End prompt/);
  assert.deepEqual(spawnDetail.timelineSections[0].targets, ['agent-2']);
  assert.deepEqual(spawnDetail.timelineSections[0].fields.find((field) => field.key === 'Nickname'), { key: 'Nickname', value: 'Builder' });
  assert.deepEqual(spawnDetail.timelineSections[0].statuses, [{ label: 'Status', status: 'pending_init' }]);
  assert.equal(sendDetail.timelineSections[0].type, 'collaboration');
  assert.match(sendDetail.timelineSections[0].messageHtml, /End prompt/);
  assert.deepEqual(sendDetail.timelineSections[0].statuses, [{ label: 'Status', status: 'running' }]);
  assert.equal(closeDetail.timelineSections[0].type, 'collaboration');
  assert.match(closeDetail.timelineSections[0].resultHtml, /End result/);
  assert.deepEqual(closeDetail.timelineSections[0].statuses, [{ label: 'Status', status: 'completed' }]);
  assert.deepEqual(spawnOutputDetail.timelineSections[0].targets, ['agent-3']);
  assert.deepEqual(spawnOutputDetail.timelineSections[0].fields.find((field) => field.key === 'Nickname'), { key: 'Nickname', value: 'Reviewer' });
  assert.deepEqual(waitOutputDetail.timelineSections[0].statuses, [{ label: 'agent-3', status: 'completed' }]);
  assert.match(waitOutputDetail.timelineSections[0].resultHtml, /agent-3 · completed/);
  assert.match(waitOutputDetail.timelineSections[0].resultHtml, /Function result/);
  assert.deepEqual(closeOutputDetail.timelineSections[0].statuses, [{ label: 'Previous status', status: 'completed' }]);
  assert.match(closeOutputDetail.timelineSections[0].resultHtml, /Previous result/);
  assert.deepEqual(listOutputDetail.timelineSections[0].fields.find((field) => field.key === 'Agent count'), { key: 'Agent count', value: '2' });
  assert.deepEqual(listOutputDetail.timelineSections[0].statuses, [
    { label: 'Builder', status: 'running' },
    { label: 'Reviewer', status: 'completed' },
  ]);
  assert.match(listOutputDetail.timelineSections[0].resultHtml, /Implement the fix/);
  assert.match(listOutputDetail.timelineSections[0].resultHtml, /Review complete/);
  assert.equal(listOutputDetail.timelineSections.some((section) => section.title === 'Response summary'), false);
  assert.equal(sendFallbackDetail.timelineSections[0].type, 'collaboration');
  assert.deepEqual(sendFallbackDetail.timelineSections[1], {
    type: 'code',
    title: 'Response summary',
    language: 'json',
    code: '{\n  "delivery_receipt": "receipt-1"\n}',
  });
  assert.equal(imageDetail.timelineSections[0].type, 'markdown');
  assert.match(imageDetail.timelineSections[0].html, /Image inspection/);
  assert.deepEqual(imageDetail.inspectorSections.find((section) => section.type === 'image_preview').images, [
    {
      previewId: 'image-23-0',
      src: `/api/sessions/${id}/events/${encodeURIComponent(image.id)}/image-previews/image-23-0`,
      mimeType: 'image/png',
      estimatedBytes: 5,
      detail: 'high',
      alt: 'Image preview 1',
    },
  ]);
  assert.deepEqual(imageDetail.inspectorSections.find((section) => section.title === 'Response').value, [
    { type: 'input_image', image_url: '[embedded image payload externalized; open raw refs for source]', detail: 'high' },
    { type: 'input_image', image_url: '[embedded data URL omitted; see raw refs]', detail: 'high' },
  ]);
  assert.deepEqual(dynamicDetail.timelineSections.map((section) => section.title), ['Request summary', 'Response summary']);
  assert.equal(dynamicDetail.timelineSections[0].type, 'code');
  assert.match(dynamicDetail.timelineSections[0].code, /timeline image/);
  assert.match(dynamicDetail.timelineSections[1].code, /\[embedded image payload externalized; open raw refs for source\]/);
  assert.doesNotMatch(dynamicDetail.timelineSections[1].code, /very-large-image-payload/);
  assert.equal(dynamicDetail.inspectorSections.find((section) => section.title === 'Request').value.request.image_url, '[embedded image payload externalized; open raw refs for source]');
  assert.equal(dynamicDetail.inspectorSections.find((section) => section.title === 'Response').value.result.image_url, '[embedded image payload externalized; open raw refs for source]');
  assert.deepEqual(imageErrorDetail.timelineSections.map((section) => section.type), ['markdown', 'code']);
  assert.match(imageErrorDetail.timelineSections[1].code, /image decode failed/);
});

test('other tool call sanitization covers structured cards, embedded URLs, object keys, and preview limits', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const embeddedUrl = 'data:text/plain,private-payload';
  const encodedUrl = 'data:text/plain,encoded%20private%20payload';
  const wrappedGenericUrl = 'data:text/plain,wrapped-private-payload\twrapped-private-tail';
  const multilineBase64Url = 'data:image/png;base64,AAAA\nBBBB\nCCCC';
  const spacedBase64Url = 'data:image/png;base64,DDDD EEEE\tFFFF';
  const malformedRasterUrl = 'data:image/png;base64,AAAA%%%%malformed-image-secret';
  const malformedLeadingRasterUrl = 'data:image/png;base64,%%%%leading-image-secret';
  const malformedGenericUrl = 'data:text/plain;base64,%%%%generic-secret';
  const previewUrls = Array.from({ length: 10 }, (_, index) => `data:image/png;base64,${Buffer.from(`image-${index}`).toString('base64')}`);
  const dir = path.join(codexHome, 'sessions', '2026', '05', '29');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const file = path.join(dir, `rollout-2026-05-29T10-00-00-${id}.jsonl`);
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-05-29T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:01.000Z',
      payload: {
        type: 'function_call',
        name: 'request_user_input',
        call_id: 'call-question-sensitive',
        arguments: {
          questions: [{
            id: 'display_mode',
            header: `Display ${embeddedUrl} after`,
            question: `Choose before ${embeddedUrl} after`,
            options: [{ label: 'Timeline', description: `Readable ${embeddedUrl} after` }],
          }],
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:01.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-question-sensitive',
        output: { answers: { display_mode: { answers: ['Timeline'] } } },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:02.000Z',
      payload: {
        type: 'function_call',
        name: 'send_input',
        call_id: 'call-send-sensitive',
        arguments: { target: 'agent-sensitive', message: `Message before ${embeddedUrl} after` },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-29T10:00:02.100Z',
      payload: {
        type: 'collab_agent_interaction_end',
        call_id: 'call-send-sensitive',
        receiver_thread_id: 'agent-sensitive',
        status: 'running',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:03.000Z',
      payload: {
        type: 'function_call',
        name: 'update_plan',
        call_id: 'call-plan-sensitive',
        arguments: {
          explanation: `Plan before ${embeddedUrl} after`,
          plan: [{ step: `Inspect ${embeddedUrl} after`, status: 'in_progress' }],
        },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:03.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-plan-sensitive',
        output: `Plan response before ${embeddedUrl} after`,
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-29T10:00:04.000Z',
      payload: {
        type: 'dynamic_tool_call_begin',
        call_id: 'call-dynamic-sensitive',
        tool_name: 'asset_lookup',
        request: {
          [`field-${embeddedUrl}`]: `Request before ${embeddedUrl} after`,
          [embeddedUrl]: 'first redacted-key value',
          'data:text/plain,second-private-payload': 'second redacted-key value',
          multiline: `Request before (${multilineBase64Url}) after`,
          spaced: `Request before (${spacedBase64Url}) after`,
          malformedRaster: `Request before (${malformedRasterUrl}) after`,
          malformedLeadingRaster: `Request before ${malformedLeadingRasterUrl} after`,
          malformedGeneric: `Request before ${malformedGenericUrl} after`,
          encoded: `Request before ${encodedUrl} after`,
          wrappedGeneric: 'Request before ' + wrappedGenericUrl + ' after',
          uppercaseWrappedGeneric: 'Request before data:text/plain,SECRET\tLEAKED after',
          percentWrappedGeneric: 'Request before data:text/plain,SECRET\tencoded%20tail after',
          ordinaryAfterNewline: 'Request before data:text/plain,SECRET\nnavigation needle',
          ordinaryAfterTab: 'Request before data:text/plain,SECRET\tnavigation needle',
          ordinarySlash: 'Request before data:text/plain,SECRET\ninput/output remains',
          ordinaryUnderscore: 'Request before data:text/plain,SECRET\nnavigation_needle remains',
          ordinaryUrl: 'Request before data:text/plain,SECRET\nhttps://example.test/path remains',
          multiple: `Request before ${embeddedUrl} middle ${encodedUrl} after`,
          ordinary: 'metadata:value',
        },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-29T10:00:04.100Z',
      payload: {
        type: 'dynamic_tool_call_end',
        call_id: 'call-dynamic-sensitive',
        tool_name: 'asset_lookup',
        result: { message: `Response before (${multilineBase64Url}) after`, ordinary: 'metadata:value' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:05.000Z',
      payload: {
        type: 'function_call',
        name: 'view_image',
        call_id: 'call-image-sensitive',
        arguments: { path: 'G:\\repo\\missing.png' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:05.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-image-sensitive',
        output: `Decode failed before ${embeddedUrl} after ${'x'.repeat(5000)}`,
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:06.000Z',
      payload: {
        type: 'function_call',
        name: 'view_image',
        call_id: 'call-image-many',
        arguments: { path: 'G:\\repo\\many.png', detail: 'high' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-29T10:00:06.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-image-many',
        output: [...previewUrls.map((image_url) => ({ type: 'input_image', image_url })), { type: 'input_image', image_url: previewUrls[0] }],
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-29T10:00:07.000Z',
      payload: {
        type: 'dynamic_tool_call_begin',
        call_id: 'call-envelope-sensitive',
        tool_name: 'data:text/plain,tool-secret',
        turn_id: 'data:text/plain,turn-secret',
        request: { ok: true },
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-05-29T10:00:07.100Z',
      payload: {
        type: 'dynamic_tool_call_end',
        call_id: 'call-envelope-sensitive',
        tool_name: 'data:text/plain,tool-secret',
        turn_id: 'data:text/plain,turn-secret',
        result: { ok: true },
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const detailFor = (callId) => {
    const event = session.logicalEvents.find((candidate) => candidate.id.includes(callId));
    return { event, detail: buildEventDetail(session, event.id, 'main') };
  };
  const question = detailFor('call-question-sensitive');
  const send = detailFor('call-send-sensitive');
  const plan = detailFor('call-plan-sensitive');
  const dynamic = detailFor('call-dynamic-sensitive');
  const image = detailFor('call-image-sensitive');
  const manyImages = detailFor('call-image-many');
  const envelope = detailFor('call-envelope-sensitive');

  for (const { event, detail } of [question, send, plan, dynamic, image, envelope]) {
    assert.doesNotMatch(JSON.stringify(event), /private-payload/);
    assert.doesNotMatch(JSON.stringify(detail), /private-payload/);
  }
  assert.match(question.detail.timelineSections[0].questions[0].prompt, /before \[embedded data URL omitted; see raw refs\] after/);
  assert.match(send.detail.timelineSections[0].messageHtml, /before \[embedded data URL omitted; see raw refs\] after/);
  assert.deepEqual(plan.detail.timelineSections.map((section) => section.type), ['plan_update', 'code']);
  assert.match(plan.detail.timelineSections[0].explanationHtml, /before \[embedded data URL omitted; see raw refs\] after/);
  assert.match(plan.detail.timelineSections[0].steps[0].step, /Inspect \[embedded data URL omitted; see raw refs\] after/);
  assert.match(plan.detail.timelineSections[1].code, /response before \[data URL omitted\] after/);
  assert.match(JSON.stringify(plan.detail.inspectorSections), /\[embedded data URL omitted; see raw refs\]/);
  assert.match(JSON.stringify(dynamic.detail.timelineSections), /\[data URL omitted\]/);
  assert.match(JSON.stringify(dynamic.detail.inspectorSections), /field-\[embedded data URL omitted; see raw refs\]/);
  assert.match(JSON.stringify(dynamic.detail.inspectorSections), /metadata:value/);
  const dynamicRequest = dynamic.detail.inspectorSections.find((section) => section.title === 'Request').value.request;
  assert.equal(dynamicRequest['[embedded data URL omitted; see raw refs]'], 'first redacted-key value');
  assert.equal(dynamicRequest['[embedded data URL omitted; see raw refs] #2'], 'second redacted-key value');
  assert.equal(dynamicRequest.multiline, 'Request before ([embedded image payload externalized; open raw refs for source]) after');
  assert.equal(dynamicRequest.spaced, 'Request before ([embedded image payload externalized; open raw refs for source]) after');
  assert.equal(dynamicRequest.malformedRaster, 'Request before ([embedded image payload externalized; open raw refs for source]) after');
  assert.equal(dynamicRequest.malformedLeadingRaster, 'Request before [embedded image payload externalized; open raw refs for source] after');
  assert.equal(dynamicRequest.malformedGeneric, 'Request before [embedded data URL omitted; see raw refs] after');
  assert.equal(dynamicRequest.encoded, 'Request before [embedded data URL omitted; see raw refs] after');
  assert.equal(dynamicRequest.wrappedGeneric, 'Request before [embedded data URL omitted; see raw refs]\twrapped-private-tail after');
  assert.equal(dynamicRequest.uppercaseWrappedGeneric, 'Request before [embedded data URL omitted; see raw refs] after');
  assert.equal(dynamicRequest.percentWrappedGeneric, 'Request before [embedded data URL omitted; see raw refs] after');
  assert.equal(dynamicRequest.ordinaryAfterNewline, 'Request before [embedded data URL omitted; see raw refs]\nnavigation needle');
  assert.equal(dynamicRequest.ordinaryAfterTab, 'Request before [embedded data URL omitted; see raw refs]\tnavigation needle');
  assert.equal(dynamicRequest.ordinarySlash, 'Request before [embedded data URL omitted; see raw refs]\ninput/output remains');
  assert.equal(dynamicRequest.ordinaryUnderscore, 'Request before [embedded data URL omitted; see raw refs]\nnavigation_needle remains');
  assert.equal(dynamicRequest.ordinaryUrl, 'Request before [embedded data URL omitted; see raw refs]\nhttps://example.test/path remains');
  assert.equal(dynamicRequest.multiple, 'Request before [embedded data URL omitted; see raw refs] middle [embedded data URL omitted; see raw refs] after');
  assert.doesNotMatch(JSON.stringify(dynamic.detail), /AAAA|BBBB|CCCC|DDDD|EEEE|FFFF|encoded%20private/);
  assert.doesNotMatch(JSON.stringify(dynamic.detail), /wrapped-private-payload|encoded%20tail/);
  assert.doesNotMatch(JSON.stringify(dynamic.detail), /SECRET|LEAKED/);
  for (const query of ['navigation needle', 'input/output', 'navigation_needle', 'https://example.test/path']) {
    const preservedTextSearch = getTimeline(index, id, {
      offset: 0,
      limit: 100,
      q: query,
      kind: '',
      status: '',
      tool: '',
      file: '',
      layer: 'main',
    });
    assert.ok(
      preservedTextSearch.events.some((event) => event.id === dynamic.event.id && event.hasSearchHit),
      query,
    );
  }
  assert.equal(image.detail.timelineSections[1].code.length, 4000);
  assert.match(image.detail.timelineSections[1].code, /Decode failed before \[data URL omitted\] after/);
  const imagePreview = manyImages.detail.inspectorSections.find((section) => section.type === 'image_preview');
  assert.equal(imagePreview.images.length, 8);
  assert.equal(new Set(imagePreview.images.map((item) => item.src)).size, 8);
  assert.match(imagePreview.notice, /2 additional embedded images/);
  const manyImageResponse = manyImages.detail.inspectorSections.find((section) => section.title === 'Response');
  assert.equal(manyImageResponse.value.filter((item) => item.image_url === '[embedded image payload externalized; open raw refs for source]').length, 11);
  assert.doesNotMatch(JSON.stringify(session.rawEvents), /data:image\/png;base64|malformed-image-secret|leading-image-secret/);
  assert.doesNotMatch(JSON.stringify(dynamic.detail), /malformed-image-secret|leading-image-secret|generic-secret/);
  const envelopeTimeline = getTimeline(index, id, { layer: 'main', q: '', offset: 0, limit: 100 }).events.find((event) => event.id === envelope.event.id);
  assert.equal(envelope.event.turnId, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelope.event.subtype, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelope.event.toolName, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelopeTimeline.turnId, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelopeTimeline.payloadType, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelopeTimeline.subtype, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelopeTimeline.toolName, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelope.detail.subtype, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelope.detail.meta.turnId, '[embedded data URL omitted; see raw refs]');
  assert.equal(envelope.detail.meta.toolName, '[embedded data URL omitted; see raw refs]');
  session.title = `Session before ${encodedUrl} after`;
  const summary = filterSessions(index, { sort: 'updated-desc' }).sessions.find((item) => item.id === id);
  assert.equal(summary.title, 'Session before [embedded data URL omitted; see raw refs] after');
  const rawDetail = buildEventDetail(session, session.rawEvents.find((raw) => raw.callId === 'call-plan-sensitive').rawId, 'raw');
  assert.match(JSON.stringify(rawDetail), /private-payload/);
  const rawEnvelopeDetail = buildEventDetail(session, session.rawEvents.find((raw) => raw.callId === 'call-envelope-sensitive').rawId, 'raw');
  assert.match(JSON.stringify(rawEnvelopeDetail), /tool-secret/);
  assert.match(JSON.stringify(rawEnvelopeDetail), /turn-secret/);
});

test('image preview decoder validates supported base64 and bounded sizes', () => {
  const valid = decodeImagePreviewDataUrl('data:image/png;base64,aGVs\nbG8=');
  assert.equal(valid.error, undefined);
  assert.equal(valid.mimeType, 'image/png');
  assert.equal(valid.bytes.toString('utf8'), 'hello');
  assert.deepEqual(decodeImagePreviewDataUrl('data:image/svg+xml;base64,aGVsbG8='), { statusCode: 422, error: 'Image preview payload is malformed' });
  assert.deepEqual(decodeImagePreviewDataUrl('data:image/png;base64,%%%%'), { statusCode: 422, error: 'Image preview payload is malformed' });
  assert.deepEqual(decodeImagePreviewDataUrl('data:image/png;base64,aGVsbG8=', { maxEncodedChars: 4 }), { statusCode: 413, error: 'Image preview is too large' });
  assert.deepEqual(decodeImagePreviewDataUrl('data:image/png;base64,aGVsbG8=', { maxDecodedBytes: 4 }), { statusCode: 413, error: 'Image preview is too large' });
});

test('image preview endpoint rehydrates only indexed server-owned image locators', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const id = '12121212-1212-1212-1212-121212121212';
  const dir = path.join(codexHome, 'sessions', '2026', '05', '30');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const file = path.join(dir, `rollout-2026-05-30T10-00-00-${id}.jsonl`);
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-05-30T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-30T10:00:01.000Z',
      payload: {
        type: 'function_call',
        name: 'view_image',
        call_id: 'call-image-endpoint',
        arguments: { path: 'G:\\repo\\preview.png', detail: 'high' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-05-30T10:00:01.100Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-image-endpoint',
        output: [
          { type: 'input_image', image_url: 'data:image/png;base64,aGVs\nbG8=', detail: 'high' },
          { type: 'input_image', image_url: 'data:image/png;base64,%%%%', detail: 'high' },
          { type: 'input_image', image_url: 'data:image/svg+xml;base64,aGVsbG8=', detail: 'high' },
        ],
      },
    },
  ];
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const event = session.logicalEvents.find((candidate) => candidate.toolName === 'view_image');
  const detail = buildEventDetail(session, event.id, 'main');
  const previews = detail.inspectorSections.find((section) => section.type === 'image_preview').images;
  const outputRaw = session.rawEvents.find((raw) => raw.callId === 'call-image-endpoint' && raw.payloadType === 'function_call_output');
  assert.equal(previews.length, 2);
  assert.doesNotMatch(JSON.stringify(session), /data:image\/png;base64/);
  assert.equal(outputRaw.embeddedImages.length, 2);

  const server = createServer(index, 1, { codexHome });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const valid = await fetch(`${base}${previews[0].src}?file=..%2Foutside.jsonl`);
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get('content-type'), 'image/png');
    assert.equal(valid.headers.get('content-length'), '5');
    assert.equal(valid.headers.get('cache-control'), 'no-store');
    assert.equal(valid.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await valid.arrayBuffer()).toString('utf8'), 'hello');

    const malformed = await fetch(`${base}${previews[1].src}`);
    assert.equal(malformed.status, 422);
    assert.equal((await malformed.json()).error, 'Image preview payload is malformed');

    const unknown = await fetch(`${base}${previews[0].src.replace(/image-3-0$/, 'unknown-preview')}`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'Unknown image preview');

    const malformedIdentifier = await fetch(`${base}/api/sessions/%ZZ/events/event/image-previews/preview`);
    assert.equal(malformedIdentifier.status, 400);

    const raw = await fetch(`${base}/api/raw?file=${encodeURIComponent(outputRaw.source.file)}&line=${outputRaw.source.line}`);
    assert.equal(raw.status, 200);
    assert.match((await raw.json()).raw, /data:image\/png;base64,aGVs\\nbG8=/);

    const originalFile = outputRaw.embeddedImages[0].source.file;
    outputRaw.embeddedImages[0].source.file = '..\\outside.jsonl';
    const outside = await fetch(`${base}${previews[0].src}`);
    assert.equal(outside.status, 409);
    outputRaw.embeddedImages[0].source.file = originalFile;

    records[2].payload.output[0].image_url = 'data:image/png;base64,d29ybGQ=';
    await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
    const stale = await fetch(`${base}${previews[0].src}`);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'Image preview source is stale');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('command terminal sections repair UTF-8 text decoded as GB18030', () => {
  const decodeUtf8AsGb18030 = (text) => new TextDecoder('gb18030').decode(Buffer.from(text, 'utf8'));
  const rawCall = {
    rawId: 'fixture:raw:1',
    recordType: 'response_item',
    payloadType: 'function_call',
    toolName: 'shell_command',
    output: JSON.stringify({
      command: "Get-Content -Path 'analysis_output\\fine_omni_events.py'",
      workdir: 'G:\\vibe\\video-spotter',
    }),
    parsed: { payload: {} },
    source: { file: 'fixture.jsonl', line: 1 },
  };
  const rawOutput = {
    rawId: 'fixture:raw:2',
    recordType: 'response_item',
    payloadType: 'function_call_output',
    output: [
      'Exit code: 0',
      'Wall time: 0.1 seconds',
      'Output:',
      '\u001b[32;1mANSI heading\u001b[0m',
      '\u001b]8;;https://example.invalid\u0007linked label\u001b]8;;\u0007',
      `# AI ${decodeUtf8AsGb18030('功能测试视频事件定位工作流')}`,
      '本文档总结 `荣耀-OCR表格提取` 和 `2-语音转文字` 两个场景。',
      'ASCII question? stays as question.',
      `## ${decodeUtf8AsGb18030('已验证场景')}`,
      `VIDEO_DIR = ROOT / "test_videos" / "${decodeUtf8AsGb18030('荣耀-OCR表格提取')}"`,
      `WINDOWS = {"${decodeUtf8AsGb18030('语料1.mp4')}": {"capture_done": (10.8, 12.4)}}`,
      `- ${decodeUtf8AsGb18030('抽帧与 seek 策略')}`,
      'Lost punctuation: 鍜? 銆? 锛? 鈥?',
    ].join('\n'),
    parsed: { payload: {} },
    source: { file: 'fixture.jsonl', line: 2 },
  };
  const event = {
    id: 'fixture:logical:call:1',
    kind: 'command',
    layer: 'main',
    label: 'Command',
    status: 'success',
    severity: 'normal',
    toolName: 'shell_command',
    outputStats: { exitCode: 0 },
    touchedFiles: [],
    rawRefs: [
      { rawId: rawCall.rawId, file: 'fixture.jsonl', line: 1 },
      { rawId: rawOutput.rawId, file: 'fixture.jsonl', line: 2 },
    ],
    channels: ['response_item'],
  };
  const session = {
    rawEvents: [rawCall, rawOutput],
    logicalEvents: [event],
  };

  const detail = buildEventDetail(session, event.id, 'main');
  const stdout = allSections(detail).find((section) => section.type === 'terminal' && section.title === 'stdout');
  assert.ok(stdout);
  assert.match(stdout.text, /功能测试视频事件定位工作/);
  assert.match(stdout.text, /ANSI heading/);
  assert.match(stdout.text, /linked label/);
  assert.doesNotMatch(stdout.text, /\u001b|\[32;1m|\]8;;/);
  assert.match(stdout.text, /功能测试视频事件定位工作□/);
  assert.match(stdout.text, /本文档总结 `荣耀-OCR表格提取` 和 `2-语音转文字` 两个场景。/);
  assert.match(stdout.text, /ASCII question\? stays as question\./);
  assert.match(stdout.text, /已验证场/);
  assert.match(stdout.text, /已验证场□/);
  assert.match(stdout.text, /荣耀-OCR表格提取/);
  assert.match(stdout.text, /语料1\.mp4/);
  assert.match(stdout.text, /抽帧/);
  assert.match(stdout.text, /策略/);
  assert.match(stdout.text, /Lost punctuation: □ □ □ □/);
  assert.doesNotMatch(stdout.text, /\uFFFD\?/);
  assert.doesNotMatch(stdout.text, /鍔熻兘|鑽|璇枡|绛栫暐/);
});

test('detail endpoint returns structured event detail with split sections and raw refs', async () => {
  const index = await buildFixtureIndex();
  const session = primaryFixtureSession(index);
  const planEvent = session.logicalEvents.find((event) => event.kind === 'proposed_plan');
  const server = createServer(index, 1);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/sessions/${encodeURIComponent(session.id)}/events/${encodeURIComponent(planEvent.id)}/detail?layer=main`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, planEvent.id);
    assert.equal(body.layer, 'main');
    assert.equal(body.sections, undefined);
    assert.equal(body.timelineSections[0].type, 'markdown');
    assert.ok(body.inspectorSections.some((section) => section.type === 'raw_json'));
    assert.ok(body.rawRefs.length >= 1);
    assert.deepEqual(Object.keys(body.meta), ['timestamp', 'turnId', 'status', 'severity', 'toolName', 'touchedFiles', 'outputStats', 'channels', 'source']);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('project endpoints require and select a browser-chosen project', async () => {
  const server = createServer(null, 0, { codexHome: fixtureCodexHome });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const stateBefore = await fetch(`${base}/api/state`);
    assert.equal(stateBefore.status, 409);
    assert.equal((await stateBefore.json()).error, 'Project not selected');

    const projectsRes = await fetch(`${base}/api/projects`);
    assert.equal(projectsRes.status, 200);
    const projectsBody = await projectsRes.json();
    assert.ok(projectsBody.projects.some((project) => project.repoRoot === 'G:\\vibe\\term-agent'));

    const selectRes = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'G:\\vibe\\term-agent', locale: 'zh-CN' }),
    });
    assert.equal(selectRes.status, 202);
    const selectBody = await selectRes.json();
    assert.equal(selectBody.job.repoRoot, 'G:\\vibe\\term-agent');
    assert.equal(selectBody.job.status, 'running');

    let statusBody = null;
    for (let i = 0; i < 20; i += 1) {
      const statusRes = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(selectBody.job.id)}`);
      assert.equal(statusRes.status, 200);
      statusBody = await statusRes.json();
      if (statusBody.job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(statusBody.job.status, 'succeeded');
    assert.equal(statusBody.state.locale, 'zh-CN');
    assert.equal(statusBody.state.repoRoot, 'G:\\vibe\\term-agent');
    assert.equal(statusBody.state.totals.sessionCount, 10);
    assert.equal(statusBody.state.totals.skippedFileCount, 1);

    const sessionsRes = await fetch(`${base}/api/sessions`);
    assert.equal(sessionsRes.status, 200);
    assert.equal((await sessionsRes.json()).total, 10);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('project summary endpoint returns fast config rows and later cached activity', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const configProject = path.join(codexHome, 'configured-project');
  const transcriptProject = path.join(codexHome, 'transcript-project');
  await fsp.mkdir(configProject, { recursive: true });
  await fsp.mkdir(transcriptProject, { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'config.toml'), `[projects.'${configProject}']\n`, 'utf8');
  await writeFixtureTranscript(codexHome, transcriptProject);

  const server = createServer(null, 0, { codexHome });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const summaryRes = await fetch(`${base}/api/projects?summary=1`);
    assert.equal(summaryRes.status, 200);
    const summaryBody = await summaryRes.json();
    assert.equal(summaryBody.summary, true);
    assert.equal(summaryBody.cached, false);
    assert.equal(summaryBody.projects.length, 1);
    assert.equal(summaryBody.projects[0].repoRoot, path.resolve(configProject));
    assert.equal(summaryBody.projects[0].statsPending, true);
    assert.equal(summaryBody.projects[0].sessionCount, null);

    const fullRes = await fetch(`${base}/api/projects`);
    assert.equal(fullRes.status, 200);
    const fullBody = await fullRes.json();
    const fullByRoot = new Map(fullBody.projects.map((project) => [project.repoRoot, project]));
    assert.equal(fullByRoot.get(path.resolve(configProject)).sessionCount, 0);
    assert.equal(fullByRoot.get(path.resolve(configProject)).statsPending, false);
    assert.equal(fullByRoot.get(path.resolve(transcriptProject)).sessionCount, 1);

    const cachedSummaryRes = await fetch(`${base}/api/projects?summary=1`);
    assert.equal(cachedSummaryRes.status, 200);
    const cachedSummaryBody = await cachedSummaryRes.json();
    const cachedByRoot = new Map(cachedSummaryBody.projects.map((project) => [project.repoRoot, project]));
    assert.equal(cachedSummaryBody.cached, true);
    assert.equal(cachedByRoot.get(path.resolve(configProject)).sessionCount, 0);
    assert.equal(cachedByRoot.get(path.resolve(transcriptProject)).sessionCount, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('state reports active project job even when an old index exists', async () => {
  const index = await buildFixtureIndex();
  let releaseIndex = null;
  const server = createServer(index, 1, {
    codexHome: fixtureCodexHome,
    buildIndex: () => new Promise((resolve) => {
      releaseIndex = () => resolve(index);
    }),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const selectRes = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'G:\\vibe\\term-agent', locale: 'zh-CN' }),
    });
    assert.equal(selectRes.status, 202);
    const selectBody = await selectRes.json();

    const stateRes = await fetch(`${base}/api/state`);
    assert.equal(stateRes.status, 202);
    const stateBody = await stateRes.json();
    assert.equal(stateBody.job.id, selectBody.job.id);
    assert.equal(stateBody.currentState.locale, 'zh-CN');
    assert.equal(stateBody.currentState.repoRoot, 'G:\\vibe\\term-agent');
    releaseIndex();
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('cancelling an active project job preserves the previous index', async () => {
  const index = await buildFixtureIndex();
  const server = createServer(index, 1, {
    codexHome: fixtureCodexHome,
    buildIndex: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('Indexing cancelled');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const selectRes = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'G:\\vibe\\term-agent' }),
    });
    assert.equal(selectRes.status, 202);
    const selectBody = await selectRes.json();

    const cancelRes = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(selectBody.job.id)}`, {
      method: 'DELETE',
    });
    assert.equal(cancelRes.status, 200);
    assert.equal((await cancelRes.json()).job.status, 'cancelled');

    const stateRes = await fetch(`${base}/api/state`);
    assert.equal(stateRes.status, 200);
    const stateBody = await stateRes.json();
    assert.equal(stateBody.repoRoot, 'G:\\vibe\\term-agent');
    assert.equal(stateBody.totals.sessionCount, 10);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('readRawLine returns the original JSONL row for drill-down', async () => {
  const index = await buildFixtureIndex();
  const raw = await readRawLine(index, primaryFixtureSession(index).sourceFile, 12);
  assert.equal(raw.parsed.type, 'event_msg');
  assert.equal(raw.parsed.payload.type, 'agent_message');
});

test('path containment and folding profiles expose expected presets', () => {
  assert.equal(isPathInsideOrSame('G:\\vibe\\term-agent\\src', 'G:\\vibe\\term-agent'), true);
  assert.equal(isPathInsideOrSame('G:\\vibe\\term-agent-other', 'G:\\vibe\\term-agent'), false);
  assert.ok(foldingProfiles.some((profile) => profile.id === 'narrative'));
  assert.ok(foldingProfiles.some((profile) => profile.id === 'debug'));
  assert.ok(foldingProfiles.some((profile) => profile.id === 'compact'));
  assert.equal(EDITABLE_EVENT_KINDS.includes('protocol'), false);
  assert.equal(EDITABLE_EVENT_KINDS.includes('event'), false);
  assert.equal(EDITABLE_EVENT_KINDS.includes('plan_update'), false);
  assert.equal(EDITABLE_EVENT_KINDS.includes('hook'), false);
  assert.equal(EDITABLE_EVENT_KINDS.includes('subagent'), false);
  assert.equal(EDITABLE_EVENT_KINDS.includes('review'), true);
  for (const profile of foldingProfiles) {
    assert.ok(profile.rules, `${profile.id} has rule data`);
    assert.ok(DISPLAY_STATES.includes(profile.rules.fallback), `${profile.id} has a valid fallback`);
    for (const state of Object.values(profile.rules.kindStates || {})) {
      assert.ok(DISPLAY_STATES.includes(state), `${profile.id} has a valid kind state`);
    }
    for (const condition of profile.rules.conditions || []) {
      assert.ok(condition.id, `${profile.id} condition has an id`);
      assert.ok(DISPLAY_STATES.includes(condition.state), `${profile.id} condition has a valid state`);
    }
  }
  const narrative = foldingProfiles.find((profile) => profile.id === 'narrative');
  assert.equal(narrative.rules.kindStates.user_message, 'expanded');
  assert.equal(narrative.rules.kindStates.reasoning, 'collapsed');
  const compact = foldingProfiles.find((profile) => profile.id === 'compact');
  assert.equal(compact.rules.fallback, 'collapsed');
});
