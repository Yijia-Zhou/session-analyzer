'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  capacityWarningFields,
  createIndexDiagnostics,
  diagnosticLogFiles,
  pruneDiagnosticLogs,
  progressFields,
} = require('../src/runtime-diagnostics');
const {
  LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES,
  LARGE_TRANSCRIPT_HISTORY_WARNING_CODE,
  createLargeTranscriptHistoryWarning,
  largeTranscriptHistoryWarning,
} = require('../src/runtime-capacity');
const { createServer } = require('../server');
const { strictClaudeIndexFromComplete } = require('./strict-claude-fixture');

async function makeTempDir(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-diagnostics-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

test('index diagnostics emit bounded aggregate lifecycle and peak-memory records', async (t) => {
  const logDir = await makeTempDir(t);
  let elapsedMs = 0;
  let memoryIndex = 0;
  const memorySamples = [
    { rss: 100, heapUsed: 50, heapTotal: 70, external: 10, arrayBuffers: 5 },
    { rss: 120, heapUsed: 80, heapTotal: 90, external: 11, arrayBuffers: 6 },
    { rss: 115, heapUsed: 60, heapTotal: 95, external: 12, arrayBuffers: 7 },
    { rss: 110, heapUsed: 55, heapTotal: 85, external: 9, arrayBuffers: 4 },
  ];
  const diagnostics = createIndexDiagnostics({
    logDir,
    jobId: 'job/1',
    sourceKind: 'codex',
    now: () => new Date(Date.UTC(2026, 7, 12, 0, 0, 0, elapsedMs)),
    clock: () => elapsedMs,
    readMemory: () => memorySamples[Math.min(memoryIndex++, memorySamples.length - 1)],
  });

  diagnostics.progress({ phase: 'scanning', repoRoot: 'sensitive/path', filesTotal: 5, filesScanned: 1 });
  elapsedMs = 250;
  diagnostics.progress({ phase: 'scanning', repoRoot: 'sensitive/path', filesTotal: 5, filesScanned: 2 });
  elapsedMs = 500;
  diagnostics.progress({ phase: 'parsing', repoRoot: 'sensitive/path', candidateFileCount: 3, candidateBytes: 2048 });
  diagnostics.capacityWarning({
    warningCode: LARGE_TRANSCRIPT_HISTORY_WARNING_CODE,
    thresholdBytes: 1024,
    candidateBytes: 2048,
    candidateFileCount: 3,
    repoRoot: 'sensitive/path',
    prompt: 'sensitive prompt',
  });
  elapsedMs = 750;
  diagnostics.finish('succeeded', { buildMs: 750 });
  diagnostics.finish('failed');

  const lines = (await fsp.readFile(diagnostics.filePath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((entry) => entry.event), [
    'indexing_started',
    'indexing_progress',
    'indexing_progress',
    'capacity_warning',
    'indexing_finished',
  ]);
  assert.equal(lines[1].repoRoot, undefined);
  assert.equal(lines[2].candidateBytes, 2048);
  assert.equal(lines[3].warningCode, LARGE_TRANSCRIPT_HISTORY_WARNING_CODE);
  assert.equal(lines[3].repoRoot, undefined);
  assert.equal(lines[3].prompt, undefined);
  assert.deepEqual(lines[2].peakMemory, {
    rss: 120,
    heapUsed: 80,
    heapTotal: 95,
    external: 12,
    arrayBuffers: 7,
  });
  assert.equal(lines[4].status, 'succeeded');
  assert.equal(lines[4].elapsedMs, 750);
  assert.deepEqual(lines[4].peakMemory, {
    rss: 120,
    heapUsed: 80,
    heapTotal: 95,
    external: 12,
    arrayBuffers: 7,
  });
});

test('large-history capacity warning is empirical, stable, non-blocking, and emitted once', () => {
  const messages = [];
  const warnings = [];
  const originalNodeOptions = process.env.NODE_OPTIONS;
  const monitor = createLargeTranscriptHistoryWarning({
    warn: (message) => messages.push(message),
    onWarning: (warning) => warnings.push(warning),
  });

  assert.equal(monitor.observe({
    phase: 'parsing',
    candidateBytes: LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES - 1,
    candidateFileCount: 4,
  }), null);
  const warning = monitor.observe({
    phase: 'parsing',
    candidateBytes: LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES,
    candidateFileCount: 5,
  });
  assert.equal(warning.warningCode, LARGE_TRANSCRIPT_HISTORY_WARNING_CODE);
  assert.match(warning.message, /indexing will continue normally/u);
  assert.match(warning.message, /no heap change is needed if it succeeds/u);
  assert.match(warning.message, /Only if indexing fails with "JavaScript heap out of memory"/u);
  assert.match(warning.message, /--log-dir <path>/u);
  assert.match(warning.message, /empirical guidance rather than an OOM boundary/u);
  assert.equal(monitor.observe({
    phase: 'parsing',
    candidateBytes: LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES * 2,
    candidateFileCount: 10,
  }), null);
  assert.equal(messages.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(process.env.NODE_OPTIONS, originalNodeOptions);

  const resilientMonitor = createLargeTranscriptHistoryWarning({
    warn: () => { throw new Error('synthetic stderr failure'); },
    onWarning: () => { throw new Error('synthetic diagnostics failure'); },
  });
  assert.doesNotThrow(() => resilientMonitor.observe({
    phase: 'parsing',
    candidateBytes: LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES,
  }));
});

test('large-history threshold is evaluated only after candidate selection completes', () => {
  assert.equal(largeTranscriptHistoryWarning({
    phase: 'selecting',
    candidateBytes: LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES * 2,
  }), null);
  assert.equal(largeTranscriptHistoryWarning({
    phase: 'complete',
    candidateBytes: LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES * 2,
  }), null);
});

test('capacity diagnostics allow only stable aggregate warning fields', () => {
  assert.deepEqual(capacityWarningFields({
    warningCode: LARGE_TRANSCRIPT_HISTORY_WARNING_CODE,
    thresholdBytes: 1,
    candidateBytes: 2,
    candidateFileCount: 3,
    repoRoot: 'private/repository',
    sourceFile: 'private.jsonl',
    transcriptText: 'private transcript text',
    command: 'private command',
  }), {
    warningCode: LARGE_TRANSCRIPT_HISTORY_WARNING_CODE,
    thresholdBytes: 1,
    candidateBytes: 2,
    candidateFileCount: 3,
  });
});

test('diagnostic retention deletes only older indexing logs', async (t) => {
  const logDir = await makeTempDir(t);
  const unrelated = path.join(logDir, 'keep-me.txt');
  await fsp.writeFile(unrelated, 'unrelated', 'utf8');
  for (let index = 0; index < 5; index += 1) {
    const filePath = path.join(logDir, `index-2026-08-12-${index}.jsonl`);
    await fsp.writeFile(filePath, '{}\n', 'utf8');
    const timestamp = new Date(Date.UTC(2026, 7, 12, 0, 0, index));
    await fsp.utimes(filePath, timestamp, timestamp);
  }

  pruneDiagnosticLogs(logDir, 3);

  assert.equal(fs.existsSync(unrelated), true);
  assert.deepEqual(
    diagnosticLogFiles(logDir).map((entry) => path.basename(entry.filePath)),
    ['index-2026-08-12-4.jsonl', 'index-2026-08-12-3.jsonl', 'index-2026-08-12-2.jsonl'],
  );
});

test('progressFields keeps only aggregate non-path indexing data', () => {
  assert.deepEqual(progressFields({
    phase: 'complete',
    repoRoot: 'sensitive/path',
    sourceFile: 'sensitive.jsonl',
    sessionCount: 2,
    rawEventCount: 3,
    eventCount: 1,
  }), {
    phase: 'complete',
    sessionCount: 2,
    rawEventCount: 3,
    logicalEventCount: 1,
  });
});

test('server diagnostics record successful, failed, and cancelled indexing outcomes', async (t) => {
  const root = await makeTempDir(t);
  const cases = [
    {
      name: 'succeeded',
      expectedStatus: 'succeeded',
      buildIndex: async ({ repoRoot, sourceKind }) => strictClaudeIndexFromComplete({
        repoRoot,
        sourceKind,
        sessions: [],
        sessionsById: new Map(),
      }),
    },
    {
      name: 'failed',
      expectedStatus: 'failed',
      buildIndex: async () => {
        throw new Error('synthetic failure');
      },
    },
    {
      name: 'cancelled',
      expectedStatus: 'cancelled',
      cancel: true,
      buildIndex: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('late synthetic failure')));
      }),
    },
  ];

  for (const scenario of cases) {
    const logDir = path.join(root, scenario.name);
    const server = createServer(null, 0, {
      source: 'claude-code',
      logDir,
      buildIndex: scenario.buildIndex,
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const startResponse = await fetch(`${base}/api/project`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoRoot: 'synthetic-repository' }),
      });
      assert.equal(startResponse.status, 202);
      const jobId = (await startResponse.json()).job.id;
      if (scenario.cancel) {
        const cancelResponse = await fetch(`${base}/api/project/status?jobId=${jobId}`, { method: 'DELETE' });
        assert.equal(cancelResponse.status, 200);
      }

      let status = 'running';
      for (let attempt = 0; attempt < 50 && status === 'running'; attempt += 1) {
        const statusResponse = await fetch(`${base}/api/project/status?jobId=${jobId}`);
        status = (await statusResponse.json()).job.status;
        if (status === 'running') await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(status, scenario.expectedStatus);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }

    const [log] = diagnosticLogFiles(logDir);
    const entries = (await fsp.readFile(log.filePath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(entries.at(-1).event, 'indexing_finished');
    assert.equal(entries.at(-1).status, scenario.expectedStatus);
  }
});

