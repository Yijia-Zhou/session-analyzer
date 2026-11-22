'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { freeze } = require('../scripts/freeze-history-eval');
const { freezeScope } = require('../scripts/history-eval-scope');
const { createGate, bindGateRpc, capture } = require('../scripts/history-eval-mcp');
const { summarize } = require('../scripts/aggregate-history-eval');

function readRows(file) {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
}

test('bounded subprocess capture retains bytes already received on timeout and overflow', async () => {
  const timedOut = await capture(process.execPath, ['-e', 'process.stdout.write("received"); setInterval(() => {}, 1000)'], { timeoutMs: 2000 });
  assert.equal(timedOut.failure.code, 'COMMAND_TIMEOUT');
  assert.equal(timedOut.captureComplete, false);
  assert.equal(timedOut.stdout.toString(), 'received');
  const overflow = await capture(process.execPath, ['-e', 'process.stdout.write("kept"); setTimeout(() => process.stdout.write("too many bytes"), 200)'], { limit: 8 });
  assert.equal(overflow.failure.code, 'CAPTURE_LIMIT');
  assert.equal(overflow.captureComplete, false);
  assert.equal(overflow.stdout.toString(), 'kept');
});
function responseText(response) {
  return response.content.map((item) => item.text).join('');
}
function responseValue(response) {
  return JSON.parse(responseText(response));
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function fixture(t, overrides = {}, expectedSessionIds = ['gate-synthetic']) {
  await fsp.mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const root = await fsp.mkdtemp(path.join(ROOT, 'tmp/history-gate-test-'));
  let gate = null;
  t.after(async () => {
    if (gate) await gate.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'project');
  await fsp.mkdir(project);
  const original = path.join(root, 'gate-synthetic.jsonl');
  const transcript = [
    { type: 'session_meta', timestamp: '2026-11-01T00:00:00Z', payload: { id: 'gate-synthetic', cwd: project } },
    { type: 'event_msg', timestamp: '2026-11-01T00:00:01Z', payload: { type: 'user_message', message: 'SYNTHETIC_GATE_EVIDENCE 中文' } },
  ].map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(original, transcript);
  const frozen = path.join(root, 'frozen');
  const corpus = freeze({ target: frozen, inputs: [original], repo: project });
  const corpusManifest = path.join(frozen, 'manifest.json');
  const port = await freePort();
  const serveArgs = ['serve', '--repo', project, '--source', 'codex', '--codex-home', corpus.codexHome, '--port', String(port)];
  const scope = await freezeScope({ corpusManifest, serveArgs, expectedSessionIds });
  const scopeFile = path.join(root, 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify(scope));
  const guideRoot = path.join(root, 'guide');
  fs.mkdirSync(guideRoot);
  const guide = 'SYNTHETIC_GUIDE 中文\n';
  fs.writeFileSync(path.join(guideRoot, 'SKILL.md'), guide);
  const config = { directory: path.join(root, 'trial'), trial: path.basename(root), condition: 'current', task: 'synthetic-task',
    model: 'synthetic-model', harness: 'synthetic-gate-test', scopeFile, corpusManifest, runtimeRoot: ROOT,
    maxRetrievalCalls: 80, maxOutputBytes: 65536, serveArgs, port, serviceTimeoutMs: 25000, initialState: 'no-service',
    calibrationControl: false, pollWaitMs: 50, guideRoot, guides: { 'SKILL.md': sha256(guide) }, rgExecutable: 'rg', ...overrides };
  return { root, scope, corpus, config, original, transcript,
    frozenFile: path.join(corpus.codexHome, corpus.files[0].relativePath),
    async open(factory = createGate) { gate = await factory(config); return gate; } };
}
async function waitForReady(gate, config) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const response = await gate.execute(['history', 'status', '--endpoint', `http://127.0.0.1:${config.port}`]);
    assert.equal(response.isError, false, responseText(response));
    const value = responseValue(response);
    if (value.coverage?.indexing === 'complete') return value;
    assert.equal(value.evidenceForwarded, false);
  }
  throw new Error('Synthetic service did not become ready before the test deadline');
}
async function waitForAbort(gate, config) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const response = await gate.execute(['history', 'status', '--endpoint', `http://127.0.0.1:${config.port}`]);
    if (response.isError && responseValue(response).error.code === 'TRIAL_TERMINATED') return response;
  }
  throw new Error('Synthetic scope failure did not terminate the trial');
}

