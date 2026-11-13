'use strict';

// Historical project interpretation is deliberately separate from host file
// resolution. Artifact scopes below use only the reader's physical locators.
const path = require('node:path');
const { createHash } = require('node:crypto');
const { interpretProjectPath, projectPathContains, PROJECT_PATH_VERSION } = require('./shared/project-path');

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_PROJECT_PATH_POLICY';
  return error;
}

function physicalContains(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function normalizeProjectPathRules(rules = [], sourceHome) {
  if (!Array.isArray(rules) || rules.length > 128) throw invalid('At most 128 project path rules are allowed.');
  const home = path.resolve(sourceHome);
  const unique = new Map();
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)
        || Object.keys(rule).sort().join(',') !== 'interpretation,path,scope'
        || !['artifact', 'container'].includes(rule.scope)
        || !['unc', 'posix'].includes(rule.interpretation)
        || typeof rule.path !== 'string' || !rule.path || rule.path.includes('\0')) {
      throw invalid('A project path rule requires scope, physical path and unc/posix interpretation.');
    }
    const target = path.resolve(home, rule.path);
    if (!physicalContains(target, home)) throw invalid('Project path rule must stay within its configured source root.');
    const normalized = { scope: rule.scope, path: target, interpretation: rule.interpretation };
    unique.set(JSON.stringify(normalized), normalized);
  }
  const result = [...unique.values()].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i]; const b = result[j];
      const overlaps = path.relative(a.path, b.path) === ''
        || (a.scope === 'container' && physicalContains(b.path, a.path))
        || (b.scope === 'container' && physicalContains(a.path, b.path));
      if (overlaps && a.interpretation !== b.interpretation) throw invalid('Overlapping project path rules disagree; resolve the conflict explicitly.');
    }
  }
  return result;
}

function createProjectPathContext(options) {
  if (!options || typeof options.sourceKind !== 'string' || !options.sourceKind
      || options.sourceKind.includes('\0') || typeof options.sourceHome !== 'string'
      || !options.sourceHome || options.sourceHome.includes('\0')) throw invalid('A path context requires an explicit source kind and local source root.');
  const sourceKind = options.sourceKind;
  const sourceHome = path.resolve(options.sourceHome);
  const configured = options.sourceConfigs?.[sourceKind];
  let rules = Object.hasOwn(options, 'projectPathRules') ? options.projectPathRules
    : (configured && Object.hasOwn(configured, 'projectPathRules') ? configured.projectPathRules : []);
  if (options.projectPathContext !== undefined) {
    let captured;
    try { captured = JSON.parse(options.projectPathContext); } catch { throw invalid('Invalid captured project path context.'); }
    if (!captured || captured.version !== PROJECT_PATH_VERSION || captured.sourceKind !== sourceKind || captured.sourceHome !== sourceHome) {
      throw invalid('Captured project path context belongs to another source or version.');
    }
    rules = captured.rules;
  }
  const normalized = normalizeProjectPathRules(rules, sourceHome);
  const serialized = JSON.stringify({ version: PROJECT_PATH_VERSION, sourceKind, sourceHome, rules: normalized });
  if (options.projectPathContext !== undefined && options.projectPathContext !== serialized) throw invalid('Captured project path context is not canonical.');
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) throw invalid('Project path context is too large.');
  const digest = createHash('sha256').update(serialized).digest('hex');
  return Object.freeze({ sourceKind, sourceHome, serialized, digest,
    rules: Object.freeze(normalized.map((rule) => Object.freeze(rule))) });
}

function interpretWithNamespaceCompatibility(raw, options = {}) {
  const descriptor = interpretProjectPath(raw, options);
  if (descriptor.status === 'unsupported' && typeof raw === 'string' && /^\\\\[?.]\\/.test(raw)
      && options.semantics !== 'posix' && !(Array.isArray(options.semantics) && options.semantics.includes('posix'))) {
    return interpretProjectPath(raw, { ...options, legacyNamespace: true });
  }
  return descriptor;
}

function projectPathFor(raw, context, artifact, onDiagnostic, semantics) {
  const physical = artifact && path.resolve(artifact);
  const rule = physical && context.rules.find((entry) => entry.scope === 'artifact'
    ? path.relative(physical, entry.path) === '' : physicalContains(physical, entry.path));
  const descriptor = interpretWithNamespaceCompatibility(raw, { doubleSlash: rule?.interpretation || 'legacy', semantics });
  if (descriptor.namespaceCompatibility) onDiagnostic?.({ code: 'PROJECT_PATH_NAMESPACE_COMPATIBILITY', path: artifact,
    message: 'Native Windows namespace project spelling retains an independent legacy identity; it does not alias an ordinary path.' });
  else if (descriptor.legacyAssumption) onDiagnostic?.({ code: 'PROJECT_PATH_LEGACY_ASSUMPTION', path: artifact,
    message: 'Unknown double-leading slash cwd uses legacy POSIX compatibility. Choose an explicit artifact/container interpretation to change it.' });
  else if (descriptor.status !== 'valid') onDiagnostic?.({ code: descriptor.status === 'conflict' ? 'PROJECT_PATH_CONFLICT' : 'PROJECT_PATH_UNSUPPORTED',
    path: artifact, message: descriptor.reason || 'Recorded cwd has no supported project identity.' });
  return descriptor;
}

function projectSelection(repoRoot, base, semantics) {
  if (semantics !== undefined && !['windows', 'posix'].includes(semantics)) throw invalid('Project input semantics must be windows or posix.');
  let selected = interpretWithNamespaceCompatibility(repoRoot, { semantics });
  if (selected.status !== 'valid' && typeof repoRoot === 'string' && repoRoot && !repoRoot.includes('\0')
      && !/^(?:[A-Za-z]:|[\\/])/.test(repoRoot)) {
    // Capture a local base only when completing a relative input. Complete
    // captured project paths must remain usable even after cwd disappears.
    const localBase = base === undefined ? process.cwd() : base;
    if (typeof localBase !== 'string' || !path.isAbsolute(localBase)) throw invalid('A local project input needs an absolute base.');
    selected = interpretProjectPath(path.resolve(localBase, repoRoot), { semantics });
  }
  if (selected.status !== 'valid') throw invalid('Project selection must be a supported complete path or a local relative input.');
  return semantics === undefined || selected.namespaceCompatibility ? selected : Object.freeze({ ...selected, evidence: 'user' });
}

function projectContextIndexFields(context, repoRoot) {
  return { projectPathContext: context.serialized, projectPathPolicyId: context.digest,
    projectPath: projectSelection(repoRoot) };
}

const capturedContexts = new Map();
function projectPathMatches(raw, repoRoot, artifact, serialized) {
  let context = null;
  if (serialized) {
    context = capturedContexts.get(serialized);
    if (!context) {
      let captured;
      try { captured = JSON.parse(serialized); } catch { throw invalid('Invalid captured project path context.'); }
      context = createProjectPathContext({ ...captured, projectPathContext: serialized });
      if (capturedContexts.size >= 64) capturedContexts.delete(capturedContexts.keys().next().value);
      capturedContexts.set(serialized, context);
    }
  }
  return projectPathContains(context ? projectPathFor(raw, context, artifact) : interpretWithNamespaceCompatibility(raw), projectSelection(repoRoot));
}

module.exports = { createProjectPathContext, normalizeProjectPathRules, projectPathFor, projectSelection,
  projectContextIndexFields, projectPathMatches, physicalContains };
