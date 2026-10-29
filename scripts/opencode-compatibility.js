#!/usr/bin/env node
'use strict';

// Opt-in producer compatibility probe. Ordinary tests do not run this command.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const evidence = require('./lib/opencode-compatibility');
const { buildOpenCodeIndex, opencodeAdapter } = require('../src/opencode');
const { materializeSessionForIndex, readIndexedRawRecord, buildEventDetailForSession } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');

const HELP = 'node scripts/opencode-compatibility.js --version X.Y.Z --binary /path/to/opencode --source-checkout /path/to/upstream --output /new/report-directory [--baseline-report /path/to/baseline/report.json]';
function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    if (!['--version', '--binary', '--source-checkout', '--output', '--baseline-report'].includes(key)
      || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error(HELP);
    options[key] = value;
  }
  for (const key of ['--version', '--binary', '--source-checkout', '--output']) if (!options[key]) throw new Error(HELP);
  evidence.version(options['--version']);
  if (options['--version'] !== evidence.BASELINE.version && !options['--baseline-report']) throw new Error('Candidate runs require --baseline-report from the accepted baseline on the same Analyzer commit');
  return options;
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function until(fn, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await delay(100); }
  throw Object.assign(new Error('Probe operation timed out'), { code: 'PROBE_TIMEOUT' });
}
async function waitForServer(request, assertAlive, milliseconds = 30000) {
  await until(async () => {
    assertAlive();
    try { await request('/api/session'); return true; }
    catch (error) {
      // The listener can start before migrations and service initialization end.
      if (error.code?.startsWith('HTTP_') && error.code !== 'HTTP_503') throw error;
      return false;
    }
  }, milliseconds);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await until(() => child.exitCode !== null || child.signalCode !== null, 5000);
  }
}
async function run(options) {
  if (process.platform !== 'linux') throw new Error('Producer probe currently supports Linux only; ordinary reader tests remain cross-platform');
  // System-managed plugins cannot be overridden completely by the supported CLI.
  if (fs.existsSync('/etc/opencode')) throw new Error('Run the producer probe on a clean Linux host without /etc/opencode');
  const output = path.resolve(options['--output']);
  await fsp.mkdir(output, { recursive: false, mode: 0o700 }); // Never overwrite an earlier evidence bundle.
  const report = { format: 'session-analyzer-opencode-compatibility-v1', probeVersion: 1,
    probeDigest: evidence.hash(Buffer.concat([fs.readFileSync(__filename), fs.readFileSync(path.join(__dirname, 'lib/opencode-compatibility.js'))])),
    analyzer: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(),
      runtimeDigest: evidence.runtimeDigest(path.join(__dirname, '..')),
      worktreeDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(),
      node: process.version, platform: process.platform },
    producer: { version: options['--version'] }, checks: evidence.CHECKS.map(name => ({ name, status: 'not-run' })), databaseSchema: null, messageShapes: [],
    gaps: evidence.GAPS, supportDecision: 'unchanged', outcome: 'probe-failed', cleanup: 'pending' };
  let root; let child; let release; let shellCompletion; const indexes = [];
  const shutdown = new AbortController();
  let stage = 'provenance'; let infrastructureReady = false;
  const shapes = new Set();
  async function check(name, fn) {
    stage = name;
    const entry = report.checks.find(c => c.name === name); assert.ok(entry);
    try { const value = await fn(); entry.status = 'passed'; return value; }
    catch (error) { entry.status = 'failed'; entry.code = safeCode(error); throw error; }
  }
  try {
    report.producer = evidence.sourceEvidence(path.resolve(options['--source-checkout']), options['--version']);
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sa-opencode-compatibility-'));
    const env = evidence.isolatedEnv(root);
    for (const directory of ['data', 'config/opencode', 'cache', 'state', 'tmp', 'home', 'project', 'snapshots']) await fsp.mkdir(path.join(root, directory), { recursive: true });
    const project = path.join(root, 'project'); release = path.join(project, 'release');
    const binary = await fsp.realpath(path.resolve(options['--binary']));
    // Stream the large executable hash without retaining its bytes.
    report.producer.binarySha256 = await new Promise((resolve, reject) => {
      const hash = require('node:crypto').createHash('sha256'); const input = fs.createReadStream(binary);
      input.on('error', reject); input.on('data', chunk => hash.update(chunk)); input.on('end', () => resolve(hash.digest('hex')));
    });
    report.producer.reportedVersion = execFileSync(binary, ['--version'], { cwd: project, env, timeout: 15000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    assert.equal(report.producer.reportedVersion, `opencode v${options['--version']}`);
    const port = await freePort();
    child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    // Do not put upstream logs, responses, paths, or authentication in public artifacts.
    child.stdout.resume(); child.stderr.resume();
    let spawnError; child.on('error', error => { spawnError = error; });
    async function request(route, method = 'GET', payload, timeout = 10000) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeout)]),
        headers: { authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`, 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload) });
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('Upstream HTTP request failed'), { code: `HTTP_${response.status}` }); }
      if (response.status === 204) return null;
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; assert.ok(bytes <= 2 * 1024 * 1024, 'HTTP response budget'); chunks.push(part.value); } }
      finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    stage = 'server-startup';
    await waitForServer(request, () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw Object.assign(new Error('Producer exited'), { code: 'PRODUCER_EXITED' });
    });
    infrastructureReady = true;
    const main = await check('session-create', async () => {
      const result = await request('/api/session', 'POST', { id: 'ses_compat_main', title: 'Compatibility probe', location: { directory: project } });
      assert.equal(result.data.id, 'ses_compat_main'); return result.data;
    });
    const dbPath = env.OPENCODE_DB;
    const sql = () => evidence.inspectDatabase(dbPath, main.id);
    const messages = async () => {
      const result = await evidence.readApiMessages(request, main.id);
      for (const shape of evidence.messageShapes(result)) shapes.add(shape);
      return result;
    };
    async function indexed(sessionID, expected) {
      const index = await buildOpenCodeIndex({ sourceHome: dbPath, repoRoot: project, snapshotBase: path.join(root, 'snapshots') });
      indexes.push(index);
      const meta = index.sessions.find(s => s.sourceSessionId === sessionID);
      assert.ok(meta, 'session is discoverable');
      const session = await materializeSessionForIndex(index, meta);
      const rows = [expected.session, ...expected.rows];
      assert.equal(session.rawEvents.length, rows.length);
      for (const raw of session.rawEvents) {
        const result = await readIndexedRawRecord(index, session, raw.rawId);
        const original = raw.sourceLocator.table === 'session_v2' ? expected.session : expected.rows.find(r => r.id === raw.sourceLocator.messageID);
        assert.deepEqual(JSON.parse(result.raw), JSON.parse(JSON.stringify(original)), 'exact SQL row including JSON data string');
      }
      for (const event of session.logicalEvents) assert.ok(await buildEventDetailForSession(index, session, event.id, event.layer));
      return { index, session, expected };
    }
    await check('database-layout', async () => { report.databaseSchema = sql().schema; assert.ok(report.databaseSchema.length > 0); });
    await check('live-shell-start', async () => {
      // Finite loop is a second cleanup bound if the probe is terminated.
      shellCompletion = request(`/api/session/${main.id}/shell`, 'POST', { id: 'msg_compat_shell',
        command: "printf 'compatibility-start'; i=0; while [ ! -f release ] && [ \"$i\" -lt 600 ]; do sleep 0.1; i=$((i+1)); done; printf 'compatibility-end'; exit 7" }, 45000)
        .then(() => ({}), error => ({ error }));
      await until(async () => (await messages()).some(m => m.id === 'msg_compat_shell' && m.status === 'running'));
    });
    let first;
    await check('running-api-sql-snapshot', async () => {
      const original = sql(); evidence.compareApiRows(await messages(), original.rows);
      first = await indexed(main.id, original);
      assert.ok(first.session.logicalEvents.some(e => e.kind === 'command' && e.status === 'incomplete'));
    });
    await check('export-omits-running-shell', async () => {
      const exported = await request(`/api/experimental/session/${main.id}/export`);
      assert.ok(!exported.data.messages.some(m => m.id === 'msg_compat_shell'));
    });
    await check('same-message-completion-and-old-snapshot', async () => {
      await fsp.writeFile(release, 'release');
      const completion = await shellCompletion; if (completion.error) throw completion.error;
      await until(async () => (await messages()).some(m => m.id === 'msg_compat_shell' && m.status === 'exited'));
      const current = sql(); evidence.compareApiRows(await messages(), current.rows);
      const before = first.expected.rows.find(r => r.id === 'msg_compat_shell'); const after = current.rows.find(r => r.id === before.id);
      assert.equal(after.seq, before.seq); assert.notEqual(after.data, before.data);
      assert.equal(JSON.parse(after.data).exit, 7);
      const second = await indexed(main.id, current);
      assert.notEqual(first.session.materializationSnapshotId, second.session.materializationSnapshotId);
      assert.ok(second.session.logicalEvents.some(e => e.kind === 'command' && e.status === 'failed'));
      const oldRaw = first.session.rawEvents.find(r => r.sourceLocator.messageID === before.id);
      assert.equal(JSON.parse((await readIndexedRawRecord(first.index, first.session, oldRaw.rawId)).raw).data, before.data);
      const exported = await request(`/api/experimental/session/${main.id}/export`);
      evidence.compareApiRows(exported.data.messages, current.rows);
    });
    await check('metadata-update', async () => {
      await request(`/api/session/${main.id}`, 'PATCH', { title: 'Compatibility renamed', metadata: { probe: 'updated' } });
      const current = sql(); assert.equal(current.session.title, 'Compatibility renamed');
      assert.equal(JSON.parse(current.session.metadata).probe, 'updated');
      await indexed(main.id, current);
    });
    await check('import-settled-messages', async () => {
      // Import exercises transfer persistence, not the model's assistant producer.
      const importedMessages = [{ id: 'msg_compat_user', type: 'user', text: 'Compatibility question', time: { created: 1700000000000 } },
        { id: 'msg_compat_answer', type: 'assistant', agent: 'build', model: { providerID: 'probe', id: 'no-model' },
          content: [{ type: 'text', text: 'Compatibility answer' }], time: { created: 1700000000001, completed: 1700000000002 } }];
      await request('/api/experimental/session/import', 'POST', { info: { ...main, id: 'ses_compat_import', title: 'Imported synthetic messages' }, messages: importedMessages, location: { directory: project } });
      const current = evidence.inspectDatabase(dbPath, 'ses_compat_import');
      evidence.compareApiRows(importedMessages, current.rows);
      const imported = await indexed('ses_compat_import', current);
      assert.ok(imported.session.logicalEvents.some(e => e.kind === 'user_message'));
      assert.ok(imported.session.logicalEvents.some(e => e.kind === 'assistant_message'));
      const hits = await opencodeAdapter.query.filterSessions(imported.index, { layer: 'main', q: 'Compatibility answer' });
      assert.equal(hits.total, 1); assert.equal(hits.matchingEventTotal, 1);
      for (const shape of evidence.messageShapes(importedMessages)) shapes.add(shape);
    });
    await check('parent-and-fork-relations', async () => {
      const childSession = (await request('/api/session', 'POST', { id: 'ses_compat_child', parentID: main.id })).data;
      assert.equal(childSession.parentID, main.id);
      const childRows = evidence.inspectDatabase(dbPath, childSession.id); assert.equal(childRows.session.parent_id, main.id);
      await indexed(childSession.id, childRows);
      const fork = (await request(`/api/session/${main.id}/fork`, 'POST', {})).data;
      const forkRows = evidence.inspectDatabase(dbPath, fork.id); assert.equal(forkRows.session.fork_session_id, main.id);
      assert.ok(forkRows.rows.length > 0); await indexed(fork.id, forkRows);
    });
    await check('delete-and-held-snapshot', async () => {
      await request(`/api/session/${main.id}`, 'DELETE');
      assert.equal(sql().session, undefined); assert.equal(sql().rows.length, 0);
      const next = await buildOpenCodeIndex({ sourceHome: dbPath, repoRoot: project, snapshotBase: path.join(root, 'snapshots') }); indexes.push(next);
      assert.ok(!next.sessions.some(s => s.sourceSessionId === main.id));
      assert.ok(await readIndexedRawRecord(first.index, first.session, first.session.rawEvents[0].rawId));
    });
    report.messageShapes = [...shapes].sort();
    report.outcome = 'passed';
  } catch (error) {
    const infrastructureError = ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'PROBE_TIMEOUT', 'ABORT_ERR', 'OPENCODE_SQLITE_UNAVAILABLE'].includes(error?.code)
      || ['TimeoutError', 'AbortError'].includes(error?.name);
    report.outcome = infrastructureReady && !infrastructureError ? 'review-required' : 'probe-failed';
    report.failure = { stage, code: safeCode(error) }; // Error strings can include payloads, paths or credentials.
    report.messageShapes = [...shapes].sort();
  } finally {
    report.messageShapes = [...shapes].sort();
    if (options['--baseline-report'] && infrastructureReady) {
      try {
        const baselinePath = path.resolve(options['--baseline-report']); assert.ok((await fsp.stat(baselinePath)).size < 2 * 1024 * 1024);
        report.comparison = evidence.compareReports(JSON.parse(await fsp.readFile(baselinePath, 'utf8')), report);
        if (report.outcome === 'passed' && (report.comparison.sourceFiles.length || report.comparison.migrationTreeChanged || report.comparison.databaseSchemaChanged || report.comparison.messageShapesChanged)) report.outcome = 'review-required';
      } catch (error) { report.outcome = 'probe-failed'; report.comparisonError = safeCode(error); }
    }
    try {
      if (release) await fsp.writeFile(release, 'release').catch(() => {});
      if (shellCompletion) await Promise.race([shellCompletion, delay(5000, undefined, { ref: false })]);
      shutdown.abort();
      await stop(child);
      for (const index of indexes) await disposeIndexResources(index);
      if (root) await fsp.rm(root, { recursive: true, force: true });
      report.cleanup = 'completed';
    } catch (error) { report.cleanup = 'failed'; report.outcome = 'probe-failed'; report.cleanupError = safeCode(error); }
    await fsp.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    await fsp.writeFile(path.join(output, 'report.md'), markdown(report), { mode: 0o600 });
  }
  return report;
}
function safeCode(error) { return /^(?:OPENCODE_[A-Z_]+|ERR_ASSERTION|HTTP_\d{3}|PROBE_TIMEOUT|PRODUCER_EXITED|E[A-Z]+)$/.test(error?.code || '') ? error.code : 'PROBE_ERROR'; }
function markdown(report) {
  return `# OpenCode compatibility probe\n\nOutcome: **${report.outcome}**. Support decision: unchanged.\n\n` +
    `Producer: ${report.producer.version}; source: ${report.producer.commit || 'unresolved'}.\nAnalyzer: ${report.analyzer.commit}.\n\n` +
    '| Check | Result |\n| --- | --- |\n' + report.checks.map(c => `| ${c.name} | ${c.status}${c.code ? ` (${c.code})` : ''} |`).join('\n') +
    `\n\nCleanup: ${report.cleanup}.\n${report.failure ? `Failure stage: ${report.failure.stage}; code: ${report.failure.code}.\n` : ''}` +
    '\nReview source/schema/shape differences in report.json using docs/design-docs/schema-update-runbook.md. Passing this bounded probe does not accept a new producer version.\n\nUncovered:\n' + report.gaps.map(g => `- ${g}`).join('\n') + '\n';
}
if (require.main === module) {
  (async () => { const options = parseArgs(process.argv.slice(2)); if (options.help) return console.log(HELP);
    const report = await run(options); console.log(JSON.stringify({ outcome: report.outcome, checks: report.checks.length, cleanup: report.cleanup }));
    process.exitCode = report.outcome === 'passed' ? 0 : report.outcome === 'review-required' ? 2 : 1;
  })().catch(() => { console.error(`Compatibility probe could not run. ${HELP}`); process.exitCode = 1; });
}
module.exports = { parseArgs, run, markdown, safeCode, stop, waitForServer };
