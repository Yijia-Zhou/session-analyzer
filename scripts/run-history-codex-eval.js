#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { ROOT, sha256, privateTarget } = require('./history-eval-common');
const { createSupervisor } = require('./history-eval-supervisor');
const { importUsage } = require('./import-history-codex-usage');
const { buildCodexArgs, commonConfigSha256 } = require('./history-eval-codex-config');
const { checkExposure, requestTools, assessAdversarial } = require('./probe-history-codex-tools');
const { startGateTransport } = require('./history-eval-transport');

function writeNew(file, value) { fs.writeFileSync(privateTarget(file), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
function purposeOf(config) {
  const purpose = config.purpose ?? 'calibration-only';
  if (!['calibration-only', 'formal-comparison'].includes(purpose)) throw new Error('Unknown trial purpose');
  if (purpose === 'formal-comparison' && config.calibrationControl !== undefined && config.calibrationControl !== false) {
    throw new Error('Formal comparisons must not include the calibration control process');
  }
  return purpose;
}
function workerTimeout(config, now = Date.now()) {
  if (!config.approvalBatch?.deadline) return config.timeoutMs;
  const deadline = Date.parse(config.approvalBatch.deadline);
  if (!Number.isFinite(deadline)) throw new Error('Invalid approval batch deadline');
  const remaining = Math.min(config.timeoutMs, deadline - now);
  if (remaining < 1000) throw new Error('Approved trial batch deadline has expired');
  return remaining;
}
function validateToolBoundary(config) {
  if (!config.toolBoundaryAudit) throw new Error('A passing tool-boundary probe is required before a real worker may start');
  const proof = JSON.parse(fs.readFileSync(config.toolBoundaryAudit, 'utf8'));
  if (proof.status !== 'pass' || proof.passed !== true || proof.codexSha256 !== config.codexSha256
      || proof.model !== config.model || proof.effort !== config.effort
      || proof.commonConfigSha256 !== commonConfigSha256({ model: config.model, effort: config.effort, modelCatalog: config.modelCatalog })
      || !Array.isArray(proof.unsafeTools) || proof.unsafeTools.length || !proof.proofFiles?.length) {
    throw new Error('Tool-boundary probe is blocked or does not match this pinned worker configuration');
  }
  for (const file of proof.proofFiles) if (sha256(fs.readFileSync(file.path)) !== file.sha256) throw new Error('Tool-boundary probe evidence changed');
  if (config.modelCatalog && (proof.modelCatalog?.unchanged !== true || proof.modelCatalog.sha256 !== sha256(fs.readFileSync(config.modelCatalog)))) {
    throw new Error('Tool-boundary model catalog evidence does not match this trial');
  }
  const requestFile = proof.proofFiles.find((file) => path.basename(file.path) === 'provider-requests.jsonl');
  const configurationFile = proof.proofFiles.find((file) => path.basename(file.path) === 'configuration.json');
  if (proof.kind !== 'local-fake-provider-tool-exposure' || !requestFile || !configurationFile) throw new Error('Tool-boundary proof requires captured provider requests and configuration');
  if (purposeOf(config) === 'formal-comparison' && !proof.adversarial) {
    throw new Error('Formal comparisons require the adversarial native tool-boundary proof');
  }
  const configuration = JSON.parse(fs.readFileSync(configurationFile.path, 'utf8'));
  const allRequests = fs.readFileSync(requestFile.path, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  const requests = allRequests.filter((r) => r.url?.endsWith('/responses'));
  let verifiedResourceGate = false;
  if (proof.adversarial) {
    const gateScript = path.join(ROOT, 'scripts/history-eval-mcp.js');
    const dependencies = ['history-eval-mcp.js', 'history-eval-transport.js', 'history-eval-scope.js', 'history-eval-supervisor.js', 'history-eval-common.js', 'record-history-eval.js'];
    if (proof.adversarial.gateScript?.path !== gateScript || proof.adversarial.gateScript.sha256 !== sha256(fs.readFileSync(gateScript))
        || dependencies.some((name) => { const file = path.join(ROOT, 'scripts', name); return !proof.gateDependencies?.some((d) => d.path === file && d.sha256 === sha256(fs.readFileSync(file))); })) {
      throw new Error('Adversarial proof does not cover this actual gate and its dependencies');
    }
    if (proof.transport?.kind !== 'parent-owned-loopback' || proof.transport.closed !== true) {
      throw new Error('Adversarial proof does not cover the parent-owned gate transport and cleanup');
    }
    const checked = assessAdversarial(allRequests, {
      outsideCanary: 'SYNTHETIC_OUTSIDE_SOURCE_MUST_NOT_BE_DELIVERED', controlledCanary: 'SYNTHETIC_CONTROLLED_GATE_CANARY',
      markerExists: fs.existsSync(path.join(path.dirname(requestFile.path), 'unexpected-patch.txt')), processResult: proof.process,
    });
    if (proof.adversarial.passed !== true || !checked.passed) throw new Error('Adversarial resource/registry/output boundary proof is incomplete');
    verifiedResourceGate = true;
  }
  if (configuration.codexSha256 !== config.codexSha256 || configuration.model !== config.model || configuration.effort !== config.effort
      || !requests.length || requests.some((r) => r.decodeError || r.body?.model !== config.model || !checkExposure(requestTools(r.body), { verifiedResourceGate }).passed)) {
    throw new Error('Captured provider requests do not prove a controlled tool boundary');
  }
  return { path: config.toolBoundaryAudit, sha256: sha256(fs.readFileSync(config.toolBoundaryAudit)), status: proof.status };
}
function hashes(directory, predicate = () => true, { includeNodeModules = false } = {}) {
  const result = {};
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name), relative = path.relative(directory, file).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error('Frozen runtime must not contain symlinks');
      if (entry.isDirectory()) { if ((entry.name !== 'node_modules' || includeNodeModules) && entry.name !== '.git') walk(file); }
      else if (entry.isFile() && predicate(relative)) result[relative] = sha256(fs.readFileSync(file));
    }
  }
  walk(directory); return result;
}