test('RPC shutdown records pending and queued calls without counting suppressed output or starting queued work', async (t) => {
  for (const shutdown of ['explicit-close', 'input-eof']) {
    const f = await fixture(t);
    const gate = await f.open();
    const input = new PassThrough(), output = new PassThrough();
    let written = '';
    output.on('data', (bytes) => { written += bytes.toString('utf8'); });
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    let first = true;
    const errors = [];
    const rpc = bindGateRpc({ input, output, onError: (error) => errors.push(error), gate: {
      async execute(args, options) {
        if (first) { first = false; entered.resolve(); await release.promise; }
        return gate.execute(args, options);
      },
    } });
    t.after(async () => { release.resolve(); await rpc.close(); input.destroy(); output.destroy(); });
    const pendingArgs = ['guide', 'SKILL.md'];
    const queuedArgs = ['history', ...f.config.serveArgs];
    for (const [index, args] of [pendingArgs, queuedArgs].entries()) {
      input.write(JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'history_eval', arguments: { args } } }) + '\n');
    }
    await entered.promise;
    if (shutdown === 'explicit-close') void rpc.close();
    else { input.end(); await new Promise((resolve) => input.once('end', resolve)); }
    release.resolve();
    await rpc.drained;
    assert.deepEqual(errors, []);
    assert.equal(written, '');
    const rows = readRows(gate.recordPath);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].executed, true);
    assert.match(rows[0].stdout, /SYNTHETIC_GUIDE/u);
    assert.ok(rows[0].outputBytes > 0);
    assert.equal(rows[1].executed, false);
    assert.equal(rows[1].error.code, 'CALL_CANCELLED');
    assert.match(rows[1].stderr, /CALL_CANCELLED/u);
    assert.deepEqual(rows.map((row) => row.args), [pendingArgs, queuedArgs]);
    for (const row of rows) {
      assert.equal(row.forwarding, 'suppressed');
      assert.equal(row.forwardingError.code, 'RESPONSE_NOT_FORWARDED');
      assert.equal(row.withheld, true);
      assert.equal(row.deliveredStdoutBytes, 0);
      assert.equal(row.deliveredStderrBytes, 0);
    }
    const events = readRows(path.join(f.config.directory, 'gate-events.jsonl'));
    assert.equal(events.filter((row) => row.event === 'tool_response_suppressed').length, 2);
    assert.equal(events.some((row) => row.event === 'tool_response'), false);
    assert.equal(readRows(path.join(f.config.directory, 'processes/lifecycle.jsonl')).some((row) => row.event === 'start_requested'), false);
    const trial = summarize([gate.recordPath]).trials[0];
    assert.equal(trial.refusedCalls, 1);
    assert.equal(trial.deliveredStdoutBytes, 0);
    assert.equal(trial.deliveredStderrBytes, 0);
  }
});

test('RPC delivery records a write attempt while direct execute retains returned-output accounting', async (t) => {
  const f = await fixture(t);
  const gate = await f.open();
  const input = new PassThrough(), output = new PassThrough();
  const rpc = bindGateRpc({ gate, input, output });
  t.after(async () => { await rpc.close(); input.destroy(); output.destroy(); });
  const response = new Promise((resolve) => output.once('data', (bytes) => resolve(JSON.parse(bytes.toString('utf8')))));
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'history_eval', arguments: { args: ['guide', 'SKILL.md'] } } }) + '\n');
  assert.equal((await response).result.isError, false);
  await rpc.close();
  await gate.execute(['guide', 'SKILL.md']);
  const rows = readRows(gate.recordPath);
  assert.deepEqual(rows.map((row) => row.forwarding), ['attempted', 'returned']);
  assert.ok(rows.every((row) => row.deliveredStdoutBytes > 0 && row.forwardingError === null));
});

