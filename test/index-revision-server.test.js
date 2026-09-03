'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('../server');
const { createEmptyMaterializedPresentationIndexes } = require('../src/canonical-contract');
const { buildProjectQueryStore } = require('../src/project-query-store');
const { getSourceAdapter } = require('../src/source-adapters');
const { materializationBusyError } = require('../src/materialized-session-owner');
const { strictClaudeIndexFromComplete } = require('./strict-claude-fixture');

const SOURCE_KIND = 'claude-code';

function session(id, eventCount = 0) {
  const logicalEvents = Array.from({ length: eventCount }, (_, index) => ({
    id: `${id}:event:${index}`,
    sourceKind: SOURCE_KIND,
    layer: 'main',
    kind: 'message',
    subtype: 'assistant_message',
    label: 'Assistant message',
    timestamp: `2026-08-16T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    status: '',
    toolName: '',
    preview: `target row ${index}`,
    searchText: `target searchable row ${index}`,
    touchedFiles: [],
    rawRefs: [],
    source: { file: `${id}.jsonl`, line: index + 1 },
  }));
  return {
    id,
    sourceKind: SOURCE_KIND,
    title: id,
    sourceFile: `${id}.jsonl`,
    bytes: 1,
    lineCount: eventCount,
    cwdSet: new Set(['G:\\repo']),
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T01:00:00.000Z',
    counts: { messages: eventCount, toolCalls: 0, failedCommands: 0 },
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents,
    rawEvents: [],
    presentationIndexes: createEmptyMaterializedPresentationIndexes(),
  };
}

function index(id, eventCount = 0, withStore = false) {
  const item = session(id, eventCount);
  const value = {
    sourceKind: SOURCE_KIND,
    repoRoot: `G:\\repo\\${id}`,
    generatedAt: '2026-08-16T00:00:00.000Z',
    sessions: [item],
    sessionsById: new Map([[item.id, item]]),
    eventKinds: { main: [], protocol: [], raw: [] },
    totals: { sessionCount: 1, eventCount, rawEventCount: 0 },
  };
  if (withStore) {
    const query = getSourceAdapter(SOURCE_KIND).query;
    const projected = { ...item, ...query.projectSessionMetadata(item) };
    value.sessions = [projected];
    value.sessionsById = new Map([[projected.id, projected]]);
    value.projectQueryStore = buildProjectQueryStore([projected], {
      presentationForEvent: query.projectQueryPresentation,
    });
  }
  return value;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('server retires an in-flight packed query and never emits a mixed revision response', async () => {
  const initial = strictClaudeIndexFromComplete(index('initial', 20_000, true));
  const replacement = strictClaudeIndexFromComplete(index('replacement'));
  const server = createServer(initial, 1, {
    buildIndex: async () => replacement,
  });
  const base = await listen(server);
  try {
    const pendingQuery = fetch(`${base}/api/sessions?q=target&layer=main`);
    await new Promise((resolve) => setImmediate(resolve));
    const replacementResponse = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: replacement.repoRoot }),
    });
    assert.equal(replacementResponse.status, 202);
    const retiredAt = performance.now();
    const queryResponse = await pendingQuery;
    const retirementLatencyMs = performance.now() - retiredAt;
    assert.equal(queryResponse.status, 409);
    assert.equal((await queryResponse.json()).code, 'INDEX_REVISION_RETIRED');
    assert.ok(retirementLatencyMs < 100, `retirement took ${retirementLatencyMs.toFixed(1)}ms`);

    let stateResponse;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      stateResponse = await fetch(`${base}/api/state`);
      if (stateResponse.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.indexRevision, 2);
    assert.equal(state.repoRoot, replacement.repoRoot);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('project cancellation during final query projection validation never installs the replacement Index', async () => {
  const initial = strictClaudeIndexFromComplete(index('validation-initial', 1, true));
  const replacement = strictClaudeIndexFromComplete(index('validation-replacement', 1_200, true));
  let releaseBuild;
  const buildGate = new Promise((resolve) => { releaseBuild = resolve; });
  let jobId = '';
  let cancelRequest = null;
  let base = '';
  const server = createServer(initial, 1, {
    buildIndex: async () => {
      await buildGate;
      return replacement;
    },
    onIndexValidationChunk() {
      if (!cancelRequest && jobId) {
        cancelRequest = fetch(`${base}/api/project/status?jobId=${encodeURIComponent(jobId)}`, {
          method: 'DELETE',
        });
      }
    },
  });
  base = await listen(server);
  try {
    const start = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: replacement.repoRoot }),
    });
    assert.equal(start.status, 202);
    jobId = (await start.json()).job.id;
    releaseBuild();
    while (!cancelRequest) await new Promise((resolve) => setImmediate(resolve));
    const cancelled = await cancelRequest;
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).job.status, 'cancelled');

    let status;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(jobId)}`);
      status = (await response.json()).job;
      if (status.status === 'cancelled') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(status.status, 'cancelled');
    const stateResponse = await fetch(`${base}/api/state`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.repoRoot, initial.repoRoot);
    assert.equal(state.indexRevision, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('server event routes coalesce and reuse one revision-owned Materialized Session', async () => {
  const completeIndex = index('cached-session', 2);
  const completeSession = completeIndex.sessions[0];
  const strictIndex = strictClaudeIndexFromComplete(completeIndex);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const server = createServer(strictIndex, 1, {
    materializeSession: async (_index, indexedSession) => {
      assert.equal(indexedSession.id, completeSession.id);
      calls += 1;
      await gate;
      return completeSession;
    },
  });
  const base = await listen(server);
  try {
    const id = encodeURIComponent(completeSession.id);
    const first = fetch(`${base}/api/sessions/${id}/analysis`);
    const second = fetch(`${base}/api/sessions/${id}/analysis?locale=zh-CN`);
    while (calls === 0) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    const [analysisResponse, secondAnalysisResponse] = await Promise.all([first, second]);
    assert.equal(analysisResponse.status, 200);
    assert.equal(secondAnalysisResponse.status, 200);
    assert.deepEqual(await analysisResponse.json(), completeSession.analysis);
    assert.deepEqual(await secondAnalysisResponse.json(), completeSession.analysis);

    const cached = await fetch(`${base}/api/sessions/${id}/analysis`);
    assert.equal(cached.status, 200);
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('server schedules prewarm after project success without delaying state and reuses its cache', async () => {
  const initial = strictClaudeIndexFromComplete(index('prewarm-initial', 1));
  const replacementComplete = index('prewarm-replacement', 2);
  const replacementSession = replacementComplete.sessions[0];
  const replacement = strictClaudeIndexFromComplete(replacementComplete);
  let wake;
  let materializationCalls = 0;
  const server = createServer(initial, 1, {
    buildIndex: async () => replacement,
    materializeSession: async (_index, indexedSession) => {
      assert.equal(indexedSession.id, replacementSession.id);
      materializationCalls += 1;
      return replacementSession;
    },
    sessionPrewarm: {
      delayMs: 150,
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 30_000,
      individualBytes: 20_000,
      setTimer(callback, delayMs) {
        assert.equal(delayMs, 150);
        wake = callback;
        return 41;
      },
      clearTimer() {},
    },
  });
  const base = await listen(server);
  try {
    const start = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: replacement.repoRoot }),
    });
    const jobId = (await start.json()).job.id;
    let status;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(jobId)}`);
      status = await response.json();
      if (status.job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(status.job.status, 'succeeded');
    assert.equal(status.state.repoRoot, replacement.repoRoot);
    assert.equal(materializationCalls, 0);
    assert.equal(typeof wake, 'function');

    assert.deepEqual(await wake(), {
      status: 'completed',
      consideredCount: 1,
      attemptedCount: 1,
      completedCount: 1,
      notAdmittedCount: 0,
      promotedCount: 0,
      preemptedCount: 0,
      failedCount: 0,
    });
    assert.equal(materializationCalls, 1);
    const analysis = await fetch(`${base}/api/sessions/${encodeURIComponent(replacementSession.id)}/analysis`);
    assert.equal(analysis.status, 200);
    assert.equal(materializationCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('failed post-commit prewarm remains a silent background outcome', async () => {
  const initial = strictClaudeIndexFromComplete(index('prewarm-failure-initial', 1));
  const replacement = strictClaudeIndexFromComplete(index('prewarm-failure-replacement', 1));
  let wake;
  const server = createServer(initial, 1, {
    buildIndex: async () => replacement,
    materializeSession: async () => {
      const error = new Error('synthetic background failure');
      error.code = 'INDEXED_SOURCE_STALE';
      throw error;
    },
    sessionPrewarm: {
      delayMs: 0,
      candidateCap: 1,
      scanLimit: 1,
      budgetBytes: 30_000,
      individualBytes: 20_000,
      setTimer(callback) {
        wake = callback;
        return 51;
      },
      clearTimer() {},
    },
  });
  const base = await listen(server);
  try {
    const start = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: replacement.repoRoot }),
    });
    const jobId = (await start.json()).job.id;
    let status;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      status = await (await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(jobId)}`)).json();
      if (status.job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(status.job.status, 'succeeded');
    const outcome = await wake();
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.failedCount, 1);

    const current = await fetch(`${base}/api/state`);
    assert.equal(current.status, 200);
    const currentState = await current.json();
    assert.equal(currentState.repoRoot, replacement.repoRoot);
    assert.equal(currentState.indexRevision, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invalid prewarm diagnostics cannot overturn a committed project success', async () => {
  const initial = strictClaudeIndexFromComplete(index('prewarm-warning-initial', 1));
  const replacement = strictClaudeIndexFromComplete(index('prewarm-warning-replacement', 1));
  const server = createServer(initial, 1, {
    buildIndex: async () => replacement,
    sessionPrewarm: { candidateCap: 4 },
    warn() {
      throw new Error('synthetic warning sink failure');
    },
  });
  const base = await listen(server);
  try {
    const start = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: replacement.repoRoot }),
    });
    const jobId = (await start.json()).job.id;
    let status;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      status = await (await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(jobId)}`)).json();
      if (status.job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(status.job.status, 'succeeded');
    assert.equal(status.state.repoRoot, replacement.repoRoot);
    assert.equal(status.state.indexRevision, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('server exposes bounded materialization admission as retryable 503', async () => {
  const completeIndex = index('busy-session');
  const strictIndex = strictClaudeIndexFromComplete(completeIndex);
  const server = createServer(strictIndex, 1, {
    materializeSession: async () => {
      throw materializationBusyError();
    },
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/api/sessions/busy-session/analysis`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    const body = await response.json();
    assert.equal(body.code, 'MATERIALIZATION_BUSY');
    assert.equal(body.error, 'Internal server error');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('server preserves materialization contract error code and never caches the failure', async () => {
  const completeIndex = index('invalid-session');
  const strictIndex = strictClaudeIndexFromComplete(completeIndex);
  let calls = 0;
  const server = createServer(strictIndex, 1, {
    materializeSession: async () => {
      calls += 1;
      const error = new Error('synthetic validator rejection');
      error.code = 'MATERIALIZATION_CONTRACT_VIOLATION';
      error.statusCode = 500;
      throw error;
    },
  });
  const base = await listen(server);
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(`${base}/api/sessions/invalid-session/analysis`);
      assert.equal(response.status, 500);
      assert.equal((await response.json()).code, 'MATERIALIZATION_CONTRACT_VIOLATION');
      assert.equal(calls, attempt);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('failed replacement leaves the current revision Materialized Session cache usable', async () => {
  const completeIndex = index('preserved-cache');
  const completeSession = completeIndex.sessions[0];
  const strictIndex = strictClaudeIndexFromComplete(completeIndex);
  let materializationCalls = 0;
  const server = createServer(strictIndex, 1, {
    materializeSession: async () => {
      materializationCalls += 1;
      return completeSession;
    },
    buildIndex: async () => {
      throw new Error('synthetic replacement failure');
    },
  });
  const base = await listen(server);
  try {
    const analysisUrl = `${base}/api/sessions/preserved-cache/analysis`;
    assert.equal((await fetch(analysisUrl)).status, 200);
    assert.equal(materializationCalls, 1);

    const start = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'G:\\repo\\replacement-fails' }),
    });
    assert.equal(start.status, 202);
    const jobId = (await start.json()).job.id;
    let status;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(jobId)}`);
      status = await response.json();
      if (status.job.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(status.job.status, 'failed');
    assert.equal((await fetch(analysisUrl)).status, 200);
    assert.equal(materializationCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