function validateRuntimeDependencies(runtimeRoot) {
  const root = fs.realpathSync(runtimeRoot), seen = new Set();
  const contained = (file) => {
    const relative = path.relative(root, fs.realpathSync(file));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  function visit(folder) {
    if (seen.has(folder)) return;
    seen.add(folder);
    const manifest = path.join(folder, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const resolve = createRequire(manifest).resolve;
    for (const name of Object.keys(pkg.dependencies || {})) {
      const entry = resolve(name);
      if (!contained(entry)) throw new Error(`Formal runtime resolves an unfrozen ambient dependency: ${name}`);
      let directory = path.dirname(entry);
      while (contained(directory)) {
        const file = path.join(directory, 'package.json');
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) { visit(directory); break; }
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      if (!contained(directory)) throw new Error(`Formal dependency package is outside its frozen runtime: ${name}`);
    }
  }
  visit(root);
}

function validateFrozenInputs(config) {
  const formal = purposeOf(config) === 'formal-comparison';
  const runtimeFiles = formal ? hashes(config.runtimeRoot, () => true, { includeNodeModules: true })
    : hashes(config.runtimeRoot, (file) => file.startsWith('src/') || ['server.js', 'package.json', 'package-lock.json'].includes(file));
  const harnessFiles = hashes(path.join(ROOT, 'scripts'), (file) => /^(history-eval-|run-history-codex-eval|import-history-codex-usage|record-history-eval|aggregate-history-eval|probe-history-codex-tools)/u.test(file));
  const artifactHashes = Object.fromEntries(['scopeFile', 'corpusManifest', 'promptFile', ...(config.modelCatalog ? ['modelCatalog'] : [])].map((key) => [key, sha256(fs.readFileSync(config[key]))]));
  for (const [expected, actual] of [[config.expectedRuntimeFiles, runtimeFiles], [config.expectedHarnessFiles, harnessFiles], [config.expectedArtifactHashes, artifactHashes]]) {
    if (!expected || Object.keys(expected).length !== Object.keys(actual).length || Object.keys(actual).some((key) => expected[key] !== actual[key])) {
      throw new Error('Frozen input hashes changed or were not supplied; create a separately recorded candidate/run manifest');
    }
  }
  if (formal) {
    validateRuntimeDependencies(config.runtimeRoot);
    const guideFiles = hashes(config.guideRoot);
    if (!config.guides || Object.keys(config.guides).length !== Object.keys(guideFiles).length
        || Object.entries(guideFiles).some(([file, hash]) => config.guides[file] !== hash)) {
      throw new Error('Frozen formal guide files changed or were not supplied');
    }
  }
  return { runtimeFiles, harnessFiles, artifactHashes };
}

function auditToolOutput(eventsFile, gateEventsFile) {
  if (!fs.existsSync(gateEventsFile)) return { status: 'unknown', reason: 'No gate event stream' };
  const delivered = fs.readFileSync(gateEventsFile, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse).filter((e) => e.event === 'tool_response');
  let invalidEvent = false;
  const events = fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/u).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { invalidEvent = true; return []; } });
  const observed = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'mcp_tool_call').map((e) => e.item);
  const matches = delivered.map((entry, i) => ({ call: i + 1, gateResponseSha256: entry.responseSha256,
    present: Boolean(observed[i]), exactContentMatch: JSON.stringify(observed[i]?.result?.content) === JSON.stringify(entry.response.content),
    identityMatch: observed[i]?.server === 'history_eval' && observed[i]?.tool === 'history_eval'
      && JSON.stringify(observed[i]?.arguments?.args) === JSON.stringify(entry.args),
    gateHashValid: sha256(JSON.stringify(entry.response)) === entry.responseSha256 }));
  return { status: !invalidEvent && matches.length > 0 && matches.every((m) => m.exactContentMatch && m.identityMatch && m.gateHashValid) && observed.length === delivered.length ? 'matched' : 'unknown',
    gateCalls: delivered.length, eventCalls: observed.length, matches,
    limit: 'Matches the MCP result visible in Codex events, not hidden provider context packing or tokenization; the latter remains unknown.' };
}

