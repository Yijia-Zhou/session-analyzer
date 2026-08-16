'use strict';

const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const codex = require('./codex');
const claude = require('./claude');
const { buildClaudeEventDetail } = require('./claude-detail');
const {
  inspectDataProperty,
  validateCanonicalDependencySet,
  validateCanonicalIndexFields,
  validateCanonicalIndexedSessionShape,
  validateCanonicalLegacyRawOwnerIndex,
  validateCanonicalLogicalEventShape,
  validateCanonicalMaterializedSessionShape,
  validateCanonicalRawEventShape,
  validateCanonicalSessionShape,
  validateCanonicalSessionsProperty,
} = require('./canonical-contract');
const { createSessionQuery } = require('./session-query');
const {
  buildProjectQueryStore,
  validateProjectQueryStore,
} = require('./project-query-store');
const {
  sanitizeStructuredLogicalDetailDto,
  validateLogicalDetailEnvelope,
  validateStructuredLogicalDetailDto,
} = require('./shared/logical-detail-contract');
const {
  createSourceAdapterRegistry,
  defineSourceAdapter,
  SESSION_LIFECYCLE,
} = require('./source-adapter-contract');

const SOURCE_KIND = Object.freeze({
  CODEX: 'codex',
  CLAUDE_CODE: 'claude-code',
});

const claudeQuery = createSessionQuery();

function attachProjectQueryStore(index, query) {
  const projectedSessions = index.sessions.map((session) => ({
    ...session,
    ...query.projectSessionMetadata(session),
  }));
  index.sessions = projectedSessions;
  index.sessionsById = new Map(projectedSessions.map((session) => [session.id, session]));
  index.projectQueryStore = buildProjectQueryStore(projectedSessions, {
    presentationForEvent: query.projectQueryPresentation,
  });
  return index;
}

function graphFingerprint(value, identityState = {
  objectIds: new WeakMap(),
  symbolIds: new Map(),
  nextObjectId: 0,
  nextSymbolId: 0,
}) {
  const hash = createHash('sha256');
  const seen = new WeakSet();
  const objectId = (current) => {
    if (!identityState.objectIds.has(current)) {
      identityState.objectIds.set(current, identityState.nextObjectId);
      identityState.nextObjectId += 1;
    }
    return identityState.objectIds.get(current);
  };
  const symbolId = (current) => {
    if (!identityState.symbolIds.has(current)) {
      identityState.symbolIds.set(current, identityState.nextSymbolId);
      identityState.nextSymbolId += 1;
    }
    return identityState.symbolIds.get(current);
  };
  const write = (text) => {
    const valueText = String(text);
    hash.update(`${Buffer.byteLength(valueText, 'utf8')}:`);
    hash.update(valueText, 'utf8');
  };
  const writeKey = (key) => {
    if (typeof key === 'symbol') {
      write('symbol-key');
      write(symbolId(key));
      write(Symbol.keyFor(key) || '');
      write(key.description || '');
      return;
    }
    write('string-key');
    write(key);
  };
  const visit = (current) => {
    if (current === null) {
      write('null');
      return;
    }
    const type = typeof current;
    write(type);
    if (type === 'undefined') return;
    if (type === 'string') {
      write(current);
      return;
    }
    if (type === 'number') {
      write(Number.isNaN(current) ? 'NaN' : (Object.is(current, -0) ? '-0' : current));
      return;
    }
    if (type === 'bigint' || type === 'boolean') {
      write(current);
      return;
    }
    if (type === 'symbol') {
      write(symbolId(current));
      write(Symbol.keyFor(current) || '');
      write(current.description || '');
      return;
    }
    if (type === 'function') write(Function.prototype.toString.call(current));
    const referenceId = objectId(current);
    if (seen.has(current)) {
      write('reference');
      write(referenceId);
      return;
    }
    seen.add(current);
    write('object');
    write(referenceId);
    const prototype = Object.getPrototypeOf(current);
    if (prototype === null) {
      write('null-prototype');
    } else {
      write(objectId(prototype));
      const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
      write(constructorDescriptor?.value?.name || 'anonymous-prototype');
    }
    if (current instanceof Date) write(current.getTime());
    if (current instanceof RegExp) {
      write(current.source);
      write(current.flags);
      write(current.lastIndex);
    }
    if (current instanceof Map) {
      write('map');
      write(current.size);
      for (const [key, nested] of current) {
        visit(key);
        visit(nested);
      }
    } else if (current instanceof Set) {
      write('set');
      write(current.size);
      for (const nested of current) visit(nested);
    } else if (ArrayBuffer.isView(current)) {
      write('array-buffer-view');
      hash.update(Buffer.from(current.buffer, current.byteOffset, current.byteLength));
    } else if (current instanceof ArrayBuffer) {
      write('array-buffer');
      hash.update(Buffer.from(current));
    }
    const keys = Reflect.ownKeys(current);
    write(keys.length);
    for (const key of keys) {
      writeKey(key);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      write(descriptor.enumerable);
      write(descriptor.configurable);
      if (Object.hasOwn(descriptor, 'value')) {
        write('data');
        write(descriptor.writable);
        visit(descriptor.value);
      } else {
        write('accessor');
        visit(descriptor.get);
        visit(descriptor.set);
      }
    }
  };
  visit(value);
  return hash.digest('hex');
}

