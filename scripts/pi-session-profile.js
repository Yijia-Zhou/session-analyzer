'use strict';

// Descriptive synthetic capacity probe, not a benchmark gate. Run with other
// suites paused. Each case runs serially in a fresh process; OS caches remain.
// Usage: node scripts/pi-session-profile.js [--reader-root /checkout]
//        [--suite default|capacity] [--case NAME ...] [--list-cases|--self-check]
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const MIB = 1024 * 1024;
const NEEDLE = 'SYNTHETIC_PROFILE_NEEDLE';
const CASES = Object.freeze({
  // Preserve the two original default workloads and their names.
  'linear-4mib': { shape: 'linear', artifacts: 1, targetBytes: 4 * MIB, textRepeats: 160 },
  'shared-1000x16': { shape: 'shared', artifacts: 1, prefixEntries: 1000, branches: 16, textRepeats: 24 },
  // Matched axes: size changes only the byte target; branch count and prefix
  // length vary independently with identical text density; artifact count
  // changes while the total number and size of message payloads stays fixed.
  'linear-1mib': { shape: 'linear', artifacts: 1, targetBytes: MIB, textRepeats: 160 },
  'linear-8mib': { shape: 'linear', artifacts: 1, targetBytes: 8 * MIB, textRepeats: 160 },
  'shared-1000x2': { shape: 'shared', artifacts: 1, prefixEntries: 1000, branches: 2, textRepeats: 24 },
  'shared-1000x32': { shape: 'shared', artifacts: 1, prefixEntries: 1000, branches: 32, textRepeats: 24 },
  'shared-100x16': { shape: 'shared', artifacts: 1, prefixEntries: 100, branches: 16, textRepeats: 24 },
  'large-text-record-1mib': { shape: 'large-record', artifacts: 1, recordPayloadBytes: MIB, media: false },
  'media-record-1mib': { shape: 'large-record', artifacts: 1, recordPayloadBytes: MIB, media: true },
  'artifacts-1x1024': { shape: 'fixed-linear', artifacts: 1, entriesPerArtifact: 1024, textRepeats: 24 },
  'artifacts-8x128': { shape: 'fixed-linear', artifacts: 8, entriesPerArtifact: 128, textRepeats: 24 },
});
const DEFAULT_CASES = ['linear-4mib', 'shared-1000x16'];
const USAGE = 'Usage: node scripts/pi-session-profile.js [--reader-root /checkout] [--suite default|capacity] [--case NAME ...] [--list-cases|--self-check]';
function args(argv) {
  const options = { readerRoot: path.resolve(__dirname, '..'), child: '', suite: 'default', cases: [], listCases: false, selfCheck: false };
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => {
      const result = inline === undefined ? argv[++i] : inline;
      if (!result || result.startsWith('--')) throw new Error(USAGE);
      return result;
    };
    if (name === '--reader-root') options.readerRoot = path.resolve(value());
    else if (name === '--child') options.child = value();
    else if (name === '--suite') options.suite = value();
    else if (name === '--case') options.cases.push(value());
    else if (name === '--list-cases' && inline === undefined) options.listCases = true;
    else if (name === '--self-check' && inline === undefined) options.selfCheck = true;
    else throw new Error(USAGE);
  }
  if (!['default', 'capacity'].includes(options.suite)
      || [options.child, ...options.cases].some((name) => name && !Object.hasOwn(CASES, name))) throw new Error(USAGE);
  if (options.child && (options.cases.length || options.listCases || options.selfCheck)) throw new Error(USAGE);
  return options;
}
function selectedCases(options) {
  return [...new Set(options.cases.length ? options.cases : options.suite === 'capacity' ? Object.keys(CASES) : DEFAULT_CASES)];
}
function snapshot() {
  return { memoryBytes: process.memoryUsage(), resourceUsage: process.resourceUsage() };
}

