'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createIndexDiagnostics,
  diagnosticLogFiles,
  pruneDiagnosticLogs,
  progressFields,
} = require('../src/runtime-diagnostics');
const { createServer } = require('../server');

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
  elapsedMs = 750;
  diagnostics.finish('succeeded', { buildMs: 750 });
  diagnostics.finish('failed');

  const lines = (await fsp.readFile(diagnostics.filePath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((entry) => entry.event), [
    'indexing_started',
    'indexing_progress',
    'indexing_progress',
    'indexing_finished',
  ]);
  assert.equal(lines[1].repoRoot, undefined);
  assert.equal(lines[2].candidateBytes, 2048);
  assert.equal(lines[3].status, 'succeeded');
  assert.equal(lines[3].elapsedMs, 750);
  assert.deepEqual(lines[3].peakMemory, {
    rss: 120,
    heapUsed: 80,
    heapTotal: 95,
    external: 12,
    arrayBuffers: 7,
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
      buildIndex: async ({ repoRoot }) => ({ repoRoot }),
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
    const server = createServer(null, 0, { logDir, buildIndex: scenario.buildIndex });
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
