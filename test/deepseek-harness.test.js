'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { createServer } = require('../server');
const {
  buildDeepSeekIndex,
  deepSeekAdapter,
  discoverDeepSeekProjects,
  readDeepSeekRawRecord,
} = require('../src/deepseek-harness');
const storage = require('../src/deepseek-harness-storage');
const {
  buildEventDetailForSession,
  materializeSessionForIndex,
  normalizeSourceKind,
  readIndexedRawRecord,
  supportedSourceKinds,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const {
  projectQueryProjectionDigestAsync,
} = require('../src/project-query-store');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness', 'sessions');
const UNCOMPRESSED_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-uncompressed', 'sessions');
const NORMAL_REPO = '/home/joejack/dsh_playground/spike/ws/normal';
const INTERRUPT_REPO = '/home/joejack/dsh_playground/spike/ws/interrupt';
const NORMAL_SOURCE_SESSION = 'session-695bc3a2-78cb-4585-8acc-e637c327efa1';
const ABORT_SOURCE_SESSION = 'session-d4976b66-54c6-4884-aa6a-819d07759be8';
const CRASH_SOURCE_SESSION = 'session-b2744c2e-515a-4f02-b16a-c706f921576a';

async function buildFor(repoRoot, root = FIXTURE_ROOT) {
  const index = await buildDeepSeekIndex({
    sourceHome: root,
    repoRoot,
  });
  await validateIndexOwnershipForCommit(index);
  return index;
}

async function makeSyntheticDeepSeekFixture(t, id, records) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-synth-repo-'));
  const sourceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-synth-home-'));
  t.after(() => fsp.rm(sourceHome, { recursive: true, force: true }));
  t.after(() => fsp.rm(repoRoot, { recursive: true, force: true }));
  const sessionDir = path.join(sourceHome, '--synthetic-project--', id);
  await fsp.mkdir(sessionDir, { recursive: true });
  const file = path.join(sessionDir, 'session.jsonl');
  const header = {
    type: 'session',
    version: 0,
    id,
    createdAt: 1,
    cwd: repoRoot,
    delegationDepth: 0,
  };
  const text = `${[header, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`;
  await fsp.writeFile(file, text, 'utf8');
  return { sourceHome, repoRoot, file, id, text };
}

test('DeepSeek Harness is a selectable indexed-materialized third source', () => {
  assert.ok(supportedSourceKinds().includes('deepseek-harness'));
  assert.equal(normalizeSourceKind('dsh'), 'deepseek-harness');
  assert.equal(normalizeSourceKind('deepseek'), 'deepseek-harness');
  assert.equal(deepSeekAdapter.sessionLifecycle, 'indexed-materialized-v1');
  assert.equal(path.basename(deepSeekAdapter.defaultHome()), 'sessions');
  assert.deepEqual(deepSeekAdapter.materializationContextFields, ['sessionsRoot']);
  assert.deepEqual(deepSeekAdapter.materializedPrivateFields, ['_forkSegmentsByRawId']);
});

test('header-only discovery finds synthetic current-writer projects', async () => {
  const projects = await discoverDeepSeekProjects({ sourceHome: FIXTURE_ROOT });
  assert.deepEqual(projects.map((project) => path.basename(project.repoRoot)).sort(), ['interrupt', 'normal']);
  const normal = projects.find((project) => project.repoRoot === NORMAL_REPO);
  assert.equal(normal.sessionCount, 1);
  assert.ok(normal.bytes >= 14_000);
});