function captureGraphFingerprint(value) {
  const identityState = {
    objectIds: new WeakMap(),
    symbolIds: new Map(),
    nextObjectId: 0,
    nextSymbolId: 0,
  };
  return {
    digest: graphFingerprint(value, identityState),
    identityState,
  };
}

function graphFingerprintMatches(value, captured) {
  return graphFingerprint(value, captured.identityState) === captured.digest;
}

function materializationContractViolation(message, cause, retainCause = cause !== undefined) {
  const error = new Error(message);
  error.code = 'MATERIALIZATION_CONTRACT_VIOLATION';
  if (retainCause) error.cause = cause;
  return error;
}

function callbackErrorText(error) {
  try {
    if (error instanceof Error && error.message) return error.message;
    if (error === undefined) return 'undefined adapter rejection';
    return String(error);
  } catch {
    return 'unprintable adapter rejection';
  }
}

function invokeReadOnlyMaterializationValidator({
  callback,
  args,
  guardedValues,
  label,
}) {
  const fingerprints = guardedValues.map((value) => captureGraphFingerprint(value));
  let callbackRejected = false;
  let callbackError;
  let callbackResult;
  try {
    callbackResult = callback(args);
  } catch (error) {
    callbackRejected = true;
    callbackError = error;
  }
  if (!callbackRejected && callbackResult !== undefined) {
    try {
      if (callbackResult instanceof Promise) callbackResult.catch(() => {});
    } catch {
      // The return value is already a contract violation; suppressing is best-effort only.
    }
    callbackRejected = true;
    callbackError = new Error(`${label} must return undefined synchronously`);
  }
  let inputsUnchanged = false;
  try {
    inputsUnchanged = guardedValues.every((value, index) => (
      graphFingerprintMatches(value, fingerprints[index])
    ));
  } catch (error) {
    throw materializationContractViolation(
      `${label} left inputs unverifiable`,
      callbackRejected ? callbackError : error,
      true,
    );
  }
  if (!inputsUnchanged) {
    throw materializationContractViolation(
      `${label} must not mutate inputs`,
      callbackRejected ? callbackError : undefined,
      callbackRejected,
    );
  }
  if (callbackRejected) {
    throw materializationContractViolation(
      `${label} rejected: ${callbackErrorText(callbackError)}`,
      callbackError,
      true,
    );
  }
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

async function materializeResidentSession({ index, indexedSession, signal }) {
  throwIfAborted(signal);
  if (!(index?.sessionsById instanceof Map)
    || index.sessionsById.get(indexedSession?.id) !== indexedSession) {
    const error = new Error('Compatibility materialization requires exact captured Index ownership');
    error.code = 'CANONICAL_CONTRACT_VIOLATION';
    throw error;
  }
  return indexedSession;
}

// This boundary is deliberately non-extensible: only the exact repository-owned
// Codex materializer and validators receive a bounded Index view. Custom and
// future strict adapters retain the complete exception-safe graph fingerprint.
function trustedCodexStrictBoundary(adapter) {
  return adapter.sessionLifecycle === SESSION_LIFECYCLE.INDEXED_MATERIALIZED
    && adapter.materializeSession === codex.materializeCodexSession
    && adapter.validateMaterializationDescriptor === codex.validateCodexMaterializationDescriptor
    && adapter.validateLegacyRawOwnerIndex === codex.validateCodexLegacyRawOwnerIndex
    && adapter.validateMaterializedPrivateState === codex.validateCodexMaterializedPrivateState
    && adapter.materializedPrivateFields.length === codex.materializedPrivateFields.length
    && adapter.materializedPrivateFields.every((field, index) => (
      field === codex.materializedPrivateFields[index]
    ));
}

function trustedStrictBoundaryError(message) {
  const error = new Error(message);
  error.code = 'CANONICAL_CONTRACT_VIOLATION';
  return error;
}

function captureOwnDataProperty(value, field, owner) {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw trustedStrictBoundaryError(`${owner}.${field} must be an own data property`);
  }
  return descriptor.value;
}