test('controlled MCP rejects installed-CLI file and stdin input instead of ignoring it', async (t) => {
  const f = await fixture(t);
  const gate = await f.open();
  const endpoint = `http://127.0.0.1:${f.config.port}`;
  for (const inputFile of [path.join(f.root, 'scope.json'), '-']) {
    const response = await gate.execute(['history', 'read', '--endpoint', endpoint, '--input-file', inputFile]);
    assert.equal(response.isError, true);
    const value = responseValue(response);
    assert.equal(value.error.code, 'INVALID_ARGUMENT');
    assert.match(value.error.message, /file\/stdin input belongs to the installed CLI/u);
    assert.equal(value.state, undefined);
  }
  const conflict = await gate.execute(['history', 'read', '--endpoint', endpoint, '--input-file', '-', '--input', '{}']);
  assert.equal(responseValue(conflict).error.code, 'INVALID_OPTION');
  const status = responseValue(await gate.execute(['history', 'status', '--endpoint', endpoint]));
  assert.equal(status.state, 'no-service');
  assert.equal(status.evidenceForwarded, false);
  assert.equal(readRows(path.join(f.config.directory, 'processes/lifecycle.jsonl')).some((row) => row.event === 'start_requested'), false);
  const rows = readRows(gate.recordPath);
  assert.deepEqual(rows.slice(0, 3).map((row) => row.error.code), ['INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_OPTION']);
});

test('no-service starts only at worker request and records service/control lifecycle through cleanup', { timeout: 35000 }, async (t) => {
  const f = await fixture(t, { calibrationControl: true });
  const gate = await f.open();
  const lifecyclePath = path.join(f.config.directory, 'processes', 'lifecycle.jsonl');
  assert.deepEqual(readRows(lifecyclePath).map((row) => row.event), ['supervisor_started']);
  assert.equal(fs.existsSync(path.join(f.config.directory, 'processes', 'service.stdout')), false);
  const notStarted = responseValue(await gate.execute(['history', 'status', '--endpoint', `http://127.0.0.1:${f.config.port}`]));
  assert.equal(notStarted.state, 'no-service');
  assert.equal(notStarted.indexing, undefined);
  assert.equal(notStarted.evidenceForwarded, false);
  const started = responseValue(await gate.execute(['history', ...f.config.serveArgs]));
  assert.equal(started.state, 'indexing');
  assert.equal(started.indexing, 'pending');
  assert.equal(started.startedBy, 'worker');
  const status = await waitForReady(gate, f.config);
  assert.equal(status.coverage.sessionCount, 1);
  const result = await gate.execute(['history', 'search', '--endpoint', `http://127.0.0.1:${f.config.port}`, '--query', 'SYNTHETIC_GATE_EVIDENCE']);
  assert.equal(result.isError, false, responseText(result));
  assert.equal(responseValue(result).items[0].sessionId, 'gate-synthetic');
  assert.match(responseText(result), /SYNTHETIC_GATE_EVIDENCE/u);
  await gate.close();
  const lifecycle = readRows(lifecyclePath);
  assert.deepEqual(lifecycle.filter((row) => row.event === 'start_requested').map((row) => row.id).sort(), ['control', 'service']);
  assert.ok(lifecycle.some((row) => row.id === 'service' && row.event === 'indexing_complete'));
  assert.ok(lifecycle.some((row) => row.id === 'service' && row.event === 'ready'));
  for (const id of ['service', 'control']) {
    const closed = lifecycle.find((row) => row.id === id && row.event === 'closed');
    assert.ok(closed, `${id} is reaped`);
    assert.equal(closed.stopReason, 'trial_cleanup');
    assert.equal(closed.captureComplete, true);
  }
  const controlReady = readRows(path.join(f.config.directory, 'processes', 'control.stdout'))
    .find((row) => row.event === 'control_ready');
  const servicePreflight = readRows(path.join(f.config.directory, 'processes', 'service.stdout'))
    .find((row) => row.event === 'preflight_passed');
  assert.ok(controlReady);
  assert.equal(controlReady.ppid, servicePreflight.ppid);
  const starts = lifecycle.filter((row) => row.event === 'start_requested');
  assert.equal(starts[0].stdin, starts[1].stdin);
  assert.equal(starts[0].parentPid, starts[1].parentPid);
  assert.equal(lifecycle.at(-1).event, 'supervisor_closed');
  const report = summarize([gate.recordPath]);
  assert.equal(report.trials.length, 1);
  assert.equal(report.trials[0].identity.corpus.corpusHash, f.corpus.corpusHash);
  assert.equal(report.trials[0].providerOrHarnessUsage, null);
  assert.equal(report.trials[0].phases.setup.calls, 1);
  assert.ok(report.trials[0].phases.retrieval.calls >= 2);
});

