'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { commonConfigSha256 } = require('../scripts/history-eval-codex-config');
const { checkExposure } = require('../scripts/probe-history-codex-tools');
const runner = require('../scripts/run-history-codex-eval');

function fixture(t) {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp/history-runner-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexExecutable = path.join(root, 'never-run-synthetic-codex.exe');
  fs.writeFileSync(codexExecutable, 'This is synthetic test data, not an executable.');
  const config = { trial: 'synthetic-trial', condition: 'current', initialState: 'no-service',
    model: 'synthetic-model', effort: 'max', codexExecutable, codexSha256: sha256(fs.readFileSync(codexExecutable)),
    directory: path.join(root, 'must-not-start'), maxRetrievalCalls: 10, maxOutputBytes: 4096, timeoutMs: 1000,
    authFile: path.join(root, 'AUTH_MUST_NOT_BE_READ'), toolBoundaryAudit: path.join(root, 'probe-report.json') };
  const tools = [{ type: 'function', name: 'mcp__history_eval__history_eval', description: 'Synthetic controlled gateway',
    parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } } } }];
  const configuration = path.join(root, 'configuration.json');
  const requests = path.join(root, 'provider-requests.jsonl');
  fs.writeFileSync(configuration, JSON.stringify({ codexPath: codexExecutable, codexSha256: config.codexSha256,
    model: config.model, effort: config.effort }));
  fs.writeFileSync(requests, JSON.stringify({ method: 'POST', url: '/v1/responses', decodeError: null, body: { model: config.model, tools } }) + '\n');
  const proof = { schemaVersion: 1, kind: 'local-fake-provider-tool-exposure', status: 'pass', passed: true,
    model: config.model, effort: config.effort, codexSha256: config.codexSha256,
    commonConfigSha256: commonConfigSha256(config), unsafeTools: [], responseRequests: 1, requests: 1,
    exposures: [checkExposure(tools)], proofFiles: [configuration, requests].map((file) => ({ path: file, sha256: sha256(fs.readFileSync(file)) })) };
  const saveProof = () => fs.writeFileSync(config.toolBoundaryAudit, JSON.stringify(proof));
  saveProof();
  return { root, config, proof, tools, requests, configuration, saveProof };
}
function writeRows(file, rows) {
  fs.writeFileSync(file, rows.map((row) => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
}

test('blocked or absent boundary proof prevents all credential and worker preparation', async (t) => {
  const f = fixture(t);
  f.proof.passed = false; f.proof.status = 'blocked'; f.saveProof();
  const manifest = path.join(f.root, 'run.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  await assert.rejects(runner.run(manifest), /Tool-boundary probe is blocked/u);
  assert.equal(fs.existsSync(f.config.directory), false);
  assert.equal(fs.existsSync(f.config.authFile), false);
  delete f.config.toolBoundaryAudit;
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  await assert.rejects(runner.run(manifest), /passing tool-boundary probe/u);
  assert.equal(fs.existsSync(f.config.directory), false);
});

test('boundary acceptance is tied to pinned executable, model, effort and common settings', (t) => {
  const f = fixture(t);
  assert.equal(runner.validateToolBoundary(f.config).status, 'pass');
  for (const mutation of [
    { codexSha256: '0'.repeat(64) }, { model: 'other-model' }, { effort: 'high' },
    { commonConfigSha256: 'f'.repeat(64) }, { unsafeTools: ['functions.exec'] },
  ]) {
    const original = { ...f.proof };
    Object.assign(f.proof, mutation); f.saveProof();
    assert.throws(() => runner.validateToolBoundary(f.config), /Tool-boundary probe/u);
    Object.assign(f.proof, original);
  }
});

test('changed or incomplete probe evidence cannot authorize a real worker', async (t) => {
  const f = fixture(t);
  fs.appendFileSync(f.requests, ' ');
  assert.throws(() => runner.validateToolBoundary(f.config), /evidence changed/u);
  // Updating a digest does not turn a summary-only assertion into exposure proof.
  f.proof.proofFiles = f.proof.proofFiles.filter((file) => file.path !== f.requests);
  f.saveProof();
  assert.throws(() => runner.validateToolBoundary(f.config), /probe|evidence|request/iu);
  const manifest = path.join(f.root, 'run.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  await assert.rejects(runner.run(manifest), /probe|evidence|request/iu);
  assert.equal(fs.existsSync(f.config.directory), false);
});

test('exposure is rechecked from provider requests rather than trusting an optimistic summary', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.requests, JSON.stringify({ method: 'POST', url: '/v1/responses', decodeError: null,
    body: { model: f.config.model, tools: [...f.tools, { type: 'function', name: 'read_private_file', parameters: { type: 'object' } }] } }) + '\n');
  f.proof.proofFiles.find((file) => file.path === f.requests).sha256 = sha256(fs.readFileSync(f.requests));
  f.saveProof();
  assert.throws(() => runner.validateToolBoundary(f.config), /probe|exposure|tool/iu);
});

function adversarialFixture(t) {
  const f = fixture(t);
  const controlled = { type: 'namespace', name: 'mcp__history_eval', tools: [
    { type: 'function', name: 'history_eval', parameters: { type: 'object' } },
  ] };
  const input = [
    { type: 'tool_search_output', call_id: 'call_probe_search', tools: [controlled] },
    { type: 'function_call_output', call_id: 'call_probe_unknown_resource', output: "unknown MCP server 'outside_probe'" },
    { type: 'function_call_output', call_id: 'call_probe_known_resource', output: 'resources/read failed: Mcp error: -32601: Unsupported method' },
    { type: 'function_call_output', call_id: 'call_probe_known_resource_http', output: 'resources/read failed: Mcp error: -32601: Unsupported method' },
    { type: 'custom_tool_call_output', call_id: 'call_probe_undeclared_patch', output: 'unsupported custom tool call: apply_patch' },
    { type: 'custom_tool_call_output', call_id: 'call_probe_undeclared_exec', output: 'unsupported custom tool call: exec' },
    { type: 'function_call_output', call_id: 'call_probe_undeclared_exec_command', output: 'unsupported call: exec_command' },
    { type: 'function_call_output', call_id: 'call_probe_controlled_read', output: 'SYNTHETIC_CONTROLLED_GATE_CANARY' },
  ];
  const resourceTools = [
    { type: 'function', name: 'tool_search', parameters: { type: 'object' } },
    { type: 'namespace', name: 'functions', tools: [
      { type: 'function', name: 'list_mcp_resources', parameters: { type: 'object' } },
      { type: 'function', name: 'list_mcp_resource_templates', parameters: { type: 'object' } },
      { type: 'function', name: 'read_mcp_resource', parameters: { type: 'object' } },
    ] },
  ];
  const request = { method: 'POST', url: '/v1/responses', decodeError: null,
    body: { model: f.config.model, tools: resourceTools, input } };
  const gateScript = path.join(ROOT, 'scripts/history-eval-mcp.js');
  f.proof.adversarial = { passed: true, gateScript: { path: gateScript, sha256: sha256(fs.readFileSync(gateScript)) } };
  f.proof.process = { exitCode: 0, timedOut: false, captureComplete: true };
  f.proof.transport = { kind: 'parent-owned-loopback', closed: true };
  f.proof.gateDependencies = ['history-eval-mcp.js', 'history-eval-transport.js', 'history-eval-scope.js', 'history-eval-supervisor.js', 'history-eval-common.js', 'record-history-eval.js']
    .map((name) => { const file = path.join(ROOT, 'scripts', name); return { path: file, sha256: sha256(fs.readFileSync(file)) }; });
  const saveRequests = (requests = [request]) => {
    writeRows(f.requests, requests);
    f.proof.proofFiles.find((file) => file.path === f.requests).sha256 = sha256(fs.readFileSync(f.requests));
    f.saveProof();
  };
  saveRequests();
  return { ...f, input, request, saveRequests };
}

test('resource helpers require a complete adversarial proof bound to the actual gate and dependencies', async (t) => {
  const f = adversarialFixture(t);
  assert.equal(runner.validateToolBoundary(f.config).status, 'pass');
  const original = structuredClone(f.proof);
  const restore = () => {
    for (const key of Object.keys(f.proof)) delete f.proof[key];
    Object.assign(f.proof, structuredClone(original));
  };
  for (const weaken of [
    () => { delete f.proof.adversarial; },
    () => { f.proof.adversarial.passed = false; },
    () => { delete f.proof.gateDependencies; },
    () => { f.proof.gateDependencies.pop(); },
    () => { f.proof.gateDependencies[1].sha256 = '0'.repeat(64); },
    () => { f.proof.adversarial.gateScript.sha256 = '0'.repeat(64); },
    () => { f.proof.adversarial.gateScript.path = path.join(f.root, 'other-gate.js'); },
    () => { delete f.proof.transport; },
    () => { f.proof.transport.closed = false; },
  ]) {
    restore(); weaken(); f.saveProof();
    assert.throws(() => runner.validateToolBoundary(f.config), /boundary|proof|dependencies/iu);
  }
  // The failure remains before auth or worker preparation through run(), too.
  restore(); delete f.proof.gateDependencies; f.saveProof();
  const manifest = path.join(f.root, 'run.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  await assert.rejects(runner.run(manifest), /dependencies/iu);
  assert.equal(fs.existsSync(f.config.directory), false);
});

test('optimistic adversarial summary cannot replace missing rejection or controlled-delivery observations', (t) => {
  const f = adversarialFixture(t);
  for (const omitted of f.input) {
    f.saveRequests([{ ...f.request, body: { ...f.request.body, input: f.input.filter((item) => item !== omitted) } }]);
    assert.throws(() => runner.validateToolBoundary(f.config), /Adversarial.*incomplete/u, omitted.call_id);
  }
  f.saveRequests();
  assert.equal(runner.validateToolBoundary(f.config).status, 'pass');
  for (const processResult of [
    { exitCode: 1, timedOut: false, captureComplete: true },
    { exitCode: 0, timedOut: true, captureComplete: true },
    { exitCode: 0, timedOut: false, captureComplete: false },
  ]) {
    f.proof.process = processResult; f.saveProof();
    assert.throws(() => runner.validateToolBoundary(f.config), /Adversarial.*incomplete/u);
  }
});

test('resource fallback, outside canary delivery, expanded registry or a created patch invalidate proof', (t) => {
  const f = adversarialFixture(t);
  const marker = path.join(f.root, 'unexpected-patch.txt');
  fs.writeFileSync(marker, 'synthetic unexpected write');
  assert.throws(() => runner.validateToolBoundary(f.config), /Adversarial.*incomplete/u);
  fs.unlinkSync(marker);
  f.saveRequests([f.request, { method: 'GET', url: '/outside-resource-fallback', body: {} }]);
  assert.throws(() => runner.validateToolBoundary(f.config), /Adversarial.*incomplete/u);
  const outside = { type: 'function_call_output', call_id: 'uncontrolled', output: 'SYNTHETIC_OUTSIDE_SOURCE_MUST_NOT_BE_DELIVERED' };
  f.saveRequests([{ ...f.request, body: { ...f.request.body, input: [...f.input, outside] } }]);
  assert.throws(() => runner.validateToolBoundary(f.config), /Adversarial.*incomplete/u);
  const extraRegistry = structuredClone(f.input);
  extraRegistry[0].tools.push({ type: 'function', name: 'uncontrolled_read', parameters: {} });
  f.saveRequests([{ ...f.request, body: { ...f.request.body, input: extraRegistry } }]);
  assert.throws(() => runner.validateToolBoundary(f.config), /Adversarial.*incomplete/u);
});

test('a passing adversarial probe stays tied to the unchanged model catalog', (t) => {
  const f = adversarialFixture(t);
  f.config.modelCatalog = path.join(f.root, 'synthetic-model-catalog.json');
  fs.writeFileSync(f.config.modelCatalog, JSON.stringify({ models: [{ slug: f.config.model }] }));
  f.proof.commonConfigSha256 = commonConfigSha256(f.config);
  f.proof.modelCatalog = { unchanged: true, sha256: sha256(fs.readFileSync(f.config.modelCatalog)) };
  f.saveProof();
  assert.equal(runner.validateToolBoundary(f.config).status, 'pass');
  f.proof.modelCatalog.unchanged = false; f.saveProof();
  assert.throws(() => runner.validateToolBoundary(f.config), /model catalog/u);
  f.proof.modelCatalog.unchanged = true; f.saveProof();
  fs.appendFileSync(f.config.modelCatalog, ' ');
  assert.throws(() => runner.validateToolBoundary(f.config), /configuration|catalog/u);
});

test('output audit correlates the exact controlled tool call and content without claiming provider packing', (t) => {
  const f = fixture(t);
  const eventsFile = path.join(f.root, 'events.jsonl');
  const gateFile = path.join(f.root, 'gate-events.jsonl');
  const args = ['history', 'status', '--endpoint', 'http://127.0.0.1:17891'];
  const response = { content: [{ type: 'text', text: 'SYNTHETIC_GATE_OUTPUT 中文' }], isError: false };
  const gate = { event: 'tool_response', args, response, responseSha256: sha256(JSON.stringify(response)) };
  const event = { type: 'item.completed', item: { id: 'call-synthetic', type: 'mcp_tool_call', server: 'history_eval',
    tool: 'history_eval', arguments: { args }, result: response } };
  const audit = () => runner.auditToolOutput(eventsFile, gateFile);
  const reset = () => { writeRows(eventsFile, [event]); writeRows(gateFile, [gate]); };
  reset();
  const matched = audit();
  assert.equal(matched.status, 'matched');
  assert.match(matched.limit, /unknown|not hidden provider/iu);
  for (const item of [
    { ...event.item, server: 'uncontrolled_server' },
    { ...event.item, tool: 'other_tool' },
    { ...event.item, arguments: { args: ['raw', 'read', 'unrelated'] } },
    { ...event.item, result: { ...response, content: [{ type: 'text', text: 'TRUNCATED' }] } },
  ]) {
    reset(); writeRows(eventsFile, [{ ...event, item }]);
    assert.equal(audit().status, 'unknown');
  }
  reset(); writeRows(eventsFile, [event, '{incomplete-event']);
  assert.equal(audit().status, 'unknown');
  reset(); writeRows(eventsFile, [event, { ...event, item: { ...event.item, id: 'extra-call' } }]);
  assert.equal(audit().status, 'unknown');
  reset(); writeRows(gateFile, [{ ...gate, responseSha256: '0'.repeat(64) }]);
  assert.equal(audit().status, 'unknown');
});

test('missing gate or empty event evidence stays unknown', (t) => {
  const f = fixture(t);
  const events = path.join(f.root, 'events.jsonl');
  const gate = path.join(f.root, 'gate.jsonl');
  writeRows(events, []);
  assert.equal(runner.auditToolOutput(events, gate).status, 'unknown');
  writeRows(gate, []);
  assert.equal(runner.auditToolOutput(events, gate).status, 'unknown');
});

test('the original batch deadline bounds a retry and expires before credential preparation', async (t) => {
  const f = fixture(t);
  const now = Date.parse('2026-01-01T00:00:00Z');
  const config = { timeoutMs: 900000, approvalBatch: { deadline: '2026-01-01T00:00:30Z' } };
  assert.equal(runner.workerTimeout(config, now), 30000);
  assert.equal(runner.workerTimeout({ ...config, timeoutMs: 10000 }, now), 10000);
  assert.throws(() => runner.workerTimeout(config, now + 30000), /expired/u);
  assert.throws(() => runner.workerTimeout({ ...config, approvalBatch: { deadline: 'invalid' } }, now), /Invalid/u);
  f.config.approvalBatch = { deadline: '2020-01-01T00:00:00Z' };
  const manifest = path.join(f.root, 'expired-run.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  await assert.rejects(runner.run(manifest), /expired/u);
  assert.equal(fs.existsSync(f.config.directory), false);
});

test('actual configuration comes from persisted turn context and preserves mismatches and provenance', (t) => {
  const f = fixture(t);
  const home = path.join(f.root, 'home');
  const sessions = path.join(home, 'sessions', 'nested');
  fs.mkdirSync(sessions, { recursive: true });
  const file = path.join(sessions, 'synthetic.jsonl');
  writeRows(file, [
    { type: 'event_msg', payload: { model: 'untrusted-text-model', effort: 'low' } },
    { type: 'turn_context', payload: { model: 'synthetic-model', effort: 'max', approval_policy: 'never', sandbox_policy: { type: 'read-only' } } },
    { type: 'turn_context', payload: { model: 'different-actual-model', effort: 'high', approval_policy: 'on-request', sandbox_policy: { type: 'workspace-write' } } },
  ]);
  const actual = runner.actualConfiguration(home);
  assert.equal(actual.length, 2);
  assert.equal(actual[0].model, 'synthetic-model');
  assert.equal(actual[1].model, 'different-actual-model');
  assert.equal(actual[1].approvalPolicy, 'on-request');
  assert.equal(actual[1].sandboxPolicy.type, 'workspace-write');
  assert.ok(actual.every((entry) => entry.sessionFile === file && entry.sessionSha256 === sha256(fs.readFileSync(file))));
  assert.deepEqual(runner.actualConfiguration(path.join(f.root, 'empty-home')), []);
});

test('frozen input maps reject changed, missing or newly introduced bytes before auth is read', async (t) => {
  const f = fixture(t);
  f.config.runtimeRoot = path.join(f.root, 'runtime');
  fs.mkdirSync(path.join(f.config.runtimeRoot, 'src'), { recursive: true });
  const source = path.join(f.config.runtimeRoot, 'src', 'synthetic.js');
  fs.writeFileSync(source, 'module.exports = "synthetic frozen baseline";\n');
  fs.writeFileSync(path.join(f.config.runtimeRoot, 'package.json'), '{"name":"synthetic"}');
  for (const key of ['scopeFile', 'corpusManifest', 'promptFile']) {
    f.config[key] = path.join(f.root, `${key}.json`); fs.writeFileSync(f.config[key], JSON.stringify({ synthetic: key }));
  }
  f.config.expectedRuntimeFiles = runner.hashes(f.config.runtimeRoot, (file) => file.startsWith('src/') || ['server.js', 'package.json', 'package-lock.json'].includes(file));
  f.config.expectedHarnessFiles = runner.hashes(path.join(ROOT, 'scripts'), (file) => /^(history-eval-|run-history-codex-eval|import-history-codex-usage|record-history-eval|aggregate-history-eval|probe-history-codex-tools)/u.test(file));
  f.config.expectedArtifactHashes = Object.fromEntries(['scopeFile', 'corpusManifest', 'promptFile'].map((key) => [key, sha256(fs.readFileSync(f.config[key]))]));
  runner.validateFrozenInputs(f.config);
  const original = fs.readFileSync(f.config.promptFile);
  fs.appendFileSync(f.config.promptFile, 'changed-task');
  assert.throws(() => runner.validateFrozenInputs(f.config), /frozen|changed|hash|artifact/iu);
  const manifest = path.join(f.root, 'run.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  await assert.rejects(runner.run(manifest), /frozen|changed|hash|artifact/iu);
  assert.equal(fs.existsSync(f.config.directory), false);
  fs.writeFileSync(f.config.promptFile, original);
  fs.writeFileSync(path.join(f.config.runtimeRoot, 'src', 'injected.js'), 'unfrozen implementation');
  assert.throws(() => runner.validateFrozenInputs(f.config), /frozen|changed|hash|runtime/iu);
  fs.unlinkSync(path.join(f.config.runtimeRoot, 'src', 'injected.js'));
  fs.unlinkSync(source);
  assert.throws(() => runner.validateFrozenInputs(f.config), /frozen|changed|hash|runtime/iu);
});

function completeCalibration() {
  const config = { model: 'synthetic-model', effort: 'max', initialState: 'no-service', calibrationControl: true };
  const result = { exitCode: 0, timedOut: false, captureComplete: true };
  const usage = { complete: true, observed: { inputTokens: 42, outputTokens: 8, cachedInputTokens: null, reasoningTokens: null } };
  const actual = [{ model: config.model, effort: config.effort, approvalPolicy: 'never', sandboxPolicy: { type: 'read-only' } }];
  const output = { status: 'matched', gateCalls: 1, eventCalls: 1 };
  const audit = { preflight: { stage: 'pre-index', verified: true, indexingCostIncurred: false,
    scopeSha256: 'a'.repeat(64), corpusHash: 'b'.repeat(64), fileCount: 1 },
    index: { stage: 'post-index', verified: true, indexingCostIncurred: true,
      sourceRoot: path.join(ROOT, 'tmp', 'synthetic-frozen', 'codex', 'sessions'),
      projectPathIdentity: { version: 1, digest: 'synthetic-project-identity' }, projectPathPolicyId: 'c'.repeat(64),
      sessionCount: 1, sessionIds: ['synthetic-session'], sessionSetSha256: sha256(JSON.stringify(['synthetic-session'])) } };
  const gate = [
    { event: 'preflight_passed', origin: 'worker', audit: audit.preflight },
    { event: 'service_observation', observation: { event: 'indexing_complete', audit } },
    { event: 'service_observation', observation: { event: 'ready', audit } },
    { event: 'forwarding_scope_verified', operation: 'search' },
  ];
  const lifecycle = [
    { id: 'service', event: 'start_requested' }, { id: 'service', event: 'started' },
    { id: 'service', event: 'indexing_complete' }, { id: 'service', event: 'ready' },
    { id: 'control', event: 'start_requested' }, { id: 'control', event: 'started' }, { id: 'control', event: 'ready' },
    { id: 'service', event: 'closed', captureComplete: true, timedOut: false, stopReason: 'trial_cleanup' },
    { id: 'control', event: 'closed', captureComplete: true, timedOut: false, stopReason: 'trial_cleanup' },
    { event: 'supervisor_closed' },
  ];
  return { config, result, usage, actual, output, gate, lifecycle };
}
function assess(f) {
  return runner.assessCalibrationChecks(f.config, f.result, f.usage, f.actual, f.output, f.gate, f.lifecycle);
}

test('calibration requires usage, actual configuration, both scope stages, lifecycle/control and output audit', () => {
  const complete = completeCalibration();
  assert.equal(assess(complete).complete, true);
  // Provider packing may remain explicitly unknown; this does not waive actual
  // gate output/call auditing or any of the other plumbing checks.
  complete.output.status = 'unknown';
  assert.equal(assess(complete).complete, true);
  const missingEvidence = [
    (f) => { f.actual = []; },
    (f) => { f.actual[0].model = 'different'; },
    (f) => { f.actual[0].effort = 'low'; },
    (f) => { f.actual[0].approvalPolicy = 'on-request'; },
    (f) => { f.actual[0].sandboxPolicy = { type: 'workspace-write' }; },
    (f) => { f.usage.complete = false; },
    (f) => { f.usage.observed.inputTokens = null; },
    (f) => { f.usage.observed.outputTokens = null; },
    (f) => { f.output = { status: 'unknown', reason: 'No gate event stream' }; },
    (f) => { f.gate = []; },
    (f) => { f.gate.push({ event: 'trial_aborted' }); },
    (f) => { f.gate = f.gate.filter((row) => row.observation?.event !== 'indexing_complete'); },
    (f) => { f.gate = f.gate.filter((row) => row.event !== 'forwarding_scope_verified'); },
    (f) => { f.lifecycle = f.lifecycle.filter((row) => row.id !== 'control'); },
    (f) => { f.lifecycle = f.lifecycle.filter((row) => !(row.id === 'service' && row.event === 'closed')); },
    (f) => { f.lifecycle = f.lifecycle.filter((row) => row.event !== 'supervisor_closed'); },
    (f) => { f.lifecycle.push({ event: 'cleanup_unconfirmed', id: 'control' }); },
    (f) => { f.config.calibrationControl = false; },
    (f) => { f.config.initialState = 'service-ready'; },
    (f) => { f.result.exitCode = 1; },
    (f) => { f.result.timedOut = true; },
  ];
  for (const remove of missingEvidence) {
    const f = completeCalibration(); remove(f);
    assert.equal(assess(f).complete, false, String(remove));
  }
});

test('unknown capture completeness or a count-only scope receipt cannot pass calibration', () => {
  const workerCaptureUnknown = completeCalibration();
  delete workerCaptureUnknown.result.captureComplete;
  assert.equal(assess(workerCaptureUnknown).complete, false);
  const controlCaptureUnknown = completeCalibration();
  delete controlCaptureUnknown.lifecycle.find((row) => row.id === 'control' && row.event === 'closed').captureComplete;
  assert.equal(assess(controlCaptureUnknown).complete, false);
  const countOnly = completeCalibration();
  const index = countOnly.gate.find((row) => row.observation?.event === 'indexing_complete').observation.audit.index;
  delete index.sessionSetSha256;
  delete index.sessionIds;
  assert.equal(assess(countOnly).complete, false);
});

function completeFormal(condition = 'current', initialState = 'no-service') {
  const f = completeCalibration();
  const preflight = f.gate[0].audit;
  const index = f.gate.find((entry) => entry.observation?.event === 'indexing_complete').observation.audit.index;
  Object.assign(f.config, { purpose: 'formal-comparison', condition, initialState, calibrationControl: false, corpusHash: preflight.corpusHash });
  f.lifecycle = f.lifecycle.filter((entry) => entry.id !== 'control');
  const scope = { scopeSha256: preflight.scopeSha256, corpusHash: preflight.corpusHash, sessionIds: index.sessionIds,
    sessionSetSha256: index.sessionSetSha256, sourceRoot: index.sourceRoot, project: { identity: index.projectPathIdentity },
    projectPathPolicyId: index.projectPathPolicyId, files: [{ relativePath: 'sessions/synthetic.jsonl', sha256: 'd'.repeat(64), bytes: 128 }] };
  f.evidence = { scope, frozenInputsUnchanged: true, answer: { bytes: 42, sha256: 'e'.repeat(64) } };
  f.gate.unshift({ event: 'gate_preflight_passed', audit: preflight });
  if (initialState === 'service-ready') f.gate.find((entry) => entry.event === 'preflight_passed').origin = 'initial-state-preparation';
  if (condition === 'raw') {
    f.lifecycle = [{ event: 'supervisor_closed' }];
    f.gate = [f.gate[0], { event: 'raw_scope_verified', call: 1, operation: 'read', corpusHash: scope.corpusHash,
      scopeSha256: scope.scopeSha256, files: structuredClone(scope.files) },
    { event: 'tool_response', call: 1, args: ['raw', 'read', 'sessions/synthetic.jsonl'], response: { isError: false } }];
  }
  return f;
}
function assessFormal(f) {
  return runner.assessFormalChecks(f.config, f.result, f.usage, f.actual, f.output, f.gate, f.lifecycle, f.evidence);
}

test('formal purpose keeps calibration behavior separate and rejects an unreviewed mode before credentials', async (t) => {
  assert.equal(runner.purposeOf({}), 'calibration-only');
  assert.equal(runner.purposeOf({ purpose: 'calibration-only', calibrationControl: true }), 'calibration-only');
  assert.equal(runner.purposeOf({ purpose: 'formal-comparison', calibrationControl: false }), 'formal-comparison');
  const f = fixture(t);
  for (const extra of [{ purpose: 'formal' }, { purpose: 'formal-comparison', calibrationControl: true }]) {
    const manifest = path.join(f.root, 'unapproved-mode.json');
    fs.writeFileSync(manifest, JSON.stringify({ ...f.config, ...extra }));
    await assert.rejects(runner.run(manifest), /purpose|control/u);
    assert.equal(fs.existsSync(f.config.directory), false);
  }
  assert.throws(() => runner.validateToolBoundary({ ...f.config, purpose: 'formal-comparison' }), /adversarial/u);
});

test('formal runtime checks support all frozen condition/state pairs without claiming answer quality', () => {
  for (const condition of ['raw', 'current', 'candidate']) for (const initialState of ['no-service', 'service-ready']) {
    const f = completeFormal(condition, initialState);
    const report = assessFormal(f);
    assert.equal(report.complete, true, `${condition}/${initialState}`);
    assert.match(report.limit, /answer quality.*unassessed/u);
    if (condition === 'raw') {
      assert.equal(report.checks.rawScope, true);
      assert.equal(report.checks.serviceLifecycle, undefined);
    } else {
      assert.equal(report.checks.initialState, true);
      assert.equal(report.checks.scopeStages, true);
      assert.equal(report.checks.rawScope, undefined);
    }
  }
  assert.equal(assess(completeCalibration()).complete, true, 'the existing no-service calibration contract is unchanged');
});

test('formal missing usage, output matching, actual configuration, answer, frozen inputs or cleanup remain incomplete', () => {
  for (const condition of ['raw', 'current', 'candidate']) {
    const mutations = [
      (f) => { f.usage.complete = false; },
      (f) => { f.usage.observed.inputTokens = null; },
      (f) => { f.usage.observed.outputTokens = null; },
      (f) => { f.output.status = 'unknown'; },
      (f) => { f.output.eventCalls = 2; },
      (f) => { f.actual = []; },
      (f) => { f.actual[0].model = 'different'; },
      (f) => { f.actual[0].approvalPolicy = 'on-request'; },
      (f) => { f.evidence.answer = null; },
      (f) => { f.evidence.answer.bytes = 0; },
      (f) => { f.evidence.frozenInputsUnchanged = false; },
      (f) => { f.evidence.scope = null; },
      (f) => { f.gate = f.gate.filter((entry) => entry.event !== 'gate_preflight_passed'); },
      (f) => { f.gate.push({ event: 'trial_aborted' }); },
      (f) => { f.lifecycle = f.lifecycle.filter((entry) => entry.event !== 'supervisor_closed'); },
      (f) => { f.lifecycle.push({ event: 'cleanup_unconfirmed', id: 'service' }); },
      (f) => { f.lifecycle.push({ event: 'started', id: 'control' }); },
      (f) => { f.result.captureComplete = false; },
      (f) => { f.result.timedOut = true; },
      (f) => { f.result.cleanupError = 'unconfirmed'; },
    ];
    for (const mutate of mutations) {
      const f = completeFormal(condition); mutate(f);
      assert.equal(assessFormal(f).complete, false, `${condition}: ${mutate}`);
    }
  }
});

test('formal structured scope compares the actual Session set and required start origin', () => {
  for (const condition of ['current', 'candidate']) for (const initialState of ['no-service', 'service-ready']) {
    for (const mutate of [
      (f) => { f.gate.find((entry) => entry.event === 'preflight_passed').origin = initialState === 'no-service' ? 'initial-state-preparation' : 'worker'; },
      (f) => { delete f.gate.find((entry) => entry.observation?.event === 'indexing_complete').observation.audit.index.sessionIds; },
      (f) => { f.gate.find((entry) => entry.observation?.event === 'indexing_complete').observation.audit.index = { sourceRoot: f.evidence.scope.sourceRoot, sessionCount: 1 }; },
      (f) => { f.gate.find((entry) => entry.observation?.event === 'indexing_complete').observation.audit.index.sessionIds = ['different-session']; },
      (f) => { f.gate.find((entry) => entry.observation?.event === 'indexing_complete').observation.audit.index.sourceRoot = 'different-root'; },
      (f) => { f.gate = f.gate.filter((entry) => entry.event !== 'forwarding_scope_verified'); },
      (f) => { f.lifecycle.find((entry) => entry.event === 'closed' && entry.id === 'service').captureComplete = null; },
    ]) {
      const f = completeFormal(condition, initialState); mutate(f);
      assert.equal(assessFormal(f).complete, false, `${condition}/${initialState}: ${mutate}`);
    }
  }
});

test('formal raw scope requires a matching verified-file receipt for delivered calls and forbids a history service', () => {
  for (const mutate of [
    (f) => { f.gate = f.gate.filter((entry) => entry.event !== 'raw_scope_verified'); },
    (f) => { f.gate.find((entry) => entry.event === 'raw_scope_verified').call = 2; },
    (f) => { f.gate.find((entry) => entry.event === 'raw_scope_verified').files[0].sha256 = 'f'.repeat(64); },
    (f) => { f.gate.find((entry) => entry.event === 'raw_scope_verified').files[0].relativePath = 'outside.jsonl'; },
    (f) => { f.gate.find((entry) => entry.event === 'tool_response').response.isError = true; },
    (f) => { f.lifecycle.push({ id: 'service', event: 'started' }); },
  ]) {
    const f = completeFormal('raw'); mutate(f);
    assert.equal(assessFormal(f).complete, false, String(mutate));
  }
});

test('answer artifact validation requires an actual nonempty file and retains its content hash', (t) => {
  const f = fixture(t);
  assert.equal(runner.answerArtifact(f.root), null);
  fs.writeFileSync(path.join(f.root, 'answer.txt'), ' \n');
  assert.equal(runner.answerArtifact(f.root).bytes, 0);
  fs.writeFileSync(path.join(f.root, 'answer.txt'), 'Synthetic answer.\n');
  assert.deepEqual(runner.answerArtifact(f.root), { path: path.join(f.root, 'answer.txt'), bytes: 18,
    sha256: sha256('Synthetic answer.\n') });
});

function freezeFormalTestInputs(f) {
  f.config.purpose = 'formal-comparison';
  f.config.calibrationControl = false;
  f.config.runtimeRoot = path.join(f.root, 'runtime');
  f.config.guideRoot = path.join(f.root, 'guide');
  fs.mkdirSync(path.join(f.config.runtimeRoot, 'src'), { recursive: true });
  fs.mkdirSync(f.config.guideRoot);
  fs.writeFileSync(path.join(f.config.runtimeRoot, 'src', 'synthetic.js'), 'module.exports = "synthetic";\n');
  fs.writeFileSync(path.join(f.config.runtimeRoot, 'package.json'), '{"name":"synthetic-runtime","dependencies":{}}');
  fs.writeFileSync(path.join(f.config.guideRoot, 'SKILL.md'), 'Synthetic formal guide.\n');
  f.config.guides = runner.hashes(f.config.guideRoot);
  for (const key of ['scopeFile', 'corpusManifest', 'promptFile']) {
    f.config[key] = path.join(f.root, `${key}.json`);
    fs.writeFileSync(f.config[key], JSON.stringify({ synthetic: key }));
  }
  f.config.expectedRuntimeFiles = runner.hashes(f.config.runtimeRoot);
  f.config.expectedHarnessFiles = runner.hashes(path.join(ROOT, 'scripts'), (file) => /^(history-eval-|run-history-codex-eval|import-history-codex-usage|record-history-eval|aggregate-history-eval|probe-history-codex-tools)/u.test(file));
  f.config.expectedArtifactHashes = Object.fromEntries(['scopeFile', 'corpusManifest', 'promptFile']
    .map((key) => [key, sha256(fs.readFileSync(f.config[key]))]));
}

test('formal frozen inputs include the exact guide file set before worker preparation', async (t) => {
  const f = adversarialFixture(t);
  freezeFormalTestInputs(f);
  runner.validateFrozenInputs(f.config);
  const guide = path.join(f.config.guideRoot, 'SKILL.md');
  fs.appendFileSync(guide, 'changed guidance');
  assert.throws(() => runner.validateFrozenInputs(f.config), /guide files changed/u);
  const manifest = path.join(f.root, 'changed-guide-run.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  await assert.rejects(runner.run(manifest), /guide files changed/u);
  assert.equal(fs.existsSync(f.config.directory), false);
  fs.writeFileSync(guide, 'Synthetic formal guide.\n');
  fs.writeFileSync(path.join(f.config.guideRoot, 'unfrozen.md'), 'undeclared guide');
  assert.throws(() => runner.validateFrozenInputs(f.config), /guide files changed/u);
});

test('formal preparation failures retain elapsed cost and unknown usage without starting a worker', async (t) => {
  const f = adversarialFixture(t);
  freezeFormalTestInputs(f);
  fs.writeFileSync(f.config.authFile, 'SYNTHETIC_CREDENTIAL_FILE_NOT_SENT_ANYWHERE');
  const manifest = path.join(f.root, 'preparation-failure.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  // The deliberately invalid synthetic scope fails before requiring a CLI,
  // building an index, launching Codex or contacting any model destination.
  const result = await runner.run(manifest);
  assert.equal(result.workerStarted, false);
  assert.equal(result.phase, 'preparation');
  assert.equal(result.runtimeChecksComplete, false);
  assert.equal(result.formalComparisonComplete, false);
  assert.equal(result.modelUsage, null);
  assert.ok(result.preparationElapsedMs >= 0);
  const retained = JSON.parse(fs.readFileSync(path.join(f.config.directory, 'result.json'), 'utf8'));
  assert.equal(retained.purpose, 'formal-comparison');
  assert.equal(retained.evidenceQualityAssessed, false);
  assert.equal(fs.existsSync(path.join(f.config.directory, 'worker-process')), false);
});

test('formal credential preparation failure is recorded after creating the trial directory', async (t) => {
  const f = adversarialFixture(t);
  freezeFormalTestInputs(f);
  const manifest = path.join(f.root, 'missing-auth.json');
  fs.writeFileSync(manifest, JSON.stringify(f.config));
  const result = await runner.run(manifest);
  assert.equal(result.error.code, 'ENOENT');
  assert.equal(result.workerStarted, false);
  assert.equal(result.phase, 'preparation');
  assert.equal(result.modelUsage, null);
  assert.equal(result.runtimeChecksComplete, false);
  assert.ok(result.preparationElapsedMs >= 0);
  const retained = JSON.parse(fs.readFileSync(path.join(f.config.directory, 'result.json'), 'utf8'));
  assert.deepEqual(retained.error, result.error);
  assert.equal(retained.preparationStartedAt, result.preparationStartedAt);
  assert.equal(fs.existsSync(path.join(f.config.directory, 'worker-process')), false);
  assert.equal(fs.existsSync(path.join(f.config.directory, 'gate')), false);
});

test('formal full-tree freezing rejects dependency tampering, additions and removals', (t) => {
  const f = adversarialFixture(t);
  freezeFormalTestInputs(f);
  const dependency = path.join(f.config.runtimeRoot, 'node_modules', 'synthetic-dependency');
  fs.mkdirSync(dependency, { recursive: true });
  const entry = path.join(dependency, 'index.js'), extra = path.join(dependency, 'extra.js');
  const original = 'module.exports = "frozen dependency";\n';
  fs.writeFileSync(path.join(dependency, 'package.json'), '{"name":"synthetic-dependency","version":"1.0.0","main":"index.js"}');
  fs.writeFileSync(entry, original);
  fs.writeFileSync(path.join(f.config.runtimeRoot, 'package.json'), '{"name":"synthetic-runtime","dependencies":{"synthetic-dependency":"1.0.0"}}');
  f.config.expectedRuntimeFiles = runner.hashes(f.config.runtimeRoot, () => true, { includeNodeModules: true });
  runner.validateFrozenInputs(f.config);
  assert.ok(f.config.expectedRuntimeFiles['node_modules/synthetic-dependency/index.js']);
  assert.equal(runner.hashes(f.config.runtimeRoot)['node_modules/synthetic-dependency/index.js'], undefined,
    'calibration hashing still excludes dependencies');
  fs.writeFileSync(entry, 'module.exports = "changed dependency";\n');
  assert.throws(() => runner.validateFrozenInputs(f.config), /Frozen input hashes changed/u);
  fs.writeFileSync(entry, original);
  fs.writeFileSync(extra, 'unfrozen file');
  assert.throws(() => runner.validateFrozenInputs(f.config), /Frozen input hashes changed/u);
  fs.unlinkSync(extra);
  fs.unlinkSync(entry);
  assert.throws(() => runner.validateFrozenInputs(f.config), /Frozen input hashes changed/u);
});

test('formal dependency resolution cannot fall through to ambient workspace modules', (t) => {
  const f = adversarialFixture(t);
  freezeFormalTestInputs(f);
  fs.writeFileSync(path.join(f.config.runtimeRoot, 'package.json'), '{"name":"synthetic-runtime","dependencies":{"acorn":"8.15.0"}}');
  f.config.expectedRuntimeFiles = runner.hashes(f.config.runtimeRoot, () => true, { includeNodeModules: true });
  assert.throws(() => runner.validateFrozenInputs(f.config), /unfrozen ambient dependency: acorn/u);
});
