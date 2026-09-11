#!/usr/bin/env node
'use strict';

// Deterministic synthetic HTTP readback measurement; no user transcripts.
const assert = require('node:assert/strict');
const { execFileSync, execSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { zstdCompressSync } = require('node:zlib');
const { createPhaseCollector, coldAttribution } = require('./deepseek-phase-accounting');

function option(name, fallback) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

function fingerprintProfileFrom(value) {
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw new Error('fingerprint-profile must be on or off');
}

const FINGERPRINT_PROFILE_INVOCATIONS = Object.freeze([
  'private_capture/materialization_context',
  'private_capture/indexed_session',
  'private_capture/materialized_session',
  'private_recheck/materialization_context',
  'private_recheck/indexed_session',
  'private_recheck/materialized_session',
  'projection_recheck/materialized_session',
]);

const FINGERPRINT_PROFILE_METRICS = ['elapsedMs', 'yieldWaitMs', 'activeComputeMs'];
const FINGERPRINT_PROFILE_COUNTERS = [
  'visitTaskCount', 'writeTaskCount', 'byteTaskCount', 'firstObjectVisitCount',
  'repeatedReferenceCount', 'ownPropertyCount', 'mapEntryCount', 'setEntryCount',
  'writeTokenCount', 'textValueUtf8Bytes', 'textPrefixBytes', 'binaryHashBytes',
  'operationCount', 'chunkCount', 'yieldCount', 'hashInputBytes', 'hashUpdateCallCount', 'textHashUpdateCallCount',
];
const FINGERPRINT_PROFILE_FIELDS = [
  'role', ...FINGERPRINT_PROFILE_METRICS, ...FINGERPRINT_PROFILE_COUNTERS,
];

function fingerprintAttributionFrom(summaries) {
  assert.ok(Array.isArray(summaries), 'fingerprint profile must be an array');
  assert.equal(
    summaries.length,
    FINGERPRINT_PROFILE_INVOCATIONS.length,
    'fingerprint profile must contain exactly seven invocations',
  );
  const invocations = summaries.map((summary, index) => {
    const expected = FINGERPRINT_PROFILE_INVOCATIONS[index];
    assert.ok(summary && typeof summary === 'object', `fingerprint profile invocation ${index} is invalid`);
    assert.equal(summary.role, expected, `unexpected fingerprint profile invocation ${index}`);
    assert.deepEqual(
      Object.keys(summary).sort(),
      [...FINGERPRINT_PROFILE_FIELDS].sort(),
      `fingerprint profile invocation ${index} has unexpected fields`,
    );
    const invocation = { ...summary };
    for (const metric of FINGERPRINT_PROFILE_METRICS) {
      assert.ok(
        Number.isFinite(summary[metric]) && summary[metric] >= 0,
        `fingerprint profile invocation ${index} has invalid ${metric}`,
      );
    }
    for (const counter of FINGERPRINT_PROFILE_COUNTERS) {
      assert.ok(
        Number.isSafeInteger(summary[counter]) && summary[counter] >= 0,
        `fingerprint profile invocation ${index} has invalid ${counter}`,
      );
    }
    assert.ok(
      Math.abs(invocation.elapsedMs - invocation.yieldWaitMs - invocation.activeComputeMs) <= 1e-7,
      `fingerprint profile invocation ${index} has invalid wall-time accounting`,
    );
    assert.equal(
      invocation.operationCount,
      invocation.visitTaskCount + invocation.writeTaskCount + invocation.byteTaskCount,
      `fingerprint profile invocation ${index} has invalid operation accounting`,
    );
    assert.equal(
      invocation.chunkCount,
      Math.floor(invocation.operationCount / 4_096) + 1,
      `fingerprint profile invocation ${index} has invalid chunk accounting`,
    );
    assert.equal(
      invocation.yieldCount,
      invocation.chunkCount,
      `fingerprint profile invocation ${index} has invalid yield accounting`,
    );
    assert.equal(
      invocation.hashInputBytes,
      invocation.textPrefixBytes + invocation.textValueUtf8Bytes + invocation.binaryHashBytes,
      `fingerprint profile invocation ${index} has invalid hash-input accounting`,
    );
    assert.equal(
      invocation.hashUpdateCallCount,
      invocation.textHashUpdateCallCount + invocation.byteTaskCount,
      `fingerprint profile invocation ${index} has invalid hash-update accounting`,
    );
    assert.ok(
      invocation.writeTokenCount >= invocation.writeTaskCount,
      `fingerprint profile invocation ${index} has invalid write accounting`,
    );
    return invocation;
  });
  const totals = Object.fromEntries([...FINGERPRINT_PROFILE_METRICS, ...FINGERPRINT_PROFILE_COUNTERS].map((metric) => [
    metric,
    invocations.reduce((sum, invocation) => sum + invocation[metric], 0),
  ]));
  assert.ok(
    Math.abs(totals.elapsedMs - totals.yieldWaitMs - totals.activeComputeMs) <= 1e-7,
    'fingerprint profile totals have invalid wall-time accounting',
  );
  return { invocations, totals };
}

function sizesFrom(value) {
  const sizes = value.split(',').map(Number);
  if (!sizes.length || sizes.length > 4 || sizes.some((size) => !Number.isInteger(size) || size < 100 || size > 50_000 || size % 2)) {
    throw new Error('sizes must contain 1–4 even integers from 100 through 50000');
  }
  return [...new Set(sizes)];
}

function compressionsFrom(value) {
  const compressions = [...new Set(value.split(','))];
  if (compressions.some((compression) => !['plain', 'zstd'].includes(compression))) {
    throw new Error('compression must be plain, zstd, or plain,zstd');
  }
  return compressions;
}

const rounded = (value) => Math.round(value * 100) / 100;
function distribution(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
  return {
    samplesMs: samples.map(rounded),
    minMs: rounded(sorted[0]),
    medianMs: rounded(percentile(0.5)),
    p95Ms: rounded(percentile(0.95)),
    maxMs: rounded(sorted.at(-1)),
  };
}

function shapesFrom(value) {
  const shapes = [...new Set(value.split(','))];
  if (shapes.some((shape) => !['tool-dense', 'message-dense'].includes(shape))) throw new Error('shape must be tool-dense or message-dense');
  return shapes;
}

function eventTarget(shape, pair) {
  return shape === 'tool-dense' ? `logical:tool:profile-call-${pair}` : `logical:user_message:${pair * 2}`;
}

async function writeFixture(root, dataRows, compression, shape = 'tool-dense') {
  const repoRoot = path.join(root, 'target-repo');
  const sourceHome = path.join(root, 'sessions');
  const sessionDir = path.join(sourceHome, '--synthetic-readback--', 'profile-session');
  await fsp.mkdir(repoRoot);
  await fsp.mkdir(sessionDir, { recursive: true });
  const file = path.join(sessionDir, compression === 'plain' ? 'session.jsonl' : 'session.jsonl.zstd');
  const handle = await fsp.open(file, 'wx');
  let plainBytes = 0;
  let artifactBytes = 0;
  let frameCount = 0;
  async function writeRows(rows) {
    const plain = Buffer.from(`${rows.map((record) => JSON.stringify(record)).join('\n')}\n`);
    const bytes = compression === 'zstd' ? zstdCompressSync(plain) : plain;
    plainBytes += plain.length;
    artifactBytes += bytes.length;
    if (compression === 'zstd') frameCount += 1;
    await handle.writeFile(bytes);
  }
  try {
    await writeRows([{ type: 'session', version: 0, id: 'profile-session', createdAt: 1_780_000_000_000, cwd: repoRoot, delegationDepth: 0 }]);
    let batch = [];
    for (let pair = 0; pair < dataRows / 2; pair += 1) {
      const seq = pair * 2;
      const callId = `profile-call-${pair}`;
      const turn = pair + 1;
      // Eight hashes give deterministic varied text, without private content.
      const output = Array.from({ length: 8 }, (_, part) => createHash('sha256').update(`${pair}:${part}`).digest('hex')).join('');
      if (shape === 'tool-dense') {
        batch.push({ type: 'tool/call', seq, time: 1_780_000_000_001 + seq, data: { turn, step: 1, callId, name: 'bash', arguments: JSON.stringify({ command: `printf synthetic-${pair}` }) } });
        batch.push({ type: 'tool/result', seq: seq + 1, time: 1_780_000_000_002 + seq, data: { turn, step: 1, message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: output }], isError: false }], role: 'user', id: `profile-result-${pair}` } }, sourceEventSeqs: [seq], surfaceOp: 'append' });
      } else {
        batch.push({ type: 'user/message', seq, time: 1_780_000_000_001 + seq, surfaceOp: 'append', data: { turn, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: `Synthetic question ${pair}` }] } });
        batch.push({ type: 'assistant/message', seq: seq + 1, time: 1_780_000_000_002 + seq, surfaceOp: 'append', data: { turn, step: 1, message: { id: `profile-answer-${pair}`, content: [{ type: 'text', text: output }] } } });
      }
      if (batch.length === 256) {
        await writeRows(batch);
        batch = [];
      }
    }
    if (batch.length) await writeRows(batch);
  } finally {
    await handle.close();
  }
  return { repoRoot, sourceHome, file, plainBytes, artifactBytes, frameCount };
}

