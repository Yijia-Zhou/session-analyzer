'use strict';

// Descriptive synthetic capacity probe, not a benchmark gate. Each case runs in
// a fresh process; OS filesystem caches remain shared and are not flushed.
// Usage: node scripts/pi-session-profile.js [--reader-root /path/to/checkout]
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

function args(argv) {
  const options = { readerRoot: path.resolve(__dirname, '..'), child: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reader-root' && argv[i + 1]) options.readerRoot = path.resolve(argv[++i]);
    else if (argv[i].startsWith('--reader-root=') && argv[i].slice(14)) options.readerRoot = path.resolve(argv[i].slice(14));
    else if (argv[i] === '--child' && ['linear-4mib', 'shared-1000x16'].includes(argv[i + 1])) options.child = argv[++i];
    else throw new Error('Usage: node scripts/pi-session-profile.js [--reader-root /checkout]');
  }
  return options;
}
function snapshot() {
  return { memoryBytes: process.memoryUsage(), resourceUsage: process.resourceUsage() };
}
async function profile(options) {
  const { buildPiIndex, piAdapter } = require(path.join(options.readerRoot, 'src/pi'));
  const { materializeSessionForIndex, buildEventDetailForSession } = require(path.join(options.readerRoot, 'src/source-adapters'));
  const { disposeProjectQueryStore } = require(path.join(options.readerRoot, 'src/project-query-store'));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-synthetic-profile-'));
  let index;
  try {
    const repoRoot = path.join(temporary, 'project');
    const sourceHome = path.join(temporary, 'agent');
    const sessionDir = path.join(sourceHome, 'sessions', 'synthetic');
    await fs.mkdir(repoRoot);
    await fs.mkdir(sessionDir, { recursive: true });
    const timestamp = '2026-10-23T00:00:00.000Z';
    const header = { type: 'session', version: 3, id: 'synthetic-profile', cwd: repoRoot, timestamp };
    let lines = [JSON.stringify(header)];
    let bytes = Buffer.byteLength(lines[0]) + 1;
    let physicalEntries = 0;
    const append = (id, parentId, text) => {
      const row = JSON.stringify({ type: 'message', id, parentId, timestamp,
        message: { role: 'user', content: text, timestamp: Date.parse(timestamp) } });
      lines.push(row); bytes += Buffer.byteLength(row) + 1; physicalEntries++;
    };
    if (options.child === 'linear-4mib') {
      while (bytes < 4 * 1024 * 1024) {
        const n = physicalEntries;
        append(`entry-${n}`, n ? `entry-${n - 1}` : null, `SYNTHETIC_PROFILE_NEEDLE ${n} ${'recorded synthetic text '.repeat(160)}`);
      }
    } else {
      for (let n = 0; n < 1000; n++) append(`prefix-${n}`, n ? `prefix-${n - 1}` : null,
        `SYNTHETIC_PROFILE_NEEDLE shared ${n} ${'synthetic '.repeat(24)}`);
      for (let n = 0; n < 16; n++) append(`leaf-${n}`, 'prefix-999', `SYNTHETIC_PROFILE_NEEDLE branch ${n}`);
    }
    await fs.writeFile(path.join(sessionDir, 'synthetic.jsonl'), lines.join('\n') + '\n');
    lines = null;
    const stages = [];
    const measure = async (name, action, facts = () => ({})) => {
      const before = snapshot(); const started = performance.now();
      const value = await action();
      stages.push({ name, elapsedMs: performance.now() - started, before, after: snapshot(), ...facts(value) });
      return value;
    };
    index = await measure('coldIndex', () => buildPiIndex({ repoRoot, sourceHome }));
    const selected = index.sessions[0];
    if (!selected) throw new Error('Synthetic profile indexed no Sessions');
    const session = await measure('coldSelectedMaterialization', () => materializeSessionForIndex(index, selected));
    const event = session.logicalEvents.find(item => item.layer === 'main');
    if (!event) throw new Error('Synthetic profile has no Main event');
    const detail = () => buildEventDetailForSession(index, session, event.id, 'main');
    await measure('firstDetailOnMaterializedSession', detail);
    await measure('repeatedDetailOnSameMaterializedSession', detail);
    const filters = { layer: 'main', q: 'SYNTHETIC_PROFILE_NEEDLE', limit: 20, offset: 0 };
    const search = () => piAdapter.query.filterSessions(index, filters);
    const resultFacts = value => ({ matchedSessions: value.total, matchedEvents: value.matchingEventTotal });
    await measure('firstProjectSearch', search, resultFacts);
    await measure('repeatedProjectSearch', search, resultFacts);
    return { case: options.child, readerRoot: options.readerRoot, node: process.version,
      platform: `${process.platform}/${process.arch}`, physicalBytes: bytes, physicalEntries,
      physicalRowsIncludingHeader: physicalEntries + 1, branchSessions: index.sessions.length,
      projectedRawRowsIncludingRepeatedHeaders: index.sessions.reduce((sum, item) => sum + item.rawEventCount, 0),
      projectedLogicalEvents: index.sessions.reduce((sum, item) => sum + item.logicalEventCount, 0),
      selectedBranchRawRows: session.rawEventCount, selectedBranchLogicalEvents: session.logicalEventCount,
      diagnostics: index.sourceDiagnostics, stages, final: snapshot() };
  } finally {
    if (index) await disposeProjectQueryStore(index.projectQueryStore);
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
async function main() {
  const options = args(process.argv.slice(2));
  if (options.child) {
    process.stdout.write(JSON.stringify(await profile(options)) + '\n');
    return;
  }
  const cases = [];
  for (const name of ['linear-4mib', 'shared-1000x16']) {
    const child = spawnSync(process.execPath, [__filename, '--reader-root', options.readerRoot, '--child', name],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`Profile ${name} failed (${child.status ?? child.signal}): ${child.stderr}`);
    cases.push(JSON.parse(child.stdout));
  }
  process.stdout.write(JSON.stringify({ schemaVersion: 1, descriptiveOnly: true,
    notes: ['Synthetic data only; temporary files removed after each case.',
      'Each case uses a fresh child process; filesystem caches are not flushed.',
      'Cold means first API call in the child, not cold OS cache; repeated Detail retains the same materialized Session.',
      'No forced GC; snapshots include transient allocations. resourceUsage.maxRSS is process high-water RSS in KiB, not an operation delta.',
      'Memory snapshots use bytes; resourceUsage CPU times use microseconds. No thresholds or pass/fail performance claims.'], cases }, null, 2) + '\n');
}
main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