test('normal current-writer zstd fixture indexes strictly and materializes with projection parity', async () => {
  const index = await buildFor(NORMAL_REPO);
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  assert.equal(indexed.sourceKind, 'deepseek-harness');
  assert.equal(indexed.sourceSessionId, NORMAL_SOURCE_SESSION);
  assert.equal(indexed.lineCount, 39);
  assert.equal(indexed.rawEventCount, 39);
  assert.equal(indexed.logicalEventCount, 22);
  assert.equal(indexed.counts.turns, 1);
  assert.equal(indexed.counts.messages, 3);
  assert.equal(indexed.counts.toolCalls, 1);
  assert.equal(indexed.counts.reasoning, 1);
  assert.equal(indexed.title, 'Tool output check');
  assert.equal(indexed.materializationDescriptor.payload.compression, 'zstd');

  const materialized = await materializeSessionForIndex(index, indexed);
  assert.equal(materialized.rawEvents.length, 39);
  assert.equal(materialized.logicalEvents.length, 22);
  assert.ok(materialized.rawEvents.every((raw) => !Object.hasOwn(raw, 'parsed')));

  const projectionDigest = await projectQueryProjectionDigestAsync(
    materialized,
    deepSeekAdapter.query.projectQueryPresentation,
  );
  assert.equal(projectionDigest, indexed.queryProjectionDigest);

  const main = materialized.logicalEvents.filter((event) => event.layer === 'main');
  assert.deepEqual(main.map((event) => event.kind), [
    'user_message',
    'reasoning',
    'assistant_message',
    'command',
    'assistant_message',
  ]);
  const tool = main.find((event) => event.kind === 'command');
  assert.equal(tool.status, 'success');
  assert.equal(tool.toolName, 'bash');
  assert.deepEqual(tool.rawRefs.map((ref) => ref.sourceEventType), ['tool/call', 'tool/result']);

  // Exact lazy readback returns the original physical record text, not a
  // reconstruction from retained parsed payloads.
  const toolCallRaw = materialized.rawEvents.find((raw) => raw.payloadType === 'tool/call');
  const readback = await readDeepSeekRawRecord(index, materialized, toolCallRaw);
  assert.ok(readback.raw.startsWith('{"type":"tool/call"'));
  assert.equal(readback.parsed, null);
  assert.equal(JSON.parse(readback.raw).seq, 96);
});

test('packed chunk rows stay one Raw Record per physical row and partial output reconstructs lazily', async () => {
  const index = await buildFor(INTERRUPT_REPO);
  const indexed = index.sessions.find((session) => session.sourceSessionId === ABORT_SOURCE_SESSION);
  assert.ok(indexed);
  assert.equal(indexed.lineCount, 35);
  assert.equal(indexed.rawEventCount, 35);
  // The writer stored 285 logical events in 35 physical records. The Index
  // must not contain one Raw object per assistant delta.
  assert.ok(indexed.rawEventCount < 285);

  const materialized = await materializeSessionForIndex(index, indexed);
  assert.equal(Object.hasOwn(indexed, 'rawEvents'), false);
  assert.equal(Object.hasOwn(indexed, 'logicalEvents'), false);
  const packedRows = materialized.rawEvents.filter((raw) => raw.payloadType.endsWith('-chunks'));
  assert.equal(packedRows.length, 16);
  assert.ok(packedRows.every((raw) => raw.memberCount > 1));
  assert.ok(packedRows.every((raw) => !raw.searchText.includes('Ochre')));
  assert.ok(materialized.rawEvents.every((raw) => raw.payloadType !== 'assistant/chunk:expanded'));
  assert.equal(materialized.rawEvents.filter((raw) => raw.payloadType === 'assistant/message').length, 0);

  const partial = materialized.logicalEvents.find((event) => event.subtype === 'partial_assistant_stream');
  assert.ok(partial);
  assert.equal(partial.kind, 'assistant_message');
  assert.equal(partial.status, 'aborted');
  assert.match(partial.preview, /Ochre Parakeet/);
  assert.ok(partial.rawRefs.length > 1);
  for (const ref of partial.rawRefs) {
    assert.ok(ref.sourceEventType.endsWith('-chunks') || ref.sourceEventType === 'assistant/chunk');
  }

  const protocolTurnEnd = materialized.logicalEvents.find((event) => event.subtype === 'turn/end');
  assert.equal(protocolTurnEnd.layer, 'protocol');
  assert.match(protocolTurnEnd.preview, /aborted by user/);

  const detail = await buildEventDetailForSession(index, materialized, partial.id, 'main');
  assert.ok(detail.timelineSections.some((section) => section.purpose === 'content'));
  assert.ok(detail.inspectorSections.some((section) => (
    section.purpose === 'traceability' && /no finalized assistant\/message/.test(section.text)
  )));
});

