'use strict';

// Evaluation-only admission and forwarding checks. This is not a filesystem
// sandbox: the caller must make this gate the worker's only evidence output path.
const fs = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { nativeScopePath } = require('../src/project-path-context');
const { ROOT, sha256, inside } = require('./history-eval-common');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
function runtimeModules(runtimeRoot = ROOT) {
  const root = path.resolve(runtimeRoot);
  return { root, ...require(path.join(root, 'src/history-cli.js')), ...require(path.join(root, 'src/cli.js')),
    ...require(path.join(root, 'src/project-path-context.js')), ...require(path.join(root, 'src/shared/project-path.js')),
    adapters: require(path.join(root, 'src/source-adapters.js')) };
}
function mismatch(stage, reason) {
  throw Object.assign(new Error(`Frozen evidence scope mismatch: ${reason}`), {
    code: 'EVAL_SCOPE_MISMATCH', stage, reason, indexingCostIncurred: stage === 'post-index',
  });
}
function samePath(left, right) {
  return typeof left === 'string' && typeof right === 'string' && nativeScopePath(left) === nativeScopePath(right);
}
function normalizedSessionSet(ids, stage) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id || id.includes('\0'))
      || new Set(ids).size !== ids.length) mismatch(stage, 'Session identities must be a complete, duplicate-free string array');
  const sessionIds = [...ids].sort();
  return { sessionIds, sessionSetSha256: sha256(JSON.stringify(sessionIds)) };
}

async function rejectSymlink(file, stage) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const component of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try { stat = await fs.lstat(current); } catch { mismatch(stage, 'required source or configuration path is missing'); }
    if (stat.isSymbolicLink()) mismatch(stage, 'symbolic links and junctions are not frozen evidence');
  }
}

// Mirrors createHistoryService's actual precedence and uses the same parser,
// path-config loader, historical path interpretation and policy normalizer.
async function resolveServeScope(serveArgs, { runtimeRoot = ROOT } = {}) {
  const { parseHistoryArgs, loadPathConfig, adapters, createProjectPathContext, projectSelection,
    PROJECT_PATH_VERSION, root } = runtimeModules(runtimeRoot);
  const options = parseHistoryArgs(serveArgs);
  if (options.operation !== 'serve' || options.help || options.source !== 'codex') {
    mismatch('pre-index', 'the Step 0 frozen corpus requires an explicit Codex serve command');
  }
  if (options.pathConfig && options.codexHome) mismatch('pre-index', 'use one explicit source configuration, not a path config plus a home flag');
  if (!options.pathConfig && !options.codexHome) mismatch('pre-index', 'an explicit frozen source home or path config is required');
  if (options.pathConfig) await rejectSymlink(options.pathConfig, 'pre-index');
  const sourceConfigs = options.pathConfig ? await loadPathConfig(options.pathConfig) : options.sourceConfigs;
  const adapter = adapters.requireSourceAdapter(options.source);
  const configured = sourceConfigs?.[adapter.kind];
  if (configured !== undefined && (!configured || typeof configured.home !== 'string' || !configured.home.trim())) {
    mismatch('pre-index', 'configured source home is invalid');
  }
  if (options.pathConfig && !configured) mismatch('pre-index', 'the frozen path config must explicitly configure Codex');
  const sourceHome = path.resolve(configured?.home || options[adapter.homeOption] || adapter.defaultHome());
  const context = createProjectPathContext({ sourceKind: adapter.kind, sourceHome, sourceConfigs });
  const project = projectSelection(options.repo, process.cwd(), options.projectPathSemantics);
  const pathConfig = options.pathConfig ? {
    path: path.resolve(options.pathConfig), sha256: sha256(await fs.readFile(options.pathConfig)),
  } : null;
  return { options, runtimeRoot: root, sourceConfigs, sourceHome, sourceRoot: path.join(sourceHome, 'sessions'),
    sourceHomeIdentity: context.sourceHomeIdentity, source: adapter.kind,
    project: { path: project.path, key: project.key, semantics: options.projectPathSemantics ?? null,
      identity: { version: PROJECT_PATH_VERSION, digest: digest(project.key) } },
    projectPathContext: context.serialized, projectPathPolicyId: context.digest, pathConfig };
}