function assessCalibrationChecks(config, result, usageAudit, actual, outputAudit, gateEvents, lifecycle) {
  const observed = gateEvents.filter((e) => e.event === 'service_observation').map((e) => e.observation);
  const has = (id, event) => lifecycle.some((e) => e.id === id && e.event === event);
  const closedCleanly = (id) => lifecycle.some((e) => e.id === id && e.event === 'closed'
    && e.captureComplete === true && !e.cleanupError && !e.spawnError && !e.captureError && !e.timedOut);
  const checks = {
    workerCompleted: result.exitCode === 0 && !result.timedOut && result.captureComplete === true,
    realUsage: usageAudit.complete === true && [usageAudit.observed?.inputTokens, usageAudit.observed?.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0),
    actualConfiguration: actual.length > 0 && actual.every((c) => c.model === config.model && c.effort === config.effort
      && c.approvalPolicy === 'never' && ['read-only', 'read_only'].includes(c.sandboxPolicy?.type || c.sandboxPolicy)),
    workerInitiatedStart: config.initialState === 'no-service' && gateEvents.some((e) => e.event === 'preflight_passed' && e.origin === 'worker'),
    scopeStages: observed.some((e) => {
      const index = e.audit?.index;
      return e.event === 'indexing_complete' && e.audit?.preflight?.verified === true && index?.verified === true
        && typeof index.sourceRoot === 'string' && index.sourceRoot.length > 0 && index.projectPathIdentity?.digest
        && typeof index.projectPathPolicyId === 'string' && index.projectPathPolicyId.length > 0
        && ((Array.isArray(index.sessionIds) && index.sessionIds.every((id) => typeof id === 'string' && id))
          || /^[a-f0-9]{64}$/u.test(index.sessionSetSha256 || ''));
    }),
    ready: observed.some((e) => e.event === 'ready') && has('service', 'ready'),
    forwardingGate: gateEvents.some((e) => e.event === 'forwarding_scope_verified') && !gateEvents.some((e) => e.event === 'trial_aborted'),
    serviceLifecycle: has('service', 'start_requested') && has('service', 'started') && has('service', 'indexing_complete') && closedCleanly('service'),
    controlLifecycle: config.calibrationControl === true && has('control', 'started') && has('control', 'ready') && closedCleanly('control'),
    cleanup: lifecycle.some((e) => e.event === 'supervisor_closed') && !lifecycle.some((e) => e.event === 'cleanup_unconfirmed'),
    outputAuditRecorded: ['matched', 'unknown'].includes(outputAudit.status) && outputAudit.gateCalls > 0,
  };
  return { complete: Object.values(checks).every(Boolean), checks,
    limit: 'This certifies the no-service calibration plumbing only. Supporting evidence and first-valid-evidence timing require the private scoring key; provider context packing remains unknown.' };
}