// Stream the fixture to disk instead of retaining a second corpus-sized line
// array in the profiled process. All payloads are synthetic and bounded.
async function writeSynthetic(sessionDir, repoRoot, config) {
  const timestamp = '2026-10-23T00:00:00.000Z';
  const totals = { physicalBytes: 0, physicalEntries: 0, physicalRowsIncludingHeader: 0,
    physicalArtifacts: config.artifacts, largestPhysicalRecordBytes: 0, artifacts: [] };
  for (let artifact = 0; artifact < config.artifacts; artifact++) {
    const file = path.join(sessionDir, `synthetic-${artifact}.jsonl`);
    const handle = await fs.open(file, 'wx');
    const facts = { physicalBytes: 0, physicalEntries: 0, largestPhysicalRecordBytes: 0 };
    const write = async (value) => {
      const row = JSON.stringify(value) + '\n';
      const bytes = Buffer.byteLength(row);
      await handle.writeFile(row);
      facts.physicalBytes += bytes;
      facts.largestPhysicalRecordBytes = Math.max(facts.largestPhysicalRecordBytes, bytes);
    };
    const append = async (id, parentId, content) => {
      await write({ type: 'message', id, parentId, timestamp,
        message: { role: 'user', content, timestamp: Date.parse(timestamp) } });
      facts.physicalEntries++;
    };
    try {
      await write({ type: 'session', version: 3, id: `synthetic-profile-${artifact}`, cwd: repoRoot, timestamp });
      if (config.shape === 'linear' || config.shape === 'fixed-linear') {
        while (config.shape === 'linear' ? facts.physicalBytes < config.targetBytes : facts.physicalEntries < config.entriesPerArtifact) {
          const n = facts.physicalEntries;
          await append(`entry-${n}`, n ? `entry-${n - 1}` : null,
            `${NEEDLE} ${n} ${'recorded synthetic text '.repeat(config.textRepeats)}`);
        }
      } else if (config.shape === 'shared') {
        for (let n = 0; n < config.prefixEntries; n++) await append(`prefix-${n}`, n ? `prefix-${n - 1}` : null,
          `${NEEDLE} shared ${n} ${'synthetic '.repeat(config.textRepeats)}`);
        for (let n = 0; n < config.branches; n++) await append(`leaf-${n}`, `prefix-${config.prefixEntries - 1}`, `${NEEDLE} branch ${n}`);
      } else {
        // A valid small PNG signature followed by synthetic padding exercises
        // media-bearing record parsing/redaction without loading an image.
        const payload = config.media ? 'iVBORw0KGgo=' + 'A'.repeat(config.recordPayloadBytes - 12)
          : 'T'.repeat(config.recordPayloadBytes);
        await append('large-record', null, config.media
          ? [{ type: 'text', text: NEEDLE }, { type: 'image', mimeType: 'image/png', data: payload }]
          : `${NEEDLE} ${payload}`);
      }
    } finally { await handle.close(); }
    const actual = await fs.stat(file);
    if (actual.size !== facts.physicalBytes) throw new Error('Synthetic byte accounting mismatch');
    totals.artifacts.push({ name: path.basename(file), ...facts });
    totals.physicalBytes += facts.physicalBytes;
    totals.physicalEntries += facts.physicalEntries;
    totals.physicalRowsIncludingHeader += facts.physicalEntries + 1;
    totals.largestPhysicalRecordBytes = Math.max(totals.largestPhysicalRecordBytes, facts.largestPhysicalRecordBytes);
  }
  return totals;
}
async function diskUsage(directory) {
  const result = { bytes: 0, files: 0 };
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await diskUsage(file); result.bytes += nested.bytes; result.files += nested.files;
    } else if (entry.isFile()) { result.bytes += (await fs.stat(file)).size; result.files++; }
  }
  return result;
}
async function profile(options) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-synthetic-profile-'));
  const queryTemporary = path.join(temporary, 'query-storage');
  await fs.mkdir(queryTemporary);
  // Isolate the disposable query files in this child so actual file sizes can
  // be measured without exposing private store state or scanning shared /tmp.
  const priorTemp = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]));
  for (const key of Object.keys(priorTemp)) process.env[key] = queryTemporary;
  let index; let disposeProjectQueryStore;
  try {
    const { buildPiIndex, piAdapter } = require(path.join(options.readerRoot, 'src/pi'));
    const { materializeSessionForIndex, buildEventDetailForSession } = require(path.join(options.readerRoot, 'src/source-adapters'));
    ({ disposeProjectQueryStore } = require(path.join(options.readerRoot, 'src/project-query-store')));
    const repoRoot = path.join(temporary, 'project');
    const sourceHome = path.join(temporary, 'agent');
    const sessionDir = path.join(sourceHome, 'sessions', 'synthetic');
    await fs.mkdir(repoRoot);
    await fs.mkdir(sessionDir, { recursive: true });
    const config = CASES[options.child];
    const physical = await writeSynthetic(sessionDir, repoRoot, config);
    const stages = [];
    const measure = async (name, action, facts = () => ({})) => {
      const before = snapshot(); const started = performance.now();
      const value = await action();
      const elapsedMs = performance.now() - started;
      const after = snapshot();
      stages.push({ name, elapsedMs, before, after, ...facts(value) });
      return value;
    };
    index = await measure('coldIndex', () => buildPiIndex({ repoRoot, sourceHome }));
    const queryDisk = await diskUsage(queryTemporary);
    const selected = index.sessions[0];
    if (!selected) throw new Error('Synthetic profile indexed no Sessions');
    const session = await measure('coldSelectedMaterialization', () => materializeSessionForIndex(index, selected));
    const event = session.logicalEvents.find((item) => item.layer === 'main');
    if (!event) throw new Error('Synthetic profile has no Main event');
    const detail = () => buildEventDetailForSession(index, session, event.id, 'main');
    await measure('firstDetailOnMaterializedSession', detail);
    await measure('repeatedDetailOnSameMaterializedSession', detail);
    const filters = { layer: 'main', q: NEEDLE, limit: 20, offset: 0 };
    const search = () => piAdapter.query.filterSessions(index, filters);
    const resultFacts = (value) => ({ matchedSessions: value.total, matchedEvents: value.matchingEventTotal });
    await measure('firstProjectSearch', search, resultFacts);
    await measure('repeatedProjectSearch', search, resultFacts);
    const projectedRawRows = index.sessions.reduce((sum, item) => sum + item.rawEventCount, 0);
    const projectedLogicalEvents = index.sessions.reduce((sum, item) => sum + item.logicalEventCount, 0);
    return { case: options.child, configuration: config, readerRoot: options.readerRoot, node: process.version,
      platform: `${process.platform}/${process.arch}`, ...physical, branchSessions: index.sessions.length,
      projectedRawRowsIncludingRepeatedHeaders: projectedRawRows, projectedLogicalEvents,
      projectedToPhysicalRawRowRatio: projectedRawRows / physical.physicalRowsIncludingHeader,
      projectedLogicalEventsPerPhysicalEntry: projectedLogicalEvents / physical.physicalEntries,
      queryShardDiskBytes: queryDisk.bytes, queryShardDiskFiles: queryDisk.files,
      queryStoreAccountedBytes: index.projectQueryStore?.accountedBytes ?? null,
      queryStoreSchemaVersion: index.projectQueryStore?.schemaVersion ?? null,
      selectedBranchRawRows: session.rawEventCount, selectedBranchLogicalEvents: session.logicalEventCount,
      diagnostics: index.sourceDiagnostics, stages, final: snapshot() };
  } finally {
    if (index) await disposeProjectQueryStore(index.projectQueryStore);
    for (const [key, value] of Object.entries(priorTemp)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
async function selfCheck() {
  const assert = require('node:assert/strict');
  assert.deepEqual(selectedCases(args([])), DEFAULT_CASES);
  assert.deepEqual(selectedCases(args(['--case=media-record-1mib', '--case', 'media-record-1mib'])), ['media-record-1mib']);
  assert.equal(selectedCases(args(['--suite=capacity'])).length, 11);
  for (const argv of [['--suite=unknown'], ['--case=unknown'], ['--reader-root'], ['--self-check=yes']]) assert.throws(() => args(argv));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-profile-self-check-'));
  try {
    const configurations = [
      { shape: 'shared', artifacts: 1, prefixEntries: 3, branches: 2, textRepeats: 2 },
      { shape: 'fixed-linear', artifacts: 2, entriesPerArtifact: 3, textRepeats: 2 },
      { shape: 'linear', artifacts: 1, targetBytes: 4096, textRepeats: 2 },
      { shape: 'large-record', artifacts: 1, recordPayloadBytes: 1024, media: false },
      { shape: 'large-record', artifacts: 1, recordPayloadBytes: 1024, media: true },
    ];
    for (const [i, config] of configurations.entries()) {
      const directory = path.join(temporary, String(i)); await fs.mkdir(directory);
      const facts = await writeSynthetic(directory, '/synthetic/project', config);
      const disk = await diskUsage(directory);
      assert.equal(facts.physicalBytes, disk.bytes);
      assert.equal(facts.physicalArtifacts, disk.files);
      assert.equal(facts.physicalRowsIncludingHeader, facts.physicalEntries + config.artifacts);
      const rows = (await fs.readFile(path.join(directory, 'synthetic-0.jsonl'), 'utf8')).trimEnd().split('\n').map(JSON.parse);
      assert.equal(rows[0].type, 'session');
      assert.equal(rows[1].message.role, 'user');
      if (config.shape === 'shared') {
        assert.equal(facts.physicalEntries, 5);
        assert.deepEqual(rows.slice(-2).map((row) => row.parentId), ['prefix-2', 'prefix-2']);
      }
      if (config.shape === 'fixed-linear') assert.equal(facts.physicalEntries, 6);
      if (config.shape === 'linear') assert.ok(facts.physicalBytes >= config.targetBytes);
      if (config.media) assert.equal(rows[1].message.content[1].data.length, config.recordPayloadBytes);
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  process.stdout.write('pi profile self-check passed (arguments, workload shapes, byte/row accounting; no reader characterization run)\n');
}
async function main() {
  const options = args(process.argv.slice(2));
  if (options.selfCheck) return selfCheck();
  if (options.listCases) {
    process.stdout.write(JSON.stringify(selectedCases(options).map((name) => ({ case: name, ...CASES[name] })), null, 2) + '\n'); return;
  }
  if (options.child) { process.stdout.write(JSON.stringify(await profile(options)) + '\n'); return; }
  const cases = [];
  for (const name of selectedCases(options)) {
    const child = spawnSync(process.execPath, [__filename, '--reader-root', options.readerRoot, '--child', name],
      { encoding: 'utf8', maxBuffer: 16 * MIB, timeout: 5 * 60 * 1000 });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`Profile ${name} failed (${child.status ?? child.signal}): ${child.stderr}`);
    cases.push(JSON.parse(child.stdout));
  }
  process.stdout.write(JSON.stringify({ schemaVersion: 2, descriptiveOnly: true, suite: options.suite,
    notes: ['Synthetic data only; temporary files removed after each case.',
      'Each case runs serially in a fresh child process; filesystem caches are not flushed.',
      'Cold means first API call in the child, not cold OS cache; repeated Detail retains the same materialized Session.',
      'Physical byte counts include JSONL envelopes and headers. Large-record payload bytes mean encoded string bytes, not decoded media bytes.',
      'Raw row amplification compares projected rows including repeated headers with physical rows including one header per artifact.',
      'Query shard disk bytes are actual logical file sizes under an isolated child temporary directory, not filesystem allocated blocks.',
      'No forced GC; snapshots include transient allocations and fixture generation. resourceUsage.maxRSS is process high-water RSS in KiB, not an operation delta.',
      'Memory snapshots use bytes; resourceUsage CPU times use microseconds. No thresholds or pass/fail performance claims.'], cases }, null, 2) + '\n');
}
main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