test('status reports an exited service before and after readiness, including a clean exit', async (t) => {
  const gatePath = require.resolve('../scripts/history-eval-mcp');
  const source = fs.readFileSync(gatePath, 'utf8');
  const gateRequire = createRequire(gatePath);
  const cases = [
    ['before ready', { exitCode: 17 }],
    ['after ready', { ready: true, exitCode: 0 }],
    ['bind failure before the capture pipes close', { failureCode: 'EADDRINUSE', exitCode: 1 }],
    ['capture setup fails before a child is created', { setupError: 'EACCES' }],
    ['capture settles without a confirmed child exit', { cleanupUnconfirmed: true }],
    ['spawn fails asynchronously with a libuv error value', { spawnErrorCode: 'ENOENT', exitCode: -2 }],
    ['scope verification I/O fails before index admission', { scopeFailureCode: 'EACCES', exitCode: 1 }],
  ];
  for (const [phase, { ready, failureCode, exitCode, setupError, cleanupUnconfirmed, spawnErrorCode, scopeFailureCode }] of cases) {
    await t.test(phase, async (t) => {
      const f = await fixture(t);
      const completed = Promise.withResolvers();
      const child = { exited: false, completed: completed.promise };
      let onStdout;
      const marks = [];
      const supervisor = {
        start(options) {
          if (setupError) throw Object.assign(new Error('Synthetic capture setup failed'), { code: setupError });
          onStdout = options.onStdout;
          return child;
        },
        mark(id, event) { marks.push(event); },
        async close() {},
      };
      const module = { exports: {} };
      vm.runInNewContext(source, { module, __dirname: path.dirname(gatePath), process, Buffer, performance, AbortController,
        setTimeout, clearTimeout,
        require: (id) => id === './history-eval-supervisor' ? { createSupervisor: () => supervisor } : gateRequire(id) }, { filename: gatePath });
      const gate = await f.open(module.exports.createGate);
      const endpoint = `http://127.0.0.1:${f.config.port}`;
      const send = (event) => onStdout(Buffer.from(JSON.stringify(event) + '\n'));
      async function statusError(code, state) {
        const response = await gate.execute(['history', 'status', '--endpoint', endpoint]);
        const value = responseValue(response);
        assert.equal(response.isError, true, responseText(response));
        assert.equal(value.error.code, code);
        assert.equal(value.state, state);
        assert.equal(value.indexing, undefined);
        assert.equal(value.evidenceForwarded, false);
        return value;
      }
      const started = responseValue(await gate.execute(['history', ...f.config.serveArgs]));
      if (setupError) {
        assert.equal(started.error.code, setupError);
        const unavailable = await statusError('SERVICE_UNAVAILABLE', 'failed');
        assert.equal(unavailable.exit.serviceFailureCode, setupError);
        return;
      }
      assert.equal(started.state, 'indexing');
      if (ready || failureCode) send({ event: 'indexing_complete', audit: {} });
      if (ready) send({ event: 'ready', endpoint, audit: {} });
      assert.deepEqual(marks, ready ? ['indexing_complete', 'ready'] : failureCode ? ['indexing_complete'] : []);
      if (failureCode) send({ event: 'failed', code: failureCode, message: 'Synthetic HTTP bind failure' });
      if (scopeFailureCode) send({ event: 'failed', code: scopeFailureCode, message: 'Synthetic scope verification I/O failure' });
      const cleanupError = cleanupUnconfirmed ? { code: 'CLEANUP_UNCONFIRMED' } : null;
      const spawnError = spawnErrorCode ? { code: spawnErrorCode } : null;
      const result = { id: 'service', exitCode: exitCode ?? null, signal: null,
        timedOut: cleanupUnconfirmed === true, stopReason: cleanupUnconfirmed ? 'timeout' : null, cleanupError, spawnError };
      child.exited = !cleanupUnconfirmed && !spawnError;
      child.child = { exitCode: result.exitCode, signalCode: null };
      child.timedOut = result.timedOut;
      child.stopReason = result.stopReason;
      child.spawnError = spawnError;
      const readExit = () => statusError('SERVICE_EXITED', 'exited');
      const readUnavailable = () => statusError('SERVICE_UNAVAILABLE', 'failed');
      if (failureCode) {
        const early = await readExit();
        assert.equal(early.exit.exitCode, exitCode);
        assert.equal(early.exit.serviceFailureCode, failureCode);
        assert.equal(fs.existsSync(path.join(f.config.directory, 'aborted.json')), false);
      }
      if (cleanupUnconfirmed) assert.equal((await readUnavailable()).exit.stopReason, 'timeout');
      if (spawnError) assert.equal((await readUnavailable()).exit.spawnErrorCode, spawnErrorCode);
      child.settled = true;
      completed.resolve(result);
      await completed.promise;
      const events = readRows(path.join(f.config.directory, 'gate-events.jsonl'));
      if (scopeFailureCode) {
        const refused = await gate.execute(['history', 'status', '--endpoint', endpoint]);
        assert.equal(refused.isError, true);
        assert.equal(responseValue(refused).error.code, 'TRIAL_TERMINATED');
        assert.equal(events.find((row) => row.event === 'trial_aborted').code, scopeFailureCode);
      } else if (cleanupUnconfirmed || spawnError) {
        const unavailable = await readUnavailable();
        assert.equal(unavailable.exit.exitCode, null);
        assert.equal(unavailable.exit.timedOut, result.timedOut);
        if (cleanupError) assert.equal(unavailable.exit.cleanupErrorCode, cleanupError.code);
        if (spawnError) assert.equal(unavailable.exit.spawnErrorCode, spawnErrorCode);
        assert.equal(events.some((row) => row.event === 'service_exited'), false);
      } else {
        assert.equal(events.find((row) => row.event === 'service_exited').result.exitCode, exitCode);
        const value = await readExit();
        assert.deepEqual(value.exit, { exitCode, signal: null, timedOut: false, stopReason: null,
          ...(failureCode ? { serviceFailureCode: failureCode } : {}) });
      }
    });
  }
});