function createTrustedCodexIndexView(index) {
  const sourceKind = captureOwnDataProperty(index, 'sourceKind', 'Codex Index');
  const repoRoot = captureOwnDataProperty(index, 'repoRoot', 'Codex Index');
  const sessionsRoot = captureOwnDataProperty(index, 'sessionsRoot', 'Codex Index');
  if (sourceKind !== SOURCE_KIND.CODEX
      || typeof repoRoot !== 'string'
      || repoRoot === ''
      || typeof sessionsRoot !== 'string'
      || sessionsRoot === '') {
    throw trustedStrictBoundaryError('Codex Index materialization roots are invalid');
  }
  return Object.freeze({ sourceKind, repoRoot, sessionsRoot });
}

function captureTrustedStrictOwnership(index, indexedSession, dependencySet, indexView) {
  const sessionsById = captureOwnDataProperty(index, 'sessionsById', 'Codex Index');
  const materializationDependencies = captureOwnDataProperty(
    index,
    'materializationDependencies',
    'Codex Index',
  );
  if (!(sessionsById instanceof Map)
      || sessionsById.get(indexedSession.id) !== indexedSession
      || !(materializationDependencies instanceof Map)
      || materializationDependencies.get(dependencySet.id) !== dependencySet) {
    throw trustedStrictBoundaryError('Codex Index does not own the selected materialization inputs');
  }
  return {
    indexView,
    sessionsById,
    materializationDependencies,
    indexedSessionFingerprint: captureGraphFingerprint(indexedSession),
    dependencySetFingerprint: captureGraphFingerprint(dependencySet),
  };
}

function trustedStrictOwnershipMatches(index, indexedSession, dependencySet, captured) {
  try {
    return captureOwnDataProperty(index, 'sourceKind', 'Codex Index') === captured.indexView.sourceKind
      && captureOwnDataProperty(index, 'repoRoot', 'Codex Index') === captured.indexView.repoRoot
      && captureOwnDataProperty(index, 'sessionsRoot', 'Codex Index') === captured.indexView.sessionsRoot
      && captureOwnDataProperty(index, 'sessionsById', 'Codex Index') === captured.sessionsById
      && captured.sessionsById.get(indexedSession.id) === indexedSession
      && captureOwnDataProperty(
        index,
        'materializationDependencies',
        'Codex Index',
      ) === captured.materializationDependencies
      && captured.materializationDependencies.get(dependencySet.id) === dependencySet
      && graphFingerprintMatches(indexedSession, captured.indexedSessionFingerprint)
      && graphFingerprintMatches(dependencySet, captured.dependencySetFingerprint);
  } catch {
    return false;
  }
}

function normalizeSourceKind(value) {
  const normalized = String(value || SOURCE_KIND.CODEX).trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claudecode' || normalized === 'claude_code') {
    return SOURCE_KIND.CLAUDE_CODE;
  }
  return normalized;
}

const codexAdapter = {
    kind: SOURCE_KIND.CODEX,
    label: 'Codex',
    homeOption: 'codexHome',
    homeLabel: 'Codex home',
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    defaultHome: () => path.join(os.homedir(), '.codex'),
    query: codex.query,
    async discoverConfiguredProjects(context) {
      return codex.discoverConfiguredProjects({ codexHome: context.sourceHome });
    },
    async discoverProjects(context) {
      return codex.discoverProjects({ codexHome: context.sourceHome });
    },
    async buildIndex(context) {
      return codex.buildSourceBackedIndex({
        ...context,
        codexHome: context.sourceHome,
      });
    },
    materializeSession: codex.materializeCodexSession,
    validateMaterializationDescriptor: codex.validateCodexMaterializationDescriptor,
    validateLegacyRawOwnerIndex: codex.validateCodexLegacyRawOwnerIndex,
    validateMaterializedPrivateState: codex.validateCodexMaterializedPrivateState,
    materializedPrivateFields: codex.materializedPrivateFields,
    async buildEventDetail(index, session, eventId, layer, options) {
      return codex.buildHydratedEventDetail(index, session, eventId, layer, options);
    },
    async readRawRecord(index, session, raw, options) {
      const value = await codex.readIndexedCodexRawRecord(index, session, raw, options);
      if (!value) return null;
      return {
        ...value,
        rawId: raw.rawId,
        sourceKind: SOURCE_KIND.CODEX,
        sourceLocator: raw.sourceLocator,
      };
    },
    async readImagePreview(index, session, eventId, previewId, options) {
      return codex.readImagePreview(index, session, eventId, previewId, options);
    },
    resolveLegacyRaw(index, file, line) {
      return codex.resolveIndexedCodexLegacyRaw(index, file, line);
    },
    async readLegacyRaw(index, match, options) {
      return codex.readIndexedCodexRawRecord(index, match.session, match.raw, options);
    },
  };

