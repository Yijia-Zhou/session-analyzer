'use strict';

// Offline maintenance-tool contracts. These tests never install/run OpenCode.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const evidence = require('../scripts/lib/opencode-compatibility');
const { parseArgs, markdown, safeCode, stop, waitForServer } = require('../scripts/opencode-compatibility');
const { createOpenCodeFixture } = require('./helpers/opencode-fixture');

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-compat-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function report() {
  return { format: 'session-analyzer-opencode-compatibility-v1', probeVersion: 1, probeDigest: 'same-probe-bytes',
    analyzer: { commit: 'same-reader-commit', runtimeDigest: 'a'.repeat(64), node: process.version, platform: process.platform }, producer: { ...evidence.BASELINE,
      files: Object.fromEntries(evidence.SOURCE_FILES.map(file => [file, 'same-file'])), migrationTreeDigest: 'same-migrations' },
    outcome: 'passed', cleanup: 'completed', checks: evidence.CHECKS.map(name => ({ name, status: 'passed' })),
    databaseSchema: [{ name: 'session_message', columns: [{ name: 'data', type: 'TEXT' }] }],
    messageShapes: ['shell.status:string'], gaps: evidence.GAPS };
}

test('compatibility versions reject mutable aliases, ranges and shell/ref injection', () => {
  for (const value of ['latest', 'v2.1.4', '^2.1.4', '2.1', '2.1.4;echo bad', '2.1.4\n', '../2.1.4', '2.01.4', '', null]) assert.throws(() => evidence.version(value));
  assert.equal(evidence.version('2.1.4'), '2.1.4');
  assert.throws(() => parseArgs(['--version', '2.1.5', '--binary', '/binary', '--source-checkout', '/source', '--output', '/report']), /baseline-report/);
  assert.throws(() => parseArgs(['--output', '/report', '--output', '/second']), /node scripts/);
  assert.deepEqual(parseArgs(['--help']), { help: true });
});

test('producer environment isolates data/config and drops provider keys and launch hooks while retaining proxy trust', () => {
  const env = evidence.isolatedEnv('/probe', { PATH: '/bin', OPENROUTER_API_KEY: 'do-not-inherit',
    OPENCODE_DB: '/real/user.db', OPENCODE_CONFIG: '/private.json', NODE_OPTIONS: '--require private-hook',
    HTTP_PROXY: 'http://managed-proxy', NODE_EXTRA_CA_CERTS: '/managed-ca.pem', HOME: '/real/home' });
  assert.equal(env.HTTP_PROXY, 'http://managed-proxy'); assert.equal(env.NODE_EXTRA_CA_CERTS, '/managed-ca.pem');
  assert.equal(env.PATH, '/bin'); assert.equal(env.OPENROUTER_API_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.OPENCODE_CONFIG, undefined); assert.equal(env.HOME, undefined);
  assert.equal(env.OPENCODE_DB, path.join('/probe', 'data', 'opencode.db'));
  assert.equal(env.OPENCODE_TEST_HOME, path.join('/probe', 'home'));
  assert.notEqual(env.OPENCODE_SERVER_PASSWORD, evidence.isolatedEnv('/probe', {}).OPENCODE_SERVER_PASSWORD);
});

test('source evidence reads release Git objects rather than an edited checkout and detects a moved accepted tag', async t => {
  const root = await temporary(t);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init');
  const file = evidence.SOURCE_FILES[0]; await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), 'reviewed source');
  await fs.mkdir(path.join(root, 'packages/core/src/database/migration'), { recursive: true });
  await fs.writeFile(path.join(root, 'packages/core/src/database/migration/example.ts'), 'migration');
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic source');
  git('tag', 'v2.1.5'); await fs.writeFile(path.join(root, file), 'uncommitted changes');
  const result = evidence.sourceEvidence(root, '2.1.5');
  assert.equal(result.files[file], evidence.hash('reviewed source'));
  assert.equal(result.files[evidence.SOURCE_FILES[1]], null);
  assert.notEqual(result.migrationTreeDigest, evidence.hash(''));
  git('tag', 'v2.1.4'); assert.throws(() => evidence.sourceEvidence(root, '2.1.4'), /reviewed commit/);
});