test('pre-index mismatch permanently terminates trial and cannot be repaired by a later good start', async (t) => {
  const f = await fixture(t);
  const gate = await f.open();
  const wrong = [...f.config.serveArgs]; wrong[6] = f.root;
  const rejected = await gate.execute(['history', ...wrong]);
  assert.equal(rejected.isError, true);
  assert.equal(responseValue(rejected).error.code, 'EVAL_SCOPE_MISMATCH');
  assert.doesNotMatch(responseText(rejected), /SYNTHETIC_GATE_EVIDENCE/u);
  const retry = await gate.execute(['history', ...f.config.serveArgs]);
  assert.equal(responseValue(retry).error.code, 'TRIAL_TERMINATED');
  const lifecycle = readRows(path.join(f.config.directory, 'processes', 'lifecycle.jsonl'));
  assert.equal(lifecycle.some((row) => row.event === 'start_requested'), false);
  const calls = readRows(gate.recordPath);
  assert.equal(calls[0].outputBytes, 0);
  assert.equal(calls[1].executed, false);
  assert.equal(summarize([gate.recordPath]).trials[0].refusedCalls, 1);
});

test('initial frozen-source failure closes preparation resources without launching children', async (t) => {
  const f = await fixture(t);
  fs.appendFileSync(f.frozenFile, '\n');
  await assert.rejects(f.open(), { code: 'EVAL_SCOPE_MISMATCH' });
  const lifecycle = readRows(path.join(f.config.directory, 'processes', 'lifecycle.jsonl'));
  assert.equal(lifecycle.some((row) => row.event === 'start_requested'), false);
  assert.equal(lifecycle.at(-1).event, 'supervisor_closed');
  assert.equal(fs.existsSync(path.join(f.config.directory, 'gate-ready.json')), false);
});

