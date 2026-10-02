'use strict';

// Run alone: node --expose-gc scripts/contract-capacity-profile.js --files=200001
// Synthetic production Codex input; retains no transcript after the run.
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const codex = require('../src/codex');
const { materializeSessionForIndex, validateIndexOwnership } = require('../src/source-adapters');

async function main() {
  const files = Number(process.argv.find((arg) => arg.startsWith('--files='))?.split('=')[1] || 200001);
  assert.ok(Number.isSafeInteger(files) && files > 0);
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-contract-profile-'));
  const repoRoot = path.join(home, 'repo');
  const folder = path.join(home, 'sessions', '2026', '08', '16');
  const id = '11111111-1111-4111-8111-111111111111';
  let peakRss = 0;
  let peakHeap = 0;
  const sample = () => {
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    peakHeap = Math.max(peakHeap, memory.heapUsed);
  };
  let interval;
  try {
    await fsp.mkdir(folder, { recursive: true });
    await fsp.mkdir(repoRoot);
    let changes = Object.fromEntries(Array.from({ length: files }, (_, index) => [
      `src/file-${index}.js`, { type: 'add', content: '+synthetic\n' },
    ]));
    const records = [
      { timestamp: '2026-08-16T10:00:00Z', type: 'session_meta', payload: { id, cwd: repoRoot } },
      { timestamp: '2026-08-16T10:00:01Z', type: 'event_msg',
        payload: { type: 'patch_apply_end', call_id: 'capacity-patch', success: true, changes } },
    ];
    const file = path.join(folder, `rollout-2026-08-16T10-00-00-${id}.jsonl`);
    await fsp.writeFile(file, `${records.map(JSON.stringify).join('\n')}\n`);
    const inputBytes = (await fsp.stat(file)).size;
    records.length = 0;
    changes = null;
    global.gc?.();
    const baseline = process.memoryUsage();
    interval = setInterval(sample, 10);
    const start = performance.now();
    const index = await codex.buildSourceBackedIndex({ codexHome: home, repoRoot });
    validateIndexOwnership(index);
    const indexedAt = performance.now();
    const indexed = index.sessionsById.get(id);
    const materialized = await materializeSessionForIndex(index, indexed);
    const materializedAt = performance.now();
    assert.equal(materialized.analysis.patchedFiles.length, files);
    assert.equal(materialized.analysis.patchedFiles.at(-1).file, `src/file-${files - 1}.js`);
    assert.equal(materialized.analysis.patchedFiles.at(-1).count, 1);
    assert.equal(indexed.summary.patchedFiles.length, Math.min(5, files));
    let baselineContract = null;
    const baselineRef = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11);
    if (baselineRef) {
      assert.match(baselineRef, /^[a-f0-9]{40}$/);
      const filename = path.join(__dirname, '..', 'src', 'canonical-contract.js');
      const previous = new Module(filename, module);
      previous.filename = filename;
      previous.paths = Module._nodeModulePaths(path.dirname(filename));
      previous._compile(execFileSync('git', ['show', `${baselineRef}:src/canonical-contract.js`],
        { encoding: 'utf8', cwd: path.join(__dirname, '..') }), filename);
      try {
        previous.exports.validateCanonicalMaterializedSessionShape(indexed, materialized, 'codex',
          { allowedPrivateFields: codex.materializedPrivateFields });
        baselineContract = 'accepted';
      } catch (error) {
        baselineContract = { code: error.code, message: error.message };
      }
      if (files >= 200_001) assert.match(baselineContract.message, /maximum entries/);
    }
    sample();
    process.stdout.write(`${JSON.stringify({ node: process.version, files, inputBytes,
      indexMs: indexedAt - start, materializeMs: materializedAt - indexedAt,
      baseline, sampledPeakRss: peakRss, sampledPeakHeap: peakHeap,
      processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
      baselineContract,
      tail: materialized.analysis.patchedFiles.at(-1),
    })}\n`);
  } finally {
    clearInterval(interval);
    await fsp.rm(home, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
