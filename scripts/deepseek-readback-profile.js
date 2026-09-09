#!/usr/bin/env node
'use strict';

// Deterministic synthetic HTTP readback measurement; no user transcripts.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { zstdCompressSync } = require('node:zlib');

function option(name, fallback) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
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

async function writeFixture(root, dataRows, compression) {
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
      batch.push({ type: 'tool/call', seq, time: 1_780_000_000_001 + seq, data: { turn, step: 1, callId, name: 'bash', arguments: JSON.stringify({ command: `printf synthetic-${pair}` }) } });
      batch.push({ type: 'tool/result', seq: seq + 1, time: 1_780_000_000_002 + seq, data: { turn, step: 1, message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: output }], isError: false }], role: 'user', id: `profile-result-${pair}` } }, sourceEventSeqs: [seq], surfaceOp: 'append' });
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

async function worker(dataRows, compression) {
  if (compression === 'zstd' && typeof zstdCompressSync !== 'function') throw new Error('This profile needs built-in Zstd compression (Node 22.15+).');
  const { createServer } = require('../server');
  const { materializeSessionForIndex } = require('../src/source-adapters');
  const tempParent = path.resolve(os.tmpdir());
  const root = await fsp.mkdtemp(path.join(tempParent, 'session-analyzer-readback-profile-'));
  let server;
  const memory = [];
  const checkpoint = (stage) => memory.push({ stage, ...process.memoryUsage(), maxRSSKiB: process.resourceUsage().maxRSS });
  let materializationCalls = 0;
  try {
    checkpoint('beforeFixture');
    const fixture = await writeFixture(root, dataRows, compression);
    const identityBefore = await fsp.stat(fixture.file, { bigint: true });
    checkpoint('afterFixture');
    server = createServer(null, 0, {
      source: 'deepseek-harness', dshHome: fixture.sourceHome, sessionPrewarm: false,
      warn: (message) => process.stderr.write(`${message}\n`),
      materializeSession: async (...args) => {
        materializationCalls += 1;
        return materializeSessionForIndex(...args);
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
    // Adapter tool-event ID convention avoids a timeline read that would pre-materialize.
    const detailPath = (pair) => `/api/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(`${sessionId}:logical:tool:profile-call-${pair}`)}/detail?layer=main`;
    const rawPath = (pair) => `/api/sessions/${encodeURIComponent(sessionId)}/raw/${encodeURIComponent(`${sessionId}:raw:${pair * 2 + 1}`)}`;
    async function timed(route, raw = false) {
      const start = performance.now();
      const body = await request(route);
      const duration = performance.now() - start;
      if (raw) assert.match(body.raw, /"tool\/call"/);
      else assert.ok(Array.isArray(body.timelineSections) && body.timelineSections.length > 0);
      return duration;
    }
    const coldDetailMs = await timed(detailPath(0));
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
      dataRows, physicalRows: dataRows + 1, logicalToolEvents: dataRows / 2, compression,
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
  if (process.argv.includes('--worker')) {
    assert.equal(sizes.length, 1);
    assert.equal(compressions.length, 1);
    process.stdout.write(`${JSON.stringify(await worker(sizes[0], compressions[0]))}\n`);
    return;
  }
  const results = [];
  for (const size of sizes) {
    for (const compression of compressions) {
      process.stderr.write(`Measuring ${size} rows / ${compression}\n`);
      const output = execFileSync(process.execPath, [__filename, '--worker', `--sizes=${size}`, `--compression=${compression}`], {
        encoding: 'utf8', timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      });
      results.push(JSON.parse(output));
    }
  }
  const report = {
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
    method: 'Isolated child per case; real loopback HTTP; prewarm disabled; one index and one materialization; cold means materialization cold, not OS-cache cold. Warm API reads bypass browser detail cache. Memory includes generator, server and client; checkpoints miss transient synchronous peaks, maxRSS is process lifetime high-water.',
    results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