test('post-index Session-set mismatch retains build lifecycle and withholds all evidence', { timeout: 35000 }, async (t) => {
  const f = await fixture(t, {}, ['different-session-with-same-count']);
  const gate = await f.open();
  await gate.execute(['history', ...f.config.serveArgs]);
  const rejected = await waitForAbort(gate, f.config);
  assert.equal(responseValue(rejected).error.code, 'TRIAL_TERMINATED');
  const retry = await gate.execute(['history', ...f.config.serveArgs]);
  assert.equal(responseValue(retry).error.code, 'TRIAL_TERMINATED');
  const events = readRows(path.join(f.config.directory, 'gate-events.jsonl'));
  assert.ok(events.some((row) => row.observation?.event === 'indexing_started'));
  assert.ok(events.some((row) => row.event === 'trial_aborted' && row.code === 'EVAL_SCOPE_MISMATCH'));
  assert.equal(events.some((row) => row.observation?.event === 'ready'), false);
  for (const row of readRows(gate.recordPath)) {
    assert.doesNotMatch(row.deliveredStdout + row.deliveredStderr, /SYNTHETIC_GATE_EVIDENCE/u);
  }
  await gate.close();
  const closed = readRows(path.join(f.config.directory, 'processes', 'lifecycle.jsonl')).find((row) => row.event === 'closed');
  assert.ok(closed.elapsedMs > 0);
  assert.ok(closed.stdoutBytes > 0);
});

test('raw read permits only verified frozen bytes and a scope error ends the trial', async (t) => {
  const f = await fixture(t, { condition: 'raw' });
  const gate = await f.open();
  const relative = f.corpus.files[0].relativePath;
  const accepted = await gate.execute(['raw', 'read', relative, '2', '1', '0', '10000']);
  assert.equal(accepted.isError, false);
  assert.equal(responseValue(accepted).text, f.transcript.trimEnd().split('\n')[1]);
  const audited = readRows(path.join(f.config.directory, 'gate-events.jsonl'));
  const preflight = audited.find((entry) => entry.event === 'gate_preflight_passed').audit;
  assert.equal(preflight.verified, true);
  assert.equal(preflight.scopeSha256, f.scope.scopeSha256);
  assert.equal(preflight.indexingCostIncurred, false);
  const verified = audited.find((entry) => entry.event === 'raw_scope_verified');
  assert.equal(verified.call, 1);
  assert.equal(verified.operation, 'read');
  assert.equal(verified.corpusHash, f.scope.corpusHash);
  assert.deepEqual(verified.files, f.scope.files);
  assert.equal(JSON.stringify(verified).includes('SYNTHETIC_GATE_EVIDENCE'), false, 'scope receipt contains metadata only');
  const outside = await gate.execute(['raw', 'read', f.original, '2']);
  assert.equal(outside.isError, true);
  assert.equal(responseValue(outside).error.code, 'EVAL_SCOPE_MISMATCH');
  assert.doesNotMatch(responseText(outside), /SYNTHETIC_GATE_EVIDENCE/u);
  const retry = await gate.execute(['raw', 'read', relative, '2']);
  assert.equal(responseValue(retry).error.code, 'TRIAL_TERMINATED');
});

const rgAvailable = spawnSync('rg', ['--version'], { windowsHide: true, encoding: 'utf8' }).status === 0;
test('raw fixed-string search uses verified input without admitting flags or outside filenames', { skip: !rgAvailable }, async (t) => {
  const f = await fixture(t, { condition: 'raw' });
  const gate = await f.open();
  const found = await gate.execute(['raw', 'search', 'SYNTHETIC_GATE_EVIDENCE']);
  assert.equal(found.isError, false, responseText(found));
  assert.match(responseText(found), /sessions\/gate-synthetic\.jsonl:2:/u);
  assert.match(responseText(found), /SYNTHETIC_GATE_EVIDENCE/u);
  const verified = readRows(path.join(f.config.directory, 'gate-events.jsonl')).find((entry) => entry.event === 'raw_scope_verified');
  assert.equal(verified.operation, 'search');
  assert.deepEqual(verified.files, f.scope.files);
  const literalFlag = await gate.execute(['raw', 'search', '--files']);
  assert.equal(literalFlag.isError, false, responseText(literalFlag));
  assert.equal(responseText(literalFlag), '');
  fs.appendFileSync(f.frozenFile, 'OUTSIDE_APPEND');
  const changed = await gate.execute(['raw', 'search', 'OUTSIDE_APPEND']);
  assert.equal(changed.isError, true);
  assert.doesNotMatch(responseText(changed), /OUTSIDE_APPEND/u);
});