test('indexing/materialization keep large packed rows structural and never invoke per-member expansion', async (t) => {
  const memberCount = 4096;
  const fixture = await makeSyntheticDeepSeekFixture(t, 'large-packed-row', [
    { type: 'step/start', seq: 0, time: 1001, data: { turn: 1, step: 1 } },
    {
      type: 'reasoning-chunks',
      seq0: 1,
      time0: 1002,
      data: {
        turn: 1,
        step: 1,
        index: 0,
        dt: Array(memberCount - 1).fill(0),
        texts: Array(memberCount).fill('x'),
      },
    },
    {
      type: 'step/end',
      seq: memberCount + 1,
      time: 1003,
      data: { turn: 1, step: 1 },
    },
  ]);

  const originalDecoder = storage.decodeStorageRecord;
  let expansionCalls = 0;
  storage.decodeStorageRecord = function countExpansionCall(...args) {
    expansionCalls += 1;
    return originalDecoder(...args);
  };
  try {
    const index = await buildDeepSeekIndex({
      sourceHome: fixture.sourceHome,
      repoRoot: fixture.repoRoot,
    });
    const indexed = index.sessions[0];
    assert.equal(indexed.lineCount, 4);
    assert.equal(indexed.rawEventCount, 4);
    assert.equal(indexed.logicalEventCount, 3);
    assert.equal(expansionCalls, 0, 'indexing must not decode packed rows into per-member events');

    const materialized = await materializeSessionForIndex(index, indexed);
    assert.equal(expansionCalls, 0, 'materialization must not decode packed rows into per-member events');
    const packedRaw = materialized.rawEvents.find((raw) => raw.payloadType === 'reasoning-chunks');
    assert.equal(packedRaw.memberCount, memberCount);
    assert.equal(packedRaw.seq0, 1);
    assert.equal(packedRaw.seqEnd, memberCount);
    const partial = materialized.logicalEvents.find((event) => event.subtype === 'partial_assistant_stream');
    assert.ok(partial);
    assert.equal(partial.searchText.length, memberCount);
  } finally {
    storage.decodeStorageRecord = originalDecoder;
  }
});

