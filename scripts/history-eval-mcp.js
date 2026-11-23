#!/usr/bin/env node
'use strict';

// A single controlled tool is the worker's only evidence path. The native
// Codex event stream is an audit source, never this output gate.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { ROOT, privateTarget, sha256, readManifest } = require('./history-eval-common');
const { captureRow } = require('./record-history-eval');
const { verifyPreflight, verifyRawFiles, verifyCorpus } = require('./history-eval-scope');
const { createSupervisor } = require('./history-eval-supervisor');

const TOOL = 'history_eval';
const fail = (code, message) => Object.assign(new Error(message), { code });
const isScopeFailure = (code) => /SCOPE|CORPUS|SOURCE|SESSION|POLICY|FROZEN|INTEGRITY/u.test(code);

async function capture(command, args, { cwd, input, limit = 32 * 1024 * 1024, timeoutMs = 120000, signal } = {}) {
  if (signal?.aborted) return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 1,
    captureComplete: false, failure: fail('COMMAND_CANCELLED', 'Trial transport is closing') };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    const out = [], err = []; let bytes = 0, failure;
    const timer = setTimeout(() => { failure = fail('COMMAND_TIMEOUT', 'Command timed out'); child.kill(); }, timeoutMs);
    const abort = () => { failure ||= fail('COMMAND_CANCELLED', 'Trial transport is closing'); child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) { failure ||= fail('CAPTURE_LIMIT', 'Capture limit reached'); child.kill(); }
      else chunks.push(chunk);
    };
    child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
    child.once('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err), exitCode: code,
      captureComplete: !failure, failure }); });
  });
}