function validateScope(scope, stage) {
  if (!scope || scope.schemaVersion !== 1 || scope.kind !== 'history-eval-scope' || scope.source !== 'codex'
      || typeof scope.sourceHome !== 'string' || !path.isAbsolute(scope.sourceHome)
      || !samePath(scope.sourceRoot, path.join(scope.sourceHome, 'sessions'))
      || typeof scope.runtimeRoot !== 'string' || !path.isAbsolute(scope.runtimeRoot)
      || typeof scope.project?.key !== 'string' || typeof scope.projectPathContext !== 'string'
      || typeof scope.projectPathPolicyId !== 'string' || !Array.isArray(scope.files) || !scope.files.length) {
    mismatch(stage, 'invalid frozen scope manifest');
  }
  const { scopeSha256, ...body } = scope;
  if (scopeSha256 !== sha256(JSON.stringify(body))) mismatch(stage, 'scope manifest digest changed');
  const sessions = normalizedSessionSet(scope.sessionIds, stage);
  if (sessions.sessionSetSha256 !== scope.sessionSetSha256) mismatch(stage, 'Session manifest digest changed');
  const names = new Set();
  for (const file of scope.files) {
    if (typeof file.relativePath !== 'string' || !/^sessions\/.+\.jsonl$/u.test(file.relativePath)
        || file.relativePath.includes('\\') || file.relativePath.includes('\0')
        || file.relativePath.split('/').some((part) => !part || part === '.' || part === '..')
        || !/^[a-f0-9]{64}$/u.test(file.sha256 || '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      mismatch(stage, 'invalid frozen source file entry');
    }
    const key = nativeScopePath(path.join(scope.sourceHome, file.relativePath));
    if (names.has(key)) mismatch(stage, 'duplicate frozen source file');
    names.add(key);
  }
}

async function verifyCorpus(scope, stage = 'pre-index') {
  validateScope(scope, stage);
  await rejectSymlink(scope.sourceHome, stage);
  if (scope.corpusManifestPath) {
    await rejectSymlink(scope.corpusManifestPath, stage);
    if (sha256(await fs.readFile(scope.corpusManifestPath)) !== scope.corpusManifestSha256) mismatch(stage, 'corpus manifest changed');
  }
  const actual = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) mismatch(stage, 'symbolic links and junctions are not frozen evidence');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) actual.push(file);
      else mismatch(stage, 'unsupported entry in frozen source home');
    }
  }
  await visit(scope.sourceHome);
  const expected = new Map(scope.files.map((file) => [nativeScopePath(path.join(scope.sourceHome, file.relativePath)), file]));
  if (actual.length !== expected.size || actual.some((file) => !expected.has(nativeScopePath(file)))) {
    mismatch(stage, 'frozen source file set changed');
  }
  for (const file of actual) {
    const bytes = await fs.readFile(file);
    const entry = expected.get(nativeScopePath(file));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) mismatch(stage, 'frozen source bytes changed');
  }
  return { corpusHash: scope.corpusHash, fileCount: expected.size };
}