test('runtime evidence detects changed reader bytes under the same commit and ignores documentation edits', async t => {
  const root = await temporary(t); await fs.mkdir(path.join(root, 'src'));
  for (const file of ['src/reader.js', 'package.json', 'package-lock.json']) await fs.writeFile(path.join(root, file), 'original');
  const baseline = report(); baseline.analyzer.runtimeDigest = evidence.runtimeDigest(root);
  await fs.writeFile(path.join(root, 'README.md'), 'documentation');
  assert.equal(evidence.runtimeDigest(root), baseline.analyzer.runtimeDigest);
  const candidate = structuredClone(baseline);
  for (const file of ['src/reader.js', 'src/new-reader.js', 'package-lock.json']) {
    await fs.writeFile(path.join(root, file), 'changed'); candidate.analyzer.runtimeDigest = evidence.runtimeDigest(root);
    assert.throws(() => evidence.compareReports(baseline, candidate), /same analyzer runtime bytes/);
    if (file === 'src/new-reader.js') await fs.unlink(path.join(root, file));
    else await fs.writeFile(path.join(root, file), 'original');
  }
});

test('read-only SQL inspection exposes actual schema and compares every API row including order and JSON body', async t => {
  const root = await temporary(t); const f = createOpenCodeFixture({ dbPath: path.join(root, 'db'), repoRoot: path.join(root, 'project') });
  try {
    const original = await fs.readFile(f.dbPath); const wal = await fs.readFile(f.dbPath + '-wal');
    const actual = evidence.inspectDatabase(f.dbPath, f.sessionId);
    const api = actual.rows.map(row => ({ ...JSON.parse(row.data), id: row.id, type: row.type }));
    evidence.compareApiRows(api, actual.rows);
    assert.throws(() => evidence.compareApiRows(api.slice(1), actual.rows));
    assert.throws(() => evidence.compareApiRows([...api].reverse(), actual.rows));
    assert.throws(() => evidence.compareApiRows([{ ...api[0], text: 'mutated' }, ...api.slice(1)], actual.rows));
    const table = actual.schema.find(s => s.name === 'session_message');
    assert.deepEqual(table.indexes.find(i => i.name === 'session_message_session_seq_idx').columns, ['session_id', 'seq']);
    assert.deepEqual(await fs.readFile(f.dbPath), original); assert.deepEqual(await fs.readFile(f.dbPath + '-wal'), wal);
  } finally { f.close(); }
});

test('API pagination follows final-page cursors to an empty page without mixing cursor and order', async () => {
  const seen = [];
  const actual = await evidence.readApiMessages(async route => {
    seen.push(route);
    return seen.length === 1 ? { data: [{ id: 'a' }], cursor: { next: 'after-a' } }
      : seen.length === 2 ? { data: [{ id: 'b' }], cursor: { next: 'after-b' } } : { data: [], cursor: {} };
  }, 'ses_probe');
  assert.deepEqual(actual, [{ id: 'a' }, { id: 'b' }]); assert.equal(seen.length, 3);
  assert.match(seen[0], /order=asc/); assert.match(seen[1], /cursor=after-a/); assert.doesNotMatch(seen[1], /order=/);
});

test('API pagination diagnoses repeated cursors and excessive messages rather than comparing a partial capture', async () => {
  await assert.rejects(evidence.readApiMessages(async () => ({ data: [{ id: 'a' }], cursor: { next: 'same' } }), 'ses_probe'), /non-advancing/);
  await assert.rejects(evidence.readApiMessages(async () => ({ data: Array.from({ length: 101 }, () => ({})) }), 'ses_probe'), /message limit/);
});