const claudeAdapter = {
    kind: SOURCE_KIND.CLAUDE_CODE,
    label: 'Claude Code',
    homeOption: 'claudeHome',
    homeLabel: 'Claude home',
    sessionLifecycle: SESSION_LIFECYCLE.RESIDENT_COMPLETE,
    defaultHome: () => path.join(os.homedir(), '.claude'),
    query: claudeQuery,
    async discoverConfiguredProjects(context) {
      return claude.discoverClaudeConfiguredProjects({
        claudeHome: context.sourceHome,
        signal: context.signal,
      });
    },
    async discoverProjects(context) {
      return claude.discoverClaudeProjects({
        claudeHome: context.sourceHome,
        signal: context.signal,
      });
    },
    async buildIndex(context) {
      const index = await claude.buildClaudeIndex({
        ...context,
        claudeHome: context.sourceHome,
      });
      return attachProjectQueryStore(index, claudeQuery);
    },
    materializeSession: materializeResidentSession,
    async buildEventDetail(index, session, eventId, layer, options) {
      return buildClaudeEventDetail(session, eventId, layer, options);
    },
    async readRawRecord(index, session, raw, options) {
      return claude.readClaudeRawRecord(index, session, raw, options);
    },
  };

const adapters = createSourceAdapterRegistry([
  codexAdapter,
  claudeAdapter,
]);

function getSourceAdapter(value) {
  return adapters.get(value) || null;
}

function requireSourceAdapter(value) {
  const sourceKind = requireExplicitSourceKind(value, 'source');
  return adapters.get(sourceKind);
}

function requireExplicitSourceKind(value, owner = 'source') {
  const rawSourceKind = typeof value === 'string' ? value : '';
  if (!rawSourceKind || rawSourceKind.trim() === '') {
    const error = new Error(`Missing source ownership on ${owner}`);
    error.code = 'MISSING_SOURCE_OWNERSHIP';
    throw error;
  }
  const adapter = adapters.get(rawSourceKind);
  if (adapter) return adapter.kind;

  // This comparison only classifies an invalid canonical value for a clear
  // contract error; it never dispatches through the normalized value.
  const normalizedSourceKind = rawSourceKind.trim().toLowerCase();
  const canonicalAdapter = adapters.get(normalizedSourceKind);
  if (canonicalAdapter) {
    const error = new Error(`Canonical ${owner}.sourceKind must be ${canonicalAdapter.kind}`);
    error.code = 'CANONICAL_CONTRACT_VIOLATION';
    throw error;
  }

  const error = new Error(`Unsupported source ownership on ${owner}: ${value}`);
  error.code = 'UNSUPPORTED_SOURCE';
  throw error;
}