test('Detail and Raw readback reject changed source after Index/materialization instead of mixing snapshots', async (t) => {
  const baseRecords = () => [
    { type: 'turn/start', seq: 0, time: 1001, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 1,
      time: 1002,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'original question' }],
      },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time: 1003,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'message-1',
          content: [{ type: 'text', text: 'original answer' }],
        },
      },
    },
  ];

  await t.test('append after materialization is stale for logical Detail and Raw readback', async (subtest) => {
    const fixture = await makeSyntheticDeepSeekFixture(subtest, 'freshness-append', baseRecords());
    const index = await buildDeepSeekIndex({
      sourceHome: fixture.sourceHome,
      repoRoot: fixture.repoRoot,
    });
    const indexed = index.sessions[0];
    const materialized = await materializeSessionForIndex(index, indexed);
    const user = materialized.logicalEvents.find((event) => event.kind === 'user_message');
    const rawId = user.rawRefs[0].rawId;

    await fsp.appendFile(
      fixture.file,
      `${JSON.stringify({ type: 'turn/end', seq: 3, time: 1004, data: { turn: 1 } })}\n`,
      'utf8',
    );

    await assert.rejects(
      buildEventDetailForSession(index, materialized, user.id, 'main'),
      { code: 'INDEXED_SOURCE_STALE', statusCode: 409 },
    );
    await assert.rejects(
      readIndexedRawRecord(index, materialized, rawId),
      { code: 'INDEXED_SOURCE_STALE', statusCode: 409 },
    );
  });

  await t.test('same-length replacement after materialization is stale for logical Detail and Raw readback', async (subtest) => {
    const fixture = await makeSyntheticDeepSeekFixture(subtest, 'freshness-replace', baseRecords());
    const index = await buildDeepSeekIndex({
      sourceHome: fixture.sourceHome,
      repoRoot: fixture.repoRoot,
    });
    const indexed = index.sessions[0];
    const materialized = await materializeSessionForIndex(index, indexed);
    const user = materialized.logicalEvents.find((event) => event.kind === 'user_message');
    const rawId = user.rawRefs[0].rawId;
    const replaced = [...baseRecords()];
    replaced[1] = {
      ...replaced[1],
      data: {
        ...replaced[1].data,
        content: [{ type: 'text', text: 'replacement query' }],
      },
    };
    const replacementText = [
      JSON.stringify({
        type: 'session',
        version: 0,
        id: fixture.id,
        createdAt: 1,
        cwd: fixture.repoRoot,
        delegationDepth: 0,
      }),
      ...replaced.map((record) => JSON.stringify(record)),
    ].join('\n').concat('\n');
    assert.equal(Buffer.byteLength(replacementText), Buffer.byteLength(fixture.text));
    await fsp.writeFile(fixture.file, replacementText, 'utf8');

    await assert.rejects(
      buildEventDetailForSession(index, materialized, user.id, 'main'),
      { code: 'INDEXED_SOURCE_STALE', statusCode: 409 },
    );
    await assert.rejects(
      readIndexedRawRecord(index, materialized, rawId),
      { code: 'INDEXED_SOURCE_STALE', statusCode: 409 },
    );
  });
});

test('SIGKILL/open-turn artifact adds no synthetic turn/end and remains inspectable', async () => {
  const index = await buildFor(INTERRUPT_REPO);
  const indexed = index.sessions.find((session) => session.sourceSessionId === CRASH_SOURCE_SESSION);
  assert.ok(indexed);
  assert.equal(indexed.rawEventCount, 59);
  const materialized = await materializeSessionForIndex(index, indexed);
  assert.equal(materialized.rawEvents.some((raw) => raw.payloadType === 'turn/end'), false);
  assert.equal(materialized.logicalEvents.some((event) => event.subtype === 'turn/end'), false);
  const partial = materialized.logicalEvents.find((event) => event.subtype === 'partial_assistant_stream');
  assert.ok(partial);
  assert.equal(partial.status, 'incomplete');
  assert.ok(partial.rawRefs.length > 1);
});

test('committed-prefix reader drops a torn final Zstd frame without modifying the artifact', () => {
  const headerFrame = zstdCompressSync('{"type":"session","version":0,"id":"synthetic","createdAt":1,"cwd":"/tmp/synthetic","delegationDepth":0}\n');
  const eventFrame = zstdCompressSync('{"type":"turn/start","seq":0,"time":2,"data":{"turn":1}}\n');
  const torn = Buffer.concat([headerFrame, eventFrame.subarray(0, eventFrame.length - 6)]);
  const prefix = storage.committedArtifactPrefix(torn, 'zstd');
  assert.equal(prefix.recordTexts.length, 1);
  assert.equal(prefix.torn, true);
  assert.ok(prefix.committedBytes < torn.length);
  assert.equal(storage.parseHeaderText(prefix.recordTexts[0]).id, 'synthetic');
});