test('delivery truncation keeps complete raw capture and compatible aggregation, separately from usage', async (t) => {
  const f = await fixture(t, { condition: 'raw', maxOutputBytes: 256 });
  const guide = '中文'.repeat(500);
  fs.writeFileSync(path.join(f.config.guideRoot, 'SKILL.md'), guide);
  f.config.guides['SKILL.md'] = sha256(guide);
  const gate = await f.open();
  const response = await gate.execute(['guide', 'SKILL.md']);
  assert.equal(response.isError, false);
  assert.ok(Buffer.byteLength(responseText(response)) <= 256);
  assert.match(responseText(response), /OUTPUT_TRUNCATED/u);
  assert.doesNotMatch(responseText(response), /\ufffd/u);
  const [row] = readRows(gate.recordPath);
  assert.equal(row.stdout, guide);
  assert.equal(row.outputBytes, Buffer.byteLength(guide));
  assert.equal(row.stdoutSha256, sha256(guide));
  assert.equal(row.outputTruncated, true);
  assert.equal(row.deliveredStdout + row.deliveredStderr, responseText(response));
  const [trial] = summarize([gate.recordPath]).trials;
  assert.equal(trial.truncatedCalls, 1);
  assert.ok(trial.stdoutBytes > trial.deliveredStdoutBytes);
  assert.equal(trial.providerOrHarnessUsage, null);
});

test('retrieval budget refuses further calls before execution and retains the refusal', async (t) => {
  const f = await fixture(t, { condition: 'raw', maxRetrievalCalls: 1 });
  const gate = await f.open();
  const args = ['raw', 'read', f.corpus.files[0].relativePath, '2'];
  assert.equal((await gate.execute(args)).isError, false);
  const refused = await gate.execute(args);
  assert.equal(responseValue(refused).error.code, 'RETRIEVAL_BUDGET_EXCEEDED');
  const rows = readRows(gate.recordPath);
  assert.equal(rows[1].executed, false);
  assert.equal(rows[1].outputBytes, 0);
  assert.equal(summarize([gate.recordPath]).trials[0].refusedCalls, 1);
});

test('service-ready is prepared explicitly and is not recorded as a worker no-service start', { timeout: 35000 }, async (t) => {
  const f = await fixture(t, { initialState: 'service-ready' });
  const gate = await f.open();
  const status = responseValue(await gate.execute(['history', 'status', '--endpoint', `http://127.0.0.1:${f.config.port}`]));
  assert.equal(status.coverage.indexing, 'complete');
  const events = readRows(path.join(f.config.directory, 'gate-events.jsonl'));
  assert.ok(events.some((row) => row.event === 'preflight_passed' && row.origin === 'initial-state-preparation'));
  assert.equal(events.some((row) => row.event === 'preflight_passed' && row.origin === 'worker'), false);
});

test('a source change during retrieval withholds the body and retains its captured audit', { timeout: 35000 }, async (t) => {
  const f = await fixture(t, { initialState: 'service-ready' });
  const gate = await f.open();
  const cli = require(path.join(ROOT, 'src/history-cli'));
  const originalRequest = cli.requestHistory;
  const captured = { producer: 'session-analyzer', schemaVersion: 1, operation: 'history.search', items: [{ text: 'WITHHELD_SYNTHETIC_BODY' }] };
  cli.requestHistory = async () => {
    fs.appendFileSync(f.frozenFile, '\n');
    return captured;
  };
  t.after(() => { cli.requestHistory = originalRequest; });
  const response = await gate.execute(['history', 'search', '--endpoint', `http://127.0.0.1:${f.config.port}`, '--query', 'SYNTHETIC_GATE_EVIDENCE']);
  cli.requestHistory = originalRequest;
  assert.equal(response.isError, true);
  assert.doesNotMatch(responseText(response), /WITHHELD_SYNTHETIC_BODY/u);
  const [row] = readRows(gate.recordPath);
  assert.match(row.stdout, /WITHHELD_SYNTHETIC_BODY/u);
  assert.equal(row.withheld, true);
  assert.equal(row.deliveredStdout, '');
  const retry = await gate.execute(['history', 'status', '--endpoint', `http://127.0.0.1:${f.config.port}`]);
  assert.equal(responseValue(retry).error.code, 'TRIAL_TERMINATED');
});