test('shape comparison excludes generated values but detects field/type changes', () => {
  const first = [{ type: 'shell', id: 'one', time: { created: 1 }, output: { output: 'private text' } }];
  const second = [{ type: 'shell', id: 'two', time: { created: 999 }, output: { output: 'different text' } }];
  assert.deepEqual(evidence.messageShapes(first), evidence.messageShapes(second));
  assert.ok(!JSON.stringify(evidence.messageShapes(first)).includes('private text'));
  second[0].time.created = 'changed wire type'; assert.notDeepEqual(evidence.messageShapes(first), evidence.messageShapes(second));
});

test('candidate comparison distinguishes source, migration, SQL schema and message-shape drift', () => {
  const baseline = report(); const candidate = structuredClone(baseline); candidate.producer.version = '2.1.5';
  assert.deepEqual(evidence.compareReports(baseline, candidate), { sourceFiles: [], migrationTreeChanged: false,
    databaseSchemaChanged: false, messageShapesChanged: false, unrunChecks: [], failedChecks: [] });
  candidate.producer.files[evidence.SOURCE_FILES[0]] = null;
  candidate.producer.migrationTreeDigest = 'changed'; candidate.databaseSchema[0].columns[0].type = 'BLOB';
  candidate.messageShapes.push('shell.newField:string'); candidate.checks[0].status = 'failed';
  candidate.checks[1].status = 'not-run';
  assert.deepEqual(evidence.compareReports(baseline, candidate), { sourceFiles: [evidence.SOURCE_FILES[0]], migrationTreeChanged: true,
    databaseSchemaChanged: true, messageShapesChanged: null, unrunChecks: ['database-layout'], failedChecks: ['session-create'] });
  candidate.checks = structuredClone(baseline.checks);
  assert.equal(evidence.compareReports(baseline, candidate).messageShapesChanged, true);
});

test('incomplete baseline, changed probe or different reader cannot authorize a compatibility comparison', () => {
  for (const mutate of [r => { r.outcome = 'review-required'; }, r => { r.cleanup = 'failed'; },
    r => { r.checks.pop(); }, r => { r.checks[0].status = 'not-run'; }, r => { r.producer.commit = 'other'; },
    r => { r.analyzer.commit = 'other'; }, r => { r.probeDigest = 'other'; }, r => { delete r.analyzer.runtimeDigest; },
    r => { r.analyzer.node = 'other'; }, r => { r.analyzer.platform = 'other'; }]) {
    const baseline = report(); mutate(baseline); assert.throws(() => evidence.compareReports(baseline, report()));
  }
});

test('startup retries transient 503 but bounds readiness and rejects authentication or route failures', async () => {
  let attempts = 0;
  await waitForServer(async () => { if (++attempts < 3) throw { code: 'HTTP_503' }; }, () => {});
  assert.equal(attempts, 3);
  for (const code of ['HTTP_401', 'HTTP_404']) {
    await assert.rejects(waitForServer(async () => { throw { code }; }, () => {}), { code });
  }
  await assert.rejects(waitForServer(async () => { throw { code: 'HTTP_503' }; }, () => {}, 150), { code: 'PROBE_TIMEOUT' });
  await assert.rejects(waitForServer(async () => {}, () => { throw { code: 'PRODUCER_EXITED' }; }), { code: 'PRODUCER_EXITED' });
});

test('report failures expose fixed error codes without serializing error messages or stack traces', () => {
  assert.equal(safeCode(new Error('private error payload')), 'PROBE_ERROR');
  assert.equal(safeCode({ code: 'OPENCODE_SCHEMA_UNSUPPORTED' }), 'OPENCODE_SCHEMA_UNSUPPORTED');
  assert.equal(safeCode({ code: 'secret-value' }), 'PROBE_ERROR');
  const r = report(); r.failure = { stage: 'session-create', code: 'HTTP_500' };
  assert.match(markdown(r), /Support decision: unchanged/); assert.match(markdown(r), /HTTP_500/);
  assert.match(markdown(r), /model-generated assistant/);
});

test('producer shutdown waits for actual child exit before returning and is idempotent', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  try { await once(child.stdout, 'data', { signal: AbortSignal.timeout(10000) }); await stop(child); assert.ok(child.exitCode !== null || child.signalCode !== null); await stop(child); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