// expectedSessionIds is coordinator-frozen evidence, never the outcome of the
// trial being checked. An explicit empty set is valid for a missing-source task.
async function freezeScope({ corpusManifest, serveArgs, expectedSessionIds, runtimeRoot = ROOT }) {
  const corpusManifestPath = typeof corpusManifest === 'string' ? path.resolve(corpusManifest) : null;
  const bytes = corpusManifestPath ? await fs.readFile(corpusManifestPath) : Buffer.from(JSON.stringify(corpusManifest));
  const corpus = JSON.parse(bytes.toString('utf8'));
  if (corpus?.schemaVersion !== 1 || corpus.kind !== 'frozen-codex-corpus' || corpus.source !== 'codex'
      || !/^[a-f0-9]{64}$/u.test(corpus.corpusHash || '') || !Array.isArray(corpus.files)) {
    mismatch('pre-index', 'expected a frozen Codex corpus manifest');
  }
  const resolved = await resolveServeScope(serveArgs, { runtimeRoot });
  const { projectSelection } = runtimeModules(resolved.runtimeRoot);
  if (!samePath(resolved.sourceHome, corpus.codexHome)) mismatch('pre-index', 'configured home differs from the frozen corpus home');
  if (corpus.repo && projectSelection(corpus.repo).key !== resolved.project.key) mismatch('pre-index', 'configured project differs from the frozen corpus project');
  const files = corpus.files.map(({ relativePath, sha256: fileHash, bytes: size }) => ({ relativePath, sha256: fileHash, bytes: size }))
    .sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  if (sha256(JSON.stringify(files)) !== corpus.corpusHash) mismatch('pre-index', 'corpus file manifest digest differs');
  const scope = { schemaVersion: 1, kind: 'history-eval-scope', source: resolved.source, runtimeRoot: resolved.runtimeRoot,
    sourceHome: resolved.sourceHome, sourceHomeIdentity: resolved.sourceHomeIdentity, sourceRoot: resolved.sourceRoot,
    project: resolved.project, projectPathContext: resolved.projectPathContext, projectPathPolicyId: resolved.projectPathPolicyId,
    pathConfig: resolved.pathConfig, corpusManifestPath, corpusManifestSha256: sha256(bytes), corpusHash: corpus.corpusHash,
    files, ...normalizedSessionSet(expectedSessionIds, 'pre-index') };
  scope.scopeSha256 = sha256(JSON.stringify(scope));
  await verifyCorpus(scope);
  return scope;
}

async function verifyPreflight(scope, serveArgs) {
  validateScope(scope, 'pre-index');
  const resolved = await resolveServeScope(serveArgs, { runtimeRoot: scope.runtimeRoot });
  if (resolved.source !== scope.source || resolved.sourceHomeIdentity !== scope.sourceHomeIdentity
      || resolved.project.key !== scope.project.key || resolved.project.semantics !== scope.project.semantics
      || resolved.projectPathContext !== scope.projectPathContext || resolved.projectPathPolicyId !== scope.projectPathPolicyId
      || JSON.stringify(resolved.pathConfig) !== JSON.stringify(scope.pathConfig)) {
    mismatch('pre-index', 'resolved source home, project interpretation or path policy differs');
  }
  const corpus = await verifyCorpus(scope);
  return { options: resolved.options, audit: { stage: 'pre-index', verified: true, indexingCostIncurred: false,
    scopeSha256: scope.scopeSha256, ...corpus } };
}

function verifyIndex(scope, index) {
  validateScope(scope, 'post-index');
  const { projectSelection } = runtimeModules(scope.runtimeRoot);
  if (index?.sourceKind !== scope.source || !samePath(index.sourceRoot, scope.sourceRoot)
      || !samePath(index.sourceHome, scope.sourceHome) || projectSelection(index.repoRoot).key !== scope.project.key
      || index.projectPathContext !== scope.projectPathContext || index.projectPathPolicyId !== scope.projectPathPolicyId) {
    mismatch('post-index', 'actual index source root, project or path policy differs');
  }
  const actual = normalizedSessionSet(index.sessions?.map((session) => session.id), 'post-index');
  if (actual.sessionSetSha256 !== scope.sessionSetSha256 || JSON.stringify(actual.sessionIds) !== JSON.stringify(scope.sessionIds)) {
    mismatch('post-index', 'actual complete Session set differs');
  }
  return { stage: 'post-index', verified: true, indexingCostIncurred: true, sourceRoot: index.sourceRoot,
    projectPathIdentity: scope.project.identity, projectPathPolicyId: scope.projectPathPolicyId,
    sessionCount: actual.sessionIds.length, ...actual };
}

