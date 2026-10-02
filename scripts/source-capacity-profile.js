'use strict';

// Run alone: node --expose-gc scripts/source-capacity-profile.js [65536]
// Synthetic files only; directory creation and cleanup are outside measurements.
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { buildClaudeSourceBackedIndex } = require('../src/claude');

async function main() {
  const fileCount = Number(process.argv[2] || 65536);
  assert.ok(Number.isSafeInteger(fileCount) && fileCount > 0);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-capacity-profile-'));
  const repoRoot = path.join(root, 'repo');
  const container = path.join(root, 'projects', 'capacity');
  const options = { claudeHome: root, repoRoot };
  const file = path.join(container, 'capacity.jsonl');
  const row = (uuid) => `${JSON.stringify({ type: 'user', sessionId: 'capacity', cwd: repoRoot,
    uuid, timestamp: '2026-09-01T00:00:00.000Z', message: { role: 'user', content: uuid } })}\n`;
  const measurements = [];
  async function measure(name, operation) {
    global.gc?.();
    const start = process.memoryUsage();
    let peakRss = start.rss;
    let peakHeap = start.heapUsed;
    const sample = () => {
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakHeap = Math.max(peakHeap, memory.heapUsed);
    };
    const timer = setInterval(sample, 10);
    const began = performance.now();
    try {
      return await operation();
    } finally {
      sample();
      clearInterval(timer);
      measurements.push({ name, elapsedMs: Math.round(performance.now() - began),
        peakRss, peakHeap, startRss: start.rss, startHeap: start.heapUsed,
        activeResources: process.getActiveResourcesInfo() });
    }
  }
  try {
    await fsp.mkdir(repoRoot);
    await fsp.mkdir(container, { recursive: true });
    await fsp.writeFile(file, row('first'));
    const groupCount = Math.ceil(fileCount / 256);
    for (let i = 0; i < groupCount; i += 1) await fsp.mkdir(path.join(container, `extra-${i}`));
    for (let base = 0; base < fileCount; base += 32) {
      await Promise.all(Array.from({ length: Math.min(32, fileCount - base) }, (_, j) => {
        const i = base + j;
        return fsp.writeFile(path.join(container, `extra-${Math.floor(i / 256)}`, `note-${i}`), '');
      }));
    }
    const first = await measure('cold', () => buildClaudeSourceBackedIndex(options));
    const warm = await measure('reuse', () => buildClaudeSourceBackedIndex({ ...options, previousIndex: first }));
    assert.equal(first.sessions.length, 1);
    assert.equal(warm.projectQueryStore, first.projectQueryStore);
    await fsp.appendFile(file, row('tail'));
    const rebuilt = await measure('rebuild', () => buildClaudeSourceBackedIndex({ ...options, previousIndex: warm }));
    assert.equal(rebuilt.sessions[0].rawEventCount, 2);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25);
    await measure('cancel', () => assert.rejects(buildClaudeSourceBackedIndex({ ...options,
      signal: controller.signal, previousIndex: rebuilt }), { name: 'AbortError' }));
    clearTimeout(timer);
    console.log(JSON.stringify({ node: process.version, platform: process.platform,
      fileCount, treeEntries: fileCount + groupCount + 2, measurements }, null, 2));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