function assessFormalChecks(config, result, usageAudit, actual, outputAudit, gateEvents, lifecycle, evidence = {}) {
  const { scope, answer, frozenInputsUnchanged } = evidence;
  const has = (id, event) => lifecycle.some((entry) => entry.id === id && entry.event === event);
  const closedCleanly = (id) => lifecycle.some((entry) => entry.id === id && entry.event === 'closed'
    && entry.captureComplete === true && !entry.cleanupError && !entry.spawnError && !entry.captureError && !entry.timedOut);
  const scopeKnown = scope && Array.isArray(scope.files) && scope.corpusHash === config.corpusHash && /^[a-f0-9]{64}$/u.test(scope.scopeSha256 || '')
    && /^[a-f0-9]{64}$/u.test(scope.sessionSetSha256 || '') && Array.isArray(scope.sessionIds)
    && scope.sessionSetSha256 === sha256(JSON.stringify([...scope.sessionIds].sort()));
  const preflightMatches = (audit) => scopeKnown && audit?.verified === true && audit.stage === 'pre-index'
    && audit.indexingCostIncurred === false && audit.scopeSha256 === scope.scopeSha256 && audit.corpusHash === scope.corpusHash;
  const checks = {
    workerCompleted: result.exitCode === 0 && !result.timedOut && result.captureComplete === true
      && !result.spawnError && !result.captureError && !result.cleanupError,
    realUsage: usageAudit.complete === true && [usageAudit.observed?.inputTokens, usageAudit.observed?.outputTokens]
      .every((value) => Number.isSafeInteger(value) && value >= 0),
    actualConfiguration: actual.length > 0 && actual.every((entry) => entry.model === config.model && entry.effort === config.effort
      && entry.approvalPolicy === 'never' && ['read-only', 'read_only'].includes(entry.sandboxPolicy?.type || entry.sandboxPolicy)),
    frozenInputsUnchanged: frozenInputsUnchanged === true,
    answerArtifact: Boolean(answer?.bytes > 0 && /^[a-f0-9]{64}$/u.test(answer.sha256 || '')),
    gatePreflight: gateEvents.some((entry) => entry.event === 'gate_preflight_passed' && preflightMatches(entry.audit)),
    noScopeAbort: !gateEvents.some((entry) => entry.event === 'trial_aborted'),
    outputAuditMatched: outputAudit.status === 'matched' && outputAudit.gateCalls > 0
      && outputAudit.gateCalls === outputAudit.eventCalls,
    noCalibrationControl: config.calibrationControl !== true && !lifecycle.some((entry) => entry.id === 'control'),
    cleanup: lifecycle.some((entry) => entry.event === 'supervisor_closed')
      && !lifecycle.some((entry) => entry.event === 'cleanup_unconfirmed'),
  };
  if (config.condition === 'raw') {
    const deliveries = gateEvents.filter((entry) => entry.event === 'tool_response' && entry.args?.[0] === 'raw'
      && entry.response?.isError === false);
    checks.rawScope = Boolean(scopeKnown && deliveries.length && deliveries.every((delivery) => gateEvents.some((entry) =>
      entry.event === 'raw_scope_verified' && entry.call === delivery.call && entry.operation === delivery.args[1]
      && entry.corpusHash === scope.corpusHash && entry.scopeSha256 === scope.scopeSha256
      && Array.isArray(entry.files) && entry.files.length > 0 && entry.files.every((file) => scope.files.some((expected) =>
        file.relativePath === expected.relativePath && file.sha256 === expected.sha256 && file.bytes === expected.bytes)))));
    checks.rawHasNoService = !lifecycle.some((entry) => entry.id === 'service');
  } else {
    const origin = config.initialState === 'no-service' ? 'worker' : 'initial-state-preparation';
    checks.initialState = gateEvents.some((entry) => entry.event === 'preflight_passed' && entry.origin === origin
      && preflightMatches(entry.audit));
    const observed = gateEvents.filter((entry) => entry.event === 'service_observation').map((entry) => entry.observation);
    checks.scopeStages = Boolean(scopeKnown && observed.some((entry) => {
      const index = entry.audit?.index;
      return entry.event === 'indexing_complete' && preflightMatches(entry.audit?.preflight)
        && index?.verified === true && index.stage === 'post-index' && index.indexingCostIncurred === true
        && index.sourceRoot === scope.sourceRoot && index.projectPathIdentity?.digest === scope.project?.identity?.digest
        && index.projectPathPolicyId === scope.projectPathPolicyId && index.sessionSetSha256 === scope.sessionSetSha256
        && Array.isArray(index.sessionIds) && JSON.stringify([...index.sessionIds].sort()) === JSON.stringify([...scope.sessionIds].sort());
    }));
    checks.ready = observed.some((entry) => entry.event === 'ready') && has('service', 'ready');
    checks.forwardingGate = gateEvents.some((entry) => entry.event === 'forwarding_scope_verified');
    checks.serviceLifecycle = has('service', 'start_requested') && has('service', 'started')
      && has('service', 'indexing_complete') && closedCleanly('service');
  }
  return { complete: Object.values(checks).every(Boolean), checks,
    limit: 'Runtime evidence only; answer quality and human handoff remain unassessed. Unknown usage, output matching, scope or cleanup cannot pass. Provider context packing remains unknown.' };
}