test('server emits one large-history warning without blocking successful indexing', async (t) => {
  const root = await makeTempDir(t);
  const messages = [];
  const server = createServer(null, 0, {
    source: 'claude-code',
    logDir: root,
    warn: (message) => messages.push(message),
    buildIndex: async ({ repoRoot, sourceKind, onProgress }) => {
      const progress = {
        phase: 'parsing',
        candidateBytes: LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES + 1,
        candidateFileCount: 7,
        sessionCount: 0,
        rawEventCount: 0,
        eventCount: 0,
      };
      onProgress(progress);
      onProgress({ ...progress, sessionCount: 1, rawEventCount: 2, eventCount: 1 });
      return strictClaudeIndexFromComplete({
        repoRoot,
        sourceKind,
        sessions: [],
        sessionsById: new Map(),
      });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const startResponse = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'synthetic-repository' }),
    });
    assert.equal(startResponse.status, 202);
    const jobId = (await startResponse.json()).job.id;
    let job;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const statusResponse = await fetch(`${base}/api/project/status?jobId=${jobId}`);
      job = (await statusResponse.json()).job;
      if (job.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(job.status, 'succeeded');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  assert.equal(messages.length, 1);
  assert.match(messages[0], new RegExp(`\\[${LARGE_TRANSCRIPT_HISTORY_WARNING_CODE}\\]`, 'u'));
  const [log] = diagnosticLogFiles(root);
  const entries = (await fsp.readFile(log.filePath, 'utf8')).trim().split('\n').map(JSON.parse);
  const capacityEntries = entries.filter((entry) => entry.event === 'capacity_warning');
  assert.equal(capacityEntries.length, 1);
  assert.equal(capacityEntries[0].candidateFileCount, 7);
  assert.equal(capacityEntries[0].candidateBytes, LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES + 1);
  assert.equal(capacityEntries[0].warningCode, LARGE_TRANSCRIPT_HISTORY_WARNING_CODE);
});

test('English and Chinese README capacity guidance preserves aligned operational anchors', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const readmeZh = fs.readFileSync(path.join(__dirname, '..', 'README.zh-CN.md'), 'utf8');
  for (const content of [readme, readmeZh]) {
    assert.match(content, /490/u);
    assert.match(content, /305,485/u);
    assert.match(content, /788 MB/u);
    assert.match(content, /2\.16 GB/u);
    assert.match(content, /1\.055 GB/u);
    assert.match(content, /10\.84/u);
    assert.match(content, /0\.14 ms/u);
    assert.match(content, /800 MiB/u);
    assert.match(content, /SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY/u);
    assert.match(content, /JavaScript heap out of memory/u);
    assert.match(content, /--max-old-space-size=4096/u);
    assert.match(content, /--log-dir <path>/u);
    assert.match(content, /no eviction|不实现 eviction/u);
    assert.match(content, /permanent product capacity limits|永久的产品容量上限/u);
  }
});