test('uncompressed session.jsonl current-writer fixture works', async () => {
  const index = await buildFor(NORMAL_REPO, UNCOMPRESSED_ROOT);
  const indexed = index.sessions[0];
  assert.equal(indexed.materializationDescriptor.payload.compression, 'none');
  assert.equal(indexed.bytes, 41_283);
  assert.equal(indexed.lineCount, 39);
  const materialized = await materializeSessionForIndex(index, indexed);
  assert.equal(materialized.logicalEvents.length, 22);
  const raw = materialized.rawEvents.find((candidate) => candidate.payloadType === 'tool/result');
  const readback = await readDeepSeekRawRecord(index, materialized, raw);
  assert.match(readback.raw, /fx-normal-tool-round-ok/);
});

test('future format versions fail closed rather than being guessed', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-future-'));
  const projectDir = '--tmp-synthetic--';
  const sessionDir = 'future-session';
  const artifactDir = path.join(root, projectDir, sessionDir);
  await fsp.mkdir(artifactDir, { recursive: true });
  await fsp.writeFile(
    path.join(artifactDir, 'session.jsonl'),
    '{"type":"session","version":1,"id":"future-session","createdAt":1,"cwd":"/tmp/synthetic","delegationDepth":0}\n',
  );
  try {
    await assert.rejects(
      buildDeepSeekIndex({ sourceHome: root, repoRoot: '/tmp/synthetic' }),
      (error) => error?.code === 'DEEPSEEK_FORMAT_VERSION_UNSUPPORTED',
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('current known-unmodeled and genuinely unknown v0 events keep distinct Protocol/Raw fallback', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-unknown-'));
  const artifactDir = path.join(root, '--tmp-synthetic--', 'unknown-session');
  await fsp.mkdir(artifactDir, { recursive: true });
  const lines = [
    '{"type":"session","version":0,"id":"unknown-session","createdAt":1,"cwd":"/tmp/synthetic","delegationDepth":0}',
    '{"type":"turn/start","seq":0,"time":2,"data":{"turn":1}}',
    '{"type":"team/task","seq":1,"time":3,"data":{"version":1,"teamId":"synthetic-team","task":{"id":"synthetic-task"}}}',
    '{"type":"plugin/unknown-thing","seq":2,"time":4,"data":{"opaque":"evidence","count":2}}',
  ];
  await fsp.writeFile(path.join(artifactDir, 'session.jsonl'), `${lines.join('\n')}\n`);
  try {
    const index = await buildFor('/tmp/synthetic', root);
    const indexed = index.sessions[0];
    assert.equal(indexed.logicalEventCount, 3);
    const materialized = await materializeSessionForIndex(index, indexed);
    const team = materialized.logicalEvents.find((event) => event.subtype === 'team/task');
    assert.ok(team);
    assert.equal(team.layer, 'protocol');
    assert.equal(team.severity, 'normal');
    assert.equal(team.rawRefs.length, 1);
    const teamRaw = materialized.rawEvents.find((raw) => raw.rawId === team.rawRefs[0].rawId);
    assert.ok(teamRaw);
    assert.equal(teamRaw.payloadType, 'team/task');
    const teamReadback = await readDeepSeekRawRecord(index, materialized, teamRaw);
    assert.deepEqual(JSON.parse(teamReadback.raw), {
      type: 'team/task',
      seq: 1,
      time: 3,
      data: { version: 1, teamId: 'synthetic-team', task: { id: 'synthetic-task' } },
    });
    const unknown = materialized.logicalEvents.find((event) => event.subtype === 'unknown_event');
    assert.equal(unknown.subtype, 'unknown_event');
    assert.equal(unknown.severity, 'warning');
    assert.equal(materialized.rawEvents.some((raw) => raw.payloadType === 'plugin/unknown-thing'), true);
    const detail = await buildEventDetailForSession(index, materialized, unknown.id, 'protocol');
    const fallback = detail.inspectorSections.find((section) => section.type === 'raw_json');
    assert.ok(fallback);
    assert.equal(fallback.purpose, 'fallback');
    assert.deepEqual(fallback.value, { opaque: 'evidence', count: 2 });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});


async function withDeepSeekServer(t, run) {
  const server = createServer(null, 0, {
    source: 'deepseek-harness',
    dshHome: FIXTURE_ROOT,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  await run(base);
}

async function requestJson(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}

async function waitForProject(base, jobId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await requestJson(base, `/api/project/status?jobId=${encodeURIComponent(jobId)}`);
    if (result.json?.job && ['succeeded', 'failed'].includes(result.json.job.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for DeepSeek project indexing');
}

test('server API discovers, indexes, materializes, and inspects DeepSeek Harness without source-specific routes', async (t) => {
  await withDeepSeekServer(t, async (base) => {
    const projects = await requestJson(base, '/api/projects');
    assert.equal(projects.status, 200);
    assert.equal(projects.json.sourceKind, 'deepseek-harness');
    assert.ok(projects.json.projects.some((project) => project.repoRoot === NORMAL_REPO));

    const started = await requestJson(base, '/api/project', {
      method: 'POST',
      body: JSON.stringify({ repoRoot: NORMAL_REPO }),
    });
    assert.equal(started.status, 202);
    const finished = await waitForProject(base, started.json.job.id);
    assert.equal(finished.json.job.status, 'succeeded');
    assert.equal(finished.json.state.sourceKind, 'deepseek-harness');
    assert.equal(finished.json.state.totals.sessionCount, 1);

    const sessionId = encodeURIComponent('deepseek-harness:session-695bc3a2-78cb-4585-8acc-e637c327efa1');
    const timeline = await requestJson(base, `/api/sessions/${sessionId}/timeline?layer=main&limit=20`);
    assert.equal(timeline.status, 200);
    const kinds = timeline.json.events.map((event) => event.kind);
    assert.ok(kinds.includes('user_message'));
    assert.ok(kinds.includes('command'));
    assert.ok(kinds.includes('assistant_message'));

    const userEvent = timeline.json.events.find((event) => event.kind === 'user_message');
    const detail = await requestJson(base, `/api/sessions/${sessionId}/events/${encodeURIComponent(userEvent.id)}/detail?layer=main`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.json.timelineSections.map((section) => section.purpose), ['content']);

    const rawId = encodeURIComponent('deepseek-harness:session-695bc3a2-78cb-4585-8acc-e637c327efa1:raw:27');
    const raw = await requestJson(base, `/api/sessions/${sessionId}/raw/${rawId}`);
    assert.equal(raw.status, 200);
    assert.equal(raw.json.sourceKind, 'deepseek-harness');
    assert.ok(raw.json.raw.includes('"tool/call"'));
  });
});

test('normal structured detail assigns purpose and responsibility from DeepSeek semantics', async () => {
  const index = await buildFor(NORMAL_REPO);
  const indexed = index.sessions[0];
  const materialized = await materializeSessionForIndex(index, indexed);
  const user = materialized.logicalEvents.find((event) => event.kind === 'user_message');
  const tool = materialized.logicalEvents.find((event) => event.kind === 'command');
  const requestHeader = materialized.logicalEvents.find((event) => event.subtype === 'request/header');
  const userDetail = await buildEventDetailForSession(index, materialized, user.id, 'main');
  assert.deepEqual(userDetail.timelineSections.map((section) => [section.purpose, section.type]), [
    ['content', 'markdown'],
  ]);
  const toolDetail = await buildEventDetailForSession(index, materialized, tool.id, 'main');
  assert.deepEqual(toolDetail.timelineSections.map((section) => [section.purpose, section.type]), [
    ['request', 'code'],
    ['result', 'terminal'],
  ]);
  const requestDetail = await buildEventDetailForSession(index, materialized, requestHeader.id, 'protocol');
  assert.deepEqual(requestDetail.timelineSections.map((section) => [section.purpose, section.type]), [
    ['context', 'kv'],
  ]);
  assert.ok(requestDetail.inspectorSections.every((section) => section.purpose !== 'fallback'));
});