async function worker(dataRows, compression, shape = 'tool-dense', options = { fingerprintProfile: false }) {
  if (compression === 'zstd' && typeof zstdCompressSync !== 'function') throw new Error('This profile needs built-in Zstd compression (Node 22.15+).');
  const { createServer } = require('../server');
  const { materializeSessionForIndex, buildEventDetailForSession } = require('../src/source-adapters');
  const fingerprintProfile = options?.fingerprintProfile === true;
  const tempParent = path.resolve(os.tmpdir());
  const root = await fsp.mkdtemp(path.join(tempParent, 'session-analyzer-readback-profile-'));
  let server;
  const memory = [];
  const fingerprintSummaries = fingerprintProfile ? [] : null;
  let fingerprintAttribution;
  const checkpoint = (stage) => memory.push({ stage, ...process.memoryUsage(), maxRSSKiB: process.resourceUsage().maxRSS });
  let materializationCalls = 0;
  let collectingCold = false;
  let materializationStart;
  let materializationEnd;
  let detailConstructionMs = 0;
  let coldBuilderCalls = 0;
  let rawEventCount;
  let logicalEventCount;
  const collector = createPhaseCollector();
  try {
    checkpoint('beforeFixture');
    const fixture = await writeFixture(root, dataRows, compression, shape);
    const identityBefore = await fsp.stat(fixture.file, { bigint: true });
    checkpoint('afterFixture');
    server = createServer(null, 0, {
      source: 'deepseek-harness', dshHome: fixture.sourceHome, sessionPrewarm: false,
      warn: (message) => process.stderr.write(`${message}\n`),
      materializeSession: async (index, indexedSession, options) => {
        materializationCalls += 1;
        if (!collectingCold) return materializeSessionForIndex(index, indexedSession, options);
        materializationStart = performance.now();
        let session;
        const materializationOptions = { ...options, onMaterializationPhase: collector.onPhase };
        if (fingerprintProfile) {
          materializationOptions.onFingerprintProfile = (summary) => fingerprintSummaries.push(summary);
        }
        try {
          session = await materializeSessionForIndex(index, indexedSession, materializationOptions);
        } finally {
          materializationEnd = performance.now();
        }
        if (fingerprintProfile) fingerprintAttribution = fingerprintAttributionFrom(fingerprintSummaries);
        rawEventCount = session.rawEvents.length;
        logicalEventCount = session.logicalEvents.length;
        return session;
      },
      buildEventDetail: async (...args) => {
        if (!collectingCold) return buildEventDetailForSession(...args);
        coldBuilderCalls += 1;
        const start = performance.now();
        try { return await buildEventDetailForSession(...args); }
        finally { detailConstructionMs += performance.now() - start; }
      },
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, options) {
      const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(120_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${JSON.stringify(body)}`);
      return body;
    }
    const started = performance.now();
    const project = await request('/api/project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoRoot: fixture.repoRoot }) });
    for (;;) {
      if (performance.now() - started > 120_000) throw new Error('Indexing exceeded 120 seconds');
      const status = await request(`/api/project/status?jobId=${encodeURIComponent(project.job.id)}`);
      if (status.job.status === 'failed') throw new Error(JSON.stringify(status.job));
      if (status.job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const indexMs = performance.now() - started;
    checkpoint('afterIndex');
    assert.equal(materializationCalls, 0, 'first detail must be cold materialization');
    const sessionId = 'deepseek-harness:profile-session';
    // Deterministic adapter event IDs avoid a timeline read that would pre-materialize.
    const detailPath = (pair) => `/api/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(`${sessionId}:${eventTarget(shape, pair)}`)}/detail?layer=main`;
    const rawPath = (pair) => `/api/sessions/${encodeURIComponent(sessionId)}/raw/${encodeURIComponent(`${sessionId}:raw:${pair * 2 + 1}`)}`;
    async function timed(route, raw = false) {
      const start = performance.now();
      const body = await request(route);
      const duration = performance.now() - start;
      const targetId = decodeURIComponent(route.split('?')[0].split('/')[5]);
      if (raw) {
        assert.equal(body.rawId, targetId);
        assert.equal(JSON.parse(body.raw).type, shape === 'tool-dense' ? 'tool/call' : 'user/message');
      } else {
        assert.equal(body.id, targetId);
        assert.ok(Array.isArray(body.timelineSections) && body.timelineSections.length > 0);
      }
      return duration;
    }
    collectingCold = true;
    let coldDetailMs;
    try { coldDetailMs = await timed(detailPath(0)); }
    finally { collectingCold = false; }
    assert.equal(coldBuilderCalls, 1);
    const attribution = coldAttribution(collector, materializationStart, materializationEnd, detailConstructionMs, coldDetailMs);
    assert.equal(rawEventCount, dataRows + 1);
    assert.equal(logicalEventCount, shape === 'tool-dense' ? dataRows / 2 : dataRows);
    checkpoint('afterColdDetail');
    assert.equal(materializationCalls, 1);
    const pairs = Array.from({ length: 12 }, (_, i) => 1 + Math.floor(i * (dataRows / 2 - 2) / 12));
    const distinct = [];
    for (const pair of pairs) distinct.push(await timed(detailPath(pair)));
    checkpoint('afterDistinctDetails');
    const repeated = [];
    for (let i = 0; i < 6; i += 1) repeated.push(await timed(detailPath(pairs[0])));
    checkpoint('afterRepeatedDetails');
    const singleRawMs = await timed(rawPath(pairs[0]), true);
    checkpoint('afterSingleRaw');
    const concurrentRequests = [];
    const concurrentBatches = [];
    for (let batch = 0; batch < 3; batch += 1) {
      const start = performance.now();
      concurrentRequests.push(...await Promise.all(pairs.slice(0, 8).map((pair) => timed(rawPath(pair), true))));
      concurrentBatches.push(performance.now() - start);
      checkpoint(`afterConcurrentRawBatch${batch + 1}`);
    }
    assert.equal(materializationCalls, 1, 'warm reads should reuse the materialized session');
    const identityAfter = await fsp.stat(fixture.file, { bigint: true });
    for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(identityAfter[field], identityBefore[field]);
    return {
      dataRows, physicalRows: dataRows + 1, logicalToolEvents: shape === 'tool-dense' ? dataRows / 2 : 0, compression,
      shape, physicalRecordCount: dataRows + 1, rawEventCount, logicalEventCount, uncompressedBytes: fixture.plainBytes,
      coldAttribution: attribution, ...(fingerprintProfile ? { fingerprintAttribution } : {}),
      materializationCallsBeforeColdDetail: 0, materializationCallsAfterColdDetail: 1,
      plainBytes: fixture.plainBytes, artifactBytes: fixture.artifactBytes, frameCount: fixture.frameCount,
      indexMs: rounded(indexMs), coldDetailMs: rounded(coldDetailMs),
      distinctDetails: distribution(distinct), repeatedDetail: distribution(repeated), singleRawMs: rounded(singleRawMs),
      concurrentRawRequests: distribution(concurrentRequests), concurrentRawBatches: distribution(concurrentBatches),
      materializationCalls, sourceIdentityUnchanged: true, memory, maxRSSKiB: process.resourceUsage().maxRSS,
    };
  } finally {
    if (server?.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    // Remove only the exact temporary directory created by this worker.
    assert.equal(path.dirname(path.resolve(root)), tempParent);
    assert.ok(path.basename(root).startsWith('session-analyzer-readback-profile-'));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const sizes = sizesFrom(option('sizes', '10000,50000'));
  const compressions = compressionsFrom(option('compression', 'plain,zstd'));
  const shapes = shapesFrom(option('shape', 'tool-dense,message-dense'));
  const fingerprintProfile = fingerprintProfileFrom(option('fingerprint-profile', 'off'));
  if (process.argv.includes('--worker')) {
    assert.equal(sizes.length, 1);
    assert.equal(compressions.length, 1);
    assert.equal(shapes.length, 1);
    process.stdout.write(`${JSON.stringify(await worker(sizes[0], compressions[0], shapes[0], { fingerprintProfile }))}\n`);
    return;
  }
  const repositorySha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', windowsHide: true }).trim();
  const gitOptions = { cwd: path.join(__dirname, '..'), windowsHide: true };
  const repositoryDirty = execFileSync('git', ['status', '--porcelain'], gitOptions).length > 0;
  const trackedDiffSha256 = createHash('sha256').update(execFileSync('git', ['diff', '--no-ext-diff', '--binary', 'HEAD'], gitOptions)).digest('hex');
  const npmVersion = execSync('npm --version', { encoding: 'utf8', windowsHide: true }).trim();
  const results = [];
  for (const size of sizes) {
    for (const shape of shapes) {
      for (const compression of compressions) {
        process.stderr.write(`Measuring ${size} rows / ${shape} / ${compression}\n`);
        const output = execFileSync(process.execPath, [__filename, '--worker', `--sizes=${size}`, `--compression=${compression}`, `--shape=${shape}`, `--fingerprint-profile=${fingerprintProfile ? 'on' : 'off'}`], {
          encoding: 'utf8', timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
        });
        results.push(JSON.parse(output));
      }
    }
  }
  const report = {
    repositorySha, repositoryDirty, trackedDiffSha256,
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, npm: npmVersion, platform: process.platform, arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
    method: 'Isolated child per case; real loopback HTTP; prewarm disabled; one index and one materialization; cold means materialization cold, not OS-cache cold. Warm API reads bypass browser detail cache. Memory includes generator, server and client; checkpoints miss transient synchronous peaks, maxRSS is process lifetime high-water.',
    results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  writeFixture,
  eventTarget,
  worker,
  shapesFrom,
  fingerprintProfileFrom,
  fingerprintAttributionFrom,
  FINGERPRINT_PROFILE_INVOCATIONS,
};

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
