'use strict';

// Lexical project identity is deliberately independent of host path APIs and
// filesystem resolution. These descriptors must never grant permission to read
// a source file. Windows lowercase is a versioned logical compatibility policy,
// not a claim about the case behavior of an actual Windows/SMB filesystem.
const PROJECT_PATH_VERSION = 1;
const POSIX_COMPARISON = 'posix-case-sensitive-v1';
const WINDOWS_COMPARISON = 'windows-lowercase-v1';

function rejected(raw, status, reason, extra = {}) {
  return Object.freeze({
    version: PROJECT_PATH_VERSION,
    status,
    raw,
    path: '',
    key: '',
    namespace: '',
    root: '',
    components: Object.freeze([]),
    comparison: '',
    semantics: '',
    evidence: '',
    legacyAssumption: false,
    reason,
    ...extra,
  });
}

function normalizeComponents(parts) {
  const components = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      // A volume's root is not an ordinary component. Excess .. is clamped at
      // that root, so a UNC path cannot walk into a different share or server.
      components.pop();
    } else components.push(part);
  }
  return components;
}

function comparable(value, comparison) {
  return comparison === WINDOWS_COMPARISON ? value.toLowerCase() : value;
}

function identity(namespace, comparison, root, components) {
  return `project-path:v${PROJECT_PATH_VERSION}:${JSON.stringify([
    namespace,
    comparison,
    comparable(root, comparison),
    components.map((part) => comparable(part, comparison)),
  ])}`;
}

function accepted(raw, semantics, namespace, root, parts, evidence) {
  const components = Object.freeze(normalizeComponents(parts));
  const comparison = semantics === 'windows' ? WINDOWS_COMPARISON : POSIX_COMPARISON;
  const separator = semantics === 'windows' ? '\\' : '/';
  return Object.freeze({
    version: PROJECT_PATH_VERSION,
    status: 'valid',
    raw,
    path: root + components.join(separator),
    key: identity(namespace, comparison, root, components),
    namespace,
    root,
    components,
    comparison,
    semantics,
    evidence,
    legacyAssumption: evidence === 'legacy',
    reason: '',
  });
}

function interpretLegacyNamespace(raw) {
  // This opt-in branch preserves existing reader compatibility. It does not
  // strip a namespace prefix or add equivalence with an ordinary DOS/UNC path.
  const native = raw.match(/^\\\\([?.])\\([\s\S]*)$/);
  if (!native) return null;
  const namespace = native[1] === '?' ? 'windows-extended' : 'windows-device';
  const prefix = '\\\\' + native[1] + '\\';
  const tail = native[2];
  const drive = tail.match(/^([A-Za-z]):\\([\s\S]*)$/);
  let root;
  let rest;
  if (drive) {
    root = prefix + drive[1] + ':\\';
    rest = drive[2];
  } else if (/^UNC(?:\\|$)/i.test(tail)) {
    const unc = tail.match(/^UNC\\([^\\/]+)\\([^\\/]+)(?:\\([\s\S]*))?$/i);
    const invalidRoot = (value) => value === '.' || value === '..' || /[<>:"|?*\u0000-\u001f]/.test(value);
    if (!unc || invalidRoot(unc[1]) || invalidRoot(unc[2])) {
      return rejected(raw, 'invalid', 'incomplete-or-invalid-namespace-unc-root', { namespace, semantics: 'windows' });
    }
    root = prefix + tail.slice(0, 3) + '\\' + unc[1] + '\\' + unc[2] + '\\';
    rest = unc[3] || '';
  } else {
    const volume = tail.match(/^([^\\/]+)(?:\\([\s\S]*))?$/);
    if (!volume || volume[1] === '.' || volume[1] === '..'
        || /[<>:"|?*\u0000-\u001f]/.test(volume[1])) {
      return rejected(raw, 'invalid', 'incomplete-or-invalid-namespace-root', { namespace, semantics: 'windows' });
    }
    // The existing reader's generic namespaced volume/device root remains
    // opaque. This is no promise of physical resolution for that namespace.
    root = prefix + volume[1] + '\\';
    rest = volume[2] || '';
  }
  return Object.freeze({
    ...accepted(raw, 'windows', namespace, root, rest.split(/[\\/]/), 'legacy'),
    namespaceCompatibility: true,
    legacyAssumption: false,
  });
}

function interpretWindowsPath(raw, evidence, legacyNamespace = false) {
  // Detect namespaces before parsing a server/share. Do not turn a device or
  // extended path into ordinary UNC by removing its prefix.
  const special = raw.match(/^[\\/]{2}([?.])[\\/]/);
  if (special) {
    if (legacyNamespace) {
      const compatible = interpretLegacyNamespace(raw);
      if (compatible) return compatible;
    }
    return rejected(raw, 'unsupported', 'special-namespace', {
      namespace: special[1] === '?' ? 'windows-extended' : 'windows-device',
      semantics: 'windows',
      evidence,
    });
  }
  const drive = raw.match(/^([A-Za-z]):[\\/]/);
  if (drive) {
    return accepted(raw, 'windows', 'windows-drive', `${drive[1]}:\\`, raw.slice(3).split(/[\\/]/), evidence);
  }
  if (/^[\\/]{2}/.test(raw)) {
    const unc = raw.match(/^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)(?:[\\/]([\s\S]*))?$/);
    if (!unc) return rejected(raw, 'invalid', 'incomplete-unc', { semantics: 'windows', evidence });
    const [, server, share, tail = ''] = unc;
    const invalidRoot = (value) => value === '.' || value === '..' || /[<>:"|?*\u0000-\u001f]/.test(value);
    if (invalidRoot(server) || invalidRoot(share)) {
      return rejected(raw, 'invalid', 'invalid-unc-root', { semantics: 'windows', evidence });
    }
    return accepted(raw, 'windows', 'windows-unc', `\\\\${server}\\${share}\\`, tail.split(/[\\/]/), evidence);
  }
  return rejected(raw, 'invalid', 'windows-path-not-fully-qualified', { semantics: 'windows', evidence });
}

/**
 * Interpret one recorded path once, before comparing it with another path.
 * `semantics` is reserved for trustworthy source evidence; source contracts
 * supply it explicitly. `doubleSlash` is a user policy for otherwise unknown
 * exactly-two-forward-slash paths, not evidence of a producer platform.
 */
function interpretProjectPath(raw, options = {}) {
  if (typeof raw !== 'string') return rejected(raw, 'invalid', 'path-type');
  if (!raw) return rejected(raw, 'invalid', 'empty-path');
  if (raw.includes('\u0000')) return rejected(raw, 'invalid', 'nul-path');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return rejected(raw, 'invalid', 'interpretation-options');
  }
  const doubleSlash = options.doubleSlash === undefined ? 'legacy' : options.doubleSlash;
  if (!['legacy', 'unc', 'posix'].includes(doubleSlash)) return rejected(raw, 'invalid', 'double-slash-policy');
  if (options.legacyNamespace !== undefined && typeof options.legacyNamespace !== 'boolean') {
    return rejected(raw, 'invalid', 'namespace-compatibility-option');
  }
  const sourceSemantics = options.semantics === undefined ? []
    : (Array.isArray(options.semantics) ? options.semantics : [options.semantics]);
  if (sourceSemantics.some((value) => !['posix', 'windows'].includes(value))) {
    return rejected(raw, 'invalid', 'source-semantics');
  }
  const uniqueSemantics = [...new Set(sourceSemantics)];
  if (uniqueSemantics.length > 1) {
    return rejected(raw, 'conflict', 'source-semantics-conflict', { evidence: 'producer' });
  }

  let semantics = uniqueSemantics[0];
  let evidence = semantics ? 'producer' : 'syntax';
  if (!semantics) {
    if (/^\/{2}(?!\/)/.test(raw)) {
      semantics = doubleSlash === 'unc' ? 'windows' : 'posix';
      evidence = doubleSlash === 'legacy' ? 'legacy' : 'user';
    } else if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(raw)) semantics = 'windows';
    else if (raw.startsWith('/')) semantics = 'posix';
    else return rejected(raw, 'invalid', 'relative-path');
  }

  if (semantics === 'windows') return interpretWindowsPath(raw, evidence, options.legacyNamespace === true);
  if (!raw.startsWith('/')) {
    return rejected(raw, 'invalid', 'posix-path-not-absolute', { semantics, evidence });
  }
  return accepted(raw, 'posix', 'posix', '/', raw.split('/'), evidence);
}