function verifyCoverage(scope, coverage) {
  const { projectSelection } = runtimeModules(scope.runtimeRoot);
  if (coverage?.source !== scope.source || !samePath(coverage.sourceRoot, scope.sourceRoot)
      || coverage.sourceRootAccessible !== true || coverage.indexing !== 'complete'
      || projectSelection(coverage.repo).key !== scope.project.key
      || JSON.stringify(coverage.projectPathIdentity) !== JSON.stringify(scope.project.identity)
      || coverage.projectPathPolicyId !== scope.projectPathPolicyId || coverage.sessionCount !== scope.sessionIds.length) {
    mismatch('post-index', 'actual service coverage differs from the independently checked index');
  }
}

async function verifyRawFiles(scope, requestedPaths) {
  await verifyCorpus(scope, 'raw-forward');
  if (!Array.isArray(requestedPaths) || requestedPaths.some((file) => typeof file !== 'string' || !file || file.includes('\0'))) {
    mismatch('raw-forward', 'raw file requests must be explicit paths');
  }
  const selected = [];
  for (const file of requestedPaths) {
    const absolute = path.resolve(scope.sourceHome, file);
    const entry = scope.files.find((item) => samePath(path.join(scope.sourceHome, item.relativePath), absolute));
    if (!inside(scope.sourceRoot, absolute) || !entry) mismatch('raw-forward', 'raw access is outside the frozen file set');
    await rejectSymlink(absolute, 'raw-forward');
    const content = await fs.readFile(absolute);
    if (content.length !== entry.bytes || sha256(content) !== entry.sha256) mismatch('raw-forward', 'raw evidence bytes changed');
    // Forward these checked bytes, not a later unverified reread of the path.
    selected.push({ ...entry, path: absolute, content });
  }
  return selected;
}

async function createAuditedHistoryService(scope, serveArgs) {
  const preflight = await verifyPreflight(scope, serveArgs);
  const { adapters, projectSelection } = runtimeModules(scope.runtimeRoot);
  const filename = require.resolve(path.join(scope.runtimeRoot, 'src/history-service.js'));
  const source = await fs.readFile(filename, 'utf8');
  let actualIndex = null;
  let indexAudit = null;
  // Load unmodified service source in one private CommonJS module instance.
  // Only this instance sees the adapter observer; no global cache or adapter is
  // mutated. The same actual adapter builds exactly the index the service uses.
  const instrumented = new Module(filename, module);
  instrumented.filename = filename;
  instrumented.paths = Module._nodeModulePaths(path.dirname(filename));
  const ordinaryRequire = instrumented.require.bind(instrumented);
  instrumented.require = (request) => request === './source-adapters' ? {
    ...adapters,
    requireSourceAdapter(kind) {
      const adapter = adapters.requireSourceAdapter(kind);
      return { ...adapter, async buildIndex(options) {
        if (!samePath(options.sourceHome, scope.sourceHome) || projectSelection(options.repoRoot).key !== scope.project.key
            || options.projectPathContext !== scope.projectPathContext) {
          mismatch('pre-index', 'actual build configuration changed after preflight');
        }
        await verifyPreflight(scope, serveArgs);
        const index = await adapter.buildIndex(options);
        actualIndex = index;
        indexAudit = verifyIndex(scope, index);
        await verifyCorpus(scope, 'post-index');
        return index;
      } };
    },
  } : ordinaryRequire(request);
  instrumented._compile(source, filename);
  let service;
  try {
    service = await instrumented.exports.createHistoryService(preflight.options);
    if (!actualIndex || !indexAudit) mismatch('post-index', 'the service did not expose an index to the audit observer');
    const status = await service.execute('status', { maxBytes: 1048576 });
    verifyCoverage(scope, status.coverage);
    return { service, audit: { preflight: preflight.audit, index: indexAudit, serviceSourceSha256: sha256(source) } };
  } catch (error) {
    if (service) await service.close();
    // A failed build is managed by the product's resource-build scopes. Once
    // createHistoryService owns an index its own failure path disposes it.
    throw error;
  }
}

module.exports = { freezeScope, resolveServeScope, verifyCorpus, verifyPreflight, verifyIndex,
  verifyCoverage, verifyRawFiles, createAuditedHistoryService, normalizedSessionSet };