function validateIndexOwnership(index, {
  allowUninspectableSessions = false,
  adapter: adapterOverride = null,
} = {}) {
  const indexKind = adapterOverride
    ? index?.sourceKind
    : requireExplicitSourceKind(index?.sourceKind, 'index');
  const adapter = adapterOverride || requireSourceAdapter(indexKind);
  if (adapter.kind !== indexKind) {
    const error = new Error(`Source ownership mismatch: index ${indexKind}, adapter ${adapter.kind}`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  const allowResidentComplete = adapter.sessionLifecycle === SESSION_LIFECYCLE.RESIDENT_COMPLETE;
  const sessionsById = index?.sessionsById;
  const sessionsPropertyDescriptor = inspectDataProperty(index, 'sessions');
  const validatedSessions = new Set();
  const listedSessionIds = new Set();
  const validateSession = (session, { fromArray = false, mapKey } = {}) => {
    const sessionKind = adapterOverride
      ? session?.sourceKind
      : requireExplicitSourceKind(session?.sourceKind, `session ${session?.id || '<unknown>'}`);
    if (sessionKind !== indexKind) {
      const error = new Error(`Source ownership mismatch: index ${indexKind}, session ${session?.id || '<unknown>'} ${sessionKind}`);
      error.code = 'SOURCE_OWNERSHIP_MISMATCH';
      throw error;
    }
    if (!validatedSessions.has(session)) {
      validateCanonicalIndexedSessionShape(session, indexKind, { allowResidentComplete });
      validatedSessions.add(session);
    }
    if (mapKey !== undefined && session.id !== mapKey) {
      const error = new Error(`Canonical index.sessionsById key ${mapKey} does not match session ${session.id}`);
      error.code = 'CANONICAL_CONTRACT_VIOLATION';
      throw error;
    }
    if (fromArray && sessionsById instanceof Map && sessionsById.get(session.id) !== session) {
      const error = new Error(`Canonical index.sessions must reference sessionsById[${session.id}]`);
      error.code = 'CANONICAL_CONTRACT_VIOLATION';
      throw error;
    }
  };

  if (sessionsById instanceof Map) {
    for (const [mapKey, session] of sessionsById.entries()) {
      validateSession(session, { mapKey });
    }
  }
  if (sessionsPropertyDescriptor.kind === 'data' && Array.isArray(sessionsPropertyDescriptor.value)) {
    for (const session of sessionsPropertyDescriptor.value) {
      validateSession(session, { fromArray: true });
      if (listedSessionIds.has(session.id)) {
        const error = new Error(`Canonical index.sessions contains duplicate session ${session.id}`);
        error.code = 'CANONICAL_CONTRACT_VIOLATION';
        throw error;
      }
      listedSessionIds.add(session.id);
    }
    if (sessionsById instanceof Map && listedSessionIds.size !== sessionsById.size) {
      const error = new Error('Canonical index.sessions and sessionsById must contain the same Session set');
      error.code = 'CANONICAL_CONTRACT_VIOLATION';
      throw error;
    }
  }

  validateCanonicalIndexFields(index);
  validateCanonicalSessionsProperty(index, { allowUninspectableSessions });
  if (index.projectQueryStore) {
    validateProjectQueryStore(index.projectQueryStore, [...sessionsById.keys()]);
  } else if (!allowResidentComplete) {
    const error = new Error('Canonical strict Index.projectQueryStore is required');
    error.code = 'CANONICAL_CONTRACT_VIOLATION';
    throw error;
  }
  if (!allowResidentComplete || index.legacyRawOwners !== undefined) {
    validateCanonicalLegacyRawOwnerIndex(index.legacyRawOwners, indexKind);
  }
  if (!allowResidentComplete) {
    if (!(index.materializationDependencies instanceof Map)) {
      const error = new Error('Canonical strict Index.materializationDependencies must be a Map');
      error.code = 'CANONICAL_CONTRACT_VIOLATION';
      throw error;
    }
    let dependencyBytes = 0;
    for (const [dependencyId, dependencySet] of index.materializationDependencies) {
      if (typeof dependencyId !== 'string' || dependencyId.trim() === '') {
        const error = new Error('Canonical materialization dependency Map keys must be non-empty strings');
        error.code = 'CANONICAL_CONTRACT_VIOLATION';
        throw error;
      }
      dependencyBytes += validateCanonicalDependencySet(
        dependencySet,
        indexKind,
        dependencyId,
      );
    }
    if (dependencyBytes > 128 * 1024 * 1024) {
      const error = new Error('Canonical Index materialization dependency store exceeds 128 MiB');
      error.code = 'CANONICAL_CONTRACT_VIOLATION';
      throw error;
    }
    const trustedStrictBoundary = trustedCodexStrictBoundary(adapter);
    const descriptorIndex = trustedStrictBoundary
      ? createTrustedCodexIndexView(index)
      : index;
    for (const session of validatedSessions) {
      const descriptor = session.materializationDescriptor;
      const dependencySet = index.materializationDependencies.get(descriptor.dependencySetId);
      if (!dependencySet) {
        const error = new Error(`Missing materialization dependency set ${descriptor.dependencySetId}`);
        error.code = 'CANONICAL_CONTRACT_VIOLATION';
        throw error;
      }
      invokeReadOnlyMaterializationValidator({
        callback: adapter.validateMaterializationDescriptor,
        args: {
          index: descriptorIndex,
          indexedSession: session,
          descriptor,
          dependencySet,
        },
        guardedValues: trustedStrictBoundary
          ? [descriptorIndex, session, dependencySet]
          : [index],
        label: 'Adapter materialization descriptor validation',
      });
    }
    const legacyValidationIndex = trustedStrictBoundary
      ? Object.freeze({ sessionsById: new Map(index.sessionsById) })
      : index;
    invokeReadOnlyMaterializationValidator({
      callback: adapter.validateLegacyRawOwnerIndex,
      args: {
        index: legacyValidationIndex,
        legacyRawOwners: index.legacyRawOwners,
      },
      guardedValues: trustedStrictBoundary
        ? [legacyValidationIndex, index.legacyRawOwners]
        : [index],
      label: 'Adapter legacy Raw owner validation',
    });
  }
  return indexKind;
}

async function materializeSessionForIndex(index, indexedSession, options = {}) {
  const indexKind = validateCanonicalIndexFields(index);
  const adapter = requireSourceAdapter(indexKind);
  return materializeSessionWithAdapter(index, indexedSession, adapter, options);
}

async function materializeSessionWithAdapter(index, indexedSession, adapter, options = {}) {
  const indexKind = validateCanonicalIndexFields(index);
  const trustedResidentBoundary = adapter.sessionLifecycle === SESSION_LIFECYCLE.RESIDENT_COMPLETE
    && adapter.materializeSession === materializeResidentSession;
  const trustedStrictBoundary = trustedCodexStrictBoundary(adapter);
  if (!trustedResidentBoundary && !trustedStrictBoundary) {
    validateIndexOwnership(index, { adapter });
  }
  if (adapter.kind !== indexKind) {
    const error = new Error(`Source ownership mismatch: index ${indexKind}, adapter ${adapter.kind}`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  if (!(index?.sessionsById instanceof Map)
    || index.sessionsById.get(indexedSession?.id) !== indexedSession) {
    const error = new Error(`Canonical Index does not own Session ${indexedSession?.id || '<unknown>'}`);
    error.code = 'CANONICAL_CONTRACT_VIOLATION';
    throw error;
  }
  const allowResidentComplete = adapter.sessionLifecycle === SESSION_LIFECYCLE.RESIDENT_COMPLETE;
  validateCanonicalIndexedSessionShape(indexedSession, indexKind, { allowResidentComplete });
  throwIfAborted(options.signal);

  if (trustedResidentBoundary) {
    const materializedSession = await adapter.materializeSession({
      index,
      indexedSession,
      signal: options.signal,
      indexRevision: options.indexRevision,
    });
    throwIfAborted(options.signal);
    if (materializedSession !== indexedSession) {
      throw materializationContractViolation(
        'Compatibility materialization must return the exact resident Session identity',
      );
    }
    validateCanonicalMaterializedSessionShape(
      indexedSession,
      materializedSession,
      indexKind,
      { allowResidentComplete: true, index },
    );
    return materializedSession;
  }

  const dependencySet = allowResidentComplete
    ? undefined
    : index.materializationDependencies?.get(
      indexedSession.materializationDescriptor.dependencySetId,
    );
  if (trustedStrictBoundary) {
    if (!dependencySet) {
      throw trustedStrictBoundaryError(
        `Missing materialization dependency set ${indexedSession.materializationDescriptor.dependencySetId}`,
      );
    }
    validateCanonicalDependencySet(
      dependencySet,
      indexKind,
      indexedSession.materializationDescriptor.dependencySetId,
    );
    const indexView = createTrustedCodexIndexView(index);
    invokeReadOnlyMaterializationValidator({
      callback: adapter.validateMaterializationDescriptor,
      args: {
        index: indexView,
        indexedSession,
        descriptor: indexedSession.materializationDescriptor,
        dependencySet,
      },
      guardedValues: [indexView, indexedSession, dependencySet],
      label: 'Adapter materialization descriptor validation',
    });
    const capturedOwnership = captureTrustedStrictOwnership(
      index,
      indexedSession,
      dependencySet,
      indexView,
    );
    let materializedSession;
    let materializationRejected = false;
    let materializationError;
    try {
      materializedSession = await adapter.materializeSession({
        index: indexView,
        indexedSession,
        dependencySet,
        signal: options.signal,
        indexRevision: options.indexRevision,
      });
    } catch (error) {
      materializationRejected = true;
      materializationError = error;
    }
    if (!trustedStrictOwnershipMatches(
      index,
      indexedSession,
      dependencySet,
      capturedOwnership,
    )) {
      throw materializationContractViolation(
        'Materialization mutated the selected Codex ownership boundary',
        materializationRejected ? materializationError : undefined,
        materializationRejected,
      );
    }
    if (materializationRejected) throw materializationError;
    throwIfAborted(options.signal);
    validateCanonicalMaterializedSessionShape(
      indexedSession,
      materializedSession,
      indexKind,
      {
        allowResidentComplete: false,
        index,
        allowedPrivateFields: adapter.materializedPrivateFields,
      },
    );
    invokeReadOnlyMaterializationValidator({
      callback: adapter.validateMaterializedPrivateState,
      args: {
        indexedSession,
        session: materializedSession,
      },
      guardedValues: [indexedSession, materializedSession],
      label: 'Adapter materialized private-state validation',
    });
    return materializedSession;
  }
  const materializationInputFingerprint = captureGraphFingerprint(index);
  let materializedSession;
  let materializationRejected = false;
  let materializationError;
  try {
    materializedSession = await adapter.materializeSession({
      index,
      indexedSession,
      dependencySet,
      signal: options.signal,
      indexRevision: options.indexRevision,
    });
  } catch (error) {
    materializationRejected = true;
    materializationError = error;
  }
  let materializationInputsUnchanged = false;
  try {
    materializationInputsUnchanged = graphFingerprintMatches(
      index,
      materializationInputFingerprint,
    );
  } catch (error) {
    throw materializationContractViolation(
      'Materialization left the captured Index unverifiable',
      materializationRejected ? materializationError : error,
      true,
    );
  }
  if (!materializationInputsUnchanged) {
    throw materializationContractViolation(
      'Materialization mutated the captured Index or Indexed Session',
      materializationRejected ? materializationError : undefined,
      materializationRejected,
    );
  }
  if (materializationRejected) throw materializationError;
  throwIfAborted(options.signal);
  validateCanonicalMaterializedSessionShape(
    indexedSession,
    materializedSession,
    indexKind,
    {
      allowResidentComplete,
      index,
      allowedPrivateFields: adapter.materializedPrivateFields,
    },
  );
  if (!allowResidentComplete) {
    invokeReadOnlyMaterializationValidator({
      callback: adapter.validateMaterializedPrivateState,
      args: {
        indexedSession,
        session: materializedSession,
      },
      guardedValues: [index, materializedSession],
      label: 'Adapter materialized private-state validation',
    });
  }
  return materializedSession;
}

function supportedSourceKinds() {
  return [...adapters.keys()];
}

function supportedSourceOptions() {
  return supportedSourceKinds().map((kind) => {
    const adapter = requireSourceAdapter(kind);
    return {
      kind: adapter.kind,
      label: adapter.label || adapter.kind,
      homeOption: adapter.homeOption,
      homeLabel: adapter.homeLabel || `${adapter.label || adapter.kind} home`,
    };
  });
}

function queryForIndex(index) {
  const sourceKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  validateCanonicalIndexFields(index);
  return requireSourceAdapter(sourceKind).query;
}

function adapterForSession(session) {
  return requireSourceAdapter(requireExplicitSourceKind(session?.sourceKind, `session ${session?.id || '<unknown>'}`));
}

async function buildEventDetailForSession(index, session, eventId, layer, options = {}) {
  const indexKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  const sessionSourceKind = validateCanonicalSessionShape(session, indexKind);
  const requestedLayer = layer === undefined ? 'main' : layer;
  let selectedLogicalEvent = null;
  if (requestedLayer === 'raw') {
    const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
    if (!raw) return null;
    validateCanonicalRawEventShape(raw, sessionSourceKind);
  } else {
    const event = session.logicalEvents.find((candidate) => (
      candidate.id === eventId && candidate.layer === requestedLayer
    ));
    if (!event) return null;
    selectedLogicalEvent = event;
    validateCanonicalLogicalEventShape(event, sessionSourceKind);
    validateLogicalEventRawReferences(session, event, sessionSourceKind);
  }
  const adapter = adapterForSession(session);
  if (adapter.kind !== indexKind) {
    const error = new Error(`Source ownership mismatch: index ${indexKind}, session ${session?.id || '<unknown>'} ${adapter.kind}`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  const detail = await adapter.buildEventDetail(index, session, eventId, layer, options);
  if (requestedLayer === 'raw') return detail;

  return conformStructuredLogicalDetail(detail, selectedLogicalEvent, {
    layer: requestedLayer,
  });
}

function conformStructuredLogicalDetail(detail, selectedLogicalEvent, options = {}) {
  validateLogicalDetailEnvelope(detail, selectedLogicalEvent, {
    layer: options.layer ?? selectedLogicalEvent?.layer,
  });
  validateStructuredLogicalDetailDto(detail);
  const sanitized = sanitizeStructuredLogicalDetailDto(detail, options);
  validateStructuredLogicalDetailDto(sanitized);
  validateLogicalDetailEnvelope(sanitized, selectedLogicalEvent, {
    layer: options.layer ?? selectedLogicalEvent?.layer,
  });
  return sanitized;
}

function validateLogicalEventRawReferences(session, event, expectedSourceKind) {
  const rawById = new Map(session.rawEvents.map((raw) => [raw.rawId, raw]));
  for (const reference of event.rawRefs) {
    const raw = rawById.get(reference.rawId);
    if (!raw) {
      const error = new Error(`Canonical logical event ${event.id}.rawRefs references missing raw event ${reference.rawId}`);
      error.code = 'CANONICAL_CONTRACT_VIOLATION';
      throw error;
    }
    validateCanonicalRawEventShape(raw, expectedSourceKind);
  }
}

async function readImagePreviewForSession(index, session, eventId, previewId, options = {}) {
  const indexKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  const sessionSourceKind = validateCanonicalSessionShape(session, indexKind);
  const event = session.logicalEvents.find((candidate) => candidate.id === eventId);
  if (!event) return { statusCode: 404, error: 'Unknown event' };
  validateCanonicalLogicalEventShape(event, sessionSourceKind);
  validateLogicalEventRawReferences(session, event, sessionSourceKind);
  const adapter = adapterForSession(session);
  if (adapter.kind !== indexKind) {
    const error = new Error(`Source ownership mismatch: index ${indexKind}, session ${session?.id || '<unknown>'} ${adapter.kind}`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  return adapter.readImagePreview(index, session, eventId, previewId, {
    ...options,
    expectedSourceKind: sessionSourceKind,
  });
}

async function readIndexedRawRecord(index, session, rawId, options = {}) {
  const raw = session?.rawEvents?.find((candidate) => candidate.rawId === rawId);
  if (!raw) return null;
  const indexKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  const adapter = adapterForSession(session);
  if (adapter.kind !== indexKind) {
    const error = new Error(`Source ownership mismatch: index ${indexKind}, session ${session?.id || '<unknown>'} ${adapter.kind}`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  validateCanonicalRawEventShape(raw, indexKind);
  return adapter.readRawRecord(index, session, raw, options);
}

function resolveLegacyRawOwnerForIndex(index, file, line) {
  const indexKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  const adapter = requireSourceAdapter(indexKind);
  const owner = adapter.resolveLegacyRaw(index, file, line);
  if (!owner) return null;
  const keys = Object.keys(owner).sort();
  if (keys.length !== 3
      || keys[0] !== 'line'
      || keys[1] !== 'rawIdHint'
      || keys[2] !== 'sessionId'
      || typeof owner.sessionId !== 'string'
      || !owner.sessionId
      || typeof owner.rawIdHint !== 'string'
      || !owner.rawIdHint
      || !Number.isSafeInteger(owner.line)
      || owner.line < 0) {
    const error = new Error('Adapter returned an invalid legacy Raw owner');
    error.code = 'CANONICAL_CONTRACT_VIOLATION';
    throw error;
  }
  const indexedSession = index.sessionsById.get(owner.sessionId);
  if (!indexedSession) {
    const error = new Error(`Legacy Raw owner references unknown Session ${owner.sessionId}`);
    error.code = 'CANONICAL_CONTRACT_VIOLATION';
    throw error;
  }
  const sessionSourceKind = requireExplicitSourceKind(
    indexedSession.sourceKind,
    `session ${indexedSession.id || '<unknown>'}`,
  );
  if (sessionSourceKind !== indexKind || indexedSession.id !== owner.sessionId) {
    const error = new Error(`Source ownership mismatch for legacy Raw owner ${owner.sessionId}`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  return { ...owner, adapter };
}

async function readLegacyRawLineForSession(index, materializedSession, owner, adapter, options = {}) {
  const indexKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  const sessionSourceKind = validateCanonicalSessionShape(materializedSession, indexKind);
  if (materializedSession.id !== owner.sessionId) {
    const error = new Error(`Materialized Session ${materializedSession.id} does not own legacy Raw lookup`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  const materializedRaw = materializedSession.rawEvents.find((candidate) => (
    candidate.rawId === owner.rawIdHint
  ));
  if (!materializedRaw) return null;
  validateCanonicalRawEventShape(materializedRaw, sessionSourceKind);
  return adapter.readLegacyRaw(index, {
    session: materializedSession,
    raw: materializedRaw,
    owner,
  }, options);
}

module.exports = {
  SOURCE_KIND,
  adapterForSession,
  buildEventDetailForSession,
  conformStructuredLogicalDetail,
  createSourceAdapterRegistry,
  defineSourceAdapter,
  getSourceAdapter,
  materializeSessionForIndex,
  materializeSessionWithAdapter,
  normalizeSourceKind,
  queryForIndex,
  readImagePreviewForSession,
  readIndexedRawRecord,
  readLegacyRawLineForSession,
  resolveLegacyRawOwnerForIndex,
  requireSourceAdapter,
  requireExplicitSourceKind,
  supportedSourceOptions,
  supportedSourceKinds,
  validateIndexOwnership,
};