async function createGate(config) {
  const directory = privateTarget(config.directory);
  fs.mkdirSync(directory, { recursive: true });
  const scope = JSON.parse(fs.readFileSync(config.scopeFile, 'utf8'));
  const corpus = JSON.parse(fs.readFileSync(config.corpusManifest, 'utf8'));
  if (fs.realpathSync(config.runtimeRoot) !== fs.realpathSync(scope.runtimeRoot)
      || sha256(fs.readFileSync(config.corpusManifest)) !== scope.corpusManifestSha256
      || corpus.corpusHash !== scope.corpusHash || (config.corpusHash !== undefined && config.corpusHash !== scope.corpusHash)) {
    throw fail('EVAL_SCOPE_MISMATCH', 'Gate configuration and frozen scope identify different runtime or corpus');
  }
  const identity = { trial: config.trial, condition: config.condition, task: config.task,
    model: config.model, harness: config.harness, corpus: readManifest(config.corpusManifest),
    budgets: { maxRetrievalCalls: config.maxRetrievalCalls, maxOutputBytes: config.maxOutputBytes } };
  const recordPath = privateTarget(path.join(directory, 'calls.jsonl'));
  if (fs.existsSync(recordPath)) throw new Error('Trial gate cannot reuse an existing calls log');
  const supervisor = createSupervisor({ directory: path.join(directory, 'processes'), identity });
  const captureAbort = new AbortController();
  const cli = require(path.join(config.runtimeRoot, 'src/history-cli'));
  let service = null, endpoint = null, terminal = null, state = 'no-service', serviceAudit = null, calls = 0;
  let serviceExit, serviceFailureCode;
  const journal = (event) => fs.appendFileSync(path.join(directory, 'gate-events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  const abort = async (error) => {
    terminal ||= { code: error.code || 'SCOPE_MISMATCH', message: error.message };
    fs.writeFileSync(path.join(directory, 'aborted.json'), JSON.stringify(terminal));
    journal({ event: 'trial_aborted', ...terminal }); await supervisor.close('scope_failure');
  };
  const assertCorpus = async () => verifyPreflight(scope, config.serveArgs);
  try {
    const preflight = await assertCorpus();
    journal({ event: 'gate_preflight_passed', audit: preflight.audit });
  } catch (error) { await supervisor.close('preparation_scope_failure'); throw error; }
  journal({ event: 'gate_started', initialState: config.initialState, corpusHash: corpus.corpusHash });

  function serviceStateError() {
    const recorded = serviceExit || service;
    // A child can exit before capture closes. A failed spawn can also close
    // capture with a numeric libuv error code. Use the observed exit event.
    const exited = service?.exited === true;
    if (!exited && state !== 'failed' && !serviceExit && !service?.settled && !service?.spawnError && !service?.stopReason) return null;
    const exitCode = exited ? recorded?.exitCode ?? service.child?.exitCode ?? null : null;
    const signal = exited ? recorded?.signal ?? service.child?.signalCode ?? null : null;
    const exit = { exitCode, signal, timedOut: recorded?.timedOut ?? null, stopReason: recorded?.stopReason ?? null,
      ...(recorded?.spawnError ? { spawnErrorCode: recorded.spawnError.code ?? null } : {}),
      ...(recorded?.cleanupError ? { cleanupErrorCode: recorded.cleanupError.code ?? null } : {}),
      ...(serviceFailureCode ? { serviceFailureCode } : {}) };
    const code = exitCode === null ? '' : ` with code ${exitCode}`;
    const error = exited ? fail('SERVICE_EXITED', `The trial history service exited${code} and is unavailable.`)
      : fail('SERVICE_UNAVAILABLE', 'The trial history service is not available.');
    return Object.assign(error, { serviceStatus: { state: exited ? 'exited' : 'failed', evidenceForwarded: false, exit } });
  }

  function requireLiveService() {
    const error = serviceStateError();
    if (error) throw error;
  }

  async function start(args, origin) {
    if (service) throw fail('ALREADY_STARTED', 'The trial already started its service');
    // Never fill in omitted home/project options or replace rejected arguments.
    const { options, audit } = await verifyPreflight(scope, args);
    if (options.port !== config.port) throw fail('SCOPE_MISMATCH', 'Port differs from the frozen trial endpoint');
    journal({ event: 'preflight_passed', origin, audit });
    const childConfig = JSON.stringify({ scope, args, runtimeRoot: config.runtimeRoot }) + '\n';
    let pending = '';
    let indexAudited = false;
    const onStdout = (chunk) => {
      pending += chunk.toString('utf8');
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        journal({ event: 'service_observation', observation: event });
        if (event.event === 'indexing_complete') {
          supervisor.mark('service', 'indexing_complete', event.audit);
          indexAudited = true;
        }
        if (event.event === 'ready') {
          endpoint = event.endpoint; serviceAudit = event.audit; state = 'ready';
          supervisor.mark('service', 'ready', { endpoint, audit: event.audit });
        }
        if (event.event === 'failed') {
          state = 'failed';
          // The child emits indexing_complete after verifying the scope and
          // building the audited service, immediately before starting HTTP.
          if (!indexAudited || isScopeFailure(event.code)) void abort(fail(event.code, event.message));
          else serviceFailureCode = event.code || 'SERVICE_FAILED';
        }
      }
    };
    serviceFailureCode = null;
    try {
      service = supervisor.start({ id: 'service', command: process.execPath,
        args: [path.join(__dirname, 'history-eval-service.js')], cwd: config.runtimeRoot,
        env: process.env, input: childConfig, timeoutMs: config.serviceTimeoutMs, onStdout });
    } catch (error) {
      state = 'failed';
      serviceFailureCode = error.code ?? null;
      throw error;
    }
    state = 'indexing';
    service.completed.then((result) => {
      serviceExit = result;
      ({ state } = serviceStateError().serviceStatus);
      journal({ event: state === 'exited' ? 'service_exited' : 'service_unavailable', result });
      if (serviceFailureCode) void supervisor.close('service_failure');
    });
    if (config.calibrationControl) {
      let controlPending = '';
      supervisor.start({ id: 'control', command: process.execPath,
        args: [path.join(__dirname, 'history-eval-service.js'), '--control'],
        cwd: config.runtimeRoot, env: process.env, input: childConfig, timeoutMs: config.serviceTimeoutMs,
        onStdout: (chunk) => {
          controlPending += chunk.toString('utf8');
          let end;
          while ((end = controlPending.indexOf('\n')) !== -1) {
            const line = controlPending.slice(0, end); controlPending = controlPending.slice(end + 1);
            let event; try { event = JSON.parse(line); } catch { continue; }
            if (event.event === 'control_ready') supervisor.mark('control', 'ready', { pid: event.pid, ppid: event.ppid });
          }
        } });
    }
    requireLiveService();
    return { state, startedBy: origin, endpoint: `http://127.0.0.1:${config.port}`, indexing: 'pending' };
  }

  async function raw(args) {
    if (config.condition !== 'raw') throw fail('CONDITION_TOOL_MISMATCH', 'Raw access is not in this condition');
    if (args[0] === 'search') {
      // Fixed-string OR search is intentional; no glob, config, command, symlink,
      // arbitrary rg option or filename is accepted from the worker.
      const queries = args.slice(1);
      if (!queries.length || queries.length > 20 || queries.some((q) => !q || q.length > 4096)) throw fail('INVALID_ARGUMENT', 'raw search expects 1..20 literal queries');
      const files = corpus.files.map((file) => path.join(corpus.codexHome, file.relativePath));
      const verified = await verifyRawFiles(scope, files);
      journal({ event: 'raw_scope_verified', call: calls, operation: 'search', corpusHash: corpus.corpusHash,
        scopeSha256: scope.scopeSha256, files: verified.map(({ relativePath, sha256: hash, bytes }) => ({ relativePath, sha256: hash, bytes })) });
      const outputs = []; let size = 0;
      for (const file of verified) {
        const result = await capture(config.rgExecutable, ['--no-config', '-n', '-F', '--no-heading', '--no-filename',
          ...queries.flatMap((q) => ['-e', q]), '--', '-'], { cwd: corpus.codexHome, input: file.content, signal: captureAbort.signal });
        const labeled = Buffer.from(result.stdout.toString('utf8').split(/\r?\n/u).filter(Boolean).map((line) => `${file.relativePath}:${line}`).join('\n') + (result.stdout.length ? '\n' : ''));
        size += labeled.length;
        if (size > 32 * 1024 * 1024) return { stdout: Buffer.concat(outputs), exitCode: 1, captureComplete: false,
          failure: fail('CAPTURE_LIMIT', 'Raw search capture exceeded 32 MiB; narrow the literal queries') };
        outputs.push(labeled);
        if (result.failure || result.exitCode > 1) return { ...result, stdout: Buffer.concat(outputs) };
      }
      return { stdout: Buffer.concat(outputs), exitCode: 0 };
    }
    if (args[0] === 'read') {
      const [relativePath, lineText = '1', countText = '1', offsetText = '0', lengthText = '12000'] = args.slice(1);
      const [line, count, offset, length] = [lineText, countText, offsetText, lengthText].map(Number);
      if (!relativePath || args.length > 6 || ![line, count, offset, length].every(Number.isSafeInteger)
          || line < 1 || count < 1 || count > 100 || offset < 0 || length < 1 || length > 1000000) throw fail('INVALID_ARGUMENT', 'raw read: relative-file, line>=1, count 1..100, offset>=0, length 1..1000000');
      const file = path.resolve(corpus.codexHome, relativePath);
      const [verified] = await verifyRawFiles(scope, [file]);
      journal({ event: 'raw_scope_verified', call: calls, operation: 'read', corpusHash: corpus.corpusHash,
        scopeSha256: scope.scopeSha256, files: [{ relativePath: verified.relativePath, sha256: verified.sha256, bytes: verified.bytes }] });
      const lines = verified.content.toString('utf8').split(/\r?\n/u);
      const selected = lines.slice(line - 1, line - 1 + count).join('\n');
      const text = selected.slice(offset, offset + length);
      return { stdout: Buffer.from(JSON.stringify({ relativePath, line, count, offset, text,
        hasMore: offset + text.length < selected.length, nextOffset: offset + text.length < selected.length ? offset + text.length : null,
        totalLines: lines.length, unit: 'UTF-16 code units' }) + '\n'), exitCode: 0 };
    }
    throw fail('INVALID_ARGUMENT', 'Use raw search <literal...> or raw read <relative-file> <line> <count> <offset> <length>');
  }

  // These options belong to the RPC transport, never to worker tool arguments.
  async function execute(args, { cancelled = false, deliver } = {}) {
    const started = performance.now(), at = new Date().toISOString();
    let result, capturedResult, error = null, executed = true;
    const phase = args?.[0] === 'guide' || args?.[1] === 'serve' ? 'setup' : 'retrieval';
    try {
      if (cancelled) { executed = false; throw fail('CALL_CANCELLED', 'Trial transport closed before the queued call could execute'); }
      if (!Array.isArray(args) || args.length > 100 || args.some((a) => typeof a !== 'string' || a.length > 65536)) throw fail('INVALID_ARGUMENT', 'args must be a bounded array of strings');
      if (terminal) { executed = false; throw fail('TRIAL_TERMINATED', 'Trial terminated after a scope failure'); }
      if (phase === 'retrieval' && calls >= config.maxRetrievalCalls) { executed = false; throw fail('RETRIEVAL_BUDGET_EXCEEDED', 'Retrieval call budget exhausted'); }
      if (phase === 'retrieval') calls++;
      if (args[0] === 'guide') {
        const relative = args[1] || 'SKILL.md';
        if (args.length > 2 || !Object.hasOwn(config.guides, relative)) throw fail('INVALID_GUIDE', 'Guide path is not in the frozen guide manifest');
        const file = path.join(config.guideRoot, relative), bytes = fs.readFileSync(file);
        if (sha256(bytes) !== config.guides[relative]) throw fail('SCOPE_MISMATCH', 'Frozen guide changed');
        result = { stdout: bytes, exitCode: 0 };
      } else if (args[0] === 'raw') result = await raw(args.slice(1));
      else if (args[0] === 'history') {
        if (config.condition === 'raw') throw fail('CONDITION_TOOL_MISMATCH', 'history is not in the raw condition');
        const parsed = cli.parseHistoryArgs(args.slice(1));
        if (parsed.inputFile !== undefined) throw fail('INVALID_ARGUMENT', 'This controlled transport accepts inline JSON or flags; file/stdin input belongs to the installed CLI');
        if (parsed.help) result = { stdout: Buffer.from(cli.formatHistoryHelp()), exitCode: 0 };
        else if (parsed.operation === 'serve') result = { stdout: Buffer.from(JSON.stringify(await start(args.slice(1), 'worker'))), exitCode: 0 };
        else {
          if (parsed.endpoint !== `http://127.0.0.1:${config.port}`) throw fail('SCOPE_MISMATCH', 'Only the frozen trial endpoint is allowed');
          requireLiveService();
          if (state === 'indexing') await new Promise((resolve) => setTimeout(resolve, Math.min(config.pollWaitMs || 1000, 5000)));
          if (terminal) throw fail('TRIAL_TERMINATED', 'Scope validation failed; evidence withheld');
          requireLiveService();
          if (state === 'no-service' || state === 'indexing') {
            result = { stdout: Buffer.from(JSON.stringify({ state, ...(state === 'indexing' ? { indexing: 'pending' } : {}),
              evidenceForwarded: false })), exitCode: 0 };
          } else {
            if (state !== 'ready' || !serviceAudit) throw fail('SERVICE_UNAVAILABLE', 'The trial history service is not available.');
            const scopeStart = performance.now();
            await verifyCorpus(scope, 'post-index');
            requireLiveService();
            const bytes = await cli.requestHistory(endpoint, parsed.operation, parsed.input);
            capturedResult = { stdout: Buffer.from(JSON.stringify(bytes) + '\n'), exitCode: bytes.error ? 1 : 0 };
            await verifyCorpus(scope, 'post-index');
            journal({ event: 'forwarding_scope_verified', operation: parsed.operation, elapsedIncludingRequestMs: performance.now() - scopeStart });
            result = capturedResult;
          }
        }
      } else throw fail('INVALID_ARGUMENT', 'Use history, raw or guide');
      if (result.failure) {
        error = { code: result.failure.code || 'CAPTURE_FAILED', message: result.failure.message };
        result.stderr = Buffer.concat([result.stderr || Buffer.alloc(0), Buffer.from(JSON.stringify({ error }) + '\n')]);
        result.exitCode = 1;
      }
    } catch (caught) {
      error = { code: caught.code || 'GATE_ERROR', message: caught.message };
      if (isScopeFailure(error.code)) await abort(caught);
      const diagnostic = Buffer.from(JSON.stringify({ error, ...caught.serviceStatus }) + '\n');
      result = capturedResult ? { ...capturedResult, exitCode: 1, withheld: true, withheldMessage: diagnostic }
        : { stdout: Buffer.alloc(0), stderr: diagnostic, exitCode: 1 };
    }
    const captured = { identity, args, phase, at, elapsedMs: performance.now() - started,
      ...result, maxOutputBytes: config.maxOutputBytes, error, executed };
    let row = captureRow(captured);
    const responseFor = (value) => ({ content: [{ type: 'text', text: value.deliveredStdout + value.deliveredStderr }], isError: value.exitCode !== 0 });
    let response = responseFor(row), forwarding = 'returned', forwardingError = null;
    if (deliver) {
      try { forwarding = deliver(response) === true ? 'attempted' : 'suppressed'; }
      catch (caught) {
        forwarding = 'suppressed';
        forwardingError = { code: caught.code || 'RESPONSE_WRITE_FAILED', message: caught.message };
      }
      if (forwarding === 'suppressed') {
        forwardingError ||= { code: 'RESPONSE_NOT_FORWARDED', message: 'RPC transport did not accept a response write' };
        row = captureRow({ ...captured, withheld: true, withheldMessage: Buffer.alloc(0) });
        response = responseFor(row);
      }
    }
    Object.assign(row, { forwarding, forwardingError });
    fs.appendFileSync(recordPath, `${JSON.stringify(row)}\n`);
    journal({ event: forwarding === 'suppressed' ? 'tool_response_suppressed' : 'tool_response', forwarding, forwardingError,
      call: calls, phase, args, response, responseSha256: sha256(JSON.stringify(response)),
      rawStdoutSha256: row.stdoutSha256, outputTruncated: row.outputTruncated });
    return response;
  }
  if (config.initialState === 'service-ready' && config.condition !== 'raw') {
    await start(config.serveArgs, 'initial-state-preparation');
    const deadline = Date.now() + config.serviceTimeoutMs;
    while (state === 'indexing' && !service.exited && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    const unavailable = serviceStateError();
    if (state !== 'ready' || unavailable) {
      await supervisor.close('preparation_failed');
      throw fail('PREPARATION_FAILED', unavailable?.message || 'Ready-state preparation failed');
    }
  }
  fs.writeFileSync(path.join(directory, 'gate-ready.json'), JSON.stringify({ state, at: new Date().toISOString() }));
  return { execute, close: () => {
    terminal ||= { code: 'TRIAL_CLOSED', message: 'Trial transport is closing' };
    captureAbort.abort();
    return supervisor.close('trial_cleanup');
  }, identity, recordPath };
}

function bindGateRpc({ gate, input, output, onError = (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }) {
  const lines = readline.createInterface({ input });
  let stopped = false;
  const write = (value) => {
    if (stopped || output.destroyed || output.writableEnded) return false;
    output.write(`${JSON.stringify(value)}\n`);
    // A stream write attempt is not confirmation of model-visible delivery.
    return true;
  };
  const send = (id, result) => write({ jsonrpc: '2.0', id, result });
  let queue = Promise.resolve();
  let finish;
  const drained = new Promise((resolve) => { finish = resolve; });
  lines.on('line', (line) => {
    queue = queue.then(async () => {
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      if (message.method === 'tools/call' && message.params?.name === TOOL) {
        return gate.execute(message.params.arguments?.args, { cancelled: stopped, deliver: (response) => send(message.id, response) });
      }
      if (stopped) return;
      if (message.method === 'initialize') return send(message.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'history-eval-gate', version: '1' } });
      if (message.method === 'ping') return send(message.id, {});
      if (message.method === 'tools/list') return send(message.id, { tools: [{ name: TOOL,
        description: 'Run history CLI arguments or bounded raw retrieval in the frozen trial scope. Use ["history","--help"] for history syntax; ["guide","SKILL.md"] for the frozen guide. Raw: ["raw","search",literal,...] or ["raw","read",relativeFile,line,count,offset,length]. No shell expansion. Service start is asynchronous; poll history status on the given endpoint.',
        inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false } }] });
      write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported method' } });
    }).catch(onError);
  });
  lines.once('close', () => { stopped = true; void queue.finally(finish); });
  lines.on('error', (error) => { if (error.code !== 'ECONNRESET') onError(error); lines.close(); });
  return { drained, close() { stopped = true; lines.close(); return drained; } };
}

async function main() {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const gate = await createGate(config);
  const rpc = bindGateRpc({ gate, input: process.stdin, output: process.stdout });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void rpc.close(); });
  try { await rpc.drained; } finally { await gate.close(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { createGate, bindGateRpc, capture, TOOL };