function descriptor(value) {
  if (typeof value === 'string') return interpretProjectPath(value);
  if (!value || typeof value !== 'object' || value.status !== 'valid'
      || value.version !== PROJECT_PATH_VERSION
      || typeof value.root !== 'string' || !Array.isArray(value.components)) return null;
  const compatibilityNamespace = value.namespace === 'windows-extended' || value.namespace === 'windows-device';
  const windows = value.namespace === 'windows-drive' || value.namespace === 'windows-unc' || compatibilityNamespace;
  if (compatibilityNamespace && value.namespaceCompatibility !== true) return null;
  if (!windows && value.namespace !== 'posix') return null;
  const comparison = windows ? WINDOWS_COMPARISON : POSIX_COMPARISON;
  if (value.comparison !== comparison) return null;
  if (value.components.some((part) => typeof part !== 'string' || !part || part === '.' || part === '..'
    || part.includes('\u0000') || (windows ? /[\\/]/.test(part) : part.includes('/')))) return null;
  const root = interpretProjectPath(value.root, { semantics: windows ? 'windows' : 'posix',
    ...(compatibilityNamespace ? { legacyNamespace: true } : {}) });
  if (root.status !== 'valid' || root.namespace !== value.namespace
      || root.components.length !== 0 || root.root !== value.root) return null;
  if (identity(value.namespace, comparison, value.root, value.components) !== value.key) return null;
  return value;
}

function sameProjectPath(left, right) {
  const a = descriptor(left);
  const b = descriptor(right);
  return Boolean(a && b && a.status === 'valid' && b.status === 'valid' && a.key === b.key);
}

function projectPathContains(child, parent) {
  const a = descriptor(child);
  const b = descriptor(parent);
  if (!a || !b || a.status !== 'valid' || b.status !== 'valid'
      || a.namespace !== b.namespace || a.comparison !== b.comparison
      || comparable(a.root, a.comparison) !== comparable(b.root, b.comparison)
      || a.components.length < b.components.length) return false;
  return b.components.every((part, index) => comparable(part, b.comparison) === comparable(a.components[index], a.comparison));
}

module.exports = {
  PROJECT_PATH_VERSION,
  interpretProjectPath,
  sameProjectPath,
  projectPathContains,
};