function answerArtifact(directory) {
  const file = path.join(directory, 'answer.txt');
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return { path: file, bytes: bytes.toString('utf8').trim() ? bytes.length : 0, sha256: sha256(bytes) };
}

function actualConfiguration(home) {
  const found = [];
  function walk(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.jsonl')) {
        const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
        for (const line of rows) {
          let row; try { row = JSON.parse(line); } catch { continue; }
          if (row.type === 'turn_context') found.push({ model: row.payload?.model, effort: row.payload?.effort,
            approvalPolicy: row.payload?.approval_policy, sandboxPolicy: row.payload?.sandbox_policy,
            sessionFile: file, sessionSha256: sha256(fs.readFileSync(file)) });
        }
      }
    }
  }
  walk(path.join(home, 'sessions')); return found;
}

async function run(manifestFile) {
  const manifestBytes = fs.readFileSync(manifestFile), config = JSON.parse(manifestBytes);
  const formal = purposeOf(config) === 'formal-comparison';
  if (!['raw', 'current', 'candidate'].includes(config.condition)) throw new Error('Unknown comparison condition');
  if (!['no-service', 'service-ready'].includes(config.initialState)) throw new Error('Unknown initial state');
  if (!Number.isSafeInteger(config.maxRetrievalCalls) || config.maxRetrievalCalls < 1 || config.maxRetrievalCalls > 1000
      || !Number.isSafeInteger(config.maxOutputBytes) || config.maxOutputBytes < 256 || config.maxOutputBytes > 1048576
      || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 3600000) throw new Error('Invalid frozen trial budgets');
  workerTimeout(config);
  if (sha256(fs.readFileSync(config.codexExecutable)) !== config.codexSha256) throw new Error('Pinned Codex executable changed');
  const boundary = validateToolBoundary(config);
  const { runtimeFiles, harnessFiles, artifactHashes } = validateFrozenInputs(config);
  const frozenScope = formal ? JSON.parse(fs.readFileSync(config.scopeFile, 'utf8')) : null;
  const directory = privateTarget(config.directory);
  if (fs.existsSync(directory)) throw new Error('Use a new trial directory; failed trials are retained');
  fs.mkdirSync(directory, { recursive: true });
  const preparationStartedAt = new Date().toISOString(), preparationStart = performance.now();
  const home = path.join(directory, 'worker-home'), cwd = path.join(directory, 'worker-cwd');
  const descriptorFile = path.join(directory, 'gate-transport.json');
  // The gate and its owned service/control outlive the worker's process tree.
  // Closing the worker cannot kill the process that records their exit status.
  let transport, prompt;
  try {
    fs.mkdirSync(home); fs.mkdirSync(cwd);
    // Credentials are copied only to the private per-trial home; never to the
    // frozen source, logs, manifests or command arguments.
    fs.copyFileSync(config.authFile, path.join(home, 'auth.json'), fs.constants.COPYFILE_EXCL);
    prompt = fs.readFileSync(config.promptFile, 'utf8');
    const gateConfig = { ...config, directory: path.join(directory, 'gate') };
    delete gateConfig.authFile;
    const gateFile = path.join(directory, 'gate-config.json'); writeNew(gateFile, gateConfig);
    transport = await startGateTransport({ config: gateConfig, descriptorFile });
  }
  catch (error) {
    if (!formal) throw error;
    const failure = { trial: config.trial, condition: config.condition, purpose: 'formal-comparison',
      formalComparison: true, formalComparisonComplete: false, phase: 'preparation', workerStarted: false,
      preparationStartedAt, endedAt: new Date().toISOString(), preparationElapsedMs: performance.now() - preparationStart,
      runtimeChecksComplete: false, evidenceQualityAssessed: false, realUsageExported: false, modelUsage: null,
      error: { code: error.code || 'PREPARATION_FAILED', message: error.message } };
    try { writeNew(path.join(directory, 'result.json'), failure); }
    catch (recordingError) { error.recordingError = recordingError; throw error; }
    return { directory, ...failure };
  }
  let transportCleanupError = null;
  const closeTransport = async () => {
    try { await transport.close(); }
    catch (error) { transportCleanupError ||= { code: error.code || 'TRANSPORT_CLEANUP_FAILED', message: error.message }; }
  };
  try {
    const args = buildCodexArgs({ model: config.model, effort: config.effort, nodePath: process.execPath, modelCatalog: config.modelCatalog,
      mcpScript: path.join(__dirname, 'history-eval-transport.js'), mcpConfig: descriptorFile, cwd,
      answerPath: path.join(directory, 'answer.txt') });
    const startedAt = new Date().toISOString();
    const frozen = { ...config, authFile: undefined, authProvision: 'existing ChatGPT auth copied to independent worker home; secret omitted',
      startedAt, manifestSha256: sha256(manifestBytes), runtimeFiles, harnessFiles, artifactHashes,
      node: process.version, platform: process.platform, command: config.codexExecutable, args,
      workerHome: home, workerCwd: cwd, promptSha256: sha256(prompt), promptBytes: Buffer.byteLength(prompt),
      toolBoundary: boundary, gateTransport: transport.transport, formalComparison: formal, subagents: 'disabled',
      ...(formal ? { preparationStartedAt, preparationElapsedMs: performance.now() - preparationStart } : {}) };
    writeNew(path.join(directory, 'frozen-run.json'), frozen);
    const timeoutMs = workerTimeout(config);
    const supervisor = createSupervisor({ directory: path.join(directory, 'worker-process'), identity: { trial: config.trial, condition: config.condition } });
    const start = performance.now();
    const worker = supervisor.start({ id: 'codex', command: config.codexExecutable, args,
      cwd, env: { ...process.env, CODEX_HOME: home }, input: prompt, timeoutMs });
    let scopeAborted = false;
    const monitor = setInterval(() => {
      if (fs.existsSync(path.join(directory, 'gate/aborted.json'))) { scopeAborted = true; void supervisor.stop('codex', 'scope_failure'); }
    }, 100);
    let result;
    try { result = await worker.completed; } finally {
      clearInterval(monitor);
      try { await supervisor.close('trial_finished'); } finally { await closeTransport(); }
    }
    const usage = importUsage(worker.stdoutPath, { condition: config.condition, trial: config.trial, corpusHash: config.corpusHash, model: config.model },
      { ...result, cancelled: scopeAborted, subagents: 'disabled' });
    writeNew(path.join(directory, 'usage.json'), usage.usage);
    writeNew(path.join(directory, 'usage-audit.json'), usage.audit);
    const actual = actualConfiguration(home);
    const outputAudit = auditToolOutput(worker.stdoutPath, path.join(directory, 'gate/gate-events.jsonl'));
    const readEvents = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
    const gateEvents = readEvents(path.join(directory, 'gate/gate-events.jsonl'));
    const lifecycle = readEvents(path.join(directory, 'gate/processes/lifecycle.jsonl'));
    let frozenInputsUnchanged = null, frozenInputError = null;
    if (formal) {
      try { validateFrozenInputs(config); frozenInputsUnchanged = true; }
      catch (error) { frozenInputsUnchanged = false; frozenInputError = error.message; }
    }
    const answer = formal ? answerArtifact(directory) : null;
    const assessment = formal
      ? assessFormalChecks(config, result, usage.audit, actual, outputAudit, gateEvents, lifecycle,
        { scope: frozenScope, answer, frozenInputsUnchanged })
      : assessCalibrationChecks(config, result, usage.audit, actual, outputAudit, gateEvents, lifecycle);
    assessment.checks.transportCleanup = !transportCleanupError;
    assessment.complete &&= !transportCleanupError;
    const complete = !scopeAborted && assessment.complete;
    const summary = { trial: config.trial, condition: config.condition, purpose: formal ? 'formal-comparison' : 'calibration', startedAt,
      endedAt: new Date().toISOString(), elapsedMs: performance.now() - start, result, scopeAborted, transportCleanupError,
      realUsageExported: assessment.checks.realUsage, actualConfiguration: actual, outputAudit,
      ...(formal ? { runtime: assessment, runtimeChecksComplete: complete, answerArtifact: answer,
        preparationStartedAt, preparationElapsedMs: frozen.preparationElapsedMs, frozenInputsUnchanged, frozenInputError,
        formalComparisonComplete: false } : { calibration: assessment, calibrationChecksComplete: complete }),
      evidenceQualityAssessed: false, formalComparison: formal };
    writeNew(path.join(directory, 'result.json'), summary);
    const log = path.join(directory, 'gate/calls.jsonl');
    if (fs.existsSync(log)) {
      const aggregate = spawnSync(process.execPath, [path.join(ROOT, 'scripts/aggregate-history-eval.js'), '--usage', path.join(directory, 'usage.json'),
        '--report', path.join(directory, 'aggregate.json'), log], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
      fs.writeFileSync(path.join(directory, 'aggregate-command.json'), JSON.stringify({ exitCode: aggregate.status, stderr: aggregate.stderr }));
      if (aggregate.status !== 0) throw new Error('Aggregation failed; inspect retained local aggregate-command.json');
    }
    return { directory, trial: config.trial, ...(formal ? { purpose: 'formal-comparison', runtimeChecksComplete: complete }
      : { calibrationChecksComplete: complete }), realUsageExported: assessment.checks.realUsage,
      exitCode: result.exitCode, outputAuditStatus: outputAudit.status, elapsedMs: summary.elapsedMs };
  } catch (error) {
    if (formal) {
      await closeTransport();
      writeNew(path.join(directory, 'runner-failure.json'), { purpose: 'formal-comparison', trial: config.trial,
        condition: config.condition, preparationStartedAt, endedAt: new Date().toISOString(),
        elapsedSincePreparationMs: performance.now() - preparationStart, runtimeChecksComplete: false,
        evidenceQualityAssessed: false, transportCleanupError, error: { code: error.code || 'RUNNER_FAILED', message: error.message },
        retainedArtifacts: fs.readdirSync(directory).filter((name) => name !== 'worker-home') });
    }
    throw error;
  } finally { await closeTransport(); }
}

if (require.main === module) run(process.argv[2]).then((result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`); if (!(result.runtimeChecksComplete ?? result.calibrationChecksComplete)) process.exitCode = 1;
}, (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { run, hashes, auditToolOutput, actualConfiguration, validateToolBoundary, validateFrozenInputs,
  assessCalibrationChecks, assessFormalChecks, answerArtifact, purposeOf, workerTimeout, validateRuntimeDependencies };
