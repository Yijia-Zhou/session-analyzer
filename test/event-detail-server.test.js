'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('../server');
const { createEmptyMaterializedPresentationIndexes } = require('../src/canonical-contract');
const { buildEventDetailForSession } = require('../src/source-adapters');
const { strictClaudeIndexFromComplete } = require('./strict-claude-fixture');

const SOURCE_KIND = 'claude-code';

function makeFixture(id = 'detail-server-session') {
  const event = {
    id: `${id}:event:0`,
    sourceKind: SOURCE_KIND,
    layer: 'main',
    kind: 'message',
    subtype: 'assistant_message',
    label: 'Assistant message',
    timestamp: '2026-08-16T00:00:00.000Z',
    status: '',
    toolName: '',
    preview: 'detail preview',
    searchText: 'detail searchable text',
    touchedFiles: [],
    rawRefs: [],
    source: { file: `${id}.jsonl`, line: 1 },
  };
  const session = {
    id,
    sourceKind: SOURCE_KIND,
    title: id,
    sourceFile: `${id}.jsonl`,
    bytes: 1,
    lineCount: 1,
    cwdSet: new Set(['G:\\repo']),
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T01:00:00.000Z',
    counts: { messages: 1, toolCalls: 0, failedCommands: 0 },
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents: [event],
    rawEvents: [],
    presentationIndexes: createEmptyMaterializedPresentationIndexes(),
  };
  const completeIndex = {
    sourceKind: SOURCE_KIND,
    repoRoot: `G:\\repo\\${id}`,
    generatedAt: '2026-08-16T00:00:00.000Z',
    sessions: [session],
    sessionsById: new Map([[session.id, session]]),
    eventKinds: { main: [], protocol: [], raw: [] },
    totals: { sessionCount: 1, eventCount: 1, rawEventCount: 0 },
  };
  return {
    event,
    session,
    index: strictClaudeIndexFromComplete(completeIndex),
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function detailUrl(base, fixture) {
  return `${base}/api/sessions/${encodeURIComponent(fixture.session.id)}/events/${encodeURIComponent(fixture.event.id)}/detail?layer=main`;
}

function serverFor(fixture, options = {}) {
  return createServer(fixture.index, 1, {
    sessionPrewarm: false,
    materializeSession: async () => fixture.session,
    ...options,
  });
}

test('detail route keeps the default event-detail builder behavior', async () => {
  const fixture = makeFixture();
  const server = serverFor(fixture);
  const base = await listen(server);
  try {
    const response = await fetch(`${detailUrl(base, fixture)}&locale=zh-CN`);
    assert.equal(response.status, 200);
    const actual = await response.json();
    const expected = await buildEventDetailForSession(
      fixture.index,
      fixture.session,
      fixture.event.id,
      'main',
      { locale: 'zh-CN' },
    );
    assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)));
  } finally {
    await close(server);
  }
});

test('the supplied event-detail builder is scoped to Detail and called once per request', async () => {
  const fixture = makeFixture();
  const calls = [];
  const server = serverFor(fixture, {
    buildEventDetail: async (...args) => {
      calls.push(args);
      assert.equal(args[0], fixture.index);
      assert.equal(args[1], fixture.session);
      assert.equal(args[2], fixture.event.id);
      assert.equal(args[3], 'main');
      assert.equal(args[4].locale, 'en');
      assert.ok(args[4].signal instanceof AbortSignal);
      return buildEventDetailForSession(...args);
    },
  });
  const base = await listen(server);
  try {
    const detailResponse = await fetch(detailUrl(base, fixture));
    assert.equal(detailResponse.status, 200);
    assert.equal(calls.length, 1);

    const eventResponse = await fetch(
      `${base}/api/sessions/${encodeURIComponent(fixture.session.id)}/events/${encodeURIComponent(fixture.event.id)}?layer=main`,
    );
    assert.equal(eventResponse.status, 200);
    assert.equal(calls.length, 1);
  } finally {
    await close(server);
  }
});

test('detail builder errors keep the existing HTTP error semantics', async () => {
  const fixture = makeFixture('detail-server-error');
  const error = new Error('synthetic detail failure');
  error.statusCode = 418;
  error.code = 'DETAIL_BUILDER_FAILED';
  let calls = 0;
  const server = serverFor(fixture, {
    buildEventDetail: async () => {
      calls += 1;
      throw error;
    },
  });
  const base = await listen(server);
  try {
    const response = await fetch(detailUrl(base, fixture));
    assert.equal(response.status, 418);
    assert.deepEqual(await response.json(), {
      error: error.message,
      code: error.code,
    });
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }
});

test('HTTP disconnect still aborts the detail builder signal', async () => {
  const fixture = makeFixture('detail-server-abort');
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let markAborted;
  const aborted = new Promise((resolve) => { markAborted = resolve; });
  const server = serverFor(fixture, {
    buildEventDetail: async (_index, _session, _eventId, _layer, { signal }) => {
      markStarted();
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          markAborted();
          reject(abortError);
        }, { once: true });
      });
    },
  });
  const base = await listen(server);
  try {
    const controller = new AbortController();
    const request = fetch(detailUrl(base, fixture), { signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(request, (requestError) => requestError.name === 'AbortError');
    await aborted;
  } finally {
    await close(server);
  }
});
